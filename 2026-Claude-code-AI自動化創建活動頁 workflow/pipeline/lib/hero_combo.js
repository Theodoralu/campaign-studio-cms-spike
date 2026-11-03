"use strict";
/**
 * lib/hero_combo.js —— 編修頁組合面板的伺服器端邏輯（51 號 W1-D，2026-08-25）
 *
 * 職責（全部走登記簿真源、失敗一律 throw 出聲＝鐵律 3）：
 *  1. 換版式格位搬家（51 §2.4）：slotKey 相等＝直搬；搬不過去＝入 page.heroSlotStash（不渲染不出貨）；
 *     換回＝自暫存還原。機器可再生內容（＝預設補槽/legacy 對映逐字原值）換走時不入暫存——
 *     這是 A→B→A 深度 diff=0 的關鍵：預設內容換回時會原樣重生，暫存只收「使用者改過的」。
 *  2. 折扣開關＝kinRef 貨號對換（同一條換版式路）；008↔009 特例背景處置（51 §2.14）：
 *     原選在對方池內＝保留、池外＝換對方預設＋黃燈句。一般換版式＝背景保留、池外亮黃燈不阻擋（彈性三原則）。
 *  3. legacy 態（51 §2.8）：kv 頁→九貨號＝固定對映表搬家（主標＋副標→標題槽、主打商品×N→商品槽；
 *     kv 節點不動＝切回即全量還原）；「優惠框」對映＝條文未指名 kv 對應欄、本波不立法（見 story D7 註記）。
 *  4. 背景／主題改選：背景值域＝backgrounds 登記簿全景（池外允許＝黃燈揭示）；主題值域＝tokens.json
 *     themes slug（rejected 不收）；②型版式主題＝「主色不適用（跟隨背景圖）」語意（寫入容忍、UI 灰化）。
 *
 * 真值鐵律：本檔只搬 hero 槽引用與文字槽，絕不觸碰 products[] 價格/URL、kv.dateValue/actid 等真值欄。
 * 寫入紀律（R4）：writeComboIntoDraft 為編修期寫入點——server 端點寫後必呼叫 invalidateApproval，
 * 登錄＝scripts/draft-writers.allow（combo-apply 行）。
 */
const fs = require("fs");
const { loadLayoutDeps, defaultHeroForLayout, defaultHeroForLayoutEx, heroPrefillOptions, heroPrefillNotes } = require("./layout_choice");
const { normalizeKvVariant, parseProposalPack } = require("./proposal_pack");
const themeDraftLib = require("./theme_draft");
const ownBg = require("./hero_bg_license"); /* 「你上傳的背景」（78 號 2026-09-27）：own 哨兵、三檔齊判定、掛牌字 */

/** 版式的「可承接」槽鍵集合：slots 列出且 state !== "off"（off＝骨架有位但不渲染＝內容搬不過去） */
function activeSlotKeys(rec) {
  const s = new Set();
  for (const slot of (rec && rec.slots) || []) if (slot && slot.key && slot.state !== "off") s.add(slot.key);
  return s;
}

const PRODUCT_SLOT_CAP = { "item-ring": 4, "collage-right": 4, "product-left": 2, "product-right": 2, "product-main": 6 };/* product-main 1→6＝2026-08-30 使用者 design review（中秋輪播卡至多 6 件、至少 1 件＝CP-29）；CMS 面板 comboSlotName 的 ×N 標示與此表同步義務 */
const TEXT_SLOTS = new Set(["title-center", "slogan-left", "sub-capsule"]);

/**
 * legacy（kv 頁）→ 新版式的固定對映表（51 §2.8）：
 *   主標（titleLine1+titleLine2）＋副標（eyebrowZh｜eyebrow）→ 目標骨架的標題槽（title-center｜slogan-left）；
 *   主打商品 kv.keyProductGdids → 目標商品槽（依骨架容量順填）。
 * kv 節點不動＝之後切回現行版型即全量還原。回傳「候選值」——只用來補仍缺的槽，絕不覆蓋已搬家內容。
 */
function legacyHeroSeed(kv, rec) {
  const seed = {};
  const k = kv || {};
  const title = [String(k.titleLine1 || ""), String(k.titleLine2 || "")].join("").trim();
  const sub = String(k.eyebrowZh || k.eyebrow || "").trim();
  const titleText = [title, sub].filter(Boolean).join("\n");
  const pool = (k.keyProductGdids || []).map(String).filter(Boolean);
  let cursor = 0;
  for (const key of activeSlotKeys(rec)) {
    if ((key === "title-center" || key === "slogan-left") && titleText) seed[key] = titleText;
    else if (PRODUCT_SLOT_CAP[key]) {
      const g = pool.slice(cursor, cursor + PRODUCT_SLOT_CAP[key]);
      cursor += g.length;
      if (g.length) seed[key] = { gdids: g };
    }
  }
  return seed;
}

/** 深比較（JSON 值域夠用：draft 皆純資料） */
function deepEq(a, b) {
  if (a === b) return true;
  if (a == null || b == null || typeof a !== typeof b) return false;
  if (typeof a !== "object") return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a), kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  return ka.every((k) => deepEq(a[k], b[k]));
}

/**
 * 換版式搬家（純函式、只動傳入的 page 物件）。
 * @returns { stashedKeys, restoredKeys, droppedKeys, filledKeys, restoredGdids }
 * 機器可再生內容判定：換走的槽值若「逐字等於」來源版式的預設補槽值或 legacy 對映值＝不入暫存
 * （換回時會由同一套函式原樣重生）——暫存只收使用者內容，A→B→A 才能 diff=0。
 */
function migrateHero(page, srcRec, targetRec, products) {
  const hero = (page.hero && typeof page.hero === "object") ? page.hero : {};
  const stash = (page.heroSlotStash && typeof page.heroSlotStash === "object") ? { ...page.heroSlotStash } : {};
  const targetKeys = activeSlotKeys(targetRec);
  const isRegen = regenCheckerFor(page, srcRec, products);
  const out = { stashedKeys: [], restoredKeys: [], droppedKeys: [], filledKeys: [], restoredGdids: [] };
  const newHero = {};
  for (const [k, v] of Object.entries(hero)) {
    if (targetKeys.has(k)) newHero[k] = v; // 同名槽（slotKey 相等）＝直搬
    else if (isRegen(k, v)) out.droppedKeys.push(k); // 機器內容＝可再生，不佔暫存
    else { stash[k] = v; out.stashedKeys.push(k); } // 使用者內容＝入暫存（不渲染不出貨、換回還原）
  }
  for (const k of targetKeys) {
    if (!(k in newHero) && k in stash) { // 換回＝自暫存還原
      const v = stash[k];
      newHero[k] = v;
      delete stash[k];
      out.restoredKeys.push(k);
      if (v && Array.isArray(v.gdids)) out.restoredGdids.push(...v.gdids.map(String));
    }
  }
  // legacy → 新版式：固定對映補位（只補仍缺的槽——暫存還原優先於對映）
  if (!srcRec) {
    const seed = legacyHeroSeed(page.kv, targetRec);
    for (const [k, v] of Object.entries(seed)) if (!(k in newHero)) { newHero[k] = v; out.filledKeys.push(k); }
  }
  // 缺槽＝預設補槽（不覆蓋搬家/還原/對映內容）。文字槽預填吃 kv 兩行標題（2026-09-24），與建立期同一個來源。
  // 2026-09-27：商品槽也跟建立期同一把尺——跳過已在樓層／牆曝光的、跳過名字放不進兩行的（heroSoFar＝newHero：主視覺內部也不重複）；沒放滿＝fillNotes 出聲
  const filled = defaultHeroForLayoutEx(targetRec, page.pageName, products, page.kv, heroPrefillOptions(page, products, newHero));
  for (const [k, v] of Object.entries(filled.hero)) if (!(k in newHero)) { newHero[k] = v; out.filledKeys.push(k); }
  out.fillNotes = heroPrefillNotes({ ...filled, short: filled.short.filter((s) => out.filledKeys.includes(s.slot)) }); // 只講真的由這裡補、又沒補滿的槽
  page.hero = newHero;
  if (Object.keys(stash).length) page.heroSlotStash = stash;
  else delete page.heroSlotStash; // 空暫存＝欄位不留（契約預設 {}；A→B→A 回到原字節）
  return out;
}

