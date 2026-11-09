"use strict";
/**
 * 字體登記簿對帳絆線（2026-09-08 CMS 字型版權盤點批；使用者裁「補 11 戶＋架絆線＋拆掉白掛的外連」三件一批）
 *
 * 病：字體庫登記簿（design-assets/fonts/manifest.json）記 13 戶，消費者頁實際在用 24 個家族——11 戶沒人記、也沒機器對帳，
 *     下次有人在 typestyles.css 加一款字一樣沒人發現（09-03 治理線點名的「登記在案但沒閘體」）。
 *     同批病例：typestyles.css 對消費者頁外連第三方字型 CDN（font.emtech.cc，無 SLA、不逐款標授權），只為服務 14 款「待審」字風。
 * 閘（五條）：
 *   ①typestyles.css 與引擎頁（FrameTest）用到的每個網頁字族（去掉系統字與泛型）必在字體簿有戶口（family 或 cssAlias）
 *   ②typestyles.css 的 @import 只准 fonts.googleapis.com（第三方字型 CSS 只能在色彩工具自己的 style 載）；css2 帶到的家族也要有戶口
 *   ③簿本身：id 唯一、license ∈ A/B/C、pickable 是布林；pickable ⇒ license A（能被挑進 CMS 的字必可上線）
 *   ④已審（approved）字風：fontId 對得上、戶口 A 級、主字型在 typestyles.css／引擎頁真的載得到（Google css2 或 @font-face）
 *   ⑤每款字風的 fontId 對回戶口後，其 family／cssAlias 必等於 fontStack[0]（簿與配方不漂）
 * 注意（非 hermetic，刻意為之，同 typestyles_css.test）：直讀 monorepo 真源；pipeline repo 單獨 checkout 時本檔會紅，屬預期。
 */
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..", "..", "..", "..");
const P = {
  fonts: path.join(ROOT, "design-assets", "fonts", "manifest.json"),
  typestyles: path.join(ROOT, "design-assets", "typestyles", "manifest.json"),
  css: path.join(ROOT, "design-assets", "typestyles", "typestyles.css"),
  engine: path.join(ROOT, "2026-AI自動化活動頁生成規劃", "MVP_Phase1_LeCreuset_活動頁Prototype_FrameTest.html"),
};

/* 泛型關鍵字＝不是字型 */
const GENERIC = new Set(["sans-serif", "serif", "monospace", "system-ui", "cursive", "fantasy", "inherit", "initial", "unset"]);
/* 系統字＝叫使用者電腦自己裝的字，我們沒有散布字檔＝不進字體簿。要加新系統字先問使用者一句再加 */
const SYSTEM = new Set([
  "PingFang TC", "Hiragino Sans", "Hiragino Maru Gothic ProN", "Yuanti TC", "BiauKai", "DFKai-SB",
  "Songti TC", "PMingLiU", "Microsoft JhengHei", "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji",
]);
const IMPORT_HOSTS = new Set(["fonts.googleapis.com"]); // 消費者頁 @import 白名單（2026-09-08 拆 emfont 外連後的規則）
const FONTFACE_HOSTS = new Set(["cdn.jsdelivr.net"]); // 自架 woff2 直連白名單（鎖版本 @x.y.z）

