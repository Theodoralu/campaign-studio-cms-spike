/* 五型態名冊（2026-09-15 C 批）：value＝資料鍵（存進 wb_meta／draft，永不改）、title＝卡上的名字（09-15 改口）、legacyTitle＝舊卡名、goal＝卡上小字。
   這是機器端的唯一真源——解析器（策略檔第一行）、組「給 Gemini 的話」、伺服器守門、範本產生器都讀這裡。
   index.html 的 RECIPE_CARDS 是介面那份（inline 無法 require），由 test/unit/scenario_names.test.js 逐字對齊守著。 */
"use strict";
const SCENARIOS = [
  { value: "同品類×跨品牌-優惠銷售", title: "多品牌一起賣，主打省錢", legacyTitle: "同品類×跨品牌．優惠銷售", goal: "一個品類、很多牌子，標題會帶優惠" },
  { value: "單一品牌-優惠/曝光",     title: "只講一個品牌",           legacyTitle: "單一品牌．優惠／曝光",     goal: "整頁跟著這個牌子的顏色與語氣，有優惠就順帶講" },
  { value: "同品類-情境×優惠",       title: "用一個生活場景帶出優惠", legacyTitle: "同品類．情境×優惠",       goal: "例：不鏽鋼安心廚房、開學收納提案" },
  { value: "同品類-新品/熱銷曝光",   title: "秀新品或熱銷，不喊優惠", legacyTitle: "同品類．新品／熱銷曝光",   goal: "這一頁不會出現任何折扣字" },
  { value: "時事主題-情境×選品",     title: "抓一個時事話題選品",     legacyTitle: "時事主題．情境選品",       goal: "例：中秋烤肉；有時效，兩週內下架" },
];
const norm = (s) => String(s || "").replace(/^0\d\s+/, "").replace(/[\s・．.／/×x×\-－—–、，,「」()（）]/g, "").toLowerCase();
/** 任何寫法（value／新卡名／舊卡名／去符號近似）→ 名冊那一筆；認不得＝null */
function resolve(text) {
  const t = String(text || "").trim(); if (!t) return null;
  const exact = SCENARIOS.find((s) => s.value === t || s.title === t || s.legacyTitle === t);
  if (exact) return exact;
  const n = norm(t);
  return SCENARIOS.find((s) => [s.value, s.title, s.legacyTitle].some((x) => norm(x) === n)) || null;
}
const byValue = (v) => SCENARIOS.find((s) => s.value === v) || null;
const titleOf = (v) => { const s = byValue(v); return s ? s.title : (v || "先不指定"); };
module.exports = { SCENARIOS, resolve, byValue, titleOf, norm };
