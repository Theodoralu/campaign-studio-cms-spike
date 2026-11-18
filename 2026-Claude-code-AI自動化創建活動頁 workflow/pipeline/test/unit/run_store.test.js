"use strict";
/**
 * D11：RunStore——同一套案例跑兩個後端（本機資料夾、S3）。S3 用記憶體版（語意照 S3：ETag、If-Match 不符 412、版本控管）。
 * 計畫的完成條件「兩個 client 交錯存檔，後者收到 409」＝第二個測試。
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const S = require("../../core/store");
const { createMemoryS3 } = require("../../core/store/memory_s3");
const { enforceProductTruth } = require("../../core/store/truth_fields");
const { canonical } = require("../../core/store/fingerprint");

const FIX = path.join(__dirname, "..", "fixtures", "runs", "2026-10-27-wb-085823");
const read = (f) => JSON.parse(fs.readFileSync(path.join(FIX, f), "utf8"));
const clone = (o) => JSON.parse(JSON.stringify(o));
let tick = 0;
const clock = { iso: () => new Date(Date.UTC(2026, 10, 18, 2, 0, tick++)).toISOString() };

const BACKENDS = {
  fs: () => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cs-store-")); return { store: S.createFsRunStore(dir, { clock }), dir }; },
  s3: () => { const s3 = createMemoryS3(); return { store: S.createS3RunStore({ client: s3, bucket: "test-bucket", prefix: "runs" }, { clock }), s3 }; },
};
async function seeded(make) {
  const ctx = make(); const id = "2026-11-18-wb-100000";
  await ctx.store.createRun(id, { stage: "ready", input: { url: "https://tw.buy.yahoo.com/?sub=1035" } });
  await ctx.store.putJson(id, "snapshot.json", read("snapshot.replay.json"));
  const first = await ctx.store.saveDraft(id, read("draft.golden.json"), { source: "system", note: "建立" });
  return { ...ctx, id, first };
}

for (const [name, make] of Object.entries(BACKENDS)) {
  test(`[${name}] 建立、列表、狀態檔：重複建立同編號＝409；patchMeta 合併且留 createdAt`, async () => {
    const { store, id } = await seeded(make);
    assert.deepStrictEqual(await store.listRuns(), [id]);
    await assert.rejects(() => store.createRun(id), (e) => e instanceof S.ConflictError && e.code === "run-exists" && e.status === 409);
    const m = await store.patchMeta(id, { stage: "gating" });
    assert.strictEqual(m.stage, "gating"); assert.strictEqual(m.id, id); assert.ok(m.createdAt && m.updatedAt >= m.createdAt); assert.ok(m.sysDraftWriteAt, "系統寫草稿會記時刻");
    await assert.rejects(() => store.readMeta("../etc"), /活動編號格式不對/);
  });

  test(`[${name}] 兩個人交錯存檔：先存的成功，後存的收到 409 與最新版，沒有蓋掉`, async () => {
    const { store, id } = await seeded(make);
    const a = await store.getDraft(id), b = await store.getDraft(id);
    assert.strictEqual(a.etag, b.etag);
    a.draft.page.ctaText = "甲改的"; b.draft.page.ctaText = "乙改的";
    const ra = await store.saveDraft(id, a.draft, { ifMatch: a.etag, actor: "甲" });
    assert.strictEqual(ra.changed, true);
    await assert.rejects(() => store.saveDraft(id, b.draft, { ifMatch: b.etag, actor: "乙" }),
      (e) => e instanceof S.ConflictError && e.status === 409 && e.code === "stale-draft" && e.latest.draft.page.ctaText === "甲改的" && e.latest.etag === ra.etag);
    assert.strictEqual((await store.getDraft(id)).draft.page.ctaText, "甲改的");
    // 乙拿最新版重改一次就能存
    const b2 = await store.getDraft(id); b2.draft.page.ctaText = "乙改的";
    await store.saveDraft(id, b2.draft, { ifMatch: b2.etag, actor: "乙" });
    assert.match(await store.readLog(id), /草稿存檔被擋：乙 手上的版本不是最新版/);
    // 畫面存檔不帶版本＝擋（系統寫入可以不帶）
    await assert.rejects(() => store.saveDraft(id, b2.draft, {}), (e) => e.code === "missing-base");
  });

  test(`[${name}] 真的同時到（都通過了前置比對）：後端的條件式寫入只放一個過`, async () => {
    const { store, id } = await seeded(make);
    const base = await store.getDraft(id);
    const mk = (t) => { const d = clone(base.draft); d.page.ctaText = t; return d; };
    const rs = await Promise.allSettled([store.saveDraft(id, mk("一"), { ifMatch: base.etag }), store.saveDraft(id, mk("二"), { ifMatch: base.etag }), store.saveDraft(id, mk("三"), { ifMatch: base.etag })]);
    assert.strictEqual(rs.filter((r) => r.status === "fulfilled").length, 1, "只有一個成功");
    assert.ok(rs.filter((r) => r.status === "rejected").every((r) => r.reason.code === "stale-draft"));
  });

  test(`[${name}] 真值欄照伺服器：畫面改不了價格／品名／連結；系統寫入可以改；改了哪些有回報`, async () => {
    const { store, id } = await seeded(make);
    const c = await store.getDraft(id); const p0 = c.draft.products[0], orig = { price: p0.price, name: p0.name, url: p0.url };
    p0.price = 1; p0.name = "被畫面改掉的名字"; p0.tag = "標籤可以改";
    const r = await store.saveDraft(id, c.draft, { ifMatch: c.etag, actor: "業務" });
    assert.deepStrictEqual(r.corrected.map((x) => x.field).sort(), ["name", "price"]);
    const saved = (await store.getDraft(id)).draft.products[0];
    assert.strictEqual(saved.price, orig.price); assert.strictEqual(saved.name, orig.name); assert.strictEqual(saved.tag, "標籤可以改");
    assert.match(await store.readLog(id), /真值欄照伺服器：2 欄改回伺服器的值/);
    const s = await store.getDraft(id); s.draft.products[0].price = orig.price - 5;
    const rs = await store.saveDraft(id, s.draft, { ifMatch: s.etag, source: "system", note: "價格對真" });
    assert.deepStrictEqual(rs.corrected, []); assert.strictEqual((await store.getDraft(id)).draft.products[0].price, orig.price - 5);
  });

  test(`[${name}] 核可綁內容指紋：內容沒變的存檔不動核可；內容變了＝核可失效；看舊版的人不能核可`, async () => {
    const { store, id } = await seeded(make);
    const seen = await store.getDraft(id);
    const ap = await store.approve(id, { by: "審核者", expectFingerprint: seen.fingerprint });
    assert.strictEqual(ap.fingerprint, seen.fingerprint); assert.strictEqual((await store.approvalState(id)).approved, true);
    // 內容一樣（只是鍵順序不同）再存一次：核可還在
    const reordered = { products: seen.draft.products, assets: seen.draft.assets, meta: seen.draft.meta, page: seen.draft.page };
    const same = await store.saveDraft(id, reordered, { ifMatch: seen.etag, actor: "業務" });
    assert.strictEqual(same.changed, false); assert.strictEqual(same.approvalInvalidated, false); assert.strictEqual((await store.approvalState(id)).approved, true);
    // 改內容：核可失效
    const c = await store.getDraft(id); c.draft.page.ctaText = "核可後又改";
    const ch = await store.saveDraft(id, c.draft, { ifMatch: c.etag, actor: "業務" });
    assert.strictEqual(ch.approvalInvalidated, true);
    const m = await store.readMeta(id);
    assert.strictEqual(m.approvedAt, null); assert.strictEqual(m.approvedAtPrev, ap.approvedAt); assert.ok(m.approvalInvalidatedAt);
    assert.deepStrictEqual({ approved: (await store.approvalState(id)).approved }, { approved: false });
    assert.match(await store.readLog(id), /核可失效：核可後內容有變更/);
    // 審核者畫面上還是舊版＝不給核可
    await assert.rejects(() => store.approve(id, { by: "審核者", expectFingerprint: seen.fingerprint }), (e) => e.code === "approve-stale" && e.status === 409);
    // 保險：旗標沒清到（繞過 saveDraft 直接寫檔）也不算已核可
    await store.approve(id, { by: "審核者" });
    const raw = await store.getDraft(id); raw.draft.page.ctaText = "繞過存檔流程"; await store.putJson(id, "draft.json", raw.draft);
    const st = await store.approvalState(id); assert.strictEqual(st.approved, false); assert.strictEqual(st.stale, true);
  });

  test(`[${name}] 留舊版：每次覆寫草稿都拿得回上一版`, async () => {
    const { store, id } = await seeded(make);
    for (const t of ["第二版", "第三版"]) { const c = await store.getDraft(id); c.draft.page.ctaText = t; await store.saveDraft(id, c.draft, { ifMatch: c.etag, actor: "業務" }); }
    const vs = await store.listDraftVersions(id);
    assert.strictEqual(vs.length, 2, "現行＝第三版，舊版兩份");
    const v1 = await store.getDraftVersion(id, vs[0].versionId), v2 = await store.getDraftVersion(id, vs[1].versionId);
    assert.strictEqual(v1.draft.page.ctaText, read("draft.golden.json").page.ctaText); assert.strictEqual(v2.draft.page.ctaText, "第二版");
  });

  test(`[${name}] log 同時寫十行：一行都不掉`, async () => {
    const { store, id } = await seeded(make);
    await Promise.all(Array.from({ length: 10 }, (_, i) => store.appendLog(id, `並行第 ${i} 行`)));
    const log = await store.readLog(id);
    for (let i = 0; i < 10; i++) assert.ok(log.includes(`並行第 ${i} 行`), `掉了第 ${i} 行`);
  });
}

test("[fs] 資料夾擺法與單機版相同：runs/<id>/ 底下就是那幾個檔，內容通過 schema，舊版叫 draft.v1.json", async () => {
  const { store, id, dir } = await seeded(BACKENDS.fs);
  const c = await store.getDraft(id); c.draft.page.ctaText = "改"; await store.saveDraft(id, c.draft, { ifMatch: c.etag });
  const names = fs.readdirSync(path.join(dir, id)).sort();
  assert.deepStrictEqual(names, ["draft.json", "draft.v1.json", "snapshot.json", "wb.log", "wb_meta.json"]);
  assert.ok(!names.some((n) => n.includes(".tmp-")), "不留暫存檔");
  const { spawnSync } = require("node:child_process"); const PIPE = path.resolve(__dirname, "..", "..");
  const v = spawnSync(process.execPath, [path.join(PIPE, "tools", "schema", "validate.js"), path.join(PIPE, "schemas"), path.join(dir, id, "draft" + ".json"), path.join(dir, id, "snapshot.json"), path.join(dir, id, "wb_meta.json")], { encoding: "utf8" });
  assert.strictEqual(v.status, 0, v.stdout + v.stderr);
});

test("[s3] 寫入真的帶條件：覆寫帶 If-Match、新建帶 If-None-Match；鍵在 runs/<id>/ 底下", async () => {
  const { store, id, s3 } = await seeded(BACKENDS.s3);
  const c = await store.getDraft(id); c.draft.page.ctaText = "改"; await store.saveDraft(id, c.draft, { ifMatch: c.etag });
  const puts = s3.calls.filter((x) => x.op === "put");
  assert.ok(puts.every((p) => p.Key.startsWith(`runs/${id}/`)));
  const draftPuts = puts.filter((p) => p.Key.endsWith("/draft.json"));
  assert.strictEqual(draftPuts[0].IfNoneMatch, "*"); assert.strictEqual(draftPuts[1].IfMatch, c.etag);
  assert.ok(puts.filter((p) => /wb_meta\.json$|wb\.log$/.test(p.Key)).every((p) => p.IfMatch || p.IfNoneMatch === "*"), "狀態檔與 log 也都是條件式寫入");
  assert.ok(!puts.some((p) => /draft\.v\d+\.json$/.test(p.Key)), "S3 不另存 draft.vN——靠 bucket 版本控管");
});

test("指紋：鍵順序、縮排無關；陣列順序有關；真值欄函式遇到不在伺服器也不在快照的商品＝不動", () => {
  assert.strictEqual(S.fingerprint({ a: 1, b: [1, 2], c: { x: 1, y: undefined } }), S.fingerprint({ c: { x: 1 }, b: [1, 2], a: 1 }));
  assert.notStrictEqual(S.fingerprint({ b: [1, 2] }), S.fingerprint({ b: [2, 1] }));
  assert.strictEqual(canonical({ b: 1, a: "中" }), '{"a":"中","b":1}');
  const inc = { products: [{ gdid: "999", name: "新", price: 5 }] };
  assert.deepStrictEqual(enforceProductTruth(inc, { serverDraft: { products: [] }, snapshot: { products: [] } }), []);
  // 畫面新加一件快照裡有的商品：真值取自快照；快照劃線價不高於現價＝不留欄
  const inc2 = { products: [{ gdid: "7", name: "亂填", price: 1, marketPrice: 9999, url: "u" }] };
  const cor = enforceProductTruth(inc2, { serverDraft: { products: [] }, snapshot: { products: [{ gdid: 7, name: "真名", price: 100, marketPrice: 100, url: "https://x" }] } });
  assert.deepStrictEqual(inc2.products[0], { gdid: "7", name: "真名", price: 100, url: "https://x" }); assert.strictEqual(cor.length, 4); assert.ok(cor.every((c) => c.source === "snapshot"));
});

test("storeFromEnv：預設本機資料夾；選 S3 但沒裝 SDK＝講清楚怎麼辦", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cs-store-env-"));
  assert.strictEqual(S.storeFromEnv({ CS_RUNS_DIR: dir }).kind, "fs");
  assert.throws(() => S.storeFromEnv({}), /CS_RUNS_DIR/); assert.throws(() => S.storeFromEnv({ CS_STORE: "s3" }), /CS_S3_BUCKET/);
  let hasSdk = true; try { require.resolve("@aws-sdk/client-s3"); } catch (e) { hasSdk = false; }
  if (!hasSdk) assert.throws(() => S.storeFromEnv({ CS_STORE: "s3", CS_S3_BUCKET: "b" }), /需要先安裝 @aws-sdk\/client-s3/);
});
