"use strict";
/**
 * Excel／Google Sheets 匯出檔帶入三個內文模組（2026-09-26 立案、當晚使用者裁「今天做完、進單機版」；2026-09-27 範本 v3＝每款版面一個分頁＋表單式）。
 * 守五件事：①範本結構＝欄位表（不手抄第二份）、每款版面一個分頁只列它會畫的欄、開始頁講清楚「只會出現一款」
 *          ②解析資訊卡：表單式讀 A 欄名／C 值、段落標記認第幾列；填兩款＝問題；非 Yahoo 連結／圖片非 https＝問題
 *          ③解析主打選品（表單）與促銷卡（表格）：商品欄只驗格式；Google Sheets 超連結物件／richText 讀顯示值
 *          ④套用：走 applyContentModule 同一條路（加區塊／換版面／pick）、整模組覆寫、最後 validateContentModules 單閘；lib 不碰網路
 *          ⑤指南：建議字數＝量測檔、對照圖每頁一張、字數警告只掛黃格且不擋、範例句不超建議字數、★ 標在會擋出貨的格
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const ExcelJS = require("exceljs");
const PIPE = path.join(__dirname, "..", "..");
const SI = require(path.join(PIPE, "lib", "sheet_import.js"));
const CM = require(path.join(PIPE, "lib", "content_modules.js"));
const reg = CM.loadContentRegistry();
const opts = SI.variantOptions(reg);
const sheetOf = (name) => SI.mechanicSheetName(opts.find((o) => o.name === name || o.id === name));
const FIX = path.join(PIPE, "test", "fixtures", "gate_pass_draft.json");
const fakeProduct = (g) => ({ gdid: String(g), name: "商品 " + g, price: 100 + Number(String(g).slice(-2)), url: `https://tw.buy.yahoo.com/gdsale/gdsale.asp?gdid=${g}`, imgs: [`https://img.yec.tw/${g}.jpg`], marketPrice: 999 });

async function filled(mut) { const wb = new ExcelJS.Workbook(); await wb.xlsx.load(await SI.buildTemplate(reg)); mut(wb); return Buffer.from(await wb.xlsx.writeBuffer()); }
const txt = (c) => SI.cellText(c);
/** 表單式：在某段落（null＝整頁）裡找 A 欄＝label 的那一列，把值寫進 C 欄；回傳列號 */
function setForm(ws, section, label, value) {
  let inSec = section == null, from = 1;
  for (let r = 1; r <= ws.rowCount; r++) {
    const a = txt(ws.getRow(r).getCell(SI.FORM.label));
    if (SI.SECTION.is(a)) { inSec = section == null || a.startsWith(section); continue; }
    if (inSec && a === label) { ws.getCell(r, SI.FORM.value).value = value; return r; }
  }
  throw new Error(`找不到 ${ws.name} ${section || ""} 「${label}」`);
}
const setBanner = (ws, label, v) => setForm(ws, SI.SECTION.banner, label, v);
const setRowField = (ws, n, label, v) => setForm(ws, SI.SECTION.row(n), label, v);
/** 促銷卡：第 n 張那一列，B～F */
function setCard(ws, n, vals) { for (let r = 1; r <= ws.rowCount; r++) if (txt(ws.getRow(r).getCell(1)) === `第 ${n} 張`) { vals.forEach((v, i) => { ws.getCell(r, i + 2).value = v; }); return r; } throw new Error(`找不到第 ${n} 張`); }
const labelsOf = (ws, section) => { const out = []; let inSec = false; for (let r = 1; r <= ws.rowCount; r++) { const a = txt(ws.getRow(r).getCell(1)); if (SI.SECTION.is(a)) { inSec = a.startsWith(section); continue; } if (inSec && a && !/^[▼（]/.test(a) && a !== "欄位") out.push(a); } return out; };

