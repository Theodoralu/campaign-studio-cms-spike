"use strict";
/**
 * lib/aem_export.js 單元測試（69 號 Phase 2「下載 AEM HTML」瘦身組裝器，2026-09-10；零新相依、hermetic）
 * 守的是「減法不能剝壞東西」的每一把刀：
 *   ①註解剝除不碰字串／正規表示式／樣板字串　②CSS 規則樹：巢狀 @media、逗號清單只剪不整條丟、黏著註解的 @font-face 仍認得出
 *   ③版型／骨架取捨與親戚版型（kinRef 家族借名）　④函式換空殼與資料常數置 null＝引用全部合法
 *   ⑤鷹架留殼去肉／舞台平衡移除／區段剝除的符號稽核（命脈函式被切到＝紅燈）　⑥字風表只留這頁字風＋真用到的字族載入
 * 對板（DOM／像素）交給 aem_verify.js 在真 Chrome 跑；本檔不開瀏覽器。
 */
const { test } = require("node:test");
const assert = require("node:assert");
const A = require("../../lib/aem_export");

test("stripJs：剝 // 與 /* */，但字串、正規表示式、樣板字串裡的斜線不動；換行數保留", () => {
  const src = `const a = "http://x//y"; // 尾註\nconst r = /https?:\\/\\//g; /* 多行\n註解 */ const t = \`\${a}//\${r}\`;\nconst u = 'it\\'s /* not */ a comment';`;
  const out = A.stripJs(src);
  assert.match(out, /"http:\/\/x\/\/y"/); assert.match(out, /\/https\?:\\\/\\\/\/g/); assert.match(out, /`\$\{a\}\/\/\$\{r\}`/);
  assert.match(out, /'it\\'s \/\* not \*\/ a comment'/); assert.doesNotMatch(out, /尾註|多行/);
});
test("stripJs：不刪換行＝不製造 ASI 風險（每個原始語句仍各自一行）", () => {
  const out = A.stripJs("let a = 1 // x\nlet b = a\n+ 1");
  assert.strictEqual(out.split("\n").length, 3);
});
test("stripCss：剝註解、保留字串內容與 url()", () => {
  const out = A.stripCss(`.a{content:"/* 不是註解 */";background:url("x/*y*/.png")} /* 真註解 */\n.b{}`);
  assert.match(out, /content:"\/\* 不是註解 \*\/"/); assert.match(out, /x\/\*y\*\/\.png/); assert.doesNotMatch(out, /真註解/);
});

test("parseCssRules／filterCss：巢狀 @media 遞迴、容器空了整塊丟；黏在規則前的註解不算 prelude", () => {
  const css = `/* 說明 */ .keep{a:1} /* 黏著 */ @font-face{font-family:'X';src:url(x)} @media (max-width:768px){ .drop{b:2} .keep{c:3} } @media print{ .drop{d:4} } @import url('https://f/x');`;
  const out = A.filterCss(css, (p) => !/\.drop|@font-face/.test(p));
  assert.match(out, /\.keep\{a:1\}/); assert.match(out, /@media \(max-width:768px\)\{\.keep\{c:3\}\}/);
  assert.doesNotMatch(out, /@media print/); assert.doesNotMatch(out, /font-face/); assert.match(out, /@import url\('https:\/\/f\/x'\);/);
});
test("selectorListKeeper：逗號清單只剪掉不要的那幾段（括號內逗號不切）", () => {
  const k = A.selectorListKeeper((part) => !/\.x/.test(part));
  assert.strictEqual(k(".a,.x .b,:is(.c,.d)"), ".a,:is(.c,.d)");
  assert.strictEqual(k(".x,.x .y"), false);
  assert.strictEqual(k(".a,.b"), true);
  assert.strictEqual(k("@media (min-width:1px)"), true);
});

const TPL_STAGES = `<div class="hero-v2"><div class="hv2-s10w hv2-l002" id="hv2-l002"><div><div></div></div></div>
<div class="hv2-s12 hv2-l008" id="hv2-l008"><div></div></div><div class="hv2-s12 hv2-l009" id="hv2-l009"><span>x</span></div><div class="hv2-l011" id="hv2-l011"><div></div></div></div>`;
test("stageSkeletons／kinLayouts：從舞台元素讀骨架 class；同骨架＝親戚", () => {
  const sk = A.stageSkeletons(TPL_STAGES);
  assert.deepStrictEqual(sk["layout-009"], ["hv2-s12"]); assert.deepStrictEqual(sk["layout-011"], []);
  assert.deepStrictEqual(A.kinLayouts("layout-009", sk).sort(), ["layout-008", "layout-009"]);
  assert.deepStrictEqual(A.kinLayouts("layout-011", sk), ["layout-011"]);
});
test("layoutRuleKeeper：別款版型／別套骨架的段丟、共用段留；親戚（008）的 CSS 也丟（CSS 各寫各的）", () => {
  const k = A.layoutRuleKeeper("layout-009", A.stageSkeletons(TPL_STAGES));
  assert.strictEqual(k("body.shell-v2[data-layout=\"layout-011\"] .hero-v2,.floor"), ".floor");
  assert.strictEqual(k(".hv2-l008 .x"), false);
  assert.strictEqual(k(".hv2-s12 .card"), true);
  assert.strictEqual(k(".hv2-s10w .card"), false);
  assert.strictEqual(k("html[data-device=\"tablet\"] .floor"), true);
});
test("removeUnusedStages：平衡配對移除其餘舞台；找不到＝throw", () => {
  const r = A.removeUnusedStages(TPL_STAGES, "layout-009", A.stageSkeletons(TPL_STAGES));
  assert.match(r.html, /id="hv2-l009"><span>x<\/span><\/div>/); assert.doesNotMatch(r.html, /hv2-l002|hv2-l008|hv2-l011/);
  assert.strictEqual(r.removed.length, 3);
  assert.throws(() => A.removeDivById("<div id=\"a\"></div>", "zzz"), /錨點漂移/);
});

test("otherLayoutFnPredicate：他款版型函式 true；本款與親戚 false；他套骨架 true", () => {
  const p = A.otherLayoutFnPredicate("layout-009", A.stageSkeletons(TPL_STAGES));
  assert.strictEqual(p("renderHeroV2L011"), true); assert.strictEqual(p("fitHeroV2S10WTitle"), true);
  assert.strictEqual(p("hv2L008Deco"), false); assert.strictEqual(p("renderHeroV2S12"), false); assert.strictEqual(p("fitHeroV2L009Title"), false);
  assert.strictEqual(p("applyState"), false);
});
test("stubFunctionsByName／jsBlockEnd：主體換 {}、簽名保留；巢狀括號、字串與 regex 內的大括號不干擾", () => {
  const js = `function keep(a){ return a; }\nfunction dropMe(x, y = {z:1}){ const s = "}"; const r = /\\{/g; if (x) { return { s, r }; } }\nkeep(dropMe(1));`;
  const r = A.stubFunctionsByName(js, (n) => n === "dropMe");
  assert.deepStrictEqual(r.stubbed, ["dropMe"]);
  assert.match(r.js, /function dropMe\(x, y = \{z:1\}\)\{\}/); assert.match(r.js, /function keep\(a\)\{ return a; \}/); assert.match(r.js, /keep\(dropMe\(1\)\);/);
  assert.doesNotThrow(() => new Function(r.js));
});
test("nullDataConsts：陣列／物件／字串常數置 null（含字串裡的括號）；其他表達式不動", () => {
  const js = `const A_X = [ { u: "]}" }, 2 ];\nconst B_Y = "https://x";\nconst C_Z = A_X.length;\nconst D_W = {a:[1,2]};`;
  const r = A.nullDataConsts(js, (n) => /^[A-D]_/.test(n));
  assert.deepStrictEqual(r.nulled, ["A_X", "B_Y", "D_W"]);
  assert.match(r.js, /const A_X=null;/); assert.match(r.js, /const C_Z = A_X\.length;/);
  assert.doesNotThrow(() => new Function(r.js));
});

test("dropJsRegions＋auditDroppedSymbols：切掉區段、被引用的函式補空殼；切到命脈函式＝throw；變數被引用＝throw", () => {
  const js = `/* A */\nfunction gone(){ return 1; }\nfunction alsoGone(){}\n/* B */\nfunction stay(){ return gone(); }`; // 頂層函式＝行首（組裝器刻意只認行首＝不誤抓巢狀函式）
  const r = A.dropJsRegions(js, [{ name: "t", start: "/* A */", end: "/* B */" }]);
  assert.match(r.js, /function stay/); assert.doesNotMatch(r.js, /function gone|alsoGone/); assert.strictEqual(r.dropped.length, 1);
  assert.deepStrictEqual(A.auditDroppedSymbols(r.js, r.dropped).stubs, ["gone"]);
  assert.throws(() => A.auditDroppedSymbols("x();", [{ name: "t", text: "function loadDraftJson(){}" }]), /命脈/);
  assert.throws(() => A.auditDroppedSymbols("use(TABLE)", [{ name: "t", text: "const TABLE = {};" }]), /無法安全補殼/);
  assert.throws(() => A.dropJsRegions(js, [{ name: "t", start: "/* 不存在 */", end: "/* B */" }]), /錨點漂移/);
});
test("shrinkScaffold：面板換空殼、只留引擎會 getElementById 的 id；沒面板＝throw", () => {
  const html = `<body><aside id="exp-panel"><div class="ep-head"><button id="ep-toggle">x</button></div><div id="ep-body"><input id="ep-url"><input type="file" id="ep-draft-file"><div id="unused-thing">big</div></div></aside></body>`;
  const r = A.shrinkScaffold(html, `document.getElementById("ep-body"); document.getElementById("ep-url"); document.getElementById("ep-draft-file")`);
  assert.deepStrictEqual(r.stubIds, ["ep-body", "ep-url", "ep-draft-file"]);
  assert.match(r.html, /<aside id="exp-panel" hidden aria-hidden="true">/); assert.doesNotMatch(r.html, /unused-thing|big/);
  assert.match(r.html, /<input type="file" id="ep-draft-file" hidden>/);
  assert.throws(() => A.shrinkScaffold("<body></body>", ""), /錨點漂移/);
});

test("filterTypestyles：只留這頁字風＋共用底；@import／@font-face 只留真用到的字族；清單只剪別款那幾段", () => {
  const css = `@import url('https://fonts.googleapis.com/css2?family=Zen+Maru+Gothic:wght@900&display=swap');
@import url('https://fonts.googleapis.com/css2?family=Unbounded:wght@400&display=swap');
.hero-font-preview .line{position:relative}
.hero-font-preview.css-f1 .line::after,.hero-font-preview.css-f2 .line::after{content:""}
.hero-font-preview.css-f1{font-family:'Zen Maru Gothic',sans-serif}
.hero-font-preview.css-y1{font-family:'Unbounded Sans',sans-serif}
@font-face{font-family:'Cubic 11';src:url('https://cdn/x.woff2')} /* W5 */
@font-face{font-family:'Unbounded Sans';src:url('https://cdn/y.ttf')} /* Y1 */`;
  const r = A.filterTypestyles(css, "css-f1");
  assert.match(r.css, /css-f1\{font-family:'Zen Maru Gothic'/); assert.doesNotMatch(r.css, /css-y1|css-f2/);
  assert.match(r.css, /\.hero-font-preview\.css-f1 \.line::after\{content:""\}/);
  assert.match(r.css, /family=Zen\+Maru\+Gothic/); assert.doesNotMatch(r.css, /family=Unbounded|Cubic 11|Unbounded Sans/);
  assert.strictEqual(r.imports, 1); assert.strictEqual(r.fontFaces, 0);
  const none = A.filterTypestyles(css, null);
  assert.doesNotMatch(none.css, /css-|@import|@font-face/); assert.match(none.css, /\.hero-font-preview \.line/);
});
test("extractAssigned／shrinkBgMap：bg-map.js 有兩段（__BG_MAP__＋__BG_DEFAULTS__）也解得開；只留用到的條目與本款預設", () => {
  const js = `/* banner */\nwindow.__BG_MAP__ = {\n "bg-001": { "file": "assets/hero-bg/bg-001.png", "name": "a}b" },\n "bg-007": { "file": "assets/hero-bg/bg-007.png" }\n};\nwindow.__BG_DEFAULTS__ = {"layout-001":"bg-001","layout-009":"bg-007"};\n`;
  const r = A.shrinkBgMap(js, ["bg-007"], ["layout-009"]);
  assert.deepStrictEqual(Object.keys(r.map), ["bg-007"]); assert.deepStrictEqual(r.defaults, { "layout-009": "bg-007" }); assert.strictEqual(r.all, 2);
  assert.strictEqual(A.extractAssigned(js, "__NOPE__"), null);
});
test("resolveTitleStyle：page.titleStyle ＞ colors.themeDraft.titleStyle ＞ typography.title.style；非 css-* 一律 null", () => {
  assert.strictEqual(A.resolveTitleStyle({ titleStyle: "css-a2", colors: { themeDraft: { titleStyle: "css-f1" } } }), "css-a2");
  assert.strictEqual(A.resolveTitleStyle({ colors: { themeDraft: { titleStyle: "css-f1" } } }), "css-f1");
  assert.strictEqual(A.resolveTitleStyle({ colors: { themeDraft: { typography: { title: { style: "css-n7" } } } } }), "css-n7");
  assert.strictEqual(A.resolveTitleStyle({ titleStyle: "bogus" }), null);
});
test("DEVICE_INLINE_SCRIPT／launcherScript：不含空 catch（dod G2）、啟動器只在乾淨網址啟動、失敗出聲文案是白話", () => {
  assert.doesNotMatch(A.DEVICE_INLINE_SCRIPT, /catch\s*\([^)]*\)\s*\{\s*\}/);
  const l = A.launcherScript("{}");
  assert.match(l, /q\.has\("dataset"\)\|\|q\.has\("draftUrl"\)/); assert.match(l, /活動資料沒有載入/); assert.doesNotMatch(l, /layout-\d{3}|undefined/);
  // 開機遮罩（2026-09-10 使用者看到示範畫面閃現）：套上資料與失敗出聲兩條路都要掀遮罩，不留黑箱
  assert.match(l, /function unmask\(\)\{document\.documentElement\.classList\.remove\("aem-boot"\);\}/);
  assert.match(l, /if\(r!==false\)\{clean\(\);unmask\(\);/); assert.match(l, /function fail\(msg\)\{unmask\(\);/);
});
