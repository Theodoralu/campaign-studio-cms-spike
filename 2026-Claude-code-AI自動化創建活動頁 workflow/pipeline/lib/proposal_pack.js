"use strict";
/**
 * lib/proposal_pack.js —— 組合提案包 schema v0 解析器＋kvVariant 拼法正規化（51 號 W1-A，2026-08-24）
 *
 * 真源原則：值域一律 runtime 讀登記簿——modules.json hero variants（出貨值域）、design-assets 四本
 * manifest（版式/背景/字體/動畫貨號）、design-tokens/tokens.json（主題鍵）。本檔零硬編值域；
 * 登記簿讀不到＝throw（失敗要出聲，不做內建清單靜默降級＝鐵律 3）。
 *
 * 拼法合帳（51 §2.6）：全鏈裸值 new|legacy|layout-NNN；kv-new/kv-legacy 舊拼法（2026-07-21 裁決⑮）
 * 讀入時正規化、不再輸出。
 *
 * W1-E 擴充（2026-08-24）：loadRegistries 增回傳逐筆紀錄面——heroVariantRecords（rollout 灰度旗標）、
 * backgroundRecords（license／複查欄 qaStatus）、backgroundsMeta（termsVerification 商用條款查證）、
 * motionRecords（license）＝gate CP-25/27 消費；值域集合面（*Ids）不變。
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto"); // 2026-09-21 C：登記簿指紋（檢查結果會不會過期，看的是內容不是時間）

// pipeline/lib → pipeline → workflow 資料夾 → repo 根
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const DEFAULT_PATHS = {
  modules: path.join(REPO_ROOT, "2026-AI自動化活動頁生成規劃", "modules.json"),
  layouts: path.join(REPO_ROOT, "design-assets", "layouts", "manifest.json"),
  backgrounds: path.join(REPO_ROOT, "design-assets", "backgrounds", "manifest.json"),
  pendingBackgrounds: path.join(REPO_ROOT, "design-assets", "backgrounds", "pending.json"), // 待審簿（63 號直通車 2026-08-31）——訪客號段 pending-NNNN
  fonts: path.join(REPO_ROOT, "design-assets", "fonts", "manifest.json"),
  motion: path.join(REPO_ROOT, "design-assets", "motion", "manifest.json"),
  tokens: path.join(REPO_ROOT, "design-tokens", "tokens.json"),
  typestyles: path.join(REPO_ROOT, "design-assets", "typestyles", "manifest.json"), // 字風登記簿（68 號第二批 Q2／Q10，2026-09-04 開簿）——值域只認 review.status=approved
};

function readJson(p) {
  let raw;
  try {
    raw = fs.readFileSync(p, "utf8");
  } catch (e) {
    throw new Error(`登記簿讀取失敗（${p}）：${e.message}——值域真源缺席，拒絕靜默降級`);
  }
  try {
    return JSON.parse(raw);
  } catch (e) {
    throw new Error(`登記簿不是合法 JSON（${p}）：${e.message}`);
  }
}

/** kv-new/kv-legacy 舊拼法 → 裸值；其餘原樣返回（含 layout-NNN 與未知值，未知值交由值域驗證擋） */
function normalizeKvVariant(v) {
  if (v == null) return v;
  const s = String(v).trim();
  if (s === "kv-new") return "new";
  if (s === "kv-legacy") return "legacy";
  return s;
}

