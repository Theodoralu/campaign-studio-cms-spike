"use strict";
/**
 * workbench/content_checks.js 單元測試（零新相依，僅 node:test；不觸網）
 *
 * 迴歸鎖（2026-07-27 DJI 11697562 死循環根治）：
 *   - syncPoolEntry 必須同步 price（原「只刷 imgs、價格不動」＝draft==live 而池價舊
 *     →CP-02「現價≠來源」永久 FAIL 且無「套用新價」鈕可解）。
 *   - classifyLinkTarget／classifySearchLiveness：延伸探索等連結內容檢查的分型與判活
 *     （活動頁連活的都回 HTTP 404＝判活不能看狀態碼，2026-07-27 實測）。
 */
const { test } = require("node:test");
const assert = require("node:assert");

const {
  gdidOfUrl,
  classifyLinkTarget,
  classifySearchLiveness,
  collectPageLinks,
  syncPoolEntry,
  upsertPoolEntry,
  normalizeLinkUrl,
  pickLivePromo,
  isShellPage,
  SEARCH_PRODUCT_LINK_RE,
} = require("../../workbench/content_checks.js");

/* ---------- normalizeLinkUrl（CP-12 等價；QA #6：商品連結兩式不可繞過唯一守門） ---------- */
test("normalizeLinkUrl：gdsale.asp 與 p-N.html 兩式正規化相等；一般 URL 去尾斜線", () => {
  assert.strictEqual(
    normalizeLinkUrl("https://tw.buy.yahoo.com/gdsale/gdsale.asp?gdid=123456"),
    normalizeLinkUrl("https://tw.buy.yahoo.com/gdsale/p-123456.html"),
    "同一商品兩式網址必須視為同一目的地"
  );
  assert.strictEqual(normalizeLinkUrl("https://tw.buy.yahoo.com/category/x/"), normalizeLinkUrl("https://tw.buy.yahoo.com/category/x"));
  assert.notStrictEqual(normalizeLinkUrl("https://tw.buy.yahoo.com/activity/onsale?actid=1"), normalizeLinkUrl("https://tw.buy.yahoo.com/activity/onsale?actid=2"));
});

/* ---------- pickLivePromo ---------- */
test("pickLivePromo：只挑在檔且未用過；過期/未開檔/已用/外站全跳過", () => {
  const now = 1000000;
  const promos = [
    { actid: "1", title: "過期", url: "https://tw.buy.yahoo.com/activity/onsale?actid=1", startTs: 1, endTs: now - 10 },
    { actid: "2", title: "未開檔", url: "https://tw.buy.yahoo.com/activity/onsale?actid=2", startTs: now + 100, endTs: now + 999 },
    { actid: "3", title: "已用", url: "https://tw.buy.yahoo.com/activity/onsale?actid=3", startTs: 1, endTs: now + 999 },
    { actid: "4", title: "外站", url: "https://evil.example.com/x", startTs: 1, endTs: now + 999 },
    { actid: "5", title: "正解", url: "https://tw.buy.yahoo.com/activity/onsale?actid=5", startTs: 1, endTs: now + 999 },
  ];
  const used = new Set([normalizeLinkUrl(promos[2].url)]);
  const p = pickLivePromo(promos, used, now);
  assert.ok(p && p.actid === "5", "應跳過過期/未開檔/已用/外站、取第 5 檔");
  assert.strictEqual(pickLivePromo([], used, now), null);
});

/* ---------- isShellPage（Yahoo 軟擋殼頁；2026-07-27 實證誤判 expired） ---------- */
test("isShellPage：首頁通用標題＋無商品無檔期＝殼頁；真結束活動（有自身標題或商品）非殼頁", () => {
  assert.ok(isShellPage({ pageTitle: "Yahoo購物中心 - 最懂生活的人", hasProducts: false, pagePeriod: null }));
  assert.ok(!isShellPage({ pageTitle: "AS集團 春夏新品5折起 | Yahoo購物中心", hasProducts: true, pagePeriod: "2026.07.01~07.25" }), "真活動頁（過期）＝非殼頁");
  assert.ok(!isShellPage({ pageTitle: null, hasProducts: false, pagePeriod: null }), "無標題死頁＝非殼頁（走 dead）");
  assert.ok(!isShellPage(null));
});

