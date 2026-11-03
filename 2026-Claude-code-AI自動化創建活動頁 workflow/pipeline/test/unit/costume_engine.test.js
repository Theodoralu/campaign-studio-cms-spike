"use strict";
/* design-assets/typestyles/costume-engine.js 單元測試（2026-09-05 換妝接線上）
   守：①配方各自的方向（backdrop 襯字層更深、glow 光暈更淺、outline 深描邊→主色深階、hue 只換色相、keep 空）
      ②「只畫在字裡」偵測認得 Chrome 把 clip 併進簡寫、位置在尺寸之後的寫法（A3 病例）
      ③純字形（一個顏色都沒換到）＝補一條字身吃墨色
      ④字風樣式表每款 --ts-costume 與登記簿 costumeMode 同值（機器寫入、人肉不同步就紅） */
const test = require("node:test"); const assert = require("node:assert/strict"); const fs = require("fs"); const path = require("path");
const ROOT = path.join(__dirname, "..", "..", "..", "..");
const C = require(path.join(ROOT, "design-assets", "typestyles", "costume-engine.js"));
const theme = C.buildTheme({ brand: "#2BA6A0", accent: "#78C2C4" }, "light");
const lum = (hex) => { const c = C.hexToRgb(hex); return (0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b) / 255; };
test("配方方向：backdrop 襯字層比字身深、glow 光暈比字身淺、outline 深描邊→主色深階、keep 空字串", () => {
  assert.ok(lum(theme.shade) < lum(theme.brand) - 0.2, "shade 要明顯深於主色");
  assert.ok(lum(theme.tintBrand) > lum(theme.brand) + 0.2, "tintBrand 要明顯淺於主色");
  assert.ok(lum(theme.shade) < lum(theme.backdrop), "backdrop：字身(shade)要比底紋(backdrop)深");
  assert.ok(lum(theme.backdrop) < 0.82, "底紋襯層不能太淺到看不見（<0.82）");
  const pseudo = { pseudo: true }, base = { pseudo: false };
  assert.match(C.transformBody("backdrop", "background:repeating-linear-gradient(45deg,rgb(244, 168, 175) 0 1px,transparent 1px 3px)", theme, pseudo), new RegExp(theme.backdrop.slice(1), "i")); /* 底紋襯層＝可見淡階（2026-09-05） */
  assert.match(C.transformBody("backdrop", "color: rgb(239, 131, 139)", theme, base), new RegExp(theme.shade.slice(1), "i")); /* 字身＝深 */
  assert.match(C.transformBody("outline", "-webkit-text-stroke: 2px rgb(20, 20, 22)", theme, base), new RegExp(theme.shade.slice(1), "i"), "深描邊→主色深階");
  assert.equal(C.buildCss("css-n7", "keep", theme, []), "", "keep＝不產生任何規則");
  const hueOut = C.transformBody("hue", "color: rgb(73, 243, 255)", theme, base);
  assert.notEqual(hueOut, "color: rgb(73, 243, 255)", "hue 要換色");
});
test("只畫在字裡偵測：明寫 background-clip、簡寫 ') text'、簡寫尺寸後 'text,'（A3）都要抓到；沒有的不抓", () => {
  assert.ok(C.hasClipText("background: linear-gradient(x) text, linear-gradient(y); opacity: .8"));
  assert.ok(C.hasClipText("background: radial-gradient(x) 0px 0px / 0.145em 0.145em text, radial-gradient(y)"));
  assert.ok(C.hasClipText("-webkit-background-clip: text; color: red"));
  assert.ok(!C.hasClipText("color: red; text-shadow: 0 0 1px #fff"), "text-shadow 的 text 不算");
});
test("純字形（沒換到任何顏色）＝補字身吃墨色；有換到＝不補", () => {
  const rules = [{ selectorText: ".hero-font-preview.css-h2", style: { cssText: "font-family: X; letter-spacing: .06em" } }];
  const css = C.buildCss("css-h2", "generic", theme, rules);
  assert.match(css, /\.hero-font-preview\.css-h2\{color:#/);
  const rules2 = [{ selectorText: ".hero-font-preview.css-b3", style: { cssText: "color: rgb(239, 131, 139)" } }];
  assert.doesNotMatch(C.buildCss("css-b3", "backdrop", theme, rules2), /\{color:#[0-9A-F]{6};-webkit-text-fill-color/);
});
test("字風樣式表每款 --ts-costume 與登記簿 costumeMode 同值（沒配方的款不得有變數）", () => {
  const man = JSON.parse(fs.readFileSync(path.join(ROOT, "design-assets", "typestyles", "manifest.json"), "utf8"));
  const css = fs.readFileSync(path.join(ROOT, "design-assets", "typestyles", "typestyles.css"), "utf8");
  for (const a of man.assets) {
    const m = css.match(new RegExp("\\.hero-font-preview\\." + a.id + "\\{([^}]*)\\}"));
    assert.ok(m, a.id + " 沒有 hero 規則");
    const v = (m[1].match(/--ts-costume:([a-z]+)/) || [])[1] || null;
    assert.equal(v, a.costumeMode || null, a.id + " 的 --ts-costume 與登記簿不一致（改登記簿後要重寫樣式表變數）");
  }
});

/* 2026-09-26 使用者裁「乙」：字面跟 Headline、妝跟配方——字面種類判定只有 fillKind 一份 */
test("fillKind：漸層字面（clip text，含寫在 .line 行段的）＝gradient；實色＝solid；透明字面＝hollow；襯字層不算字面；未登記＝solid", () => {
  const Rl = (sel, css) => ({ selectorText: sel, style: { cssText: css } });
  const rules = [
    Rl(".hero-font-preview.css-g1", "color: rgb(46, 54, 99); -webkit-text-stroke: 0.0175em rgb(46, 54, 99); paint-order: stroke fill"),
    Rl(".hero-font-preview.css-g1 .line::before", "background: linear-gradient(rgb(1,2,3), rgb(4,5,6)) text"), // 襯字層有漸層＝妝，不影響字面判定
    Rl(".hero-font-preview.css-b3 .line", "background: linear-gradient(rgb(1,2,3), rgb(4,5,6)) text; -webkit-text-fill-color: transparent"), // 漸層寫在 .line 行段（堆疊款）＝字面
    Rl(".hero-font-preview.css-b2", "background: linear-gradient(rgb(1,2,3), rgb(4,5,6)) text; -webkit-text-fill-color: transparent"),
    Rl(".hero-font-preview.css-n7", "color: rgb(1,1,1)"), Rl(".hero-font-preview.css-n7b", "-webkit-text-fill-color: transparent; -webkit-text-stroke: 1px rgb(0,0,0)"),
    Rl(".font-preview.css-q9", "background-clip: text"),
  ];
  assert.equal(C.fillKind("css-g1", rules), "solid"); assert.equal(C.fillKind("css-b2", rules), "gradient"); assert.equal(C.fillKind("css-b3", rules), "gradient", ".line 上的漸層也是字面");
  assert.equal(C.fillKind("css-n7", rules), "solid", "n7 不能被 n7b 的規則污染"); assert.equal(C.fillKind("css-n7b", rules), "hollow");
  assert.equal(C.fillKind("css-zz", rules), "solid"); assert.equal(C.fillKind("css-q9", rules), "solid", "hero 態不認型錄格規則"); assert.equal(C.fillKind("css-q9", rules, { catalogToo: true }), "gradient");
  assert.equal(C.VERSION, "2026-09-26");
});
