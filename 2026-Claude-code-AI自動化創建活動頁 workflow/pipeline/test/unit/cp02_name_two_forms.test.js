"use strict";
/**
 * cp02_name_two_forms.test.js —— 名稱兩式死鎖根治絆線（2026-10-05；與 10-04 網址兩式同形）
 *
 * 病例＝gdid 11943448：來源清單欄位寫「L OCCITANE」（空格）、商品頁寫「L'OCCITANE」（撇號）——
 * 兩個都是實抓真值。池被任何實抓刷成頁面寫法後，草稿留著清單寫法＝CP-02 名稱字面比對永久紅；
 * 「重建來源紀錄」原本只寫池那半邊＝按幾次都一樣（修復鈕修一半）。
 * 裁定＝名稱沿 price_truth 先例「快照與草稿同批改」：一有商品頁實抓，兩邊一起收斂。
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const cm = require("../../lib/content_modules.js");

const SERVER = fs.readFileSync(path.join(__dirname, "..", "..", "workbench", "server.js"), "utf8");
const INDEX = fs.readFileSync(path.join(__dirname, "..", "..", "workbench", "public", "index.html"), "utf8");
const LIB = fs.readFileSync(path.join(__dirname, "..", "..", "lib", "content_modules.js"), "utf8");

test("①對齊判定：清單寫法 vs 頁面寫法＝同步 name 並回報；已一致＝不動；不在草稿＝不動", () => {
  const products = [{ gdid: "11943448", name: "L OCCITANE 歐舒丹 黑曜薰衣草體香露 50ml（百貨公司貨）" }];
  const pageTruth = { gdid: "11943448", name: "L'OCCITANE 歐舒丹 黑曜薰衣草體香露 50ml（百貨公司貨）", url: "https://tw.buy.yahoo.com/gdsale/p-11943448.html" };
  assert.deepEqual(cm.alignDraftRowTruth(products, pageTruth), ["name"]);
  assert.equal(products[0].name, pageTruth.name, "草稿列要收斂成頁面真值");
  assert.deepEqual(cm.alignDraftRowTruth(products, pageTruth), [], "已一致＝第二次不動（冪等）");
  assert.deepEqual(cm.alignDraftRowTruth(products, { gdid: "999", name: "別件" }), [], "不在草稿＝不動");
  assert.deepEqual(cm.alignDraftRowTruth(products, { gdid: "11943448" }), [], "實抓缺 name＝不動（不拿空值蓋真值）");
});

test("②重建來源紀錄＝兩邊都對齊：端點有草稿收斂＋備份鏈＋核可失效＋回報 draftAligned", () => {
  const i = SERVER.indexOf('seg[3] === "pool-rebuild"');
  assert.ok(i > 0, "找不到 pool-rebuild 端點");
  const seg = SERVER.slice(i, i + 3600);
  assert.match(seg, /alignDraftRowTruth\(djR\.products, rf\.product\)/, "要對齊草稿那半邊（原本只寫池＝修復鈕修一半）");
  assert.match(seg, /copyFileSync\([\s\S]{0,120}draft\.v\$\{vR\}\.json/, "草稿收斂前要落版備份（可還原）");
  assert.match(seg, /alignedR\.length \? invalidateApproval/, "草稿變了＝核可要失效");
  assert.match(seg, /draftAligned: alignedR/, "回報 draftAligned＝前端才能同步本地列");
});

test("③另外三條入池路都接了對齊（編輯精選挑品／Excel 帶入／lib 寫入口＝pick 共用）", () => {
  assert.match(SERVER, /upsertPoolEntry\(snap, np, "R3:editorial-manual"\);\n\s*\{ const aE = contentModules\.alignDraftRowTruth\(dj\.products, np\)/, "編輯精選挑品");
  assert.match(SERVER, /const aI = contentModules\.alignDraftRowTruth\(djI\.products, pI\)/, "Excel 帶入");
  assert.match(LIB, /const aligned = change && change\.product \? alignDraftRowTruth\(dj\.products, change\.product\) : \[\];/, "lib 寫入口（牆/樓層/選品 pick 共用）");
  assert.match(LIB, /if \(!r\.changed && aligned\.length\) r\.changed = true;/, "只有名稱收斂也要落盤＝不然修了白修");
});

test("④前端跟上：rebuildPool 以 draftAligned 同步本地列再宣告磁碟一致", () => {
  assert.match(INDEX, /r\.draftAligned && r\.draftAligned\.includes\("name"\)/, "前端要讀 draftAligned");
  assert.match(INDEX, /pRow\.name = r\.product\.name; renderEditor\(\);/, "本地列名稱跟上＋重繪");
});
