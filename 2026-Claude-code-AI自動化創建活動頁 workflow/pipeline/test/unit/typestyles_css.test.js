"use strict";
/**
 * 字風樣式表靜態檢查（2026-09-07 經驗卡「字風壓深會殺掉紋理」技術半機器化；裁決＝docs/workflow-hub/decisions/2026-09-07-經驗卡11張裁決.md）
 *
 * 病：用 background-clip:text 畫的紋理層（網點／漸層／斜紋／暈染）若沒補 -webkit-text-fill-color:transparent，
 *     會繼承亮底壓深的實色、把紋理整個蓋掉——2026-09-06 一次補了 21 處才發現是整類病。
 * 閘：design-assets/typestyles/typestyles.css 每一個含 background-clip:text 的宣告塊，必帶 -webkit-text-fill-color:transparent；漏一處即紅。
 *
 * 注意（非 hermetic，刻意為之，同 proposal_pack.test）：直讀 monorepo 真源 typestyles.css；pipeline repo 單獨 checkout 時本檔會紅，屬預期。
 */
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const CSS = path.resolve(__dirname, "..", "..", "..", "..", "design-assets", "typestyles", "typestyles.css");

function clipTextBlocksMissingTransparentFill(cssText) {
  const noComments = cssText.replace(/\/\*[\s\S]*?\*\//g, "");
  const blocks = [...noComments.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ selector: m[1].trim(), body: m[2] }));
  const clip = blocks.filter((b) => /background-clip\s*:\s*text/i.test(b.body));
  return {
    clipCount: clip.length,
    missing: clip.filter((b) => !/-webkit-text-fill-color\s*:\s*transparent/i.test(b.body)).map((b) => b.selector),
  };
}

test("typestyles.css：剪字紋理層（background-clip:text）必帶透明填色，否則亮底壓深會蓋掉紋理", () => {
  const css = fs.readFileSync(CSS, "utf8");
  const r = clipTextBlocksMissingTransparentFill(css);
  assert.ok(r.clipCount >= 10, `解析到的 clip-text 規則只有 ${r.clipCount} 個＝解析器可能壞了（2026-09-06 實數 21）——測試不得靜默通過`);
  assert.deepStrictEqual(r.missing, [], "以下規則畫了紋理卻沒補 -webkit-text-fill-color:transparent：\n" + r.missing.join("\n"));
});

test("檢查器自檢：漏掉透明填色的合成規則要被抓到、補了的放行", () => {
  const bad = ".hero-font-preview.css-zz .line::after{background:linear-gradient(red,blue);-webkit-background-clip:text;background-clip:text}";
  const good = ".hero-font-preview.css-zz2 .line::after{background:red;-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent}";
  const r = clipTextBlocksMissingTransparentFill(bad + "\n" + good);
  assert.strictEqual(r.clipCount, 2);
  assert.deepStrictEqual(r.missing, [".hero-font-preview.css-zz .line::after"]);
});
