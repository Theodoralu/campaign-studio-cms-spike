/**
 * 機械策展 v0（workbench「快速引擎」）—— snapshot.json → draft.json（14 號契約形）
 * 用法：node curate_auto.js <run 資料夾> [--scenario "..."] [--theme "..."] [--pageName "..."]
 *
 * 定位：策展工作台的秒級預覽引擎——**只挑選、不生成**（T1/T2 的機械下界）；
 * AI 文案品質需求走 workbench 的 Claude 引擎（curate_prompt.md）。產物同樣過 gate.js 裁決。
 *
 * 鐵律（03 schema／04 §1）：真值欄（價格/折數/檔期/URL/offer/券面）逐字取自 snapshot；
 * ai-curated 標題一律無數字（避開優惠詞宣稱義務）；標籤 v5 優先序＝①offer 逐字（寬度內）
 * ②特色第一行前綴（原文有序子序列＝合規改寫），超寬裁切存 tagOriginal。
 * 分組單一來源制（U19）：promoEntries 湊不滿 ≥3 則在線活動＝整組省略（loader 維持現值＋警示）。
 */
/* ═══════════════════════════════════════════════════════════════════════════════════════
 * core/curate/rules.js —— 規則版策展引擎（D8，2026-11-13）：自 workbench/curate_auto.js main() 原樣抽出
 *   變更只有 I/O 邊界：snapshot 由參數進、draft 由回傳出、策略檔與圓卡圖探測由 deps 注入、process.exit 改 throw CurateError。
 *   選品、切層、標題、配色……每一行邏輯逐位元組不動（黃金對照 test/e2e_golden.test.js 守）。
 *   入口：curateRules(snapshot, opt, deps) → { draft, notes, summary }
 *     opt  ：{ runId, scenario, theme, pageName, heroCount, themeFit?, brief?（策略檔內容字串）, briefFile? }
 *     deps ：{ pickCircleImg(imgs) → {img, notes[]} }
 * ═══════════════════════════════════════════════════════════════════════════════════════ */
const path = require("path");
const clock = require("../../lib/clock"); // D4：唯一時鐘（CS_NOW 可固定）

const RULES = require(path.join(__dirname, "..", "..", "rules.json"));
const GATE_RULES = require(path.join(__dirname, "..", "..", "gate.js")).RULES; // CP-20 詞庫單一來源＝gate.js（鐵律：不另寫規則）
const themeDraftLib = require(path.join(__dirname, "..", "..", "lib", "theme_draft.js")); // v2 主題橋接：自訂盤推導單一真源（palette-engine 家族三軌已內接）
class CurateError extends Error { constructor(msg, code) { super(msg); this.name = "CurateError"; this.code = code; } }
// imgProbe 改由 deps.pickCircleImg 注入（規則 4：副作用往外推）； // 編輯精選圓 img 解析度守門（2026-08-26 80×80 病例根治；候選鏈單一真源）
const BASE_SYNONYMS = GATE_RULES.moduleChecks.moduleCoherence.lexicons.baseSynonyms;
const DISCOUNT_CHAR_RE = (() => { // 市價比 <0.4 禁用折數標籤（CP-02）：pattern 取自 rules 匯出
  const row = (GATE_RULES.promoWordPatterns || []).find((p) => p.id === "discountChar");
  return row ? new RegExp(row.pattern, row.flags || "") : /折/;
})();

/* ---------- 寬度模型（rules.json charLimits.widthModel；鐵律：規則不另寫，值全取自 rules.json） ---------- */
const W = RULES.charLimits.widthModel;
const charW = (ch) => (ch === " " ? W.space : ch.charCodeAt(0) > 255 ? W.fullwidth : W.halfwidth);
const strW = (s) => [...(s || "")].reduce((a, c) => a + charW(c), 0);
const emBudget = (key) => RULES.charLimits.pxBudgets[key].budgetPx / RULES.charLimits.pxBudgets[key].fontPx;
const cutToBudget = (s, budget) => {
  let acc = 0, out = "";
  for (const ch of s || "") { acc += charW(ch); if (acc > budget) break; out += ch; }
  return out;
};

/* ---------- 標籤 v5 優先序：①offer 逐字 ②feature 前綴（子序列合規）；
   市價比 <0.4 異常件＝禁折數/元價型標籤（CP-02）→ 一律走 feature ---------- */
function makeTag(p) {
  const budget = emBudget("productTag");
  const ratioAbnormal = typeof p.marketPrice === "number" && p.marketPrice > 0 && p.price / p.marketPrice < 0.4;
  const offer = (p.offer || "").trim();
  const offerBanned = ratioAbnormal && DISCOUNT_CHAR_RE.test(offer);
  if (offer && !offerBanned && strW(offer) <= budget) return { tag: offer, tagSource: "offer" };
  const feat = ((p.desc && p.desc[0]) || "").trim();
  if (feat) {
    if (strW(feat) <= budget) return { tag: feat, tagSource: "feature", tagOriginal: feat }; // 2026-07-23 修：未裁切也必帶原文——gate CP-02 feature 一律要求 tagOriginal（IKEA 保鮮袋案＝首個 7 字內 desc 踩中）
    return { tag: cutToBudget(feat, budget), tagSource: "feature", tagOriginal: feat };
  }
  if (offer && !offerBanned) return { tag: cutToBudget(offer, budget), tagSource: "offer", tagOriginal: offer };
  return { tag: "", tagSource: "feature" };
}

