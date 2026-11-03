#!/usr/bin/env node
/* motion_perf_scan.selftest.js —— 首屏重量閘閘體自我測試（2026-09-04 立）
 *
 * 白話：這道閘的價值是「新背景過線就擋」。閘體若被改壞或放寬（門檻悄悄變大、基線名單偷加新 id、
 *       比對邏輯退化成永遠 ✅），畫面上仍一片綠——跟沒有閘一模一樣。這支逼它每次被動到時證明「壞掉真的會紅」。
 * 打法：spawn 真的掃描 CLI，餵假登記簿（env MOTION_PERF_MANIFEST）與假 FrameTest（MOTION_PERF_FRAMETEST），
 *       假檔含真實體積的臨時圖檔（fs 寫入指定 KB），驗 exit code 與原話。不碰任何真檔。
 * 用法：node tools/motion_perf_scan.selftest.js
 */
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const CLI = path.join(__dirname, "motion_perf_scan.js");
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "motion-perf-selftest-"));

function fakeFile(name, kb) { const p = path.join(TMP, name); fs.writeFileSync(p, Buffer.alloc(kb * 1024, 0)); return p; }
function manifest(name, assets, gate) {
  const p = path.join(TMP, `manifest-${name}.json`);
  fs.writeFileSync(p, JSON.stringify({ meta: { weightGate: { maxKB: 400, legacyIds: [], ...(gate || {}) } }, assets }, null, 1));
  return p;
}
function frametest(name, css) { const p = path.join(TMP, `ft-${name}.html`); fs.writeFileSync(p, `<style>${css}</style>`); return p; }
function run(mf, ft, extra = []) {
  const r = spawnSync("node", [CLI, ...extra], { encoding: "utf8", env: { ...process.env, MOTION_PERF_MANIFEST: mf, MOTION_PERF_FRAMETEST: ft || frametest("empty", "") } });
  return { code: r.status, out: `${r.stdout || ""}${r.stderr || ""}` };
}

const heavy = fakeFile("heavy.png", 1200), light = fakeFile("light.png", 120), heavy375 = fakeFile("heavy-375.png", 700), light375 = fakeFile("light-375.png", 200), tiny = fakeFile("tile.png", 1);

const CASES = [
  { name: "新背景主圖 1200KB、沒手機版、不在基線＝🔴 擋",
    mf: () => manifest("new-heavy", [{ id: "bg-900", file: heavy, license: "B" }]), wantRed: true, wantText: "🔴 bg-900" },
  { name: "同一張在存量基線＝🟡 不擋（列帳）",
    mf: () => manifest("legacy", [{ id: "bg-900", file: heavy, license: "B" }], { legacyIds: ["bg-900"] }), wantRed: false, wantText: "🟡 bg-900" },
  { name: "基線裡那張補了手機版且過線＝自動 ✅（不必撤名單）",
    mf: () => manifest("legacy-fixed", [{ id: "bg-900", file: heavy, deviceFiles: { "375": light375, "768": light375, "1440": heavy }, license: "B" }], { legacyIds: ["bg-900"] }), wantRed: false, wantText: "✅ bg-900" },
  { name: "有手機版但手機版 700KB 仍超線、不在基線＝🔴（量的是手機那張）",
    mf: () => manifest("dev-heavy", [{ id: "bg-901", file: heavy, deviceFiles: { "375": heavy375, "768": heavy375, "1440": heavy }, license: "A" }]), wantRed: true, wantText: "把 375 版壓到線下" },
  { name: "主圖 120KB 沒手機版＝✅（線量的是實際下載重量，不是有沒有小圖）",
    mf: () => manifest("light", [{ id: "bg-902", file: light, license: "B" }]), wantRed: false, wantText: "✅ bg-902" },
  { name: "登記簿指的檔在磁碟不存在＝🔴（簿與盤不符）",
    mf: () => manifest("missing", [{ id: "bg-903", file: path.join(TMP, "nope.png"), license: "B" }]), wantRed: true, wantText: "簿與盤不符" },
  { name: "退場（retiredFromPool）與無檔（純色）不量＝⏸",
    mf: () => manifest("skip", [{ id: "bg-904", file: heavy, retiredFromPool: true }, { id: "bg-905", file: null, license: "A" }]), wantRed: false, wantText: "不量 2 張" },
  { name: "四方連續磚 1KB 不報可疑（seamless 例外）",
    mf: () => manifest("tile", [{ id: "bg-906", file: tiny, bgClass: "seamless", license: "B" }]), wantRed: false, wantText: "✅ bg-906" },
  { name: "門檻改在登記簿 meta 一處即生效（maxKB=2000 時 1200KB 過）",
    mf: () => manifest("gate-2000", [{ id: "bg-907", file: heavy, license: "B" }], { maxKB: 2000 }), wantRed: false, wantText: "✅ bg-907" },
  { name: "CSS 動到 layout 屬性＝🟡 列出、不擋",
    mf: () => manifest("css", []), ft: () => frametest("layout", ".dot{transition:width .3s,background .3s}"), wantRed: false, wantText: "動到 width" },
];

let failed = 0;
console.log(`▶ 首屏重量閘閘體自我測試（${CASES.length} 案；假檔住 ${TMP}）\n`);
for (const c of CASES) {
  const { code, out } = run(c.mf(), c.ft ? c.ft() : null);
  const okRed = (code !== 0) === c.wantRed, okText = out.includes(c.wantText);
  if (okRed && okText) console.log(`  ✅ ${c.name}`);
  else { failed++; console.log(`  ❌ ${c.name}`); if (!okRed) console.log(`       期望 ${c.wantRed ? "紅(exit≠0)" : "放行(exit 0)"}，實得 exit=${code}`); if (!okText) console.log(`       缺關鍵字「${c.wantText}」；原話＝${out.trim().split("\n").slice(0, 3).join(" ⏎ ")}`); }
}
fs.rmSync(TMP, { recursive: true, force: true });
if (failed) { console.log(`\n🔴 ${failed}/${CASES.length} 案未過——首屏重量閘的閘體壞了或被放寬。壞掉的閘跟沒有閘一樣，先修好再 commit。`); process.exit(1); }
console.log(`\n✅ ${CASES.length}/${CASES.length} 全過——首屏重量閘該紅會紅、該綠會綠。`);
