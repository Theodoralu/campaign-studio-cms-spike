"use strict";
/**
 * D13：主流程在新伺服器上走通——建立 → 編修存檔 → 檢查 → 核可 → 製作 HTML 檔 → 下載 → 舊版還原。
 * 真的 HTTP 請求打隨機埠的伺服器；資料走 RunStore（本機資料夾後端）。不連外：
 *   uther＝回放 D6 錄的卡帶（店家型 sub=1035）；建立期價格對真那一批沒有卡帶，從黃金快照合成（價格與快照相同＝沒有變價）
 *   探圖片＝固定取第二張；顯示檢查（Chrome）＝假的，回通過。真 Chrome 那段由 CI 的 aem-verify job 驗。
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const PIPE = path.resolve(__dirname, "..", "..");
const GOLD = JSON.parse(fs.readFileSync(path.join(PIPE, "test", "fixtures", "runs", "2026-10-27-wb-085823", "snapshot.uther.json"), "utf8"));
process.env.CS_HTTP_MODE = "replay"; process.env.CS_HTTP_CASSETTE_DIR = path.join(PIPE, "test", "fixtures", "http"); process.env.CS_NOW = GOLD.fetchedAt;

const { createApp } = require("../../cms/app");
const { createJobs } = require("../../cms/jobs");
const { runIdAt } = require("../../cms/runs");
const A = require("../../cms/auth");
const { loadApprovers } = require("../../cms/approvers");
const S = require("../../core/store");
const clock = require("../../lib/clock");
const { createUtherClient } = require("../../core/uther/client");
const exp = require("../../core/export");

const APPROVER = "approver@dev.local", SALES = "sales@dev.local", URL1035 = GOLD.sourceUrl;

function fakeDeps(over = {}) {
  const real = createUtherClient({ log: () => {} });
  const byId = new Map(GOLD.products.map((p) => [String(p.gdid), p]));
  const uther = Object.create(real);
  uther.productsByIds = async (ids) => { try { return await real.productsByIds(ids); } catch (e) { return { items: ids.map(String).filter((g) => byId.has(g)).map((g) => { const p = byId.get(g); return { gdid: g, price: p.price, currentPrice: p.currentPrice ?? null, marketPrice: p.marketPrice ?? null, stockStatus: p.stockStatus || "NORMAL", url: p.url }; }) }; } };
  const verifyCalls = [];
  const hold = { create: null, verify: null }; // 測試要看「工作進行中」的樣子時，放一個 promise 讓工作停在半路
  return { clock, uther, hold, fetchBrandId: async () => ({ brandIds: [], brandName: null }), pickCircleImg: async (imgs) => { if (hold.create) await hold.create; return { img: imgs[1] || imgs[0], notes: [] }; },
    verifyHtml: async (a) => { if (hold.verify) await hold.verify; verifyCalls.push(a); return { ok: true, report: { externalHosts: ["img.yec.tw"] } }; }, verifyCalls, assetRoots: exp.defaultAssetRoots(PIPE), offline: true, publisher: null, ...over };
}
async function boot(over) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cs-flow-"));
  const store = S.createFsRunStore(dir), jobs = createJobs({ onError: () => {} }), deps = fakeDeps(over);
  const app = createApp({ store, auth: A.devAuth({ env: {} }), approvers: loadApprovers(path.join(PIPE, "config", "approvers.json")), deps, jobs });
  const srv = await new Promise((r) => { const s = app.listen(0, "127.0.0.1", () => r(s)); });
  const base = `http://127.0.0.1:${srv.address().port}`;
  const call = async (method, p, { as = SALES, body, headers = {} } = {}) => { const r = await fetch(base + p, { method, headers: { ...(as ? { "x-dev-user": as } : {}), ...(body !== undefined ? { "content-type": "application/json" } : {}), ...headers }, body: body !== undefined ? JSON.stringify(body) : undefined }); const text = await r.text(); let j = null; try { j = JSON.parse(text); } catch (e) { /* 非 JSON */ } return { status: r.status, body: j, text, headers: r.headers }; };
  return { store, jobs, deps, call, dir, port: srv.address().port, close: () => new Promise((r) => srv.close(r)) };
}
async function created(s, body = { url: URL1035, scenario: "同品類-情境×優惠", theme: "" }) {
  const r = await s.call("POST", "/api/runs", { body }); assert.strictEqual(r.status, 200, r.text);
  await s.jobs.wait(r.body.id);
  const st = await s.call("GET", `/api/runs/${r.body.id}/status`);
  assert.strictEqual(st.body.stage, "ready", `建立沒有走到 ready：${st.body.error}\n${await s.store.readLog(r.body.id)}`);
  return r.body.id;
}

