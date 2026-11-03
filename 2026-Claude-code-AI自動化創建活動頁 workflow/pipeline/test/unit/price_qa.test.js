"use strict";
/**
 * price_qa.js 單元測試（零新相依，僅 node:test）
 * 不觸網（不呼叫 fetchPage）、不依賴 runs/ 大檔；全部用最小合成 HTML/JSON 片段。
 *
 * 涵蓋 module.exports 之純函式：parseProductPage / extractData / collectItems / discTag / selftestLiterals
 *
 * 重點一：parseProductPage 實付真值（2026-07-26 修，見 price_qa.js:189-192）
 *   有效售價＝消費者實付真值：promotionPrice 存在且 >0 且低於 currentPrice 時採 promotionPrice，否則 currentPrice。
 *   三退回案：promotionPrice 缺／為 0／高於現價 → 一律退回 currentPrice。
 *   另驗：currentPrice 缺但有促銷→採促銷、小數 Math.round、實體不存在回 null、
 *   錨定必帶 ":"（{"__ref":"Shopping_Product:<gdid>"} 指標不誤中，讀真實體）。
 *
 * 重點二：balancedEnd／string-comment-aware tokenizer 餵含 regex 字面量之來源不 throw
 *   （07-21 事故迴歸）。balancedEnd／literalAfter／tokenizer 皆「未 export」，
 *   故改測其唯一可 export 的等價入口 extractData —— 它經 literalAfter→balancedEnd 切片各常數，
 *   並以 balancedEnd 切出 runSelfTest 函式體（該體含 regex 字面量）。驗證：不 throw ＋ 切片正確收在對應 } 。
 *   註：現行 tokenizer 對「含引號字元或不成對大括號的 regex 字元類」（如 /["']/、/[{]/）仍會誤判；
 *   本迴歸鎖定真實 runSelfTest 實際出現、且現行實作可正確處理的樣態：無引號、括號/大括號成對的 regex
 *   （/^\d+折$/、/NT\$[\d,]+/g、/^[0-9]{2,3}$/）。
 */
const { test } = require("node:test");
const assert = require("node:assert");

const {
  parseProductPage,
  extractData,
  collectItems,
  discTag,
  selftestLiterals,
} = require("../../price_qa.js");

/* ───────────────────────── 合成工具 ───────────────────────── */

/**
 * 合成一段含 Apollo 快取實體的頁身。
 * 前置一個 {"__ref":"Shopping_Product:<gdid>"} 指標（decoy）以驗證錨定必帶 ":"、只讀真實體。
 * @param {string} gdid
 * @param {string} fields 逐字欄位片段（不含前後大括號），欄位順序/引號需對齊 parseProductPage 正則
 */
function productHtml(gdid, fields) {
  return (
    `{"ROOT":{"product":{"__ref":"Shopping_Product:${gdid}"}},` +
    `"Shopping_Product:${gdid}":{${fields},"title":"某商品"}}`
  );
}

/* ═════════════════ 重點一：parseProductPage 實付真值 ═════════════════ */

test('parseProductPage: promotionPrice < currentPrice → 取促銷價（07-26 修：gdid=11697562 網路15840/促銷15365）', () => {
  const html = productHtml("11697562", '"currentPrice":"15840","marketPrice":"19800","promotionPrice":"15365"');
  const p = parseProductPage(html, "11697562");
  assert.strictEqual(p.price, 15365, "實付真值應取較低的促銷價 15365");
  assert.strictEqual(p.currentPrice, 15840, "currentPrice 逐字保留 15840");
  assert.strictEqual(p.promotionPrice, 15365);
  /* 2026-07-27 劃線價真值修：listPrice＝商品頁顯示語意（促銷才有劃線、劃 currentPrice）；
     marketPrice（廠商建議售價，頁面不顯示）另存 marketPriceRaw（11581454 實證：有 marketPrice 4980 但頁面只見 $1,380） */
  assert.strictEqual(p.listPrice, 15840, "劃線價＝currentPrice（促銷中）");
  assert.strictEqual(p.marketPriceRaw, 19800, "廠商建議售價透明保留");
  assert.strictEqual(p.title, "某商品");
});

