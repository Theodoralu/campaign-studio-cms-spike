"use strict";
/**
 * 活動頁互動提示一致性（2026-09-26 使用者裁）：全頁可點的商品卡 hover 一律蓋一層中性灰遮罩，值只定義一次（--hover-veil）。
 * 起因：資訊卡整列入口的 hover 用了品牌淡紫，跟商品卡（只有上浮）不一致；使用者指定 10% 灰、參考購物中心首頁
 *（實測首頁最常用 rgba(0,0,0,.04)、少數 .12）。做成一個變數＝要對齊改一個數字。
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const ENGINE = path.join(__dirname, "..", "..", "..", "..", "2026-AI自動化活動頁生成規劃", "MVP_Phase1_LeCreuset_活動頁Prototype_FrameTest.html");
const src = fs.existsSync(ENGINE) ? fs.readFileSync(ENGINE, "utf8") : null;

test("①灰度只定義一次：遮罩 10% 與調暗 90% 寫在同一行（html{--hover-veil;--hover-dim}），是中性灰、不是品牌色", (t) => {
  if (!src) { t.skip("引擎源檔不在（同事包情境）"); return; }
  assert.strictEqual((src.match(/--hover-veil:/g) || []).length, 1, "--hover-veil 只能定義一次");
  assert.strictEqual((src.match(/--hover-dim:/g) || []).length, 1, "--hover-dim 只能定義一次");
  assert.strictEqual((src.match(/--hover-veil-text:/g) || []).length, 1, "--hover-veil-text 只能定義一次");
  assert.match(src, /html\{--hover-veil:rgba\(0,0,0,\.10\);--hover-dim:\.9;--hover-veil-text:rgba\(0,0,0,\.04\)\}/, "三個數字綁在一起：卡 10%、調暗 90%、文字 4%（使用者 2026-09-26 裁）");
});

test("②矩形卡蓋遮罩、切角卡整卡調暗；資訊卡整列入口吃同一個變數；品牌淡紫不得殘留", (t) => {
  if (!src) { t.skip("引擎源檔不在"); return; }
  assert.match(src, /\.cmm-rowlink:hover\{background:var\(--hover-veil-text,rgba\(0,0,0,\.04\)\)\}/, "文字列吃 4% 那個變數");
  assert.doesNotMatch(src, /--campaign-brand-tint/, "整列入口不再用品牌淡紫");
  assert.match(src, /\.product-card::after,\.kv-key-product::after,\.cmsp-ecard::after,\.scene-card::after,\.explore-item::after,\.cmm-banner::after\{content:"";position:absolute;inset:0;border-radius:inherit;background:var\(--hover-veil,rgba\(0,0,0,\.10\)\);opacity:0;pointer-events:none/,
    "六種矩形可點卡共用同一條遮罩規則（含情境卡、探索卡、資訊卡 banner＝2026-09-26 補齊）");
  assert.match(src, /\.product-card:hover::after,\.kv-key-product:hover::after,\.cmsp-ecard:hover::after,\.scene-card:hover::after,\.explore-item:hover::after,\.cmm-banner:hover::after\{opacity:1\}/);
  assert.match(src, /\.explore-item\{position:relative\}/, "探索卡原本沒定位，遮罩會跑掉");
  assert.match(src, /\.more:hover\{background:var\(--hover-veil-text,rgba\(0,0,0,\.04\)\);box-shadow:0 0 0 6px var\(--hover-veil-text/, "「看更多」文字連結＝4% 淡底＋同色光暈、不改版面");
  /* 主打選品大卡與促銷卡的框是多層多邊形裁切（三套裝置座標），矩形遮罩會溢出切角（2026-09-26 使用者截圖）——改整卡調暗，
     只有畫了顏色的像素變暗＝天然貼框，不另抄多邊形座標。 */
  assert.match(src, /\.cmsp-card:hover,\.cmpc:hover,\.promo-entry:hover,\.editor-circle:hover,\.cmm-btn:hover\{filter:brightness\(var\(--hover-dim,\.9\)\)\}/, "切角卡、圓卡、搶購鈕用整卡調暗（跟著畫出來的形狀）");
  assert.doesNotMatch(src, /\.cmsp-card::after|\.cmpc::after/, "切角卡不得再蓋矩形遮罩（會溢出框）");
});

test("③遮罩只在有 hover 能力的裝置啟用（手機點一下不會殘留）；遮罩不吃點擊", (t) => {
  if (!src) { t.skip("引擎源檔不在"); return; }
  const i = src.indexOf("@media (hover:hover){"); assert.ok(i > 0, "要包在 @media (hover:hover)");
  const block = src.slice(i, src.indexOf("\n}", i));
  assert.match(block, /\.product-card::after/); assert.match(block, /pointer-events:none/);
});

test("④用 ::after 蓋遮罩的卡都有定位（沒有 position 的卡遮罩會跑到別處）", (t) => {
  if (!src) { t.skip("引擎源檔不在"); return; }
  assert.match(src, /\.product-card\{position:relative\}/); assert.match(src, /\.cmsp-ecard\{position:relative\}/);
  for (const c of ["cmsp-card", "cmpc"]) assert.match(src, new RegExp("\\." + c + "\\{[^}]*position:relative"), c + " 本身要有 position:relative");
  assert.match(src, /\.kv-key-product\{[^}]*position:absolute/, "主視覺資訊卡本來就是 absolute");
});
