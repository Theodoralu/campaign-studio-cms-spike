"use strict";
/**
 * engine_twin_tables.test.js —— 引擎「每款版式對照表」互相對帳（CMS-DOORS 第 1 層）
 *
 * 09-07 病例：「換副標字型預覽沒反應」＝引擎裡副標節點有兩張表（HV2_SUB_NODES 給字體、hv2ApplyTypo 裡的 SUB 給字級），
 * 改槽位時只改了一張。這支把引擎源檔裡所有「以版式貨號為鍵」的表抓出來互相對：
 *   ① 副標雙生表：SUB（若還存在）必須逐鍵等於 HV2_SUB_NODES；第 2 層合一後＝SUB 不得再存在、hv2ApplyTypo 讀 HV2_SUB_NODES
 *   ② 舞台表 HV2_STAGES、標題節點表 HV2_TITLE_NODES、lib 文字槽段名表 HERO_TEXT_PIECES 三者鍵集合一致（一款版式三處都要登）
 *   ③ 有副標節點的版式，lib 至少要有兩格可填（不然副標字沒地方落）
 * 引擎源檔＝規劃資料夾的 FrameTest.html（改源頭非產物；deploy-site 那份是 sync 產物）。
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { HERO_TEXT_PIECES } = require("../../lib/layout_choice.js");

const ENGINE = path.join(__dirname, "..", "..", "..", "..", "2026-AI自動化活動頁生成規劃", "MVP_Phase1_LeCreuset_活動頁Prototype_FrameTest.html");
const SRC = fs.readFileSync(ENGINE, "utf8");

/** 抓 `const NAME = {` 起到對應的 `};` 為止的物件字面值原文（第一個 `};`＝這些表都是單層字串表） */
function objectLiteral(anchor) {
  const i = SRC.indexOf(anchor);
  if (i < 0) return null;
  const start = SRC.indexOf("{", i);
  const end = SRC.indexOf("};", start);
  return SRC.slice(start, end + 1);
}
const evalObj = (lit) => new Function(`return (${lit});`)(); // 只用在純字串表（含註解）——不含函式
const keysOf = (lit) => [...new Set([...lit.matchAll(/"(layout-\d{3})"\s*:/g)].map((m) => m[1]))].sort();

test("① 副標雙生表：hv2ApplyTypo 的 SUB 與 HV2_SUB_NODES 逐鍵一致（第 2 層合一後 SUB 應消失）", () => {
  const subNodes = evalObj(objectLiteral("const HV2_SUB_NODES = {"));
  const typoStart = SRC.indexOf("function hv2ApplyTypo(");
  assert.ok(typoStart > 0, "找不到 hv2ApplyTypo");
  const typoBody = SRC.slice(typoStart, SRC.indexOf("\nfunction ", typoStart + 10));
  const subIdx = typoBody.indexOf("const SUB = {");
  if (subIdx >= 0) {
    const sub = evalObj(typoBody.slice(typoBody.indexOf("{", subIdx), typoBody.indexOf("};", subIdx) + 1));
    assert.deepEqual(sub, subNodes, "hv2ApplyTypo 的 SUB 與 HV2_SUB_NODES 不同步——改槽位要兩張表一起改（或直接合一）");
  } else {
    assert.ok(/HV2_SUB_NODES\[layoutId\]/.test(typoBody), "SUB 不見了但 hv2ApplyTypo 也沒改讀 HV2_SUB_NODES＝副標字級沒有節點可套");
  }
});

test("② 舞台表／標題節點表／lib 文字槽段名表：三處版式鍵集合一致", () => {
  const stages = keysOf(objectLiteral("const HV2_STAGES = {"));
  const titles = keysOf(objectLiteral("const HV2_TITLE_NODES = {"));
  const pieces = Object.keys(HERO_TEXT_PIECES).sort();
  assert.ok(stages.length >= 11, `舞台表只有 ${stages.length} 款`);
  assert.deepEqual(titles, stages, "有舞台沒標題節點（或反過來）＝字風／字級套不到那款");
  assert.deepEqual(pieces, stages, "lib 文字槽段名表與引擎舞台表不同步＝編修器欄位與畫面格數對不上");
});

test("③ 有副標節點的版式，lib 至少兩格可填；沒副標節點的版式（007）lib 也不該有「副」字格", () => {
  const subNodes = evalObj(objectLiteral("const HV2_SUB_NODES = {"));
  for (const [layout, sel] of Object.entries(subNodes)) {
    assert.ok(typeof sel === "string" && sel.trim(), `${layout} 副標節點選擇器空白`);
    const slot = HERO_TEXT_PIECES[layout]; const labels = Object.values(slot)[0];
    assert.ok(labels.filter(Boolean).length >= 2, `${layout} 有副標節點但 lib 只有 ${labels.filter(Boolean).length} 格可填`);
  }
  for (const layout of Object.keys(HERO_TEXT_PIECES)) {
    if (subNodes[layout]) continue;
    const labels = Object.values(HERO_TEXT_PIECES[layout])[0];
    assert.ok(!labels.some((l) => l && /^副標/.test(l)), `${layout} 沒有副標節點，lib 卻有「副標」格＝填了會無聲消失`);
  }
});
