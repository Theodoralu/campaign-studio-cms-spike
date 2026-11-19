#!/usr/bin/env node
"use strict";
/**
 * cms/server.js —— 啟動 CMS 伺服器（D12）
 *
 * 本機：CS_RUNS_DIR=<活動資料夾> CS_DEV_USER=approver@dev.local node cms/server.js      → http://localhost:8790
 * 設定全走環境變數：
 *   PORT（預設 8790）｜CS_STORE=fs|s3（見 core/store）｜CS_AUTH=dev|okta｜CS_DEV_USER｜CS_APPROVERS_FILE（預設 config/approvers.json）｜CS_SECRETS=env|asm
 * 啟動時就把設定驗完（資料後端、登入方式、審核者名單）；有一項不對＝直接結束並講清楚缺什麼，不要帶病上線。
 */
const path = require("path");
const { createApp } = require("./app");
const { authFromEnv } = require("./auth");
const { loadApprovers } = require("./approvers");
const { storeFromEnv } = require("../core/store");

/** 真的對外相依：uther、探圖片、Chrome 顯示檢查。測試不走這裡（各自傳假的 deps）。 */
function liveDeps() {
  const clock = require("../lib/clock");
  const { createUtherClient } = require("../core/uther/client");
  const { fetchBrandId } = require("../fetch_uther");
  const imgProbe = require("../workbench/img_probe");
  const exp = require("../core/export");
  const { chromeVerify } = require("./pipeline");
  return { clock, uther: createUtherClient({ log: () => {} }), fetchBrandId, pickCircleImg: (imgs) => imgProbe.pickCircleImg(imgs), verifyHtml: chromeVerify(), assetRoots: exp.defaultAssetRoots(), publisher: null };
}
function build(env = process.env) {
  const store = storeFromEnv(env);
  const auth = authFromEnv(env);
  const approvers = loadApprovers(env.CS_APPROVERS_FILE || path.join(__dirname, "..", "config", "approvers.json"));
  return { app: createApp({ store, auth, approvers, deps: liveDeps(), version: env.CS_VERSION || "dev" }), store, auth, approvers };
}
if (require.main === module) {
  let b; try { b = build(); } catch (e) { console.error("✖ CMS 啟動失敗：" + e.message); process.exit(2); }
  const port = Number(process.env.PORT || 8790);
  const srv = b.app.listen(port, () => console.log(`CMS 已啟動：http://localhost:${port}（資料＝${b.store.kind}；登入＝${b.auth.kind}；審核者 ${b.approvers.count} 位）`));
  const stop = () => srv.close(() => process.exit(0)); // 平台送 SIGTERM 時把手上的請求做完再結束
  process.on("SIGTERM", stop); process.on("SIGINT", stop);
}
module.exports = { build };
