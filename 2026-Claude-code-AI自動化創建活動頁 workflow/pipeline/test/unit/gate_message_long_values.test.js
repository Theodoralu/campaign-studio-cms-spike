"use strict";
/**
 * 檢查訊息「指名道姓」在長值時不得失效（2026-10-08 使用者走查病例）。
 *
 * 病例：使用者走查 run 2026-08-30-wb-195025，畫面顯示兜底句「有一格文字太長、版面放不下」，
 * 看不出是「主視覺商品標題」還是「商品特色標題」。gate 原訊息其實寫得很清楚，
 * 是 UI 白話層那條正則把引號裡的值限成 30 字 ⇒ 69 字的商品名配不到 ⇒ 退回兜底句。
 *
 * 不只是偶爾失效——**算得出來是 100% 失效**：CP-03 預算 760px@16px＝47.5em，
 * 而 30 個全形字最多 30em，所以「30 字以內」永遠不可能超標 ⇒ 能觸發這條檢查的訊息，
 * 其引號內容必定 > 30 字 ⇒ 那條指名道姓從上線起一次都沒成功過。
 *
 * 根因族＝同一條規則兩邊各寫一份、沒有東西綁住（卡 20260831-one-rule-many-doors）：
 * gate.js 決定送出前截多長，UI 自己另外猜一個上限，兩個數字沒有任何機制保持一致。
 * 本測試直接**從 index.html 把正則抽出來跑**（不抄一份），所以上限若被改回去就會紅。
 */
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const UI_PATH = path.join(__dirname, "../../workbench/public/index.html");
const ui = fs.readFileSync(UI_PATH, "utf8");

/** 從原始碼抓 `const <名> = msg.match(/.../);` 裡那顆正則，編成真的 RegExp */
function regexFromSource(varName) {
  const m = ui.match(new RegExp(`const ${varName} = msg\\.match\\((/.*?/)\\);`));
  assert.ok(m, `在 index.html 找不到 ${varName} 的 msg.match(...)——句型改了就同批改這支測試`);
  const lit = m[1];
  const close = lit.lastIndexOf("/");
  return new RegExp(lit.slice(1, close), lit.slice(close + 1));
}

/* gate.js 真實句型（值代入實際病例） */
const HERO_NAME =
  "【Pro Kamping 領航家】4.1kW 高功率大火力防風卡式瓦斯爐 X4100II 附軍綠質感硬盒(坦克風格卡式爐 戰術風戶外爐具)";
const CP03_MSG = `[9685014] 主視覺商品標題「${HERO_NAME}」太長（兩行放不下）——請縮短`;

test("病例原字：69 字商品名——CP-03 要抽得出「主視覺商品標題」，不得退回兜底句", () => {
  assert.ok(HERO_NAME.length > 30, "病例前提：名字要比舊上限長，否則這條測試測不到東西");
  const m3 = CP03_MSG.match(regexFromSource("m3"));
  assert.ok(m3, "抽不到＝畫面會顯示兜底句「有一格文字太長」，使用者得自己猜是哪一欄");
  assert.equal(m3[1], "主視覺商品標題");
  assert.equal(m3[2], HERO_NAME, "要收完整值；截短是顯示層的事，不是比對層的事");
});

test("CP-03 的引號擷取不得再設長度上限（設了就必定 100% 失效）", () => {
  const src = regexFromSource("m3").source;
  assert.ok(!/\.\{1,\d+\}/.test(src), `CP-03 擷取又出現長度上限：${src}——預算 47.5em，上限 N 字 ⇒ N 字以內根本超不了標 ⇒ 永遠配不到`);
});

test("CP-26：gate 送出前截到 60 字，UI 這邊不能收得比它短", () => {
  const gate = fs.readFileSync(path.join(__dirname, "../../gate.js"), "utf8");
  assert.match(gate, /CP-26.*slice\(0, 60\)/s, "gate 的 CP-26 截短長度改了＝本測試的 60 要同批改");
  const value = "滿 $-- 折 $--　滿 $-- 送 $--　滿 $-- 折 $--　滿 $-- 送 $--".slice(0, 60);
  assert.ok(value.length > 40, "病例前提：要比舊上限 40 長");
  const m26 = `page.floors[1].title「${value}」含示意佔位（滿 $-- 折 $-- 型）——佔位永不出貨`.match(regexFromSource("m26"));
  assert.ok(m26, "抽不到＝41~60 字的佔位字會退回「（「滿 $-- 折 $--」這種）」泛稱，使用者不知道是哪一欄");
  assert.equal(m26[1], value);
});

test("截短發生在顯示層：cutQ 20 字＋…，短值原樣不動", () => {
  assert.match(ui, /const cutQ = \(s\) => \(String\(s\)\.length > 20 \? String\(s\)\.slice\(0, 20\) \+ "…" : String\(s\)\);/, "cutQ 不在了或長度改了");
  const cutQ = (s) => (String(s).length > 20 ? String(s).slice(0, 20) + "…" : String(s));
  assert.equal(cutQ(HERO_NAME), HERO_NAME.slice(0, 20) + "…");
  assert.equal(cutQ("薄型卡式爐"), "薄型卡式爐");
  assert.ok(ui.includes("${cutQ(m3[2])}") && ui.includes("${cutQ(m26[1])}"), "兩個分支都要走顯示層截短");
});
