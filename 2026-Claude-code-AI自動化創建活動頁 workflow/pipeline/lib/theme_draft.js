"use strict";
const path = require("path");
/* 家族三軌公式單一真源＝design-tokens/palette-engine.js（1.1.0 brandFamily；2026-08-26 兩線協定）——CMS 不重寫推導 */
const paletteEngine = require(path.join(__dirname, "..", "..", "..", "design-tokens", "palette-engine.js"));
/**
 * lib/theme_draft.js —— 自訂主色 → themeDraft 推導＋可讀性檢查＋排版檔位表（theme 框架接 CMS 批，2026-08-25）
 *
 * 職責（純函式、零 I/O）：
 *  1. deriveThemeDraft(seed)：一個主色 → 細粒度套色草案（標題/副標/膠囊/底紋線/五背景角色）——
 *     欄形對齊「活動頁色彩策略工具」輸出的 colors.themeDraft（消費端＝FrameTest applyThemeDraftColors）。
 *     推導原則沿工具與 FrameTest 舊自訂色引擎：文字自動加深到可讀、底色＝極淡同調、商品卡白底恆定不碰。
 *     ⚠ 雙生註記：surface 明度公式（page 0.97／section 0.93）與 FrameTest deriveCampaignTokens 同組——改一邊要同批改另一邊。
 *  2. checkThemeDraft(td, opts)：機器可讀性檢查（2026-08-25 使用者指示；2026-08-27 令取代 2026-08-25 黃燈制）——
 *     標題/副標 vs 所在底色 WCAG ≥4.5、膠囊/螢光/輔助字 vs 底 ≥3（亮度感應擇字、與渲染同謂詞）；
 *     擋級（blocking:true）不過＝寫入路擋下＋給選項（一鍵建議色/建議值）、提醒級不擋。
 *     opts.heroSurface（2026-09-04 假閘修正）＝「標題實際坐在哪個底上」——照片型（scene）版面的標題壓在照片上，
 *     照片不跟草案換色，草案宣稱的 hero 底色在畫面上根本不存在；本函式若拿草案的 hero 算對比＝量錯東西
 *     （病例＝深色草案 #F0F2F4 白字 vs 宣稱底 #274372 算出 8.78:1 放行，實際壓在 #F2F2F2 白棚照上只有 1.00:1）。
 *     呼叫端（hero_combo.applyCombo）解析實際背景登記簿紀錄後傳入 { hex, label }；未傳＝照舊用草案 hero（自訂色純色底時它就是真底）。
 *  3. TYPO_SCALE_STEPS / TITLE_WIDTH_STEPS：字級/標題寬檔位乘數表＝單一來源（catalog 下發；
 *     面板選項與 FrameTest 吸字預算都吃這張表，不得各編一份）。
 *
 * 真值鐵律：價格紅、商品卡白底＝恆定不推導不覆寫；本檔只產顏色草案，價格/檔期/URL 不經此路。
 */

