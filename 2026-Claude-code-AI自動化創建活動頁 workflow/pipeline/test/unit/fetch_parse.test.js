"use strict";
/**
 * fetch_parse.js 單元測試（零新相依，僅 node:test）
 * 不觸網（不呼叫 fetchPage）。合成最小 bundle 字串驗核心解析邏輯。
 *
 * 重點：parseActivityPage 促銷價偏好（2026-07-27 修）
 *   - "promotionPrice":880（無引號數字）      → price=880
 *   - "promotionPrice":"880"（加引號字串）     → price=880
 *   - 無促銷欄位                                 → price=currentPrice、promotionPrice=null
 *   - disc 以「實付價」計（促銷時用 880 而非 currentPrice）
 * 另含 classifyLiveness / hasActivityData / extractActivityPeriod 最小案例。
 */
const { test } = require("node:test");
const assert = require("node:assert");

const {
  parseActivityPage,
  parseFlagshipPage,
  parseActivityLinks,
  parseListingHits,
  extractActivityPeriod,
  classifyLiveness,
  hasActivityData,
} = require("../../fetch_parse.js");

/**
 * 依 parseActivityPage 主正則合成一個 Shopping_Promotion_ProductBundle 片段。
 * 欄位順序／引號需嚴格對齊源碼正則（見 fetch_parse.js parseActivityPage）。
 * @param {object} o
 * @param {string} [o.promoField] 促銷價原始片段（含前導逗號），null/undefined＝無促銷
 */
function makeBundle(o = {}) {
  const {
    gdid = "12345",
    name = "測試商品",
    desc = "說明文字",
    current = 1000,
    market = 1200,
    promoField = "", // 例：',"promotionPrice":880' 或 ',"promotionPrice":"880"'
    url = "/gdsale/test-12345.html",
    img = "https://s.yimg.com/img/1.jpg",
  } = o;
  return (
    `"Shopping_Promotion_ProductBundle:${gdid}":` +
    `{"__typename":"Shopping_Promotion_ProductBundle","id":"${gdid}",` +
    `"title({"revertYIV":true})":"${name}",` +
    `"description":"${desc}",` +
    `"currentPrice":${current},"marketPrice":${market}` +
    `${promoField},` +
    `"url":"${url}",` +
    `"imageSet":[[{"__typename":"Shopping_ProductImage","url":"${img}"}]],` +
    `"__trailing":"x"}`
  );
}

// ───────────────────────── parseActivityPage：促銷價偏好 ─────────────────────────

test("parseActivityPage: 促銷價無引號數字 '\"promotionPrice\":880' → price=880", () => {
  const html = makeBundle({ current: 1000, market: 1200, promoField: ',"promotionPrice":880' });
  const { products } = parseActivityPage(html);
  assert.strictEqual(products.length, 1, "應解析出 1 件商品");
  const p = products[0];
  assert.strictEqual(p.price, 880, "實付價應取促銷價 880");
  assert.strictEqual(p.currentPrice, 1000, "currentPrice 應保留 1000");
  assert.strictEqual(p.promotionPrice, 880, "promotionPrice 應為 880");
  /* 2026-07-27 劃線價真值修（gdid 11581454 實證）：marketPrice 欄＝商品頁顯示語意（促銷才有劃線、劃 currentPrice）；
     廠商建議售價（bundle marketPrice 1200，商品頁不顯示）另存 vendorMarketPrice */
  assert.strictEqual(p.marketPrice, 1000, "劃線價＝currentPrice（促銷中）");
  assert.strictEqual(p.vendorMarketPrice, 1200, "廠商建議售價透明保留");
});

test("parseActivityPage: 促銷價加引號字串 '\"promotionPrice\":\"880\"' → price=880（容忍字串形式）", () => {
  const html = makeBundle({ current: 1000, market: 1200, promoField: ',"promotionPrice":"880"' });
  const { products } = parseActivityPage(html);
  assert.strictEqual(products.length, 1);
  const p = products[0];
  assert.strictEqual(p.price, 880, "加引號字串形式仍應抓到 880");
  assert.strictEqual(p.currentPrice, 1000);
  assert.strictEqual(p.promotionPrice, 880);
});

