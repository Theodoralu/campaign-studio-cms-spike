"use strict";
/**
 * core/curate/index.js —— CurateEngine 介面（D8，2026-11-13）
 *
 * 兩步，照競業文件 C1／C2 留的形狀：
 *   plan(snapshot, input)  → outline  「這頁打算分哪幾層、每層放什麼、哪些待確認」
 *   build(outline)         → draft    照 outline 產整份草稿
 *   curate(snapshot, input) ＝ plan 再 build（第一版呼叫端只用這個）
 *
 * 第一版只有 rules 引擎：它不會先出大綱再生成——curate_auto 是一次產整份。所以 rules 的 plan() 其實就把整份跑完、
 * 把「切出來的層」包成 outline 當內部資料，build() 原樣回 draft。這樣介面先立住：
 *   第二階段 AI 引擎接同一個介面，plan() 是真的大綱（給人核准），build() 才生成；人核准大綱那一步放在 plan 與 build 之間。
 *   AI 引擎的輸入要明確（取自單機版 #24 ai-curate-read-scope 的結論「設計上必讀兩檔」）：deps.contractExample（契約形範例 draft）、
 *   deps.curationRules（04 號策展規則全文）＋ snapshot＋input，全部放進 prompt 走 LLM API；不 spawn CLI、不給檔案系統，
 *   所以單機版「AI 讀檔圈地」的沙箱題在 CMS 側不存在。
 *
 * outline 形狀（兩種引擎共用）：
 *   { engine, input, pool: {size, order}, modules: [{ id, kind: hero|floor|wall|promo|editorial|explore, title, productGdids, source }],
 *     notes: [], pending: [] }   ← pending＝待人確認的事；rules 引擎永遠空
 *
 * 洞（D8 留，預設不變、黃金對照照綠）：
 *   input.poolOrder   "disc"（預設；單機版依折數）｜"sales"（依 salesVolume→globalRating→disc；D6 存的數字）——P39
 *   input.excludeOutOfStock  true＝把 stockStatus OUT_OF_STOCK／NO_LONGER_BE_SOLD 擋在池外（uther 快照才有此欄；預設 false）
 *   input.wallGroupBy "none"（預設）｜"filterTag:<名稱>"（用 uther filterTags 分品類牆；實作在第二階段，第一版只收參數並記在 outline）
 */
const { curateRules, CurateError } = require("./rules");

/** 池子前處理（洞）：純函式，回新 snapshot（不改原物件） */
function preparePool(snapshot, input = {}) {
  let products = (snapshot.products || []).slice();
  const notes = [];
  if (input.excludeOutOfStock) {
    const before = products.length;
    products = products.filter((p) => !["OUT_OF_STOCK", "NO_LONGER_BE_SOLD"].includes(p.stockStatus));
    if (products.length !== before) notes.push(`excludeOutOfStock：擋掉 ${before - products.length} 件售完／停售`);
  }
  if (input.poolOrder === "sales") {
    // 穩定排序：銷量多→少、評分高→低、折數深→淺；缺值排後。rules 引擎內還會再依折數排一次（逐位元組不動），所以這裡只影響同折數內的順序
    const key = (p) => [-(p.salesVolume ?? -1), -(p.globalRating ?? -1), p.disc == null ? 999 : p.disc];
    products = products.map((p, i) => [p, i]).sort((a, b) => { const ka = key(a[0]), kb = key(b[0]); for (let k = 0; k < 3; k++) if (ka[k] !== kb[k]) return ka[k] - kb[k]; return a[1] - b[1]; }).map((x) => x[0]);
    notes.push("poolOrder=sales：池子依 salesVolume→globalRating→disc 預排");
  }
  return { snapshot: { ...snapshot, products }, notes };
}

/** draft → outline（rules 引擎：事後整理，給人看、給第二階段對齊用） */
function outlineOf(draft, input, poolInfo, notes) {
  const page = draft.page || {};
  const modules = [];
  if (page.hero && typeof page.hero === "object") for (const [slot, v] of Object.entries(page.hero)) if (v && Array.isArray(v.gdids) && v.gdids.length) modules.push({ id: `hero:${slot}`, kind: "hero", title: page.kv && page.kv.titleLine1 || "", productGdids: v.gdids.map(String), source: "rules" });
  (page.floors || []).forEach((f, i) => modules.push({ id: f.pos || `featured-${i + 1}`, kind: "floor", title: f.title || "", productGdids: (f.productGdids || []).map(String), source: f.titleSource || "rules" }));
  (page.walls || []).forEach((w, i) => modules.push({ id: w.pos || `category-${i + 1}`, kind: "wall", title: w.title || "", productGdids: (w.productGdids || []).map(String), source: w.titleSource || "rules" }));
  if (Array.isArray(page.promoEntries) && page.promoEntries.length) modules.push({ id: "promo", kind: "promo", title: page.promoModuleTitle || "", productGdids: [], source: page.promoSourceMode || "auto" });
  if (page.editorial && Array.isArray(page.editorial.circles)) modules.push({ id: "editorial", kind: "editorial", title: Array.isArray(page.editorial.title) ? page.editorial.title.join(" ") : "", productGdids: [], source: "rules" });
  if (page.explore && Array.isArray(page.explore.items)) modules.push({ id: "explore", kind: "explore", title: "", productGdids: [], source: "rules" });
  return { engine: "rules", input: { scenario: input.scenario || "", theme: input.theme || "", heroCount: input.heroCount ?? null, poolOrder: input.poolOrder || "disc", wallGroupBy: input.wallGroupBy || "none" }, pool: poolInfo, modules, notes, pending: [] };
}

function createRulesEngine(deps = {}) {
  async function plan(snapshot, input = {}) {
    const pre = preparePool(snapshot, input);
    const { draft, notes, summary } = await curateRules(pre.snapshot, { runId: input.runId, scenario: input.scenario, theme: input.theme, pageName: input.pageName, heroCount: input.heroCount, themeFit: input.themeFit, brief: input.brief, briefFile: input.briefFile }, deps);
    const outline = outlineOf(draft, input, { size: pre.snapshot.products.length, order: input.poolOrder || "disc" }, pre.notes.concat(notes));
    outline._draft = draft; outline._summary = summary; // rules 引擎：plan 已把整份做完，build 只是取出
    Object.defineProperty(outline, "_draft", { enumerable: false }); Object.defineProperty(outline, "_summary", { enumerable: false });
    return outline;
  }
  async function build(outline) {
    if (!outline || !outline._draft) throw new CurateError("rules 引擎的 build 需要 plan() 回的 outline", 1);
    return { draft: outline._draft, notes: outline.notes, summary: outline._summary, outline };
  }
  async function curate(snapshot, input = {}) { return build(await plan(snapshot, input)); }
  return { name: "rules", plan, build, curate };
}

module.exports = { createRulesEngine, preparePool, outlineOf, CurateError };
