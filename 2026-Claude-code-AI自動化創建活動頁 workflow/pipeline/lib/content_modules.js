"use strict";
/**
 * lib/content_modules.js —— 編修頁「頁面組成」面板的伺服器端邏輯（W2 內文模組第一批，2026-08-25）
 * story＝docs/stories/content-modules-wave2.md（M1 值域／M4 寫入紀律／M5 機器閘）
 * W2 第二批（2026-08-26）：①模組順序 page.composeOrder＋move 動作（M11；★S11 2026-08-27 升版＝釘位制：
 * kv 恆首＋explore 恆末、中段七鍵自由——舊「固定鍵相對序」制退役；等於預設序＝刪鍵，舊 draft 零波及）②本期活動/編輯精選開放移除
 * （2026-08-25 使用者追加）——只開 remove、一律 delete 鍵（gate CP-15 對鍵缺席＝略過、對 []＝FAIL）。
 * W2.5 換皮批（2026-08-26 使用者方案 A 四題裁決）：本期活動排版樣式 page.promoVariant——promo 新開
 * set-variant 動作（add/set 照舊擋）；值域 runtime 讀 modules.json promo variants（buildSelectable 過濾）；
 * 預設 entry-circles＝刪鍵（缺席即預設＝舊 draft 零波及，沿 composeOrder 慣例）；同內容換皮＝
 * promoEntries 零改動、隨時換回（換皮＝核可失效重檢由 server 端點沿既有 invalidateApproval）。
 * banner 輪播批（2026-08-26 使用者實測回報）：資訊卡活動 banner 升級 imgs[]（1~3 張輪播；1 張＝不輪播）——
 * img 舊欄保留讀取相容（讀取端優先 imgs、退 img）、面板寫入一律走 imgs；驗證＝陣列＋至多 3＋每格字串
 * （URL 寬嚴度沿 banner.img 既例＝不做網域檢）；完稿圖（圖含字）＝標題文案可留空、情境圖＋文案＝渲染端疊字（渲染端主線做）。
 * 主打選品貼稿批（2026-08-26 使用者需求；14 §2.14 配套規則 8 登錄待審）：三個選品位（大卡／右欄 ×2）
 * 除下拉外開放貼商品網址或賣場編號帶入新商品——`pick` 動作。真值鏈＝伺服器實抓（server 端 productFetch：
 * fetch_parse fetchPage＋price_qa classifyProductLiveness 三態、非 online 白話拒收）→ 本函式只收實抓結果
 * （change.product）＝lib 不碰網路、不代填任何真值；dedupe by gdid（已在活動裡＝直接引用不重複加）、
 * 新品追加 products[] 標 position: "spotlight-pick"（追溯）。同一寫入口＝draft-writers.allow「content-modules-apply」行。
 * 促銷卡多卡批（2026-08-26 使用者下午需求；14 §2.14 §2.14-promoCards 登錄待審）：page.promoCard 單物件 →
 * page.promoCards[]（1~20 張，2026-09-09 上限 4→20；「每型至多一實例」對促銷卡翻案）——lib 讀寫一律新形、讀到舊形單物件＝視為一張
 * （相容）、任何促銷卡寫入動作先就地升級成陣列；add＝加一張卡（滿 4 擋）、remove 帶 index＝移除單卡
 * （移到 0 張＝刪鍵，沿 delete 鍵制）、pick 擴 kind=promoCard（slot=card-1~card-4、position "promo-card-pick"）。
 * 渲染排列真源＝docs/design-qa/content-modules-wave2-spec/promo-card-module-layout.json（桌機/平板一列兩張、手機直排）。
 * 牆/樓層加商品批（2026-08-26 同批）：pick 再擴 kind=wall|floor（index 指第幾面牆/第幾層；walls/floors 僅開 pick、
 * 結構動作不開）——沿編輯精選人工加入慣例：全頁互斥（每件商品整頁只放一次＝CP-18 語意，server 端另以
 * pageGdids/池過濾把關）＋新品入 products[] 標 position category-N/featured-N（★大體檢 CT-3 修：牆原誤寫 wall-N）＋件數上限（樓層 15＝2026-08-26 裁決 3/7/11/15 節奏；
 * 牆 12＝CP-21 值域上限）；件數提醒照各模組真規則（牆＝4 的倍數、樓層＝3/7/11/15 勿套四倍數）。
 *
 * 職責（全部走登記簿真源、失敗一律 throw 出聲＝鐵律 3）：
 *  1. 值域：三種內文模組（活動資訊卡 mechanic／主打選品 spotlight／促銷卡 promoCard）的版式白名單
 *     runtime 讀 modules.json（CP-25 讀簿模式）——mechanic variants（buildSelectable:true 者）＋
 *     featured variants（spotlight／promo-card 登錄在案才可加入）。
 *  2. 結構變更單一寫入口：加入（每型至多一實例＝2026-08-25 使用者裁決 v1）／移除／換版式（資訊卡四版式、
 *     列數隨版式定值：滿額贈雙列＝2、其餘＝3）。內容欄編修＝走既有 draft 儲存（PUT draft.json），
 *     兩路共用同一套 validateContentModules（值域檢＝M5 機器閘、非法 400）。
 *  3. 掛點＝獨立 page 節點（page.mechanic／page.spotlight／page.promoCard）——floors[] 為渲染端按索引
 *     消費（FrameTest featuredDealSections 位置映射），休眠樓層條目會被當 classic 樓層渲染＝破預覽；
 *     正式掛點（是否併回 floors[].variant）＝14 號 §2.14 登錄待審、第二批渲染批裁定。
 *
 * 真值鐵律：滿額/金額/贈品名/URL＝真值欄（AI 禁代填；第一批＝人工照抄制，沿 14 §2.13 真值槽人工填寫制）；
 * 本檔只做結構與值域，絕不代填任何真值內容。
 * 寫入紀律（R4）：writeContentModuleIntoDraft 為編修期寫入點——server 端點寫後必呼叫 invalidateApproval，
 * 登錄＝scripts/draft-writers.allow（content-modules-apply 行）。
 */
const fs = require("fs");
const { readJson, DEFAULT_PATHS } = require("./proposal_pack");
/* 情境卡代表品的 URL→貨號解析：借用既有那支，不自己再抄一份正則
   （p 型編號 2026-08-28 已在該檔處理過，抄一份就會在下次規格變動時靜默過期）。 */
const { gdidOf } = require("../workbench/product_fetch.js");

/** 模組身分表（display 名＝設計師語言）。三內文模組＝add/remove/set/move 全開；
 *  promo/editorial（W2 第二批）＝removeOnly——內容編修各有原生面板與生成流程，從這裡 add/set
 *  等於繞過那些驗證，故擋；remove＝delete 鍵（絕不可寫空陣列——gate CP-15 對 []＝FAIL、對鍵缺席＝略過）。
 *  promo 另開 set-variant（W2.5 換皮批）＝只換排版樣式 page.promoVariant、不碰內容（removeOnly 的 add/set 擋照舊）。 */
const CONTENT_MODULES = {
  mechanic: { node: "mechanic", name: "活動資訊卡", moduleId: "mechanic" },
  spotlight: { node: "spotlight", name: "主打選品", moduleId: "featured", variantId: "spotlight" },
  /* 促銷卡多卡批（2026-08-26）：掛點升級 promoCards[]（1~4）；legacyNode＝舊形單物件（讀取相容、寫入升級） */
  promoCard: { node: "promoCards", legacyNode: "promoCard", name: "促銷卡", moduleId: "featured", variantId: "promo-card" },
  promo: { node: "promoEntries", name: "本期活動", removeOnly: true },
  editorial: { node: "editorial", name: "編輯精選", removeOnly: true },
  /* 牆/樓層個體戶（2026-08-26 加商品批只開 pick；2026-08-27 模組批升格＝pick＋add/remove/move 帶 index 的單層單牆操作）：
     面數值域＝牆 1~3（使用者裁決、CP-16 同步升版）／樓層 0~3（引擎版位上限、無下限閘）；indexed＝陣列型模組記號 */
  wall: { node: "walls", name: "品類牆", indexed: true, posPrefix: "category", minCount: 1, maxCount: 3 },
  floor: { node: "floors", name: "主打樓層", indexed: true, posPrefix: "featured", minCount: 0, maxCount: 3 },
  /* 群組鍵（composeOrder 專用、2026-08-27 模組批）：樓層／牆「整組」上下移——node 同個體戶、只收 move */
  featured: { node: "floors", name: "主打樓層", groupMoveOnly: true },
  walls: { node: "walls", name: "品類牆", groupMoveOnly: true },
};

/* ---------- 模組順序（W2 第二批 M11；2026-08-27 模組全開放排序刪除批升版；14 §2.14 配套規則 6 登錄待審） ---------- */
/** 頁面組成完整序＝9 鍵排列；draft 缺 page.composeOrder＝這條預設序（舊 draft 零波及）。 */
const COMPOSE_ORDER_DEFAULT = ["kv", "mechanic", "promo", "spotlight", "promoCard", "featured", "editorial", "walls", "explore"];
/** 釘位不變式（2026-08-27 使用者裁決）：主視覺恆首、延伸探索恆末（頁尾不在 composeOrder＝天然固定）；
 *  中段七鍵全自由——原「六固定鍵相對序不可變」制（COMPOSE_FIXED_SEQ）退役，歷史見 14 §2.14 規則 6 升版紀錄。 */
const COMPOSE_PIN = { first: "kv", last: "explore" };
const COMPOSE_MOVABLE = new Set(["mechanic", "spotlight", "promoCard", "promo", "featured", "editorial", "walls"]);
/** 寫回順序：等於預設序＝刪鍵——缺席即預設，避免冗餘複本（也讓「下移→上移」復原後 page 逐字等於原稿）。
 *  分隔符 2026-08-27 改「|」：原 NUL 位元組令整檔被 grep 判二進位（工具盲區）；鍵名皆識別字無「|」＝語意等價。 */
