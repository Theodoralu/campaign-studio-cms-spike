"use strict";
/**
 * W1-B12 K16 旅程走查（真點擊；playwright-core channel:chrome）——照 story「以終為始一頁」逐句驗：
 *   ①建立表單看得到「霓虹夜市・夜間限定」卡 → ②選它＋貼 Yahoo 來源網址＋按建置（快速草稿） → ③編修頁預覽是真樣式
 *   （夜市底圖／螢光黃實心主標／三張卡中間大／售價＝實抓真數字）→ ④主標改兩行＝預覽真換行、日期折數往下讓位
 *   → ⑤促購格打「買一送一」＝「折起」小字收起 → ⑥切平板／手機＝各自排版（手機兩張卡）→ 存檔。
 * 不做：核可、部署（story 最後一句「核可後上線」屬上線流程，不在旅程走查裡按）。
 * 用法：node test/browser/l012-journey.js [port] [outDir]   預設 8787、docs/design-qa/layout-012-shots/
 * 前置：workbench server 活著（Basic Auth 密碼讀 workbench/.wb-pass，不印）；能連 tw.buy.yahoo.com。
 */
if (process.env.NODE_TEST_CONTEXT) { console.log("l012-journey：手動旅程走查腳本（需 Chrome＋活 server＋外網），node --test 下跳過"); return; }
const fs = require("fs"), path = require("path"), pw = require("playwright-core");
const PORT = process.argv[2] || "8787";
const OUT = process.argv[3] ? path.resolve(process.argv[3]) : path.join(__dirname, "..", "..", "docs", "design-qa", "layout-012-shots");
const BASE = `http://127.0.0.1:${PORT}`;
const PASS = fs.readFileSync(path.join(__dirname, "..", "..", "workbench", ".wb-pass"), "utf8").trim();
const SRC_URL = "https://tw.buy.yahoo.com/category/4481524";
fs.mkdirSync(OUT, { recursive: true });
const results = [];
const ok = (name, pass, note) => { results.push({ name, pass: !!pass, note: note || "" }); console.log(`${pass ? "✔" : "✖"} ${name}${note ? "｜" + note : ""}`); };
const EXPECTED_404 = /\/(product_check|gate_report|snapshot)\.json$/; // 進場探測報告檔＝既有行為（app 以 r.ok 分支處理）