/* ---------- CP-20 基底詞過濾：theme/scenario 命中詞庫鍵或同義詞 → 模組成員商品名必須含基底詞 ---------- */
function baseWordsFor(text) {
  const t = (text || "").toLowerCase();
  let words = [];
  for (const [key, syns] of Object.entries(BASE_SYNONYMS)) {
    if (t.includes(key.toLowerCase()) || syns.some((s) => t.includes(s.toLowerCase()))) words = words.concat(syns);
  }
  return [...new Set(words.map((w) => w.toLowerCase()))];
}

/* ---------- 主題配色路由（B1-B6 機械近似：關鍵詞表；無命中＝pink 預設） ---------- */
const HUE_KEYWORDS = [
  { hue: "green", words: ["露營", "戶外", "登山", "野", "自然", "植", "健行"] },
  { hue: "blue",  words: ["電競", "鍵盤", "3C", "科技", "數位", "家電", "電腦"] },
  { hue: "gold",  words: ["女裝", "時尚", "精品", "秋", "咖啡", "質感", "居家"] },
  { hue: "mono",  words: ["鈦", "健康", "簡約", "極簡", "純", "無印"] }
];
function routeHue(text) {
  for (const row of HUE_KEYWORDS) if (row.words.some((w) => text.includes(w))) return row.hue;
  return "pink";
}
/* 色系的白話名（2026-09-11 文案批）：建立頁要向使用者講明「你的主題配到哪個色系」，需要人看得懂的名字。
   放這裡＝與 HUE_KEYWORDS／FAMILY_ACCENT 同一支，改路由表時不會漏改名字（避免第二份真相）。
   綠/金棕/藍沿 design-tokens/tokens.json 主題 label 用字；pink 與 mono 該檔沒有對應主題，取一般用戶看得懂的講法。 */
const HUE_LABEL = { pink: "粉色系", gold: "金棕色系", green: "綠色系", blue: "藍色系", mono: "灰階" };

/* ---------- v2 主題橋接（2026-08-26 病例 214311 根治：建立選的色到不了新版型） ----------
   色的旅程：建立時的色只落 legacy 欄（theme.colorTheme=hue-light／theme.customColor）——舊版型（kvVariant
   new/legacy）的 FrameTest 舊引擎吃這欄；新版式殼（layout-*＝shell-v2）只吃 page.themeId（token 十主題）
   與 page.colors.themeDraft（自訂盤），legacy 欄它看不見＝模組全穿預設。本橋接在建立期收尾
   （server createRun、寫完 kvVariant 之後）把建立所選的色翻譯到新欄位：
     ①自訂 hex（theme.customColor）＝走 deriveThemeDraft（lib/theme_draft 單一真源；palette-engine 家族三軌）
       寫 page.colors.themeDraft——與編修頁組合面板自訂色路（hero_combo customColor）同形＝反例 145831 同路。
     ②hue 家族（pink/gold/green/blue/mono × light/dark＝機械與 AI 引擎共同值域）＝token 十主題有同名 slug
       就寫 page.themeId；token 沒有的家族（pink/mono 與 rejected 款）＝取家族代表色走①的自訂盤路。
     ③legacy/new 頁＝no-op（colorTheme 照舊、零波及）；已有 themeId／colors.themeDraft（提案包等先寫）＝不覆蓋。
   家族代表色＝07 色彩規劃 tokens.json「campaign/accent」變數各 mode 真值（v1.1 2026-07-18 匯出；
   FrameTest THEME_EXPECT accent 同值）——禁自創色值，值變動時以該匯出檔為準同批更新。
   擋色制修訂（2026-08-27 使用者裁決「機選自動用通過版」）：代表色推導後擋級檢查不過＝自動改用
   suggestSeed 同色系通過版＋履歷記帳——「代表色原值」與「實際採用值」都寫進 note（不靜默）；
   此為「禁自創色值」的裁決性放行：使用者選的是「色系」意圖、深一階仍是同色系。 */
const V2_KV_RE = /^layout-\d{3}$/;
const FAMILY_ACCENT = {
  "pink-light": "#F26591", "pink-dark": "#F3749C",
  "gold-light": "#C0821F", "gold-dark": "#D9AB55",
  "green-light": "#5F9A66", "green-dark": "#85B389",
  "blue-light": "#417FB6", "blue-dark": "#6EA6D4",
  "mono-light": "#6E7780", "mono-dark": "#979EA8",
};

/**
 * 純函式：就地把建立所選的色橋接進 draft 的新欄位（v2 版式限定；不動 legacy 欄、不動既有新欄）。
 * @param {object} draft draft.json 解析物
 * @param {string[]|function} availableThemeIds token 主題 slug 值域（design-tokens 登記簿）；傳函式＝
 *        惰性讀簿（只有 hue 家族路需要；讀不到 throw＝值域真源缺席不靜默降級，交呼叫端出聲）
 * @returns {{applied:boolean, mode:string, note:string}} note＝白話履歷（wb.log 與 meta.themeBridge 用）
 */
