#!/usr/bin/env node
/* motion_perf_scan.js —— 首屏重量與動效效能掃描（2026-09-04 立；執行 09-01 工具情報線議題 2 已裁項）
 *
 * 為什麼有這支：活動頁每天對消費者部署、首屏壓一張大背景圖，但**從來沒有任何機器在量那張圖多重**。
 * 2026-09-04 實量：背景登記簿現役 28 張裡，只有 8 張做過手機版小圖；沒做的那些主圖 725～4364KB，
 * 手機用戶一進頁就得為了一張背景下載 1～4MB。背景庫還在長（自帶背景直通車每上傳一張就多一張沒小圖的），
 * 這支的第一價值是**止血**：以後新進來的背景過不了線就擋，債不再增加；第二價值是把存量列成一張補圖工單。
 *
 * 判準（住背景登記簿 meta.weightGate，本檔只讀不寫）：
 *   量的是「手機實際會下載的那張」＝有 deviceFiles["375"] 用它、沒有就吃主圖 file。
 *   ✅ ≤ maxKB｜🔴 > maxKB 且不在 legacyIds＝擋（exit 1）｜🟡 > maxKB 但在 legacyIds＝存量欠帳，不擋
 *   legacyIds 是「存量基線」不是免死金牌：一旦該張補了小圖、實測 ≤ maxKB，自動變 ✅——不必手動從名單移除。
 *   退場（retiredFromPool）與無檔（純色／CSS 背景，file=null）不量。登記簿指的檔在磁碟找不到＝🔴（簿與盤不符）。
 *
 * 第二段（黃燈資訊、不擋）：FrameTest 源頭 CSS 裡 transition／animation 動到 layout 屬性
 *   （width/height/top/left/right/bottom/margin/padding）＝會觸發整頁重排。外來 checklist 列 CRITICAL，
 *   但 2026-09-04 實查 3 處全是 08-26 裁決過的輪播頁點（8px 小點拉長染主色），對本專案不成立，故只列不擋；升紅＝裁決題。
 *
 * 用法：node tools/motion_perf_scan.js [--json] [--bg-only] [--css-only]
 *   env 覆寫（selftest 用，正式跑一律走真檔）：MOTION_PERF_MANIFEST＝背景登記簿路徑；MOTION_PERF_FRAMETEST＝FrameTest 路徑
 * 退出碼：有 🔴＝1；全 ✅／🟡＝0；讀檔失敗＝2
 *
 * 限制誠實列：
 *  - 量的是檔案 KB，不是首屏秒數（LCP）。真要量秒數是另一支（09-01 議題 2 第二步），別把這支當成「速度量過了」。
 *  - 不管圖的像素尺寸與格式（PNG vs WebP／JPG）——那是「怎麼把它壓到線下」的工法，本支只判「有沒有過線」。
 *  - CSS 那段是字面比對，`transition: all` 這類間接動到 layout 的寫法抓不到；抓得到的都是明寫屬性名的。
 */
const fs = require("fs");
const path = require("path");

const PIPE = path.join(__dirname, "..");
const REPO = path.resolve(PIPE, "..", "..");
const MANIFEST = process.env.MOTION_PERF_MANIFEST || path.join(REPO, "design-assets", "backgrounds", "manifest.json");
const FRAMETEST = process.env.MOTION_PERF_FRAMETEST || path.join(REPO, "2026-AI自動化活動頁生成規劃", "MVP_Phase1_LeCreuset_活動頁Prototype_FrameTest.html");

const args = process.argv.slice(2);
const asJson = args.includes("--json");
const bgOnly = args.includes("--bg-only");
const cssOnly = args.includes("--css-only");

const DEFAULT_GATE = { maxKB: 400, legacyIds: [] };

function readJson(p) {
  try { return JSON.parse(fs.readFileSync(p, "utf8")); }
  catch (e) { console.error(`✗ 讀不開 ${p}：${e.message}`); process.exit(2); }
}
function kbOf(rel) {
  if (!rel) return null;
  const abs = path.isAbsolute(rel) ? rel : path.join(REPO, rel);
  try { return Math.round(fs.statSync(abs).size / 1024); } catch { return "missing"; }
}

