#!/usr/bin/env node
/* slot_coverage_audit.js —— 11 款版式「文字槽覆蓋審計」：設計師填的每一格字，畫面上到底有沒有出現
 *
 * 為什麼有這支：2026-09-07 一天裡「005 副標欄有字、預覽沒出」「006 副標掉進主標格」「換副標字型沒反應」三件，
 * 全是同一種病——**文字槽的對照表住在三個地方**（lib/layout_choice HERO_TEXT_PIECES＝編修器欄位、引擎 loadProposalPack＝工具怎麼組字、
 * 引擎各 renderHeroV2LXXX＋HV2_SUB_NODES＝畫面哪個節點顯示），改一處漏兩處。逐款人工對板做過一次（09-07），這支把它變成機器每次都做：
 *
 *   A 記號法（lib ↔ 引擎）：把每一格塞一個獨一無二的記號字（槽甲記、槽乙記…，不含數字），畫完後看舞台上「看得見」的文字裡有沒有它——
 *     lib 說這格可填 → 記號必須出現；lib 說 null（藏欄）→ 記號不得出現；多送一格 → 不得出現（引擎不讀 lib 沒登的格）
 *   B 組字法（工具 → 引擎）：走色彩工具真正走的 loadProposalPack（主標甲／副標乙／膠囊丙），讀它組進去的每一行——
 *     每一行非空的字都要在舞台上看得見（沒有一行無聲消失）；落在 lib 藏欄（null）那格的字＝⚠ 警告（工具送字進會收起的格）
 *   C 節點法：主標節點（HV2_TITLE_NODES）要含「主標甲」；副標節點（HV2_SUB_NODES＝副標字體／字級套用的那個節點）要含「副標乙」
 *     ——這就是 09-07「換副標字型沒反應」的機器版：字體套的節點 ≠ 副標字所在的節點＝紅
 *
 * 用法：node tools/slot_coverage_audit.js [--layouts layout-005,layout-006] [--json]
 * 直讀規劃資料夾的引擎源檔（file://），不需 sync；「看得見」＝innerText（display:none 的收起格不算）。exit 1＝有 ✖。
 */
const path = require("path");
const { chromium } = require("playwright-core");
const { HERO_TEXT_PIECES } = require("../lib/layout_choice.js");

const ROOT = path.resolve(__dirname, "..", "..", "..");
const FRAMETEST = path.join(ROOT, "2026-AI自動化活動頁生成規劃", "MVP_Phase1_LeCreuset_活動頁Prototype_FrameTest.html");
const args = process.argv.slice(2);
const argOf = (k) => (args.includes(k) ? args[args.indexOf(k) + 1] : null);
const DEMO = { titleText: "主標甲", subtitleText: "副標乙", capsuleText: "膠囊丙", dateValue: "09/01 - 10/10" };

