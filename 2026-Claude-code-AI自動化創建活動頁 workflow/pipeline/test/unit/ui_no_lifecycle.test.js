/* 「介面不得再長出活動檔期欄，也不得再對使用者講『巡檢』」絆線（2026-09-14 舊管線退場批，69 號附錄 C Q3 甲＋D1／D2／D3 甲）。
   ------------------------------------------------------------------
   拿掉的東西：建立頁與活動小卡的「活動上線日／失效日」兩格、列表「已結束」分頁與「活動時間」欄、
   首頁「本週注意」區、首頁已發佈卡的巡檢一句話、以及所有對使用者說「每日巡檢會…」的句子。
   為什麼要用機器守：這些句子散在 20 幾處，人清一次會漏；而且每日巡檢已經沒有了，畫面上再出現「巡檢」
   就是對使用者說一件不會發生的事（2026-09-14 前的病例＝「今天還沒巡檢」會永遠掛著）。
   守法＝從最外層讀 index.html 字面：①拿掉的 id／函式名不得回來 ②把 JS 區塊註解與 HTML 註解剝掉之後，
   剩下的（＝使用者看得到或程式真的在跑的）不得含「巡檢」二字。 */
"use strict";
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const UI = fs.readFileSync(path.resolve(__dirname, "..", "..", "workbench", "public", "index.html"), "utf8");

test("活動檔期的輸入格、儲存通道、列表欄與首頁區塊都不在了", () => {
  for (const tok of [
    'id="in-active-from"', 'id="in-active-until"',      // 建立頁兩格
    'id="lc-from"', 'id="lc-until"', 'id="ac-lc-save"',   // 活動小卡兩格＋儲存鈕
    "function saveLifecycle", "/lifecycle`",              // 儲存通道（前端函式＋端點路徑）
    "const lcCell", "活動時間</th>",                       // 列表「活動時間」欄
    '["ended", "已結束"]',                                 // 列表「已結束」分頁
    'id="home-week"', "function renderHomeWeek",          // 首頁「本週注意」
    "function patrolHtml", "function loadPatrolSummary", "/api/patrol/summary", // 首頁巡檢一句話
  ]) {
    assert.ok(!UI.includes(tok), `${tok} 回來了——這是 2026-09-14 拿掉的檔期／巡檻介面（69 號附錄 C）`);
  }
});

test("剝掉註解之後，介面不再對使用者講「巡檢」", () => {
  const stripped = UI
    .replace(/<!--[\s\S]*?-->/g, "")   // HTML 註解
    .replace(/\/\*[\s\S]*?\*\//g, ""); // JS 區塊註解（本檔文案註解全是這種形式）
  const hits = stripped.split("\n").map((l, i) => [i + 1, l]).filter(([, l]) => l.includes("巡檢"));
  assert.deepStrictEqual(
    hits.map(([n, l]) => `${n}: ${l.trim().slice(0, 90)}`),
    [],
    "介面有使用者看得到的「巡檢」——每日巡檢 2026-09-14 已退場，畫面不得再講一件不會發生的事；" +
      "商品狀態檢查請叫「檢查」（它只在製作 AEM 網頁檔／發佈預覽時跑）"
  );
});

test("廠商 Google 試算表選單項預設隱藏、依連線狀態顯示（Q1 甲：同事機不出現）", () => {
  assert.ok(/data-mm="vendorsheet" hidden/.test(UI), "vendorsheet 選單項沒有預設 hidden＝同事機會看到一個按了只會叫他授權的項目");
  assert.ok(/function refreshVendorSheetMenu/.test(UI), "缺 refreshVendorSheetMenu＝連線後不會顯示");
  assert.ok(/b\.hidden = !\(st && st\.connected\)/.test(UI), "顯示判定不是看 connected");
});