test("①範本結構：開始頁＋每款版面一個分頁＋主打選品＋促銷卡；每頁只列這款會畫的欄、列數照版面；開始頁講清楚只會出現一款；空範本＝三個區塊都不動", async () => {
  const wb = new ExcelJS.Workbook(); await wb.xlsx.load(await SI.buildTemplate(reg));
  assert.deepStrictEqual(wb.worksheets.map((w) => w.name), ["開始", ...opts.map((o) => SI.mechanicSheetName(o)), "主打選品", "促銷卡"]);
  assert.strictEqual(opts.length, reg.mechanicVariants.length);
  for (const o of opts) {
    const ws = wb.getWorksheet(SI.mechanicSheetName(o));
    const drawn = CM.rowFieldsFor(o.id); const imgCap = CM.rewardImgsCapFor(o.id);
    const want = SI.ROW_COLS.filter((k) => (/^rewardImg/.test(k) ? drawn.includes("rewardImgs") && Number(k.slice(-1)) <= imgCap : k === "ctaUrl" || drawn.includes(k))).map(SI.rowColLabel);
    assert.deepStrictEqual(labelsOf(ws, SI.SECTION.row(1)), want, `${o.name} 第 1 列只列會畫的欄`);
    assert.deepStrictEqual(labelsOf(ws, SI.SECTION.banner), SI.BANNER_COLS.map((x) => x[1]));
    const rowsSections = []; for (let r = 1; r <= ws.rowCount; r++) { const n = SI.SECTION.isRow(txt(ws.getRow(r).getCell(1))); if (n) rowsSections.push(n); }
    assert.deepStrictEqual(rowsSections, Array.from({ length: CM.rowsCountFor(o.id) }, (_, i) => i + 1), `${o.name} 列數照版面`);
    const head = []; for (let r = 1; r <= 4; r++) head.push(txt(ws.getRow(r).getCell(1)));
    assert.ok(head.some((t) => /只會出現一款活動資訊卡/.test(t)), "每頁頂端都要提醒只會出現一款");
    assert.ok(head.some((t) => /要填 \d+ 格（★ \d+ 格）/.test(t)), "每頁頂端要講要填幾格");
  }
  const start = wb.getWorksheet("開始"); const startTxt = []; start.eachRow((row) => row.eachCell((c) => startTxt.push(txt(c))));
  assert.ok(startTxt.some((t) => /只會出現一款/.test(t))); for (const o of opts) assert.ok(startTxt.includes(SI.mechanicSheetName(o)), "開始頁一覽要列出每個分頁");
  assert.deepStrictEqual(labelsOf(wb.getWorksheet("主打選品"), "── 標題區").concat(labelsOf(wb.getWorksheet("主打選品"), "── 左邊大卡"), labelsOf(wb.getWorksheet("主打選品"), "── 右欄兩件")), SI.SPOT_COLS.map((x) => x[1]));
  const r = await SI.parseWorkbook(await SI.buildTemplate(reg), reg);
  assert.deepStrictEqual(Object.keys(r.modules), []); assert.strictEqual(r.report.problemsTotal, 0); assert.deepStrictEqual(r.report.sheets, []);
  assert.strictEqual(r.report.modules.mechanic.present, false);
});