test("建立：貼網址 → 背景工作跑完 → ready；快照、草稿、商品狀態、檢查報告都在，建立者＝登入的人", async () => {
  const s = await boot();
  try {
    let go; s.deps.hold.create = new Promise((r) => (go = r));
    const r = await s.call("POST", "/api/runs", { body: { url: URL1035, scenario: "同品類-情境×優惠", theme: "", themeColor: "#1D5F8A" } });
    assert.strictEqual(r.status, 200, r.text); assert.strictEqual(r.body.id, runIdAt(GOLD.fetchedAt)); assert.match(r.body.kvVariant, /^layout-\d{3}$/); assert.strictEqual(r.body.layoutChoice.by, "ai");
    assert.strictEqual((await s.call("GET", `/api/runs/${r.body.id}/status`)).body.busy, "create");
    assert.strictEqual((await s.call("PUT", `/api/runs/${r.body.id}/draft.json`, { body: { page: {}, products: [] } })).body.code, "busy", "建立中不收存檔");
    go(); s.deps.hold.create = null; await s.jobs.wait(r.body.id);
    const id = r.body.id, st = (await s.call("GET", `/api/runs/${id}/status`)).body;
    assert.strictEqual(st.stage, "ready", `${st.error}\n${await s.store.readLog(id)}`); assert.strictEqual(st.busy, null); assert.strictEqual(st.priceTruth.mode, "uther");
    const meta = await s.store.readMeta(id);
    assert.match(await s.store.readLog(id), /建立期價格對真：\d+ 件與 uther 一致/, "log 照實寫比的是 uther");
    assert.strictEqual(meta.input.ownerEmail, SALES); assert.strictEqual(meta.engineUsed, "rules"); assert.strictEqual(meta.input.engine, "rules");
    const d = await s.call("GET", `/api/runs/${id}/draft.json`);
    assert.ok(d.headers.get("x-draft-version")); assert.match(d.headers.get("x-draft-fingerprint"), /^fp_/);
    assert.ok(d.body.products.length >= 20); assert.strictEqual(d.body.page.kvVariant, r.body.kvVariant); assert.strictEqual(d.body.page.theme.customColor, "#1D5F8A");
    const snap = (await s.call("GET", `/api/runs/${id}/snapshot.json`)).body; assert.strictEqual(snap.products.length, GOLD.products.length); assert.match(snap.products[0].source, /^uther:/);
    assert.strictEqual((await s.call("GET", `/api/runs/${id}/product_check.json`)).body.layer, "uther");
    const g = (await s.call("GET", `/api/runs/${id}/gate_report.json`)).body; assert.ok(g.result && g.counts);
    assert.strictEqual((await s.call("GET", "/api/runs")).body[0].id, id);
    // 同一秒再建一檔＝讓位成 -2
    const r2 = await s.call("POST", "/api/runs", { body: { url: URL1035 } }); assert.strictEqual(r2.body.id, id + "-2"); await s.jobs.wait(r2.body.id);
  } finally { await s.close(); }
});

test("建立被擋：沒網址、不是購物中心網址、色碼不對；來源抓不到＝狀態 error 加一句白話", async () => {
  const s = await boot({ uther: { productsByIds: async () => { throw new Error("ECONNRESET"); }, idsByStoreId: async () => { throw new Error("ECONNRESET"); }, calls: [] } });
  try {
    assert.strictEqual((await s.call("POST", "/api/runs", { body: {} })).body.code, "missing-url");
    assert.strictEqual((await s.call("POST", "/api/runs", { body: { url: "https://example.com/x" } })).body.code, "bad-url");
    assert.strictEqual((await s.call("POST", "/api/runs", { body: { url: URL1035, themeColor: "藍色" } })).body.code, "bad-color");
    assert.strictEqual((await s.call("POST", "/api/runs", { as: null, body: { url: URL1035 } })).status, 401);
    const r = await s.call("POST", "/api/runs", { body: { url: URL1035 } }); await s.jobs.wait(r.body.id);
    const st = (await s.call("GET", `/api/runs/${r.body.id}/status`)).body;
    assert.strictEqual(st.stage, "error"); assert.match(st.error, /^建立時發生問題，請再試一次/); assert.match(await s.store.readLog(r.body.id), /建立失敗：/);
  } finally { await s.close(); }
});

test("編修存檔：帶版本才收；舊版＝409；真值欄改回；存完核可前要重新檢查", async () => {
  const s = await boot();
  try {
    const id = await created(s);
    const a = await s.call("GET", `/api/runs/${id}/draft.json`), v0 = a.headers.get("x-draft-version");
    const d = a.body; d.page.ctaText = "立即逛逛"; const orig = d.products[0].price; d.products[0].price = 1;
    assert.strictEqual((await s.call("PUT", `/api/runs/${id}/draft.json`, { body: d })).body.code, "missing-base");
    const ok = await s.call("PUT", `/api/runs/${id}/draft.json`, { body: d, headers: { "x-draft-base": v0 } });
    assert.strictEqual(ok.status, 200, ok.text); assert.deepStrictEqual(ok.body.corrected.map((c) => c.field), ["price"]); assert.notStrictEqual(ok.body.version, v0);
    const now = (await s.call("GET", `/api/runs/${id}/draft.json`)).body; assert.strictEqual(now.page.ctaText, "立即逛逛"); assert.strictEqual(now.products[0].price, orig);
    const stale = await s.call("PUT", `/api/runs/${id}/draft.json`, { body: d, headers: { "if-match": v0 } });
    assert.strictEqual(stale.status, 409); assert.strictEqual(stale.body.code, "stale-draft"); assert.ok(stale.body.latest.fingerprint);
    assert.strictEqual((await s.call("PUT", `/api/runs/${id}/draft.json`, { body: { page: {} }, headers: { "if-match": ok.body.version } })).body.code, "bad-draft");
    // 改過之後檢查報告是舊的＝不能直接核可
    const ap = await s.call("POST", `/api/runs/${id}/approve`, { as: APPROVER, body: { fingerprint: ok.body.fingerprint } });
    assert.strictEqual(ap.status, 409); assert.strictEqual(ap.body.code, "gate-stale");
    const rn = await s.call("POST", `/api/runs/${id}/rename`, { body: { pageName: "法式餐廚週" } }); assert.strictEqual(rn.status, 200); assert.strictEqual((await s.call("GET", `/api/runs/${id}/draft.json`)).body.page.pageName, "法式餐廚週");
  } finally { await s.close(); }
});

