"use strict";
/**
 * 建立期價格對真・伺服器層（丙-甲；2026-09-27 使用者裁）。沿 server_brief_flow.test.js：起編修模式子行程（runs／briefs 落暫存夾＝不碰真資料），
 * 用「照策略檔重做」把 finishDraftAfterCurate 那段跑起來（建立要抓來源頁＝觸網；重做沿既有 snapshot＝離線可跑，收尾同一支）。
 * 兩個測試樁（都不觸網）：
 *   CAMPAIGN_PRICE_TRUTH=report:<檔>  拿檔內 results 當商品頁實抓結果 → 驗「有變價＝快照與草稿同批改、gate CP-02 0、wb.log 逐件＋總結、meta.priceTruth」
 *   CAMPAIGN_PRICE_TRUTH=offline-stub  當作全部連不上 → 驗「一件都不改、出聲、不擋建立（stage ready）」
 * 真連網的那一段（productCheck 逐品實抓）有自己的既有測試與真人走查；本檔守的是接線與邊界。
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

const PIPE = path.resolve(__dirname, "..", "..");
const SEED = "2026-10-27-wb-085823"; // D4：夾具改為 repo 內的真活動（test/fixtures/runs）
const BRIEF = "built-in/05-時事主題-情境選品.md";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, ms, what) { const t0 = Date.now(); let last = null; while (Date.now() - t0 < ms) { try { const v = await fn(); if (v) return v; } catch (e) { last = e; } await sleep(400); } throw new Error(`等不到 ${what}${last ? "：" + last.message : ""}`); }

async function withServer(priceTruthEnv, body) {
  const runs = fs.mkdtempSync(path.join(os.tmpdir(), "wb-pt-runs-")); const briefs = fs.mkdtempSync(path.join(os.tmpdir(), "wb-pt-briefs-"));
  fs.cpSync(path.join(PIPE, "test", "fixtures", "runs", SEED), path.join(runs, SEED), { recursive: true });
  /* 種子是活的真實 run，它的 wb.log 會被日常使用一直往後接——把別人的舊紀錄留在考卷上，
     斷言「這一輪有沒有寫某句話」就會被歷史汙染（2026-10-10 病例：使用者當天早上在 CMS 實測建置，
     寫進 48 筆「價格改用商品頁現價」，直接讓 offline 樁紅燈、pre-commit 全擋）。
     清空複本的紀錄＝這一輪寫什麼就驗什麼；要驗的行為一條都沒放過。 */
  fs.writeFileSync(path.join(runs, SEED, "wb.log"), "");
  for (const f of fs.readdirSync(path.join(runs, SEED))) if (/^draft\.v\d+\.json$/.test(f)) fs.rmSync(path.join(runs, SEED, f)); // 種子是活的真實 run，備份不帶進來
  fs.cpSync(path.join(PIPE, "briefs", "built-in"), path.join(briefs, "built-in"), { recursive: true });
  { const mp = path.join(runs, SEED, "wb_meta.json"); const m = JSON.parse(fs.readFileSync(mp, "utf8")); m.approvedAt = "2026-09-15T00:00:00.000Z"; fs.writeFileSync(mp, JSON.stringify(m, null, 1)); } // 先蓋個核可章＝驗「重做端點先讓它失效、價格對真在其後」
  const PORT = 19900 + Math.floor(Math.random() * 90);
  const BASE = `http://127.0.0.1:${PORT}`;
  const env = { ...process.env, CAMPAIGN_MODE: "editor", CAMPAIGN_RUNS_DIR: runs, CAMPAIGN_BRIEFS_DIR: briefs, CAMPAIGN_CAPS: "ai:0,publish:0,vendorSheet:0", CAMPAIGN_PRICE_TRUTH: priceTruthEnv(runs) }; delete env.WB_PASS;
  /* 種子是活的真實 run：快照裡本來就有幾行「套用新價」稽核（負責人 09-21 在 CMS 按過一鍵套用）——斷言一律比「多了幾行」，不比絕對值 */
  const auditBefore = JSON.parse(fs.readFileSync(path.join(runs, SEED, "snapshot.json"), "utf8")).warnings.filter((w) => /^套用新價：gdid/.test(w)).length;
  let out = "";
  const child = spawn(process.execPath, [path.join(PIPE, "workbench", "server.js"), String(PORT)], { env, stdio: ["ignore", "pipe", "pipe"] });
  child.stdout.on("data", (d) => { out += d; }); child.stderr.on("data", (d) => { out += d; });
  try {
    await waitFor(async () => (await fetch(`${BASE}/ping`)).status === 204, 60000, "/ping");
    const r = await fetch(`${BASE}/api/runs/${SEED}/redo-draft`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ briefFile: BRIEF }) });
    assert.strictEqual(r.status, 200, await r.text());
    const meta = await waitFor(() => { const m = JSON.parse(fs.readFileSync(path.join(runs, SEED, "wb_meta.json"), "utf8")); return m.stage === "ready" || m.stage === "error" ? m : null; }, 120000, "重做跑完");
    const read = (f) => JSON.parse(fs.readFileSync(path.join(runs, SEED, f), "utf8"));
    await body({ runs, meta, read, log: fs.readFileSync(path.join(runs, SEED, "wb.log"), "utf8"), serverOut: () => out, auditBefore });
  } finally { try { child.kill("SIGTERM"); } catch (e) { /* 已結束 */ } }
}

