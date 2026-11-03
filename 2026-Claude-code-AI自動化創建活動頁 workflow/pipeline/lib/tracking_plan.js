"use strict";
/**
 * lib/tracking_plan.js — 活動頁的「追蹤身分」與頁級參數（75 號裁決批，2026-09-15）
 *
 * 一句話：這頁「是哪一檔、長什麼組合」在建置端算好，AEM 匯出時寫進 <head>；瀏覽器端的掃描機
 * （FrameTest「GA 掃描機」區）用同一套規則再算一次給內網預覽用——兩邊必須算出同一個值，
 * 對帳絆線＝test/unit/ga_tracking.test.js（把模板那段抽出來跑、逐欄比對本檔）。
 *
 * 規則出處（本檔不另立規則）：
 *  - build_id：24 號 D-2／D-3——結構變（模組增刪／版型／順序）＝換發、只有商品資料變＝不換。
 *    實作採「組合內容雜湊」而非流水號：同組合恆同值＝D-3 天然成立，不必在每條寫 draft 的路上補換發（鐵律 4）。
 *  - promotion_id／promotion_name 成對：75 R-6（pageName 67 頁僅 49 唯一，不可當主鍵）。
 *  - 樓層 module_variant 缺鍵補 `default`：75 R-3（同 D-11／O-14 建置端補實值，draft 儲存慣例不動）。
 *  - 位置 0-based、品類牆只看陣列索引不讀 walls[].pos：75 R-4（舊 wall-N 殘檔不留特例）。
 *  - GTM 由我們注入、做成開關：75 R-7（AEM 第②題回覆後一行切換）。
 *  - 曝光只送分析師 v3 已定義的四模組：75 §5（第 9 題定案後擴名單）。
 *
 * 零相依：雜湊採 FNV-1a 32 位元（不是密碼學，是身分鍵），瀏覽器端同一支＝同值。
 */
const { COMPOSE_ORDER_DEFAULT } = require("./content_modules");

const CONTENT_GROUP = "activity_ai";
/** `page_type`＝模板類型＝我們的版型代號（分析師 2026-09-15 定：活動頁的 page_type 放 template type，與 `activity_aem` 頁對齊；`content_group` 才是分家）。
 *  09-15 一度另開 `layout` 欄、page_type 暫填 activity＝前提誤判，同日撤回（75 號 §7.3）。 */
const GTM_CONTAINER_DEFAULT = "GTM-WJ5JQR4"; // 分析師 2026-09-01 回件（17 號 O-5／62 號 D-1）
/** 分析師 v3 有 view_promotion 的模組；主視覺／品類牆／延伸探索／頁首等第 9 題定案後加進來（75 §5）。 */
const VIEW_SLOTS = ["mechanic", "promo", "featured", "editor_topic"];
/** 章節最多渲染幾個（鏡射 FrameTest：[data-fd] ×3、CG_SECTION_IDS ×3）——超出的資料不渲染＝不算進組合。 */
const MAX_FLOORS = 3, MAX_WALLS = 3;

function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return ("0000000" + h.toString(16)).slice(-8);
}

/** 頁面組合（依 composeOrder；缺＝預設序）——只列「會渲染出來」的模組，每塊一筆 { module_id, module_variant, slot_id, pos }。 */
function composition(draft) {
  const pg = (draft && draft.page) || {};
  const co = Array.isArray(pg.composeOrder) && pg.composeOrder.length === COMPOSE_ORDER_DEFAULT.length ? pg.composeOrder : COMPOSE_ORDER_DEFAULT;
  const out = [];
  const one = (module_id, module_variant, slot_id, pos) => out.push({ module_id, module_variant: String(module_variant), slot_id, pos });
  for (const k of co) {
    if (k === "kv") one("hero", pg.kvVariant || "legacy", "hero", 0);
    else if (k === "mechanic") { if (pg.mechanic && pg.mechanic.variant) one("mechanic", pg.mechanic.variant, "mechanic", 0); }
    else if (k === "promo") { if (Array.isArray(pg.promoEntries) && pg.promoEntries.length) one("promo", pg.promoVariant || "entry-circles", "promo", 0); }
    else if (k === "spotlight") { if (pg.spotlight) one("featured", "spotlight", "spotlight", 0); }
    else if (k === "promoCard") { const pc = Array.isArray(pg.promoCards) ? pg.promoCards : (pg.promoCard ? [pg.promoCard] : []); if (pc.length) one("featured", "promo-card", "promocard", 0); }
    else if (k === "featured") (Array.isArray(pg.floors) ? pg.floors : []).slice(0, MAX_FLOORS).forEach((f, i) => one("featured", (f && f.variant) || "default", `featured-${i + 1}`, i));
    else if (k === "editorial") { if (pg.editorial) one("editor_topic", "default", "editor_topic", 0); }
    else if (k === "walls") (Array.isArray(pg.walls) ? pg.walls : []).slice(0, MAX_WALLS).forEach((w, i) => { if (w && Array.isArray(w.productGdids) && w.productGdids.length) one("category_groups", "default", `category-${i + 1}`, i); });
    else if (k === "explore") { if (pg.explore && Array.isArray(pg.explore.items) && pg.explore.items.length) one("extended_links", "default", "extended_links", 0); }
  }
  return out;
}
const compositionKey = (comp) => comp.map((c) => `${c.module_id}:${c.module_variant}:${c.slot_id}`).join("|");
const compositionHash = (draft) => fnv1a(compositionKey(composition(draft)));
function pageId(draft) { const pg = (draft && draft.page) || {}; return String(pg.id || (draft && draft.id) || ""); }
const buildId = (draft) => `bld_${pageId(draft)}_${compositionHash(draft)}`;

