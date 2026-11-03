"use strict";
/**
 * lib/aem_probe.js —— 量 AEM 檔案大小的共用零件（2026-09-18 重寫）
 *
 * 白話：AEM 的頁面編輯器只吃得下「網址編碎後 131,072 個字」。這支檔是幾支量尺工具的共用零件——
 * 一份檔多大、畫面本身多大、首屏佔多少，全部從這裡量，所以不同工具量出來的數字一定對得上。
 *
 * 為什麼要有這支檔（2026-09-18 病例）：09-17 量那些數字用的是四支臨時腳本，各自帶一套自己的尺與
 * 自己的 Chrome 啟動參數，放在暫存區、session 一結束就被清掉。數字留在文件上、工具沒了，而且
 * 當時就沒人能保證「臨時腳本的尺」和「產品裡的尺」算出同一個數。這次的做法相反：
 *   ① 尺只有一把＝lib/aem_export.js 的 measureAemBudget（產品在用的那把，這裡 re-export 不另寫）
 *   ② 三裝置的定義只有一份＝本檔 VIEWS（對板閘 aem_verify.js 也讀這裡）
 *   ③「可見 DOM」的定義只有一份＝本檔 VISIBLE_DOM_FN（與對板閘同一段邏輯）
 *
 * 技術備忘（給 Claude）：
 * - 量法＝encodeURIComponent(x).length。中文一字 9、`<>"=/ ` 等一字 3、安全 ASCII 一字 1，整體約 1.46×。
 * - 「可見 DOM」＝真 Chrome 渲染後，去掉 script／style／display:none 的子樹／後台鷹架，剩下的 body。
 *   這是「畫好的畫面本身有多大」的定義，也就是靜態化之後那份 HTML 的下限。
 * - VIEWS 的 touch 欄會開 isMobile/hasTouch：引擎現行的裝置判定看觸控，所以不開就永遠量到桌機版面。
 */
const { measureAemBudget, AEM_ENCODED_CAP } = require("./aem_export");
const crypto = require("crypto");
const path = require("path");

/* 三裝置：與對板閘 aem_verify.js 共用同一份定義（它 require 這裡）。改這裡＝兩邊一起改。 */
const VIEWS = [
  { key: "desktop", width: 1440, height: 1000, touch: false, wantDevice: null },
  { key: "tablet", width: 768, height: 1024, touch: true, wantDevice: "tablet" },
  { key: "mobile", width: 375, height: 812, touch: true, wantDevice: "mobile" },
];

const fileUrl = (p) => "file://" + encodeURI(path.resolve(p));
const fp = (s) => crypto.createHash("sha1").update(String(s)).digest("hex").slice(0, 8);
const pct = (n, of = AEM_ENCODED_CAP) => Math.round((n / of) * 1000) / 10;

/** 量一段字串對 AEM 上限的距離＋佔比（薄包裝，尺仍是產品那把） */
function measure(str) {
  const m = measureAemBudget(String(str));
  return { encoded: m.encoded, bytes: m.bytes, pctOfCap: pct(m.encoded) };
}

/* ── 瘦身後會是多大（2026-10-07 加）─────────────────────────────────────────
   白話：我們自己的尺量的是「瘦身前」，答案永遠是「超標 5～7 倍，要瘦身」——那句話對業務沒有用，
   因為他想知道的是「我這頁瘦完還剩多少空間、還能不能再加商品」。這一段就是回答那個問題。

   怎麼估：可見 DOM（真 Chrome 畫完、圖片外連掉的那一坨）＋ 一個固定的額外量。
   那個額外量＝瘦身後的檔裡，可見 DOM 以外還留著的東西——<head>、剝不掉的樣式、殘留程式。

   這個數字是**對出來的，不是猜的**（2026-10-07，工程師回三檔實測）：
     C layout-002＋自備背景　我們量 116,543 → 他實測 128,303　差 11,760
     A layout-005　　　　　　我們量  77,684 → 推估  90,948　差 13,264（誤差 1.7%）
     B layout-012　　　　　　我們量  80,578 → 推估  97,444　差 16,866（誤差 5.2%）
   三檔的差額接近同一個定值 ⇒ 用**加法**不是乘法。取 C 的 11,760 當基準（唯一一筆他給了編碼後真值的）。

   ⚠ 已知限制，不要當成保證（誠實記錄）：
   ① 只有 C 是真值，A／B 的「實測」是拿他給的 KB × C 推出來的編碼膨脹率 1.586 換算的＝推估對推估。
      已在 2026-10-07 的信裡請他之後把「編碼後字數」直接回拋，拿到就把下面的常數改掉、把這段註解更新。
   ② 這是「main.css 還內嵌」世界的數字。等共用樣式真的外部化，額外量會掉一大截（估 C 從 97.9%→約 89%），
      屆時這個常數必須重新對，不然會系統性高估。
   ③ 估不準的方向刻意選「寧可高估」——money-facing，寧可早一點提醒業務，不要等他貼進 AEM 被擋。 */
