"use strict";
/**
 * D6：網址判型＋uther 版 snapshot 組裝（不觸網：uther client 用假 fetch），產物要通過 schemas/snapshot.schema.json。
 */
const test = require("node:test");
const assert = require("node:assert");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const { resolveSource } = require("../../core/source/resolve");
const { buildSnapshot } = require("../../core/source/build_snapshot");
const { createUtherClient } = require("../../core/uther/client");

const PIPE = path.resolve(__dirname, "..", "..");
const clock = { unix: () => 1793062704, iso: () => "2026-10-27T00:58:24.018Z", now: () => 1793062704018 };

test("resolveSource：五種網址型判對、外域與商品頁擋下", () => {
  assert.deepStrictEqual(resolveSource("https://tw.buy.yahoo.com/activity/onsale?actid=549012").kind, "activity");
  assert.strictEqual(resolveSource("https://tw.buy.yahoo.com/activity/onsale?actid=549012").actid, "549012");
  assert.deepStrictEqual([resolveSource("https://tw.buy.yahoo.com/?sub=1035").kind, resolveSource("https://tw.buy.yahoo.com/?sub=1035").storeId], ["store", "1035"]);
  assert.strictEqual(resolveSource("https://tw.buy.yahoo.com/act/flagship/1000.html").storeId, "1000");
  const s = resolveSource("https://tw.buy.yahoo.com/search/product?p=烤肉&brandIds=12&sort=-price");
  assert.deepStrictEqual([s.kind, s.keyword, s.extra], ["search", "烤肉", { brandIds: "12", sort: "-price" }]);
  assert.deepStrictEqual([resolveSource("https://tw.buy.yahoo.com/brands/nike").kind, resolveSource("https://tw.buy.yahoo.com/brands/nike").slug], ["brand", "nike"]);
  assert.deepStrictEqual([resolveSource("https://tw.buy.yahoo.com/brands/41168929").kind, resolveSource("https://tw.buy.yahoo.com/brands/41168929").brandId], ["brand", "41168929"]);
  assert.strictEqual(resolveSource("https://tw.buy.yahoo.com/brands/nike").brandId, null);
  assert.strictEqual(resolveSource("https://tw.buy.yahoo.com/gdsale/abc-123.html").kind, "product");
  assert.strictEqual(resolveSource("https://example.com/?sub=1").kind, "invalid");
  assert.strictEqual(resolveSource("https://tw.buy.yahoo.com/category/123").kind, "unsupported");
  assert.strictEqual(resolveSource("not a url").kind, "invalid");
});

/* 假 uther：店家 1035 有 30 件（前 10 熱銷＋v1 補 20），其中 4 件掛活動 789017；活動 796420 已結束 */
const ACT = { "shopping-mipPrice-789017": { id: "789017", name: "Le Creuset 週年慶", subtitle: "滿額贈", startTs: "2026-10-01T00:00:00Z", endTs: "2026-10-31T15:59:59Z", url: "https://tw.buy.yahoo.com/activity/onsale?actid=789017", banner: "https://s.yimg.com/b.jpg" },
              "shopping-mipPrice-796420": { id: "796420", name: "早鳥檔", startTs: "2026-09-01T00:00:00Z", endTs: "2026-09-30T15:59:59Z", url: "https://tw.buy.yahoo.com/activity/onsale?actid=796420" } };
const item = (id) => ({ productId: String(id), title: `鑄鐵鍋 ${id}`, propertyCode: "5", currentPrice: id % 3 === 0 ? "4500" : undefined, marketPrice: "5000", discountWording: id % 3 === 0 ? "9折" : undefined,
  stockStatus: "NORMAL", sellerId: "1035", productURL: `https://tw.buy.yahoo.com/gdsale/lc-${id}.html`, productImages: [{ large: { url: `https://img.yec.tw/${id}.jpg` } }], flags: [],
  productActData: id <= 4 ? ["shopping-mipPrice-789017"] : (id === 5 ? ["shopping-mipPrice-796420"] : []) });
const ok = (b) => new Response(JSON.stringify(b), { status: 200, headers: { "content-type": "application/json" } });
const fakeFetch = async (url) => {
  const u = new URL(url);
  if (u.pathname.endsWith("/getProductsByStoreId")) return ok({ products: Array.from({ length: 10 }, (_, i) => item(i + 1)), status: { code: "200001" } }); // 真實回應：無 sellers、無根 productActData
  if (u.pathname === "/api/uther/v1") { const off = Number(u.searchParams.get("offset")), hits = Number(u.searchParams.get("hits")); const all = Array.from({ length: 30 }, (_, i) => ({ ec_productid: String(i + 1) })); return ok({ totalhitcount: "30", result: { ecsearch: { hits: all.slice(off, off + hits) } } }); }
  if (u.pathname.endsWith("/products")) { const ids = u.searchParams.get("productIds").split(","); return ok({ products: ids.filter((id) => id !== "29").map((id) => item(Number(id))), productActData: ACT, sellers: [{ id: "1035", name: "Le Creuset" }], status: { code: "200001" } }); }
  throw new Error("unexpected " + url);
};

