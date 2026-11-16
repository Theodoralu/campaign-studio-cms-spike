"use strict";
/**
 * core/finish/index.js —— 策展之後、檢查之前的收尾（D9，2026-11-16）
 *
 * 來源：workbench/server.js finishDraftAfterCurate（293–479，187 行；讀檔 10、寫檔 4、網路 2、log 34）。
 * 原函式每一步都是「讀 draft.json → 改 → 寫回 → 寫 log／meta」。這裡把每一步的「改」抽成純步驟：
 *     step(draft, ctx) → { changed, logs: [字串], meta: {要併進 wb_meta 的欄位} }
 * 就地改 draft（與原碼相同語意），不讀寫檔、不觸網、不寫 log——那些由呼叫端做（單機版殼＝server.js；CMS＝D11 的 RunStore 工作）。
 * 原則沿原碼：每一步失敗要出聲但不擋建立（配色、版式、主題橋接缺席只影響外觀；價格沒對上交發佈前檢查）。
 * log 文字與 meta 欄位名逐字沿用原碼（前端黃條、列表警告都讀這些欄位）。
 *
 * 步驟順序（原碼順序，不可換：橋接看 kvVariant 分流、對價要排在所有改稿之後）：
 *   1. themeFitPatch        CP-14 主題詞組校準內容（純計算；寫 feedback_patch.json 由呼叫端）
 *   2. customThemeColor     建立表單選的自訂品牌色
 *   3. layoutChoice         版式選定＋主視覺商品槽預填
 *   4. proposalPack         提案包整組落地　　　　　　　【第二階段：不在這裡，單機版殼保留原碼】
 *   5. themeBridge          v2 主題橋接（新版式吃 themeId／themeDraft）
 *   6. brief                活動策略檔套用　　　　　　　【第二階段：同上】
 *   7. priceTruth           建立期價格對真：拿一批「活體價列」把快照與草稿對齊（列從哪來＝D7 兩層任一，由呼叫端取）
 */
const path = require("path");
const PIPE = path.join(__dirname, "..", "..");
const { deriveThemeKeywords } = require(path.join(PIPE, "lib", "theme_keywords.js"));
const layoutLib = require(path.join(PIPE, "lib", "layout_choice.js"));
const { applyPriceTruth } = require(path.join(PIPE, "lib", "price_truth.js"));
const { bridgeThemeForV2 } = require(path.join(PIPE, "core", "curate", "rules.js"));
const { patchSnapshotPrice } = require(path.join(PIPE, "core", "product-truth", "rows.js"));

const errText = (e) => String((e && e.message) || e);
const THEME_FIT_NOTE = "機械派生＝curationTheme＋來源頁詞（2026-07-25 裁決 Q1-B1、U23 同源；30% 門檻不變；人工詞組可直接改本檔或經工作台「主題詞組」卡）";

/** 來源頁詞（原 server.js deriveSourceKeywords 的計算部分）：搜尋網址的 p= 詞＋來源頁 <title> 的頭一段。pageTitle 由呼叫端給（爬頁版＝raw/source_page.html 的 title；uther 版＝snapshot.brand）。 */
function deriveSourceKeywords(srcUrl, pageTitle) {
  const kws = new Set();
  try { const u = new URL(srcUrl || ""); const q = u.searchParams.get("p");
    if (q) decodeURIComponent(q).split(/[\s+]+/).forEach((w) => { const t = w.trim().toLowerCase(); if (t.length >= 2) kws.add(t); });
  } catch (e) { /* 壞網址＝沒有搜尋詞 */ }
  if (pageTitle) {
    const head = String(pageTitle).split(/[,，|｜]/)[0].replace(/優惠推薦.*$/, "").trim();
    head.split(/[\/、\s\-]+/).forEach((w) => { const t = w.trim().toLowerCase(); if (t.length >= 2 && !/yahoo|購物中心/i.test(t)) kws.add(t); });
  }
  return [...kws];
}

/** 步驟 1：CP-14 主題詞組校準檔內容。回 { patch: 物件|null, text: 要落檔的 JSON 字串|null, keywords } ——沒有詞＝null（不寫檔） */
function themeFitPatch({ theme, sourceUrl, pageTitle }) {
  const kws = [...new Set([...deriveThemeKeywords(theme), ...deriveSourceKeywords(sourceUrl, pageTitle)])];
  if (!kws.length) return { patch: null, text: null, keywords: [] };
  const patch = { themeFitRule: { keywords: kws, threshold: 0.3, note: THEME_FIT_NOTE } };
  return { patch, text: JSON.stringify(patch, null, 1), keywords: kws };
}

