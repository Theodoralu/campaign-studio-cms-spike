"use strict";
/**
 * core/store/truth_fields.js —— 真值欄照伺服器（D11，2026-11-18；14 號 §2.15 第三條）
 *
 * 白話：商品的品名、價格、劃線價、連結、優惠原文是「真值」——只能來自來源（uther／商品頁），畫面不能改。
 * 畫面存檔時，這幾欄一律以伺服器手上那份為準：畫面送來的值跟伺服器不同＝改回伺服器的值，並回報改了哪些。
 * 為什麼要這條：建立期價格對真改了價，使用者畫面上還是舊價，直接存回來就把新價蓋掉（單機版 2026-09-28 病例）。
 *   版本衝突（409）擋的是「整份舊草稿蓋新草稿」；這條擋的是「版本對得上、但真值欄被畫面帶了別的值」。
 *
 * 取值順序：伺服器現存草稿裡同賣場編號的商品 → 來源快照裡同賣場編號的商品 → 都沒有＝不動（發佈前檢查 CP-02 會擋）。
 * 系統自己的寫入（建立、價格對真、換品）不走這條——那些就是真值的來源。
 */
const PRODUCT_TRUTH_FIELDS = ["name", "price", "marketPrice", "url", "offer"];
const same = (a, b) => (a === undefined ? null : a) === (b === undefined ? null : b) || (a == null && b == null);

/** 就地把 incoming.products 的真值欄改回伺服器值；回 corrected: [{ gdid, field, from, to, source }] */
function enforceProductTruth(incoming, { serverDraft = null, snapshot = null } = {}) {
  const corrected = [];
  const byServer = new Map(((serverDraft && serverDraft.products) || []).map((p) => [String(p.gdid), p]));
  const bySnap = new Map(((snapshot && snapshot.products) || []).map((p) => [String(p.gdid), p]));
  for (const p of (incoming && incoming.products) || []) {
    const g = String(p.gdid);
    const src = byServer.get(g) || bySnap.get(g);
    if (!src) continue;
    const source = byServer.has(g) ? "draft" : "snapshot";
    for (const f of PRODUCT_TRUTH_FIELDS) {
      /* 快照的 marketPrice 可能不高於現價（草稿慣例＝原價高於現價才留欄）；快照來源時照草稿慣例取值 */
      let want = src[f];
      if (source === "snapshot" && f === "marketPrice" && !(Number(src.marketPrice) > Number(src.price))) want = undefined;
      if (source === "snapshot" && f === "offer" && want == null) want = p[f]; // 快照沒有 offer 欄＝不判
      if (same(p[f], want)) continue;
      corrected.push({ gdid: g, field: f, from: p[f] === undefined ? null : p[f], to: want === undefined ? null : want, source });
      if (want === undefined) delete p[f]; else p[f] = want;
    }
  }
  return corrected;
}
module.exports = { PRODUCT_TRUTH_FIELDS, enforceProductTruth };
