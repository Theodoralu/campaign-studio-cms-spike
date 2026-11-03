"use strict";
/**
 * AEM 共用樣式 main.css 切割器（lib/aem_shared_css.js；2026-09-17）
 * 白話：從引擎那一份 CSS 切出給 AEM 素材庫的共用樣式——後台面板樣式要剝乾淨、12 款版型一款都不能漏、字風不進；
 * 素材路徵要能列出來、改寫成外連；覆蓋證明要能對一頁瘦身匯出檔逐條說「每條都在」。
 */
const { test } = require("node:test");
const assert = require("node:assert");
const S = require("../../lib/aem_shared_css");

const TPL = `<html><head>
<style>html.colortool-boot body{visibility:hidden}</style>
<style>/* 鐵律 */:root{--color-surface:#fff}
.pcard{x:1}
.pcard,.ep-opt{y:2}
#exp-panel{z:3}
body.cc-title .hv2-l011 .l11-title:not(.hero-font-preview){w:4}
.hv2-l001 .hero-font-preview{v:5}
.hv2-l001{background:#F2F2F2 url("assets/hero-bg/bg-009.png") center/cover}
@media (max-width:768px){.ep-row .ep-label{a:1}.hv2-l001 .t{b:2}}
@media print{#selftest-results{c:1}}
</style>
<style id="device-preview-css">html[data-device="tablet"] .hv2-l002 .u{c:3}
html[data-device] #exp-panel{display:none}</style>
<link id="tokensV2" rel="stylesheet" disabled>
<style>html.draft-boot body>:not(#draft-url-error){visibility:hidden}</style>
</head><body>
<div class="hv2-stage hv2-l001 hv2-s10w" id="hv2-l001"></div>
<div class="hv2-stage hv2-l002 hv2-s10w" id="hv2-l002"></div>
<div class="hv2-stage hv2-l011 hv2-s12" id="hv2-l011"></div>
</body></html>`;
const TOKENS = `/* tokens */\n:root{--brand:#f00;--ink:#111}`;

test("isEditorOnly：後台面板／預覽／自測／開機遮罩選擇器＝true；:not() 裡提到的不算；一般版型與模組＝false", () => {
  for (const s of ["#exp-panel .ep-body", ".ep-opt.on", "html[data-device] #exp-panel", "#bg-license-watermark", "details.ep-adv summary::before", ".dp-toolbar .dp-note", "body.selftest #selftest-results", "html.draft-boot body::after", ".hv2-l001 .hero-font-preview"]) assert.strictEqual(S.isEditorOnly(s), true, s);
  for (const s of [".pcard", "body.cc-title .hv2-l011 .l11-title:not(.hero-font-preview)", ":is([data-campaign-theme],.cc-on) .hv2-l009 .ttl", "html[data-device=\"tablet\"] .hv2-l002 .u", ".epic-title", ".deposit"]) assert.strictEqual(S.isEditorOnly(s), false, s);
});

