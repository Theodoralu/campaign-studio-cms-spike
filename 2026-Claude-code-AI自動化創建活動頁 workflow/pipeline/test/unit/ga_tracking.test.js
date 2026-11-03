"use strict";
/**
 * GA 埋點注入（75 號裁決批 2026-09-15）單元測試——三件事：
 *  ① lib/tracking_plan.js 的規則：build_id 結構變才變（24 號 D-3）、promotion_id 成對（R-6）、樓層補 default（R-3）、牆看索引不讀 pos（R-4）、GTM 開關（R-7）、head 逃逸
 *  ② 模板↔Node 同規則對帳：把 FrameTest「GA 掃描機」區的純函式抽出來跑，逐欄比對——同一條規則兩份實作，這是絆線
 *  ③ 模板存在性：section 的 data-ga-module 對得上 DOM_TO_MODULE（規劃/tools/export-module-dictionary.mjs）；十處可點元素的拼字串都帶 data-ga-；啟動器會叫掃描機
 * 零相依、不開瀏覽器（曝光判定在真 Chrome 由 aem_verify／頁內自測守）。
 */
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const T = require("../../lib/tracking_plan");
const A = require("../../lib/aem_export");

const PIPE = path.join(__dirname, "..", "..");
const SPEC = path.join(PIPE, "..", "..", "2026-AI自動化活動頁生成規劃");
const ENGINE = path.join(SPEC, "MVP_Phase1_LeCreuset_活動頁Prototype_FrameTest.html");
const DICT = path.join(SPEC, "tools", "export-module-dictionary.mjs");

const draft = () => ({
  id: "2026-09-15-wb-000001",
  page: {
    id: "2026-09-15-wb-000001", pageName: "中秋烤肉_時事主題", kvVariant: "layout-012",
    mechanic: { variant: "info-offer-rows", rows: [] },
    promoEntries: [{ url: "https://tw.buy.yahoo.com/activity/onsale?actid=1" }],
    floors: [{ productGdids: ["1", "2", "3"] }, { productGdids: ["4"] }],
    editorial: { circles: [{}] },
    walls: [{ pos: "wall-1", productGdids: ["5"] }, { pos: "wall-2", productGdids: [] }, { pos: "category-3", productGdids: ["6"] }],
    explore: { items: [{ label: "品牌館" }] },
  },
  products: [{ gdid: "1", name: "A", price: 100, url: "https://tw.buy.yahoo.com/gdsale/x-1.html" }],
});

