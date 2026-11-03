"use strict";
/**
 * products[].store 賣場名稱欄（2026-08-26 使用者裁決：促銷卡店名開正式欄——實抓帶入＋可事後編修）
 * hermetic 不觸網；覆蓋整條資料鏈：
 *   ①解析（fetch_parse.extractStoreName）：取值優先序＝旗艦館頭錨點 alt → h1 退位 → 內嵌 state
 *     storeName／JSON-LD seller.name（平台通名「Yahoo購物中心」無賣場辨識度＝視同缺席）；
 *     抓不到＝null（不捏造、不留空字串）——2026-08-26 實抓 5 檔驗證（2 中＝掛旗艦館者、3 缺席）
 *   ②商品頁實抓單一解析點（price_qa.parseProductPage）帶回 store
 *   ③選品實抓（workbench/product_fetch）：有店名＝product.store、沒有＝鍵缺席
 *   ④池 upsert（workbench/content_checks）：add 帶欄／缺席不留欄；sync 跟實抓真值走（含頁面撤賣場頭＝刪欄）
 *   ⑤入列（lib/content_modules pick）：pushProduct 帶 store；無店名＝列上無鍵
 *   ⑥可編修語意：draft 列帶 store 過 validateContentModules（PUT draft.json 同一套閘）＝不被擋
 *     （gate 也不比對 store＝使用者改了以 draft 為準）
 */
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { extractStoreName } = require("../../fetch_parse.js");
const { parseProductPage } = require("../../price_qa.js");
const { createProductFetch } = require("../../workbench/product_fetch.js");
const { upsertPoolEntry, syncPoolEntry } = require("../../workbench/content_checks.js");
const CM = require("../../lib/content_modules");

/* ---------- 合成頁身（形狀照抄 2026-08-26 實抓頁：gdid 12111887） ---------- */
const FLAGSHIP_HTML =
  '<div class="ProductItemPage__flagshipWrapper___39d8B"><div class="FlagshipHeader__mod___15ewj">' +
  '<div class="FlagshipHeader__info___11cVb"><a href="https://tw.buy.yahoo.com/?sub=999" alt="24HRS品牌旗艦館">' +
  '<div class="Image__mod___1FJXk"></div><h1>24HRS品牌旗艦館</h1></a></div></div></div>';
/* 內嵌 state 的 storeName 鍵＝GraphQL 參數形（頁身內引號帶跳脫）＋JSON-LD seller——購物中心恆為平台通名 */
const GENERIC_STATE =
  '"storeName({\\"filters\\":[\\"FILTER_REVERT_YIV\\"]})":"Yahoo 購物中心"' +
  ',"seller":{"@type":"Organization","name":"Yahoo購物中心"}';

/* ═════════ ①extractStoreName：優先序＋通名過濾＋缺席不捏造 ═════════ */
test("extractStoreName：旗艦館頭錨點 alt＝第一優先（頁面實際顯示的賣場頭）", () => {
  assert.strictEqual(extractStoreName(FLAGSHIP_HTML + GENERIC_STATE), "24HRS品牌旗艦館");
});

test("extractStoreName：無錨點 alt＝退 FlagshipHeader 區塊內 <h1> 文字", () => {
  const html = '<div class="FlagshipHeader__mod___zz"><div><h1>某品牌旗艦館</h1></div></div>';
  assert.strictEqual(extractStoreName(html), "某品牌旗艦館");
});

test("extractStoreName：平台通名（storeName／JSON-LD seller 皆「Yahoo購物中心」）＝視同缺席回 null", () => {
  assert.strictEqual(extractStoreName(GENERIC_STATE), null, "通名無賣場辨識度＝不入欄");
  assert.strictEqual(extractStoreName('"seller":{"@type":"Organization","name":"Yahoo 購物中心"}'), null, "帶空白同判");
});

test("extractStoreName：非通名的 seller.name＝可入欄（未來頁型出現真店家名自然生效）", () => {
  assert.strictEqual(extractStoreName('"seller":{"@type":"Organization","name":"某某電器行"}'), "某某電器行");
});

test("extractStoreName：抓不到＝null（空頁／無任何來源＝不捏造、不留空字串）", () => {
  assert.strictEqual(extractStoreName(""), null);
  assert.strictEqual(extractStoreName("<html><body>沒有賣場資料</body></html>"), null);
  assert.strictEqual(extractStoreName(null), null);
});

