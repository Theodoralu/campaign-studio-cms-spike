"use strict";
/**
 * 活動資訊卡「優惠卡三列」「好禮圖列」的每一列也要有活動入口（2026-09-26 使用者實測＋裁「甲」）。
 *
 * 病例：使用者手動建了這兩款，CMS 沒有任何「連結」欄可填；引擎把列畫成純文字。四款版面裡只有
 * 有搶購鈕的兩款把 ctaUrl 列進顯示欄位（2026-09-09「CMS 只顯示會畫的欄位」制），另兩款既不畫、也就不顯示。
 * 欄位字典卻寫著這兩款有「搶購連結」——字典跟程式不一致。
 *
 * 修法（甲）：沿既有 ctaUrl 欄（不新開欄）；有連結＝整列包成一個 <a>（左右兩欄同一檔活動，hover 整列可點）；
 * 沒填＝維持純文字；有鈕那兩款不動。追蹤標記沿搶購鈕同一套。同批把資訊卡連結補進「連結活不活」檢查（欄位清查 F5）。
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const PIPE = path.join(__dirname, "..", "..");
const CM = require(path.join(PIPE, "lib", "content_modules.js"));
const { collectPageLinks } = require(path.join(PIPE, "workbench", "content_checks.js"));
const ENGINE = path.join(PIPE, "..", "..", "2026-AI自動化活動頁生成規劃", "MVP_Phase1_LeCreuset_活動頁Prototype_FrameTest.html");
const DICT = path.join(PIPE, "..", "..", "2026-AI自動化活動頁生成規劃", "tools", "lib", "field-dictionary.mjs");
const ui = fs.readFileSync(path.join(PIPE, "workbench", "public", "index.html"), "utf8");

test("①欄位清單：優惠卡三列／好禮圖列多了連結欄（ctaUrl），但沒有鈕文字（ctaText）；有鈕那兩款不動", () => {
  const F = CM.INFO_ROW_FIELDS_BY_VARIANT;
  for (const v of ["info-offer-rows", "info-gift-gallery"]) {
    assert.ok(F[v].includes("ctaUrl"), v + " 要有連結欄");
    assert.ok(!F[v].includes("ctaText"), v + " 沒有搶購鈕、不該有鈕文字欄");
  }
  for (const v of ["info-gift-rows", "info-gift-rush"]) assert.deepStrictEqual(F[v].filter((k) => /^cta/.test(k)).sort(), ["ctaText", "ctaUrl"], v + " 維持按鈕那一套");
});

test("②引擎：這兩款的列有連結時整列是一個 <a>、帶搶購鈕同一套追蹤標記；沒連結＝純文字 div", (t) => {
  if (!fs.existsSync(ENGINE)) { t.skip("引擎源檔不在這台機器（同事包情境）"); return; }
  const src = fs.readFileSync(ENGINE, "utf8");
  assert.match(src, /const rowWrap = \(r, i, inner\) => r\.ctaUrl \? `<a class="cmm-row cmm-rowlink" data-ga-cta="info_card_rush" data-ga-pos="\$\{i\}" href="\$\{esc\(r\.ctaUrl\)\}" target="_blank" rel="noopener" referrerpolicy="no-referrer">\$\{inner\}<\/a>` : `<div class="cmm-row">\$\{inner\}<\/div>`/,
    "整列入口＝有連結包 <a class=\"cmm-row cmm-rowlink\">，追蹤標記與搶購鈕相同；沒連結退回 div");
  assert.match(src, /if \(v === "info-offer-rows"\) return `\$\{rowWrap\(r, i, `/, "優惠卡三列走整列入口");
  assert.match(src, /if \(v === "info-gift-gallery"\) return `\$\{rowWrap\(r, i, `/, "好禮圖列走整列入口");
  assert.match(src, /if \(v === "info-gift-rows"\) return `<div class="cmm-row">[\s\S]{0,300}?\$\{btn\(r, i\)\}<\/div>`/, "好禮圖列（有鈕）維持按鈕");
});

test("③引擎樣式：整列 hover 只用淡底表示可點；文字不加底線、連結不變色（使用者 2026-09-26 裁：淡底夠了、底線像劃掉）", (t) => {
  if (!fs.existsSync(ENGINE)) { t.skip("引擎源檔不在"); return; }
  const src = fs.readFileSync(ENGINE, "utf8");
  assert.match(src, /\.cmm-rowlink,\.cmm-rowlink:hover,\.cmm-rowlink:hover \*\{text-decoration:none\}/, "任何狀態都不畫底線");
  assert.match(src, /\.cmm-rowlink\{color:inherit;cursor:pointer/);
  assert.match(src, /\.cmm-rowlink:hover\{background:var\(--hover-veil-text,rgba\(0,0,0,\.04\)\)\}/, "hover 用全頁共用的文字列變數 4%（使用者 2026-09-26 裁：10% 太深），不再是品牌淡紫");
  assert.doesNotMatch(src, /\.cmm-rowlink:hover[^{]*\{[^}]*text-decoration:underline/, "hover 不得再有底線");
  assert.match(src, /\.cmm-rowlink:focus-visible\{outline:/, "鍵盤操作也要看得到焦點");
});

test("④CMS 欄位標籤照版面講：沒有鈕的兩款叫「這一列的活動連結」，有鈕的叫「搶購連結」", () => {
  assert.match(ui, /case "ctaUrl": return \[field\(RF\.includes\("ctaText"\) \? "搶購連結（Yahoo購物中心網址）" : "這一列的活動連結（Yahoo購物中心網址；貼上後整列都能點，消費者按這一列就到這檔活動）"/);
});

test("⑤連結活不活的檢查納入資訊卡：每列連結、banner 共用連結或一圖一連結（欄位清查 F5）", () => {
  const page = { mechanic: {
    banner: { img: "", imgs: ["https://img.yec.tw/a.jpg", "", ""], urls: ["", "", ""], titleLine1: "全民運動日", url: "https://tw.buy.yahoo.com/activity/index?actid=1" },
    rows: [
      { label: "熱銷生鮮", offerText: "下單再享95折", ctaUrl: "https://tw.buy.yahoo.com/category/4436714" },
      { label: "海陸管家", offerText: "限時92折", ctaUrl: "" },
      { label: "統一生機", offerText: "滿額899免運", ctaUrl: "https://tw.buy.yahoo.com/activity/index?actid=2" },
    ],
  } };
  const links = collectPageLinks(page);
  const mech = links.filter((l) => l.module === "mechanic");
  assert.deepStrictEqual(mech.map((l) => l.where), ["活動資訊卡 banner", "活動資訊卡 第 1 列", "活動資訊卡 第 3 列"], "沒填連結的第 2 列不報");
  assert.strictEqual(mech[0].img, "https://img.yec.tw/a.jpg", "banner 帶第一張有值的圖");
  // 一圖一連結：有任何一張自己的連結＝逐圖列、不再列共用 url（沿引擎 perImg 規則）
  page.mechanic.banner.urls = ["https://tw.buy.yahoo.com/activity/index?actid=3", "", "https://tw.buy.yahoo.com/activity/index?actid=4"];
  const per = collectPageLinks(page).filter((l) => l.module === "mechanic" && /banner/.test(l.where)).map((l) => l.where);
  assert.deepStrictEqual(per, ["活動資訊卡 banner 圖 1", "活動資訊卡 banner 圖 3"]);
  assert.deepStrictEqual(collectPageLinks({}).filter((l) => l.module === "mechanic"), [], "沒有資訊卡＝不誤殺");
});

test("⑥連結檢查報告：資訊卡那一列有「前往活動資訊卡」的鈕（不然報了沒路走）", () => {
  assert.match(ui, /if \(l\.module === "mechanic"\) return `<button onclick="jumpToSection\('sec-cm-mechanic'\)">→ 前往「活動資訊卡」<\/button>`/);
});

test("⑦欄位字典不再說「只有搶購版面有按鈕」（字典要照程式寫）", (t) => {
  if (!fs.existsSync(DICT)) { t.skip("字典不在"); return; }
  const d = fs.readFileSync(DICT, "utf8");
  assert.doesNotMatch(d, /只有搶購版面有按鈕/);
  assert.match(d, /優惠卡三列、好禮圖列＝整列可點/);
});