/* ---------- gdidOfUrl ---------- */
test("gdidOfUrl：gdsale.asp 與 p-N.html 兩型都認得", () => {
  assert.equal(gdidOfUrl("https://tw.buy.yahoo.com/gdsale/gdsale.asp?gdid=11697562"), "11697562");
  assert.equal(gdidOfUrl("https://tw.buy.yahoo.com/gdsale/p-11697562.html"), "11697562");
  assert.equal(gdidOfUrl("https://tw.buy.yahoo.com/activity/onsale?actid=773765"), null);
});

/* ---------- classifyLinkTarget ---------- */
test("classifyLinkTarget：商品／活動／搜尋／站內其他／外站／非法", () => {
  assert.deepEqual(classifyLinkTarget("https://tw.buy.yahoo.com/gdsale/gdsale.asp?gdid=123456").kind, "product");
  assert.equal(classifyLinkTarget("https://tw.buy.yahoo.com/gdsale/gdsale.asp?gdid=123456").gdid, "123456");
  assert.equal(classifyLinkTarget("https://tw.buy.yahoo.com/gdsale/gdsale.asp?gdid=p0216265344571").kind, "product"); // p 型編號 2026-08-28（使用者實測案例）
  assert.equal(classifyLinkTarget("https://tw.buy.yahoo.com/gdsale/gdsale.asp?gdid=p0216265344571").gdid, "p0216265344571");
  const act = classifyLinkTarget("https://tw.buy.yahoo.com/activity/onsale?actid=773765");
  assert.equal(act.kind, "activity");
  assert.equal(act.actid, "773765");
  assert.equal(classifyLinkTarget("https://tw.buy.yahoo.com/search/product?p=%E9%9E%8B").kind, "search");
  assert.equal(classifyLinkTarget("https://tw.buy.yahoo.com/category/foo").kind, "search"); // 2026-08-28 使用者裁決：分類頁＝商品列表、有無結果判活與搜尋同制（原 other）
  assert.equal(classifyLinkTarget("https://tw.buy.yahoo.com/openpoint/exchangeList").evergreen, true); // 常設賣場頁白名單（2026-08-28）：openpoint/act/onsale 聚合＝HTTP＋殼判活、不做檔期
  assert.equal(classifyLinkTarget("https://tw.buy.yahoo.com/act/channel/yahoo24h.html").kind, "activity");
  assert.equal(classifyLinkTarget("https://tw.buy.yahoo.com/activity/onsale?actid=1").evergreen, true);
  assert.equal(classifyLinkTarget("https://tw.buy.yahoo.com/activity/activity950?p=x").evergreen, undefined); // 真檔期頁照舊走檔期判活
  assert.equal(classifyLinkTarget("https://evil.example.com/gdsale/gdsale.asp?gdid=1").kind, "external");
  assert.equal(classifyLinkTarget("http://tw.buy.yahoo.com/x").kind, "invalid"); // 非 https
  assert.equal(classifyLinkTarget("not-a-url").kind, "invalid");
  assert.equal(classifyLinkTarget("").kind, "invalid");
});

/* ---------- classifySearchLiveness ---------- */
test("classifySearchLiveness：認得商品＝online；200 但認不出＝unverified（非 empty）；非 200＝dead", () => {
  const withHits = 'x /gdsale/gdsale.asp?gdid=123456 y /gdsale/p-234567 z';
  assert.equal(classifySearchLiveness(withHits, 200), "online");
  assert.equal(classifySearchLiveness(withHits, 404), "online"); // 內容優先於狀態碼（前端殼常回非 200）
  assert.equal(classifySearchLiveness("", 404), "dead");
  /* 2026-09-25 使用者裁：200 但我們的樣式認不出商品＝誠實說「不確定」，不得斷言 empty。
     empty 是擋發佈的紅燈，斷言錯＝使用者貼了正常網址卻被擋死且無路可走。 */
  assert.equal(classifySearchLiveness("<html>找不到符合的商品</html>", 200), "unverified");
  assert.notEqual(classifySearchLiveness("<html>找不到符合的商品</html>", 200), "empty"); // 反向：舊行為回歸即紅
});

