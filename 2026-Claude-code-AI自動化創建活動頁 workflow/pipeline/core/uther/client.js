"use strict";
/**
 * core/uther/client.js —— UtherClient（D6，2026-11-09）
 *
 * 所有對 EC Search uther API 的呼叫都從這裡出去（其他模組不直接打）。每支端點一個方法；
 * 回傳一律是「正規化後的 item cell」（見 normalize.js），呼叫端不用知道 v1／v3 的差別。
 *
 * 依賴全部注入（規則 4）：fetch、clock、log 由呼叫端給；預設 fetch＝lib/http_replay.fetch，
 * 所以 CS_HTTP_MODE=record|replay 自然生效，正式環境不設就是 globalThis.fetch。
 *
 * 設定（環境變數或 opts）：
 *   UTHER_BASE_URL   預設 https://tw.search.ec.yahoo.com（文件「Host 請參考」那份 Google Doc 沒附；以 Product Listing 範例為準）
 *   UTHER_SPACE_ID   預設 shp_campaign_studio（監控用 GA4 content_group 標籤，不用申請）
 *
 * 行為（依 uther 文件，見 docs/campaign-studio-uther.html）：
 *   - productsByIds：60 件切批；若伺服器回 400002（上限）就降成 10 件重切，只降一次並出聲
 *   - 429：讀 Retry-After（秒），等完重試一次；再 429 就 throw
 *   - 5xx：throw，訊息帶 traceId（給 search team 查）
 *   - v1 查詢一律 isBackfillEnabled=0、isKeywordRefineEnabled=0（商品池不混進「相關」商品）
 *   - 查不到的 id 不在回應裡＝下架（呼叫端自己比對缺了誰）
 */
const path = require("path");
const normalize = require("./normalize");

const DEFAULTS = {
  baseUrl: process.env.UTHER_BASE_URL || "https://tw.search.ec.yahoo.com",
  spaceId: process.env.UTHER_SPACE_ID || "shp_campaign_studio",
  property: "shopping",          // 第一版只做購物中心（propertyCode 5／12）
  batchSize: 60,                 // productIds 上限（正文 60；錯誤表寫 10 是舊資料）
  fallbackBatchSize: 10,
  v1PageSize: 60,                // v1 分頁每頁筆數（psz／hits）
  v1MaxPages: 10,                // 最多翻幾頁（600 件夠任何活動）
  storeTopHits: 10,              // getProductsByStoreId 上限
  timeoutMs: 10000,
};

class UtherError extends Error {
  constructor(message, { status, code, traceId, url } = {}) {
    super(message); this.name = "UtherError"; this.status = status; this.code = code; this.traceId = traceId; this.url = url;
  }
}