test("檢查 → 核可 → 製作 → 下載；每一步的門都有守", async () => {
  const s = await boot();
  try {
    const id = await created(s);
    const fp = () => s.call("GET", `/api/runs/${id}`).then((r) => r.body.approval.fingerprint);
    assert.strictEqual((await s.call("POST", `/api/runs/${id}/export-aem`)).body.code, "not-approved", "沒核可不能製作");
    assert.strictEqual((await s.call("GET", `/api/runs/${id}/export.aem.html`)).body.code, "not-exported");
    const g = await s.call("POST", `/api/runs/${id}/gate`, { body: {} }); assert.strictEqual(g.status, 200);
    const pc = await s.call("POST", `/api/runs/${id}/product-check`); assert.strictEqual(pc.body.layer, "uther"); await s.jobs.wait(id);
    assert.strictEqual((await s.call("GET", `/api/runs/${id}/status`)).body.productCheck.stage, "done");
    // 業務不能核可
    assert.strictEqual((await s.call("POST", `/api/runs/${id}/approve`, { as: SALES, body: { fingerprint: await fp() } })).status, 403);
    let ap = await s.call("POST", `/api/runs/${id}/approve`, { as: APPROVER, body: { fingerprint: await fp() } });
    if (g.body.counts.FAIL > 0) { // 檢查有必修項目：要勾選知悉才收，並留印記
      assert.strictEqual(ap.body.code, "gate-fail"); assert.strictEqual(ap.body.failCount, g.body.counts.FAIL);
      ap = await s.call("POST", `/api/runs/${id}/approve`, { as: APPROVER, body: { fingerprint: await fp(), ackFail: true } });
      assert.strictEqual(ap.body.approvedWithFail, g.body.counts.FAIL);
    }
    assert.strictEqual(ap.status, 200, ap.text); assert.strictEqual(ap.body.approvedBy, APPROVER);
    assert.strictEqual((await s.call("GET", `/api/runs/${id}/draft.json`)).body.page.status, "待建置");
    assert.strictEqual((await s.store.approvalState(id)).approved, true, "核可鎖的是改完狀態欄之後的那一版");
    let goV; s.deps.hold.verify = new Promise((r) => (goV = r));
    const ex = await s.call("POST", `/api/runs/${id}/export-aem`);
    if (g.body.counts.FAIL > 0) { // 帶 FAIL 核可的活動：製作時全檢會擋——這是設計（先鎖版後修）
      goV(); await s.jobs.wait(id); const st = (await s.call("GET", `/api/runs/${id}/status`)).body.exportAem;
      assert.strictEqual(st.stage, "error"); assert.match(st.error, /合規檢查發現必修問題/); return;
    }
    assert.strictEqual(ex.status, 200, ex.text); assert.strictEqual((await s.call("POST", `/api/runs/${id}/export-aem`)).body.code, "busy");
    goV(); s.deps.hold.verify = null; await s.jobs.wait(id);
    const st = (await s.call("GET", `/api/runs/${id}/status`)).body.exportAem;
    assert.strictEqual(st.stage, "done", `${st.error}\n${await s.store.readLog(id)}`); assert.strictEqual(st.file, `activity-${id}.html`);
    assert.strictEqual(s.deps.verifyCalls.length, 1); assert.ok(s.deps.verifyCalls[0].fullHtml.length > s.deps.verifyCalls[0].slimHtml.length);
    const html = await s.call("GET", `/api/runs/${id}/export.aem.html`);
    assert.strictEqual(html.status, 200); assert.match(html.headers.get("content-disposition"), new RegExp(`activity-${id}\\.html`)); assert.ok(html.text.includes(String((await s.store.getDraft(id)).draft.products[0].gdid)));
    assert.deepStrictEqual(fs.readdirSync(path.join(s.dir, id, "export", "aem")).sort(), ["README.txt", `activity-${id}.html`, "aem-build-report.json", "aem-verify.json"], "交付資料夾＝一個 HTML＋三份報告，沒有對照檔");
    // 製作之後又改內容：核可失效、舊的網頁檔不給下載
    const d = await s.call("GET", `/api/runs/${id}/draft.json`); d.body.page.ctaText = "製作後又改";
    const put = await s.call("PUT", `/api/runs/${id}/draft.json`, { body: d.body, headers: { "x-draft-base": d.headers.get("x-draft-version") } });
    assert.strictEqual(put.body.approvalInvalidated, true);
    assert.strictEqual((await s.call("GET", `/api/runs/${id}/export.aem.html`)).body.code, "export-stale");
    assert.strictEqual((await s.call("POST", `/api/runs/${id}/export-aem`)).body.code, "not-approved");
  } finally { await s.close(); }
});

test("舊版：列得出來、還原得回去、還原後自動補跑快檢", async () => {
  const s = await boot();
  try {
    const id = await created(s);
    const d = await s.call("GET", `/api/runs/${id}/draft.json`); const before = d.body.page.ctaText; d.body.page.ctaText = "改壞了";
    await s.call("PUT", `/api/runs/${id}/draft.json`, { body: d.body, headers: { "x-draft-base": d.headers.get("x-draft-version") } });
    const vs = (await s.call("GET", `/api/runs/${id}/versions`)).body.versions; assert.ok(vs.length >= 1);
    const rb = await s.call("POST", `/api/runs/${id}/versions/${vs[0].versionId}/rollback`); assert.strictEqual(rb.status, 200, rb.text); assert.ok(["PASS", "FAIL"].includes(rb.body.gate));
    assert.strictEqual((await s.call("GET", `/api/runs/${id}/draft.json`)).body.page.ctaText, before);
    assert.strictEqual((await s.call("POST", `/api/runs/${id}/versions/999/rollback`)).status, 404);
  } finally { await s.close(); }
});

