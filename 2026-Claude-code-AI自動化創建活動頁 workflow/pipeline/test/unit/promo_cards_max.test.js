"use strict";
/**
 * 促銷卡張數上限單一來源對帳（2026-09-09 使用者裁 4→20）。
 * 同一個數字原本躲在五道門：lib 常數、server 槽位正則（另抄一份 card-[1-4]）、CMS 面板文案寫死 4、引擎 loader slice(0,4)、契約／登記簿／字典文字。
 * 現在：lib PROMO_CARDS_MAX 是真源 → server 用 lib 的正則、CMS 讀 rules.json、引擎留一個鏡像常數——這支測試把鏡像與文案殘留一起看住。
 */
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const CM = require("../../lib/content_modules.js");
const PIPE = path.join(__dirname, "..", "..");

test("lib 真源＝20；pick 槽位正則跟著上限走（card-20 合法、card-21／card-0 不合法）", () => {
  assert.strictEqual(CM.PROMO_CARDS_MAX, 20);
  assert.ok(CM.PROMO_CARD_PICK_SLOT_RE.test("card-1") && CM.PROMO_CARD_PICK_SLOT_RE.test("card-20"));
  assert.ok(!CM.PROMO_CARD_PICK_SLOT_RE.test("card-21") && !CM.PROMO_CARD_PICK_SLOT_RE.test("card-0") && !CM.PROMO_CARD_PICK_SLOT_RE.test("card-"));
});

test("rules.json 帶 contentModules.promoCardsMax＝lib（CMS 面板讀這裡，不另寫死）", () => {
  const rules = JSON.parse(fs.readFileSync(path.join(PIPE, "rules.json"), "utf8"));
  assert.strictEqual(rules.contentModules && rules.contentModules.promoCardsMax, CM.PROMO_CARDS_MAX, "rules.json 過期——node export_rules.js");
});

test("server 不再自抄槽位正則；CMS 面板不再寫死 4 張文案", () => {
  const server = fs.readFileSync(path.join(PIPE, "workbench", "server.js"), "utf8");
  assert.doesNotMatch(server, /card-\[1-4\]/, "server.js 仍有自抄的 card-[1-4]");
  const wb = fs.readFileSync(path.join(PIPE, "workbench", "public", "index.html"), "utf8");
  assert.doesNotMatch(wb, /已放滿 4 張|最多 4 張|放 2 或 4 張|放 1~4 張/, "CMS 面板仍有寫死 4 張的文案");
  assert.match(wb, /function promoCardsMax\(\)/);
});

test("引擎鏡像 CMPC_MAX＝lib（真源可達才驗；同事包沒有規劃 repo＝跳過）", (t) => {
  const src = path.join(PIPE, "..", "..", "2026-AI自動化活動頁生成規劃", "MVP_Phase1_LeCreuset_活動頁Prototype_FrameTest.html");
  if (!fs.existsSync(src)) { t.skip("引擎源檔不在這台機器"); return; }
  const m = /const CMPC_MAX = (\d+);/.exec(fs.readFileSync(src, "utf8"));
  assert.ok(m, "引擎找不到 CMPC_MAX 鏡像常數");
  assert.strictEqual(Number(m[1]), CM.PROMO_CARDS_MAX, "引擎 CMPC_MAX 與 lib PROMO_CARDS_MAX 不一致");
});