function bridgeThemeForV2(draft, availableThemeIds) {
  const page = draft && draft.page;
  if (!page || typeof page !== "object") return { applied: false, mode: "no-page", note: "draft 無 page 節點＝不橋接" };
  if (!V2_KV_RE.test(String(page.kvVariant || ""))) {
    return { applied: false, mode: "legacy", note: "非新版式（layout-*）＝照舊走 theme.colorTheme，不寫新欄" };
  }
  if (page.themeId != null || (page.colors && page.colors.themeDraft)) {
    return { applied: false, mode: "present", note: "themeId／colors.themeDraft 已存在（提案包或先行寫入）＝不覆蓋" };
  }
  const th = (page.theme && typeof page.theme === "object") ? page.theme : {};
  const stamp = (mode, note) => {
    draft.meta = draft.meta || {};
    draft.meta.themeBridge = { mode, note, at: clock.iso() };
    return { applied: true, mode, note };
  };
  /* ①自訂 hex（建立表單調色盤）＝deriveThemeDraft 單一真源；欄形與 hero_combo customColor 路同形，
     編修頁組合面板可無縫接手（seed 在＝可逐槽微調）。 */
  if (themeDraftLib.isHex6(th.customColor)) {
    const seed = themeDraftLib.normHex(th.customColor);
    let td = themeDraftLib.deriveThemeDraft(seed);
    /* 擋色制兜底（2026-08-27）：建立表單前端已有同尺把關＝正常到不了這裡；若別的通道塞進不及格色，
       照「機選自動用通過版」處置＋記帳（建立收尾無面板可給選項、擋掉整個建立更傷）。 */
    const bad = themeDraftLib.checkThemeDraft(td).filter((c) => !c.pass && c.blocking !== false);
    if (bad.length) {
      const altRaw = themeDraftLib.suggestSeed(seed);
      const alt = altRaw ? themeDraftLib.normHex(altRaw) : null;
      if (alt) {
        td = themeDraftLib.deriveThemeDraft(alt);
        page.colors = { source: "custom", seed: alt, overrides: {}, themeDraft: td, seedOrigin: `auto-pass:${seed}` };
        return stamp("custom-seed-autopass", `建立自訂主色 ${seed} 文字檢查不過（${bad.map((c) => c.name).join("、")}）→ 自動改用同色系通過版 ${alt}（2026-08-27 擋色制；原值記帳）`);
      }
    }
    page.colors = { source: "custom", seed, overrides: {}, themeDraft: td };
    return stamp("custom-seed", `建立自訂主色 ${seed} → colors.themeDraft（deriveThemeDraft 單一真源；檢查=${td.qaStatus}）`);
  }
  /* ②hue 家族路：token 同名 slug＝themeId；沒有＝家族代表色走自訂盤 */
  let hue = String(th.hueFamily || "");
  let mode = th.surfaceMode === "dark" ? "dark" : "light";
  if (!FAMILY_ACCENT[`${hue}-${mode}`]) { // hueFamily 缺席/值域外＝從 colorTheme 拆（AI 引擎的硬約束欄＝colorTheme 十枚舉；prompt 逐條自查③）
    const m = /^(pink|gold|green|blue|mono)-(light|dark)$/.exec(String(th.colorTheme || ""));
    if (m) { hue = m[1]; mode = m[2]; }
  }
  const slug = `${hue}-${mode}`;
  const ids = typeof availableThemeIds === "function" ? availableThemeIds() : availableThemeIds;
  if (Array.isArray(ids) && ids.includes(slug)) {
    page.themeId = slug;
    return stamp("token-theme", `建立配色家族 ${hue}（${mode}）→ themeId=${slug}（token 十主題）`);
  }
  const rep = FAMILY_ACCENT[slug];
  if (rep) {
    let seed = rep, origin = `auto-hue:${slug}`, extra = "";
    let td = themeDraftLib.deriveThemeDraft(rep);
    /* 機選自動用通過版（2026-08-27 使用者裁決）：十家族代表色照定版原樣推導現況全數擋級不過（標題對底色）——
       機器選的色不讓機器自己的檢查擋死＝自動換同色系深一階通過版＋記帳（原代表色值留在 note 可考）。 */
    const bad = themeDraftLib.checkThemeDraft(td).filter((c) => !c.pass && c.blocking !== false);
    if (bad.length) {
      const altRaw = themeDraftLib.suggestSeed(rep);
      const alt = altRaw ? themeDraftLib.normHex(altRaw) : null;
      if (alt) { seed = alt; td = themeDraftLib.deriveThemeDraft(alt); origin = `auto-hue-pass:${slug}`; extra = `（代表色 ${rep} 檢查不過＝自動改用通過版 ${alt}；2026-08-27 裁決）`; }
      else extra = `（代表色 ${rep} 配不出通過版＝照原值帶入、檢查=${td.qaStatus}）`;
    }
    page.colors = { source: "custom", seed, overrides: {}, themeDraft: td, seedOrigin: origin };
    return stamp("family-seed", `建立配色家族 ${slug}＝token 主題沒有這款 → 家族代表色走 colors.themeDraft${extra || `；檢查=${td.qaStatus}`}`);
  }
  return { applied: false, mode: "unknown-hue", note: `hueFamily=${hue || "（缺）"} 不在家族表（pink/gold/green/blue/mono）＝不橋接、新版式將以預設主題渲染——請檢查引擎輸出值域` };
}

/**
 * 檔案版：讀 draft.json → 橋接 → 有變更才寫回（legacy/no-op＝檔案不動）。
 * 讀不到／寫不進＝throw（呼叫端記 meta.themeBridgeError＋wb.log 出聲——沿 writeLayoutChoiceIntoDraft 模式）。
 * 建立期寫入＝草稿誕生、當下無核可可失效（draft-writers.allow CREATE 節 create-theme-bridge 登錄）。
 */
// bridgeThemeForV2IntoDraft（讀寫 draft 檔）留在 workbench/curate_auto.js，不進 core

