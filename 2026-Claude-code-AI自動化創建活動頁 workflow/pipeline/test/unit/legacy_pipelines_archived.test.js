/* 「封存的檔要在檔頭自己講清楚」絆線（2026-09-14 舊管線退場批，69 號附錄 C）。
   ------------------------------------------------------------------
   三支程式（08:30 活動巡檢純函式層、09:30 價格巡檢腳本、活動總覽表）2026-09-14 停用但不刪——
   使用者說這些功能未來會以別的形式回來（CMS 搬進內網＋同事 Google id／接正式商品 API／工程師的商品檢查機制），
   刪了要重寫、留著才划算。但「留著不刪」有一個代價：半年後有人打開會以為是現役、順手掛回排程。
   所以檔頭必須寫：停用日期、為什麼停、還能不能手動跑、回來的條件。這支守的就是那段話不被誰清掉。 */
"use strict";
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const PIPE = path.resolve(__dirname, "..", "..");
const FILES = ["run_patrol.js", "price_watch.sh", "overview_sheet.js"];

for (const f of FILES) {
  test(`${f} 檔頭寫明 2026-09-14 停用／封存與回來的條件`, () => {
    const head = fs.readFileSync(path.join(PIPE, f), "utf8").split("\n").slice(0, 16).join("\n");
    assert.ok(head.includes("2026-09-14"), `${f} 檔頭沒有停用日期`);
    assert.ok(/停用|封存/.test(head), `${f} 檔頭沒寫「停用」或「封存」`);
    assert.ok(/回來的條件/.test(head), `${f} 檔頭沒寫回來的條件——沒寫的話半年後會被當成遺忘的欠債或被誤掛回去`);
  });
}
