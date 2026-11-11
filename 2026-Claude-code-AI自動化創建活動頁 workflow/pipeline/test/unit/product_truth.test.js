"use strict";
/** D7：core/product-truth 純邏輯與兩層（不觸網） */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const rows = require("../../core/product-truth/rows");
const layers = require("../../core/product-truth/layers");
const { createUtherClient } = require("../../core/uther/client");

const clock = { iso: () => "2026-11-11T02:00:00.000Z", unix: () => 1794362400, now: () => 1794362400000 };
const FIX = path.join(__dirname, "..", "fixtures", "runs", "2026-10-27-wb-085823");

test("compareRow：online 同價＝無 drift；價差／劃線價差＝drift；快照落後＝snapDrift；不在快照＝snapMissing", () => {
  const p = { gdid: "1", name: "A", price: 100, marketPrice: 120, url: "u" };
  const ok = rows.compareRow(p, { status: "online", prod: { price: 100, listPrice: 120 }, evidence: {} }, { price: 100, marketPrice: 120 });
  assert.deepStrictEqual([ok.status, ok.drift, ok.marketDrift, ok.snapDrift, ok.snapMissing], ["online", false, false, false, undefined]);
  const d = rows.compareRow(p, { status: "online", prod: { price: 90, listPrice: 120 }, evidence: {} }, { price: 100, marketPrice: 120 });
  assert.deepStrictEqual([d.drift, d.livePrice, d.snapDrift], [true, 90, true]);
  const m = rows.compareRow(p, { status: "online", prod: { price: 100, listPrice: null }, evidence: {} }, { price: 100, marketPrice: 120 });
  assert.deepStrictEqual([m.drift, m.marketDrift, m.draftMarketPrice, m.snapDrift], [true, true, 120, true], "劃線價消失也算變價");
  const s = rows.compareRow(p, { status: "online", prod: { price: 100, listPrice: 120 }, evidence: {} }, undefined, { snapHasPool: true });
  assert.strictEqual(s.snapMissing, true);
  const off = rows.compareRow(p, { status: "offline", prod: null, evidence: { x: 1 } }, undefined);
  assert.deepStrictEqual([off.status, off.livePrice], ["offline", undefined]);
  const un = rows.compareRow(p, null, undefined, { err: Object.assign(new Error("ECONNREFUSED"), { attempts: [{ url: "u" }] }) });
  assert.deepStrictEqual([un.status, un.note, un.evidence], ["unverified", "ECONNREFUSED", { attempts: [{ url: "u" }] }]);
});

test("pageLocator：位置文字與暫存品判定沿 productCheck", () => {
  const dj = { page: { kvVariant: "layout-005", hero: { "product-left": { gdids: ["1", "2"] } }, heroSlotStash: { "product-right": { gdids: ["9"] } }, floors: [{ productGdids: ["3"], sceneUrl: "https://tw.buy.yahoo.com/gdsale/x-7700077.html" }], walls: [{ productGdids: ["4"] }], kv: { keyProductGdids: ["5"] } }, products: [] };
  const L = rows.pageLocator(dj);
  assert.strictEqual(L.whereOf("2"), "主視覺槽 product-left #2"); assert.strictEqual(L.whereOf("3"), "樓層1 卡1"); assert.strictEqual(L.whereOf("4"), "品類牆1 卡1");
  assert.strictEqual(L.whereOf("7700077"), "樓層1 情境代表品"); assert.strictEqual(L.whereOf("9"), "未上場暫存（不出貨）"); assert.strictEqual(L.isStashedOnly("9"), true);
  assert.strictEqual(L.whereOf("5"), "KV 主品 #1（新版式頁休眠）", "v2 頁 kv 休眠");
});

test("summary／blockingCount：暫存品不計主計數；unverified 也擋", () => {
  const s = rows.summary([{ status: "online" }, { status: "online", drift: true }, { status: "offline" }, { status: "unverified" }, { status: "online", stashed: true }]);
  assert.deepStrictEqual(s, { online: 1, drift: 1, offline: 1, dead: 0, unverified: 1, snapMissing: 0, stashed: 1 });
  assert.strictEqual(rows.blockingCount(s, 2), 5);
  assert.match(rows.blockMessage(s, 5, "核可"), /連不上 Yahoo/);
});

test("patchSnapshotPrice：改價、劃線價只在高於現價時保留、重算 minDisc、留稽核行", () => {
  const snap = { products: [{ gdid: "1", price: 100, marketPrice: 200, disc: 50 }, { gdid: "2", price: 80, marketPrice: 100, disc: 80 }], warnings: [] };
  const r = rows.patchSnapshotPrice(snap, snap.products[0], { livePrice: 150, liveMarketPrice: 200 }, "T");
  assert.deepStrictEqual(r, { gdid: "1", price: 150, marketPrice: 200 }); assert.strictEqual(snap.products[0].disc, 75); assert.strictEqual(snap.minDisc, 75);
  rows.patchSnapshotPrice(snap, snap.products[1], { livePrice: 100, liveMarketPrice: 100 }, "T");
  assert.deepStrictEqual([snap.products[1].marketPrice, snap.products[1].disc, snap.minDisc], [null, null, 75]);
  assert.strictEqual(snap.warnings.length, 2); assert.match(snap.warnings[0], /^套用新價：gdid 1 price 100→150/);
});