function writeComposeOrder(page, order) {
  if (order.join("|") === COMPOSE_ORDER_DEFAULT.join("|")) delete page.composeOrder;
  else page.composeOrder = order;
}
/** 讀入正規化（相容遷移 2026-08-27）：舊制「固定鍵子序列」允許三內文模組合法排在 explore 之後——新制 explore 恆末。
 *  在場且為合法 9 鍵排列＋kv 首者，把落在 explore 後的鍵原序前移到 explore 前（等於預設＝刪鍵）＝下次儲存即轉正、不擋人；
 *  其他非法形不動＝交給 validateContentModules 出聲。 */
function normalizeComposeOrder(page) {
  const co = page && page.composeOrder;
  if (!Array.isArray(co) || co.length !== COMPOSE_ORDER_DEFAULT.length) return;
  if (co[0] !== COMPOSE_PIN.first) return;
  if (co.map(String).slice().sort().join("|") !== COMPOSE_ORDER_DEFAULT.slice().sort().join("|")) return;
  if (co[co.length - 1] === COMPOSE_PIN.last) return;
  writeComposeOrder(page, [...co.filter((k) => k !== COMPOSE_PIN.last), COMPOSE_PIN.last]);
}

/** 資訊卡各版式的列數定值（規格真源＝勘查藍圖四版式差異表：3/2/3/3；未知新版式＝保守 3） */
const INFO_ROWS_BY_VARIANT = { "info-offer-rows": 3, "info-gift-rows": 2, "info-gift-gallery": 3, "info-gift-rush": 3 };
const rowsCountFor = (variant) => INFO_ROWS_BY_VARIANT[variant] || 3;
/** 各版面實際會畫出來的列欄位（真源對照＝引擎 FrameTest renderCmMechanic 的四個列模板；絆線＝test/unit/mechanic_row_fields.test.js 對引擎源檔逐款對帳）。
 *  2026-09-09 使用者裁（翻 2026-08-30「不藏欄位＋列暫存」制）：CMS 只顯示目前版面會畫的欄位；換版面＝新版面用不到的欄位資料清掉、多出的列刪掉，
 *  CMS 換之前先列出會清掉什麼請使用者確認（每次變更前仍有 draft.vN 自動備份）。rewardImgs 各版面張數＝INFO_REWARD_IMGS_BY_VARIANT。 */
/* 2026-09-26 使用者裁「甲」：優惠卡三列／好禮圖列每一列也要有活動入口——沿用既有 ctaUrl 欄、不新開欄；
   這兩款沒有搶購鈕（沒有 ctaText），有連結時引擎把整列包成一個入口（左右兩欄同一檔活動、整列可點），
   追蹤標記沿有鈕那兩款同一套（四款擇一、欄位骨幹相同＝數據分析師已納入）。 */
const INFO_ROW_FIELDS_BY_VARIANT = {
  "info-offer-rows":   ["label", "brandName", "offerText", "thresholdText", "rewardText", "ctaUrl"],
  "info-gift-rows":    ["label", "thresholdText", "rewardText", "rewardImgs", "ctaText", "ctaUrl"],
  "info-gift-gallery": ["label", "thresholdText", "rewardText", "rewardImgs", "ctaUrl"],
  "info-gift-rush":    ["label", "thresholdText", "rewardText", "rewardImgs", "ctaText", "ctaUrl"],
};
const INFO_REWARD_IMGS_BY_VARIANT = { "info-offer-rows": 0, "info-gift-rows": 1, "info-gift-gallery": 2, "info-gift-rush": 1 };
const rowFieldsFor = (variant) => INFO_ROW_FIELDS_BY_VARIANT[variant] || ["label", "brandName", "offerText", "thresholdText", "rewardText", "rewardImgs", "ctaText", "ctaUrl"];
const rewardImgsCapFor = (variant) => (variant in INFO_REWARD_IMGS_BY_VARIANT ? INFO_REWARD_IMGS_BY_VARIANT[variant] : 2);
const ROW_FIELD_LABELS = { label: "列標籤", brandName: "店家名", offerText: "活動文案", thresholdText: "滿額門檻", rewardText: "折抵或贈品", rewardImgs: "贈品圖", ctaText: "搶購鈕文字", ctaUrl: "搶購連結" };

/** 本期活動排版樣式預設值（W2.5 換皮批）：等於預設＝刪鍵、缺席即預設（舊 draft 零波及，沿 composeOrder 慣例） */
const PROMO_VARIANT_DEFAULT = "entry-circles";
/** 本期活動兩款排版各自畫的欄位（真源對照＝引擎 renderPromoEntries／labelStack；絆線＝test/unit/promo_variant_fields.test.js 解析引擎源檔對帳）。
 *  2026-09-09 使用者裁（翻 08-30「永遠顯示、不藏欄位」）：CMS 只顯示目前排版會畫的欄位；換排版＝不重疊的清掉——舞台專屬文字（副標／斜帶字）、
 *  圓形專屬的檔期、舞台放不下的第 4 則起入口——換之前先列出請使用者確認（draft.vN 自動備份可還原）。 */
const PROMO_VARIANT_FIELDS = {
  "entry-circles":   { page: ["promoModuleTitle", "dockPromoLabel"], entry: ["img", "chip", "copy", "dateValue", "url"], maxEntries: null },
  "spotlight-stage": { page: ["promoModuleTitle", "dockPromoLabel", "promoSpotSubtitle", "promoSpotDiagonal"], entry: ["img", "chip", "copy", "url"], maxEntries: 3 },
};
const promoVariantFieldsFor = (v) => PROMO_VARIANT_FIELDS[v] || PROMO_VARIANT_FIELDS[PROMO_VARIANT_DEFAULT];
const PROMO_FIELD_LABELS = { promoSpotSubtitle: "右欄副標", promoSpotDiagonal: "大卡斜帶字", dateValue: "檔期", chip: "標籤", copy: "文案", img: "圖", url: "連結" };

/* ---------- 主打選品貼稿選品（2026-08-26；14 §2.14 配套規則 8 登錄待審） ---------- */
/** 三個選品位（機讀鍵 → 設計師語言顯示名）；position 標記＝追溯用（gate CP-18 曝光計算不掃 products[] 列＝安全） */
const SPOTLIGHT_PICK_SLOTS = { hero: "大卡主打", ref1: "右欄第 1 件", ref2: "右欄第 2 件" };
const SPOTLIGHT_PICK_POSITION = "spotlight-pick";

/* ---------- 促銷卡多卡＋牆/樓層加商品（2026-08-26 下午批；14 §2.14 登錄待審） ---------- */
/* 品類牆件數鐵律（U27㉗ 2026-07-20 裁決）＝桌機一行四品：4＝一行、8＝兩行、12＝三行，不留孤兒卡。
   2026-09-24 從 gate.js 搬來當單一真源——原本只有機器閘認得它，CMS 介面不知道，
   導致「加入」不設限、業務可以加到第 13 件卻沒有任何地方能減回去（品類牆刻意不開放移除＝受版型件數契約管）。
   現在 gate.js 與 CMS 介面都讀這一份；export_rules.js 會把它帶進 rules.json 給前端。 */
const WALL_PRODUCT_COUNT_ENUM = [4, 8, 12];
const PROMO_CARDS_MAX = 20;                    // 促銷卡 1~20 張（2026-09-09 使用者裁上限 4→20；渲染排列＝promo-card-module-layout.json：桌機/平板一列兩張、手機直排）——單一來源：server pick 槽位、rules.json→CMS 面板、引擎 CMPC_MAX 鏡像（絆線 test/unit/promo_cards_max.test.js）
const PROMO_CARD_PICK_SLOT_RE = new RegExp(`^card-(${Array.from({ length: PROMO_CARDS_MAX }, (_, i) => i + 1).join("|")})$`); // pick 槽位＝card-1~card-N（第幾張卡；N 跟著上限走）
const PROMO_CARD_PICK_POSITION = "promo-card-pick"; // 沿 spotlight-pick 命名慣例（追溯）
/** pick 動作值域（server 端點共用）：source＝快照池 upsert 稽核標；exclusive＝全頁互斥模組（productFetch 帶
 *  pageGdids 擋「整頁只能放一次」＋開放 auto AI 補一件——沿編輯精選人工加入慣例）；spotlight/promoCard＝
 *  引用式選品位（允許引用已在活動裡的商品，下拉本來就能選它）＝不互斥、無 auto。 */
const PICK_KINDS = {
  spotlight: { name: "主打選品", source: "R3:spotlight-pick", exclusive: false },
  promoCard: { name: "促銷卡", source: "R3:promo-card-pick", exclusive: false },
  wall: { name: "品類牆", source: "R3:wall-pick", exclusive: true },
  floor: { name: "主打樓層", source: "R3:floor-pick", exclusive: true },
};
/** 牆/樓層件數上限（加入時擋；下限與整齊度＝提醒文案不硬擋）：樓層 15＝2026-08-26 使用者裁決
 *  「第一排情境卡＋3 件、之後每排 4 件」＝3/7/11/15 值域、上限先約定 15（一排 4 的節奏；渲染端同批已承載）；牆 12＝CP-21 {4,8,12} 上限 */
const MODULE_PICK_CAPS = { wall: 12, floor: 15 };

/** 舊形升級（寫入路徑用）：page.promoCard 單物件＝視為一張卡、就地升級成 promoCards[]（雙鍵不並存＝防雙真相）。
 *  只在促銷卡寫入動作前呼叫——零變更（changed:false）不落盤，舊 draft 讀取零波及。 */
