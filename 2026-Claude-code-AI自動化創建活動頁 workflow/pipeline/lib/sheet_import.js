"use strict";
/* lib/sheet_import.js —— 用 Excel／Google Sheets 匯出檔一次把三個內文模組（活動資訊卡／主打選品／促銷卡）的格子填好
   立案 2026-09-26（story docs/stories/sheet-import-content-modules.md；使用者當晚裁「今天做完、進單機版」）。
   一條規則（使用者確認）：上傳只是「幫你把格子填好」的一個動作——填完就是普通 CMS 欄位，檢查、編修、發佈前檢查跟手打一模一樣；CMS 不記得來源。
   四題定案：.xlsx 一檔多分頁（含 Google Sheets 匯出檔）／整模組覆寫、先備份、對帳預覽／雲端同步第一階段不做。
   **版面怎麼選（2026-09-27 使用者走查後改版＝範本 v3）**：原「分頁最上面一格下拉」讓四款版面擠在同一張表，用戶要猜哪欄該填——改成
   **每款版面一個分頁，選分頁＝選版面**；每頁只列這款會畫的欄位、表單式（一行一欄：欄位｜填不填｜你填這裡｜範例｜建議字數｜圖上編號），
   對照圖放頁面最上方，頂端寫清楚「活動頁只會出現一款活動資訊卡：四個分頁選一個填」。主打選品同表單式；促銷卡維持表格（一列一張）但 A 欄預填「第幾張」。
   真源：欄位表全讀 content_modules.js（欄位、列數、贈品圖張數、選品位、促銷卡上限），範本由它產、不手抄第二份；版面白話名由登記簿 meaning 推；
   建議字數＝lib/content_module_char_limits.json（tools/sheet_template_guide.js 量的）＋搶購鈕沿 rules.json；對照圖＝workbench/public/sheet-template-guide/。
   解析器認的是「欄位名」與「── 段落 ──」標記，不靠列號；商品欄收「賣場編號或商品網址」——這裡只驗格式、不碰網路（鐵律 2：真值由伺服器 productFetch 實抓＋R3 入池）。 */
const ExcelJS = require("exceljs");
const fs = require("fs");
const path = require("path");
const CM = require("./content_modules.js");

const SHEET = { start: "開始", mechanic: "活動資訊卡", mechanicPrefix: "活動資訊卡・", spotlight: "主打選品", promoCard: "促銷卡" };
const EXAMPLE_PREFIX = "（範例）";
const ROW_IMG_LABELS = { rewardImg1: "贈品圖 1", rewardImg2: "贈品圖 2" };
const BANNER_COLS = [["badgeText", "角標"], ["titleLine1", "標題第一行"], ["titleLine2", "標題第二行"], ["url", "共用連結"], ["img1", "圖 1"], ["url1", "圖 1 連結"], ["img2", "圖 2"], ["url2", "圖 2 連結"], ["img3", "圖 3"], ["url3", "圖 3 連結"]];
const ROW_COLS = ["label", "brandName", "offerText", "thresholdText", "rewardText", "rewardImg1", "rewardImg2", "ctaText", "ctaUrl"];
const rowColLabel = (k) => ROW_IMG_LABELS[k] || (k === "ctaUrl" ? "活動連結（搶購連結）" : CM.ROW_FIELD_LABELS[k]);
const SPOT_COLS = [["badgeText", "角標"], ["title", "標題"], ["subtitle", "副標"], ["capsuleText", "大卡・膠囊字"], ["diagonalText", "大卡・斜帶字"], ["offerLine", "大卡・優惠一行"], ["hero", "大卡・商品（賣場編號或商品網址）"], ["ref1", "右欄第 1 件商品（賣場編號或商品網址）"], ["ref2", "右欄第 2 件商品（賣場編號或商品網址）"]];
const PROMO_COLS = [["capsuleText", "膠囊字"], ["diagonalText", "斜帶字"], ["offerLine", "優惠一行"], ["priceNote", "價格註記"], ["ref", "商品（賣場編號或商品網址）"]];
const PROMO_INDEX_HEADER = "第幾張";
const SECTION = { banner: "── 活動 banner ──", row: (n) => `── 第 ${n} 列 ──`, isRow: (s) => { const m = /^── 第 (\d+) 列 ──/.exec(s || ""); return m ? Number(m[1]) : null; }, is: (s) => /^── /.test(s || "") };
/* 表單欄位（1-based）：A 欄位｜B 填不填｜C 你填這裡｜D 範例｜E 建議字數｜F 圖上編號 */
const FORM = { label: 1, need: 2, value: 3, example: 4, limit: 5, badge: 6 };
const CIRCLED = ["①", "②", "③", "④", "⑤", "⑥", "⑦", "⑧", "⑨", "⑩"], CIRCLED_RED = ["❶", "❷", "❸", "❹", "❺", "❻", "❼", "❽", "❾", "❿"];

