"use strict";
/**
 * cms/runs.js —— 主流程路由（D13）。全部掛在 /api 底下、都要登入；核可另要審核者身分。
 *
 * 建立　POST /runs · GET /runs/:id/status
 * 編修　GET|PUT /runs/:id/draft.json · GET /runs/:id/snapshot.json · POST /runs/:id/rename
 * 檢查　POST /runs/:id/gate · GET /runs/:id/gate_report.json · POST /runs/:id/product-check · GET /runs/:id/product_check.json · POST /runs/:id/apply-live-price-all
 * 核可　POST /runs/:id/approve
 * 製作　POST /runs/:id/export-aem · GET /runs/:id/export.aem.html
 * 舊版　GET /runs/:id/versions · POST /runs/:id/versions/:v/rollback
 * 進階　GET /runs/:id/promo-options · POST /runs/:id/promo-recompose · GET|PUT /runs/:id/feedback-patch · POST /product-fetch · POST /runs/:id/r3-add ·
 *       POST /runs/:id/apply-live-price · POST /runs/:id/content-modules
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
const promo = require(path.join(PIPE, "core", "promo"));
const finish = require(path.join(PIPE, "core", "finish"));
const { deriveThemeKeywords } = require(path.join(PIPE, "lib", "theme_keywords.js"));
const { upsertPoolEntry } = require(path.join(PIPE, "workbench", "content_checks.js"));
const { patchSnapshotPrice, summary: pcSummary } = require(path.join(PIPE, "core", "product-truth", "rows"));
const { requireApprover } = require("./auth");
const { baseNum } = require("./frontend");

const errText = (e) => String((e && e.message) || e);
const BUSY_TEXT = { create: "這個活動還在建立處理中——等它完成再操作", export: "網頁檔還在製作中——請等這一輪完成", check: "商品狀態檢查進行中——等它完成再操作" };
const SCENARIOS = Object.keys(layoutLib.SCENARIO_LAYOUT_MAP || {});

/** 活動編號：建立當下的台灣時間（沿單機版格式 YYYY-MM-DD-wb-HHMMSS） */
function runIdAt(iso) { const d = new Date(new Date(iso).getTime() + 8 * 3600 * 1000); const p = (n) => String(n).padStart(2, "0"); return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}-wb-${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}`; }

function mountRuns(api, { store, approvers, jobs, deps, wrap }) {
  const need = async (req, res) => { const m = await store.readMeta(req.params.id); if (!m) { res.status(404).json({ error: "找不到這檔活動", code: "not-found" }); return null; } return m; };
  const busy = (req, res) => { const b = jobs.busy(req.params.id); if (b) { res.status(409).json({ error: BUSY_TEXT[b] || "這個活動正在處理中——請稍後再試", code: "busy", job: b }); return true; } return false; };
  const sendDoc = (name) => wrap(async (req, res) => { if (!(await need(req, res))) return; const r = await store.getText(req.params.id, name); if (!r) return res.status(404).json({ error: "這份資料還沒有產生", code: "no-doc" }); res.type("application/json").send(r.text); });

  /* ---------- 建立前的網址檢查（畫面按「開始策展」會先打這支；不通過就不建）----------
     單機版是去抓來源頁數活動檔；這裡問 uther 這個來源拿得到幾件商品。回應欄位沿單機版（畫面照這些欄位畫檢核表）：
     promotions／hotSales 固定 0（uther 這條路不看頁面上的活動檔）、hits＝拿得到的商品數。 */
  api.post("/source-check", wrap(async (req, res) => {
    const url = String((req.body && req.body.url) || "").trim();
    const plan = resolveSource(url);
    if (["invalid", "unsupported", "product"].includes(plan.kind)) return res.json({ ok: false, verdict: plan.reason });
    try {
      const u = deps.uther, o = { max: 60 };
      let r;
      if (plan.kind === "activity") r = await u.idsByMipId(plan.actid, o);
      else if (plan.kind === "store") r = await u.idsByStoreId(plan.storeId, o);
      else if (plan.kind === "search") r = await u.searchByKeyword(plan.keyword, plan.extra, o);
      else { const b = plan.brandId ? { brandIds: [plan.brandId] } : await deps.fetchBrandId(plan); r = b.brandIds && b.brandIds.length ? await u.idsByBrandIds(b.brandIds, o) : { ids: [] }; }
      const n = (r.ids || []).length, MIN = 27;
      const kindZh = { activity: "活動賣場", store: "店家", search: "搜尋結果", brand: "品牌頁" }[plan.kind];
      res.json({ ok: n >= MIN, promotions: 0, hotSales: 0, hits: n, flagship: 0, listing: n, suggestUrl: "", suggestKw: "", sourceKind: plan.kind,
        verdict: n >= MIN ? `這個網址可以用（${kindZh}，找到${n >= 60 ? " 60 件以上" : ` ${n} 件`}商品）——開始策展`
          : n > 0 ? `這個來源只找到 ${n} 件商品，版面最少需要 ${MIN} 件——請換一個商品比較多的網址（品牌頁、活動賣場或範圍大一點的搜尋）`
          : `這個來源目前找不到商品——可能是活動已結束、店家沒有上架商品，或關鍵字太窄；請換一個網址` });
    } catch (e) {
      console.warn(`[source-check] ${plan.kind} 查詢失敗：${errText(e)}`);
      res.json({ ok: false, kind: "network", verdict: "現在查不到商品資料（商品服務沒有回應）——請等一兩分鐘再按一次「開始策展」", tech: errText(e).slice(0, 160) });
    }
  }));

  /* 換品第一步：貼商品網址或賣場編號 → 伺服器去商品頁讀真值（判讀程式與單機版同一支） */
  api.post("/product-fetch", wrap(async (req, res) => {
    if (!deps.productFetch) return res.status(501).json({ error: "這台伺服器沒有接商品頁讀取，不能換品", code: "not-migrated" });
    const r = await deps.productFetch(req.body || {});
    res.status(r.code).json(r.code === 200 ? r.product : { error: r.error });
  }));

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
    const log = await store.readLog(req.params.id); // 舊畫面的建立進度條讀 logTail 最後幾行
    res.json({ ...m, id: m.id || req.params.id, stage: m.stage || null, error: m.error || null, busy: jobs.busy(req.params.id), exportAem: m.exportAem || null, productCheck: m.productCheck || null, priceTruth: m.priceTruth || null, logTail: log.split("\n").slice(-12).join("\n") });
  }));

  /* ---------- 編修 ---------- */
  api.get("/runs/:id/draft.json", wrap(async (req, res) => {
    if (!(await need(req, res))) return;
    const r = await store.getText(req.params.id, "draft.json");
    if (!r) return res.status(404).json({ error: "草稿還沒有產生（建立還沒完成？）", code: "no-doc" });
    const d = await store.getDraft(req.params.id);
    res.set("X-Draft-Version", r.etag).set("X-Draft-Mtime", String(baseNum(r.etag))).set("X-Draft-Fingerprint", d.fingerprint).set("Cache-Control", "no-store").type("application/json").send(r.text);
  }));
  api.put("/runs/:id/draft.json", wrap(async (req, res) => {
    if (!(await need(req, res)) || busy(req, res)) return;
    const parsed = req.body;
    if (!parsed || !parsed.page || !Array.isArray(parsed.products)) return res.status(400).json({ error: "儲存的內容不完整，這次沒有存入——請重新整理頁面後再試一次", code: "bad-draft" });
    try { contentModules.validateContentModules(parsed.page, contentModules.loadContentRegistry(), parsed.products); }
    catch (e) { return res.status(400).json({ error: "還沒儲存——" + errText(e), code: "invalid-content" }); }
    /* 版本怎麼帶：If-Match（版本代號原樣）或 X-Draft-Base。舊畫面的 X-Draft-Base 是數字（GET 時 X-Draft-Mtime 給的那個）：
       數字對得上現在這版＝當作帶了現在這版；對不上＝舊版；0 或沒帶＝沒帶。 */
    let ifMatch = req.get("If-Match") || null;
    const base = req.get("X-Draft-Base");
    if (!ifMatch && base && base !== "0") {
      if (/^\d+$/.test(base)) { const cur = await store.getText(req.params.id, "draft.json"); ifMatch = cur && baseNum(cur.etag) === Number(base) ? cur.etag : "stale:" + base; }
      else ifMatch = base;
    }
    const r = await store.saveDraft(req.params.id, parsed, { ifMatch, source: "client", actor: req.user.email });
    const savedAt = deps.clock.iso(); await store.patchMeta(req.params.id, { draftSavedAt: savedAt });
    res.set("X-Draft-Version", r.etag).json({ ok: true, version: r.etag, baseMs: baseNum(r.etag), fingerprint: r.fingerprint, changed: r.changed, corrected: r.corrected, approvalInvalidated: r.approvalInvalidated,
      savedAt, backup: r.versionId ? `draft.v${r.versionId}.json` : "上一版" });
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
    const full = !!(req.body && req.body.full) || req.query.full === "1";
    const report = await P.runGate({ store, id: req.params.id, full, deps });
    res.json({ ok: true, result: report.result, counts: report.counts, exit: report.counts.FAIL ? 1 : 0, output: "", report, mode: full ? "全檢" : "快檢" }); // exit／output／report／mode＝舊畫面讀的欄位
  }));
  api.get("/runs/:id/gate_report.json", sendDoc("gate_report.json"));
  /* 商品狀態檢查＝背景工作（商品頁層要逐件開頁，幾十秒）。body { layer: "uther" } 可指定只查 uther；預設走這台伺服器能做的最完整那層。 */
  api.post("/runs/:id/product-check", wrap(async (req, res) => {
    if (!(await need(req, res)) || busy(req, res)) return;
    const layer = req.body && req.body.layer === "uther" ? "uther" : null;
    /* 登記成背景工作（檢查中不收別的修改），但沿單機版等它做完才回、回整份報告——舊畫面按下去是等結果的 */
    jobs.start(req.params.id, "check", () => P.runProductCheck({ store, id: req.params.id, deps, layer }));
    await jobs.wait(req.params.id);
    const pc = await store.getJson(req.params.id, "product_check.json"), m2 = await store.readMeta(req.params.id);
    if (!pc || (m2.productCheck && m2.productCheck.stage === "error")) return res.status(502).json({ error: (m2.productCheck && m2.productCheck.error) || "商品狀態檢查沒有跑完，請再試一次", code: "check-failed" });
    res.json({ ok: true, ...pc.data });
  }));
  api.post("/runs/:id/apply-live-price-all", wrap(async (req, res) => {
    if (!(await need(req, res)) || busy(req, res)) return;
    const r = await P.applyLivePrices({ store, id: req.params.id, actor: req.user.email });
    if (r.count) await P.runGate({ store, id: req.params.id, full: false, deps }); // 價格變了＝補跑快檢，報告對得上這一版
    res.json({ ok: true, count: r.count, applied: r.applied.map((a) => ({ gdid: a.gdid, from: a.from, to: a.to })), approvalInvalidated: r.approvalInvalidated });
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
    const now = await store.getText(id, "draft.json");
    res.json({ ok: true, ...r, approvedWithFail: fails > 0 ? fails : null, baseMs: baseNum(now.etag), version: now.etag, status: "待建置" });
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

  /* ---------- 編修頁的進階操作（D14 第二段）----------
     這幾支都會改草稿或快照。改完一律回新的版本代號（baseMs／fingerprint）與整份草稿，畫面換成伺服器這一版接著編。 */
  const ver = async (id) => { const t = await store.getText(id, "draft.json"), d = await store.getDraft(id); return { version: t.etag, baseMs: baseNum(t.etag), fingerprint: d.fingerprint }; };
  const loadBoth = async (req, res) => { const id = req.params.id; const [cur, snap] = [await store.getDraft(id), await store.getJson(id, "snapshot.json")];
    if (!cur) { res.status(404).json({ error: "草稿還沒有產生", code: "no-doc" }); return null; }
    if (!snap) { res.status(409).json({ error: "這個活動缺少來源商品資料——請重新建立這個活動", code: "no-snapshot" }); return null; }
    return { id, cur, snap }; };
  const themeKeywords = async (id, draft, snapshot) => {
    const patch = await store.getJson(id, "feedback_patch.json"); const k = patch && patch.data.themeFitRule && patch.data.themeFitRule.keywords;
    if (k && k.length) return k;
    const meta = await store.readMeta(id);
    return [...new Set([...deriveThemeKeywords(draft.page.curationTheme), ...finish.deriveSourceKeywords((meta.input || {}).url || "", snapshot.brand || "")])];
  };

  /* 本期活動：三種來源各有幾個可選 */
  api.get("/runs/:id/promo-options", wrap(async (req, res) => {
    if (!(await need(req, res))) return; const x = await loadBoth(req, res); if (!x) return;
    const layers = promo.promoLayers({ draft: x.cur.draft, snapshot: x.snap.data, keywords: await themeKeywords(x.id, x.cur.draft, x.snap.data), nowMs: Date.parse(deps.clock.iso()) });
    res.json({ mode: x.cur.draft.page.promoSourceMode || (x.cur.draft.page.promoEntries ? "promo-activity" : "auto"), hasEntries: !!x.cur.draft.page.promoEntries, layers });
  }));
  /* 本期活動：換來源或重選入口＝整批重組 */
  api.post("/runs/:id/promo-recompose", wrap(async (req, res) => {
    if (!(await need(req, res)) || busy(req, res)) return; const x = await loadBoth(req, res); if (!x) return;
    const b = req.body || {};
    const layers = promo.promoLayers({ draft: x.cur.draft, snapshot: x.snap.data, keywords: await themeKeywords(x.id, x.cur.draft, x.snap.data), nowMs: Date.parse(deps.clock.iso()) });
    const r = promo.recompose({ draft: x.cur.draft, layers, mode: String(b.mode || ""), actids: b.actids, gdids: b.gdids });
    if (!r.ok) return res.status(r.status).json({ error: r.error, code: "promo-recompose" });
    const saved = await store.saveDraft(x.id, x.cur.draft, { ifMatch: x.cur.etag, source: "system", actor: req.user.email, note: `本期活動重組（${promo.MODE_ZH[b.mode]}）：入口 ×${r.entries.length}` });
    if (r.added.length) await store.appendLog(x.id, `本期活動入口商品補入商品清單 ${r.added.length} 件：${r.added.join(",")}`);
    if (r.ensureNote) await store.appendLog(x.id, "⚠ " + r.ensureNote);
    res.json({ ok: true, draft: x.cur.draft, backup: saved.versionId ? `draft.v${saved.versionId}.json` : "上一版", entries: r.entries.length, truncated: r.truncated, ensureNote: r.ensureNote, approvalInvalidated: saved.approvalInvalidated, ...(await ver(x.id)) });
  }));
  /* 主題詞組（CP-14 用哪些詞判斷商品跟主題有沒有關）：讀、人工改 */
  api.get("/runs/:id/feedback-patch", wrap(async (req, res) => { if (!(await need(req, res))) return; const p = await store.getJson(req.params.id, "feedback_patch.json"); res.json({ themeFitRule: (p && p.data.themeFitRule) || null }); }));
  api.put("/runs/:id/feedback-patch", wrap(async (req, res) => {
    if (!(await need(req, res)) || busy(req, res)) return;
    const kws = Array.isArray(req.body && req.body.keywords) ? req.body.keywords.map((k) => String(k).trim()).filter(Boolean).slice(0, 30) : [];
    if (!kws.length) return res.status(400).json({ error: "至少要留一個關鍵詞——全部清空的話，就無法檢查商品和主題相不相符了", code: "no-keywords" });
    const p = await store.getJson(req.params.id, "feedback_patch.json"); const j = (p && p.data) || {};
    j.themeFitRule = { ...(j.themeFitRule || { threshold: 0.3 }), keywords: kws, note: `人工詞組（工作台編修 ${deps.clock.iso().slice(0, 10)}；30% 門檻不變）` };
    await store.putJson(req.params.id, "feedback_patch.json", j);
    await store.appendLog(req.params.id, `CP-14 主題詞組人工編修（${req.user.email}）：${kws.join("、")}`);
    res.json({ ok: true, themeFitRule: j.themeFitRule });
  }));
  /* 換品第二步：把換進來的商品登記進來源快照（否則發佈前檢查會說「這件不在來源紀錄裡」）。既有商品＝同步成新抓到的真值，並讓核可失效。 */
  api.post("/runs/:id/r3-add", wrap(async (req, res) => {
    if (!(await need(req, res)) || busy(req, res)) return;
    const id = req.params.id, p = (req.body && req.body.product) || {};
    const snap = await store.getJson(id, "snapshot.json"); if (!snap) return res.status(404).json({ error: "這個活動沒有來源快照", code: "no-snapshot" });
    if (!p.gdid || !p.name || p.price == null || !p.url) { await store.appendLog(id, "來源紀錄登記被拒：商品缺必要欄位（編號／名稱／價格／連結）"); return res.status(400).json({ error: "無法加入這件商品：讀不到它的必要資料（名稱／價格／連結）——請改用賣場編號重新挑一件在售商品", code: "bad-product" }); }
    snap.data.products = snap.data.products || [];
    const up = upsertPoolEntry(snap.data, p);
    if (up.mode === "sync" && !up.changed.length) return res.json({ ok: true, already: true });
    const now = deps.clock.iso();
    snap.data.warnings = (snap.data.warnings || []).concat(up.mode === "sync" ? `R3 真值同步：gdid ${p.gdid} 更替重抓→同步 ${up.changed.join("、")}（${now}）` : `R3 自動入池：gdid ${p.gdid}「${p.name}」＝更替實抓真值（${now}）；desc 未抓、offer 留空不捏造`);
    await store.putJson(id, "snapshot.json", snap.data, { ifMatch: snap.etag });
    await store.appendLog(id, up.mode === "sync" ? `來源紀錄同步：gdid ${p.gdid}（${up.changed.join("、")}）` : `來源紀錄登記：gdid ${p.gdid}（換品）`);
    let approvalInvalidated = false;
    if (up.mode === "sync") { const m = await store.readMeta(id); if (m.approvedAt) { approvalInvalidated = true; await store.patchMeta(id, { approvedAt: null, approvalInvalidatedAt: now, approvedAtPrev: m.approvedAt }); await store.appendLog(id, "核可失效：來源紀錄的價格真值有變，需重新檢查並核可"); } }
    res.json({ ok: true, mode: up.mode, refreshed: up.changed, approvalInvalidated });
  }));
  /* 單件套用商品頁現價（一鍵全部＝apply-live-price-all） */
  api.post("/runs/:id/apply-live-price", wrap(async (req, res) => {
    if (!(await need(req, res)) || busy(req, res)) return;
    const gdid = String((req.body && req.body.gdid) || "");
    const r = await P.applyLivePrices({ store, id: req.params.id, actor: req.user.email, onlyGdid: gdid });
    if (r.count) await P.runGate({ store, id: req.params.id, full: false, deps });
    const a = r.applied[0];
    res.json({ ok: true, price: a ? a.to.price : null, marketPrice: a ? a.to.marketPrice : null, approvalInvalidated: r.approvalInvalidated, draft: (await store.getDraft(req.params.id)).draft, ...(await ver(req.params.id)) });
  }));
  /* 頁面組成：區塊與樓層的上移下移、加減區塊、換排版、貼網址帶入商品。規則全在 lib/content_modules（單機版同一支）。 */
  api.post("/runs/:id/content-modules", wrap(async (req, res) => {
    if (!(await need(req, res)) || busy(req, res)) return; const x = await loadBoth(req, res); if (!x) return;
    const b = { ...(req.body || {}) };
    let reg; try { reg = contentModules.loadContentRegistry(); } catch (e) { return res.status(500).json({ error: "頁面組成面板暫時無法運作（模組登記簿讀取問題）：" + errText(e) }); }
    let poolSynced = false;
    if (b.action === "pick") {
      const pk = contentModules.PICK_KINDS[b.kind];
      if (!pk) return res.status(400).json({ error: "這個區塊不支援貼網址帶入商品——目前開放主打選品、促銷卡、品類牆、主打樓層。" });
      if (b.auto === true) return res.status(501).json({ error: "「補一件折數最好的」第一版還沒接上——請貼商品網址或輸入賣場編號指名商品", code: "not-migrated" });
      if (!String(b.input || "").trim()) return res.status(400).json({ error: "請先貼上商品網址或輸入賣場編號，再按「帶入商品」。" });
      if (!deps.productFetch) return res.status(501).json({ error: "這台伺服器沒有接商品頁讀取，不能貼網址帶入商品", code: "not-migrated" });
      const rK = await deps.productFetch({ url: String(b.input) });
      if (rK.code !== 200) return res.status(rK.code).json({ error: rK.error });
      const up = upsertPoolEntry(x.snap.data, rK.product, pk.source);
      if (up.mode === "add" || up.changed.length) {
        x.snap.data.warnings = (x.snap.data.warnings || []).concat(up.mode === "add" ? `R3 入池（${pk.name}貼稿）：gdid ${rK.product.gdid}「${rK.product.name}」（${deps.clock.iso()}）` : `R3 真值同步（${pk.name}貼稿）：gdid ${rK.product.gdid} 同步 ${up.changed.join("、")}（${deps.clock.iso()}）`);
        await store.putJson(x.id, "snapshot.json", x.snap.data, { ifMatch: x.snap.etag });
        await store.appendLog(x.id, `${pk.name}貼稿${up.mode === "add" ? "入池" : "真值同步"}：gdid ${rK.product.gdid}`);
        poolSynced = up.mode === "sync" && up.changed.length > 0;
      }
      b.product = rK.product; b.auto = undefined; // 真值只走伺服器實抓結果，畫面傳的 product 一律覆蓋
    }
    let r;
    try { const aligned = b.product ? contentModules.alignDraftRowTruth(x.cur.draft.products, b.product) : []; r = contentModules.applyContentModule(x.cur.draft, b, reg); if (aligned.length) { r.info = r.info || {}; r.info.nameAligned = b.product.gdid; r.changed = true; } }
    catch (e) { await store.appendLog(x.id, "頁面組成變更失敗：" + errText(e)); return res.status(400).json({ error: errText(e) }); }
    if (!r.changed && !poolSynced) return res.json({ ok: true, changed: false, draft: x.cur.draft, info: r.info, approvalInvalidated: false, ...(await ver(x.id)) });
    const saved = await store.saveDraft(x.id, x.cur.draft, { ifMatch: x.cur.etag, source: "system", actor: req.user.email, note: `頁面組成：${b.kind || ""} ${b.action || ""}`.trim() });
    res.json({ ok: true, changed: true, draft: x.cur.draft, backup: saved.versionId ? `draft.v${saved.versionId}.json` : "上一版", info: r.info, approvalInvalidated: saved.approvalInvalidated, ...(await ver(x.id)) });
  }));

  /* ---------- 舊版 ---------- */
  api.get("/runs/:id/versions", wrap(async (req, res) => {
    const m = await need(req, res); if (!m) return;
    const vs = await store.listDraftVersions(req.params.id);
    /* file／n／mtime＝舊畫面讀的欄位（本機資料夾後端的舊版就叫 draft.vN.json） */
    res.json({ current: m.draftSavedAt || m.updatedAt || null, approvedAt: m.approvedAt || null, deploy: null, versions: vs.slice().reverse().map((v) => ({ ...v, file: `draft.v${v.versionId}.json`, n: Number(v.versionId) || null, mtime: v.lastModified || null })) });
  }));
  api.post("/runs/:id/versions/:v/rollback", wrap(async (req, res) => {
    const id = req.params.id;
    if (!(await need(req, res)) || busy(req, res)) return;
    const vid = (String(req.params.v).match(/^draft\.v(\d+)\.json$/) || [])[1] || req.params.v; // 舊畫面傳檔名 draft.vN.json
    const old = await store.getDraftVersion(id, vid);
    if (!old) return res.status(404).json({ error: "找不到這個版本——請重新整理頁面後再試一次", code: "no-version" });
    const cur = await store.getDraft(id);
    const r = await store.saveDraft(id, old.draft, { ifMatch: cur.etag, source: "system", actor: req.user.email, note: `版本還原：${req.params.v}` });
    const g = await P.runGate({ store, id, full: false }); // 還原後補跑快檢：畫面上的「檢查都過了」要是這一版的結果
    res.json({ ok: true, version: r.etag, baseMs: baseNum(r.etag), fingerprint: r.fingerprint, approvalInvalidated: r.approvalInvalidated, gate: g.result, rollbackRegate: g.result, draft: old.draft });
  }));
}
module.exports = { mountRuns, runIdAt, SCENARIOS };