function normalizePromoCards(page) {
  if (!Array.isArray(page.promoCards) && page.promoCard && typeof page.promoCard === "object" && !Array.isArray(page.promoCard)) {
    page.promoCards = [page.promoCard];
    delete page.promoCard;
  }
  return page.promoCards;
}
/** 商品被頁面哪個曝光位用走了（CP-18 全頁互斥的 lib 端結構檢；圓卡/探索卡＝url 型、由 server 端 pageGdids 把關） */
function gdidUsedOnPage(page, products, gdid) {
  const s = String(gdid);
  if ((((page || {}).kv || {}).keyProductGdids || []).map(String).includes(s)) return "主視覺";
  /* 新版主視覺槽（page.hero[*].gdids，2026-09-26 修）：原本只認舊 KV 欄 ⇒ 加商品／換商品的排除清單漏掉主視覺槽裡的商品（run 150126：同一件同時在主視覺右槽與樓層情境卡）。 */
  if (Object.values(((page || {}).hero) || {}).some((sv) => sv && Array.isArray(sv.gdids) && sv.gdids.map(String).includes(s))) return "主視覺";
  const fi = ((page || {}).floors || []).findIndex((f) => ((f && f.productGdids) || []).map(String).includes(s));
  if (fi >= 0) return `主打樓層 ${fi + 1}`;
  /* 情境卡代表品也算「用過」（2026-09-24 修）：契約是「代表品不入卡列」（見 vendor_sheet.js 檔頭），
     但本函式原本只掃 productGdids，漏掉 floors[].sceneUrl ⇒ 加一件商品時不會發現它已經是那層的代表品，
     加下去就成立 CP-18「scene 卡代表品與商品卡同商品」。病例＝run 2026-09-24-wb-174314：13 個版本快照
     顯示代表品與卡列反覆對上、「重做後穩定出現」，而樓層當時又不給刪＝使用者撞上就出不來。 */
  const si = ((page || {}).floors || []).findIndex((f) => f && f.sceneUrl && String(gdidOf(String(f.sceneUrl)) || "") === s);
  if (si >= 0) return `主打樓層 ${si + 1} 的情境卡`;
  const wi = ((page || {}).walls || []).findIndex((w) => ((w && w.productGdids) || []).map(String).includes(s));
  if (wi >= 0) return `品類牆 ${wi + 1}`;
  if ((products || []).some((x) => x && String(x.gdid) === s && x.position === "editorial-wall")) return "編輯精選";
  if (((page || {}).promoEntries || []).some((e) => e && String(e.gdid || "") === s)) return "本期活動";
  return null;
}

/** 讀值域真源（modules.json）。讀不到／登錄缺席＝throw（不靜默降級）。 */
function loadContentRegistry(overridePaths = {}) {
  const P = { ...DEFAULT_PATHS, ...overridePaths };
  const modules = readJson(P.modules);
  const find = (mid) => (modules.modules || []).find((m) => m.module_id === mid);
  const mech = find("mechanic");
  const feat = find("featured");
  const promoM = find("promo");
  if (!mech || !feat || !promoM) throw new Error("modules.json 找不到 mechanic／featured／promo 模組——內文模組值域真源缺席");
  const selectable = (m) => ((m && m.variants) || []).filter((v) => v && v.buildSelectable === true);
  const mechanicVariants = selectable(mech).map((v) => ({ id: v.variant_id, meaning: v.meaning || v.variant_id }));
  const featuredIds = new Set(selectable(feat).map((v) => v.variant_id));
  const promoVariants = selectable(promoM).map((v) => ({ id: v.variant_id, meaning: v.meaning || v.variant_id }));
  return {
    mechanicVariants,
    mechanicVariantIds: new Set(mechanicVariants.map((v) => v.id)),
    featuredSelectable: featuredIds, // spotlight／promo-card 登錄在案才可加入
    promoVariants, // 本期活動排版樣式（W2.5 換皮批）：buildSelectable:true 者——好禮款未登錄＝天然排除
    promoVariantIds: new Set(promoVariants.map((v) => v.id)),
  };
}

/* ---------- 節點預設形（欄形＝14 §2.14；全空欄＝等使用者填，AI 不代填） ---------- */
function emptyInfoRow() {
  return { label: "", brandName: "", offerText: "", thresholdText: "", rewardText: "", rewardImgs: [], ctaText: "", ctaUrl: "" }; // ctaText（2026-09-09 使用者需求）＝搶購鈕自填文字，空＝引擎預設「搶購去」；字數建議走 rules.json charLimits.mobile（CMS 寬度尺提醒、不硬擋）
}
function defaultNodeFor(kind, variant) {
  if (kind === "mechanic") {
    const v = variant || "info-offer-rows";
    return {
      variant: v,
      /* banner 輪播升級（2026-08-26 使用者需求；14 §2.14 登錄待審）：imgs＝1~3 張輪播（1 張＝不輪播）。
         img 舊欄保留＝讀取端相容（讀取端優先 imgs、退 img）；寫入端面板一律走 imgs。 */
      banner: { img: "", imgs: ["", "", ""], urls: ["", "", ""], badgeText: "", titleLine1: "", titleLine2: "", url: "" }, // urls（2026-09-09 使用者需求）＝一圖一連結、與 imgs 一對一；沒填的格退共用 url
      rows: Array.from({ length: rowsCountFor(v) }, emptyInfoRow),
    };
  }
  if (kind === "spotlight") {
    return { badgeText: "", title: "", subtitle: "", heroCard: { capsuleText: "", diagonalText: "", offerLine: "", gdid: "" }, productRefs: [] };
  }
  if (kind === "promoCard") {
    return [emptyPromoCard()]; // 多卡制（2026-08-26）：節點形＝陣列（首次加入＝一張空卡）
  }
  throw new Error(`未知的區塊種類（技術：kind=${kind} 不在 mechanic|spotlight|promoCard）`);
}
/** 促銷卡單卡空形（欄形＝14 §2.14；「＋ 新增一張卡片」與首次加入共用） */
function emptyPromoCard() {
  return { capsuleText: "", diagonalText: "", offerLine: "", priceNote: "", gdid: "" };
}

/* ---------- 驗證器（M5 機器閘）：content-modules 端點與 PUT draft.json 共用；非法＝throw（呼叫端 400 白話） ---------- */
const YAHOO_URL_RE = /^https:\/\/tw\.(buy|promo)\.yahoo\.com\//; // 2026-10-05 使用者裁：促銷活動站 tw.promo.yahoo.com 納入（與 gate LINK_DOMAIN_RE 同一條裁決）
function checkUrlField(v, where) {
  const s = String(v == null ? "" : v).trim();
  if (s && !YAHOO_URL_RE.test(s)) {
    throw new Error(`${where}要是 Yahoo購物中心（https://tw.buy.yahoo.com）或促銷活動站（https://tw.promo.yahoo.com）的網址，或先留空。（技術：URL 網域白名單）`);
  }
}
function checkGdidField(v, products, where) {
  const s = String(v == null ? "" : v).trim();
  if (!s) return;
  const hit = (products || []).some((p) => p && String(p.gdid) === s);
  if (!hit) throw new Error(`${where}選的商品不在這檔活動的商品清單裡——請重新選一件。（技術：gdid ${s} 不在 products[]＝防懸空引用）`);
}
/**
 * 驗三節點（在場才驗；page 缺節點＝合法）。
 * @param {object} page draft.page
 * @param {object} reg loadContentRegistry() 產物
 * @param {Array} products draft.products（gdid 引用檢）
 */
