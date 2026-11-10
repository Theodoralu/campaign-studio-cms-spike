"use strict";
/**
 * core/source/resolve.js —— 來源網址判型（D6）
 *
 * 單機版支援的來源網址型（13 號 §15）→ uther 查詢計畫。純函式，不打網路。
 * 對照表＝docs/campaign-studio-uther.html「來源網址 → 查詢」：
 *   activity  /activity/onsale?actid=549012        → v1 mipIds → v3 by ids
 *   store     /?sub=1000、/act/flagship/1000.html   → v3 getProductsByStoreId（主軸 10）＋ v1 storeIds 補池
 *   search    /search/product?p=烤肉&brandIds=12    → v1 p=（可帶 brandIds／cid）→ v3 by ids
 *   brand     /brands/nike                         → 抓一次品牌頁取 brandId → v1 brandIds → v3 by ids
 *   product   /gdsale/…                            → 只能用於換商品，不能當活動來源（規則不變）→ 擋
 *   其他（純分類頁、外域）                           → 擋
 */
const HOST_RE = /(^|\.)tw\.buy\.yahoo\.com$/;

function resolveSource(rawUrl) {
  let u;
  try { u = new URL(String(rawUrl).trim()); } catch (_) { return { kind: "invalid", reason: "不是合法網址", url: rawUrl }; }
  if (!HOST_RE.test(u.hostname)) return { kind: "invalid", reason: `非法網域：${u.hostname}（僅接受 tw.buy.yahoo.com）`, url: u.href };
  const p = u.pathname, q = u.searchParams;

  if (/\/activity\/onsale/.test(p) && q.get("actid")) return { kind: "activity", actid: q.get("actid"), url: u.href };

  const flagship = p.match(/\/act\/flagship\/(\d+)\.html/);
  if (flagship) return { kind: "store", storeId: flagship[1], url: u.href };
  if ((p === "/" || p === "") && q.get("sub")) return { kind: "store", storeId: q.get("sub"), url: u.href };

  if (/\/search\/product/.test(p) && (q.get("p") || q.get("brandIds") || q.get("cid"))) {
    const extra = {};
    for (const k of ["brandIds", "cid", "flt", "sort", "shoppingCategory"]) if (q.get(k)) extra[k] = q.get(k);
    return { kind: "search", keyword: q.get("p") || "", extra, url: u.href };
  }

  const brand = p.match(/\/brands\/([^/?#]+)/);
  if (brand) return { kind: "brand", slug: decodeURIComponent(brand[1]), url: u.href };

  if (/\/gdsale\//.test(p)) return { kind: "product", reason: "單一商品頁只能用於換商品，不能當活動來源", url: u.href };

  return { kind: "unsupported", reason: "不支援的頁型（分類頁第二階段可走 v1 cid=）", url: u.href };
}

module.exports = { resolveSource };
