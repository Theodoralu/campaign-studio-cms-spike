"use strict";
/**
 * workbench/product_fetch.js 單元測試（2026-08-26 主打選品貼稿批：自 server.js 抽出＝抽出零回歸絆線）
 * hermetic＝注入樁 fetchPage／classifyProductLiveness（不觸網）。
 * 守的邏輯：
 *   ①gdid 解析兩型＋xgdid 防誤抽（F9-1 審查修）　②賣場編號裸輸入＝組 gdsale 網址、實抓走 p-<gdid>.html
 *   ③網域白名單（僅 tw.buy.yahoo.com https）＋必須商品頁（/gdsale/）　④存活三態：offline/dead＝白話拒收
 *   ⑤pageGdids 互斥預檢（替換情境 409＝抽出前行為保留）　⑥真值欄：name/price/marketPrice 逐字自實抓、
 *     og:image 置首、缺名稱或價格＝400（不捏造）
 */
const { test } = require("node:test");
const assert = require("node:assert");

const { gdidOf, createProductFetch } = require("../../workbench/product_fetch.js");

const GD = "10309671";
const OG = `https://s.yimg.com/zp/MerchandiseImages/abc-Gd-${GD}.jpg`;
const IMG2 = `https://s.yimg.com/zp/MerchandiseImages/def-Gd-${GD}.jpg`;
function pageHtml() {
  return `<html><head><meta property="og:image" content="${OG}"></head>
  <body><img src="${IMG2}"><img src="${OG}"></body></html>`;
}
/** 注入樁工廠：紀錄 fetch 過的網址＋可指定存活三態與實抓真值 */
function stubbed({ status = "online", prod = { title: "測試主打品", price: 990, listPrice: 1290 }, html = pageHtml(), fetchErr = null } = {}) {
  const fetched = [];
  const pf = createProductFetch({
    fetchPage: async (url) => { fetched.push(url); if (fetchErr) throw fetchErr; return { html, statusCode: 200 }; },
    classifyProductLiveness: () => ({ status, prod }),
    probeDelayMs: 0, // 兩種拼法之間不等（2026-09-28 兩證據制；測試不觸網）
  });
  return { pf, fetched };
}

test("gdid 解析兩型：gdsale.asp?gdid= 與 -<gdid>.html；?xgdid=＝不誤抽（F9-1 參數界定）", () => {
  assert.strictEqual(gdidOf(`https://tw.buy.yahoo.com/gdsale/gdsale.asp?gdid=${GD}`), GD);
  assert.strictEqual(gdidOf(`https://tw.buy.yahoo.com/gdsale/p-${GD}.html`), GD);
  assert.strictEqual(gdidOf(`https://tw.buy.yahoo.com/gdsale/some-product-name-${GD}.html`), GD, "slug 尾碼型同收");
  assert.strictEqual(gdidOf(`https://tw.buy.yahoo.com/gdsale/x.html?xgdid=${GD}`), null, "xgdid ≠ gdid（誤抽防護）");
  assert.strictEqual(gdidOf("https://tw.buy.yahoo.com/gdsale/"), null);
});

test("賣場編號裸輸入＝組 gdsale 網址＋實抓走 p-<gdid>.html；真值欄逐字自實抓（name/price/marketPrice、og 置首）", async () => {
  const { pf, fetched } = stubbed();
  const r = await pf({ url: `　賣場編號：${GD} ` });
  assert.strictEqual(r.code, 200);
  assert.deepStrictEqual(fetched, [`https://tw.buy.yahoo.com/gdsale/p-${GD}.html`], "gdsale.asp 型＝改抓 p-<gdid>.html");
  assert.strictEqual(r.product.gdid, GD);
  assert.strictEqual(r.product.name, "測試主打品");
  assert.strictEqual(r.product.price, 990);
  assert.strictEqual(r.product.marketPrice, 1290, "listPrice > price 才收＝原價顯示語意");
  assert.strictEqual(r.product.imgs[0], OG, "og:image 置首（商品卡第一張語意）");
  assert.ok(r.product.imgs.includes(IMG2));
});

test("商品頁網址（-<gdid>.html 型）＝照原網址實抓；listPrice 不高於現價＝不收 marketPrice", async () => {
  const { pf, fetched } = stubbed({ prod: { title: "測試主打品", price: 990, listPrice: 990 } });
  const url = `https://tw.buy.yahoo.com/gdsale/p-${GD}.html`;
  const r = await pf({ url });
  assert.strictEqual(r.code, 200);
  assert.deepStrictEqual(fetched, [url]);
  assert.ok(!("marketPrice" in r.product), "劃線價顯示語意：不高於現價＝不標原價");
});