/** 版面白話名：登記簿 meaning「活動資訊卡・優惠卡列三列（…）」→「優惠卡列三列」；推不出來就用貨號（分頁名裡看得到、解析也認貨號） */
function variantOptions(reg) {
  return (reg.mechanicVariants || []).map((v) => { const m = String(v.meaning || "").match(/・([^（(]+)/); return { id: v.id, name: (m ? m[1] : v.id).trim() }; });
}
const norm = (s) => String(s == null ? "" : s).replace(/\s+/g, "").toLowerCase();
function variantIdFor(reg, text) { const t = norm(text); if (!t) return null; const o = variantOptions(reg).find((x) => norm(x.name) === t || norm(x.id) === t); return o ? o.id : null; }
const mechanicSheetName = (o) => SHEET.mechanicPrefix + o.name;

/** 儲存格 → 純文字：Google Sheets／Excel 會把網址變超連結物件、長句變 richText、公式帶 result——一律讀「顯示值」 */
function cellText(cell) {
  const v = cell && cell.value;
  if (v == null) return "";
  if (typeof v === "object") {
    if (Array.isArray(v.richText)) return v.richText.map((r) => r.text || "").join("").trim();
    /* Excel 桌機版把貼進去的網址存成「超連結＋富文本」＝{ text: { richText: [...] }, hyperlink }——原本 String(v.text) 讀成 "[object Object]"，
       任何網址格都被判「不是 Yahoo 網址／不是 https」（2026-09-28 使用者四個檔全中：C27／C29／C40／C47／C54）。text 是物件＝再剝一層；剝不出字＝用 hyperlink。 */
    if (v.text != null) {
      const t = typeof v.text === "object" ? cellText({ value: v.text }) : String(v.text).trim();
      if (t) return t;
      return v.hyperlink ? String(v.hyperlink).trim() : "";
    }
    if (v.result != null) return String(v.result).trim();
    if (v instanceof Date) return v.toISOString().slice(0, 10);
    if (v.hyperlink) return String(v.hyperlink).trim();
    return "";
  }
  return String(v).trim();
}
const isExample = (t) => /^（/.test(String(t || "")); /* 「（範例）」「（字數）」「（說明）」都不是資料 */
const isYahooUrl = (u) => { try { const x = new URL(u); return x.protocol === "https:" && x.hostname === "tw.buy.yahoo.com"; } catch { return false; } };
const isHttpsUrl = (u) => /^https:\/\/[^\s]+$/i.test(u);
const gdidOfRef = (t) => { const s = String(t || "").trim(); if (/^\d{6,10}$/.test(s)) return s; const m = s.match(/[?&]gdid=(\d{6,10})|\/gdsale\/(?:p-)?(\d{6,10})|-(\d{6,10})\.html/); return m ? (m[1] || m[2] || m[3]) : null; };
const okRef = (t) => !!gdidOfRef(t) && (/^\d{6,10}$/.test(String(t).trim()) || isYahooUrl(String(t).trim()));

/* ---------- 範本 ---------- */
const LIMITS_FILE = path.join(__dirname, "content_module_char_limits.json");
const GUIDE_DIR = path.join(__dirname, "..", "workbench", "public", "sheet-template-guide");
const RULES_FILE = path.join(__dirname, "..", "rules.json");
const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return null; } };
const TEMPLATE_VERSION = "v3"; /* v1＝09-26 首版（單頁表格）；v2＝09-27 加圖與字數（單頁＋下拉）；v3＝09-27 每款版面一個分頁＋表單式 */
const GUIDE_IMG_W = 700, GUIDE_IMG_MAXH = 360, ROW_PX = 20; /* 圖最寬 700、最高 360（約 18 列）＝表單不會被推到第二屏 */
const limOf = (bag, key) => { const v = bag && bag[key]; return v && typeof v.min === "number" && v.min > 0 ? v.min : null; };
const charHint = (n) => (n ? `≤${n} 字` : "—");
const NEED = { must: "★ 必填", one: "★ 至少一個", atLeastOne: "★ 至少 1 件", opt: "選填" };
const COLOR = { input: "FFFFF3C4", header: "FFEFEFEF", section: "FFE8ECF7", note: "FF666666", warn: "FFB00020", hint: "FF6B4FD8", blue: "FF3E5BFD" };
const fill = (argb) => ({ type: "pattern", pattern: "solid", fgColor: { argb } });
const colLetter = (c) => String.fromCharCode(64 + c);
/** 字數偏多＝黃色警告、不擋（跟 CMS 寬度尺同一態度） */
function lenWarn(ws, addr, n) {
  ws.getCell(addr).dataValidation = { type: "custom", allowBlank: true, showErrorMessage: true, errorStyle: "warning", errorTitle: "字數偏多", error: `建議 ${charHint(n)}。超過的部分在手機上會被截掉或折行。`, formulae: [`LEN(${addr})<=${n}`] };
}
/** 頁首：標題＋提醒＋成本＋對照圖＋「▼ 往下填」；回傳下一個可用列 */
function sheetHead(wb, ws, title, lines, img) {
  ws.getCell(1, 1).value = title; ws.getCell(1, 1).font = { bold: true, size: 14 };
  let r = 2;
  for (const [text, color] of lines) { ws.getCell(r, 1).value = text; ws.getCell(r, 1).font = { color: { argb: color || COLOR.note }, bold: color === COLOR.warn }; r++; }
  if (img) {
    let buf = null; try { buf = fs.readFileSync(path.join(GUIDE_DIR, img.file)); } catch { buf = null; }
    if (buf) {
      let w = GUIDE_IMG_W, h = Math.round((img.height || 400) * w / (img.width || 1100));
      if (h > GUIDE_IMG_MAXH) { w = Math.round(w * GUIDE_IMG_MAXH / h); h = GUIDE_IMG_MAXH; }
      ws.addImage(wb.addImage({ buffer: buf, extension: "png" }), { tl: { col: 0, row: r - 1 }, ext: { width: w, height: h } });
      r += Math.ceil(h / ROW_PX) + 1;
    }
  }
  ws.getCell(r, 1).value = "▼ 往下填，黃色格子是你要填的地方"; ws.getCell(r, 1).font = { bold: true, color: { argb: COLOR.blue } }; r++;
  return r;
}
function formColumns(ws) { [[FORM.label, 24], [FORM.need, 12], [FORM.value, 46], [FORM.example, 30], [FORM.limit, 12], [FORM.badge, 10]].forEach(([c, w]) => { ws.getColumn(c).width = w; ws.getColumn(c).numFmt = "@"; }); }
function formHeader(ws, r) { const row = ws.getRow(r); row.values = ["欄位", "填不填", "你填這裡 ▼", "範例", "建議字數", "圖上編號"]; row.font = { bold: true }; row.fill = fill(COLOR.header); return r + 1; }
function formSection(ws, r, text) { const c = ws.getCell(r, 1); c.value = text; c.font = { bold: true }; for (let i = 1; i <= 6; i++) ws.getCell(r, i).fill = fill(COLOR.section); return r + 1; }
/** 一行一欄：{label, need, example, limit, badge} */
function formField(ws, r, f) {
  ws.getCell(r, FORM.label).value = f.label;
  ws.getCell(r, FORM.need).value = f.need || NEED.opt; if (f.need && f.need !== NEED.opt) ws.getCell(r, FORM.need).font = { bold: true, color: { argb: COLOR.warn } };
  ws.getCell(r, FORM.value).fill = fill(COLOR.input);
  ws.getCell(r, FORM.example).value = f.example ? EXAMPLE_PREFIX + f.example : ""; ws.getCell(r, FORM.example).font = { italic: true, color: { argb: "FF888888" } };
  ws.getCell(r, FORM.limit).value = f.limit || ""; ws.getCell(r, FORM.limit).font = { color: { argb: COLOR.hint } };
  ws.getCell(r, FORM.badge).value = f.badge || ""; ws.getCell(r, FORM.badge).font = { color: { argb: COLOR.hint } };
  if (f.warnN) lenWarn(ws, `${colLetter(FORM.value)}${r}`, f.warnN);
  return r + 1;
}
const kindHint = (k) => (/^(url|url\d|ctaUrl)$/.test(k) ? "網址" : /^(img\d|rewardImg\d)$/.test(k) ? "圖片網址" : /^(hero|ref\d?|ref)$/.test(k) ? "賣場編號或商品網址" : null);
const BANNER_EXAMPLES = { badgeText: "開館慶", titleLine1: "今天加菜", titleLine2: "好料一次挑齊", url: "https://tw.buy.yahoo.com/activity/onsale?actid=123456", img1: "https://img.yec.tw/…/a.jpg", img2: "https://img.yec.tw/…/b.jpg" };
const ROW_EXAMPLES = { label: "熱銷生鮮", brandName: "海陸管家", offerText: "下單再享95折", thresholdText: "滿1件", rewardText: "打95折", rewardImg1: "https://img.yec.tw/…/gift.jpg", ctaText: "搶購去", ctaUrl: "https://tw.buy.yahoo.com/activity/onsale?actid=123456" };
const SPOT_EXAMPLES = { badgeText: "開館慶", title: "海陸管家 海味好料", subtitle: "新鮮食材↘任選899免運", capsuleText: "生食級海灣貝柱", diagonalText: "SEAFOOD", offerLine: "每盒約250g", hero: "12034942", ref1: "11941676", ref2: "https://tw.buy.yahoo.com/gdsale/gdsale.asp?gdid=11954634" };
const PROMO_EXAMPLE = ["紅玉雞塔香三杯雞", "十八養場", "滿2000享免運", "超值優惠價", "12234229"];
/* 填不填的依據＝欄位字典「機器驗什麼」（tools/lib/field-dictionary.mjs）：CP-31 出貨閘——banner 的圖／第一行標題至少一個非空、每列滿額門檻必填；
   主打選品大卡與促銷卡每張沒挑品＝佔位殘留、出貨擋；右欄至少 1 件。其餘欄不驗＝選填。 */
