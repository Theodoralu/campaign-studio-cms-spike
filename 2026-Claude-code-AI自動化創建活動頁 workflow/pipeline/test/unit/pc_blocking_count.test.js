"use strict";
/* 「要處理幾件」單一口徑絆線（2026-09-16 打包前總檢 C-H1／牆 P-9 甲；鐵律 4「一條規則好幾道門」）
   病例：deployRun／exportZip／exportAem 三處各自把 dead+offline+drift+snapMissing 抄一份，三份都漏了 unverified
   ＝同事機連不上 Yahoo 時商品全「沒能驗價」、閘卻綠燈放行、出貨建檔當天舊價。
   本測試掃原始碼，不起伺服器：①單一函式存在且含 unverified ②舊的手抄算式零殘留 ③前端 pcBad 同口徑 ④白話訊息點名「連不上 Yahoo」。
   之後誰再抄一份新算式漏掉 unverified，這裡就紅。 */
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("fs"), path = require("path");
const PIPE = path.resolve(__dirname, "..", "..");
const SERVER = fs.readFileSync(path.join(PIPE, "workbench", "server.js"), "utf8");
const INDEX = fs.readFileSync(path.join(PIPE, "workbench", "public", "index.html"), "utf8");

test("server：pcBlockingCount 只定義一次、且把 unverified 算進去", () => {
  const defs = SERVER.match(/const pcBlockingCount = \(s, badLinks\) =>[^\n]+/g) || [];
  assert.strictEqual(defs.length, 1, "pcBlockingCount 應恰好一處定義");
  assert.match(defs[0], /s\.unverified/);
  assert.match(defs[0], /s\.dead/); assert.match(defs[0], /s\.offline/); assert.match(defs[0], /s\.drift/); assert.match(defs[0], /s\.snapMissing/);
});

test("server：三條交付路（發佈／匯出／製作 AEM）都改吃 pcBlockingCount，舊手抄算式零殘留", () => {
  const legacy = SERVER.match(/summary\.dead \+ \w+\.summary\.offline \+ \w+\.summary\.drift/g) || [];
  assert.deepStrictEqual(legacy, [], `還有手抄算式：\n${legacy.join("\n")}`);
  const uses = SERVER.match(/= pcBlockingCount\(\w+\.summary, \w+\)/g) || [];
  assert.ok(uses.length >= 3, `pcBlockingCount 呼叫應 ≥3 處（deployRun／exportZip／exportAem），實際 ${uses.length}`);
});

test("server：擋下時的白話訊息會點名「連不上 Yahoo、沒能驗價」與件數，並告訴人怎麼辦", () => {
  assert.match(SERVER, /const pcBlockMessage = \(s, n, verb\) =>/);
  assert.match(SERVER, /連不上 Yahoo、沒能驗價（共 \$\{n\} 項要處理）/);
  assert.match(SERVER, /按「重新檢查」後再/, "指路要用介面上那顆鈕的名字（介面叫「重新檢查」）");
  assert.match(SERVER, /parts\.push\(`連不上 Yahoo、沒能驗價 ×\$\{pc\.summary\.unverified\}`\)/, "deployRun 的逐項清單也要列 unverified");
});

test("前端：pcBad 同口徑含 unverified（介面「N 件要處理」與伺服器擋門一致）", () => {
  const m = INDEX.match(/const pcBad = s \? [^\n]+/);
  assert.ok(m, "找不到 pcBad 定義");
  assert.match(m[0], /s\.unverified/);
});

test("P-8：apply-live-price(-all) 不在編修模式 403 名單（同事遇變價有路可走）", () => {
  const m = SERVER.match(/const EDITOR_BLOCKED_SUBROUTES = new Set\(\[([^\]]*)\]\)/);
  assert.ok(m, "找不到 EDITOR_BLOCKED_SUBROUTES");
  assert.doesNotMatch(m[1], /apply-live-price/);
  for (const must of ["deploy", "publish-public", "sheet-create", "sheet-read", "sheet-status", "sheet-unlink"]) assert.match(m[1], new RegExp(`"${must}"`), `${must} 仍應在名單`);
});
