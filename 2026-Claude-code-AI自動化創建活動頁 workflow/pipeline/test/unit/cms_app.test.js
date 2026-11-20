"use strict";
/**
 * D12：CMS 伺服器——登入、審核者權限、健康檢查。計畫的完成條件：登入後看到列表；非審核者按核可收到 403。
 * 伺服器開在隨機埠，用真的 HTTP 請求打（不連外）。資料＝本機資料夾後端＋黃金夾具。
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createApp } = require("../../cms/app");
const A = require("../../cms/auth");
const { loadApprovers } = require("../../cms/approvers");
const Sec = require("../../cms/secrets");
const { build } = require("../../cms/server");
const S = require("../../core/store");

const PIPE = path.resolve(__dirname, "..", "..");
const FIX = path.join(PIPE, "test", "fixtures", "runs", "2026-10-27-wb-085823");
const read = (f) => JSON.parse(fs.readFileSync(path.join(FIX, f), "utf8"));
const APPROVER = "approver@dev.local", SALES = "sales@dev.local";
const ID = "2026-11-18-wb-120000";

async function boot({ store: given } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cs-cms-"));
  const store = given || S.createFsRunStore(dir);
  if (!given) { await store.createRun(ID, { stage: "ready", input: { url: "https://tw.buy.yahoo.com/?sub=1035", theme: "法式餐廚", ownerEmail: SALES } }); await store.putJson(ID, "snapshot.json", read("snapshot.replay.json")); await store.saveDraft(ID, read("draft.golden.json"), { source: "system", note: "建立" }); }
  const app = createApp({ store, auth: A.devAuth({ env: {} }), approvers: loadApprovers(path.join(PIPE, "config", "approvers.json")), deps: { clock: require("../../lib/clock"), offline: true } });
  const srv = await new Promise((r) => { const s = app.listen(0, "127.0.0.1", () => r(s)); });
  const base = `http://127.0.0.1:${srv.address().port}`;
  const call = async (method, p, { as, body } = {}) => { const r = await fetch(base + p, { method, headers: { ...(as ? { "x-dev-user": as } : {}), ...(body !== undefined ? { "content-type": "application/json" } : {}) }, body: body !== undefined ? (typeof body === "string" ? body : JSON.stringify(body)) : undefined }); let j = null; try { j = await r.json(); } catch (e) { /* 非 JSON */ } return { status: r.status, body: j }; };
  return { store, call, close: () => new Promise((r) => srv.close(r)) };
}

test("健康檢查不用登入；API 沒登入＝401", async () => {
  const s = await boot();
  try {
    assert.deepStrictEqual((await s.call("GET", "/healthz")).body, { ok: true, version: "dev" });
    assert.deepStrictEqual((await s.call("GET", "/readyz")).body, { ok: true, store: "fs" });
    for (const p of ["/api/me", "/api/runs", `/api/runs/${ID}`]) { const r = await s.call("GET", p); assert.strictEqual(r.status, 401, p); assert.strictEqual(r.body.code, "unauthenticated"); }
    assert.strictEqual((await s.call("POST", `/api/runs/${ID}/approve`, { body: {} })).status, 401);
    assert.strictEqual((await s.call("GET", "/nope")).status, 404);
  } finally { await s.close(); }
});

test("登入後看到列表與自己的身分（完成條件一）", async () => {
  const s = await boot();
  try {
    const me = await s.call("GET", "/api/me", { as: SALES });
    assert.deepStrictEqual(me.body, { email: SALES, name: "sales", dept: "", isApprover: false });
    assert.strictEqual((await s.call("GET", "/api/me", { as: `Test Approver <${APPROVER.toUpperCase()}>` })).body.isApprover, true, "名單比對不分大小寫");
    const list = await s.call("GET", "/api/runs", { as: SALES });
    assert.strictEqual(list.status, 200); assert.ok(Array.isArray(list.body), "列表回陣列（舊畫面認這個形狀）"); assert.strictEqual(list.body.length, 1);
    const row = list.body[0];
    assert.deepStrictEqual({ id: row.id, stage: row.stage, theme: row.input.theme, owner: row.input.ownerEmail, approvedAt: row.approvedAt, hasDraft: row.hasDraft, hasGate: row.hasGate, gate: row.gate, prodcheck: row.prodcheck },
      { id: ID, stage: "ready", theme: "法式餐廚", owner: SALES, approvedAt: null, hasDraft: true, hasGate: false, gate: null, prodcheck: null });
    assert.ok(row.pageName, "列表帶活動名稱");
    const one = await s.call("GET", `/api/runs/${ID}`, { as: SALES });
    assert.strictEqual(one.body.approval.approved, false); assert.match(one.body.approval.fingerprint, /^fp_/);
    assert.strictEqual((await s.call("GET", "/api/runs/no-such-run", { as: SALES })).status, 404);
    assert.strictEqual((await s.call("GET", "/api/runs/..%2Fetc", { as: SALES })).status, 400);
  } finally { await s.close(); }
});