test("parseActivityPage: 無促銷欄位 → price=currentPrice、promotionPrice=null", () => {
  const html = makeBundle({ current: 1000, market: 1200, promoField: "" });
  const { products } = parseActivityPage(html);
  assert.strictEqual(products.length, 1);
  const p = products[0];
  assert.strictEqual(p.price, 1000, "無促銷時實付價=網路價 1000");
  assert.strictEqual(p.promotionPrice, null, "無促銷時 promotionPrice 應為 null");
  assert.strictEqual(p.currentPrice, 1000);
});

test("parseActivityPage: disc 以「實付/劃線價」計；無促銷＝無劃線＝無折數（2026-07-27 劃線價真值修）", () => {
  const withPromo = parseActivityPage(
    makeBundle({ current: 1000, market: 1200, promoField: ',"promotionPrice":880' })
  ).products[0];
  const noPromo = parseActivityPage(
    makeBundle({ current: 1000, market: 1200, promoField: "" })
  ).products[0];
  // 促銷：round(880/1000*100)=88（劃線＝currentPrice，非廠商價 1200——商品頁不顯示廠商價）；
  // 無促銷：商品頁無劃線價＝disc null、marketPrice null（原以 1200 計 83 折＝虛深折扣，11581454 實證修正）
  assert.strictEqual(withPromo.disc, 88, "disc 以實付 880／劃線 1000 計 = 88");
  assert.strictEqual(withPromo.marketPrice, 1000);
  assert.strictEqual(noPromo.disc, null, "無促銷＝無劃線＝無折數");
  assert.strictEqual(noPromo.marketPrice, null, "無促銷＝不顯示灰價");
  assert.strictEqual(noPromo.vendorMarketPrice, 1200);
});

test("parseActivityPage: 促銷價 >= 網路價則不採用（退回網路價）", () => {
  const html = makeBundle({ current: 900, market: 1200, promoField: ',"promotionPrice":950' });
  const p = parseActivityPage(html).products[0];
  assert.strictEqual(p.price, 900, "促銷價未低於網路價時，實付價退回網路價 900");
  assert.strictEqual(p.promotionPrice, 950, "promotionPrice 仍逐字保留 950");
});

test("parseActivityPage: 解析基本欄位（名稱／圖庫／絕對化 URL）＋ meta.resultsTotal", () => {
  const html =
    `"resultsTotal":42,` +
    makeBundle({ name: "藍牙耳機", url: "/gdsale/abc.html", img: "https://s.yimg.com/img/a.jpg" });
  const { products, meta } = parseActivityPage(html);
  assert.strictEqual(meta.resultsTotal, 42);
  const p = products[0];
  assert.strictEqual(p.name, "藍牙耳機");
  assert.deepStrictEqual(p.imgs, ["https://s.yimg.com/img/a.jpg"], "應抽出圖庫 URL");
  assert.ok(p.url.startsWith("https://tw.buy.yahoo.com/"), "相對 URL 應絕對化到 tw.buy.yahoo.com");
  assert.strictEqual(p.source, "activity");
});

// ───────── parseFlagshipPage / parseActivityLinks（2026-07-30 旗艦店/主題館頁型根治）─────────

/** 合成旗艦店頁最小 HTML：Apollo 快取容器＝<script id="gqlstate-data" type="mime/invalid">（實頁實證格式） */
function makeFlagshipHtml(state) {
  return `<html><head><script id="gqlstate-data" type="mime/invalid">${JSON.stringify(state)}</script></head></html>`;
}