function validateContentModules(page, reg, products) {
  if (!page || typeof page !== "object") return;
  normalizeComposeOrder(page); // 相容遷移（2026-08-27）：舊制合法的「內文模組在 explore 後」形＝自動歸位、下次儲存轉正，不擋人
  const co = page.composeOrder;
  if (co != null) { // 在場才驗（缺席＝預設序＝合法）；同一函式＝content-modules 端點與 PUT 路自動同閘
    if (!Array.isArray(co)) throw new Error("頁面組成順序的資料形不對——請重新整理頁面後再試。（技術：page.composeOrder 非陣列）");
    const got = co.map(String).slice().sort().join("|");
    if (co.length !== COMPOSE_ORDER_DEFAULT.length || got !== COMPOSE_ORDER_DEFAULT.slice().sort().join("|")) {
      throw new Error(`頁面組成順序不完整或有重複，請重新整理頁面後再試。（技術：composeOrder 必須是 9 鍵完整排列＝${COMPOSE_ORDER_DEFAULT.join("|")}）`);
    }
    if (co[0] !== COMPOSE_PIN.first) throw new Error("主視覺固定在頁面最上方，不能被排到別的位置。（技術：composeOrder[0] 必須是 kv）");
    if (co[co.length - 1] !== COMPOSE_PIN.last) {
      throw new Error("延伸探索固定在頁面最後一區（頁尾之前），不能被排到別的位置。（技術：composeOrder 末位必須是 explore；2026-08-27 模組批釘位制）");
    }
  }
  /* 面數上限（2026-08-27 使用者裁決：牆 1~3、樓層 0~3＝引擎版位）——大體檢改層（OF 鎖死洞）：
     這裡不再 throw——超限舊稿的「減面修回」與任何儲存不得被上限堵死（原本 5→4 仍 >3 照樣擋＝唯一修回通道被封）。
     增面守門＝add 動作 def.maxCount（唯一能增面的端點通道）；PUT 路＝server 端 ratchet（變多且超位才擋）；出貨＝gate CP-16。 */
  const pv = page.promoVariant;
  if (pv != null) { // 在場才驗（缺席＝entry-circles 預設＝合法）；W2.5 換皮批——content-modules 端點與 PUT 路同閘
    if (!reg.promoVariantIds.has(pv)) {
      throw new Error(`這個「本期活動」排版樣式系統不認得，請重新選一種。（技術：page.promoVariant=${pv} 不在 modules.json promo variants 白名單）`);
    }
  }
  const mech = page.mechanic;
  if (mech != null) {
    if (typeof mech !== "object") throw new Error("活動資訊卡的資料形不對——請重新整理頁面後再試。（技術：page.mechanic 非物件）");
    if (!reg.mechanicVariantIds.has(mech.variant)) {
      throw new Error(`這個資訊卡排版系統不認得，請重新選一種。（技術：mechanic.variant=${mech.variant} 不在 modules.json 白名單）`);
    }
    const want = rowsCountFor(mech.variant);
    if (!Array.isArray(mech.rows) || mech.rows.length !== want) {
      throw new Error(`這種排版固定是 ${want} 列，資料列數對不上——請重新整理頁面後再試。（技術：rows=${Array.isArray(mech.rows) ? mech.rows.length : typeof mech.rows}≠${want}＝列數×版式一致閘）`);
    }
    checkUrlField((mech.banner || {}).url, "活動 banner 的點擊連結");
    const bImgs = (mech.banner || {}).imgs;
    if (bImgs != null) { // 在場才驗（舊 draft 只有 banner.img＝合法零波及；2026-08-26 輪播升級）
      if (!Array.isArray(bImgs)) throw new Error("活動 banner 的輪播圖資料形不對——請重新整理頁面後再試。（技術：banner.imgs 非陣列）");
      if (bImgs.length > 3) throw new Error(`活動 banner 的圖最多 3 張（放 1 張不輪播、2~3 張自動輪播）。（技術：banner.imgs 長度 ${bImgs.length}>3＝2026-08-26 使用者需求上限）`);
      bImgs.forEach((x, i) => { // 每格＝空字串或網址文字；URL 寬嚴度沿 banner.img 既例（上稿素材不做網域檢，異於點擊連結的 Yahoo 白名單）
        if (x != null && typeof x !== "string") throw new Error(`活動 banner 第 ${i + 1} 張圖要是網址文字，或先留空。（技術：banner.imgs[${i}] 非字串）`);
      });
    }
    const bUrls = (mech.banner || {}).urls;
    if (bUrls != null) { // 一圖一連結（2026-09-09 使用者需求）：在場才驗（舊稿只有共用 url＝合法零波及）；每格＝Yahoo 網域或空
      if (!Array.isArray(bUrls)) throw new Error("活動 banner 的圖片連結資料形不對——請重新整理頁面後再試。（技術：banner.urls 非陣列）");
      if (bUrls.length > 3) throw new Error(`活動 banner 的圖片連結最多 3 個（跟圖一對一）。（技術：banner.urls 長度 ${bUrls.length}>3）`);
      bUrls.forEach((x, i) => checkUrlField(x, `活動 banner 第 ${i + 1} 張圖的點擊連結`));
    }
    mech.rows.forEach((r, i) => {
      if (!r || typeof r !== "object") throw new Error(`活動資訊卡第 ${i + 1} 列的資料形不對。（技術：rows[${i}] 非物件）`);
      checkUrlField(r.ctaUrl, `活動資訊卡第 ${i + 1} 列的搶購連結`);
      if (r.ctaText != null && typeof r.ctaText !== "string") throw new Error(`活動資訊卡第 ${i + 1} 列的搶購鈕文字要是文字。（技術：rows[${i}].ctaText 非字串）`);
      if (r.rewardImgs != null) {
        if (!Array.isArray(r.rewardImgs)) throw new Error(`活動資訊卡第 ${i + 1} 列的贈品圖資料形不對。（技術：rewardImgs 非陣列）`);
        if (r.rewardImgs.filter((x) => String(x || "").trim()).length > 2) {
          throw new Error(`活動資訊卡第 ${i + 1} 列的贈品圖最多 2 張。（技術：rewardImgs>2＝勘查藍圖好禮圖列上限）`);
        }
      }
    });
  }
  const sp = page.spotlight;
  if (sp != null) {
    if (typeof sp !== "object") throw new Error("主打選品的資料形不對——請重新整理頁面後再試。（技術：page.spotlight 非物件）");
    checkGdidField((sp.heroCard || {}).gdid, products, "主打選品大卡");
    const refs = sp.productRefs;
    if (refs != null) {
      if (!Array.isArray(refs)) throw new Error("主打選品右欄商品的資料形不對。（技術：productRefs 非陣列）");
      if (refs.filter((x) => String(x || "").trim()).length > 2) {
        throw new Error("主打選品右欄的商品最多 2 件（加上大卡共 3 件）。（技術：productRefs>2＝02 §5.1 件數約束）");
      }
      refs.forEach((g, i) => checkGdidField(g, products, `主打選品右欄第 ${i + 1} 件`));
    }
  }
  /* 促銷卡（2026-08-26 多卡批）：新形 promoCards[] 1~4 張；舊形 promoCard 單物件＝讀取相容（視為一張）；
     兩鍵同時在場＝雙真相、擋（寫入端 normalizePromoCards 升級時必刪舊鍵） */
  const pc = page.promoCard;
  const pcs = page.promoCards;
  if (pc != null && pcs != null) {
    throw new Error("促銷卡的資料出現新舊兩份——請重新整理頁面後再試。（技術：page.promoCard 與 page.promoCards 並存＝雙真相，寫入端升級必刪舊鍵）");
  }
  if (pc != null) {
    if (typeof pc !== "object" || Array.isArray(pc)) throw new Error("促銷卡的資料形不對——請重新整理頁面後再試。（技術：page.promoCard 非物件）");
    checkGdidField(pc.gdid, products, "促銷卡");
  }
  if (pcs != null) {
    if (!Array.isArray(pcs)) throw new Error("促銷卡的資料形不對——請重新整理頁面後再試。（技術：page.promoCards 非陣列）");
    if (pcs.length < 1 || pcs.length > PROMO_CARDS_MAX) {
      throw new Error(`促銷卡是 1~${PROMO_CARDS_MAX} 張（目前資料裡有 ${pcs.length} 張）——不放促銷卡就把整個區塊移除。（技術：promoCards 長度值域 1~${PROMO_CARDS_MAX}）`);
    }
    const seen = new Map();
    pcs.forEach((c, i) => {
      if (!c || typeof c !== "object" || Array.isArray(c)) throw new Error(`第 ${i + 1} 張促銷卡的資料形不對——請重新整理頁面後再試。（技術：promoCards[${i}] 非物件）`);
      checkGdidField(c.gdid, products, `第 ${i + 1} 張促銷卡`);
      const g = String(c.gdid == null ? "" : c.gdid).trim();
      if (g) {
        if (seen.has(g)) throw new Error(`第 ${seen.get(g) + 1} 張和第 ${i + 1} 張促銷卡選了同一件商品——同一個區塊每件商品只放一次，請把其中一張換成別的商品。（技術：promoCards gdid 重複）`);
        seen.set(g, i);
      }
    });
  }
}

/* 位置標記重編（2026-08-27 模組批）：floors/walls 的 pos 與 products[].position（featured-N／category-N／featured-N-scene）
   皆為 1 起算槽位編號——組內對調/刪除/加入後就地重編，xlsx 追溯欄與後續 pick 才不會指到已易主的槽。
   scene 列（featured-N-scene＝情境圖來源商品）跟樓層走：對調＝兩槽互換、刪除＝清位置（商品留池＝沿 promo 移除慣例）。 */
function resyncIndexedPositions(page, products, def, op) {
  const prefix = def.posPrefix;
  const arr = page[def.node] || [];
  const mapPos = new Map(); // 舊 position → 新 position（"" ＝清空）
  if (op.type === "swap") {
    for (const [x, y] of [[op.a, op.b], [op.b, op.a]]) {
      mapPos.set(`${prefix}-${x + 1}`, `${prefix}-${y + 1}`);
      mapPos.set(`${prefix}-${x + 1}-scene`, `${prefix}-${y + 1}-scene`);
    }
  } else if (op.type === "remove") {
    mapPos.set(`${prefix}-${op.idx + 1}`, "");
    mapPos.set(`${prefix}-${op.idx + 1}-scene`, "");
    for (let k = op.idx + 1; k <= arr.length; k++) { // splice 後 arr＝新長度：舊槽 k+1 整批往前一格
      mapPos.set(`${prefix}-${k + 1}`, `${prefix}-${k}`);
      mapPos.set(`${prefix}-${k + 1}-scene`, `${prefix}-${k}-scene`);
    }
  }
  arr.forEach((it, i) => { if (it && typeof it === "object") it.pos = `${prefix}-${i + 1}`; });
  if (mapPos.size) (products || []).forEach((pr) => {
    if (!pr || typeof pr.position !== "string" || !mapPos.has(pr.position)) return;
    const np = mapPos.get(pr.position);
    if (np) pr.position = np; else delete pr.position; // 槽沒了＝清追溯標（商品本身留池）
  });
  if (def.node === "walls") { // 宣告欄一致性（gate CP-16 宣告≠實有＝FAIL）：欄位在場＝跟實數
    if (page.categoryWallCount != null) page.categoryWallCount = arr.length;
    if (page.wallCount != null) page.wallCount = arr.length;
  }
}

/* ---------- 結構變更（純物件層；驗證失敗 throw＝呼叫端 400 白話） ---------- */
/**
 * @param {object} dj draft.json 內容（就地變更）
 * @param {object} change { kind: mechanic|spotlight|promoCard|promo|editorial, action: add|remove|set|move|pick,
 *                          variant?, dir?, slot?（pick：hero|ref1|ref2）, product?（pick：伺服器實抓真值） }
 * @param {object} reg loadContentRegistry() 產物
 * @returns { changed:boolean, info:{ summary, notes[] } }
 */