const SLIM_OVERHEAD_ENCODED = 11760;
/* 安全邊際：上面三檔的誤差最大 5.2%，取 8% 當緩衝（比最差再寬一點，寧可早出聲）。 */
const SLIM_SAFETY = 1.08;

/** 從「可見 DOM（圖片已外連）的編碼長度」估瘦身後的大小。
 *  回傳 { encoded, pctOfCap, safe, safePctOfCap, fits, verdict }——
 *  encoded＝中位估計（對 C 檔正中真值）、safe＝加了安全邊際的上界。
 *
 *  分級刻意分兩把尺用（2026-10-07 第一版的毛病，當天就改掉）：
 *    ・「偏緊／貼著線」這種**提早出聲**的級別 → 看 safe（寧可早講）
 *    ・「超標」這種**斷言它不會過**的級別 → 只看 encoded（要有把握才敢講）
 *  第一版兩種都看 safe，結果 C 檔（實際 97.9%＝真的過了）被判成「超標 ❌」＝假警報。
 *  這個專案已經有過「會誤報的閘三天內就被當成雜訊自動略過」的病（67 號假閘），
 *  所以寧可少喊一次狼，也不要喊錯——「貼著線」已經足夠讓業務知道不能再加東西了。 */
function estimateSlimmed(visibleDomEncodedExternalized) {
  if (!Number.isFinite(Number(visibleDomEncodedExternalized))) throw new Error("estimateSlimmed 要吃數字（可見 DOM 的編碼長度）——拿到 " + String(visibleDomEncodedExternalized)); /* 審查低-2：NaN 會算出「寬鬆但 fits:false」的自相矛盾、且方向是低估——失敗要出聲 */
  const encoded = Math.round(Number(visibleDomEncodedExternalized) + SLIM_OVERHEAD_ENCODED);
  const safe = Math.round(encoded * SLIM_SAFETY);
  const verdict =
    encoded > AEM_ENCODED_CAP ? "超標" :            /* 中位估計就過不了＝有把握說不會過 */
    safe > AEM_ENCODED_CAP * 0.9 ? "貼著線" :       /* 可能過、可能不過——不要再加東西了 */
    safe > AEM_ENCODED_CAP * 0.75 ? "偏緊" : "寬鬆";
  return { encoded, pctOfCap: pct(encoded), safe, safePctOfCap: pct(safe), fits: encoded <= AEM_ENCODED_CAP, verdict };
}

/* ── 整檔拆桶 ───────────────────────────────────────────────────────────────
   一份匯出檔為什麼那麼大？拆成三桶看：引擎程式、樣式、其餘標記。
   內嵌圖片是「交叉項」——它住在樣式或標記裡面，所以三桶加起來已經含它，
   單獨再列一次是為了回答「把圖片外連出去能省多少」。故四個數字相加會超過 100%，這是對的。 */
const BLOCK_RE = { script: /<script\b[^>]*>[\s\S]*?<\/script>/gi, style: /<style\b[^>]*>[\s\S]*?<\/style>/gi };
const DATA_URI_RE = /data:[a-z0-9.+-]+\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/=]+/gi;