test("②解析資訊卡：選分頁＝選版面；banner 與各列讀 C 欄；非 Yahoo 連結／圖片非 https＝問題（位置＝C 欄格）；填兩款版面＝問題、不帶入", async () => {
  const buf = await filled((wb) => {
    const ws = wb.getWorksheet(sheetOf("優惠卡列三列"));
    setBanner(ws, "角標", "開館慶"); setBanner(ws, "標題第一行", "今天加菜"); setBanner(ws, "共用連結", "https://tw.buy.yahoo.com/activity/onsale?actid=1"); setBanner(ws, "圖 1", "https://img.yec.tw/a.jpg"); setBanner(ws, "圖 2", "http://img.yec.tw/b.jpg");
    setRowField(ws, 1, "列標籤", "熱銷"); setRowField(ws, 1, "店家名", "海陸管家"); setRowField(ws, 1, "活動文案", "下單95折"); setRowField(ws, 1, "滿額門檻", "滿1件"); setRowField(ws, 1, "折抵或贈品", "打95折"); setRowField(ws, 1, "活動連結（搶購連結）", "https://tw.buy.yahoo.com/category/1");
    setRowField(ws, 2, "列標籤", "第二列"); setRowField(ws, 2, "滿額門檻", "滿2件"); setRowField(ws, 2, "活動連結（搶購連結）", "https://shopee.tw/x");
    setRowField(ws, 3, "列標籤", "第三列");
  });
  const r = await SI.parseWorkbook(buf, reg);
  const m = r.report.modules.mechanic; assert.strictEqual(m.variant, "info-offer-rows"); assert.strictEqual(m.variantName, "優惠卡列三列"); assert.strictEqual(m.bannerFilled, 5); assert.strictEqual(m.rowsFilled, 3);
  assert.deepStrictEqual(m.ignored, [], "每頁只列會畫的欄＝沒有略過項");
  assert.ok(m.problems.some((x) => /優惠卡列三列!C\d+ 連結要是 Yahoo購物中心/.test(x)), "shopee 連結要被叫、位置指到 C 欄格");
  assert.ok(m.problems.some((x) => /優惠卡列三列!C\d+ 圖片欄要填 https/.test(x)), "http 圖片要被叫");
  assert.strictEqual(m.problems.length, 2);
  assert.strictEqual(r.modules.mechanic.banner.badgeText, "開館慶"); assert.strictEqual(r.modules.mechanic.banner.imgs[0], "https://img.yec.tw/a.jpg"); assert.strictEqual(r.modules.mechanic.banner.imgs[1], "http://img.yec.tw/b.jpg");
  assert.strictEqual(r.modules.mechanic.rows[0].ctaUrl, "https://tw.buy.yahoo.com/category/1"); assert.deepStrictEqual(r.modules.mechanic.rows[0].rewardImgs, []); assert.strictEqual(r.modules.mechanic.rows[1].thresholdText, "滿2件"); assert.strictEqual(r.modules.mechanic.rows.length, 3);
  assert.deepStrictEqual(r.report.sheets, ["活動資訊卡"]);
  // 填了兩款
  const two = await SI.parseWorkbook(await filled((wb) => { setRowField(wb.getWorksheet(sheetOf("優惠卡列三列")), 1, "列標籤", "A"); setRowField(wb.getWorksheet(sheetOf("滿額贈雙列")), 1, "列標籤", "B"); }), reg);
  assert.ok(two.report.modules.mechanic.problems.some((x) => /只會出現一款活動資訊卡.*「優惠卡列三列」和「滿額贈雙列」/.test(x))); assert.strictEqual(two.modules.mechanic, undefined); assert.strictEqual(two.report.problemsTotal, 1);
  // 雙列版面：贈品圖只有 1 格、第 3 列不存在＝只會有 2 列
  const gift = await SI.parseWorkbook(await filled((wb) => { const ws = wb.getWorksheet(sheetOf("滿額贈雙列")); setRowField(ws, 1, "滿額門檻", "滿1000"); setRowField(ws, 1, "折抵或贈品", "送杯"); setRowField(ws, 1, "贈品圖 1", "https://img.yec.tw/cup.jpg"); setRowField(ws, 1, "搶購鈕文字", "馬上搶"); setRowField(ws, 2, "滿額門檻", "滿2000"); }), reg);
  const gm = gift.report.modules.mechanic; assert.strictEqual(gm.variant, "info-gift-rows"); assert.strictEqual(gift.modules.mechanic.rows.length, 2); assert.deepStrictEqual(gift.modules.mechanic.rows[0].rewardImgs, ["https://img.yec.tw/cup.jpg"]); assert.strictEqual(gift.modules.mechanic.rows[0].ctaText, "馬上搶"); assert.strictEqual(gm.problems.length, 0);
});

