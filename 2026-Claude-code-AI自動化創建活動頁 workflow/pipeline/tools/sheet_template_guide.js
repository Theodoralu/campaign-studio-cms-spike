"use strict";
/* tools/sheet_template_guide.js —— Excel／Google Sheets 範本的「欄位對照圖」與「建議字數」產生器（2026-09-27 使用者需求：一般用戶看不出範本欄位最後在活動頁長什麼樣、也不知道能填幾個字）
 *
 * 產物（兩份，都是機器產、不手改）：
 *   ① lib/content_module_char_limits.json —— 三個內文模組每一欄「放得下幾個全形字」：桌機 1264／平板 768／手機 375 各量一次＋取最小值。
 *      量法＝把「測」×N 直接填進畫面上那個元素，二分搜尋到「再多一個字就出事」：出事＝橫向溢出（scrollWidth>clientWidth，含尾端 …）
 *      ／縱向溢出（clamp 截行）／超出父框／折行超過該欄設計行數。單位＝全形字（半形約算 0.55，同 rules.json widthModel）。
 *   ② workbench/public/sheet-template-guide/*.png ＋ manifest.json —— 桌機 CMS 示範態截圖（灰字＝「欄位名，例：…」，來源 cms-hints.json）、
 *      每欄疊一顆編號徽章（編號＝範本欄位順序），商品位用灰圖＋「系統帶入」字樣。**不放任何真商品／真價格／真品牌**（真值鐵律；範本跟單機版出貨數月）。
 *
 * 引擎＝源頭檔 規劃/MVP_Phase1_LeCreuset_活動頁Prototype_FrameTest.html（file:// 直開，同 tools/spec_check.js 慣例；deploy-site 那份是它的鏡像）。
 * 用法：node tools/sheet_template_guide.js            （量字數＋截圖）
 *       node tools/sheet_template_guide.js --measure  （只量字數）
 *       node tools/sheet_template_guide.js --shots    （只截圖）
 * 引擎版面改了就重跑；範本產生器（lib/sheet_import.js）只讀這兩份產物，不自己算。 */
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright-core");
const sharp = require("sharp");

const PIPE = path.resolve(__dirname, "..");
const ROOT = path.resolve(PIPE, "..", "..");
const ENGINE = path.join(ROOT, "2026-AI自動化活動頁生成規劃", "MVP_Phase1_LeCreuset_活動頁Prototype_FrameTest.html");
const FIX = path.join(PIPE, "test", "fixtures", "gate_pass_draft.json");
const HINTS = path.join(PIPE, "workbench", "public", "cms-hints.json");
const OUT_LIMITS = path.join(PIPE, "lib", "content_module_char_limits.json");
const OUT_DIR = path.join(PIPE, "workbench", "public", "sheet-template-guide");
const CM = require(path.join(PIPE, "lib", "content_modules.js"));

for (const f of [ENGINE, FIX, HINTS]) if (!fs.existsSync(f)) { console.error(`缺檔：${f}`); process.exit(1); }
const reg = CM.loadContentRegistry();
const VARIANTS = (reg.mechanicVariants || []).map((v) => v.id);
const DEVICES = [{ id: "desktop", w: 1264 }, { id: "tablet", w: 768 }, { id: "mobile", w: 375 }];
const SHOT_W = 1264;

/* 假商品：灰圖＋名稱／價格寫明「系統帶入」——只為了讓卡片長出來，畫面上不會出現任何真值 */
const FAKE_IMG = "data:image/svg+xml;utf8," + encodeURIComponent(
  `<svg xmlns='http://www.w3.org/2000/svg' width='600' height='600'><rect width='100%' height='100%' fill='#E6E8EC'/><text x='50%' y='50%' font-size='38' text-anchor='middle' dominant-baseline='middle' fill='#8A939B' font-family='sans-serif'>商品圖（系統帶入）</text></svg>`);
const fakeProduct = (g, withOrig) => ({ gdid: String(g), name: "商品名稱（系統從商品頁帶入）", price: withOrig ? 100 : 0, marketPrice: withOrig ? 200 : 0, url: "https://tw.buy.yahoo.com/", img: FAKE_IMG, imgs: [FAKE_IMG] });
const G = { hero: "90000001", ref1: "90000002", ref2: "90000003", pc1: "90000004", pc2: "90000005" };

