"use strict";
/**
 * Excel 桌機版超連結格子（2026-09-28 使用者四個檔全中：３３３／０００００／１１１／２２２.xlsx）
 * 病例：貼進範本的網址被 Excel 存成 { text: { richText: [...] }, hyperlink }，cellText 讀成 "[object Object]"
 *      ＝共用連結／活動連結（tw.buy.yahoo.com）被判「連結要是 Yahoo購物中心網址」、圖片欄被判「要 https」，整份擋下。
 * 守：①cellText 對三種超連結形都讀出網址 ②整份範本帶這種格子解析零問題、值進 banner.url／ctaUrl
 */
const { test } = require("node:test");
const assert = require("node:assert");
const path = require("node:path");
const ExcelJS = require("exceljs");
const PIPE = path.join(__dirname, "..", "..");
const SI = require(path.join(PIPE, "lib", "sheet_import.js"));
const CM = require(path.join(PIPE, "lib", "content_modules.js"));
const reg = CM.loadContentRegistry();
const URL_A = "https://tw.buy.yahoo.com/?sub=1039", URL_B = "https://tw.buy.yahoo.com/activity/onsale?actid=786673";
const IMG = "https://img.yec.tw/zp/MerchandiseImages/2DCA6BB90E-SP-23312303.jpg";
const excelLink = (u) => ({ text: { richText: [{ font: { underline: "single", size: 11, color: { indexed: 18 }, name: "Calibri" }, text: u }] }, hyperlink: u }); // Excel 桌機版實際形制（使用者檔案原樣）
const sheetsLink = (u) => ({ text: u, hyperlink: u });        // Google Sheets 形
const onlyLink = (u) => ({ text: { richText: [] }, hyperlink: u }); // 富文本空、只有 hyperlink

test("cellText：Excel 超連結（text 是 richText 物件）、Sheets 超連結（text 是字串）、只有 hyperlink——三種都讀出網址；不再是 [object Object]", () => {
  assert.strictEqual(SI.cellText({ value: excelLink(URL_A) }), URL_A);
  assert.strictEqual(SI.cellText({ value: sheetsLink(URL_B) }), URL_B);
  assert.strictEqual(SI.cellText({ value: onlyLink(IMG) }), IMG);
  assert.strictEqual(SI.cellText({ value: { richText: [{ text: "開" }, { text: "館慶" }] } }), "開館慶", "既有 richText 形照舊");
  assert.strictEqual(SI.cellText({ value: "  純字串 " }), "純字串");
});

test("整份範本：活動資訊卡的共用連結／圖 1／活動連結都用 Excel 超連結形 → 零問題、值逐字帶進模組（使用者 ３３３.xlsx 的形狀）", async () => {
  const opts = SI.variantOptions(reg);
  const wsName = SI.mechanicSheetName(opts[0]);
  const wb = new ExcelJS.Workbook(); await wb.xlsx.load(await SI.buildTemplate(reg));
  const ws = wb.getWorksheet(wsName); assert.ok(ws, "找得到 " + wsName);
  const setForm = (section, label, value) => { let inSec = section == null; for (let r = 1; r <= ws.rowCount; r++) { const a = SI.cellText(ws.getRow(r).getCell(SI.FORM.label)); if (SI.SECTION.is(a)) { inSec = section == null || a.startsWith(section); continue; } if (inSec && a === label) { ws.getCell(r, SI.FORM.value).value = value; return r; } } throw new Error("找不到 " + label); };
  setForm(SI.SECTION.banner, "標題第一行", "這是標題一");
  setForm(SI.SECTION.banner, "共用連結", excelLink(URL_A));
  setForm(SI.SECTION.banner, "圖 1", excelLink(IMG));
  setForm(SI.SECTION.row(1), "滿額門檻", "滿一件");
  setForm(SI.SECTION.row(1), "活動連結（搶購連結）", excelLink(URL_B));
  const r = await SI.parseWorkbook(Buffer.from(await wb.xlsx.writeBuffer()), reg);
  const probs = (r.report.sheets || []).flatMap((s) => s.problems || []);
  assert.deepStrictEqual(probs, [], "超連結形的網址不該被擋：" + JSON.stringify(probs));
  assert.ok(r.modules.mechanic, "活動資訊卡有帶入");
  assert.strictEqual(r.modules.mechanic.banner.url, URL_A);
  assert.strictEqual(r.modules.mechanic.banner.imgs[0], IMG);
  assert.strictEqual(r.modules.mechanic.rows[0].ctaUrl, URL_B);
});
