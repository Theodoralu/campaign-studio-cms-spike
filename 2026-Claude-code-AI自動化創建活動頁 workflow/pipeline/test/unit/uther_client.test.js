"use strict";
/**
 * D6：UtherClient 與正規化器（不觸網：fetch 注入假伺服器）。
 * 假回應照 uther 文件的範例形狀（Item cell reference、Product Listing、SAS v1）。
 */
const test = require("node:test");
const assert = require("node:assert");
const { createUtherClient } = require("../../core/uther/client");
const nz = require("../../core/uther/normalize");

const item = (id, over = {}) => ({ productId: String(id), title: `商品 ${id}`, propertyCode: "5", marketPrice: "1000.00", stockStatus: "NORMAL", sellerId: "1035",
  productURL: `https://tw.buy.yahoo.com/gdsale/x-${id}.html`,
  productImages: [{ small: { url: `https://s.yimg.com/${id}-s.jpg` }, large: { url: `https://s.yimg.com/${id}-l.jpg`, width: "400", height: "400" } }, { large: { url: `https://s.yimg.com/${id}-2.jpg` } }],
  flags: ["HAS_ACTIVITY"], productActData: ["shopping-mipPrice-789017"], ...over });
const ok = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

function fakeFetch(handler) { const seen = []; const f = async (url) => { seen.push(String(url)); return handler(new URL(url), seen.length); }; f.seen = seen; return f; }

test("normalize：價格規則 currentPrice ?? marketPrice、劃線價只在有活動價時、折數字→數字", () => {
  const a = nz.v3Product(item(1, { currentPrice: "880.00", marketPrice: "1000.00", discountWording: "88折" }));
  assert.deepStrictEqual([a.price, a.marketPrice, a.currentPrice, a.disc, a.discountWording], [880, 1000, 880, 88, "88折"]);
  const b = nz.v3Product(item(2));
  assert.deepStrictEqual([b.price, b.marketPrice, b.currentPrice, b.disc], [1000, null, null, null]);
  assert.strictEqual(nz.discFromWording("9折"), 90); assert.strictEqual(nz.discFromWording("8.5折"), 85); assert.strictEqual(nz.discFromWording(undefined), null);
  assert.deepStrictEqual(a.imgs, ["https://s.yimg.com/1-l.jpg", "https://s.yimg.com/1-2.jpg"]);
  assert.strictEqual(a.actid, "789017"); assert.deepStrictEqual(a.actIds, ["789017"]); assert.strictEqual(a.source, "uther:v3");
  const c = nz.v3Product(item(3, { salesVolume: "150", ratingCount: "19", globalRating: "4.9" }));
  assert.deepStrictEqual([c.salesVolume, c.ratingCount, c.globalRating], [150, 19, 4.9]);
  assert.deepStrictEqual([b.salesVolume, b.ratingCount, b.globalRating], [null, null, null], "uther 不出欄＝null");
});

test("productsByIds：60 切批、查不到的列 missing、productActData 彙整成 actid 表", async () => {
  const fetch = fakeFetch((u) => {
    const ids = u.searchParams.get("productIds").split(",");
    assert.strictEqual(u.pathname, "/api/uther/v3/shopping/products"); assert.strictEqual(u.searchParams.get("spaceId"), "shp_campaign_studio");
    return ok({ products: ids.filter((id) => id !== "13").map((id) => item(id)), productActData: { "shopping-mipPrice-789017": { id: "789017", name: "週年慶", startTs: "2026-10-01T00:00:00Z", endTs: "2026-10-31T15:59:59Z", url: "https://tw.buy.yahoo.com/activity/onsale?actid=789017" } }, status: { code: "200001" } });
  });
  const c = createUtherClient({ fetch });
  const ids = Array.from({ length: 70 }, (_, i) => String(i + 1));
  const r = await c.productsByIds(ids);
  assert.strictEqual(fetch.seen.length, 2, "70 件＝兩批（60＋10）");
  assert.strictEqual(r.items.length, 69); assert.deepStrictEqual(r.missing, ["13"]);
  assert.strictEqual(r.actData["789017"].title, "週年慶"); assert.strictEqual(r.actData["789017"].endTs, Math.floor(Date.parse("2026-10-31T15:59:59Z") / 1000));
});