test("③解析主打選品（表單）與促銷卡（表格）：商品欄只驗格式；Google Sheets 超連結物件／richText 讀顯示值；範例列與空列不算", async () => {
  const buf = await filled((wb) => {
    const w2 = wb.getWorksheet("主打選品");
    setForm(w2, null, "角標", { richText: [{ text: "開" }, { text: "館慶" }] }); setForm(w2, null, "標題", "海味好料"); setForm(w2, null, "大卡・膠囊字", "生食級貝柱");
    setForm(w2, null, "大卡・商品（賣場編號或商品網址）", "12034942"); setForm(w2, null, "右欄第 1 件商品（賣場編號或商品網址）", { text: "https://tw.buy.yahoo.com/gdsale/gdsale.asp?gdid=11941676", hyperlink: "https://tw.buy.yahoo.com/gdsale/gdsale.asp?gdid=11941676" }); setForm(w2, null, "右欄第 2 件商品（賣場編號或商品網址）", "abc");
    const w3 = wb.getWorksheet("促銷卡"); setCard(w3, 1, ["三杯雞", "十八養場", "滿2000免運", "超值價", "12234229"]); setCard(w3, 3, ["咖哩雞丁", "", "", "", ""]);
  });
  const r = await SI.parseWorkbook(buf, reg);
  const s = r.report.modules.spotlight; assert.strictEqual(r.modules.spotlight.badgeText, "開館慶"); assert.deepStrictEqual(s.refs, ["12034942", "https://tw.buy.yahoo.com/gdsale/gdsale.asp?gdid=11941676"]); assert.ok(s.problems.some((x) => /主打選品!C\d+ 商品欄要填/.test(x)), "abc 不是商品引用");
  const p = r.report.modules.promoCard; assert.strictEqual(p.cards, 2, "第 2 張沒填＝跳過、不算空卡"); assert.deepStrictEqual(p.refs, ["12234229"]); assert.deepStrictEqual(p.problems, []); assert.strictEqual(r.modules.promoCard.cards[1].capsuleText, "咖哩雞丁");
  assert.deepStrictEqual(SI.collectRefs(r).map((x) => x.input), ["12034942", "https://tw.buy.yahoo.com/gdsale/gdsale.asp?gdid=11941676", "12234229"]);
  assert.deepStrictEqual(r.report.sheets, ["主打選品", "促銷卡"]); assert.strictEqual(r.report.modules.mechanic.present, false);
  // 促銷卡商品格式錯＝問題指到那一格（第 1 張＝表頭後第 3 列起）
  const bad = await SI.parseWorkbook(await filled((wb) => setCard(wb.getWorksheet("促銷卡"), 1, ["x", "", "", "", "https://shopee.tw/p/1"])), reg);
  assert.ok(bad.report.modules.promoCard.problems.some((x) => /促銷卡!F\d+ 商品欄要填/.test(x)));
});

