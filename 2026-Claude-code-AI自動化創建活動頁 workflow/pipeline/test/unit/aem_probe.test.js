"use strict";
/**
 * 量 AEM 檔案大小的共用零件（lib/aem_probe.js；2026-09-18 重寫四支量尺後新增）
 * 白話：這幾支量尺的命脈是「尺只有一把、裝置定義只有一份」。這裡守的就是那件事——
 * 尺必須跟產品端匯出器同一把，三裝置必須跟對板閘同一份，拆桶必須加得起來。
 */
const { test } = require("node:test");
const assert = require("node:assert");
const P = require("../../lib/aem_probe");
const AE = require("../../lib/aem_export");

test("尺只有一把：aem_probe 的量法＝產品端匯出器的 measureAemBudget，上限同一個常數", () => {
  assert.strictEqual(P.AEM_ENCODED_CAP, AE.AEM_ENCODED_CAP);
  assert.strictEqual(P.measureAemBudget, AE.measureAemBudget, "不可以自己包一份尺，要 re-export 產品那把");
  for (const s of ["", "abc", "中文字", '<a href="x">中</a>', "a".repeat(5000)]) {
    assert.strictEqual(P.measure(s).encoded, AE.measureAemBudget(s).encoded, s.slice(0, 12));
  }
  /* 量法本身：中文一字 9、安全 ASCII 一字 1 */
  assert.strictEqual(P.measure("中").encoded, 9);
  assert.strictEqual(P.measure("a").encoded, 1);
});

