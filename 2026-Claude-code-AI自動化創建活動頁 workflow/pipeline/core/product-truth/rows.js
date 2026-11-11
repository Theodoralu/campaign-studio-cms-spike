"use strict";
/**
 * core/product-truth/rows.js —— 商品狀態列的純邏輯（D7，2026-11-11）
 *
 * 自 workbench/server.js productCheck（1293–1458）原樣抽出，邏輯零改動：
 *   whereOf／isStashedOnly（商品在頁上哪個位置、是不是未上場暫存品）
 *   compareRow（活體價 vs 草稿價 vs 快照價 → drift／marketDrift／snapDrift／snapMissing）
 *   summary（pcSummaryOf 口徑）、blockingCount／blockMessage（pcBlockingCount／pcBlockMessage）
 *   patchSnapshotPrice（server.js:176–189，套用新價到快照那一刀）
 * 全部純函式：不讀寫檔、不觸網。兩層真值（uther／商品頁）都用同一套列形狀，呼叫端不分來源。
 *
 * 列形狀（product_check.json results[]，schemas/product_check.schema.json）：
 *   { gdid, name, where, draftPrice, status: online|offline|dead|unverified, stashed?, seeded?, note?,
 *     livePrice?, liveMarketPrice?, drift?, marketDrift?, draftMarketPrice?, snapPrice?, snapDrift?, snapMissing?, evidence? }
 */
const { gdidOf } = require("../../workbench/product_fetch");

/** 草稿頁面 → 位置查詢器（原 productCheck 內的 whereOf／isStashedOnly 閉包） */
function pageLocator(dj) {
  const page = dj.page || {};
  const heroObj = (page.hero && typeof page.hero === "object") ? page.hero : {};
  const stashObj = (page.heroSlotStash && typeof page.heroSlotStash === "object") ? page.heroSlotStash : {};
  const isV2Page = /^layout-\d{3}$/.test(String(page.kvVariant || "").replace(/^kv-/, ""));
  const activeGdids = new Set();
  if (!isV2Page) ((page.kv || {}).keyProductGdids || []).forEach((g) => activeGdids.add(String(g))); // v2 頁 kv 節點休眠＝不算在場（14 §2.13）
  for (const v of Object.values(heroObj)) if (v && Array.isArray(v.gdids)) v.gdids.forEach((g) => activeGdids.add(String(g)));
  (page.floors || []).forEach((f) => (f.productGdids || []).forEach((g) => activeGdids.add(String(g))));
  (page.walls || []).forEach((w) => (w.productGdids || []).forEach((g) => activeGdids.add(String(g))));
  (dj.products || []).forEach((p) => { if (p && p.position === "editorial-wall") activeGdids.add(String(p.gdid)); });
  const stashGdids = new Set();
  for (const v of Object.values(stashObj)) if (v && Array.isArray(v.gdids)) v.gdids.forEach((g) => stashGdids.add(String(g)));
  const isStashedOnly = (g) => stashGdids.has(String(g)) && !activeGdids.has(String(g));
  const whereOf = (g) => {
    if (isStashedOnly(g)) return "未上場暫存（不出貨）";
    const kvI = ((page.kv || {}).keyProductGdids || []).map(String).indexOf(String(g));
    if (kvI >= 0 && !isV2Page) return `KV 主品 #${kvI + 1}`;
    for (const [slotK, v] of Object.entries(heroObj)) { if (v && Array.isArray(v.gdids)) { const j = v.gdids.map(String).indexOf(String(g)); if (j >= 0) return `主視覺槽 ${slotK} #${j + 1}`; } }
    for (let i = 0; i < (page.floors || []).length; i++) { const j = (page.floors[i].productGdids || []).map(String).indexOf(String(g)); if (j >= 0) return `樓層${i + 1} 卡${j + 1}`; }
    for (let i = 0; i < (page.walls || []).length; i++) { const j = (page.walls[i].productGdids || []).map(String).indexOf(String(g)); if (j >= 0) return `品類牆${i + 1} 卡${j + 1}`; }
    for (let i = 0; i < (page.floors || []).length; i++) { if (gdidOf(page.floors[i].sceneUrl || "") === String(g)) return `樓層${i + 1} 情境代表品`; }
    if (kvI >= 0) return `KV 主品 #${kvI + 1}（新版式頁休眠）`;
    return "—";
  };
  return { whereOf, isStashedOnly, isV2Page, activeGdids, stashGdids };
}

