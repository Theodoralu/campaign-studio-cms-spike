"use strict";
/**
 * lib/colortool_env.js —— 色彩策略工具的「環境格」唯一填法（2026-09-21 A「工具不猜環境」）
 *
 * 白話：工具頁開頭有一格設定（引擎在哪、工作台 API 在哪、跟引擎同不同網域），
 * 由「把它發佈出去的那條鏈」在發佈時填——工作台伺服器送檔時填、設計站部署腳本填 bundle 那份。
 * 源頭檔永遠留空（環境中立），所以工具不必再靠猜網址路徑判斷自己住在哪。
 *
 * 病例 2026-09-21：`engineUrl()` 只認美國站的路徑結構（/design-system-site/ → ../activity-share-site/），
 * 搬到台灣（每站各自亂碼主機）後回 null＝線上預覽黑掉、字級檔位全落「標準」；另有兩處寫死 localhost:8787。
 * 四處各猜各的＝搬一次家壞一次。這裡收成一處。
 *
 * 兩個消費端同吃這一支（不重複立法）：
 *   - workbench/server.js `/colortool/` 路由：送檔時 injectEnv(html, {site:"workbench", engineBase:"/frametest/", apiBase:"", engineSameOrigin:true})
 *   - 規劃/tools/deploy-design-system-ghe.sh：cp 進 bundle 後跑本檔 CLI 填設計站的值（engine＝分享站引擎、跨網域、沒有 API）
 */
const fs = require("fs");

const MARK_START = "/*CS_ENV*/";
const MARK_END = "/*CS_ENV_END*/";
const FIELDS = ["site", "engineBase", "apiBase", "engineSameOrigin"];

function defaultEnv() { return { site: null, engineBase: null, apiBase: null, engineSameOrigin: null }; }

/** 把環境格填進 HTML（冪等：再填一次＝覆寫同一格）。找不到格＝throw（失敗要出聲，不靜默送出一份會亂猜的工具） */
function injectEnv(html, env) {
  const s = html.indexOf(MARK_START), e = html.indexOf(MARK_END);
  if (s < 0 || e < 0 || e < s) throw new Error(`工具頁找不到環境格 ${MARK_START}…${MARK_END}——別把這兩個標記刪掉，發佈鏈靠它填「引擎在哪」`);
  const merged = { ...defaultEnv() };
  for (const k of FIELDS) if (env && env[k] !== undefined) merged[k] = env[k];
  const body = `window.CS_ENV = ${JSON.stringify(merged)};`;
  return html.slice(0, s + MARK_START.length) + body + html.slice(e);
}

/** 讀回目前填的值（測試與健檢用） */
function readEnv(html) {
  const s = html.indexOf(MARK_START), e = html.indexOf(MARK_END);
  if (s < 0 || e < 0 || e < s) return null;
  const inner = html.slice(s + MARK_START.length, e);
  const m = inner.match(/window\.CS_ENV\s*=\s*(\{[\s\S]*\});?\s*$/);
  if (!m) return null;
  try { return JSON.parse(m[1]); } catch (err) { return null; }
}

/* CLI：node lib/colortool_env.js --file <html> --site design --engine <url> [--api <base>] [--same-origin yes|no]
   給 zsh 部署腳本用；就地改寫那個檔（要改的是 bundle 複本，不是源頭）。 */
if (require.main === module) {
  const a = process.argv.slice(2);
  const get = (k) => { const i = a.indexOf(k); return i >= 0 ? a[i + 1] : undefined; };
  const file = get("--file");
  if (!file) { console.error("用法：--file <html> --site <name> [--engine <url>] [--api <base>] [--same-origin yes|no]"); process.exit(2); }
  const env = { site: get("--site") || null, engineBase: get("--engine") || null, apiBase: get("--api") === undefined ? null : get("--api") };
  const so = get("--same-origin"); env.engineSameOrigin = so === undefined ? null : so === "yes";
  const html = fs.readFileSync(file, "utf8");
  fs.writeFileSync(file, injectEnv(html, env));
  console.log(`✓ 色彩工具環境格已填：${JSON.stringify(env)} → ${file}`);
}

module.exports = { injectEnv, readEnv, defaultEnv, MARK_START, MARK_END, FIELDS };
