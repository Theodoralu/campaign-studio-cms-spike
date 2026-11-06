/**
 * ① 抓取＋解析：Yahoo 購物中心 URL → 標準快照 snapshot.json
 * 用法：node fetch_parse.js <URL> <輸出資料夾>
 *
 * 支援來源：品牌頁 brands/<id>、活動賣場 activity/onsale?actid=、分類頁（同品牌頁結構）、
 *          旗艦店主題館 ?catitemid=（Apollo 活動檔）、旗艦館首頁 ?sub=／分類頁 category/<id>（頁內活動連結型）
 * 產出：snapshot.json（活動賣場×N＋商品池＋hotSales＋品類分布）＋ raw/*.html 原始快照（保真稽核用）
 *
 * 鐵則（承 03 schema）：本模組只做「搬運」——所有價格/折數/檔期/URL 逐字取自來源；
 * 圖庫解析必附錨定（ProductBundle imageSet 為商品頁自帶有序圖庫，天然錨定）。
 *
 * 2026-07-20 擴充：①存活三態 online/archived/dead（classifyLiveness，雙證據＝頁內
 * 「活動時間」檔期 vs 現在＋來源頁 ec_promotions；404 不再一律 reject）；②活動頁 SSR
 * 檔期抽取（extractActivityPeriod → startTs/endTs/period）；③hasActivityData(snapshot)
 * ＝04 §8「有活動資料」總定義單一函式（N-11 收攏）。另可 require 匯出上述函式。
 */
const fs = require("fs");
const path = require("path");
const https = require("https");
const clock = require("./lib/clock"); // D4：唯一時鐘（CS_NOW 可固定）
const httpReplay = require("./lib/http_replay"); // D4：對外 HTTP 錄製／回放
const { ATTEMPT_TIMEOUT_MS } = require("./lib/net_tuning"); // 對外連線預算（唯一一份＝lib/net_tuning.js）：預設 250ms 太短會讓「人點得開、工具抓不到」
const { errKind, errText } = require("./lib/err_text.js"); // 2026-09-24：連線層失敗判準與可讀原因（CMS-OFFLINE-HONESTY）
const sleepMs = (ms) => new Promise((r) => setTimeout(r, ms));

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36";
const MAX_PRODUCTS_PER_ACT = 60; // R3：商品池抓取上限（現況＝內嵌首批；不足由人工指定補抓）

/**
 * 抓取單頁（跟隨轉址）→ { html, statusCode, finalUrl }。
 * 2026-07-20 實抓修正：舊版「非 200 即 reject」會誤傷——已結束活動的封存頁與
 * sw 保護檔（檔期內，例 actid=709977）都回 404 狀態碼、但頁身含完整 SSR 內容。
 * 故 200/404 一律回傳頁身；存活三態交由 classifyLiveness() 以雙證據判定
 * （頁內「活動時間」檔期 vs 現在＋呼叫端提供的來源頁 ec_promotions 檔期）。
 */
function fetchOnce(url, opts = {}) {
  const get = opts.get || httpReplay.get; // D4：live＝https.get；CS_HTTP_MODE=record|replay 走卡帶
  const reqOpts = { headers: { "User-Agent": UA } };
  if (opts.agent) reqOpts.agent = opts.agent;
  if (opts.autoSelectFamilyAttemptTimeout) reqOpts.autoSelectFamilyAttemptTimeout = opts.autoSelectFamilyAttemptTimeout;
  return new Promise((resolve, reject) => {
    const req = get(url, reqOpts, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        return resolve(fetchPage(new URL(res.headers.location, url).href, opts));
      }
      if (res.statusCode !== 200 && res.statusCode !== 404) {
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
      }
      let data = "";
      res.setEncoding("utf8");
      res.on("data", (c) => (data += c));
      res.on("end", () => resolve({ html: data, statusCode: res.statusCode, finalUrl: url }));
    });
    req.on("error", reject);
    req.setTimeout(30000, () => { req.destroy(new Error("timeout")); });
  });
}

/**
 * 2026-09-24 CMS-OFFLINE-HONESTY 第③件：連線層失敗（DNS／連線被拒／逾時／多位址全掛的 AggregateError）自動換新連線再試一次。
 * 為什麼是「換新連線」：09-22 病例＝同事貼好網址失敗、重開工具就好——若真因是啟動那一刻網路還沒好、舊連線把壞狀態留在身上，
 * 換一顆不保活的 Agent 就等於重開那一小段；重試時把雙協定嘗試的等待放寬到 2 秒（Node 預設 250ms，公司網路 IPv6 慢時會整批判死）。
 * 只重試連線層：HTTP 5xx／頁面空殼不重試（那不是這台的問題，重試只會多等）。失敗要出聲：重試前 console.warn 留痕。
 * 故障注入：CS_FETCH_SIMULATE_OFFLINE=1 ＝ 模擬「多位址全部連不上」（測試與驗收用；正式服務不設此 env）。
 */
