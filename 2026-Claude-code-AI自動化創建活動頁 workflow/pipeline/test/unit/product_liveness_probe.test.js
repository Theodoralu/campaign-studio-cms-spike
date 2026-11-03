"use strict";
/**
 * workbench/product_fetch.js probeProductLiveness 單元測試（PRODUCT-DEAD-TWO-URLS，2026-09-28）
 * 病例＝2026-09-27 星巴克新品 213533：gdid 12087726 在售 $497，被檢查器一次 404 空殼判成「連結已失效」。
 * 守的規則：①任一拼法 online＝online ②全部拼法都非 online 才判死 ③每一次問了誰、對方回什麼留在 evidence.attempts
 *          ④網路層連不上＝同拼法重試一次、全連不上＝throw（不是「不在」）⑤網址怎麼拼只有 productFetchUrls 這一份
 * hermetic＝抓取樁照腳本回答、真的 classifyProductLiveness（price_qa）判三態，不觸網。
 */
const { test } = require("node:test");
const assert = require("node:assert");
const { probeProductLiveness, productFetchUrls, evidenceLine, createProductFetch } = require("../../workbench/product_fetch.js");
const { classifyProductLiveness } = require("../../price_qa.js");

const GD = "12087726";
const P_URL = `https://tw.buy.yahoo.com/gdsale/p-${GD}.html`;
const ASP_URL = `https://tw.buy.yahoo.com/gdsale/gdsale.asp?gdid=${GD}`;
const OG = `https://s.yimg.com/zp/MerchandiseImages/abc-Gd-${GD}.jpg`;
/* 真下架與偶發空殼長一模一樣（2026-09-27 對照 gdid 10000001 實抓：346KB、title「Yahoo購物中心 - 最懂生活的人」、無商品實體） */
const SHELL = `<html><head><title>Yahoo購物中心 - 最懂生活的人</title></head><body><div id="app"></div></body></html>`;
const LIVE = `<html><head><title>星巴克 夾心肉鬆蛋捲禮盒 204g</title><meta property="og:image" content="${OG}"></head>` +
  `<body><script>{"Shopping_Product:${GD}":{"currentPrice":"497","marketPrice":"497","title":"星巴克 夾心肉鬆蛋捲禮盒 204g"}}</script></body></html>`;
const R404 = { html: SHELL, statusCode: 404 }, R200SHELL = { html: SHELL, statusCode: 200 }, R200 = { html: LIVE, statusCode: 200 };

/** 抓取樁：照腳本順序回答（Error＝丟例外）、記錄問過的網址 */
function scripted(answers) {
  const asked = []; let i = 0;
  return { asked, fetchPage: async (u) => { asked.push(u); const a = answers[Math.min(i++, answers.length - 1)]; if (a instanceof Error) throw a; return a; } };
}
const probe = (s, extra = {}) => probeProductLiveness({ gdid: GD, url: ASP_URL, fetchPage: s.fetchPage, classifyProductLiveness, delayMs: 0, ...extra });

test("productFetchUrls：網址怎麼拼只有這一份——數字型 asp 形→[p-,asp]；slug 形→[原網址,asp]；無網址→[p-,asp]；p 型→asp 形問兩次", () => {
  assert.deepStrictEqual(productFetchUrls(GD, ASP_URL), [P_URL, ASP_URL]);
  const slug = `https://tw.buy.yahoo.com/gdsale/starbucks-gift-${GD}.html`;
  assert.deepStrictEqual(productFetchUrls(GD, slug), [slug, ASP_URL]);
  assert.deepStrictEqual(productFetchUrls(GD, null), [P_URL, ASP_URL]);
  const PG = "p0216265344571", PASP = `https://tw.buy.yahoo.com/gdsale/gdsale.asp?gdid=${PG}`;
  assert.deepStrictEqual(productFetchUrls(PG, PASP), [PASP, PASP], "p 型只有 asp 形有 SSR＝同一網址當第二證據");
});

test("迴歸 12087726：p- 形一次 404 空殼、asp 形 200 有商品 → online（不是 dead）；兩次都留證據", async () => {
  const s = scripted([R404, R200]);
  const r = await probe(s);
  assert.strictEqual(r.status, "online");
  assert.strictEqual(r.prod.price, 497);
  assert.deepStrictEqual(s.asked, [P_URL, ASP_URL], "第一種拼法沒答案就換第二種再問");
  assert.strictEqual(r.evidence.attempts.length, 2);
  assert.strictEqual(r.evidence.attempts[0].status, "dead"); assert.strictEqual(r.evidence.attempts[0].httpStatus, 404);
  assert.strictEqual(r.evidence.attempts[1].status, "online"); assert.strictEqual(r.evidence.attempts[1].httpStatus, 200);
  assert.strictEqual(r.evidence.fetchUrl, ASP_URL, "fetchUrl＝有回商品資料的那個拼法");
  assert.strictEqual(r.html, LIVE, "呼叫端（貼稿選品抓圖）要拿得到有商品的那頁 html");
  const line = evidenceLine(r.evidence);
  assert.match(line, /問了 2 次/); assert.match(line, /p-12087726\.html → HTTP 404 空殼/); assert.match(line, /gdsale\.asp\?gdid=12087726 → HTTP 200 有商品/);
});

test("第一次就 online → 只問一次（不多花一次網路）", async () => {
  const s = scripted([R200]);
  const r = await probe(s);
  assert.strictEqual(r.status, "online");
  assert.deepStrictEqual(s.asked, [P_URL]);
  assert.strictEqual(r.evidence.asked, 1);
});

