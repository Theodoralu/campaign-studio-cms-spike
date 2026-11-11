"use strict";
/**
 * core/source/build_snapshot.js —— 來源網址 → uther 商品池 → snapshot（D6）
 *
 * 取代 fetch_parse.js「爬網頁」那一條：輸入同樣是一個網址，輸出同樣是 snapshot.json（通過 schemas/snapshot.schema.json），
 * 下游（curate_auto、gate）不用改。純函式＋注入：uther client、品牌頁抓取（只有 brand 型要）、時鐘都由呼叫端給。
 *
 * 查詢鏈（docs/campaign-studio-uther.html）：
 *   activity：v1 mipIds=<actid> 取 id → v3 by ids；活動資訊取 productActData；endTs 已過＝警告「活動已結束」（不擋，交 gate CP-02／liveness 判）
 *   store   ：v1 storeIds=&isStoreSearch=1&sort=-sales 全店商品依熱銷排（上限 MAX_POOL）＝池子；v3 getProductsByStoreId 7 日熱銷 10 件只拿來打 bestseller7d 標記，不另成池
 *             （2026-11-09 裁：MIP 活動非每個品牌都用、熱銷 10 件太窄，池子以全店商品為準；「全站重選＋AI 判分類」留第二階段）
 *   search  ：v1 p=（關 backfill）→ v3 by ids
 *   brand   ：抓一次品牌頁取 brandId → v1 brandIds= → v3 by ids
 * 池量：第一版沿用單機版守門 ≥24 件（gate 另有判）；不足只警告。
 *
 * snapshot 與舊版的差異（刻意，見 docs/uther-D6.md 差異報告）：
 *   - products[].source = "uther:<endpoint>"；新增 discountWording／stockStatus／flags／actIds／sellerId
 *   - disc 由 discountWording 換算，不再自己算
 *   - promotions[]／activities{} 由 productActData 彙整（不再抓活動頁 HTML）；period 字串格式沿用「YYYY.MM.DD ~ YYYY.MM.DD」
 *   - hits[]／subcatDist 由 filterTags 無法對應舊分類 → 第一版留空陣列／空物件（策展用 filterTags 是 D8 的事）
 *   - meta.uther：打了哪些請求（錄製回放對照用）
 */
const TPE_OFFSET_MS = 8 * 3600 * 1000;
const fmtTs = (unix) => { const d = new Date(unix * 1000 + TPE_OFFSET_MS); const p = (n) => String(n).padStart(2, "0"); return `${d.getUTCFullYear()}.${p(d.getUTCMonth() + 1)}.${p(d.getUTCDate())}`; };
const MIN_POOL = 24;
const MAX_POOL = 120; // 全店商品取前 120 件（v1 兩頁）；規則版策展最多用到 ~60，餘池給換品