/* ---------- KV 標題：主題文字 → 兩行（mobile 無起徽行限 5 全形/行＝rules.json）；無主題＝模板（無數字） ---------- */
function kvTitle(theme, brand) {
  const maxLine = RULES.charLimits.mobile.kvTitleLineNoBadge.maxFullwidthChars;
  const t = (theme || "").replace(/\s+/g, "");
  if (t.length >= 4) {
    let cut = Math.min(Math.ceil(t.length / 2), maxLine);
    // 2026-07-23 修：切點落在 ASCII 連串（數字/英文）中間＝斷詞（「不鏽鋼30｜4安心廚房」）——就近找 CJK↔ASCII 邊界；
    // 行寬約束用 strW 寬度（數字 0.55 全形）非字元數，「不鏽鋼304」＝4.65 寬合法
    const isAscii = (c) => c && c.charCodeAt(0) <= 255;
    const fits = (i) => strW(t.slice(0, i)) <= maxLine && strW(t.slice(i)) <= maxLine;
    if (isAscii(t[cut - 1]) && isAscii(t[cut])) {
      for (let d = 1; d < t.length; d++) {
        const L = cut - d, R = cut + d;
        if (L > 0 && !(isAscii(t[L - 1]) && isAscii(t[L])) && fits(L)) { cut = L; break; }
        if (R < t.length && !(isAscii(t[R - 1]) && isAscii(t[R])) && fits(R)) { cut = R; break; }
      }
    }
    return { line1: t.slice(0, cut), line2: cutToBudget(t.slice(cut), maxLine) };
  }
  const b = (brand || "").trim();
  const cjkBrand = b && [...b].every((c) => c.charCodeAt(0) > 255) && b.length <= maxLine;
  return { line1: cjkBrand ? b : "本檔嚴選", line2: "精選好物" };
}