test("非審核者按核可＝403，核可狀態沒變（完成條件二）；審核者才核可得了", async () => {
  const s = await boot();
  try {
    const fp = (await s.call("GET", `/api/runs/${ID}`, { as: SALES })).body.approval.fingerprint;
    const no = await s.call("POST", `/api/runs/${ID}/approve`, { as: SALES, body: { fingerprint: fp } });
    assert.strictEqual(no.status, 403); assert.strictEqual(no.body.code, "not-approver");
    assert.strictEqual((await s.store.approvalState(ID)).approved, false);
    // 審核者：沒帶版本＝400；帶舊版＝409；帶現在這版＝成功，記下是誰核可
    assert.strictEqual((await s.call("POST", `/api/runs/${ID}/approve`, { as: APPROVER, body: {} })).body.code, "missing-fingerprint");
    const stale = await s.call("POST", `/api/runs/${ID}/approve`, { as: APPROVER, body: { fingerprint: "fp_old" } });
    assert.strictEqual(stale.status, 409); assert.strictEqual(stale.body.code, "approve-stale"); assert.strictEqual(stale.body.latest.fingerprint, fp);
    // D13：核可前這一版要跑過發佈前檢查；核可會把草稿狀態改成「待建置」，所以鎖的是改完之後的指紋
    assert.strictEqual((await s.call("POST", `/api/runs/${ID}/approve`, { as: APPROVER, body: { fingerprint: fp } })).body.code, "gate-stale");
    assert.strictEqual((await s.call("POST", `/api/runs/${ID}/gate`, { as: APPROVER, body: {} })).body.result, "PASS");
    const ok = await s.call("POST", `/api/runs/${ID}/approve`, { as: APPROVER, body: { fingerprint: fp } });
    assert.strictEqual(ok.status, 200, JSON.stringify(ok.body)); assert.strictEqual(ok.body.approvedBy, APPROVER); assert.match(ok.body.fingerprint, /^fp_/); assert.notStrictEqual(ok.body.fingerprint, fp);
    const st = await s.store.approvalState(ID); assert.strictEqual(st.approved, true); assert.strictEqual(st.approvedBy, APPROVER);
    assert.match(await s.store.readLog(ID), new RegExp(`核可：${APPROVER.replace(".", "\\.")} 核可內容版本 fp_`));
    { const r1 = (await s.call("GET", "/api/runs", { as: SALES })).body[0]; assert.strictEqual(r1.approvedBy, APPROVER); assert.deepStrictEqual(r1.gate, { pass: true, fail: 0, warn: r1.gate.warn }); }
    assert.strictEqual((await s.call("POST", "/api/runs/no-such-run/approve", { as: APPROVER, body: { fingerprint: fp } })).status, 404);
    assert.strictEqual((await s.call("POST", `/api/runs/${ID}/approve`, { as: APPROVER, body: "{壞掉" })).body.code, "bad-json");
  } finally { await s.close(); }
});

test("伺服器內部出錯＝500 一句白話，不把錯誤細節回給畫面；資料後端連不上＝readyz 503", async () => {
  const boom = { kind: "fs", listRuns: async () => { throw new Error("秘密路徑 /var/secret 讀不到"); } };
  const orig = console.error; const logged = []; console.error = (...a) => logged.push(a.join(" "));
  const s = await boot({ store: boom });
  try {
    const r = await s.call("GET", "/api/runs", { as: SALES });
    assert.strictEqual(r.status, 500); assert.strictEqual(r.body.code, "internal"); assert.ok(!JSON.stringify(r.body).includes("秘密路徑"));
    assert.ok(logged.some((l) => l.includes("秘密路徑")), "細節進伺服器 log");
    const rd = await s.call("GET", "/readyz"); assert.strictEqual(rd.status, 503); assert.ok(!JSON.stringify(rd.body).includes("秘密路徑"));
  } finally { console.error = orig; await s.close(); }
});