test("productsByIds：伺服器回 400002（上限）＝降成 10 件重切，只降一次", async () => {
  const fetch = fakeFetch((u) => {
    const n = u.searchParams.get("productIds").split(",").length;
    if (n > 10) return ok({ status: { code: "400002", message: "productIds has max length of 10" } }, 400);
    return ok({ products: u.searchParams.get("productIds").split(",").map((id) => item(id)), status: { code: "200001" } });
  });
  const logs = []; const c = createUtherClient({ fetch, log: (s) => logs.push(s) });
  const r = await c.productsByIds(Array.from({ length: 25 }, (_, i) => String(i + 1)));
  assert.strictEqual(r.items.length, 25);
  assert.strictEqual(fetch.seen.length, 1 + 3, "第一刀 60 被拒＋三批 10");
  assert.ok(logs.some((s) => /400002/.test(s)));
});

test("429：讀 Retry-After 等完重試一次；再 429 就 throw", async () => {
  let n = 0; const waits = [];
  const fetch = fakeFetch(() => (++n === 1 ? ok({ status: { code: "400007" } }, 429, { "retry-after": "2" }) : ok({ products: [item(1)], status: { code: "200001" } })));
  const c = createUtherClient({ fetch, sleep: async (ms) => waits.push(ms) });
  const r = await c.productsByIds(["1"]);
  assert.strictEqual(r.items.length, 1); assert.deepStrictEqual(waits, [2000]);
  const c2 = createUtherClient({ fetch: fakeFetch(() => ok({ status: { code: "400007" } }, 429, { "retry-after": "1" })), sleep: async () => {} });
  await assert.rejects(() => c2.productsByIds(["1"]), /429 連續兩次/);
});

test("5xx：throw 帶 traceId", async () => {
  const c = createUtherClient({ fetch: fakeFetch(() => ok({ status: { code: "500001", message: "Server error", traceId: "T-123" } }, 500)) });
  await assert.rejects(() => c.productsByIds(["1"]), (e) => e.name === "UtherError" && e.traceId === "T-123" && /T-123/.test(e.message));
});

test("idsByStoreId：店內搜尋帶 sort=-sales（近期熱銷）", async () => {
  const fetch = fakeFetch((u) => { assert.strictEqual(u.searchParams.get("sort"), "-sales"); assert.strictEqual(u.searchParams.get("isStoreSearch"), "1"); return ok({ totalhitcount: "1", result: { ecsearch: { hits: [{ ec_productid: "1" }] } } }); });
  const r = await createUtherClient({ fetch }).idsByStoreId("1035");
  assert.deepStrictEqual(r.ids, ["1"]);
});

test("v1：固定關 backfill／refine、分頁到不足一頁為止、只取 ec_productid", async () => {
  const fetch = fakeFetch((u) => {
    assert.strictEqual(u.searchParams.get("isBackfillEnabled"), "0"); assert.strictEqual(u.searchParams.get("isKeywordRefineEnabled"), "0");
    assert.strictEqual(u.searchParams.get("mipIds"), "789017");
    const off = Number(u.searchParams.get("offset")), hits = Number(u.searchParams.get("hits"));
    const all = Array.from({ length: 75 }, (_, i) => ({ ec_productid: String(1000 + i), ec_price: "100" }));
    return ok({ totalhitcount: "75", result: { ecsearch: { hits: all.slice(off, off + hits) } } });
  });
  const c = createUtherClient({ fetch });
  const r = await c.idsByMipId("789017");
  assert.strictEqual(r.ids.length, 75); assert.strictEqual(r.total, 75); assert.strictEqual(fetch.seen.length, 2);
});

test("productsByStoreId：hits 夾在 10 以內、sort 帶過去", async () => {
  const fetch = fakeFetch((u) => { assert.strictEqual(u.searchParams.get("hits"), "10"); assert.strictEqual(u.searchParams.get("sort"), "bestsellingIn7days"); assert.strictEqual(u.searchParams.get("storeId"), "1035");
    return ok({ products: [item(1), item(2)], sellers: [{ id: "1035", name: "Le Creuset 旗艦店" }], status: { code: "200001" } }); });
  const c = createUtherClient({ fetch });
  const r = await c.productsByStoreId("1035", { hits: 50 });
  assert.strictEqual(r.items.length, 2); assert.strictEqual(r.sellers[0].name, "Le Creuset 旗艦店"); assert.strictEqual(r.items[0].source, "uther:v3/getProductsByStoreId");
});
