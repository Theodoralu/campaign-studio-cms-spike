"use strict";
/**
 * lib/aem_shared_css.js —— AEM 共用樣式 main.css 切割器（story aem-static-export.md 工項 #2；2026-09-17 使用者裁「從引擎切一份 main.css 給工程師」提前做）
 *
 * 白話：AEM 頁面編輯器只吃得下編碼後 131,072 字的 HTML，樣式必須外連。工程師的瘦身工具是「只抽幾頁都一樣的樣式」，
 * 餵 12 頁會把各款版型自己的樣式判成每頁的、留在 HTML 裡（011 直接爆）。本檔改成從引擎那唯一一份 CSS 直接切：
 *   進 main.css＝色彩變數（design-tokens/tokens.css）＋殼層＋模組＋三裝置覆寫（data-device）＋12 款版型全部
 *   不進＝後台編輯面板專用樣式（剝掉）、字風（每頁只帶自己那一款，含外部字型 @import）、匯出器注入的開機遮罩
 *   素材＝main.css 裡 url("assets/…") 的背景圖：預設相對路徑（與 main.css 同資料夾）；給 AEM 素材庫時改寫成正式網址（見 AEM_ASSET_PUBLIC_BASE）
 * 版本＝CSS 內容雜湊（**素材路徑改寫前**，同一份 CSS 不論素材放哪都是同一個版本）；檔頭印來源、剝除數、素材位置；機器產出勿手改。
 * 純函式：不碰檔案；I/O 在 tools/build_aem_shared_css.js。
 *
 * 機器證明（失敗要出聲）：extractBody 內建「12 款舞台每款至少一條規則」與「面板樣式不得殘留」兩道紅燈；
 * coverageCheck 對每一份瘦身匯出檔逐條證明「頁上模板來源的每一條樣式規則都在 main.css 裡」。像素層的重畫對板與素材上線確認在 CLI。
 */
const crypto = require("crypto");
const A = require("./aem_export");

/* ───────── AEM 素材庫（AEM 工程窗口 2026-09-17 答覆 Q4）─────────
   上傳介面＝AEM_DAM_UPLOAD_URL 底下建資料夾（他的規則：每頁一個資料夾）；上傳完要「發佈」；發佈後的正式網址＝AEM_ASSET_PUBLIC_BASE + 資料夾 + 檔名。
   共用樣式跨頁共用＝放 shared/<版本>/（一個資料夾、扁平放 main.css＋它的背景圖，AEM 介面一次多選上傳）。 */
const AEM_DAM_UPLOAD_URL = "https://aem.ec.yahoo.com/assets.html/content/dam/yahoo/campaign-studio-ai/";
const AEM_ASSET_PUBLIC_BASE = "https://tw.buy.yahoo.com/act/assets/campaign-studio-ai/";
const sharedFolder = (version) => `shared/${version}/`;

/* ───────── 後台專用選擇器（名單來源＝2026-09-17 對引擎 CSS 全掃 59 條疑似後台選擇器逐條判） ─────────
   只在「選擇器主體」判，:not(...) 裡提到的不算——例：body.cc-title .hv2-l011 .l11-title:not(.hero-font-preview) 是真規則、要留。 */