test("extractStoreName：HTML entity 反跳脫（alt 帶 &amp;）", () => {
  const html = '<div class="FlagshipHeader__info___x"><a href="/x" alt="A&amp;B旗艦館">x</a></div>';
  assert.strictEqual(extractStoreName(html), "A&B旗艦館");
});

/* ═════════ ②parseProductPage：商品頁實抓單一解析點帶回 store ═════════ */
function productPageHtml(gdid, withFlagship) {
  return (withFlagship ? FLAGSHIP_HTML : "") +
    `{"Shopping_Product:${gdid}":{"currentPrice":"1580","marketPrice":"1980","title":"測試商品"}}` +
    GENERIC_STATE;
}

test("parseProductPage：頁面有旗艦館頭＝prod.store 帶賣場名（旗艦館頭在實體切片外＝對整頁抽取）", () => {
  const p = parseProductPage(productPageHtml("12111887", true), "12111887");
  assert.strictEqual(p.store, "24HRS品牌旗艦館");
  assert.strictEqual(p.price, 1580, "價格解析不受店名欄影響");
});

test("parseProductPage：頁面無旗艦館頭（僅平台通名）＝prod.store=null（缺席不捏造）", () => {
  const p = parseProductPage(productPageHtml("12134470", false), "12134470");
  assert.strictEqual(p.store, null);
});

/* ═════════ ③product_fetch：實抓結果帶欄／缺席不留空字串 ═════════ */
const GD = "10309671";
const OG = `https://s.yimg.com/zp/MerchandiseImages/abc-Gd-${GD}.jpg`;
function pfStub(prodOver = {}) {
  return createProductFetch({
    fetchPage: async () => ({ html: `<meta property="og:image" content="${OG}">`, statusCode: 200 }),
    classifyProductLiveness: () => ({ status: "online", prod: Object.assign({ title: "測試品", price: 990, listPrice: 1290 }, prodOver) }),
  });
}

test("productFetch：實抓有店名＝product.store 逐字帶回", async () => {
  const r = await pfStub({ store: "24HRS品牌旗艦館" })({ url: `https://tw.buy.yahoo.com/gdsale/p-${GD}.html` });
  assert.strictEqual(r.code, 200);
  assert.strictEqual(r.product.store, "24HRS品牌旗艦館");
});

test("productFetch：實抓無店名＝product 鍵缺席（不留空字串）", async () => {
  const r = await pfStub({ store: null })({ url: `https://tw.buy.yahoo.com/gdsale/p-${GD}.html` });
  assert.strictEqual(r.code, 200);
  assert.ok(!("store" in r.product), "缺席＝促銷卡不顯示店名列");
});

/* ═════════ ④池 upsert：add 帶欄／sync 跟實抓真值走 ═════════ */
function fetchedProduct(over = {}) {
  return Object.assign({
    gdid: "444", name: "池測試商品", price: 500, marketPrice: 700,
    url: "https://tw.buy.yahoo.com/gdsale/p-444.html",
    imgs: ["https://s.yimg.com/zp/MerchandiseImages/a-Gd-444.jpg"],
  }, over);
}

test("upsertPoolEntry add：實抓有店名＝池列帶 store；沒有＝鍵缺席", () => {
  const snapA = { products: [] };
  upsertPoolEntry(snapA, fetchedProduct({ store: "24HRS品牌旗艦館" }), "R3:test");
  assert.strictEqual(snapA.products[0].store, "24HRS品牌旗艦館");
  const snapB = { products: [] };
  upsertPoolEntry(snapB, fetchedProduct(), "R3:test");
  assert.ok(!("store" in snapB.products[0]), "缺席不留空字串");
});

test("syncPoolEntry：店名變＝同步並記變更；新抓沒有＝刪欄（頁面撤賣場頭＝缺席）；同值＝零變更", () => {
  const snap = { products: [] };
  upsertPoolEntry(snap, fetchedProduct({ store: "舊賣場館" }), "R3:test");
  const exist = snap.products[0];
  const c1 = syncPoolEntry(exist, fetchedProduct({ store: "新賣場館" }));
  assert.ok(c1.some((s) => /store/.test(s)), "變更描述含 store");
  assert.strictEqual(exist.store, "新賣場館");
  const c2 = syncPoolEntry(exist, fetchedProduct());
  assert.ok(c2.some((s) => /store/.test(s)));
  assert.ok(!("store" in exist), "新抓沒有＝刪欄、不留舊值");
  const c3 = syncPoolEntry(exist, fetchedProduct());
  assert.deepStrictEqual(c3, [], "同值（皆缺席）＝零變更");
});