test("parseFlagshipPage: Shopping_PromotionList_Promotion → 活動檔（檔期逐字＋banner＋旗艦店名）", () => {
  const html = makeFlagshipHtml({
    "Shopping_Category:749": { __typename: "Shopping_Category", id: "749", title: "PUMA旗艦店", level: "2" },
    "Shopping_PromotionList_Promotion:779114": {
      __typename: "Shopping_PromotionList_Promotion", id: "779114",
      'name({"revertYIV":true})': "PUMA 新品搶先購 任2件再享8折",
      bannerImage: [{ __typename: "Shopping_PromotionImage", img_950: "https://img.yec.tw/zp/a.jpg", img_620: "https://img.yec.tw/zp/b.jpg" }],
      description: "品牌日限定！", url: "https://tw.buy.yahoo.com/activity/onsale?actid=779114",
      is_hidden: false, start_date: 1785376800, end_date: 1785463199,
    },
  });
  const out = parseFlagshipPage(html);
  assert.strictEqual(out.promotions.length, 1, "應解析出 1 個活動檔");
  const p = out.promotions[0];
  assert.strictEqual(p.actid, "779114");
  assert.strictEqual(p.title, "PUMA 新品搶先購 任2件再享8折", "標題取 name(revertYIV) 鍵");
  assert.strictEqual(p.startTs, 1785376800, "檔期逐字＝start_date");
  assert.strictEqual(p.endTs, 1785463199, "檔期逐字＝end_date");
  assert.ok(p.period && p.period.includes("~"), "period 應由檔期組出");
  assert.strictEqual(p.banner, "https://img.yec.tw/zp/a.jpg", "banner 優先取 img_950");
  assert.strictEqual(out.brand, "PUMA旗艦店", "旗艦店名＝二層分類 title");
});

test("parseFlagshipPage: is_hidden / 無 url 的活動檔應濾除", () => {
  const html = makeFlagshipHtml({
    "Shopping_PromotionList_Promotion:1": { id: "1", 'name({"revertYIV":true})': "隱藏檔", url: "https://x", is_hidden: true, start_date: 1, end_date: 2 },
    "Shopping_PromotionList_Promotion:2": { id: "2", 'name({"revertYIV":true})': "無連結檔", is_hidden: false, start_date: 1, end_date: 2 },
  });
  assert.strictEqual(parseFlagshipPage(html).promotions.length, 0);
});

test("parseFlagshipPage: 無 gqlstate-data → 空結果；壞 JSON → parseError 出聲不吞錯", () => {
  assert.deepStrictEqual(parseFlagshipPage("<html>沒有快取</html>").promotions, []);
  const bad = parseFlagshipPage('<script id="gqlstate-data" type="mime/invalid">{壞掉的json</script>');
  assert.deepStrictEqual(bad.promotions, []);
  assert.ok(bad.parseError, "JSON 解析失敗必須帶 parseError（鐵律 3：失敗要出聲）");
});

test("parseActivityLinks: 抽 distinct actid、絕對化 URL；重複連結去重；無連結回空陣列", () => {
  const html = '<a href="/activity/onsale?actid=771331">A</a> <a href="https://tw.buy.yahoo.com/activity/onsale?actid=771331&sub=x">A2</a> <a href="/activity/onsale?actid=776018">B</a>';
  const links = parseActivityLinks(html);
  assert.strictEqual(links.length, 2, "同 actid 應去重");
  assert.deepStrictEqual(links.map((l) => l.actid).sort(), ["771331", "776018"]);
  assert.ok(links.every((l) => l.url === `https://tw.buy.yahoo.com/activity/onsale?actid=${l.actid}`));
  assert.ok(links.every((l) => l.startTs === null && l.period === null), "連結型無列載檔期＝null（由活動頁 SSR 補）");
  assert.deepStrictEqual(parseActivityLinks("<html>no links</html>"), []);
  assert.deepStrictEqual(parseActivityLinks(null), []);
});

// ───────── parseListingHits（2026-07-30 方案A：純商品池頁支援）─────────

/** 合成商品清單 hit 區塊：ec_* 欄位在前、display 子物件（sourcetitle…producturl）在後＝實頁實證順序 */
function makeListingHit(o = {}) {
  const { gdid = "11404093", name = "Puma 休閒鞋 Speedcat OG", url = `https://tw.buy.yahoo.com/gdsale/gdsale.asp?gdid=${gdid}`,
    ecPrice = "3280.0", img = `https://img.yec.tw/zp/MerchandiseImages/62ae-Gd-${gdid}.jpg` } = o;
  return `{"ec_price":"${ecPrice}","ec_image":"${img}","creditprice":"3280",` +
    `"sourcetitle":"Yahoo!奇摩購物中心","catname_full":"運動\\t運動男鞋\\tPUMA\\t休閒鞋",` +
    `"productname_disp":"${name}","producturl":"${url}","subcatname":"休閒鞋"}`;
}