const EDITOR_PART = /(#exp-panel|#ep-[\w-]+|\.ep-[\w-]+|#preview-watermark|#bg-license-watermark|#draft-badge|#draft-drop-overlay|#draft-url-error|html\.draft-boot|html\.colortool-boot|html\.aem-boot|#device-preview-overlay|#dp-frame|\.dp-[\w-]+|#selftest-results|body\.selftest|\.hero-font-preview)(?![\w-])/;
const stripNot = (sel) => sel.replace(/:not\([^()]*\)/g, "");
function isEditorOnly(part) { return EDITOR_PART.test(stripNot(String(part))); }
const editorKeeper = A.selectorListKeeper((part) => !isEditorOnly(part));

/** 模板裡的 <style> 逐塊取出（含 id、剝註解），**照文件順序**，並在 <link id="tokensV2"> 的位置放一個 tokens 佔位——
 *  順序就是層疊（cascade）：模板裡 tokens.css 是在引擎樣式之後載入的，main.css 必須照同一個順序排，同名同權重的規則才會是同一個贏。
 *  只有開機遮罩的小塊（colortool-boot／draft-boot）＝後台開機用，整塊不進。 */
function templateStyleBlocks(templateHtml) {
  const html = String(templateHtml);
  const out = [];
  for (const m of html.matchAll(/<style([^>]*)>([\s\S]*?)<\/style>/g)) {
    const id = (m[1].match(/\bid="([^"]+)"/) || [])[1] || null;
    const css = A.stripCss(m[2]);
    const bootOnly = /^html\.(colortool|draft|aem)-boot/.test(css) && css.length < 1000;
    out.push({ at: m.index, id, css, bootOnly });
  }
  const link = html.match(/<link[^>]*\bid="tokensV2"[^>]*>/);
  out.push({ at: link ? link.index : -1, id: "tokensV2", tokens: true }); // 找不到 link＝放最前（-1）
  return out.sort((a, b) => a.at - b.at);
}
function countLeaves(nodes) { let n = 0; for (const nd of nodes) { if (nd.children) n += countLeaves(nd.children); else n++; } return n; }
const norm = (s) => String(s).replace(/\s+/g, " ").trim();

/* ───────── 素材引用：main.css 裡的相對路徑 url()（外連 https／內嵌 data／SVG 片段 #／%23／樣板 ${ 不算） ───────── */
const ASSET_URL_RE = /url\(\s*(["']?)((?!https?:|data:|#|%23|\$\{)[^"')]+)\1\s*\)/g;
function assetRefs(css) { return [...new Set([...String(css).matchAll(ASSET_URL_RE)].map((m) => m[2]))]; }
/** 把每個相對路徑引用換成 mapFn(ref) 回傳的字串（回原值＝不動）。 */
function rewriteAssetUrls(css, mapFn) { return String(css).replace(ASSET_URL_RE, (all, q, ref) => { const to = mapFn(ref); return to === ref ? all : `url("${to}")`; }); }

/** 第一步：從模板＋tokens 切出本體（未加檔頭、素材路徑未改） */
function extractBody({ templateHtml, tokensCss }) {
  if (!/<style/.test(String(templateHtml || ""))) throw new Error("模板沒有 <style>（錨點漂移）");
  if (!tokensCss || !/--[\w-]+\s*:/.test(tokensCss)) throw new Error("tokens.css 空或不含變數");
  const skeletons = A.stageSkeletons(templateHtml);
  if (!Object.keys(skeletons).length) throw new Error("模板讀不到任何舞台（stageSkeletons 空）");

  const report = { blocks: [], editorRulesDropped: 0, rules: 0, layouts: {}, warnings: [] };
  const parts = [];
  for (const b of templateStyleBlocks(templateHtml)) {
    if (b.tokens) { parts.push(A.stripCss(tokensCss)); report.blocks.push({ id: "tokensV2", source: "design-tokens/tokens.css" }); continue; }
    if (b.bootOnly) { report.blocks.push({ id: b.id, skipped: "後台開機遮罩" }); continue; }
    const before = countLeaves(A.parseCssRules(b.css));
    const css = A.filterCss(b.css, editorKeeper);
    const after = countLeaves(A.parseCssRules(css));
    report.blocks.push({ id: b.id, rulesBefore: before, rulesAfter: after });
    report.editorRulesDropped += before - after; report.rules += after;
    parts.push(css);
  }
  const body = parts.join("\n");
  for (const layout of Object.keys(skeletons)) {
    const n = (body.match(new RegExp(`\\.hv2-l${layout.slice(-3)}(?![\\w-])`, "g")) || []).length;
    report.layouts[layout] = n;
    if (!n) throw new Error(`${layout} 在 main.css 找不到任何 .hv2-l 規則（版型樣式漏切＝那款頁面會裸奔）`);
  }
  if (/(^|[\s,}])(#exp-panel|\.ep-opt|#selftest-results)\s*\{/m.test(body)) throw new Error("後台面板樣式仍在 main.css（剝除失敗）");
  return { body, report, skeletons };
}

/** 版本＝日期＋CSS 內容雜湊（素材路徑改寫前）。日期只是「首次切出那天」的註記，認的是後面那八碼 */
function versionOf(body, date = new Date()) { return `v${new Date(date).toISOString().slice(0, 10)}-${crypto.createHash("sha1").update(body).digest("hex").slice(0, 8)}`; }

/** 從版本字串取內容雜湊那八碼；不合格式回 null */
function versionHash(version) { const m = /-([0-9a-f]{8})$/.exec(String(version || "")); return m ? m[1] : null; }

/** 正式網址該回什麼型別：副檔名 → 允許的 content-type */
const LIVE_TYPES = { css: ["text/css"], webp: ["image/webp"], png: ["image/png"], jpg: ["image/jpeg"], jpeg: ["image/jpeg"], gif: ["image/gif"], svg: ["image/svg+xml"] };

/** 判一個正式網址算不算真的上線了。
 *  只看狀態碼會被騙：有些要登入的位址會回 200 加一整頁登入表單——狀態是綠的、內容是登入畫面，
 *  程式抓圖抓回一頁 HTML 也不會有人報錯。所以型別與大小都要對得上。 */
function judgeLive({ url = "", status, contentType = "", contentLength = null, expectedBytes = null }) {
  const ext = String(url).split("?")[0].split("#")[0].split(".").pop().toLowerCase();
  const want = LIVE_TYPES[ext] || null;
  const type = String(contentType || "").split(";")[0].trim().toLowerCase();
  if (status !== 200) {
    return { ok: false, why: `HTTP ${status}`, hint: status >= 300 && status < 400 ? "被轉走了——多半是那個位址要登入" : "還沒上傳，或上傳了沒按發佈，或資料夾名不對" };
  }
  if (type === "text/html" && ext !== "html" && ext !== "htm") {
    return { ok: false, why: "200 但回的是一頁 HTML", hint: "這就是登入畫面的樣子：狀態綠、內容是登入頁。這個位址不能給程式抓" };
  }
  if (want && type && !want.includes(type)) {
    return { ok: false, why: `型別不對（回 ${type}，該是 ${want.join("／")}）`, hint: "檔案可能被轉檔、或放錯位置" };
  }
  if (expectedBytes != null && contentLength != null && Number(contentLength) !== Number(expectedBytes)) {
    return { ok: false, why: `大小不同（線上 ${contentLength}、本機 ${expectedBytes}）`, hint: "AEM 可能自己重新壓過，或上傳到一半斷了——重新壓過就代表畫面跟我們證明過的那份不一樣了" };
  }
  return { ok: true };
}

/** 版本＝內容：從既有版本號裡挑出「同一份內容」的那個沿用（日期最早者優先），沒有就用今天算的。
 *  不沿用的後果＝同一份 CSS 隔天重產換一個名字，AEM 上出現兩份一樣的東西、各頁 HTML 掛到哪一份靠運氣。 */
function reuseVersion(computed, candidates = []) {
  const wanted = versionHash(computed);
  const same = candidates.filter((v) => versionHash(v) === wanted).sort();
  return same[0] || computed;
}

/** 第二步：算版本 → 改寫素材路徑（assetUrl(ref, version)→新路徑；預設不動）→ 加檔頭
 *  version＝沿用既有版本號（內容沒變時；見 tools/build_aem_shared_css.js pickVersion）。
 *  雜湊不符就丟錯：版本號永遠跟著內容，不接受外面硬塞一個名字。 */
function finalizeCss({ body, report, skeletons, date = new Date(), version: reuse = null, assetUrl = (r) => r, assetBase = "" }) {
  const computed = versionOf(body, date);
  if (reuse && versionHash(reuse) !== versionHash(computed)) {
    throw new Error(`沿用版本 ${reuse} 與這份內容的雜湊不符（內容算出 ${computed}）——版本必須跟著內容`);
  }
  const version = reuse || computed;
  const out = rewriteAssetUrls(body, (r) => assetUrl(r, version));
  const header = `/* Campaign Studio main.css ${version}
   AEM 共用樣式：色彩變數＋殼層＋模組＋三裝置覆寫＋${Object.keys(skeletons).length} 款版型全部。
   來源＝引擎 FrameTest 模板 <style>×${report.blocks.filter((x) => !x.skipped && !x.source).length}＋design-tokens/tokens.css（照模板載入順序排）；後台面板樣式已剝 ${report.editorRulesDropped} 條。
   素材位置＝${assetBase || "與 main.css 同資料夾（相對路徑，以樣式檔位置為準）"}。
   機器產出（pipeline tools/build_aem_shared_css.js）勿手改。每頁 HTML 另帶：自己那一款字風 <style id="typestylesV2">、Google Fonts <link>、主題與版型的 class／data-* 屬性。 */
`;
  const css = header + out;
  const rep = { ...report, version, assetBase: assetBase || null, bytes: Buffer.byteLength(css), encoded: encodeURIComponent(css).length, assets: assetRefs(out) };
  return { css, version, report: rep };
}

/** 一步到位 */
function buildMainCss({ templateHtml, tokensCss, date = new Date(), version = null, assetUrl, assetBase }) {
  const ex = extractBody({ templateHtml, tokensCss });
  return finalizeCss({ ...ex, date, version, assetUrl, assetBase });
}

/** 覆蓋證明：一頁瘦身匯出檔裡「模板來源」的樣式規則，每一條都要在 main.css（字風塊、後台專用段、匯出器注入的遮罩除外）。
 *  比法＝同一個 at-rule 鏈＋同一個宣告本體下，頁上的每個選擇器段都要出現在 main.css 的選擇器清單裡（頁上的清單可能被版型取捨剪過＝子集合法）。
 *  宣告本體裡的 url(...) 一律視為同值（頁上是內嵌 data:、main.css 是相對路徑或正式網址，素材本身另由 CLI 的重畫證明對像素）。 */
const normBody = (s) => norm(s).replace(/url\(\s*["']?[^"')]*["']?\s*\)/g, "url(*)");
function coverageCheck(mainCss, pageHtml) {
  const index = new Map();
  const walk = (nodes, chain, sink) => { for (const nd of nodes) { if (nd.children) { walk(nd.children, chain + norm(nd.prelude) + ">", sink); continue; } if (nd.flat) continue; sink(chain, nd); } };
  walk(A.parseCssRules(mainCss), "", (chain, nd) => {
    const key = chain + "|" + normBody(nd.body); let set = index.get(key); if (!set) index.set(key, (set = new Set()));
    for (const p of A.splitSelectorList(nd.prelude)) set.add(norm(p));
  });
  const missing = []; let total = 0, styleBlocks = 0, skippedEditor = 0;
  for (const m of String(pageHtml).matchAll(/<style([^>]*)>([\s\S]*?)<\/style>/g)) {
    const id = (m[1].match(/\bid="([^"]+)"/) || [])[1] || null;
    if (id === "typestylesV2") continue; // 字風＝每頁自帶
    styleBlocks++;
    walk(A.parseCssRules(A.stripCss(m[2])), "", (chain, nd) => {
      const key = chain + "|" + normBody(nd.body); const set = index.get(key);
      const parts = A.splitSelectorList(nd.prelude).map(norm);
      const live = parts.filter((p) => !isEditorOnly(p)); skippedEditor += parts.length - live.length;
      if (!live.length) return;
      total++;
      const bad = live.filter((p) => !(set && set.has(p)));
      if (bad.length) missing.push({ chain, prelude: bad.join(","), body: nd.body.slice(0, 80) });
    });
  }
  return { total, styleBlocks, skippedEditor, missing, ok: missing.length === 0 };
}

module.exports = { AEM_DAM_UPLOAD_URL, AEM_ASSET_PUBLIC_BASE, sharedFolder, EDITOR_PART, isEditorOnly, templateStyleBlocks, ASSET_URL_RE, assetRefs, rewriteAssetUrls, extractBody, versionOf, versionHash, reuseVersion, LIVE_TYPES, judgeLive, finalizeCss, buildMainCss, coverageCheck };