/* ───────── ① tracking_plan 規則 ───────── */
test("composition：依預設序列出會渲染的模組；樓層 variant 缺鍵補 default；牆看索引（wall-N 舊寫法不讀）、0 件牆不算", () => {
  const c = T.composition(draft());
  assert.deepStrictEqual(c.map((x) => x.slot_id), ["hero", "mechanic", "promo", "featured-1", "featured-2", "editor_topic", "category-1", "category-3", "extended_links"]);
  assert.deepStrictEqual(c.filter((x) => x.module_id === "featured").map((x) => x.module_variant), ["default", "default"]);
  const w = c.filter((x) => x.module_id === "category_groups");
  assert.deepStrictEqual(w.map((x) => x.pos), [0, 2], "位置＝陣列索引（0-based），不是 walls[].pos 字串");
  assert.strictEqual(c[0].module_variant, "layout-012");
});
test("composition：composeOrder 改序＝組合鍵改；spotlight／promoCards 有才算", () => {
  const d = draft(); d.page.composeOrder = ["kv", "featured", "mechanic", "promo", "spotlight", "promoCard", "editorial", "walls", "explore"];
  const k1 = T.compositionKey(T.composition(draft())), k2 = T.compositionKey(T.composition(d));
  assert.notStrictEqual(k1, k2);
  d.page.spotlight = { heroCard: {} }; d.page.promoCards = [{}];
  assert.ok(T.composition(d).some((x) => x.slot_id === "spotlight" && x.module_variant === "spotlight"));
  assert.ok(T.composition(d).some((x) => x.slot_id === "promocard" && x.module_variant === "promo-card"));
});
test("build_id：只改商品資料不變、結構變（增刪模組／換版型／換順序）就變（24 號 D-3）", () => {
  const base = T.buildId(draft());
  assert.match(base, /^bld_2026-09-15-wb-000001_[0-9a-f]{8}$/);
  const d1 = draft(); d1.products[0].price = 999; d1.page.floors[0].productGdids = ["9", "8", "7"]; d1.page.pageName = "改名";
  assert.strictEqual(T.buildId(d1), base, "商品／文案變＝不換發");
  const d2 = draft(); d2.page.kvVariant = "layout-003"; assert.notStrictEqual(T.buildId(d2), base);
  const d3 = draft(); delete d3.page.mechanic; assert.notStrictEqual(T.buildId(d3), base);
  const d4 = draft(); d4.page.floors.push({ productGdids: ["1"] }); assert.notStrictEqual(T.buildId(d4), base);
  const d5 = draft(); d5.page.composeOrder = ["kv", "promo", "mechanic", "spotlight", "promoCard", "featured", "editorial", "walls", "explore"]; assert.notStrictEqual(T.buildId(d5), base);
});
test("pageParams：分析師 v3 五欄＋我方 promotion_name／build_id；page_type＝版型代號（模板類型，2026-09-15 定、layout 欄撤）；has_ad 看 mechanic；promotion_id＝page.id 不是 pageName", () => {
  const p = T.pageParams(draft());
  assert.deepStrictEqual(Object.keys(p), ["event", "content_group", "page_type", "promotion_id", "promotion_name", "has_ad", "build_id"]);
  assert.strictEqual(p.event, "ec_page_view"); assert.strictEqual(p.content_group, "activity_ai"); assert.strictEqual(p.page_type, "layout-012"); assert.ok(!("layout" in p), "layout 欄已撤");
  assert.strictEqual(p.promotion_id, "2026-09-15-wb-000001"); assert.strictEqual(p.promotion_name, "中秋烤肉_時事主題"); assert.strictEqual(p.has_ad, "Y");
  const d = draft(); delete d.page.mechanic; assert.strictEqual(T.pageParams(d).has_ad, "N");
  assert.ok(!("user_id" in p) && !("esid" in p), "填不出的欄位不送空值");
});
test("gaConfig／gaHeadScript：預設注入 GTM-WJ5JQR4；CAMPAIGN_GTM=off 關；換容器；dataLayer 在 GTM 之前；</script> 逃逸", () => {
  assert.deepStrictEqual(T.gaConfig({}), { injectGtm: true, gtmId: "GTM-WJ5JQR4" });
  assert.deepStrictEqual(T.gaConfig({ CAMPAIGN_GTM: "off" }), { injectGtm: false, gtmId: null });
  assert.deepStrictEqual(T.gaConfig({ CAMPAIGN_GTM: "GTM-ABC123" }), { injectGtm: true, gtmId: "GTM-ABC123" });
  const d = draft(); d.page.pageName = "壞名</script><script>alert(1)</script>";
  const h = T.gaHeadScript(d, T.gaConfig({}));
  const gtmAt = h.indexOf("googletagmanager.com/gtm.js"); assert.ok(gtmAt > 0 && h.indexOf("window.dataLayer.push") < gtmAt, "頁級參數先於 GTM");
  assert.ok(h.includes("'GTM-WJ5JQR4'"), "容器編號以參數帶入");
  assert.doesNotMatch(h.slice(h.indexOf("promotion_name"), h.indexOf("promotion_name") + 60), /<\/script>/, "JSON 內 </script> 必逃逸");
  assert.ok(h.includes("window.__WB_GA__="));
  assert.ok(!T.gaHeadScript(d, T.gaConfig({ CAMPAIGN_GTM: "off" })).includes("googletagmanager"));
});
test("trackingPlan／expectedSlots：交付件形狀", () => {
  const tp = T.trackingPlan(draft(), T.gaConfig({}));
  assert.deepStrictEqual(Object.keys(tp), ["build_id", "composition_hash", "composition", "page", "viewSlots", "expectedSlots", "gtm"]);
  assert.deepStrictEqual(tp.viewSlots, ["mechanic", "promo", "featured", "editor_topic"]);
  assert.deepStrictEqual(tp.expectedSlots, T.expectedSlots(draft()));
  assert.deepStrictEqual(tp.gtm, { inject: true, id: "GTM-WJ5JQR4" });
});