function bucketize(html) {
  const src = String(html);
  const total = measure(src);
  const take = (re) => (src.match(re) || []);
  const scripts = take(BLOCK_RE.script), styles = take(BLOCK_RE.style);
  let rest = src.replace(BLOCK_RE.script, "").replace(BLOCK_RE.style, "");
  const sum = (arr) => arr.reduce((a, s) => a + measure(s).encoded, 0);
  const dataUris = take(DATA_URI_RE);
  const buckets = {
    script: { count: scripts.length, encoded: sum(scripts) },
    style: { count: styles.length, encoded: sum(styles) },
    markup: { count: 1, encoded: measure(rest).encoded },
  };
  for (const k of Object.keys(buckets)) buckets[k].pctOfCap = pct(buckets[k].encoded);
  const inlineImages = { count: dataUris.length, encoded: sum(dataUris), crossCut: true };
  inlineImages.pctOfCap = pct(inlineImages.encoded);
  /* 只把圖片外連出去、其餘不動，還剩多大 */
  const withoutImages = measure(src.replace(DATA_URI_RE, "IMG"));
  return { total, buckets, inlineImages, withoutImages, cap: AEM_ENCODED_CAP, fits: total.encoded <= AEM_ENCODED_CAP };
}

/** 把內嵌圖片（base64）換成一個 AEM 素材庫網址的長度＝靜態化之後那份檔的樣子。
 *  網址樣本取實際規則：<公開網域>/campaign-studio-ai/<活動編號>/<檔名>.webp，約 90 字。 */
const SAMPLE_ASSET_URL = "https://tw.buy.yahoo.com/act/assets/campaign-studio-ai/2026-09-10-wb-171419/bg-0000.webp";
const externalizeImages = (html) => String(html).replace(DATA_URI_RE, SAMPLE_ASSET_URL);

/* ── 可見 DOM ────────────────────────────────────────────────────────────────
   與對板閘同一段邏輯：先在活體標記 display:none，再複製、把標記過的與 script/style/後台鷹架拿掉。
   （複製出來的節點沒有 computed style，所以順序不能顛倒——這是 aem_verify 早就踩過的。） */
const EDITOR_SCAFFOLD = ["#exp-panel", "#preview-watermark", "#draft-badge", "#draft-drop-overlay", "#device-preview-overlay", "#selftest-results"];

/** 在頁面內執行，回傳可見 DOM 的字串與每個頂層區塊的大小。傳給 page.evaluate 用。 */
function visibleDomSnapshot(scaffold) {
  const mark = "data-aemp-hidden";
  document.body.querySelectorAll("*").forEach((e) => { if (getComputedStyle(e).display === "none") e.setAttribute(mark, "1"); });
  const clone = document.body.cloneNode(true);
  document.body.querySelectorAll("[" + mark + "]").forEach((e) => e.removeAttribute(mark));
  clone.querySelectorAll("[" + mark + "]").forEach((n) => n.remove());
  clone.querySelectorAll("script,style").forEach((n) => n.remove());
  scaffold.forEach((s) => clone.querySelectorAll(s).forEach((n) => n.remove()));
  const sections = [...clone.children].map((el) => ({
    tag: el.tagName.toLowerCase(),
    id: el.id || null,
    module: el.getAttribute ? el.getAttribute("data-ga-module") : null,
    html: el.outerHTML,
  }));
  /* 有意義的量測單位，**互不重疊**（09-18 第一版兩個錯：①只看 body 直接子層＝首屏漏掉、誤報三裝置同一份
     ②站頭同時被算成模組與殼層、首屏又被外層模組包一次＝加起來超過整頁）。
     切法：站頭／頁尾／浮動導覽按 id 認；其餘按 data-ga-module 認；已被前面認走的節點的子孫不再認一次。
       hero＝首屏那個模組　module＝其餘內容模組（樓層／商品牆／編輯精選⋯）　shell＝自帶站頭頁尾　nav＝浮動導覽 */
  const taken = [];
  const inside = (el) => taken.some((t) => t === el || t.contains(el)); /* 自己已被認走也算（第一版漏了 t === el，站頭被認兩次） */
  const unit = (el, kind) => {
    if (inside(el)) return null;
    taken.push(el);
    return { kind, id: el.id || null, tag: el.tagName.toLowerCase(), module: el.getAttribute("data-ga-module") || null, html: el.outerHTML };
  };
  const units = [];
  for (const sel of ["header#sec-uh", "footer#sec-footer"]) clone.querySelectorAll(sel).forEach((el) => { const u = unit(el, "shell"); if (u) units.push(u); });
  clone.querySelectorAll("nav#sec-anchornav-floating").forEach((el) => { const u = unit(el, "nav"); if (u) units.push(u); });
  clone.querySelectorAll('[data-ga-module="hero"]').forEach((el) => { const u = unit(el, "hero"); if (u) units.push(u); });
  clone.querySelectorAll("[data-ga-module]").forEach((el) => { const u = unit(el, "module"); if (u) units.push(u); });
  /* 舞台＝首屏模組裡「每個裝置長不一樣」的那一塊（巢狀在 hero 模組內，不進 units 分區，單獨回傳避免重複計算） */
  const stages = [...clone.querySelectorAll('[id^="hv2-l"]')].map((el) => ({ id: el.id, html: el.outerHTML }));
  return {
    stages,
    device: document.documentElement.getAttribute("data-device") || "(無)",
    layout: document.body.getAttribute("data-layout") || "(無)",
    html: clone.innerHTML,
    sections,
    units,
  };
}

