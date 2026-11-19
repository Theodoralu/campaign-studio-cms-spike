"use strict";
/**
 * cms/runs.js —— 主流程路由（D13）。全部掛在 /api 底下、都要登入；核可另要審核者身分。
 *
 * 建立　POST /runs · GET /runs/:id/status
 * 編修　GET|PUT /runs/:id/draft.json · GET /runs/:id/snapshot.json · POST /runs/:id/rename
 * 檢查　POST /runs/:id/gate · GET /runs/:id/gate_report.json · POST /runs/:id/product-check · GET /runs/:id/product_check.json
 * 核可　POST /runs/:id/approve
 * 製作　POST /runs/:id/export-aem · GET /runs/:id/export.aem.html
 * 舊版　GET /runs/:id/versions · POST /runs/:id/versions/:v/rollback
 *
 * 網址形狀沿單機版（舊前端認得）。行為改走 RunStore：存草稿要帶版本（If-Match 或 X-Draft-Base＝GET 時拿到的 X-Draft-Version）。
 * 有背景工作在跑的活動（建立中、製作中）不收會改資料的請求＝409。
 */
const path = require("path");
const PIPE = path.join(__dirname, "..");
const { resolveSource } = require(path.join(PIPE, "core", "source", "resolve"));
const layoutLib = require(path.join(PIPE, "lib", "layout_choice.js"));
const contentModules = require(path.join(PIPE, "lib", "content_modules.js"));
const P = require("./pipeline");
const { requireApprover } = require("./auth");

const errText = (e) => String((e && e.message) || e);
const BUSY_TEXT = { create: "這個活動還在建立處理中——等它完成再操作", export: "網頁檔還在製作中——請等這一輪完成" };
const SCENARIOS = Object.keys(layoutLib.SCENARIO_LAYOUT_MAP || {});

