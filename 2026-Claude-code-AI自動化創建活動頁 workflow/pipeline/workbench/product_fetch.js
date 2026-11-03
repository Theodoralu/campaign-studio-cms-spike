"use strict";
/**
 * workbench/product_fetch.js —— 商品實抓（URL/賣場編號 → 真值 product）
 * 2026-08-26 主打選品貼稿批：自 server.js 原樣抽出（邏輯零改動）——工廠注入 fetchPage／
 * classifyProductLiveness＝hermetic 測試可用注入樁（不觸網）；server.js 綁定真依賴後行為不變。
 *
 * 檢查鏈：①網域白名單（CP-04）②必須是商品頁 gdsale 連結 ③實抓存活三態（price_qa classifyProductLiveness）
 * ④全頁互斥預檢（CP-18：pageGdids 給了才檢＝替換情境；貼稿選品不給＝允許直接引用既有品）。
 * 真值鐵律：name/price/marketPrice 逐字自商品頁 SSR；offer 不可得＝留空（不捏造）。
 */

function gdidOf(url) {
  let m = url.match(/[-p](\d{6,})\.html/); if (m) return m[1];
  m = url.match(/[?&]gdid=(p\d{8,18}|\d{6,})/i); if (m) return m[1]; /* p 型編號 2026-08-28（使用者實測 gdid=p0216265344571：gdsale.asp 形有 SSR、p-*.html 形 404——p 型一律走 gdsale.asp、數字型照舊） */ // F9-1 審查修：補參數界定——原無界定會把 ?xgdid=1234567 誤抽成賣場編號（前端 manualUrlGdid 同式、兩層守門接受集一致）
  return null;
}

/* ═══════ 商品在不在：兩種拼法、兩個證據、留下問了什麼（PRODUCT-DEAD-TWO-URLS，2026-09-28） ═══════
   病例＝2026-09-27 星巴克新品 213533：gdid 12087726 在售 $497，卻被寫「連結已失效」——檢查器把 gdsale.asp?gdid=N
   改拼成 gdsale/p-N.html 去問、p- 形偶爾回 404 空殼（同一分鐘再問就 200）、只問一次、404 不重試、報告只寫 dead。
   真下架（對照 gdid 10000001）兩種拼法都 404 同一空殼＝一次回應分不出「偶發」與「真死」。
   規則（使用者裁甲）：①任一拼法 online＝online ②全部拼法都非 online 才判死 ③每一次問了哪個網址、對方回幾號、頁標題
   都留在 evidence.attempts。原本六處各抄一份「網址怎麼拼」（商品檢查／連結檢查／貼網址／替換商品／修價／策展驗價）
   ＝修一處漏五處（鐵律 4），現在只有這一份。本檔零相依＝price_qa／fetch_parse／server 都能 require、不成環。 */
const GDSALE = "https://tw.buy.yahoo.com/gdsale/";
const aspUrl = (g) => `${GDSALE}gdsale.asp?gdid=${g}`;
const pHtmlUrl = (g) => `${GDSALE}p-${g}.html`;

/** 問法順序（唯一一份）：
 *  數字型＝先 p-N.html（SSR 穩定；使用者貼 gdsale.asp 形也改問這個）、再 gdsale.asp?gdid=N；
 *  使用者貼的是 slug 形（xxx-N.html）＝先照他貼的問、再 asp 形；
 *  p 型＝只有 asp 形有 SSR（p-*.html 一律 404，2026-08-28 實測）→ 同一網址隔一拍再問一次當第二證據。
 *  帶簽章 sw= 的網址＝先照原網址問（2026-10-14 病例 gdid=11688645「(特)」品：只有 gdsale.asp?gdid=N&sw=… 回 200，
 *  p-N.html 與不帶 sw 的 asp 形都 404 空殼＝在賣卻被判死、價格也校不到——促銷價 8541 卻停在列表價 8990）。 */