/* ═════ 劃線價＝顯示語意直取渲染節點（2026-09-29 修；病例 run 2026-09-29-wb-112554 五件原價消失）═════
   07-27 拿 11581454 一例斷成「marketPrice 一律不顯示」＝過度概括；實抓三頁證實 Yahoo 有條件顯示灰價。
   關鍵：容器 HeroInfo__subPrice 每頁都在（沒顯示＝空的），有值的是 subPriceNumber——瞄準錯節點會抓到空殼。 */

const heroDom = (inner) => `<div class="HeroInfo__subPrice___3Js7-">${inner}</div>`;

test('parseProductPage: 頁面顯示灰價（subPriceNumber 有值）→ listPrice 直取顯示值（12034942：現價239／灰價290）', () => {
  const html = productHtml("12034942", '"currentPrice":"239","marketPrice":"290"') + heroDom('<span class="HeroInfo__subPriceNumber___3N0y7">$290</span>');
  const p = parseProductPage(html, "12034942");
  assert.strictEqual(p.price, 239);
  assert.strictEqual(p.listPrice, 290, "頁面顯示什麼就取什麼（顯示語意）");
  assert.strictEqual(p.marketPriceRaw, 290, "欄位照舊透明保留");
});

test('parseProductPage: 深折不顯示（容器在但是空的）→ 不捏造灰價；促銷中仍照 07-27 規則劃 currentPrice（11581454 形）', () => {
  const html = productHtml("11581454", '"currentPrice":"1380","marketPrice":"4980","promotionPrice":"1099"') + heroDom("  ");
  const p = parseProductPage(html, "11581454");
  assert.strictEqual(p.price, 1099);
  assert.strictEqual(p.listPrice, 1380, "頁面沒顯示 4980 就不給 4980——退促銷劃線規則");
  assert.strictEqual(p.marketPriceRaw, 4980);
});

test('parseProductPage: 灰價帶千分位（$4,980）→ 正確去逗號；灰價 ≤ 實付價＝解析雜訊不採', () => {
  const a = parseProductPage(productHtml("2", '"currentPrice":"3980"') + heroDom('<span class="HeroInfo__subPriceNumber___x">$4,980</span>'), "2");
  assert.strictEqual(a.listPrice, 4980);
  const b = parseProductPage(productHtml("3", '"currentPrice":"500"') + heroDom('<span class="HeroInfo__subPriceNumber___x">$500</span>'), "3");
  assert.strictEqual(b.listPrice, null, "灰價沒有高於實付價＝不採（防雜訊，content_checks 原價必高於現價同款）");
});

test('parseProductPage: promotionPrice 缺 → 退回 currentPrice、promotionPrice=null', () => {
  const p = parseProductPage(productHtml("1", '"currentPrice":"15840","marketPrice":"19800"'), "1");
  assert.strictEqual(p.price, 15840, "無促銷欄位時實付價=網路價");
  assert.strictEqual(p.currentPrice, 15840);
  assert.strictEqual(p.promotionPrice, null, "缺促銷欄位 → null");
});

test('parseProductPage: promotionPrice = 0 → 退回 currentPrice（0 不視為有效促銷）', () => {
  const p = parseProductPage(productHtml("1", '"currentPrice":"15840","promotionPrice":"0"'), "1");
  assert.strictEqual(p.price, 15840, "促銷價 0 不採用、退回網路價");
  assert.strictEqual(p.promotionPrice, 0, "促銷價 0 仍逐字保留");
});

test('parseProductPage: promotionPrice > currentPrice → 退回 currentPrice', () => {
  const p = parseProductPage(productHtml("1", '"currentPrice":"15840","promotionPrice":"16000"'), "1");
  assert.strictEqual(p.price, 15840, "促銷價高於網路價時退回網路價");
  assert.strictEqual(p.promotionPrice, 16000, "促銷價仍逐字保留 16000");
});

test('parseProductPage: promotionPrice == currentPrice（非嚴格小於）→ 退回 currentPrice', () => {
  const p = parseProductPage(productHtml("1", '"currentPrice":"800","promotionPrice":"800"'), "1");
  assert.strictEqual(p.price, 800, "等於網路價（非 <）→ 採 currentPrice");
});

test('parseProductPage: currentPrice 缺但有促銷 → 採促銷價（currentPrice==null 分支）', () => {
  const p = parseProductPage(productHtml("1", '"promotionPrice":"950"'), "1");
  assert.strictEqual(p.price, 950, "無 currentPrice 時採促銷價");
  assert.strictEqual(p.currentPrice, null);
  assert.strictEqual(p.promotionPrice, 950);
});