function applyContentModule(dj, change, reg) {
  if (!dj || !dj.page) throw new Error("草稿內容不完整（缺 page）——請重新整理頁面後再試");
  const def = CONTENT_MODULES[change && change.kind];
  if (!def) throw new Error(`未知的區塊種類，請重新整理頁面後再試。（技術：kind=${change && change.kind}）`);
  const page = dj.page;
  const info = { notes: [], summary: "" };
  const action = change.action;

  if (def.removeOnly && (action === "add" || action === "set")) {
    throw new Error(`「${def.name}」的內容編修走原本的「${def.name}」面板——頁面組成這裡只提供移除。（技術：kind=${change.kind} 僅開放 remove）`);
  }
  if (def.groupMoveOnly && action !== "move") {
    throw new Error(`「${def.name}」整組這裡只支援上下移動；加一層、移除或排序單一層請用列表上各層自己的按鈕。（技術：kind=${change.kind} 僅開放 move）`);
  }
  /* unpick＝移除單一商品（2026-09-24 加）。此前樓層／品類牆「能加不能刪」，
     理由寫的是「受版型件數契約管、只走替換」——但替換不改變件數，件數一旦落在
     不合法值就沒有任何動作能回頭。使用者實測當場卡住並指出「商品數不夠時一樣沒解決」。 */
  if (def.indexed && !["pick", "unpick", "add", "remove", "move"].includes(action)) {
    throw new Error(`「${def.name}」支援加商品、移除商品、加一層／一面、移除整層／整面與組內排序。（技術：kind=${change.kind} 動作 ${action} 未開放）`);
  }
  if (change.kind === "promoCard") normalizePromoCards(page); // 舊形單物件＝就地升級一張卡（零變更不落盤＝舊 draft 讀取零波及）

  if (action === "move") {
    normalizeComposeOrder(page); // 舊稿 explore 後綴形＝先歸位再移（讀入正規化與 PUT 路同義）
    if (def.indexed && change.index == null) {
      throw new Error(`「${def.name}」要指定移動哪一${def.node === "floors" ? "層" : "面"}；整組搬用「${def.name}（整組）」的上下鍵。（技術：indexed move 必帶 index）`);
    }
    /* indexed 組內對調（2026-08-27 模組批）：floor/wall 帶 index＝陣列內上下移；碰組邊界＝changed:false 撞牆不痛（UI 端邊界鈕 disabled、此為第二道守門） */
    if (def.indexed && change.index != null) {
      const arr = page[def.node];
      if (!Array.isArray(arr) || !arr.length) throw new Error(`頁面上還沒有「${def.name}」——先加入，才需要調整位置。`);
      const i = Number(change.index);
      if (!Number.isInteger(i) || i < 0 || i >= arr.length) throw new Error(`找不到要移動的那一${def.node === "floors" ? "層" : "面"}，請重新整理頁面後再試。（技術：index=${change.index} 不在 0~${arr.length - 1}）`);
      const dirI = change.dir;
      if (dirI !== "up" && dirI !== "down") throw new Error(`未知的移動方向，請重新整理頁面後再試。（技術：dir=${dirI} 不在 up|down）`);
      const j2 = dirI === "up" ? i - 1 : i + 1;
      if (j2 < 0 || j2 >= arr.length) {
        info.summary = `「${def.name} ${i + 1}」已經在${dirI === "up" ? "這一組的最上面" : "這一組的最下面"}了——整組要一起搬，用「${def.name}（整組）」的上下鍵`;
        return { changed: false, info };
      }
      [arr[i], arr[j2]] = [arr[j2], arr[i]];
      resyncIndexedPositions(page, dj.products, def, { type: "swap", a: i, b: j2 });
      validateContentModules(page, reg, dj.products);
      info.summary = `已把「${def.name} ${i + 1}」和「${def.name} ${j2 + 1}」對調`;
      return { changed: true, info };
    }
    if (!COMPOSE_MOVABLE.has(change.kind)) {
      throw new Error(`「${def.name}」的位置是固定的，不能移動。（技術：move 開放鍵＝七鍵中段；主視覺/延伸探索/頁尾釘位——2026-08-27 模組批）`);
    }
    if (page[def.node] == null || (Array.isArray(page[def.node]) && !page[def.node].length)) throw new Error(`頁面上還沒有「${def.name}」——先加入，才需要調整位置。`);
    const dir = change.dir;
    if (dir !== "up" && dir !== "down") throw new Error(`未知的移動方向，請重新整理頁面後再試。（技術：dir=${dir} 不在 up|down）`);
    const order = Array.isArray(page.composeOrder) ? page.composeOrder.slice() : COMPOSE_ORDER_DEFAULT.slice();
    const i = order.indexOf(change.kind);
    if (i < 0) throw new Error("頁面組成順序的資料不完整——請重新整理頁面後再試。（技術：composeOrder 缺 " + change.kind + " 鍵）");
    /* 大體檢 JS-03 修（2026-08-27）：跳過「樹上看不見」的鍵——原本和沒加入的隱形模組（如未加入的主打選品）對調＝
       畫面沒動卻報成功＋白白核可失效；可見性語意＝treeSections 節點存在（promo/editorial 恆有節點〔未啟用徽章〕、
       三內文模組與樓層/牆＝有資料才有節點）。 */
    const visible = (k) => {
      if (k === "kv" || k === "explore" || k === "promo" || k === "editorial") return true;
      if (k === "mechanic") return page.mechanic != null;
      if (k === "spotlight") return page.spotlight != null;
      if (k === "promoCard") return (Array.isArray(page.promoCards) && page.promoCards.length > 0) || (page.promoCard != null && !Array.isArray(page.promoCard));
      if (k === "featured") return Array.isArray(page.floors) && page.floors.length > 0;
      if (k === "walls") return Array.isArray(page.walls) && page.walls.length > 0;
      return false;
    };
    let j = i;
    do { j = dir === "up" ? j - 1 : j + 1; } while (j >= 1 && j <= order.length - 2 && !visible(order[j]));
    if (j < 1 || j > order.length - 2) { // 首界＝kv 恆首、尾界＝explore 恆末（2026-08-27 釘位制）；碰界＝零變更（沿「排版沒有變」語意）
      info.summary = dir === "up" ? `「${def.name}」已經在最上面了（頁面最上方固定是主視覺）——沒有變更` : `「${def.name}」已經在最下面了（頁面最後固定是延伸探索與頁尾）——沒有變更`;
      return { changed: false, info };
    }
    order.splice(i, 1);
    order.splice(j > i ? j : j, 0, change.kind); // 跨過隱形鍵一次到位（隱形鍵相對序保留）；相鄰可見＝等同對調
    writeComposeOrder(page, order);
    validateContentModules(page, reg, dj.products); // 對調後整頁複驗＝順序不變式自檢（含既存 composeOrder 壞值一併擋下）
    info.summary = `已把「${def.name}」往${dir === "up" ? "上" : "下"}移一格`;
    return { changed: true, info };
  }

  if (action === "add") {
    /* indexed 加一層/一面（2026-08-27 模組批＝58 號裁決③升檔條款兌現：真需求出現＝面數開放；上限＝引擎版位 3）。
       空模組＝欄位空字串照形（真值鐵律：URL/文案 AI 禁代填）——渲染端空值降級、發佈前檢查把還缺的列給使用者。 */
    if (def.indexed) {
      const arr0 = Array.isArray(page[def.node]) ? page[def.node] : [];
      const unitA = def.node === "floors" ? "層" : "面";
      if (arr0.length >= def.maxCount) {
        throw new Error(`「${def.name}」最多 ${def.maxCount} ${unitA}——版面位子就是這麼多；想換內容請直接編修現有的那幾${unitA}。`);
      }
      const n = arr0.length + 1;
      const blank = def.node === "floors"
        ? { pos: `featured-${n}`, title: "", titleSource: "manual", subtitle: "", sceneCopy: { tag: "", title: "", sub: "" }, sceneImg: "", sceneUrl: "", moreLink: { enabled: "off", url: "" }, productGdids: [] }
        : { pos: `category-${n}`, title: "", titleSource: "manual", moreLink: { enabled: "off", url: "" }, productGdids: [] };
      arr0.push(blank);
      page[def.node] = arr0;
      resyncIndexedPositions(page, dj.products, def, { type: "add" });
      validateContentModules(page, reg, dj.products);
      info.summary = `已加入「${def.name} ${n}」——放進商品前這一${def.node === "floors" ? "層" : "面"}不會出現在頁面上；先填標題、用「人工挑選商品加入」或「補一件折數最好的」補商品，其餘缺項發佈前檢查會提醒`;
      return { changed: true, info };
    }
    if (def.variantId && !reg.featuredSelectable.has(def.variantId)) {
      throw new Error(`「${def.name}」還沒開放加入，請先跳過這一區。（技術：featured variant ${def.variantId} 未登錄或未開放＝modules.json 白名單）`);
    }
    /* 促銷卡多卡（2026-08-26）：「每型至多一實例」對促銷卡翻案——add＝加一張卡（首次＝建節點一張、其後＝追加、滿 PROMO_CARDS_MAX 擋） */
    if (change.kind === "promoCard") {
      const cards = page.promoCards;
      if (cards != null && cards.length >= PROMO_CARDS_MAX) {
        throw new Error(`促銷卡已經放滿 ${PROMO_CARDS_MAX} 張——桌機和平板一列兩張，放偶數張最整齊；要換內容請直接編修其中一張，或先移除一張再加。`);
      }
      if (cards == null) {
        page.promoCards = [emptyPromoCard()];
        info.summary = `已把「促銷卡」加進頁面組成（第 1 張卡）——往下捲到「促銷卡」段填內容；最多可以放 ${PROMO_CARDS_MAX} 張`;
      } else {
        cards.push(emptyPromoCard());
        info.summary = `已新增第 ${cards.length} 張促銷卡${cards.length % 2 ? "——桌機和平板一列兩張，放偶數張最整齊" : ""}`;
      }
      validateContentModules(page, reg, dj.products);
      return { changed: true, info };
    }
    if (page[def.node] != null) {
      throw new Error(`「${def.name}」已經在頁面上了——每種區塊最多加一個；要調整內容請直接在該區塊編修。`);
    }
    let variant;
    if (def.node === "mechanic") {
      variant = change.variant || (reg.mechanicVariants[0] && reg.mechanicVariants[0].id);
      if (!reg.mechanicVariantIds.has(variant)) {
        throw new Error(`這個資訊卡排版系統不認得，請重新選一種。（技術：variant=${change.variant} 不在 modules.json 白名單）`);
      }
    }
    page[def.node] = defaultNodeFor(change.kind, variant);
    validateContentModules(page, reg, dj.products);
    info.summary = `已把「${def.name}」加進頁面組成——內容先保存，正式版面完成後會自動出現在頁面上`;
    return { changed: true, info };
  }

  if (action === "remove") {
    /* indexed 移除單一層/面（2026-08-27 模組批）：牆守下限 1（使用者裁決 1~3）；樓層可刪到 0＝刪鍵（缺席即預設、整區隱藏）；
       商品一律留池不動（沿 promo 移除慣例、14 §2.14 升版註記）——只清/重編 position 追溯標 */
    if (def.indexed) {
      if (change.index == null) throw new Error(`「${def.name}」要指定移除哪一${def.node === "floors" ? "層" : "面"}——不提供整組移除。（技術：indexed remove 必帶 index）`);
      const arr = page[def.node];
      if (!Array.isArray(arr) || !arr.length) { info.summary = `頁面上沒有「${def.name}」——沒有變更`; return { changed: false, info }; }
      const unitR = def.node === "floors" ? "層" : "面";
      const idx = Number(change.index);
      if (!Number.isInteger(idx) || idx < 0 || idx >= arr.length) throw new Error(`找不到要移除的那一${unitR}，請重新整理頁面後再試。（技術：index=${change.index} 不在 0~${arr.length - 1}）`);
      if (arr.length <= (def.minCount || 0)) throw new Error(`「${def.name}」至少要留 ${def.minCount} ${unitR}——頁面骨架的下限（2026-08-27 裁決＝牆 1~3）。`);
      arr.splice(idx, 1);
      resyncIndexedPositions(page, dj.products, def, { type: "remove", idx });
      if (!arr.length) delete page[def.node]; // 刪到 0＝刪鍵（樓層專屬；牆由下限守住）
      validateContentModules(page, reg, dj.products);
      info.summary = `已移除「${def.name} ${idx + 1}」（移除前有自動備份）——商品仍留在這檔的來源商品清單，之後照樣選得到`;
      return { changed: true, info };
    }
    if (page[def.node] == null) {
      info.summary = `頁面上沒有「${def.name}」——沒有變更`;
      return { changed: false, info };
    }
    /* 促銷卡單卡移除（2026-08-26 多卡批）：remove 帶 index＝只移那一張；移到 0 張＝整節點刪鍵（delete 鍵制）。
       不帶 index＝整區塊移除（維持既有語意；面板「移除整個區塊」鍵走這裡）。 */
    if (change.kind === "promoCard" && change.index != null) {
      const cards = page.promoCards;
      const idx = Number(change.index);
      if (!Number.isInteger(idx) || idx < 0 || idx >= cards.length) {
        throw new Error(`找不到要移除的那張卡，請重新整理頁面後再試。（技術：index=${change.index} 不在 0~${cards.length - 1}）`);
      }
      cards.splice(idx, 1);
      if (!cards.length) {
        delete page.promoCards;
        info.summary = "已移除最後一張促銷卡——整個「促銷卡」區塊一併從頁面組成移除（移除前有自動備份）";
      } else {
        info.summary = `已移除第 ${idx + 1} 張促銷卡——剩 ${cards.length} 張（移除前有自動備份）`;
      }
      validateContentModules(page, reg, dj.products);
      return { changed: true, info };
    }
    delete page[def.node];
    info.summary = `已從頁面組成移除「${def.name}」（移除前有自動備份）`;
    return { changed: true, info };
  }

  if (action === "set") {
    if (def.node !== "mechanic") throw new Error(`「${def.name}」沒有排版可換。（技術：set 僅 mechanic 支援 variant）`);
    const node = page[def.node];
    if (node == null) throw new Error("頁面上還沒有「活動資訊卡」——請先加入再選排版。");
    const v = String(change.variant || "").trim();
    if (!reg.mechanicVariantIds.has(v)) {
      throw new Error(`這個資訊卡排版系統不認得，請重新選一種。（技術：variant=${change.variant} 不在 modules.json 白名單）`);
    }
    if (node.variant === v) {
      info.summary = "排版沒有變——沒有變更";
      return { changed: false, info };
    }
    node.variant = v;
    const want = rowsCountFor(v);
    if (!Array.isArray(node.rows)) node.rows = [];
    /* 2026-09-09 使用者裁（翻 2026-08-30 列暫存制）：版面只顯示自己會畫的欄位——換版面＝新版面用不到的欄位資料清掉、多出的列刪掉、
       贈品圖截到該版面張數；CMS 換之前先列出會清掉什麼請使用者確認（每次變更前仍有 draft.vN 自動備份可還原）。舊稿殘留的 rowStash 一併清掉、出聲。 */
    const keep = new Set(rowFieldsFor(v));
    const imgCap = rewardImgsCapFor(v);
    const hasVal = (x) => (Array.isArray(x) ? x.some((y) => String(y || "").trim()) : String(x || "").trim());
    const cleared = [];
    if (node.rows.length > want) {
      const dropped = node.rows.slice(want);
      node.rows = node.rows.slice(0, want);
      dropped.forEach((r, i) => { if (r && Object.values(r).some(hasVal)) cleared.push(`第 ${want + i + 1} 列整列`); });
    }
    while (node.rows.length < want) node.rows.push(emptyInfoRow());
    node.rows.forEach((r, i) => {
      if (!r || typeof r !== "object") { node.rows[i] = emptyInfoRow(); return; }
      const gone = [];
      for (const k2 of Object.keys(r)) {
        if (keep.has(k2)) continue;
        if (hasVal(r[k2])) gone.push(ROW_FIELD_LABELS[k2] || k2);
        r[k2] = Array.isArray(r[k2]) ? [] : "";
      }
      if (Array.isArray(r.rewardImgs) && r.rewardImgs.filter(hasVal).length > imgCap) { gone.push(`第 ${imgCap + 1} 張起的贈品圖`); r.rewardImgs = r.rewardImgs.slice(0, imgCap); }
      if (gone.length) cleared.push(`第 ${i + 1} 列的${gone.join("、")}`);
    });
    if (Array.isArray(node.rowStash) && node.rowStash.some((r) => r && Object.values(r).some(hasVal))) cleared.push("之前暫存的列");
    delete node.rowStash;
    if (cleared.length) info.notes.push(`這個版面用不到的內容已清掉：${cleared.join("；")}（每次變更前都有自動備份，「設定」→「版本歷史」可還原）`);
    info.cleared = cleared;
    validateContentModules(page, reg, dj.products);
    info.summary = `資訊卡排版已換成「${mechanicVariantLabel(v, reg)}」（${want} 列）`;
    return { changed: true, info };
  }

  if (action === "set-variant") { // W2.5 換皮批（2026-08-26 方案 A）：只換排版樣式 page.promoVariant、內容零改動（promoEntries 不碰）
    if (change.kind !== "promo") {
      throw new Error(`「${def.name}」這裡沒有排版樣式可換。（技術：set-variant 僅 promo；資訊卡換版式走 set）`);
    }
    if (page[def.node] == null) {
      throw new Error("頁面上還沒有「本期活動」——先在「本期活動」段選一個內容主題建立這個區塊，再挑排版樣式。");
    }
    const v = String(change.variant || "").trim();
    if (!reg.promoVariantIds.has(v)) {
      throw new Error(`這個排版樣式系統不認得，請重新選一種。（技術：variant=${change.variant} 不在 modules.json promo variants 白名單）`);
    }
    const now = page.promoVariant == null ? PROMO_VARIANT_DEFAULT : page.promoVariant;
    if (now === v) {
      info.summary = "排版樣式沒有變——沒有變更";
      return { changed: false, info };
    }
    /* 2026-09-09 使用者裁（翻 08-30 同內容換皮制）：換排版＝新排版用不到的清掉、先由 CMS 確認過才會打到這裡（同一套判定＝PROMO_VARIANT_FIELDS） */
    const fromF = promoVariantFieldsFor(now), toF = promoVariantFieldsFor(v);
    const hasVal = (x) => String(x == null ? "" : x).trim().length > 0;
    const cleared = [];
    for (const k of fromF.page) if (!toF.page.includes(k)) { if (hasVal(page[k])) cleared.push(PROMO_FIELD_LABELS[k] || k); delete page[k]; }
    const entries = Array.isArray(page.promoEntries) ? page.promoEntries : [];
    const entryGone = fromF.entry.filter((k) => !toF.entry.includes(k));
    if (entryGone.length) {
      const touched = new Set();
      entries.forEach((e, i) => { if (!e || typeof e !== "object") return; entryGone.forEach((k) => { if (hasVal(e[k])) touched.add(i + 1); if (k in e) e[k] = ""; }); });
      if (touched.size) cleared.push(`第 ${[...touched].join("、")} 則的${entryGone.map((k) => PROMO_FIELD_LABELS[k] || k).join("、")}`);
    }
    if (toF.maxEntries != null && entries.length > toF.maxEntries) {
      cleared.push(`第 ${toF.maxEntries + 1}${entries.length > toF.maxEntries + 1 ? `～${entries.length}` : ""} 則入口整則（這款排版只放前 ${toF.maxEntries} 則）`);
      page.promoEntries = entries.slice(0, toF.maxEntries);
    }
    if (v === PROMO_VARIANT_DEFAULT) delete page.promoVariant; // 等於預設＝刪鍵（缺席即預設＝舊 draft 零波及，沿 composeOrder 慣例）
    else page.promoVariant = v;
    validateContentModules(page, reg, dj.products);
    if (cleared.length) info.notes.push(`這個排版用不到的內容已清掉：${cleared.join("；")}（每次變更前都有自動備份，「設定」→「版本歷史」可還原）`);
    info.cleared = cleared;
    info.summary = `「本期活動」排版樣式已換成「${promoVariantLabel(v, reg)}」${cleared.length ? "" : "——內容都沒動，隨時可換回"}`;
    return { changed: true, info };
  }

  if (action === "pick") { // 貼商品網址/賣場編號帶入（2026-08-26；同日下午擴促銷卡＋牆/樓層）：change.product＝伺服器實抓真值——lib 不碰網路、不代填（鐵律 2）
    if (!PICK_KINDS[change.kind]) {
      throw new Error(`「${def.name}」不支援貼網址帶入商品——目前開放主打選品、促銷卡、品類牆、主打樓層。（技術：action=pick kind=${change.kind} 不在值域）`);
    }
    const p = change.product || {};
    const gdid = String(p.gdid || "").trim();
    if (!gdid || !p.name || p.price == null || !p.url || !(Array.isArray(p.imgs) && p.imgs[0])) {
      throw new Error("這件商品讀不到完整資料（名稱／價格／連結／圖片），沒有帶入——請換一件在售商品。（技術：pick 缺真值欄＝只收伺服器實抓完整結果，防手填繞道）");
    }
    const shortName = String(p.name).slice(0, 24);
    dj.products = Array.isArray(dj.products) ? dj.products : [];
    const already = dj.products.some((x) => x && String(x.gdid) === gdid);
    /* dedupe by gdid：已在活動裡＝直接引用不重複加（下拉本來就能選它）；
       新品＝追加 products[] 一列（真值全伺服器實抓、欄形沿 editorial-add 慣例；position 標記供追溯） */
    const pushProduct = (position, extra) => {
      if (already) return;
      dj.products.push(Object.assign({
        gdid, position,
        name: p.name, price: p.price, url: p.url,
        img: p.imgs[0], sceneImg: p.imgs[1] || p.imgs[0], imgOptions: p.imgs.slice(0, 5),
        offer: "", tag: "", tagSource: "manual",
      }, extra || {}, (typeof p.marketPrice === "number" && p.marketPrice > p.price) ? { marketPrice: p.marketPrice } : {},
        p.store ? { store: p.store } : {})); // 賣場名稱（2026-08-26 店名欄）：實抓有才帶、缺席不留空字串（渲染端有 store 才顯示店名列）
    };

    if (change.kind === "spotlight") {
      const sp = page.spotlight;
      if (sp == null) throw new Error("頁面上還沒有「主打選品」——請先在「頁面組成」加入這個區塊，再帶入商品。");
      const slotLabel = SPOTLIGHT_PICK_SLOTS[change.slot];
      if (!slotLabel) throw new Error(`未知的商品位置，請重新整理頁面後再試。（技術：slot=${change.slot} 不在 hero|ref1|ref2）`);
      if (!sp.heroCard || typeof sp.heroCard !== "object") sp.heroCard = { capsuleText: "", diagonalText: "", offerLine: "", gdid: "" };
      if (!Array.isArray(sp.productRefs)) sp.productRefs = [];
      const cur = { hero: String(sp.heroCard.gdid || ""), ref1: String(sp.productRefs[0] || ""), ref2: String(sp.productRefs[1] || "") };
      if (cur[change.slot] === gdid) {
        info.summary = `「${shortName}」已經放在${slotLabel}了——沒有變更`;
        return { changed: false, info };
      }
      const clash = Object.keys(cur).find((k) => k !== change.slot && cur[k] === gdid);
      if (clash) {
        throw new Error(`這件商品已經放在主打選品的「${SPOTLIGHT_PICK_SLOTS[clash]}」了——同一個區塊每件商品只放一次；想搬位置，請先把那一格換成別的商品。`);
      }
      pushProduct(SPOTLIGHT_PICK_POSITION);
      if (change.slot === "hero") sp.heroCard.gdid = gdid;
      else sp.productRefs[change.slot === "ref1" ? 0 : 1] = gdid; // 稀疏洞填空字串（勿留 undefined＝JSON 落盤成 null、驗證器語意跑掉）
      for (let i = 0; i < sp.productRefs.length; i++) if (sp.productRefs[i] == null) sp.productRefs[i] = "";
      validateContentModules(page, reg, dj.products);
      info.summary = `已把「${shortName}」（$${p.price}）放進主打選品的${slotLabel}`;
      if (already) info.notes.push("這件商品本來就在這檔活動裡——直接引用，不會重複加一筆");
      return { changed: true, info };
    }

    if (change.kind === "promoCard") { // 促銷卡（2026-08-26 多卡批）：slot=card-1~card-4＝第幾張卡
      const cards = page.promoCards;
      if (cards == null) throw new Error("頁面上還沒有「促銷卡」——請先在「頁面組成」加入這個區塊，再帶入商品。");
      const m = PROMO_CARD_PICK_SLOT_RE.exec(String(change.slot || ""));
      if (!m) throw new Error(`未知的卡片位置，請重新整理頁面後再試。（技術：slot=${change.slot} 不在 card-1~card-${PROMO_CARDS_MAX}）`);
      const ci = Number(m[1]) - 1;
      if (ci >= cards.length) throw new Error(`頁面上還沒有第 ${ci + 1} 張促銷卡——先按「＋ 新增一張卡片」，再帶入商品。`);
      if (!cards[ci] || typeof cards[ci] !== "object") cards[ci] = emptyPromoCard();
      const curCards = cards.map((c) => String((c && c.gdid) || ""));
      if (curCards[ci] === gdid) {
        info.summary = `「${shortName}」已經放在第 ${ci + 1} 張促銷卡了——沒有變更`;
        return { changed: false, info };
      }
      const clashI = curCards.findIndex((g, k) => k !== ci && g === gdid);
      if (clashI >= 0) {
        throw new Error(`這件商品已經放在第 ${clashI + 1} 張促銷卡了——同一個區塊每件商品只放一次；想搬位置，請先把那張卡換成別的商品。`);
      }
      pushProduct(PROMO_CARD_PICK_POSITION);
      cards[ci].gdid = gdid;
      validateContentModules(page, reg, dj.products);
      info.summary = `已把「${shortName}」（$${p.price}）放進第 ${ci + 1} 張促銷卡`;
      if (already) info.notes.push("這件商品本來就在這檔活動裡——直接引用，不會重複加一筆");
      return { changed: true, info };
    }

    /* 牆/樓層加商品（2026-08-26）：index＝第幾面牆/第幾層（0 起算）；全頁互斥（每件商品整頁只放一次＝CP-18 語意；
       圓卡/探索卡等 url 型曝光由 server 端 pageGdids 前置擋）＋件數上限（樓層 5／牆 12）；件數提醒照各模組真規則 */
    const arr = page[def.node];
    const idx = Number(change.index);
    if (!Array.isArray(arr) || !arr.length) throw new Error(`頁面上還沒有${def.name}，沒辦法加商品。（技術：page.${def.node} 缺席或空陣列）`);
    if (!Number.isInteger(idx) || idx < 0 || idx >= arr.length) {
      throw new Error(`找不到要加商品的位置，請重新整理頁面後再試。（技術：index=${change.index} 不在 0~${arr.length - 1}）`);
    }
    const target = arr[idx];
    if (!target || typeof target !== "object") throw new Error(`${def.name}的資料形不對——請重新整理頁面後再試。（技術：${def.node}[${idx}] 非物件）`);
    if (!Array.isArray(target.productGdids)) target.productGdids = [];
    const label = `${def.name} ${idx + 1}`;
    if (target.productGdids.map(String).includes(gdid)) {
      info.summary = `「${shortName}」已經在${label}上了——沒有變更`;
      return { changed: false, info };
    }
    const usedAt = gdidUsedOnPage(page, dj.products, gdid);
    /* 2026-10-05 使用者裁：主視覺可與下方重複曝光＝這道門對「只在主視覺用過」放行、改提醒
       （gate CP-18 會出 WARN；gdidUsedOnPage 仍照實回報「它在哪」——政策在門、不在查詢）。 */
    if (usedAt && usedAt !== "主視覺") {
      throw new Error(`這件商品已經用在「${usedAt}」了——每件商品整頁只能放一次，請換一件。`);
    }
    if (usedAt === "主視覺") info.notes.push("這件商品也在主視覺上——主視覺可與下方重複曝光（2026-10-05 裁決）；檢查清單會提醒一句，不會擋出貨");
    const cap = MODULE_PICK_CAPS[change.kind];
    if (target.productGdids.length >= cap) {
      throw new Error(change.kind === "floor"
        ? `這一層已經放滿 ${cap} 件（第一排情境卡＋3 件、之後每排 4 件，最多 ${cap} 件）——想換內容，用商品清單該列的「替換商品」。`
        : `這面牆已經放滿 ${cap} 件（一行 4 件、最多三行）——想換內容，用商品清單該列的「替換商品」。`);
    }
    pushProduct(`${def.posPrefix}-${idx + 1}`, { order: target.productGdids.length + 1 }); /* 大體檢 CT-3 修：牆＝category-N（原 wall-N 與 posPrefix/重編器不同調＝對調移除後殘影、xlsx 錯位） */
    target.productGdids.push(gdid);
    validateContentModules(page, reg, dj.products);
    const n = target.productGdids.length;
    const countNote = change.kind === "wall"
      ? (n % 4 ? `（一行 4 件：再加 ${4 - (n % 4)} 件湊滿一行，4／8／12 件最整齊）` : "（4 的倍數，排起來最整齊）")
      : (n < 3 ? `（第一排＝情境卡＋3 件：還差 ${3 - n} 件）`
        : ((n - 3) % 4 === 0 ? `（${n} 件剛好排滿——每排 4 件的節奏，3／7／11／15 件最整齊）` : `（每排 4 件：再加 ${4 - ((n - 3) % 4)} 件湊滿這一排，3／7／11／15 件最整齊）`));
    info.summary = `已把「${shortName}」（$${p.price}）加進${label}——目前 ${n} 件${countNote}`;
    if (already) info.notes.push("這件商品本來就在這檔活動的資料裡——直接引用，不會重複加一筆");
    return { changed: true, info };
  }

  if (action === "unpick") { // 移除單一商品（2026-09-24 使用者實測後補）
    /* 為什麼需要這條：原本樓層／品類牆「能加不能刪」——理由寫的是「受版型件數契約管、只走替換」，
       但替換不改變件數，所以一旦件數落在不合法值（牆＝非 4／8／12）就沒有任何動作能回頭＝死路。
       使用者 2026-09-24 實測當場卡住，並指出「商品數不夠的時候一樣沒解決問題」——湊不滿又刪不掉。
       商品一律留在來源商品池（沿刪層／刪牆慣例）——只從這個模組的清單拿掉，之後照樣選得回來。 */
    if (!def.indexed) throw new Error(`「${def.name}」不支援移除單一商品。（技術：unpick 僅限 indexed 模組）`);
    const arr = page[def.node];
    const idx = Number(change.index);
    if (!Array.isArray(arr) || !arr.length) throw new Error(`頁面上還沒有${def.name}。（技術：page.${def.node} 缺席或空陣列）`);
    if (!Number.isInteger(idx) || idx < 0 || idx >= arr.length) {
      throw new Error(`找不到要移除商品的位置，請重新整理頁面後再試。（技術：index=${change.index} 不在 0~${arr.length - 1}）`);
    }
    const target = arr[idx];
    const gd = String(change.gdid == null ? "" : change.gdid);
    const at = ((target && target.productGdids) || []).map(String).indexOf(gd);
    if (at < 0) { info.summary = `這件商品不在${def.name} ${idx + 1} 上——沒有變更`; return { changed: false, info }; }
    target.productGdids.splice(at, 1);
    resyncIndexedPositions(page, dj.products, def, { type: "reorder", idx });
    validateContentModules(page, reg, dj.products);
    const n = target.productGdids.length;
    const nm = ((dj.products || []).find((x) => x && String(x.gdid) === gd) || {}).name || gd;
    const countNote = change.kind === "wall"
      ? (n % 4 ? `（一行 4 件：再移 ${n % 4} 件或補 ${4 - (n % 4)} 件，4／8／12 件最整齊）` : "（4 的倍數，排起來最整齊）")
      : (n < 3 ? `（第一排＝情境卡＋3 件：還差 ${3 - n} 件）` : "");
    info.summary = `已從${def.name} ${idx + 1} 移除「${String(nm).slice(0, 14)}」——目前 ${n} 件${countNote}。商品仍留在這檔的來源商品清單，之後照樣選得回來`;
    return { changed: true, info };
  }

  throw new Error(`未知的操作，請重新整理頁面後再試。（技術：action=${action} 不在 add|remove|set|set-variant|move|pick|unpick）`);
}

