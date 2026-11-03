#!/usr/bin/env node
/* pack_assert.js —— 同事包（zip）交付前斷言（69 號 Phase 3 開工前置第 1 條；2026-09-16 開工）
   ------------------------------------------------------------------
   白話：打包完先掃一遍 zip 清單——裡面有憑證、有負責人的私人檔、缺版本記號＝紅燈、不准出貨。
   這支是「守門」，只掃 zip 清單（unzip -Z1），不解開＝symlink 或改名都繞不過。

   **這裡驗什麼、不驗什麼（2026-09-21 更正：舊註解兩頭都寫錯，並且是「三道門」誤判的起點）**
   - 這裡驗：VERSION（含 hash 等於打包當下 HEAD）＋**包根五件的「數量」**（install.sh 一支／.command 兩顆／.txt 兩份）。
     只能數數量、不能比檔名：macOS 內建 unzip 列中文檔名會亂碼，拿中文去比會**假紅**（2026-09-16 負向測試抓到）。
   - **檔名對不對**＝由 pack-editor.sh 組裝後體檢負責（比對本機實際路徑，中文可靠）。兩道互補。
   - **執行期依賴**（伺服器起不起來、Node／sharp 在不在、私人檔沒混進去）＝解包冒煙 test/browser/pack-smoke.js。
     ⚠ 冒煙**不看包根有哪些檔**（舊註解說「該帶的有沒有帶齊由冒煙驗」＝不成立）。
   - **已知缺口**：解開之後沒有任何一道門確認包根五件在且非空。補法＝冒煙加一條（規劃 77 號 §7 有登錄）。

   用法：node tools/pack_assert.js <zip> [--expect-hash <短hash>]
   結束碼：0＝可出貨；1＝有問題（逐條白話印出）；2＝用法錯／zip 讀不到
   pack-editor.sh 在產出 zip 後呼叫本支，紅＝刪掉 zip、不留半成品。 */
"use strict";
const { spawnSync } = require("child_process");
const fs = require("fs");