test("buildMainCss：tokens 進、後台規則剝（整條與清單裡的那一段）、@media 內的後台規則剝但容器留、字風不在、版本＝日期＋雜湊且可重現", () => {
  const d = new Date("2026-09-17T03:00:00Z");
  const r1 = S.buildMainCss({ templateHtml: TPL, tokensCss: TOKENS, date: d });
  const css = r1.css;
  assert.match(css, /^\/\* Campaign Studio main\.css v2026-09-17-[0-9a-f]{8}/);
  assert.ok(css.includes(":root{--brand:#f00;--ink:#111}"), "tokens 要在");
  assert.ok(css.indexOf(":root{--brand:#f00") > css.indexOf('html[data-device="tablet"] .hv2-l002 .u{c:3}'), "tokens 要照模板載入順序排在引擎樣式與裝置覆寫之後（層疊順序一致）");
  assert.ok(!css.includes("draft-boot"), "draft-boot 開機遮罩不進");
  assert.ok(css.includes(".pcard{x:1}"), "共用規則要在");
  assert.ok(css.includes(".pcard{y:2}") && !css.includes(".ep-opt"), "清單裡的後台段要剪掉、共用段留");
  assert.ok(!css.includes("#exp-panel"), "整條後台規則要剝");
  assert.ok(css.includes("body.cc-title .hv2-l011 .l11-title:not(.hero-font-preview){w:4}"), ":not() 裡提到後台字樣的真規則要留");
  assert.ok(!css.includes(".hv2-l001 .hero-font-preview"), "字型預覽態＝後台、剝");
  assert.ok(css.includes("@media (max-width:768px){.hv2-l001 .t{b:2}}"), "@media 內只剝後台那條、容器留");
  assert.ok(!css.includes("@media print"), "@media 內全是後台＝整塊丟");
  assert.ok(css.includes('html[data-device="tablet"] .hv2-l002 .u{c:3}') && !css.includes("html[data-device] #exp-panel"), "裝置覆寫留、其中的後台條剝");
  assert.ok(!css.includes("colortool-boot"), "開機遮罩小塊不進");
  assert.deepStrictEqual(r1.report.layouts, { "layout-001": 2, "layout-002": 1, "layout-011": 1 }); // 001＝背景那條＋@media 那條（.hero-font-preview 那條已剝、不算）
  assert.strictEqual(r1.report.editorRulesDropped, 5); // #exp-panel／.hv2-l001 .hero-font-preview／@media 內 .ep-row .ep-label／@media print 內 #selftest-results／裝置塊 html[data-device] #exp-panel（.pcard,.ep-opt 只剪段、不算整條）
  assert.deepStrictEqual(r1.report.assets, ["assets/hero-bg/bg-009.png"]);
  const r2 = S.buildMainCss({ templateHtml: TPL, tokensCss: TOKENS, date: d });
  assert.strictEqual(r1.version, r2.version, "同源同日＝同版本");
});

test("素材路徵：assetRefs 只列相對路徵（外連／data／#／%23／樣板不算）；rewriteAssetUrls 改寫＝版本跟著變", () => {
  const css = `.a{background:url("assets/x.png")}.b{background:url(assets/y.webp)}.c{background:url('https://img.yec.tw/z.jpg')}.d{mask:url(#p)}.e{fill:url(%23p)}.f{background:url("data:image/webp;base64,AAAA")}`;
  assert.deepStrictEqual(S.assetRefs(css), ["assets/x.png", "assets/y.webp"]);
  const out = S.rewriteAssetUrls(css, (r) => (r.endsWith(".png") ? "https://dam/" + r.replace(".png", ".webp") : r));
  assert.ok(out.includes('url("https://dam/assets/x.webp")') && out.includes("url(assets/y.webp)") && out.includes("url(#p)") && out.includes("url(%23p)"), out);
  const d = new Date("2026-09-17T03:00:00Z");
  const plain = S.buildMainCss({ templateHtml: TPL, tokensCss: TOKENS, date: d });
  const based = S.buildMainCss({ templateHtml: TPL, tokensCss: TOKENS, date: d, assetUrl: (r, v) => S.AEM_ASSET_PUBLIC_BASE + S.sharedFolder(v) + r.split("/").pop().replace(/\.png$/, ".webp"), assetBase: "https://dam/x/" });
  assert.strictEqual(plain.version, based.version, "版本＝CSS 內容雜湊（素材路徵改寫前）：同一份 CSS 不論素材放哪都是同一個版本");
  assert.ok(based.css.includes(`url("https://tw.buy.yahoo.com/act/assets/campaign-studio-ai/shared/${based.version}/bg-009.webp")`), "正式網址＝公開網址＋shared/<版本>/＋扁平檔名");
  assert.ok(based.css.includes("素材位置＝https://dam/x/") && plain.css.includes("素材位置＝與 main.css 同資料夾"), "檔頭要講素材放哪");
  assert.deepStrictEqual(based.report.assets, [], "改成外連後不再算相對素材");
  assert.strictEqual(S.sharedFolder("v2026-09-17-abcd1234"), "shared/v2026-09-17-abcd1234/");
  assert.ok(/^https:\/\/tw\.buy\.yahoo\.com\/act\/assets\/campaign-studio-ai\/$/.test(S.AEM_ASSET_PUBLIC_BASE) && /^https:\/\/aem\.ec\.yahoo\.com\/assets\.html\/content\/dam\/yahoo\/campaign-studio-ai\/$/.test(S.AEM_DAM_UPLOAD_URL), "AEM 兩個位址（工程窗口 2026-09-17 答覆）以斜線結尾");
});