function baseDraft(withOrig) {
  const d = JSON.parse(fs.readFileSync(FIX, "utf8"));
  delete d.page.mechanic; delete d.page.spotlight; delete d.page.promoCards; delete d.page.promoCard;
  d.products = (d.products || []).concat(Object.values(G).map((g) => fakeProduct(g, withOrig)));
  return d;
}
const emptyBanner = () => ({ imgs: [], urls: [], badgeText: "", titleLine1: "", titleLine2: "", url: "" });
function mechanicDraft(variant, fillRow, banner, withOrig) {
  const d = baseDraft(withOrig); const n = CM.rowsCountFor(variant); const fields = CM.rowFieldsFor(variant);
  const rows = Array.from({ length: n }, () => { const r = CM.emptyInfoRow(); if (fillRow) for (const k of Object.keys(r)) { if (k === "rewardImgs") { if (fields.includes("rewardImgs")) r.rewardImgs = [FAKE_IMG]; } else if (k === "ctaUrl") { if (fields.includes("ctaUrl") || fields.includes("ctaText")) r.ctaUrl = "https://tw.buy.yahoo.com/"; } else if (fields.includes(k)) r[k] = "測"; } return r; });
  d.page.mechanic = { variant, banner: Object.assign(emptyBanner(), banner || {}), rows };
  return d;
}
function spotlightDraft(fill, withOrig) {
  const d = baseDraft(withOrig); const t = fill ? "測" : "";
  d.page.spotlight = { badgeText: t, title: t, subtitle: t, heroCard: { capsuleText: t, diagonalText: t, offerLine: t, gdid: G.hero }, productRefs: [G.ref1, G.ref2] };
  return d;
}
function promoDraft(fill, withOrig) {
  const d = baseDraft(withOrig); const t = fill ? "測" : "";
  d.page.promoCards = [G.pc1, G.pc2].map((g) => ({ capsuleText: t, diagonalText: t, offerLine: t, priceNote: fill ? "測" : "價格註記（例：超值優惠價）", gdid: g }));
  return d;
}

/* 欄位 → 畫面上的元素（第一列／第一張）。lines＝該欄設計上的行數（超過就算折行出事） */
const rowSel = (v, k) => ({
  label: ".cmm-row .cmm-label", brandName: ".cmm-row .cmm-brand", offerText: ".cmm-row .cmm-copy",
  thresholdText: v === "info-offer-rows" ? ".cmm-row .cmm-num > span:first-child" : ".cmm-row .cmm-th",
  rewardText: v === "info-offer-rows" ? ".cmm-row .cmm-num > span:last-child" : ".cmm-row .cmm-gname",
  ctaText: ".cmm-row .cmm-btn",
})[k];
const rowLines = (v, k) => (k === "rewardText" && v !== "info-offer-rows") ? 2 : 1;
const BANNER = [["badgeText", ".cmm-bovl .bo-cap", 1], ["titleLine1", ".cmm-bovl .bo-l:first-of-type", 1], ["titleLine2", ".cmm-bovl .bo-l:last-of-type", 1]];
const SPOT = [["badgeText", ".cmsp-neon", 1], ["title", ".cmsp-title", 1], ["subtitle", ".cmsp-sub", 1], ["capsuleText", ".cmsp-cap", 1], ["diagonalText", ".cmsp-diag.d1", 1], ["offerLine", ".cmsp-htheme", 1]];
const PROMO = [["capsuleText", ".cmpc .cmpc-label", 1], ["diagonalText", ".cmpc .cmpc-diag", 1], ["offerLine", ".cmpc .cmpc-theme", 1], ["priceNote", ".cmpc .cmpc-orig", 1, "原價 $1,299　｜"]]; // 價格註記跟「原價 $x　｜」共用一行＝量的時候把前綴算進去

