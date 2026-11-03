/* 廠商變更單建表／讀回（2026-07-27；v2 真值安全重構）：把 draft 商品建成「商品為中心」的 Google Sheet 列，供外部廠商溝通。
 * 使用者需求：一列一商品＋清楚標示模組位置＋可改/不可改欄位＋附 demo 預覽網址。
 * 【真值安全根治（QA 2026-07-27 critical）】：
 *   - 每列第一欄＝「系統索引🔒」＝原始 gdid（不可改），讀回時以此鍵回錨到「建表當下的基準快照(baseline)」，
 *     不靠列序、不靠即時 draft ⇒ 免疫廠商刪列/插列/排序、及 CMS 端在寄出後改過策展造成的漂移。
 *   - 「賣場編號✍️」純粹是換品目標欄（廠商要換商品才改它）；與系統索引分離。
 * 位置對應沿用 server.js productCheck whereOf（KV/樓層/牆）。 */
"use strict";

const COLS = [
  { key: "origKey", label: "系統索引", lock: "🔒", hint: "請勿修改" }, // 原始 gdid，讀回回錨鍵
  { key: "pos", label: "模組位置", lock: "🔒" },
  { key: "name", label: "商品名稱", lock: "🔒" },
  { key: "gdid", label: "賣場編號", lock: "✍️", hint: "要換商品才改這欄" }, // 換品目標
  { key: "url", label: "商品頁URL", lock: "🔒" },
  { key: "price", label: "現價", lock: "🔒" },
  { key: "market", label: "原價", lock: "🔒" },
  { key: "tag", label: "標籤文案", lock: "✍️" },
  { key: "note", label: "廠商備註", lock: "✍️" },
];
const HEADER_MARK = "系統索引"; // 讀回定位表頭列的錨（穩定）
const HEADER_ROWS = 5;         // 資訊區 4 列 + 表頭 1 列
// 讀回欄位索引（對應 COLS 順序）
const C_ORIGKEY = 0, C_GDID = 3, C_TAG = 7, C_NOTE = 8;

/* 模組位置＝用商品自身 position 欄位（QA 2026-07-27：原反查 floors/walls 陣列會漏掉「編輯精選商品牆」＋部分主打樓層）。
   只列「換品流程可安全反映」的位置：kv／featured-N／wall-N／editorial-wall（都由 frametest 依 position 渲染、applySwap 保留 position）。
   排除 editorial-circle（精選圓卡走 CMS 圓卡更替、換品不反映）、promodeal/explore（入口卡）＝避免誤導。 */
/* 陣列成員法（QA 2026-07-27 二修）：以 kv.keyProductGdids／floors[].productGdids／walls[].productGdids 定位——AI 與機械策展引擎皆穩健
   （機械引擎 position＝kv-main/category-N，純比對 position 字串會漏掉 KV＋品類牆；改比對陣列成員則不受命名影響）。
   editorial-wall 另由 position 補（不在上述陣列、但 frametest 依 position 渲染、applySwap 保留 position＝換品可反映）。
   天然排除「情境代表品」（featured order 1、不在 floors[].productGdids）——換它 applySwap 不更新 sceneUrl/sceneImg＝不反映，故不開放。 */
function locateProduct(page, p) {
  const g = String(p.gdid);
  const kvI = ((page.kv && page.kv.keyProductGdids) || []).map(String).indexOf(g);
  if (kvI >= 0) return { ord: kvI, group: "kv", label: `KV 主品 卡${kvI + 1}` };
  const floors = page.floors || [];
  for (let i = 0; i < floors.length; i++) { const j = ((floors[i].productGdids) || []).map(String).indexOf(g); if (j >= 0) return { ord: 100 + i * 20 + j, group: "fl", label: `主打樓層${i + 1} 卡${j + 1}` }; }
  const walls = page.walls || [];
  for (let i = 0; i < walls.length; i++) { const j = ((walls[i].productGdids) || []).map(String).indexOf(g); if (j >= 0) return { ord: 1000 + i * 20 + j, group: "wl", label: `品類牆${i + 1} 卡${j + 1}` }; }
  if (p.position === "editorial-wall") return { ord: 10000 + (Number(p.order) || 0), group: "ed", label: "編輯精選商品牆" }; // 卡號於 buildVendorRows 依序補
  return null;
}
function whereOf(page, product) { const p = product && typeof product === "object" ? product : null; if (!p) return "（未曝光）"; const loc = locateProduct(page, p); return loc ? loc.label : "（未曝光）"; }

/* draft → { title, rows(二維含資訊區＋表頭＋商品列), headerRows, gdidOrder, baseline }
 * baseline＝建表當下的每列快照 [{gdid,name,tag,pos}]，需持久化到 meta，讀回時當對齊基準（真值鎖存）。 */
