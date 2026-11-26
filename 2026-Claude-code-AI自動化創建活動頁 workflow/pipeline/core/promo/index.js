"use strict";
/**
 * core/promo/index.js —— 「本期活動」區塊：有哪些可以放（promoLayers）、整批重組（recompose）（D14，2026-11-26）
 *
 * 來源：workbench/server.js promoLayerOptions 與 promo-recompose 路由，原樣抽出成純函式（資料用參數傳進來，不讀寫檔）。
 * 單機版的 promoLayerOptions 改呼叫這裡的 promoLayers；promo-recompose 路由本體仍留一份在 server.js（與 recompose 同邏輯，退役時一起拿掉）。
 *
 * 三層來源（優先序沿 U8）：
 *   promo-activity    進行中的優惠活動（未過期、池裡有它的商品；附主題契合率，≥30% 才算可選）
 *   brand-recommend   品牌頁推薦清單裡、還沒在頁面上曝光的商品
 *   product-fallback  商品名含主題詞、還沒曝光的池商品
 */
const path = require("path");
const PIPE = path.join(__dirname, "..", "..");
const { gdidOf } = require(path.join(PIPE, "workbench", "product_fetch.js"));
const promoProducts = require(path.join(PIPE, "lib", "promo_products.js"));
const LIMITS = require(path.join(PIPE, "gate.js")).RULES.entryChecks.entryCount; // CP-15 入口數量單一來源

const cutFull = (s, n) => { let w = 0, out = ""; for (const ch of String(s)) { w += ch.charCodeAt(0) > 255 ? 1 : 0.55; if (w > n) break; out += ch; } return out; };
const wFull = (s) => [...String(s)].reduce((a, c) => a + (c.charCodeAt(0) > 255 ? 1 : 0.55), 0);
const MODES = ["promo-activity", "brand-recommend", "product-fallback"];
const MODE_ZH = { "promo-activity": "優惠活動", "brand-recommend": "品牌商品推薦", "product-fallback": "主題商品替補" };

function promoLayers({ draft: dj, snapshot: snap, keywords, nowMs }) {
  const kws = keywords || [];
  const fitOf = (pool) => { if (!pool.length || !kws.length) return null;
    const hits = pool.filter((x) => { const nm = String(x.name || "").toLowerCase(); return kws.some((k) => nm.includes(String(k).toLowerCase())); }).length;
    return hits / pool.length; };
  // 第 1 層：在線活動（未過期＋該檔有池商品）＋CP-14 契合率
  const acts = [];
  for (const pr of snap.promotions || []) {
    if (!pr || !pr.actid || !pr.url || !pr.title) continue;
    if (typeof pr.endTs === "number" && pr.endTs * 1000 < nowMs) continue;
    const pool = (snap.products || []).filter((p) => p && String(p.actid || "") === String(pr.actid));
    const first = pool.find((p) => p.imgs && p.imgs[0]);
    if (!first) continue;
    const fit = fitOf(pool.slice(0, 20));
    acts.push({ actid: String(pr.actid), title: pr.title, chip: pr.short || pr.title, period: pr.period || "",
      url: pr.url, img: first.imgs[0], fit: fit == null ? null : Math.round(fit * 100), eligible: fit == null ? true : fit >= 0.3 });
  }
  // 已曝光集合（CP-18：商品層選品排除）——promo 入口本身不佔 products[] 列
  const exposed = new Set();
  (dj.products || []).forEach((p) => p && p.gdid && exposed.add(String(p.gdid)));
  (((dj.page || {}).kv || {}).keyProductGdids || []).forEach((g) => g && exposed.add(String(g)));
  const prodsBy = new Map((snap.products || []).map((p) => [String(p.gdid), p]));
  // 第 2 層：品牌頁推薦清單（hits/hotSales；項目以 url→gdid 對映回商品池）
  const recIds = new Set();
  for (const k of ["hits", "hotSales"]) (Array.isArray(snap[k]) ? snap[k] : []).forEach((x) => {
    const g = (x && typeof x === "object") ? (x.gdid || gdidOf(x.url || "")) : gdidOf(String(x));
    if (g) recIds.add(String(g));
  });
  const rec = [...recIds].map((g) => prodsBy.get(g)).filter((p) => p && p.imgs && p.imgs[0] && !exposed.has(String(p.gdid)));
  // 第 3 層：主題契合的未曝光池商品
  const fb = (snap.products || []).filter((p) => p && p.gdid && p.name && p.imgs && p.imgs[0] && !exposed.has(String(p.gdid)) &&
    (!kws.length || kws.some((k) => String(p.name).toLowerCase().includes(String(k).toLowerCase()))));
  const prodItem = (p) => promoProducts.promoPoolItem(p); // 帶全真值欄（2026-09-04：原本只留四欄、價格被剝掉＝下游收不進 products[]）
  return {
    "promo-activity": { count: acts.filter((a) => a.eligible).length, items: acts },
    "brand-recommend": { count: rec.length, items: rec.slice(0, 12).map(prodItem) },
    "product-fallback": { count: fb.length, items: fb.slice(0, 12).map(prodItem) },
  };
}

