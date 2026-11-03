"use strict";
/**
 * hero_stages_twin.test.js —— lib/hero_stages.js（伺服器端舞台尺寸 twin 表）必須逐值等於引擎 HV2_STAGES
 *
 * 白話：上傳背景圖的體檢與背景製作說明包都拿 lib 那張表當尺；引擎畫圖拿的是自己那張。
 * 兩張表若漂了＝體檢說「夠大」但畫出來糊、或說明包教人做錯尺寸。這支釘死：每款 w/h、tablet.w/h、mobile.w/h 一模一樣。
 * （engine_twin_tables.test.js 已釘鍵集合；本支釘值。2026-09-27 立，78 號。）
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { HERO_STAGES, SLOTS, minSizeFor, checkSize } = require("../../lib/hero_stages.js");

const ENGINE = path.join(__dirname, "..", "..", "..", "..", "2026-AI自動化活動頁生成規劃", "MVP_Phase1_LeCreuset_活動頁Prototype_FrameTest.html");
const SRC = fs.readFileSync(ENGINE, "utf8");

function objectLiteral(anchor) {
  const i = SRC.indexOf(anchor); assert.ok(i >= 0, "引擎找不到 " + anchor);
  const start = SRC.indexOf("{", i); const end = SRC.indexOf("};", start);
  return SRC.slice(start, end + 1);
}
const engineStages = new Function(`return (${objectLiteral("const HV2_STAGES = {")});`)();

test("① 鍵集合一致：lib 有的版式引擎都有，反之亦然", () => {
  assert.deepEqual(Object.keys(HERO_STAGES).sort(), Object.keys(engineStages).sort());
});

test("② 逐值一致：w/h、tablet、mobile 三組尺寸每款都等於引擎", () => {
  for (const [id, e] of Object.entries(engineStages)) {
    const l = HERO_STAGES[id];
    assert.ok(l, `${id} lib 缺`);
    assert.deepEqual({ w: l.w, h: l.h, tablet: l.tablet, mobile: l.mobile }, { w: e.w, h: e.h, tablet: e.tablet, mobile: e.mobile }, `${id} 尺寸與引擎不同——改引擎 HV2_STAGES 要同批改 lib/hero_stages.js`);
  }
});

test("③ 最小尺寸＝視窗寬×2、舞台高×2；桌機以 1440 視窗計；三格都有數字", () => {
  for (const id of Object.keys(HERO_STAGES)) {
    for (const slot of SLOTS) {
      const m = minSizeFor(id, slot); assert.ok(m && m.w > 0 && m.h > 0, `${id}/${slot} 算不出最小尺寸`);
    }
    const d = minSizeFor(id, "desktop"); assert.strictEqual(d.w, 2880, `${id} 桌機寬應以 1440×2 計`);
    assert.strictEqual(d.h, Math.ceil(HERO_STAGES[id].h * 2));
    assert.strictEqual(minSizeFor(id, "375").w, 750);
  }
});

test("④ 體檢只驗最小尺寸與方向，不驗比例：設計線既有資產（bg-027 平板 1536×1120 配 768×340）要能過", () => {
  // 004 平板舞台 768×340.26 → 最小 1536×681；1536×1120 比例差很多但要過
  assert.strictEqual(checkSize("layout-004", "768", 1536, 1120).pass, true);
  assert.strictEqual(checkSize("layout-002", "desktop", 2880, 1120).pass, true, "bg-037 桌機 2880×1120 對 560 舞台要過");
  assert.strictEqual(checkSize("layout-011", "desktop", 2880, 1120).pass, false, "011 舞台 780 → 桌機高至少 1560");
  assert.strictEqual(checkSize("layout-011", "desktop", 3440, 867).pass, true, "有必見主體的 3440×867 版要過");
  assert.strictEqual(checkSize("layout-002", "375", 750, 880).pass, true, "bg-037 手機 750×880 對 424 舞台要過");
  assert.strictEqual(checkSize("layout-002", "375", 880, 750).pass, false, "手機橫的不行");
  assert.strictEqual(checkSize("layout-002", "desktop", 1200, 600).pass, false);
  assert.match(checkSize("layout-002", "desktop", 1200, 600).reason, /至少 2880×1120/);
  assert.match(checkSize("layout-002", "768", 1200, 600).reason, /平板版至少 1536×660/);
});

test("⑤ 說明句白話、不帶貨號", () => {
  const r = checkSize("layout-002", "375", 300, 300);
  assert.doesNotMatch(r.reason, /layout-\d{3}/);
});
