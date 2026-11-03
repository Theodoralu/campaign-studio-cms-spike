"use strict";
/**
 * 型錄字風：字面色跟「主標題文字」（Headline）走、妝跟配方走（2026-09-26 使用者裁「乙」；story＝docs/stories/title-ink-follows-headline.md）。
 * 病例：Headline #1C1C1C、G1 交互描邊＋妝容跟主題走 → 主標山吹黃。9/4 規則「字風容器不吃主題字色」把字面與妝綁在一起；現在拆開：字面吃 Headline、妝照配方。
 * 這裡守的是來源與兩份機器複本（工具頁 COSTUME_ENGINE 塊、deploy-site 鏡像）；畫面實測在無頭瀏覽器（story 驗收紀錄）。
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..", "..", "..", "..");
const PL = path.join(ROOT, "2026-AI自動化活動頁生成規劃");
const ENGINE = path.join(PL, "MVP_Phase1_LeCreuset_活動頁Prototype_FrameTest.html");
const TOOL = path.join(PL, "活動頁色彩策略工具.html");
const CE = path.join(ROOT, "design-assets", "typestyles", "costume-engine.js");
const ui = fs.readFileSync(path.join(__dirname, "..", "..", "workbench", "public", "index.html"), "utf8");
const has = (p) => fs.existsSync(p);

test("引擎：hv2ApplyTitleInk 存在、掛在 hv2ApplyCostume 開頭（不論妝容開關）、只對 solid＋cc-title 用行內樣式套主標色、拆時只拆自己的", (t) => {
  if (!has(ENGINE)) { t.skip("引擎源檔不在（同事包情境）"); return; }
  const src = fs.readFileSync(ENGINE, "utf8");
  assert.match(src, /function hv2ApplyTitleInk\(layoutId, ts\)\{/);
  assert.match(src, /const ts = \(typeof pg\.titleStyle === "string" && \/\^css-\[a-z0-9\]\+\$\/\.test\(pg\.titleStyle\)\) \? pg\.titleStyle : null;\n  try \{ hv2ApplyTitleInk\(layoutId, ts\); \}/, "要在 on 判斷之前呼叫＝妝容關著也套字面色");
  assert.match(src, /el\.dataset\.tsFill = kind;/);
  assert.match(src, /if \(kind === "solid" && document\.body\.classList\.contains\("cc-title"\)\) \{ el\.style\.setProperty\("color", "var\(--campaign-title\)"\); el\.style\.setProperty\("-webkit-text-fill-color", "var\(--campaign-title\)"\); el\.dataset\.tsInk = "1"; \}/);
  assert.match(src, /if \(el\.dataset\.tsInk\) \{ el\.style\.removeProperty\("color"\); el\.style\.removeProperty\("-webkit-text-fill-color"\); delete el\.dataset\.tsInk; \}/, "沒設過就不動別人的行內樣式");
  assert.match(src, /hv2EnsureCostumeJs\(\); return; \}/, "算法沒載＝先載、載到再套");
  assert.match(src, /2026-09-26 使用者裁「乙」：字風容器的「字面」改由 hv2ApplyTitleInk/, "CSS 那批排除條文旁要寫新規則");
});

test("換妝算法真源有 fillKind；工具頁與鏡像兩份機器複本跟上（複本由腳本重產、不手改）", (t) => {
  const ce = fs.readFileSync(CE, "utf8");
  assert.match(ce, /function fillKind\(styleId, rules, opts\)/); assert.match(ce, /VERSION: "2026-09-26"/);
  if (has(TOOL)) { const tool = fs.readFileSync(TOOL, "utf8"); assert.ok(tool.includes("function fillKind(styleId, rules, opts)"), "工具頁 COSTUME_ENGINE 塊要重產（tools/sync-registry-to-colortool.mjs）"); }
  const mirror = path.join(PL, "deploy-site", "lecreuset-frametest", "costume-engine.js");
  if (has(mirror)) assert.strictEqual(fs.readFileSync(mirror, "utf8"), ce, "鏡像要與真源逐位元組相同（deploy-site/sync.sh）");
  else t.diagnostic("鏡像不在（同事包情境）");
});

test("工具：字風說明改口（實心＝跟主標題文字映射走／漸層＝不作用）＋漸層款打包提醒＋純字形款改口", (t) => {
  if (!has(TOOL)) { t.skip("工具頁不在"); return; }
  const tool = fs.readFileSync(TOOL, "utf8");
  assert.match(tool, /function titleFillKind\(styleId\)\{/);
  assert.match(tool, /titleFillKind\(\$\("titleStyle"\)\.value\) === "gradient" \? "這款字面是漸層（型錄設計本體），下方「主標題文字」映射（Headline）對主標<b>不作用<\/b>/);
  assert.match(tool, /"跟下方「主標題文字」映射（Headline）走——工具預覽、CMS、上線同一套（2026-09-26 起）。"/);
  assert.match(tool, /titleFillKind\(fontStyle\) === "gradient" && titleColor\) tsWarnings\.push\("字風「"/);
  assert.match(tool, /這款只管字形，字色跟下方「主標題文字」映射（Headline）走；沒給時跟主視覺墨色自動判/);
  assert.doesNotMatch(tool, /標題顏色完全跟主題走/, "舊句不得殘留");
});

test("CMS 編修頁「妝容跟主題走」提示補一句字面色規則", () => {
  assert.match(ui, /字面色一律跟「主標題文字」色走（字面是漸層的款除外）/);
});
