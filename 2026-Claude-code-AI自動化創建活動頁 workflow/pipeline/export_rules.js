/**
 * 產 pipeline/rules.json —— 前端預檢規則單一來源（Stage A 驗收條件）
 * 用法：node export_rules.js
 *
 * 來源：
 *   1. gate.js 抽頂規則常數（module.exports.RULES）：優惠詞 regex 詞型、標籤字數/寬度語意、
 *      必填欄清單、枚舉表——機器閘 v2 的規則值，抽頂不改值（負向測試 17/17 parity＝v2 基線 17 規則驗證）；
 *      v3（2026-07-20 U1–U5 裁決）新增 entryChecks 五規則（CP-06 重複／CP-07 過期／CP-08 入口圖／
 *      CP-09 商品型入口／R2 混填排序），規則數 17 → 22；
 *      v4（2026-07-20 U8⑧）entrySourceMode（CP-10）＋R2 三層升級，22 → 23；
 *      v5（2026-07-20 U10–U15⑩–⑮）新增 moduleChecks 五規則（CP-06 跨模組擴充／CP-11 KV 圖源／
 *      CP-12 樓層 URL 唯一／CP-13 文案工程字串／CP-14 主題契合閘）＋enums.linkWhitelistForms
 *      （U15 brandIds 品牌篩選 URL 合法形態），23 → 28；
 *      v6（2026-07-20 U17⑰）entryChecks 新增 entryCount（CP-15 入口數量 3~4——<3 依 U8 遞補、
 *      遞補後仍不足＝FAIL 訊息載明遞補義務；恰 3 則＝3 則版型等比放大 INFO；欄位缺席＝略過），28 → 29；
 *      v7（2026-07-20 U18⑱）moduleChecks 新增 categoryWallCount（CP-16 品類牆數量 3~5——預設 3 組、
 *      Sheets 可選數量；宣告≠實有＝FAIL；標題撞名＝WARN dock 錨點；欄位缺席＝略過），29 → 30；
 *      v8（2026-07-20 U19⑲）選品單一來源制：R2 混填排序移除、entryChecks 改設 typeHomogeneity
 *      （CP-17 型別混用＝FAIL＋promoModuleTitle 標題同型 FAIL）＋entrySourceMode auto 語意修訂
 *      （取可滿足 ≥3 則的最高優先層；auto 下全商品型且在線契合活動 ≥3＝WARN），30 → 32；
 *      v15（2026-08-24 51 號 W1-E＝CP 登記表 v1.8 配號）新增 heroLayoutChecks 三規則（CP-25 版式值域／
 *      CP-26 佔位殘留／CP-27 素材授權＋灰度門票＋動畫欄），46 → 51；版式/背景/動畫貨號值域＝runtime
 *      讀登記簿（loadRegistries），不鏡像進本檔（R5 防範）——前端預檢值域走 server 端登記簿讀取。
 *   2. 03_GoogleSheets_Schema_v1.md §8.1 mobile 字元上限建議表（v1.2 提案；FrameTest mobile 375 實測）。
 *
 * 鐵律：前端預檢一律載 rules.json，禁止另寫規則；regex 以字串保存，前端 new RegExp(pattern, flags) 還原。
 * 注意：rules.json 是產物——改規則改 gate.js 常數或 03 §8.1 表，再重跑本檔；勿手改 rules.json。
 */
const fs = require("fs");
const path = require("path");
const { RULES } = require("./gate.js");
const { WALL_PRODUCT_COUNT_ENUM, PROMO_CARDS_MAX, INFO_ROWS_BY_VARIANT, INFO_ROW_FIELDS_BY_VARIANT, INFO_REWARD_IMGS_BY_VARIANT, ROW_FIELD_LABELS, PROMO_VARIANT_FIELDS, PROMO_FIELD_LABELS } = require("./lib/content_modules.js"); // 促銷卡張數上限（2026-09-09 使用者裁 4→20）：CMS 面板讀 rules.json、不另寫死

/* 03 §8.1 mobile 字元上限建議表（依 FrameTest mobile 375 實測；KV 左欄 123px、
 * Q3b 裁決後 fit 係數 1.0、Mochiy 全形；數字約佔 0.6 全形寬） */