async function fetchPage(url, opts = {}) {
  if (process.env.CS_FETCH_SIMULATE_OFFLINE === "1") {
    const e = new AggregateError([
      Object.assign(new Error("connect ECONNREFUSED 203.0.113.1:443"), { code: "ECONNREFUSED" }),
      Object.assign(new Error("connect ENETUNREACH 2001:db8::1:443"), { code: "ENETUNREACH" }),
    ], "");
    e.code = "ECONNREFUSED";
    throw e;
  }
  const retries = opts.retry == null ? 1 : opts.retry;
  try {
    return await fetchOnce(url, opts);
  } catch (e) {
    if (retries > 0 && errKind(e) === "network") {
      console.warn(`[fetchPage] 連線層失敗（${errText(e)}）→ ${opts.retryDelayMs == null ? 800 : opts.retryDelayMs}ms 後換新連線再試一次：${url}`);
      await sleepMs(opts.retryDelayMs == null ? 800 : opts.retryDelayMs);
      const agent = opts.get ? undefined : new https.Agent({ keepAlive: false });
      return fetchOnce(url, { ...opts, retry: 0, agent, autoSelectFamilyAttemptTimeout: ATTEMPT_TIMEOUT_MS, _retried: true }); /* 2026-10-05 合併調和：數字只有一份＝net_tuning（原分支寫死 2000；net_tuning 已把全程預設調到同值，這裡保留顯式帶入＝重試那一次不受外部改動影響） */
    }
    throw e;
  }
}

