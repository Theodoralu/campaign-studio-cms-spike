"use strict";
/**
 * 主視覺換品三道門・編輯器與伺服器側（2026-09-26 使用者裁「乙」；病例＝run 2026-09-26-wb-150126）。
 * 門①殘值：離開主視覺的商品清掉 heroName（換品與移除兩個出口共用一支）。
 * 門②來源登記：主視覺／layout-004 貼網址換品也走 R3 入池；「沒有來源紀錄」那條直接給「重建來源紀錄」鈕。
 * 門③全頁互斥：主視覺貼網址換品傳整頁已用集合（跟挑選器同口徑）；伺服器 pageExposedGdids 與 lib gdidUsedOnPage 也認新版主視覺槽。
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const PIPE = path.join(__dirname, "..", "..");
const ui = fs.readFileSync(path.join(PIPE, "workbench", "public", "index.html"), "utf8");
const server = fs.readFileSync(path.join(PIPE, "workbench", "server.js"), "utf8");
const CM = require(path.join(PIPE, "lib", "content_modules.js"));

const fnSrc = (name) => { const m = ui.match(new RegExp(`\\nfunction ${name}\\([^)]*\\)\\{[\\s\\S]*?\\n\\}`)); assert.ok(m, name + " 要存在"); return m[0]; };

test("門①｜clearHeroNameIfLeftHero：離開所有主視覺槽才清；還在別的槽＝不清；兩個出口都呼叫它", () => {
  const ctx = { draft: { page: { hero: { "product-left": { gdids: ["111111"] }, "product-right": { gdids: ["222222"] } } }, products: [{ gdid: "111111", heroName: "A" }, { gdid: "333333", heroName: "殘值" }, { gdid: "222222", heroName: "B" }] } };
  vm.createContext(ctx); vm.runInContext(fnSrc("clearHeroNameIfLeftHero") + "\n;globalThis.__c = clearHeroNameIfLeftHero;", ctx);
  ctx.__c("333333"); assert.strictEqual(ctx.draft.products[1].heroName, undefined, "已不在任何槽＝清掉");
  ctx.__c("111111"); assert.strictEqual(ctx.draft.products[0].heroName, "A", "還在槽裡＝不動");
  ctx.__c(""); ctx.__c("999999"); // 空值／不存在的商品＝不拋錯
  const swap = ui.slice(ui.indexOf("async function heroSwapProduct("), ui.indexOf("/* ---------- l004 換商品"));
  assert.match(swap, /clearHeroNameIfLeftHero\(oldG\)/, "換品出口要清出去的那件");
  assert.match(fnSrc("heroRemoveProduct"), /clearHeroNameIfLeftHero\(removedG\)/, "移除出口要清");
  const l4 = ui.slice(ui.indexOf("async function l4SwapProduct("), ui.indexOf("/* ---------- editorial/explore 機械補生成"));
  assert.match(l4, /clearHeroNameIfLeftHero\(oldL4\)/, "layout-004 換品出口要清");
});

test("門②｜R3 入池只有一支共用函式；模組換品兩處、主視覺、layout-004 四個入口都走它", () => {
  assert.strictEqual((ui.match(/runs\/\$\{currentId\}\/r3-add/g) || []).length, 1, "裸 r3-add fetch 只准出現在共用函式裡");
  assert.ok((ui.match(/r3AddToPool\((np|r)\)/g) || []).length >= 4, "至少四個入口呼叫共用函式");
  const swap = ui.slice(ui.indexOf("async function heroSwapProduct("), ui.indexOf("/* ---------- l004 換商品")); assert.match(swap, /r3AddToPool\(r\)/);
  const l4 = ui.slice(ui.indexOf("async function l4SwapProduct("), ui.indexOf("/* ---------- editorial/explore 機械補生成")); assert.match(l4, /r3AddToPool\(r\)/);
});

test("門②｜檢查清單「沒有來源紀錄」那條直接給「重建來源紀錄」鈕（草稿有這件才畫）", () => {
  /* 2026-10-04 放寬（run 211607 死鎖）：原斷言釘「不存在於快照|不在 P2」兩種訊息——實證「連結與來源不符」等
     真值打架家族同病同解卻不給鈕＝死巷。條件放寬後本絆線跟著釘新條文；涵蓋面與出口鈕細節另有
     test/unit/cp02_deadlock_exits.test.js 整組鎖。 */
  assert.match(ui, /const gdM = \/不存在於快照\|不在 P2\|與來源不符\|≠ 來源\|不在來源圖庫\/\.test\(String\(f\.msg \|\| ""\)\) \? String\(f\.msg\)\.match\(\/\\\[\(\\d\{6,\}\)\\\]\/\) : null;/);
  assert.match(ui, /const rebuildBtn = \(gdM && \(draft\.products \|\| \[\]\)\.some\(p => p && String\(p\.gdid\) === gdM\[1\]\)\) \? `<button type="button" class="chk-go" onclick="rebuildPool\('\$\{gdM\[1\]\}'\)">重建來源紀錄<\/button>` : "";/);
  assert.match(ui, /ops: rebuildBtn \+ \(f\.ref && f\.ref\.orphan/, "孤兒條目改給「清出這件」真出口（2026-10-04）；非孤兒照舊「去修 →」");
  assert.match(ui, /: \(f\.ref && !rebuildBtn \? `<button type="button" class="chk-go" data-chk-gf="\$\{idx\}">去修 →<\/button>` : ""\)\)/, "一條一顆 CTA（2026-10-05 使用者裁）：重建鈕在場＝不並排「去修」——名稱/連結是系統帶入欄，跳過去也不能手改");
});