const item = (id, o = {}) => ({ productId: String(id), title: `P${id}`, marketPrice: "1000", stockStatus: "NORMAL", productURL: `https://tw.buy.yahoo.com/gdsale/p-${id}.html`, productImages: [{ large: { url: "i" } }], ...o });
const ok = (b) => new Response(JSON.stringify(b), { status: 200 });

test("utherLayer：在售／售完／停售／查不到 → online／offline；價格規則同 normalize", async () => {
  const fetch = async (url) => ok({ products: [item(1, { currentPrice: "880", discountWording: "88折" }), item(2, { stockStatus: "OUT_OF_STOCK" }), item(3, { stockStatus: "NO_LONGER_BE_SOLD" }), item(4, { stockStatus: "UNKNOWN" })], status: { code: "200001" } });
  const m = await layers.utherLayer(["1", "2", "3", "4", "5"], { uther: createUtherClient({ fetch }), clock });
  assert.deepStrictEqual([m.get("1").status, m.get("1").prod], ["online", { price: 880, listPrice: 1000, listPriceUnknown: false }]);
  assert.deepStrictEqual(m.get("4").prod, { price: 1000, listPrice: null, listPriceUnknown: true }, "沒活動價＝劃線價未知，不比");
  const un = rows.compareRow({ gdid: "4", price: 1000, marketPrice: 1200 }, m.get("4"), { price: 1000, marketPrice: 1200 });
  assert.deepStrictEqual([un.drift, un.marketDrift, un.snapDrift, un.listPriceUnknown], [false, false, false, true], "uther 層不因劃線價判變價");
  assert.strictEqual(m.get("2").status, "offline"); assert.strictEqual(m.get("3").status, "offline");
  assert.deepStrictEqual([m.get("4").status, !!m.get("4").evidence.note], ["online", true]);
  assert.deepStrictEqual([m.get("5").status, m.get("5").evidence.source], ["offline", "uther"]); assert.match(m.get("5").evidence.note, /查不到/);
});

test("utherLayer：uther 連不上＝整批 throw（連不上不是不在）", async () => {
  const fetch = async () => { throw new Error("ECONNREFUSED"); };
  await assert.rejects(() => layers.utherLayer(["1"], { uther: createUtherClient({ fetch }), clock }), /ECONNREFUSED/);
});

test("pageLayer：逐件走 productLiveness，失敗的件帶 error 不炸整批", async () => {
  const productLiveness = async ({ gdid }) => { if (gdid === "2") throw Object.assign(new Error("timeout"), { attempts: [] }); return { status: "online", prod: { price: 5, listPrice: null }, evidence: { fetchUrl: "u" } }; };
  const m = await layers.pageLayer([{ gdid: "1", url: "" }, { gdid: "2", url: "" }], { productLiveness });
  assert.strictEqual(m.get("1").status, "online"); assert.strictEqual(m.get("2").error.message, "timeout");
});

test("buildCheck：拿黃金 draft＋快照對 uther 層，產出 product_check 形狀並通過 schema", async () => {
  const draft = JSON.parse(fs.readFileSync(path.join(FIX, "draft.golden.json"), "utf8"));
  const snap = JSON.parse(fs.readFileSync(path.join(FIX, "snapshot.replay.json"), "utf8"));
  const gdids = draft.products.map((p) => String(p.gdid));
  // 假 uther：第 1 件漲價、第 2 件查不到、其餘照快照價
  const fetch = async (url) => { const ids = new URL(url).searchParams.get("productIds").split(","); return ok({ products: ids.filter((id) => id !== gdids[1]).map((id) => { const sp = snap.products.find((x) => String(x.gdid) === id); return item(id, { marketPrice: String(id === gdids[0] ? sp.price + 10 : sp.price) }); }), status: { code: "200001" } }); };
  const live = await layers.utherLayer(gdids, { uther: createUtherClient({ fetch }), clock });
  const chk = layers.buildCheck(draft, snap, live, { layer: "uther", clock });
  assert.strictEqual(chk.results.length, draft.products.length);
  assert.strictEqual(chk.results[0].drift, true); assert.strictEqual(chk.results[1].status, "offline");
  assert.strictEqual(chk.summary.drift, 1); assert.strictEqual(chk.summary.offline, 1);
  assert.ok(chk.results.every((r) => r.where !== undefined));
  const os = require("node:os"); const { spawnSync } = require("node:child_process");
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "cs-pc-")), "product_check.json"); fs.writeFileSync(f, JSON.stringify({ checkedAt: chk.checkedAt, summary: chk.summary, results: chk.results, links: [], linksSummary: {} }));
  const v = spawnSync(process.execPath, [path.join(__dirname, "..", "..", "tools", "schema", "validate.js"), path.join(__dirname, "..", "..", "schemas"), f], { encoding: "utf8" });
  assert.strictEqual(v.status, 0, v.stdout + v.stderr);
});