/** 步驟 2：自訂品牌色。色碼合法才套；覆寫 curate 的 auto hue、保留其餘 theme 欄位。 */
function customThemeColor(draft, { input }) {
  if (!(input.themeColor && /^#?[0-9a-fA-F]{6}$/.test(String(input.themeColor).replace("#", "")))) return { changed: false, logs: [], meta: {} };
  const hex = input.themeColor[0] === "#" ? input.themeColor : "#" + input.themeColor;
  const mode = input.themeMode === "dark" ? "dark" : "light";
  draft.page.theme = { ...(draft.page.theme || {}), hueFamily: "custom", colorTheme: `custom-${mode}`, surfaceMode: mode, customColor: hex };
  return { changed: true, logs: [`自訂主題色寫入：${hex}（${mode}）＝建置流程選定，覆寫 auto 配色`], meta: {} };
}

/** 步驟 3：版式選定＋主視覺商品槽預填。失敗＝meta.layoutChoiceWriteError（前端黃條）。 */
function layoutChoice(draft, { input, layoutOverridePaths }) {
  if (!(input.kvVariant && input.layoutChoice)) return { changed: false, logs: [], meta: {} };
  try {
    layoutLib.applyLayoutChoiceToDraft(draft, input, layoutOverridePaths || {});
    return { changed: true, meta: {}, logs: [`版式選定：kvVariant=${input.kvVariant}（${input.layoutChoice.by}）——${input.layoutChoice.reason}${input.layoutChoice.engineNote ? "｜" + input.layoutChoice.engineNote : ""}`] };
  } catch (e) {
    return { changed: false, logs: ["版式選擇寫入失敗：" + errText(e)], meta: { layoutChoiceWriteError: errText(e) } };
  }
}

/** 步驟 5：v2 主題橋接。themeIds＝惰性取值函式（只有 hue 家族路需要值域）。失敗＝meta.themeBridgeError。 */
function themeBridge(draft, { themeIds }) {
  try {
    const br = bridgeThemeForV2(draft, themeIds || (() => layoutLib.loadLayoutDeps().registries.themeIds));
    if (br.applied) return { changed: true, logs: [`v2 主題橋接：${br.note}`], meta: {} };
    if (br.mode === "unknown-hue") return { changed: false, logs: [`⚠ v2 主題橋接未套用：${br.note}`], meta: {} };
    return { changed: false, logs: [], meta: {} };
  } catch (e) {
    return { changed: false, logs: ["⚠ v2 主題橋接失敗（新版式暫以預設主題渲染；可到編修頁組合面板重選主題或自訂色）：" + errText(e)], meta: { themeBridgeError: errText(e) } };
  }
}

/**
 * 步驟 7：建立期價格對真。rows＝product_check 形狀的活體價列（D7：utherLayer 或 pageLayer → buildCheck().results）。
 * 就地改 snapshot 與 draft；回 applied（每件 from→to）讓呼叫端同步 product_check.json。log 文字逐字沿原碼。
 */
function priceTruth(draft, { snapshot, rows, checkedAt, mode = "live", startedAt, finishedAt }) {
  const logs = [];
  try {
    const r = applyPriceTruth({ snap: snapshot, draft, rows, checkedAt, patchSnapshotPrice });
    if (r.applied.length) {
      for (const a of r.applied) logs.push(`價格改用商品頁現價：gdid ${a.gdid} $${a.from.price}→$${a.to.price}${a.to.marketPrice ? `、原價 ${a.to.marketPrice}` : a.from.marketPrice ? "、原價移除" : ""}`);
      logs.push(`建立期價格對真：${r.applied.length} 件改用商品頁現價，來源紀錄與草稿已同步（來源活動頁沒給促銷價）`);
    } else if (r.offline) logs.push(`⚠ 建立期價格對真：${r.checked} 件都沒能連上商品頁，價格沒動。發佈前檢查會再驗`);
    else logs.push(`建立期價格對真：${r.checked} 件與商品頁一致`);
    if (r.unverified && !r.offline) logs.push(`⚠ 建立期價格對真：${r.unverified} 件沒能連上商品頁，價格沒動。發佈前檢查會再驗`);
    if (r.skippedNotInPool.length) logs.push(`⚠ 建立期價格對真：${r.skippedNotInPool.length} 件不在來源紀錄裡、沒改（gdid ${r.skippedNotInPool.join("、")}）`);
    if (r.skippedNotInDraft.length) logs.push(`建立期價格對真：${r.skippedNotInDraft.length} 件不在草稿上、沒動（報告多給的列）`);
    return { changed: r.applied.length > 0, logs, applied: r.applied, result: r,
      meta: { priceTruth: { stage: "done", startedAt, finishedAt, total: r.checked, applied: r.applied.length, unverified: r.unverified, offline: r.offline, mode } } };
  } catch (e) {
    return { changed: false, applied: [], result: null, logs: ["⚠ 建立期價格對真沒有跑成，價格沒動。發佈前檢查會再驗（技術：" + errText(e) + "）"],
      meta: { priceTruth: { stage: "error", error: errText(e), finishedAt }, priceTruthError: errText(e) } };
  }
}

/**
 * 第一版（MVP）收尾：步驟 2 → 3 → 5 →（rows 有給才）7，全在記憶體。回 { draft, snapshot, logs, meta, applied }。
 * 第二階段的 4（提案包）、6（策略檔）插在各自的位置，介面相同。
 */
function finishDraft({ draft, snapshot, input, rows, checkedAt, ctx = {} }) {
  const logs = [], meta = {};
  const run = (r) => { logs.push(...r.logs); Object.assign(meta, r.meta); return r; };
  run(customThemeColor(draft, { input }));
  run(layoutChoice(draft, { input, layoutOverridePaths: ctx.layoutOverridePaths }));
  run(themeBridge(draft, { themeIds: ctx.themeIds }));
  let applied = [];
  if (rows) applied = run(priceTruth(draft, { snapshot, rows, checkedAt, mode: ctx.priceTruthMode, startedAt: ctx.startedAt, finishedAt: ctx.finishedAt })).applied;
  return { draft, snapshot, logs, meta, applied };
}

module.exports = { finishDraft, THEME_FIT_NOTE, themeFitPatch, deriveSourceKeywords, customThemeColor, layoutChoice, themeBridge, priceTruth };