/** 活動編號：建立當下的台灣時間（沿單機版格式 YYYY-MM-DD-wb-HHMMSS） */
function runIdAt(iso) { const d = new Date(new Date(iso).getTime() + 8 * 3600 * 1000); const p = (n) => String(n).padStart(2, "0"); return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}-wb-${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}`; }

function mountRuns(api, { store, approvers, jobs, deps, wrap }) {
  const need = async (req, res) => { const m = await store.readMeta(req.params.id); if (!m) { res.status(404).json({ error: "找不到這檔活動", code: "not-found" }); return null; } return m; };
  const busy = (req, res) => { const b = jobs.busy(req.params.id); if (b) { res.status(409).json({ error: BUSY_TEXT[b] || "這個活動正在處理中——請稍後再試", code: "busy", job: b }); return true; } return false; };
  const sendDoc = (name) => wrap(async (req, res) => { if (!(await need(req, res))) return; const r = await store.getText(req.params.id, name); if (!r) return res.status(404).json({ error: "這份資料還沒有產生", code: "no-doc" }); res.type("application/json").send(r.text); });

  /* ---------- 建立 ---------- */
  api.post("/runs", wrap(async (req, res) => {
    const b = req.body || {};
    const url = String(b.url || "").trim();
    if (!url) return res.status(400).json({ error: "請貼上來源網址", code: "missing-url" });
    const plan = resolveSource(url);
    if (["invalid", "unsupported", "product"].includes(plan.kind)) return res.status(400).json({ error: plan.reason, code: "bad-url" });
    if (b.themeColor && !/^#?[0-9a-fA-F]{6}$/.test(String(b.themeColor))) return res.status(400).json({ error: "自訂主題色要是六碼色碼，例如 #1D5F8A", code: "bad-color" });
    const input = { url, scenario: String(b.scenario || "").trim(), theme: String(b.theme || "").trim(), pageName: String(b.pageName || "").trim() || undefined,
      ownerEmail: req.user.email, ownerDept: req.user.dept || "", engine: "rules", themeColor: b.themeColor ? String(b.themeColor) : "", themeMode: b.themeMode === "dark" ? "dark" : "light",
      kvVariant: b.kvVariant ? String(b.kvVariant) : "ai" };
    try { const r = layoutLib.resolveLayoutChoice(input, layoutLib.loadLayoutDeps()); input.kvVariant = r.kvVariant; input.layoutChoice = r.choice; }
    catch (e) { return res.status(400).json({ error: errText(e), code: "bad-layout" }); }
    const base = runIdAt(deps.clock.iso()); let id = base;
    for (let n = 2; ; n++) { try { await store.createRun(id, { stage: "fetching", input, engine: "rules" }); break; } catch (e) { if (e.code !== "run-exists" || n > 20) throw e; id = `${base}-${n}`; } }
    jobs.start(id, "create", () => P.createRun({ store, id, input, deps }));
    res.json({ id, kvVariant: input.kvVariant || null, layoutChoice: input.layoutChoice || null });
  }));
  api.get("/runs/:id/status", wrap(async (req, res) => {
    const m = await need(req, res); if (!m) return;
    res.json({ id: m.id, stage: m.stage || null, error: m.error || null, busy: jobs.busy(req.params.id), exportAem: m.exportAem || null, priceTruth: m.priceTruth || null, approvedAt: m.approvedAt || null, updatedAt: m.updatedAt || null });
  }));

  /* ---------- 編修 ---------- */
  api.get("/runs/:id/draft.json", wrap(async (req, res) => {
    if (!(await need(req, res))) return;
    const r = await store.getText(req.params.id, "draft.json");
    if (!r) return res.status(404).json({ error: "草稿還沒有產生（建立還沒完成？）", code: "no-doc" });
    const d = await store.getDraft(req.params.id);
    res.set("X-Draft-Version", r.etag).set("X-Draft-Fingerprint", d.fingerprint).set("Cache-Control", "no-store").type("application/json").send(r.text);
  }));
  api.put("/runs/:id/draft.json", wrap(async (req, res) => {
    if (!(await need(req, res)) || busy(req, res)) return;
    const parsed = req.body;
    if (!parsed || !parsed.page || !Array.isArray(parsed.products)) return res.status(400).json({ error: "儲存的內容不完整，這次沒有存入——請重新整理頁面後再試一次", code: "bad-draft" });
    try { contentModules.validateContentModules(parsed.page, contentModules.loadContentRegistry(), parsed.products); }
    catch (e) { return res.status(400).json({ error: "還沒儲存——" + errText(e), code: "invalid-content" }); }
    const ifMatch = req.get("If-Match") || req.get("X-Draft-Base") || null;
    const r = await store.saveDraft(req.params.id, parsed, { ifMatch, source: "client", actor: req.user.email });
    res.set("X-Draft-Version", r.etag).json({ ok: true, version: r.etag, fingerprint: r.fingerprint, changed: r.changed, corrected: r.corrected, approvalInvalidated: r.approvalInvalidated });
  }));
  api.get("/runs/:id/snapshot.json", sendDoc("snapshot.json"));
  api.post("/runs/:id/rename", wrap(async (req, res) => {
    if (!(await need(req, res)) || busy(req, res)) return;
    const name = String((req.body && req.body.pageName) || "").trim();
    if (!name || name.length > 60) return res.status(400).json({ error: "活動名稱要 1～60 個字", code: "bad-name" });
    const cur = await store.getDraft(req.params.id);
    if (!cur) return res.status(404).json({ error: "草稿還沒有產生", code: "no-doc" });
    cur.draft.page.pageName = name;
    const r = await store.saveDraft(req.params.id, cur.draft, { ifMatch: cur.etag, source: "system", actor: req.user.email, note: "改名" });
    res.json({ ok: true, pageName: name, version: r.etag, fingerprint: r.fingerprint, approvalInvalidated: r.approvalInvalidated });
  }));

  /* ---------- 檢查 ---------- */
  api.post("/runs/:id/gate", wrap(async (req, res) => {
    if (!(await need(req, res)) || busy(req, res)) return;
    const report = await P.runGate({ store, id: req.params.id, full: !!(req.body && req.body.full), deps });
    res.json({ ok: true, result: report.result, counts: report.counts });
  }));
  api.get("/runs/:id/gate_report.json", sendDoc("gate_report.json"));
  api.post("/runs/:id/product-check", wrap(async (req, res) => {
    if (!(await need(req, res)) || busy(req, res)) return;
    const chk = await P.runProductCheck({ store, id: req.params.id, deps });
    res.json({ ok: true, layer: chk.layer, summary: chk.summary, checkedAt: chk.checkedAt });
  }));
  api.get("/runs/:id/product_check.json", sendDoc("product_check.json"));

  /* ---------- 核可 ----------
     單機版三件事搬過來兩件：①核可＝把草稿狀態改「待建置」並鎖這一版 ②檢查有必修項目沒過，要明確勾選知悉（ackFail）才收，並留稽核印記。
     ③「換版式後強制重驗」跟著換主視覺組合那批路由一起搬（第一版未搬）。 */
  api.post("/runs/:id/approve", requireApprover(approvers), wrap(async (req, res) => {
    const id = req.params.id;
    if (!(await need(req, res)) || busy(req, res)) return;
    const b = req.body || {};
    if (!b.fingerprint) return res.status(400).json({ error: "核可要帶你檢視的那一版（fingerprint）——請重新整理頁面後再核可", code: "missing-fingerprint" });
    const cur = await store.getDraft(id);
    if (!cur) return res.status(404).json({ error: "草稿還沒有產生", code: "no-doc" });
    if (b.fingerprint !== cur.fingerprint) return res.status(409).json({ error: "草稿在你檢視之後有變更，這次沒有核可——請重新檢查後再核可", code: "approve-stale", latest: { fingerprint: cur.fingerprint, etag: cur.etag } });
    const g = await store.getJson(id, "gate_report.json");
    const fails = g ? (g.data.counts && g.data.counts.FAIL) || 0 : null;
    const fresh = g && g.data.draftSha256 === require("crypto").createHash("sha256").update((await store.getText(id, "draft.json")).text).digest("hex");
    if (!g || !fresh) return res.status(409).json({ error: "這一版還沒有跑過發佈前檢查——請先按「重新檢查」再核可", code: "gate-stale" });
    if (fails > 0 && !b.ackFail) return res.status(409).json({ error: `發佈前檢查還有 ${fails} 個必修項目沒過——修正後再核可，或勾選「我知道還有必修項目」先鎖版`, code: "gate-fail", failCount: fails });
    cur.draft.page.status = "待建置";
    const saved = await store.saveDraft(id, cur.draft, { ifMatch: cur.etag, source: "system", actor: req.user.email, note: "核可鎖版：status→待建置" });
    const r = await store.approve(id, { by: req.user.email, expectFingerprint: saved.fingerprint, extra: { approvedWithFail: fails > 0 ? fails : null } });
    await P.runGate({ store, id, full: false }); // 狀態欄變了＝檔案指紋變了；補跑快檢讓報告對得上這一版
    if (fails > 0) await store.appendLog(id, `⚠ 帶 ${fails} 個 FAIL 核可（${req.user.email} 勾選知悉＝先鎖版後修）`);
    res.json({ ok: true, ...r, approvedWithFail: fails > 0 ? fails : null });
  }));

  /* ---------- 製作 ---------- */
  api.post("/runs/:id/export-aem", wrap(async (req, res) => {
    const id = req.params.id;
    if (!(await need(req, res)) || busy(req, res)) return;
    const st = await store.approvalState(id);
    if (!st.fingerprint) return res.status(404).json({ error: "草稿還沒有產生", code: "no-doc" });
    if (!st.approved) return res.status(409).json({ error: "要先核可這個版本才能製作——請先按「核可這一版」，製作時會自動再跑一次合規檢查把關", code: "not-approved" });
    jobs.start(id, "export", () => P.exportHtml({ store, id, deps }));
    res.json({ ok: true, note: "已開始製作（合規全檢→組裝單一 HTML→三裝置顯示檢查；做好即可下載）" });
  }));
  api.get("/runs/:id/export.aem.html", wrap(async (req, res) => {
    const m = await need(req, res); if (!m) return;
    const ex = m.exportAem || {};
    if (ex.stage !== "done" || !ex.file) return res.status(409).json({ error: "網頁檔還沒有做好——請先按「製作」", code: "not-exported", stage: ex.stage || null });
    const cur = await store.getDraft(req.params.id);
    if (ex.fingerprint && cur && ex.fingerprint !== cur.fingerprint) return res.status(409).json({ error: "草稿在製作之後有變更——這份網頁檔已經不是最新內容，請重新核可並製作", code: "export-stale" });
    const f = await store.getText(req.params.id, `export/aem/${ex.file}`);
    if (!f) return res.status(404).json({ error: "找不到做好的網頁檔，請重新製作", code: "no-doc" });
    res.set("Content-Disposition", `attachment; filename="${ex.file}"`).type("text/html").send(f.text);
  }));

  /* ---------- 舊版 ---------- */
  api.get("/runs/:id/versions", wrap(async (req, res) => {
    const m = await need(req, res); if (!m) return;
    const vs = await store.listDraftVersions(req.params.id);
    res.json({ approvedAt: m.approvedAt || null, versions: vs.slice().reverse() });
  }));
  api.post("/runs/:id/versions/:v/rollback", wrap(async (req, res) => {
    const id = req.params.id;
    if (!(await need(req, res)) || busy(req, res)) return;
    const old = await store.getDraftVersion(id, req.params.v);
    if (!old) return res.status(404).json({ error: "找不到這個版本——請重新整理頁面後再試一次", code: "no-version" });
    const cur = await store.getDraft(id);
    const r = await store.saveDraft(id, old.draft, { ifMatch: cur.etag, source: "system", actor: req.user.email, note: `版本還原：${req.params.v}` });
    const g = await P.runGate({ store, id, full: false }); // 還原後補跑快檢：畫面上的「檢查都過了」要是這一版的結果
    res.json({ ok: true, version: r.etag, fingerprint: r.fingerprint, approvalInvalidated: r.approvalInvalidated, gate: g.result });
  }));
}
module.exports = { mountRuns, runIdAt, SCENARIOS };
