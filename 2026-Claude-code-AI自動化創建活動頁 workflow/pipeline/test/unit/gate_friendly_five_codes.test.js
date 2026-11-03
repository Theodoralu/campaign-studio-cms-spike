"use strict";
/**
 * 白話牆五碼絆線（2026-10-08 使用者圈照建議＝qa/gate-messages-wall-2026-10-08.html）
 * 守兩件事：①五碼的白話分支都在（兜底句歸零 26/26 的那一半）②帶路映射的抽取式對得上 gate 真實句型。
 * 樣句逐字取自 gate.js 模板（值代入）；gate 模板若改句型＝這裡要同批動（跟 dup_product_marking 同款）。
 */
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const ui = fs.readFileSync(path.join(__dirname, "../../workbench/public/index.html"), "utf8");

test("五碼白話分支都在（CP-03/26/28/29/31）", () => {
  for (const c of ["CP-03", "CP-26", "CP-28", "CP-29", "CP-31"]) assert.match(ui, new RegExp(`code === "${c}"`), c + " 要有白話分支");
});

test("CP-31 資訊卡型：抽得到列號與缺欄、帶路跳到該列欄位", () => {
  const msg = "活動資訊卡第 3 列還沒填滿額門檻、折抵或贈品——每一列都要填完才能上線；用不到的列請換成列數較少的排版，或把模組移除（技術：page.mechanic.rows[2] thresholdText+rewardText 空）（CP-31）";
  const mr = msg.match(/活動資訊卡第 (\d+) 列還沒填(.{1,20}?)——/);
  assert.equal(mr[1], "3"); assert.ok(mr[2].includes("滿額門檻"));
  const i = msg.match(/^活動資訊卡第 (\d+) 列還沒填/);
  assert.equal(`page.mechanic.rows.${+i[1] - 1}.${msg.includes("滿額門檻") ? "thresholdText" : "rewardText"}`, "page.mechanic.rows.2.thresholdText");
});

test("CP-26：路徑直映（含陣列索引轉點號）", () => {
  const msg = "page.floors[1].title「滿 $-- 折 $--」含示意佔位（滿 $-- 折 $-- 型）——佔位永不出貨";
  const m = msg.match(/^(page\.[A-Za-z0-9_.\-\[\]]+)「/);
  assert.equal(m[1].replace(/\[(\d+)\]/g, ".$1"), "page.floors.1.title");
});

test("CP-29／CP-28：句首判定互不誤攔", () => {
  assert.ok(/^商品槽「/.test("商品槽「product-right」是空的——版面會開天窗"));
  assert.ok(/^角落商品第 \d+ 件缺賣場編號/.test("角落商品第 2 件缺賣場編號——名稱與網址由商品資料自動帶出"));
  assert.ok(!/^商品槽「/.test("樓層 #1 商品槽「x」")); /* 非句首＝不攔，讓位給樓層分支 */
});
