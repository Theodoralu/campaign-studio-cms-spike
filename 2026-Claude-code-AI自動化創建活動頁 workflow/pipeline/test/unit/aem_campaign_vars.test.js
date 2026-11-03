"use strict";
/**
 * AEM 匯出：設計師配色變數的頁面專屬樣式（2026-09-27 使用者裁「甲」）。
 * 病例（實烤證實）：工程師瘦身工具 bake.py 刪光 <script> 後用寫死清單重組 <body style>，折數三支變數不在清單＝被丟；
 * body 的 cc-discount class 與覆寫規則留著 → var() 沒值 → 折數字繼承深灰、圓章底透明。
 * 這裡守：①槽→變數對應從模板讀、不另抄（引擎改一處自動跟）②只送草稿真的有給的槽③來源優先序同引擎④沒配色＝零波及。
 * 烤過之後顏色對不對＝scratchpad aem_proof.js 對板（真 Chrome＋真 bake.py），本檔不開瀏覽器。
 */
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const A = require("../../lib/aem_export");
const ENGINE = path.join(__dirname, "..", "..", "..", "..", "2026-AI自動化活動頁生成規劃", "MVP_Phase1_LeCreuset_活動頁Prototype_FrameTest.html");

const MINI = `
  set("--campaign-title", hex(cc.title)); if (hex(cc.title)) b.classList.add("cc-title");
  set("--campaign-price-draft", hex(cc.price)); if (hex(cc.price)) b.classList.add("cc-price");
  set("--campaign-discount", hex(cc.discount)); if (hex(cc.discount)) b.classList.add("cc-discount");
  set("--campaign-discount-badge-text", hex(cc.discountBadgeText)); if (hex(cc.discountBadgeText)) b.classList.add("cc-discountbadgetext");`;

test("ccVarMapFromTemplate：從模板 set(\"--campaign-*\", hex(cc.*)) 讀出槽→變數；找不到＝throw", () => {
  const map = A.ccVarMapFromTemplate(MINI);
  assert.deepStrictEqual(map, { title: "--campaign-title", price: "--campaign-price-draft", discount: "--campaign-discount", discountBadgeText: "--campaign-discount-badge-text" });
  assert.throws(() => A.ccVarMapFromTemplate("<html>沒有套色段</html>"), /錨點漂移/);
});

test("真模板：對應表含折數三支、價格、標題（引擎源檔在時才驗）", (t) => {
  if (!fs.existsSync(ENGINE)) { t.skip("引擎源檔不在（同事包情境）"); return; }
  const map = A.ccVarMapFromTemplate(fs.readFileSync(ENGINE, "utf8"));
  assert.strictEqual(map.discount, "--campaign-discount"); assert.strictEqual(map.discountBadge, "--campaign-discount-badge"); assert.strictEqual(map.discountBadgeText, "--campaign-discount-badge-text");
  assert.strictEqual(map.price, "--campaign-price-draft"); assert.strictEqual(map.title, "--campaign-title"); assert.strictEqual(map.cardText, "--campaign-card-text");
});

test("campaignVarsStyle：只送真的有給的槽、壞值略過、沒配色＝空字串、選擇器 body.shell-v2 不會被 bake 修剪名單命中", () => {
  const map = A.ccVarMapFromTemplate(MINI);
  const r = A.campaignVarsStyle({ page: { colors: { source: "pack", themeDraft: { componentColors: { title: "#1C1C1C", discount: "#A80505", discountBadgeText: "FFEE00", price: "不是色碼" } } } } }, map);
  assert.deepStrictEqual(r.keys, ["title", "discount", "discountBadgeText"]);
  assert.strictEqual(r.css, '<style id="campaignVarsV2">body.shell-v2{--campaign-title:#1C1C1C;--campaign-discount:#A80505;--campaign-discount-badge-text:#FFEE00}</style>');
  assert.doesNotMatch(r.css, /layout-0|hv2-|campaign-[a-z0-9]+-[a-z0-9]+\s*[{,]/, "選擇器不得帶版型名或 campaign-xx-yy 主題名（bake.py 的 needle／unused_theme 會刪）");
  assert.deepStrictEqual(A.campaignVarsStyle({ page: {} }, map), { css: "", keys: [] });
  assert.deepStrictEqual(A.campaignVarsStyle({ page: { colors: { themeDraft: {} } } }, map), { css: "", keys: [] });
});

test("campaignVarsStyle：來源優先序同引擎——page.colors.themeDraft ＞ 未偏離的提案包；偏離過的包不吃", () => {
  const map = A.ccVarMapFromTemplate(MINI);
  const pack = { colors: { componentColors: { discount: "#123456" } } };
  assert.deepStrictEqual(A.campaignVarsStyle({ page: {}, meta: { proposalPack: { pack } } }, map).keys, ["discount"]);
  assert.deepStrictEqual(A.campaignVarsStyle({ page: {}, meta: { proposalPack: { pack, deviated: true } } }, map).keys, []);
  const both = A.campaignVarsStyle({ page: { colors: { themeDraft: { componentColors: { title: "#000000" } } } }, meta: { proposalPack: { pack } } }, map);
  assert.deepStrictEqual(both.keys, ["title"], "頁面自己的配色優先，不回頭吃包");
});
