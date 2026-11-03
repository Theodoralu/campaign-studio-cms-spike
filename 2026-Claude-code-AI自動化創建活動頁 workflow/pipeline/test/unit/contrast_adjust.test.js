"use strict";
/**
 * 建議色雙向回頭（2026-09-08 病例 run 150043：中間調照片上黑字被判不過、建議色卻往白走到底仍不過＝回「沒有修正版」死巷）
 * 擋色制（60 號）第二半條＝「擋的同時給選項」：只要存在能過的同色相明度，就必須給得出來。
 */
const { test } = require("node:test");
const assert = require("node:assert");
const TD = require("../../lib/theme_draft.js");

test("亮底＝往深調（原行為不變）", () => {
  const out = TD.adjustToContrast("#F596AA", "#F2F2F2", 4.5); // 淺粉字壓淺灰底
  assert.ok(TD.contrast(out, "#F2F2F2") >= 4.5, out);
  assert.ok(TD.luminance ? true : true);
});
test("暗底＝往亮調（原行為不變）", () => {
  const out = TD.adjustToContrast("#333333", "#1A1A1A", 4.5);
  assert.ok(TD.contrast(out, "#1A1A1A") >= 4.5, out);
});
test("中間調照片（#A16C69，亮度 0.19 被判暗底）：黑字往亮走到白仍 4.32 不過→回頭往深＝純黑 4.86 過", () => {
  const out = TD.adjustToContrast("#1C1C1C", "#A16C69", 4.5);
  assert.ok(TD.contrast(out, "#A16C69") >= 4.5, `建議色 ${out} 對比只有 ${TD.contrast(out, "#A16C69").toFixed(2)}`);
  assert.notStrictEqual(out.toUpperCase(), "#FFFFFF", "不得回傳不過的白");
});
test("兩向都不過＝回對比較高的那一向（呼叫端自會判 pass=false，不假裝過）", () => {
  const out = TD.adjustToContrast("#808080", "#7F7F7F", 21); // 不可能達成的門檻
  assert.ok(TD.contrast(out, "#7F7F7F") >= Math.max(TD.contrast("#000000", "#7F7F7F"), TD.contrast("#FFFFFF", "#7F7F7F")) - 0.01);
});
