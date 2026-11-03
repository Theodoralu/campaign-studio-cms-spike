"use strict";
/**
 * 兩端可讀性數學同判絆線（2026-09-08 使用者裁「色彩工具可讀性檢查對齊 CMS」＝60 號 §6.1 佇列項落地）
 *
 * 病：工具吃 design-tokens/palette-engine readabilityChecks（原：只看草案宣稱 hero 底、主標門檻 3），
 *     CMS 吃 pipeline/lib/theme_draft checkThemeDraft（09-04 起：照片版面拿照片代表色當底、標題族 4.5）
 *     ＝工具綠、CMS 紅（病例 run 150043：13.8:1 vs 3.95:1）。
 * 閘：對同一組「標題族字色 × 底」，兩份數學的 標題／副標題／活動時間標題／活動時間日期 四列必須同判、同數字（兩位小數）、同門檻。
 *     兩份實作刻意不合併（一份跑瀏覽器＋Node、一份 Node 專用），這條測試就是它們不准漂的鎖。
 * 非 hermetic（同 typestyles_css.test）：直讀 monorepo 真源 design-tokens/palette-engine.js。
 */
const { test } = require("node:test");
const assert = require("node:assert");
const path = require("path");
const PE = require(path.resolve(__dirname, "..", "..", "..", "..", "design-tokens", "palette-engine.js"));
const TD = require("../../lib/theme_draft.js");

const NAMES = ["標題", "副標題", "活動時間標題", "活動時間日期"];
const toolRows = (fg, heroHex, surface) => {
  const colors = { headline: fg, text: fg, hero: heroHex, surface: "#FFFFFF", brand: "#D0104C", price: "#F43E09", cta: "#D0104C", accent: "#F596AA" };
  const roles = [{ key: "hero", hex: heroHex }, { key: "card", hex: "#FFFFFF" }];
  const rows = PE.readabilityChecks(colors, roles, surface ? { heroSurface: surface } : {});
  return NAMES.map((n) => { const r = rows.find((x) => String(x[0]).startsWith(n + " /")); assert.ok(r, `工具列缺「${n}」`); return { name: n, ratio: Math.round(r[1] * 100) / 100, need: r[2], pass: r[1] >= r[2] }; });
};
const cmsRows = (fg, heroHex, surface) => {
  const td = { componentColors: { title: fg, subtitle: fg, eventLabel: fg, eventDate: fg }, backgroundModules: [{ key: "hero", hex: heroHex }, { key: "page", hex: "#F2F2F2" }] };
  const out = TD.checkThemeDraft(td, surface ? { heroSurface: { hex: surface, label: "測試照片" } } : undefined);
  return NAMES.map((n) => { const r = out.find((x) => x.name === n); assert.ok(r, `CMS 列缺「${n}」`); return { name: n, ratio: r.ratio, need: r.need, pass: r.pass }; });
};

test("病例 run 150043：墨字 #1C1C1C × 阿虎照片 #A16C69 ＝ 兩端都紅、都是 3.95:1、門檻都 4.5", () => {
  const t = toolRows("#1C1C1C", "#F8E2E9", "#A16C69");
  const c = cmsRows("#1C1C1C", "#F8E2E9", "#A16C69");
  assert.deepStrictEqual(t, c);
  assert.ok(t.every((r) => !r.pass && r.ratio === 3.95 && r.need === 4.5), JSON.stringify(t));
});

test("純色底（沒傳 heroSurface）：兩端都對草案 hero 底算、同判", () => {
  assert.deepStrictEqual(toolRows("#1C1C1C", "#F8E2E9", null), cmsRows("#1C1C1C", "#F8E2E9", null));
  assert.deepStrictEqual(toolRows("#FFFFFF", "#F8E2E9", null), cmsRows("#FFFFFF", "#F8E2E9", null));
});

test("格點同判：12 組字色 × 6 塊底（含亮／中間調／暗照片）＝ 四列 pass／ratio／need 逐格相等", () => {
  const fgs = ["#000000", "#1C1C1C", "#333333", "#555555", "#777777", "#999999", "#BBBBBB", "#DDDDDD", "#FFFFFF", "#D0104C", "#1F3A6B", "#F596AA"];
  const surfaces = ["#F2F2F2", "#A16C69", "#212949", "#7F7F7F", "#E8EAEE", "#101010"];
  let n = 0;
  for (const fg of fgs) for (const sf of surfaces) { assert.deepStrictEqual(toolRows(fg, "#FEDFE1", sf), cmsRows(fg, "#FEDFE1", sf), `字 ${fg} × 底 ${sf} 兩端不同判`); n++; }
  assert.strictEqual(n, 72);
});

test("工具列標籤講清楚坐哪：有照片底＝「／照片底」、沒有＝「／Hero」", () => {
  const colors = { headline: "#1C1C1C", text: "#1C1C1C", hero: "#F8E2E9", surface: "#FFF", brand: "#D0104C", price: "#F43E09", cta: "#D0104C", accent: "#F596AA" };
  const roles = [{ key: "hero", hex: "#F8E2E9" }, { key: "card", hex: "#FFFFFF" }];
  assert.ok(PE.readabilityChecks(colors, roles, { heroSurface: "#A16C69" }).some((r) => r[0] === "標題 / 照片底"));
  assert.ok(PE.readabilityChecks(colors, roles, {}).some((r) => r[0] === "標題 / Hero"));
});
