"use strict";
/**
 * cms/frontend.js —— 把單機版的畫面接到新伺服器（D14 第一段）
 *
 * 單機版的畫面是一支 9 千多行的 index.html，直接打 /api/…。這裡做三件事讓它能在新伺服器上開起來：
 *   1. 靜態檔：/（畫面本體）、/public、/frametest（預覽用的活動頁引擎）、/design-assets、/design-proposal-kit、兩個素材資料夾。
 *      靜態檔也要登入才給（整站登入）；只有健康檢查不用。
 *   2. 舊畫面認的回應形狀：/api/version（版本握手＋能力表）、列表的每一列長什麼樣（legacyRow）。
 *   3. 還沒搬的 API：一律回 501「這個功能第一版還沒接上」，並記在伺服器 log 與 /api/_missing——用來盤點畫面實際會打到哪些沒搬的路由。
 *
 * 能力表（caps）回 null＝畫面上標了 data-needs 的功能（AI 策展、Google 試算表…）全部藏起來＝第一版範圍外的入口不露出。
 */
const fs = require("fs");
const path = require("path");
const express = require("express");
const crypto = require("crypto");
const PIPE = path.join(__dirname, "..");
const { summarizeCheck } = require(path.join(PIPE, "run_patrol.js"));

/** 草稿版本的「數字代號」：舊畫面把版本當數字存（原本是檔案時間）。這裡用 etag 算一個穩定的整數給它，存檔時再對回來。 */
const baseNum = (etag) => (etag ? parseInt(crypto.createHash("sha256").update(String(etag)).digest("hex").slice(0, 12), 16) : 0);

function defaultStaticRoots(pipeDir = PIPE) {
  const repo = path.join(pipeDir, "..", ".."), plan = path.join(repo, "2026-AI自動化活動頁生成規劃"), deploy = path.join(plan, "deploy-site");
  return { pub: path.join(pipeDir, "workbench", "public"), frametest: path.join(deploy, "lecreuset-frametest"), heroBg: path.join(plan, "assets", "hero-bg"),
    designAssets: path.join(repo, "design-assets"), layoutThumbs: path.join(repo, "design-assets", "layouts", "thumbs"), proposalKit: path.join(repo, "design-proposal-kit"), cutouts: path.join(deploy, "活動版型去背商品"), pendingBg: path.join(deploy, "活動版型待審背景") };
}

function mountStatic(app, { auth, requireUser, roots = defaultStaticRoots() }) {
  const gate = [auth.middleware, requireUser];
  const st = (dir) => express.static(dir, { index: "index.html", fallthrough: true, dotfiles: "deny", maxAge: 0 });
  app.get("/", gate, (req, res) => res.sendFile(path.join(roots.pub, "index.html")));
  app.use("/public", gate, st(roots.pub));
  app.use("/frametest/assets/hero-bg", gate, st(roots.heroBg)); // 真源優先（單機版同招：剛上傳的待審圖要看得到）
  app.use("/frametest", gate, st(roots.frametest));
  app.use("/design-assets", gate, st(roots.designAssets));
  app.use("/design-proposal-kit", gate, st(roots.proposalKit));
  app.use("/" + encodeURIComponent("活動版型去背商品"), gate, st(roots.cutouts));
  app.use("/" + encodeURIComponent("活動版型待審背景"), gate, st(roots.pendingBg));
}

/** 列表的一列——欄位照單機版 GET /api/runs（畫面的列表、首頁、狀態燈都讀這些） */
async function legacyRow(store, id) {
  const meta = await store.readMeta(id); if (!meta) return null;
  const [d, g, pc] = [await store.getDraft(id), await store.getJson(id, "gate_report.json"), await store.getJson(id, "product_check.json")];
  const pg = d ? d.draft.page || {} : {};
  return { id, stage: meta.stage || (d ? "ready" : "snapshot-only"), engineUsed: meta.engineUsed || meta.engine || "", input: meta.input || null, pageName: pg.pageName || "",
    hasDraft: !!d, hasGate: !!g, error: meta.error || null, approvedAt: meta.approvedAt || null, approvedBy: meta.approvedBy || null, approvedWithFail: meta.approvedWithFail || null,
    liveUrl: null, deploy: null, heroBgLicenseConfirm: meta.heroBgLicenseConfirm || null,
    gate: g ? { pass: g.data.result === "PASS", fail: (g.data.counts && g.data.counts.FAIL) || 0, warn: (g.data.counts && g.data.counts.WARN) || 0 } : null,
    themeHue: (pg.theme && pg.theme.hueFamily) || null, createdAt: meta.createdAt || "", draftSavedAt: meta.draftSavedAt || meta.updatedAt || null,
    prodcheck: pc ? { checkedAt: pc.data.checkedAt || null, ...summarizeCheck(pc.data) } : null,
    publicUrl: null, publicAt: null, publicDeploy: null, exportZip: null, exportAem: meta.exportAem || null, kvVariant: pg.kvVariant || null, priceTruth: meta.priceTruth || null, productCheck: meta.productCheck || null };
}

