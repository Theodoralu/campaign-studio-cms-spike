"use strict";
/**
 * 換品的排除清單要認得情境卡（2026-09-25 使用者裁「甲」）。
 *
 * 病例（程式實跑證實，非推論）：前端「頁面上已有哪些商品」（usedGdidSet）靠 sectionOfGdid 判「在頁面上」，
 * 而它不認情境卡代表品 ⇒ 每一層的情境卡商品都不在排除清單裡；後端 product-fetch 只信前端送來的清單
 *（請求沒有活動編號、它自己算不了）⇒ 使用者可以把樓層 1 的情境卡換成「樓層 3 情境卡那一件」＝
 * 兩張都不能刪、內容相同。09-24 修了 lib 與 server 兩份「它在頁面上嗎」，這是第三份沒同步的複本（鐵律 4）。
 *
 * 修法＝「它在哪」只留 gdidPlaces 一份：usedGdidSet 從它推；sectionOfGdid 的情境卡分支也走它。
 * 本檔把三支函式抽出來注入假草稿實跑，不比對字串。
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "../..");
const ui = fs.readFileSync(path.join(ROOT, "workbench/public/index.html"), "utf8");
const grab = (name) => { const m = ui.match(new RegExp("function " + name + "\\([^)]*\\)\\{[\\s\\S]*?\\n\\}")); assert.ok(m, "抽不到 " + name); return m[0]; };
const SRC = ["gdidPlaces", "sectionOfGdid", "usedGdidSet"].map(grab).join("\n");

/** 兩層樓各有情境卡（9001、9003）＋商品卡；主視覺 1；牆 5。 */
function env(extraPage) {
  const draft = {
    page: Object.assign({
      kv: { keyProductGdids: ["1"] },
      floors: [
        { productGdids: ["2", "3"], sceneUrl: "https://tw.buy.yahoo.com/gdsale/gdsale.asp?gdid=9001" },
        { productGdids: ["4"], sceneUrl: "https://tw.buy.yahoo.com/gdsale/gdsale.asp?gdid=9003" },
      ],
      walls: [{ productGdids: ["5"] }],
      promoEntries: [], explore: { items: [] }, editorial: { circles: [] },
    }, extraPage || {}),
    products: [
      { gdid: "1", position: "kv" }, { gdid: "2", position: "featured-1" }, { gdid: "3", position: "featured-1" },
      { gdid: "9001", position: "featured-1-scene" }, { gdid: "4", position: "featured-2" },
      { gdid: "9003", position: "featured-2-scene" }, { gdid: "5", position: "wall-1" },
      { gdid: "7777", position: "hero" }, { gdid: "8888", position: "spotlight" },
    ],
  };
  const ctx = {
    draft,
    pIdx: (g) => draft.products.findIndex((p) => String(p.gdid) === String(g)),
    manualUrlGdid: (v) => { const m = String(v || "").match(/gdid=(\d+)|[-p](\d{6,})\.html/); return m ? (m[1] || m[2]) : null; },
  };
  vm.createContext(ctx);
  vm.runInContext(SRC + "\n;globalThis.__used=usedGdidSet;globalThis.__sec=sectionOfGdid;globalThis.__pl=gdidPlaces;", ctx);
  return ctx;
}

test("①換品排除清單要含每一層的情境卡商品（原本 9001／9003 都不在＝可以換成同一件）", () => {
  const used = [...env().__used()];
  assert.ok(used.includes("9001"), "樓層 1 情境卡要在排除清單：" + JSON.stringify(used));
  assert.ok(used.includes("9003"), "樓層 2 情境卡要在排除清單：" + JSON.stringify(used));
});

test("②原本認得的曝光面一個都不能掉（主視覺／樓層卡／牆／主視覺槽位／主打選品／促銷卡）", () => {
  const ctx = env({
    hero: { "product-main": { gdids: ["7777"] } },
    spotlight: { heroCard: { gdid: "8888" }, productRefs: [] },
    promoCards: [{ gdid: "5" }],
  });
  const used = [...ctx.__used()];
  for (const g of ["1", "2", "3", "4", "5", "7777", "8888"]) assert.ok(used.includes(g), "要在：" + g + "；實得 " + JSON.stringify(used));
});

test("③不在頁面上的商品不得被排除（池裡有、頁上沒有＝要能換回來；CT-1 語意不變）", () => {
  const ctx = env();
  ctx.draft.products.push({ gdid: "6666", position: "featured-3" }); // 刪層留池：清單裡有、頁面上沒有
  assert.ok(![...ctx.__used()].includes("6666"), "池品不是頁品，不能擋");
});

test("④sectionOfGdid 認得情境卡＝回它所在的樓層（「前往」與紅點才找得到它；孤兒判定也不再誤判）", () => {
  const ctx = env();
  assert.equal(ctx.__sec("9001"), "sec-floor-0");
  assert.equal(ctx.__sec("9003"), "sec-floor-1");
  assert.equal(ctx.__sec("2"), "sec-floor-0", "原本的商品卡判定不變");
  assert.equal(ctx.__sec("nope"), null);
});

test("⑤「它在哪」只有一份規則：usedGdidSet 與 sectionOfGdid 的情境卡判定都走 gdidPlaces", () => {
  assert.match(grab("usedGdidSet"), /gdidPlaces\(String\(p\.gdid\)\)\.length/, "usedGdidSet 要從 gdidPlaces 推");
  assert.doesNotMatch(grab("usedGdidSet"), /sectionOfGdid\(/, "不再經導航用的 sectionOfGdid");
  assert.match(grab("sectionOfGdid"), /gdidPlaces\(g\)\.find\(p => p\.kind === "scene"\)/, "情境卡分支走 gdidPlaces");
  assert.match(grab("gdidPlaces"), /kind: "hero"[\s\S]*kind: "spotlight"[\s\S]*kind: "promoCard"/, "gdidPlaces 要涵蓋原本 sectionOfGdid 認得的每一種曝光面");
});