/** 版式的背景池集合（含預設） */
function poolOf(rec) {
  if (!rec) return new Set();
  return new Set([rec.defaultBackground, ...(rec.backgroundPool || [])].filter(Boolean));
}

/** 「機器可再生內容」判定器：值逐字等於來源版式的預設補槽值、或 legacy kv 對映值＝可再生（換走不佔暫存） */
function regenCheckerFor(page, srcRec, products) {
  if (!srcRec) return () => false;
  const seed = legacyHeroSeed(page.kv, srcRec);
  const defaults = defaultHeroForLayout(srcRec, page.pageName, products, page.kv); // 2026-09-27 前的預填（照 products[] 順序切、不避曝光）——舊稿那份也算機器內容
  const legacyDefaults = defaultHeroForLayout(srcRec, page.pageName, products); // 2026-09-24 前預填的是活動名——舊稿那份也算機器內容，換版式不入暫存
  /* 2026-09-27 起的預填（避開已曝光、跳過長名）——heroSoFar 用空物件近似補槽當下的狀態：文字槽不帶 gdid、
     現役版式沒有「一格已搬家、另一格要補」的組合，所以排除集合與補槽當下相同；萬一不同＝最多把機器內容當使用者內容入暫存（保守方向） */
  const defaultsNew = defaultHeroForLayout(srcRec, page.pageName, products, page.kv, heroPrefillOptions(page, products, {}));
  return (k, v) => deepEq(v, defaults[k]) || deepEq(v, defaultsNew[k]) || deepEq(v, legacyDefaults[k]) || deepEq(v, seed[k]);
}

/**
 * 套用組合變更到 draft 物件（純物件層；驗證失敗 throw＝呼叫端 400 白話）。
 * @param {object} dj draft.json 內容（就地變更）
 * @param {object} change { kvVariant?, backgroundId?(string|null), themeId?(string|null),
 *                 customColor?(hex|null), colors?(themeDraft 物件＝提案包帶入), pageBg?(hex|null),
 *                 heroTitleScale?/heroSubtitleScale?(sm|md|lg|null), heroTitleLeading?/heroSubtitleLeading?/heroTitleTracking?(sm|md|lg|null), heroTitleWidth?(narrow|standard|wide|null),
 *                 by?, reasonNote? }
 *                 undefined＝不動；null＝清除（回預設）。theme 框架批 2026-08-25：
 *                 自訂色/主題 slug 互斥（單一控制點）——選其一即清另一；檔位表與推導＝lib/theme_draft.js 單一來源。
 * @param {object} deps loadLayoutDeps() 產物
 * @returns { changed:boolean, info } info={ changedFields, stashedKeys, restoredKeys, droppedKeys,
 *   filledKeys, restoredGdids, notes[], summary }
 */
/* 標題實際渲染底（2026-09-04 假閘修正；病例＝白字壓白棚照 1.00:1 被放行）：
   照片型（bgClass=scene）版面的標題壓在照片上、照片不跟草案換色，草案宣稱的 hero 底色在畫面上不存在——
   檢查必須拿「畫面上真的那塊」算：登記簿 bridgeColor＝該照片的代表色（引擎 applyHeroBg 也拿它鋪頁底＝同一個值）。
   解析順序鏡射引擎：這手要換的版式/背景優先 → 草稿現值 → 版式預設背景；退場背景（retiredFromPool）非版式預設＝引擎回落預設（同法）。
   seamless（連續磚）／pattern（底紋跟主題）／查無紀錄＝回 null（照舊用草案宣稱底；不假裝知道）。 */
function effectiveHeroSurface(page, change, deps) {
  const { registries } = deps;
  const kv = normalizeKvVariant(change.kvVariant !== undefined ? change.kvVariant : page.kvVariant) || "";
  const rec = registries.layoutRecords.get(kv);
  if (!rec) return null; // 現行版型（new/legacy）＝舊制自訂色引擎自管，不在此判
  let bgId = change.backgroundId !== undefined ? change.backgroundId : page.backgroundId;
  if (bgId == null || bgId === "") bgId = rec.defaultBackground;
  const ownRec = (change.heroBgOwn !== undefined ? change.heroBgOwn : page.heroBgOwn) || null;
  const lookup = (id) => id === ownBg.OWN_BG_ID
    ? (ownRec && typeof ownRec === "object" ? { name: "你上傳的背景", bgClass: "scene", bridgeColor: ownRec.bridgeColor || null } : null) /* own＝照片類；銜接色＝上傳時量桌機圖底緣（78 號） */
    : (deps.backgrounds && deps.backgrounds.get(id)) || (registries.pendingBackgroundRecords && registries.pendingBackgroundRecords.get(id)) || null;
  let bg = lookup(bgId);
  if (bg && bg.retiredFromPool && bgId !== rec.defaultBackground) { bgId = rec.defaultBackground; bg = lookup(bgId); }
  if (bg && !bg.bgClass && /^pending-/.test(String(bgId))) bg = { ...bg, bgClass: "scene" }; /* 待審簿條目沒有分類欄＝一律照片（2026-09-04）；有量到 bridgeColor 才算得出真底色，舊條目 null＝不判（引擎預覽端會現量） */
  if (!bg || bg.bgClass !== "scene" || !themeDraftLib.isHex6(bg.bridgeColor)) return null;
  return { hex: themeDraftLib.normHex(bg.bridgeColor), label: `「${rec.name}」的照片背景「${bg.name || bgId}」`, bgId, bgName: bg.name || bgId, layoutName: rec.name, layoutId: kv };
}