/* ── Chrome harness（量測用，與對板閘的 render 不同用途：閘要擋外連、量尺允許選擇）──
   共用一份，避免每支量尺各帶一套啟動參數——那正是 09-17 那四支臨時腳本量出來的數字
   無法保證與產品端一致的原因。lazy require：不跑 Chrome 的工具（如拆桶）不必載 playwright。 */
async function withMeasuredPages(htmlPath, { views = VIEWS, blockExternal = true, settleMs = 1500 } = {}, fn) {
  const { chromium } = require("playwright-core");
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const self = fileUrl(htmlPath);
  const out = [];
  try {
    for (const v of views) {
      const ctx = await browser.newContext({ viewport: { width: v.width, height: v.height }, isMobile: v.touch, hasTouch: v.touch, deviceScaleFactor: 1 });
      const page = await ctx.newPage();
      const errs = [];
      page.on("pageerror", (e) => errs.push(String(e).slice(0, 200)));
      if (blockExternal) {
        /* 外連一律擋成 1×1 透明圖，不要 abort：abort 會讓 Chrome 畫破圖圖示，而破圖出現的時機
           會隨頁上多一條 <link> 漂移（09-17 實際踩到，012 手機差 1742px）。 */
        const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8AAAwAB/AF/pOgVAAAAAElFTkSuQmCC", "base64");
        await page.route("**/*", (route) => {
          const u = route.request().url();
          if (u === self || u.startsWith(self + "?") || u.startsWith(self + "#")) return route.continue();
          if (/^https?:/.test(u)) return route.fulfill({ status: 200, contentType: "image/png", body: png });
          return route.fulfill({ status: 200, contentType: "image/png", body: png });
        });
      }
      await page.addInitScript(() => { window.setInterval = function () { return 0; }; });
      await page.goto(self, { waitUntil: "load", timeout: 60000 });
      await page.waitForFunction(() => document.body.classList.contains("shell-v2") && !!document.body.getAttribute("data-layout"), null, { timeout: 30000 }).catch(() => {});
      await page.waitForTimeout(settleMs);
      await page.evaluate(async () => { for (let y = 0; y < document.body.scrollHeight; y += 600) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 30)); } window.scrollTo(0, 0); });
      await page.waitForTimeout(500);
      out.push({ view: v, result: await fn(page, v), jsErrors: errs });
      await ctx.close();
    }
  } finally { await browser.close(); }
  return out;
}

module.exports = { VIEWS, fileUrl, fp, pct, measure, bucketize, externalizeImages, SAMPLE_ASSET_URL, visibleDomSnapshot, withMeasuredPages, EDITOR_SCAFFOLD, AEM_ENCODED_CAP, measureAemBudget, estimateSlimmed, SLIM_OVERHEAD_ENCODED, SLIM_SAFETY };