test("SEARCH_PRODUCT_LINK_RE：認得第三型 /gdsale/<商品名>-<編號>.html（2026-09-25 實測病例）", () => {
  /* 病例＝使用者貼 category/31012821（實際 56 件商品）與 category/4436714，舊樣式 0 命中 ⇒ 全被判失效。
     樣本逐字取自當日實抓的 HTML。 */
  const realRows = [
    "/gdsale/包大人-親膚防漏量販包成人紙尿褲M-L-XL-6包-箱購-黏貼型-11801244.html",
    "/gdsale/白蘭-含熊寶貝馨香精華超濃縮洗衣精補充包-箱購1-6kgx6-8款任選--12090920.html",
    "/gdsale/%e7%a2%a7%e8%93%aeVanish-%e8%a1%a3%e7%89%a9%e5%8e%bb%e6%bc%ac%e5%87%9d%e8%86%a0-200ml--7077542.html",
  ];
  for (const u of realRows) {
    assert.ok((u.match(SEARCH_PRODUCT_LINK_RE) || []).length > 0, "應認得第三型：" + u);
    assert.equal(classifySearchLiveness(`<a href="${u}">x</a>`, 200), "online");
  }
  // 反向：不得把分類頁／搜尋頁／活動頁／短碼當成商品（誤認＝空頁被判 online，訪客點進去撲空）
  const notProduct = [
    "https://tw.buy.yahoo.com/category/31012821",
    "https://tw.buy.yahoo.com/category/4436714?sort=-sales",
    "https://tw.buy.yahoo.com/search/product?p=%E6%B4%97%E8%A1%A3%E7%B2%BE",
    "https://tw.buy.yahoo.com/activity/index?actid=123456",
    "https://tw.buy.yahoo.com/gdsale/index.html",
    "https://tw.buy.yahoo.com/gdsale/abc-123.html", // 編號僅 3 碼＝不是貨號
    '<a href="/category/123-456789.html">x</a>',
  ];
  for (const u of notProduct) {
    assert.equal((u.match(SEARCH_PRODUCT_LINK_RE) || []).length, 0, "不得誤認為商品：" + u);
  }
});

/* ---------- collectPageLinks ---------- */
test("collectPageLinks：延伸探索 items＋看更多、圓卡、本期活動；缺席模組＝空", () => {
  const page = {
    explore: {
      moreUrl: "https://tw.buy.yahoo.com/search/product?p=a",
      ctaText: "探索更多",
      items: [
        { label: "專區A", url: "https://tw.buy.yahoo.com/activity/onsale?actid=1", img: "https://img.yec.tw/a.jpg" },
        { label: "專區B", url: "https://tw.buy.yahoo.com/activity/onsale?actid=2", img: "" },
      ],
    },
    editorial: { circles: [{ tag: "t", copy: "圓卡一", url: "https://tw.buy.yahoo.com/gdsale/gdsale.asp?gdid=111111", img: "https://img.yec.tw/c.jpg" }] },
    promoEntries: [{ chip: "chip1", copy: "入口一", url: "https://tw.buy.yahoo.com/gdsale/gdsale.asp?gdid=222222", img: "https://img.yec.tw/p.jpg" }],
  };
  const links = collectPageLinks(page);
  assert.equal(links.length, 5);
  assert.deepEqual(links.map((l) => l.module), ["explore", "explore", "explore", "editorial", "promo"]);
  assert.equal(links[0].where, "延伸探索 #1");
  assert.equal(links[2].where, "延伸探索 看更多");
  assert.equal(links[3].where, "編輯精選圓卡 #1");
  assert.equal(links[4].where, "本期活動 #1");
  assert.deepEqual(collectPageLinks({}), []); // 全模組缺席＝不誤殺
  assert.deepEqual(collectPageLinks(null), []);
});