/** 版式顯示名（設計師語言）：取 meaning 主句（去「活動資訊卡・」前綴與括號細節）——展示層禁機讀代號 */
function mechanicVariantLabel(id, reg) {
  const v = (reg.mechanicVariants || []).find((x) => x.id === id);
  if (!v) return id;
  return String(v.meaning || id).replace(/^活動資訊卡・/, "").replace(/（.*$/, "");
}

/** 本期活動排版樣式顯示名：取 meaning 主句（去「本期活動・」前綴與括號細節）；登錄名尾字「皮」＝換皮制
 *  治理語彙，顯示名去掉（CMS 介面禁內部治理詞彙＝2026-08-25 使用者指示）——「優惠說明卡皮」介面顯示「優惠說明卡」 */
function promoVariantLabel(id, reg) {
  const v = (reg.promoVariants || []).find((x) => x.id === id);
  if (!v) return id;
  return String(v.meaning || id).replace(/^本期活動・/, "").replace(/（.*$/, "").replace(/皮$/, "");
}

/**
 * 讀 draft → applyContentModule → 落版備份 → 寫回（編修期寫入點；R4：呼叫端【必須】在本函式成功後
 * 呼叫 invalidateApproval——登錄＝scripts/draft-writers.allow「content-modules-apply」行）。
 * 讀不到／驗證失敗／寫不進＝throw（失敗要出聲）；沒有變更＝不寫檔、changed:false。
 * G3 計數不變：writeFileSync 經 draftPath 變數（沿 hero_combo.writeComboIntoDraft 前例）。
 */