function applyCombo(dj, change, deps) {
  if (!dj || !dj.page) throw new Error("草稿內容不完整（缺 page）——請重新整理頁面後再試");
  const { registries } = deps;
  /* 顯示層文案一律用登記簿名稱、不印貨號裸碼（2026-08-25 使用者裁決：CMS 介面禁工程/內部治理詞彙；
     貨號只進句尾「（技術：…）」括號＝範式沿 layout_choice.js） */
  const bgName = (id) => { if (id === ownBg.OWN_BG_ID) return "你上傳的背景"; const b = deps.backgrounds && deps.backgrounds.get(id); return (b && b.name) || id; }; /* own 不印裸字（78 號） */
  const page = dj.page;
  const cur = normalizeKvVariant(page.kvVariant) || null; // null＝舊 draft 無版式欄（legacy 態）
  const curIsV2 = /^layout-\d{3}$/.test(cur || "");
  const info = { changedFields: [], stashedKeys: [], restoredKeys: [], droppedKeys: [], filledKeys: [], restoredGdids: [], notes: [] };

  /* ── 提案包配色前置驗（2026-08-27 擋色制＝使用者令取代 2026-08-25「黃燈帶入不擋」；colors 可讀性 vs pack qaStatus 黃燈帶入＝不同題，後者照 51 §2.7 不動）：
     擋級檢查不過＝整包「原子」擋——版式/背景/主題任何欄位都不落地（不前置＝colors 段在 L357 才驗＝半套病）、
     meta.proposalPack 也不寫（引擎 applyThemeDraftColors 有 meta 後備讀色路＝寫了等於被擋的色從後門上畫面）。
     選項＝fixedColors「只調不及格字色」修正版（使用者主動按才帶入＝「不自動改色」半條裁決仍有效）。 ── */
  /* 標題實際渲染底（2026-09-04）：三條寫入路（提案包／自訂主色／逐槽微調）同一個值——檢查算的底＝畫面上真的那塊 */
  const heroSurface = effectiveHeroSurface(page, change, deps);
  const chk = (td) => themeDraftLib.checkThemeDraft(td, heroSurface ? { heroSurface } : undefined);
  if (change.colors !== undefined && change.colors && typeof change.colors === "object") {
    const packFails = chk(change.colors).filter((c) => !c.pass && c.blocking !== false);
    if (packFails.length) {
      const fixed = JSON.parse(JSON.stringify(change.colors));
      for (const c of packFails) {
        if (!c.suggest || !c.slot) continue;
        if (["title", "subtitle", "eventLabel", "eventDate"].includes(c.slot)) { fixed.componentColors = fixed.componentColors || {}; fixed.componentColors[c.slot] = c.suggest; }
        else fixed[c.slot] = c.suggest;
      }
      const fixedOk = chk(fixed).every((x) => x.pass || x.blocking === false);
      info.blocked = { kind: "pack", fails: packFails.map((c) => ({ name: c.name, msg: c.msg, ratio: c.ratio, need: c.need })), fixedColors: fixedOk ? fixed : null,
        surface: heroSurface ? { hex: heroSurface.hex, bgName: heroSurface.bgName, layoutName: heroSurface.layoutName } : null };
      const worst = packFails.slice().sort((a, b) => a.ratio - b.ratio)[0];
      const lead = heroSurface
        ? `提案包沒有帶入：你的${worst.name}色在${heroSurface.label}上會看不見（對比只有 ${worst.ratio.toFixed(2)}：1，需要 ${worst.need}：1${packFails.length > 1 ? `；共 ${packFails.length} 處` : ""}）——這款版面的照片不會跟著配色變暗，整包先擋下、這檔什麼都沒改。`
        : `提案包的配色有 ${packFails.length} 處文字會看不清——整包先擋下、這檔什麼都沒改。`;
      info.notes.push(lead + (fixedOk ? "可以一鍵帶入「只調不及格字色」的修正版（其餘照包）；或回色彩工具重選。" : "請回色彩工具修正後重新打包。"));
      return { changed: false, info };
    }
  }

  /* ── 換版式 ── */
  let target = change.kvVariant === undefined ? undefined : normalizeKvVariant(String(change.kvVariant).trim());
  const sameFamilyNoop = target !== undefined && cur == null && (target === "new" || target === "legacy") && !curIsV2;
  if (sameFamilyNoop) {
    info.notes.push("這檔本來就是現行版型（舊草稿無版式欄＝同義）——沒有變更"); // §2.8：不改動即儲存＝零 diff
    target = undefined;
  }
  if (target !== undefined && target !== cur) {
    const targetIsV2 = /^layout-\d{3}$/.test(target);
    if ((!targetIsV2 && target !== "new" && target !== "legacy") || (targetIsV2 && !registries.layoutRecords.has(target))) {
      throw new Error(`這個版面代號系統不認得，請重新選一張。（技術：kvVariant=${change.kvVariant} 不在值域＝new｜legacy＋登記簿貨號）`);
    }
    if (!deps.shippable(target)) {
      throw new Error(`這個版面暫停使用，請改選其他版面。（技術：${target} 停收＝不在出貨值域或 rollout=closed）`);
    }
    /* 引擎完工閘（滾動上架制 2026-08-25，與表單 resolveLayoutChoice／CP-25 閘同一套名單）：
       未完工版面＝面板卡不出現、直傳值也擋、提案包帶入也擋（pack 路徑同走本函式）——三入口零後門。 */
    if (!deps.engineReady.has(target)) {
      throw new Error(`這個版面正式樣式還在製作中，完成後就會開放選用，請先改選其他版面。（技術：${target} 不在 ENGINE_SUPPORTED 完工名單）`);
    }
    const srcRec = curIsV2 ? registries.layoutRecords.get(cur) || null : null;
    /* 「你上傳的背景」跟版式綁（78 號）：三張圖是對這款版式的舞台尺寸驗的，換版式＝尺不同＝要重傳；先擋、講清楚怎麼做 */
    if (page.backgroundId === ownBg.OWN_BG_ID && change.backgroundId === undefined) {
      throw new Error("這檔用的是你上傳的背景，而每款版面需要的圖尺寸不同——請先把背景改回「版式預設」（你上傳的三張會先收著），換完版面再重新上傳三張。（技術：backgroundId=own 與 kvVariant 變更互斥）");
    }
    if (targetIsV2) {
      const rec = registries.layoutRecords.get(target);
      const m = migrateHero(page, srcRec, rec, dj.products);
      Object.assign(info, {
        stashedKeys: m.stashedKeys, restoredKeys: m.restoredKeys, droppedKeys: m.droppedKeys,
        filledKeys: m.filledKeys, restoredGdids: m.restoredGdids,
      });
      for (const n of m.fillNotes || []) info.notes.push(n); // 2026-09-27：補槽沒補滿＝白話講哪一格少幾件、為什麼、怎麼補
      /* 背景處置：kinRef 親戚對換（折扣開關）＝51 §2.14——原選在對方池內保留、池外換對方預設＋黃燈；
         一般換版式＝保留使用者原選（池外＝黃燈揭示不阻擋＝彈性三原則）。未明選（缺欄）＝跟隨版式預設，不動。 */
      const isKinSwap = !!(srcRec && srcRec.kinRef && (srcRec.kinRef.promo === target || srcRec.kinRef.base === target));
      if (page.backgroundId != null && !poolOf(rec).has(page.backgroundId)) {
        if (isKinSwap) {
          info.notes.push(`原本選的背景「${bgName(page.backgroundId)}」在「${rec.name}」沒有對應——已幫你換成「${rec.name}」的預設背景「${bgName(rec.defaultBackground)}」。（技術：kinRef 對換特例，${page.backgroundId}→${rec.defaultBackground}）`);
          page.backgroundId = rec.defaultBackground;
          info.changedFields.push("backgroundId");
        } else {
          info.notes.push(`你選的背景「${bgName(page.backgroundId)}」不是「${rec.name}」的建議背景——照樣保留你的選擇，只做提醒、不會擋你。（技術：池外組合＝黃燈不阻擋）`);
        }
      }
    } else {
      /* 新版式 → 現行版型：hero 全量入暫存（機器可再生內容照樣不佔位）、kv 未動＝全量還原。
         backgroundId/themeId 留在欄位上（現行版型頁不消費＝休眠；換回新版式時原值續用）。 */
      if (page.hero && typeof page.hero === "object") {
        const isRegen = regenCheckerFor(page, srcRec, dj.products);
        const stash = (page.heroSlotStash && typeof page.heroSlotStash === "object") ? { ...page.heroSlotStash } : {};
        for (const [k, v] of Object.entries(page.hero)) {
          if (isRegen(k, v)) info.droppedKeys.push(k);
          else { stash[k] = v; info.stashedKeys.push(k); }
        }
        if (Object.keys(stash).length) page.heroSlotStash = stash; else delete page.heroSlotStash;
      }
      delete page.hero;
      info.notes.push("已切回現行版型——主視覺內容全量還原（原 kv 內容未曾變動）；新版式槽位的內容收在未上場暫存，之後換回對應版式會自動還原");
    }
    page.kvVariant = target;
    info.changedFields.push("kvVariant");
  } else if (target !== undefined) {
    info.notes.push(`版式已經是 ${target}——沒有變更`);
  }

  /* ── 背景改選（值域＝登記簿全景；池外亮黃燈不阻擋） ── */
  if (change.backgroundId !== undefined) {
    const bg = change.backgroundId;
    if (bg === null || bg === "") {
      if (page.backgroundId != null) { delete page.backgroundId; info.changedFields.push("backgroundId"); }
    } else {
      const isPendingBg = (registries.pendingBackgroundIds || []).includes(bg);
      const isOwnBg = bg === ownBg.OWN_BG_ID;
      if (isOwnBg) {
        const own = change.heroBgOwn !== undefined ? change.heroBgOwn : page.heroBgOwn;
        if (!own || typeof own !== "object") throw new Error("還沒有上傳背景圖——先在下方三格各上傳一張，三張齊了才能選「你上傳的背景」。（技術：backgroundId=own 需 page.heroBgOwn）");
        const missing = ownBg.ownMissingSlots(own);
        if (!(own.files && typeof own.files.desktop === "string" && own.files.desktop)) throw new Error("先上傳桌機版——有桌機圖預覽就能先換上，平板與手機再補。（技術：heroBgOwn.files.desktop 缺）");
        /* 傳了桌機版就先套用預覽（2026-09-27 使用者實測：只靠縮圖不夠，左邊預覽要即時跟上）；缺的裝置先用桌機圖代替、黃條明講；三張齊才過 gate CP-27 與核可 */
        if (missing.length) info.notes.push(`你上傳的背景・已套用，缺${missing.map((m) => ({ "768": "平板版", "375": "手機版" })[m]).join("、")}（暫用桌機圖）→ 三張齊才能核可`);
        /* 三張齊的狀態句 2026-09-29 使用者走查裁撤：它掛在面板底部的「上次套用」黃框＝離上傳區塊太遠沒人看到，
           而且確認完成後還寫著「確認中」＝過期說謊。狀態只住一處＝上傳區塊的 stateLine＋確認框（那裡即時、就地）。 */
      }
      if (!isOwnBg && !registries.backgroundIds.includes(bg) && !isPendingBg) {
        throw new Error(`這個背景系統不認得，請重新選一個。（技術：backgroundId=${bg} 不在背景登記簿，也不在待審簿）`);
      }
      /* 待審背景（63 號直通車 2026-08-31）：訪客號＝照常寫入使用——上線會掛「背景版權待審核」浮水印（內網展示限定）。
         漏改實證＝2026-08-31 使用者報「抵達 CMS 沒辦法直接用」：包驗證層（parseProposalPack）已放行、
         本寫入層值域沒同步＝同一規則兩處只改一處；此處為第二處，同批補齊。 */
      if (isPendingBg) {
        info.notes.push(`「${bg}」是你上傳的待審背景——直接用沒問題；上線後頁面會掛「背景版權待審核」浮水印（內網展示限定），審核轉正後浮水印自動消失。`);
      }
      if (page.backgroundId !== bg) {
        page.backgroundId = bg;
        info.changedFields.push("backgroundId");
        const kvNow = normalizeKvVariant(page.kvVariant) || "";
        const recNow = registries.layoutRecords.get(kvNow);
        if (recNow && !isOwnBg && !poolOf(recNow).has(bg)) {
          info.notes.push(`你選的背景「${bgName(bg)}」不是「${recNow.name}」的建議背景——可以用，出貨前系統會自動確認素材授權。（技術：池外組合＝黃燈不阻擋，授權閘照常把關）`);
        }
        const bgRec = deps.backgrounds && deps.backgrounds.get(bg);
        if (bgRec && bgRec.retiredFromPool) {
          /* 池過濾退場者（登記簿 v0.6.3，2026-08-25 裁決＝與設計工具同一套）：例外＝版式自己的預設照常沿用；
             其餘＝容忍存檔出聲、渲染回落版式預設 */
          info.notes.push(bg === (recNow && recNow.defaultBackground)
            ? `「${bgName(bg)}」是這款版式原本的搭配——只有這款版式還能用它，其他版式已停止提供。`
            : `「${bgName(bg)}」這張背景已停用——先幫你存起來，但畫面會改用版式預設背景。`);
        }
        if (page.pageBgOverride) { // 補遺二③：換背景時頁底手調＝保留＋提醒
          info.notes.push("你手動設定過活動頁底色——換背景後照樣保留；如果和新背景接不起來，按底色旁的「× 回自動」。");
        }
      }
    }
  }

  /* ── 主題改選（值域＝tokens.json themes slug、rejected 不收）──
     單一控制點制（2026-08-25 使用者裁決：主題兩欄統整）：本欄同時驅動
     ①hero＝page.themeId（tokens 十主題；②型版式恆定不動＝天然）
     ②下方內容區塊＝page.theme（舊制 campaign-*；過渡對映表＝W1-F 內文模組換新制後廢）
     「跟隨背景圖／預設」＝themeId 清空＋page.theme 回預設＝使用者要的「回復背景圖銜接配色」。 */
  if (change.themeId !== undefined) {
    const th = change.themeId;
    /* 單一控制點（theme 框架批 2026-08-25）：改選主題（含回預設）＝細粒度套色草案退場——
       自訂色或提案包配色與主題 slug 不並存（並存＝兩套顏色打架、無從說明畫面誰說了算）。 */
    if (dj.page.colors) {
      delete dj.page.colors;
      info.changedFields.push("colors");
      info.notes.push("已改用主題配色——先前的自訂顏色（或提案包配色）設定已移除；想用回自訂顏色，重新在主題配色選「自訂顏色」即可。");
    }
    /* 新主題 slug → 舊制內容配色對映（家族同名者 1:1；japanese/clash 無舊制對應＝內容先走預設＋出聲揭示） */
    const THEME_LEGACY_MAP = { "green-light": "green-light", "green-dark": "green-dark", "gold-light": "gold-light", "gold-dark": "gold-dark", "blue-light": "blue-light" };
    const setLegacyTheme = (ct) => {
      const cur = page.theme || {};
      if (cur.colorTheme === ct) return false;
      page.theme = { ...cur, colorTheme: ct, hueFamily: ct.split("-")[0], surfaceMode: ct.split("-")[1] };
      return true;
    };
    if (th === null || th === "") {
      if (page.themeId != null) { delete page.themeId; info.changedFields.push("themeId"); }
      if (setLegacyTheme("pink-light")) info.changedFields.push("theme"); // 回預設＝跟隨背景圖銜接配色（建立預設）
      info.notes.push("已回復預設配色（主視覺跟隨版式／背景圖，下方內容區塊回到預設）。");
    } else {
      if (!registries.themeIds.includes(th)) {
        throw new Error(`這個主題系統不認得，請重新選一個。（技術：themeId=${th} 不在主題清單，或該款未獲採用）`);
      }
      if (page.themeId !== th) { page.themeId = th; info.changedFields.push("themeId"); }
      const leg = THEME_LEGACY_MAP[th];
      if (leg) { if (setLegacyTheme(leg)) info.changedFields.push("theme"); }
      else {
        if (setLegacyTheme("pink-light")) info.changedFields.push("theme");
        info.notes.push("這款主題目前只作用在主視覺——下方內容區塊先以預設配色呈現（內容區塊的新配色隨後續批到位）。");
      }
    }
  }

  /* ── 自訂顏色（theme 框架批 2026-08-25：調色盤主色 → 機器配色 → 可讀性檢查黃燈 → 寫入）──
     推導與檢查＝lib/theme_draft.js 單一來源；主視覺細粒度套色＝page.colors.themeDraft（FrameTest 消費）、
     下方內容區塊＝page.theme custom 舊制（FrameTest 既有自訂色引擎消費）——同一顆種子色、兩層一起變。 */
  if (change.customColor !== undefined) {
    const seedRaw = change.customColor;
    if (seedRaw === null || seedRaw === "") {
      if (page.colors) { delete page.colors; info.changedFields.push("customColor"); }
      const curT = page.theme || {};
      if (/^custom-/.test(curT.colorTheme || "")) {
        page.theme = { ...curT, colorTheme: "pink-light", hueFamily: "pink", surfaceMode: "light" };
        delete page.theme.customColor;
        if (!info.changedFields.includes("customColor")) info.changedFields.push("customColor");
      }
      if (info.changedFields.includes("customColor")) info.notes.push("已取消自訂顏色，回到預設配色。");
    } else {
      if (!themeDraftLib.isHex6(seedRaw)) {
        throw new Error("這個顏色代碼系統看不懂，請用調色盤重新選一次。（技術：customColor 需 #RRGGBB）");
      }
      const seed = themeDraftLib.normHex(seedRaw);
      if (page.colors && page.colors.source === "custom" && page.colors.seed === seed) {
        info.notes.push("這個自訂顏色已經在用了——沒有變更"); // 等值 no-op 先於擋（宿主鏡頭：存量 needs-review 稿重送同色不得回「被擋」）
      } else {
        const assess = themeDraftLib.assessSeedColor(seed);
        const td = themeDraftLib.deriveThemeDraft(seed);
        /* 擋色制（2026-08-27 使用者令取代 2026-08-25「黃燈不硬擋」；「不自動改色」半條仍有效＝建議色是選項不代按）：
           擋級檢查不過＝不寫入、回 info.blocked 結構（原色完好；面板渲染擋卡＋一鍵建議色）。 */
        const fails = chk(td).filter((c) => !c.pass && c.blocking !== false); // 同一把尺（照片型版面＝對實際照片底）
        if (fails.length) {
          const seedSuggest = themeDraftLib.suggestSeed(seed);
          info.blocked = { kind: "customColor", seed, fails: fails.map((c) => ({ name: c.name, msg: c.msg, ratio: c.ratio, need: c.need })), seedSuggest };
          info.notes.push(`${fails.map((c) => c.msg).join("；")}。這個顏色先擋下、沒有存檔——` + (seedSuggest ? "可以一鍵改用同色系深一點的通過版，或換一個顏色。" : "這個色系配不出通過檢查的版本，請換一個顏色。"));
        } else {
          if (assess.warn) info.notes.push(assess.warn);
          page.colors = { source: "custom", seed, overrides: {}, themeDraft: td }; // 換主色＝逐槽微調歸零重推（C 案：overrides 存於 draft、themeDraft＝完整 schema 產物）
          info.changedFields.push("customColor");
          if (page.themeId != null) { delete page.themeId; info.changedFields.push("themeId"); } // 單一控制點：自訂色上場＝主題 slug 退位
          /* 內容區塊＝舊制自訂色引擎（FrameTest applyCustomTheme：一顆種子推 21 個內容區 token、自動保可讀） */
          page.theme = { ...(page.theme || {}), colorTheme: "custom-light", customColor: seed, hueFamily: "custom", surfaceMode: "light" };
          info.notes.push("整頁配色已照你選的主色自動配好（照片不會被改色）；文字顏色檢查全數通過。");
        }
      }
    }
  }

  /* ── 自訂色逐槽微調（C 案 2026-08-25 裁決：推導出的每一槽在面板可點色塊調整、改完重過對比檢查）──
     覆寫存 page.colors.overrides、themeDraft＝重推產物（單一真相：改槽＝改 overrides 再重推，不直接改 themeDraft）。
     擋色制（2026-08-27）判準＝「這手新造成的不及格」（前後 diff）——存量草稿既有的舊病灶不擋無關槽的微調
     （批判走查鏡頭：全域擋＝存量 needs-review 稿逐槽全鎖死）；customSlots（多槽一次）＝擋卡「一鍵連動修正」的寫入通道。 */
  const slotEdits = [];
  if (change.customSlot !== undefined && change.customSlot && typeof change.customSlot === "object") slotEdits.push(change.customSlot);
  if (Array.isArray(change.customSlots)) for (const e of change.customSlots) { if (e && typeof e === "object") slotEdits.push(e); }
  if (slotEdits.length) {
    if (!page.colors || page.colors.source !== "custom" || !page.colors.seed) {
      throw new Error("要先在主題配色選「自訂顏色」挑一個主色，才能微調各部位的顏色。");
    }
    const ovs = { ...(page.colors.overrides || {}) };
    const labels = [];
    for (const e of slotEdits) {
      const key = String(e.key || "");
      const slotDef = themeDraftLib.THEME_SLOTS.find((s) => s.key === key);
      if (!slotDef) throw new Error("這個部位系統不認得，請重新整理頁面再試。（技術：customSlot.key 不在 THEME_SLOTS）");
      if (slotDef.locked) throw new Error(`「${slotDef.label}」是固定色不能改——${slotDef.locked}。`);
      const hexV = e.hex;
      if (hexV === null || hexV === "") delete ovs[key];
      else {
        if (!themeDraftLib.isHex6(hexV)) throw new Error("這個顏色代碼系統看不懂，請用調色盤重新選一次。（技術：customSlot.hex 需 #RRGGBB）");
        ovs[key] = themeDraftLib.normHex(hexV);
      }
      labels.push(slotDef.label);
    }
    const beforeFail = new Set(chk(page.colors.themeDraft || {}).filter((c) => !c.pass && c.blocking !== false).map((c) => c.name));
    const td2 = themeDraftLib.deriveThemeDraft(page.colors.seed, ovs);
    const after = chk(td2);
    const introduced = after.filter((c) => !c.pass && c.blocking !== false && !beforeFail.has(c.name));
    if (introduced.length) {
      /* 這手改壞＝不寫入；fixSlots＝「使用者這手＋連動字色修正」複合套組（批判走查鏡頭：底色槽編修的 suggest 指向字色槽，
         單獨套建議＝使用者的底色被丟棄——一鍵要兩槽一起寫才符合本意） */
      const fixSlots = {};
      for (const e of slotEdits) { if (e.hex != null && e.hex !== "") fixSlots[String(e.key)] = themeDraftLib.normHex(e.hex); }
      let fixable = true;
      for (const c of introduced) { if (c.slot && c.suggest) fixSlots[c.slot] = c.suggest; else fixable = false; }
      info.blocked = { kind: "customSlot", slots: labels, fails: introduced.map((c) => ({ name: c.name, msg: c.msg, ratio: c.ratio, need: c.need, slot: c.slot, suggest: c.suggest })), fixSlots: fixable ? fixSlots : null };
      info.notes.push(`這樣改會讓「${introduced.map((c) => c.name).join("、")}」看不清楚——先擋下、沒有存檔。` + (fixable ? "可以一鍵「照你改的＋連動調整字色」一起套用，或改選別的值。" : "請改選別的值。"));
    } else {
      page.colors = { ...page.colors, overrides: ovs, themeDraft: td2 };
      info.changedFields.push("customSlot");
      const remind = after.filter((c) => !c.pass && c.blocking === false);
      info.notes.push(`「${labels.join("、")}」顏色已更新，文字對比檢查通過。` + (remind.length ? `（提醒：${remind.map((c) => c.msg).join("；")}）` : ""));
    }
  }

  /* ── 提案包配色草案（colors.themeDraft）：設計師在色彩工具打包的細粒度套色——擋級已在函式頭前置驗過
     （走到這裡＝全過；2026-08-27 擋色制），落 draft 後只剩提醒級（cta）黃燈揭示。 ── */
  if (change.colors !== undefined && change.colors && typeof change.colors === "object") {
    page.colors = { source: "pack", themeDraft: change.colors };
    info.changedFields.push("colors");
    for (const c of chk(change.colors)) {
      if (!c.pass) info.notes.push(`提案包配色提醒：${c.msg}。`);
    }
    /* 頁底色被照片銜接色壓過＝出聲（2026-09-04 D2；原本靜默）：照片型版面的頁底跟照片走（引擎 applyHeroBg 行內鋪底、補遺二④），
       草案 backgroundModules.page 只進 CSS 變數、畫面上用不到；手調（下方「活動頁底色」）優先於銜接色＝給使用者可走的路 */
    const pageRole = Array.isArray(change.colors.backgroundModules) ? change.colors.backgroundModules.find((m) => m && m.key === "page") : null;
    if (heroSurface && pageRole && themeDraftLib.isHex6(pageRole.hex) && themeDraftLib.normHex(pageRole.hex) !== heroSurface.hex) {
      info.notes.push(`這款版面是照片背景：活動頁底色會跟著照片的銜接色走（${heroSurface.hex}），提案包配的頁面底色 ${themeDraftLib.normHex(pageRole.hex)} 不會用上；想用它，在下方「活動頁底色」點色塊手動選。`);
    }
  }

  /* ── 活動頁底色手調（補遺二②③ 2026-08-25）：自訂＝取代自動銜接（頁底＋漸層帶終點同一個值）；
     null＝回自動（scene 跟背景圖銜接色、底紋類回主題色）。 ── */
  if (change.pageBg !== undefined) {
    const pb = change.pageBg;
    if (pb === null || pb === "") {
      if (page.pageBgOverride != null) {
        delete page.pageBgOverride;
        info.changedFields.push("pageBg");
        info.notes.push("活動頁底色已回到自動（跟著背景圖的銜接色走）。");
      }
    } else {
      if (!themeDraftLib.isHex6(pb)) {
        throw new Error("這個顏色代碼系統看不懂，請用調色盤重新選一次。（技術：pageBg 需 #RRGGBB）");
      }
      const v = themeDraftLib.normHex(pb);
      if (page.pageBgOverride !== v) {
        page.pageBgOverride = v;
        info.changedFields.push("pageBg");
        const bgNow = deps.backgrounds && deps.backgrounds.get(page.backgroundId || ((registries.layoutRecords.get(normalizeKvVariant(page.kvVariant) || "") || {}).defaultBackground));
        if (bgNow && bgNow.bgClass === "scene" && bgNow.bridgeColor && themeDraftLib.isHex6(bgNow.bridgeColor) && themeDraftLib.contrast(v, themeDraftLib.normHex(bgNow.bridgeColor)) > 2) {
          info.notes.push("你選的底色和背景圖邊緣的顏色差比較多，接縫處可能會明顯——不合適的話按底色旁的 × 回到自動。");
        }
      }
    }
  }

  /* ── 排版檔位（2026-08-25 使用者指示：標題/副標字級＋主視覺標題排版寬度）：
     檔位表＝theme_draft.js 單一來源；渲染端把乘數套在吸字「起始字級/版寬預算」上、保底恆定＝不爆版。 ── */
  const typoFields = [
    ["heroTitleScale", "titleScale", themeDraftLib.TYPO_SCALE_STEPS, "標題字級"],
    ["heroSubtitleScale", "subtitleScale", themeDraftLib.TYPO_SCALE_STEPS, "副標題字級"],
    ["heroTitleLeading", "titleLeading", themeDraftLib.TYPO_LEADING_STEPS, "標題行距"], /* 行距兩檔＝2026-09-04 晚場（使用者報「行距不能調整」） */
    ["heroSubtitleLeading", "subtitleLeading", themeDraftLib.TYPO_LEADING_STEPS, "副標題行距"],
    ["heroTitleWidth", "titleWidth", themeDraftLib.TITLE_WIDTH_STEPS, "標題排版寬度"],
    ["heroTitleTracking", "titleTracking", themeDraftLib.TYPO_TRACKING_STEPS, "標題字距"], /* 字距＝2026-09-05（引擎實測四控制只有兩支真的會動） */
  ];
  for (const [chKey, field, steps, label] of typoFields) {
    if (change[chKey] === undefined) continue;
    const v = change[chKey];
    const typo = (page.typography && typeof page.typography === "object") ? page.typography : {};
    /* 哪一檔是「標準」＝寫在檔位表自己身上（default 旗標）。原本用 mul===1 反推，
       但字距那張表是加減制、沒有 mul 欄＝反推會炸；判準寫進表裡才不會每加一種控制就多一個特例（鐵律 4）。 */
    const defId = (steps.find((s) => s.default) || steps.find((s) => s.mul === 1)).id;
    if (v === null || v === "" || v === defId) {
      /* null 或標準檔＝回預設（欄位不留＝草稿保持乾淨） */
      if (field in typo) { delete typo[field]; info.changedFields.push(chKey); }
    } else {
      if (!steps.some((s) => s.id === v)) {
        throw new Error(`${label}只能選固定檔位，請重新選一次。（技術：${chKey}=${v} 不在 ${steps.map((s) => s.id).join("|")}）`);
      }
      if (typo[field] !== v) { typo[field] = v; info.changedFields.push(chKey); }
    }
    if (Object.keys(typo).length) page.typography = typo;
    else delete page.typography;
  }

  /* ── 標題字風（2026-09-04 字風落地批＝68 號第二批；14 號 page.titleStyle）：值域＝字風登記簿 approved 貨號——
     與 parseProposalPack 同吃 registries.typestyleIds（名單只有一處；2026-09-01「一條規則好幾道門」教訓）。
     null／空＝清欄回版式原字；fontLoaded=false 的款＝寫入但出聲（別人電腦上會退成後備字型）。 ── */
  if (change.titleStyle !== undefined) {
    const v = change.titleStyle;
    if (v === null || v === "") {
      if (page.titleStyle != null) { delete page.titleStyle; info.changedFields.push("titleStyle"); }
    } else {
      const id = String(v).trim();
      const rec = registries.typestyleRecords ? registries.typestyleRecords.get(id) : null;
      if (!rec) throw new Error(`這個字風系統不認得，請重新選一個。（技術：titleStyle=${id} 不在字風登記簿）`);
      if (!(registries.typestyleIds || []).includes(id)) {
        throw new Error(`「${rec.displayName || id}」這款字風還沒審查通過，暫時不能用；請改選已審查的字風。（技術：review.status=${(rec.review || {}).status || "（缺）"}≠approved）`);
      }
      if (page.titleStyle !== id) {
        page.titleStyle = id;
        info.changedFields.push("titleStyle");
        if (rec.fontLoaded === false) info.notes.push(`「${rec.displayName || id}」用的字型「${rec.family || "（未知）"}」目前沒有隨頁面載入——別人的電腦會看到後備字型；出貨前請負責人補字型或改選。`);
      }
    }
  }

  /* ── 副標題字體（2026-09-04 使用者翻案 09-03 Q8；14 號 page.subtitleFont）：{ fontId, weight } → 草稿存 { fontId, weight, family, css2 }——
     family／css2 由字體簿在寫入時解析後帶著走（引擎不讀登記簿；css2＝Google Fonts 載入串，缺＝單檔 WebFont 無網路載入路、出聲）。 ── */
  if (change.subtitleFont !== undefined) {
    const v = change.subtitleFont;
    if (v === null || v === "") {
      if (page.subtitleFont != null) { delete page.subtitleFont; info.changedFields.push("subtitleFont"); }
    } else {
      if (typeof v !== "object" || !v.fontId) throw new Error("副標字體資料不完整，請重新帶入提案包。（技術：subtitleFont 需 { fontId, weight }）");
      const rec = registries.fontRecords ? registries.fontRecords.get(String(v.fontId)) : null;
      if (!rec) throw new Error(`這個副標字體系統不認得，請重新選一個。（技術：subtitleFont.fontId=${v.fontId} 不在字體簿）`);
      if (rec.pickable !== true) throw new Error(`「${rec.displayName || rec.family}」這款字不供挑選，請改選字體選單裡有的。（技術：字體簿 pickable≠true＝字風配方專用／引擎內建／授權未達 A 級；與 parseProposalPack 同吃 fontIds 判準）`);
      const w = v.weight != null ? Number(v.weight) : null;
      if (w != null && !(w >= 100 && w <= 900 && w % 100 === 0)) throw new Error(`副標字重只能是 100～900 的整百。（技術：weight=${v.weight}）`);
      const next = { fontId: rec.id, family: rec.family, ...(w != null ? { weight: w } : {}), ...(rec.css2 ? { css2: rec.css2 } : {}) };
      if (JSON.stringify(page.subtitleFont || null) !== JSON.stringify(next)) {
        page.subtitleFont = next;
        info.changedFields.push("subtitleFont");
        if (!rec.css2) info.notes.push(`「${rec.displayName || rec.family}」沒有網路字型檔——頁面上會退成後備字型；要真的顯示這款字，請負責人補字型載入路。`);
      }
    }
  }

  /* ── 字風妝容跟主題走（2026-09-05 接線上；14 號 page.titleStyleThemed）：只有 true 需要存；false／null＝清欄＝原妝。沒字風時開了也沒用＝照存不擋（換字風就生效） ── */
  if (change.titleStyleThemed !== undefined) {
    const v = change.titleStyleThemed;
    if (v === true) { if (page.titleStyleThemed !== true) { page.titleStyleThemed = true; info.changedFields.push("titleStyleThemed"); } }
    else if (v === null || v === false || v === "") { if (page.titleStyleThemed != null) { delete page.titleStyleThemed; info.changedFields.push("titleStyleThemed"); } }
    else throw new Error("字風妝容跟主題走只有開／關兩種。（技術：titleStyleThemed 需 true|false）");
  }
  /* ── 同組文字一起變形（2026-09-05；14 號 page.titleGroupWarp）：只有 true 需要存 ── */
  if (change.titleGroupWarp !== undefined) {
    const v = change.titleGroupWarp;
    if (v === true) { if (page.titleGroupWarp !== true) { page.titleGroupWarp = true; info.changedFields.push("titleGroupWarp"); } }
    else if (v === null || v === false || v === "") { if (page.titleGroupWarp != null) { delete page.titleGroupWarp; info.changedFields.push("titleGroupWarp"); } }
    else throw new Error("同組文字一起變形只有開／關兩種。（技術：titleGroupWarp 需 true|false）");
  }
  /* ── 你上傳的背景（78 號 2026-09-27）：heroBgOwn 物件＝寫入／更新（三檔齊由 backgroundId=own 那段驗）；null＝移除＋清指針。
     只收固定形狀；檔案路徑必須是本檔活動自己的 /api/runs/<id>/hero-bg/<格>.<副檔名>（伺服器端另驗檔在不在）。 ── */
  if (change.heroBgOwn !== undefined) {
    const v = change.heroBgOwn;
    if (v === null) {
      if (page.heroBgOwn != null) { delete page.heroBgOwn; info.changedFields.push("heroBgOwn"); }
      if (page.backgroundId === ownBg.OWN_BG_ID) { delete page.backgroundId; info.changedFields.push("backgroundId"); info.notes.push("你上傳的背景・已移除 → 改用版式預設"); }
    } else if (v && typeof v === "object" && v.files && typeof v.files === "object") {
      const okPath = (x) => typeof x === "string" && /^\/api\/runs\/[^/]+\/hero-bg\/(desktop|768|375)\.(jpg|png|webp)$/.test(x);
      for (const [k, x] of Object.entries(v.files)) {
        if (!ownBg.OWN_SLOTS.includes(k)) throw new Error("上傳的背景資料格位不對。（技術：heroBgOwn.files 鍵需 desktop|768|375）");
        if (!okPath(x)) throw new Error("上傳的背景檔案位置不對，請重新上傳。（技術：heroBgOwn.files 路徑需為 /api/runs/<id>/hero-bg/<slot>.<ext>）");
      }
      if (!deepEq(page.heroBgOwn, v)) { page.heroBgOwn = v; info.changedFields.push("heroBgOwn"); }
    } else throw new Error("上傳的背景資料形狀不對，請重新上傳。（技術：heroBgOwn 需物件含 files 或 null）");
  }
  /* ── 主視覺活動文字不顯示（78 號 2026-09-27；範疇＝確認牆 12 款）：只有 true 需要存；false／null＝清欄＝照常顯示。內容不清、關掉即回。 ── */
  if (change.heroTitleHidden !== undefined) {
    const v = change.heroTitleHidden;
    if (v === true) { if (page.heroTitleHidden !== true) { page.heroTitleHidden = true; info.changedFields.push("heroTitleHidden"); info.notes.push("主視覺文字・不顯示 → 內容保留，關掉即回"); } }
    else if (v === null || v === false || v === "") { if (page.heroTitleHidden != null) { delete page.heroTitleHidden; info.changedFields.push("heroTitleHidden"); } }
    else throw new Error("主視覺活動文字只有顯示／不顯示兩種。（技術：heroTitleHidden 需 true|false）");
  }
  /* ── 舞台下方跑馬文字不顯示（78 號；使用者裁：獨立開關、不綁標題；目前只有霓虹夜市款有跑馬帶） ── */
  if (change.heroMarqueeHidden !== undefined) {
    const v = change.heroMarqueeHidden;
    if (v === true) { if (page.heroMarqueeHidden !== true) { page.heroMarqueeHidden = true; info.changedFields.push("heroMarqueeHidden"); } }
    else if (v === null || v === false || v === "") { if (page.heroMarqueeHidden != null) { delete page.heroMarqueeHidden; info.changedFields.push("heroMarqueeHidden"); } }
    else throw new Error("跑馬文字只有顯示／不顯示兩種。（技術：heroMarqueeHidden 需 true|false）");
  }
  /* ── 主標兩側裝飾線（2026-09-04 使用者需求；14 號 page.titleFrame）：只有 off 需要存；on／null＝清欄＝板原樣 ── */
  if (change.titleFrame !== undefined) {
    const v = change.titleFrame;
    if (v === "off") { if (page.titleFrame !== "off") { page.titleFrame = "off"; info.changedFields.push("titleFrame"); } }
    else if (v === null || v === "" || v === "on") { if (page.titleFrame != null) { delete page.titleFrame; info.changedFields.push("titleFrame"); } }
    else throw new Error("主標兩側裝飾線只有開／關兩種。（技術：titleFrame 需 on|off）");
  }

  /* ── 提案包 QA 狀態（🔒 機器欄；qaStatus 非 candidate-pass＝needs-review 黃燈） ── */
  if (change.heroQaStatus !== undefined && page.heroQaStatus !== change.heroQaStatus) {
    page.heroQaStatus = change.heroQaStatus;
    info.changedFields.push("heroQaStatus");
  }

  const changed = info.changedFields.length > 0;
  if (changed && change.proposalPack) {
    dj.meta = dj.meta || {};
    dj.meta.proposalPack = { pack: change.proposalPack, warnings: change.packWarnings || [], deviated: false, appliedAt: new Date().toISOString(), appliedFrom: "combo-panel" };
    /* 2026-09-21 B：提案包解析時的提醒（待審背景、字級沒量到…）原本只存進 meta、沒回到畫面——編修頁貼包的人看不到。
       推進 info.notes＝跟其他黃燈同一條路顯示（建立表單那條路另有 renderPackResult，不重複）。 */
    for (const w of change.packWarnings || []) if (w && !info.notes.includes(w)) info.notes.push(w);
  }
  if (changed) {
    /* 理由行履歷（51 §2.12）：面板改選＝手動；原 AI 建議保留可顯示「已手動改選（原 AI 建議：＿）」。
       舊履歷推入 meta.layoutChoiceLog（機器欄、審計用；不參與 A→B→A 內容不變式——page 層才是內容）。 */
    dj.meta = dj.meta || {};
    const old = dj.meta.layoutChoice || null;
    const what = [...new Set(info.changedFields)].map((f) => ({ kvVariant: "版式", backgroundId: "背景", heroBgOwn: "上傳的背景", heroTitleHidden: "主視覺活動文字顯示", heroMarqueeHidden: "跑馬文字顯示", themeId: "主題", heroQaStatus: "組合QA狀態", customColor: "自訂顏色", customSlot: "自訂顏色微調", colors: "配色草案", pageBg: "活動頁底色", heroTitleScale: "標題字級", heroSubtitleScale: "副標題字級", heroTitleLeading: "標題行距", heroSubtitleLeading: "副標題行距", heroTitleWidth: "標題排版寬度", heroTitleTracking: "標題字距", titleStyle: "標題字風", subtitleFont: "副標題字體", titleFrame: "主標兩側裝飾線", titleStyleThemed: "字風妝容跟主題走", titleGroupWarp: "同組文字一起變形" }[f] || f)).join("＋");
    /* 偏離標記（51 §2.13 語意、2026-08-25 review M2）：草稿曾帶入提案包（meta.proposalPack 在案）、
       這次又是手動改動（非 pack 帶入）＝翻 deviated:true——包的紀錄照留（不刪不改內容），只標「現況已不照包」。
       語意邊界：一經手動改動即偏離、不做「改回原值＝自動復位」（值相同≠意圖相同；重貼提案包＝重新對齊、deviated 歸 false）。
       已知角落（story 申報）：人工漂回包值後重貼包＝零變更不寫檔、deviated 維持 true（誠實態：不為清旗而空寫）。 */
    if (!change.proposalPack && dj.meta.proposalPack && dj.meta.proposalPack.deviated !== true) {
      dj.meta.proposalPack.deviated = true;
      dj.meta.proposalPack.deviatedAt = new Date().toISOString();
      dj.meta.proposalPack.deviatedNote = `手動改動（${what}）——目前設定已與提案包不一致；重貼提案包可重新對齊`;
      info.notes.push("這檔原本照設計師的提案包設定——你手動改過之後，會標「已偏離提案包」（純紀錄，不影響出貨；重貼提案包可回到包的設定）。");
    }
    const kvNow = normalizeKvVariant(page.kvVariant) || "";
    const recNow = registries.layoutRecords.get(kvNow);
    const label = recNow ? `「${recNow.name}」（${kvNow}）` : kvNow === "new" || kvNow === "legacy" ? "現行版型" : kvNow || "（未宣告）";
    if (old) dj.meta.layoutChoiceLog = (dj.meta.layoutChoiceLog || []).concat([old]);
    /* reason＝機器履歷（存 meta 供追溯，可帶貨號代號）；reasonDisplay＝介面顯示（2026-08-25 使用者裁決：
       顯示層禁貨號/文件編號——編修頁橫幅與面板理由行都吃這欄，沿 layout_choice.js 同款雙欄制） */
    const labelDisplay = recNow ? `「${recNow.name}」` : "「現行版型」";
    /* 被審查制丟掉的字風也要進面板黃燈（2026-09-08 病例 run 150043：09-07 只寫進頂部「版面怎麼來的」橫幅，設計師貼完包盯的是面板下方的黃條列＝
       看不到任何一句講字風，追問「字風沒辦法打包進 CMS？」）——同一句話兩個位置都講，不多立規則 */
    if (change.by === "pack" && change.droppedTitleStyle) {
      info.notes.push(`字風「${change.droppedTitleStyle.displayName}」沒有帶入——它還在待審（負責人在字風登記簿審過才進得了 CMS），標題現在用版式原本的字。要用字風＝改選已審查的款，或請負責人審這款後重新打包。`);
    }
    dj.meta.layoutChoice = {
      by: change.by === "pack" ? "pack" : "manual",
      reason: `${change.by === "pack" ? "提案包帶入" : "組合面板改選"}（${what}）：現值＝版式${label}${page.backgroundId ? `、背景 ${page.backgroundId}` : "、背景＝版式預設"}${page.themeId ? `、主題 ${page.themeId}` : ""}${change.reasonNote ? `。${change.reasonNote}` : ""}`,
      reasonDisplay: `${change.by === "pack" ? "照設計師提案包帶入" : "你在編修頁改了"}${what}——目前用 ${labelDisplay} 版面、背景${page.backgroundId ? `「${bgName(page.backgroundId)}」` : "照版面預設"}${page.themeId ? `、主題「${page.themeId}」` : ""}${page.titleStyle ? `、字風「${((registries.typestyleRecords && registries.typestyleRecords.get(page.titleStyle)) || {}).displayName || "設計師指定"}」` : ""}${page.subtitleFont ? `、副標字體「${((registries.fontRecords && registries.fontRecords.get(page.subtitleFont.fontId)) || {}).displayName || page.subtitleFont.family}」` : ""}。${change.droppedTitleStyle ? `字風「${change.droppedTitleStyle.displayName}」沒有帶入（尚未審查通過），標題現在用版式原本的字。` : ""}`,
      decidedAt: new Date().toISOString(),
      aiOriginal: old ? (old.by === "ai" ? old.reason : old.aiOriginal) || null : null,
      aiOriginalDisplay: old ? (old.by === "ai" ? old.reasonDisplay || old.reason : old.aiOriginalDisplay || old.aiOriginal) || null : null,
    };
    info.summary = `已套用：${what}${info.stashedKeys.length ? `｜搬不過去的 ${info.stashedKeys.length} 槽已收未上場暫存` : ""}${info.restoredKeys.length ? `｜自暫存還原 ${info.restoredKeys.length} 槽` : ""}`;
  } else {
    info.summary = "沒有任何變更——草稿未寫入";
  }
  return { changed, info };
}

