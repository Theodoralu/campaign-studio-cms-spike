"use strict";
/**
 * 本期活動人工手動入稿・動態清單資料層測試（2026-08-26 使用者裁決＝入口上限 4→12）。
 *
 * 測的是「真的出貨的那份程式」：從 workbench/public/index.html 原文抽出
 * promoLimits / promoCanAdd / promoCanRemove 三支 guard 函式（面板新增/移除鍵共用的資料層），
 * 用 rules.json（單一來源＝gate.js 抽頂常數重匯）注入跑——不在測試裡重寫一份邏輯。
 *
 * 驗收（任務指定三態）：加到 12＝一路放行、加第 13＝擋、刪到 2（剛好 3 則按刪）＝擋。
 */
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const PIPE = path.join(__dirname, "..", "..");
const INDEX = path.join(PIPE, "workbench", "public", "index.html");
const RULES_JSON = path.join(PIPE, "rules.json");

function loadPanelPromoGuards(rulesObj) {
  const html = fs.readFileSync(INDEX, "utf8");
  const grab = (name) => {
    const m = html.match(new RegExp(`function ${name}\\([^)]*\\)\\{[^\\n]*\\}`));
    assert.ok(m, `index.html 應存在 ${name}（面板入口數量 guard）`);
    return m[0];
  };
  const src = ["promoLimits", "promoCanAdd", "promoCanRemove"].map(grab).join("\n");
  return new Function("RULES", `${src}\nreturn { promoLimits, promoCanAdd, promoCanRemove };`)(rulesObj);
}

test("單一來源：rules.json entryCount＝3~12（gate 抽頂常數重匯；上限 4→12 已生效）", () => {
  const rules = JSON.parse(fs.readFileSync(RULES_JSON, "utf8"));
  assert.strictEqual(rules.entryChecks.entryCount.min, 3, "下限應維持 3");
  assert.strictEqual(rules.entryChecks.entryCount.max, 12, "上限應為 12（2026-08-26 裁決）");
});

test("面板資料層：加到 12 一路放行、加第 13 擋、剛好 3 則按刪＝擋", () => {
  const rules = JSON.parse(fs.readFileSync(RULES_JSON, "utf8"));
  const g = loadPanelPromoGuards(rules);
  assert.deepStrictEqual(g.promoLimits(), { min: 3, max: 12 }, "面板讀到的界線應＝rules.json");
  // 加到 12：自 3 則起逐則新增，11 步全放行
  let len = 3;
  while (len < 12) {
    assert.strictEqual(g.promoCanAdd(len), true, `第 ${len + 1} 則應可新增`);
    len++;
  }
  assert.strictEqual(len, 12, "應能加到 12 則");
  // 加第 13：擋（滿版＝新增鍵消失＋保險絲）
  assert.strictEqual(g.promoCanAdd(12), false, "第 13 則應被擋");
  // 刪到 2：剛好 3 則（下限）按刪＝擋；4 則以上可刪；<3 入稿中狀態可刪（改錯要能撤）
  assert.strictEqual(g.promoCanRemove(3), false, "剛好 3 則不能再刪（版型下限）");
  assert.strictEqual(g.promoCanRemove(4), true, "4 則可刪（刪後仍 ≥3）");
  assert.strictEqual(g.promoCanRemove(2), true, "入稿中 2 則可刪（尚未達下限的建置態）");
});

test("rules.json 還沒載到（RULES=null）＝保守 fallback 同值 3~12，不會變成無上限", () => {
  const g = loadPanelPromoGuards(null);
  assert.deepStrictEqual(g.promoLimits(), { min: 3, max: 12 });
  assert.strictEqual(g.promoCanAdd(12), false);
  assert.strictEqual(g.promoCanRemove(3), false);
});

test("絆線：面板不得殘留舊上限寫死（length >= 4 disabled）＋新文案在場", () => {
  const html = fs.readFileSync(INDEX, "utf8");
  assert.doesNotMatch(html, /promoEntries \|\| \[\]\)\.length >= 4 \? "disabled"/, "舊 4 則寫死應已移除");
  assert.match(html, /＋ 新增一則入口/, "新增鍵文案應為「＋ 新增一則入口」");
  assert.match(html, /超過 3 則會變左右滑動/, "上限白話說明應在場"); // 句隨說明減肥 #29 升版（S10 第 7 件・2026-08-27 圈可套用）
});
