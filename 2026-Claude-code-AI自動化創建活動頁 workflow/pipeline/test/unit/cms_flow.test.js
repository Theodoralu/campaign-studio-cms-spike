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
  return { store, jobs, deps, call, dir, close: () => new Promise((r) => srv.close(r)) };
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
    assert.strictEqual(meta.input.ownerEmail, SALES); assert.strictEqual(meta.engineUsed, "rules"); assert.strictEqual(meta.input.engine, "rules");
    const d = await s.call("GET", `/api/runs/${id}/draft.json`);
    assert.ok(d.headers.get("x-draft-version")); assert.match(d.headers.get("x-draft-fingerprint"), /^fp_/);
    assert.ok(d.body.products.length >= 20); assert.strictEqual(d.body.page.kvVariant, r.body.kvVariant); assert.strictEqual(d.body.page.theme.customColor, "#1D5F8A");
    const snap = (await s.call("GET", `/api/runs/${id}/snapshot.json`)).body; assert.strictEqual(snap.products.length, GOLD.products.length); assert.match(snap.products[0].source, /^uther:/);
    assert.strictEqual((await s.call("GET", `/api/runs/${id}/product_check.json`)).body.layer, "uther");
    const g = (await s.call("GET", `/api/runs/${id}/gate_report.json`)).body; assert.ok(g.result && g.counts);
    assert.strictEqual((await s.call("GET", "/api/runs")).body.runs[0].id, id);
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
    const pc = await s.call("POST", `/api/runs/${id}/product-check`); assert.strictEqual(pc.body.layer, "uther");
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