test('parseProductPage: 小數價格 Math.round（1000.4→1000、950.6→951）', () => {
  const p = parseProductPage(productHtml("1", '"currentPrice":"1000.4","promotionPrice":"950.6"'), "1");
  assert.strictEqual(p.currentPrice, 1000, "1000.4 四捨五入 → 1000");
  assert.strictEqual(p.promotionPrice, 951, "950.6 四捨五入 → 951");
  assert.strictEqual(p.price, 951, "實付價＝取整後較低者");
});

test('parseProductPage: 找不到商品實體 → null', () => {
  assert.strictEqual(parseProductPage('{"other":true}', "999"), null);
  assert.strictEqual(parseProductPage("", "999"), null);
});

test('parseProductPage: 錨定必帶 ":"，{"__ref":"Shopping_Product:<gdid>"} 指標不誤中、讀真實體', () => {
  // decoy 指標在前（無現價），真實體在後（現價 1234）；錨 "Shopping_Product:777": 需帶冒號 → 只中真實體
  const html =
    `{"ref":{"__ref":"Shopping_Product:777"},"noise":1,` +
    `"Shopping_Product:777":{"currentPrice":"1234","marketPrice":"2000"}}`;
  const p = parseProductPage(html, "777");
  assert.ok(p, "應讀到真實體、非 null");
  assert.strictEqual(p.price, 1234, "應讀真實體現價 1234，未被前置 __ref 指標誤導");
  assert.strictEqual(p.listPrice, null, "無促銷＝無劃線價（2026-07-27 劃線價真值修）");
  assert.strictEqual(p.marketPriceRaw, 2000, "廠商建議售價透明保留");
});

/* ═══════════ 重點二：balancedEnd/tokenizer 迴歸（經等價入口 extractData）═══════════ */

const U = "https://tw.buy.yahoo.com/gdsale/p-111.html";

/**
 * 合成 FrameTest.html 的最小完整骨架（含 extractData 所需全部錨點），
 * runSelfTest 函式體由 selfTestBody 注入。以 String.raw 保留 regex 反斜線原文。
 */
function frameHtml(selfTestBody) {
  return String.raw`
<script>
const marketMeta = { "K1": { listPrice: "NT$1000" } };
const productGroups = [ { id: "g1", products: [ ["K1","副標","img","NT$800","8折","extra","${U}"] ] } ];
const CAMP_PRODUCTS = [ ["K1","x","img","NT$800","8折","e","${U}"] ];
const KB_PRODUCTS = [ ["K1","x","img","NT$800","8折","e","${U}"] ];
const FA_PRODUCTS = [ ["K1","x","img","NT$800","8折","e","${U}"] ];
const TITANIUM_PRODUCTS = [ ["K1","x","img","NT$800","8折","e","${U}"] ];
const LC_WALL3 = [];
const CAMP_WALL3 = [];
const KB_WALL3 = [];
const FA_WALL3 = [];
const TI_WALL3 = [];
let kvKeyProducts = [ { name:"lc", price:"NT$800", url:"${U}" } ];
const DEMO_DATASETS = {
  camping: { apply() { kvKeyProducts = [ { name:"c", price:"NT$800", url:"${U}" } ]; } },
  keyboard: { apply() { kvKeyProducts = [ { name:"k", price:"NT$800", url:"${U}" } ]; } },
  fashion: { apply() { kvKeyProducts = [ { name:"f", price:"NT$800", url:"${U}" } ]; } },
  titanium: { apply() { kvKeyProducts = [ { name:"t", price:"NT$800", url:"${U}" } ]; } },
};
function runSelfTest() {
${selfTestBody}
}
</script>`;
}

// 真實 runSelfTest 常見樣態：無引號、括號/大括號成對之 regex ＋ NT$ 字面斷言
const SELFTEST_REGEX_BODY = String.raw`  const a = /^\d+折$/; const b = /NT\$[\d,]+/g; const c = /^[0-9]{2,3}$/;
  assertLit("NT$800");`;