test("store 型：全店商品當池、熱銷只打標記、去重、查不到的列警告、活動由 productActData 彙整、通過 schema", async () => {
  const uther = createUtherClient({ fetch: fakeFetch });
  const snap = await buildSnapshot(resolveSource("https://tw.buy.yahoo.com/?sub=1035"), { uther, clock });
  assert.strictEqual(snap.brand, "Le Creuset", "店家名來自 v3 products 的 sellers[]");
  assert.deepStrictEqual(snap.products.filter((p) => p.bestseller7d).map((p) => p.gdid).sort((x, y) => x - y), ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10"], "熱銷 10 件只是標記");
  assert.strictEqual(snap.meta.totalhitcount, 30);
  assert.strictEqual(snap.products.length, 29, "30 件去重後扣掉 uther 查不到的 29 號");
  assert.ok(snap.warnings.some((w) => /查不到 1 件/.test(w)));
  assert.strictEqual(new Set(snap.products.map((p) => p.gdid)).size, 29, "無重複 gdid");
  const p3 = snap.products.find((p) => p.gdid === "3"); assert.deepStrictEqual([p3.price, p3.marketPrice, p3.disc, p3.discountWording], [4500, 5000, 90, "9折"]);
  const p1 = snap.products.find((p) => p.gdid === "1"); assert.deepStrictEqual([p1.price, p1.marketPrice, p1.actid], [5000, null, "789017"]);
  assert.deepStrictEqual(Object.keys(snap.activities).sort(), ["789017", "796420"]);
  assert.strictEqual(snap.activities["789017"].count, 4); assert.strictEqual(snap.activities["789017"].liveness, "online"); assert.strictEqual(snap.activities["789017"].period, "2026.10.01 ~ 2026.10.31");
  assert.strictEqual(snap.activities["796420"].archived, true);
  assert.strictEqual(snap.promotions[0].actid, "796420", "promotions 依 startTs 排");
  assert.strictEqual(snap.minDisc, 90);
  assert.ok(snap.meta.uther.length >= 3 && snap.meta.uther.every((c) => !/spaceId/.test(c.url)));
  // schema
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cs-uther-snap-")); const f = path.join(dir, "snapshot.json"); fs.writeFileSync(f, JSON.stringify(snap));
  const r = spawnSync(process.execPath, [path.join(PIPE, "tools", "schema", "validate.js"), path.join(PIPE, "schemas"), f], { encoding: "utf8" });
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
});

test("activity 型：v1 mipIds → v3；活動已結束＝警告不擋", async () => {
  const fetch = async (url) => { const u = new URL(url);
    if (u.pathname === "/api/uther/v1") { assert.strictEqual(u.searchParams.get("mipIds"), "796420"); return ok({ totalhitcount: "2", result: { ecsearch: { hits: [{ ec_productid: "5" }, { ec_productid: "6" }] } } }); }
    return ok({ products: [item(5), item(6)], productActData: ACT, status: { code: "200001" } }); };
  const snap = await buildSnapshot(resolveSource("https://tw.buy.yahoo.com/activity/onsale?actid=796420"), { uther: createUtherClient({ fetch }), clock });
  assert.strictEqual(snap.products.length, 2);
  assert.ok(snap.warnings.some((w) => /活動 796420 已結束/.test(w)));
  assert.ok(snap.warnings.some((w) => /＜24/.test(w)));
});

test("brand 型：先取 brandId 再 v1 brandIds；取不到＝出聲失敗", async () => {
  const fetch = async (url) => { const u = new URL(url);
    if (u.pathname === "/api/uther/v1") { assert.strictEqual(u.searchParams.get("brandIds"), "12,34"); return ok({ totalhitcount: "1", result: { ecsearch: { hits: [{ ec_productid: "7" }] } } }); }
    return ok({ products: [item(7)], status: { code: "200001" } }); };
  const plan = resolveSource("https://tw.buy.yahoo.com/brands/le-creuset");
  const snap = await buildSnapshot(plan, { uther: createUtherClient({ fetch }), clock, fetchBrandId: async () => ({ brandIds: ["12", "34"], brandName: "Le Creuset" }) });
  assert.strictEqual(snap.brand, "Le Creuset"); assert.deepStrictEqual(snap.meta.brandIds, ["12", "34"]); assert.strictEqual(snap.products.length, 1);
  await assert.rejects(() => buildSnapshot(plan, { uther: createUtherClient({ fetch }), clock, fetchBrandId: async () => ({ brandIds: [] }) }), /取不到 brandId/);
});
