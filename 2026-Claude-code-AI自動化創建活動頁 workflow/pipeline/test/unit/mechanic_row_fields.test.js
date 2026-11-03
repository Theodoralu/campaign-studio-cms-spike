"use strict";
/**
 * 活動資訊卡「版面→會畫出來的列欄位」單一來源對帳（2026-09-09 使用者裁：CMS 只顯示對應欄位、換版面清不重疊資料）。
 * 真源＝lib INFO_ROW_FIELDS_BY_VARIANT；引擎四個列模板是實際畫面——兩邊不一致＝面板顯示的欄位跟預覽對不起來（正是使用者抓到的病）。
 * ①lib 表 vs 引擎源檔逐款解析（真源可達才驗）②rules.json 鏡像＝lib ③cms-hints 的 gift／cta 顯示旗標＝lib 推導。
 */
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const CM = require("../../lib/content_modules.js");
const PIPE = path.join(__dirname, "..", "..");

const ENGINE = path.join(PIPE, "..", "..", "2026-AI自動化活動頁生成規劃", "MVP_Phase1_LeCreuset_活動頁Prototype_FrameTest.html");

function engineRowFields(src) {
  const start = src.indexOf("const row = (r, i) => {"); const end = src.indexOf("\n  };", start);
  assert.ok(start > 0 && end > start, "引擎找不到 renderCmMechanic 的 row 模板");
  const body = src.slice(start, end);
  const out = {};
  const lines = body.split("\n").filter((l) => /return `/.test(l));
  const order = ["info-offer-rows", "info-gift-rows", "info-gift-gallery"]; // 第四個 return（無 if）＝ info-gift-rush
  lines.forEach((l, idx) => {
    const m = /v === "([^"]+)"/.exec(l); const vid = m ? m[1] : "info-gift-rush";
    if (m) assert.strictEqual(vid, order[idx], "引擎模板順序變了，更新本測試的對照");
    const keys = new Set();
    for (const mm of l.matchAll(/T\(r, i, "(\w+)"/g)) keys.add(mm[1]);
    if (/lab\(r, i\)/.test(l)) keys.add("label");
    if (/num\(r, i\)/.test(l)) { keys.add("thresholdText"); keys.add("rewardText"); }
    if (/gimgs\(r, i, (\d)/.test(l)) keys.add("rewardImgs");
    if (/btn\(r, i\)/.test(l)) { keys.add("ctaText"); keys.add("ctaUrl"); }
    if (/rowWrap\(r, i/.test(l)) keys.add("ctaUrl"); // 整列入口（2026-09-26）：有連結就把整列包成 <a>，只用 ctaUrl、沒有鈕文字
    const cap = /gimgs\(r, i, (\d)/.exec(l);
    out[vid] = { fields: [...keys].sort(), imgs: cap ? Number(cap[1]) : 0 };
  });
  return out;
}

test("lib 版面→欄位表 vs 引擎列模板：四款逐欄相等；贈品圖張數相等", (t) => {
  if (!fs.existsSync(ENGINE)) { t.skip("引擎源檔不在這台機器（同事包情境）"); return; }
  const eng = engineRowFields(fs.readFileSync(ENGINE, "utf8"));
  for (const [vid, want] of Object.entries(CM.INFO_ROW_FIELDS_BY_VARIANT)) {
    assert.ok(eng[vid], `引擎沒有版面 ${vid} 的模板`);
    assert.deepStrictEqual(eng[vid].fields, [...want].sort(), `${vid}：lib 表與引擎模板欄位不一致`);
    assert.strictEqual(eng[vid].imgs, CM.INFO_REWARD_IMGS_BY_VARIANT[vid], `${vid}：贈品圖張數不一致`);
  }
  assert.deepStrictEqual(Object.keys(eng).sort(), Object.keys(CM.INFO_ROW_FIELDS_BY_VARIANT).sort());
});

test("rules.json 鏡像＝lib（CMS 面板讀這裡）", () => {
  const rules = JSON.parse(fs.readFileSync(path.join(PIPE, "rules.json"), "utf8"));
  assert.deepStrictEqual(rules.contentModules.mechanicRowFields, CM.INFO_ROW_FIELDS_BY_VARIANT, "rules.json 過期——node export_rules.js");
  assert.deepStrictEqual(rules.contentModules.mechanicRows, CM.INFO_ROWS_BY_VARIANT);
  assert.deepStrictEqual(rules.contentModules.mechanicRewardImgs, CM.INFO_REWARD_IMGS_BY_VARIANT);
});

test("cms-hints 版面旗標 gift／cta＝由 lib 表推導（顯示層不另立名單）", () => {
  const h = JSON.parse(fs.readFileSync(path.join(PIPE, "workbench", "public", "cms-hints.json"), "utf8"));
  for (const [vid, v] of Object.entries(h.variants.mechanic)) {
    const f = CM.INFO_ROW_FIELDS_BY_VARIANT[vid];
    assert.strictEqual(!!v.gift, f.includes("rewardImgs"), `${vid} gift 旗標與 lib 不一致`);
    assert.strictEqual(!!v.cta, f.includes("ctaUrl"), `${vid} cta 旗標與 lib 不一致`);
  }
});