test("④套用：走 applyContentModule（加區塊／換版面／pick）、整模組覆寫、商品由呼叫端給、最後單閘驗證；缺商品＝throw", async () => {
  const dj = JSON.parse(fs.readFileSync(FIX, "utf8")); assert.strictEqual(dj.page.mechanic, undefined);
  const buf = await filled((wb) => {
    const ws = wb.getWorksheet(sheetOf("好禮圖列")); setBanner(ws, "角標", "角標"); setBanner(ws, "標題第一行", "標題一");
    setRowField(ws, 1, "列標籤", "列一"); setRowField(ws, 1, "滿額門檻", "滿1000"); setRowField(ws, 1, "折抵或贈品", "送杯"); setRowField(ws, 1, "贈品圖 1", "https://img.yec.tw/1.jpg"); setRowField(ws, 1, "贈品圖 2", "https://img.yec.tw/2.jpg"); setRowField(ws, 1, "活動連結（搶購連結）", "https://tw.buy.yahoo.com/activity/onsale?actid=1");
    const w2 = wb.getWorksheet("主打選品"); setForm(w2, null, "角標", "角標"); setForm(w2, null, "標題", "標題"); setForm(w2, null, "副標", "副標"); setForm(w2, null, "大卡・膠囊字", "膠囊"); setForm(w2, null, "大卡・斜帶字", "斜帶"); setForm(w2, null, "大卡・優惠一行", "優惠"); setForm(w2, null, "大卡・商品（賣場編號或商品網址）", "20000001"); setForm(w2, null, "右欄第 1 件商品（賣場編號或商品網址）", "20000002");
    const w3 = wb.getWorksheet("促銷卡"); setCard(w3, 1, ["卡一", "", "", "", "20000003"]); setCard(w3, 2, ["卡二", "", "", "", ""]);
  });
  const parsed = await SI.parseWorkbook(buf, reg); assert.strictEqual(parsed.report.problemsTotal, 0, JSON.stringify(parsed.report));
  const fetched = new Map([["20000001", fakeProduct("20000001")], ["20000002", fakeProduct("20000002")], ["20000003", fakeProduct("20000003")]]);
  const r = SI.applyImport(dj, parsed, reg, fetched);
  assert.ok(r.changed); assert.match(r.summary, /活動資訊卡（好禮圖列，3 列）、主打選品（2 件商品）、促銷卡（2 張）/);
  assert.strictEqual(dj.page.mechanic.variant, "info-gift-gallery"); assert.deepStrictEqual(dj.page.mechanic.rows[0].rewardImgs, ["https://img.yec.tw/1.jpg", "https://img.yec.tw/2.jpg"]); assert.strictEqual(dj.page.mechanic.rows[0].brandName, "", "好禮圖列不畫店家名＝空");
  assert.strictEqual(dj.page.mechanic.rows.length, 3); assert.strictEqual(dj.page.mechanic.banner.titleLine1, "標題一"); assert.strictEqual(dj.page.mechanic.rows[0].ctaUrl, "https://tw.buy.yahoo.com/activity/onsale?actid=1");
  assert.strictEqual(dj.page.spotlight.heroCard.gdid, "20000001"); assert.deepStrictEqual(dj.page.spotlight.productRefs, ["20000002"]); assert.strictEqual(dj.page.spotlight.heroCard.capsuleText, "膠囊");
  assert.strictEqual(dj.page.promoCards.length, 2); assert.strictEqual(dj.page.promoCards[0].gdid, "20000003"); assert.strictEqual(dj.page.promoCards[1].capsuleText, "卡二");
  assert.ok(dj.products.some((p) => p.gdid === "20000001"), "pick 走同一條路＝商品進池");
  // 再帶一次＝整模組覆寫（換版面走 set）
  const buf2 = await filled((wb) => { const ws = wb.getWorksheet(sheetOf("優惠卡列三列")); setRowField(ws, 1, "店家名", "新店家"); setRowField(ws, 1, "滿額門檻", "滿1"); });
  const parsed2 = await SI.parseWorkbook(buf2, reg); SI.applyImport(dj, parsed2, reg, new Map());
  assert.strictEqual(dj.page.mechanic.variant, "info-offer-rows"); assert.strictEqual(dj.page.mechanic.rows[0].brandName, "新店家"); assert.deepStrictEqual(dj.page.mechanic.rows[0].rewardImgs, []); assert.strictEqual(dj.page.mechanic.banner.titleLine1, "", "整模組覆寫＝舊 banner 文字清掉");
  // 缺商品＝throw
  const parsed3 = await SI.parseWorkbook(await filled((wb) => setCard(wb.getWorksheet("促銷卡"), 1, ["x", "", "", "", "20000009"])), reg);
  assert.throws(() => SI.applyImport(JSON.parse(fs.readFileSync(FIX, "utf8")), parsed3, reg, new Map()), /沒有實抓到資料/);
});

