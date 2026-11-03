/* CMS 介面禁 emoji 絆線（S3 2026-08-26 牆裁決＝emoji 一次全撤批的驗收絆線，防日後回滲）。
   掃描目標＝workbench/public/index.html「全文」——含 CSS content、title 屬性、HTML/JS 註解，一視同仁。
   ⚠ 切換上線時把 TARGET 改成 index.html（index-next 轉正那一批同步改這行）。
   禁字範圍＝emoji 碼位區段（U+1F000–1FAFF／U+2600–27BF／U+2B00–2BFF）＋清點節列過的文字符號
   （勾、叉、警告驚嘆、寫字手、斜箭頭、回捲箭頭、沙漏、實心圓點、三角形、複製框等，逐碼列於 EXTRA）；
   允許清單＝空。替代做法＝SHP 官方圖示 sprite（design-assets/shp-icons/＋REGISTRY.md 對照）或純文字。 */
"use strict";
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const TARGET = path.join(__dirname, "..", "..", "workbench", "public", "index.html"); // 切換上線時改 index.html

const RANGES = [
  [0x1F000, 0x1FAFF], // emoji 主區（含符號與象形、補充區）
  [0x2600, 0x27BF],   // 雜項符號＋裝飾符號（勾/叉/警告/筆/手/齒輪/星芒 等文字符號全在此）
  [0x2B00, 0x2BFF],   // 箭頭與幾何補充（粗下箭頭 等）
];
const EXTRA = new Set([
  0x2197, // 右上斜箭頭（外開連結記號）→ external 圖示
  0x21A9, // 回捲箭頭（還原）→ 純文字
  0x231B, // 沙漏
  0x23F3, // 計時沙漏（進行中）→ 純文字＋灰點
  0x25B6, // 右三角
  0x25C0, // 左三角
  0x25CF, // 實心圓點（狀態燈）→ CSS 色點
  0x29C9, // 雙方框（複製記號）→ copy 圖示
  0xFE0E, // 變體選擇子（文字型）
  0xFE0F, // 變體選擇子（emoji 型）
]);
const isBanned = (cp) => EXTRA.has(cp) || RANGES.some(([a, b]) => cp >= a && cp <= b);

test("CMS 介面檔全文零 emoji（含文字符號；允許清單＝空）", () => {
  const text = fs.readFileSync(TARGET, "utf8");
  const hits = [];
  text.split("\n").forEach((ln, i) => {
    for (const ch of ln) {
      const cp = ch.codePointAt(0);
      if (isBanned(cp)) { hits.push(`第 ${i + 1} 行 U+${cp.toString(16).toUpperCase()}：${ln.trim().slice(0, 70)}`); break; }
    }
  });
  assert.strictEqual(hits.length, 0,
    `介面檔出現禁用符號 ${hits.length} 行——emoji 與清點節文字符號一律改 SHP 圖示（sprite <use>）或純文字：\n` + hits.slice(0, 20).join("\n"));
});

test("SHP 圖示 sprite 存在且不用 display:none 隱藏（display:none 會吞 <use> 圖——2026-08-18 SHP 分享站病例）", () => {
  const text = fs.readFileSync(TARGET, "utf8");
  const m = text.match(/<svg[^>]*style="([^"]*)"[^>]*aria-hidden="true">\s*<symbol/);
  assert.ok(m, "找不到內嵌 sprite（<svg …><symbol …> 集）");
  assert.ok(!/display\s*:\s*none/.test(m[1]), "sprite 容器不得用 display:none（改 width:0;height:0;position:absolute;overflow:hidden）");
  ["i-check", "i-x", "i-alert", "i-swap", "i-trash", "i-pencil", "i-gear", "i-download", "i-export", "i-sparkle",
   "i-external", "i-close", "i-clock", "i-link", "i-archive", "i-dollar", "i-doc", "i-eye", "i-copy", "i-info",
   "i-refresh", "i-add"].forEach((id) => {
    assert.ok(text.includes(`<symbol id="${id}"`), `sprite 缺少圖示 ${id}（22 顆 SHP 官方圖示應全內嵌）`);
  });
});
