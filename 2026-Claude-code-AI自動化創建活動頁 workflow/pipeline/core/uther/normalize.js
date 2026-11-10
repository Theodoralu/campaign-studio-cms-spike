"use strict";
/**
 * core/uther/normalize.js —— uther 回應 → snapshot.products[] 形狀（D6）
 *
 * 真值鐵律（04 號）在這裡落地：價格、劃線價、折數文字、網址、品名、活動起訖一律從 item cell 帶出，不改寫。
 * 欄位對照依 docs/campaign-studio-uther.html「v3 item cell 對照」：
 *   gdid        ← productId
 *   name        ← title
 *   price       ← currentPrice ?? marketPrice（實付）
 *   marketPrice ← 有 currentPrice 時的 marketPrice（劃線價）；沒有活動價＝null（不劃線）
 *   currentPrice← currentPrice（原樣保留，供對照）
 *   disc        ← 由 discountWording「97折」換算成 97；沒折扣＝null（舊爬頁版自己算，這裡用 uther 的字）
 *   discountWording ← 原字（新欄）
 *   url         ← productURL
 *   imgs[]      ← productImages[].large.url（順序照 uther）
 *   desc[]      ← description 以三個全形空白切段（舊版慣例）
 *   stockStatus ← stockStatus（新欄：NORMAL／PRIORITY_DISPLAY／OUT_OF_STOCK／NO_LONGER_BE_SOLD／UNKNOWN）
 *   flags[]     ← flags（新欄）
 *   actid       ← productActData[0] 的 id（uniqueId「shopping-<type>-<id>」取最後一段）
 *   actIds[]    ← 全部活動 id（新欄）
 *   sellerId    ← sellerId（新欄）
 *   salesVolume／ratingCount／globalRating ← 同名（新欄；2026-11-10 裁：先存數字、策展排序 D8 才動）
 *   source      ← "uther:<endpoint>"
 * uther 的數字都是字串（"488.00"），這裡轉成整數元（購中沒有小數）。
 */

const toInt = (v) => { if (v == null || v === "") return null; const n = Math.round(Number(v)); return Number.isFinite(n) ? n : null; };
const discFromWording = (w) => { const m = /(\d+(?:\.\d+)?)\s*折/.exec(String(w || "")); if (!m) return null; const n = Number(m[1]); return n < 10 ? Math.round(n * 10) : Math.round(n); }; // 「9折」→90、「97折」→97、「8.5折」→85
const actIdOf = (uniqueId) => { const s = String(uniqueId || ""); const i = s.lastIndexOf("-"); return i >= 0 ? s.slice(i + 1) : s; };

function v3Product(p, { endpoint } = {}) {
  const current = toInt(p.currentPrice), market = toInt(p.marketPrice);
  const acts = Array.isArray(p.productActData) ? p.productActData : [];
  return {
    gdid: String(p.productId),
    name: p.title || "",
    desc: p.description ? String(p.description).split(/　{3}/).map((s) => s.trim()).filter(Boolean) : [],
    price: current ?? market,
    currentPrice: current,
    marketPrice: current != null ? market : null,
    disc: discFromWording(p.discountWording),
    discountWording: p.discountWording || null,
    url: p.productURL || "",
    imgs: (p.productImages || []).map((im) => im && im.large && im.large.url).filter(Boolean),
    stockStatus: p.stockStatus || "UNKNOWN",
    flags: p.flags || [],
    actid: acts.length ? actIdOf(acts[0]) : "",
    actIds: acts.map(actIdOf),
    sellerId: p.sellerId || null,
    salesVolume: toInt(p.salesVolume),
    ratingCount: toInt(p.ratingCount),
    globalRating: p.globalRating != null && p.globalRating !== "" ? Number(p.globalRating) : null,
    offer: null,
    source: `uther:${endpoint || "v3"}`,
  };
}

const v3Products = (body, o) => (body && Array.isArray(body.products) ? body.products.map((p) => v3Product(p, o)) : []);

/** 根物件 productActData（Map<uniqueId, 活動>）→ 以 actid 為鍵的活動表（snapshot.activities 形狀） */
function v3ActData(map) {
  const out = {};
  for (const [uid, a] of Object.entries(map || {})) {
    const id = actIdOf(a.id || uid);
    out[id] = { uniqueId: uid, title: a.name || null, subtitle: a.subtitle || null, banner: a.banner || null, url: a.url || null,
      startTs: a.startTs ? Math.floor(Date.parse(a.startTs) / 1000) : null, endTs: a.endTs ? Math.floor(Date.parse(a.endTs) / 1000) : null,
      activityType: a.activityType || null, propertyActivityType: a.propertyActivityType || null };
  }
  return out;
}

/** v1 SAS：只取 id（result.ecsearch.hits[].ec_productid） */
function v1Ids(body) {
  const hits = (((body || {}).result || {}).ecsearch || {}).hits;
  return Array.isArray(hits) ? hits.map((h) => String(h.ec_productid || h.productId || "")).filter(Boolean) : [];
}

module.exports = { v3Product, v3Products, v3ActData, v1Ids, discFromWording, actIdOf, toInt };
