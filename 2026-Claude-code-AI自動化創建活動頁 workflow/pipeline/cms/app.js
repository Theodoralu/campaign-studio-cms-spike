"use strict";
/**
 * cms/app.js —— CMS 伺服器（D12）：Express＋登入＋審核者權限＋健康檢查
 *
 *   createApp({ store, auth, approvers, version }) → Express app（不 listen；cms/server.js 才 listen，測試直接拿 app）
 *
 * D12 只接四條路由，用來證明「登入 → 身分 → 權限 → RunStore」整條通：
 *   GET  /healthz                 服務活著（不用登入；平台探活用）
 *   GET  /readyz                  資料後端連得上（不用登入）
 *   GET  /api/me                  我是誰、是不是審核者
 *   GET  /api/runs                活動列表
 *   GET  /api/runs/:id            一檔活動的狀態與核可狀態
 *   POST /api/runs/:id/approve    核可（審核者才行）；body { fingerprint }＝核可者畫面上看到的那一版
 * 建立、編修、檢查、製作 HTML 檔的路由是 D13。核可在單機版還會做的事（把草稿狀態改成「待建置」、帶 FAIL 核可的勾選、換版式後強制重驗）
 * 也在 D13 搬；這裡的核可只做「誰可以按」與「核可綁哪一版內容」。
 */
const express = require("express");
const { requireUser } = require("./auth");
const { createJobs } = require("./jobs");
const { mountRuns } = require("./runs");
const FE = require("./frontend");

function createApp({ store, auth, approvers, deps = null, jobs = createJobs(), version = "dev", frontend = false }) {
  if (!store || !auth || !approvers) throw new Error("createApp 需要 store、auth、approvers");
  const app = express();
  app.disable("x-powered-by");
  /* 舊畫面送 JSON 不帶 Content-Type——/api 底下一律當 JSON 解析 */
  app.use("/api", express.json({ limit: "5mb", type: () => true }));
  const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
  const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,80}$/;

  /* 健康檢查：票（ECSEARCH-39055）訂的是 /status.html 與 /readiness；/healthz、/readyz 是 D12 先做的同義網址，兩組都留 */
  const alive = (req, res) => res.json({ ok: true, version });
  app.get("/status.html", alive); app.get("/healthz", alive);
  app.get(["/readiness", "/readyz"], wrap(async (req, res) => { try { await store.listRuns(); res.json({ ok: true, store: store.kind }); } catch (e) { res.status(503).json({ ok: false, store: store.kind, error: "資料後端連不上" }); } }));

  const api = express.Router();
  api.use(auth.middleware, requireUser);
  api.param("id", (req, res, next, id) => (ID_RE.test(id) ? next() : res.status(400).json({ error: "活動編號格式不對", code: "bad-id" })));
  api.get("/me", (req, res) => res.json({ ...req.user, isApprover: approvers.isApprover(req.user.email) }));
  /* 列表：回陣列、每列的欄位照單機版（畫面的列表、首頁、狀態燈都讀這些） */
  api.get("/runs", wrap(async (req, res) => {
    const rows = [];
    for (const id of await store.listRuns()) { const r = await FE.legacyRow(store, id); if (r && !r.deletedAt) rows.push(r); } // 進了垃圾桶的不列
    res.json(rows);
  }));
  api.get("/runs/:id", wrap(async (req, res) => {
    const m = await store.readMeta(req.params.id);
    if (!m) return res.status(404).json({ error: "找不到這檔活動", code: "not-found" });
    res.json({ meta: m, approval: await store.approvalState(req.params.id) });
  }));
  if (deps) mountRuns(api, { store, approvers, jobs, deps, wrap }); // 主流程路由（D13）；沒給 deps＝只有唯讀的列表與狀態
  if (deps) require("./edit_more").mountEditMore(api, { store, jobs, deps, wrap }); // 補選型態、來源紀錄重建、編輯精選、延伸探索（D14 第三段）
  if (deps) require("./lifecycle").mountLifecycle(api, { store, jobs, deps, wrap }); // 刪除、垃圾桶、封存（D14 第三段）
  FE.mountCompat(api, { version });
  FE.mountMissing(api);
  app.use("/api", api);
  if (frontend) FE.mountStatic(app, { auth, requireUser });

  app.use((req, res) => res.status(404).json({ error: "沒有這個網址", code: "no-route" }));
  // 錯誤出口：RunStore 的 409／404 照它的狀態碼回（409 附最新版的指紋，讓畫面知道要重讀）；其餘一律 500，細節只進伺服器 log 不回給畫面
  app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
    if (err && err.type === "entity.parse.failed") return res.status(400).json({ error: "送來的內容不是合法 JSON", code: "bad-json" });
    if (err && (err.status === 409 || err.status === 404 || err.status === 400) && err.code) return res.status(err.status).json({ error: err.message, code: err.code, ...(err.latest ? { latest: { fingerprint: err.latest.fingerprint, etag: err.latest.etag },
      ...(err.code === "stale-draft" ? { draft: err.latest.draft, sysDraftWriteAt: FE.baseNum(err.latest.etag) } : {}) } : {}) }); // draft／sysDraftWriteAt＝舊畫面被擋時拿來換成最新版的欄位
    console.error(`[cms] ${req.method} ${req.path} 失敗：`, err && err.stack ? err.stack : err);
    res.status(500).json({ error: "伺服器發生問題，請再試一次；連續失敗請聯絡系統管理員", code: "internal" });
  });
  app.locals.jobs = jobs;
  return app;
}
module.exports = { createApp };
