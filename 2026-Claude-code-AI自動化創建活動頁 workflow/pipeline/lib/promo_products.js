"use strict";
/**
 * lib/promo_products.js —— 本期活動「商品型入口」的商品要進 draft.products（純函式、零 I/O、可單元測試）
 *
 * 為什麼有這支（2026-09-04 復發病例，run 2026-09-04-wb-164258）：
 *   主打選品舞台皮的大卡與右欄卡靠 gdid 回查 draft.products[] 取真值價與特色標；入口若只存 {gdid,圖,連結,文案}、
 *   商品沒進清單＝渲染退到「無價格」簡化分支。2026-08-30 已在 promo-recompose 補「收進 products[]」——
 *   但那段碼的守門條件是 `src.price == null ⇒ continue`，而它拿到的候選項是 promoLayerOptions 的 prodItem
 *   （只剩 gdid/name/img/url 四欄、價格被剝掉）＝條件永遠不成立、每一件都被靜靜跳過。**修好的碼在等一個永遠不會來的欄位。**
 *   這支把「候選項要帶哪些真值欄」與「補入清單」做成同一份、互相咬合的純函式，並讓跳過的每一件都出聲。
 *
 * 真值鐵律：price/marketPrice/name/url/img 一律來自 snapshot（來源實抓），本檔只搬運不生成；
 *   收進 products[] 而非在入口另存價格＝價格照樣受 CP-02 逐字驗證。
 */

/** snapshot 商品 → 入口候選項（帶完整真值欄；promoLayerOptions 的 brand-recommend／product-fallback 兩層同吃） */
function promoPoolItem(p) {
  if (!p || p.gdid == null) return null;
  const imgs = Array.isArray(p.imgs) ? p.imgs.filter(Boolean) : [];
  return {
    gdid: String(p.gdid), name: p.name || "", img: imgs[0] || p.img || "", url: p.url || "",
    price: p.price != null ? p.price : null,
    marketPrice: p.marketPrice != null ? p.marketPrice : null,
    imgs, offer: p.offer || null, tag: p.tag || null,
  };
}

/** 入口商品補進 draft.products（冪等；缺真值＝跳過並回報原因，不塞半套、不靜默） */
function ensurePromoProducts(dj, entries, pool) {
  dj.products = Array.isArray(dj.products) ? dj.products : [];
  const have = new Set(dj.products.map((x) => String(x && x.gdid)));
  const added = [], skipped = [];
  for (const e of entries || []) {
    const g = String((e && e.gdid) || "");
    if (!g || have.has(g)) continue;
    const src = (pool || []).find((x) => x && String(x.gdid) === g);
    if (!src) { skipped.push({ gdid: g, reason: "not-in-pool" }); continue; }
    const missing = ["price", "name", "url", "img"].filter((k) => src[k] == null || src[k] === "");
    if (missing.length) { skipped.push({ gdid: g, reason: "missing:" + missing.join(",") }); continue; }
    dj.products.push({
      gdid: g, name: src.name, price: src.price, url: src.url, img: src.img,
      ...(Array.isArray(src.imgs) && src.imgs.length ? { imgs: src.imgs } : {}),
      ...(src.marketPrice != null ? { marketPrice: src.marketPrice } : {}),
      ...(src.offer ? { offer: src.offer } : {}),
      ...(src.tag ? { tag: src.tag, tagSource: "source" } : {}),
    });
    have.add(g); added.push(g);
  }
  return { added, skipped };
}

/** 給人看的一句（工作台 toast／log 用）：缺了誰、為什麼——白話先講、技術句尾括號 */
function describeSkipped(skipped) {
  if (!skipped || !skipped.length) return "";
  const n = skipped.length;
  return `有 ${n} 則入口的商品沒補進商品清單，這幾則在「主打選品舞台」會沒有價格與特色標（技術：${skipped.map((s) => `${s.gdid} ${s.reason}`).join("、")}）`;
}

module.exports = { promoPoolItem, ensurePromoProducts, describeSkipped };
