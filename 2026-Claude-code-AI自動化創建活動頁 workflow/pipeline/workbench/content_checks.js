"use strict";
/**
 * 頁面內容檢查純函式（2026-07-27）——零相依、不觸網（網路呼叫在 server.js）＝可單元測試。
 * 兩個使用者實證缺口的共用邏輯：
 *  1) syncPoolEntry：更替重抓＝池內既有品同步「整組」實抓真值（DJI 11697562 死循環根治）。
 *  2) collectPageLinks／classifyLinkTarget／classifySearchLiveness：
 *     商品狀態檢查延伸到「延伸探索／編輯精選圓卡／本期活動」的連結與圖（原本完全是檢查盲區）。
 */

/** 商品連結 → gdid（gdsale.asp?gdid=N 與 /gdsale/p-N.html 兩型；沿 server.js gdidOf 慣例） */
function gdidOfUrl(url) {
  const s = String(url || "");
  const m = s.match(/[?&]gdid=(p\d{8,18}|\d+)/i) || s.match(/\/gdsale\/p-(\d+)\.html/); /* p 型編號 2026-08-28（使用者實測 gdid=p0216265344571：gdsale.asp 形有 SSR、p-*.html 形 404——p 型一律走 gdsale.asp、數字型照舊） */
  return m ? m[1] : null;
}

/** 商品網址等價鍵（2026-10-04 根治 CP-02「連結與來源不符」死鎖，病例＝run 2026-10-04-wb-211607 gdid 7460184）：
 *  同一件商品有三種合法網址寫法——gdsale.asp?gdid=N（舊）／/gdsale/p-N.html／/gdsale/slug-N.html——
 *  使用者輸入賣場編號會組出 asp 式、原始抓取存的是 p- 式，字串硬比對就把同一件商品判成「被改過」。
 *  normalizeLinkUrl 的註解早寫明「兩式視為同一目的地」，但四道比對門（gate CP-02 ×2／syncPoolEntry／
 *  server 真值收斂）全都沒用它＝規則存在卻被無視。本鍵只認 tw.buy.yahoo.com（網域守門仍歸 CP-04）。 */