const BANNER_NEED = { titleLine1: NEED.one, img1: NEED.one };
const ROW_NEED = { thresholdText: NEED.must };
const SPOT_NEED = { title: NEED.must, hero: NEED.must, ref1: NEED.atLeastOne };

/** 活動資訊卡・某版面的欄位清單（給範本與「要填幾格」共用） */
function mechanicFields(vid, mech, ctaMax) {
  const drawn = new Set(CM.rowFieldsFor(vid)); const imgCap = CM.rewardImgsCapFor(vid);
  const banner = BANNER_COLS.map(([k, label], i) => ({ key: k, label, need: BANNER_NEED[k] || NEED.opt, example: BANNER_EXAMPLES[k] || "", limit: kindHint(k) || charHint(limOf(mech.banner, k)), badge: CIRCLED[i], warnN: kindHint(k) ? null : limOf(mech.banner, k) }));
  const rowFields = ROW_COLS.filter((k) => {
    if (k === "rewardImg1" || k === "rewardImg2") return drawn.has("rewardImgs") && Number(k.slice(-1)) <= imgCap;
    if (k === "ctaUrl") return true; /* 整列入口／搶購鈕連結：四款都吃 */
    return drawn.has(k);
  }).map((k) => { const i = ROW_COLS.indexOf(k); const n = k === "ctaText" ? (ctaMax || limOf((mech.rows || {})[vid], k)) : limOf((mech.rows || {})[vid], k); return { key: k, label: rowColLabel(k), need: ROW_NEED[k] || NEED.opt, example: ROW_EXAMPLES[k] || "", limit: kindHint(k) || charHint(n), badge: CIRCLED_RED[i], warnN: kindHint(k) ? null : n }; });
  return { banner, rowFields, rows: CM.rowsCountFor(vid) };
}
const countCells = (fields) => ({ total: fields.length, must: fields.filter((f) => f.need !== NEED.opt).length });