(async () => {
  const browser = await chromium.launch({ channel: "chrome" });
  const page = await browser.newPage({ viewport: { width: 1264, height: 1000 } });
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(e.message));
  await page.goto("file://" + FRAMETEST + "?device=desktop", { waitUntil: "load" });
  await page.waitForTimeout(1500);

  const engineLayouts = await page.evaluate(() => Object.keys(HV2_STAGES).sort());
  const wanted = argOf("--layouts") ? argOf("--layouts").split(",") : engineLayouts;
  const report = [];
  for (const layout of wanted) {
    const row = { layout, checks: [], warns: [] };
    const bad = (m) => row.checks.push({ pass: false, m });
    const good = (m) => row.checks.push({ pass: true, m });
    const pieces = HERO_TEXT_PIECES[layout];
    if (!pieces) { bad("lib HERO_TEXT_PIECES 沒有這款（引擎有舞台、編修器沒有欄位表）"); report.push(row); continue; }
    const slotKey = Object.keys(pieces)[0]; const labels = pieces[slotKey];

    /* B 先跑：工具組字（也順便讓引擎掛好這款舞台） */
    const b = await page.evaluate(({ layout, slotKey, demo }) => {
      const res = loadProposalPack({ layout }, { demo });
      if (!res || res.ok === false) return { fatal: (res && res.reason) || "loadProposalPack 回 false" };
      return { composed: String((window.__hv2Draft.page.hero || {})[slotKey] || ""), subtitleSlot: res.subtitleSlot === undefined ? "（引擎沒回報）" : res.subtitleSlot };
    }, { layout, slotKey, demo: DEMO });
    if (b.fatal) { bad("工具組字路走不通：" + b.fatal); report.push(row); continue; }
    await page.waitForTimeout(500);
    const visB = await page.evaluate(({ layout }) => {
      const stage = document.getElementById("sec-hero") || document.body;
      const T = HV2_TITLE_NODES[layout]; const tEls = T ? [...document.querySelectorAll(T.sel)] : [];
      const sSel = HV2_SUB_NODES[layout]; const sEls = sSel ? [...document.querySelectorAll(sSel)] : [];
      return { text: stage.innerText || "", titleText: tEls.map((e) => e.innerText || "").join(" | "), subText: sEls.map((e) => e.innerText || "").join(" | "), subSel: sSel || null, titleSel: T ? T.sel : null };
    }, { layout });
    const squash = (t) => String(t || "").replace(/[\s\u2028・·•｜|]+/g, "").toLowerCase(); // 逐字撐滿（004／005 年份帶）、兩色段品牌帶的 innerText 會夾換行與空格＝去空白再比；品牌帶「・」切段後分隔符不落 DOM＝一併忽略；**分段符 ｜ 同理（2026-09-22 補）**＝layout-012 跑馬帶的欄位就叫「跑馬帶文案（用｜分段）」，引擎 split(/[｜|]/) 後分隔符不落 DOM，而 squash 原本沒剝它＝needle 帶 ｜、haystack 沒有，includes 與 subseq 都比不到，於是把一個完全正常的跑馬帶判成「舞台上看不到」。本檔早就為品牌帶的「・」做過同一件事、卻沒為 ｜ 做＝同一條規則兩道門只改了一道（鐵律 4）；CSS 轉大寫＝不分大小寫
    /* 連續比對不到再退「依序出現」：004／005 是嵌字膠囊（主標第一字後嵌一顆膠囊＝畫面上「主[膠囊丙]標甲」），字被合法切開 */
    const subseq = (hay, needle) => { let j = 0; for (const ch of hay) { if (ch === needle[j]) j++; if (j >= needle.length) return true; } return needle.length === 0; };
    const has = (hay, needle) => { const H = squash(hay), N = squash(needle); return H.includes(N) || subseq(H, N); };
    const lines = b.composed.split("\n");
    row.composedLines = lines.length; row.declared = labels.length; row.fillable = labels.filter(Boolean).length;
    if (lines.length > labels.length) bad(`工具組了 ${lines.length} 行，lib 只登 ${labels.length} 格＝多出來的行沒有欄位對應`);
    lines.forEach((ln, i) => {
      if (!ln.trim()) return;
      if (labels[i] === null) row.warns.push(`第 ${i} 格是藏欄（lib null），工具卻送了「${ln.slice(0, 12)}」＝設計師填了會無聲消失（工具端該像 007 一樣講「這款沒有這格」）`);
      else if (!has(visB.text, ln)) bad(`工具組進第 ${i} 格「${ln.slice(0, 12)}」（${labels[i]}），舞台上看不到`);
      else good(`第 ${i} 格「${ln.slice(0, 10)}」→ ${labels[i]}：有畫出`);
    });
    /* C 節點法 */
    /* 主標節點要含「lib 標成主標那一格」的字——不一定是工具的活動標題：006 第 0 格是大字「NEW IN」＝活動標題的示意佈位字
       （使用者 2026-09-08 裁：字風套在它身上是設計本意＝合意），活動標題落第 1 格；判準從 lib 的段名來，不另立名單 */
    const titleIdx = labels.findIndex((l) => l && /^主標/.test(l));
    if (!visB.titleSel) bad("引擎沒有這款的主標節點表（HV2_TITLE_NODES）");
    else if (has(visB.titleText, DEMO.titleText)) good(`主標節點 ${visB.titleSel} 含主標`);
    else if (titleIdx >= 0 && lines[titleIdx] && has(visB.titleText, lines[titleIdx])) good(`主標節點 ${visB.titleSel} 含第 ${titleIdx} 格「${lines[titleIdx].slice(0, 10)}」＝lib 標的主標格（示意佈位字；合意）`);
    else {
      const hit = lines.findIndex((ln) => ln.trim() && has(visB.titleText, ln));
      if (hit < 0) bad(`主標節點 ${visB.titleSel} 裡沒有工具組的任何一行（字風／字級會套到不知道哪裡的字上）`);
      else bad(`字風／字級套的節點 ${visB.titleSel} 是第 ${hit} 格「${lines[hit].slice(0, 10)}」（${labels[hit]}）、不是 lib 標的主標格＝要對板`);
    }
    const subComposedIdx = lines.findIndex((ln) => ln.includes(DEMO.subtitleText));
    const subVisible = subComposedIdx >= 0 && labels[subComposedIdx] !== null && has(visB.text, DEMO.subtitleText);
    if (subVisible) {
      if (!visB.subSel) bad("副標有畫出來，但引擎沒登副標節點（HV2_SUB_NODES）＝副標字體／字級套不到");
      else if (!has(visB.subText, DEMO.subtitleText)) bad(`副標字體套的節點 ${visB.subSel} 裡沒有「副標乙」＝換副標字型會沒反應（09-07 病）`);
      else good(`副標節點 ${visB.subSel} 含副標`);
      if (b.subtitleSlot !== true) bad(`副標畫出來了，引擎卻回報 subtitleSlot=${JSON.stringify(b.subtitleSlot)}＝工具會誤講「沒有副標位置」`);
      else good("引擎回報 subtitleSlot=true（工具不會誤講）");
    } else {
      /* 副標沒畫出來（003／007 板無副標）＝引擎必須回報 subtitleSlot=false，色彩工具才會在副標欄下講「這款沒有副標位置」（2026-09-08 使用者裁） */
      if (b.subtitleSlot === false) good("副標無處落＝引擎回報 subtitleSlot=false（工具會講「這款沒有副標位置」）");
      else bad(`副標無處落，但引擎回報 subtitleSlot=${JSON.stringify(b.subtitleSlot)}＝設計師填了會無聲消失、工具也不會講`);
    }

    /* A 記號法：每格一個記號＋多送一格 */
    /* 記號不用數字（舞台上「示意商品 1」「$--」「09/01」都有數字，依序比對會誤中）；每格一個獨一無二的天干字 */
    const PAINT_DEPS = { "layout-012": { "discount-digit": "85" } }; /* 畫面相依（測試夾具、非產品規則）：真源＝引擎 renderHeroV2L012「折數空＝促購整塊收起（K4 佔位永不出貨）」；slogan-left 第 2 格要折數有值才畫得出 */
const GAN = ["甲", "乙", "丙", "丁", "戊", "己", "庚", "辛", "壬", "癸"];
    const markers = Array.from({ length: labels.length + 1 }, (_, i) => `槽${GAN[i]}記`);
    await page.evaluate(({ slotKey, markers, deps }) => {
      const d = JSON.parse(JSON.stringify(window.__hv2Draft));
      d.page.hero[slotKey] = markers.join("\n");
      Object.assign(d.page.hero, deps); /* 畫面相依夾具（2026-10-08）：l12 促購小字只在折數有值時顯示（引擎 K4 佔位永不出貨）——不給折數＝那格永遠測不到 */
      loadDraftJson(d, "slot-audit");
    }, { slotKey, markers, deps: PAINT_DEPS[layout] || {} });
    await page.waitForTimeout(450);
    const visA = await page.evaluate(() => ((document.getElementById("sec-hero") || document.body).innerText || ""));
    if (args.includes("--debug")) console.log(`[debug ${layout}] 舞台文字（組字）＝${JSON.stringify(visB.text.slice(0, 300))}\n[debug ${layout}] 舞台文字（記號）＝${JSON.stringify(visA.slice(0, 300))}`);
    markers.forEach((m, i) => {
      const shown = has(visA, m);
      if (i === labels.length) { if (shown) bad(`多送的第 ${i} 格記號畫出來了＝引擎讀了 lib 沒登的格`); else good("多送一格：引擎不畫（正確）"); return; }
      if (labels[i] === null) { if (shown) bad(`第 ${i} 格是藏欄（lib null）卻畫出來了`); else good(`第 ${i} 格藏欄：不畫（正確）`); return; }
      if (!shown) bad(`第 ${i} 格「${labels[i]}」lib 說可填、引擎沒畫出來`); else good(`第 ${i} 格「${labels[i]}」：畫出`);
    });
    report.push(row);
  }
  await browser.close();

  const fails = report.flatMap((r) => r.checks.filter((c) => !c.pass).map((c) => `${r.layout}：${c.m}`));
  const warns = report.flatMap((r) => r.warns.map((w) => `${r.layout}：${w}`));
  if (args.includes("--json")) { console.log(JSON.stringify({ report, fails, warns, pageErrors }, null, 2)); process.exit(fails.length ? 1 : 0); }
  console.log(`\n文字槽覆蓋審計 × ${report.length} 款版式（lib 段名表 ↔ 工具組字 ↔ 引擎畫面）\n`);
  for (const r of report) {
    const nf = r.checks.filter((c) => !c.pass).length;
    console.log(`${nf ? "✖" : r.warns.length ? "⚠" : "✔"} ${r.layout}  lib ${r.fillable}/${r.declared} 格可填｜工具組 ${r.composedLines ?? "-"} 行｜檢查 ${r.checks.length - nf}/${r.checks.length} 過${r.warns.length ? `｜⚠ ${r.warns.length}` : ""}`);
    r.checks.filter((c) => !c.pass).forEach((c) => console.log(`    ✖ ${c.m}`));
    r.warns.forEach((w) => console.log(`    ⚠ ${w}`));
  }
  if (pageErrors.length) console.log(`\n引擎頁 JS 錯誤 ${pageErrors.length} 則：${pageErrors.slice(0, 3).join(" / ")}`);
  console.log(`\n合計：✖ ${fails.length}｜⚠ ${warns.length}`);
  process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error("✖ 審計中斷：", e && e.stack || e); process.exit(2); });