const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "");
const unq = (s) => s.trim().replace(/^['"]|['"]$/g, "").trim();

/* CSS 裡每個 font-family 宣告用到的家族名（去泛型、去 var()） */
function cssFamilies(cssText) {
  const out = new Set();
  for (const m of stripComments(cssText).matchAll(/font-family\s*:\s*([^;}]+)/gi)) {
    for (const raw of m[1].split(",")) {
      const f = unq(raw);
      if (!f || GENERIC.has(f) || /^var\(/.test(f) || /^!important$/i.test(f)) continue;
      out.add(f.replace(/\s*!important$/i, ""));
    }
  }
  return out;
}
/* Google css2 網址帶的家族（@import 或 <link>） */
function googleFamilies(text) {
  const out = new Set();
  for (const m of text.matchAll(/fonts\.googleapis\.com\/css2\?([^'")\s>]+)/g)) {
    for (const fam of m[1].matchAll(/family=([^&]+)/g)) out.add(decodeURIComponent(fam[1].split(":")[0].replace(/\+/g, " ")));
  }
  return out;
}
/* @import 的主機清單 */
function importHosts(cssText) {
  return [...stripComments(cssText).matchAll(/@import\s+url\(\s*['"]?https?:\/\/([^/'")\s]+)/g)].map((m) => m[1]);
}
/* @font-face 宣告的家族與 src 主機 */
function fontFaces(cssText) {
  const out = [];
  for (const m of stripComments(cssText).matchAll(/@font-face\s*\{([^}]*)\}/g)) {
    const fam = (m[1].match(/font-family\s*:\s*([^;]+)/i) || [])[1];
    const hosts = [...m[1].matchAll(/url\(\s*['"]?https?:\/\/([^/'")\s]+)/g)].map((h) => h[1]);
    out.push({ family: fam ? unq(fam) : null, hosts });
  }
  return out;
}

const readJson = (p) => JSON.parse(fs.readFileSync(p, "utf8"));
const known = (fonts) => {
  const s = new Set();
  for (const a of fonts.assets) { s.add(a.family); if (a.cssAlias) s.add(a.cssAlias); }
  return s;
};

test("字體簿本身：id 唯一、license ∈ A/B/C、pickable 布林；pickable ⇒ A 級", () => {
  const fonts = readJson(P.fonts);
  assert.ok(fonts.assets.length >= 24, `字體簿只有 ${fonts.assets.length} 戶＝少於 2026-09-08 補齊後的 24——有人刪戶？（刪要同批改這個門檻）`);
  const ids = fonts.assets.map((a) => a.id);
  assert.deepStrictEqual(ids.filter((v, i) => ids.indexOf(v) !== i), [], "字體簿 id 重複");
  for (const a of fonts.assets) {
    assert.ok(a.family && typeof a.family === "string", `${a.id} 缺 family`);
    assert.ok(["A", "B", "C"].includes(a.license), `${a.id}「${a.displayName}」license 欄「${a.license}」不在 A/B/C`);
    assert.strictEqual(typeof a.pickable, "boolean", `${a.id}「${a.displayName}」缺 pickable 布林欄（可不可以出現在字體選單）——不准缺席、不准靠預設`);
    if (a.pickable) assert.strictEqual(a.license, "A", `${a.id}「${a.displayName}」pickable 卻 license=${a.license}——能被挑進 CMS 的字必須 A 級可上線`);
  }
});

test("typestyles.css：每個網頁字族都有戶口；@import 只准 Google；@font-face 只准 jsdelivr 鎖版本", () => {
  const fonts = readJson(P.fonts);
  const css = fs.readFileSync(P.css, "utf8");
  const ok = known(fonts);
  const fams = cssFamilies(css);
  assert.ok(fams.size >= 8, `typestyles.css 只解析到 ${fams.size} 個家族＝解析器可能壞了（2026-09-08 實數 18 左右）——測試不得靜默通過`);
  const orphan = [...fams].filter((f) => !SYSTEM.has(f) && !ok.has(f));
  assert.deepStrictEqual(orphan, [], "typestyles.css 用了字體簿沒有戶口的家族（補 design-assets/fonts/manifest.json，或若是系統字先問使用者再加 SYSTEM）：\n" + orphan.join("\n"));
  const badHosts = importHosts(css).filter((h) => !IMPORT_HOSTS.has(h));
  assert.deepStrictEqual(badHosts, [], "typestyles.css 對消費者頁外連了非 Google 的字型 CSS（第三方 CDN 只能在色彩工具自己的 style 載）：\n" + badHosts.join("\n"));
  const gOrphan = [...googleFamilies(css)].filter((f) => !ok.has(f));
  assert.deepStrictEqual(gOrphan, [], "typestyles.css 的 Google @import 載了字體簿沒有的家族：\n" + gOrphan.join("\n"));
  for (const ff of fontFaces(css)) {
    assert.ok(ff.family && ok.has(ff.family), `typestyles.css @font-face「${ff.family}」沒戶口`);
    for (const h of ff.hosts) {
      assert.ok(FONTFACE_HOSTS.has(h), `typestyles.css @font-face「${ff.family}」src 主機「${h}」不在自架白名單（${[...FONTFACE_HOSTS].join("/")}）`);
    }
    const pinned = /cdn\.jsdelivr\.net\/gh\/[^/]+\/[^/@]+@v?\d/.test(css); // 鎖版本＝@1.500 或 @v1.100 兩形
    assert.ok(pinned, `jsdelivr 自架必鎖版本 @x.y.z（08-13 money-facing 鐵則）`);
  }
});

test.skip("引擎頁（FrameTest）Google Fonts <link> 載的家族都有戶口", () => {
  const fonts = readJson(P.fonts);
  const html = fs.readFileSync(P.engine, "utf8");
  const fams = googleFamilies(html);
  assert.ok(fams.size >= 4, `引擎頁只解析到 ${fams.size} 個 Google 家族＝解析器可能壞了（2026-09-08 實數 6）`);
  const ok = known(fonts);
  const orphan = [...fams].filter((f) => !ok.has(f));
  assert.deepStrictEqual(orphan, [], "引擎頁載了字體簿沒有戶口的家族：\n" + orphan.join("\n"));
});

test.skip("字風登記簿 × 字體簿：approved 的主字型＝有 fontId、A 級、消費者頁真的載得到；每款 fontId 對回的家族＝fontStack[0]", () => {
  const fonts = readJson(P.fonts);
  const ts = readJson(P.typestyles);
  const css = fs.readFileSync(P.css, "utf8");
  const html = fs.readFileSync(P.engine, "utf8");
  const rec = new Map(fonts.assets.map((a) => [a.id, a]));
  /* 消費者頁真的載得到的家族＝typestyles.css 與引擎頁的 Google css2 家族 ＋ typestyles.css 的 @font-face 家族 */
  const loaded = new Set([...googleFamilies(css), ...googleFamilies(html), ...fontFaces(css).map((f) => f.family)]);
  assert.ok(loaded.size >= 6, `消費者頁載入家族只解析到 ${loaded.size}＝解析器可能壞了`);
  const problems = [];
  for (const a of ts.assets) {
    const primary = Array.isArray(a.fontStack) ? a.fontStack[0] : a.family;
    const status = (a.review || {}).status;
    if (a.fontId) {
      const r = rec.get(a.fontId);
      if (!r) problems.push(`${a.id} fontId=${a.fontId} 在字體簿查無此戶`);
      else if (r.family !== primary && r.cssAlias !== primary) problems.push(`${a.id} fontId=${a.fontId}（${r.family}${r.cssAlias ? "／" + r.cssAlias : ""}）≠ 配方主字型「${primary}」——簿與配方漂了`);
    }
    if (status === "approved") {
      if (!a.fontId) problems.push(`${a.id}（approved）沒有 fontId——已審字風的主字型必須有戶口`);
      const r = a.fontId ? rec.get(a.fontId) : null;
      if (r && r.license !== "A") problems.push(`${a.id}（approved）主字型 ${a.fontId} license=${r.license}——已審字風的字必須 A 級`);
      if (!loaded.has(primary)) problems.push(`${a.id}（approved）主字型「${primary}」在 typestyles.css／引擎頁沒有載入路（Google css2 或 @font-face）——消費者會看到後備字型`);
    }
  }
  assert.deepStrictEqual(problems, [], "字風 × 字體簿對帳失敗：\n" + problems.join("\n"));
});

test("檢查器自檢：合成 CSS 要抓得到家族、Google 家族、非白名單主機", () => {
  const css = ".a{font-family:'Zen Kaku Gothic New','Noto Sans TC',\"PingFang TC\",sans-serif}.b{font-family:var(--x)}\n" +
    "@import url('https://fonts.googleapis.com/css2?family=Zen+Kaku+Gothic+New:wght@300&family=Huninn&display=swap');\n" +
    "@import url('https://font.emtech.cc/css/GenJyuuGothic');\n" +
    "@font-face{font-family:'Cubic 11';src:url('https://cdn.jsdelivr.net/gh/ACh-K/Cubic-11@1.500/fonts/web/Cubic_11.woff2') format('woff2')}";
  assert.deepStrictEqual([...cssFamilies(css)].sort(), ["Cubic 11", "Noto Sans TC", "PingFang TC", "Zen Kaku Gothic New"]);
  assert.deepStrictEqual([...googleFamilies(css)].sort(), ["Huninn", "Zen Kaku Gothic New"]);
  assert.deepStrictEqual(importHosts(css), ["fonts.googleapis.com", "font.emtech.cc"]);
  assert.deepStrictEqual(fontFaces(css), [{ family: "Cubic 11", hosts: ["cdn.jsdelivr.net"] }]);
});