test('extractData: runSelfTest 體含 regex 字面量不 throw、balancedEnd 正確切片（07-21 迴歸）', () => {
  let data;
  assert.doesNotThrow(() => { data = extractData(frameHtml(SELFTEST_REGEX_BODY)); },
    "含 regex 字面量的來源不應使 balancedEnd/tokenizer throw");
  // selftestSrc 應涵蓋整個 runSelfTest 函式體，且正確收在對應 }（未被 regex 誤導而過切/短切）
  assert.ok(data.selftestSrc.startsWith("function runSelfTest("), "selftestSrc 應自 runSelfTest 起始");
  assert.ok(data.selftestSrc.trimEnd().endsWith("}"), "應正確收在函式閉括號 }");
  assert.ok(data.selftestSrc.includes(String.raw`/^\d+折$/`), "regex 字面量原文應完整落在切片內");
  assert.ok(data.selftestSrc.includes(String.raw`/NT\$[\d,]+/g`), "含錢號/字元類的 regex 原文應完整保留");
  assert.ok(data.selftestSrc.includes('assertLit("NT$800")'), "函式體末段亦應在切片內（未短切）");
});

test('extractData: 結構抽取（marketMeta、五池、各集 kvKeyProducts）—— 等價入口健全', () => {
  const data = extractData(frameHtml(SELFTEST_REGEX_BODY));
  assert.strictEqual(data.marketMeta.K1.listPrice, "NT$1000", "marketMeta 應抽出並可查 listPrice");
  assert.deepStrictEqual(
    Object.keys(data.pools).sort(),
    ["camping", "fashion", "keyboard", "lecreuset", "titanium"],
    "五池皆抽出"
  );
  assert.strictEqual(data.pools.lecreuset.length, 1, "lecreuset 池 1 件（productGroups 攤平）");
  // kvKeyProducts：預設集 lecreuset ＋ DEMO_DATASETS 四集各自重指派
  for (const k of ["lecreuset", "camping", "keyboard", "fashion", "titanium"]) {
    assert.ok(Array.isArray(data.kvKeyProducts[k]) && data.kvKeyProducts[k].length === 1,
      `kvKeyProducts.${k} 應抽出 1 件`);
  }
});

/* ═══════════════════ collectItems：實付真值管線 × 去重 ═══════════════════ */

test('collectItems: parseMoney 抽價、pool+kv 同 gdid 去重併 where、listPrice 取自 marketMeta', () => {
  const data = extractData(frameHtml(SELFTEST_REGEX_BODY));
  const items = collectItems(data, "all");
  assert.strictEqual(items.length, 5, "五集各 1 件（同 gdid 於 pool 與 kv 去重後）");
  const lc = items.find((i) => i.dataset === "lecreuset");
  assert.ok(lc, "應有 lecreuset 項");
  assert.strictEqual(lc.gdid, "111", "gdid 自 URL 解析");
  assert.strictEqual(lc.shown.price, 800, "parseMoney('NT$800') → 800");
  assert.strictEqual(lc.shown.listPrice, 1000, "listPrice 取自 marketMeta.K1.listPrice");
  assert.strictEqual(lc.shown.offerTag, "8折", "offerTag 取 tuple[4]");
  assert.deepStrictEqual(lc.where, ["pool.g1[0]", "kv[0]"], "同 gdid 之 pool 與 kv 併列 where");
});

test('collectItems: datasetFilter 只收指定集', () => {
  const data = extractData(frameHtml(SELFTEST_REGEX_BODY));
  const only = collectItems(data, "titanium");
  assert.strictEqual(only.length, 1);
  assert.strictEqual(only[0].dataset, "titanium");
});

/* ═══════════════════ selftestLiterals：NT$ tokenizer 端到端 ═══════════════════ */

test('selftestLiterals: 掃出 runSelfTest 內 NT$ 字面、對映 items、無漂移時 breaks=false', () => {
  const data = extractData(frameHtml(SELFTEST_REGEX_BODY));
  const items = collectItems(data, "all");
  const out = selftestLiterals(data, items, /* drifts */ [], /* dead */ []);
  const hit = out.find((o) => o.literal === "NT$800");
  assert.ok(hit, "應掃出自測斷言中的 NT$800 字面");
  assert.strictEqual(hit.matches.length, 5, "五集 shown.price=800 之項皆對映");
  assert.ok(hit.matches.every((m) => m.status === "OK"), "無 drifts/dead → 全 OK");
  assert.strictEqual(hit.breaks, false, "無受影響斷言 → breaks=false");
});

/* ═══════════════════ discTag：折數慣例（ceil vs round）與 null 護欄 ═══════════════════ */

