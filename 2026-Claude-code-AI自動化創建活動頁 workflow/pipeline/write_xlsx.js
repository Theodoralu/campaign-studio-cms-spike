/**
 * ③ 寫入工作簿 v2：snapshot ＋ draft ＋ gate_report → 四分頁 .xlsx（依 03 schema v1.0 契約）
 * 用法：node write_xlsx.js <run 資料夾>
 *
 * v2 契約對齊（2026-07-17 對抗性審查修補）：
 *   P1/P3 改「一列＝一個活動頁／一次抓取」橫式；欄位碼 A1~F3 對映契約 §2；
 *   P2 補 G1（頁面ID/模組位置/排序）＋G5（優惠標籤 🔒）；G7/G8 圖欄改 🎚 色、F1 樓層標題 ✍️ 色；
 *   P4 全枚舉鏡像＋來源版本註記（R5）；顯示開關（是/否）下拉接上 C5/C7/C8；
 *   gate_report 以 draft/snapshot sha256 綁定——指紋不符＝拒產出（防閘後竄改洗 PASS）。
 *
 * v3（2026-07-20 使用者裁決 U7⑦）：
 *   P1 表尾附加「C9 KV中文眉標mobile顯示」🎚（下拉引用 P4 新枚舉 kvEyebrowCnMobile＝auto|hide|show，預設 auto）；
 *     欄位邏輯編號 C9、物理位置附加於表尾（U7 逐字「不得插入中段以免既有欄位位移」；Sheets C 區對應 BM，
 *     本腳本產表欄位總數隨樓層/牆數浮動、物理字母以實際產出為準）；表頭儲存格備註載量測基準 430px（iPhone 16 Plus）。
 *
 * v4（2026-07-20 使用者裁決 U8⑧＋U9⑨）：
 *   E0「本期活動來源模式promoSourceMode」附加於 P1 表尾（C9 之後）：🎚、預設 auto、下拉引用 P4 新枚舉
 *     promoSourceMode（auto|promo-activity|brand-recommend|product-fallback）；auto＝依三層優先序混填
 *     （1.優惠活動→2.品牌商品推薦→3.商品替補）、其餘值＝強制單一來源（Sheets v4 對應 P1 BN＋P4 O；
 *     本腳本欄位總數隨樓層/牆數浮動、物理字母以實際產出為準）。
 *   U9 命名慣例「代號＋中文名＋englishKey」：C9 表頭改「C9 KV眉標中文mobile顯示kvEyebrowCnMobile」（與 xlsx v4 逐字一致）。
 *   P0 資訊架構分頁改由本腳本產出（排第一分頁）：從「實際寫入的表頭」程式化生成完整欄位對照
 *     （模組堆疊對照＋P1 全欄對照含權限/下拉來源＋P2/P3/P4 一覽＋重點填寫規則）——欄名一致性由建構保證（U9）。
 *
 * v5（2026-07-20 使用者裁決 U16⑯）：
 *   E6「本期活動模組標題promoModuleTitle」附加於 P1 表尾（E0 之後）：✍️ 黃表頭、預設「本期活動」；
 *     模組 h2 標題隨 AI 策展內容組成重新撰寫（04 §3 titleSource 規則：有優惠資料→標題優先曝光優惠資訊
 *     且優惠詞真值逐字、無優惠資料→AI 策展命名禁無真值數字優惠詞；「本期活動」＝promo-truth 預設前綴、非固定文案）；
 *     dock 錨點同步資料層 dockPromoLabel（≤5 全形字短標，沿 dockFeaturedLabel 模式，14 §2.9；Sheets 欄位化留待後續提案）；
 *     表尾附加不插中段（同 C9/E0 原則；表頭 note 引 04 §3）。
 *
 * v6（2026-07-20 使用者裁決 U18⑱＋收編 v4 手工欄）：
 *   A. U18 品類牆 3~5 組（預設 3）：P1 牆標題欄擴至 牆4~8（F1.4~F1.8；樓層編號連續制——樓層1-3＝主打、
 *      牆4~8＝品類牆1~5；牆6/7/8 值空＝未啟用，超出 draft 實有牆數的標題欄附加表尾）＋新增
 *      「categoryWallCount 品類牆數量」🎚 欄（enum 3|4|5 下拉引用 P4 新枚舉、預設 3、note 載 U18）；
 *      P2「模組位置」枚舉 wall-1/wall-2 擴至 wall-1~wall-5；dock 錨點隨牆數連動（預設 3 牆時 6→7，dock 具橫滑 rail）；
 *      14 號契約 walls[]「恰 2」改 3~5（契約修訂另案）；P0 由表頭程式化生成、自動涵蓋新欄。
 *   B. 收編使用者匯入檔 v4 手工加欄（整檔重生不再手工 patch；~/Downloads 匯入檔不動、整檔重生留待 wall3 資料入 draft 後統一做）：
 *      ①「D0 KV版型kvVariant」🎚（下拉＝裸值全值域、值取 normalizeKvVariant(draft.page.kvVariant) 預設 new；P4 枚舉 kvVariant）
 *      ②「D7/D8/D9 KV主打商品1~3商品頁url」🔒（draft 實際欄名確認＝kv.keyProductGdids[i]→draft.products[].url 對應；
 *        kv.keyProducts[i].url 不存在於現行 draft、保留為優先讀取以備 schema 演進；缺值容空）
 *      ③ 欄位順序沿 v4 慣例：60 基礎欄後＝kvVariant→D7~D9→C9→E0→E6→（新）牆6~8標題→categoryWallCount
 *        （附加制、不插中段；物理字母隨牆/樓層數浮動、以表頭定位）。
 *
 * v7（保留版位）：A7/A8 previewUrl 欄＝13 號 §13.6 所見即所得預覽（N-22 未落地；原文誤標 N-20，2026-07-21 U24 13-3 改編 N-22）——落地時取本版號。✅ 2026-07-23 N-22 落地（v9 批取本保留版位）。
 * v9（2026-07-22 裁決 22-1~22-4／2026-07-23 N-22 落地）：
 *   A7「預覽連結previewUrl」＋A8「預覽建置時間previewBuiltAt」表尾附加（取 v7 保留版位；🔒 系統生成唯讀＝13-1）：
 *   A7＝「最後建置版」?dataset=<key> 完整網址（13-4 (a)；22-1＝?draftUrl= 不入 A7、留變更單送單前自查）；
 *   A8＝stage2 產表時刻 ISO8601（22-3「建置＝產表時點」語意）；datasetKey＝draft.page.datasetKey（14 號提案欄）
 *   或 DATASET_BY_RUN 對照；無 key＝兩欄空（尚無建置版）；遷站＝批次重填 SOP（改 PREVIEW_BASE 重生成全欄，禁逐格手改）。
 *
 * v8（2026-07-20 使用者裁決㉗㉘／2026-07-21 條文落地）：
 *   A. U27㉗ 牆N商品數wallProductCount per-wall 欄 ×5（N=4~8＝品類牆1~5，沿 F1.4~F1.8 樓層編號連續制；
 *      邏輯代號 F1.Nq＝牆標題伴生欄，正式代號（2026-07-21 裁決⑬ 轉正、原「暫定/掛收斂會」語去除））：🎚 下拉 P4 新枚舉 wallProductCount＝4|8|12、
 *      值＝draft.page.walls[i] 實有商品件數字串、牆未啟用＝空；與 P2 該牆商品列實數一致性＝機器閘 CP-21；
 *      物理位置＝categoryWallCount 之後附加、不插中段（U7 鐵則）。
 *   B. U28㉘/U28b 看更多 per 位置雙欄 ×8（n=1~8：樓層1~3＋牆4~8）：F7.n 看更多開關moreLinkToggle
 *      （🎚 on|off 預設 on）＋F8.n 看更多URLmoreLinkUrl（✍️ AI 初稿＝策展目的地、off 時可留值備用）；
 *      約束＝≠自身 scene 卡 URL（Blocking）＋全頁唯一＋主題切合＝機器閘 CP-22；缺欄＝退全域 moreUrl 舊行為。
 *   C. P4 枚舉新增 wallProductCount／moreLinkToggle（隨 R5 版本註記）；P2 模組位置枚舉補 editorial-wall
 *      （編輯精選商品牆＝過渡建模值：14 契約 editorial 商品牆建模前、該 12 件曝光列的落位；CP-18 依 U22 排除）。
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const ExcelJS = require("exceljs");
const { normalizeKvVariant } = require("./lib/proposal_pack"); // 2026-08-24 W1-A：kvVariant 拼法合帳（51 §2.6）

const FILL = {
  "🔒": { type: "pattern", pattern: "solid", fgColor: { argb: "FFD9D9D9" } },
  "✍️": { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFF2CC" } },
  "🎚": { type: "pattern", pattern: "solid", fgColor: { argb: "FFD0E0F0" } },
  "sys": { type: "pattern", pattern: "solid", fgColor: { argb: "FFEAD1DC" } },
};
const RED_FONT = { color: { argb: "FFCC0000" }, bold: true };

// P4 枚舉鏡像（R5：單一來源＝03 schema v1.0＋色彩規劃 02 v1.0；禁止在此新增值）
const ENUMS = {
  "狀態": ["草稿", "調修中", "待建置", "已建置"],
  "版型選擇": ["MVP-v1"],
  "模組位置": ["kv", "featured-1", "featured-2", "featured-3", "wall-1", "wall-2", "wall-3", "wall-4", "wall-5", "promodeal", "explore", "editorial-wall"], // U18 裁決⑱ 2026-07-20：品類牆 3~5 組 → wall-3/4/5 入庫；editorial-wall＝v8 過渡建模值（編輯精選商品牆曝光列；14 契約 editorial 建模前落位、CP-18 依 U22 排除）
  "標籤來源": ["offer", "feature", "無"],
  "顯示開關": ["是", "否"],
  "hueFamily": ["pink-plum", "gold-bronze", "green-sage", "blue-calm", "mono", "custom"], // mono 黑灰白 2026-07-18 入庫（R5 枚舉同步）；custom＝自訂品牌色推導（2026-07-25 入庫，工作台選 🎨 自訂色時寫入，鏡像同步防 P4 下拉脫鉤）
  "surfaceMode": ["light", "dark"],
  "kvTitleStyle": ["vivid", "deep"],
  "moduleBorderStyle": ["none", "theme", "black"],
  "labelStyle": ["deep-plate", "bright-plate"],
  "colorTheme": ["mono-light", "custom-light", "custom-dark"], // mono-light 補列（2026-07-19 使用者裁決定版；依色彩規劃02 mono 家族 2026-07-18 入庫、Figma Surface mode mono-light/mono-dark；其餘值 WP2b 定版後鏡像）；custom-light/custom-dark＝自訂品牌色（2026-07-25 入庫，鏡像同步防 P4 下拉選不到自訂值）
  "kvEyebrowCnMobile": ["auto", "hide", "show"], // U7 裁決⑦ 2026-07-20 入庫：mobile 下 kv-offer-box 放不下時中文眉標顯示模式（auto=溢出自動偵測隱藏＝預設）
  "promoSourceMode": ["auto", "promo-activity", "brand-recommend", "product-fallback"], // U8 裁決⑧ 2026-07-20 入庫：E0 本期活動來源模式（auto=依三層優先序混填＝預設）
  "kvVariant": ["new", "legacy", "layout-001", "layout-002", "layout-003", "layout-004", "layout-005", "layout-006", "layout-007", "layout-008", "layout-009", "layout-010", "layout-011", "layout-012"], // 2026-08-24 拼法合帳（51 §2.6）＝裸值制、九版式擴編（值域真源＝modules.json hero variants）；layout-011 中秋團圓＝W1-B11 鏡射 append（2026-08-28）；kv- 前綴舊拼法（2026-07-21 裁決⑮）讀入正規化、不再輸出
  "categoryWallCount": ["3", "4", "5"], // U18 裁決⑱ 2026-07-20 入庫：品類牆數量（預設 3；至少曝光 3 組、至多 5 組）
  "wallProductCount": ["4", "8", "12"], // U27 裁決㉗ 2026-07-20（2026-07-21 落地 v8）：品類牆商品數＝4 的倍數（一行四品；8＝上下兩行、12＝三行）；一致性＝CP-21
  "moreLinkToggle": ["on", "off"], // U28b 裁決㉘ 2026-07-20（2026-07-21 落地 v8）：per 位置看更多開關（off＝不渲染；URL 可留值備用）
};
const ENUM_SOURCE = "鏡像來源：03_GoogleSheets_Schema_v1.md v1.0（2026-07-17）＋色彩規劃02 v1.0；wallProductCount=4|8|12 新增（R5 版本註記 2026-07-21：使用者裁決 U27㉗ 2026-07-20——品類牆商品數＝4 的倍數；desktop 一行四品陣列、8 件＝上下兩行；一致性＝機器閘 CP-21）；moreLinkToggle=on|off 新增（R5 版本註記 2026-07-21：使用者裁決 U28㉘/U28b 2026-07-20——per 位置看更多開關；off＝不渲染、URL 可留值備用；唯一性＋主題切合＝機器閘 CP-22）；模組位置補 editorial-wall（R5 版本註記 2026-07-21：編輯精選商品牆曝光列之過渡建模值——14 契約 editorial 建模前落位、CP-18 依 U22 排除；第四次擴圈候補）；colorTheme=mono-light 補列（R5 版本註記 2026-07-19：使用者裁決定版，依 02 色彩 mono 家族 2026-07-18 入庫）；kvEyebrowCnMobile=auto|hide|show 新增（R5 版本註記 2026-07-20：使用者裁決 U7⑦——自動偵測為預設＝auto，量測基準以手機寬度 430px（iPhone 16 Plus）為主）；promoSourceMode=auto|promo-activity|brand-recommend|product-fallback 新增（R5 版本註記 2026-07-20：使用者裁決 U8⑧——auto＝依三層優先序 1.優惠活動→2.品牌商品推薦→3.商品替補 混填＝預設，其餘值＝強制單一來源）；kvVariant=kv-new|kv-legacy 收編（R5 版本註記 2026-07-20：2026-07-19 欄位化、v4 手工欄 v6 收編進產表腳本；拼法定案 kv-new|kv-legacy＝2026-07-21 使用者裁決⑮）；kvVariant 裸值合帳＋九版式擴編（R5 版本註記 2026-08-24：51 號 §2.6 使用者裁決＝kv- 前綴退場、讀入正規化 normalizeKvVariant；值域真源＝modules.json hero variants，layout-001~009 隨 M1 定版登錄）；模組位置擴 wall-3|wall-4|wall-5＋categoryWallCount=3|4|5 新增（R5 版本註記 2026-07-20：使用者裁決 U18⑱——品類牆預設 3 組、至少曝光 3 組至多 5 組）；禁止在此新增值（R5：規格改版時由 Claude 同步）";

const yn = (b) => (b ? "是" : "否");

async function main() {
  const runDir = process.argv[2];
  if (!runDir) { console.error("用法：node write_xlsx.js <run 資料夾>"); process.exit(1); }
  const raw = (f) => fs.readFileSync(path.join(runDir, f));
  const snapRaw = raw("snapshot.json"), draftRaw = raw("draft.json");
  const snap = JSON.parse(snapRaw.toString("utf8"));
  const draft = JSON.parse(draftRaw.toString("utf8"));

  // ---- gate_report 指紋綁定（拒收過期/不符的報告） ----
  let gate;
  try { gate = JSON.parse(raw("gate_report.json").toString("utf8")); }
  catch { console.error("找不到 gate_report.json——先執行 gate.js（機器閘未跑不得產表）"); process.exit(1); }
  const sha = (b) => crypto.createHash("sha256").update(b).digest("hex");
  if (gate.draftSha256 !== sha(draftRaw) || gate.snapshotSha256 !== sha(snapRaw)) {
    console.error("gate_report 指紋與現行 draft/snapshot 不符（報告過期或檔案已改）——重跑 gate.js 後再產表");
    process.exit(1);
  }

  const wb = new ExcelJS.Workbook();
  wb.creator = "AI活動頁 pipeline (A1 v2)";
  const gateBanner = `${gate.result}（FAIL ${gate.counts.FAIL}／WARN ${gate.counts.WARN}）@ ${gate.checkedAt}`;

  /* ---------- P4 枚舉鏡像（先建，供下拉引用） ---------- */
  const p4 = wb.addWorksheet("P4 枚舉鏡像");
  const enumKeys = Object.keys(ENUMS);
  p4.columns = [...enumKeys.map((k) => ({ header: k, width: 15 })), { header: "來源版本（R5）", width: 60 }];
  p4.getRow(1).font = { bold: true };
  const maxLen = Math.max(...enumKeys.map((k) => ENUMS[k].length));
  for (let i = 0; i < maxLen; i++) p4.addRow([...enumKeys.map((k) => ENUMS[k][i] || null), i === 0 ? ENUM_SOURCE : null]);
  const colLetter = (n) => { let s = ""; for (let x = n; x > 0; x = Math.floor((x - 1) / 26)) s = String.fromCharCode(65 + ((x - 1) % 26)) + s; return s; };
  const enumRef = (k) => { const c = colLetter(enumKeys.indexOf(k) + 1); return `'P4 枚舉鏡像'!$${c}$2:$${c}$${ENUMS[k].length + 1}`; };
  const dvList = (cell, k) => { cell.dataValidation = { type: "list", allowBlank: true, formulae: [enumRef(k)] }; };

  /* ---------- P1 活動頁主表（一列＝一個活動頁，欄位碼對映契約 §2） ---------- */
  const kv = draft.page.kv || {};
  const theme = draft.page.theme || {};
  const entries = draft.page.promoEntries || [];
  const floors = draft.page.floors || [];
  const walls = draft.page.walls || [];

  // [欄位碼＋名稱, 值, 權限, 枚舉名(掛下拉)]
  const P1COLS = [
    ["A1 頁面ID", draft.page.id || "", "sys"],
    ["A2 活動頁名稱", draft.page.pageName || "", "✍️"],
    ["A3 狀態", draft.page.status || "草稿", "🎚", "狀態"],
    ["A4 來源URL", snap.sourceUrl, "🔒"],
    ["A5 抓取快照", path.join(runDir, "snapshot.json"), "sys"],
    ["A6 版型選擇", draft.page.template || "MVP-v1", "🎚", "版型選擇"],
    ["B1 主題配色hueFamily", theme.hueFamily || "", "🎚", "hueFamily"],
    ["B2 色彩主題colorTheme", theme.colorTheme || "", "🎚", "colorTheme"],
    ["B3 明暗surfaceMode", theme.surfaceMode || "", "🎚", "surfaceMode"],
    ["B4 標題配色kvTitleStyle", theme.kvTitleStyle || "", "🎚", "kvTitleStyle"],
    ["B5 模組線框moduleBorderStyle", theme.moduleBorderStyle || "", "🎚", "moduleBorderStyle"],
    ["B6 標籤樣式labelStyle", theme.labelStyle || "", "🎚", "labelStyle"],
    ["C1 KV眉標(拉丁)", kv.eyebrow || "", "✍️"],
    ["C2 KV眉標(中文)", kv.eyebrowZh || "", "✍️"],
    ["C3 KV標題第一行", kv.titleLine1 || "", "✍️"],
    ["C4 KV標題第二行(數字🔒)", kv.titleLine2 || "", "✍️"],
    ["C5 起字顯示", yn(kv.showSuffix), "🎚", "顯示開關"],
    ["C6 活動日期", kv.dateValue || "", "🔒"],
    ["C6a KV主軸actid", kv.actid || "", "🔒"],
    ["C7 標題掀牌titleFlip", yn(kv.titleFlip !== false), "🎚", "顯示開關"],
    ["C8 跑馬燈showMarquee", yn(kv.showMarquee !== false), "🎚", "顯示開關"],
    ["D1 KV主圖", (kv.images || [])[0] || "", "🎚"],
    ["D2 KV副圖1", (kv.images || [])[1] || "", "🎚"],
    ["D3 KV副圖2", (kv.images || [])[2] || "", "🎚"],
    ["D4 KV主打商品1(gdid)", (kv.keyProductGdids || [])[0] || "", "🔒"],
    ["D5 KV主打商品2(gdid)", (kv.keyProductGdids || [])[1] || "", "🔒"],
    ["D6 KV主打商品3(gdid)", (kv.keyProductGdids || [])[2] || "", "🔒"],
  ];
  for (let i = 0; i < 4; i++) {
    const e = entries[i] || {};
    P1COLS.push(
      [`E1.${i + 1} 入口${i + 1}標籤chip`, e.chip || "", "✍️"],
      [`E2.${i + 1} 入口${i + 1}文案`, e.copy || "", "✍️"],
      [`E3.${i + 1} 入口${i + 1}檔期`, e.dateValue || "", "🔒"],
      [`E4.${i + 1} 入口${i + 1}圖`, e.img || "", "🎚"],
      [`E5.${i + 1} 入口${i + 1}連結`, e.url || "", "🔒"],
    );
  }
  const floorsAll = [...floors.map((f) => ({ ...f, kind: "樓層" })), ...walls.map((w) => ({ ...w, kind: "牆" }))];
  floorsAll.forEach((f, i) => {
    P1COLS.push([`F1.${i + 1} ${f.kind}${i + 1}標題`, f.title || "", "✍️"]);
    if (f.kind === "樓層") {
      P1COLS.push(
        [`F2.${i + 1} 樓層${i + 1}情境卡圖`, f.sceneImg || "", "🎚"],
        [`F3.${i + 1} 樓層${i + 1}情境卡文案`, f.sceneCopy ? `${f.sceneCopy.tag || ""}｜${f.sceneCopy.title || ""}｜${f.sceneCopy.sub || ""}` : "", "✍️"],
      );
    }
  });
  P1COLS.push(["CTA文案", draft.page.ctaText || "", "✍️"], ["機器閘結果", gateBanner, "sys"]);
  // ---- 表尾附加區（附加制、不插中段；順序沿 v4 匯入檔慣例：kvVariant→D7~D9→C9→E0→E6→牆6~8→categoryWallCount）----
  // v6 收編①（v4 手工欄）：D0 KV版型kvVariant——🎚 下拉＝裸值全值域（new|legacy|layout-001~009；2026-08-24 拼法合帳）、預設 new；舊 draft 帶 kv- 前綴＝讀入正規化
  P1COLS.push(["D0 KV版型kvVariant", normalizeKvVariant(draft.page.kvVariant) || "new", "🎚", "kvVariant"]);
  // v6 收編②（v4 手工欄）：D7~D9 KV主打商品1~3商品頁url——🔒 灰表頭；draft 實際欄名＝kv.keyProductGdids[i]→
  // draft.products[].url 由 gdid 對應（kv.keyProducts[i].url 現行 draft 不存在、保留優先讀取以備 schema 演進）；缺值容空
  const urlByGdid = new Map((draft.products || []).map((p) => [p.gdid, p.url]));
  for (let i = 0; i < 3; i++) {
    const kpUrl = (kv.keyProducts || [])[i]?.url || urlByGdid.get((kv.keyProductGdids || [])[i]) || "";
    P1COLS.push([`D${7 + i} KV主打商品${i + 1}商品頁url`, kpUrl, "🔒"]);
  }
  // U7⑦（2026-07-20）：C9 附加於表尾（逐字「不得插入中段以免既有欄位位移」）；邏輯編號 C9、物理欄＝表尾
  // 表頭命名依 U9⑨ 慣例「代號＋中文名＋englishKey」（與 xlsx v4 逐字一致）
  P1COLS.push(["C9 KV眉標中文mobile顯示kvEyebrowCnMobile", kv.eyebrowCnMobile || "auto", "🎚", "kvEyebrowCnMobile"]);
  // U8⑧（2026-07-20）：E0 附加於表尾 C9 之後（Sheets v4 對應 BN）；邏輯編號 E0（E 區本期活動來源模式）
  P1COLS.push(["E0 本期活動來源模式promoSourceMode", draft.page.promoSourceMode || "auto", "🎚", "promoSourceMode"]);
  // U16⑯（2026-07-20）：E6 附加於表尾 E0 之後（不插中段）；邏輯編號 E6（E 區本期活動模組標題）；✍️ 黃表頭、預設「本期活動」
  P1COLS.push(["E6 本期活動模組標題promoModuleTitle", draft.page.promoModuleTitle || "本期活動", "✍️"]);
  // U18⑱（2026-07-20）：品類牆擴至至多 5 面（樓層編號連續制：樓層1-3＝主打、牆4~8＝品類牆1~5）——
  // draft 實有牆欄仍由 floorsAll 迴圈就地生成（既有欄零位移），超出實有牆數的標題欄附加表尾、值空＝未啟用
  const WALL_MAX = 5;
  for (let w = walls.length; w < WALL_MAX; w++) {
    const n = floors.length + w + 1;
    P1COLS.push([`F1.${n} 牆${n}標題`, "", "✍️"]);
  }
  // U18⑱（2026-07-20）：categoryWallCount 品類牆數量——🎚 enum 3|4|5、預設 3（值以文字寫入以符 P4 下拉字面比對）
  P1COLS.push(["categoryWallCount 品類牆數量", String(draft.page.categoryWallCount || 3), "🎚", "categoryWallCount"]);
  // U27㉗（2026-07-20 裁決／2026-07-21 落地 v8）：牆N商品數 per-wall 欄 ×5（N=4~8；F1.Nq＝牆標題伴生欄，正式代號＝2026-07-21 裁決⑬ 轉正）——
  // 值＝該牆實有商品件數字串（與宣告欄一致性＝CP-21）、牆未啟用＝空；categoryWallCount 之後附加不插中段
  for (let w = 0; w < WALL_MAX; w++) {
    const n = floors.length + w + 1;
    const wall = walls[w];
    const cnt = wall ? (wall.productGdids || wall.wallProductRefs || wall.products || []).length : 0;
    P1COLS.push([`F1.${n}q 牆${n}商品數wallProductCount`, cnt ? String(cnt) : "", "🎚", "wallProductCount"]);
  }
  // U28㉘/U28b（2026-07-20 裁決／2026-07-21 落地 v8）：看更多 per 位置雙欄 ×8（n=1~8：樓層1~3＋牆4~8）
  for (let n = 1; n <= floors.length + WALL_MAX; n++) {
    const isFloor = n <= floors.length;
    const box = isFloor ? floors[n - 1] : walls[n - floors.length - 1];
    const kind = isFloor ? "樓層" : "牆";
    const ml = box?.moreLink;
    P1COLS.push([`F7.${n} ${kind}${n}看更多開關moreLinkToggle`, box ? (ml?.enabled || "on") : "", "🎚", "moreLinkToggle"]);
    P1COLS.push([`F8.${n} ${kind}${n}看更多URLmoreLinkUrl`, ml?.url || "", "✍️"]);
  }
  // N-22（2026-07-22 裁決 22-1~22-4／2026-07-23 落地 v9）：A7/A8 取 v7 保留版位（表尾附加、不插中段）
  // A7＝「最後建置版」?dataset=<key> 完整網址（13-4 (a)；22-1）；A8＝stage2 產表時刻（22-3）；🔒 系統生成唯讀（13-1）
  const PREVIEW_BASE = "https://solid-pancake-38klg7k.pages.github.io/lecreuset-frametest/"; // 遷移 #6（2026-09-20）：美國 GHE 9/19 停權→台灣技術文件站示範頁（公司 GitHub 帳號登入）；#4（08-04）曾為美國內網站；13-4 SOP＝改此值＋全 run 重生成
  const DATASET_BY_RUN = { "2026-07-17-lecreuset": "lecreuset", "2026-07-19-titanium": "titanium", "2026-07-20-titanium-refresh": "titanium" }; // 遷站批次重填 SOP 錨點（13-4）：域名變更＝改 PREVIEW_BASE 重生成全欄，禁逐格手改
  const dsKey = draft.page.datasetKey || DATASET_BY_RUN[draft.page.id] || "";
  P1COLS.push(["A7 預覽連結previewUrl", dsKey ? `${PREVIEW_BASE}?dataset=${dsKey}` : "", "🔒"]);
  P1COLS.push(["A8 預覽建置時間previewBuiltAt", dsKey ? new Date().toISOString() : "", "🔒"]);

  const p1 = wb.addWorksheet("P1 活動頁主表");
  p1.columns = P1COLS.map((c) => ({ header: c[0], width: Math.min(Math.max(c[0].length + 4, 14), 40) }));
  const h1 = p1.getRow(1);
  h1.font = { bold: true };
  P1COLS.forEach((c, i) => { if (FILL[c[2]]) h1.getCell(i + 1).fill = FILL[c[2]]; });
  // A7/A8 表頭備註（N-22：2026-07-22 裁決 22-1~22-4／2026-07-23 落地 v9）
  const a7Idx = P1COLS.findIndex((c) => c[0].startsWith("A7 "));
  if (a7Idx >= 0) h1.getCell(a7Idx + 1).note = "N-22（22-1／13-4）：目標語意＝「最後建置版」?dataset=<key> 完整網址；行動預覽變體＝尾加 &device=mobile（?device= 通道，375/768/desktop）；?draftUrl= 不入本欄（留變更單「送單前自查」場景）；🔒 系統生成唯讀（13-1 真值鐵律同款）；遷站＝批次重填 SOP：站點域名變更由 pipeline 以 dataset 對照批次重生成全欄，禁逐格手改";
  const a8Idx = P1COLS.findIndex((c) => c[0].startsWith("A8 "));
  if (a8Idx >= 0) h1.getCell(a8Idx + 1).note = "N-22（22-3）：「建置」＝stage2 產表時點——本欄＝產表時刻 ISO8601（URL 確定性生成、與 A7 語意一致；誠實性缺口補強：非上線時刻、非快照時刻）；🔒 系統生成唯讀";
  // C9 表頭備註（U7⑦）：量測基準＋auto 語意
  const c9Idx = P1COLS.findIndex((c) => c[0].startsWith("C9 "));
  if (c9Idx >= 0) h1.getCell(c9Idx + 1).note = "U7（2026-07-20 裁決⑦）：以手機寬度 430px（iPhone 16 Plus）為主；auto=溢出自動隱藏中文眉標；拉丁眉標仍放不下→ellipsis 截斷為最後防線；預設 auto";
  // E0 表頭備註（U8⑧）：三層優先序＋裁決出處
  const e0Idx = P1COLS.findIndex((c) => c[0].startsWith("E0 "));
  if (e0Idx >= 0) h1.getCell(e0Idx + 1).note = "U8（2026-07-20 裁決⑧）：本期活動來源三層優先序＝1.優惠活動（ec_promotions/onsale 活動）→2.品牌商品推薦（品牌頁 hotSales/hits 推薦商品）→3.商品替補（商品池主題關鍵商品）；auto=依 1→2→3 優先序混填（補位先取第 2 層品牌推薦、再取第 3 層商品替補）＝預設；promo-activity/brand-recommend/product-fallback=強制單一來源";
  // E6 表頭備註（U16⑯）：04 §3 命名規則＋裁決出處
  const e6Idx = P1COLS.findIndex((c) => c[0].startsWith("E6 "));
  if (e6Idx >= 0) h1.getCell(e6Idx + 1).note = "U16（2026-07-20 裁決⑯）：本期活動模組 h2 標題——隨 AI 策展的內容組成重新撰寫；命名規則＝04 §3 titleSource：有優惠資料→標題優先曝光優惠資訊（優惠詞須真值逐字、過 CP-02）；無優惠資料→依 AI 策展命名（ai-curated 禁無真值數字優惠詞）；「本期活動」四字＝titleSource=promo-truth 時預設前綴、非固定文案（預設值）；dock 錨點同步資料層 dockPromoLabel（≤5 全形字短標，沿 dockFeaturedLabel 模式）";
  // D0 表頭備註（v6 收編）：kvVariant 拼法統一案出處
  const d0Idx = P1COLS.findIndex((c) => c[0].startsWith("D0 "));
  if (d0Idx >= 0) h1.getCell(d0Idx + 1).note = "KV 版型：new（現行＝預設）｜legacy（舊版）｜layout-001~009（新版式九款，2026-08-24 擴編）。拼法沿革：2026-07-21 裁決⑮ kv- 前綴 → 2026-08-24 裸值合帳（51 §2.6；舊拼法讀入自動正規化）";
  // 牆6~8 表尾附加欄表頭備註（U18⑱）：值空＝未啟用
  P1COLS.forEach((c, i) => {
    if (i > e6Idx && /^F1\.\d+ 牆\d+標題$/.test(c[0])) h1.getCell(i + 1).note = "U18（2026-07-20 裁決⑱）：品類牆至多 5 面（樓層編號連續制：牆4~8＝品類牆1~5）；本欄值空＝未啟用；預設曝光 3 面";
  });
  // categoryWallCount 表頭備註（U18⑱）：裁決出處＋dock 連動
  const cwcIdx = P1COLS.findIndex((c) => c[0].startsWith("categoryWallCount"));
  if (cwcIdx >= 0) h1.getCell(cwcIdx + 1).note = "U18（2026-07-20 裁決⑱）：以分類為切入點的品類牆模組（CategoryGroup/categorySections）由預設 2 組改預設 3 組；本欄選擇活動頁出現的品類牆數量＝3|4|5（至少曝光 3 組、至多 5 組）；dock 錨點隨牆數連動（預設 3 牆時 6→7，dock 已有橫滑 rail 機制）；牆6/7/8 標題值空＝未啟用";
  // 牆N商品數／F7.n／F8.n 表頭備註（U27㉗／U28㉘，2026-07-21 落地 v8）
  P1COLS.forEach((c, i) => {
    if (/^F1\.\d+q 牆\d+商品數/.test(c[0])) h1.getCell(i + 1).note = "U27（2026-07-20 裁決㉗、2026-07-21 落地）：品類牆商品數＝4 的倍數（4|8|12；desktop 一行四品陣列、8＝上下兩行、12＝三行）；與 P2 該牆（wall-N）商品列實數一致性＝機器閘 CP-21；值空＝牆未啟用；per-wall 欄＝同頁各牆件數可互異（U27 落地首例鈦案 4/4/8）；邏輯代號 F1.Nq＝正式代號（2026-07-21 裁決⑬ 轉正）";
    if (/^F7\.\d+ /.test(c[0])) h1.getCell(i + 1).note = "U28b（2026-07-20 裁決㉘、2026-07-21 落地）：per 位置看更多開關——off＝該位置不渲染看更多（URL 可留值備用）；缺欄＝退全域 moreUrl 舊行為（向下相容）；預設 on";
    if (/^F8\.\d+ /.test(c[0])) h1.getCell(i + 1).note = "U28（2026-07-20 裁決㉘、2026-07-21 落地）：看更多目的地——AI 初稿＝策展目的地（優先序 p=詞＞brandIds＞品類/分類頁＞品牌頁最後手段；GET 驗 hits>0、品牌集純度 ≥0.8）；約束＝≠自身 scene 卡 URL（Blocking）＋全頁唯一＋主題切合＝機器閘 CP-22";
  });
  p1.addRow(P1COLS.map((c) => c[1]));
  P1COLS.forEach((c, i) => { if (c[3]) dvList(p1.getCell(2, i + 1), c[3]); });
  p1.views = [{ state: "frozen", ySplit: 1, xSplit: 2 }];

  /* ---------- P2 商品明細（契約 §3：G1/G0/G2~G9＋輔助欄） ---------- */
  const P2COLS = [
    ["G1a 頁面ID", "🎚", 16], ["G1b 模組位置", "🎚", 12, "模組位置"], ["G1c 排序", "🎚", 7],
    ["G0 檢查結果", "sys", 42],
    ["G2 gdid", "🔒", 11], ["G3 商品名", "🔒", 44],
    ["G4a 現價", "🔒", 9], ["G4b 原價", "🔒", 9], ["G4c 折數", "🔒", 7],
    ["G5 優惠/活動標籤", "🔒", 16],
    ["G6 商品標籤", "✍️", 16], ["G6a 標籤來源", "🎚", 10, "標籤來源"], ["G6b 標籤原文", "🔒", 24], ["G6c KV縮寫名", "✍️", 20],
    ["G7 商品圖", "🎚", 40], ["G8 情境圖", "🎚", 40],
    ["G9 商品連結", "🔒", 40],
  ];
  const p2 = wb.addWorksheet("P2 商品明細");
  p2.columns = P2COLS.map((c) => ({ header: c[0], width: c[2] }));
  const h2 = p2.getRow(1);
  h2.font = { bold: true };
  P2COLS.forEach((c, i) => { if (FILL[c[1]]) h2.getCell(i + 1).fill = FILL[c[1]]; });
  p2.views = [{ state: "frozen", ySplit: 1 }];

  const byGdid = new Map(snap.products.map((x) => [x.gdid, x]));
  (draft.products || []).forEach((p, i) => {
    const src = byGdid.get(p.gdid) || {};
    const check = (gate.rowResults || [])[i] ?? "未檢查";
    const row = p2.addRow([
      draft.page.id || "", p.position || "", p.order ?? i + 1,
      check,
      p.gdid, p.name, p.price, p.marketPrice ?? "", src.disc ? `${src.disc}折` : "",
      p.offer || "", p.tag || "", p.tagSource || "無", p.tagOriginal || "", p.kvShortName || "",
      p.img || "", p.sceneImg || "", p.url,
    ]);
    if (String(check).startsWith("⚠")) row.getCell(4).font = RED_FONT; // R4 異常標紅
  });
  const nRows = (draft.products || []).length;
  for (let r = 2; r <= nRows + 1; r++) {
    dvList(p2.getCell(`B${r}`), "模組位置");
    dvList(p2.getCell(`L${r}`), "標籤來源");
  }

  /* ---------- P3 策展初稿區（一列＝一次抓取，契約 §4 項目） ---------- */
  const meta = draft.meta || {};
  const promoList = snap.promotions.map((p) => `${p.actid}｜${p.title}｜${p.short}｜${p.period}${p.banner ? "｜banner有" : ""}`).join("\n");
  const poolStat = Object.entries(snap.activities || {}).map(([id, a]) => `actid ${id}：池 ${a.meta?.resultsTotal ?? "?"} 件、已抓 ${a.count} 件（內嵌首批）`).join("\n");
  const subcat = Object.entries(snap.subcatDist || {}).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}×${v}`).join("、");
  const P3COLS = [
    ["抓取時間", snap.fetchedAt, 22],
    ["來源URL", snap.sourceUrl, 40],
    ["品牌/品類判斷", snap.brand || "", 18],
    ["活動賣場清單", promoList, 62],
    ["KV主軸選擇依據", meta.kvRationale || "", 50],
    ["最低折數實算vs活動標題互證", `實算最低 ${snap.minDisc ?? "無"} 折（全池 ${snap.products.length} 件）；${meta.discCrossCheck || ""}`, 46],
    ["樓層分組提案(子類分布)", `${meta.rationale || ""}\n子類分布：${subcat}`, 60],
    ["商品池統計", poolStat, 44],
    ["快照檔路徑", path.join(runDir, "snapshot.json"), 40],
    ["資料侷限warnings", (snap.warnings || []).join("\n") || "無", 50],
    ["人工介入點", meta.humanTouchpoints || "", 50],
  ];
  const p3 = wb.addWorksheet("P3 策展初稿區");
  p3.columns = P3COLS.map((c) => ({ header: c[0], width: c[2] }));
  p3.getRow(1).font = { bold: true };
  const r3 = p3.addRow(P3COLS.map((c) => c[1]));
  r3.alignment = { wrapText: true, vertical: "top" };
  r3.height = 150;
  p3.views = [{ state: "frozen", ySplit: 1 }];

  /* ---------- P0 活動頁資訊架構（U9⑨ 2026-07-20）：從「實際寫入的表頭」程式化生成——欄名一致性由建構保證 ---------- */
  const txt = (c) => { const v = c && c.value; if (v == null) return ""; if (typeof v === "object" && v.richText) return v.richText.map((r) => r.text).join(""); return String(v); };
  const PERM_LABEL = { "🔒": "🔒 真值鎖定", "✍️": "✍️ 文案可修", "🎚": "🎚 開關/選擇", "sys": "sys 系統欄" };
  const p0 = wb.addWorksheet("P0 活動頁資訊架構");
  p0.columns = [{ width: 14 }, { width: 12 }, { width: 46 }, { width: 14 }, { width: 60 }];
  let r0 = 1;
  const W = (vals, opts = {}) => { const row = p0.getRow(r0++); vals.forEach((v, i) => { row.getCell(i + 1).value = v; }); if (opts.bold) row.font = { bold: true }; if (opts.size) row.font = { ...(row.font || {}), size: opts.size, bold: true }; return row; };

  W([`P0 活動頁資訊架構（由實際表頭程式化生成 ${new Date().toISOString().slice(0, 10)}；欄名與各分頁逐字一致）`], { size: 13 });
  W([]);
  W(["【一】頁面模組堆疊（手機版由上至下）與欄位區對照"], { bold: true });
  W(["順序", "模組", "模組說明", "欄位區", ""]);
  [
    ["1", "HorizontalUH", "購物中心表頭", "—（系統）"],
    ["2", "AnchorNav", "浮動 dock 導覽", "F1 樓層標題自動連動＋dockFeaturedLabel（版型層）"],
    ["3", "HeroModule", "KV 主視覺", "B 區配色＋C 區文案（含 C9）＋D 區視覺（D0 版型＋D1~D6＋D7~D9 商品頁url，v6 起本表齊備）"],
    ["4", "CategoryEntry", "本期活動 圓形入口×4（無看更多；h2 標題隨策展內容組成＝E6）", "E 區（E0 來源模式＋E1~E5×4＋E6 模組標題）"],
    ["5", "FeaturedDeal", "主打精選 三樓層（標題隨 AI 策展）", "F1~F3 ×3"],
    ["6", "EditorTopic", "編輯精選（引用本期活動入口）", "—（refEntry 引用）"],
    ["7", "CategoryGroup×N", "品類牆（U18：預設 3 組、可選 3~5；dock 錨點隨牆數連動；U27：每牆商品數＝4 的倍數 4|8|12）", "F1.4~F1.8 牆標題（牆6~8 值空＝未啟用）＋categoryWallCount＋牆N商品數wallProductCount（4|8|12＝CP-21）＋F7.n/F8.n 看更多雙欄（CP-22）＋P2 wall-1~wall-5"],
    ["8", "ExtendedExplore", "延伸探索", "moreUrl＋items（版型層）"],
    ["9", "Notice", "注意事項", "noticeText（v1.2 提案，暫存 P3）"],
    ["10", "Footer", "頁尾", "footerTitle（v1.2 提案，暫存 P3）"],
  ].forEach((row) => W(row));
  W([]);

  W([`【二】P1 活動頁主表——全欄對照（${P1COLS.length} 欄，欄名與 P1 表頭逐字一致）`], { bold: true });
  W(["欄位代號", "P1 欄位置", "欄名（逐字）", "權限", "下拉選項來源（P4）"], { bold: true });
  p1.getRow(1).eachCell((c, col) => {
    const h = txt(c); if (!h) return;
    const code = (h.match(/^([A-Z]\d+(?:\.\d+)?[a-z]?|CTA文案|機器閘結果|categoryWallCount)/) || ["—"])[0];
    const spec = P1COLS[col - 1] || [];
    W([code, colLetter(col), h, PERM_LABEL[spec[2]] || "", spec[3] ? `${spec[3]}：${enumRef(spec[3]).replace(/'/g, "")}` : ""]);
  });
  W([]);

  [[p2, "三", P2COLS], [p3, "四", null]].forEach(([ws, label, cols]) => {
    W([`【${label}】${ws.name}——欄位一覽`], { bold: true });
    W(["欄位代號", "欄位置", "欄名（逐字）", "權限", cols ? "下拉選項來源（P4）" : ""], { bold: true });
    ws.getRow(1).eachCell((c, col) => {
      const h = txt(c); if (!h) return;
      const code = (h.match(/^(G\d+[a-z]?)/) || ["—"])[0];
      const spec = cols ? cols[col - 1] || [] : [];
      W([code, colLetter(col), h, cols ? PERM_LABEL[spec[1]] || "" : "", cols && spec[3] ? `${spec[3]}：${enumRef(spec[3]).replace(/'/g, "")}` : ""]);
    });
    W([]);
  });

  W(["【五】P4 枚舉鏡像——下拉選項字典（真相來源＝02/03 規格與 rules.json，P4 僅鏡射供下拉引用，由 Claude 同步、勿手改）"], { bold: true });
  W(["P4 欄", "枚舉名", "選項值", "", ""], { bold: true });
  p4.getRow(1).eachCell((c, col) => {
    const h = txt(c); if (!h) return;
    const vals = [];
    for (let rr = 2; rr <= maxLen + 1; rr++) { const v = txt(p4.getRow(rr).getCell(col)); if (v) vals.push(v); }
    W([colLetter(col), h, vals.join(" | "), "", ""]);
  });
  W([]);
  W(["【六】重點填寫規則"], { bold: true });
  [
    `R12 KV 主打商品成組：每組＝商品圖URL（D1~D3）＋gdid（D4~D6）＋商品頁url（D7~D9，v6 收編；由 gdid 對應、與 P2 G9 同源），人為改圖須連動`,
    `C9（${colLetter(c9Idx + 1)}）KV眉標中文mobile顯示：auto＝溢出自動隱藏中文眉標｜hide/show 強制；以手機寬度 430px（iPhone 16 Plus）為主；降級順序＝隱藏中文眉標→拉丁眉標截斷`,
    `E0（${colLetter(e0Idx + 1)}）本期活動來源模式：auto＝依優先序 1.優惠活動→2.品牌商品推薦→3.商品替補 混填；其餘值＝強制單一來源（2026-07-20 裁決⑧）`,
    `E6（${colLetter(e6Idx + 1)}）本期活動模組標題：隨 AI 策展內容組成重新撰寫（預設「本期活動」＝promo-truth 前綴、非固定文案）；有優惠→優惠詞真值逐字優先曝光、無優惠→AI 策展命名禁無真值數字優惠詞（04 §3；2026-07-20 裁決⑯）；dock 錨點同步 dockPromoLabel ≤5 全形字`,
    "E 區入口規則（2026-07-20 裁決）：同模組不得重複同活動/URL；活動入口圖預設＝該活動首商品第一張商品圖；商品型入口＝無檔期、標籤限單品詞",
    "F1 樓層標題：隨 AI 策展命名（自動連動 dock 錨點與頁尾），三樓層勿同名",
    `categoryWallCount（${colLetter(cwcIdx + 1)}）品類牆數量：3|4|5、預設 3（U18 2026-07-20 裁決⑱：至少曝光 3 組、至多 5 組）；牆標題欄涵蓋 F1.4~F1.8（牆6~8 值空＝未啟用）；dock 錨點隨牆數連動（預設 3 牆時 6→7，dock 具橫滑 rail）`,
    `D0（${colLetter(d0Idx + 1)}）KV版型kvVariant：new（預設）|legacy|layout-001~009；裸值合帳 2026-08-24（51 §2.6；原 kv- 前綴拼法 2026-07-21 使用者裁決⑮，P4 現值為準；v4 手工欄 v6 收編）`,
    "本表由表頭程式化生成，欄名保證與各分頁一致；規格真相＝03_GoogleSheets_Schema_v1.md",
  ].forEach((t) => W([t]));
  p0.getRow(1).font = { bold: true, size: 13 };

  // 分頁順序 P0→P4（P0 排第一）
  ["P0 活動頁資訊架構", "P1 活動頁主表", "P2 商品明細", "P3 策展初稿區", "P4 枚舉鏡像"].forEach((name, i) => { wb.getWorksheet(name).orderNo = i; });
  wb.views = [{ firstSheet: 0, activeTab: 0 }];

  const outPath = path.join(runDir, `${draft.page.pageName || "activity"}_schema_v1.xlsx`);
  await wb.xlsx.writeFile(outPath);
  console.log(`工作簿完成：${outPath}`);
  console.log(`  P0 資訊架構 ${r0 - 1} 列（表頭程式化生成）｜P1 橫式 ${P1COLS.length} 欄×1 列｜P2 商品 ${nRows} 列｜P3 一次抓取×1 列｜P4 枚舉 ×${enumKeys.length}＋版本註記`);
}

if (require.main === module) {
  main().catch((e) => { console.error("FATAL:", e.message); process.exit(1); });
}
module.exports = { ENUMS }; // 供鏡像絆線測試（R5：ENUMS.kvVariant vs loadRegistries().heroVariantIds）
