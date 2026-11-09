"use strict";
/**
 * 檔位表三份複本必須相等（2026-09-21 D「契約收緊」第一刀）
 *
 * 白話：字級／行距／字距／標題寬度的「大／標準／小」各差多少，這張表被抄了三份——
 *   ①CMS 真源 lib/theme_draft.js（帶「哪一檔是標準」旗標）
 *   ②色彩策略工具（TYPO_MUL／LEAD_MUL／TRACK_EM）——量滑桿、算檔位用
 *   ③示範頁引擎 hv2TypoMul（S／W／L／K）——真的畫出來用
 * theme_draft.js 自己的註解就寫著「渲染端有一份人肉複本，改這裡要同批改那裡」。
 * 三份今天一致；這條絆線讓「改了一份忘了另兩份」在 commit 時就紅，而不是等設計師發現工具說「大」、頁面畫「標準」。
 * 真正合成一份＝另一批（要動引擎與工具的載入方式）。
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const T = require("../../lib/theme_draft.js");

const ROOT = path.join(__dirname, "..", "..", "..", "..");
const TOOL = fs.readFileSync(path.join(ROOT, "2026-AI自動化活動頁生成規劃", "活動頁色彩策略工具.html"), "utf8");
const ENGINE = fs.readFileSync(path.join(ROOT, "2026-AI自動化活動頁生成規劃", "MVP_Phase1_LeCreuset_活動頁Prototype_FrameTest.html"), "utf8");

/** 把 `{ sm: .85, md: 1, lg: 1.15 }` 這種字面量抓成物件（只認數字，抓不到＝throw 出聲，不讓測試假綠） */
function grabObj(src, varName, where) {
  const m = src.match(new RegExp(`\\b${varName}\\s*=\\s*\\{([^}]*)\\}`));
  assert.ok(m, `${where} 找不到 ${varName} 的表——表被改名或搬走了，這條絆線要跟著改`);
  const out = {};
  for (const kv of m[1].split(",")) { const mm = kv.match(/(\w+)\s*:\s*(-?[\d.]+)/); if (mm) out[mm[1]] = Number(mm[2]); }
  assert.ok(Object.keys(out).length >= 3, `${where} 的 ${varName} 解析出不到三檔：${m[1]}`);
  return out;
}
const byId = (steps, field) => Object.fromEntries(steps.map((s) => [s.id, s[field]]));

test("字級檔位：CMS 表 ＝ 工具 TYPO_MUL ＝ 引擎 S", () => {
  const cms = byId(T.TYPO_SCALE_STEPS, "mul");
  assert.deepStrictEqual(grabObj(TOOL, "TYPO_MUL", "工具"), cms, "工具的字級倍率跟 CMS 真源不一樣");
  assert.deepStrictEqual(grabObj(ENGINE, "S", "引擎"), cms, "引擎的字級倍率跟 CMS 真源不一樣");
});

test("行距檔位：CMS 表 ＝ 工具 LEAD_MUL ＝ 引擎 L", () => {
  const cms = byId(T.TYPO_LEADING_STEPS, "mul");
  assert.deepStrictEqual(grabObj(TOOL, "LEAD_MUL", "工具"), cms);
  assert.deepStrictEqual(grabObj(ENGINE, "L", "引擎"), cms);
});

test("字距檔位（加減制，單位 em）：CMS 表 ＝ 工具 TRACK_EM ＝ 引擎 K", () => {
  const cms = byId(T.TYPO_TRACKING_STEPS, "em");
  assert.deepStrictEqual(grabObj(TOOL, "TRACK_EM", "工具"), cms);
  assert.deepStrictEqual(grabObj(ENGINE, "K", "引擎"), cms);
});

test("標題寬度檔位：CMS 表 ＝ 引擎 W（工具端是固定門檻 92.5／107.5，不抄倍率）", () => {
  const cms = byId(T.TITLE_WIDTH_STEPS, "mul");
  assert.deepStrictEqual(grabObj(ENGINE, "W", "引擎"), cms);
});

test("每張 CMS 表恰有一檔標 default（applyCombo 靠它判「回標準」）", () => {
  for (const [name, steps] of Object.entries({ TYPO_SCALE_STEPS: T.TYPO_SCALE_STEPS, TITLE_WIDTH_STEPS: T.TITLE_WIDTH_STEPS, TYPO_LEADING_STEPS: T.TYPO_LEADING_STEPS, TYPO_TRACKING_STEPS: T.TYPO_TRACKING_STEPS })) {
    assert.strictEqual(steps.filter((s) => s.default).length, 1, `${name} 要有、且只有一檔 default`);
  }
});