test("parseListingHits: 抽 gdid/品名/清單價/錨定圖（gdsale.asp?gdid= 舊型連結）", () => {
  const hits = parseListingHits(makeListingHit());
  assert.strictEqual(hits.length, 1);
  const h = hits[0];
  assert.strictEqual(h.gdid, "11404093");
  assert.strictEqual(h.name, "Puma 休閒鞋 Speedcat OG");
  assert.strictEqual(h.ecPrice, "3280.0");
  assert.ok(h.img && h.img.includes("-Gd-11404093"), "圖必須帶 -Gd-<gdid> 錨定");
  assert.strictEqual(h.subcat, "休閒鞋");
});

test("parseListingHits: …-N.html 新型連結也抽得到 gdid；同 gdid 去重", () => {
  const html = makeListingHit({ gdid: "12175596", url: "https://tw.buy.yahoo.com/gdsale/PUMA-鞋-12175596.html" }) +
    makeListingHit({ gdid: "12175596", url: "https://tw.buy.yahoo.com/gdsale/PUMA-鞋-12175596.html" });
  const hits = parseListingHits(html);
  assert.strictEqual(hits.length, 1, "同 gdid 應去重");
  assert.strictEqual(hits[0].gdid, "12175596");
});

test("parseListingHits: -SP-<規格id> 檔名 key 的圖也收（區塊所有權錨定，非檔名驗）；無 gdid 連結＝整筆略過", () => {
  const spImg = parseListingHits(makeListingHit({ img: "https://img.yec.tw/zp/M/8579FCD0C7-SP-19464296.jpg" }));
  assert.strictEqual(spImg[0].img, "https://img.yec.tw/zp/M/8579FCD0C7-SP-19464296.jpg", "同區塊圖＝本品的圖（實頁 52/60 件為 -SP- key）");
  const noGdid = parseListingHits(makeListingHit({ url: "https://tw.buy.yahoo.com/some/other/page" }));
  assert.strictEqual(noGdid.length, 0, "抽不到 gdid＝不可實抓驗價＝略過");
  assert.deepStrictEqual(parseListingHits(""), []);
  assert.deepStrictEqual(parseListingHits(null), []);
});

test("parseListingHits: 相鄰兩 hit 的 ec_* 欄位不互相汙染（取窗內最後匹配）", () => {
  const html = makeListingHit({ gdid: "11111111", ecPrice: "100.0", img: "https://img.yec.tw/zp/M/a-Gd-11111111.jpg" }) +
    makeListingHit({ gdid: "22222222", ecPrice: "200.0", img: "https://img.yec.tw/zp/M/b-Gd-22222222.jpg" });
  const hits = parseListingHits(html);
  assert.strictEqual(hits.length, 2);
  assert.strictEqual(hits[0].ecPrice, "100.0");
  assert.strictEqual(hits[1].ecPrice, "200.0", "第二 hit 不得撿到第一 hit 的價");
  assert.ok(hits[1].img.includes("-Gd-22222222"));
});

// ───────────────────────── extractActivityPeriod ─────────────────────────

test("extractActivityPeriod: 帶時刻的檔期逐字抽取", () => {
  const r = extractActivityPeriod("活動時間: 2026/07/01 10:00 ~ 2026/07/31 22:00");
  assert.ok(r, "應解析成功");
  assert.strictEqual(r.raw, "2026/07/01 10:00 ~ 2026/07/31 22:00");
  assert.strictEqual(r.period, "2026.07.01 ~ 2026.07.31");
  assert.ok(Number.isFinite(r.startTs) && Number.isFinite(r.endTs));
  assert.ok(r.endTs > r.startTs, "結束應晚於開始");
});