test("三裝置定義只有一份：對板閘 aem_verify.js 讀的就是這裡（桌機無觸控、平板與手機有觸控）", () => {
  assert.deepStrictEqual(P.VIEWS.map((v) => v.key), ["desktop", "tablet", "mobile"]);
  assert.deepStrictEqual(P.VIEWS.map((v) => v.touch), [false, true, true]);
  assert.deepStrictEqual(P.VIEWS.map((v) => v.width), [1440, 768, 375]);
  assert.deepStrictEqual(P.VIEWS.map((v) => v.wantDevice), [null, "tablet", "mobile"]);
  const src = require("fs").readFileSync(require("path").join(__dirname, "../../aem_verify.js"), "utf8");
  assert.match(src, /require\("\.\/lib\/aem_probe"\)/, "對板閘要讀共用庫，不可以自己再寫一份 VIEWS");
  assert.doesNotMatch(src, /const VIEWS = \[/, "對板閘不該還有自己的 VIEWS 複本");
});

test("拆桶：三桶相加＝總數；內嵌圖片是交叉項（已含在前三桶裡，不可相加）", () => {
  const img = "data:image/png;base64,AAAABBBBCCCCDDDD====";
  const html = `<html><head><style>.a{background:url("${img}")}</style><script>var x="中文"</script></head><body><p>中文字</p><img src="${img}"></body></html>`;
  const r = P.bucketize(html);
  const sum = r.buckets.script.encoded + r.buckets.style.encoded + r.buckets.markup.encoded;
  assert.strictEqual(sum, r.total.encoded, "三桶相加必須等於總數");
  assert.strictEqual(r.inlineImages.count, 2, "兩處內嵌圖");
  assert.strictEqual(r.inlineImages.crossCut, true, "要標明是交叉項");
  assert.ok(r.inlineImages.encoded > 0 && r.inlineImages.encoded < r.total.encoded);
  assert.ok(r.withoutImages.encoded < r.total.encoded, "把圖片換掉一定變小");
  assert.strictEqual(r.cap, P.AEM_ENCODED_CAP);
  assert.strictEqual(r.fits, true, "這段很短，過得了");
});

test("圖片外連：內嵌 base64 換成真實 AEM 素材庫網址的長度（不是猜一個短網址）", () => {
  const img = "data:image/webp;base64," + "A".repeat(4000);
  const before = P.measure(`<img src="${img}">`).encoded;
  const after = P.measure(P.externalizeImages(`<img src="${img}">`)).encoded;
  assert.ok(after < before / 10, "外連後應該小一個級數以上");
  assert.match(P.SAMPLE_ASSET_URL, /^https:\/\/tw\.buy\.yahoo\.com\/act\/assets\/campaign-studio-ai\//, "網址樣本要照工程師 09-17 給的真實規則");
  assert.strictEqual(P.measure(P.SAMPLE_ASSET_URL).encoded, 104, "樣本長度固定＝104（改樣本會讓所有歷史數字不可比，要同批改文件）");
  assert.strictEqual(P.externalizeImages("<p>沒有圖</p>"), "<p>沒有圖</p>", "沒有圖就不要動");
});

test("可見 DOM 的取法是一個可傳進瀏覽器的純函式（對板閘與量尺共用同一段邏輯）", () => {
  const src = P.visibleDomSnapshot.toString();
  assert.match(src, /getComputedStyle/, "要靠 computed style 判隱藏");
  assert.match(src, /cloneNode\(true\)/, "先在活體標記、再複製（複製出來的沒有 computed style）");
  assert.match(src, /script,style/, "script 與 style 不算畫面");
  assert.match(src, /t === el \|\| t\.contains\(el\)/, "單位不可重疊：自己已被認走也算（第一版漏了 t === el，站頭被認兩次）");
  assert.ok(P.EDITOR_SCAFFOLD.includes("#exp-panel"), "後台鷹架要剝");
});

/* ── 瘦身後估計（2026-10-07 加）────────────────────────────────────────────
   白話：這條測試守的是「那個常數當初是拿什麼對出來的」。常數可以改，但改的人要先看見
   這三筆實測，並且同批把測試裡的真值一起換掉——不然就是把對照基準偷偷換了。 */
test("瘦身後估計：常數是對著 2026-10-07 工程師三檔實測校準的，不是猜的", () => {
  /* 唯一一筆有「編碼後真值」的：C layout-002＋自備背景 */
  const C_VISIBLE_DOM_EXTERNALIZED = 116543; // 我們量的（真 Chrome、圖片外連後、desktop）
  const C_ENGINEER_ACTUAL = 128303;          // 工程師瘦身工具實測的編碼後字數
  const est = P.estimateSlimmed(C_VISIBLE_DOM_EXTERNALIZED);
  assert.strictEqual(est.encoded, C_ENGINEER_ACTUAL, "中位估計要正中 C 檔那筆真值（常數就是這樣定出來的）");

  /* 另外兩筆只有他給的 KB，編碼值是用 C 的膨脹率 1.586 換算的＝推估對推估，所以容忍放寬到 8% */
  for (const [name, ours, derived] of [["A layout-005", 77684, 90948], ["B layout-012", 80578, 97444]]) {
    const e = P.estimateSlimmed(ours);
    const err = Math.abs(e.encoded - derived) / derived;
    assert.ok(err < 0.08, `${name}：估 ${e.encoded} vs 推估實測 ${derived}，誤差 ${(err * 100).toFixed(1)}% 應 <8%`);
  }
});

test("瘦身後估計：兩把尺分開用——提早出聲看安全邊際，斷言不會過只看中位估計", () => {
  const e = P.estimateSlimmed(100000);
  assert.ok(e.safe > e.encoded, "安全邊際是上界，要比中位估計大");
  assert.strictEqual(e.safePctOfCap, P.pct(e.safe));

  /* 絆線：C 檔實際是「過了」（128,303 ≤ 131,072）。第一版因為 fits 看 safe，
     把它判成超標＝假警報。這條就是守那件事不要再發生。 */
  const C = P.estimateSlimmed(116543);
  assert.strictEqual(C.encoded, 128303);
  assert.strictEqual(C.fits, true, "C 檔真的過了，不可以判成不過（假警報會讓整道閘被當雜訊略過）");
  assert.strictEqual(C.verdict, "貼著線", "但要大聲講『貼著線』，不能說寬鬆");
  assert.ok(C.safe > P.AEM_ENCODED_CAP, "安全邊際確實超過上限＝提早出聲的理由還在");
});

test("瘦身後估計：四級判定的分界（寬鬆／偏緊／貼著線／超標）", () => {
  const at = (pctOfCap) => P.estimateSlimmed(P.AEM_ENCODED_CAP * pctOfCap / P.SLIM_SAFETY - P.SLIM_OVERHEAD_ENCODED).verdict;
  assert.strictEqual(at(0.5), "寬鬆");
  assert.strictEqual(at(0.8), "偏緊");
  assert.strictEqual(at(0.95), "貼著線");
  /* 「超標」只在中位估計自己就過不了時才講 */
  assert.strictEqual(P.estimateSlimmed(P.AEM_ENCODED_CAP).verdict, "超標");
});
