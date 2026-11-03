"use strict";
/**
 * 主視覺商品「顯示名」欄預設留白（2026-09-27 使用者裁；story docs/stories/first-draft-no-red.md 第三個錯）。
 * 病例：編輯器把商品放進主視覺槽時，欄位預設值＝商品全名，第一次存檔就把 60 字寫進 heroName → 檢查器 CP-03「主視覺標題太長」；
 * 使用者什麼都沒改就吃一條紅。CP-03 驗的是「人工填的顯示名」，機器不該替商品改名：留白＝存檔不寫 heroName＝畫面退回顯示商品原名（真值）。
 * 使用者自己貼進來的長名檢查器看不到（欄位空）＝多一行軟提示（同一把尺 emW／pxBudget，不擋）。
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const src = fs.readFileSync(path.join(__dirname, "..", "..", "workbench", "public", "index.html"), "utf8");

test("主視覺顯示名欄：預設留白、placeholder 顯示原名＋「留白＝用商品原名」；不再把全名塞進欄位", () => {
  assert.ok(src.includes('data-path="products.${i}.heroName" value="${esc(p.heroName != null ? p.heroName : "")}"'), "預設值要是空字串，不是 p.name");
  assert.ok(src.includes('placeholder="${esc(p.name || "主視覺標題")}（留白＝用商品原名；可改）"'));
  assert.ok(!src.includes('value="${esc(p.heroName != null ? p.heroName : (p.name || ""))}"'), "舊寫法（全名當預設）不得回滲");
});

test("長名軟提示：只在欄位空且原名放不進兩行時出現、用檢查器同一把尺、不擋", () => {
  assert.ok(src.includes('${p.heroName == null && emW(p.name || "") > pxBudget("heroName", 47.5) ? `<span class="hint bad">原名放不進兩行，請填短一點的主視覺標題</span>` : ""}'));
  assert.match(src, /function pxBudget\(key, fb\)\{ const b = RULES && RULES\.charLimits\.pxBudgets\[key\];/, "尺要讀 rules.json 的 heroName 預算（與 CP-03 同源）");
});