/** 讀五本真源，回傳值域集合（供解析器與 gate CP-25/CP-27 共用） */
function loadRegistries(overridePaths = {}) {
  const P = { ...DEFAULT_PATHS, ...overridePaths };
  const modules = readJson(P.modules);
  const hero = (modules.modules || []).find((m) => m.module_id === "hero" || m.id === "hero");
  if (!hero || !Array.isArray(hero.variants)) {
    throw new Error("modules.json 找不到 hero variants——出貨值域真源缺席");
  }
  const heroVariantIds = hero.variants.map((v) => v.variant_id);
  const ids = (man) => (man.assets || []).map((a) => a.id);
  const recordsOf = (man) => new Map((man.assets || []).map((a) => [a.id, a]));
  const layoutsMan = readJson(P.layouts);
  const layoutRecords = recordsOf(layoutsMan);
  const backgroundsMan = readJson(P.backgrounds);
  /* 待審簿（63 號直通車）：訪客號段——promoted（已轉正）不再算現役待審；檔案缺席＝空簿容忍（新制前的環境） */
  let pendingBook = { entries: [] };
  try { pendingBook = readJson(P.pendingBackgrounds); } catch (e) { /* 簿未開戶＝空 */ }
  const pendingEntries = (pendingBook.entries || []).filter((e) => e && e.review && e.review.status === "pending"); // 現役待審＝pending 態；promoted（已轉正）/rejected（退回）皆退出值域
  const motionMan = readJson(P.motion);
  const fontsMan = readJson(P.fonts);
  /* 字風登記簿（2026-09-04）：檔案缺席＝空簿容忍（沿待審簿前例；hermetic 測試環境與開簿前的環境）——
     但包若帶 titleStyle 而簿是空的＝「未知字風」出聲擋下，不會靜默放行 */
  let typestylesMan = { assets: [] };
  try { typestylesMan = readJson(P.typestyles); } catch (e) { /* 簿未開戶＝空 */ }
  const typestyleRecords = recordsOf(typestylesMan);
  const typestyleIds = (typestylesMan.assets || []).filter((a) => a && a.review && a.review.status === "approved").map((a) => a.id); // 值域＝只認 approved（Q10 入庫審查制）
  // 主題真源＝tokens.json themes「陣列」（每筆 {slug, rejected?}）；rejected（G/K 未採用不出 CSS）排除。
  // 機讀值＝slug；字母代號（B/C/E…）＝口語對照、不進機器（沿 idPolicy「口語 alias 永不進 CMS」家規）。
  const tokens = readJson(P.tokens);
  if (!Array.isArray(tokens.themes) || tokens.themes.length === 0) {
    throw new Error(`design-tokens 主題真源缺席或形狀不符（${P.tokens} 的 themes 必須是非空陣列）——拒絕靜默縮值域`);
  }
  const themeIds = ["default", ...tokens.themes.filter((t) => !t.rejected).map((t) => t.slug)].filter(
    (v, i, arr) => v && arr.indexOf(v) === i
  );
  return {
    heroVariantIds, // 含 new/legacy＋layout-*（gate CP-25 用）
    heroVariantRecords: new Map(hero.variants.map((v) => [v.variant_id, v])), // 逐變體紀錄（rollout 灰度旗標等；51 §3——trial＝試用徽章、legacy 停新案開關＝legacy 變體之 rollout:"closed"，欄缺席＝開放）
    layoutIds: ids(layoutsMan), // 僅 layout-*（提案包 layout 欄用）
    layoutRecords, // 逐版式紀錄（defaultBackground/backgroundPool/slots 等，UI 與 CP-27 用）
    backgroundIds: ids(backgroundsMan),
    backgroundRecords: recordsOf(backgroundsMan), // 逐背景紀錄（license／複查欄 qaStatus 等；gate CP-27 用）
    backgroundsMeta: backgroundsMan.meta || {}, // 簿級 meta（termsVerification＝B 級商用條款查證紀錄；CP-27 B 級放行前提）
    pendingBackgroundIds: pendingEntries.map((e) => e.id), // 待審背景訪客號（63 號：可帶包可上線掛浮水印、不可正式出貨）
    pendingBackgroundRecords: new Map(pendingEntries.map((e) => [e.id, e])),
    fontIds: (fontsMan.assets || []).filter((a) => a && a.pickable === true).map((a) => a.id), // 值域＝可挑選（pickable:true）貨號——2026-09-08 字體簿補 11 戶（引擎內建／待審字風配方專用／C 級 MiSans）後，只有 pickable 的進工具字體選單與 font／subtitleFont 值域；名單只在簿裡（工具 sync 腳本同讀此欄）
    fontRecords: recordsOf(fontsMan), // 逐字體紀錄（family／css2／displayName；副標字體 2026-09-04 Q8 翻案用）
    typestyleIds, // 字風值域＝approved 貨號（parseProposalPack 與 applyCombo 兩道門同吃這一份＝名單只有一處）
    typestyleRecords, // 逐字風紀錄（含 pending／rejected；顯示名／字型是否載入／審查狀態）
    motionIds: ids(motionMan),
    motionRecords: recordsOf(motionMan), // 逐動畫素材紀錄（license；gate CP-27／E7 動畫欄用）
    themeIds,
  };
}

