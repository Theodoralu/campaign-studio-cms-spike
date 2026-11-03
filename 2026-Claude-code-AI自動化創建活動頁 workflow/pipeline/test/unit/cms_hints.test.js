"use strict";
/**
 * CMS 提示產物（70 號 2026-09-09）三道絆線：
 *   ①保鮮：真源可達時，workbench/public/cms-hints.json 必逐字等於現算（改了真源沒重跑生成器＝紅）；清單上的母版圖必在產物目錄
 *   ②顯示文案禁詞：CMS 會印出來的字（欄位 ph／ghost、模組 name／one、版面 name／note）沿 layout_choice 那套 BAN
 *     ＋加禁程式鍵名（module_id／page.）——CMS 介面＝展示層，不印機器的語言（2026-08-25 使用者裁決）
 *   ③真值鐵律：示範句純顯示——defaultNodeFor() 三模組空形每個字串葉子仍是 ""（提示永不變成預設值）
 * 真源不可達（69 號同事包＝沒有規劃 repo）＝①跳過並說明；②③照跑（讀 commit 產物）。
 */
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const B = require("../../tools/build_cms_hints.js");
const cm = require("../../lib/content_modules.js");

const BAN = /(layout-\d{3}|\d+\s*號|§|modules\.json|rollout|映射表|灰度|值域|manifest|module_id|module_variant|page\.|gdid)/;
const strip = (t) => String(t || "").replace(/\*\*/g, "").replace(/`/g, "");

test("cms-hints 產物存在且形狀完整（modules／variants／fields／images）", () => {
  assert.ok(fs.existsSync(B.OUT_JSON), "缺 workbench/public/cms-hints.json——跑 node tools/build_cms_hints.js");
  const h = JSON.parse(fs.readFileSync(B.OUT_JSON, "utf8"));
  for (const k of ["mechanic", "spotlight", "promoCard"]) {
    assert.ok(h.modules[k] && h.modules[k].name && h.modules[k].one && h.modules[k].file, `modules.${k} 缺 name/one/file`);
    assert.ok(h.fields[k] && Object.keys(h.fields[k]).length, `fields.${k} 空`);
  }
  assert.deepStrictEqual(Object.keys(h.variants.mechanic).sort(), ["info-gift-gallery", "info-gift-rows", "info-gift-rush", "info-offer-rows"]);
  assert.ok(Array.isArray(h.images) && h.images.length >= 6);
  for (const f of h.images) assert.ok(fs.existsSync(path.join(B.OUT_IMG_DIR, f)), `產物缺母版圖 ${f}`);
});

test("保鮮：真源可達＝產物逐字等於現算（改真源要重跑生成器）", async (t) => {
  if (!B.sourceReachable()) { t.skip("規劃 repo 不在（同事包情境）＝沿用 commit 產物"); return; }
  const { json } = await B.compute();
  assert.strictEqual(fs.readFileSync(B.OUT_JSON, "utf8"), json, "cms-hints.json 過期——node tools/build_cms_hints.js");
});

test("顯示文案禁詞：CMS 會印的字不含貨號／文件編號／治理行話／程式鍵名", () => {
  const h = JSON.parse(fs.readFileSync(B.OUT_JSON, "utf8"));
  const shown = [];
  for (const m of Object.values(h.modules)) shown.push(m.name, m.one);
  for (const vs of Object.values(h.variants)) for (const v of Object.values(vs)) shown.push(v.name, v.note);
  for (const fs_ of Object.values(h.fields)) for (const f of Object.values(fs_)) { if (f.hidden) continue; shown.push(f.ph, f.ghost); }
  for (const s of shown) if (s) assert.doesNotMatch(strip(s), BAN, `CMS 顯示文案含機器詞彙：「${s}」`);
});

test("每個人工欄都有輸入提示；實抓欄有佔位卡的話", () => {
  const h = JSON.parse(fs.readFileSync(B.OUT_JSON, "utf8"));
  for (const [k, fields] of Object.entries(h.fields)) for (const [f, v] of Object.entries(fields)) {
    if (v.hidden) continue;
    if (v.filler === "人工") assert.ok(String(v.ph).trim(), `${k}.${f} 人工欄沒有輸入提示`);
    if (v.filler === "實抓") assert.ok(String(v.ghost).trim(), `${k}.${f} 實抓欄沒有佔位卡的話`);
  }
});

test("真值鐵律：示範句純顯示——三模組空形每個字串葉子仍是空字串", () => {
  const leaves = (n, out = []) => { if (Array.isArray(n)) n.forEach((x) => leaves(x, out)); else if (n && typeof n === "object") Object.values(n).forEach((x) => leaves(x, out)); else out.push(n); return out; };
  for (const [kind, variant] of [["mechanic", "info-offer-rows"], ["mechanic", "info-gift-rows"], ["spotlight"], ["promoCard"]]) {
    for (const leaf of leaves(cm.defaultNodeFor(kind, variant))) if (typeof leaf === "string" && !/^info-/.test(leaf)) assert.strictEqual(leaf, "", `${kind} 空形有非空字串「${leaf}」——提示漏進預設值`);
  }
});