// D4（2026-11-06）：頁面上的檔期一律是台灣時間，但舊寫法用「機器本地時區」換算——在 UTC 的 CI／容器上會差 8 小時，
// 回放對不上。這裡改成寫死 +08:00（台灣無夏令時間），不再看 process.env.TZ。
const TPE_OFFSET_MS = 8 * 3600 * 1000;
const fmtTs = (unix) => {
  const d = new Date(unix * 1000 + TPE_OFFSET_MS);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}.${p(d.getUTCMonth() + 1)}.${p(d.getUTCDate())}`;
};

/** 「YYYY/MM/DD」＋「HH:MM」（Asia/Taipei，固定 +08:00）→ unix 秒；缺時刻用 fallbackTime */
function slashDateToTs(dateStr, timeStr, fallbackTime) {
  const [y, mo, d] = dateStr.split("/").map(Number);
  const [h, mi] = (timeStr || fallbackTime).split(":").map(Number);
  return Math.floor((Date.UTC(y, mo - 1, d, h, mi) - TPE_OFFSET_MS) / 1000);
}

/**
 * 活動頁 SSR 檔期抽取（04 §2.2 缺口補齊）：
 * 頁身「活動時間: YYYY/MM/DD HH:MM ~ YYYY/MM/DD HH:MM」（SSR 帶 <!-- --> 註解）
 * → { startTs, endTs, period, raw }；找不到＝null。逐字搬運，不推算。
 */
function extractActivityPeriod(rawHtml) {
  const m = (rawHtml || "").match(
    /活動時間[:：]\s*(?:<!--\s*-->)?\s*(\d{4}\/\d{1,2}\/\d{1,2})(?:\s+(\d{1,2}:\d{2}))?\s*[~～]\s*(\d{4}\/\d{1,2}\/\d{1,2})(?:\s+(\d{1,2}:\d{2}))?/
  );
  if (!m) return null;
  const startTs = slashDateToTs(m[1], m[2], "00:00");
  const endTs = slashDateToTs(m[3], m[4], "23:59"); // 結束缺時刻＝保守取當日尾（避免整日誤判過期）
  return {
    startTs, endTs,
    period: `${fmtTs(startTs)} ~ ${fmtTs(endTs)}`,
    raw: `${m[1]}${m[2] ? " " + m[2] : ""} ~ ${m[3]}${m[4] ? " " + m[4] : ""}`,
  };
}

/**
 * 活動頁存活三態（2026-07-20 實抓定案）——不能只看狀態碼：
 *   online＝在線：頁內檔期含現在，或來源頁 ec_promotions 檔期含現在（listedPeriod），
 *          或（無任何檔期證據時）HTTP 200。sw 保護檔在檔期內也回 404 → 仍判 online。
 *   archived＝已結束活動封存頁：頁身含完整 SSR（頁題／「活動時間」／商品池）但檔期已過。
 *   dead＝近空殼：頁題、檔期、商品池俱缺。
 * @param {object} [opts] - { now?: ms, listedPeriod?: {startTs,endTs}（unix 秒，來源頁 ec_promotions） }
 */
function classifyLiveness(rawHtml, statusCode, opts = {}) {
  const now = opts.now ?? clock.now();
  const html = rawHtml || "";
  const pagePeriod = extractActivityPeriod(html);
  const t = html.match(/<title>([^<]*)<\/title>/);
  const pageTitle = t && t[1].trim() ? t[1].trim() : null;
  // 商品池信號＝Apollo cache 實體鍵「ProductBundle:<gdid>」；近空殼頁也含同名 type policy 設定字串，不能用純字串包含
  const hasProducts = /Shopping_Promotion_ProductBundle:\d/.test(html);
  const inRange = (p) => !!p && Number.isFinite(+p.endTs) && +p.endTs * 1000 >= now &&
    (!Number.isFinite(+p.startTs) || +p.startTs * 1000 <= now);
  const evidence = {
    httpStatus: statusCode, pageTitle, hasProducts,
    pagePeriod: pagePeriod ? pagePeriod.raw : null,
    listedPeriod: opts.listedPeriod || null,
  };
  if (!hasProducts && !pagePeriod && !pageTitle) return { status: "dead", archived: false, evidence };
  if (inRange(pagePeriod) || inRange(opts.listedPeriod)) return { status: "online", archived: false, evidence };
  if (pagePeriod || opts.listedPeriod) return { status: "archived", archived: true, evidence };
  // 頁身有內容但兩路檔期證據皆缺：僅剩狀態碼可依（200＝在線；404＝視為封存）
  return statusCode === 200
    ? { status: "online", archived: false, evidence }
    : { status: "archived", archived: true, evidence };
}

/**
 * N-11 收攏（04 §8「有活動資料」總定義的單一函式）：
 * 快照是否含「在線」活動資料——ec_promotions 任一檔期含現在，
 * 或任一活動頁本身檔期含現在（且未標 archived）；過期一律 false。
 */
function hasActivityData(snapshot, now = clock.now()) {
  if (!snapshot || typeof snapshot !== "object") return false;
  const inRange = (startTs, endTs) => Number.isFinite(endTs) && endTs * 1000 >= now &&
    (!Number.isFinite(startTs) || startTs * 1000 <= now);
  const promos = Array.isArray(snapshot.promotions) ? snapshot.promotions : [];
  if (promos.some((p) => p && inRange(+p.startTs, +p.endTs))) return true;
  const acts = snapshot.activities && typeof snapshot.activities === "object"
    ? Object.values(snapshot.activities) : [];
  return acts.some((a) => a && !a.archived && inRange(+a.startTs, +a.endTs));
}

/** 品牌/分類頁解析：ec_promotions ＋ hotSales ＋ hits 品類分布 */
function parseBrandPage(html) {
  const out = { promotions: [], hotSales: [], hits: [], brand: null };
  const b = html.match(/"freqQuery":"([^"]+)"/) || html.match(/"brandName":"([^"]+)"/);
  if (b) out.brand = b[1];

  const promoBlock = html.match(/ec_promotions":(\[.*?\]),"/s);
  if (promoBlock) {
    out.promotions = [...promoBlock[1].matchAll(
      /\{"id":"(\d+)","title":"([^"]+)","short_description":"([^"]*)","start_time":(\d+),"end_time":(\d+),"url":"([^"]+)"(?:,"banner_url":"([^"]*)")?/g
    )].map((m) => ({
      actid: m[1], title: m[2], short: m[3],
      startTs: +m[4], endTs: +m[5],
      period: `${fmtTs(+m[4])} ~ ${fmtTs(+m[5])}`,
      url: m[6], banner: m[7] || null,
    }));
  }

  // hotSales：逐塊解析（欄位序可變、subtitle/currentPrice 可缺 —— 相鄰性 regex 會漏件）
  const hsBlock = html.match(/"hotSales":\{"products":(\[.*?\])\}/s);
  if (hsBlock) {
    const chunks = hsBlock[1].split(/\{"propertyCode":/).slice(1);
    out.hotSalesRaw = chunks.length;
    for (const c of chunks) {
      const f = (re) => { const m = c.match(re); return m ? m[1] : null; };
      const gdid = f(/"productId":"(\d+)"/), name = f(/"title":"([^"]+)"/);
      const cp = f(/"currentPrice":"([\d.]+)"/), mp = f(/"marketPrice":"([\d.]+)"/), pp = f(/"promotionPrice":"([\d.]+)"/);
      const url = f(/"productURL":"([^"]+)"/);
      const img = f(/"large":\{"url":"([^"]*)"/) || f(/"small":\{"url":"([^"]*)"/);
      if (!gdid || !name || !cp || !url) continue; // 無現價等必要欄位＝不可驗真值，略過（數量落差記 warning）
      const curP = Math.round(+cp), promoP = pp != null ? Math.round(+pp) : null;
      // 有效售價＝促銷價優先（存在且 >0 且低於網路價），否則網路價——與 price_qa parseProductPage 2026-07-26 一致（漏抓 promotionPrice 致報價偏高）
      const price = (promoP != null && promoP > 0 && promoP < curP) ? promoP : curP;
      out.hotSales.push({
        gdid, name, price, currentPrice: curP, promotionPrice: promoP,
        // 劃線價＝顯示語意（2026-07-27，與 parseActivityPage/parseProductPage 同修）：促銷才有、劃 currentPrice；廠商價另存透明
        marketPrice: (promoP != null && promoP > 0 && promoP < curP) ? curP : null,
        vendorMarketPrice: mp ? Math.round(+mp) : null,
        url, imgs: [img].filter(Boolean),
        desc: [], offer: f(/"subtitle":"([^"]*)"/), source: "hotSales",
      });
    }
  }

  out.hits = [...html.matchAll(
    /"sourcetitle":"[^"]*","catname_full":"([^"]+)","productname_disp":"([^"]+)","producturl":"([^"]+)","subcatname":"([^"]*)"/g
  )].map((m) => ({ cat: m[1].split("\t").pop(), name: m[2], url: m[3], subcat: m[4].trim() }));

  return out;
}

/**
 * 旗艦店/主題館頁解析（2026-07-30 頁型根治：catitemid=157965 三 run 實證——瀏覽器看得到商品，
 * 但頁內是新版 Apollo 快取 <script id="gqlstate-data">，無 ec_promotions/hotSales 舊結構）：
 * Shopping_PromotionList_Promotion 實體 → 活動檔清單（start_date/end_date 逐字＝檔期真值）。
 * 商品池不在此頁 SSR（getUther hits 僅品名/連結層級、currentPrice 多為 null）
 * → 一律走既有「逐檔抓活動頁商品池」路徑＝價格真值鏈不變。
 */
function parseFlagshipPage(html) {
  const out = { promotions: [], brand: null };
  const m = (html || "").match(/<script[^>]*id="gqlstate-data"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) return out;
  let state;
  try { state = JSON.parse(m[1]); }
  catch (e) { out.parseError = e.message; return out; } // 不吞錯：呼叫端記 warning（鐵律 3）
  for (const [key, v] of Object.entries(state)) {
    if (!key.startsWith("Shopping_PromotionList_Promotion:") || !v || v.is_hidden || !v.url) continue;
    const nameKey = Object.keys(v).find((k) => k === "name" || k.startsWith("name(")); // 實際鍵＝name({"revertYIV":true})
    const startTs = Number.isFinite(+v.start_date) ? +v.start_date : null;
    const endTs = Number.isFinite(+v.end_date) ? +v.end_date : null;
    out.promotions.push({
      actid: String(v.id), title: nameKey ? v[nameKey] : null, short: v.description || "",
      startTs, endTs,
      period: startTs != null && endTs != null ? `${fmtTs(startTs)} ~ ${fmtTs(endTs)}` : null,
      url: v.url,
      banner: (Array.isArray(v.bannerImage) && v.bannerImage[0] && (v.bannerImage[0].img_950 || v.bannerImage[0].img_620)) || null,
    });
  }
  const cat = Object.entries(state).find(([k, c]) => k.startsWith("Shopping_Category:") && c && c.level === "2" && c.title);
  if (cat) out.brand = cat[1].title; // 旗艦店名＝二層分類 title（例「PUMA旗艦店」）
  return out;
}

/**
 * 純連結型 fallback（?sub= 旗艦館首頁、category/<id> 分類頁：頁內無任何內嵌活動/價格資料，
 * 只有活動頁的純 HTML 連結）：抽 distinct actid；檔期/標題留 null，由各活動頁 SSR
 * 「活動時間」逐字補真值（classifyLiveness 雙證據退化為單證據＝頁內檔期，仍不推算）。
 */
function parseActivityLinks(html) {
  const seen = new Set();
  for (const m of (html || "").matchAll(/activity\/onsale\?actid=(\d+)/g)) seen.add(m[1]);
  return [...seen].map((actid) => ({
    actid, title: null, short: null, startTs: null, endTs: null, period: null,
    url: `https://tw.buy.yahoo.com/activity/onsale?actid=${actid}`, banner: null,
  }));
}