/**
 * 讀 draft → applyCombo → 落版備份 → 寫回（編修期寫入點；R4：呼叫端【必須】在本函式成功後
 * 呼叫 invalidateApproval——登錄＝scripts/draft-writers.allow「combo-apply」行）。
 * 讀不到／驗證失敗／寫不進＝throw（失敗要出聲；沒有變更＝不寫檔、changed:false）。
 */
function writeComboIntoDraft(draftPath, change, overridePathsOrDeps = {}) {
  const deps = overridePathsOrDeps.registries ? overridePathsOrDeps : loadLayoutDeps(overridePathsOrDeps);
  let dj;
  try {
    dj = JSON.parse(fs.readFileSync(draftPath, "utf8"));
  } catch (e) {
    throw new Error(`組合變更失敗（讀取草稿 ${draftPath}）：${e.message}`);
  }
  const r = applyCombo(dj, change, deps);
  if (!r.changed) return { ...r, draft: dj, backup: null };
  let backup = null;
  try {
    let v = 1;
    const dir = draftPath.replace(/[/\\][^/\\]+$/, "");
    while (fs.existsSync(`${dir}/draft.v${v}.json`)) v++;
    fs.copyFileSync(draftPath, `${dir}/draft.v${v}.json`);
    backup = `draft.v${v}.json`;
    fs.writeFileSync(draftPath, JSON.stringify(dj, null, 1));
  } catch (e) {
    throw new Error(`組合變更失敗（寫入草稿）：${e.message}——這次變更沒有存入，請再試一次`);
  }
  return { ...r, draft: dj, backup };
}