const MOBILE_CHAR_LIMITS = {
  kvTitleLineNoBadge: {
    field: "KV titleLine（無起徽行）", maxFullwidthChars: 5,
    overflow: "不截斷、字級遞減：5字=23px、6字=19px⚠、7字=16px、8字=14px（<20px 記 warning 不硬夾）",
  },
  kvTitleLineWithBadge: {
    field: "KV titleLine（帶起徽行）", maxFullwidthChars: 4,
    overflow: "4字=22px、5字=17px⚠、6字=14px（兩行統一字級＝取小者）",
  },
  kvEyebrow: {
    field: "KV 眉標 eyebrowLatin＋Cn 合計", maxFullwidthChars: 8, approx: true,
    overflow: "超出尾端 ellipsis（Q1b 裁決＝以縮短文案為正解）", note: "12px 不折行、103px 內",
  },
  productOfferTag: {
    field: "商品卡 offer 標籤", maxFullwidthChars: 9,
    overflow: "超出尾端 ellipsis", note: "mobile 14px 單行；寬度語意 v5",
  },
  stickerThemeLine: {
    field: "貼紙堆疊主題句", maxFullwidthChars: 9, maxLines: 2,
    overflow: "超出 clamp 截斷", note: "14px 最多兩行 clamp（每行 ≈9 全形）",
  },
  /* 活動資訊卡搶購鈕文字（2026-09-09 使用者需求＝開放自填、CMS 依三裝置寬度提醒字數；不硬擋）
     算法＝卡內寬（桌 536／板 362／機 311）− 贈品圖（大圖 188／133／107.5；小圖 120／85／68.6）− 兩個 16 間距 − 鈕框 40px（padding 18×2＋border 2×2）
     − 鈕字 n×字級（桌 16／板 14／機 12）≥ 留給滿額字至少 ~110px（板・機）／150px（桌）→ 最緊的是「滿額贈雙列」平板＝3 字；「好禮列搶購」＝6 字。
     鍵名＝mechanicCtaText_<版面 id>，CMS 面板依目前版面查表；沒按鈕的版面不查。 */
  "mechanicCtaText_info-gift-rows": {
    field: "活動資訊卡 搶購鈕文字（滿額贈雙列）", maxFullwidthChars: 3,
    overflow: "鈕變寬會擠壓左邊的滿額字（平板 410／手機 343 卡寬先出事）", note: "預設「搶購去」＝3 字剛好",
  },
  "mechanicCtaText_info-gift-rush": {
    field: "活動資訊卡 搶購鈕文字（好禮列搶購）", maxFullwidthChars: 6,
    overflow: "同上；贈品小圖較窄故可到 6 字", note: "同上算法",
  },
};