async function buildTemplate(reg) {
  const wb = new ExcelJS.Workbook(); wb.creator = "Campaign Studio";
  const opts = variantOptions(reg);
  const limits = readJson(LIMITS_FILE) || {}; const rules = readJson(RULES_FILE);
  const guide = readJson(path.join(GUIDE_DIR, "manifest.json")); const guideImgs = (guide && guide.images) || [];
  const mech = limits.mechanic || {}; const spot = limits.spotlight || {}; const promo = limits.promoCard || {};
  const ctaMax = (vid) => { const t = rules && rules.charLimits && rules.charLimits.mobile && rules.charLimits.mobile["mechanicCtaText_" + vid]; return (t && t.maxFullwidthChars) || null; };
  const ONLY_ONE = `活動頁只會出現一款活動資訊卡：${opts.length} 個「${SHEET.mechanicPrefix}」分頁選一個填，其他留白。填了兩個以上，帶入時會請你清掉多的。`;
  const overview = []; // 給「開始」分頁的一覽表
  const wsStart = wb.addWorksheet(SHEET.start); /* 先建＝排第一個分頁（exceljs 依建立順序排），內容最後才填 */

  // ── 活動資訊卡：每款版面一個分頁 ──
  for (const o of opts) {
    const ws = wb.addWorksheet(mechanicSheetName(o)); formColumns(ws);
    const F = mechanicFields(o.id, mech, ctaMax(o.id));
    const total = F.banner.length + F.rowFields.length * F.rows; const must = countCells(F.banner).must + countCells(F.rowFields).must * F.rows;
    overview.push({ sheet: mechanicSheetName(o), what: `活動資訊卡的一款版面（${F.rows} 列）`, total: `${total} 格`, must: `${must} 格` });
    const g = guideImgs.find((x) => x.kind === "mechanic" && x.variant === o.id);
    let r = sheetHead(wb, ws, mechanicSheetName(o), [[ONLY_ONE, COLOR.warn], [`這一款要填 ${total} 格（★ ${must} 格）：活動 banner ${F.banner.length} 格＋每列 ${F.rowFields.length} 格 × ${F.rows} 列。圈號對到下面「圖上編號」欄。`]], g);
    r = formHeader(ws, r);
    r = formSection(ws, r, `${SECTION.banner}　左邊那張圖與疊在上面的字`);
    for (const f of F.banner) r = formField(ws, r, f);
    for (let n = 1; n <= F.rows; n++) { r = formSection(ws, r, `${SECTION.row(n)}　右邊優惠卡的第 ${n} 列`); for (const f of F.rowFields) r = formField(ws, r, f); }
    ws.getCell(r + 1, 1).value = "沒填的格子在活動頁上就不顯示。這個區塊沒有商品，圖片欄填圖片網址。"; ws.getCell(r + 1, 1).font = { color: { argb: COLOR.note } };
  }

  // ── 主打選品（表單式） ──
  {
    const ws = wb.addWorksheet(SHEET.spotlight); formColumns(ws);
    const fields = SPOT_COLS.map(([k, label], i) => ({ key: k, label, need: SPOT_NEED[k] || NEED.opt, example: SPOT_EXAMPLES[k] || "", limit: kindHint(k) || charHint(limOf(spot, k)), badge: CIRCLED[i], warnN: kindHint(k) ? null : limOf(spot, k) }));
    const c = countCells(fields); overview.push({ sheet: SHEET.spotlight, what: "一張大卡＋右邊兩張商品卡", total: `${c.total} 格`, must: `${c.must} 格` });
    const g = guideImgs.find((x) => x.kind === "spotlight");
    let r = sheetHead(wb, ws, SHEET.spotlight, [[`要填 ${c.total} 格（★ ${c.must} 格）。商品欄貼賣場編號或商品頁網址；名稱、價格、圖片由系統帶入。`]], g);
    r = formHeader(ws, r);
    r = formSection(ws, r, "── 標題區 ──　右上方的三行字"); for (const f of fields.slice(0, 3)) r = formField(ws, r, f);
    r = formSection(ws, r, "── 左邊大卡 ──"); for (const f of fields.slice(3, 7)) r = formField(ws, r, f);
    r = formSection(ws, r, "── 右欄兩件 ──"); for (const f of fields.slice(7)) r = formField(ws, r, f);
  }

  // ── 促銷卡（表格：一列一張） ──
  {
    const ws = wb.addWorksheet(SHEET.promoCard);
    [[1, 10], [2, 26], [3, 22], [4, 26], [5, 18], [6, 40]].forEach(([c2, w]) => { ws.getColumn(c2).width = w; ws.getColumn(c2).numFmt = "@"; });
    overview.push({ sheet: SHEET.promoCard, what: `一列一張卡，最多 ${CM.PROMO_CARDS_MAX} 張`, total: "每張 5 格", must: "每張 1 格（商品）" });
    const g = guideImgs.find((x) => x.kind === "promoCard");
    let r = sheetHead(wb, ws, SHEET.promoCard, [[`一列一張卡，最多 ${CM.PROMO_CARDS_MAX} 張；桌機一排兩張，偶數張最整齊。沒填的列不會出現。`], ["每張 ★ 商品欄必填：貼賣場編號或商品頁網址；名稱、價格、圖片由系統帶入。"]], g);
    const hdr = ws.getRow(r); hdr.values = [PROMO_INDEX_HEADER, ...PROMO_COLS.map(([k, label]) => (k === "ref" ? "★ " + label : label))]; hdr.font = { bold: true }; hdr.fill = fill(COLOR.header); r++;
    const hint = ws.getRow(r); hint.values = ["（字數）", ...PROMO_COLS.map(([k], i) => `${CIRCLED[i]} ${kindHint(k) || charHint(limOf(promo, k))}`)]; hint.font = { color: { argb: COLOR.hint } }; r++;
    const ex = ws.getRow(r); ex.values = [EXAMPLE_PREFIX, ...PROMO_EXAMPLE]; ex.font = { italic: true, color: { argb: "FF888888" } }; r++;
    for (let n = 1; n <= CM.PROMO_CARDS_MAX; n++, r++) {
      ws.getCell(r, 1).value = `第 ${n} 張`; ws.getCell(r, 1).font = { color: { argb: COLOR.note } };
      PROMO_COLS.forEach(([k], i) => { ws.getCell(r, i + 2).fill = fill(COLOR.input); const n2 = kindHint(k) ? null : limOf(promo, k); if (n2) lenWarn(ws, `${colLetter(i + 2)}${r}`, n2); });
    }
  }

  // ── 開始（第一個分頁，最後填內容） ──
  {
    const ws = wsStart;
    [[1, 34], [2, 34], [3, 12], [4, 16]].forEach(([c2, w]) => { ws.getColumn(c2).width = w; });
    const put = (r, text, style) => { ws.getCell(r, 1).value = text; if (style) ws.getCell(r, 1).font = style; };
    put(1, "活動內容範本：怎麼用", { bold: true, size: 14 });
    put(3, "1. 選分頁填。活動資訊卡有四款版面、各一個分頁，活動頁只會出現一款：挑一個填，其他留白。主打選品、促銷卡各一個分頁。", { bold: true });
    put(4, "2. 每個分頁最上面有圖，圈號對到表格的「圖上編號」欄；黃色格子是你要填的地方，旁邊有範例和建議字數。");
    put(5, "3. 填好後：檔案 → 下載 → Microsoft Excel (.xlsx)，回 CMS 按「從 Excel 帶入」。");
    put(7, "分頁一覽", { bold: true });
    const th = ws.getRow(8); th.values = ["分頁", "這是什麼", "要填", "其中 ★"]; th.font = { bold: true }; th.fill = fill(COLOR.header);
    overview.forEach((o, i) => { ws.getRow(9 + i).values = [o.sheet, o.what, o.total, o.must]; });
    let r = 9 + overview.length + 1;
    put(r++, "規則", { bold: true });
    for (const t of [
      "沒填的分頁，那個區塊不會被動到；填了的分頁會把該區塊整塊換成檔裡的內容，換之前自動備份一版。",
      "★ 是出貨前系統會檢查的格：沒填就不能發佈。其他格沒填，活動頁上就不顯示那一項。",
      "字數單位是全形字：中文 1 個字算 1，英文、數字約算半個。超過的部分在手機上會被截掉或折行。",
      "商品欄貼賣場編號（6～10 碼數字）或商品頁網址；名稱、價格、圖片由系統帶入，不用填。",
      "連結欄只收 Yahoo購物中心網址（https://tw.buy.yahoo.com 開頭）；圖片欄填圖片網址，不是貼圖。",
      "含巨集的 .xlsm 不收。再上傳一次就再覆寫一次；Excel 改了，CMS 不會自己知道。",
    ]) put(r++, "・" + t);
    /* 版本戳：拿到舊檔（瀏覽器快取、舊包）時一眼看得出來——2026-09-27 使用者下載到沒有圖的舊版、以為新版把圖拿掉了 */
    const now = new Date(); const pad = (n) => String(n).padStart(2, "0");
    put(r + 1, `範本版本 ${TEMPLATE_VERSION}・產生於 ${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`, { color: { argb: COLOR.note }, size: 9 });
  }
  wb.title = `活動內容範本 ${TEMPLATE_VERSION}`;
  return Buffer.from(await wb.xlsx.writeBuffer());
}

