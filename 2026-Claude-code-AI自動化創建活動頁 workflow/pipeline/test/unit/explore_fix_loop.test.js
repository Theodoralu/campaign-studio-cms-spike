/* 探索卡修復不得把人鎖在迴圈裡（2026-09-24 使用者實測）
 *
 * 病例：使用者點「AI 換在檔內容」→ 修復其實成功了 → 但下一次操作被擋，
 *       訊息說「請到發佈前檢查按重新檢查後再操作」→ 按了 → 再點 → 又擋。
 *       從頭到尾沒有一句話說得出真正原因，使用者原話：「鬼打牆的錯誤迴圈走不出去」。
 *
 * 實證：product_check.json 22:43:08 vs draft.json 22:44:46——報告比草稿舊 1 分 38 秒。
 * 根因兩處：
 *   ①applyExploreFix 同步報告時 `if (row)` 找不到對應列就**靜默跳過** ⇒ 清單永遠補不上
 *   ②exploreRowGuard 把「報告過期」也當成「這張卡被別人動過」一起擋
 *
 * 本檔守的是「不得回到靜默」：兩處都要主動把清單拉回同步，而不是丟一句「請你去按重新檢查」。
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "..");
const ui = fs.readFileSync(path.join(ROOT, "workbench/public/index.html"), "utf8");

test("①報告找不到對應列時，要自己補跑檢查——不可以靜默跳過", () => {
  assert.match(ui, /function applyExploreFix[\s\S]{0,900}?else \{ refreshChecksAfterDrift\(\); \}/,
    "applyExploreFix 的 if (row) 必須有 else 分支補跑檢查（原本沒有＝清單永遠補不上）");
});

test("②守門擋下時，要順手把清單更新好，不是叫人自己去按", () => {
  assert.match(ui, /function exploreRowGuard[\s\S]{0,1400}?refreshChecksAfterDrift\(\)/,
    "exploreRowGuard 擋下後要自己補跑檢查");
  assert.match(ui, /已幫你更新清單，請再按一次就會執行/,
    "訊息要說『已經幫你做了』，不是『請你去做』——原文案把人推回迴圈");
});

test("③補跑失敗要出聲，不得靜默吞掉（吞掉＝另一種鬼打牆）", () => {
  assert.match(ui, /async function refreshChecksAfterDrift\(\)[\s\S]{0,400}?catch[\s\S]{0,200}?toast\([^)]*沒成功/,
    "失敗要用白話告訴使用者，並附手動退路");
  assert.match(ui, /refreshChecksAfterDrift[\s\S]{0,400}?runProdCheck\(\)/,
    "要真的去重跑商品狀態檢查（報告來源），不是只重畫畫面");
});

test("④原本那句把人推回迴圈的文案不得復活", () => {
  const guard = ui.slice(ui.indexOf("function exploreRowGuard"), ui.indexOf("function exploreRowGuard") + 1600);
  assert.doesNotMatch(guard, /請到「發佈前檢查」按「重新檢查」後再操作/,
    "守門擋下時不得再叫使用者自己去按重新檢查——那正是迴圈的來源");
});
