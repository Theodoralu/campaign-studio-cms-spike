"use strict";
/**
 * build_hero_kit_tables.js —— 量出每款版式在三種裝置上「文字在哪、商品在哪、哪裡能放插畫」，產 lib/hero_kit_tables.json
 *
 * 白話：背景製作說明包要告訴 Gemini 這類生圖工具「圖的哪一塊會被標題壓住、哪一塊會被商品卡蓋住、插畫該擺哪」。
 * 這些位置不能手抄（12 款 × 3 裝置＝36 組、版式一改就漂），所以用無頭 Chrome 把引擎真的畫出來量：
 *   文字區＝引擎藏標題表 HV2_TITLE_HIDE 那些容器的聯集（去掉純裝飾）；商品區＝各款商品容器；跑馬帶另記；銜接帶高度另記。
 * 換成「整張圖寬高的百分比」，再算 3×3 九宮格哪幾格是空的＝插畫可放的位置。
 *
 * 用法：node tools/build_hero_kit_tables.js [--frametest <mirror index.html>]
 * 產物：lib/hero_kit_tables.json（進單機包；由 lib/hero_bg_kit.js 讀）。引擎或版式改了就重跑（design-qa 收尾項）。
 * 示範內容沿 design-assets/layouts/spec/<layout>.<device>.json 的 demoHero／demoKv／demoProducts（與 spec_check 同一套）。
 * 2026-09-27 立（78 號；使用者實測：Gemini 圖的插畫壓到標題）。
 */
const fs = require("fs");
const path = require("path");
const PIPE = path.join(__dirname, "..");
const { HERO_STAGES } = require(path.join(PIPE, "lib", "hero_stages.js"));
const pw = require(path.join(PIPE, "node_modules", "playwright-core"));

const args = process.argv.slice(2);
const ftIdx = args.indexOf("--frametest");
const FRAMETEST = ftIdx >= 0 ? path.resolve(args[ftIdx + 1]) : path.join(PIPE, "..", "..", "2026-AI自動化活動頁生成規劃", "deploy-site", "lecreuset-frametest", "index.html");
const SPEC_DIR = path.join(PIPE, "..", "..", "design-assets", "layouts", "spec");
const OUT = path.join(PIPE, "lib", "hero_kit_tables.json");

/** 各款商品容器（畫面上會蓋住背景的東西）；純裝飾不算 */
const PRODUCT_SELS = {
  "layout-001": [".pcard"], "layout-002": [".pcard"], "layout-003": [".pcard"],
  "layout-004": [".l4-collage", ".l4-note", ".l4-chip"],
  "layout-005": [".l5-photo", ".l5-note", ".l5-chip"],
  "layout-006": [".ring", ".cat"], "layout-007": [".ring", ".cat"],
  "layout-008": [".s12-card"], "layout-009": [".s12-card"],
  "layout-010": [".l10-card"],
  "layout-011": [".l11-stage", ".l11-badge"],
  "layout-012": [".l12-cards"],
};
const DECOR_ONLY = new Set([".s12-arrow", ".l10-arc"]); // 藏標題表裡的純裝飾：不算文字區

const VIEWPORT = { desktop: { width: 1440, height: 900 }, tablet: { width: 768, height: 1024 }, mobile: { width: 375, height: 800 } };

function demoProductsOf(n) {
  return Array.from({ length: n }, (_, i) => ({ gdid: String(900001 + i), name: `對板示意商品${i + 1}（檢核專用非賣品）`, price: 100 * (i + 1), img: "assets/lecreuset-hero-source.jpg", tag: `示意標${i + 1}` }));
}
function fixtureFor(layout, device) {
  const f = path.join(SPEC_DIR, `${layout}.${device}.json`);
  if (fs.existsSync(f)) return JSON.parse(fs.readFileSync(f, "utf8"));
  const alt = path.join(SPEC_DIR, `${layout}.desktop.json`);
  return fs.existsSync(alt) ? JSON.parse(fs.readFileSync(alt, "utf8")) : { layout, demoHero: {}, demoProducts: 4 };
}
const r1 = (v) => Math.round(v * 10) / 10;
const clamp = (v) => Math.max(0, Math.min(100, v));