/**
 * 一件商品：活體結果 → 狀態列。live 由兩層任一提供：{ status, prod: {price, listPrice}|null, evidence }。
 * @param {object} p 草稿商品 {gdid, name, price, marketPrice, url}
 * @param {object|null} live  null＝連不上（unverified）；err 另給
 * @param {object|undefined} sp 快照同 gdid 商品（無＝snapMissing，當快照有池時）
 */
function compareRow(p, live, sp, { whereOf = () => "—", isStashedOnly = () => false, snapHasPool = true, err = null } = {}) {
  const row = { gdid: String(p.gdid), name: p.name, where: whereOf(p.gdid), draftPrice: p.price };
  if (isStashedOnly(p.gdid)) row.stashed = true;
  if (err || !live) {
    row.status = "unverified"; row.note = err ? String((err && err.message) || err) : "沒有結果";
    if (err && err.attempts) row.evidence = { attempts: err.attempts };
    return row;
  }
  row.evidence = live.evidence;
  row.status = live.status; // online | offline | dead
  if (live.seeded) row.seeded = true;
  if (live.status === "online") {
    row.livePrice = live.prod.price;
    if (live.prod.listPrice) row.liveMarketPrice = live.prod.listPrice;
    const liveM = live.prod.listPrice || null, draftM = p.marketPrice || null;
    if (live.prod.listPriceUnknown) { row.marketDrift = false; row.listPriceUnknown = true; } // uther 層沒有廠商市價＝不比劃線價（D7）
    else { row.marketDrift = liveM !== draftM; if (row.marketDrift) row.draftMarketPrice = draftM; }
    row.drift = live.prod.price !== p.price || row.marketDrift;
    if (sp) { row.snapPrice = sp.price; row.snapDrift = live.prod.price !== sp.price || (!live.prod.listPriceUnknown && (sp.marketPrice || null) !== liveM); }
    else if (snapHasPool) row.snapMissing = true;
  }
  return row;
}

/** 商品狀態統計（pcSummaryOf 口徑；暫存品不計主計數） */
function summary(results) {
  const act = results.filter((r) => !r.stashed);
  return {
    online: act.filter((r) => r.status === "online" && !r.drift && !r.snapDrift).length,
    drift: act.filter((r) => r.drift || r.snapDrift).length,
    offline: act.filter((r) => r.status === "offline").length,
    dead: act.filter((r) => r.status === "dead").length,
    unverified: act.filter((r) => r.status === "unverified").length,
    snapMissing: act.filter((r) => r.snapMissing).length,
    stashed: results.length - act.length,
  };
}
const blockingCount = (s, badLinks) => (s.dead || 0) + (s.offline || 0) + (s.drift || 0) + (s.snapMissing || 0) + (s.unverified || 0) + (badLinks || 0);
const blockMessage = (s, n, verb) => ((s.unverified || 0) > 0
  ? `有 ${s.unverified} 件商品連不上 Yahoo、沒能驗價（共 ${n} 項要處理）——請確認這台電腦連得上 tw.buy.yahoo.com，按「重新檢查」後再${verb}`
  : `商品狀態檢查未過（要處理 ${n} 項）——開「發佈前檢查」清單，照每條的按鈕與指引處理後再${verb}`);

/** 套用實抓新價到快照商品（server.js patchSnapshotPrice 原樣；就地變更 snap 與 sp） */
const patchSnapshotPrice = (snap, sp, row, checkedAt) => {
  const oldP = sp.price, oldM = sp.marketPrice || null;
  sp.price = row.livePrice;
  if (row.liveMarketPrice && row.liveMarketPrice > row.livePrice) { sp.marketPrice = row.liveMarketPrice; sp.disc = Math.round((row.livePrice / row.liveMarketPrice) * 100); }
  else { sp.marketPrice = null; sp.disc = null; }
  snap.warnings = snap.warnings || [];
  snap.warnings.push(`套用新價：gdid ${sp.gdid} price ${oldP}→${sp.price}、marketPrice ${oldM}→${sp.marketPrice}（真值＝product_check ${checkedAt || "?"} 伺服器實抓；Q4-A）`);
  const _ds = (snap.products || []).map((p) => p.disc).filter((d) => d && d > 0 && d < 100);
  snap.minDisc = _ds.length ? Math.min(..._ds) : null;
  return { gdid: String(sp.gdid), price: sp.price, marketPrice: sp.marketPrice || null };
};

module.exports = { pageLocator, compareRow, summary, blockingCount, blockMessage, patchSnapshotPrice };