function mountCompat(api, { version, roots = defaultStaticRoots() }) {
  const boot = new Date().toISOString();
  const layoutLib = require(path.join(PIPE, "lib", "layout_choice.js"));
  const rules = require(path.join(PIPE, "core", "curate", "rules.js"));
  const errText = (e) => String((e && e.message) || e);
  /* 建立表單的三支：版式選單、自動配版面的預告、自動配色的預告（照單機版：業務上配不出來＝200 ok:false 帶白話原因，表單退回手選） */
  api.get("/layout-catalog", (req, res) => { try { res.json(layoutLib.catalogForForm(layoutLib.loadLayoutDeps())); } catch (e) { res.status(500).json({ error: "版式選單載入失敗（登記簿讀取問題）：" + errText(e) }); } });
  api.get("/layout-suggest", (req, res) => {
    try { const deps = layoutLib.loadLayoutDeps(); const s = layoutLib.suggestLayout(String(req.query.scenario || ""), deps, String(req.query.theme || "")); const rec = deps.registries.layoutRecords.get(s.layout);
      res.json({ ok: true, layout: s.layout, name: (rec && rec.name) || s.layout, reason: s.reason, reasonDisplay: s.reasonDisplay, substitutedFrom: s.substitutedFrom, byTheme: s.byTheme || null, engineNote: layoutLib.engineNoteFor ? layoutLib.engineNoteFor(s.layout) : null }); }
    catch (e) { res.json({ ok: false, error: errText(e) }); }
  });
  /* 規則表（字數上限、寬度模型、各版面欄位…）：畫面一載入就讀，編修欄每一格都靠它算；讀不到編修欄整個畫不出來（2026-11-23 實測） */
  api.get("/rules.json", (req, res) => res.sendFile(path.join(PIPE, "rules.json")));
  /* 版式縮圖：缺圖＝404，畫面自己會放佔位圖 */
  api.use("/layout-thumbs", express.static(roots.layoutThumbs, { fallthrough: false, dotfiles: "deny" }), (err, req, res, next) => res.status(404).end()); // eslint-disable-line no-unused-vars
  /* 畫面載入時會要的幾份清單：引導文案照給；策略檔（第二階段）與回收區（還沒搬）回空清單，畫面就不顯示那兩塊 */
  api.get("/flow-guide", (req, res) => { try { res.json({ ok: true, ...JSON.parse(fs.readFileSync(path.join(PIPE, "lib", "flow_guide_copy.json"), "utf8")) }); } catch (e) { res.status(500).json({ error: "引導文案讀不到（技術：" + errText(e) + "）" }); } });
  api.get("/briefs", (req, res) => res.json([]));
  api.get("/runs-deleted", (req, res) => res.json([]));
  /* 主題色把關（建立表單選自訂色時問的）：跟編修面板同一把尺 lib/theme_draft */
  api.get("/theme-check", (req, res) => {
    const T = require(path.join(PIPE, "lib", "theme_draft.js")); const raw = String(req.query.seed || "");
    if (!T.isHex6(raw)) return res.json({ ok: false, format: false, reason: "色碼格式不正確——請用調色盤重新選一次顏色" });
    const seed = T.normHex(raw), assess = T.assessSeedColor(seed), fails = T.checkThemeDraft(T.deriveThemeDraft(seed)).filter((c) => !c.pass && c.blocking !== false);
    res.json({ ok: fails.length === 0, warn: assess.warn || null, fails: fails.map((c) => ({ name: c.name, msg: c.msg, ratio: c.ratio, need: c.need })), seedSuggest: fails.length ? T.suggestSeed(seed) : null });
  });
  api.get("/theme-suggest", (req, res) => {
    try { const theme = String(req.query.theme || "").trim(), scenario = String(req.query.scenario || "").replace(/^0\d\s+/, "").trim(); const hue = rules.routeHue(theme + " " + scenario);
      res.json({ ok: true, hue, hueLabel: rules.HUE_LABEL[hue] || hue, basedOn: theme || scenario || "" }); }
    catch (e) { res.json({ ok: false, error: "配色預告算不出來：" + errText(e) }); }
  });
  api.get("/version", (req, res) => { let html = 0; try { html = fs.statSync(path.join(roots.pub, "index.html")).mtimeMs; } catch (e) { /* 量不到＝0 */ }
    res.json({ boot, html, staleServer: false, mode: "cms", build: version, caps: null, capsDetail: null, capsCheckedAt: null, user: req.user }); });
}

/** 放在所有 /api 路由之後：還沒搬的一律 501，並記下來 */
function mountMissing(api) {
  const missing = new Map(); // "METHOD /path樣式" → 次數
  api.get("/_missing", (req, res) => res.json({ missing: [...missing.entries()].map(([k, n]) => ({ route: k, hits: n })).sort((a, b) => b.hits - a.hits) }));
  api.use((req, res) => {
    const shape = req.path.replace(/\/runs\/[^/]+/, "/runs/:id").replace(/\/versions\/[^/]+/, "/versions/:v");
    const key = `${req.method} ${shape}`; if (!missing.has(key)) console.warn(`[cms] 畫面打到還沒搬的路由：${key}`);
    missing.set(key, (missing.get(key) || 0) + 1);
    res.status(501).json({ error: "這個功能第一版還沒接上", code: "not-migrated", route: key });
  });
}
module.exports = { mountStatic, mountCompat, mountMissing, legacyRow, baseNum, defaultStaticRoots };