/* ── 色彩工具（與 FrameTest 自訂色引擎同式；hex 一律 #RRGGBB） ── */
function hexToRgb(h) {
  h = String(h).replace("#", "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  const n = parseInt(h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function rgbToHex(r, g, b) {
  return "#" + [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("");
}
function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  let h, s;
  const l = (mx + mn) / 2;
  if (mx === mn) { h = s = 0; }
  else {
    const d = mx - mn;
    s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
    switch (mx) { case r: h = (g - b) / d + (g < b ? 6 : 0); break; case g: h = (b - r) / d + 2; break; default: h = (r - g) / d + 4; }
    h /= 6;
  }
  return [h * 360, s, l];
}
function hslToHex(h, s, l) {
  h = ((h % 360) + 360) % 360 / 360;
  let r, g, b;
  if (s === 0) { r = g = b = l; }
  else {
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
    const hue = (t) => { if (t < 0) t += 1; if (t > 1) t -= 1; if (t < 1 / 6) return p + (q - p) * 6 * t; if (t < 1 / 2) return q; if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6; return p; };
    r = hue(h + 1 / 3); g = hue(h); b = hue(h - 1 / 3);
  }
  return rgbToHex(r * 255, g * 255, b * 255);
}
function luminance(hex) {
  const c = hexToRgb(hex).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
function contrast(a, b) {
  const l1 = luminance(a), l2 = luminance(b);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}
function darkenToContrast(hex, bg, ratio) {
  const x = rgbToHsl(...hexToRgb(hex));
  let l = x[2];
  for (let i = 0; i < 70 && contrast(hslToHex(x[0], x[1], l), bg) < ratio; i++) l = Math.max(0, l - 0.014);
  return hslToHex(x[0], x[1], l);
}
/* 雙向調整（2026-08-27 擋色批：底被改深時字要「調亮」——一路調深＝黑上黑永遠不過的死巷）：
   照底色亮度決定字的走向（亮底＝調深、暗底＝調亮），同色相彩度不動。 */
function adjustToContrast(hex, bg, ratio) {
  const x = rgbToHsl(...hexToRgb(hex));
  const walk = (dir) => {
    let l = x[2];
    for (let i = 0; i < 70 && contrast(hslToHex(x[0], x[1], l), bg) < ratio; i++) l = Math.min(1, Math.max(0, l + dir));
    const out = hslToHex(x[0], x[1], l);
    return { hex: out, ratio: contrast(out, bg) };
  };
  /* 先照底色亮度走（亮底調深、暗底調亮）；走到底仍不夠＝回頭試另一向，兩向擇能過者、都不過擇對比較高者。
     2026-09-08 病例（run 150043）：中間調照片 #A16C69（亮度 0.19）被判「暗底」＝黑字 #1C1C1C 一路調亮到純白只有 4.32:1 仍不過，
     可是往深走到純黑是 4.86:1 早就過了——單向演算法把「有解」講成「沒有修正版、請回工具重做」＝擋色制「擋的同時給選項」那半條失效。 */
  const first = walk(luminance(normHex(bg)) < 0.5 ? +0.014 : -0.014);
  if (first.ratio >= ratio) return first.hex;
  const second = walk(luminance(normHex(bg)) < 0.5 ? -0.014 : +0.014);
  if (second.ratio >= ratio) return second.hex;
  return (second.ratio > first.ratio ? second : first).hex;
}
function isHex6(v) { return /^#?[0-9a-fA-F]{6}$/.test(String(v || "").replace("#", "")); }
function normHex(v) { const s = String(v).trim(); return (s.startsWith("#") ? s : "#" + s).toUpperCase(); }
function bestText(bg) { return contrast("#191919", bg) >= contrast("#FFFFFF", bg) ? "#191919" : "#FFFFFF"; }
/* 亮度感應擇字（2026-08-27 使用者裁決＝取代 2026-08-26「自訂盤一律白字」）：膠囊/螢光標籤字色照「底色亮度」定——
   深底（亮度 <0.5）＝白字（使用者 8/26 圈可的綠底白字保留：那顆綠夠深）、淺底＝深墨字（薄荷綠白字病例的解）。
   ⚠ 雙生註記（沿 surface 公式前例）：FrameTest applyThemeDraftColors 的膠囊/neon/soft 字色同一條門檻——改一邊要同批改另一邊。
   與 bestText（黑白對比擇優）的差異＝中明度底 bestText 必選黑（使用者 8/26 嫌醜的正主）、本謂詞照亮度切＝中深底仍白字。 */
function textOnColor(bg) { return luminance(normHex(bg)) < 0.5 ? "#FFFFFF" : "#191919"; }

/* ── 排版檔位表（單一來源；catalog 下發＝面板與 FrameTest 同吃） ──
   字級檔位＝乘在吸字「起始字級預算」上（保底恆定＝任何檔位不爆版）；
   標題寬檔位＝乘在吸字「版寬預算」與標題群容器 max-width 上（渲染端 clamp 舞台寬）。 */
const TYPO_SCALE_STEPS = [ // 三檔制＝2026-08-25 使用者裁決（大／標準／小，不做滑桿）
  { id: "sm", label: "小", mul: 0.85 },
  { id: "md", label: "標準", mul: 1, default: true },
  { id: "lg", label: "大", mul: 1.15 },
];
const TITLE_WIDTH_STEPS = [
  { id: "narrow", label: "窄", mul: 0.85 },
  { id: "standard", label: "標準", mul: 1, default: true },
  { id: "wide", label: "寬", mul: 1.15 },
];
/* 行距檔位（2026-09-04 使用者報「行距不能調整」＝68 號第二批第 6 項提前落地）：乘在各版式主標／副標樣式表的「行高÷字級」比值上，
   寫回無單位值＝跟著吸字後的字級走；主標在吸字前套＝塊高預算照新行距量、不爆版。倍率比字級檔位收斂（0.9／1.12）：行距 ±15% 會擠字或散行。 */
const TYPO_LEADING_STEPS = [
  { id: "sm", label: "緊", mul: 0.9 },
  { id: "md", label: "標準", mul: 1, default: true },
  { id: "lg", label: "鬆", mul: 1.12 },
];
/* 字距檔位（2026-09-05 使用者指示「四支排版控制每一款字風都要調得動」＝68 號第二批第 6 項落地）。
   跟其他三張表不同：字距是**加減不是乘**——字距 0 乘任何數還是 0，所以值欄叫 em 不叫 mul。
   單位 em＝跟著字級走（字大字距也跟著大），設計師不必為每個字級重調。
   檔距：緊 -3%／鬆 +10%（2026-09-05 由 -2／+4 加大：使用者在 N6 這類斜體厚字上拉「鬆」肉眼看不出＝等於沒反應；+10% 在粗黑體上剛好看得出「開」）。
   ⚠ 這張表在渲染端有一份人肉複本＝FrameTest hv2TypoMul 的 K 表，改這裡要同批改那裡。 */
const TYPO_TRACKING_STEPS = [
  { id: "sm", label: "緊", em: -0.03 },
  { id: "md", label: "標準", em: 0, default: true },
  { id: "lg", label: "鬆", em: 0.10 },
];

/**
 * 主色種子的上游把關（沿 FrameTest assessSeedColor 語意）：格式錯＝不可用；太淺/偏灰＝可用但出聲。
 * @returns { ok, reason?, warn? }
 */
function assessSeedColor(hex) {
  if (!isHex6(hex)) return { ok: false, reason: "色碼格式不正確——請用調色盤重新選一次顏色" };
  const x = rgbToHsl(...hexToRgb(hex)), s = x[1], l = x[2];
  if (l > 0.82) return { ok: true, warn: "你選的顏色比較淺——標題和膠囊的文字檢查很可能過不了；被擋下時可一鍵改用系統建議的深一點版本" }; // 2026-08-27 擋色制措辭（分工＝本函式只管格式與前置提示、可讀性擋一律 checkThemeDraft 實測）
  if (s < 0.10 && l > 0.55) return { ok: true, warn: "這個顏色偏灰，整體會比較低調（不影響可讀性）" };
  return { ok: true };
}

/* ── 15 槽定義（C 案 2026-08-25 裁決：資料格式＝提案包 colors.themeDraft 完整 schema；
   日後換共用推導引擎 palette-engine.js 只換引擎不換資料）——
   locked＝恆定槽（價格紅鐵律／商品卡白恆定／商品圖底恆定），面板顯示鎖定理由、不開微調。 ── */
const THEME_SLOTS = [
  { key: "title", label: "標題" },
  { key: "subtitle", label: "副標題" },
  { key: "eventLabel", label: "活動時間標題" },
  { key: "eventDate", label: "活動時間日期" },
  { key: "eyebrow", label: "強調色" },
  { key: "cta", label: "行動按鈕" },
  { key: "cardBadge", label: "商品特色標" },
  { key: "titleBadge", label: "標題特色標" },
  { key: "latticeLine", label: "底紋線條" },
  { key: "hero", label: "主視覺底色" },
  { key: "section", label: "內容區塊底色" },
  { key: "page", label: "頁面底色" },
  { key: "price", label: "價格", locked: "價格紅是全站固定色，讓人一眼認得價錢" },
  { key: "card", label: "商品卡底", locked: "商品卡固定白底，商品照才不會失真" },
  { key: "product", label: "商品圖底", locked: "商品圖底固定淺灰，全站一致" },
];
const BG_ROLE_KEYS = ["page", "hero", "section", "card", "product"];

/** 讀 themeDraft 某槽的現值（面板色塊顯示用；欄形對映＝componentColors／頂層／backgroundModules） */
function slotValue(td, key) {
  if (!td || typeof td !== "object") return null;
  const cc = td.componentColors || {};
  if (["title", "subtitle", "eventLabel", "eventDate"].includes(key)) return cc[key] || null;
  if (key === "eyebrow") return td.accent || null;
  if (BG_ROLE_KEYS.includes(key)) {
    const r = (Array.isArray(td.backgroundModules) ? td.backgroundModules : []).find((m) => m && m.key === key);
    return (r && r.hex) || null;
  }
  return td[key] || null; // cta / price / cardBadge / titleBadge / latticeLine ＝頂層
}

/**
 * 一個主色 → themeDraft（C 案完整 schema：15 槽＋backgroundModules＋bgOverrides 亮暗雙套＋qaStatus）。
 * @param {string} seedRaw 主色
 * @param {object} overrides 逐槽微調（面板可點色塊改；key＝THEME_SLOTS 非鎖定槽；恆定槽忽略）
 * 恆定條款：price #EB0F29／card #FFFFFF／product #F0F3F5＝任何主色與微調都不動。
 * 忠實用色條款（2026-08-25 使用者裁決：檢查不過＝黃燈＋給建議色一鍵換、不自動改色）：
 * 標題與膠囊「照使用者選的主色」不擅自加深——可讀性由 checkThemeDraft 出黃燈＋suggestSeed 給替代種子。
 */
function deriveThemeDraft(seedRaw, overrides) {
  if (!isHex6(seedRaw)) throw new Error("色碼格式不正確——請用調色盤重新選一次顏色");
  const seed = normHex(seedRaw);
  const ov = {};
  for (const [k, v] of Object.entries(overrides || {})) {
    const def = THEME_SLOTS.find((s) => s.key === k);
    if (def && !def.locked && isHex6(v)) ov[k] = normHex(v);
  }
  const x = rgbToHsl(...hexToRgb(seed));
  const h = x[0];
  const sat = Math.max(0.35, Math.min(0.9, x[1]));
  /* 背景角色（⚠ 雙生：page/section 明度＝FrameTest deriveCampaignTokens surface 公式同組） */
  const val = (k, base) => ov[k] || base;
  const page = val("page", hslToHex(h, Math.min(sat, 0.55), 0.97));
  const hero = val("hero", hslToHex(h, Math.min(sat, 0.5), 0.90));
  const section = val("section", hslToHex(h, Math.min(sat, 0.5), 0.93));
  /* 標題/膠囊＝主色原樣（忠實用色）；副標/時間標題＝機器配的穩重深色（同色相低彩、保可讀＝配色非改色） */
  const title = val("title", seed);
  const brandFam = paletteEngine.brandFamily(seed, "light");
  const subtitle = val("subtitle", darkenToContrast(hslToHex(h, Math.min(sat, 0.45), 0.4), hero, 4.5));
  const bgLabel = { page: "活動頁底色", hero: "主視覺舞台底色", section: "內容區塊底色", card: "商品卡白底（恆定）", product: "商品圖底（恆定）" };
  const lightRoles = { page, hero, section, card: "#FFFFFF", product: "#F0F3F5" };
  const td = {
    mainColorSource: "cms-custom",
    brandColor: seed,
    themeMode: "light",
    accent: val("eyebrow", seed),
    cta: val("cta", darkenToContrast(seed, "#FFFFFF", 4.5)),
    price: "#EB0F29", // 恆定（鐵律）
    cardBadge: val("cardBadge", seed),
    titleBadge: val("titleBadge", seed),
    latticeLine: val("latticeLine", hslToHex(h, Math.min(sat, 0.6), 0.8)),
    /* 家族三軌（2026-08-26 兩線協定・使用者裁決「自訂盤要到達新模組主色件」）：公式單一真源＝palette-engine 1.1.0 brandFamily，
       CMS 不重寫推導；brand＝seed 直通、soft/neon＝引擎公式（十主題走 tokens 原值、這裡只管自訂 seed）。 */
    brand: seed,
    brandSoft: brandFam.brandSoft,
    brandNeon: brandFam.brandNeon,
    componentColors: { title, subtitle, eventLabel: val("eventLabel", subtitle), eventDate: val("eventDate", title) },
    designerOverrides: { colorOverrides: { ...ov }, moduleMapping: {} },
    backgroundModules: BG_ROLE_KEYS.map((k) => ({ key: k, label: bgLabel[k], hex: lightRoles[k], usage: bgLabel[k] })),
    /* 亮暗雙套（補遺一＝per-theme 值互不干擾；CMS 自訂色第一波只出亮色、暗套＝機器對應值供 schema 完整） */
    bgOverrides: {
      light: { ...lightRoles },
      dark: {
        page: hslToHex(h, Math.min(sat, 0.5), 0.16),
        hero: hslToHex(h, Math.min(sat, 0.5), 0.20),
        section: hslToHex(h, Math.min(sat, 0.5), 0.22),
        card: "#FFFFFF", product: "#F0F3F5", // 卡片白恆定＝暗色也不翻
      },
    },
  };
  td.qaStatus = checkThemeDraft(td).every((c) => c.pass || c.blocking === false) ? "candidate-pass" : "needs-review"; // 擋級全過＝綠；提醒級（cta）不翻狀態。存量草稿的舊 qaStatus 不回溯改檔＝下次重推才換新尺；顯示層一律現算不吃存值（2026-08-27 擋色制）
  return td;
}

/**
 * themeDraft 可讀性檢查（寫入時機器檢）。
 * 擋色制（2026-08-27 使用者裁決＝取代 2026-08-25「黃燈不硬擋」）：blocking:true 的檢查不過＝寫入路擋下＋給選項；
 * blocking:false＝提醒級不擋（cta＝v2 引擎不消費該變數、擋了也改不到畫面——批判立法鏡頭 2026-08-27）。
 * 字色模型＝與渲染端同一條亮度感應謂詞 textOnColor()（2026-08-27 使用者圈「亮度感應擇字」；
 * 舊版用 bestText 黑白擇優＝數學上永不可能 fail（白<3 需 L>0.30、黑<3 需 L<0.10 不相交）＝薄荷綠白字漏網真因）。
 * 對象＝任何來源的 themeDraft（自訂色/提案包）；缺欄項目跳過（缺欄＝退現行 token、由 token 治理把關；
 * 提案包欄形無 brandNeon/brandSoft/cta＝該幾列對包路天然 no-op、擋線比自訂色路窄＝設計如此要申報）。
 * @returns [{ name, ratio, need, pass, blocking, slot?, suggest?, msg? }]  slot＝修這條該動的槽（一鍵修正用；null＝非開放槽、換主色解）
 */
function checkThemeDraft(td, opts) {
  const out = [];
  if (!td || typeof td !== "object") return out;
  const o0 = opts || {};
  const bg = (key) => {
    const rows = Array.isArray(td.backgroundModules) ? td.backgroundModules : [];
    const r = rows.find((m) => m && m.key === key);
    return r && isHex6(r.hex) ? normHex(r.hex) : null;
  };
  /* 標題族所在底＝實際渲染底優先（照片型版面：照片銜接色＝畫面上真的那塊）；沒給＝草案宣稱的 hero/page（純色底時宣稱即真） */
  const surface = (o0.heroSurface && isHex6(o0.heroSurface.hex)) ? { hex: normHex(o0.heroSurface.hex), label: o0.heroSurface.label || "照片背景" } : null;
  const heroBg = surface ? surface.hex : (bg("hero") || bg("page"));
  const cc = (td.componentColors && typeof td.componentColors === "object") ? td.componentColors : {};
  const push = (name, fg, base, need, opts) => {
    if (!isHex6(fg) || !isHex6(base)) return;
    const o = opts || {};
    const ratio = contrast(normHex(fg), normHex(base));
    const pass = ratio >= need;
    const onWhat = (o.onSurface && surface) ? `在${surface.label}上` : "和底色";
    out.push({
      name, ratio: Math.round(ratio * 100) / 100, need, pass,
      blocking: o.blocking !== false,
      slot: o.slot !== undefined ? o.slot : null,
      suggest: pass ? null : (o.suggestFn ? o.suggestFn() : adjustToContrast(normHex(fg), normHex(base), need)),
      msg: pass ? null : (o.onSurface && surface
        ? `${name}的顏色${onWhat}會看不見（對比 ${ratio.toFixed(2)}：1，需要 ${need}：1）`
        : `${name}的顏色和底色太接近，會看不清楚（對比 ${ratio.toFixed(2)}：1，需要 ${need}：1）`),
      surface: (o.onSurface && surface) ? surface.hex : null,
    });
  };
  if (heroBg) {
    push("標題", cc.title, heroBg, 4.5, { slot: "title", onSurface: true });
    push("副標題", cc.subtitle, heroBg, 4.5, { slot: "subtitle", onSurface: true });
    push("活動時間標題", cc.eventLabel, heroBg, 4.5, { slot: "eventLabel", onSurface: true });
    push("活動時間日期", cc.eventDate, heroBg, 4.5, { slot: "eventDate", onSurface: true });
  }
  /* 膠囊/螢光/輔助＝亮度感應擇字（檢查算的字色＝渲染端實際會用的字色；同一謂詞、雙生註記見 textOnColor）＋提醒級：
     真實病例（薄荷綠白字）由渲染極性根治（淺底自動深字）；中明度底配白字＝使用者 8/26 美學裁決的區間（門檻 L<0.5 保留白字）、
     對比不足出提醒不擋——擋級只留標題族（可讀性底線）。擋級若含螢光軌＝深色種子的螢光推導落中明度、調深種子救不了螢光
     ＝建議色迴路奔到黑色的死巷（2026-08-27 批判 M3 實證：#2F6B4F 建議一路到 #000000）。 */
  if (isHex6(td.cardBadge)) push("商品特色標文字", textOnColor(td.cardBadge), td.cardBadge, 3, { blocking: false, slot: "cardBadge", suggestFn: () => darkenToContrast(normHex(td.cardBadge), "#FFFFFF", 3) });
  if (isHex6(td.titleBadge)) push("標題特色標文字", textOnColor(td.titleBadge), td.titleBadge, 3, { blocking: false, slot: "titleBadge", suggestFn: () => darkenToContrast(normHex(td.titleBadge), "#FFFFFF", 3) });
  if (isHex6(td.brandNeon)) push("螢光標籤文字", textOnColor(td.brandNeon), td.brandNeon, 3, { blocking: false, slot: null, suggestFn: () => null });
  if (isHex6(td.brandSoft)) push("輔助色帶文字", textOnColor(td.brandSoft), td.brandSoft, 3, { blocking: false, slot: null, suggestFn: () => null });
  /* hero 折扣數字與圓章（2026-09-27 使用者拍板「hero 的價格與折數顏色要能跟主題走」；裁決牆 Q5 乙＝出聲不擋）：
     折數多半壓在照片上＝拿照片代表色（同標題族的 heroBg）算、大字門檻 3；圓章字對圓章底 3。兩條都提醒級（不擋、不給一鍵換：slot null）——
     提案包沒帶這兩欄（舊包）＝天然 no-op。 */
  if (heroBg && isHex6(cc.discount)) push("折扣數字", cc.discount, heroBg, 3, { blocking: false, slot: null, onSurface: true, suggestFn: () => null });
  if (isHex6(cc.discountBadge) && isHex6(cc.discountBadgeText)) push("折扣圓章文字", cc.discountBadgeText, cc.discountBadge, 3, { blocking: false, slot: null, suggestFn: () => null });
  /* 主色底字（2026-09-01 使用者報修「下方模組黃底白字」同批補）：brandColor 會被拿去當情境卡三行標籤與
     「編輯精選」章牌的底（渲染端 .label-box／.editor-badge）——本層原本沒有這一格，主色再亮也不出聲＝
     黃底白字的漏網正主。渲染端已改吃 --campaign-brand-text（亮度感應），檢查算的字色與它同一謂詞。 */
  const brandFill = isHex6(td.brand) ? td.brand : (isHex6(td.brandColor) ? td.brandColor : null);
  if (brandFill) push("主色標籤文字", textOnColor(brandFill), brandFill, 3, { blocking: false, slot: null, suggestFn: () => darkenToContrast(normHex(brandFill), "#FFFFFF", 3) });
  if (isHex6(td.cta)) push("行動按鈕文字", textOnColor(td.cta), td.cta, 4.5, { blocking: false, slot: "cta", suggestFn: () => darkenToContrast(normHex(td.cta), "#FFFFFF", 4.5) });
  return out;
}

/**
 * 檢查不過時的「建議色」（一鍵換用；「不自動改色、給建議讓人自己按」半條裁決仍有效——2026-08-27 擋色制只反轉「不硬擋」半條）。
 * 2026-08-27 改「推完整草案全過檢才回傳」（批判走查鏡頭：舊版只保兩條件、新檢查下建議色可能仍被擋＝按了還被擋的死巷）：
 * 同色相彩度逐步調深、每步真推 deriveThemeDraft＋checkThemeDraft，擋級全過才回傳；收斂不了＝回 null（呼叫端誠實講「這個色系配不出通過版，請換一個顏色」）。
 */
function suggestSeed(seedRaw) {
  const seed = normHex(seedRaw);
  const x = rgbToHsl(...hexToRgb(seed));
  let l = x[2];
  for (let i = 0; i < 64; i++) {
    const cand = hslToHex(x[0], x[1], l);
    const td = deriveThemeDraft(cand);
    if (checkThemeDraft(td).every((c) => c.pass || c.blocking === false)) return cand;
    if (l <= 0) break;
    l = Math.max(0, l - 0.014);
  }
  return null;
}

module.exports = {
  TYPO_SCALE_STEPS,
  TYPO_LEADING_STEPS,
  TYPO_TRACKING_STEPS,
  THEME_SLOTS,
  BG_ROLE_KEYS,
  slotValue,
  suggestSeed,
  TITLE_WIDTH_STEPS,
  assessSeedColor,
  deriveThemeDraft,
  checkThemeDraft,
  contrast,
  bestText,
  isHex6,
  normHex,
  darkenToContrast,
  adjustToContrast,
};