test("⑤指南：建議字數＝量測檔、對照圖每頁一張、字數警告只掛黃格且不擋、範例句不超建議字數、★ 標在會擋出貨的格", async () => {
  const wb = new ExcelJS.Workbook(); await wb.xlsx.load(await SI.buildTemplate(reg));
  const lim = JSON.parse(fs.readFileSync(path.join(PIPE, "lib", "content_module_char_limits.json"), "utf8"));
  const manifest = JSON.parse(fs.readFileSync(path.join(PIPE, "workbench", "public", "sheet-template-guide", "manifest.json"), "utf8"));
  assert.strictEqual(manifest.images.filter((x) => x.kind === "mechanic").length, reg.mechanicVariants.length, "活動資訊卡每款版面一張對照圖");
  for (const o of opts) assert.strictEqual(wb.getWorksheet(SI.mechanicSheetName(o)).getImages().length, 1, `${o.name} 一張圖`);
  assert.strictEqual(wb.getWorksheet("主打選品").getImages().length, 1); assert.strictEqual(wb.getWorksheet("促銷卡").getImages().length, 1); assert.strictEqual(wb.getWorksheet("開始").getImages().length, 0);
  const emW = (s) => [...String(s).replace(/^（範例）/, "")].reduce((n, ch) => n + (ch === " " ? 0.3 : /[\u0000-ÿ]/.test(ch) ? 0.55 : 1), 0);
  const ws = wb.getWorksheet(sheetOf("優惠卡列三列"));
  const find = (section, label) => { let inSec = false; for (let r = 1; r <= ws.rowCount; r++) { const a = txt(ws.getRow(r).getCell(1)); if (SI.SECTION.is(a)) { inSec = a.startsWith(section); continue; } if (inSec && a === label) return r; } throw new Error(label); };
  const rBadge = find(SI.SECTION.banner, "角標"), rTh = find(SI.SECTION.row(1), "滿額門檻"), rBrand = find(SI.SECTION.row(1), "店家名"), rT2 = find(SI.SECTION.banner, "標題第二行");
  assert.strictEqual(ws.getCell(rBadge, SI.FORM.limit).value, `≤${lim.mechanic.banner.badgeText.min} 字`); assert.strictEqual(ws.getCell(rBadge, SI.FORM.badge).value, "①");
  assert.strictEqual(ws.getCell(rTh, SI.FORM.limit).value, `≤${lim.mechanic.rows["info-offer-rows"].thresholdText.min} 字`); assert.strictEqual(ws.getCell(rTh, SI.FORM.badge).value, "❹"); assert.strictEqual(ws.getCell(rTh, SI.FORM.need).value, SI.NEED.must);
  assert.strictEqual(ws.getCell(rBrand, SI.FORM.need).value, SI.NEED.opt);
  assert.ok(emW(ws.getCell(rT2, SI.FORM.example).value) <= lim.mechanic.banner.titleLine2.min, "banner 標題第二行範例超過建議字數");
  const dv = ws.getCell(rBadge, SI.FORM.value).dataValidation; assert.ok(dv, "黃格要有字數警告"); assert.strictEqual(dv.type, "custom"); assert.strictEqual(dv.errorStyle, "warning"); assert.match(dv.formulae[0], new RegExp(`^LEN\\(C${rBadge}\\)<=${lim.mechanic.banner.badgeText.min}$`));
  assert.ok(!ws.getCell(rBadge, SI.FORM.example).dataValidation, "範例格不掛警告"); assert.ok(!ws.getCell(rBadge, SI.FORM.label).dataValidation);
  assert.strictEqual(ws.getCell(rBadge, SI.FORM.value).fill.fgColor.argb, "FFFFF3C4", "填寫格＝黃底");
  // 搶購鈕文字沿 rules.json（滿額贈雙列 3／好禮列搶購 6）
  const rules = JSON.parse(fs.readFileSync(path.join(PIPE, "rules.json"), "utf8"));
  const wsRush = wb.getWorksheet(sheetOf("好禮列搶購")); let rCta = -1; let inSec = false; for (let r = 1; r <= wsRush.rowCount; r++) { const a = txt(wsRush.getRow(r).getCell(1)); if (SI.SECTION.is(a)) { inSec = a.startsWith(SI.SECTION.row(1)); continue; } if (inSec && a === "搶購鈕文字") { rCta = r; break; } }
  assert.ok(rCta > 0); assert.strictEqual(wsRush.getCell(rCta, SI.FORM.limit).value, `≤${rules.charLimits.mobile["mechanicCtaText_info-gift-rush"].maxFullwidthChars} 字`);
  // 促銷卡：字數列＝量測檔、範例在建議內、黃格警告
  const w3 = wb.getWorksheet("促銷卡"); let hr = -1; for (let r = 1; r <= w3.rowCount; r++) if (txt(w3.getRow(r).getCell(1)) === SI.PROMO_INDEX_HEADER) { hr = r; break; }
  assert.ok(hr > 0); assert.strictEqual(txt(w3.getRow(hr + 1).getCell(1)), "（字數）"); assert.strictEqual(w3.getRow(hr + 1).getCell(4).value, `③ ≤${lim.promoCard.offerLine.min} 字`);
  assert.ok(emW(w3.getRow(hr + 2).getCell(4).value) <= lim.promoCard.offerLine.min, "促銷卡優惠一行範例超過建議字數");
  assert.strictEqual(txt(w3.getRow(hr + 3).getCell(1)), "第 1 張"); const dv3 = w3.getCell(hr + 3, 2).dataValidation; assert.ok(dv3 && dv3.errorStyle === "warning");
  // 主打選品：斜帶字範例在建議內、大卡商品 ★ 必填
  const w2 = wb.getWorksheet("主打選品"); let rDiag = -1, rHero = -1; for (let r = 1; r <= w2.rowCount; r++) { const a = txt(w2.getRow(r).getCell(1)); if (a === "大卡・斜帶字") rDiag = r; if (a === "大卡・商品（賣場編號或商品網址）") rHero = r; }
  assert.ok(emW(w2.getCell(rDiag, SI.FORM.example).value) <= lim.spotlight.diagonalText.min); assert.strictEqual(w2.getCell(rHero, SI.FORM.need).value, SI.NEED.must); assert.strictEqual(w2.getCell(rHero, SI.FORM.limit).value, "賣場編號或商品網址");
});