/* 在頁面裡量：把「測」×N 填進元素，二分搜尋最大不出事的 N（同步量、不重載） */
/* 判「出事」的三條路（依元素的 CSS 自動選）：
   ①nowrap 單行欄＝文字實際寬（Range）＞可用寬（自身 content box；inline 元素用父盒；有 max-width 取小）→ 有 ellipsis 會截、沒有會撐破
   ②line-clamp 欄＝scrollHeight＞clientHeight（第 N+1 行被截）
   ③會折行的欄＝Range 行數＞設計行數
   另：絕對定位元素超出 offsetParent 右緣＝撐破卡框。量前把 transform 拿掉（斜帶字旋轉會讓包圍盒失真），量完還原。
   不用 scrollHeight 判一般文字：CJK 字型 content-area 常比 line-height 高 1~2px＝假陽性（第一輪全部歸零的原因）。 */
const MEASURE_JS = `(function(sel, lines, prefix){
  const el = document.querySelector(sel); if (!el) return { missing: true };
  const keep = el.innerHTML, keepT = el.style.transform;
  el.style.transform = "none";
  const cs = getComputedStyle(el);
  const clamp = cs.webkitLineClamp && cs.webkitLineClamp !== "none";
  const nowrap = cs.whiteSpace === "nowrap";
  const padX = (e) => { const b = getComputedStyle(e); return parseFloat(b.paddingLeft) + parseFloat(b.paddingRight); };
  const maxW = /px$/.test(cs.maxWidth) ? parseFloat(cs.maxWidth) - padX(el) : Infinity; // 只認 px 的 max-width；"100%" 這種交給 scrollWidth／父框判
  const lh = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.3;
  const text = () => { const r = document.createRange(); r.selectNodeContents(el); const rects = [...r.getClientRects()].filter((x) => x.width > 0); return { w: rects.reduce((m, x) => Math.max(m, x.width), 0), lines: rects.length }; };
  const bad = (n) => {
    el.textContent = (prefix || "") + "測".repeat(n);
    const t = text(); const r = el.getBoundingClientRect();
    const outer = cs.position === "absolute" ? el.offsetParent : el.parentElement; // 撐破外框＝出事（絕對定位比 offsetParent，其他比父元素）
    if (outer) { const pr = outer.getBoundingClientRect(); if (r.right > pr.right + 1) return true; }
    if (nowrap) { if (t.w > maxW + 1) return true; if (el.clientWidth > 0) return el.scrollWidth > el.clientWidth + 1; return t.w > el.parentElement.clientWidth - padX(el.parentElement) + 1; }
    if (clamp) return el.scrollHeight > el.clientHeight + Math.max(2, lh * 0.5); // 容忍 CJK 字型 content-area 比行高高 1~2px
    return t.lines > lines;
  };
  let lo = 0, hi = 60;
  while (lo < hi) { const mid = Math.ceil((lo + hi) / 2); if (bad(mid)) hi = mid - 1; else lo = mid; }
  el.innerHTML = keep; el.style.transform = keepT;
  return { max: lo, mode: nowrap ? "單行截斷" : clamp ? "截行" : "折行" };
})`;