test("登入方式：假登入在正式環境拒絕啟動；Okta 缺設定講清楚缺哪幾項；設定齊了也明講還沒接上", () => {
  assert.throws(() => A.devAuth({ env: { NODE_ENV: "production" } }), /正式環境不能用假登入/);
  assert.throws(() => A.authFromEnv({ CS_AUTH: "okta" }), /Okta 登入缺設定：CS_OKTA_ISSUER、CS_OKTA_CLIENT_ID、CS_OKTA_REDIRECT_URI/);
  assert.throws(() => A.authFromEnv({ CS_AUTH: "okta", CS_OKTA_ISSUER: "i", CS_OKTA_CLIENT_ID: "c", CS_OKTA_REDIRECT_URI: "r" }), /Okta 登入還沒接上/);
  assert.throws(() => A.authFromEnv({ CS_AUTH: "ldap" }), /只能是 dev 或 okta/);
  assert.deepStrictEqual(A.parseUser("王小明 <Ming@Dev.Local>"), { email: "ming@dev.local", name: "王小明", dept: "" });
  assert.strictEqual(A.parseUser("不是信箱"), null); assert.strictEqual(A.parseUser(""), null);
  // 環境變數指定預設身分；標頭優先
  const mw = A.devAuth({ env: { CS_DEV_USER: APPROVER } }).middleware; const req = { headers: {} }; mw(req, null, () => {}); assert.strictEqual(req.user.email, APPROVER);
  const req2 = { headers: { "x-dev-user": SALES } }; mw(req2, null, () => {}); assert.strictEqual(req2.user.email, SALES);
});

test("審核者名單：格式不對或是空的＝啟動時就出聲", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cs-appr-")); const w = (name, text) => { const p = path.join(dir, name); fs.writeFileSync(p, text); return p; };
  assert.throws(() => loadApprovers(path.join(dir, "none.json")), /讀不到或不是合法 JSON/);
  assert.throws(() => loadApprovers(w("a.json", "{}")), /要有 approvers 陣列/);
  assert.throws(() => loadApprovers(w("b.json", '{"approvers":[]}')), /名單是空的/);
  assert.throws(() => loadApprovers(w("c.json", '{"approvers":[{"email":"沒有小老鼠"}]}')), /email 不對/);
  const ok = loadApprovers(path.join(PIPE, "config", "approvers.json")); assert.ok(ok.count >= 1); assert.strictEqual(ok.isApprover(SALES), false);
  assert.ok(ok.list().every((a) => /@dev\.local$/.test(a.email)), "repo 裡的名單只放測試身分，不放真實信箱");
});

test("密鑰：本機讀環境變數（缺＝講清楚哪個變數）；正式讀密鑰管理服務並快取、不重複打", async () => {
  const env = Sec.envSecrets({ OKTA_CLIENT_SECRET: "x" });
  assert.strictEqual(await env.get("okta/client-secret"), "x"); assert.strictEqual(await env.has("session/secret"), false);
  await assert.rejects(() => env.get("session/secret"), /環境變數 SESSION_SECRET 沒有設定/);
  let n = 0; const asm = Sec.asmSecrets({ prefix: "campaign-studio/", client: { getSecretValue: async ({ SecretId }) => { n++; if (SecretId !== "campaign-studio/okta/client-secret") throw new Error("ResourceNotFound"); return { SecretString: "s3cr3t" }; } } });
  assert.strictEqual(await asm.get("okta/client-secret"), "s3cr3t"); assert.strictEqual(await asm.get("okta/client-secret"), "s3cr3t"); assert.strictEqual(n, 1);
  assert.strictEqual(await asm.has("nope"), false);
  assert.strictEqual(Sec.secretsFromEnv({}).kind, "env"); assert.strictEqual(Sec.secretsFromEnv({ CS_SECRETS: "asm" }).kind, "asm");
});

test("啟動組裝：設定齊＝組得起來；缺資料夾設定＝講清楚", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cs-build-"));
  const b = build({ CS_RUNS_DIR: dir, CS_DEV_USER: APPROVER });
  assert.strictEqual(b.store.kind, "fs"); assert.strictEqual(b.auth.kind, "dev"); assert.ok(b.approvers.count >= 1);
  assert.throws(() => build({}), /CS_RUNS_DIR/);
});