const rules = {
  version: "1.12.0",  // 2026-09-09 本期活動「排版→欄位」對應表進 rules.json（舞台專屬文字／圓形專屬檔期／舞台只放 3 則）；前 1.11.0＝同日活動資訊卡「版面→欄位」對應表進 rules.json（CMS 只顯示對應欄位、換版面清不重疊資料）；前 1.10.0＝2026-09-09 促銷卡上限 4→20（使用者裁；新增 contentModules.promoCardsMax＝lib PROMO_CARDS_MAX 單一來源、CMS 面板改讀此值）；前 1.9.0＝2026-08-27 模組批：CP-16 品類牆數量 3~5→1~3（使用者裁決＝刪牆開放下限 1、上限對齊引擎 3 版位；CP 登記表 v1.11）；前 1.8.0＝2026-08-26 v16：CP-15 promoEntries 入口數量上限 4→12（使用者裁決；下限 3 不變、恰 3 等比放大語意保留；>3 全裝置滑動列＝渲染端另批）；前 1.7.0＝2026-08-24 v15（51 號 W1-E）：heroLayoutChecks 三規則（CP-25/26/27）＋enums 增 motionFlag/bgReviewPass＋requiredFields 增 kvVariant/backgroundId/motionFlag 三欄；前 1.6.0＝2026-07-23 v13 本期活動人工手動入稿通道（promoSourceMode+manual、entrySource=manual 豁免語意）＋商品型入口 gdid 兩式修
  generatedAt: new Date().toISOString(),
  sources: {
    gateRules: "pipeline/gate.js（機器閘 v2 抽頂常數 N-16；v3 entryChecks＝U1–U5、v4 CP-10＝U8、v5 moduleChecks＝U10–U15、v6 entryCount＝U17⑰（CP-15 入口數量 3~4）、v7 categoryWallCount＝U18⑱（CP-16 品類牆數量 3~5）、v8 typeHomogeneity＝U19⑲（CP-17 選品單一來源制取代 R2）——皆 2026-07-20 裁決，規則數 17 → 32；v9（2026-07-21 落地 07-20 裁決㉒㉓㉗㉘）＝CP-18 全頁互斥＋CP-20 主從一致＋CP-21 牆件數 4 倍數＋CP-22 看更多，規則數 32 → 40、enums 增 wallProductCount/moreLinkToggle；v10（2026-07-22 裁決）＝tagSource 增 manual＝標籤 v6；v11（2026-07-23 收斂會裁決 23-1）＝CP-18 同樓層 scene×卡互斥，規則數 40 → 41；v12（2026-07-23 ②③定案）＝explore/editorial 檢查補課，規則數 41 → 45；v13（2026-07-23 四題裁決）＝本期活動 manual 通道（promoSourceMode+manual/entrySource 豁免與降級語意）＋商品型入口 gdid 兩式修，規則數 45 → 46；v15（2026-08-24 51 號 W1-E 裁決批）＝heroLayoutChecks 三閘＝CP-25 版式值域＋CP-26 佔位殘留＋CP-27 素材授權（含灰度門票／動畫欄），規則數 46 → 51；v15.1（2026-08-25 使用者實測批）＝CP-25 增引擎完工閘：kvVariant=layout-* 而真樣式未完工（不在 lib/layout_choice ENGINE_SUPPORTED 完工名單）＝FAIL 擋出貨，完工一款解鎖一款；v15.2（2026-08-25 CO-20260825-01）＝CP-28 主視覺真值連動：kv.cornerProducts 逐筆 gdid 必填（名稱/網址主檔帶出杜絕漂移），51 → 52；v16（2026-08-26 使用者裁決）＝CP-15 入口數量上限 4→12（規則數不變、規則值改：下限 3 不變、恰 3 等比放大語意保留；>3 全裝置左右滑動列＝渲染端互動另批；CP 登記表 v1.10＋14 號 §2.4 升版註記）",
    charLimitsMobile: "03_GoogleSheets_Schema_v1.md §8.1 mobile 字元上限建議表（v1.2 提案，2026-07-19）",
  },
  charLimits: {
    widthModel: RULES.widthModel,
    pxBudgets: RULES.pxBudgets,
    mobile: MOBILE_CHAR_LIMITS,
    curationDuty: "策展初稿 mobile 文案一律依 mobile 表預檢，超限者 AI 先行潤飾——保留原意、不添油加醋（04 §6.4）",
  },
  promoWordPatterns: RULES.promoWordPatterns,
  entryChecks: RULES.entryChecks, // 2026-07-20 U1/U2/U3/U5 裁決：promoEntries 模組規則（＋U8 CP-10＋U17⑰ CP-15＋U19⑲ CP-17 單一來源制）
  moduleChecks: RULES.moduleChecks, // 2026-07-20 U10–U15 裁決：跨模組去重/KV 圖源/樓層 URL/文案工程字串/主題契合閘（＋U18⑱ CP-16 品類牆數量 3~5）
  heroLayoutChecks: RULES.heroLayoutChecks, // 2026-08-24 51 號 W1-E：CP-25 版式值域／CP-26 佔位殘留／CP-27 素材授權＋灰度門票（值域＝登記簿 runtime 讀，本檔只載規則語意與佔位正則）
  requiredFields: RULES.requiredFields,
  enums: RULES.enums,
  contentModules: { wallProductCountEnum: WALL_PRODUCT_COUNT_ENUM, promoCardsMax: PROMO_CARDS_MAX, mechanicRows: INFO_ROWS_BY_VARIANT, mechanicRowFields: INFO_ROW_FIELDS_BY_VARIANT, mechanicRewardImgs: INFO_REWARD_IMGS_BY_VARIANT, mechanicRowFieldLabels: ROW_FIELD_LABELS, promoVariantFields: PROMO_VARIANT_FIELDS, promoFieldLabels: PROMO_FIELD_LABELS, rowFieldsNote: "活動資訊卡各版面會畫的列欄位＝lib INFO_ROW_FIELDS_BY_VARIANT（2026-09-09 使用者裁：CMS 只顯示對應欄位、換版面清不重疊資料並先確認）", note: "促銷卡張數上限＝pipeline lib/content_modules.js PROMO_CARDS_MAX（2026-09-09 使用者裁 4→20）；CMS 面板 promoCardsMax() 讀這裡、引擎 CMPC_MAX 鏡像由 test/unit/promo_cards_max.test.js 對帳" },
};

const outPath = path.join(__dirname, "rules.json");
fs.writeFileSync(outPath, JSON.stringify(rules, null, 2) + "\n");
const n = (o) => Object.keys(o).length;
console.log(`rules.json 已產出 → ${outPath}`);
console.log(`  charLimits: widthModel + pxBudgets ${n(rules.charLimits.pxBudgets)} 項 + mobile ${n(rules.charLimits.mobile)} 項`);
console.log(`  promoWordPatterns: ${rules.promoWordPatterns.length} 式`);
console.log(`  entryChecks: ${n(rules.entryChecks)} 規則（2026-07-20 U1–U8＋U17＋U19 裁決）`);
console.log(`  moduleChecks: ${n(rules.moduleChecks)} 規則（2026-07-20 U10–U15＋U18 裁決）`);
console.log(`  heroLayoutChecks: ${n(rules.heroLayoutChecks)} 規則（2026-08-24 51 號 W1-E＝CP-25/26/27）`);
console.log(`  requiredFields: ${rules.requiredFields.length} 欄`);
console.log(`  enums: ${n(rules.enums)} 表`);