/* ---------- 解析 ---------- */
/** 表單式分頁 → [{section, rowIdx, label, value, addr}]：A 欄＝欄位名、C 欄＝值；「── 」開頭＝段落標記（第 N 列／活動 banner／其他） */
function readForm(ws) {
  const out = []; let section = null, rowIdx = null;
  for (let r = 1; r <= ws.rowCount; r++) {
    const a = cellText(ws.getRow(r).getCell(FORM.label)); if (!a) continue;
    if (SECTION.is(a)) { const n = SECTION.isRow(a); rowIdx = n; section = n ? "row" : a.startsWith(SECTION.banner) ? "banner" : "other"; continue; }
    if (a === "欄位" || /^[▼（]/.test(a)) continue;
    const row = ws.getRow(r);
    out.push({ section, rowIdx, label: a, value: cellText(row.getCell(FORM.value)), addr: `${colLetter(FORM.value)}${r}`, example: cellText(row.getCell(FORM.example)), exAddr: `${colLetter(FORM.example)}${r}` });
  }
  return out;
}
/** 資料填錯欄：黃格（C）空、旁邊「範例」欄（D）被改成不是範例的字＝用戶把內容填到範例欄了（2026-09-27 盤點 #13） */
const misfilled = (entries) => entries.filter((e) => !e.value && e.example && !e.example.startsWith(EXAMPLE_PREFIX));
const misfillMsg = (sheet, list) => `${list.map((e) => `「${e.label}」`).join("")}好像填到「範例」欄了（${sheet}!${list.map((e) => e.exAddr).join("、")}）——內容要填在黃色格（${colLetter(FORM.value)} 欄）`;
const LEGACY_MSG = "這是舊版範本（9 月 27 日下午之前下載的），欄位排法不一樣、帶不進去。請重新按「下載 Excel 範本」拿新版，把內容搬過去再上傳。";
/** 舊版範本（v1／v2）特徵：單一「活動資訊卡」分頁、或「說明」分頁、或促銷卡表頭仍是 A 欄「膠囊字」而沒有「第幾張」 */
function detectLegacy(wb) {
  if (wb.getWorksheet(SHEET.mechanic) || wb.getWorksheet("說明")) return true;
  const w3 = wb.getWorksheet(SHEET.promoCard);
  return !!(w3 && findHeaderRow(w3, PROMO_COLS[0][1]) > 0 && findHeaderRow(w3, PROMO_INDEX_HEADER) < 0);
}
const anyFilled = (arr) => arr.some((x) => String(x || "").trim());
function findHeaderRow(ws, firstHeader, maxScan = 60) { for (let r = 1; r <= Math.min(ws.rowCount, maxScan); r++) if (cellText(ws.getRow(r).getCell(1)) === firstHeader) return r; return -1; }