/**
 * 商品清單頁 hits 解析（2026-07-30 方案A：純商品池頁支援——過濾式分類頁 category/<id>?brandIds=&flt=、
 * 搜尋結果頁等「有商品清單、無活動檔」來源）：逐 hit 抽 gdid＋品名＋清單訊號（ec_price/ec_image）。
 * ⚠ ec_price 僅作清單訊號**不入池**——價格真值一律由呼叫端逐品實抓商品頁（price_qa.parseProductPage
 * 同一套實付/劃線語意）＝真值鐵律不破。ec_image 檔名含 -Gd-<gdid> 天然錨定，作圖素材。
 */
function parseListingHits(html) {
  const out = [];
  const seen = new Set();
  let prevEnd = 0; // 區塊所有權錨定：視窗下界＝上一 hit 的結尾 ⇒ 窗內 ec_* 必屬本 hit（圖庫錨定鐵則的區塊版；檔名 key 有 -Gd-<gdid>/-SP-<規格id> 兩制，不可用檔名驗）
  for (const m of (html || "").matchAll(
    /"sourcetitle":"[^"]*","catname_full":"([^"]+)","productname_disp":"([^"]+)","producturl":"([^"]+)","subcatname":"([^"]*)"/g
  )) {
    const seg = html.slice(Math.max(prevEnd, m.index - 8000), m.index);
    prevEnd = m.index + m[0].length;
    const url = m[3];
    const g = url.match(/[?&]gdid=(p\d{8,18}|\d{6,10})/i) || url.match(/-(\d{6,10})\.html/); /* p 型編號 2026-08-28（使用者實測 gdid=p0216265344571：gdsale.asp 形有 SSR、p-*.html 形 404——p 型一律走 gdsale.asp、數字型照舊） */ // 兩型連結：gdsale.asp?gdid=N（舊）／…-N.html
    if (!g || seen.has(g[1])) continue;
    seen.add(g[1]);
    const last = (re) => { let v = null; for (const x of seg.matchAll(re)) v = x[1]; return v; };
    out.push({
      gdid: g[1], name: m[2], cat: m[1].split("\t").pop(), subcat: m[4].trim(),
      url, img: last(/"ec_image":"([^"]+)"/g),
      ecPrice: last(/"ec_price":"([\d.]+)"/g),
    });
  }
  return out;
}