function productUrlKey(url) {
  const s = String(url || "").trim();
  let u; try { u = new URL(s); } catch (e) { return null; }
  if (!/(^|\.)tw\.buy\.yahoo\.com$/.test(u.hostname.toLowerCase())) return null;
  const m = s.match(/[?&]gdid=(p\d{8,18}|\d{6,10})/i) || s.match(/\/gdsale\/[^/?#]*-(\d{6,10})\.html/i);
  return m ? "gd:" + m[1].toLowerCase() : null;
}

/** 兩個網址指不指同一件商品：字串全等＝同；都解得出同一個賣場編號＝同；其餘（活動頁、搜尋頁、解不出編號）＝回退字串比對。
 *  給四道比對門共用——別再各自手寫 !==（2026-10-04；同規則多門病史：2026-07-27 價格、2026-09-26 來源紀錄、2026-10-04 連結）。 */
function sameProductUrl(a, b) {
  if (String(a || "").trim() === String(b || "").trim()) return true;
  const ka = productUrlKey(a), kb = productUrlKey(b);
  return !!(ka && kb && ka === kb);
}

/**
 * 連結分型：product（商品頁）／activity（檔期活動頁）／search（搜尋頁）／other（站內其他）／
 * external（非 tw.buy.yahoo.com）／invalid（非 https 或不是網址）。
 * 分型決定存活檢查方式——活動頁連「活的」都回 HTTP 404（前端殼），不能看狀態碼（2026-07-27 實測）。
 */
function classifyLinkTarget(url) {
  let u;
  try { u = new URL(String(url || "")); } catch (e) { return { kind: "invalid" }; }
  if (u.protocol !== "https:") return { kind: "invalid" };
  if (u.hostname !== "tw.buy.yahoo.com") return { kind: "external", host: u.hostname };
  const gdid = gdidOfUrl(u.href);
  if (u.pathname.includes("/gdsale") && gdid) return { kind: "product", gdid };
  if (u.pathname.startsWith("/category/")) return { kind: "search" }; // 分類頁＝商品列表（2026-08-28 使用者新增入口型）：有無結果判活與搜尋同制
  if (u.pathname.startsWith("/openpoint/") || u.pathname.startsWith("/act/") || u.pathname.startsWith("/activity/onsale")) return { kind: "activity", actid: u.searchParams.get("actid") || null, evergreen: true }; // 常設賣場頁（2026-08-28 使用者白名單：onsale 聚合/openpoint/act 頻道）＝無檔期語意、判活走 HTTP＋殼——原「檔期判活」會把常設頁誤殺成過期
  if (u.pathname.includes("/activity/") || u.searchParams.get("actid")) return { kind: "activity", actid: u.searchParams.get("actid") || null };
  if (u.pathname.includes("/search/")) return { kind: "search" };
  return { kind: "other" };
}

/** 搜尋／分類結果頁的商品連結（三型並收；global flag 供計數）。
 *  ① gdsale.asp?gdid=N ② /gdsale/p-N.html ③ /gdsale/<商品名>-N.html
 *  第三型＝2026-09-25 使用者實測新增：分類頁 category/31012821（418KB、56 筆商品）與 category/4436714
 *  的商品連結全走第三型，舊樣式 0 命中 ⇒ 兩頁都被誤判「查無結果」。編號至少 6 碼＝排除
 *  /gdsale/abc-123.html 這種短碼誤認（正反樣本測試＝test/unit/content_checks.test.js）。 */
const SEARCH_PRODUCT_LINK_RE = /\/gdsale\/(?:gdsale\.asp\?gdid=\d+|p-\d+|[^"'\s<>?&]{1,160}-\d{6,}\.html)/g;

/**
 * 搜尋／分類頁存活：Yahoo 查無結果仍回 HTTP 200（2026-07-27 實測），死活看內容。
 * **三態（2026-09-25 使用者裁決）**——認得商品＝online；認不出且非 200＝dead；
 * **200 但認不出商品＝unverified，不是 empty**。
 * 為什麼不再判 empty：上面那張樣式表是「我認得的清單」，清單外的新版型會讓「真的有商品」的頁
 * 被斷言成失效入口，而 empty 是擋發佈的紅燈 ⇒ 使用者貼了正常網址卻被 400 擋死、無路可走
 *（病例＝2026-09-25 category/31012821，手動改連結整條路被封）。認不出就誠實說不確定、不擋，
 * 由使用者點開確認。代價＝真正空的頁面從紅燈降成灰燈（使用者已知並接受）。
 */
function classifySearchLiveness(html, statusCode) {
  const n = (String(html || "").match(SEARCH_PRODUCT_LINK_RE) || []).length;
  if (n > 0) return "online";
  return statusCode === 200 ? "unverified" : "dead";
}

/**
 * 收集頁面上「不在商品清單、但對訪客可見可點」的連結內容：
 * 延伸探索 items＋看更多、編輯精選圓卡、本期活動入口。缺席模組＝空陣列（不誤殺）。
 */
function collectPageLinks(page) {
  const links = [];
  const push = (module, where, label, url, img) => {
    if (!url && !img) return;
    links.push({ module, where, label: String(label || "").slice(0, 40), url: String(url || ""), img: String(img || "") });
  };
  const p = page || {};
  const ex = p.explore || {};
  (ex.items || []).forEach((it, i) => push("explore", `延伸探索 #${i + 1}`, it && it.label, it && it.url, it && it.img));
  if (ex.moreUrl) push("explore", "延伸探索 看更多", ex.ctaText || "看更多", ex.moreUrl, "");
  (((p.editorial || {}).circles) || []).forEach((c, i) => push("editorial", `編輯精選圓卡 #${i + 1}`, c && (c.copy || c.tag), c && c.url, c && c.img));
  (p.promoEntries || []).forEach((e, i) => push("promo", `本期活動 #${i + 1}`, e && (e.chip || e.copy), e && e.url, e && e.img));
  /* 活動資訊卡（2026-09-26，欄位清查 F5）：banner 與每一列的連結是訪客可點的，原本不在這份清單＝貼了下架的活動連結不會被叫。
     banner 沿引擎規則：有任何一張圖自己的連結＝一圖一連結；都沒有＝共用 url。列＝ctaUrl（搶購鈕或整列入口都是它）。 */
  const mc = p.mechanic || {};
  const bn = mc.banner || {};
  const perImg = Array.isArray(bn.urls) && bn.urls.some(Boolean);
  if (perImg) bn.urls.forEach((u, i) => u && push("mechanic", `活動資訊卡 banner 圖 ${i + 1}`, bn.titleLine1 || "banner", u, (bn.imgs || [])[i] || ""));
  else if (bn.url) push("mechanic", "活動資訊卡 banner", bn.titleLine1 || "banner", bn.url, (bn.imgs || []).filter(Boolean)[0] || bn.img || "");
  (mc.rows || []).forEach((r, i) => r && r.ctaUrl && push("mechanic", `活動資訊卡 第 ${i + 1} 列`, r.label || r.offerText || r.rewardText, r.ctaUrl, ""));
  return links;
}

/**
 * 更替重抓＝池內既有品同步整組實抓真值（name/price/marketPrice/disc/url/imgs）。
 * 為何不能只刷 imgs：applySwap 已把實抓價寫進 draft 列（draft==live→商品狀態無 drift、無「套用新價」鈕），
 * 池價不同步＝gate CP-02「現價≠來源」永久 FAIL 且介面上沒有任何動作能解（2026-07-27 DJI 11697562 實證死循環）。
 * 實抓真值信任等級同 apply-live-price 快照同步（皆伺服器自抓、不經客戶端）。
 * @returns {string[]} 變更描述（空陣列＝完全一致、免寫檔）；直接就地修改 exist。
 */
function syncPoolEntry(exist, p) {
  const changed = [];
  if (p.name && exist.name !== p.name) { changed.push(`name「${exist.name}」→「${p.name}」`); exist.name = p.name; }
  if (p.price != null && exist.price !== p.price) { changed.push(`price ${exist.price}→${p.price}`); exist.price = p.price; }
  const nm = p.marketPrice && p.marketPrice > exist.price ? p.marketPrice : null; // 同 productFetch/patchSnapshotPrice：原價必須高於現價才成立
  if ((exist.marketPrice || null) !== nm) { changed.push(`marketPrice ${exist.marketPrice || null}→${nm}`); exist.marketPrice = nm; }
  const nd = nm ? Math.round((exist.price / nm) * 100) : null;
  if ((exist.disc || null) !== nd) { changed.push(`disc ${exist.disc || null}→${nd}`); exist.disc = nd; }
  if (p.url && exist.url !== p.url && !sameProductUrl(exist.url, p.url)) { changed.push("url"); exist.url = p.url; } /* 等價寫法（asp 式↔p- 式）＝不是「變了」：覆寫會汙染池、連帶 gate 字串比對永久紅（2026-10-04 病例 7460184）；等價也不記 changed＝不無謂廢核可 */
  if (Array.isArray(p.imgs) && p.imgs.length && JSON.stringify(exist.imgs || []) !== JSON.stringify(p.imgs)) { changed.push("imgs 圖庫"); exist.imgs = p.imgs; }
  /* 賣場名稱（2026-08-26 店名欄）：跟實抓真值走——新抓有＝同步、新抓沒有＝刪欄（頁面已撤賣場頭＝缺席不留舊值）。
     只同步「池」；draft 列的 store 使用者可事後編修＝以 draft 為準（gate 不比對 store、不會被合規檢查打回）。 */
  const nstore = p.store || null;
  if ((exist.store || null) !== nstore) {
    changed.push(`store ${exist.store || "無"}→${nstore || "無"}`);
    if (nstore) exist.store = nstore; else delete exist.store;
  }
  return changed;
}

/** URL 正規化（同頁去重用；沿 gate.js normalizeUrl 語意的最小版：host 小寫＋去尾斜線＋去 hash）。
 *  商品連結兩式（gdsale.asp?gdid=N 與 /gdsale/p-N.html）視為同一目的地——否則同一商品可用變形繞過
 *  CP-12 同模組唯一守門（2026-07-27 QA #6）。 */
function normalizeLinkUrl(url) {
  const g = gdidOfUrl(url);
  if (g) return "gd:" + g;
  let u;
  try { u = new URL(String(url || "")); } catch (e) { return String(url || "").trim(); }
  return u.hostname.toLowerCase() + u.pathname.replace(/\/$/, "") + (u.search || "");
}

/**
 * Yahoo 軟擋殼頁偵測（2026-07-27 實證：高頻抓取後 /activity 回 HTTP 404＋首頁通用標題
 * 「Yahoo購物中心 - 最懂生活的人」＋無商品無檔期；同一頁 25 分鐘前還是完整在線內容）。
 * 殼頁＝「狀態未能確認」，絕不可判 expired/dead——否則剛驗證過在檔的活動會被誤標已結束。
 */
function isShellPage(evidence) {
  const e = evidence || {};
  return !e.hasProducts && !e.pagePeriod && /最懂生活的人/.test(e.pageTitle || "");
}

/**
 * 從來源頁促銷清單挑「現在在檔」且整頁未用過的活動（探索卡 AI 修復用）。
 * 在檔＝endTs 在未來且（無 startTs 或 startTs 已到）；URL 必須 tw.buy.yahoo.com。
 * @param {Array} promos parseBrandPage().promotions（{actid,title,url,startTs,endTs,…}）
 * @param {Set<string>} usedNorm 整頁已用目的地（normalizeLinkUrl 後）
 * @param {number} nowS epoch 秒
 */
function pickLivePromo(promos, usedNorm, nowS) {
  for (const p of promos || []) {
    if (!p || !p.url || !p.title) continue;
    if (classifyLinkTarget(p.url).kind === "external" || classifyLinkTarget(p.url).kind === "invalid") continue;
    const end = +p.endTs, start = +p.startTs;
    if (!Number.isFinite(end) || end < nowS) continue;
    if (Number.isFinite(start) && start > nowS) continue;
    if (usedNorm && usedNorm.has(normalizeLinkUrl(p.url))) continue;
    return p;
  }
  return null;
}

/**
 * 池 upsert（r3-add 與 pool-rebuild 共用）：既有＝syncPoolEntry 整組同步；不在＝以實抓真值入池
 *（欄位形同 r3-add 慣例：desc 未抓、offer 留空不捏造、source 標記工作台來源）。
 * @returns {{mode:"sync"|"add", changed:string[]}}
 */
function upsertPoolEntry(snap, p, source) {
  snap.products = snap.products || [];
  const exist = snap.products.find((x) => String(x.gdid) === String(p.gdid));
  if (exist) return { mode: "sync", changed: syncPoolEntry(exist, p) };
  snap.products.push({
    gdid: String(p.gdid), name: p.name, desc: [], price: p.price,
    marketPrice: p.marketPrice || null, disc: p.marketPrice ? Math.round((p.price / p.marketPrice) * 100) : null,
    url: p.url, imgs: p.imgs || [], offer: null, actid: null, source: source || "R3:workbench-swap",
    ...(p.store ? { store: p.store } : {}), // 賣場名稱（2026-08-26 店名欄）：實抓有才帶、缺席不留空字串
  });
  return { mode: "add", changed: [] };
}

module.exports = { gdidOfUrl, productUrlKey, sameProductUrl, classifyLinkTarget, classifySearchLiveness, collectPageLinks, syncPoolEntry, upsertPoolEntry, normalizeLinkUrl, pickLivePromo, isShellPage, SEARCH_PRODUCT_LINK_RE };
