#!/usr/bin/env node
"use strict";
/**
 * tools/theme_slot_probe.js —— 逐部位微調「死格」探針（2026-10-07 設計反饋批）
 *
 * 用法：
 *   node tools/theme_slot_probe.js <run 資料夾或 draft.json>
 *   node tools/theme_slot_probe.js runs/2026-09-25-wb-202609
 *
 * 白話：色彩面板有 12 個可調的格子，但消費端是跟著版型、甚至跟著背景型態掛的——
 * 有的格子在某款版面上調了，畫面上零像素會變（死格）。這支把頁面用真 Chrome 開起來，
 * 每一格設一個哨兵色 rgb(1,2,3)，掃全頁（含偽元素）看有沒有「看得見的元素」真的變色，
 * 回答的是「這一檔活動、這款版面，哪幾格是活的、哪幾格是死的、活的改到哪裡」。
 *
 * 出身：2026-10-07 使用者反饋「調了顏色看不到畫面變化」的盤點工具（當天在 layout-005 實測
 * 抓到 6 死格，含全版型死格「行動按鈕」——引擎從未讀過 td.cta）。收編進 repo 的理由＝
 * 卡 20261005（逐格掃描工具只活在 session 暫存區、關掉即消失、已二次重寫）。
 * 它同時是「乙案」（面板執行期探測、死格灰化）的邏輯底稿——行事曆 CMS-DEADSLOT-PROBE。
 *
 * ⚠ 誠實記錄：下面 SLOT_VARS 是「CMS 槽 → 引擎變數」對映的**第二份名單**（真源＝引擎
 * applyThemeDraftColors，deploy-site/lecreuset-frametest/index.html）。乙案落地時要把這份
 * 名單消滅（面板直接在預覽 iframe 裡探測＝零名單）；在那之前，引擎加了新槽這裡要跟著補。
 */
const fs = require("fs");
const path = require("path");

const PIPE = path.join(__dirname, "..");
const ENGINE = path.join(PIPE, "..", "..", "2026-AI自動化活動頁生成規劃", "deploy-site", "lecreuset-frametest", "index.html");

/* CMS 槽（lib/theme_draft.js THEME_SLOTS 的 12 個可調格）→ 引擎變數＋需要的 body class */
const SLOT_VARS = [
  ["title", "標題", ["--campaign-title"], ["cc-title"]],
  ["subtitle", "副標題", ["--campaign-subtitle"], ["cc-subtitle"]],
  ["eventLabel", "活動時間標題", ["--campaign-event-label"], ["cc-eventlabel"]],
  ["eventDate", "活動時間日期", ["--campaign-event-date"], ["cc-eventdate"]],
  ["eyebrow", "強調色", ["--campaign-accent", "--campaign-accent-text", "--cm-accent"], []],
  ["cta", "行動按鈕", ["--campaign-cta"], []],
  ["cardBadge", "商品特色標", ["--campaign-card-badge", "--campaign-card-badge-text"], []],
  ["titleBadge", "標題特色標", ["--campaign-title-badge", "--campaign-title-badge-text"], []],
  ["latticeLine", "底紋線條", ["--campaign-lattice-line"], []],
  ["hero", "主視覺底色", ["--campaign-bg-hero"], []],
  ["section", "內容區塊底色", ["--campaign-bg-section", "--campaign-surface-floor-a", "--campaign-surface-floor-b"], []],
  ["page", "頁面底色", ["--campaign-bg-page", "--campaign-surface-page"], []],
];

const argPath = process.argv[2];
if (!argPath) { console.error("用法：node tools/theme_slot_probe.js <run 資料夾或 draft.json>"); process.exit(2); }
const draftPath = fs.statSync(argPath).isDirectory() ? path.join(argPath, "draft.json") : argPath;
if (!fs.existsSync(draftPath)) { console.error("❌ 找不到 " + draftPath); process.exit(2); }