async function buildSnapshot(plan, { uther, clock, fetchBrandId, log = () => {} }) {
  const now = clock.unix();
  const snapshot = { sourceUrl: plan.url, fetchedAt: clock.iso(), brand: null, promotions: [], activities: {}, products: [], hits: [], warnings: [], subcatDist: {}, minDisc: null,
    meta: { source: "uther", kind: plan.kind, uther: null } };
  const warn = (s) => { snapshot.warnings.push(s); log(`warning: ${s}`); };

  let ids = [], seed = [], actData = {}, bestsellers = new Set();
  if (plan.kind === "activity") {
    const r = await uther.idsByMipId(plan.actid, { max: MAX_POOL });
    ids = r.ids; snapshot.meta.totalhitcount = r.total;
    if (!ids.length) warn(`活動 ${plan.actid} 在 uther 查無商品（v1 mipIds）＝活動不存在、已結束或未開始`);
  } else if (plan.kind === "store") {
    const r = await uther.idsByStoreId(plan.storeId, { max: MAX_POOL });
    ids = r.ids; snapshot.meta.totalhitcount = r.total;
    if (!ids.length) warn(`店家 ${plan.storeId} 在 uther 店內搜尋查無商品`);
    try { const top = await uther.productsByStoreId(plan.storeId, { sort: "bestsellingIn7days" }); bestsellers = new Set(top.items.map((p) => p.gdid)); actData = { ...actData, ...top.actData }; }
    catch (e) { warn(`店家熱銷查詢失敗（${e.message}）＝不打 bestseller7d 標記，池子不受影響`); }
  } else if (plan.kind === "search") {
    const r = await uther.searchByKeyword(plan.keyword, plan.extra, { max: MAX_POOL });
    ids = r.ids; snapshot.meta.totalhitcount = r.total;
    if (!ids.length) warn(`關鍵字「${plan.keyword}」在 uther 查無商品（已關 backfill）`);
  } else if (plan.kind === "brand") {
    const b = plan.brandId ? { brandIds: [plan.brandId], brandName: null } : await fetchBrandId(plan);
    if (!b || !b.brandIds || !b.brandIds.length) throw new Error(`品牌頁 ${plan.url} 取不到 brandId（頁面結構變了？）`);
    snapshot.brand = b.brandName || (plan.brandId ? null : plan.slug); snapshot.meta.brandIds = b.brandIds; // 數字 slug 不是名字，下面從 filterTags 推
    const r = await uther.idsByBrandIds(b.brandIds, { max: MAX_POOL });
    ids = r.ids; snapshot.meta.totalhitcount = r.total;
  } else {
    throw new Error(plan.reason || `不支援的來源：${plan.kind}`);
  }

  // 全部經 v3 by ids 補齊 item cell（seed 已是 item cell；其餘補）
  let items = [...seed]; let lastV3 = null;
  if (ids.length) {
    const r = await uther.productsByIds(ids); lastV3 = r;
    items.push(...r.items); actData = { ...actData, ...r.actData };
    if (r.missing.length) warn(`uther v3 查不到 ${r.missing.length} 件（＝下架／隱形／過期，預設過濾）：${r.missing.slice(0, 10).join(",")}${r.missing.length > 10 ? "…" : ""}`);
  }
  // 去重、有名有價有圖才入池（curate 同一條規則，這裡先擋掉連真值都缺的）
  const seen = new Set();
  snapshot.products = items.filter((p) => { if (seen.has(p.gdid)) return false; seen.add(p.gdid); return true; });
  if (bestsellers.size) for (const p of snapshot.products) if (bestsellers.has(p.gdid)) p.bestseller7d = true;
  /* brand 欄語意（2026-11-11）：店家型＝店名（sellers[0]）；品牌型＝商品 filterTags「品牌」的多數值（slug 若是數字就不能當名字）；
     活動型＝店名（活動屬於一家店）；搜尋型＝null（跨店，寫店名會誤導） */
  if (!snapshot.brand && plan.kind !== "search") {
    const sellerOf = (r) => r && r.sellers && r.sellers[0] && r.sellers[0].name;
    if (plan.kind === "brand") { const cnt = new Map(); for (const p of snapshot.products) for (const v of ((p.filterTags || {})["品牌"] || [])) cnt.set(v, (cnt.get(v) || 0) + 1); snapshot.brand = [...cnt.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || sellerOf(lastV3) || null; }
    else snapshot.brand = sellerOf(lastV3) || null;
  }
  const noPrice = snapshot.products.filter((p) => p.price == null).length;
  if (noPrice) warn(`${noPrice} 件無 currentPrice 也無 marketPrice（uther 不出欄）＝進池但策展會略過`);

  // 活動資訊：productActData 彙整 → promotions[]（沿舊形狀）＋ activities{}
  for (const [actid, a] of Object.entries(actData)) {
    const period = a.startTs && a.endTs ? `${fmtTs(a.startTs)} ~ ${fmtTs(a.endTs)}` : null;
    snapshot.promotions.push({ actid, title: a.title, short: a.subtitle, startTs: a.startTs, endTs: a.endTs, period, url: a.url || `https://tw.buy.yahoo.com/activity/onsale?actid=${actid}`, banner: a.banner });
    const count = snapshot.products.filter((p) => p.actIds && p.actIds.includes(actid)).length;
    snapshot.activities[actid] = { meta: { resultsTotal: null }, count, title: a.title, period, startTs: a.startTs, endTs: a.endTs,
      pageStartTs: a.startTs, pageEndTs: a.endTs, pagePeriod: period, liveness: a.endTs && a.endTs < now ? "archived" : "online", archived: !!(a.endTs && a.endTs < now) };
  }
  snapshot.promotions.sort((x, y) => (x.startTs || 0) - (y.startTs || 0));
  if (plan.kind === "activity" && snapshot.activities[plan.actid] && snapshot.activities[plan.actid].archived) warn(`活動 ${plan.actid} 已結束（endTs ${snapshot.activities[plan.actid].endTs}）`);

  if (!snapshot.products.length) warn("來源在 uther 抓不到任何可入池商品——此來源不支援策展，請改貼品牌頁或活動賣場網址");
  else if (snapshot.products.length < MIN_POOL) warn(`商品池 ${snapshot.products.length} 件＜${MIN_POOL}（池量守門），策展可能湊不滿樓層`);

  const discs = snapshot.products.map((p) => p.disc).filter((d) => d && d > 0 && d < 100);
  snapshot.minDisc = discs.length ? Math.min(...discs) : null;
  snapshot.meta.uther = uther.calls.map((c) => ({ url: c.url.replace(/spaceId=[^&]*&?/, ""), status: c.status, code: c.code }));
  return snapshot;
}

module.exports = { buildSnapshot, MIN_POOL, MAX_POOL, fmtTs };