async function parseWorkbook(buffer, reg) {
  const wb = new ExcelJS.Workbook(); await wb.xlsx.load(buffer);
  const modules = {}; const report = { sheets: [], modules: {}, problemsTotal: 0 };
  const addr = (sheet, a) => `${sheet}!${a}`;
  const opts = variantOptions(reg);

  // 舊版範本＝整份擋下、只講一句（report.legacy 給介面印一行；同時塞進 problems 讓舊介面也會擋）
  if (detectLegacy(wb)) {
    report.legacy = { message: LEGACY_MSG };
    report.modules.mechanic = { present: true, variant: null, variantName: "", bannerFilled: 0, rowsFilled: 0, ignored: [], problems: [LEGACY_MSG], warnings: [] };
    report.sheets.push(SHEET.mechanic); report.problemsTotal = 1;
    return { modules, report };
  }

  // 活動資訊卡：每款版面一個分頁；填了哪一頁＝選了哪一款（黃格有字、或內容填錯到範例欄，都算「動過這一頁」）
  const filledSheets = [];
  for (const o of opts) {
    const ws = wb.getWorksheet(mechanicSheetName(o)); if (!ws) continue;
    const entries = readForm(ws); if (entries.some((e) => e.value) || misfilled(entries).length) filledSheets.push({ o, ws, entries });
  }
  if (filledSheets.length > 1) {
    report.modules.mechanic = { present: true, variant: null, variantName: "", bannerFilled: 0, rowsFilled: 0, ignored: [], problems: [`活動頁只會出現一款活動資訊卡：你填了 ${filledSheets.map((f) => `「${f.o.name}」`).join("和")}，請把不用的那個分頁清空再上傳`], warnings: [] };
    report.sheets.push(SHEET.mechanic);
  } else if (filledSheets.length === 1) {
    const { o, entries } = filledSheets[0]; const vid = o.id; const sheetName = mechanicSheetName(o);
    const rep = { present: true, variant: vid, variantName: o.name, bannerFilled: 0, rowsFilled: 0, ignored: [], problems: [], warnings: [] };
    const mis = misfilled(entries).filter((e) => e.section === "banner" || (e.section === "row" && e.rowIdx <= CM.rowsCountFor(vid)));
    if (mis.length) { if (entries.some((e) => e.value)) rep.warnings.push(misfillMsg(sheetName, mis)); else rep.problems.push(misfillMsg(sheetName, mis)); } /* 全都填錯欄＝擋下講清楚，不然會變成「沒填＝不動」的靜默 */
    const fields = new Set(CM.rowFieldsFor(vid)); const imgCap = CM.rewardImgsCapFor(vid); const want = CM.rowsCountFor(vid);
    const banner = { badgeText: "", titleLine1: "", titleLine2: "", url: "", imgs: ["", "", ""], urls: ["", "", ""] };
    const bannerKey = new Map(BANNER_COLS.map(([k, label]) => [label, k]));
    for (const e of entries.filter((x) => x.section === "banner" && x.value)) {
      const k = bannerKey.get(e.label); if (!k) continue; rep.bannerFilled++; const t = e.value;
      if (/^url\d?$/.test(k) && !isYahooUrl(t)) rep.problems.push(`${addr(sheetName, e.addr)} 連結要是 Yahoo購物中心網址（https://tw.buy.yahoo.com 開頭）`);
      if (/^img\d$/.test(k) && !isHttpsUrl(t)) rep.problems.push(`${addr(sheetName, e.addr)} 圖片欄要填 https 開頭的圖片網址`);
      if (k === "url") banner.url = t; else if (/^img(\d)$/.test(k)) banner.imgs[Number(k[3]) - 1] = t; else if (/^url(\d)$/.test(k)) banner.urls[Number(k[3]) - 1] = t; else banner[k] = t;
    }
    const rowKey = new Map(ROW_COLS.map((k) => [rowColLabel(k), k]));
    const rows = Array.from({ length: want }, () => CM.emptyInfoRow()); const imgsByRow = rows.map(() => []); let extra = 0;
    for (const e of entries.filter((x) => x.section === "row" && x.value)) {
      const k = rowKey.get(e.label); if (!k) continue; const n = e.rowIdx;
      if (n > want) { extra = Math.max(extra, n); continue; }
      const row = rows[n - 1]; const t = e.value; const fieldKey = /^rewardImg/.test(k) ? "rewardImgs" : k;
      if (!fields.has(fieldKey) && k !== "ctaUrl") { rep.ignored.push(`第 ${n} 列「${e.label}」（這款版面不畫）`); continue; }
      if (k === "rewardImg1" || k === "rewardImg2") { const idx = Number(k.slice(-1)); if (idx > imgCap) { rep.ignored.push(`第 ${n} 列「${e.label}」（這款版面只放 ${imgCap} 張贈品圖）`); continue; } if (!isHttpsUrl(t)) rep.problems.push(`${addr(sheetName, e.addr)} 圖片欄要填 https 開頭的圖片網址`); imgsByRow[n - 1][idx - 1] = t; continue; }
      if (k === "ctaUrl" && !isYahooUrl(t)) rep.problems.push(`${addr(sheetName, e.addr)} 連結要是 Yahoo購物中心網址（https://tw.buy.yahoo.com 開頭）`);
      row[k] = t;
    }
    if (extra) rep.problems.push(`${sheetName} 這款版面固定 ${want} 列，第 ${want + 1} 列起的內容不會帶入，請移到前 ${want} 列或換版面`);
    rows.forEach((row, i) => { row.rewardImgs = imgsByRow[i].filter(Boolean).slice(0, imgCap); });
    rep.rowsFilled = rows.filter((x) => Object.keys(x).some((k) => (k !== "rewardImgs" ? String(x[k] || "").trim() : x[k].length))).length;
    if (entries.some((e) => e.value)) {
      /* ★ 預警（不擋帶入、發佈前會擋；依欄位字典 CP-31）：banner 圖 1／標題第一行至少一個、每列滿額門檻 */
      if (!banner.titleLine1 && !banner.imgs[0]) rep.warnings.push("★ 沒填：活動 banner 的「標題第一行」和「圖 1」都空著，發佈前檢查會要求至少填一個");
      rows.forEach((row, i) => { if (!row.thresholdText) rep.warnings.push(`★ 沒填：第 ${i + 1} 列「滿額門檻」空著，發佈前檢查會擋`); });
      modules.mechanic = { variant: vid, banner, rows };
    }
    report.sheets.push(SHEET.mechanic); report.modules.mechanic = rep;
  } else if (opts.some((o) => wb.getWorksheet(mechanicSheetName(o)))) {
    report.modules.mechanic = { present: false, variant: null, variantName: "", bannerFilled: 0, rowsFilled: 0, ignored: [], problems: [], warnings: [] }; /* 四頁都空＝這個區塊不動 */
  }

  // 主打選品（表單式）
  const w2 = wb.getWorksheet(SHEET.spotlight);
  if (w2) {
    const rep = { present: true, filled: 0, refs: [], problems: [], warnings: [] };
    const all = readForm(w2); const key = new Map(SPOT_COLS.map(([k, label]) => [label, k]));
    const got = all.filter((e) => e.value && key.has(e.label)); const mis = misfilled(all).filter((e) => key.has(e.label));
    if (!got.length && !mis.length) rep.present = false; /* 沒填＝不動 */
    else if (!got.length) rep.problems.push(misfillMsg(SHEET.spotlight, mis));
    else {
      if (mis.length) rep.warnings.push(misfillMsg(SHEET.spotlight, mis));
      const sp = { badgeText: "", title: "", subtitle: "", heroCard: { capsuleText: "", diagonalText: "", offerLine: "" }, refs: { hero: "", ref1: "", ref2: "" } };
      for (const e of got) { const k = key.get(e.label); const t = e.value; rep.filled++;
        if (k === "hero" || k === "ref1" || k === "ref2") { if (!okRef(t)) rep.problems.push(`${addr(SHEET.spotlight, e.addr)} 商品欄要填 6~10 碼賣場編號或 Yahoo購物中心商品頁網址`); else { sp.refs[k] = t; rep.refs.push(t); } continue; }
        if (k in sp.heroCard) sp.heroCard[k] = t; else sp[k] = t; }
      if (!sp.title) rep.warnings.push("★ 沒填：「標題」空著，發佈前檢查會擋");
      if (!sp.refs.hero) rep.warnings.push("★ 沒填：「大卡・商品」空著，發佈前檢查會擋");
      if (!sp.refs.ref1 && !sp.refs.ref2) rep.warnings.push("★ 沒填：右欄沒有商品，至少要放 1 件");
      modules.spotlight = sp;
    }
    if (rep.present) report.sheets.push(SHEET.spotlight); report.modules.spotlight = rep;
  }

  // 促銷卡（表格：A 欄「第幾張」、B～F 資料）
  const w3 = wb.getWorksheet(SHEET.promoCard);
  if (w3) {
    const rep = { present: true, cards: 0, refs: [], problems: [], warnings: [] };
    const hr = findHeaderRow(w3, PROMO_INDEX_HEADER);
    if (hr < 0) rep.problems.push(`${SHEET.promoCard} 找不到「${PROMO_INDEX_HEADER}」那一列標題——請用範本填`);
    else {
      const cards = []; let extra = 0;
      for (let r = hr + 1; r <= w3.rowCount; r++) {
        const row = w3.getRow(r); const a = cellText(row.getCell(1));
        if (isExample(a)) { /* 範例列被改＝那一列不會帶入，出聲提醒（2026-09-27 盤點 #13） */
          if (a === EXAMPLE_PREFIX) { const ex = PROMO_COLS.map((_, i) => cellText(row.getCell(i + 2))); if (ex.some((v, i) => v !== PROMO_EXAMPLE[i])) rep.warnings.push(`促銷卡的範例列（第 ${r} 列）被改過：那一列不會帶入，內容請填在「第 1 張」起的黃色格`); }
          continue;
        }
        const vals = PROMO_COLS.map((_, i) => cellText(row.getCell(i + 2))); if (!anyFilled(vals)) continue;
        if (cards.length >= CM.PROMO_CARDS_MAX) { extra++; continue; }
        const card = { capsuleText: "", diagonalText: "", offerLine: "", priceNote: "", ref: "" };
        PROMO_COLS.forEach(([k], i) => { const t = vals[i]; if (!t) return;
          if (k === "ref") { if (!okRef(t)) rep.problems.push(`${addr(SHEET.promoCard, `${colLetter(i + 2)}${r}`)} 商品欄要填 6~10 碼賣場編號或 Yahoo購物中心商品頁網址`); else { card.ref = t; rep.refs.push(t); } return; }
          card[k] = t; });
        cards.push(card);
      }
      if (extra) rep.problems.push(`${SHEET.promoCard} 最多 ${CM.PROMO_CARDS_MAX} 張，多出的 ${extra} 張請刪掉`);
      if (!cards.length && !rep.warnings.length) rep.present = false; /* 只有範例＝不動 */
      else if (cards.length) { rep.cards = cards.length; modules.promoCard = { cards }; cards.forEach((c, i) => { if (!c.ref) rep.warnings.push(`★ 沒填：第 ${i + 1} 張「商品」空著，發佈前檢查會擋`); }); }
    }
    if (rep.present) report.sheets.push(SHEET.promoCard); report.modules.promoCard = rep;
  }
  report.problemsTotal = Object.values(report.modules).reduce((n, m) => n + m.problems.length, 0);
  return { modules, report };
}