/**
 * 商品頁「賣場名稱」抽取（2026-08-26 使用者裁決：促銷卡店名開正式欄 products[].store、實抓帶入）。
 * 真值鐵律：只取頁面實有資料、抓不到＝回 null（呼叫端欄位缺席，不捏造、不留空字串）。
 * 取值優先序（2026-08-26 實抓 5 檔驗證）：
 *   ① 頁面品牌旗艦館頭（FlagshipHeader 錨點 alt → <h1>）＝商品頁實際顯示的賣場頭
 *      （例「24HRS品牌旗艦館」；掛旗艦館的商品才有——5 檔實測 2 中，其餘頁面本來就沒有賣場頭）。
 *   ② Apollo 內嵌 state 的 storeName ③ JSON-LD offers.seller.name——此兩路在購物中心（B2C）
 *      全站恆為平台通名「Yahoo購物中心」＝無賣場辨識度、視同缺席（欄位語意＝「這件商品的賣場」，
 *      通名不入欄；若未來頁型出現真店家名則自然生效）。平台通名過濾＝資料品質判斷，非捏造。
 * 消費端＝price_qa.parseProductPage（商品頁實抓單一解析點）；渲染端促銷卡「有 store 才顯示店名列」。
 */
function extractStoreName(html) {
  const h = String(html || "");
  const decode = (s) => String(s)
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").trim();
  const isPlatformGeneric = (s) => /^yahoo(奇摩)?購物中心$/i.test(String(s).replace(/\s+/g, ""));
  // ① 旗艦館頭：class hash 會隨前端改版變動＝只錨定 FlagshipHeader 前綴；先取錨點 alt、退 <h1> 文字
  let m = h.match(/FlagshipHeader__info[^>]*>\s*<a [^>]*alt="([^"]+)"/);
  if (!m) m = h.match(/FlagshipHeader__[\s\S]{0,1200}?<h1>([^<]+)<\/h1>/);
  if (m && decode(m[1])) return decode(m[1]);
  // ②③ 內嵌 state storeName（鍵帶 GraphQL 參數＝跳脫引號形，[^)]* 可跨）→ JSON-LD seller.name
  const cands = [];
  const st = h.match(/"storeName\([^)]*\)":"([^"]+)"/) || h.match(/"storeName":"([^"]+)"/);
  if (st) cands.push(st[1]);
  const ld = h.match(/"seller":\{"@type":"Organization","name":"([^"]+)"\}/);
  if (ld) cands.push(ld[1]);
  for (const c of cands) {
    const v = decode(c);
    if (v && !isPlatformGeneric(v)) return v;
  }
  return null;
}