function createUtherClient(opts = {}) {
  const cfg = { ...DEFAULTS, ...opts };
  const fetchImpl = opts.fetch || require(path.join(__dirname, "..", "..", "lib", "http_replay")).fetch;
  const log = opts.log || (() => {});
  const sleep = opts.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
  const calls = []; // 本次 client 生命週期打過的請求（給 snapshot.meta 與差異報告用）

  function buildUrl(pathname, params) {
    const u = new URL(pathname, cfg.baseUrl);
    u.searchParams.set("spaceId", cfg.spaceId);
    for (const [k, v] of Object.entries(params)) if (v != null && v !== "") u.searchParams.set(k, String(v));
    return u.toString();
  }

  async function getJson(url, { retried = false } = {}) {
    const t0 = Date.now();
    const res = await fetchImpl(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout ? AbortSignal.timeout(cfg.timeoutMs) : undefined });
    const text = await res.text();
    let body = null; try { body = JSON.parse(text); } catch (_) { /* 非 JSON＝下面當錯誤處理 */ }
    const st = (body && body.status) || {};
    calls.push({ url, status: res.status, code: st.code || null, ms: Date.now() - t0 });
    if (res.status === 429) {
      const wait = Number(res.headers.get("retry-after")) || 1;
      if (retried) throw new UtherError(`uther 429 連續兩次（Retry-After ${wait}s）`, { status: 429, code: st.code, url });
      log(`[uther] 429，${wait}s 後重試：${url}`);
      await sleep(wait * 1000);
      return getJson(url, { retried: true });
    }
    if (res.status >= 500) throw new UtherError(`uther ${res.status} ${st.message || ""}（traceId ${st.traceId || "無"}）`, { status: res.status, code: st.code, traceId: st.traceId, url });
    if (res.status >= 400) throw new UtherError(`uther ${res.status} ${st.code || ""} ${st.message || text.slice(0, 200)}`, { status: res.status, code: st.code, traceId: st.traceId, url });
    if (!body) throw new UtherError(`uther 回應不是 JSON：${text.slice(0, 200)}`, { status: res.status, url });
    return body;
  }

  /* ───────────── v3 ───────────── */

  /** 批次查商品真值：ids → 正規化 item cell[]（查不到的不在裡面）。60 切批，400002 降 10。 */
  async function productsByIds(ids, { batchSize = cfg.batchSize } = {}) {
    const uniq = [...new Set(ids.map(String).filter(Boolean))];
    const out = []; let actData = {}; let sellers = [];
    for (let i = 0; i < uniq.length; i += batchSize) {
      const chunk = uniq.slice(i, i + batchSize);
      const url = buildUrl(`/api/uther/v3/${cfg.property}/products`, { productIds: chunk.join(",") });
      let body;
      try { body = await getJson(url); }
      catch (e) {
        if (e.code === "400002" && batchSize > cfg.fallbackBatchSize) {
          log(`[uther] productIds 上限 ${batchSize} 被拒（400002），降成 ${cfg.fallbackBatchSize} 重切`);
          return productsByIds(ids, { batchSize: cfg.fallbackBatchSize });
        }
        throw e;
      }
      actData = { ...actData, ...(body.productActData || {}) };
      sellers = sellers.concat(body.sellers || []);
      out.push(...normalize.v3Products(body, { endpoint: "v3/products" }));
    }
    return { items: out, actData: normalize.v3ActData(actData), sellers, missing: uniq.filter((id) => !out.some((p) => p.gdid === id)) };
  }

  /** 店家前 10：sort = bestselling | bestsellingIn7days | launchedTime */
  async function productsByStoreId(storeId, { sort = "bestsellingIn7days", hits = cfg.storeTopHits } = {}) {
    const url = buildUrl(`/api/uther/v3/${cfg.property}/getProductsByStoreId`, { storeId, sort, hits: Math.min(hits, cfg.storeTopHits) });
    const body = await getJson(url);
    return { items: normalize.v3Products(body, { endpoint: "v3/getProductsByStoreId" }), actData: normalize.v3ActData(body.productActData), sellers: body.sellers || [] };
  }

  /** 「看更多」筆數（gate CP-22 用；與 SRP 實際數可能不同） */
  async function hitCountByKeyword(q, extra = {}) {
    const url = buildUrl(`/api/uther/v3/${cfg.property}/hitCountByKeyword`, { q, ...extra });
    const body = await getJson(url);
    return Number(body.hitCount ?? body.totalCount ?? 0);
  }

  /* ───────────── v1 SAS（只拿 id 清單；詳細資料回頭走 v3） ───────────── */

  /** 通用 v1 分頁：params 之外固定 property=sas、searchTarget=ecItem、關 backfill／refine */
  async function v1Ids(params, { pageSize = cfg.v1PageSize, maxPages = cfg.v1MaxPages, max = Infinity } = {}) {
    const ids = []; let total = null;
    for (let page = 0; page < maxPages; page++) {
      const url = buildUrl("/api/uther/v1", { property: "sas", searchTarget: "ecItem", isBackfillEnabled: 0, isKeywordRefineEnabled: 0, offset: page * pageSize, hits: pageSize, ...params });
      const body = await getJson(url);
      const got = normalize.v1Ids(body);
      total = body.totalhitcount != null ? Number(body.totalhitcount) : total;
      ids.push(...got);
      if (got.length < pageSize || ids.length >= max || (total != null && ids.length >= total)) break;
    }
    return { ids: [...new Set(ids)].slice(0, max === Infinity ? undefined : max), total };
  }

  const searchByKeyword = (p, extra = {}, o) => v1Ids({ p, ...extra }, o);                  // /search/product?p=
  const idsByBrandIds = (brandIds, o) => v1Ids({ brandIds: [].concat(brandIds).join(",") }, o); // /brands/<slug> → brandId
  const idsByMipId = (actid, o) => v1Ids({ mipIds: String(actid) }, o);                     // /activity/onsale?actid=
  const idsByStoreId = (storeId, o) => v1Ids({ storeIds: String(storeId), isStoreSearch: 1, sort: "-sales" }, o); // /?sub= 旗艦館；-sales＝7 日銷量＋點擊率綜合分（SRP「近期熱銷」）

  return { cfg, calls, productsByIds, productsByStoreId, hitCountByKeyword, searchByKeyword, idsByBrandIds, idsByMipId, idsByStoreId, UtherError };
}

module.exports = { createUtherClient, UtherError, DEFAULTS };
