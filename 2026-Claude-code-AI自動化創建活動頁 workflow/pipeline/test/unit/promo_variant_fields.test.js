"use strict";
/**
 * 本期活動「排版→會畫出來的欄位」對帳（2026-09-09 使用者裁：CMS 只顯示對應欄位、換排版清不重疊並先確認）。
 * 真源＝lib PROMO_VARIANT_FIELDS；引擎 renderPromoEntries（舞台皮區塊）＋labelStack（圓形入口）是實際畫面——不一致＝面板欄位跟預覽對不起來。
 * 解析法＝找引擎源檔的兩段程式文字看它「摸到哪些欄位」：舞台皮必摸 promoSpotSubtitle／promoSpotDiagonal、只取前 3 則、不摸檔期；圓形入口的標籤堆必摸檔期。
 */
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const CM = require("../../lib/content_modules.js");
const PIPE = path.join(__dirname, "..", "..");
const ENGINE = path.join(PIPE, "..", "..", "2026-AI自動化活動頁生成規劃", "MVP_Phase1_LeCreuset_活動頁Prototype_FrameTest.html");

test("lib 表形狀：兩款排版、舞台多副標／斜帶字、圓形多檔期、舞台只放 3 則", () => {
  const F = CM.PROMO_VARIANT_FIELDS;
  assert.deepStrictEqual(Object.keys(F).sort(), ["entry-circles", "spotlight-stage"]);
  assert.ok(F["spotlight-stage"].page.includes("promoSpotSubtitle") && F["spotlight-stage"].page.includes("promoSpotDiagonal"));
  assert.ok(!F["entry-circles"].page.includes("promoSpotSubtitle"));
  assert.ok(F["entry-circles"].entry.includes("dateValue") && !F["spotlight-stage"].entry.includes("dateValue"));
  assert.strictEqual(F["spotlight-stage"].maxEntries, 3);
  assert.strictEqual(F["entry-circles"].maxEntries, null);
});

test("引擎對帳：舞台皮區塊摸副標／斜帶字／前 3 則、不摸檔期；圓形標籤堆摸檔期（真源可達才驗）", (t) => {
  if (!fs.existsSync(ENGINE)) { t.skip("引擎源檔不在這台機器（同事包情境）"); return; }
  const src = fs.readFileSync(ENGINE, "utf8");
  const fnStart = src.indexOf("function renderPromoEntries(){"); assert.ok(fnStart > 0);
  const spotStart = src.indexOf("if (skinSpot) {", fnStart); const spotEnd = src.indexOf("\n    return;\n  }", spotStart);
  assert.ok(spotStart > 0 && spotEnd > spotStart, "引擎找不到舞台皮區塊");
  const spot = src.slice(spotStart, spotEnd);
  const circles = src.slice(spotEnd, src.indexOf("\n}", spotEnd));
  const F = CM.PROMO_VARIANT_FIELDS;
  for (const k of ["promoSpotSubtitle", "promoSpotDiagonal"]) assert.ok(spot.includes(k) === F["spotlight-stage"].page.includes(k), `舞台皮 ${k} 與 lib 表不一致`);
  assert.ok(!/\.date\b|dateValue/.test(spot), "舞台皮不畫檔期＝lib 表 entry 不含 dateValue");
  assert.ok(/slice\(0, 3\)/.test(spot), "舞台皮只取前 3 則＝lib maxEntries 3");
  assert.ok(/e0\.tag|e\.tag/.test(spot) && /e0\.copy|e\.copy/.test(spot) && /e0\.img|e\.img/.test(spot) && /e0\.url|e\.url/.test(spot), "舞台皮摸標籤／文案／圖／連結＝lib entry 欄位");
  assert.ok(/labelStack\(e\)/.test(circles) && !/promoSpot/.test(circles), "圓形入口用標籤堆、不摸舞台文字");
  const lsStart = src.indexOf("function labelStack(e){"); const ls = src.slice(lsStart, src.indexOf("\n}", lsStart));
  assert.ok(/e\.date\b/.test(ls) && /e\.tag/.test(ls) && /e\.copy/.test(ls), "圓形標籤堆＝標籤＋文案＋檔期（lib entry 含 dateValue）");
});

test("rules.json 鏡像＝lib（CMS 面板讀這裡）", () => {
  const rules = JSON.parse(fs.readFileSync(path.join(PIPE, "rules.json"), "utf8"));
  assert.deepStrictEqual(rules.contentModules.promoVariantFields, CM.PROMO_VARIANT_FIELDS, "rules.json 過期——node export_rules.js");
});