function buildVendorRows(draft, previewUrl) {
  const page = draft.page || {};
  const pageName = page.pageName || page.id || "活動頁";
  const items = [];
  (draft.products || []).forEach((p) => { if (p && p.gdid) { const loc = locateProduct(page, p); if (loc) items.push({ p, loc }); } });
  items.sort((a, b) => a.loc.ord - b.loc.ord);
  let _ed = 0;
  const withPos = items.map(({ p, loc }) => ({ p, pos: loc.group === "ed" ? `編輯精選商品牆 卡${++_ed}` : loc.label }));

  const header = COLS.map((c) => `${c.label} ${c.lock}${c.hint ? "（" + c.hint + "）" : ""}`);
  const info = [
    [`活動頁廠商變更單｜${pageName}`],
    ["活動頁預覽（demo）", previewUrl || "（活動尚未上線——上線後我方會更新此欄補上預覽連結，您不需要操作）"], // F7-B：空值＝上線指引，不出假連結（URL 真值只來自 liveUrl/publicUrl）；審查修：這格的讀者是外部廠商——補行為者「我方」，原「按『建立／更新廠商變更單』」的按鈕在內部 CMS，廠商會誤以為自己漏了操作
    ["填寫說明", "🔒＝系統真值請勿修改（含最左『系統索引』欄）；✍️＝可修改。要換商品：改『賣場編號』欄後通知我方；CMS 會用新編號重抓 Yahoo 真值。⚠ 請勿刪列、插列或改動『系統索引』欄，以免對應錯亂。"],
    [""],
  ];
  const gdidOrder = [], baseline = [];
  const body = withPos.map(({ p, pos }) => {
    const g = String(p.gdid);
    gdidOrder.push(g);
    baseline.push({ gdid: g, name: p.name || "", tag: p.tag || "", pos });
    return [g, pos, p.name || "", g, p.url || "", p.price != null ? String(p.price) : "", p.marketPrice != null ? String(p.marketPrice) : "", p.tag || "", ""];
  });
  return { title: `廠商變更單｜${pageName}`, rows: [...info, header, ...body], headerRows: HEADER_ROWS, gdidOrder, baseline };
}

/* 讀回：sheetRows（Google 讀回二維）＋baseline（建表時鎖存的快照）→ 逐列差異（換品/改標籤/備註）。
 * 以「系統索引欄(第一欄)＝原始 gdid」回錨到 baseline，不靠列序、不靠即時 draft ⇒ 免疫刪列/插列/排序/漂移。 */
function parseVendorEdits(sheetRows, baseline) {
  const rows = Array.isArray(sheetRows) ? sheetRows : [];
  const base = Array.isArray(baseline) ? baseline : null;
  if (!base) return { ok: false, error: "找不到這張變更單的建表基準——請按「建立／更新廠商變更單」重建（會升級為含系統索引的安全格式）後再分享給廠商", edits: [] };
  const hi = rows.findIndex((r) => Array.isArray(r) && String(r[0] || "").startsWith(HEADER_MARK));
  if (hi < 0) return { ok: false, error: "這張表不是含『系統索引』欄的新版變更單（可能是舊版）——請按「建立／更新廠商變更單」重建後再分享", edits: [] };
  const byKey = new Map(base.map((b) => [String(b.gdid), b]));
  const dataRows = rows.slice(hi + 1).filter((r) => Array.isArray(r) && r.some((c) => String(c || "").trim() !== ""));
  const edits = []; let unknown = 0;
  for (const r of dataRows) {
    const origGdid = String(r[C_ORIGKEY] || "").trim();
    const b = byKey.get(origGdid);
    if (!b) { if (origGdid) unknown++; continue; } // 索引不在基準（廠商亂改索引/幽靈殘列）＝安全略過，不誤套
    const newGdid = String(r[C_GDID] || "").trim();
    const newTag = String(r[C_TAG] || "").trim();
    const note = String(r[C_NOTE] || "").trim();
    const change = {};
    if (newGdid && newGdid !== origGdid && /^\d{6,10}$/.test(newGdid)) change.swapGdid = newGdid;
    if (newTag !== (b.tag || "")) { change.tag = newTag; change.oldTag = b.tag || ""; }
    if (note) change.note = note;
    if (Object.keys(change).length) edits.push({ pos: b.pos, oldGdid: origGdid, oldName: b.name || "", ...change });
  }
  const missing = base.length - (dataRows.length - unknown); // 基準有、但表上找不到對應列（廠商刪了列）
  return { ok: true, edits, total: dataRows.length, unknown, missing: missing > 0 ? missing : 0 };
}

module.exports = { COLS, HEADER_ROWS, buildVendorRows, parseVendorEdits, whereOf };
