#!/usr/bin/env node
/* design_qa.js —— 設計檢查的單一入口（2026-09-22 使用者裁 Q4 甲）
 *
 * 為什麼有這支：DEVELOPMENT.md §6 設計檢查清單第 2 項寫著「行動版對比＝AUTO，由 design_qa.js 負責」，
 * 2026-09-22 實查——**那支程式從來不存在**。而更難看的是同批掃出來的第二件事：
 * 我們其實已經寫了六支設計掃描器（可讀性、裁切、重量、槽位、可選件、換妝），
 * **每一支都零自動呼叫端**——要人記得手動打指令才會跑。而「要人記得」的事，就是不會發生的事。
 *
 * 所以這支**不是新造一支檢查器**，它一行檢查邏輯都沒有。它只做一件事：
 * 把那六支串成一個入口，讓「跑設計檢查」變成一個指令而不是六個。
 * （鐵律 4「同類幾處」：Q4 原本只問了可讀性那一支，動手前全庫搜一遍才發現是一族六支同病。）
 *
 * 用法：
 *   node tools/design_qa.js <runId>              # 全套（需要工作台 server 在跑）
 *   node tools/design_qa.js                      # 只跑不需要活動頁的那幾項
 *   node tools/design_qa.js <runId> --only=contrast,clip
 *   node tools/design_qa.js <runId> --devices=mobile,tablet
 *
 * 退出碼（**刻意不讓「沒跑到」混進「通過」**——§6 項 2 原文點名要補的就是這個 SKIP 黑洞）：
 *   0 ＝ 該跑的都跑了，而且全綠
 *   1 ＝ 有項目不合格
 *   3 ＝ 跑到的都綠，但**有項目根本沒跑**（沒給 runId／server 沒開）＝不是通過，是沒驗
 *   2 ＝ 用法錯誤
 */
"use strict";
const { spawnSync } = require("child_process");
const path = require("path");
const http = require("http");

const ROOT = path.resolve(__dirname, "..");
const args = process.argv.slice(2);
const runId = args.find((a) => !a.startsWith("--")) || null;
const flag = (name, dflt) => { const a = args.find((x) => x.startsWith(`--${name}=`)); return a ? a.split("=").slice(1).join("=") : dflt; };
const devices = flag("devices", "desktop,tablet,mobile");
const base = flag("base", "http://localhost:8787");
const only = (flag("only", "") || "").split(",").map((s) => s.trim()).filter(Boolean);

/* 名冊。needsRun＝要有活動頁才驗得了；needsServer＝要工作台開著；mins＝逾時上限（分鐘）。
   加一支新的設計掃描器＝在這裡補一行，不要再讓它變成第七支孤兒。
   逾時是必要的：2026-09-22 接線時實測 onoff 跑逾 20 分鐘仍未結束，
   一支卡住不該把整個入口一起拖住——逾時＝當作未過並講明是逾時，不靜默跳過。 */
const CHECKS = [
  { id: "weight", needsRun: false, needsServer: false, mins: 3,
    what: "背景圖重量——手機用戶一進頁要下載多大",
    argv: () => ["tools/motion_perf_scan.js"] },
  { id: "slots", needsRun: false, needsServer: false, mins: 8,
    what: "文字槽對照——編修器說有的格子，畫面真的畫得出來",
    argv: () => ["tools/slot_coverage_audit.js"] },
  { id: "onoff", needsRun: false, needsServer: false, mins: 25,
    what: "可選件缺席——某個零件沒填時版面會不會塌（慢，跨全部對板規格檔）",
    argv: () => ["tools/onoff_scan.js"] },
  { id: "contrast", needsRun: true, needsServer: true, mins: 8,
    what: "整頁文字可讀性——每段字對它實際坐的底色夠不夠清楚（§6 項 2 指名的那一項）",
    argv: () => ["tools/contrast_scan.js", runId, `--devices=${devices}`, `--base=${base}`] },
  { id: "clip", needsRun: true, needsServer: true, mins: 8,
    what: "文字被裁切或溢出——跨模組跨裝置一次掃完",
    argv: () => ["tools/clip_scan.js", runId, `--devices=${devices}`] },
];

const ping = (url) => new Promise((res) => {
  const req = http.get(`${url}/ping`, { timeout: 3000 }, (r) => { r.resume(); res(r.statusCode > 0); });
  req.on("error", () => res(false));
  req.on("timeout", () => { req.destroy(); res(false); });
});

(async () => {
  const picked = only.length ? CHECKS.filter((c) => only.includes(c.id)) : CHECKS;
  if (!picked.length) {
    console.error(`✗ --only 過濾後沒有東西可跑。可用：${CHECKS.map((c) => c.id).join(", ")}`);
    process.exit(2);
  }

  const serverUp = picked.some((c) => c.needsServer) ? await ping(base) : true;

  console.log("\n══ 設計檢查（design_qa）══");
  console.log(runId ? `活動頁：${runId}｜裝置：${devices}` : "沒給活動頁編號＝只跑不需要活動頁的那幾項");
  if (picked.some((c) => c.needsServer) && !serverUp) console.log(`⚠ 工作台沒開（${base}）——需要它的項目會列為「沒跑」`);

  const ran = [], skipped = [];
  for (const c of picked) {
    const why = c.needsRun && !runId ? "沒給活動頁編號"
      : c.needsServer && !serverUp ? `工作台沒開（${base}）` : null;
    if (why) { skipped.push({ ...c, why }); continue; }

    console.log(`\n▶ ${c.id}：${c.what}`);
    const t0 = Date.now();
    const r = spawnSync("node", c.argv(), { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    const secs = ((Date.now() - t0) / 1000).toFixed(0);
    const out = `${r.stdout || ""}${r.stderr || ""}`;
    // 工具自己的輸出照印（它們的訊息寫得比我轉述的好），只縮到尾段避免洗版
    const tail = out.trim().split("\n").slice(-12).join("\n");
    if (tail) console.log(tail.replace(/^/gm, "  │ "));
    const code = r.status === null ? 1 : r.status;
    console.log(`  ${code === 0 ? "✅ 過" : "❌ 未過"}（${secs}s，退出碼 ${code}）`);
    ran.push({ ...c, code });
  }

  const failed = ran.filter((c) => c.code !== 0);
  console.log("\n══ 小結 ══");
  console.log(`  跑了 ${ran.length} 項：${ran.map((c) => `${c.code === 0 ? "✅" : "❌"}${c.id}`).join(" ") || "（無）"}`);
  if (skipped.length) {
    console.log(`  🔴 沒跑 ${skipped.length} 項——**這不是通過，是沒驗**：`);
    for (const s of skipped) console.log(`     ・${s.id}（${s.what}）← ${s.why}`);
    console.log(`     補跑：先開工作台，再 node tools/design_qa.js <活動頁編號>`);
  }

  if (failed.length) { console.log(`\n✗ ${failed.length} 項未過——見上。\n`); process.exit(1); }
  if (skipped.length) { console.log(`\n⚠ 跑到的都過了，但有 ${skipped.length} 項沒驗到（退出碼 3＝別當成全綠）。\n`); process.exit(3); }
  console.log("\n✓ 設計檢查全過。\n");
})();
