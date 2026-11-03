"use strict";
/**
 * 重複商品的「第二處」也要有路標（2026-09-25 無頭瀏覽器走查抓到）。
 *
 * 走白蘭 174314：同一件在樓層 1 商品卡＋樓層 3 情境大圖。修完「框在那幾列」之後實走，
 * 兩層樓的列都框到了——但左樹紅點只亮樓層 1、樓層 3 的區塊外框沒紅。
 * 使用者站在樓層 1 看到一列被框，沒有任何東西叫他去樓層 3 看另一處。
 *
 * 根因同一個形狀：「這件商品在哪一段」只算第一段（sectionOfPath／sectionOfGdid 都回第一個）。
 * 修法＝一份「它在哪幾段」的規則（gdidPlaces），左樹紅點、區塊外框、替換撞號警語都從它取，不各自再抄。
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "../..");
const ui = fs.readFileSync(path.join(ROOT, "workbench/public/index.html"), "utf8");
const SRC = (ui.match(/function gdidPlaces\(g\)\{[\s\S]*?\n\}/) || [])[0];

function places(g, page, products) {
  const draft = { page, products: products || [] };
  const ctx = {
    draft,
    pIdx: (x) => (draft.products || []).findIndex((p) => String(p.gdid) === String(x)),
    manualUrlGdid: (v) => { const m = String(v || "").match(/[-p](\d{6,})\.html|gdid=(\d{6,})/); return m ? (m[1] || m[2]) : null; },
  };
  vm.createContext(ctx);
  vm.runInContext(SRC + "\n;globalThis.__p = gdidPlaces;", ctx);
  return [...ctx.__p(g)].map((p) => ({ sec: p.sec, kind: p.kind }));
}

test("①白蘭的形狀：樓層 1 商品卡＋樓層 3 情境大圖＝兩段都要回、而且分得出是卡還是大圖", () => {
  assert.ok(SRC, "找不到 gdidPlaces");
  const got = places("12090920", {
    kv: { keyProductGdids: [] },
    floors: [
      { productGdids: ["11801245", "11801244", "11801243", "11859702", "12090920"] },
      { productGdids: ["22222222"] },
      { productGdids: ["33333333"], sceneUrl: "https://tw.buy.yahoo.com/gdsale/gdsale.asp?gdid=12090920" },
    ],
    walls: [],
  }, [{ gdid: "12090920", position: "featured-3-scene" }]);
  assert.deepStrictEqual(got, [{ sec: "sec-floor-0", kind: "card" }, { sec: "sec-floor-2", kind: "scene" }]);
});

test("②主視覺／品類牆／編輯精選／本期活動也都算得到（不是只會看樓層）", () => {
  const got = places("777777", {
    kv: { keyProductGdids: ["777777"] },
    floors: [],
    walls: [{ productGdids: ["1", "777777"] }],
    promoEntries: [{ gdid: "777777" }],
  }, [{ gdid: "777777", position: "editorial-wall" }]);
  assert.deepStrictEqual(got, [
    { sec: "sec-kv", kind: "kv" }, { sec: "sec-wall-0", kind: "wall" },
    { sec: "sec-editorial", kind: "editorial" }, { sec: "sec-promo", kind: "promo" },
  ]);
});

test("③左樹紅點：帶貨號的問題＝它在的每一段都亮（原本只亮 sectionOfPath 回的第一段）", () => {
  assert.match(ui, /function updateTreeMarks[\s\S]{0,1200}?if \(f\.ref\.gdid\) gdidPlaces\(f\.ref\.gdid\)\.forEach\(p => gateSecs\.add\(p\.sec\)\)/,
    "updateTreeMarks 要把這件商品在的每一段都加進紅點集合");
});

test("④區塊外框：框到哪一列，那一列所在的區塊就一起亮（情境大圖列沒有 data-path、推不到 box）", () => {
  assert.match(ui, /prodRowsOfGdid\(f\.ref\.gdid\)\.forEach\(r => \{[\s\S]{0,700}?r\.closest\("fieldset"\)[\s\S]{0,120}?has-gate-err/,
    "applyGateMarks 的貨號分支要順手把該列的 fieldset 標紅");
});

test("⑤白話名是從 gdidPlaces 推出來的——「它在哪」的規則只能有一份", () => {
  const names = (ui.match(/function gdidPlaceNames\(g\)\{[\s\S]*?\n\}/) || [])[0];
  assert.ok(names, "找不到 gdidPlaceNames");
  assert.match(names, /gdidPlaces\(g\)/, "要呼叫 gdidPlaces");
  assert.doesNotMatch(names, /pg\.floors|productGdids|sceneUrl/, "不得自己再走一遍樓層／牆＝第二份規則，日後只有一份被維護到");
});