/* ═════════ ⑤入列（content_modules pick）＋⑥可編修語意（PUT 同閘不擋） ═════════ */
function buildRegistry() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "store-field-fixture-"));
  const p = path.join(dir, "modules.json");
  fs.writeFileSync(p, JSON.stringify({ modules: [
    { module_id: "mechanic", variants: [{ variant_id: "info-offer-rows", meaning: "活動資訊卡・優惠卡列", buildSelectable: true }] },
    { module_id: "featured", variants: [
      { variant_id: "spotlight", meaning: "主打選品舞台", buildSelectable: true },
      { variant_id: "promo-card", meaning: "促銷卡", buildSelectable: true },
    ] },
    { module_id: "promo", variants: [{ variant_id: "entry-circles", meaning: "本期活動・圓形入口卡", buildSelectable: true }] },
  ] }));
  return CM.loadContentRegistry({ modules: p });
}
function baseDraft() {
  return { page: { pageName: "測試活動", kv: { titleLine1: "測試" }, floors: [{ title: "樓層一", productGdids: ["111"] }], walls: [] },
    products: [{ gdid: "111", name: "既有商品", price: 100, url: "https://tw.buy.yahoo.com/gdsale/x-111.html", img: "https://s.yimg.com/1.jpg" }] };
}
function pickedProduct(over = {}) {
  return Object.assign({
    gdid: "444", name: "貼稿帶入的新商品", price: 500,
    url: "https://tw.buy.yahoo.com/gdsale/gdsale.asp?gdid=444",
    imgs: ["https://s.yimg.com/zp/MerchandiseImages/a-Gd-444.jpg", "https://s.yimg.com/zp/MerchandiseImages/b-Gd-444.jpg"],
    marketPrice: 700,
  }, over);
}

test("促銷卡 pick：實抓有店名＝新列帶 store（渲染端有 store 才顯示店名列）", () => {
  const reg = buildRegistry();
  const dj = baseDraft();
  CM.applyContentModule(dj, { kind: "promoCard", action: "add" }, reg);
  const r = CM.applyContentModule(dj, { kind: "promoCard", action: "pick", slot: "card-1", product: pickedProduct({ store: "24HRS品牌旗艦館" }) }, reg);
  assert.strictEqual(r.changed, true);
  const row = dj.products.find((p) => p.gdid === "444");
  assert.strictEqual(row.store, "24HRS品牌旗艦館");
  assert.strictEqual(dj.page.promoCards[0].gdid, "444");
});

test("pick：實抓無店名＝新列鍵缺席（不留空字串）；樓層 pick 同帶欄", () => {
  const reg = buildRegistry();
  const dj = baseDraft();
  CM.applyContentModule(dj, { kind: "promoCard", action: "add" }, reg);
  CM.applyContentModule(dj, { kind: "promoCard", action: "pick", slot: "card-1", product: pickedProduct() }, reg);
  assert.ok(!("store" in dj.products.find((p) => p.gdid === "444")), "缺席＝促銷卡不顯示店名列");
  CM.applyContentModule(dj, { kind: "floor", action: "pick", index: 0, product: pickedProduct({ gdid: "555", name: "樓層新商品", store: "某某旗艦館" }) }, reg);
  assert.strictEqual(dj.products.find((p) => p.gdid === "555").store, "某某旗艦館");
});

test("可編修語意：draft 列帶 store（含使用者改過的值）過 validateContentModules 不被擋（PUT draft.json 同一套閘）", () => {
  const reg = buildRegistry();
  const dj = baseDraft();
  dj.products[0].store = "使用者改過的賣場名";
  dj.page.promoCards = [{ capsuleText: "", diagonalText: "", offerLine: "", priceNote: "", gdid: "111" }];
  assert.doesNotThrow(() => CM.validateContentModules(dj.page, reg, dj.products));
});