/** 要實抓的商品引用（去重）：伺服器拿去 productFetch；where＝白話位置給錯誤訊息用 */
function collectRefs(parsed) {
  const out = []; const seen = new Set(); const push = (where, input) => { if (!input || seen.has(input)) return; seen.add(input); out.push({ where, input }); };
  const sp = parsed.modules.spotlight; if (sp) { push("主打選品・大卡", sp.refs.hero); push("主打選品・右欄第 1 件", sp.refs.ref1); push("主打選品・右欄第 2 件", sp.refs.ref2); }
  const pc = parsed.modules.promoCard; if (pc) pc.cards.forEach((c, i) => push(`促銷卡・第 ${i + 1} 張`, c.ref));
  return out;
}

/** 套進草稿（同一條寫入路：加區塊／換版面／貼商品都走 applyContentModule；文字欄跟手填一樣直接落欄；最後 validateContentModules 單閘）。
 *  fetched＝Map(input → 伺服器實抓 product)；缺＝throw（鐵律 2：lib 不代填）。整模組覆寫＝檔裡有的模組整塊換掉。 */
function applyImport(dj, parsed, reg, fetched) {
  const page = dj.page; const notes = []; const done = [];
  const productFor = (input, where) => { const p = fetched && fetched.get(input); if (!p) throw new Error(`「${where}」的商品「${input}」沒有實抓到資料，這次沒有帶入`); return p; };
  const m = parsed.modules.mechanic;
  if (m) {
    if (page.mechanic == null) CM.applyContentModule(dj, { kind: "mechanic", action: "add", variant: m.variant }, reg);
    else if (page.mechanic.variant !== m.variant) CM.applyContentModule(dj, { kind: "mechanic", action: "set", variant: m.variant }, reg);
    const node = page.mechanic; const fields = new Set(CM.rowFieldsFor(m.variant));
    node.banner = Object.assign(node.banner && typeof node.banner === "object" ? node.banner : {}, { img: "", badgeText: m.banner.badgeText, titleLine1: m.banner.titleLine1, titleLine2: m.banner.titleLine2, url: m.banner.url, imgs: m.banner.imgs.slice(0, 3), urls: m.banner.urls.slice(0, 3) });
    node.rows = m.rows.map((r) => { const row = CM.emptyInfoRow(); for (const k of Object.keys(row)) if (fields.has(k) || k === "ctaUrl") row[k] = r[k] != null ? r[k] : row[k]; if (!fields.has("rewardImgs")) row.rewardImgs = []; return row; });
    done.push(`活動資訊卡（${parsed.report.modules.mechanic.variantName}，${node.rows.length} 列）`);
  }
  const s = parsed.modules.spotlight;
  if (s) {
    if (page.spotlight == null) CM.applyContentModule(dj, { kind: "spotlight", action: "add" }, reg);
    const sp = page.spotlight; sp.badgeText = s.badgeText; sp.title = s.title; sp.subtitle = s.subtitle;
    if (!sp.heroCard || typeof sp.heroCard !== "object") sp.heroCard = { capsuleText: "", diagonalText: "", offerLine: "", gdid: "" };
    Object.assign(sp.heroCard, { capsuleText: s.heroCard.capsuleText, diagonalText: s.heroCard.diagonalText, offerLine: s.heroCard.offerLine });
    sp.heroCard.gdid = ""; sp.productRefs = ["", ""]; // 整模組覆寫＝三個商品位先清空再照檔放（同一件搬位置才不會被「已放在別格」擋）
    for (const slot of ["hero", "ref1", "ref2"]) { const input = s.refs[slot]; if (!input) continue; CM.applyContentModule(dj, { kind: "spotlight", action: "pick", slot, product: productFor(input, `主打選品・${CM.SPOTLIGHT_PICK_SLOTS[slot]}`) }, reg); }
    sp.productRefs = sp.productRefs.map((g) => g || ""); while (sp.productRefs.length && !sp.productRefs[sp.productRefs.length - 1]) sp.productRefs.pop();
    done.push(`主打選品（${Object.values(s.refs).filter(Boolean).length} 件商品）`);
  }
  const p = parsed.modules.promoCard;
  if (p) {
    page.promoCards = p.cards.map((c) => Object.assign(CM.emptyPromoCard(), { capsuleText: c.capsuleText, diagonalText: c.diagonalText, offerLine: c.offerLine, priceNote: c.priceNote }));
    if (page.promoCard != null) delete page.promoCard; // 舊形單物件＝已升級為多卡陣列
    p.cards.forEach((c, i) => { if (!c.ref) return; CM.applyContentModule(dj, { kind: "promoCard", action: "pick", slot: `card-${i + 1}`, product: productFor(c.ref, `促銷卡・第 ${i + 1} 張`) }, reg); });
    done.push(`促銷卡（${p.cards.length} 張）`);
  }
  CM.validateContentModules(page, reg, dj.products);
  return { changed: done.length > 0, summary: done.length ? `已從 Excel 帶入：${done.join("、")}——欄位跟手填一樣，想改哪格就改` : "檔裡沒有可帶入的內容", notes };
}

module.exports = { SHEET, EXAMPLE_PREFIX, BANNER_COLS, ROW_COLS, SPOT_COLS, PROMO_COLS, PROMO_INDEX_HEADER, SECTION, FORM, NEED, rowColLabel, variantOptions, variantIdFor, mechanicSheetName, mechanicFields, cellText, gdidOfRef, buildTemplate, parseWorkbook, collectRefs, applyImport };