async function openEngine(browser, device, w) {
  const page = await browser.newPage({ viewport: { width: w, height: 900 } });
  page.on("pageerror", (e) => console.warn(`  [pageerror ${device}] ${e.message}`));
  await page.goto("file://" + ENGINE + `?device=${device}#exp=panel:0`, { waitUntil: "load" });
  await page.waitForTimeout(1200);
  return page;
}
async function load(page, draft, opts) {
  const ok = await page.evaluate(([d, o]) => loadDraftJson(d, "範本指南", o), [draft, opts || {}]);
  if (ok === false) throw new Error("loadDraftJson 拒收（缺 page.kv／products？）");
  await page.waitForTimeout(700);
}
async function measureAll(browser) {
  const out = { mechanic: { banner: {}, rows: {} }, spotlight: {}, promoCard: {} };
  const put = (bag, key, dev, val) => { bag[key] = bag[key] || {}; bag[key][dev] = val; };
  for (const dv of DEVICES) {
    const page = await openEngine(browser, dv.id, dv.w);
    for (const v of VARIANTS) {
      await load(page, mechanicDraft(v, true, { badgeText: "測", titleLine1: "測", titleLine2: "測", imgs: [FAKE_IMG] }, true));
      out.mechanic.rows[v] = out.mechanic.rows[v] || {};
      if (v === VARIANTS[0]) for (const [k, sel, lines] of BANNER) put(out.mechanic.banner, k, dv.id, (await page.evaluate(`${MEASURE_JS}(${JSON.stringify(sel)},${lines})`)).max ?? null);
      for (const k of CM.rowFieldsFor(v)) { const sel = rowSel(v, k); if (!sel) continue; const r = await page.evaluate(`${MEASURE_JS}(${JSON.stringify(sel)},${rowLines(v, k)})`); put(out.mechanic.rows[v], k, dv.id, r.missing ? null : r.max); }
    }
    await load(page, spotlightDraft(true, true));
    for (const [k, sel, lines] of SPOT) { const r = await page.evaluate(`${MEASURE_JS}(${JSON.stringify(sel)},${lines})`); put(out.spotlight, k, dv.id, r.missing ? null : r.max); }
    await load(page, promoDraft(true, true));
    for (const [k, sel, lines, prefix] of PROMO) { const r = await page.evaluate(`${MEASURE_JS}(${JSON.stringify(sel)},${lines},${JSON.stringify(prefix || "")})`); put(out.promoCard, k, dv.id, r.missing ? null : r.max); }
    await page.close();
  }
  const fin = (bag) => { for (const k of Object.keys(bag)) { const v = bag[k]; const nums = DEVICES.map((d) => v[d.id]).filter((x) => typeof x === "number"); v.min = nums.length ? Math.min(...nums) : null; } };
  fin(out.mechanic.banner); for (const v of VARIANTS) fin(out.mechanic.rows[v]); fin(out.spotlight); fin(out.promoCard);
  /* 搶購鈕文字：rules.json 已有真源（CMS 寬度尺）——量到的值只當對照，寫檔時以量測為準但附註 */
  const json = { _產物: "機器量測、不手改；重產＝在 pipeline/ 跑 node tools/sheet_template_guide.js --measure（引擎版面改了就重跑）", generatedAt: new Date().toISOString(), engine: path.relative(ROOT, ENGINE), unit: "全形字（半形字約算 0.55，同 rules.json charLimits.widthModel）",
    method: "把「測」×N 填進畫面元素，桌機 1264／平板 768／手機 375 各量一次，二分搜尋到「再多一字就溢出／截斷／折行／超出父框」；min＝三裝置最小值＝範本建議值", devices: DEVICES.map((d) => d.id), ...out };
  fs.writeFileSync(OUT_LIMITS, JSON.stringify(json, null, 2) + "\n");
  console.log(`字數表 → ${path.relative(PIPE, OUT_LIMITS)}`);
  return json;
}