test("健康檢查兩組網址都通（票訂的 /status.html、/readiness 與 D12 的 /healthz、/readyz）", async () => {
  const s = await boot();
  try { for (const p of ["/status.html", "/healthz", "/readiness", "/readyz"]) { const r = await s.call("GET", p, { as: null }); assert.strictEqual(r.status, 200, p); assert.strictEqual(r.body.ok, true); } } finally { await s.close(); }
});

test("背景工作：同一檔同時只跑一件；跑完才收下一件；出錯不留鎖", async () => {
  const errs = []; const jobs = createJobs({ onError: (id, name, e) => errs.push(e.message) });
  let release; const gate = new Promise((r) => (release = r));
  assert.strictEqual(jobs.start("a", "create", () => gate), true); assert.strictEqual(jobs.start("a", "export", async () => {}), false); assert.strictEqual(jobs.busy("a"), "create");
  assert.strictEqual(jobs.start("b", "export", async () => { throw new Error("炸了"); }), true);
  await jobs.wait("b"); assert.deepStrictEqual(errs, ["炸了"]); assert.strictEqual(jobs.busy("b"), null);
  release(); await jobs.wait("a"); assert.strictEqual(jobs.busy("a"), null); assert.strictEqual(jobs.size(), 0);
});

/* ---------- 發布試作（ECSEARCH-39133 前半段）：製作完成後上傳到 S3 ---------- */
const { createS3Publisher, publisherFromEnv, HTML_CACHE_CONTROL } = require("../../cms/publisher");
const { createMemoryS3 } = require("../../core/store/memory_s3");
async function approvedRun(s) {
  const id = await created(s);
  await s.call("POST", `/api/runs/${id}/gate`, { body: {} });
  const fp = (await s.call("GET", `/api/runs/${id}`)).body.approval.fingerprint;
  const ap = await s.call("POST", `/api/runs/${id}/approve`, { as: APPROVER, body: { fingerprint: fp } }); assert.strictEqual(ap.status, 200, ap.text);
  return id;
}

test("發布：製作完成自動上傳到 pages/<活動編號>/index.html；狀態帶網址；重新製作覆蓋同一路徑並留舊版", async () => {
  const s3 = createMemoryS3();
  const s = await boot({ publisher: createS3Publisher({ client: s3, bucket: "cs-pages", baseUrl: "http://localhost:9000/cs-pages/", clock }) });
  try {
    const id = await approvedRun(s);
    await s.call("POST", `/api/runs/${id}/export-aem`); await s.jobs.wait(id);
    const ex = (await s.call("GET", `/api/runs/${id}/status`)).body.exportAem;
    assert.strictEqual(ex.stage, "done", ex.error); assert.strictEqual(ex.publishError, null);
    assert.deepStrictEqual({ url: ex.published.url, bucket: ex.published.bucket, key: ex.published.key }, { url: `http://localhost:9000/cs-pages/pages/${id}/index.html`, bucket: "cs-pages", key: `pages/${id}/index.html` });
    const put = s3.calls.filter((c) => c.op === "put"); assert.strictEqual(put.length, 1);
    assert.deepStrictEqual({ Key: put[0].Key, ContentType: put[0].ContentType, CacheControl: put[0].CacheControl }, { Key: `pages/${id}/index.html`, ContentType: "text/html; charset=utf-8", CacheControl: HTML_CACHE_CONTROL });
    const stored = (await s3.getObject({ Key: `pages/${id}/index.html` })).Body;
    assert.strictEqual(stored, (await s.call("GET", `/api/runs/${id}/export.aem.html`)).text, "上傳的就是下載拿到的那一份");
    assert.match(await s.store.readLog(id), new RegExp(`已發布：cs-pages/pages/${id}/index\\.html → http://localhost:9000/`));
    // 再製作一次：同一個路徑、S3 留兩版；製作途中的狀態不帶上一輪的結果
    let goV; s.deps.hold.verify = new Promise((r) => (goV = r));
    await s.call("POST", `/api/runs/${id}/export-aem`);
    for (let i = 0; i < 2000 && (await s.store.readMeta(id)).exportAem.stage !== "verify"; i++) await new Promise((r) => setTimeout(r, 10)); // 等它走到顯示檢查那一關（最多 20 秒）
    const mid = (await s.call("GET", `/api/runs/${id}/status`)).body.exportAem;
    assert.deepStrictEqual({ stage: mid.stage, file: mid.file, finishedAt: mid.finishedAt, published: mid.published }, { stage: "verify", file: null, finishedAt: null, published: null });
    goV(); s.deps.hold.verify = null; await s.jobs.wait(id);
    assert.strictEqual(s3.objects.get(`pages/${id}/index.html`).length, 2);
  } finally { await s.close(); }
});

test("發布失敗不算製作失敗：檔案照樣做好可下載，狀態記下 publishError；沒設 publisher＝不發布", async () => {
  const s = await boot({ publisher: { publish: async () => { throw new Error("AccessDenied"); } } });
  try {
    const id = await approvedRun(s);
    await s.call("POST", `/api/runs/${id}/export-aem`); await s.jobs.wait(id);
    const ex = (await s.call("GET", `/api/runs/${id}/status`)).body.exportAem;
    assert.strictEqual(ex.stage, "done"); assert.strictEqual(ex.published, null); assert.match(ex.publishError, /做好了，但發布沒有成功/);
    assert.ok(!ex.publishError.includes("AccessDenied"), "技術細節只進 log"); assert.match(await s.store.readLog(id), /發布失敗：AccessDenied/);
    assert.strictEqual((await s.call("GET", `/api/runs/${id}/export.aem.html`)).status, 200);
  } finally { await s.close(); }
  assert.strictEqual(publisherFromEnv({}), null);
  assert.throws(() => publisherFromEnv({ CS_PUBLISH: "ftp" }), /只能是 s3/); assert.throws(() => publisherFromEnv({ CS_PUBLISH: "s3" }), /CS_PUBLISH_BUCKET/);
  const p = createS3Publisher({ client: createMemoryS3(), bucket: "b", prefix: "/pages/" });
  assert.strictEqual(p.keyOf("abc"), "pages/abc/index.html"); assert.strictEqual(p.urlOf("abc"), null); assert.throws(() => p.keyOf("../x"), /活動編號格式不對/);
});

