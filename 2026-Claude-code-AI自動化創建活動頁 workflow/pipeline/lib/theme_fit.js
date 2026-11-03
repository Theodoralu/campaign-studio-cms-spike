"use strict";
/* 主題契合＝一把尺（CP-14；ENTRY-THEMEFIT-SELF-CHECK 2026-09-28）
   gate.js 檢查「本期活動入口跟主題合不合」與 workbench/curate_auto.js 挑入口，原本只有 gate 有這把尺＝系統自己挑的入口會被自己判不合格
   （病例 2026-09-28-wb-140838 入口 #3 actid 19788：百貨週年慶 20 件商品只 1 件星巴克＝5%＜30% FAIL，使用者無從修）。
   現在兩邊都呼叫這裡；判定分支與 gate 原文一對一（title／no-pool／no-global-hit／small-pool／pass／fail），訊息文字仍留在 gate。
   零相依（只用 fs）＝gate、curate、server 都能 require、不成環。 */
const fs = require("fs");

const FULLWIDTH_DIGITS_RE = /[０-９]/g;
/** 全形數字→半形（與 gate.js norm 同式） */
const normText = (s) => String(s ?? "").replace(FULLWIDTH_DIGITS_RE, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));

/** 讀校準檔 themeFitRule（形制與 gate.loadThemeFit 相容：keywords 斜線別名展開＋小寫；threshold 數值或 {B_poolHitRate}）；讀不到＝fallback */
function loadThemeFitRule(file, fallback = null) {
  try {
    const r = JSON.parse(fs.readFileSync(file, "utf8")).themeFitRule;
    if (r && Array.isArray(r.keywords) && r.keywords.length) {
      const keywords = [...new Set(r.keywords.flatMap((k) => String(k).split("/")).map((s) => s.trim().toLowerCase()).filter(Boolean))];
      const threshold = typeof r.threshold === "number" ? r.threshold
        : typeof (r.threshold && r.threshold.B_poolHitRate) === "number" ? r.threshold.B_poolHitRate
        : (fallback && typeof fallback.threshold === "number" ? fallback.threshold : 0.3);
      return { keywords, threshold, source: `feedback_patch themeFitRule（${file}）` };
    }
  } catch (e) { /* 讀不到＝走 fallback（缺檔不誤殺） */ }
  return fallback;
}

const hitKw = (text, keywords, norm = normText) => { const t = norm(text || "").toLowerCase(); return keywords.some((k) => t.includes(String(k).toLowerCase())); };
/** 全池命中數（gate themeGlobalHits 同式） */
function globalHits(products, themeFit, norm = normText) { return (products || []).filter((p) => hitKw(p.name, themeFit.keywords, norm)).length; }

/**
 * 一則入口的契合判定。
 * @returns {{kind:"title"|"no-pool"|"no-global-hit"|"small-pool"|"pass"|"fail", hits:number, total:number, rate:number}}
 *  title＝活動標題含主題詞（C 訊號）＝過；no-pool＝快照無該活動商品池；no-global-hit＝詞組與全池零命中（比對不可施作）；
 *  small-pool＝池 <5 件（樣本不足、交人工）；pass／fail＝池 ≥5 依命中率對門檻硬判。
 *  strictActid＝true 時商品池用 === 比對（gate 原行為）；false 用 String() 比對（curate：actid 型別不一定同）。
 */
function entryFitVerdict({ actid, title, snap, themeFit, themeGlobalHits, norm = normText, strictActid = false }) {
  const products = (snap && snap.products) || [];
  const pool = products.filter((p) => strictActid ? p.actid === actid : String(p && p.actid) === String(actid));
  const promoTitle = ((snap && snap.promotions) || []).find((p) => String(p.actid) === String(actid));
  const actTitle = norm(String(title || (promoTitle && promoTitle.title) || "")).toLowerCase();
  const titleHit = !!actTitle && themeFit.keywords.some((k) => actTitle.includes(String(k).toLowerCase()));
  const gh = themeGlobalHits == null ? globalHits(products, themeFit, norm) : themeGlobalHits;
  const hits = pool.filter((p) => hitKw(p.name, themeFit.keywords, norm)).length;
  const rate = pool.length ? hits / pool.length : 0;
  if (titleHit) return { kind: "title", hits, total: pool.length, rate };
  if (!pool.length) return { kind: "no-pool", hits: 0, total: 0, rate: 0 };
  if (gh === 0) return { kind: "no-global-hit", hits, total: pool.length, rate };
  if (pool.length < 5) return { kind: "small-pool", hits, total: pool.length, rate };
  return { kind: rate < themeFit.threshold ? "fail" : "pass", hits, total: pool.length, rate };
}

module.exports = { normText, loadThemeFitRule, hitKw, globalHits, entryFitVerdict };