test("下架拒收（三態非 online＝白話擋、不觸發任何寫入）：offline／dead 各自白話", async () => {
  const off = stubbed({ status: "offline" });
  const rOff = await off.pf({ url: GD });
  assert.strictEqual(rOff.code, 400);
  assert.match(rOff.error, /已下架或沒有現價/);
  const dead = stubbed({ status: "dead" });
  const rDead = await dead.pf({ url: GD });
  assert.strictEqual(rDead.code, 400);
  assert.match(rDead.error, /連結已失效/);
});

test("網域白名單＋商品頁限定：非 Yahoo購物中心／非 https／非 /gdsale/＝400 且不實抓；亂字串＝白話引導", async () => {
  const { pf, fetched } = stubbed();
  assert.strictEqual((await pf({ url: "https://example.com/gdsale/p-1234567.html" })).code, 400);
  assert.strictEqual((await pf({ url: "http://tw.buy.yahoo.com/gdsale/p-1234567.html" })).code, 400, "http 降級＝拒");
  assert.strictEqual((await pf({ url: "https://tw.buy.yahoo.com/brand/xxx" })).code, 400, "品牌頁＝非商品頁");
  const rBad = await pf({ url: "不是網址也不是編號" });
  assert.strictEqual(rBad.code, 400);
  assert.match(rBad.error, /賣場編號/);
  assert.deepStrictEqual(fetched, [], "守門全在實抓前＝一次網路都不碰");
});

test("pageGdids 互斥預檢＝409（替換情境保留；貼稿選品不傳＝允許引用既有品）", async () => {
  const { pf } = stubbed();
  const r = await pf({ url: GD, pageGdids: [GD] });
  assert.strictEqual(r.code, 409);
  assert.match(r.error, /已經在頁面上了/);
  const r2 = await pf({ url: GD, pageGdids: ["999999"] });
  assert.strictEqual(r2.code, 200, "不在頁上＝照常放行");
});

test("實抓防呆：fetchPage 拋錯＝502 白話＋技術訊息收尾；讀不到名稱或價格＝400；抓不到支援圖床的圖＝400", async () => {
  const err = stubbed({ fetchErr: new Error("ECONNRESET") });
  const rErr = await err.pf({ url: GD });
  assert.strictEqual(rErr.code, 502);
  assert.match(rErr.error, /技術訊息：ECONNRESET/);
  const noName = stubbed({ prod: { title: "", price: 990 } });
  const rNoName = await noName.pf({ url: GD });
  assert.strictEqual(rNoName.code, 400);
  assert.match(rNoName.error, /缺名稱或價格/);
  const noImg = stubbed({ html: "<html><body>沒有圖</body></html>" });
  const rNoImg = await noImg.pf({ url: GD });
  assert.strictEqual(rNoImg.code, 400);
  assert.match(rNoImg.error, /抓不到商品圖片/);
});

test("回傳 url＝實際問到的那個網址（2026-10-04 死鎖汙染源根治）：裸編號／asp 式輸入→實抓 p- 式→url 必為 p- 式", async () => {
  const GD2 = "7460184";
  const og2 = `https://img.yec.tw/zp/MerchandiseImages/88EC3FAE05-Gd-${GD2}.jpg`;
  const html2 = `<html><head><meta property="og:image" content="${og2}"></head><body><img src="${og2}"></body></html>`;
  const fetched = [];
  const pf = createProductFetch({
    fetchPage: async (url) => { fetched.push(url); return { html: html2, statusCode: 200 }; },
    classifyProductLiveness: () => ({ status: "online", prod: { title: "統一麵 蔥燒牛肉風味", price: 154 } }),
    probeDelayMs: 0,
  });
  for (const input of [GD2, `https://tw.buy.yahoo.com/gdsale/gdsale.asp?gdid=${GD2}`]) {
    fetched.length = 0;
    const r = await pf({ url: input });
    assert.strictEqual(r.code, 200);
    assert.strictEqual(fetched[0], `https://tw.buy.yahoo.com/gdsale/p-${GD2}.html`, "實抓走 p- 式（既有行為）");
    assert.strictEqual(r.product.url, fetched[0],
      "url 必須＝實抓成功的那個網址；原本回報輸入式→真值同步把 asp 式寫進快照＝與原始抓取 p- 式打架（run 211607 死鎖）");
  }
});
