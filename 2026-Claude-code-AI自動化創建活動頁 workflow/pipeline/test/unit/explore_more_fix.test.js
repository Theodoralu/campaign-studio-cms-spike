/* 「看更多」去向的修復路（2026-09-25 使用者裁甲改）
 *
 * 病例：使用者反覆被同一條紅字擋住——「換掉延伸探索卡『看更多⋯』的去向」。
 *   ①那顆按鈕**真的存在也真的可以點**（2026-09-25 使用者在預覽上親眼確認＋實測可點擊），
 *     href 指向查無結果的分類頁 ⇒ 消費者按下去會進空頁。
 *   ②但畫面上唯一能按的「重新生成探索內容」其實是 jumpToEnrich()——只跳去別的面板、不修這個欄位。
 *   ③moreUrl 的產生公式是 `sourceUrl || items[0].url`，來源頁本身查無結果時重生成幾次都指回同一個壞連結。
 *
 * ⚠️ 本批曾一度判定「這條檢查在抓幽靈」而準備關掉它，動手前最後一驗才發現按鈕是真的。
 *    **關掉等於讓壞按鈕悄悄上線給消費者點。** 本檔第 ④ 項就是守這件事不得再發生。
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "..");
const ui = fs.readFileSync(path.join(ROOT, "workbench/public/index.html"), "utf8");
const srv = fs.readFileSync(path.join(ROOT, "workbench/server.js"), "utf8");

test("①「看更多」那一列要有自己的兩條出路，不是跳去別的面板", () => {
  assert.match(ui, /看更多\/\.test\(String\(l\.where[\s\S]{0,400}?exploreMoreFix\(\)[\s\S]{0,300}?exploreMoreManual\(\)/,
    "看更多列要給『改指向在檔活動』與『手動改連結』兩顆鈕");
  assert.match(ui, /async function exploreMoreFix\(\)[\s\S]{0,900}?target: "more"/,
    "自動修復要打後端 target:more，不是前端自己改");
});

test("②自動修復要真的去找在檔活動，不可以盲抄第一張卡", () => {
  assert.match(srv, /target \|\| ""\) === "more"[\s\S]{0,2600}?pickLivePromo/,
    "要用 pickLivePromo 去來源頁找在檔活動（2026-09-25 實測：盲抄第一張卡時，兩者可能都指同一個壞連結＝換個位置的死路）");
  assert.match(srv, /target \|\| ""\) === "more"[\s\S]{0,2600}?classifyLiveness/,
    "要逐一驗活動頁本身在線——不可盲信列表檔期（2026-07-27 實證列表說在檔、頁面已結束）");
});

test("③找不到就明說並引導手動，不得靜默失敗", () => {
  assert.match(srv, /target \|\| ""\) === "more"[\s\S]{0,3000}?needManual: true/,
    "找不到候選要回 needManual，讓介面引導手動改連結");
  assert.match(srv, /來源頁上目前找不到還在檔期、而且頁面上還沒用過的活動/,
    "訊息要說清楚為什麼找不到");
  assert.match(ui, /async function exploreMoreFix[\s\S]{0,900}?refreshChecksAfterDrift\(\)/,
    "修完要自己把清單拉回同步——不叫使用者再去按一次重新檢查（2026-09-24 迴圈教訓）");
});

test("④「看更多」那條檢查不得被關掉——按鈕是真的會渲染的", () => {
  const cc = fs.readFileSync(path.join(ROOT, "workbench/content_checks.js"), "utf8");
  assert.match(cc, /if \(ex\.moreUrl\) push\("explore", "延伸探索 看更多"/,
    "這條檢查必須留著。2026-09-25 使用者在預覽上親眼確認那顆按鈕存在且可點擊，href 指向空頁——關掉它等於讓壞連結悄悄上線給消費者點");
});

test("⑤排除已經用過的目的地——看更多跟卡片指同一個地方沒有意義", () => {
  assert.match(srv, /target \|\| ""\) === "more"[\s\S]{0,2000}?triedM[\s\S]{0,300}?items[\s\S]{0,120}?normalizeLinkUrl/,
    "候選要排除探索卡已用的去向與現在的 moreUrl");
});