/* ───────── ② 模板↔Node 對帳（同規則兩份實作＝絆線） ───────── */
const engineSrc = fs.readFileSync(ENGINE, "utf8");
function templateGa() {
  const a = engineSrc.indexOf("/* ===== GA 掃描機"), b = engineSrc.indexOf("/* -- DOM 端 -- */");
  assert.ok(a > 0 && b > a, "模板找不到 GA 掃描機區或 DOM 端分界");
  const pure = engineSrc.slice(a, b);
  return new Function(pure + "\nreturn { gaFnv1a, gaComposition, gaPageParams, gaCreativeName, gaPromotionName, GA_VIEW_SLOTS, GA_COMPOSE_DEFAULT };")();
}
test("模板純函式＝Node 同值：fnv1a／composition／pageParams（含 composeOrder 改序、缺鍵、舊 wall-N）", () => {
  const G = templateGa();
  for (const s of ["", "a", "hero:layout-012:hero|mechanic:x:mechanic", "中文也一樣"]) assert.strictEqual(G.gaFnv1a(s), T.fnv1a(s));
  const cases = [draft(), (() => { const d = draft(); d.page.composeOrder = ["kv", "walls", "featured", "mechanic", "promo", "spotlight", "promoCard", "editorial", "explore"]; d.page.spotlight = {}; d.page.promoCards = [{}]; return d; })(),
    { id: "old", page: { kv: {}, floors: [], walls: [] }, products: [] }, { id: "legacy", page: { id: "p", floors: [{}, {}, {}, {}], walls: [{ productGdids: ["1"] }, { productGdids: ["2"] }, { productGdids: ["3"] }, { productGdids: ["4"] }] } }];
  for (const d of cases) {
    assert.deepStrictEqual(G.gaComposition(d.page), T.composition(d));
    assert.deepStrictEqual(G.gaPageParams(d), T.pageParams(d));
  }
  assert.deepStrictEqual(G.GA_VIEW_SLOTS, T.VIEW_SLOTS);
  assert.deepStrictEqual(G.GA_COMPOSE_DEFAULT, require("../../lib/content_modules").COMPOSE_ORDER_DEFAULT);
});

test("模板組值函式（分析師 v4 2026-09-15）：creative_name 依模組；promotion_name 只有活動資訊卡＝banner_{左右}／link_{上下}，位置 0 起、含搶購鈕", () => {
  const G = templateGa();
  assert.strictEqual(G.gaCreativeName("featured", "default", "2", ""), "default_2");
  assert.strictEqual(G.gaCreativeName("featured", "spotlight", null, ""), "spotlight_0");
  assert.strictEqual(G.gaCreativeName("featured", "promo-card", "", ""), "promo-card_0");
  assert.strictEqual(G.gaCreativeName("category_groups", "default", "1", ""), "1", "品類牆＝位置（v3 一欄三義，牆第 8 題評估中先照送）");
  assert.strictEqual(G.gaCreativeName("extended_links", "default", "0", " 品牌館 "), "品牌館");
  assert.strictEqual(G.gaCreativeName("hero", "layout-012", "0", ""), "layout-012");
  assert.strictEqual(G.gaCreativeName("mechanic", "info-gift-rush", "0", ""), "info-gift-rush");
  assert.strictEqual(G.gaPromotionName("mechanic", "info_banner", "2"), "banner_2");
  assert.strictEqual(G.gaPromotionName("mechanic", null, "1"), "link_1", "右側連結含搶購鈕＝link_{列}");
  assert.strictEqual(G.gaPromotionName("mechanic", null, null), "link_0");
  assert.strictEqual(G.gaPromotionName("promo", "promo", "0"), null, "v4 只替活動資訊卡定義 promotion_name");
});