test("report 樁：有變價＝快照與草稿同批改用商品頁現價、gate CP-02 0、wb.log 逐件＋總結、meta.priceTruth 記帳、stage ready", async () => {
  await withServer((runs) => {
    /* 樁報告：來源紀錄裡每一件都「商品頁便宜 7 元、原價＝原本的價」——重做挑到哪幾件都套得到 */
    const snap = JSON.parse(fs.readFileSync(path.join(runs, SEED, "snapshot.json"), "utf8"));
    const results = snap.products.filter((p) => typeof p.price === "number").map((p) => ({ gdid: String(p.gdid), status: "online", draftPrice: p.price, livePrice: p.price - 7, liveMarketPrice: p.price, marketDrift: true, drift: true, snapPrice: p.price, snapDrift: true }));
    const f = path.join(runs, "stub-report.json"); fs.writeFileSync(f, JSON.stringify({ checkedAt: "2026-09-27T00:00:00.000Z", results }));
    return "report:" + f;
  }, async ({ meta, read, log, auditBefore }) => {
    assert.strictEqual(meta.stage, "ready", `重做失敗：${meta.error}\n${log.slice(-800)}`);
    const d = read("draft.json"), s = read("snapshot.json");
    const bySnap = new Map(s.products.map((p) => [String(p.gdid), p]));
    const inDraft = new Set(d.products.map((p) => String(p.gdid)));
    assert.ok(d.products.length > 10, "重做有商品");
    for (const p of d.products) {
      const sp = bySnap.get(String(p.gdid)); assert.ok(sp, `草稿商品 ${p.gdid} 要在來源紀錄`);
      assert.strictEqual(p.price, sp.price, `草稿現價＝快照現價（gdid ${p.gdid}）`);
      assert.strictEqual(p.marketPrice ?? null, sp.marketPrice ?? null, `草稿原價＝快照原價（gdid ${p.gdid}）`);
      assert.strictEqual(sp.marketPrice, sp.price + 7, "快照已改用商品頁現價（便宜 7 元、原價＝舊價）");
    }
    const outside = s.products.filter((p) => !inDraft.has(String(p.gdid)) && typeof p.price === "number");
    assert.ok(outside.length > 0, "前置確認：來源紀錄裡確實有草稿沒用到的商品（樁報告多給了它們的列）");
    assert.ok(outside.every((p) => p.marketPrice !== p.price + 7), "不在草稿上的池商品沒被動到（報告多給的列不動池）");
    assert.match(log, /件不在草稿上、沒動（報告多給的列）/);
    assert.strictEqual(meta.priceTruth.stage, "done"); assert.strictEqual(meta.priceTruth.applied, d.products.length, "每一件都套到"); assert.strictEqual(meta.priceTruth.offline, false); assert.match(meta.priceTruth.mode, /^report:/, "記帳要寫是哪一種來源（真連網＝live）");
    assert.match(log, /對商品頁價格中：\d+ 件、約 \d+ 秒/, "開跑出聲（進度）");
    assert.match(log, new RegExp(`建立期價格對真：${d.products.length} 件改用商品頁現價，來源紀錄與草稿已同步`), "總結一行");
    assert.ok((log.match(/價格改用商品頁現價：gdid \d+ \$\d+→\$\d+、原價 \d+/g) || []).length === d.products.length, "每一件改價各一行 wb.log");
    assert.strictEqual(s.warnings.filter((w) => /^套用新價：gdid/.test(w)).length - auditBefore, d.products.length, "快照稽核行（patchSnapshotPrice）每件多一行");
    const g = read("gate_report.json");
    assert.deepStrictEqual(g.findings.filter((f) => f.level === "FAIL" && f.code === "CP-02" && /現價|原價/.test(f.msg)), [], "重做完成當下 gate 現價／原價零 FAIL");
    const logIdx = log.indexOf("建立期價格對真"), gateIdx = log.lastIndexOf("gate exit");
    assert.ok(logIdx > 0 && logIdx < gateIdx, "價格對真排在 gate 之前");
    assert.strictEqual(meta.approvedAt, null, "重做＝核可已失效（端點先跑 invalidateApproval）");
  });
});

test("offline 樁：全部連不上＝一件都不改、出聲、不擋建立（stage ready）、meta.priceTruth.offline", async () => {
  await withServer(() => "offline-stub", async ({ meta, read, log, auditBefore }) => {
    assert.strictEqual(meta.stage, "ready", `離線不得擋建立：${meta.error}\n${log.slice(-600)}`);
    const d = read("draft.json"), s = read("snapshot.json");
    const bySnap = new Map(s.products.map((p) => [String(p.gdid), p]));
    for (const p of d.products) assert.strictEqual(p.price, bySnap.get(String(p.gdid)).price, "價格照快照、一件沒動");
    assert.strictEqual(s.warnings.filter((w) => /^套用新價：gdid/.test(w)).length, auditBefore, "沒有多出任何改價稽核行");
    assert.match(log, new RegExp(`⚠ 建立期價格對真：${d.products.length} 件都沒能連上商品頁，價格沒動。發佈前檢查會再驗`));
    assert.doesNotMatch(log, /價格改用商品頁現價/);
    assert.strictEqual(meta.priceTruth.stage, "done"); assert.strictEqual(meta.priceTruth.offline, true); assert.strictEqual(meta.priceTruth.applied, 0); assert.strictEqual(meta.priceTruth.unverified, d.products.length);
    assert.match(log, /照策略檔重做完成/);
  });
});
