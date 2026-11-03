/**
 * CP-19 價格時效 QA（部署前必跑）：FrameTest 帶價展示元件 × 商品頁現價 逐品比對
 * 依據：U21 2026-07-20 使用者裁決（活動頁部分商品價格與現行商品頁不一致）
 *
 * 用法：node price_qa.js <FrameTest.html 路徑> [datasetKey|all] [--skip-http] [--out <report.json>] [--delay <ms>]
 *   datasetKey ∈ lecreuset|camping|keyboard|fashion|titanium|all（預設 all）
 *   --skip-http  乾跑：只抽出帶價元件清單、不實抓（exit 0）
 *   --delay      禮貌節流間隔 ms（預設 350；下限 300＝U21 指示）
 *
 * 帶價展示元件範圍（U21）：各池商品 tuple（[3] 現價、marketMeta 原價、[4] 折數標籤、[6] 商品頁 URL）
 * ＋各集 kvKeyProducts（KV 主打卡 name/price）＋品類牆3 新品。入口/編輯精選現為無價元件、不在掃描範圍
 * （U19/U20 工作流管轄）。featuredProducts 為死資料（未被任何 renderer 引用）、不掃。
 *
 * 判定：現價不符＝DRIFT（Blocking）；原價不符＝DRIFT-list（Blocking）；下架/404 空殼＝DEAD（Blocking）。
 * newOfferTag 依該集折數慣例重算：lecreuset/keyboard/camping/fashion＝進位（ceil）、titanium＝四捨五入。
 * 另掃 runSelfTest 內 NT$ 價格字面斷言 → selftestLiterals（漂移時自測會踩的斷言）。
 *
 * exit code：0＝全符（或 --skip-http）；1＝任何 DRIFT / DEAD；2＝抓取層失效（一件都沒驗到、或未驗證≥半數＝量測無效，不得判乾淨；2026-09-03）。
 * 網路慣例沿 fetch_parse.js：同 UA、fetchPage（200/404 皆回頁身）、僅 tw.buy.yahoo.com。
 */
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { fetchPage, extractStoreName } = require("./fetch_parse.js");
const { probeProductLiveness, evidenceLine } = require("./workbench/product_fetch.js"); // 商品在不在＝兩種拼法都問過才判死（PRODUCT-DEAD-TWO-URLS，2026-09-28）；該檔零相依、不成環

/* ============ 來源抽取：string/comment-aware 平衡括號切片 ============ */
/** 自 src[openIdx]（須為 [ 或 {）起，跳過字串與註解，回傳對應閉括號 index（含） */
function balancedEnd(src, openIdx) {
  const open = src[openIdx];
  const close = open === "[" ? "]" : "}";
  let depth = 0;
  for (let i = openIdx; i < src.length; i++) {
    const c = src[i];
    if (c === '"' || c === "'" || c === "`") {           // 字串：吃到同引號（跳脫感知）
      for (i++; i < src.length; i++) {
        if (src[i] === "\\") { i++; continue; }
        if (src[i] === c) break;
      }
      continue;
    }
    if (c === "/" && src[i + 1] === "/") { i = src.indexOf("\n", i); if (i < 0) break; continue; }
    if (c === "/" && src[i + 1] === "*") { i = src.indexOf("*/", i) + 1; if (i < 1) break; continue; }
    if (c === open || (open === "[" && c === "[") || (open === "{" && c === "{")) depth++;
    else if (c === close) { depth--; if (depth === 0) return i; }
  }
  throw new Error(`balancedEnd：自 index ${openIdx} 起找不到對應 ${close}`);
}

