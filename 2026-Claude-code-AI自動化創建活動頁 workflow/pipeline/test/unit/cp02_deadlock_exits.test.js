"use strict";
/**
 * 死鎖出口絆線（2026-10-04；run 2026-10-04-wb-211607）——四道比對門＋三顆解法鈕，鎖「同一條規則一個家」。
 *
 * 病史三代同病：2026-07-27 價格死循環、2026-09-26 來源紀錄死巷、2026-10-04 連結換式死鎖——
 * 每一代都是「草稿 vs 來源紀錄打架，而介面上沒有可行動作」。本檔兩件事：
 *  A) 等價函式本體行為（真跑）
 *  B) 原始碼樣式絆線（沿 explore_more_fix.test.js 慣例）：四道門必須用 sameProductUrl、
 *     出口鈕條件不得再綁訊息字串——誰改回手寫 !== 或縮回舊條件，這裡當場紅。
 */
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const { sameProductUrl, productUrlKey, syncPoolEntry } = require("../../workbench/content_checks.js");

const ASP = (g) => `https://tw.buy.yahoo.com/gdsale/gdsale.asp?gdid=${g}`;
const PHTML = (g) => `https://tw.buy.yahoo.com/gdsale/p-${g}.html`;

test("sameProductUrl：兩式同編號＝同一件；異編號／站外同路徑＝不同；非商品網址＝回退字串比對", () => {
  assert.ok(sameProductUrl(ASP("7460184"), PHTML("7460184")), "asp↔p- 同編號＝等價（病例本體）");
  assert.ok(sameProductUrl(PHTML("7460184"), "https://tw.buy.yahoo.com/gdsale/slug-name-7460184.html"), "slug 尾碼式同收");
  assert.ok(!sameProductUrl(ASP("7460184"), PHTML("7460185")), "差一號＝不同商品");
  assert.ok(!sameProductUrl(ASP("7460184"), "https://evil.example.com/gdsale/p-7460184.html"), "站外網域＝不給等價鍵（網域守門歸 CP-04，這裡不放水）");
  assert.ok(sameProductUrl("https://tw.buy.yahoo.com/activity/x?actid=1", "https://tw.buy.yahoo.com/activity/x?actid=1"), "活動頁＝字串全等才同");
  assert.ok(!sameProductUrl("https://tw.buy.yahoo.com/activity/x?actid=1", "https://tw.buy.yahoo.com/activity/x?actid=2"));
  assert.strictEqual(productUrlKey("not a url"), null);
});

test("syncPoolEntry：等價換式＝不覆寫、不記 changed（不汙染池、不無謂廢核可）；真的變了＝照同步", () => {
  const exist = { gdid: "7460184", name: "統一麵", price: 154, marketPrice: null, disc: null, url: PHTML("7460184"), imgs: ["https://img.yec.tw/a.jpg"] };
  const changed = syncPoolEntry(exist, { gdid: "7460184", name: "統一麵", price: 154, url: ASP("7460184"), imgs: ["https://img.yec.tw/a.jpg"] });
  assert.deepStrictEqual(changed, [], "等價＝整組零變更");
  assert.strictEqual(exist.url, PHTML("7460184"), "池內原始抓取的 p- 式不被換式覆寫（2026-10-04 病例的汙染動作）");
  const changed2 = syncPoolEntry(exist, { gdid: "7460184", name: "統一麵", price: 154, url: PHTML("9999999"), imgs: ["https://img.yec.tw/a.jpg"] });
  assert.ok(changed2.includes("url"), "真的指到別件＝照同步（等價判定不是放水）");
});

/* ---------- B) 原始碼樣式絆線：四道門＋出口鈕 ---------- */
const P = (...seg) => path.join(__dirname, "..", "..", ...seg);
const read = (...seg) => fs.readFileSync(P(...seg), "utf8");

test("四道比對門全部走 sameProductUrl（鐵律 4：同一條規則一個家，改回手寫 !== ＝紅）", () => {
  const gate = read("gate.js");
  assert.match(gate, /!sameProductUrl\(row\.url, src\.url\)[\s\S]{0,40}連結與來源不符/, "門 1：gate 商品列連結");
  assert.match(gate, /!sameProductUrl\(e\.url, promo\.url\)[\s\S]{0,60}連結非來源逐字/, "門 2：gate 入口連結");
  assert.match(gate, /require\("\.\/workbench\/content_checks\.js"\)/, "gate 自 content_checks 取等價函式＝單一真源");
  const cc = read("workbench", "content_checks.js");
  assert.match(cc, /p\.url && exist\.url !== p\.url && !sameProductUrl\(exist\.url, p\.url\)/, "門 3：syncPoolEntry 池同步");
  const sv = read("workbench", "server.js");
  assert.match(sv, /pr\.url && src\.url && !sameProductUrl\(pr\.url, src\.url\)/, "門 4：策展後真值收斂");
});

test("汙染源已堵：productFetch 回傳「實際問到的網址」而非使用者輸入", () => {
  const pf = read("workbench", "product_fetch.js");
  assert.match(pf, /url: \(live\.evidence && live\.evidence\.fetchUrl\) \|\| url/, "out.url＝evidence.fetchUrl");
});

test("出口鈕條件：孤兒看「在不在頁面上」不綁訊息字串；重建來源紀錄涵蓋「與來源不符」家族；孤兒條目給「清出這件」", () => {
  const html = read("workbench", "public", "index.html");
  assert.match(html, /if \(!sectionOfGdid\(g\)\) return \{ orphan: true, gdid: g \};/, "孤兒判定＝純商品狀態（原本綁「不存在於快照」字串＝其餘 17 種錯誤死巷）");
  assert.match(html, /不存在於快照\|不在 P2\|與來源不符\|≠ 來源\|不在來源圖庫/, "重建來源紀錄鈕涵蓋真值打架家族");
  assert.match(html, /f\.ref && f\.ref\.orphan[\s\S]{0,200}removeOrphanProduct\('\$\{esc\(String\(f\.ref\.gdid\)\)\}', this\)/, "發佈前檢查清單孤兒條目＝「清出這件」真出口（原本給去修＝死巷 toast）");
});
