/**
 * 機械策展 v0（workbench「快速引擎」）—— snapshot.json → draft.json（14 號契約形）
 * 用法：node curate_auto.js <run 資料夾> [--scenario "..."] [--theme "..."] [--pageName "..."]
 *
 * 定位：策展工作台的秒級預覽引擎——**只挑選、不生成**（T1/T2 的機械下界）；
 * AI 文案品質需求走 workbench 的 Claude 引擎（curate_prompt.md）。產物同樣過 gate.js 裁決。
 *
 * 鐵律（03 schema／04 §1）：真值欄（價格/折數/檔期/URL/offer/券面）逐字取自 snapshot；
 * ai-curated 標題一律無數字（避開優惠詞宣稱義務）；標籤 v5 優先序＝①offer 逐字（寬度內）
 * ②特色第一行前綴（原文有序子序列＝合規改寫），超寬裁切存 tagOriginal。
 * 分組單一來源制（U19）：promoEntries 湊不滿 ≥3 則在線活動＝整組省略（loader 維持現值＋警示）。
 */
/* D8（2026-11-13）：本檔改為薄殼。策展本體在 core/curate/rules.js（自此檔 main() 原樣抽出，邏輯零改動），
   CurateEngine 介面在 core/curate/index.js。這裡只剩：CLI 讀檔／寫檔、圓卡圖探測注入、v2 主題橋接的讀寫檔包裝（server 用）。
   規則 3：舊 CLI 當對照用的殼，D16 連同 workbench/ 一起退場。 */
const fs = require("fs");
const path = require("path");
const core = require(path.join(__dirname, "..", "core", "curate"));
const rules = require(path.join(__dirname, "..", "core", "curate", "rules.js"));
const imgProbe = require(path.join(__dirname, "img_probe.js")); // 編輯精選圓 img 解析度守門（2026-08-26 80×80 病例根治；候選鏈單一真源）

const { bridgeThemeForV2, FAMILY_ACCENT, routeHue, HUE_LABEL } = rules;

function bridgeThemeForV2IntoDraft(draftPath, availableThemeIds) {
  let dj;
  try {
    dj = JSON.parse(fs.readFileSync(draftPath, "utf8"));
  } catch (e) {
    throw new Error(`v2 主題橋接失敗（讀取 ${draftPath}）：${e.message}`);
  }
  const r = bridgeThemeForV2(dj, availableThemeIds);
  if (!r.applied) return r;
  try {
    fs.writeFileSync(draftPath, JSON.stringify(dj, null, 1));
  } catch (e) {
    throw new Error(`v2 主題橋接失敗（寫入 ${draftPath}）：${e.message}`);
  }
  return r;
}

async function main() {
  const [runDir, ...rest] = process.argv.slice(2);
  if (!runDir || !fs.existsSync(path.join(runDir, "snapshot.json"))) {
    console.error("用法：node curate_auto.js <run 資料夾（含 snapshot.json）> [--scenario ..] [--theme ..] [--pageName ..]");
    process.exit(1);
  }
  const opt = {};
  for (let i = 0; i < rest.length; i += 2) opt[rest[i].replace("--", "")] = rest[i + 1] || "";
  const snap = JSON.parse(fs.readFileSync(path.join(runDir, "snapshot.json"), "utf8"));
  const input = { ...opt, runId: path.basename(runDir) };
  if (opt.brief) { input.brief = fs.readFileSync(opt.brief, "utf8"); input.briefFile = path.basename(opt.brief); } // 策略檔由殼讀檔、內容傳進 core
  const engine = core.createRulesEngine({ pickCircleImg: (imgs) => imgProbe.pickCircleImg(imgs) });
  const { draft, notes, summary } = await engine.curate(snap, input);
  fs.writeFileSync(path.join(runDir, "draft.json"), JSON.stringify(draft, null, 1));
  console.log(summary);
  notes.forEach((n) => console.log("  提醒：" + n));
}
if (require.main === module) { // require 守門（沿 gate.js 前例）：server/測試取橋接函式時不得誤跑 CLI 主流程
  main().catch((e) => { // async 化後的失敗出口（失敗要出聲）：不留 unhandled rejection 靜默假成功
    console.error(e && e.name === "CurateError" ? e.message : "策展中止（curate_auto 未預期錯誤）：" + ((e && e.message) || e));
    process.exit(e && e.name === "CurateError" && e.code ? e.code : 1);
  });
}
module.exports = { bridgeThemeForV2, bridgeThemeForV2IntoDraft, FAMILY_ACCENT, routeHue, HUE_LABEL };