/**
 * 解析組合提案包（51 附錄 A schema v0）。
 * @param {string|object} input 貼上的 JSON 字串或已解析物件
 * @param {object} registries loadRegistries() 產物
 * @returns {ok:true, pack, warnings[]} | {ok:false, errors[], warnings[]}
 * 錯誤一律列舉出聲；qaStatus 非 candidate-pass＝黃燈（warning）不擋（工具自評訊號＝照舊帶入；
 * 與 2026-08-27 擋色制「colors 可讀性擋級」不同題——後者在 hero_combo applyCombo 前置驗、單一入口＝60 號）。未知多餘欄＝容忍。
 */
function parseProposalPack(input, registries) {
  const errors = [];
  const warnings = [];
  let pack = input;
  if (typeof input === "string") {
    try {
      pack = JSON.parse(input);
    } catch (e) {
      return { ok: false, errors: [`提案包不是合法 JSON：${e.message}`], warnings };
    }
  }
  if (!pack || typeof pack !== "object" || Array.isArray(pack)) {
    return { ok: false, errors: ["提案包必須是 JSON 物件"], warnings };
  }
  if (!("version" in pack)) errors.push("缺 version（必填，數字 1）");
  else if (pack.version !== 1) errors.push(`version 不支援：收到 ${JSON.stringify(pack.version)}（本解析器僅收數字 1）`);
  const layout = normalizeKvVariant(pack.layout);
  if (!layout) errors.push("缺 layout（版式貨號必填）");
  else if (!registries.layoutIds.includes(layout)) errors.push(`未知版式貨號：${pack.layout}`);
  if (pack.background === "own") {
    /* 「你上傳的背景」（78 號 2026-09-27）＝圖住活動自己的資料夾，提案包帶不了檔——只能在工作台編修頁上傳 */
    errors.push("提案包不能帶「你上傳的背景」——那三張圖只能在工作台的編修頁上傳（技術：background=own 不進包值域）");
  } else if (pack.background != null && !registries.backgroundIds.includes(pack.background)
      && !(registries.pendingBackgroundIds || []).includes(pack.background)) {
    errors.push(`未知背景貨號：${pack.background}（合法值＝backgrounds 登記簿貨號，或待審簿 pending-NNNN 訪客號）`);
  } else if (pack.background != null && (registries.pendingBackgroundIds || []).includes(pack.background)) {
    warnings.push(`背景「${pack.background}」＝待審臨時貨號：可展示可上線（頁面會掛「背景版權待審核」浮水印、內網展示限定），未轉正不得正式出貨（63 號）`);
  }
  if (pack.font != null && !registries.fontIds.includes(pack.font)) {
    const recF = registries.fontRecords ? registries.fontRecords.get(String(pack.font)) : null;
    errors.push(recF
      ? `字體「${recF.displayName || pack.font}」登記為不供挑選（字風配方專用／引擎內建／授權未達 A 級），不能帶進 CMS`
      : `未知字體貨號：${pack.font}（合法值＝fonts 登記簿可挑選貨號）`);
  }
  if (pack.motion != null && pack.motion !== "static" && !registries.motionIds.includes(pack.motion)) {
    errors.push(`未知動畫貨號：${pack.motion}（合法值＝motion 登記簿貨號或 static）`);
  }
  if (pack.theme != null && !registries.themeIds.includes(pack.theme)) {
    errors.push(`未知主題代號：${pack.theme}（合法值＝design-tokens 主題鍵）`);
  }
  /* 字風一等欄 titleStyle（2026-09-04 字風落地批；14 號 §2.13）：值域＝字風登記簿 approved 貨號。
     pending／rejected＝擋下出聲（Q10：未審查不得進 CMS）；舊位置（colors.titleStyle／colors.typography.title.style）＝
     出聲不套用——2026-09-04 病例：工具把字風塞在 colors 裡、解析器「未知欄容忍」把它靜靜吞掉，設計師以為帶進去了。 */
  if (pack.titleStyle != null) {
    const rec = registries.typestyleRecords ? registries.typestyleRecords.get(String(pack.titleStyle)) : null;
    if (!rec) errors.push(`未知字風貨號：${pack.titleStyle}（合法值＝字風登記簿貨號）`);
    else if (!(registries.typestyleIds || []).includes(String(pack.titleStyle))) {
      errors.push(`字風「${rec.displayName || pack.titleStyle}」尚未審查通過、不能帶進 CMS（登記簿 review.status=${(rec.review || {}).status || "（缺）"}）——請改選已審查的字風，或請負責人在字風登記簿審查後重新打包`);
    }
  } else if (pack.colors && typeof pack.colors === "object") {
    /* 舊位置相容（2026-09-04 傍晚病例：工具頁剛部署、設計師瀏覽器還開著舊頁＝打出來的包字風仍在 colors 裡，CMS 只警告不套用＝
       設計師以為「CMS 套用失敗」）：舊位置的字風若已審查通過＝照樣帶入（值域同一把尺）＋提醒去重新整理工具頁；未審＝照舊只警告不套用。 */
    const legacyTs = pack.colors.titleStyle || (pack.colors.typography && pack.colors.typography.title && pack.colors.typography.title.style);
    if (legacyTs && /^css-/.test(String(legacyTs))) {
      const id = String(legacyTs);
      const rec = registries.typestyleRecords ? registries.typestyleRecords.get(id) : null;
      if (rec && (registries.typestyleIds || []).includes(id)) {
        pack = { ...pack, titleStyle: id, droppedTitleStyle: undefined }; /* 2026-09-08：重貼「先前被丟過」的存檔包（meta.proposalPack.pack 帶著舊 droppedTitleStyle）＝審過後要清掉，否則面板會一邊套上一邊說沒帶入 */
        warnings.push(`字風「${rec.displayName || id}」是從舊位置（colors）讀到的——已照樣帶入；你的色彩工具頁是舊版，請重新整理一次再打包，之後就會放在正確位置`);
      } else if (rec) {
        /* 2026-09-07 使用者病例（F1 待審）：工具刻意不帶一等欄、只留 colors 舊位＋警告；這裡原本回「請用新版工具重新打包」＝誤導（不是工具版本問題）。
           改講真話，並把「被丟掉的字風」帶給 hero_combo 寫進編修頁「版面怎麼來的」橫幅（設計師會看的位置） */
        pack = { ...pack, droppedTitleStyle: { id, displayName: rec.displayName || id, status: (rec.review || {}).status || "pending" } };
        warnings.push(`字風「${rec.displayName || id}」尚未審查通過，CMS 不會套用（標題用版式原本的字）——請負責人在字風登記簿審查通過後重新打包，或改選已審查的字風`);
      } else {
        warnings.push(`這份包的字風「${id}」不在字風登記簿，CMS 不會套用——請用新版色彩工具重新打包`);
      }
    }
  }
  /* 副標題字體一等欄 subtitleFont（2026-09-04 使用者翻案 09-03 Q8「不開放」）：{ fontId, weight }——值域＝字體簿貨號、字重 100～900 整百。
     舊位置相容＝colors.typography.subtitle.fontFamilyCss 首字族對得上字體簿＝照樣帶入＋提醒（同 titleStyle 舊位置制）；對不上＝出聲不帶。 */
  const WEIGHTS = [100, 200, 300, 400, 500, 600, 700, 800, 900];
  if (pack.subtitleFont != null) {
    const sf = pack.subtitleFont;
    if (typeof sf !== "object" || !sf.fontId) errors.push("subtitleFont 形狀不對（要 { fontId, weight }）");
    else {
      if (!registries.fontIds.includes(String(sf.fontId))) {
        const recS = registries.fontRecords ? registries.fontRecords.get(String(sf.fontId)) : null;
        errors.push(recS
          ? `副標字體「${recS.displayName || sf.fontId}」登記為不供挑選（字風配方專用／引擎內建／授權未達 A 級），不能帶進 CMS`
          : `未知副標字體貨號：${sf.fontId}（合法值＝fonts 登記簿可挑選貨號）`);
      }
      if (sf.weight != null && !WEIGHTS.includes(Number(sf.weight))) errors.push(`副標字重只能是 100～900 的整百（收到 ${JSON.stringify(sf.weight)}）`);
    }
  } else if (pack.colors && pack.colors.typography && pack.colors.typography.subtitle) {
    const st = pack.colors.typography.subtitle;
    const fam = String(st.fontFamilyCss || "").split(",")[0].replace(/['"]/g, "").trim();
    const hit = fam && registries.fontRecords ? [...registries.fontRecords.values()].find((f) => f && f.pickable === true && f.family === fam) : null; // 只對可挑選的：不可選家族（引擎內建／待審字風專用）走下方「不在字體簿」軟提醒，行為與補戶口前一致
    if (hit && hit.id === "font-001") {
      /* 2026-09-07 誤報修正：工具只在「偏離版式預設」時才帶 subtitleFont 一等欄，沒偏離的包一律仍帶 colors.typography 舊欄＝
         原本每一份正常的包都被說「你的工具頁是舊版」。專案預設字（font-001 思源黑體）＝沒偏離＝不帶、不吵 */
    } else if (hit) {
      const w = WEIGHTS.includes(Number(st.weightCss)) ? Number(st.weightCss) : undefined;
      pack = { ...pack, subtitleFont: { fontId: hit.id, ...(w ? { weight: w } : {}) } };
      warnings.push(`副標字體「${hit.displayName || hit.family}」是從舊位置（colors.typography）讀到的——已照樣帶入`);
    } else if (fam) {
      warnings.push(`副標字體「${fam}」不在字體簿，CMS 不會套用（副標維持版式原字）`);
    }
  }
  /* 排版檔位一等欄 typography（2026-09-04 Q6 甲量化打包）：{ titleScale?, subtitleScale?, titleLeading?, subtitleLeading?, titleTracking? ∈ sm|md|lg, titleWidth? ∈ narrow|standard|wide }——
     絕對值（px／%）一律不收（8/25 檔位制不推翻）；未知檔位＝擋下出聲。行距兩欄＝2026-09-04 晚場補（使用者報「行距不能調整」）。 */
  if (pack.typography != null) {
    const ty = pack.typography;
    if (typeof ty !== "object" || Array.isArray(ty)) errors.push("typography 形狀不對（要 { titleScale, subtitleScale, titleLeading, subtitleLeading, titleTracking, titleWidth } 檔位）");
    else {
      const S = ["sm", "md", "lg"], W = ["narrow", "standard", "wide"];
      const STEP_KEYS = ["titleScale", "subtitleScale", "titleLeading", "subtitleLeading", "titleTracking"]; /* 字距＝2026-09-05 */
      for (const k of STEP_KEYS) if (ty[k] != null && !S.includes(ty[k])) errors.push(`typography.${k} 只能是 sm｜md｜lg（收到 ${JSON.stringify(ty[k])}）`);
      if (ty.titleWidth != null && !W.includes(ty.titleWidth)) errors.push(`typography.titleWidth 只能是 narrow｜standard｜wide（收到 ${JSON.stringify(ty.titleWidth)}）`);
      for (const k of Object.keys(ty)) if (![...STEP_KEYS, "titleWidth"].includes(k)) warnings.push(`typography.${k} 不是檔位欄（CMS 只吃六個檔位，絕對值不帶）——已略過`);
    }
  }
  /* 工具量不到引擎基準（2026-09-21 B）：工具會標 typographyMeasured:false 且不帶任何檔位——CMS「整組帶入」語意會把主視覺字級回到標準。
     這裡把它講出來（黃燈、不擋）：不講＝設計師以為自己調的字級帶進來了，其實被靜靜重設。非 false 的值一律忽略（未知欄容忍原則）。 */
  if (pack.typographyMeasured === false) warnings.push("這份提案包打包時沒有量到引擎——字級、行距、字距檔位都沒帶進來，套用後主視覺會回到標準字級；要帶檔位請用工作台版工具重新打包");
  /* 換妝註記 titleStyleThemed（2026-09-05 誠實出聲）：色彩工具的「妝容跟主題走」目前只在工具預覽套用，CMS／線上沒有程式套它——
     不擋、不帶、講清楚，別讓設計師以為換妝帶進來了（沿 2026-09-04「未知欄容忍靜靜吞掉」病例的教訓）。根治＝引擎自算換妝，另開批。 */
  /* 字風妝容跟主題走 titleStyleThemed（2026-09-05 接線上）：布林；舊工具送的是物件 {styleKey,note}＝視同 true＋提醒升級工具頁。引擎依登記簿配方自算，包只帶開關 */
  if (pack.titleStyleThemed != null && pack.titleStyleThemed !== false) {
    if (typeof pack.titleStyleThemed === "object") warnings.push("「妝容跟主題走」是舊格式（物件）——已視同開啟；你的色彩工具頁是舊版，請重新整理一次再打包");
    else if (pack.titleStyleThemed !== true) errors.push(`titleStyleThemed 只能是 true｜false（收到 ${JSON.stringify(pack.titleStyleThemed)}）`);
  }
  /* 同組文字一起變形 titleGroupWarp（2026-09-05 使用者 N3 需求）：布林；字風沒變形或版式沒群容器＝引擎開了也沒事 */
  if (pack.titleGroupWarp != null && pack.titleGroupWarp !== true && pack.titleGroupWarp !== false) errors.push(`titleGroupWarp 只能是 true｜false（收到 ${JSON.stringify(pack.titleGroupWarp)}）`);
  /* 主標兩側裝飾線 titleFrame（2026-09-04 使用者需求）：on｜off；缺＝板原樣。版式沒有這件（登記簿 titleFrame 缺）＝黃燈「不作用」 */
  if (pack.titleFrame != null) {
    if (!["on", "off"].includes(pack.titleFrame)) errors.push(`titleFrame 只能是 on｜off（收到 ${JSON.stringify(pack.titleFrame)}）`);
    else if (layout && registries.layoutRecords && registries.layoutRecords.get(layout) && !registries.layoutRecords.get(layout).titleFrame) warnings.push(`這款版面主標兩側沒有裝飾線，titleFrame 不作用`);
  }
  if (pack.qaStatus != null && pack.qaStatus !== "candidate-pass") {
    warnings.push(`qaStatus=${pack.qaStatus}＝黃燈帶入（組合未過試搭 QA，工作台需顯示提醒）`);
  }
  if (errors.length) return { ok: false, errors, warnings };
  return { ok: true, pack: { ...pack, layout }, warnings };
}

/* 灰度門票單一來源（2026-08-24 W1-E/W1-C 雙審合流：中4）——gate CP-27 與表單 lib 同吃這一份，
 * 嚴格版＝license A、或 B 且審核欄 qaStatus ∈ BG_REVIEW_PASS（逐字白名單，廢止 /^pass/ 寬鬆比對）
 * 且複查日期 reviewDate 在場；conditional／C／授權不明＝不發門票。 */
const BG_REVIEW_PASS = ["pass", "pass-with-note"]; // CP-27：B 級複查合格值（CP 登記表 v1.8；conditional＝不得任預設、明選黃燈）
function backgroundEligible(bg) {
  if (!bg) return false;
  if (bg.license === "A") return true;
  return bg.license === "B" && BG_REVIEW_PASS.includes(bg.qaStatus) && Boolean(bg.reviewDate);
}


/**
 * 登記簿指紋（2026-09-21 C「引用會過期＝開稿時重驗」）。
 * 為什麼：檢查報告是「檢查那一刻」的快照——之後背景退場、字風審過、版式下架，報告不會自己變。
 * 病例 2026-09-21：pending-0009 於 9/14 退場，聖誕草莓那頁的報告停在 9/3 說「待審臨時貨號、可展示」，
 * 使用者 9/21 打開看到背景消失、畫面上唯一的說明是那份過期報告。
 * 做法：把八本登記簿的內容各算一個 sha256、再合成一個總指紋，寫進 gate 報告；
 * 工作台列出活動時比對「現在的指紋」與「報告裡的指紋」——不同＝標「需重檢」並自動重跑一次。
 * 用內容不用檔案時間（從版控 checkout 會洗掉 mtime；2026-09-14 實測時間法 16 紅、內容法 2 紅）。
 * 檔案讀不到＝記 "missing"（不吞錯、也不讓一本簿缺席把整個指紋炸掉）。
 */
const REGISTRY_LABELS = { modules: "版式模組表", layouts: "版式簿", backgrounds: "背景簿", pendingBackgrounds: "待審背景簿", fonts: "字體簿", motion: "動畫簿", tokens: "色彩主題", typestyles: "字風簿" };
function registriesFingerprint(paths = DEFAULT_PATHS) {
  const files = {};
  for (const [k, p] of Object.entries(paths)) {
    try { files[k] = crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex").slice(0, 16); }
    catch (e) { files[k] = "missing"; }
  }
  const sha = crypto.createHash("sha256").update(Object.keys(files).sort().map((k) => `${k}=${files[k]}`).join("|")).digest("hex").slice(0, 16);
  return { sha, files };
}
/** 兩份指紋差在哪幾本簿（給人看的名字）；舊報告沒有指紋＝視為全部都要重檢 */
function registriesChanged(reportFp, currentFp) {
  if (!reportFp || !reportFp.files) return Object.keys(currentFp.files).map((k) => REGISTRY_LABELS[k] || k);
  return Object.keys(currentFp.files).filter((k) => reportFp.files[k] !== currentFp.files[k]).map((k) => REGISTRY_LABELS[k] || k);
}

module.exports = { normalizeKvVariant, loadRegistries, parseProposalPack, readJson, DEFAULT_PATHS, BG_REVIEW_PASS, backgroundEligible, registriesFingerprint, registriesChanged, REGISTRY_LABELS }; // readJson 供 lib/layout_choice 讀背景授權欄與 modules 旗標（同一套「讀不到就 throw」語意，2026-08-24 W1-C）