test('discTag: 進位集（ceil）vs 四捨五入集（titanium）分歧樣態', () => {
  // (800/1000)*100 = 80 → 整十 → "8折"
  assert.strictEqual(discTag(800, 1000, "lecreuset"), "8折");
  // (851/1000)*100 = 85.1 → ceil 86 / round 85，用以區分兩種慣例
  assert.strictEqual(discTag(851, 1000, "lecreuset"), "86折", "ceil 集：85.1 → 86折");
  assert.strictEqual(discTag(851, 1000, "keyboard"), "86折", "keyboard 亦 ceil");
  assert.strictEqual(discTag(851, 1000, "titanium"), "85折", "titanium round：85.1 → 85折");
  assert.strictEqual(discTag(855, 1000, "titanium"), "86折", "titanium round：85.5 → 86折");
});

test('discTag: null 護欄（無價／無原價／原價<=現價 皆回 null）', () => {
  assert.strictEqual(discTag(0, 1000, "lecreuset"), null, "price falsy → null");
  assert.strictEqual(discTag(800, 0, "lecreuset"), null, "listPrice falsy → null");
  assert.strictEqual(discTag(1000, 1000, "lecreuset"), null, "原價=現價（無折扣）→ null");
  assert.strictEqual(discTag(1200, 1000, "lecreuset"), null, "現價高於原價 → null");
});


/* ───────────────────────── 量測有效性前提（2026-09-03；經驗卡 20260901-measurement-validity-precondition 第三例） ─────────────────────────
   病例：09-02 09:30 巡檢 140 件全部抓取失敗、okCount 0，price_qa exit 0 → price_watch.sh 結論「✓ 乾淨、無事收工」。
   這組測試專抓「零成功被當零問題」：抓取層全倒／半倒必須是 FATAL，不得 PASS。 */
const { auditItems: _auditItems, priceVerdict: _priceVerdict } = require("../../price_qa.js");
test("priceVerdict：一件都沒驗到＝FATAL exit 2（09-02 假乾淨病例）", () => {
  const v = _priceVerdict({ scanned: 140, okCount: 0, unverified: 140, drifts: [], dead: [] });
  assert.strictEqual(v.level, "FATAL"); assert.strictEqual(v.code, 2); assert.match(v.reason, /抓取層失效/);
});
test("priceVerdict：未驗證達半數＝FATAL（半數都量不到不能宣稱乾淨）", () => {
  assert.strictEqual(_priceVerdict({ scanned: 10, okCount: 5, unverified: 5 }).level, "FATAL");
  assert.strictEqual(_priceVerdict({ scanned: 10, okCount: 6, unverified: 4 }).level, "CLEAN");
});
test("priceVerdict：少數未驗證放行但寫進理由；有漂移＝BLOCK exit 1", () => {
  const v = _priceVerdict({ scanned: 10, okCount: 9, unverified: 1 });
  assert.strictEqual(v.level, "CLEAN"); assert.strictEqual(v.code, 0); assert.match(v.reason, /未驗證 1/);
  const b = _priceVerdict({ scanned: 10, okCount: 8, unverified: 0, drifts: [{}], dead: [] });
  assert.strictEqual(b.level, "BLOCK"); assert.strictEqual(b.code, 1);
});
test("auditItems：抓取層全倒（fetch 一律 throw）→ 全數 unverified、ok 0、verdict FATAL（不是乾淨）", async () => {
  const items = [1, 2, 3].map((i) => ({ dataset: "t", where: [`pool[${i}]`], gdid: `1000${i}`, url: `https://tw.buy.yahoo.com/gdsale/p-1000${i}.html`, shown: { price: 100, listPrice: null, offerTag: null } }));
  const r = await _auditItems(items, { delay: 0, fetchImpl: async () => { throw new Error("ECONNRESET"); } });
  assert.strictEqual(r.unverified.length, 3); assert.strictEqual(r.ok.length, 0); assert.strictEqual(r.drifts.length, 0); assert.strictEqual(r.dead.length, 0);
  assert.strictEqual(r.notes.filter((n) => /抓取失敗 ×2/.test(n)).length, 3);
  const v = _priceVerdict({ scanned: items.length, okCount: r.ok.length, unverified: r.unverified.length, drifts: r.drifts, dead: r.dead });
  assert.strictEqual(v.level, "FATAL");
});