/* ---------- 商品頁層（P40）：核可前與製作時逐件開商品頁；劃線價靠「套用商品頁現價」補進草稿 ---------- */
test("商品頁層：第一次檢查每件都缺劃線價＝要處理；套用後草稿有劃線價、核可失效要重來；之後製作用商品頁層把關", async () => {
  // 假的商品頁：實付價同 uther，另外有劃線價（＝實付價＋100）；第一件商品頁上已經降價 5 元
  let first = null;
  const productLiveness = async ({ gdid }) => { const p = GOLD.products.find((x) => String(x.gdid) === String(gdid)); if (!p) return { status: "offline", prod: null, evidence: {} }; if (first == null) first = String(gdid);
    return { status: "online", prod: { price: p.price, listPrice: p.price + 100 }, evidence: { fetchUrl: p.url } }; };
  const s = await boot({ productLiveness, gdidOf: null, mapPool: null });
  try {
    const id = await created(s);
    const before = (await s.call("GET", `/api/runs/${id}/draft.json`)).body;
    assert.ok(before.products.every((p) => p.marketPrice == null || p.marketPrice > p.price), "uther 建立的草稿：沒有活動價的商品不帶劃線價");
    const noList = before.products.filter((p) => p.marketPrice !== p.price + 100).length; assert.ok(noList > 0);
    // 商品頁層檢查＝背景工作
    const st = await s.call("POST", `/api/runs/${id}/product-check`); assert.strictEqual(st.body.layer, "page"); await s.jobs.wait(id);
    const pc = (await s.call("GET", `/api/runs/${id}/product_check.json`)).body; assert.strictEqual(pc.layer, "page");
    assert.strictEqual(pc.results.filter((r) => r.marketDrift).length, noList, "劃線價跟商品頁不同的每一件都標出來");
    assert.strictEqual((await s.call("GET", `/api/runs/${id}/status`)).body.productCheck.blocking, noList);
    // 套用：劃線價進草稿與快照
    const ap = await s.call("POST", `/api/runs/${id}/apply-live-price-all`); assert.strictEqual(ap.status, 200, ap.text); assert.strictEqual(ap.body.count, noList);
    const after = (await s.call("GET", `/api/runs/${id}/draft.json`)).body;
    assert.ok(after.products.every((p) => p.marketPrice === p.price + 100), "每件都有商品頁的劃線價");
    const snap = (await s.call("GET", `/api/runs/${id}/snapshot.json`)).body; const sp = snap.products.find((x) => String(x.gdid) === String(after.products[0].gdid)); assert.strictEqual(sp.marketPrice, after.products[0].price + 100);
    assert.strictEqual((await s.call("GET", `/api/runs/${id}/product_check.json`)).body.results.filter((r) => r.drift).length, 0, "報告同步：套完不再標要處理");
    assert.strictEqual((await s.call("POST", `/api/runs/${id}/apply-live-price-all`)).body.count, 0, "再按一次沒有東西要套");
    assert.match(await s.store.readLog(id), /價格改用商品頁現價：gdid \d+ .*原價 \d+/);
    // 核可 → 製作：製作時的商品狀態關走商品頁層，這次全過
    const fp = (await s.call("GET", `/api/runs/${id}`)).body.approval.fingerprint;
    const ok = await s.call("POST", `/api/runs/${id}/approve`, { as: APPROVER, body: { fingerprint: fp } }); assert.strictEqual(ok.status, 200, ok.text);
    await s.call("POST", `/api/runs/${id}/export-aem`); await s.jobs.wait(id);
    const ex = (await s.call("GET", `/api/runs/${id}/status`)).body; assert.strictEqual(ex.exportAem.stage, "done", ex.exportAem.error); assert.strictEqual(ex.productCheck.layer, "page");
  } finally { await s.close(); }
});

test("商品頁層：沒套用劃線價就核可並製作＝製作被商品狀態關擋下；草稿改過之後拿舊報告來套用＝擋", async () => {
  const productLiveness = async ({ gdid }) => { const p = GOLD.products.find((x) => String(x.gdid) === String(gdid)); return { status: "online", prod: { price: p.price, listPrice: p.price + 100 }, evidence: {} }; };
  const s = await boot({ productLiveness });
  try {
    const id = await approvedRun(s);
    await s.call("POST", `/api/runs/${id}/export-aem`); await s.jobs.wait(id);
    const ex = (await s.call("GET", `/api/runs/${id}/status`)).body.exportAem; assert.strictEqual(ex.stage, "error"); assert.match(ex.error, /商品狀態檢查未過/);
    const d = await s.call("GET", `/api/runs/${id}/draft.json`); d.body.page.ctaText = "檢查後又改";
    await s.call("PUT", `/api/runs/${id}/draft.json`, { body: d.body, headers: { "x-draft-base": d.headers.get("x-draft-version") } });
    const ap = await s.call("POST", `/api/runs/${id}/apply-live-price-all`); assert.strictEqual(ap.status, 409); assert.strictEqual(ap.body.code, "check-stale");
    // 指定只查 uther 也可以（快）
    const u = await s.call("POST", `/api/runs/${id}/product-check`, { body: { layer: "uther" } }); assert.strictEqual(u.body.layer, "uther"); await s.jobs.wait(id);
    assert.strictEqual((await s.call("GET", `/api/runs/${id}/product_check.json`)).body.layer, "uther");
  } finally { await s.close(); }
});