/** 活動賣場頁解析：Shopping_Promotion_ProductBundle 商品池（Apollo cache，需反轉義） */
function parseActivityPage(rawHtml) {
  const html = rawHtml.replace(/\\"/g, '"');
  const meta = { resultsTotal: null };
  const t = html.match(/"resultsTotal":(\d+)/);
  if (t) meta.resultsTotal = +t[1];

  const products = [...html.matchAll(
    /"Shopping_Promotion_ProductBundle:(\d+)":\{"__typename":"Shopping_Promotion_ProductBundle","id":"\d+","title\(\{"revertYIV":true\}\)":"([^"]+)"[\s\S]{0,800}?"description":"([^"]*)"[\s\S]{0,500}?"currentPrice":([\d.]+),"marketPrice":([\d.]+)[\s\S]{0,400}?"url":"([^"]+)","imageSet":(\[\[[\s\S]*?\]\])(?=,")/g
  )].map((m) => {
    // imageSet＝有序圖庫（外層＝第 N 張、內層＝尺寸），逐圖取最大尺寸 URL —— 圖庫錨定天然成立
    const imgs = [...m[7].matchAll(/\[\{"__typename":"Shopping_ProductImage","url":"([^"]+)"/g)].map((x) => x[1]);
    /* 2026-07-27 根治（同類根因：實付真值一致）：促銷價優先——存在且 >0 且低於網路價才採用，
       與 hotSales（本檔 163）／price_qa.parseProductPage（2026-07-26）同一套邏輯。
       促銷價欄位若不在此 bundle JSON 片段內則 promoP=null＝自然退回網路價 ⇒ 無回歸。
       原本 price 直接取 currentPrice(m[4])＝對顧客報價可能偏高（此路徑初始快照）。 */
    const curP = +m[4], mktP = +m[5];
    const ppm = m[0].match(/"promotionPrice":"?([\d.]+)"?/); // 2026-07-27 覆核修：容忍加引號字串形式（hotSales 用 "promotionPrice":"NNN"，見本檔 157）；原無引號 regex 遇字串形式會靜默漏抓→報價仍偏高
    const promoP = ppm ? +ppm[1] : null;
    const price = (promoP != null && promoP > 0 && promoP < curP) ? promoP : curP;
    /* 劃線價（marketPrice 欄）真值＝商品頁「顯示語意」（2026-07-27 修，gdid 11581454 實證）：
       僅促銷時有劃線、劃線＝currentPrice；bundle 的 marketPrice（廠商建議售價）商品頁不顯示，
       原直接沿用＝活動頁顯示商品頁沒有的灰價＋折數虛深（1380/4980＝2.8 折）。
       欄名保留 marketPrice（下游 gate/引擎/工作台全體語意＝「要顯示的劃線價」）；廠商價另存 vendorMarketPrice 透明稽核。 */
    const dispList = (promoP != null && promoP > 0 && promoP < curP) ? Math.round(curP) : null;
    return {
      gdid: m[1], name: m[2],
      desc: m[3].split(/\\*u003cbr>/) // 斷行標記；前段殘留的「\」與 \r\n 跳脫序列一併清除
        .map((s) => s.replace(/\\[rnt]/g, " ").replace(/\\/g, "").trim())
        .filter(Boolean).slice(0, 3),
      price: Math.round(price), currentPrice: Math.round(curP), promotionPrice: promoP != null ? Math.round(promoP) : null,
      marketPrice: dispList, vendorMarketPrice: Math.round(mktP),
      disc: dispList ? Math.round((price / dispList) * 100) : null,
      url: m[6].startsWith("http") ? m[6] : "https://tw.buy.yahoo.com" + m[6],
      imgs, offer: null, source: "activity",
    };
  }).slice(0, MAX_PRODUCTS_PER_ACT);

  // 檔期＝頁內 SSR「活動時間」逐字（直接輸入 actid 路徑的檔期真值來源＝04 §2.2 補齊）
  const act = extractActivityPeriod(rawHtml);
  return {
    meta, products,
    startTs: act ? act.startTs : null,
    endTs: act ? act.endTs : null,
    period: act ? act.period : null,
    periodRaw: act ? act.raw : null,
  };
}

async function main() {
  const [url, outDir] = process.argv.slice(2);
  if (!url || !outDir) { console.error("用法：node fetch_parse.js <URL> <輸出資料夾>"); process.exit(1); }
  const u = new URL(url);
  if (!/(^|\.)tw\.buy\.yahoo\.com$/.test(u.hostname)) { console.error(`非法網域：${u.hostname}（僅接受 tw.buy.yahoo.com）`); process.exit(1); }

  fs.mkdirSync(path.join(outDir, "raw"), { recursive: true });
  const snapshot = { sourceUrl: url, fetchedAt: clock.iso(), brand: null, promotions: [], activities: {}, products: [], hits: [], warnings: [] };

  console.log(`[1/3] 抓取來源頁 ${url}`);
  const { html: mainHtml, statusCode: mainStatus } = await fetchPage(url);
  fs.writeFileSync(path.join(outDir, "raw", "source_page.html"), mainHtml);

  const isActivity = /activity\/onsale/.test(url);
  if (isActivity) {
    const live = classifyLiveness(mainHtml, mainStatus);
    if (live.status === "dead") throw new Error(`HTTP ${mainStatus}＝dead（近空殼：無頁題/檔期/商品池）：${url}`);
    const { meta, products, startTs, endTs, period } = parseActivityPage(mainHtml);
    const actid = u.searchParams.get("actid") || "unknown";
    snapshot.activities[actid] = {
      meta, count: products.length,
      title: live.evidence.pageTitle ? live.evidence.pageTitle.split(" | ")[0].trim() : null,
      startTs, endTs, period,
      liveness: live.status, archived: live.archived,
    };
    if (live.archived) snapshot.warnings.push(`actid ${actid}：檔期已過（${period ?? "頁內無檔期"}、HTTP ${mainStatus}）＝已結束活動封存頁，標 archived:true`);
    else if (mainStatus !== 200) snapshot.warnings.push(`actid ${actid}：HTTP ${mainStatus} 但頁內檔期未過（${period}）＝在線（sw 保護檔型），依雙證據判 online`);
    snapshot.products.push(...products.map((p) => ({ ...p, actid })));
  } else {
    if (mainStatus !== 200) throw new Error(`HTTP ${mainStatus} for ${url}`);
    const brand = parseBrandPage(mainHtml);
    snapshot.brand = brand.brand;
    snapshot.hits = brand.hits;

    /* 頁型分層路由（2026-07-30 根治＋方案A）：依「使用者意圖」而非頁面結構——
       E2E 實證：過濾式分類頁的 SSR 變體有時同時內嵌 ec_promotions／Apollo 活動檔（分類 banner），
       若活動檔訊號先吃＝banner 蓋過過濾意圖（黑色系 PUMA 變成整分類混池）。
       ⓪URL 帶過濾/搜尋參數（brandIds/flt、/search/）＝要的就是這份清單 → 清單逐品實抓凌駕一切活動檔訊號
       ①舊結構 ec_promotions/hotSales（品牌頁）②Apollo 活動檔（catitemid 主題館）
       ③商品清單（無過濾意圖但有 SSR 清單的頁）④頁內活動連結。
       活動檔路商品池走「逐檔抓活動頁」；清單路價格真值＝逐品實抓商品頁——兩路真值鏈同源。 */
    const filterIntent = u.searchParams.has("brandIds") || u.searchParams.has("flt") || u.pathname.includes("/search/");
    /* 清單逐品實抓（方案A 2026-07-30 使用者裁決）：ec_price 僅作清單訊號不入池，
       價格真值＝price_qa.parseProductPage 同一套實付/劃線語意；圖＝ec_image（-Gd-<gdid> 錨定）。 */
    const enrichFromListing = async () => {
        const listing = parseListingHits(mainHtml);
        if (!listing.length) return false;
        const { classifyProductLiveness } = require("./price_qa.js"); // 延遲載入：price_qa 頂層 require 本檔＝頂層反向引用會循環
        const { probeProductLiveness, evidenceLine } = require("./workbench/product_fetch.js"); // 商品在不在＝兩種拼法都問過才略過（PRODUCT-DEAD-TWO-URLS，2026-09-28）
        const take = listing.slice(0, MAX_PRODUCTS_PER_ACT);
        console.log(`[1.5/3] 商品清單型${filterIntent ? "（過濾/搜尋意圖）" : ""}：SSR 清單 ×${listing.length} → 逐品實抓驗價 ×${take.length}`);
        const skipped = [];
        /* 並行抓取池（2026-10-05 提速 B）：原本一件接一件＋每件睡 250ms＝63 件走 68 秒；改五路並行、
           全池開工間隔 250ms（整體最快每秒 4 件＝仍在禮貌線內；Yahoo 軟限流病例 2026-07-30 的教訓由
           全池節流承接，不是拆掉）。結果照清單原序入池＝並行不改商品順序（策展決定論）。
           回退＝CAMPAIGN_FETCH_POOL=off。 */
        const { mapPool } = require("./lib/fetch_pool.js");
        const probedE = await mapPool(take, async (h) => {
          try { return { h, live: await probeProductLiveness({ gdid: h.gdid, url: null, fetchPage, classifyProductLiveness, delayMs: 300 }) }; } // 網址怎麼拼＝product_fetch.js 唯一一份；兩種拼法都問過才略過
          catch (e) { return { h, err: e }; }
        }, { concurrency: 5, minGapMs: 250 });
        /* 價格對真種子（2026-10-05 提速 A）：這一輪抓的就是「建立期價格對真」等一下要再抓的同一批商品頁、
           同一支探測器（probeProductLiveness）——存下結果，server 在新鮮度窗內直接用、同一頁不付兩次網路錢。
           只存對真需要的欄位；非 online 的也記（雖然不入池＝通常不會被消費），誠實保留狀態。 */
        const seedRows = {};
        for (const r of probedE) {
          const h = r.h;
          if (r.err) { skipped.push(`${h.gdid} 抓取失敗:${r.err.message}`); continue; }
          const live = r.live;
          seedRows[String(h.gdid)] = live.status !== "online"
            ? { status: live.status }
            : { status: "online", price: live.prod.price, listPrice: live.prod.listPrice || null, fetchUrl: live.evidence.fetchUrl };
          if (live.status !== "online") { skipped.push(`${h.gdid}=${live.status}`); console.log(`      ${h.gdid} ${live.status}：${evidenceLine(live.evidence)}`); continue; }
          const purl = live.evidence.fetchUrl; // 有回商品資料的那個拼法＝入池 url
          const pr = live.prod;
          snapshot.products.push({
            gdid: h.gdid, name: h.name, desc: [], // desc 不在商品頁實體切片＝留空不捏造（R3 慣例）
            price: pr.price, currentPrice: pr.currentPrice, promotionPrice: pr.promotionPrice,
            marketPrice: pr.listPrice, vendorMarketPrice: pr.marketPriceRaw, // 劃線價顯示語意＝parseProductPage listPrice（2026-07-27 修同源）
            disc: pr.listPrice ? Math.round((pr.price / pr.listPrice) * 100) : null,
            url: purl, imgs: h.img ? [h.img] : [], offer: null, source: "listing",
            ...(pr.store ? { store: pr.store } : {}), // 賣場名稱（2026-08-26 店名欄）：頁面實有才帶、缺席不留空字串
          });
        }
        try { fs.writeFileSync(path.join(outDir, "price_truth_seed.json"), JSON.stringify({ fetchedAt: clock.iso(), source: "listing-enrich", rows: seedRows }, null, 1)); }
        catch (e) { console.log(`      ⚠ 價格對真種子沒寫成（${e.message}）——建立期會照舊逐件抓，只是慢、不是錯`); }
        const noImg = snapshot.products.filter((p) => p.source === "listing" && !p.imgs.length).length;
        snapshot.warnings.push(
          `商品清單型來源${filterIntent ? "（過濾/搜尋意圖＝清單優先於頁掛活動檔）" : ""}：清單 ${listing.length} 件${listing.length > take.length ? `（僅取前 ${take.length} 件）` : ""}、逐品實抓入池 ${take.length - skipped.length} 件` +
          (skipped.length ? `、略過 ${skipped.length} 件（${skipped.slice(0, 5).join("、")}${skipped.length > 5 ? "…" : ""}）` : "") +
          (noImg ? `；${noImg} 件無錨定圖＝策展不入池` : "") +
          "（價格真值＝逐品商品頁實抓；ec_price 僅清單訊號）"
        );
        return snapshot.products.length > 0;
      };

    if (filterIntent && (await enrichFromListing())) {
      // ⓪ 過濾/搜尋意圖已由清單滿足——不消費 ec_promotions/hotSales/Apollo/連結（banner 與過濾條件無關）
    } else {
      snapshot.promotions = brand.promotions;
      snapshot.products.push(...brand.hotSales);
      if (brand.hotSalesRaw && brand.hotSales.length < brand.hotSalesRaw) {
        snapshot.warnings.push(`hotSales：來源 ${brand.hotSalesRaw} 件、解析 ${brand.hotSales.length} 件、略過 ${brand.hotSalesRaw - brand.hotSales.length} 件（無現價等必要欄位，不可驗真值）`);
      }
      if (!snapshot.promotions.length && !snapshot.products.length) {
        const flag = parseFlagshipPage(mainHtml);
        if (flag.parseError) snapshot.warnings.push(`gqlstate-data JSON 解析失敗：${flag.parseError}（旗艦店路徑跳過，退後續層）`);
        if (flag.promotions.length) {
          snapshot.brand = snapshot.brand || flag.brand;
          snapshot.promotions = flag.promotions;
          console.log(`[1.5/3] 旗艦店/主題館型：Apollo 活動檔 ×${flag.promotions.length}`);
        } else {
          if (!filterIntent) await enrichFromListing(); // ③ 無過濾意圖：活動檔訊號全空才用清單
          if (!snapshot.products.length && !snapshot.promotions.length) {
            const links = parseActivityLinks(mainHtml);
            if (links.length) {
              snapshot.promotions = links;
              snapshot.warnings.push(`來源頁無內嵌活動檔資料＝純連結型：改抽頁內活動連結 ×${links.length}（檔期以各活動頁 SSR 逐字為準）`);
              console.log(`[1.5/3] 純連結型：頁內活動連結 ×${links.length}`);
            }
          }
        }
      }
    }

    console.log(`[2/3] 活動賣場 ×${snapshot.promotions.length}：逐檔抓商品池`);
    for (const promo of snapshot.promotions) {
      try {
        const { html: actHtml, statusCode: actStatus } = await fetchPage(promo.url);
        fs.writeFileSync(path.join(outDir, "raw", `act_${promo.actid}.html`), actHtml);
        // 雙證據：頁內「活動時間」＋來源頁列載檔期（ec_promotions/Apollo；連結型無列載檔期＝退單證據）
        const live = classifyLiveness(actHtml, actStatus, { listedPeriod: Number.isFinite(+promo.endTs) ? { startTs: promo.startTs, endTs: promo.endTs } : null });
        if (live.status === "dead") {
          snapshot.warnings.push(`actid ${promo.actid}：HTTP ${actStatus}＝dead（近空殼），略過`);
          continue;
        }
        const { meta, products, startTs: pageStartTs, endTs: pageEndTs, period: pagePeriod } = parseActivityPage(actHtml);
        snapshot.activities[promo.actid] = {
          meta, count: products.length,
          title: promo.title ?? (live.evidence.pageTitle ? live.evidence.pageTitle.split(" | ")[0].trim() : null), // 連結型無列載標題＝取活動頁頁題
          period: promo.period ?? pagePeriod,
          startTs: promo.startTs ?? pageStartTs, endTs: promo.endTs ?? pageEndTs, // 真值＝來源頁列載檔期；缺（連結型）＝頁內 SSR 逐字
          pageStartTs, pageEndTs, pagePeriod,                  // 頁內 SSR 檔期（互證用）
          liveness: live.status, archived: live.archived,
        };
        if (live.archived) {
          snapshot.warnings.push(`actid ${promo.actid}：頁內檔期（${pagePeriod ?? "無"}）與來源頁列載檔期（${promo.period ?? "無列載"}）皆已過＝封存頁，標 archived:true、商品不入池（${products.length} 件略過——過期檔價格已失真值時效）`);
          continue; // 2026-07-30 根治（連結型來源常見：catL2 實證 NIKE 771331 過期檔 20 件曾入池）：封存檔商品一律不入池
        } else if (pageEndTs && pageEndTs * 1000 < clock.now()) {
          snapshot.warnings.push(`actid ${promo.actid}：頁內檔期已過（${pagePeriod}）但 ec_promotions 仍列且未過期＝判 online（雙證據衝突，人工覆核）`);
        }
        for (const p of products) {
          if (!snapshot.products.some((x) => x.gdid === p.gdid)) snapshot.products.push({ ...p, actid: promo.actid });
        }
        if (meta.resultsTotal && products.length < Math.min(meta.resultsTotal, MAX_PRODUCTS_PER_ACT)) {
          snapshot.warnings.push(`actid ${promo.actid}：商品池 ${meta.resultsTotal} 件、本次僅取內嵌首批 ${products.length} 件（不足由人工指定補抓＝R3）`);
        }
      } catch (e) {
        snapshot.warnings.push(`actid ${promo.actid} 抓取失敗：${e.message}`);
      }
    }
  }

  // 失敗要出聲（鐵律 3；2026-07-30 根治——原「有 hits 沒 products」靜默產空池快照，策展端才 0 件中止）
  if (!snapshot.products.length) {
    snapshot.warnings.push(`來源頁抓不到任何可入池商品（活動檔 ×${Object.keys(snapshot.activities).length}、hits ×${snapshot.hits.length}＝僅品名/連結、無價格真值）——此來源不支援策展，請改貼品牌頁或活動賣場網址`);
  }

  // 品類分布（樓層分組素材）
  const bySub = {};
  for (const h of snapshot.hits) bySub[h.subcat] = (bySub[h.subcat] || 0) + 1;
  snapshot.subcatDist = bySub;

  // 折數統計（KV 主軸依據：實算最低折數）
  const discs = snapshot.products.map((p) => p.disc).filter((d) => d && d > 0 && d < 100);
  snapshot.minDisc = discs.length ? Math.min(...discs) : null;

  console.log(`[3/3] 快照落檔：${snapshot.products.length} 件商品／${snapshot.promotions.length} 檔活動／最低折數 ${snapshot.minDisc ?? "無"}`);
  fs.writeFileSync(path.join(outDir, "snapshot.json"), JSON.stringify(snapshot, null, 2));
  if (snapshot.warnings.length) console.log("warnings:\n  - " + snapshot.warnings.join("\n  - "));
}

if (require.main === module) {
  main().catch((e) => { console.error("FATAL:", e.message); process.exit(1); });
}

module.exports = { fetchPage, parseBrandPage, parseFlagshipPage, parseActivityLinks, parseListingHits, parseActivityPage, extractActivityPeriod, extractStoreName, classifyLiveness, hasActivityData };
