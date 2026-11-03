"use strict";
/**
 * AEM 頁面編輯上限的尺（lib/aem_export.js measureAemBudget；2026-09-17）
 * 白話：AEM 頁面編輯器吃的是「網址編碼後的字數」，不是檔案大小。中文一字 9、標籤符號一字 3、安全英數一字 1。
 * 這把尺 2026-09-17 起只量不擋（現行單檔版必超標）；硬閘等靜態化匯出器上線。
 */
const { test } = require("node:test");
const assert = require("node:assert");
const A = require("../../lib/aem_export");

test("上限常數＝131072（工程師瘦身工具 2026-09-17 截圖；改動要有新證據）", () => {
  assert.strictEqual(A.AEM_ENCODED_CAP, 131072);
});

test("measureAemBudget：中文一字 9、標籤符號一字 3、安全英數一字 1", () => {
  assert.strictEqual(A.measureAemBudget("中").encoded, 9);
  assert.strictEqual(A.measureAemBudget("<").encoded, 3);
  assert.strictEqual(A.measureAemBudget("a1-_.").encoded, 5);
  assert.strictEqual(A.measureAemBudget('<p class="x">中文</p>').encoded, encodeURIComponent('<p class="x">中文</p>').length);
});

test("measureAemBudget：fits／remaining／ratio 一致；剛好等於上限算過、多一字算超", () => {
  const ok = A.measureAemBudget("a".repeat(131072));
  assert.strictEqual(ok.fits, true); assert.strictEqual(ok.remaining, 0); assert.strictEqual(ok.ratio, 1);
  const over = A.measureAemBudget("a".repeat(131073));
  assert.strictEqual(over.fits, false); assert.strictEqual(over.remaining, -1);
  const big = A.measureAemBudget("中".repeat(100000)); // 900,000＝6.87 倍
  assert.strictEqual(big.encoded, 900000); assert.strictEqual(big.ratio, 6.87); assert.strictEqual(big.fits, false);
});

test("measureAemBudget：bytes 記原始大小，兩者不同（尺量的不是 bytes）", () => {
  const r = A.measureAemBudget("中文");
  assert.strictEqual(r.bytes, 6); assert.strictEqual(r.encoded, 18);
});