test("門③｜主視覺換品門只對照其他主視覺槽（2026-10-05 裁決：主視覺可與下方重複；槽內仍不重複、不傳空陣列）", () => {
  assert.doesNotMatch(ui, /pageGdids: others/, "同槽口徑要拆掉");
  const swap = ui.slice(ui.indexOf("async function heroSwapProduct("), ui.indexOf("/* ---------- l004 換商品"));
  assert.match(swap, /const pageGdids = \[\.\.\.heroGdidSetFE\(\)\]\.filter\(g => g !== oldG0\);/); assert.match(swap, /pageGdids \}\) \}\)/);
  const l4 = ui.slice(ui.indexOf("async function l4SwapProduct("), ui.indexOf("/* ---------- editorial/explore 機械補生成"));
  assert.match(l4, /pageGdids: \[\.\.\.heroGdidSetFE\(\)\]\.filter\(g => g !== oldL4\)/); assert.doesNotMatch(l4, /pageGdids: \[\]/);
});

test("門③｜伺服器 pageExposedGdids 與 lib gdidUsedOnPage 都認新版主視覺槽（同一條規則四處消費端）", () => {
  const fn = server.slice(server.indexOf("function pageExposedGdids(dj)"), server.indexOf("\n}", server.indexOf("function pageExposedGdids(dj)")));
  assert.match(fn, /Object\.values\(pg\.hero \|\| \{\}\)\.forEach\(\(sv\) => \{ if \(sv && Array\.isArray\(sv\.gdids\)\) sv\.gdids\.forEach\(\(g\) => g && exposed\.add\(String\(g\)\)\); \}\);/);
  assert.strictEqual(CM.gdidUsedOnPage({ hero: { "product-right": { gdids: ["12233552", "12240876"] } }, floors: [] }, [], "12240876"), "主視覺");
  assert.strictEqual(CM.gdidUsedOnPage({ hero: { "product-right": { gdids: ["12233552"] } }, floors: [] }, [], "999999"), null);
  assert.strictEqual(CM.gdidUsedOnPage({ kv: { keyProductGdids: ["1"] } }, [], "1"), "主視覺", "舊 KV 欄照舊");
});