/**
 * 草稿列對齊頁面真值（2026-10-05 名稱兩式死鎖根治；與 10-04 網址兩式同形）：
 * 「清單」與「商品頁」對同一件商品本就可能寫不同名（實證 gdid 11943448：清單欄位
 * productname_disp＝「L OCCITANE」、商品頁＝「L'OCCITANE」——兩個都是實抓真值、不是壞資料）。
 * 池子一旦被任何實抓動作刷成頁面寫法，草稿還留著清單寫法＝CP-02 名稱字面比對永久紅，
 * 而「重建來源紀錄」原本只寫池那半邊＝按幾次都一樣（修復鈕修一半）。
 * 裁定＝一旦有商品頁實抓，名稱以商品頁為準、草稿與池同批收斂
 * （沿 price_truth「快照與草稿同批改」先例）。只對齊 name：url 兩式已由 sameProductUrl 等價吸收；
 * 名稱是系統帶入欄、非人工欄＝可同步。呼叫端自己負責把草稿落盤。
 */
function alignDraftRowTruth(products, p) {
  if (!p || p.gdid == null || !p.name) return [];
  const row = (products || []).find((x) => x && String(x.gdid) === String(p.gdid));
  if (!row) return [];
  const changed = [];
  if (String(row.name || "") !== String(p.name)) { row.name = String(p.name); changed.push("name"); }
  return changed;
}