async function curateRules(snap, opt = {}, deps = {}) { // async 化（2026-08-26）：圓 img 解析度探測要等網路圖頭；其餘流程不變
  if (!snap || !Array.isArray(snap.products)) throw new CurateError("curateRules：snapshot 缺 products[]", 1);
  const pickCircleImg = deps.pickCircleImg || (async (imgs) => ({ img: (imgs || [])[1] || (imgs || [])[0] || "", notes: ["圓卡圖探測未注入＝照慣例取第二張"] }));
  const runDir = opt.runId || "run";
  const scenario = opt.scenario || "";
  const theme = opt.theme || "";
  const now = clock.unix();
  const notes = [];
  /* 本期活動入口先過主題契合尺（ENTRY-THEMEFIT-SELF-CHECK，2026-09-28）：--themeFit <feedback_patch.json>＝讀 themeFitRule，
     用 gate CP-14 同一支 lib/theme_fit 判每個候選；硬判不過（池 ≥5 件、命中率 < 門檻）＝不選、換下一檔並出聲。沒帶＝逐位元組舊行為。
     病例＝140838：系統自己挑的 19788（百貨週年慶，20 件只 1 件星巴克）被自己的檢查判 5%＜30% FAIL，使用者無從修。 */
  let themeFitRule = null;
  if (opt.themeFit) {
    const TF = require(path.join(__dirname, "..", "..", "lib", "theme_fit.js"));
    const r = TF.loadThemeFitRule(opt.themeFit, null);
    if (r && r.keywords.length) themeFitRule = { ...r, TF, globalHits: TF.globalHits(snap.products, r) };
    else notes.push("主題契合尺：校準檔沒有詞組＝本期活動入口不過濾（照舊）");
  }
  /* 乙（2026-09-27 使用者裁「主視覺優先、下面讓位」維持）：--heroCount N＝新版式（layout-0NN）路，server 依登記簿算好帶進來：
     ①主打預留 N 件＝版式主視覺商品槽容量——U22 讓位序 KV＞樓層 在生成端的真正實作：主視覺要幾件就先拿幾件、樓層從下一件起切。
       原本永遠只留 3 件，四件槽版式（001/002/003/005 左右各 2、004 拼貼 4、006/007 環列 4）主視覺第 4 格必然吃到
       第 1 層情境卡代表品（run 142315／123617 病例；全庫 58 檔有商品槽的活動 35 檔在撞）。
     ②主打只挑名字放得進主視覺兩行的（尺＝rules.json heroName 760px@16px＝gate CP-03 同一把）——編輯器把商品放進主視覺槽時
       「主視覺標題」欄預設＝商品全名，第一次存檔就寫進 heroName；長名進主視覺＝使用者什麼都沒改就吃一條 CP-03（run 123617 gdid 11643457）。
       太長的不丟、往後排給樓層／牆用。
     沒帶＝舊殼（kv 頁）與既有測試的路＝舊行為逐位元組不變。值域 3～8 夾住＝防手滑。 */
  const heroMode = opt.heroCount != null && String(opt.heroCount).trim() !== "";
  const heroCount = heroMode ? Math.min(8, Math.max(3, parseInt(opt.heroCount, 10) || 3)) : 3;
  const heroNameBudget = emBudget("heroName");
  const fitsHero = (p) => strW(p.name) <= heroNameBudget;

  /* 商品池：去重＋有名有價有圖才入池；CP-20 基底詞過濾（theme 命中詞庫時，成員商品名必含基底詞）；
     排序＝折數深→淺（disc 小=折深；無 disc 排後） */
  const seen = new Set();
  let pool = (snap.products || []).filter((p) => {
    if (!p || !p.gdid || !p.name || typeof p.price !== "number" || !(p.imgs && p.imgs[0])) return false;
    if (seen.has(String(p.gdid))) return false;
    seen.add(String(p.gdid));
    return true;
  });
  const baseWords = baseWordsFor(theme + " " + scenario);
  if (baseWords.length) {
    const before = pool.length;
    pool = pool.filter((p) => { const n = p.name.toLowerCase(); return baseWords.some((w) => n.includes(w)); });
    notes.push(`CP-20 基底詞過濾 {${baseWords.join("、")}}：池 ${before} → ${pool.length} 件`);
  }
  pool.sort((a, b) => (a.disc == null ? 999 : a.disc) - (b.disc == null ? 999 : b.disc));

  /* 策略檔指導選品（71 號方案 A 階段二；2026-09-14 使用者裁「依建議開工」）：
     --brief <path> 有給＝先讀策略檔，把池重排成它說的順序（避開整頁不放／多放排最前／每層照「放什麼」的字挑、不夠機器補），
     下面的切法一行不改——切出來的就是策略檔說的。沒給＝連 lib 都不載，舊行為逐位元組不變。
     排在池量守門之前＝「避開」排掉太多、池不夠時，由既有守門出聲（裁 4 甲：照排、大聲講、不放回去）。
     策略檔沒通過檢查＝出聲、照機器預設選品；伺服器那端套標題時會再擋一次並記 briefApplyError（同一份錯誤，兩處都講）。 */
  let briefSelection = null, briefData = null;
  if (opt.brief) {
    try {
      const briefLib = require(path.join(__dirname, "..", "..", "lib", "curation_brief.js"));
      const BS = require(path.join(__dirname, "..", "..", "lib", "brief_selection.js"));
      const FMT = require(path.join(__dirname, "..", "..", "lib", "curation_brief_format.js"));
      const parsed = briefLib.parseBrief(opt.brief); // D8：策略檔內容由呼叫端讀好傳進來（第二階段功能，第一版沒人傳）
      if (!parsed.ok) throw new Error("策略檔沒通過檢查：" + parsed.errors.map((e) => e.say).join("；"));
      const r = BS.applySelection(pool, parsed.data, { kvCount: heroCount, floorSize: 4, floorMax: FMT.floorMax() }); // kvCount 跟主打預留件數同數（乙）
      pool = r.pool;
      briefSelection = r.report;
      briefData = parsed.data; // 牆那段要用（放什麼）——牆的件數要等下面算完餘量才知道，所以牆的挑法排在那裡
      const ex = r.report.exclude, inc = r.report.include;
      notes.push(`策略檔選品：${ex ? `避開 {${ex.words.join("、")}} 排掉 ${ex.removed} 件（${ex.before}→${ex.after}）` : "沒寫避開"}；${inc ? `多放 {${inc.words.join("、")}} 提前 ${inc.boosted} 件` : "沒寫多放"}；` +
        r.report.floors.map((f, i) => `第 ${i + 1} 層${f.machine ? "機器" : `照「${f.words.join("、")}」對到 ${f.matched}${f.filled ? `＋補 ${f.filled}` : ""}`}`).join("、"));
      /* 主打商品的帳（2026-09-24）：有餘量的層出代表、池頂補、保留給沒餘量的層幾件——沒帳（一層字都沒寫）＝照舊池頂前 3，不多講 */
      const kvr = r.report.kv;
      if (kvr) notes.push(`主打商品：${kvr.matched ? `有餘量的層出代表 ${kvr.matched} 件（第 ${kvr.fromFloors.filter((x) => x != null).map((x) => x + 1).join("、")} 層）` : "沒有哪一層有餘量出代表"}${kvr.filled ? `＋池頂補 ${kvr.filled} 件` : ""}；沒餘量的層要的 ${kvr.protectedCount} 件不拿`);
    } catch (e) {
      notes.push("策略檔選品沒有套用（照機器預設選品）：" + e.message);
      briefSelection = null;
    }
  }

  /* 池量守門：版型最低契約＝KV3＋樓層3×4＋牆3×4＝27 件不重複商品（floorSize 4＝本檔第 290 行；2026-10-05 改：原本這段註解與訊息算樓層 3×3＝24，與下方 <27 的門檻相差三件，同一支程式兩種說法）。
     <6 件＝抓取解析近空（來源頁不支援或無內嵌商品）→ 明確報錯不產空稿；6~26 件＝產稿但如實預警 gate 將 FAIL */
  if (pool.length < 6) {
    throw new CurateError(`策展中止：商品池僅 ${pool.length} 件（來源頁可能不支援解析或無內嵌商品資料）。` +
      `版型最低契約需 27 件不重複商品（KV3＋樓層3×4＋牆3×4）；請改用品牌頁/活動賣場 URL，或人工補抓（R3）。`, 2);
  }
  if (pool.length < 27) notes.push(`商品池 ${pool.length} 件 <27（版型最低契約：KV3＋樓層3×4＋牆3×4）＝配額將縮減、gate 可能 FAIL；建議換更大池的來源或 R3 人工補抓`);

  /* KV 主品＝池前 heroCount 件（預設 3；U22 讓位序 KV＞樓層＞牆：主品不再出現於樓層/牆卡）；kvShortName 依 rules 寬度裁切
     新版式路（heroMode）：名字放不進主視覺兩行的不當主打、往後排（留給樓層／牆），主打從池頭往下挑到 N 件放得進的為止 */
  const kvBudget = emBudget("kvShortName");
  let kvProds;
  if (heroMode) {
    const picked = [], demoted = [];
    for (const p of pool) { if (picked.length >= heroCount) break; (fitsHero(p) ? picked : demoted).push(p); }
    kvProds = picked;
    if (demoted.length) {
      const kvSet = new Set(picked);
      pool = picked.concat(pool.filter((p) => !kvSet.has(p))); // 主打歸位在最前、被讓開的長名緊跟其後（原本的折數序不變）
      notes.push(`主打商品跳過 ${demoted.length} 件名字放不進兩行的，往後排給樓層。`);
    }
    if (heroCount > 3) notes.push(`主打商品預留 ${heroCount} 件，樓層從第 ${heroCount + 1} 件起分。`);
  } else {
    kvProds = pool.slice(0, 3);
  }

  let cursor = kvProds.length;
  const floorTitleTpl = [
    { title: "主打嚴選", sub: "本檔優先看這裡", tag: "嚴選" },
    { title: "人氣推薦", sub: "口碑與回購精選", tag: "人氣" },
    { title: "質感首選", sub: "值得升級的一件", tag: "質感" }
  ];
  /* 樓層結構＝demo 資料邏輯（2026-07-22 使用者裁定回歸）：情境卡代表品（scene）＋3 商品卡＝4 件不重複；
     代表品不入卡列（同樓層 scene 與卡不得同商品）——每層自池消耗 4 件 */
  const floors = [];
  for (let i = 0; i < 3 && cursor + 4 <= pool.length; i++) {
    const items = pool.slice(cursor, cursor + 4);
    floors.push({ rep: items[0], items: items.slice(1), tpl: floorTitleTpl[i] });
    cursor += 4;
  }
  const walls = [];
  const wallTitleTpl = ["更多選品一次看", "追加補貨清單", "順手加購小物"];
  {
    const remain = pool.length - cursor;
    let sizes;
    if (remain >= 12) { // 保 3 面起跳，餘量升級單面 4→8→12（U27 枚舉）
      sizes = [4, 4, 4];
      // 2026-07-23 ②定案配套：牆升級前保留編輯精選配額（圓2＋牆4＝6）——固定模組優先於牆加量
      // （LC 品牌頁實證：貪婪升級 12/12/12 吃光餘池＝editorial 連鍵省略、該區隱藏）；池緊時優先序＝牆基本量＞編輯精選＞牆升級
      const ED_RESERVE = 6;
      let extra = Math.max(0, remain - 12 - ED_RESERVE);
      for (let i = 0; i < sizes.length && extra >= 4; i++) while (sizes[i] < 12 && extra >= 4) { sizes[i] += 4; extra -= 4; }
    } else sizes = remain >= 8 ? [8] : remain >= 4 ? [4] : []; // 不足 3 面＝如實呈現
    /* 策略檔的牆「放什麼」（2026-09-14 使用者實走：「醬料與調味」底下不能是計時器）：件數已算好，把餘池照字重排，切法照舊。
       帳寫進 briefSelection.walls；一件都沒對到的牆＝applyBriefToDraft 不掛人寫的標題。 */
    if (briefSelection && briefData && Array.isArray(briefData.walls) && briefData.walls.length && sizes.length) {
      const BS2 = require(path.join(__dirname, "..", "..", "lib", "brief_selection.js"));
      const w = BS2.pickGroups(pool.slice(cursor), briefData.walls, sizes);
      pool = pool.slice(0, cursor).concat(...w.groups, w.rest);
      briefSelection.walls = w.report;
      notes.push("策略檔牆：" + w.report.map((g, i) => `第 ${i + 1} 面${g.machine ? "機器" : `照「${g.words.join("、")}」對到 ${g.matched}${g.filled ? `＋補 ${g.filled}` : ""}`}`).join("、"));
    }
    sizes.forEach((take, i) => { walls.push({ items: pool.slice(cursor, cursor + take), title: wallTitleTpl[i] }); cursor += take; });
  }
  if (walls.length < 3) notes.push(`品類牆 ${walls.length} 面 <3（U18 契約 3~5）＝池量不足如實呈現`);

  /* 編輯精選（editorial）＝餘池生成（2026-07-23 使用者指示＝14 §8 待審②定案）：
     圓×2＋牆 4|8|12（U27 枚舉、上限 12）——全部取自未曝光餘池＝CP-18 全頁互斥天然安全；
     餘池 <6（圓2＋牆4）＝整鍵省略（loader 端＝該區隱藏降級，不再殘留示範集內容） */
  let editorialCircles = null, editorialWallItems = null;
  {
    const rest = () => pool.length - cursor;
    if (rest() >= 6) {
      editorialCircles = pool.slice(cursor, cursor + 2); cursor += 2;
      let take = 0; for (const s of [12, 8, 4]) if (rest() >= s) { take = s; break; }
      editorialWallItems = pool.slice(cursor, cursor + take); cursor += take;
      notes.push(`編輯精選＝圓×2＋牆 ${take} 件（餘池生成、未曝光品）`);
    } else notes.push(`餘池 ${rest()} 件 <6＝編輯精選整鍵省略（該區隱藏降級）`);
  }

  /* 本期活動入口：在線（endTs>now）＋該 actid 有池商品；CP-08 img＝snapshot 原序該 actid 首件 imgs[0]；<3 則整組省略（U19 單一來源制） */
  const promoEntries = [];
  for (const pr of snap.promotions || []) {
    if (!pr.actid || !pr.url || !pr.title) continue;
    if (typeof pr.endTs === "number" && pr.endTs < now) continue;
    const first = (snap.products || []).find((p) => p && String(p.actid || "") === String(pr.actid) && p.imgs && p.imgs[0]);
    if (!first) continue;
    if (themeFitRule) { // 系統挑的入口先過自己的檢查（同一把尺）；只擋硬判 fail，WARN 級（池小／零命中）照舊交人工
      const v = themeFitRule.TF.entryFitVerdict({ actid: pr.actid, title: pr.title, snap, themeFit: themeFitRule, themeGlobalHits: themeFitRule.globalHits });
      if (v.kind === "fail") { notes.push(`本期活動入口跳過 actid ${pr.actid}「${pr.title}」：商品池 ${v.total} 件只有 ${v.hits} 件跟主題有關（${Math.round(v.rate * 100)}%＜${Math.round(themeFitRule.threshold * 100)}%）——系統自己挑的不該被自己的檢查打回票`); continue; }
    }
    promoEntries.push({
      actid: String(pr.actid), title: pr.title, chip: pr.short || pr.title, copy: pr.title,
      dateValue: pr.period || "", img: first.imgs[0], url: pr.url, destinationType: "activity"
    });
    if (promoEntries.length === 3) break;
  }
  const hasPromo = promoEntries.length >= 3;
  if (!hasPromo) notes.push(`在線活動入口 ${promoEntries.length} 則 <3（U17/U19）＝promoEntries 整組省略、loader 維持現值`);

  /* 主題／文案（ai-curated 一律無數字） */
  const routeText = theme + " " + scenario + " " + (snap.brand || "");
  const hue = routeHue(routeText);
  const title = kvTitle(theme, snap.brand);
  const themeLabel = theme || (snap.brand || "本檔") ;

  const products = [];
  const pushProducts = (items, position) => items.forEach((p, i) => {
    const t = makeTag(p);
    const row = {
      gdid: String(p.gdid), position, order: i + 1,
      name: p.name, price: p.price, url: p.url,
      img: p.imgs[0], sceneImg: p.imgs[1] || p.imgs[0],
      offer: p.offer || "", tag: t.tag, tagSource: t.tagSource
    };
    if (t.tagOriginal) row.tagOriginal = t.tagOriginal;
    if (typeof p.marketPrice === "number" && p.marketPrice > p.price) row.marketPrice = p.marketPrice;
    if (p.store) row.store = p.store; // 賣場名稱（2026-08-26 店名欄）：池有才帶、缺席不留空字串（促銷卡「有 store 才顯示店名列」）
    if (position === "kv-main") row.kvShortName = cutToBudget(p.name, kvBudget);
    return products.push(row);
  });
  pushProducts(kvProds, "kv-main"); // KV 主品獨立入 products[]（U22 讓位序：不與樓層/牆卡重疊）
  floors.forEach((f, i) => { pushProducts([f.rep], `featured-${i + 1}-scene`); pushProducts(f.items, `featured-${i + 1}`); });
  walls.forEach((w, i) => pushProducts(w.items, `category-${i + 1}`));
  if (editorialWallItems) pushProducts(editorialWallItems, "editorial-wall"); // loader 既有契約入口（position=editorial-wall）

  const d = clock.date();
  const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  const draft = {
    page: {
      id: path.basename(runDir),
      pageName: opt.pageName || `${themeLabel}_${scenario ? scenario.split(" ")[0] : "機械策展"}_${ym}`,
      status: "草稿",
      template: "MVP-v1",
      inputTier: theme || scenario ? "T2" : "T1",
      curationGoal: scenario || "",
      curationTheme: theme || "",
      theme: { hueFamily: hue, colorTheme: `${hue}-light`, surfaceMode: "light", kvTitleStyle: "deep", moduleBorderStyle: "theme", labelStyle: "deep-plate" },
      kv: {
        eyebrow: "CURATED SELECTION", eyebrowZh: `${themeLabel}選品`,
        titleLine1: title.line1, titleLine2: title.line2,
        titleSource: "ai-curated", showSuffix: false, titleFlip: true, showMarquee: true,
        actid: "", dateValue: "",
        /* 舊 KV 節點固定 3 件（gate KV_KEY_PRODUCTS＝3；layout-0NN 頁這節點休眠、主視覺槽讀的是 products[] 前 N 件 kv-main）——預留 4 件時多的那件只進 products[] */
        images: kvProds.slice(0, 3).map((p) => p.imgs[1] || p.imgs[0]),
        keyProductGdids: kvProds.slice(0, 3).map((p) => String(p.gdid)),
        eyebrowCnMobile: "auto"
      },
      ctaText: `看更多${themeLabel}選品`,
      dockFeaturedLabel: "主打精選",
      footerTitle: `${themeLabel}選品`,
      noticeText: "商品價格、優惠條件、活動期間與可售狀態，請以商品頁與結帳頁顯示為準。\n不同商品可能適用不同優惠、配送方式與庫存狀態。\n點擊商品卡後可前往商品頁查看完整規格、付款方式、配送資訊與最新優惠。",
      floors: floors.map((f, i) => ({
        pos: `featured-${i + 1}`,
        title: f.tpl.title, titleSource: "ai-curated", subtitle: f.tpl.sub,
        sceneCopy: { tag: f.tpl.tag, title: f.tpl.title, sub: f.tpl.sub },
        productGdids: f.items.map((p) => String(p.gdid)),
        sceneImg: f.rep.imgs[0], sceneUrl: f.rep.url, // 情境卡＝代表品（不入卡列＝不重複；URL 全頁唯一 CP-12）
        moreLink: { enabled: "off", url: "" }
      })),
      walls: walls.map((w, i) => ({
        pos: `category-${i + 1}`, title: w.title, titleSource: "ai-curated",
        productGdids: w.items.map((p) => String(p.gdid)),
        moreLink: { enabled: "off", url: "" }
      })),
      categoryWallCount: walls.length
    },
    products,
    meta: {
      generatedBy: "curate_auto v0（機械策展：只挑選不生成；moreLink 全 off＝U28 目的地驗證需網路/人工）",
      engine: "auto", scenario, theme, sourceUrl: snap.sourceUrl || "", generatedAt: clock.iso(),
      notes,
      /* 策略檔選品的帳（沒帶策略檔＝鍵不存在，draft 形狀與舊版一致）：applyBriefToDraft 折成人話進 meta.brief.notices、畫面揭示區讀。
         floors 只留真的建出來的那幾層（容量判定與上面 for 迴圈同條，這裡再對一次帳） */
      ...(briefSelection ? { briefSelection: { ...briefSelection, floors: briefSelection.floors.slice(0, floors.length) }, briefFile: opt.briefFile || "brief.md" } : {})
    },
    assets: {}
  };
  if (hasPromo) {
    draft.page.promoEntries = promoEntries;
    draft.page.promoModuleTitle = "本期活動：" + promoEntries.map((e) => e.chip).join("・");
    // dock 短標 ≤4 全形：chip 全文放得下才逐字用（禁裁切＝防「特價229元起」截成錯誤價格宣稱）；否則無數字備用詞
    draft.page.dockPromoLabel = strW(promoEntries[0].chip) <= 4 ? promoEntries[0].chip : "本期優惠";
  }
  /* 編輯精選鍵（2026-07-23 待審②定案）：title 三行 ≤6 全形（ai-curated 無數字）＋圓×2
     （tag＝標籤 v6 makeTag、copy＝品名裁切＝真值子序列；img＝第二張白底 U10 慣例；url＝商品頁真值） */
  if (editorialCircles) {
    const edT = kvTitle(themeLabel, snap.brand); // 對半切行（同 KV 標題邏輯＝不斷詞）
    /* 圓 img 解析度守門（2026-08-26 病例根治：80×80 縮圖塞 300px 圓）——「imgs[1] 第二張白底圖」慣例
       保留為首選，但候選必須實測寬 ≥300（HTTP 抓圖頭部分下載＝img_probe 單一真源）；不合格依序試
       imgs[2..]、都不合格退主圖照實用＋notes 出聲（不吞、不留空；引擎低解析防護兜底顯示） */
    const circleRows = [];
    for (const p of editorialCircles) {
      const t = makeTag(p);
      const pick = await pickCircleImg(p.imgs);
      pick.notes.forEach((n) => notes.push(`編輯精選圓（gdid ${p.gdid}）：${n}`));
      circleRows.push({ tag: t.tag || cutToBudget(p.name, emBudget("productTag")), copy: cutToBudget(p.name, 18),
                        date: "", img: pick.img, url: p.url });
    }
    draft.page.editorial = {
      title: [edT.line1, edT.line2, "編輯室嚴選提案"].filter(Boolean),
      circles: circleRows
    };
  }
  /* 延伸探索（2026-07-23 待審③定案）：items 目的地＝真值 URL 限定（來源頁＋首則在線活動）、不機造搜尋 query；
     sub 一律無數字固定詞（防活動標題截斷成錯誤價格宣稱＝dockPromoLabel 同款防線）；湊不滿＝連鍵省略（該區隱藏降級） */
  {
    const exploreItems = [];
    if (snap.sourceUrl) exploreItems.push({
      label: strW(`前往${themeLabel}來源頁`) <= 12 ? `前往${themeLabel}來源頁` : "前往來源頁完整選品", // 超寬＝整句換用固定詞（禁裁切斷詞）；themeLabel 優先（搜尋頁多品牌時 snap.brand 易誤判）
      sub: "完整選品一次看",
      img: (pool[cursor] || pool[0]).imgs[0], url: snap.sourceUrl });
    const firstPromo = (snap.promotions || []).find((pr) => pr && pr.url && pr.title && !(typeof pr.endTs === "number" && pr.endTs < now));
    if (firstPromo) {
      const fi = (snap.products || []).find((p) => p && String(p.actid || "") === String(firstPromo.actid) && p.imgs && p.imgs[0]);
      if (fi && String(firstPromo.url) !== String(snap.sourceUrl)) exploreItems.push({
        label: "看更多優惠活動", sub: "檔期優惠一覽", img: fi.imgs[0], url: firstPromo.url });
    }
    if (exploreItems.length) {
      draft.page.explore = { moreUrl: snap.sourceUrl || exploreItems[0].url, ctaText: draft.page.ctaText, items: exploreItems };
      notes.push(`延伸探索＝${exploreItems.length} 卡（真值 URL：來源頁${exploreItems.length > 1 ? "＋在線活動" : ""}）`);
    } else notes.push("延伸探索＝無可用真值 URL＝整鍵省略（該區隱藏降級）");
  }

  const summary = `draft.json 產出（機械策展 v0）：樓層×${floors.length}、牆×${walls.length}、入口${hasPromo ? "×3" : "省略"}、商品 ${products.length} 件、theme=${hue}-light`;
  return { draft, notes, summary };
}
module.exports = { curateRules, CurateError, bridgeThemeForV2, FAMILY_ACCENT, routeHue, HUE_LABEL };