test("⑥盤點修補（2026-09-27）：舊版範本整份擋下一句話；★ 沒填＝預警不擋；內容填到範例欄＝全錯擋下、部分錯預警；促銷卡範例列被改＝預警", async () => {
  // 舊版：模擬 v2 四分頁（活動資訊卡／主打選品／促銷卡／說明）
  const old = new ExcelJS.Workbook(); old.addWorksheet("活動資訊卡").getCell("A1").value = "版面"; old.addWorksheet("促銷卡").getRow(1).values = ["膠囊字", "斜帶字"]; old.addWorksheet("說明");
  const rOld = await SI.parseWorkbook(Buffer.from(await old.xlsx.writeBuffer()), reg);
  assert.ok(rOld.report.legacy && /舊版範本/.test(rOld.report.legacy.message)); assert.deepStrictEqual(rOld.modules, {}); assert.strictEqual(rOld.report.problemsTotal, 1); assert.ok(rOld.report.modules.mechanic.problems[0].includes("舊版範本"));
  // 只有促銷卡表頭是舊的（沒有「第幾張」）也算舊版
  const old2 = new ExcelJS.Workbook(); old2.addWorksheet("開始"); old2.addWorksheet("促銷卡").getRow(1).values = ["膠囊字", "斜帶字", "優惠一行", "價格註記", "商品（賣場編號或商品網址）"];
  assert.ok((await SI.parseWorkbook(Buffer.from(await old2.xlsx.writeBuffer()), reg)).report.legacy);
  // ★ 預警：banner 沒圖沒標題、第 2／3 列沒門檻；主打選品沒標題沒大卡商品沒右欄；促銷卡沒商品——都不算問題、照樣帶入
  const w = await SI.parseWorkbook(await filled((wb) => {
    const ws = wb.getWorksheet(sheetOf("優惠卡列三列")); setBanner(ws, "角標", "只有角標"); setRowField(ws, 1, "滿額門檻", "滿1件"); setRowField(ws, 2, "列標籤", "二");
    setForm(wb.getWorksheet("主打選品"), null, "角標", "x");
    setCard(wb.getWorksheet("促銷卡"), 1, ["卡", "", "", "", ""]);
  }), reg);
  assert.strictEqual(w.report.problemsTotal, 0, "預警不算問題");
  const mw = w.report.modules.mechanic.warnings; assert.ok(mw.some((x) => /標題第一行.*圖 1/.test(x))); assert.ok(mw.some((x) => /第 2 列「滿額門檻」/.test(x))); assert.ok(mw.some((x) => /第 3 列「滿額門檻」/.test(x))); assert.ok(!mw.some((x) => /第 1 列「滿額門檻」/.test(x)));
  const sw = w.report.modules.spotlight.warnings; assert.ok(sw.some((x) => /「標題」/.test(x))); assert.ok(sw.some((x) => /大卡・商品/.test(x))); assert.ok(sw.some((x) => /右欄/.test(x)));
  assert.ok(w.report.modules.promoCard.warnings.some((x) => /第 1 張「商品」/.test(x))); assert.ok(w.modules.promoCard && w.modules.mechanic && w.modules.spotlight, "預警仍帶入");
  // 填到範例欄：主打選品全填在 D 欄＝擋下講清楚；資訊卡 C 有值、D 被改＝預警
  const setEx = (ws, label, v) => { for (let r = 1; r <= ws.rowCount; r++) if (txt(ws.getRow(r).getCell(1)) === label) { ws.getCell(r, SI.FORM.example).value = v; return; } throw new Error(label); };
  const m = await SI.parseWorkbook(await filled((wb) => {
    const w2 = wb.getWorksheet("主打選品"); setEx(w2, "標題", "我的標題"); setEx(w2, "副標", "我的副標");
    const ws = wb.getWorksheet(sheetOf("好禮圖列")); setRowField(ws, 1, "滿額門檻", "滿1000"); setEx(ws, "角標", "填錯位");
  }), reg);
  assert.ok(m.report.modules.spotlight.problems.some((x) => /「標題」「副標」好像填到「範例」欄.*D\d+/.test(x)), JSON.stringify(m.report.modules.spotlight)); assert.strictEqual(m.modules.spotlight, undefined);
  assert.ok(m.report.modules.mechanic.warnings.some((x) => /「角標」好像填到「範例」欄/.test(x))); assert.ok(m.modules.mechanic); assert.strictEqual(m.report.modules.mechanic.problems.length, 0);
  // 促銷卡範例列被改
  const pe = await SI.parseWorkbook(await filled((wb) => { const w3 = wb.getWorksheet("促銷卡"); for (let r = 1; r <= w3.rowCount; r++) if (txt(w3.getRow(r).getCell(1)) === "（範例）") { w3.getCell(r, 2).value = "我改了範例"; break; } }), reg);
  assert.ok(pe.report.modules.promoCard.warnings.some((x) => /範例列.*被改過/.test(x))); assert.strictEqual(pe.modules.promoCard, undefined);
  // 乾淨範本：零預警零問題（不能對空範本吵）
  const clean = await SI.parseWorkbook(await SI.buildTemplate(reg), reg); assert.strictEqual(clean.report.problemsTotal, 0); assert.ok(!clean.report.legacy); for (const k of Object.keys(clean.report.modules)) assert.deepStrictEqual(clean.report.modules[k].warnings || [], []);
});