/** 頁級參數＝分析師 v3 head 區塊（event／content_group／page_type／promotion_id／has_ad）＋我方兩欄（promotion_name／build_id，75 R-6）
 *  ；page_type＝版型代號（模板類型，與 activity_aem 對齊）。user_id／esid 填不出＝不送（第 4 件甲）。 */
function pageParams(draft) {
  const pg = (draft && draft.page) || {};
  return {
    event: "ec_page_view",
    content_group: CONTENT_GROUP,
    page_type: pg.kvVariant || "legacy",
    promotion_id: pageId(draft),
    promotion_name: String(pg.pageName || ""),
    has_ad: pg.mechanic && pg.mechanic.variant ? "Y" : "N",
    build_id: buildId(draft),
  };
}

/** 開關（75 R-7）：預設注入 GTM；環境變數 CAMPAIGN_GTM=off 關掉、CAMPAIGN_GTM=GTM-XXXX 換容器。AEM 第②題回「母站已掛」＝改預設為 off。 */
function gaConfig(env = process.env) {
  const v = String((env && env.CAMPAIGN_GTM) || "").trim();
  if (/^off$/i.test(v)) return { injectGtm: false, gtmId: null };
  return { injectGtm: true, gtmId: /^GTM-[A-Z0-9]+$/.test(v) ? v : GTM_CONTAINER_DEFAULT };
}

/** 放進 <script> 內的 JSON：關掉 </script> 與行分隔字元逃逸。 */
const LS = String.fromCharCode(0x2028), PS = String.fromCharCode(0x2029); // 行／段分隔字元（JSON 合法、<script> 內會斷行）
const safeJson = (o) => JSON.stringify(o).split("</").join("<\\/").split(LS).join("\\u2028").split(PS).join("\\u2029");

/** 第 1 層：寫進 <head> 的那一段。順序＝先 dataLayer 頁級參數、再 GTM（分析師 v3 註：Tracking DataLayer 必須放在 GTM Container Code 之前）。 */
function gaHeadScript(draft, cfg = gaConfig()) {
  const p = safeJson(pageParams(draft));
  let s = `<script>window.dataLayer=window.dataLayer||[];window.dataLayer.push(${p});window.__WB_GA__=${p};</script>`;
  if (cfg && cfg.injectGtm && cfg.gtmId) {
    s += `<script>(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src='https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);})(window,document,'script','dataLayer','${cfg.gtmId}');</script>`;
  }
  return s;
}

/** 這頁「應該」出現哪些 slot（給 CP-32 對板：DOM 上的 [data-ga-slot] 少一個＝漏貼）。 */
const expectedSlots = (draft) => composition(draft).map((c) => c.slot_id);

/** 交付件用的整包（17 §5 鐵律 3 trackingPlan；隨 AEM 匯出報告輸出）。 */
function trackingPlan(draft, cfg = gaConfig()) {
  const comp = composition(draft);
  return {
    build_id: buildId(draft), composition_hash: fnv1a(compositionKey(comp)), composition: comp,
    page: pageParams(draft), viewSlots: VIEW_SLOTS.slice(), expectedSlots: comp.map((c) => c.slot_id),
    gtm: { inject: !!(cfg && cfg.injectGtm), id: cfg && cfg.injectGtm ? cfg.gtmId : null },
  };
}

module.exports = { fnv1a, composition, compositionKey, compositionHash, pageId, buildId, pageParams, gaConfig, gaHeadScript, safeJson, expectedSlots, trackingPlan,
  CONTENT_GROUP, GTM_CONTAINER_DEFAULT, VIEW_SLOTS, MAX_FLOORS, MAX_WALLS };