/* ---------- D14 第一段：舊畫面接上來 ---------- */
test("舊畫面的握手與形狀：版本、能力表、狀態帶 logTail、列表欄位、沒搬的路由回 501 並被記下來", async () => {
  const s = await boot();
  try {
    const v = (await s.call("GET", "/api/version")).body;
    assert.strictEqual(v.mode, "cms"); assert.strictEqual(v.caps, null, "能力表 null＝第一版範圍外的入口全藏"); assert.strictEqual(v.staleServer, false); assert.strictEqual(v.user.email, SALES);
    // 規則表：畫面的編修欄靠它算字寬（少了它整個編修欄畫不出來——2026-11-23 實測）
    const rules = (await s.call("GET", "/api/rules.json")).body; assert.ok(rules.charLimits && rules.charLimits.widthModel && rules.charLimits.mobile, "規則表要有 charLimits.widthModel");
    assert.strictEqual((await s.call("GET", "/api/layout-thumbs/no-such.png")).status, 404, "缺縮圖＝404（畫面放佔位圖），不是 501");
    // 建立前的網址檢查：問 uther 拿得到幾件（卡帶：店家 sub=1035）
    const sc = (await s.call("POST", "/api/source-check", { body: { url: URL1035 } })).body; assert.strictEqual(sc.ok, true, JSON.stringify(sc)); assert.ok(sc.hits >= 27); assert.strictEqual(sc.promotions, 0); assert.match(sc.verdict, /^這個網址可以用（店家/);
    assert.strictEqual((await s.call("POST", "/api/source-check", { body: { url: "https://example.com" } })).body.ok, false);
    assert.strictEqual((await s.call("GET", "/api/flow-guide")).body.ok, true); assert.deepStrictEqual((await s.call("GET", "/api/briefs")).body, []); assert.deepStrictEqual((await s.call("GET", "/api/runs-deleted")).body, []);
    // 建立表單的三支：版式選單、配版面預告、配色預告
    const cat = (await s.call("GET", "/api/layout-catalog")); assert.strictEqual(cat.status, 200); assert.ok(cat.body && typeof cat.body === "object");
    const sg = (await s.call("GET", "/api/layout-suggest?scenario=" + encodeURIComponent("同品類-新品/熱銷曝光") + "&theme=" + encodeURIComponent("神作就是神作！"))).body; assert.strictEqual(sg.ok, true, JSON.stringify(sg)); assert.match(sg.layout, /^layout-\d{3}$/); assert.ok(sg.name && sg.reasonDisplay);
    const th = (await s.call("GET", "/api/theme-suggest?theme=" + encodeURIComponent("中秋烤肉"))).body; assert.strictEqual(th.ok, true); assert.ok(th.hue && th.hueLabel);
    const id = await created(s);
    const st = (await s.call("GET", `/api/runs/${id}/status`)).body; assert.match(st.logTail, /發佈前檢查（快檢/); assert.ok(st.input && st.createdAt, "狀態帶整份狀態檔");
    const row = (await s.call("GET", "/api/runs")).body[0];
    for (const k of ["id", "stage", "engineUsed", "input", "pageName", "hasDraft", "hasGate", "error", "approvedAt", "gate", "themeHue", "createdAt", "draftSavedAt", "prodcheck", "exportAem"]) assert.ok(k in row, `列表缺欄位 ${k}`);
    assert.strictEqual(row.prodcheck.total, row.prodcheck.total); assert.ok(row.gate && typeof row.gate.pass === "boolean");
    for (const [m, p] of [["POST", `/api/runs/${id}/explore-fix`], ["GET", "/api/google/config"], ["POST", `/api/runs/${id}/explore-fix`]]) { const r = await s.call(m, p, { body: m === "POST" ? {} : undefined }); assert.strictEqual(r.status, 501); assert.strictEqual(r.body.code, "not-migrated"); }
    assert.deepStrictEqual((await s.call("GET", "/api/_missing")).body.missing, [{ route: "POST /runs/:id/explore-fix", hits: 2 }, { route: "GET /google/config", hits: 1 }]);
  } finally { await s.close(); }
});