test("extractActivityPeriod: 缺時刻＋SSR 註解＋全形波浪號亦可解析", () => {
  const r = extractActivityPeriod("活動時間：<!-- --> 2026/07/01 ～ 2026/07/31");
  assert.ok(r);
  assert.strictEqual(r.raw, "2026/07/01 ~ 2026/07/31");
  assert.strictEqual(r.period, "2026.07.01 ~ 2026.07.31");
});

test("extractActivityPeriod: 無檔期字樣 / 空字串 / null → 皆回 null", () => {
  assert.strictEqual(extractActivityPeriod("這頁沒有活動時間欄位"), null);
  assert.strictEqual(extractActivityPeriod(""), null);
  assert.strictEqual(extractActivityPeriod(null), null);
});

// ───────────────────────── classifyLiveness ─────────────────────────

test("classifyLiveness: 近空殼（無頁題/檔期/商品池）→ dead", () => {
  const r = classifyLiveness("", 404);
  assert.strictEqual(r.status, "dead");
  assert.strictEqual(r.archived, false);
});

test("classifyLiveness: 頁內檔期含現在 → online（sw 保護檔 404 亦判 online）", () => {
  const now = new Date(2026, 6, 15).getTime(); // 2026-07-15 本地
  const html = "<title>夏季特賣</title> 活動時間: 2026/01/01 00:00 ~ 2026/12/31 23:59";
  const r = classifyLiveness(html, 404, { now });
  assert.strictEqual(r.status, "online");
  assert.strictEqual(r.archived, false);
  assert.strictEqual(r.evidence.pageTitle, "夏季特賣");
});

test("classifyLiveness: 頁身有內容但檔期已過 → archived", () => {
  const now = new Date(2026, 6, 15).getTime();
  const html = "<title>過期活動</title> 活動時間: 2020/01/01 00:00 ~ 2020/12/31 23:59";
  const r = classifyLiveness(html, 404, { now });
  assert.strictEqual(r.status, "archived");
  assert.strictEqual(r.archived, true);
});

test("classifyLiveness: 無頁內檔期，改由來源頁 listedPeriod 含現在 → online", () => {
  const now = new Date(2026, 6, 15).getTime();
  const sec = Math.floor(now / 1000);
  const html = "<title>某活動</title>"; // 有頁題→非 dead，但無頁內檔期
  const r = classifyLiveness(html, 200, {
    now,
    listedPeriod: { startTs: sec - 86400, endTs: sec + 86400 },
  });
  assert.strictEqual(r.status, "online");
  assert.strictEqual(r.archived, false);
});

// ───────────────────────── hasActivityData ─────────────────────────

const NOW = 2_000_000_000_000; // 固定 now（ms），確保決定性
const S = Math.floor(NOW / 1000);

test("hasActivityData: 非物件輸入 → false", () => {
  assert.strictEqual(hasActivityData(null, NOW), false);
  assert.strictEqual(hasActivityData("x", NOW), false);
  assert.strictEqual(hasActivityData(undefined, NOW), false);
});

test("hasActivityData: promotions 任一檔期含現在 → true", () => {
  const snap = { promotions: [{ startTs: S - 86400, endTs: S + 86400 }] };
  assert.strictEqual(hasActivityData(snap, NOW), true);
});

test("hasActivityData: activities 未封存且檔期含現在 → true", () => {
  const snap = { activities: { a1: { startTs: S - 10, endTs: S + 86400, archived: false } } };
  assert.strictEqual(hasActivityData(snap, NOW), true);
});

test("hasActivityData: activities 檔期含現在但 archived → false", () => {
  const snap = { activities: { a1: { startTs: S - 10, endTs: S + 86400, archived: true } } };
  assert.strictEqual(hasActivityData(snap, NOW), false);
});

test("hasActivityData: 所有檔期皆已過 → false", () => {
  const snap = {
    promotions: [{ startTs: S - 200000, endTs: S - 86400 }],
    activities: { a1: { startTs: S - 200000, endTs: S - 86400, archived: false } },
  };
  assert.strictEqual(hasActivityData(snap, NOW), false);
});