/** 禁止進包的樣式（比對 zip 內完整路徑；`(^|\/)` 讓根層與任意子層都命中） */
const FORBIDDEN = [
  [/(^|\/)\.google-[^/]+$/, "Google 憑證檔（.google-config／.google-token）＝負責人的長期存取權"],
  [/(^|\/)\.wb-pass$/, "工作台密碩檔"],
  [/(^|\/)\.wb-bind$/, "對內網開放旗標"],
  [/(^|\/)\.wb-dev-schedules$/, "開發機排程開關"],
  [/(^|\/)\.wb\.log$/, "工作台日誌（含路徑與錯誤堆疊）"],
  [/(^|\/)fatal\.log$/, "致命錯誤日誌"],
  [/(^|\/)\.git(\/|$)/, ".git 版控資料夾"],
  [/\.plist$/, "launchd 排程檔"],
  [/(^|\/)briefs\/mine\/[^/]+\.md$/, "負責人的個人策略檔（briefs/mine）"],
  [/(^|\/)briefs\/\.trash\//, "策略檔垃圾桶（briefs/.trash）"],
  [/(^|\/)runs\/[^/]+/, "活動檔（runs）"],
  [/(^|\/)\.env(\.|$)/, "環境變數檔"],
  [/(^|\/)\.DS_Store$/, "Finder 中繼檔"],
  [/(^|\/)price_watch\.sh$|(^|\/)price_sync\.js$|(^|\/)overview_sheet\.js$|(^|\/)overview-mail\.gs$/, "已退場的巡檢／總覽表程式（69 號附錄 C）"],
  [/(^|\/)workbench\/(start-online|stop-online|netlify-auth|wb-watchdog|update-entry|deploy-dirty-tree-guard|deploy-ghe-pages)\.sh$|(^|\/)wb-autostart\.command$/, "負責人專用腳本（部署／通道／看門狗）"],
];

/** 唯一在這裡驗的必帶：版本記號（其餘必帶交解包冒煙） */
const VERSION_RE = /(^|\/)pipeline\/workbench\/VERSION$/;

function listZip(zip) {
  const r = spawnSync("unzip", ["-Z1", zip], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (r.error || r.status !== 0) return { error: (r.error && r.error.message) || String(r.stderr || "").trim() || `unzip exit ${r.status}` };
  return { entries: String(r.stdout || "").split("\n").filter(Boolean) };
}

function readVersionFromZip(zip) {
  /* 用純 ASCII 萬用字元抓，不拿 -Z1 列出的名稱回餵——macOS 內建 unzip 對中文路徑「列出來的名字」與「拿去比對的名字」
     編碩不一致，餵回去會找不到→讀成空→hash 誤判紅（2026-09-16 負向測試抓到的） */
  const r = spawnSync("unzip", ["-p", zip, "*pipeline/workbench/VERSION"], { encoding: "utf8" });
  return r.status === 0 ? String(r.stdout || "").split("\n")[0].trim() : ""; // 只看第一行（日期-hash）；後面幾行是 node／sharp／root 版本備註
}

/** 純函式：給清單回問題列表（測試直接呼叫，不碰 zip） */
function assertEntries(entries, opts = {}) {
  const problems = [];
  for (const e of entries) {
    for (const [re, why] of FORBIDDEN) { if (re.test(e)) { problems.push({ kind: "forbidden", entry: e, why }); break; } }
  }
  const versionEntries = entries.filter((e) => VERSION_RE.test(e));
  if (versionEntries.length === 0) problems.push({ kind: "missing", entry: "pipeline/workbench/VERSION", why: "缺版本記號檔——同事回報問題時會不知道他手上是哪一版" });
  /* 包根五件（四件源頭＝tools/pack-root/；第五件「這一版有什麼新的.txt」由打包機從 releases/ 機器轉，
     2026-09-21 使用者裁 Q3(b)）——同事第一次打開靠的就是這幾個。
     用純 ASCII 樣式抓（只認副檔名與 install.sh）：macOS 內建 unzip 列中文檔名可能亂碰，拿中文去比會假紅。 */
  const atRoot = (re) => entries.filter((e) => re.test(e)).length;
  if (atRoot(/^[^\/]+\/install\.sh$/) === 0) problems.push({ kind: "missing", entry: "install.sh", why: "缺第一次安裝腳本——同事雙擊被擋時沒有備援路（乙案）" });
  if (atRoot(/^[^\/]+\/[^\/]*\.command$/) < 2) problems.push({ kind: "missing", entry: "*.command", why: "包根要有「安裝」與「啟動」兩顆 .command——同事靠雙擊開工具" });
  if (atRoot(/^[^\/]+\/[^\/]*\.txt$/) < 2) problems.push({ kind: "missing", entry: "*.txt", why: "包根要有「先看我」與「這一版有什麼新的」兩份 txt——一份講怎麼開始，一份講這一版值不值得換" });
  if (opts.expectHash && opts.versionText !== undefined) {
    const ok = new RegExp(`(^|[-\\s])${opts.expectHash}$`).test(opts.versionText.trim());
    if (!ok) problems.push({ kind: "version", entry: "pipeline/workbench/VERSION", why: `版本記號「${opts.versionText.trim() || "（空）"}」不等於打包當下的 ${opts.expectHash}——不是從釘死的版本打的` });
  }
  return { problems, versionEntry: versionEntries[0] || null };
}

function main(argv) {
  const zip = argv[0];
  if (!zip) { console.error("用法：node tools/pack_assert.js <zip> [--expect-hash <短hash>]"); return 2; }
  if (!fs.existsSync(zip)) { console.error(`找不到 zip：${zip}`); return 2; }
  const hi = argv.indexOf("--expect-hash"); const expectHash = hi >= 0 ? argv[hi + 1] : null;
  const L = listZip(zip);
  if (L.error) { console.error(`讀不到 zip 清單：${L.error}`); return 2; }
  let versionText;
  const pre = assertEntries(L.entries);
  if (expectHash && pre.versionEntry) versionText = readVersionFromZip(zip);
  const { problems } = assertEntries(L.entries, { expectHash, versionText });
  if (problems.length === 0) { console.log(`✓ 包可出貨：${L.entries.length} 個項目，沒有憑證、沒有私人檔、有版本記號${expectHash ? `（${expectHash}）` : ""}`); return 0; }
  console.error(`✗ 這個包不能出貨——${problems.length} 個問題：`);
  for (const p of problems) console.error(`  ・${p.entry}\n    → ${p.why}`);
  console.error("處理：修正 pack-editor.sh 的排除清單或從乾淨的版本重打，不要手動從 zip 裡刪檔。");
  return 1;
}

if (require.main === module) process.exit(main(process.argv.slice(2)));
module.exports = { FORBIDDEN, VERSION_RE, assertEntries, listZip };