/**
 * 整批重組本期活動（就地改 draft）。回 { ok:true, entries, truncated, ensureNote, added } 或 { ok:false, status, error }。
 * 入口文字、標題、dock 標籤的機械寫法逐字沿原碼。
 */
function recompose({ draft: dj, layers, mode, actids, gdids }) {
  if (!MODES.includes(mode)) return { ok: false, status: 400, error: "內容主題的選項無效——請重新選擇內容主題後再試一次" };
  let entries = [], truncated = null;
  const cap = (pool) => { if (pool.length > LIMITS.max) truncated = `這個來源可組 ${pool.length} 則，已先帶前 ${LIMITS.max} 則（本期活動放 ${LIMITS.min}~${LIMITS.max} 則）`; return pool.slice(0, LIMITS.max); };
  if (mode === "promo-activity") {
    let pool = layers["promo-activity"].items.filter((a) => a.eligible);
    if (Array.isArray(actids) && actids.length) { const want = actids.map(String); pool = want.map((a) => layers["promo-activity"].items.find((x) => x.actid === a)).filter(Boolean); }
    else pool = pool.slice().sort((a, b) => (b.fit ?? 0) - (a.fit ?? 0));
    entries = cap(pool).map((a) => ({ actid: a.actid, title: a.title, chip: a.chip, copy: a.title, dateValue: a.period, img: a.img, url: a.url, destinationType: "activity" }));
  } else {
    let pool = layers[mode].items;
    if (Array.isArray(gdids) && gdids.length) { const want = gdids.map(String); pool = want.map((g) => pool.find((x) => x.gdid === g)).filter(Boolean); }
    entries = cap(pool).map((p) => ({ gdid: p.gdid, chip: cutFull(p.name, 10), copy: cutFull(p.name, 18), dateValue: "", img: p.img, url: p.url, destinationType: mode === "brand-recommend" ? "brand-recommend" : "product" }));
  }
  if (entries.length < LIMITS.min) {
    const alt = Object.entries(layers).filter(([k, v]) => k !== mode && v.count >= LIMITS.min).map(([k, v]) => `「${MODE_ZH[k]}」（可組 ${v.count} 則）`);
    return { ok: false, status: 409, error: `本期活動放 ${LIMITS.min}~${LIMITS.max} 則——「${MODE_ZH[mode] || mode}」目前只湊得出 ${entries.length} 則，至少要 ${LIMITS.min} 則版型才能成立——${alt.length ? `可改選 ${alt.join("、")}，` : ""}或改用「人工手動入稿」自行編排` };
  }
  dj.page.promoSourceMode = mode;
  dj.page.promoEntries = entries;
  let ensureNote = null, added = [];
  if (mode !== "promo-activity") { // 商品型入口＝商品收進 draft.products（舞台皮靠它取真值價；價格照樣受 CP-02 驗）
    const r = promoProducts.ensurePromoProducts(dj, entries, layers[mode].items || []);
    added = r.added; if (r.skipped.length) ensureNote = promoProducts.describeSkipped(r.skipped);
  }
  if (dj.assets && dj.assets.moduleImages) for (const k of Object.keys(dj.assets.moduleImages)) if (/^promoEntry\d+$/.test(k)) delete dj.assets.moduleImages[k]; // 重組＝整批重生，清舊圖覆寫
  if (mode === "promo-activity") { dj.page.promoModuleTitle = "本期活動：" + entries.map((e) => e.chip).join("・"); dj.page.dockPromoLabel = wFull(entries[0].chip) <= 4 ? entries[0].chip : "本期優惠"; }
  else { const th = (dj.page.curationTheme || "").trim(); dj.page.promoModuleTitle = th ? `${th}精選推薦` : "編輯精選推薦"; dj.page.dockPromoLabel = "精選推薦"; }
  return { ok: true, entries, truncated, ensureNote, added };
}
module.exports = { promoLayers, recompose, MODES, MODE_ZH, LIMITS };