test("buildMainCss：模板無 <style>／tokens 空／某款舞台在 CSS 裡零規則＝throw（失敗要出聲）", () => {
  assert.throws(() => S.buildMainCss({ templateHtml: "<html><body></body></html>", tokensCss: TOKENS }), /沒有 <style>/);
  assert.throws(() => S.buildMainCss({ templateHtml: TPL, tokensCss: "/* nothing */" }), /tokens\.css/);
  const tplMissing = TPL + '<div class="hv2-stage hv2-l012 hv2-s12" id="hv2-l012"></div>';
  assert.throws(() => S.buildMainCss({ templateHtml: tplMissing, tokensCss: TOKENS }), /layout-012 .*找不到/);
});

test("coverageCheck：頁上模板來源的規則逐條都在＝ok；字風塊略過、後台專用段略過、url() 內嵌 vs 相對路徵視為同值；外來規則或本體不同＝缺", () => {
  const { css } = S.buildMainCss({ templateHtml: TPL, tokensCss: TOKENS });
  const page = `<html><head>
<style>html.aem-boot body>*{visibility:hidden}</style>
<style id="tokensV2">:root{--brand:#f00;--ink:#111}</style>
<style>.pcard{x:1}
.pcard{y:2}
#exp-panel{z:3}
.hv2-l001{background:#F2F2F2 url("data:image/webp;base64,UklGRjwkAAB") center/cover}
@media (max-width:768px){.hv2-l001 .t{b:2}}</style>
<style id="typestylesV2">@import url("https://fonts.googleapis.com/css2?family=X");.css-n1{q:1}</style>
<style>#exp-panel,#preview-watermark{display:none!important}</style>
</head><body></body></html>`;
  const r = S.coverageCheck(css, page);
  assert.strictEqual(r.ok, true, JSON.stringify(r.missing));
  assert.strictEqual(r.total, 5); // :root／.pcard x／.pcard y／.hv2-l001 背景／@media 內 .hv2-l001 .t
  assert.strictEqual(r.skippedEditor, 4); // html.aem-boot／#exp-panel／#exp-panel,#preview-watermark（2 段）
  const bad = S.coverageCheck(css, page.replace(".pcard{x:1}", ".pcard{x:1}.foreign{k:1}"));
  assert.strictEqual(bad.ok, false); assert.strictEqual(bad.missing.length, 1); assert.strictEqual(bad.missing[0].prelude, ".foreign");
  const badBody = S.coverageCheck(css, page.replace(".pcard{x:1}", ".pcard{x:9}"));
  assert.strictEqual(badBody.ok, false, "同選擇器但宣告本體不同＝缺（不能拿舊版 main.css 配新版頁）");
});

test("版本＝內容：同一份 CSS 隔天重產不換名字（沿用原版本號），塞不符雜湊的版本要丟錯", () => {
  const d17 = new Date("2026-09-17T03:00:00Z");
  const d18 = new Date("2026-09-18T03:00:00Z");
  const v17 = S.buildMainCss({ templateHtml: TPL, tokensCss: TOKENS, date: d17 }).version;
  const v18 = S.buildMainCss({ templateHtml: TPL, tokensCss: TOKENS, date: d18 }).version;

  // 病例本體：只是換了一天，同一份內容就長出第二個名字
  assert.notStrictEqual(v17, v18, "（前提）日期段會跟著當天變");
  assert.strictEqual(S.versionHash(v17), S.versionHash(v18), "內容沒變＝雜湊那八碼必須一樣");

  // 沿用：日期最早的同雜湊版本勝出
  assert.strictEqual(S.reuseVersion(v18, [v18, v17]), v17, "同雜湊要沿用日期最早那個");
  assert.strictEqual(S.reuseVersion(v18, []), v18, "沒有舊版本就用今天算的");
  assert.strictEqual(S.reuseVersion(v18, ["v2026-01-01-deadbeef"]), v18, "雜湊不同的舊版本不能沿用");
  assert.strictEqual(S.reuseVersion(v18, ["main.css", "", null]), v18, "格式不對的候選一律忽略");

  // 從最外層打到底：帶著沿用的版本號重產，版本與素材網址都停在原版本
  const reused = S.buildMainCss({
    templateHtml: TPL, tokensCss: TOKENS, date: d18, version: v17,
    assetUrl: (r, v) => S.AEM_ASSET_PUBLIC_BASE + S.sharedFolder(v) + r.split("/").pop(),
    assetBase: S.AEM_ASSET_PUBLIC_BASE + S.sharedFolder(v17),
  });
  assert.strictEqual(reused.version, v17, "沿用版本要真的生效");
  assert.ok(reused.css.includes(`/* Campaign Studio main.css ${v17}`), "檔頭印沿用的版本");
  assert.ok(reused.css.includes(S.sharedFolder(v17) + "bg-009.png"), "素材網址要指向沿用的那個資料夾");
  assert.ok(!reused.css.includes(S.sharedFolder(v18)), "不能同時出現今天算出的版本路徑");

  // 守門：版本號永遠跟著內容，不接受外面硬塞一個名字
  assert.throws(() => S.buildMainCss({ templateHtml: TPL, tokensCss: TOKENS, date: d18, version: "v2026-09-01-deadbeef" }), /雜湊不符/);
});