test("舊畫面的存檔方式：不帶 Content-Type、版本用數字；存完拿到新數字接著存；舊數字＝409 並附最新草稿", async () => {
  const s = await boot();
  try {
    const id = await created(s);
    const raw = (p, o) => fetch(`http://127.0.0.1:${s.port}${p}`, { ...o, headers: { "x-dev-user": SALES, ...(o.headers || {}) } });
    const g = await raw(`/api/runs/${id}/draft.json`, {}); const base0 = g.headers.get("x-draft-mtime"); assert.match(base0, /^\d+$/); assert.ok(Number.isSafeInteger(Number(base0)) && Number(base0) > 0);
    const d = await g.json(); d.page.ctaText = "舊畫面第一次存";
    const p1 = await (await raw(`/api/runs/${id}/draft.json`, { method: "PUT", headers: { "x-draft-base": base0 }, body: JSON.stringify(d) })).json(); // 沒有 Content-Type
    assert.strictEqual(p1.ok, true, JSON.stringify(p1)); assert.match(p1.backup, /^draft\.v\d+\.json$/); assert.ok(p1.savedAt && p1.baseMs && String(p1.baseMs) !== base0);
    d.page.ctaText = "接著再存";
    const p2 = await (await raw(`/api/runs/${id}/draft.json`, { method: "PUT", headers: { "x-draft-base": String(p1.baseMs) }, body: JSON.stringify(d) })).json(); assert.strictEqual(p2.ok, true, JSON.stringify(p2));
    const p3 = await raw(`/api/runs/${id}/draft.json`, { method: "PUT", headers: { "x-draft-base": base0 }, body: JSON.stringify(d) }); const j3 = await p3.json();
    assert.strictEqual(p3.status, 409); assert.strictEqual(j3.code, "stale-draft"); assert.strictEqual(j3.draft.page.ctaText, "接著再存"); assert.strictEqual(j3.sysDraftWriteAt, p2.baseMs);
    const p4 = await (await raw(`/api/runs/${id}/draft.json`, { method: "PUT", headers: { "x-draft-base": "0" }, body: JSON.stringify(d) })).json(); assert.strictEqual(p4.code, "missing-base");
    // 舊畫面的檢查與舊版清單
    const gt = await (await raw(`/api/runs/${id}/gate?full=1`, { method: "POST" })).json(); assert.strictEqual(gt.mode, "全檢"); assert.ok(gt.report && gt.report.findings); assert.strictEqual(gt.exit, gt.report.counts.FAIL ? 1 : 0);
    const vs = await (await raw(`/api/runs/${id}/versions`, {})).json(); assert.match(vs.versions[0].file, /^draft\.v\d+\.json$/);
    const rb = await (await raw(`/api/runs/${id}/versions/${vs.versions[vs.versions.length - 1].file}/rollback`, { method: "POST" })).json(); assert.strictEqual(rb.ok, true, JSON.stringify(rb)); assert.ok(rb.draft && rb.baseMs);
  } finally { await s.close(); }
});

/* ---------- D14 第二段：編修頁的進階操作 ---------- */
test("本期活動：三種來源各有幾個可選；換來源整批重組；組不出三則＝409 並建議別的來源", async () => {
  const s = await boot();
  try {
    const id = await created(s);
    const o0 = (await s.call("GET", `/api/runs/${id}/promo-options`)).body;
    assert.strictEqual(o0.layers["product-fallback"].count, 0, "機械派生的詞（店名）對不到商品名＝沒得選");
    // 主題詞組改成對得到商品名的詞 → 可選的就出現（兩張卡吃同一份詞組）
    assert.strictEqual((await s.call("PUT", `/api/runs/${id}/feedback-patch`, { body: { keywords: ["統一"] } })).status, 200);
    const o = (await s.call("GET", `/api/runs/${id}/promo-options`)).body;
    assert.deepStrictEqual(Object.keys(o.layers).sort(), ["brand-recommend", "product-fallback", "promo-activity"]); assert.ok(typeof o.layers["product-fallback"].count === "number");
    const d0 = await s.call("GET", `/api/runs/${id}/draft.json`);
    const pick = Object.entries(o.layers).find(([, v]) => v.count >= 3);
    assert.ok(pick, "夾具至少有一種來源湊得出三則");
    const r = await s.call("POST", `/api/runs/${id}/promo-recompose`, { body: { mode: pick[0] } });
    assert.strictEqual(r.status, 200, r.text); assert.ok(r.body.entries >= 3); assert.strictEqual(r.body.draft.page.promoSourceMode, pick[0]); assert.ok(r.body.baseMs && r.body.fingerprint, "回新的版本代號");
    assert.notStrictEqual(String(r.body.baseMs), d0.headers.get("x-draft-mtime"));
    // 畫面拿新代號接著存＝收
    r.body.draft.page.ctaText = "重組後接著改";
    assert.strictEqual((await s.call("PUT", `/api/runs/${id}/draft.json`, { body: r.body.draft, headers: { "x-draft-base": String(r.body.baseMs) } })).body.ok, true);
    const thin = Object.entries(o.layers).find(([, v]) => v.count < 3);
    if (thin) { const bad = await s.call("POST", `/api/runs/${id}/promo-recompose`, { body: { mode: thin[0] } }); assert.strictEqual(bad.status, 409); assert.match(bad.body.error, /至少要 3 則版型才能成立/); }
    assert.strictEqual((await s.call("POST", `/api/runs/${id}/promo-recompose`, { body: { mode: "亂填" } })).status, 400);
  } finally { await s.close(); }
});

test("主題詞組：讀得到建立時算的；人工改了之後檢查用新的；不能清空", async () => {
  const s = await boot();
  try {
    const id = await created(s, { url: URL1035, theme: "韓國零食" });
    const g = (await s.call("GET", `/api/runs/${id}/feedback-patch`)).body; assert.ok(g.themeFitRule && g.themeFitRule.keywords.includes("韓國零食"));
    assert.strictEqual((await s.call("PUT", `/api/runs/${id}/feedback-patch`, { body: { keywords: [] } })).status, 400);
    const p = await s.call("PUT", `/api/runs/${id}/feedback-patch`, { body: { keywords: ["點心麵", " 辣 "] } }); assert.deepStrictEqual(p.body.themeFitRule.keywords, ["點心麵", "辣"]); assert.strictEqual(p.body.themeFitRule.threshold, 0.3);
    assert.match(await s.store.readLog(id), /CP-14 主題詞組人工編修（sales@dev\.local）：點心麵、辣/);
  } finally { await s.close(); }
});