/** 頁內量測：回 { stage, text, products[], marquee, fade } 皆為舞台百分比 */
async function measure(page, layout) {
  return page.evaluate(({ layout, productSels, decor }) => {
    const cfg = HV2_STAGES[layout]; const stage = document.getElementById(cfg.id);
    if (!stage) return { error: "no stage" };
    const S = stage.getBoundingClientRect();
    const pct = (r) => ({ x: (r.left - S.left) / S.width * 100, y: (r.top - S.top) / S.height * 100, w: r.width / S.width * 100, h: r.height / S.height * 100 });
    const vis = (el) => { const cs = getComputedStyle(el); const r = el.getBoundingClientRect(); return cs.display !== "none" && cs.visibility !== "hidden" && r.width > 2 && r.height > 2; };
    const union = (rs) => { if (!rs.length) return null; const x1 = Math.min(...rs.map(r => r.x)), y1 = Math.min(...rs.map(r => r.y)); const x2 = Math.max(...rs.map(r => r.x + r.w)), y2 = Math.max(...rs.map(r => r.y + r.h)); return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 }; };
    const boxesOf = (sels) => { const out = []; for (const s of sels) for (const el of stage.querySelectorAll(s)) if (vis(el)) out.push(pct(el.getBoundingClientRect())); return out; };
    const textSels = (HV2_TITLE_HIDE[layout] || []).filter((s) => !decor.includes(s));
    /* 文字區＝容器內「真的有字的葉節點」聯集（容器常比字寬很多，量容器會把標題兩側的空位吃掉——2026-09-27 使用者實測：手機版插畫該擺標題兩側） */
    const leafBoxes = [];
    for (const sel of textSels) for (const c of stage.querySelectorAll(sel)) {
      if (!vis(c)) continue;
      const walker = document.createTreeWalker(c, NodeFilter.SHOW_TEXT);
      let node; while ((node = walker.nextNode())) {
        if (!node.nodeValue || !node.nodeValue.trim()) continue;
        const el = node.parentElement; if (!el || !vis(el)) continue;
        const rg = document.createRange(); rg.selectNodeContents(node); const r = rg.getBoundingClientRect();
        if (r.width > 2 && r.height > 2) leafBoxes.push(pct(r));
      }
    }
    const text = union(leafBoxes) || union(boxesOf(textSels));
    const products = boxesOf(productSels);
    const mq = union(boxesOf((HV2_MARQUEE_HIDE[layout] || [])));
    const fadeEl = stage.querySelector(".fade"); const fade = fadeEl && vis(fadeEl) ? pct(fadeEl.getBoundingClientRect()).h : null;
    return { stage: { w: S.width, h: S.height }, text, products, marquee: mq, fade };
  }, { layout, productSels: PRODUCT_SELS[layout] || [], decor: [...DECOR_ONLY] });
}

const CELL_NAMES = [["左上", "中上", "右上"], ["左中", "正中", "右中"], ["左下", "中下", "右下"]];
function overlapFrac(cell, boxes) {
  let covered = 0;
  for (const b of boxes) { const x1 = Math.max(cell.x, b.x), y1 = Math.max(cell.y, b.y), x2 = Math.min(cell.x + cell.w, b.x + b.w), y2 = Math.min(cell.y + cell.h, b.y + b.h); if (x2 > x1 && y2 > y1) covered += (x2 - x1) * (y2 - y1); }
  return Math.min(1, covered / (cell.w * cell.h));
}
function freeCells(text, products, marquee) {
  const occ = [...(text ? [text] : []), ...products, ...(marquee ? [marquee] : [])];
  const out = [];
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) { const cell = { x: c * 100 / 3, y: r * 100 / 3, w: 100 / 3, h: 100 / 3 }; if (overlapFrac(cell, occ) <= 0.2) out.push(CELL_NAMES[r][c]); }
  return out;
}
/** 可放插畫的帶（舞台百分比）：上／下／左／右整條帶＋「標題兩側」（與文字同高、左右各一塊、扣掉商品） */
function bands(text, products, marquee) {
  const occ = [...(text ? [text] : []), ...products, ...(marquee ? [marquee] : [])];
  const out = [];
  const topEdge = Math.min(...occ.map(b => b.y)); if (topEdge >= 8) out.push({ name: "上方橫帶", x1: 0, x2: 100, y1: 0, y2: r1(topEdge) });
  const botEdge = Math.max(...occ.map(b => b.y + b.h)); if (100 - botEdge >= 8) out.push({ name: "下方橫帶", x1: 0, x2: 100, y1: r1(botEdge), y2: 100 });
  const leftEdge = Math.min(...occ.map(b => b.x)); if (leftEdge >= 8) out.push({ name: "左側直帶", x1: 0, x2: r1(leftEdge), y1: 0, y2: 100 });
  const rightEdge = Math.max(...occ.map(b => b.x + b.w)); if (100 - rightEdge >= 8) out.push({ name: "右側直帶", x1: r1(rightEdge), x2: 100, y1: 0, y2: 100 });
  if (text) {
    const rowsOcc = products.filter(b => b.y < text.y + text.h && b.y + b.h > text.y); // 與文字同高的商品
    const leftLimit = Math.min(text.x, ...rowsOcc.filter(b => b.x + b.w <= text.x + 1).map(() => Infinity)); // 左側可用到文字左緣
    const leftBlock = rowsOcc.filter(b => b.x < text.x).reduce((m, b) => Math.max(m, b.x + b.w), 0);
    if (text.x - leftBlock >= 10) out.push({ name: "標題左側", x1: r1(leftBlock), x2: r1(text.x), y1: r1(text.y), y2: r1(text.y + text.h) });
    const rightBlock = rowsOcc.filter(b => b.x + b.w > text.x + text.w).reduce((m, b) => Math.min(m, b.x), 100);
    if (rightBlock - (text.x + text.w) >= 10) out.push({ name: "標題右側", x1: r1(text.x + text.w), x2: r1(rightBlock), y1: r1(text.y), y2: r1(text.y + text.h) });
    void leftLimit;
  }
  return out;
}
const posWord = (b) => { if (!b) return ""; const cx = b.x + b.w / 2, cy = b.y + b.h / 2; const v = cy < 38 ? "上方" : cy > 62 ? "下方" : "中段"; const h = cx < 38 ? "偏左" : cx > 62 ? "偏右" : "居中"; return v + h; };
const round = (b) => b ? { x: r1(clamp(b.x)), y: r1(clamp(b.y)), w: r1(Math.min(100, b.w)), h: r1(Math.min(100, b.h)) } : null;