// ── 第一段：背景重量 ─────────────────────────────────────────────
function scanBackgrounds() {
  const m = readJson(MANIFEST);
  const gate = { ...DEFAULT_GATE, ...((m.meta && m.meta.weightGate) || {}) };
  const legacy = new Set(gate.legacyIds || []);
  const rows = [];
  for (const a of m.assets || []) {
    if (a.retiredFromPool) { rows.push({ id: a.id, status: "skip", why: "退場（retiredFromPool）不量" }); continue; }
    if (!a.file) { rows.push({ id: a.id, status: "skip", why: "無檔（純色／CSS 背景）不量" }); continue; }
    const d375 = a.deviceFiles && a.deviceFiles["375"];
    const src = d375 ? "375" : "主圖";
    const kb = kbOf(d375 || a.file);
    const mainKB = kbOf(a.file);
    const row = { id: a.id, license: a.license || "?", src, kb, mainKB, hasDevice: !!(a.deviceFiles && a.deviceFiles["375"] && a.deviceFiles["768"]), legacy: legacy.has(a.id) };
    if (kb === "missing") {
      row.status = "red"; row.why = `登記簿指的檔在磁碟找不到（${d375 || a.file}）＝簿與盤不符，修簿或補檔`;
    } else if (kb <= gate.maxKB) {
      row.status = "ok"; row.why = `${kb}KB（${src}）≤ ${gate.maxKB}KB`;
      if (kb < 5 && a.bgClass !== "seamless") { row.status = "warn"; row.why = `${kb}KB 小到可疑（${src}）——是佔位檔還是壞檔？（四方連續磚 bgClass=seamless 例外，小是正常）`; }
    } else if (legacy.has(a.id)) {
      row.status = "legacy"; row.why = `${kb}KB（${src}）> ${gate.maxKB}KB｜存量欠帳（基線名單內，不擋）｜補法＝${row.hasDevice ? "把 375 版壓到線下" : "做 375／768 版（deviceFiles 欄）"}`;
    } else {
      row.status = "red"; row.why = `${kb}KB（${src}）> ${gate.maxKB}KB｜手機用戶會為這張背景下載 ${(kb / 1024).toFixed(1)}MB｜補法＝${row.hasDevice ? "把 375 版壓到線下" : "做 375／768 版（deviceFiles 欄）或壓縮主圖"}`;
    }
    rows.push(row);
  }
  return { gate, rows };
}

// ── 第二段：CSS 動 layout 屬性（黃燈資訊）─────────────────────────
const LAYOUT_PROPS = /\b(width|height|top|left|right|bottom|margin(?:-[a-z]+)?|padding(?:-[a-z]+)?)\b/;
function scanCss() {
  let html;
  try { html = fs.readFileSync(FRAMETEST, "utf8"); } catch (e) { return { error: `FrameTest 讀不開：${e.message}`, hits: [] }; }
  const hits = [];
  const lines = html.split("\n");
  lines.forEach((line, i) => {
    const re = /(transition|animation)\s*:\s*([^;{}]*)/g;
    let mm;
    while ((mm = re.exec(line))) {
      const val = mm[2];
      if (LAYOUT_PROPS.test(val)) {
        const props = (val.match(new RegExp(LAYOUT_PROPS.source, "g")) || []).filter((v, k, arr) => arr.indexOf(v) === k);
        const selectorGuess = (line.slice(0, mm.index).match(/([.#][\w-]+(?:\s*[>+~]?\s*[.#\w-]+)*)\s*\{[^{}]*$/) || [])[1] || "";
        hits.push({ line: i + 1, prop: mm[1], animates: props, selector: selectorGuess, raw: val.trim().slice(0, 90) });
      }
    }
  });
  return { hits };
}

// ── 主流程 ───────────────────────────────────────────────────────
const ICON = { ok: "✅", legacy: "🟡", warn: "🟡", red: "🔴", skip: "⏸" };
const out = {};
let anyRed = false;

if (!cssOnly) {
  const bg = scanBackgrounds();
  out.backgrounds = bg;
  const live = bg.rows.filter(r => r.status !== "skip");
  const n = s => live.filter(r => r.status === s).length;
  if (!asJson) {
    console.log(`══ 背景首屏重量（判準：手機實際下載那張 ≤ ${bg.gate.maxKB}KB；存量基線 ${bg.gate.legacyIds.length} 張）══`);
    for (const r of bg.rows) {
      if (r.status === "skip") continue;
      console.log(`  ${ICON[r.status]} ${r.id}  ${String(r.kb).padStart(5)}KB  ${r.src === "375" ? "有手機版" : "吃主圖  "}  ${r.why}`);
    }
    const skipped = bg.rows.filter(r => r.status === "skip");
    if (skipped.length) console.log(`  ⏸ 不量 ${skipped.length} 張：${skipped.map(r => r.id).join("、")}（退場或無檔）`);
    console.log(`  小結：現役 ${live.length} 張｜✅ ${n("ok")}｜🟡 存量欠帳 ${n("legacy")}｜🟡 可疑 ${n("warn")}｜🔴 ${n("red")}`);
  }
  if (n("red")) anyRed = true;
}

if (!bgOnly) {
  const css = scanCss();
  out.css = css;
  if (!asJson) {
    console.log(`\n══ CSS 動到 layout 屬性（黃燈資訊，不擋；外來 checklist 列 CRITICAL、本專案待裁）══`);
    if (css.error) console.log(`  ⚠ ${css.error}`);
    else if (!css.hits.length) console.log("  ✅ 沒有 transition／animation 動到 width/height/top/left/margin/padding");
    else for (const h of css.hits) console.log(`  🟡 第 ${h.line} 行  ${h.selector || "（選擇器不明）"}  ${h.prop}: ${h.raw}  → 動到 ${h.animates.join("/")}`);
  }
}

if (asJson) console.log(JSON.stringify({ anyRed, ...out }, null, 2));
else console.log(anyRed
  ? "\n🔴 有背景過線且不在存量基線——擋。補法寫在該行；補完重跑即綠（基線名單不用改）。"
  : "\n✅ 沒有新增的過線背景（存量欠帳照列、不擋）。");
process.exit(anyRed ? 1 : 0);