function productFetchUrls(gdid, url) {
  const g = String(gdid || "");
  const u = String(url || "");
  if (/[?&]sw=/.test(u) && /^https:\/\/tw\.buy\.yahoo\.com\/gdsale\//.test(u)) return [u, /^p/i.test(g) ? u : aspUrl(g)];
  if (/^p/i.test(g)) return [aspUrl(g), aspUrl(g)];
  const first = (!u || /gdsale\.asp\?/.test(u)) ? pHtmlUrl(g) : u;
  const second = aspUrl(g);
  return first === second ? [first, first] : [first, second];
}

/** 一行人話：問了幾次、每次問哪個網址、對方怎麼回（wb.log／報告 note／巡檢 console 共用） */
function evidenceLine(evidence) {
  const at = (evidence && evidence.attempts) || [];
  const short = (u) => String(u || "").replace(GDSALE, "");
  const word = (a) => a.error ? `連不上（${a.error}）` : `HTTP ${a.httpStatus}${a.status === "online" ? " 有商品" : a.status === "offline" ? " 頁在但沒商品資料" : " 空殼"}`;
  return `問了 ${at.length} 次：` + at.map((a) => `${short(a.url)} → ${word(a)}`).join("；");
}

/**
 * 商品頁存活，問到有第二個證據才下結論。
 * @param {{gdid:string|number, url?:string|null, fetchPage:Function, classifyProductLiveness:Function, delayMs?:number, sleep?:Function}} o
 * @returns {Promise<{status:"online"|"offline"|"dead", prod:object|null, html:string|null, statusCode:number|null,
 *   evidence:{fetchUrl:string, httpStatus:number|null, pageTitle:string|null, hasProductEntity:boolean, asked:number, attempts:Array, fetchedAt:string}}>}
 * 網路層：同一拼法連不上＝隔 delayMs 重試一次（原 fetchRetry 慣例）；全部拼法都連不上＝throw 最後一個錯（err.attempts 帶證據），
 * 呼叫端照舊記 unverified／回 502——「連不上」不是「不在」。
 */
async function probeProductLiveness({ gdid, url, fetchPage, classifyProductLiveness, delayMs = 800, sleep }) {
  const zz = sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
  const urls = productFetchUrls(gdid, url);
  const attempts = []; let lastErr = null, sawAnswer = false;
  const summary = (u) => {
    const last = attempts[attempts.length - 1] || {};
    return { fetchUrl: u || last.url || urls[0], httpStatus: last.httpStatus ?? null, pageTitle: last.pageTitle ?? null, hasProductEntity: !!last.hasProductEntity, asked: attempts.length, attempts, fetchedAt: new Date().toISOString() };
  };
  for (let i = 0; i < urls.length; i++) {
    const u = urls[i];
    if (i > 0 && delayMs > 0) await zz(delayMs); // 第二個證據隔一拍：偶發空殼多半幾秒內就好
    const t0 = Date.now();
    let res = null;
    try { res = await fetchPage(u); }
    catch (e) {
      if (delayMs > 0) await zz(delayMs);
      try { res = await fetchPage(u); } catch (e2) { lastErr = e2; attempts.push({ url: u, error: String((e2 && e2.message) || e2).slice(0, 120), ms: Date.now() - t0 }); continue; }
    }
    const live = classifyProductLiveness(res.html, res.statusCode, gdid) || {};
    const ev = live.evidence || {};
    sawAnswer = true;
    attempts.push({ url: u, httpStatus: res.statusCode, pageTitle: ev.pageTitle ?? null, hasProductEntity: ev.hasProductEntity ?? !!live.prod, status: live.status || "offline", ms: Date.now() - t0 });
    if (live.status === "online") return { status: "online", prod: live.prod, html: res.html, statusCode: res.statusCode, evidence: summary(u) };
  }
  if (!sawAnswer) { const err = lastErr || new Error("沒有拿到任何回應"); err.attempts = attempts; throw err; }
  const status = attempts.some((a) => a.status === "offline") ? "offline" : "dead"; // 有一次「頁在但沒商品資料」＝下架空殼，比「連結失效」更接近事實
  return { status, prod: null, html: null, statusCode: attempts[attempts.length - 1].httpStatus ?? null, evidence: summary() };
}

/**
 * @param {{fetchPage: Function, classifyProductLiveness: Function, probeDelayMs?: number}} deps 實依賴（server）或注入樁（測試）
 * @returns {(body:{url?:string, pageGdids?:Array}) => Promise<{code:number, product?:object, error?:string}>}
 */
function createProductFetch(deps) {
  const { fetchPage, classifyProductLiveness, probeDelayMs } = deps; // probeDelayMs＝兩種拼法之間隔多久（測試設 0；省略＝800ms）
  return async function productFetch(body) {
    let url = (body.url || "").trim();
    /* 賣場編號直接輸入（2026-07-25 使用者需求）：輸入 6~10 碼數字（可含「賣場編號:」前綴）＝自動組成商品網址
       gdid 網址邏輯：https://tw.buy.yahoo.com/gdsale/gdsale.asp?gdid=<賣場編號> */
    const pBare = url.match(/^(?:賣場編號|編號|gdid)?[\s:：=＝]*(p\d{8,18})$/i); /* p 型編號 2026-08-28（使用者實測 gdid=p0216265344571：gdsale.asp 形有 SSR、p-*.html 形 404——p 型一律走 gdsale.asp、數字型照舊） */
    if (pBare) url = "https://tw.buy.yahoo.com/gdsale/gdsale.asp?gdid=" + pBare[1].toLowerCase();
    const digits = url.replace(/[^0-9]/g, "");
    if (!pBare && digits.length >= 6 && digits.length <= 10 && /^(賣場編號|編號|gdid)?[\s:：=＝]*[0-9\s]+$/i.test(url)) {
      url = "https://tw.buy.yahoo.com/gdsale/gdsale.asp?gdid=" + digits;
    }
    let u; try { u = new URL(url); } catch (e) { return { code: 400, error: "這不是完整的網址，也不是賣場編號——請貼商品頁網址，或直接輸入賣場編號（6~10 碼數字，或 p 開頭的新型編號）" }; }
    if (u.protocol !== "https:" || u.hostname !== "tw.buy.yahoo.com") return { code: 400, error: "只接受 Yahoo購物中心的商品頁——請貼 tw.buy.yahoo.com 開頭的商品頁網址" };
    if (!u.pathname.includes("/gdsale")) return { code: 400, error: "這不是商品頁連結——品牌頁／分類頁／活動頁不適用替換，請貼商品頁（網址含 /gdsale/）" };
    const gdid = gdidOf(url);
    if (!gdid) return { code: 400, error: "這個連結看不出賣場編號——請確認貼的是商品頁網址（含 /gdsale/）" };
    if ((body.pageGdids || []).map(String).includes(gdid)) return { code: 409, error: `此商品（賣場編號 ${gdid}）已經在頁面上了——同一件商品整頁只能放一次，請換一件` };
    /* 在不在＝兩種拼法都問過才判死、每次問了什麼留 evidence（PRODUCT-DEAD-TWO-URLS，2026-09-28；原本自抄一份拼法＋只問一次） */
    let live;
    try { live = await probeProductLiveness({ gdid, url, fetchPage, classifyProductLiveness, delayMs: probeDelayMs }); } catch (e) { return { code: 502, error: "讀取這個商品頁失敗——請確認網址能在瀏覽器打開後再試一次（技術訊息：" + e.message + "）" }; }
    if (live.status !== "online") return { code: 400, error: `這件商品目前不能用（${live.status === "dead" ? "連結已失效" : "已下架或沒有現價"}）——請換一件在售商品`, evidence: live.evidence };
    const res = { html: live.html, statusCode: live.statusCode };
    /* 圖庫：og:image＝第一張；同後綴（SP-<id>／Gd-<gdid>）依 HTML 出現序去重（先反跳脫 \/ 再匹配） */
    const H = res.html.replace(/\\\//g, "/");
    const og = (H.match(/property="og:image"[^>]*content="(https:\/\/(?:img\.yec\.tw|s\.yimg\.com|sp\.yimg\.com)\/[^"]+)"/) || [])[1] || ""; // 圖床三主機＝gate IMG_DOMAINS 同源（2026-07-29：僅認 img.yec.tw 時 s.yimg 商品「抓不到圖」用戶無解）
    const sfx = (og.match(/-((?:SP|Gd)-\w+)\.(?:jpg|png)/) || [])[1]; /* p 型編號 2026-08-28：後綴放寬 \w＝p 開頭編號的圖檔尾碼也認得 */
    const seen = new Set(); const imgs = [];
    const re = /https:\/\/(?:img\.yec\.tw|s\.yimg\.com|sp\.yimg\.com)\/zp\/MerchandiseImages\/[A-Za-z0-9-]+\.(?:jpg|png)/g; // 圖床三主機（同 gate IMG_DOMAINS）
    let m2;
    while ((m2 = re.exec(H))) {
      const im = m2[0];
      if (seen.has(im)) continue; seen.add(im);
      if (!sfx || im.includes(sfx) || im.includes(`-Gd-${gdid}`)) imgs.push(im);
      if (imgs.length >= 5) break; /* 前五張（2026-09-04 使用者要求：hero／本期活動商品都要能從商品頁前五張挑主圖；原上限 4） */
    }
    if (og && imgs[0] !== og) { const i = imgs.indexOf(og); if (i > 0) imgs.splice(i, 1); imgs.unshift(og); }
    if (!imgs.length) return { code: 400, error: "這個商品頁抓不到商品圖片——它的圖片可能不在支援的 Yahoo 圖床（img.yec.tw／s.yimg.com／sp.yimg.com）。請換一件商品；若這件商品必須使用，請把商品頁網址回報系統管理員擴充支援" };
    /* url＝「實際問到、拿到商品資料的那個網址」而非使用者輸入（2026-10-04 根治汙染源：輸入賣場編號會組 asp 式、
       實抓卻走 p- 式（SSR 穩定），原本回報輸入式→貼稿真值同步把它寫進快照＝與原始抓取的 p- 式打架，
       gate 字串比對判「連結與來源不符」且刪商品也消不掉（run 2026-10-04-wb-211607 實證死鎖）。 */
    const out = { gdid, name: live.prod.title || "", price: live.prod.price, url: (live.evidence && live.evidence.fetchUrl) || url, imgs };
    if (live.prod.listPrice && live.prod.listPrice > live.prod.price) out.marketPrice = live.prod.listPrice;
    if (live.prod.store) out.store = live.prod.store; // 賣場名稱（2026-08-26 店名欄）：頁面實有才帶、缺席不留空字串（促銷卡「有 store 才顯示店名列」）
    if (!out.name || out.price == null) return { code: 400, error: "這個商品頁讀不到完整資料（缺名稱或價格）——請換一件商品試試" };
    return { code: 200, product: out };
  };
}

module.exports = { gdidOf, createProductFetch, productFetchUrls, probeProductLiveness, evidenceLine };