/* ---------- 截圖 ---------- */
const BADGE_CSS = `.__co{position:absolute;z-index:99;min-width:26px;height:26px;padding:0 6px;border-radius:13px;background:#3E5BFD;color:#fff;font:700 14px/26px -apple-system,"PingFang TC",sans-serif;text-align:center;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.35);box-sizing:border-box}.__co.b{background:#EB0F29}`;
const BADGE_JS = `(function(secId, items){
  const sec = document.getElementById(secId); if (!sec) return [];
  if (!document.getElementById("__co_css")) { const st = document.createElement("style"); st.id = "__co_css"; st.textContent = ${JSON.stringify(BADGE_CSS)}; document.head.appendChild(st); }
  sec.querySelectorAll(".__co").forEach((e) => e.remove()); sec.style.position = "relative";
  /* 固定定位的東西（草稿水印、dock）會壓進區塊截圖＝藏起來；水印還帶 fixture 的活動名 */
  document.querySelectorAll("body *").forEach((e) => { const p = getComputedStyle(e).position; if (p === "fixed" || p === "sticky") e.style.display = "none"; });
  const sr = sec.getBoundingClientRect(); const done = [];
  for (const it of items) {
    const el = sec.querySelector(it.sel); if (!el) { done.push({ n: it.n, missing: true }); continue; }
    const r = el.getBoundingClientRect(); const b = document.createElement("div"); b.className = "__co" + (it.red ? " b" : ""); b.textContent = it.n;
    let x, y; // 預設＝貼在元素左外側、垂直置中（不壓字）；pos:"tl"＝放進元素左上角內側（給圖片／卡片）
    if (it.pos === "tl") { x = r.left - sr.left + 8 + (it.dx || 0); y = r.top - sr.top + 8 + (it.dy || 0); }
    else { x = r.left - sr.left - 30 + (it.dx || 0); y = r.top - sr.top + (r.height - 26) / 2 + (it.dy || 0); }
    b.style.left = Math.max(0, x) + "px"; b.style.top = Math.max(0, y) + "px"; sec.appendChild(b); done.push({ n: it.n });
  }
  /* 假商品的價格一律改字＝畫面上不留任何金額 */
  document.querySelectorAll(".cmsp-hprice,.cmpc-price").forEach((e) => { e.textContent = "價格（系統帶入）"; e.style.fontSize = "18px"; });
  sec.querySelectorAll("*").forEach((e) => { if (!e.children.length && /^(NT)?\\$\\s?0$/.test(e.textContent.trim())) { e.textContent = "價格（系統帶入）"; e.style.fontSize = "14px"; } });
  return done;
})`;
async function shootAll(browser, hints) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const page = await openEngine(browser, "desktop", SHOT_W);
  const manifest = [];
  const shoot = async (secId, file, title, kind, variant, items) => {
    const done = await page.evaluate(`${BADGE_JS}(${JSON.stringify(secId)},${JSON.stringify(items)})`);
    await page.waitForTimeout(150);
    /* 鐵律 11 程式掃描（不靠肉眼）：截圖範圍內的所有文字，不得有金額、不得有假商品名以外的商品名；命中＝整批失敗 */
    const texts = await page.evaluate((id) => [...document.getElementById(id).querySelectorAll("*")].filter((e) => !e.children.length && e.textContent.trim()).map((e) => e.textContent.trim()), secId);
    /* 允許清單＝cms-hints 的示範句本身（例「滿 $3,000」「折 $300」＝2026-09-09 文案牆 Q3「金額示例保留數字」，是 CMS 自己的佔位例句、不是真值）；其餘帶金額的字一律擋 */
    const demoOk = new Set(Object.values(hints.fields || {}).flatMap((m) => Object.values(m).flatMap((f) => [f.ghost, f.ph].filter(Boolean))));
    const leak = texts.filter((t) => !demoOk.has(t) && (/(NT)?\$\s?\d|[0-9][0-9,]{2,}\s?元/.test(t) || (/商品名稱/.test(t) && !/系統/.test(t))));
    if (leak.length) throw new Error(`${file} 截圖範圍出現金額或非示範商品名：${leak.join(" | ")}`);
    const buf = await page.locator("#" + secId).screenshot({ type: "png" });
    const img = sharp(buf); const meta = await img.metadata(); const outW = Math.min(1100, meta.width);
    await img.resize({ width: outW }).png({ compressionLevel: 9, palette: true }).toFile(path.join(OUT_DIR, file));
    const m2 = await sharp(path.join(OUT_DIR, file)).metadata();
    manifest.push({ file, kind, variant: variant || null, title, width: m2.width, height: m2.height, missing: done.filter((d) => d.missing).map((d) => d.n), texts });
    console.log(`  ${file} ${m2.width}×${m2.height}${done.some((d) => d.missing) ? "  ⚠ 找不到徽章位置：" + done.filter((d) => d.missing).map((d) => d.n).join(",") : ""}`);
  };
  /* 活動資訊卡 ×4 版面：banner ①〜③（圖／連結欄不在畫面上有字，不掛徽章）、優惠列 ❶〜（紅）。編號＝範本欄序（lib/sheet_import.js 同一張表） */
  const bannerItems = [{ n: "1", sel: ".cmm-bovl .bo-cap" }, { n: "2", sel: ".cmm-bovl .bo-l:first-of-type" }, { n: "3", sel: ".cmm-bovl .bo-l:last-of-type" }, { n: "5", sel: ".cmm-banner .cmm-bimg", pos: "tl" }];
  const ROW_ORDER = ["label", "brandName", "offerText", "thresholdText", "rewardText", "rewardImg1", "rewardImg2", "ctaText"]; // ＝sheet_import ROW_COLS 去掉 ctaUrl（連結不在畫面上）
  for (const v of VARIANTS) {
    await load(page, mechanicDraft(v, false, { badgeText: "角標", titleLine1: "標題第一行", titleLine2: "標題第二行", imgs: [FAKE_IMG] }, false), { cmsPreview: true, hints });
    const fields = CM.rowFieldsFor(v); const imgCap = CM.rewardImgsCapFor(v);
    const items = bannerItems.slice();
    ROW_ORDER.forEach((k, i) => {
      const n = String(i + 1); let sel = null;
      let pos, dx = 0;
      if (k === "rewardImg1" || k === "rewardImg2") { const idx = Number(k.slice(-1)); if (fields.includes("rewardImgs") && idx <= imgCap) { sel = `.cmm-row .cmm-gimg:nth-of-type(${idx}), .cmm-row .cmm-gwrap .cm-ghost:nth-of-type(${idx}), .cmm-row .cm-ghost.cmm-gimg`; pos = "tl"; dx = idx === 2 ? 34 : 0; /* 示範態兩張贈品圖只有一個灰框＝兩顆徽章並排、不疊 */ } }
      else if (fields.includes(k)) sel = rowSel(v, k);
      if (sel) items.push({ n, sel, red: true, pos, dx });
    });
    const name = ((reg.mechanicVariants.find((x) => x.id === v) || {}).meaning || v).replace(/^.*・/, "").replace(/（.*$/, "").trim() || v;
    await shoot("sec-cm-mechanic", `mechanic-${v}.png`, `活動資訊卡・${name}`, "mechanic", v, items);
  }
  await load(page, spotlightDraft(false, false), { cmsPreview: true, hints });
  await shoot("sec-cm-spotlight", "spotlight.png", "主打選品", "spotlight", null, [
    { n: "1", sel: ".cmsp-neon" }, { n: "2", sel: ".cmsp-title" }, { n: "3", sel: ".cmsp-sub" }, { n: "4", sel: ".cmsp-cap" }, { n: "5", sel: ".cmsp-diag.d1", pos: "tl", dx: 52, dy: 52 }, { n: "6", sel: ".cmsp-htheme" },
    { n: "7", sel: ".cmsp-himg", pos: "tl", dx: 4, dy: 110 }, { n: "8", sel: ".cmsp-cards > *:nth-child(1)", pos: "tl" }, { n: "9", sel: ".cmsp-cards > *:nth-child(2)", pos: "tl" }]);
  await load(page, promoDraft(false, false), { cmsPreview: true, hints });
  await shoot("sec-cm-promocard", "promo-card.png", "促銷卡", "promoCard", null, [
    { n: "1", sel: ".cmpc .cmpc-label" }, { n: "2", sel: ".cmpc .cmpc-diag", pos: "tl", dx: 48, dy: 48 }, { n: "3", sel: ".cmpc .cmpc-theme" }, { n: "4", sel: ".cmpc .cmpc-orig" }, { n: "5", sel: ".cmpc .cmpc-img", pos: "tl", dx: 4, dy: 90 }]);
  await page.close();
  fs.writeFileSync(path.join(OUT_DIR, "manifest.json"), JSON.stringify({ _產物: "機器截圖、不手改；重產＝在 pipeline/ 跑 node tools/sheet_template_guide.js --shots（引擎版面或 cms-hints 文案改了就重跑）", generatedAt: new Date().toISOString(), engine: path.relative(ROOT, ENGINE), note: "桌機 CMS 示範態截圖；藍徽章＝該分頁欄序（活動資訊卡上半＝banner 欄），紅徽章＝活動資訊卡優惠列欄序。無真商品／真價格；每張的 texts＝截圖範圍內全部文字（鐵律 11 掃描留證）。", images: manifest }, null, 2) + "\n");
  console.log(`對照圖 → ${path.relative(PIPE, OUT_DIR)}/（${manifest.length} 張）`);
}

(async () => {
  const args = new Set(process.argv.slice(2));
  const doMeasure = !args.has("--shots"), doShots = !args.has("--measure");
  const hints = JSON.parse(fs.readFileSync(HINTS, "utf8"));
  const browser = await chromium.launch({ channel: "chrome" });
  try {
    if (doMeasure) await measureAll(browser);
    if (doShots) await shootAll(browser, hints);
  } finally { await browser.close(); }
})().catch((e) => { console.error("FAIL", e.stack || e.message); process.exit(1); });
