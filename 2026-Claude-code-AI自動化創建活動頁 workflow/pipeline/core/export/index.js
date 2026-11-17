"use strict";
/**
 * core/export/index.js —— 製作 AEM 網頁檔的「組裝」與「說明檔」（D10，2026-11-17）
 *
 * 來源：workbench/server.js exportAem（三關：商品狀態 → 合規全檢 → 組裝＋顯示檢查）。這裡收的是不依賴單機版 run 目錄的兩段計算：
 *   buildAem({ id, draft, meta, assetRoots, runDir, onWarn }) → { fileName, layout, slimHtml, fullHtml, report }
 *       用引擎模板＋草稿組出瘦身版（交付）與未瘦身參照版（只給顯示檢查比對）。不寫檔。
 *   readme({ id, pageName, bytes, budget, hosts, now }) → README.txt 內容
 *   buildLogs(fileName, report) → 組裝完成後要寫進 log 的那幾行（文字逐字沿原碼）
 *   friendlyBuildError(e) → 給使用者看的錯誤句（已知原因原文照給，其餘包成「請再試一次」）
 * 三關的編排、進度狀態（wb_meta.exportAem）、落檔、開 Chrome 跑顯示檢查（aem_verify.js）仍在呼叫端：單機版＝server.js；CMS＝D13 的匯出工作。
 *
 * assetRoots（路徑由呼叫端給，不再從 pipeline 位置往上推）：
 *   frameDir     引擎模板資料夾（index.html、assets/hero-bg/bg-map.js）
 *   projectRoot  design-tokens／design-assets 所在的根
 * defaultAssetRoots(pipeDir)＝這個 repo 目前的擺法，給單機版殼與測試用。
 */
const fs = require("fs");
const path = require("path");
const PIPE = path.join(__dirname, "..", "..");
const aem = require(path.join(PIPE, "lib", "aem_export.js"));
const layoutLib = require(path.join(PIPE, "lib", "layout_choice.js"));

const errText = (e) => String((e && e.message) || e);
const AEM_CAP = 131072;

function defaultAssetRoots(pipeDir = PIPE) {
  const deploySite = path.join(pipeDir, "..", "..", "2026-AI自動化活動頁生成規劃", "deploy-site");
  return { frameDir: path.join(deploySite, "lecreuset-frametest"), projectRoot: path.join(deploySite, "..", "..") };
}

async function buildAem({ id, draft, meta = null, assetRoots, runDir = null, onWarn = null }) {
  const { frameDir, projectRoot } = assetRoots || defaultAssetRoots();
  const template = fs.readFileSync(path.join(frameDir, "index.html"), "utf8");
  const layout = String((draft.page || {}).kvVariant || "").trim();
  let defaultBackground = null;
  try { const rec = layoutLib.loadLayoutDeps().registries.layoutRecords.get(layout); defaultBackground = rec && rec.defaultBackground; }
  catch (e) { if (onWarn) onWarn("AEM 製作：版型預設背景解析失敗（照背景地圖預設表）：" + errText(e)); }
  const deps = aem.loadDeps({ frameDir, projectRoot, defaultBackground });
  const holdOpts = { confirm: (meta || {}).heroBgLicenseConfirm || null }; /* 78 號 §六：出 AEM 的確認真源＝wb_meta.heroBgLicenseConfirm（sha 相符才算） */
  const slim = await aem.assembleAemHtml({ template, draft, deps, mode: "slim", opts: { runDir, holdOpts } });
  const full = await aem.assembleAemHtml({ template, draft, deps, mode: "full", opts: { runDir, holdOpts } });
  return { fileName: `activity-${id}.html`, layout, slimHtml: slim.html, fullHtml: full.html, report: slim.report };
}

function buildLogs(fileName, report) {
  const logs = [`組裝完成：${fileName} ${Math.round(report.bytes / 1024)} KB（模板 ${Math.round(report.steps[0].bytes / 1024)} KB；舞台移除 ${(report.removedStages || []).length} 款、他款版型函式 ${(report.stubbedOtherLayoutFns || []).length} 支空殼、示範資料 ${(report.nulledConsts || []).length} 組置空）` + (report.warnings.length ? `；警告：${report.warnings.join("；")}` : "")];
  if (report.aemBudget) logs.push(`AEM 頁面編輯上限的尺（2026-09-17 起只量不擋）：編碎後 ${report.aemBudget.encoded}／上限 ${report.aemBudget.cap}＝${report.aemBudget.ratio} 倍${report.aemBudget.fits ? "（過）" : "（超標；貼進 AEM 頁面前需瘦身）"}`);
  return logs;
}

const KNOWN_BUILD_ERROR = /版權還在審核|沒有宣告新版型|尚未支援這款版型|這一版還不能製作 AEM 網頁檔|還沒確認版權|版權確認要重做一次|找不到，請重新上傳/;
function friendlyBuildError(e) {
  const t = errText(e);
  return KNOWN_BUILD_ERROR.test(t) ? t : `網頁檔組裝時發生問題，已停止製作——請再試一次；連續失敗請聯絡系統管理員（技術訊息：${String(t).slice(0, 160)}）`;
}

function readme({ id, pageName, bytes, budget, hosts, now }) {
  return `活動頁 AEM 網頁檔
====================
活動名稱：${pageName || id}
活動編號：${id}
檔案：activity-${id}.html（${Math.round(bytes / 1024)} KB，單一檔案、圖片與樣式都在裡面）
AEM 頁面編輯上限對照：本檔網址編碼後 ${budget ? budget.encoded : "—"} 字／上限 ${budget ? budget.cap : AEM_CAP} 字${budget && !budget.fits ? `（超過 ${budget.ratio} 倍；貼進 AEM 頁面編輯器前需經瘦身）` : ""}
製作時間：${now}
檢查：商品狀態＋合規全檢通過；三裝置顯示檢查通過（桌機／平板／手機）

怎麼用
--------
1. 把 activity-${id}.html 上傳到 Adobe Experience Manager 的活動頁位置（整頁 HTML；頁面自帶 Yahoo 購物站頭與頁尾）。
2. 頁面需要能連到這些網域才會完整顯示：${(hosts || []).join("、") || "img.yec.tw（商品圖）、fonts.googleapis.com（字型）"}。
3. 內容是製作當下的快照；商品價格或檔期有變動，回 CMS 改好後重新下載一份再上傳。
4. 活動頁在 AEM 上最多兩週就下架，不做長期維護。
`;
}

module.exports = { buildAem, buildLogs, friendlyBuildError, readme, defaultAssetRoots, AEM_CAP };