/** 取「anchor 之後第一個 [ 或 { 起」的平衡字面值原文；找不到 anchor 回 null */
function literalAfter(src, anchor, fromIdx = 0, boundIdx = Infinity) {
  const at = src.indexOf(anchor, fromIdx);
  if (at < 0 || at >= boundIdx) return null;
  const open = src.slice(at).search(/[[{]/);
  if (open < 0) return null;
  const start = at + open;
  return src.slice(start, balancedEnd(src, start) + 1);
}

/** 在共享 vm context 內求值字面值（池常數可互相引用，如 CAMP_WALL3 引 CAMP_PRODUCTS[12]） */
function evalLiteral(ctx, literal, what) {
  try { return vm.runInContext(`(${literal})`, ctx, { timeout: 5000 }); }
  catch (e) { throw new Error(`求值失敗（${what}）：${e.message}`); }
}

/** FrameTest.html → { marketMeta, pools, wall3s, kvKeyProducts(5 集), selftestSrc } */
function extractData(html) {
  const ctx = vm.createContext(Object.create(null));
  const def = (name, anchor) => {
    const lit = literalAfter(html, anchor);
    if (!lit) throw new Error(`來源抽取失敗：找不到 ${anchor}`);
    ctx[name] = evalLiteral(ctx, lit, name);
    return ctx[name];
  };

  const marketMeta = def("marketMeta", "const marketMeta = {");
  // 各池/牆的 Object.assign(marketMeta, {...}) 全數合併（U18 牆3 原價等）
  let cursor = 0;
  while (true) {
    const at = html.indexOf("Object.assign(marketMeta,", cursor);
    if (at < 0) break;
    const lit = literalAfter(html, "Object.assign(marketMeta,", cursor);
    Object.assign(marketMeta, evalLiteral(ctx, lit, "Object.assign(marketMeta)"));
    cursor = at + 25;
  }

  const pools = {
    lecreuset: def("productGroups", "const productGroups = [").flatMap((g) =>
      g.products.map((t, i) => ({ t, where: `pool.${g.id}[${i}]` }))),
    camping: def("CAMP_PRODUCTS", "const CAMP_PRODUCTS = [").map((t, i) => ({ t, where: `pool[${i}]` })),
    keyboard: def("KB_PRODUCTS", "const KB_PRODUCTS = [").map((t, i) => ({ t, where: `pool[${i}]` })),
    fashion: def("FA_PRODUCTS", "const FA_PRODUCTS = [").map((t, i) => ({ t, where: `pool[${i}]` })),
    titanium: def("TITANIUM_PRODUCTS", "const TITANIUM_PRODUCTS = [").map((t, i) => ({ t, where: `pool[${i}]` })),
  };
  const wall3s = {
    lecreuset: def("LC_WALL3", "const LC_WALL3 = ["),
    camping: def("CAMP_WALL3", "const CAMP_WALL3 = ["),
    keyboard: def("KB_WALL3", "const KB_WALL3 = ["),
    fashion: def("FA_WALL3", "const FA_WALL3 = ["),
    titanium: def("TI_WALL3", "const TI_WALL3 = ["),
  };

  // kvKeyProducts：預設集（let 宣告）＋ DEMO_DATASETS 各集 apply() 內的重指派（camping/keyboard 前置 KV 常數）
  const kvKeyProducts = { lecreuset: evalLiteral(ctx, literalAfter(html, "let kvKeyProducts = ["), "kv lecreuset") };
  const demoAt = html.indexOf("const DEMO_DATASETS");
  if (demoAt < 0) throw new Error("來源抽取失敗：找不到 DEMO_DATASETS");
  const keys = ["camping", "keyboard", "fashion", "titanium"];
  const secIdx = keys.map((k) => ({ k, at: html.indexOf(`${k}: {`, demoAt) }));
  for (let i = 0; i < secIdx.length; i++) {
    const { k, at } = secIdx[i];
    if (at < 0) throw new Error(`來源抽取失敗：DEMO_DATASETS 無 ${k} 段`);
    const bound = i + 1 < secIdx.length ? secIdx[i + 1].at : html.length;
    for (const kvConst of ["CAMP_KV", "KB_KV", "FA_KV", "TI_KV"]) {           // 各集 KV 常數（有才抽）
      const lit = literalAfter(html, `const ${kvConst} = [`, at, bound);
      if (lit) ctx[kvConst] = evalLiteral(ctx, lit, kvConst);
    }
    const lit = literalAfter(html, "kvKeyProducts = [", at, bound);
    if (!lit) throw new Error(`來源抽取失敗：${k} 段無 kvKeyProducts`);
    kvKeyProducts[k] = evalLiteral(ctx, lit, `kv ${k}`);
  }

  // runSelfTest 原始碼（NT$ 價格字面斷言掃描用）＋各字面之行號
  const stAt = html.indexOf("function runSelfTest(");
  const selftestSrc = stAt < 0 ? "" : html.slice(stAt, balancedEnd(html, stAt + html.slice(stAt).indexOf("{")) + 1);
  const stLine = stAt < 0 ? 0 : html.slice(0, stAt).split("\n").length;

  return { marketMeta, pools, wall3s, kvKeyProducts, selftestSrc, selftestStartLine: stLine };
}

/* ============ 元件清單組裝 ============ */
const parseMoney = (s) => {
  if (s == null || s === "") return null;
  const m = String(s).replace(/[NT$,\s]/g, "");
  return /^\d+$/.test(m) ? +m : null;
};
const gdidFromUrl = (u) => {
  const m = String(u).match(/[?&]gdid=(p\d{8,18}|\d+)/i) || String(u).match(/-(\d+)\.html/); /* p 型編號 2026-08-28（使用者實測 gdid=p0216265344571：gdsale.asp 形有 SSR、p-*.html 形 404——p 型一律走 gdsale.asp、數字型照舊） */
  return m ? m[1] : null;
};
const DISC_MODE = { lecreuset: "ceil", camping: "ceil", keyboard: "ceil", fashion: "ceil", titanium: "round" }; // 折數慣例（U21：LC/KB 進位、titanium 四捨五入；camping/fashion 沿進位＝與池內既有標籤互證一致）
const discTag = (price, listPrice, dataset) => {
  if (!price || !listPrice || listPrice <= price) return null;
  const pct = Math[DISC_MODE[dataset] || "ceil"]((price / listPrice) * 100);
  return pct % 10 === 0 ? `${pct / 10}折` : `${pct}折`;
};

/** 五集帶價元件 →（dataset,gdid 去重）審計項目；where 併列所有出現位置 */
function collectItems(data, datasetFilter) {
  const items = [];
  const byKey = new Map();
  const add = (dataset, where, name, url, shown) => {
    const gdid = gdidFromUrl(url);
    const key = `${dataset}:${gdid || url}`;
    if (byKey.has(key)) {
      const it = byKey.get(key);
      it.where.push(where);
      if (shown.price !== it.shown.price) it.conflicts = [...(it.conflicts || []), `${where} price ${shown.price} ≠ ${it.shown.price}`];
      return;
    }
    const it = { dataset, where: [where], gdid, name, url, shown };
    byKey.set(key, it);
    items.push(it);
  };
  for (const dataset of Object.keys(data.pools)) {
    if (datasetFilter !== "all" && dataset !== datasetFilter) continue;
    const tupleShown = (t) => ({
      price: parseMoney(t[3]),
      listPrice: data.marketMeta[t[0]] ? parseMoney(data.marketMeta[t[0]].listPrice) : null,
      offerTag: t[4] || null,
    });
    for (const { t, where } of data.pools[dataset]) add(dataset, where, t[0], t[6], tupleShown(t));
    data.wall3s[dataset].forEach((t, i) => add(dataset, `wall3[${i}]`, t[0], t[6], tupleShown(t)));
    (data.kvKeyProducts[dataset] || []).forEach((p, i) =>
      add(dataset, `kv[${i}]`, p.name, p.url, { price: parseMoney(p.price), listPrice: null, offerTag: null }));
  }
  return items;
}

/* ============ 商品頁實抓＋三態存活（沿 fetch_parse 慣例、商品頁版） ============ */
/** 主商品 Apollo 實體 "Shopping_Product:<gdid>":{...} 內逐字取價；區塊頭 8000 字內即含價格欄。
 *  錨定必帶 ":"（實體鍵），避免誤中前方 {"__ref":"Shopping_Product:<gdid>"} 指標。 */
function parseProductPage(html, gdid) {
  const at = html.indexOf(`"Shopping_Product:${gdid}":`);
  if (at < 0) return null;
  const seg = html.slice(at, at + 8000);
  const f = (re) => { const m = seg.match(re); return m ? m[1] : null; };
  const cp = f(/"currentPrice":"([\d.]+)"/), mp = f(/"marketPrice":"([\d.]+)"/), pp = f(/"promotionPrice":"([\d.]+)"/);
  const currentPrice = cp != null ? Math.round(+cp) : null;
  const promotionPrice = pp != null ? Math.round(+pp) : null;
  /* 有效售價＝消費者實付真值（＝Yahoo JSON-LD offers.price／分期計算基準）：促銷價存在且 >0 且低於網路價時採促銷價，否則網路價。
     2026-07-26 修：原 price 僅取 currentPrice（網路價），漏抓更低的 promotionPrice（促銷價），導致活動頁報價偏高
     （例：gdid=11697562 網路價 15840、促銷價 15365，活動頁誤顯 15840、貴 475）。currentPrice 另存欄位保留透明。 */
  const price = (promotionPrice != null && promotionPrice > 0 && (currentPrice == null || promotionPrice < currentPrice)) ? promotionPrice : currentPrice;
  /* 劃線價（原價）真值＝商品頁「顯示語意」直取渲染節點（2026-09-29 修；支線 tofu-0d 診斷、主線複現三頁）：
     07-27 拿 11581454（1099/4980 深折）一個病例斷成「marketPrice 一律不顯示」＝單一病例過度概括——
     實測 Yahoo 是「有條件顯示」灰價：12034942（239/290）、11275066（550/690）頁面都有灰價，11581454 確實沒有。
     顯示門檻是 Yahoo 內規（疑似市價比），我們不猜門檻：頁面顯示什麼就取什麼＝HeroInfo__subPriceNumber
     渲染節點（class hash 後綴會變＝前綴匹配；「容器 HeroInfo__subPrice 每頁都在、沒顯示時是空的」＝
     必須瞄準 subPriceNumber 才不會抓到空殼，2026-09-29 實抓三頁證實）。
     取不到渲染節點＝退 07-27 欄位規則（促銷中劃 currentPrice）；灰價必須高於實付價才採（防解析雜訊）。
     病例＝run 2026-09-29-wb-112554 主打選品 3 件＋促銷卡 2 件原價消失（使用者：「商品頁上是有灰色價格的顯示」）。
     廠商建議售價照舊另存 marketPriceRaw 透明保留。 */
  const subShown = (() => { const m = html.match(/HeroInfo__subPriceNumber[^"]*"[^>]*>\s*(?:NT?\$|\$)?\s*([\d,]+)/); return m ? Math.round(+m[1].replace(/,/g, "")) : null; })();
  const listPrice = (subShown != null && price != null && subShown > price) ? subShown
    : ((price != null && currentPrice != null && price < currentPrice) ? currentPrice : null);
  return {
    price,
    currentPrice,
    listPrice,
    marketPriceRaw: mp != null ? Math.round(+mp) : null,
    promotionPrice,
    title: f(/"title\(\{[^}]*\}\)":"([^"]*)"/) || f(/"title":"([^"]*)"/),
    /* 賣場名稱（2026-08-26 促銷卡店名欄 products[].store）：旗艦館頭在實體切片之外＝對整頁抽取；
       抓不到＝null（呼叫端入列時欄位缺席，不捏造、不留空字串）。優先序見 fetch_parse.extractStoreName。 */
    store: extractStoreName(html),
  };
}

/** 商品頁存活三態：online＝實體塊含現價；offline＝頁有骨架但無該商品實體（下架/空殼）；dead＝404 近空殼 */
function classifyProductLiveness(html, statusCode, gdid) {
  const prod = parseProductPage(html || "", gdid);
  const t = (html || "").match(/<title>([^<]*)<\/title>/);
  const evidence = { httpStatus: statusCode, pageTitle: t && t[1].trim() ? t[1].trim().slice(0, 60) : null, hasProductEntity: !!prod };
  if (prod && prod.price != null) return { status: "online", prod, evidence };
  if (statusCode === 404 && !prod) return { status: "dead", prod: null, evidence };
  return { status: "offline", prod, evidence }; // 200 但無實體/無現價＝下架空殼，同屬 DEAD 級
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 實抓 URL 怎麼拼（`gdsale.asp?gdid=N` 舊型 SSR 不出資料→先問 `gdsale/p-<gdid>.html`、再問 asp 形；p 型只走 asp 形）
 *  ＝唯一一份在 workbench/product_fetch.js productFetchUrls；本檔原本自抄一份 fetchUrlFor（2026-09-28 收掉）。
 *  展示層 URL 不改，僅抓取層轉換；evidence 記 fetchUrl 與每一次 attempts 供稽核。 */

async function auditItems(items, { delay = 300, fetchImpl } = {}) {
  const doFetch = fetchImpl || fetchPage;/* fetchImpl＝測試注入（抓取層全倒的迴歸測試用） */
  const drifts = [], dead = [], ok = [], notes = [], unverified = [];
  let n = 0;
  for (const it of items) {
    n++;
    const label = `[${n}/${items.length}] ${it.dataset} ${it.where[0]} gdid=${it.gdid}`;
    if (!/^https:\/\/tw\.buy\.yahoo\.com\//.test(it.url)) { notes.push(`${label}：非 tw.buy.yahoo.com URL、跳過（${it.url}）`); continue; }
    if (!it.gdid) { notes.push(`${label}：URL 無法解析 gdid、跳過（${it.url})`); continue; }
    /* 兩種拼法都問過才判 DEAD（PRODUCT-DEAD-TWO-URLS，2026-09-28）：p- 形偶發 404 空殼與真下架長得一樣，一次回應不能當死亡證明；
       網路層仍是「同一拼法連不上重試一次」、全部連不上＝UNVERIFIED（不判 DRIFT/DEAD）。 */
    let live;
    try { live = await probeProductLiveness({ gdid: it.gdid, url: it.url, fetchPage: doFetch, classifyProductLiveness, delayMs: Math.max(delay, 300), sleep }); }
    catch (e2) { notes.push(`${label}：抓取失敗 ×2（${e2.message}）→ 以 UNVERIFIED 記錄、不判 DRIFT/DEAD`); unverified.push({ dataset: it.dataset, where: it.where.join(" & "), gdid: it.gdid, error: String(e2 && e2.message || e2).slice(0, 120) }); continue; }
    const fetchUrl = live.evidence.fetchUrl, fetchedAt = live.evidence.fetchedAt;
    if (live.status !== "online") {
      dead.push({ dataset: it.dataset, where: it.where.join(" & "), gdid: it.gdid, name: it.name, url: it.url,
        liveness: live.status, evidence: { ...live.evidence, fetchUrl, fetchedAt } });
      console.log(`  DEAD  ${label} ${live.status}（HTTP ${live.evidence.httpStatus}；${evidenceLine(live.evidence)}）`);
    } else {
      const lp = live.prod.listPrice && live.prod.listPrice > live.prod.price ? live.prod.listPrice : null; // 慣例：原價僅實際有折扣者
      const priceDrift = it.shown.price !== live.prod.price;
      const listDrift = it.shown.listPrice != null && it.shown.listPrice !== lp;
      if (priceDrift || listDrift) {
        const isDiscTag = /^\d+折$/.test(it.shown.offerTag || "");
        drifts.push({
          dataset: it.dataset, where: it.where.join(" & "), gdid: it.gdid, name: it.name,
          kind: priceDrift && listDrift ? "price+list" : priceDrift ? "price" : "list",
          shown: { price: it.shown.price, listPrice: it.shown.listPrice, offerTag: it.shown.offerTag },
          live: { price: live.prod.price, listPrice: lp },
          delta: priceDrift ? live.prod.price - it.shown.price : 0,
          newOfferTag: isDiscTag ? discTag(live.prod.price, lp, it.dataset) : null, // 折數標籤才重算；null＝需改用特色短語或無折扣
          evidence: { url: it.url, fetchUrl, httpStatus: live.evidence.httpStatus, currentPrice: live.prod.currentPrice, marketPriceRaw: live.prod.marketPriceRaw, promotionPrice: live.prod.promotionPrice, fetchedAt }, // 2026-07-27 劃線價真值修：證據欄改存原始欄位（listPrice 已改顯示語意）
        });
        console.log(`  DRIFT ${label} ${it.shown.price}→${live.prod.price}${listDrift ? `（原價 ${it.shown.listPrice}→${lp}）` : ""}`);
      } else {
        ok.push({ dataset: it.dataset, gdid: it.gdid });
        if (it.shown.listPrice == null && lp) notes.push(`${it.dataset} ${it.where.join(" & ")} gdid=${it.gdid}：頁面未列原價但商品頁現有折扣（${live.prod.price}/${lp}）——非 U21 漂移定義、僅提示`);
      }
    }
    if (it.conflicts) notes.push(`${it.dataset} gdid=${it.gdid}：同集多處展示值不一致（${it.conflicts.join("；")}）`);
    await sleep(Math.max(delay, 300)); // U21：GET 禮貌節流 ≥300ms
  }
  return { drifts, dead, ok, notes, unverified };
}

/* ============ 量測有效性前提（2026-09-03；經驗卡 20260901-measurement-validity-precondition 第三例） ============
   病例：09-02 09:30 巡檢 140 件全部抓取失敗（okCount 0、notes 140 條「抓取失敗」）卻 exit 0 → price_watch.sh 結論
   「✓ 乾淨：140 件 0 DRIFT / 0 DEAD，無事收工」＝零成功被當零問題（鐵律 3 靜默降級、money-facing、一整天沒人看價格）。
   判準（單一決策點，CLI exit code 與 price_watch.sh 都讀這裡）：一件都沒驗到＝FATAL；未驗證達半數以上＝FATAL
  （半數都量不到的日子不能宣稱乾淨）；否則照 DRIFT/DEAD＝BLOCK／CLEAN。少數未驗證仍放行但寫進 notes＋report.unverified。 */
function priceVerdict({ scanned = 0, okCount = 0, unverified = 0, drifts = [], dead = [] } = {}) {
  const u = typeof unverified === "number" ? unverified : (unverified || []).length;
  const dr = Array.isArray(drifts) ? drifts.length : (Number(drifts) || 0), de = Array.isArray(dead) ? dead.length : (Number(dead) || 0);
  if (scanned > 0 && okCount === 0 && dr === 0 && de === 0) return { level: "FATAL", code: 2, reason: `抓取層失效：${scanned} 件一件都沒驗到（未驗證 ${u}）——不能判乾淨` };
  if (scanned > 0 && u * 2 >= scanned) return { level: "FATAL", code: 2, reason: `抓取層失效：未驗證 ${u}/${scanned}（≥ 半數）——量測無效、不能判乾淨` };
  if (dr || de) return { level: "BLOCK", code: 1, reason: `DRIFT ${dr}／DEAD ${de}` };
  return { level: "CLEAN", code: 0, reason: u ? `OK ${okCount}/${scanned}（未驗證 ${u} 件見 notes）` : `OK ${okCount}/${scanned}` };
}

/* ============ runSelfTest NT$ 價格字面斷言 × 審計結果交叉 ============ */
function selftestLiterals(data, items, drifts, dead) {
  const out = [];
  const lines = data.selftestSrc.split("\n");
  const seen = new Map();
  lines.forEach((ln, i) => {
    for (const m of ln.matchAll(/NT\$[\d,]+/g)) {
      const lineNo = data.selftestStartLine + i; // 行號＝掃描當下版本（FrameTest 若有並行編輯會漂移，僅供定位）
      if (!seen.has(m[0])) seen.set(m[0], []);
      if (!seen.get(m[0]).includes(lineNo)) seen.get(m[0]).push(lineNo);
    }
  });
  for (const [literal, lineNos] of seen) {
    const val = parseMoney(literal);
    const matches = items.filter((it) => it.shown.price === val).map((it) => {
      const d = drifts.find((x) => x.dataset === it.dataset && x.gdid === it.gdid);
      const dd = dead.find((x) => x.dataset === it.dataset && x.gdid === it.gdid);
      return { dataset: it.dataset, where: it.where.join(" & "), gdid: it.gdid,
        status: dd ? "DEAD" : d ? "DRIFT" : "OK", livePrice: d ? d.live.price : dd ? null : val };
    });
    out.push({ literal, htmlLines: lineNos, matches, breaks: matches.some((x) => x.status !== "OK") });
  }
  return out;
}

/* ============ CLI ============ */
async function main() {
  const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  const flags = process.argv.slice(2).filter((a) => a.startsWith("--"));
  const [file, datasetKey = "all"] = args;
  if (!file) {
    console.error("用法：node price_qa.js <FrameTest.html 路徑> [datasetKey|all] [--skip-http] [--out <report.json>] [--delay <ms>]");
    process.exit(1);
  }
  const skipHttp = flags.includes("--skip-http");
  const outFlag = flags.find((f) => f.startsWith("--out"));
  const outPath = outFlag ? (outFlag.includes("=") ? outFlag.split("=")[1] : process.argv[process.argv.indexOf(outFlag) + 1]) : "price_qa_report.json";
  const delayFlag = flags.find((f) => f.startsWith("--delay"));
  const delay = delayFlag ? Math.max(+(delayFlag.includes("=") ? delayFlag.split("=")[1] : process.argv[process.argv.indexOf(delayFlag) + 1]) || 350, 300) : 350;

  const html = fs.readFileSync(file, "utf8");
  const data = extractData(html);
  const items = collectItems(data, datasetKey);
  const perDs = {};
  for (const it of items) perDs[it.dataset] = (perDs[it.dataset] || 0) + 1;
  console.log(`帶價展示元件：${items.length} 件（去重後）｜` + Object.entries(perDs).map(([k, v]) => `${k} ${v}`).join("、"));

  if (skipHttp) {
    const report = { tool: "price_qa v1", mode: "skip-http", source: path.resolve(file), datasetKey, generatedAt: new Date().toISOString(),
      scanned: items.length, perDataset: perDs,
      items: items.map((it) => ({ dataset: it.dataset, where: it.where.join(" & "), gdid: it.gdid, name: it.name, shown: it.shown, url: it.url })) };
    fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
    console.log(`乾跑（--skip-http）：清單已寫 ${outPath}；不實抓、exit 0`);
    return process.exit(0);
  }

  console.log(`實抓比對（節流 ${delay}ms/請求）…`);
  const { drifts, dead, ok, notes, unverified } = await auditItems(items, { delay });
  const st = selftestLiterals(data, items, drifts, dead);
  const report = { tool: "price_qa v1", mode: "live", source: path.resolve(file), datasetKey, generatedAt: new Date().toISOString(),
    scanned: items.length, perDataset: perDs, okCount: ok.length, unverified: unverified.length, unverifiedItems: unverified,
    drifts, dead, selftestLiterals: st, notes };
  const verdict = priceVerdict({ scanned: items.length, okCount: ok.length, unverified: unverified.length, drifts, dead });
  report.verdict = verdict;
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2));

  const stBroken = st.filter((s) => s.breaks);
  console.log(`\n===== price_qa 摘要 =====`);
  console.log(`scanned ${items.length}｜OK ${ok.length}｜DRIFT ${drifts.length}｜DEAD ${dead.length}｜UNVERIFIED ${unverified.length}｜自測價格字面斷言受影響 ${stBroken.length}/${st.length}`);
  if (verdict.level === "FATAL") console.log(`✗ ${verdict.reason}`);
  for (const d of drifts) console.log(`  DRIFT [${d.dataset}] ${d.where} gdid=${d.gdid} ${d.kind}：現價 ${d.shown.price}→${d.live.price}（Δ${d.delta >= 0 ? "+" : ""}${d.delta}）` + (d.kind !== "price" ? ` 原價 ${d.shown.listPrice}→${d.live.listPrice}` : "") + (d.newOfferTag ? ` 新標籤 ${d.newOfferTag}` : ""));
  for (const x of dead) console.log(`  DEAD  [${x.dataset}] ${x.where} gdid=${x.gdid}（${x.liveness}, HTTP ${x.evidence.httpStatus}）`);
  for (const s of stBroken) console.log(`  SELFTEST ${s.literal}（FrameTest 行 ${s.htmlLines.join("/")}）→ ${s.matches.filter((m) => m.status !== "OK").map((m) => `${m.dataset} ${m.where} ${m.status}`).join("；")}`);
  if (notes.length) console.log(`notes ×${notes.length}（詳報告）`);
  console.log(`報告：${outPath}`);
  process.exit(verdict.code); // 0 CLEAN／1 BLOCK（DRIFT/DEAD＝2026-07-27 起全擋）／2 FATAL（抓取層失效＝2026-09-03 量測有效性前提）
}

if (require.main === module) {
  main().catch((e) => { console.error("FATAL:", e.message); process.exit(1); });
}

module.exports = { extractData, collectItems, parseProductPage, classifyProductLiveness, discTag, selftestLiterals, auditItems, priceVerdict };
