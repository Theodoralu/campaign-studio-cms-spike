/**
 * A1 管線入口 —— 兩段式（②策展初稿由 Claude 於對話中產出 draft.json，故拆兩段）
 *
 *   node run.js stage1 <URL> [slug]        → 建 runs/<日期>-<slug>/，抓取＋解析出 snapshot.json
 *   （Claude 讀 snapshot.json → 產 draft.json 放入同資料夾；人工可先改）
 *   node run.js stage2 <run 資料夾>         → 機器閘 gate → 通過與否都寫 xlsx（檢查結果欄如實呈現）
 *
 * 產出物一律落在 runs/ 之下，pipeline 程式本身不可寫死任何商品資料（鐵律）。
 */
const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const HERE = __dirname;
const node = (script, args) =>
  execFileSync(process.execPath, [path.join(HERE, script), ...args], { stdio: "inherit" });

const [mode, ...rest] = process.argv.slice(2);

if (mode === "stage1") {
  const [url, slug = "run"] = rest;
  if (!url) { console.error("用法：node run.js stage1 <URL> [slug]"); process.exit(1); }
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  const runDir = path.join(HERE, "runs", `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${slug}`);
  fs.mkdirSync(runDir, { recursive: true });
  node("fetch_parse.js", [url, runDir]);
  console.log(`\n下一步：Claude 依 03 schema 產出 ${path.join(runDir, "draft.json")} 後，執行 node run.js stage2 "${runDir}"`);
} else if (mode === "stage2") {
  const [runDir] = rest;
  if (!runDir || !fs.existsSync(path.join(runDir, "draft.json"))) {
    console.error("用法：node run.js stage2 <run 資料夾>（需含 snapshot.json ＋ draft.json）"); process.exit(1);
  }
  let gateFailed = false;
  try {
    node("gate.js", [path.join(runDir, "snapshot.json"), path.join(runDir, "draft.json")]);
  } catch { gateFailed = true; }
  node("write_xlsx.js", [runDir]);
  if (gateFailed) { console.error("\n⚠ 機器閘有 FAIL —— 工作簿已產出，異常列見「檢查結果」欄（標紅），修正 draft.json 後重跑 stage2。"); process.exit(1); }
} else {
  console.log("用法：\n  node run.js stage1 <URL> [slug]\n  node run.js stage2 <run 資料夾>");
  process.exit(1);
}