/* ───────── ③ 模板存在性（機器閘：新版型／新模組忘了掛身分＝這裡紅） ───────── */
test("模板 section 的 data-ga-module 與 DOM_TO_MODULE 一致（notice／footer 不追蹤＝不掛）", () => {
  const dictSrc = fs.readFileSync(DICT, "utf8");
  const m = dictSrc.match(/const DOM_TO_MODULE = (\{[\s\S]*?\});/); assert.ok(m, "export-module-dictionary.mjs 找不到 DOM_TO_MODULE");
  const map = new Function("return " + m[1])();
  const UNTRACKED = new Set(["notice", "footer"]);
  const tags = [...engineSrc.matchAll(/<(?:section|header|nav)\b([^>]*\bid="(sec-[a-z0-9_-]+)"[^>]*)>/g)];
  assert.ok(tags.length >= 15, `section 數異常：${tags.length}`);
  for (const [, attrs, id] of tags) {
    const key = Object.keys(map).find((k) => (k.endsWith("-") ? id.startsWith(k) : id === k));
    assert.ok(key, `模板 section ${id} 不在 DOM_TO_MODULE——請同批更新 export-module-dictionary.mjs＋17 號 §2`);
    const want = map[key]; const got = (attrs.match(/data-ga-module="([^"]+)"/) || [])[1];
    if (UNTRACKED.has(want)) assert.strictEqual(got, undefined, `${id} 不追蹤、不該掛 data-ga-module`);
    else assert.strictEqual(got, want, `${id} 的 data-ga-module 應為 ${want}`);
  }
});
test("十處可點元素的拼字串都帶 data-ga-（漏一處＝該處點擊靜靜消失）", () => {
  const CLICKABLE = ["product-card", "cmsp-hlink", "cmsp-ecard", "promo-entry", "cmm-blink", "cmm-btn", "cmm-banner", "cmpc", "uh-logo", "kv-key-product", "scene-card", "editor-circle", "explore-item"];
  for (const cls of CLICKABLE) {
    const sites = [...engineSrc.matchAll(new RegExp(`<a class="${cls}"[^>]*>`, "g"))].map((x) => x[0]);
    assert.ok(sites.length > 0, `模板找不到 <a class="${cls}">`);
    for (const s of sites) {
      if (cls === "kv-key-product") { assert.ok(/id="kv-key-product"/.test(s)); continue; } // 動態：renderKvKeyCard 用 setAttribute 掛
      assert.ok(/data-ga-(item|entry|nav|cta|more)|\$\{gaItemAttrs\(/.test(s), `${cls} 拼字串缺 data-ga-*：${s.slice(0, 120)}`);
    }
  }
  assert.match(engineSrc, /kp\.setAttribute\("data-ga-item", p\.gdid\)/, "主視覺資訊卡要在 renderKvKeyCard 掛貨號");
  assert.match(engineSrc, /data-ga-nav="anchor"/); assert.match(engineSrc, /data-ga-nav="top"/);
  assert.match(engineSrc, /data-ga-more="1"/);
  assert.match(engineSrc, /class="cmm-blink" data-ga-entry="info_banner" data-ga-pos="\$\{i\}"/, "橫幅每層帶左右位置（v4 banner_{position}）");
  assert.match(engineSrc, /class="cmm-banner" data-ga-entry="info_banner" data-ga-pos="0"/);
  assert.match(engineSrc, /class="cmm-btn" data-ga-cta="info_card_rush" data-ga-pos="\$\{i\}"/, "搶購鈕帶上下位置（v4 link_{position}）");
  assert.match(engineSrc, /content_type: "category_groups", content_id: "more"/, "v4 品類牆看更多＝select_content");
  assert.match(engineSrc, /gaApplyIdentity\(pg\); gaScanner\.start\(draft\);/, "loadDraftJson 收尾要補身分＋啟動掃描機");
});
test("AEM 啟動器：資料套上、遮罩掀開後才叫掃描機（曝光不能在遮罩期間觀察）", () => {
  const l = A.launcherScript("{}");
  assert.ok(l.indexOf("unmask();") < l.indexOf("__gaScanner.start(window.__WB_DRAFT__)"), "start 必在 unmask 之後");
  assert.match(l, /catch\(e\)\{console\.error\("\[ga\]/, "啟動失敗要出聲、不吞");
});
