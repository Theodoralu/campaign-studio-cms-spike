/* 欄位長度上限：spec 機讀欄 ＝ 唯一真源，CMS 的 HERO_LEN 必須跟它一致（2026-09-11 使用者裁＝73 號 §6-1 甲）
   ------------------------------------------------------------------
   為什麼要有這條：2026-09-11 清點發現同一個「這欄最多幾個字」同時活在三個地方——
   spec 的 fieldLimits（散文，機器讀不懂）／CMS 的 HERO_LEN（數字）／成績單。
   同一天另一批的病根正是「同一件事有幾種說法」（優惠文案 6／6／5 三處三個數字）。
   再多一份就是第四份。所以：spec 加機讀欄 fieldLimitsMachine 當真源，這支測試把 HERO_LEN 釘在它身上。

   守什麼：
     ①HERO_LEN 有的每一款、每一欄，spec 三裝置檔至少一份要有同鍵的 fieldLimitsMachine 條目
     ②maxChars 逐欄相等（HERO_LEN[layout][slot].max === spec.fieldLimitsMachine[slot].maxChars）
     ③spec 條目要寫 source（數字從哪來：實測／設計側給值／沿用），不准裸數字——「看起來像量的」跟「量的」要分得出來
   不守什麼：數字對不對（那是 spec_check --derive-limits 拿真畫面量的事）；哪些版型該有上限。
   注意：HERO_LEN 是巢狀兩層 { layout: { slot: {max,msg,...} } }，heroName 多帶 gateOnEdit，比對只看 max。

   讀 HERO_LEN 的方式：從 index.html 找 `const HERO_LEN = {` 起點，做括號配對（跳過字串與註解）截出物件字面值，
   再用 Function 求值——不用正則硬切（中文 msg 裡有引號、全形括號、跨行都會斷）。 */
"use strict";
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const PIPE = path.join(__dirname, "..", "..");
const UI = path.join(PIPE, "workbench", "public", "index.html");
const SPEC_DIR = path.join(PIPE, "..", "..", "design-assets", "layouts", "spec");

function extractObjectLiteral(src, anchor) {
  const i = src.indexOf(anchor);
  assert.ok(i >= 0, `index.html 找不到「${anchor}」`);
  let j = src.indexOf("{", i);
  let depth = 0, inStr = null, inLine = false, inBlock = false;
  for (let k = j; k < src.length; k++) {
    const ch = src[k], nx = src[k + 1];
    if (inLine) { if (ch === "\n") inLine = false; continue; }
    if (inBlock) { if (ch === "*" && nx === "/") { inBlock = false; k++; } continue; }
    if (inStr) { if (ch === "\\") { k++; continue; } if (ch === inStr) inStr = null; continue; }
    if (ch === "/" && nx === "/") { inLine = true; k++; continue; }
    if (ch === "/" && nx === "*") { inBlock = true; k++; continue; }
    if (ch === '"' || ch === "'" || ch === "`") { inStr = ch; continue; }
    if (ch === "{") depth++;
    else if (ch === "}") { depth--; if (depth === 0) return src.slice(j, k + 1); }
  }
  throw new Error("HERO_LEN 物件括號不配對");
}

function loadHeroLen() {
  const src = fs.readFileSync(UI, "utf8");
  const lit = extractObjectLiteral(src, "const HERO_LEN = {");
  // eslint-disable-next-line no-new-func
  return new Function(`return (${lit});`)();
}

/* spec 是逐裝置三個檔、各有自己的 maxChars（卡寬 160／136／116 量出來本來就不同）；HERO_LEN 每欄只有一個數字。
   比對規則＝ HERO_LEN[欄].max ＝ 三裝置 maxChars 的**最小值**（b3 2026-09-11 取值規則：輪播會把每件商品輪到最窄的側卡，
   最緊的那個才是會出事的那個）。三檔相同＝退化成相等；有人只改桌機沒改最緊那個＝測試不會誤報。 */
function loadSpecLimits(layout) {
  const out = {}; // slot -> { minMax, perDevice:{dev:maxChars}, sources:{dev:source} }
  for (const dev of ["desktop", "tablet", "mobile"]) {
    const p = path.join(SPEC_DIR, `${layout}.${dev}.json`);
    if (!fs.existsSync(p)) continue;
    const fx = JSON.parse(fs.readFileSync(p, "utf8"));
    for (const [slot, m] of Object.entries(fx.fieldLimitsMachine || {})) {
      if (!out[slot]) out[slot] = { minMax: Infinity, perDevice: {}, sources: {} };
      assert.strictEqual(typeof m.maxChars, "number", `${layout}.${dev} ${slot}：maxChars 不是數字`);
      out[slot].perDevice[dev] = m.maxChars;
      out[slot].sources[dev] = m.source;
      out[slot].minMax = Math.min(out[slot].minMax, m.maxChars);
    }
  }
  return out;
}

test("HERO_LEN 讀得出來、而且是巢狀兩層", () => {
  const H = loadHeroLen();
  const layouts = Object.keys(H);
  assert.ok(layouts.length >= 1, "HERO_LEN 空的");
  for (const [layout, slots] of Object.entries(H)) {
    assert.match(layout, /^layout-\d{3}$/, `HERO_LEN 第一層鍵應為版型貨號，實得「${layout}」`);
    for (const [slot, v] of Object.entries(slots)) assert.strictEqual(typeof v.max, "number", `${layout}.${slot}.max 不是數字`);
  }
});

test("HERO_LEN 每一欄在 spec 機讀欄都有同鍵條目，且 max ＝ 三裝置 maxChars 最小值（spec 是真源）", () => {
  const H = loadHeroLen();
  const problems = [];
  for (const [layout, slots] of Object.entries(H)) {
    const S = loadSpecLimits(layout);
    for (const [slot, v] of Object.entries(slots)) {
      if (!S[slot]) { problems.push(`${layout}.${slot}：spec 三裝置檔都沒有 fieldLimitsMachine["${slot}"]——數字只活在 CMS＝沒有真源`); continue; }
      if (S[slot].minMax !== v.max) problems.push(`${layout}.${slot}：CMS HERO_LEN.max=${v.max} ≠ spec 三裝置最小值 ${S[slot].minMax}（逐裝置＝${JSON.stringify(S[slot].perDevice)}）——兩邊講兩個數字；最窄的那個才是會出事的那個`);
    }
  }
  assert.deepStrictEqual(problems, [], "\n" + problems.join("\n"));
});

test("spec 機讀欄每一條、每一裝置都要寫 source（數字從哪來），不准裸數字", () => {
  const H = loadHeroLen();
  const problems = [];
  for (const layout of Object.keys(H)) {
    const S = loadSpecLimits(layout);
    for (const [slot, m] of Object.entries(S)) {
      for (const [dev, src] of Object.entries(m.sources)) {
        if (!src || String(src).trim().length < 4) problems.push(`${layout}.${dev}.${slot}：缺 source——「看起來像量的」跟「量的」要分得出來`);
      }
    }
  }
  assert.deepStrictEqual(problems, [], "\n" + problems.join("\n"));
});
