"use strict";
/**
 * cms/uploads.js —— 兩種「上傳檔案」的功能（D14 第四段，2026-11-27）
 *
 * 一、自己上傳主視覺背景（桌機／平板／手機三張）
 *   POST   /runs/:id/hero-bg            驗尺寸、自動壓成 WebP、存檔；回 heroBgOwn 描述（不寫草稿，畫面接著走 hero-combo 套用）
 *   DELETE /runs/:id/hero-bg            移除三張與原檔
 *   GET    /runs/:id/hero-bg/:file      預覽用（只放行三格檔名）
 *   POST   /runs/:id/hero-bg-confirm    版權確認（記帳號、時間、圖組指紋）；沒確認不能製作
 *   GET    /runs/:id/hero-kit           背景製作說明（依版式給三種尺寸與提示詞）
 * 二、Excel 帶入三個內文模組（活動資訊卡／主打選品／促銷卡）
 *   GET    /runs/:id/import-template    下載範本
 *   POST   /runs/:id/import-preview     只對帳、不寫入
 *   POST   /runs/:id/import-apply       帶入（商品欄一律由伺服器讀商品頁）
 *
 * 規則全在 lib（hero_bg_own、hero_bg_license、hero_bg_kit、sheet_import、content_modules），與單機版同一支。
 *
 * 圖檔怎麼存：lib/hero_bg_own 是對「活動資料夾」讀寫檔案的。這裡每次操作先把這檔的圖從 RunStore 取到暫存資料夾、讓 lib 照常做、
 * 做完把有變的檔存回 RunStore、刪掉暫存。RunStore 目前只存文字，所以圖以 base64 文字存成 hero-bg/<檔名>.b64（本機資料夾與 S3 同一套）。
 */
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const PIPE = path.join(__dirname, "..");
const heroBgOwn = require(path.join(PIPE, "lib", "hero_bg_own.js"));
const heroBgLic = require(path.join(PIPE, "lib", "hero_bg_license.js"));
const heroBgKit = require(path.join(PIPE, "lib", "hero_bg_kit.js"));
const layoutLib = require(path.join(PIPE, "lib", "layout_choice.js"));
const contentModules = require(path.join(PIPE, "lib", "content_modules.js"));
const sheetImport = require(path.join(PIPE, "lib", "sheet_import.js"));
const { upsertPoolEntry } = require(path.join(PIPE, "workbench", "content_checks.js"));
const { baseNum } = require("./frontend");

const errText = (e) => String((e && e.message) || e);
const sha = (buf) => crypto.createHash("sha256").update(buf).digest("hex");
const bgKey = (id, file) => `${id}/${heroBgOwn.DIRNAME}/${file}.b64`;
const MANIFEST = path.join(PIPE, "..", "..", "design-assets", "backgrounds", "manifest.json");

/** 把這檔的背景圖放進暫存的「活動資料夾」給 fn 用；fn 做完把新增、改過、刪掉的檔同步回 RunStore。回 fn 的結果。 */
async function withBgDir(store, id, fn, { readOnly = false } = {}) {
  const runDir = fs.mkdtempSync(path.join(os.tmpdir(), "cs-bg-")), sub = path.join(runDir, heroBgOwn.DIRNAME);
  try {
    const before = new Map();
    for (const n of await store.backend.children(`${id}/${heroBgOwn.DIRNAME}`)) { if (!n.endsWith(".b64")) continue; const file = n.slice(0, -4), r = await store.backend.get(bgKey(id, file)); if (!r) continue;
      const buf = Buffer.from(r.text, "base64"); fs.mkdirSync(sub, { recursive: true }); fs.writeFileSync(path.join(sub, file), buf); before.set(file, sha(buf)); }
    const out = await fn(runDir);
    if (!readOnly) {
      const now = fs.existsSync(sub) ? fs.readdirSync(sub) : [];
      for (const file of now) { const buf = fs.readFileSync(path.join(sub, file)); if (before.get(file) !== sha(buf)) await store.backend.put(bgKey(id, file), buf.toString("base64")); }
      for (const file of before.keys()) if (!now.includes(file)) await store.backend.del(bgKey(id, file));
    }
    return out;
  } finally { fs.rmSync(runDir, { recursive: true, force: true }); }
}

