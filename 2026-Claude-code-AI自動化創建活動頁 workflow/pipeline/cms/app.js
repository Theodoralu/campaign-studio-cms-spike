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
const { requireUser, requireApprover } = require("./auth");

function createApp({ store, auth, approvers, version = "dev" }) {
  if (!store || !auth || !approvers) throw new Error("createApp 需要 store、auth、approvers");
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "5mb" }));
  const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
  const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,80}$/;

  app.get("/healthz", (req, res) => res.json({ ok: true, version }));
  app.get("/readyz", wrap(async (req, res) => { try { await store.listRuns(); res.json({ ok: true, store: store.kind }); } catch (e) { res.status(503).json({ ok: false, store: store.kind, error: "資料後端連不上" }); } }));

  const api = express.Router();
  api.use(auth.middleware, requireUser);
  api.param("id", (req, res, next, id) => (ID_RE.test(id) ? next() : res.status(400).json({ error: "活動編號格式不對", code: "bad-id" })));
  api.get("/me", (req, res) => res.json({ ...req.user, isApprover: approvers.isApprover(req.user.email) }));
  api.get("/runs", wrap(async (req, res) => {
    const ids = await store.listRuns();
    const runs = [];
    for (const id of ids) { const m = await store.readMeta(id); if (!m) continue; runs.push({ id, stage: m.stage || null, theme: (m.input && m.input.theme) || "", sourceUrl: (m.input && m.input.url) || "", owner: (m.input && m.input.ownerEmail) || null, createdAt: m.createdAt || null, updatedAt: m.updatedAt || null, approvedAt: m.approvedAt || null, approvedBy: m.approvedBy || null }); }
    res.json({ runs });
  }));
  api.get("/runs/:id", wrap(async (req, res) => {
    const m = await store.readMeta(req.params.id);
    if (!m) return res.status(404).json({ error: "找不到這檔活動", code: "not-found" });
    res.json({ meta: m, approval: await store.approvalState(req.params.id) });
  }));
  api.post("/runs/:id/approve", requireApprover(approvers), wrap(async (req, res) => {
    const id = req.params.id;
    if (!(await store.readMeta(id))) return res.status(404).json({ error: "找不到這檔活動", code: "not-found" });
    const fp = req.body && req.body.fingerprint;
    if (!fp) return res.status(400).json({ error: "核可要帶你檢視的那一版（fingerprint）——請重新整理頁面後再核可", code: "missing-fingerprint" });
    const r = await store.approve(id, { by: req.user.email, expectFingerprint: fp });
    res.json({ ok: true, ...r });
  }));
  app.use("/api", api);

  app.use((req, res) => res.status(404).json({ error: "沒有這個網址", code: "no-route" }));
  // 錯誤出口：RunStore 的 409／404 照它的狀態碼回（409 附最新版的指紋，讓畫面知道要重讀）；其餘一律 500，細節只進伺服器 log 不回給畫面
  app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
    if (err && err.type === "entity.parse.failed") return res.status(400).json({ error: "送來的內容不是合法 JSON", code: "bad-json" });
    if (err && (err.status === 409 || err.status === 404 || err.status === 400) && err.code) return res.status(err.status).json({ error: err.message, code: err.code, ...(err.latest ? { latest: { fingerprint: err.latest.fingerprint, etag: err.latest.etag } } : {}) });
    console.error(`[cms] ${req.method} ${req.path} 失敗：`, err && err.stack ? err.stack : err);
    res.status(500).json({ error: "伺服器發生問題，請再試一次；連續失敗請聯絡系統管理員", code: "internal" });
  });
  return app;
}
module.exports = { createApp };