test("真下架：兩種拼法都 404 同一空殼 → dead；evidence 兩筆、statusCode 404", async () => {
  const s = scripted([R404, R404]);
  const r = await probe(s);
  assert.strictEqual(r.status, "dead");
  assert.strictEqual(r.prod, null);
  assert.deepStrictEqual(s.asked, [P_URL, ASP_URL], "判死前兩種拼法都問過");
  assert.strictEqual(r.evidence.attempts.length, 2);
  assert.strictEqual(r.statusCode, 404);
  assert.strictEqual(r.evidence.pageTitle, "Yahoo購物中心 - 最懂生活的人", "頁標題留下＝事後看得出對方回的是空殼");
});

test("200 空殼＋404 空殼 → offline（頁在但沒商品資料，比「連結失效」更接近事實）", async () => {
  const r = await probe(scripted([R200SHELL, R404]));
  assert.strictEqual(r.status, "offline");
  assert.strictEqual(r.evidence.attempts.length, 2);
});

test("網路層：第一種拼法連丟兩次（重試一次仍失敗）→ 換第二種拼法問到 online；例外那一筆留在 attempts", async () => {
  const s = scripted([new Error("ECONNRESET"), new Error("ECONNRESET"), R200]);
  const r = await probe(s);
  assert.strictEqual(r.status, "online");
  assert.deepStrictEqual(s.asked, [P_URL, P_URL, ASP_URL], "同一拼法連不上重試一次（原 fetchRetry 慣例）再換拼法");
  assert.strictEqual(r.evidence.attempts.length, 2);
  assert.match(r.evidence.attempts[0].error, /ECONNRESET/);
  assert.match(evidenceLine(r.evidence), /連不上（ECONNRESET）/);
});

test("網路層：全部拼法都連不上 → throw（呼叫端記 unverified／502），err.attempts 帶證據——「連不上」不是「不在」", async () => {
  const s = scripted([new Error("timeout")]);
  await assert.rejects(() => probe(s), (e) => { assert.match(e.message, /timeout/); assert.strictEqual(e.attempts.length, 2); return true; });
  assert.deepStrictEqual(s.asked, [P_URL, P_URL, ASP_URL, ASP_URL]);
});

test("貼稿選品（createProductFetch）走同一支：p- 形一次 404 → asp 形 200 → 收下商品；兩種都 404 → 400 連結已失效＋evidence", async () => {
  const ok = scripted([R404, R200]);
  const pf = createProductFetch({ fetchPage: ok.fetchPage, classifyProductLiveness, probeDelayMs: 0 });
  const r = await pf({ url: ASP_URL });
  assert.strictEqual(r.code, 200, JSON.stringify(r));
  assert.strictEqual(r.product.price, 497);
  assert.strictEqual(r.product.imgs[0], OG);
  assert.deepStrictEqual(ok.asked, [P_URL, ASP_URL]);
  const dead = scripted([R404, R404]);
  const pf2 = createProductFetch({ fetchPage: dead.fetchPage, classifyProductLiveness, probeDelayMs: 0 });
  const r2 = await pf2({ url: ASP_URL });
  assert.strictEqual(r2.code, 400);
  assert.match(r2.error, /連結已失效/);
  assert.strictEqual(r2.evidence.attempts.length, 2, "拒收也要留下問了誰");
});

/* 迴歸 11688645（2026-10-14，第九版實測）：「(特)」品只有帶簽章 sw= 的 asp 形回 200；p- 形與不帶 sw 的 asp 形都 404 空殼。
   舊行為＝簽章被丟掉 → 兩次都 404 → 判死、價格校不到（促銷價 8541 停在列表價 8990）。 */
test("迴歸 11688645：帶簽章 sw= 的網址先照原網址問——在賣就是 online、價格取得到促銷價", async () => {
  const SG = "11688645";
  const SIGNED = `https://tw.buy.yahoo.com/gdsale/gdsale.asp?gdid=${SG}&sw=49e26c455c97be9f`;
  const LIVE_SG = `<html><head><title>Yahoo購物中心</title></head><body><script>{"Shopping_Product:${SG}":{"marketPrice":"10900","currentPrice":"8990","promotionPrice":"8541","title":"DIKE 全自動臭氧烘乾洗碗機 HKE700WT(特)"}}</script></body></html>`;
  assert.deepStrictEqual(productFetchUrls(SG, SIGNED), [SIGNED, `https://tw.buy.yahoo.com/gdsale/gdsale.asp?gdid=${SG}`]);
  const s = scripted([{ html: LIVE_SG, statusCode: 200 }]);
  const r = await probeProductLiveness({ gdid: SG, url: SIGNED, fetchPage: s.fetchPage, classifyProductLiveness, delayMs: 0 });
  assert.strictEqual(r.status, "online");
  assert.deepStrictEqual(s.asked, [SIGNED], "第一次就問帶簽章的原網址");
  assert.strictEqual(r.prod.price, 8541, "實付價＝促銷價，不是列表上的網路價");
  // 簽章網址也 404 才判死（兩種拼法都問過）
  const s2 = scripted([R404, R404]);
  const r2 = await probeProductLiveness({ gdid: SG, url: SIGNED, fetchPage: s2.fetchPage, classifyProductLiveness, delayMs: 0 });
  assert.strictEqual(r2.status, "dead");
  assert.strictEqual(s2.asked[0], SIGNED);
});