function writeContentModuleIntoDraft(draftPath, change, reg) {
  let dj;
  try {
    dj = JSON.parse(fs.readFileSync(draftPath, "utf8"));
  } catch (e) {
    throw new Error(`頁面組成變更失敗（讀取草稿 ${draftPath}）：${e.message}`);
  }
  /* 名稱兩式（2026-10-05）：change.product＝伺服器實抓的頁面真值（鐵律 2 契約）——寫入前先把
     既有草稿列的名稱收斂，和本次變更同一個備份、同一次落盤。 */
  const aligned = change && change.product ? alignDraftRowTruth(dj.products, change.product) : [];
  const r = applyContentModule(dj, change, reg);
  if (aligned.length) { r.info = r.info || {}; r.info.nameAligned = change.product.gdid; }
  if (!r.changed && !aligned.length) return { ...r, draft: dj, backup: null };
  if (!r.changed && aligned.length) r.changed = true; /* 只有名稱收斂也要落盤＝不然修了白修 */
  let backup = null;
  try {
    let v = 1;
    const dir = draftPath.replace(/[/\\][^/\\]+$/, "");
    while (fs.existsSync(`${dir}/draft.v${v}.json`)) v++;
    fs.copyFileSync(draftPath, `${dir}/draft.v${v}.json`);
    backup = `draft.v${v}.json`;
    fs.writeFileSync(draftPath, JSON.stringify(dj, null, 1));
  } catch (e) {
    throw new Error(`頁面組成變更失敗（寫入草稿）：${e.message}——這次變更沒有存入，請再試一次`);
  }
  return { ...r, draft: dj, backup };
}

module.exports = {
  alignDraftRowTruth,
  WALL_PRODUCT_COUNT_ENUM,
  CONTENT_MODULES,
  COMPOSE_ORDER_DEFAULT,
  COMPOSE_PIN,
  normalizeComposeOrder,
  INFO_ROWS_BY_VARIANT,
  INFO_ROW_FIELDS_BY_VARIANT,
  INFO_REWARD_IMGS_BY_VARIANT,
  rowFieldsFor,
  rewardImgsCapFor,
  ROW_FIELD_LABELS,
  PROMO_VARIANT_DEFAULT,
  PROMO_VARIANT_FIELDS,
  promoVariantFieldsFor,
  PROMO_FIELD_LABELS,
  SPOTLIGHT_PICK_SLOTS,
  SPOTLIGHT_PICK_POSITION,
  PROMO_CARDS_MAX,
  PROMO_CARD_PICK_SLOT_RE,
  PROMO_CARD_PICK_POSITION,
  PICK_KINDS,
  MODULE_PICK_CAPS,
  normalizePromoCards,
  emptyPromoCard,
  emptyInfoRow, // 2026-09-26：Excel 帶入（lib/sheet_import.js）要用同一個列形，不另抄
  gdidUsedOnPage,
  rowsCountFor,
  loadContentRegistry,
  defaultNodeFor,
  validateContentModules,
  applyContentModule,
  writeContentModuleIntoDraft,
  mechanicVariantLabel,
  promoVariantLabel,
};