(async () => {
  if (!fs.existsSync(FRAMETEST)) { console.error("找不到引擎鏡像：" + FRAMETEST); process.exit(1); }
  const browser = await pw.chromium.launch({ channel: "chrome", headless: true });
  const out = { _generated: new Date().toISOString(), _source: "tools/build_hero_kit_tables.js ← 引擎渲染實量（frametest 鏡像＋spec fixture 示範內容）；改版式或引擎後重跑。數字＝舞台寬高百分比（左上為 0）", _cells: "九宮格＝把圖切成 3×3，格名 左上／中上／右上／左中／正中／右中／左下／中下／右下；freeCells＝被文字或商品蓋到不超過 20% 的格子", layouts: {} };
  let bad = 0;
  for (const layout of Object.keys(HERO_STAGES)) {
    out.layouts[layout] = {};
    for (const device of ["desktop", "tablet", "mobile"]) {
      const page = await browser.newPage({ viewport: VIEWPORT[device] });
      const fx = fixtureFor(layout, device);
      const url = "file://" + FRAMETEST + (device === "desktop" ? "" : `?device=${device}`) + `#exp=kv:${layout}`;
      try {
        await page.goto(url, { waitUntil: "load" });
        await page.evaluate((d) => { loadDraftJson(d, "說明包量測"); }, { page: { kvVariant: layout, pageName: "說明包量測", kv: fx.demoKv || {}, hero: fx.demoHero || {} }, products: demoProductsOf(fx.demoProducts || 4) });
        await page.waitForTimeout(400);
        const m = await measure(page, layout);
        if (m.error) throw new Error(m.error);
        const text = round(m.text), products = m.products.map(round), marquee = round(m.marquee);
        out.layouts[layout][device] = {
          stage: { w: Math.round(m.stage.w), h: Math.round(m.stage.h) },
          text, products, marquee,
          fadePct: m.fade != null ? r1(m.fade) : null,
          freeCells: freeCells(m.text, m.products, m.marquee),
          bands: bands(m.text, m.products, m.marquee),
          textPos: posWord(m.text), productPos: posWord(m.products.length ? { x: Math.min(...m.products.map(b => b.x)), y: Math.min(...m.products.map(b => b.y)), w: Math.max(...m.products.map(b => b.x + b.w)) - Math.min(...m.products.map(b => b.x)), h: Math.max(...m.products.map(b => b.y + b.h)) - Math.min(...m.products.map(b => b.y)) } : null),
        };
        const L = out.layouts[layout][device];
        console.log(`${layout} ${device.padEnd(7)} 文字 ${text ? `x${text.x}–${r1(text.x + text.w)}% y${text.y}–${r1(text.y + text.h)}%` : "—"}｜商品 ${products.length} 塊｜帶 ${L.bands.map(b => `${b.name}(x${b.x1}–${b.x2} y${b.y1}–${b.y2})`).join("、") || "（無）"}`);
      } catch (e) { bad++; console.error(`✗ ${layout} ${device}: ${e.message}`); }
      await page.close();
    }
  }
  await browser.close();
  fs.writeFileSync(OUT, JSON.stringify(out, null, 1));
  console.log(`寫入 ${path.relative(PIPE, OUT)}；失敗 ${bad} 組`);
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