test("versionHash：只認結尾那八碼十六進位，其餘回 null", () => {
  assert.strictEqual(S.versionHash("v2026-09-17-8f254386"), "8f254386");
  for (const bad of ["v2026-09-17-8F254386", "v2026-09-17-8f25438", "8f254386", "", null, undefined]) assert.strictEqual(S.versionHash(bad), null, String(bad));
});

test("judgeLive：只看狀態碼會被「回 200 加一頁登入表單」騙——型別與大小都要對", () => {
  const css = "https://tw.buy.yahoo.com/act/assets/campaign-studio-ai/shared/v1-aaaaaaaa/main.css";
  const img = "https://tw.buy.yahoo.com/act/assets/campaign-studio-ai/shared/v1-aaaaaaaa/bg-009.webp";

  // 真的上線
  assert.strictEqual(S.judgeLive({ url: css, status: 200, contentType: "text/css; charset=utf-8", contentLength: 100, expectedBytes: 100 }).ok, true);
  assert.strictEqual(S.judgeLive({ url: img, status: 200, contentType: "image/webp" }).ok, true, "沒給大小就不比大小");

  // 病例本體：狀態綠、內容是登入頁
  const login = S.judgeLive({ url: css, status: 200, contentType: "text/html; charset=utf-8" });
  assert.strictEqual(login.ok, false);
  assert.match(login.why, /回的是一頁 HTML/);
  assert.match(login.hint, /登入/);

  // 被轉去登入
  const moved = S.judgeLive({ url: img, status: 302 });
  assert.strictEqual(moved.ok, false);
  assert.match(moved.hint, /要登入/);

  // 沒上傳／沒發佈
  assert.match(S.judgeLive({ url: img, status: 404 }).hint, /沒按發佈/);

  // 被轉檔（該是 webp 卻回 png）／被重新壓過（大小不同）
  assert.match(S.judgeLive({ url: img, status: 200, contentType: "image/png" }).why, /型別不對/);
  const resized = S.judgeLive({ url: img, status: 200, contentType: "image/webp", contentLength: 999, expectedBytes: 381 });
  assert.strictEqual(resized.ok, false);
  assert.match(resized.why, /大小不同/);

  // 沒有 content-type 的伺服器不因此變紅（只少一道，不誤殺）
  assert.strictEqual(S.judgeLive({ url: img, status: 200, contentType: "", contentLength: 381, expectedBytes: 381 }).ok, true);
  // 副檔名不在表上的也不誤殺
  assert.strictEqual(S.judgeLive({ url: "https://x/y/readme.txt", status: 200, contentType: "text/plain" }).ok, true);
});

test("上線確認一律不跟隨轉址：第一跳就是答案（跟隨到底會把登入頁看成 200 假綠燈）", () => {
  const src = require("fs").readFileSync(require("path").join(__dirname, "../../tools/build_aem_shared_css.js"), "utf8");
  const fetches = src.match(/fetch\([^)]*\)/g) || [];
  assert.ok(fetches.length >= 2, "上線確認至少兩處 fetch（逐檔 HEAD ＋ main.css 取內容）");
  for (const f of fetches) assert.match(f, /redirect:\s*"manual"/, `這處 fetch 沒有鎖不跟隨轉址：${f}`);
  /* 病例（2026-09-18）：同一個網址不跟隨＝302 到登入頁、跟隨到底＝200 而內容是企業 SSO 登入表單。
     所以這不是風格問題，是「紅燈還是假綠燈」的開關。 */
  assert.match(src, /不要跟隨轉址，第一跳就是答案/, "要留下為什麼，否則下一個人會把它改成跟隨");
});