(async () => {
  const browser = await pw.chromium.launch({ channel: "chrome", headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, httpCredentials: { username: "yahoo", password: PASS } });
  const page = await ctx.newPage();
  const errs = [], bad = [];
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errs.push(m.text()); });
  page.on("pageerror", (e) => errs.push("PAGEERROR " + String(e)));
  page.on("response", (r) => { if (r.status() >= 400 && !EXPECTED_404.test(r.url())) bad.push(`${r.status()} ${r.url()}`); });
  const shot = (name, opts) => page.screenshot(Object.assign({ path: path.join(OUT, name) }, opts || {}));
  const frame = () => page.frames().find((f) => /\/frametest\//.test(f.url()));
  const heroReady = async (expectW, minCards) => { // 等預覽 iframe 裡 layout-012 舞台出現＋卡片帶真價
    const t0 = Date.now(); let lastErr = "";
    while (Date.now() - t0 < 30000) {
      const f = frame();
      if (f) { try {
        const r = await f.evaluate(([w, n]) => { const st = document.getElementById("hv2-l012"); if (!st) return null;
          const cards = Array.from(st.querySelectorAll(".l12-card:not(.empty)")); const priced = cards.filter((c) => /\$\d/.test((c.querySelector(".l12-price b") || {}).textContent || ""));
          /* CMS 預覽 iframe 被 fitPreview 縮放＝getBoundingClientRect 是縮後尺寸；裝置判定改用未縮放的版面寬 offsetWidth */
          return { w: st.offsetWidth, rendered: Math.round(st.getBoundingClientRect().width), device: document.documentElement.dataset.device || "desktop", cards: cards.length, priced: priced.length, okW: st.offsetWidth === w, okN: cards.length >= n && priced.length >= n }; }, [expectW, minCards]);
        if (r && r.okW && r.okN) return r;
      } catch (e) { lastErr = String(e); /* iframe 重載中 evaluate 會斷一次＝記下最後一次錯，逾時才出聲 */ } }
      await page.waitForTimeout(400);
    }
    console.log(`heroReady 逾時 30s（期望寬 ${expectW}、卡 ≥${minCards}）｜最後錯誤：${lastErr || "無"}`);
    return null;
  };
  const measure = () => frame().evaluate(() => { const st = document.getElementById("hv2-l012"); if (!st) return null; const r = st.getBoundingClientRect();
    const k = r.width ? st.offsetWidth / r.width : 1; /* 縮放係數：量測值 × k ＝ 設計像素（與 spec／l012-shots 同一把尺） */
    const q = (sel) => { const el = st.querySelector(sel); if (!el) return null; const b = el.getBoundingClientRect(); return { y: +((b.top - r.top) * k).toFixed(1), h: +(b.height * k).toFixed(1), w: +(b.width * k).toFixed(1), display: getComputedStyle(el).display, text: (el.textContent || "").trim().slice(0, 60) }; };
    const bgOf = (el) => (getComputedStyle(el).backgroundImage.match(/bg-036[^"')]*/) || [""])[0];
    const bgLayer = bgOf(st) || (Array.from(document.querySelectorAll("#sec-hero, #sec-hero *")).map(bgOf).find(Boolean) || "none"); /* 滿版層機制：桌機底圖在 #sec-hero 的滿版層、舞台本體 none（引擎 2026-08-30） */
    return { stage: { w: st.offsetWidth, h: Math.round(r.height * k), renderedW: Math.round(r.width), scale: +(1 / k).toFixed(3) }, bg: bgLayer, bgOnStage: bgOf(st) || "none",
      titleColor: getComputedStyle(st.querySelector(".l12-title")).color, titleStroke: getComputedStyle(st.querySelector(".l12-title")).webkitTextStrokeWidth,
      title: q(".l12-title"), date: q(".l12-date"), promo: q(".l12-promo"), promoPhrase: st.querySelector(".l12-promo").classList.contains("phrase"), promoNum: q(".l12-promo-num"), unit: q(".l12-promo-unit"), marquee: q(".l12-marquee"), marqueeTxt: ((st.querySelector(".l12-marquee") || {}).textContent || "").trim().slice(0, 60),
      cards: Array.from(st.querySelectorAll(".l12-card")).map((c) => ({ empty: c.classList.contains("empty"), w: Math.round(c.getBoundingClientRect().width * k), y: Math.round((c.getBoundingClientRect().top - r.top) * k), name: (c.querySelector(".l12-name") || {}).textContent, price: (c.querySelector(".l12-price b") || {}).textContent, was: (c.querySelector(".l12-was") || {}).textContent, cap: (c.querySelector(".l12-cap") || {}).textContent })),
      dots: st.querySelectorAll(".l12-dot").length, dotOn: Array.from(st.querySelectorAll(".l12-dot")).findIndex((d) => d.classList.contains("on")) }; });
  const report = { startedAt: new Date().toISOString(), srcUrl: SRC_URL, steps: {} };

  /* ── ① 建立表單：版式選擇區有新卡 ── */
  await page.goto(BASE + "/", { waitUntil: "networkidle" });
  const REUSE = process.env.JOURNEY_RUN || ""; /* 迭代用：重用既有 run＝跳過①②（①②證據以首次建檔那輪為準） */
  let opened = false, runId = REUSE;
  if (REUSE) { await page.evaluate((id) => openRun(id), REUSE); await page.waitForFunction(() => document.querySelector("#view-work").style.display === "flex", null, { timeout: 15000 }); opened = true; report.reused = REUSE; ok("（重用既有 run，跳過①②）", true, REUSE); }
  else {
  await page.click("#nav-create");
  const card = page.locator('#layout-cards .layout-card[data-kind="layout"][data-base="layout-012"]');
  await card.waitFor({ timeout: 15000 });
  const cardName = (await card.locator("b").textContent()).trim();
  ok("①建立表單看得到新卡", cardName === "霓虹夜市・夜間限定", `卡名＝${cardName}`);
  const cardTxt = (await card.textContent()) || "";
  ok("①卡面無貨號／治理詞", !/layout-|試用|灰度|rollout|trial/i.test(cardTxt), cardTxt.replace(/\s+/g, " ").slice(0, 80));
  await card.scrollIntoViewIfNeeded(); await shot("journey-01-create-card.png");

  /* ── ② 選卡＋貼網址＋按建置（快速草稿約 30 秒） ── */
  await card.click();
  const kvv = await page.evaluate(() => layoutVal());
  ok("②點卡＝版式值落到表單", kvv === "layout-012", `layoutVal()＝${kvv}`);
  const reason = ((await page.locator("#layout-reason").textContent()) || "").trim();
  ok("②理由行印卡面名不印貨號", /霓虹夜市/.test(reason) && !/layout-/.test(reason), reason.slice(0, 80));
  await page.fill("#in-url", SRC_URL);
  await page.fill("#in-theme", "霓虹夜市 夜間限定");
  await page.fill("#in-owner-email", "qa");
  const dept = await page.evaluate(() => { const s = document.querySelector("#in-owner-dept"); const o = Array.from(s.options).find((x) => x.value && x.value !== "__custom__"); s.value = o.value; s.dispatchEvent(new Event("change")); return o.value; });
  const engine = await page.evaluate(() => document.querySelector(".engine-card.on").dataset.engine);
  ok("②策展方式＝快速草稿（預設）", engine === "auto", `engine＝${engine}｜部門＝${dept}`);
  await shot("journey-02-form-filled.png");
  await page.click("#btn-create");
  const t0 = Date.now(); let createErr = "";
  while (Date.now() - t0 < 240000) {
    const st = await page.evaluate(() => ({ work: document.querySelector("#view-work").style.display, err: (document.querySelector("#create-error") && document.querySelector("#create-error").style.display === "block") ? document.querySelector("#create-error").textContent.trim().slice(0, 200) : "" }));
    if (st.err) { createErr = st.err; break; }
    if (st.work === "flex") { opened = true; break; }
    if (Date.now() - t0 > 6000 && Date.now() - t0 < 7000) await shot("journey-02b-progress.png");
    await page.waitForTimeout(800);
  }
  runId = await page.evaluate(() => currentId);
  report.createSeconds = Math.round((Date.now() - t0) / 10) / 100;
  ok("②建置完成自動進編修頁", opened, opened ? `run＝${runId}｜${report.createSeconds}s` : `未進編修：${createErr || "逾時 240s"}`);
  if (!opened) { report.results = results; fs.writeFileSync(path.join(OUT, "journey-report.json"), JSON.stringify(report, null, 1)); await browser.close(); process.exit(1); }
  }
  report.runId = runId;

  /* ── ③ 編修頁預覽＝真樣式（不是骨架告示）＋售價＝實抓真數字 ── */
  const ready = await heroReady(1440, 3);
  ok("③預覽出現 layout-012 舞台（桌機 1440）且三張卡帶價", !!ready, JSON.stringify(ready));
  if (!ready) { await shot("journey-03-editor-desktop.png"); const f = frame(); const seen = f ? await f.evaluate(() => ({ url: location.href, hasL012: !!document.getElementById("hv2-l012"), heroTxt: (document.querySelector("#sec-hero") || {}).innerText ? document.querySelector("#sec-hero").innerText.trim().slice(0, 160) : "" })).catch(() => null) : null;
    ok("③（診斷）預覽頁是否含 layout-012 引擎", seen && seen.hasL012, JSON.stringify(seen));
    report.results = results; report.errs = errs; report.bad = bad; fs.writeFileSync(path.join(OUT, "journey-report.json"), JSON.stringify(report, null, 1)); await browser.close(); process.exit(1); }
  await page.waitForTimeout(600);
  const m3 = await measure(); report.steps.desktop = m3;
  ok("③底圖＝夜市 bg-036（桌機在滿版層）", m3 && m3.bg === "bg-036.png", m3 && `${m3.bg}｜舞台本體=${m3.bgOnStage}`);
  ok("③跑馬帶槽留白＝不印示範句到營運眼前以外（CMS 預覽只准亮灰示範／空）", m3 && !/陣區限時 ★｜整點開搶/.test(m3.marqueeTxt) , m3 && `帶內文字＝「${m3.marqueeTxt}」`);
  ok("③主標實心螢光黃無描邊", m3 && m3.titleColor === "rgb(217, 255, 61)" && (m3.titleStroke === "0px" || !m3.titleStroke), m3 && `${m3.titleColor}｜stroke=${m3.titleStroke}`);
  const widths = (m3 && m3.cards || []).map((c) => c.w);
  ok("③三張卡中間那張比較大", widths.length === 3 && widths[1] > widths[0] && widths[1] > widths[2], `寬＝${widths.join("/")}`);
  const draft = await page.evaluate(async (id) => (await fetch(`/api/runs/${id}/draft.json`)).json(), runId);
  const priceSet = new Set((draft.products || []).map((p) => "$" + Number(p.price).toLocaleString("en-US")));
  const shown = (m3.cards || []).filter((c) => !c.empty).map((c) => c.price);
  ok("③卡片售價逐字等於草稿實抓價", shown.length === 3 && shown.every((p) => priceSet.has(p)), `顯示＝${shown.join(",")}`);
  ok("③商品卡有特色標／兩行品名區", (m3.cards || []).every((c) => c.name && c.name.length > 0), (m3.cards || []).map((c) => c.name.slice(0, 12)).join("｜"));
  report.steps.desktopAlso = { hero: draft.page.hero, kvVariant: draft.page.kvVariant, dateValue: draft.page.kv && draft.page.kv.dateValue };
  ok("③草稿版式＝layout-012", draft.page.kvVariant === "layout-012", draft.page.kvVariant);
  await shot("journey-03-editor-desktop.png");
  const heroEl = await frame().$("#hv2-l012"); if (heroEl) await heroEl.screenshot({ path: path.join(OUT, "journey-03b-preview-hero-desktop.png") });
  await page.waitForTimeout(4600); const m3b = await measure();
  ok("③商品卡自動輪播（4 秒後主位圓點移動、中間那張換人）", m3b && m3b.dotOn !== m3.dotOn && m3b.cards[1].price !== m3.cards[1].price, `dotOn ${m3.dotOn}→${m3b.dotOn}｜中卡售價 ${m3.cards[1].price}→${m3b.cards[1].price}`);

  /* ── ④ 主標改兩行＝預覽真換行、下方讓位 ── */
  await page.evaluate(() => { const n = document.querySelector('.tn[data-sec="sec-kv"]'); if (n) n.click(); try { ensureSectionOpen("sec-kv"); } catch (e) { console.warn("ensureSectionOpen 不可用：" + e); } });
  const ta = page.locator('#editor-col textarea[data-hero-piece="slogan-left:0"]');
  await ta.waitFor({ timeout: 8000 });
  const hint = ((await page.locator('#editor-col label.hp-title .lock').first().textContent()) || "").trim();
  report.steps.titleHint = hint;
  const promo = page.locator('#editor-col input[data-path="page.hero.discount-digit"]');
  await promo.fill("85"); /* 先讓折數在場，④ 才量得到「往下讓位」（折數留白＝整塊不顯示，量不到） */
  await ta.fill("霓虹夜市"); await page.waitForTimeout(1500); const m4a = await measure(); report.steps.titleOneLine = m4a;
  ok("④主標一行＝單行高", m4a && m4a.title.h >= 70 && m4a.title.h <= 90, `title.h＝${m4a && m4a.title.h}`);
  await ta.fill("霓虹夜市\n夜間限定");
  await page.waitForTimeout(1500);
  const m4 = await measure(); report.steps.titleTwoLines = m4;
  ok("④主標兩行＝預覽真換行（高度≈兩行）", m4 && m4.title.h >= 140 && m4.title.h <= 170 && /\n/.test(m4.title.text), `title.h＝${m4 && m4.title.h}｜「${m4 && m4.title.text.replace(/\n/g, "⏎")}」`);
  ok("④日期與折數往下讓位、沒擠爆", m4 && m4a && m4.promo.y > m4a.promo.y && m4.date.y > m4a.date.y && m4.promo.y + m4.promo.h <= m4.stage.h, `promo.y ${m4a && m4a.promo.y}→${m4 && m4.promo.y}｜date.y ${m4a && m4a.date.y}→${m4 && m4.date.y}｜舞台高 ${m4 && m4.stage.h}`);
  await shot("journey-04-title-two-lines.png");

  /* ── ⑤ 促購：純數字＝「折起」在；整句「買一送一」＝小字收起 ── */
  const m5a = m4;
  ok("⑤促購填 85＝數字＋「折起」單位在", m5a && m5a.unit && m5a.unit.display !== "none" && !m5a.promoPhrase && /85/.test(m5a.promoNum && m5a.promoNum.text), `num＝${m5a && m5a.promoNum && m5a.promoNum.text}｜unit=${m5a && m5a.unit && m5a.unit.display}`);
  await promo.fill("買一送一"); await page.waitForTimeout(1300); const m5 = await measure(); report.steps.promoPhrase = m5;
  ok("⑤促購「買一送一」＝「折起」小字收起", m5 && m5.unit && m5.unit.display === "none" && m5.promoPhrase && /買一送一/.test(m5.promoNum && m5.promoNum.text), `unit=${m5 && m5.unit && m5.unit.display}｜phrase=${m5 && m5.promoPhrase}｜文字＝${m5 && m5.promoNum && m5.promoNum.text}`);
  await shot("journey-05-promo-phrase.png");
  const heroEl5 = await frame().$("#hv2-l012"); if (heroEl5) await heroEl5.screenshot({ path: path.join(OUT, "journey-05b-preview-hero-edited.png") });

  /* ── ⑥ 切平板／手機＝各自排版 ── */
  await page.click('#device-bar .dv[data-dev="tablet"]');
  const rt = await heroReady(768, 3); const m6 = rt && await measure(); report.steps.tablet = m6;
  ok("⑥平板＝768 舞台、三張卡、平板底圖", !!rt && m6.bg === "bg-036-768.png" && m6.stage.h === 460, m6 && `${m6.stage.w}×${m6.stage.h}｜${m6.bg}｜卡寬 ${m6.cards.map((c) => c.w).join("/")}`);
  ok("⑥平板保住兩行主標與整句促購", m6 && /\n/.test(m6.title.text) && m6.unit.display === "none", m6 && `title.h＝${m6.title.h}`);
  await shot("journey-06-tablet.png"); { const el = await frame().$("#hv2-l012"); if (el) await el.screenshot({ path: path.join(OUT, "journey-06b-preview-hero-tablet.png") }); }
  await page.click('#device-bar .dv[data-dev="mobile"]');
  const rm = await heroReady(375, 2); const m7 = rm && await measure(); report.steps.mobile = m7;
  ok("⑥手機＝375 舞台、上下堆疊（標題在卡片上方）、只有兩張卡、手機底圖", !!rm && m7.bg === "bg-036-375.png" && m7.cards.length === 2 && m7.promo.y + m7.promo.h <= Math.min(...m7.cards.map((c) => c.y)), m7 && `${m7.stage.w}×${m7.stage.h}｜${m7.bg}｜卡數 ${m7.cards.length}（寬 ${m7.cards.map((c) => c.w).join("/")}）｜促購底 ${m7.promo.y + m7.promo.h} < 卡頂 ${Math.min(...m7.cards.map((c) => c.y))}`);
  ok("⑥手機不是桌機縮小（舞台高 ≥620＝手機專屬版）", m7 && m7.stage.h >= 620, m7 && `h＝${m7.stage.h}`);
  await shot("journey-07-mobile.png"); { const el = await frame().$("#hv2-l012"); if (el) await el.screenshot({ path: path.join(OUT, "journey-07b-preview-hero-mobile.png") }); }
  await page.locator("#device-bar .dv").first().click(); /* 切回桌機（第一顆）；找不到＝腳本出聲失敗 */

  /* ── 存檔（不核可、不部署） ── */
  await page.click("#btn-save"); /* 存檔失敗＝出聲，不吞 */
  await page.waitForTimeout(2500);
  const saved = await page.evaluate(async (id) => { const d = await (await fetch(`/api/runs/${id}/draft.json`)).json(); return { slogan: d.page.hero["slogan-left"], promo: d.page.hero["discount-digit"] }; }, runId);
  ok("存檔＝主標折行以 U+2028 入契約、促購整句入稿", /\u2028/.test(saved.slogan || "") && saved.promo === "買一送一", JSON.stringify(saved).replace(/\u2028/g, "\\u2028").slice(0, 120));

  /* ── 零主控台錯誤／零 4xx ── */
  ok("全程 console 零 error", errs.length === 0, errs.slice(0, 3).join(" | "));
  ok("全程零非預期 4xx", bad.length === 0, bad.slice(0, 3).join(" | "));
  report.results = results; report.errs = errs; report.bad = bad; report.endedAt = new Date().toISOString();
  fs.writeFileSync(path.join(OUT, "journey-report.json"), JSON.stringify(report, null, 1));
  const fails = results.filter((r) => !r.pass).length;
  console.log(`\n旅程走查：${results.length - fails}/${results.length} 句成立${fails ? `，${fails} 句不成立` : ""}｜run＝${runId}｜截圖→${OUT}`);
  await browser.close();
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error("旅程腳本中斷：", e); process.exit(2); });