function mountUploads(api, { store, jobs, deps, wrap }) {
  const alive = async (req, res) => { const m = await store.readMeta(req.params.id); if (!m || m.deletedAt) { res.status(404).json({ error: "找不到這檔活動", code: "not-found" }); return null; } return m; };
  const busy = (req, res) => { if (jobs.busy(req.params.id)) { res.status(409).json({ error: "這個活動正在處理中——請稍後再試", code: "busy" }); return true; } return false; };
  const ver = async (id) => { const t = await store.getText(id, "draft.json"), d = await store.getDraft(id); return { version: t.etag, baseMs: baseNum(t.etag), fingerprint: d.fingerprint }; };
  const pageOf = async (req, res) => { const cur = await store.getDraft(req.params.id); if (!cur) { res.status(404).json({ error: "草稿還沒有產生", code: "no-doc" }); return null; } return cur; };

  /* ---------- 自己上傳主視覺背景 ---------- */
  api.post("/runs/:id/hero-bg", wrap(async (req, res) => {
    if (!(await alive(req, res)) || busy(req, res)) return; const id = req.params.id, b = req.body || {};
    const cur = await pageOf(req, res); if (!cur) return; const pg = cur.draft.page || {};
    const rr = await withBgDir(store, id, (runDir) => heroBgOwn.uploadOwnSlot({ runDir, runId: id, layoutId: pg.kvVariant, slot: b.slot, mime: b.mime, buf: Buffer.from(String(b.dataBase64 || ""), "base64"), name: b.name,
      answers: b.answers || {}, uploadedBy: req.user.email, existing: pg.heroBgOwn || null, mobileMaxKB: heroBgOwn.mobileMaxKB(MANIFEST) }));
    if (!rr.ok) { await store.appendLog(id, `上傳背景（${String(b.slot)}）被擋：${rr.error}`); return res.status(rr.code || 400).json({ error: rr.error }); }
    await store.appendLog(id, `上傳背景 ${rr.slot} ${rr.w}×${rr.h}${rr.complete ? "（三張齊）" : `（還缺 ${rr.missing.join("、")}）`}：${req.user.email}`);
    res.json({ ok: true, heroBgOwn: rr.heroBgOwn, complete: rr.complete, missing: rr.missing, note: rr.note });
  }));
  api.delete("/runs/:id/hero-bg", wrap(async (req, res) => {
    if (!(await alive(req, res)) || busy(req, res)) return; const id = req.params.id;
    const n = await withBgDir(store, id, (runDir) => heroBgOwn.removeOwnBg(runDir));
    await store.appendLog(id, `移除上傳的背景圖檔 ${n} 個：${req.user.email}`);
    res.json({ ok: true, removed: n });
  }));
  api.get("/runs/:id/hero-bg/:file", wrap(async (req, res) => {
    if (!heroBgOwn.isOwnFileName(req.params.file)) return res.status(404).json({ error: "not found" });
    const r = await store.backend.get(bgKey(req.params.id, req.params.file)); if (!r) return res.status(404).json({ error: "not found" });
    res.set("Content-Type", heroBgOwn.EXT_MIME[path.extname(req.params.file).slice(1).toLowerCase()] || "application/octet-stream").set("Cache-Control", "no-store").send(Buffer.from(r.text, "base64"));
  }));
  /* 版權確認：新伺服器已經知道登入的人是誰，所以比的是「重輸的帳號」對不對得上登入身分；記錄用登入身分 */
  api.post("/runs/:id/hero-bg-confirm", wrap(async (req, res) => {
    if (!(await alive(req, res)) || busy(req, res)) return; const id = req.params.id, b = req.body || {};
    const cur = await pageOf(req, res); if (!cur) return; const pg = cur.draft.page || {};
    if (!heroBgLic.isOwnBg(pg)) return res.status(400).json({ error: "這檔沒有選用你上傳的背景——不需要版權確認" });
    const own = pg.heroBgOwn || {}, miss = heroBgLic.ownMissingSlots(own) || [];
    if (miss.length) return res.status(409).json({ error: `三張圖還沒齊（缺 ${miss.join("、")}）——補齊再確認` });
    if (!own.sha256) return res.status(409).json({ error: "這組圖沒有指紋紀錄，請重新上傳一次再確認。" });
    if (b.checked !== true) return res.status(409).json({ error: "先勾上面的版權確認，就能開始製作" });
    const acct = String(b.account || "").trim(), local = (e) => String(e).toLowerCase().replace(/@.*$/, "");
    if (!acct) return res.status(409).json({ error: "請再輸入一次公司帳號——系統會記錄帳號、時間與這張圖的檔案指紋" });
    if (local(acct) !== local(req.user.email)) return res.status(409).json({ error: `帳號跟你現在登入的身分不符（登入＝${req.user.email}）——版權確認要由本人做` });
    const rec = { by: req.user.email, at: deps.clock.iso(), sha256: own.sha256, source: "cms" };
    await store.patchMeta(id, { heroBgLicenseConfirm: rec });
    await store.appendLog(id, `背景版權確認：${rec.by} 確認圖組 ${String(own.sha256).slice(0, 12)}…`);
    res.json({ ok: true, confirm: rec, message: heroBgLic.CONFIRM_DONE_MSG });
  }));
  api.get("/runs/:id/hero-kit", wrap(async (req, res) => {
    const m = await alive(req, res); if (!m) return; const cur = await pageOf(req, res); if (!cur) return; const pg = cur.draft.page || {};
    let rec = null; try { rec = layoutLib.loadLayoutDeps().registries.layoutRecords.get(pg.kvVariant) || null; } catch (e) { /* 讀不到登記簿＝當成沒選版式 */ }
    if (!rec) return res.status(400).json({ error: "這檔活動還沒有選新版式——先在組合面板選一款版面，說明才知道要給哪組尺寸" });
    const mode = String(req.query.mode || "");
    let kit; try { kit = heroBgKit.buildHeroBgKit({ layoutId: pg.kvVariant, layoutName: rec.name, skeleton: rec.skeleton, pageName: pg.pageName || req.params.id, heroTitleHidden: pg.heroTitleHidden === true, mode: /^(bg|text)$/.test(mode) ? mode : undefined,
      theme: (m.input || {}).theme || (m.input || {}).scenario || "", themeId: pg.themeId || "", hero: pg.hero || {}, maxKB: heroBgOwn.mobileMaxKB(MANIFEST) }); }
    catch (e) { return res.status(500).json({ error: errText(e) }); }
    res.set("Content-Type", "text/markdown; charset=utf-8").set("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(kit.fileName)}`).set("Cache-Control", "no-store").send(kit.markdown);
  }));

  /* ---------- Excel 帶入內文模組 ---------- */
  api.get("/runs/:id/import-template", wrap(async (req, res) => {
    if (!(await alive(req, res))) return;
    let reg; try { reg = contentModules.loadContentRegistry(); } catch (e) { return res.status(500).json({ error: "範本暫時做不出來（模組登記簿讀取問題）：" + errText(e) }); }
    const buf = Buffer.from(await sheetImport.buildTemplate(reg));
    res.set("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet").set("Cache-Control", "no-store")
      .set("Content-Disposition", `attachment; filename="content-modules-template.xlsx"; filename*=UTF-8''${encodeURIComponent(`活動內容範本-${req.params.id}.xlsx`)}`).send(buf);
  }));
  const importRoute = (apply) => wrap(async (req, res) => {
    if (!(await alive(req, res)) || busy(req, res)) return; const id = req.params.id, b = req.body || {};
    if (!b.fileBase64) return res.status(400).json({ error: "沒有收到檔案——請重新選一次 .xlsx" });
    if (/\.xlsm$/i.test(String(b.name || ""))) return res.status(400).json({ error: "含巨集的 .xlsm 不收——請另存成 .xlsx 再上傳" });
    let reg; try { reg = contentModules.loadContentRegistry(); } catch (e) { return res.status(500).json({ error: "帶入暫時無法運作（模組登記簿讀取問題）：" + errText(e) }); }
    const buf = Buffer.from(String(b.fileBase64).replace(/^data:[^,]*,/, ""), "base64");
    let parsed; try { parsed = await sheetImport.parseWorkbook(buf, reg); }
    catch (e) { return res.status(400).json({ error: "這個檔讀不出來——請確認是用範本存出的 .xlsx（Google Sheets 走「檔案 → 下載 → Microsoft Excel」）。（技術：" + errText(e) + "）" }); }
    if (!apply) return res.json({ ok: true, report: parsed.report, willImport: Object.keys(parsed.modules) });
    const rep = parsed.report;
    if (!rep.sheets.length) return res.status(400).json({ error: "檔裡沒有任何一個模組分頁（活動資訊卡／主打選品／促銷卡）——請用「下載 Excel 範本」的檔來填", report: rep });
    if (rep.legacy) return res.status(400).json({ error: rep.legacy.message, report: rep });
    if (rep.problemsTotal) return res.status(400).json({ error: `檔裡有 ${rep.problemsTotal} 格要先改好才能帶入——對帳清單有寫是哪幾格`, report: rep });
    if (!Object.keys(parsed.modules).length) return res.status(400).json({ error: "檔裡沒有可帶入的內容（三個分頁都只有範例）", report: rep });
    const cur = await pageOf(req, res); if (!cur) return;
    const refs = sheetImport.collectRefs(parsed), fetched = new Map(), snap = await store.getJson(id, "snapshot.json");
    if (refs.length && !snap) return res.status(409).json({ error: "這個活動缺少來源商品資料，沒辦法帶入新商品——請重新建立這個活動，或先把商品欄留空只帶文字" });
    if (refs.length && !deps.productFetch) return res.status(501).json({ error: "這台伺服器沒有接商品頁讀取，商品欄帶不進來——請先把商品欄留空只帶文字", code: "not-migrated" });
    for (const ref of refs) { // 商品資料只認伺服器自己讀到的
      const r = await deps.productFetch({ url: ref.input });
      if (r.code !== 200) return res.status(r.code).json({ error: `「${ref.where}」的商品「${ref.input}」讀不到：${r.error}——這次整份都沒有帶入`, report: rep });
      fetched.set(ref.input, r.product);
    }
    if (fetched.size) { let touched = 0;
      for (const p of fetched.values()) { const up = upsertPoolEntry(snap.data, p, "R3:sheet-import"); if (up.mode === "add" || up.changed.length) { touched++; snap.data.warnings = (snap.data.warnings || []).concat(`R3 入池（Excel 帶入）：gdid ${p.gdid}「${p.name}」（${deps.clock.iso()}）`); } }
      if (touched) { await store.putJson(id, "snapshot.json", snap.data, { ifMatch: snap.etag }); await store.appendLog(id, `Excel 帶入：${touched} 件商品登記進來源`); } }
    for (const p of fetched.values()) contentModules.alignDraftRowTruth(cur.draft.products, p);
    let r; try { r = sheetImport.applyImport(cur.draft, parsed, reg, fetched); }
    catch (e) { await store.appendLog(id, "Excel 帶入失敗：" + errText(e)); return res.status(400).json({ error: errText(e), report: rep }); }
    const saved = await store.saveDraft(id, cur.draft, { ifMatch: cur.etag, source: "system", actor: req.user.email, note: `Excel 帶入：${r.summary}` });
    try { const safe = String(b.name || "upload.xlsx").replace(/[^\w.\-一-鿿]+/g, "_").slice(0, 80); await store.backend.put(`${id}/imports/${deps.clock.iso().replace(/[:.]/g, "-")}-${safe}.b64`, buf.toString("base64")); }
    catch (e) { await store.appendLog(id, "Excel 帶入：原檔留存失敗（不影響帶入）" + errText(e)); }
    await store.appendLog(id, `Excel 帶入：${r.summary}（${req.user.email}）`);
    res.json({ ok: true, changed: r.changed, draft: cur.draft, backup: saved.versionId ? `draft.v${saved.versionId}.json` : "上一版", report: rep, summary: r.summary, notes: r.notes, approvalInvalidated: saved.approvalInvalidated, ...(await ver(id)) });
  });
  api.post("/runs/:id/import-preview", importRoute(false));
  api.post("/runs/:id/import-apply", importRoute(true));
}
module.exports = { mountUploads, withBgDir, bgKey };
