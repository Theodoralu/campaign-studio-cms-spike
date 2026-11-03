/* 五型態名冊（2026-09-15 C 批）：機器真源 lib/scenario_names.js 與介面那份 RECIPE_CARDS 逐字對齊；策略檔第一行型態認法。 */
"use strict";
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const S = require("../../lib/scenario_names.js");
const B = require("../../lib/curation_brief.js");
const reEsc = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); // 正則跳脫（value 含 × / - 等符號）
const UI = fs.readFileSync(path.resolve(__dirname, "..", "..", "workbench", "public", "index.html"), "utf8");

test("index.html RECIPE_CARDS 五張卡的 value／title／legacyTitle／goal 與名冊逐字相同（介面那份是複本，機器這份是真源）", () => {
  for (const s of S.SCENARIOS) {
    const re = new RegExp(`value: "${reEsc(s.value)}", title: "([^"]+)", goal: "([^"]+)", legacyTitle: "([^"]+)"`);
    const m = UI.match(re);
    assert.ok(m, `RECIPE_CARDS 找不到 value=${s.value} 那張卡（或欄位順序變了）`);
    assert.strictEqual(m[1], s.title, `${s.value} title 不同`); assert.strictEqual(m[2], s.goal, `${s.value} goal 不同`); assert.strictEqual(m[3], s.legacyTitle, `${s.value} legacyTitle 不同`);
  }
});

test("resolve：新卡名、舊卡名、資料鍵、帶 0N 前綴、去符號近似都認；認不得＝null", () => {
  assert.strictEqual(S.resolve("抓一個時事話題選品").value, "時事主題-情境×選品");
  assert.strictEqual(S.resolve("時事主題．情境選品").value, "時事主題-情境×選品");
  assert.strictEqual(S.resolve("時事主題-情境×選品").value, "時事主題-情境×選品");
  assert.strictEqual(S.resolve("05 時事主題-情境×選品").value, "時事主題-情境×選品");
  assert.strictEqual(S.resolve("多品牌一起賣主打省錢").value, "同品類×跨品牌-優惠銷售");
  assert.strictEqual(S.resolve("隨便寫的"), null);
  assert.strictEqual(S.titleOf(""), "先不指定");
});

test("策略檔第一行「這檔是哪一種活動：X｜活動主題：Y」→ data.scenario／scenarioLabel／theme；不影響其餘段、不出 notice", () => {
  const md = "這檔是哪一種活動：抓一個時事話題選品｜活動主題：中秋烤肉\n\n# 這檔在賣什麼\n中秋烤肉用具\n\n# 主標\n一次備齊\n";
  const r = B.parseBrief(md);
  assert.strictEqual(r.ok, true); assert.deepStrictEqual(r.notices, []);
  assert.strictEqual(r.data.scenario, "時事主題-情境×選品"); assert.strictEqual(r.data.scenarioLabel, "抓一個時事話題選品"); assert.strictEqual(r.data.theme, "中秋烤肉");
  assert.deepStrictEqual(r.data.title, ["一次備齊"]);
});

test("第一行容錯：半形冒號與 |、只寫型態、寫舊卡名、寫了認不得的字", () => {
  assert.strictEqual(B.parsePreamble("這檔是哪一種活動: 只講一個品牌 | 活動主題: Le Creuset\n# 主標\nx").scenario, "單一品牌-優惠/曝光");
  const only = B.parsePreamble("這檔是哪一種活動：秀新品或熱銷，不喊優惠\n# 主標\nx"); assert.strictEqual(only.scenario, "同品類-新品/熱銷曝光"); assert.strictEqual(only.theme, "");
  const bad = B.parsePreamble("這檔是哪一種活動：促銷大放送｜活動主題：中秋\n# 主標\nx"); assert.strictEqual(bad.scenario, null); assert.strictEqual(bad.scenarioLabel, "促銷大放送"); assert.strictEqual(bad.theme, "中秋");
});

test("舊檔（沒有第一行）：三欄空、其餘照舊；內建五份範本仍全數解析成功", () => {
  const r = B.parseBrief("# 這檔在賣什麼\nx\n# 主標\ny\n");
  assert.strictEqual(r.data.scenario, null); assert.strictEqual(r.data.scenarioLabel, ""); assert.strictEqual(r.data.theme, "");
  const dir = path.resolve(__dirname, "..", "..", "briefs", "built-in");
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".md"))) assert.strictEqual(B.parseBrief(fs.readFileSync(path.join(dir, f), "utf8")).ok, true, f);
});