(async () => {
  const { chromium } = require(path.join(PIPE, "node_modules", "playwright-core"));
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 1000 } })).newPage();
  const draftBuf = fs.readFileSync(draftPath);
  const self = "file://" + encodeURI(ENGINE);
  /* 外連一律餵 1×1 透明圖（abort 會畫破圖、位移漂）＝lib/aem_probe.js 同招 */
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8AAAwAB/AF/pOgVAAAAAElFTkSuQmCC", "base64");
  await page.route("**/*", (route) => {
    const u = route.request().url();
    if (u.startsWith(self)) return route.continue();
    if (/draft\.json/.test(u)) return route.fulfill({ status: 200, contentType: "application/json", body: draftBuf });
    if (u.startsWith("file://")) return route.continue();
    return route.fulfill({ status: 200, contentType: "image/png", body: png });
  });
  await page.goto(self + "?draftUrl=draft.json", { waitUntil: "load", timeout: 60000 });
  await page.waitForFunction(() => document.body.classList.contains("shell-v2") && !!document.body.getAttribute("data-layout"), null, { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(1500);
  await page.evaluate(async () => { for (let y = 0; y < document.body.scrollHeight; y += 600) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 30)); } window.scrollTo(0, 0); });
  await page.waitForTimeout(500);
  const layout = await page.evaluate(() => document.body.getAttribute("data-layout"));
  console.log(`死格探針｜${path.basename(path.dirname(draftPath))}｜版面 ${layout}｜哨兵 rgb(1,2,3)\n`);
  let dead = 0;
  for (const [key, label, vars, classes] of SLOT_VARS) {
    const r = await page.evaluate(async ([vars, classes]) => {
      const b = document.body; const PROPS = ["color", "backgroundColor", "backgroundImage", "borderTopColor", "borderRightColor", "borderBottomColor", "borderLeftColor", "boxShadow", "fill", "stroke", "webkitTextFillColor", "textShadow", "outlineColor"];
      b.classList.add("cc-on"); classes.forEach((c) => b.classList.add(c));
      vars.forEach((v) => b.style.setProperty(v, "#010203"));
      await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 120)));
      const hit = (s) => s && s.includes("rgb(1, 2, 3)");
      const found = [];
      const describe = (el) => { const mod = el.closest("[data-ga-module]"); const sec = el.closest("section[id],header[id],footer[id],nav[id]"); return (mod ? "模組 " + mod.getAttribute("data-ga-module") + "・" : "") + (sec ? "#" + sec.id + "・" : "") + el.tagName.toLowerCase() + (el.className && typeof el.className === "string" ? "." + el.className.split(/\s+/).slice(0, 2).join(".") : ""); };
      const visible = (el) => { const r = el.getBoundingClientRect ? el.getBoundingClientRect() : null; if (!r) return false; const cs = getComputedStyle(el); return cs.display !== "none" && cs.visibility !== "hidden" && el.getClientRects().length > 0 && r.width >= 2 && r.height >= 2; };
      for (const el of [document.documentElement, document.body, ...document.body.querySelectorAll("*")]) {
        if (["SCRIPT", "STYLE", "META", "LINK"].includes(el.tagName)) continue;
        let matched = null; const cs = getComputedStyle(el);
        for (const p of PROPS) { if (hit(cs[p])) { matched = p; break; } }
        if (!matched) { for (const ps of ["::before", "::after"]) { const c2 = getComputedStyle(el, ps); if (c2 && c2.content !== "none") { for (const p of PROPS) { if (hit(c2[p])) { matched = ps + " " + p; break; } } } if (matched) break; } }
        if (matched) found.push({ vis: visible(el), where: describe(el), prop: matched });
      }
      vars.forEach((v) => b.style.removeProperty(v)); classes.forEach((c) => b.classList.remove(c));
      await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 30)));
      const vis = found.filter((f) => f.vis);
      return { total: found.length, visible: vis.length, samples: [...new Set(vis.map((f) => f.where + "〔" + f.prop + "〕"))].slice(0, 4) };
    }, [vars, classes]);
    const verdict = r.visible > 0 ? "✅ 有畫面" : (r.total > 0 ? "🟡 只有隱藏元素＝這款版面上是死格" : "❌ 全頁零消費端");
    if (!r.visible) dead++;
    console.log(`【${label}】${verdict}（可見 ${r.visible}／總 ${r.total}）`);
    r.samples.forEach((s) => console.log("   ・" + s));
  }
  console.log(`\n結論：12 格裡 ${12 - dead} 活、${dead} 死（死＝這一檔調了畫面不會變）。`);
  await browser.close();
})().catch((e) => { console.error("❌ " + e.message); process.exit(1); });