/** 提案包 → 組合變更（編修期貼包＝整組帶入並覆蓋手選＝51 §2.13；驗證沿 parseProposalPack 單一實作） */
function packToChange(rawPack, registries) {
  const r = parseProposalPack(rawPack, registries);
  if (!r.ok) return r;
  /* 沒接上的欄位一律出聲、不靜默丟（2026-09-04 D3；原本 font/motion 讀進來就丟、介面卻寫「整組帶入字體・動畫」）：
     font＝字體家族欄——標題字型由字風自帶，這欄目前不作用（font-001＝工具預設值＝設計師沒特別選，不吵）；
     motion＝動畫貨號——引擎尚未接動畫欄（static＝沒選，不吵）。 */
  const warnings = r.warnings.slice();
  if (r.pack.font != null && r.pack.font !== "font-001") warnings.push(`提案包選的字體家族「${r.pack.font}」目前不會套用到頁面（標題字型由字風決定）`);
  if (r.pack.motion != null && r.pack.motion !== "static") warnings.push(`提案包選的動畫「${r.pack.motion}」目前不會套用到頁面（動畫還沒接進 CMS）`);
  return {
    ok: true,
    warnings,
    pack: r.pack,
    change: {
      by: "pack",
      kvVariant: r.pack.layout,
      backgroundId: r.pack.background !== undefined ? r.pack.background : null, // 包未帶背景＝回版式預設（整組帶入語意）
      themeId: r.pack.theme !== undefined ? r.pack.theme : null,
      colors: (r.pack.colors && typeof r.pack.colors === "object") ? r.pack.colors : undefined, // 色彩草案（themeDraft）＝細粒度套色（theme 框架批 2026-08-25；缺＝不動）
      titleStyle: r.pack.titleStyle !== undefined ? r.pack.titleStyle : null, // 字風一等欄（2026-09-04）：整組帶入語意＝包沒帶＝清回版式原字
      subtitleFont: r.pack.subtitleFont !== undefined ? r.pack.subtitleFont : null, // 副標字體（2026-09-04 Q8 翻案）：同上整組語意
      /* 排版檔位（2026-09-04 Q6 甲）：包帶＝照帶；包沒帶＝回標準檔（整組帶入語意；applyCombo 的 null＝清欄） */
      heroTitleScale: (r.pack.typography && r.pack.typography.titleScale) || null,
      heroSubtitleScale: (r.pack.typography && r.pack.typography.subtitleScale) || null,
      heroTitleLeading: (r.pack.typography && r.pack.typography.titleLeading) || null,
      heroTitleTracking: (r.pack.typography && r.pack.typography.titleTracking) || null,
      heroSubtitleLeading: (r.pack.typography && r.pack.typography.subtitleLeading) || null,
      heroTitleWidth: (r.pack.typography && r.pack.typography.titleWidth) || null,
      titleFrame: r.pack.titleFrame === "off" ? "off" : null, // 主標兩側裝飾線（2026-09-04）：包沒帶／on＝清欄回板原樣
      titleStyleThemed: r.pack.titleStyleThemed ? true : null, // 字風妝容跟主題走（2026-09-05）：包沒帶＝清欄＝原妝
      titleGroupWarp: r.pack.titleGroupWarp ? true : null, // 同組文字一起變形（2026-09-05）：包沒帶＝清欄
      pageBg: null, // 整組帶入＝頁底手調歸零回自動（包的配色以包為準）
      heroQaStatus: r.pack.qaStatus === "candidate-pass" ? "candidate-pass" : "needs-review", // 非綠＝黃燈帶入（51 §2.7）
      proposalPack: r.pack,
      packWarnings: warnings,
      droppedTitleStyle: r.pack.titleStyle ? null : (r.pack.droppedTitleStyle || null), // 被審查制丟掉的字風（2026-09-07）：寫進「版面怎麼來的」橫幅＋面板黃燈；有帶到字風＝不可能同時「沒帶入」（2026-09-08 存檔包殘留欄防呆）
      reasonNote: `提案包 qaStatus=${r.pack.qaStatus || "（未帶）"}${warnings.length ? `；黃燈：${warnings.join("；")}` : ""}`,
    },
  };
}

module.exports = { activeSlotKeys, legacyHeroSeed, migrateHero, applyCombo, writeComboIntoDraft, packToChange, deepEq, poolOf, PRODUCT_SLOT_CAP, effectiveHeroSurface };
