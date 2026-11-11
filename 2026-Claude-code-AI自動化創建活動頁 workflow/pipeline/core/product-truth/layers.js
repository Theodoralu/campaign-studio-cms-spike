"use strict";
/**
 * core/product-truth/layers.js —— 價格真值兩層（D7；計畫 P30）
 *
 *   第一層 utherLayer ：建立、換品、批次對價。一次 v3 by ids 查全部（60 切批），快、不打 Yahoo 頁面；
 *                       但 uther 最多落後 12 小時（feeding 03:00／15:00＋快取 1h）。
 *   第二層 pageLayer  ：核可與製作 AEM 檔前。逐件抓商品頁（沿 probeProductLiveness＝兩種拼法都問過才判死），慢但是當下真值。
 *
 * 兩層都吐同一種「活體結果」{ status, prod: {price, listPrice}|null, evidence }，交給 rows.compareRow 變成狀態列；
 * 呼叫端（D11 的 jobs）只選層，不分來源。注入：uther client、productLiveness（page 層）、clock。
 *
 * 劃線價（2026-11-11 交叉驗證 20 件實證）：uther v3 只有 currentPrice／marketPrice，marketPrice＝Yahoo 網路價；
 *   商品頁劃掉的「市價／廠商建議售價」uther 沒有這個欄位。所以 uther 層的 listPrice 只在有活動價時可信（＝網路價），
 *   其餘標 listPriceUnknown＝不比劃線價（否則 19／20 件全被判 marketDrift）。劃線價真值只有商品頁層能給——舊爬頁版也是建立期對價才填上。
 *
 * uther 層的狀態判定（item cell → 三態）：
 *   查得到且 stockStatus ∈ {NORMAL, PRIORITY_DISPLAY}      → online（price＝currentPrice ?? marketPrice；listPrice＝有活動價時的 marketPrice）
 *   查得到但 stockStatus ∈ {OUT_OF_STOCK, NO_LONGER_BE_SOLD} → offline（售完補貨中／停售＝不出貨）
 *   查不到（uther 預設過濾：下架、過期、隱形、測試店）        → offline；evidence.note 說明
 *   UNKNOWN                                                 → online 但 evidence.note 標註（不擋，交人看）
 *   uther 連不上／5xx                                        → 整批 unverified（throw 給呼叫端，與頁面層「連不上不是不在」同義）
 */
const { compareRow, pageLocator, summary } = require("./rows");

const ONLINE_STOCK = new Set(["NORMAL", "PRIORITY_DISPLAY", "UNKNOWN"]);

/** 第一層：uther。回 Map<gdid, live> */
async function utherLayer(gdids, { uther, clock }) {
  const r = await uther.productsByIds(gdids);
  const fetchedAt = clock.iso();
  const byId = new Map(r.items.map((it) => [it.gdid, it]));
  const out = new Map();
  for (const g of gdids.map(String)) {
    const it = byId.get(g);
    if (!it) { out.set(g, { status: "offline", prod: null, evidence: { source: "uther", fetchedAt, note: "uther 查不到＝下架／過期／隱形（預設過濾）" } }); continue; }
    const online = ONLINE_STOCK.has(it.stockStatus);
    out.set(g, {
      status: online ? "online" : "offline",
      prod: online ? { price: it.price, listPrice: it.marketPrice || null, listPriceUnknown: it.currentPrice == null } : null,
      evidence: { source: "uther", fetchedAt, stockStatus: it.stockStatus, fetchUrl: it.url, ...(it.stockStatus === "UNKNOWN" ? { note: "uther stockStatus=UNKNOWN，請人看一眼" } : {}) },
    });
  }
  return out;
}

/** 第二層：商品頁。productLiveness＝server 的 probeProductLiveness 綁好 fetchPage／classifyProductLiveness；mapPool 可注入（並行） */
async function pageLayer(products, { productLiveness, mapPool, gdidOf }) {
  const run = async (p) => {
    const entityId = (gdidOf && gdidOf(p.url || "")) || String(p.gdid);
    try { const live = await productLiveness({ gdid: entityId, url: p.url }); return [String(p.gdid), live]; }
    catch (e) { return [String(p.gdid), { error: e }]; }
  };
  const pairs = mapPool ? await mapPool(products, run, { concurrency: 5, minGapMs: 250 }) : await Promise.all(products.map(run));
  return new Map(pairs);
}

/**
 * 把一層的活體結果對上草稿與快照 → product_check 形狀 { results, summary, checkedAt, layer }
 * @param {object} draft  draft.json
 * @param {object|null} snapshot snapshot.json（null＝無快照：不比快照）
 * @param {Map<string, object>} liveMap  utherLayer／pageLayer 的結果
 */
function buildCheck(draft, snapshot, liveMap, { layer, clock }) {
  const loc = pageLocator(draft);
  const snapByGdid = new Map(((snapshot && snapshot.products) || []).map((x) => [String(x.gdid), x]));
  const results = (draft.products || []).filter((p) => p && p.gdid).map((p) => {
    const live = liveMap.get(String(p.gdid));
    const err = live && live.error ? live.error : null;
    return compareRow(p, err ? null : live, snapByGdid.get(String(p.gdid)), { whereOf: loc.whereOf, isStashedOnly: loc.isStashedOnly, snapHasPool: snapByGdid.size > 0, err });
  });
  return { checkedAt: clock.iso(), layer, results, summary: summary(results) };
}

module.exports = { utherLayer, pageLayer, buildCheck, ONLINE_STOCK };