/* ---------- syncPoolEntry（DJI 死循環迴歸鎖） ---------- */
test("syncPoolEntry：price 必須同步（原只刷 imgs＝CP-02 死循環）", () => {
  const exist = { gdid: "11697562", name: "DJI 全能套裝", price: 15840, marketPrice: 18990, disc: 83, url: "https://tw.buy.yahoo.com/gdsale/gdsale.asp?gdid=11697562", imgs: ["https://img.yec.tw/old.jpg"] };
  const fresh = { gdid: "11697562", name: "DJI 全能套裝", price: 18421, marketPrice: 18990, url: exist.url, imgs: ["https://img.yec.tw/new.jpg"] };
  const changed = syncPoolEntry(exist, fresh);
  assert.equal(exist.price, 18421); // 池價跟上實抓＝gate CP-02 現價≠來源 得解
  assert.equal(exist.marketPrice, 18990);
  assert.equal(exist.disc, Math.round((18421 / 18990) * 100));
  assert.deepEqual(exist.imgs, ["https://img.yec.tw/new.jpg"]);
  assert.ok(changed.some((c) => c.includes("price 15840→18421")));
  assert.ok(changed.some((c) => c.includes("imgs")));
});

test("syncPoolEntry：實抓無原價＝marketPrice/disc 清空（同 patchSnapshotPrice 語意）", () => {
  const exist = { gdid: "1", name: "n", price: 100, marketPrice: 200, disc: 50, url: "u", imgs: [] };
  const changed = syncPoolEntry(exist, { gdid: "1", name: "n", price: 100, url: "u", imgs: [] });
  assert.equal(exist.marketPrice, null);
  assert.equal(exist.disc, null);
  assert.ok(changed.length >= 1);
});

test("syncPoolEntry：原價不高於現價＝視同無原價（禁偽折數）", () => {
  const exist = { gdid: "1", name: "n", price: 100, marketPrice: null, disc: null, url: "u", imgs: [] };
  syncPoolEntry(exist, { gdid: "1", name: "n", price: 100, marketPrice: 100, url: "u", imgs: [] });
  assert.equal(exist.marketPrice, null);
  assert.equal(exist.disc, null);
});

test("syncPoolEntry：完全一致＝回空陣列（免寫檔、不誤失效核可）", () => {
  const exist = { gdid: "1", name: "n", price: 100, marketPrice: 200, disc: 50, url: "u", imgs: ["a"] };
  const changed = syncPoolEntry(exist, { gdid: "1", name: "n", price: 100, marketPrice: 200, url: "u", imgs: ["a"] });
  assert.deepEqual(changed, []);
});

/* ---------- upsertPoolEntry ---------- */
test("upsertPoolEntry：不在池＝add（R3 慣例欄位）；既有＝sync", () => {
  const snap = { products: [] };
  const p = { gdid: "333333", name: "新品", price: 500, marketPrice: 1000, url: "https://tw.buy.yahoo.com/gdsale/gdsale.asp?gdid=333333", imgs: ["i"] };
  const r1 = upsertPoolEntry(snap, p, "R3:editorial-manual");
  assert.equal(r1.mode, "add");
  assert.equal(snap.products.length, 1);
  assert.equal(snap.products[0].disc, 50);
  assert.equal(snap.products[0].source, "R3:editorial-manual");
  assert.equal(snap.products[0].offer, null); // 不捏造
  const r2 = upsertPoolEntry(snap, { ...p, price: 600 });
  assert.equal(r2.mode, "sync");
  assert.equal(snap.products[0].price, 600);
  assert.equal(snap.products.length, 1); // 不重複入池
});