test("換品：貼網址讀商品 → 登記進來源快照；單件套用商品頁現價；樓層上移下移", async () => {
  const fetched = { gdid: "99000001", name: "測試換進來的商品", price: 888, marketPrice: 999, url: "https://tw.buy.yahoo.com/gdsale/gdsale.asp?gdid=99000001", imgs: ["https://img.yec.tw/x/a.jpg", "https://img.yec.tw/x/b.jpg"] };
  const productLiveness = async ({ gdid }) => { const p = GOLD.products.find((x) => String(x.gdid) === String(gdid)); return { status: "online", prod: { price: p.price, listPrice: p.price + 100 }, evidence: {} }; };
  const s = await boot({ productLiveness, productFetch: async (b) => (/99000001/.test(String(b.url)) ? { code: 200, product: fetched } : { code: 400, error: "這不是商品頁的網址" }) });
  try {
    const id = await created(s);
    assert.strictEqual((await s.call("POST", "/api/product-fetch", { body: { url: "https://example.com" } })).status, 400);
    const pf = await s.call("POST", "/api/product-fetch", { body: { url: fetched.url } }); assert.strictEqual(pf.body.gdid, "99000001");
    const r3 = await s.call("POST", `/api/runs/${id}/r3-add`, { body: { product: pf.body } }); assert.deepStrictEqual({ ok: r3.body.ok, mode: r3.body.mode }, { ok: true, mode: "add" });
    assert.ok((await s.call("GET", `/api/runs/${id}/snapshot.json`)).body.products.some((p) => String(p.gdid) === "99000001"), "換進來的商品進了來源快照");
    assert.strictEqual((await s.call("POST", `/api/runs/${id}/r3-add`, { body: { product: pf.body } })).body.already, true);
    assert.strictEqual((await s.call("POST", `/api/runs/${id}/r3-add`, { body: { product: { gdid: "1" } } })).status, 400);
    // 單件套用
    await s.call("POST", `/api/runs/${id}/product-check`); await s.jobs.wait(id);
    const d = (await s.call("GET", `/api/runs/${id}/draft.json`)).body; const g0 = String(d.products.find((p) => p.marketPrice == null).gdid);
    const a1 = await s.call("POST", `/api/runs/${id}/apply-live-price`, { body: { gdid: g0 } }); assert.strictEqual(a1.status, 200, a1.text); assert.ok(a1.body.marketPrice > a1.body.price && a1.body.baseMs);
    assert.strictEqual(a1.body.draft.products.find((p) => String(p.gdid) === g0).marketPrice, a1.body.marketPrice);
    assert.strictEqual((await s.call("POST", `/api/runs/${id}/apply-live-price`, { body: { gdid: "00000" } })).body.code, "no-live-price");
    // 樓層上移下移（頁面組成）
    const before = a1.body.draft.page.floors.map((f) => f.title);
    const mv = await s.call("POST", `/api/runs/${id}/content-modules`, { body: { kind: "floor", action: "move", index: 0, dir: "down" } });
    assert.strictEqual(mv.status, 200, mv.text); assert.strictEqual(mv.body.changed, true);
    assert.deepStrictEqual(mv.body.draft.page.floors.map((f) => f.title), [before[1], before[0], ...before.slice(2)]); assert.ok(mv.body.baseMs && mv.body.backup);
    assert.strictEqual((await s.call("POST", `/api/runs/${id}/content-modules`, { body: { kind: "不存在", action: "move" } })).status, 400);
    assert.deepStrictEqual((await s.call("GET", "/api/_missing")).body.missing, [], "這一輪操作沒有打到還沒搬的路由");
  } finally { await s.close(); }
});


test("主視覺組合面板：換版式存得進去、回新版本代號；主題色把關兩支都回得出來；提案包與自己上傳背景第一版不收", async () => {
  const s = await boot();
  try {
    const id = await created(s);
    const d0 = (await s.call("GET", `/api/runs/${id}/draft.json`)).body;
    const cat = (await s.call("GET", "/api/layout-catalog")).body; const other = cat.cards.map((l) => l.id).find((x) => x && x !== d0.page.kvVariant);
    assert.ok(other, "版式目錄裡要有別款可換");
    const r = await s.call("POST", `/api/runs/${id}/hero-combo`, { body: { kvVariant: other } });
    assert.strictEqual(r.status, 200, r.text); assert.strictEqual(r.body.changed, true); assert.strictEqual(r.body.draft.page.kvVariant, other); assert.ok(r.body.baseMs && r.body.fingerprint && r.body.backup);
    assert.strictEqual((await s.call("GET", `/api/runs/${id}/draft.json`)).body.page.kvVariant, other);
    assert.strictEqual((await s.call("POST", `/api/runs/${id}/hero-combo`, { body: { kvVariant: other } })).body.changed, false);
    assert.strictEqual((await s.call("POST", `/api/runs/${id}/hero-combo`, { body: { kvVariant: "沒有這款" } })).status, 400);
    assert.strictEqual((await s.call("POST", `/api/runs/${id}/hero-combo`, { body: { pack: "x" } })).status, 501);
    assert.strictEqual((await s.call("POST", `/api/runs/${id}/hero-combo`, { body: { heroBgOwn: { files: {} } } })).status, 501);
    const tc = await s.call("GET", `/api/runs/${id}/theme-check`); assert.strictEqual(tc.status, 200); assert.strictEqual(typeof tc.body.ok, "boolean");
    assert.strictEqual((await s.call("GET", "/api/theme-check?seed=zzz")).body.format, false);
    assert.strictEqual(typeof (await s.call("GET", "/api/theme-check?seed=%231d5f8a")).body.ok, "boolean");
    assert.deepStrictEqual((await s.call("GET", "/api/_missing")).body.missing, []);
  } finally { await s.close(); }
});
