/* W1-B12 design QA：layout-012 霓虹夜市三裝置實拍（K1 板圖 vs 實作並排證據的「實作」側）
   四態＝data（三件商品、一件帶劃線價）／empty（槽全空＝誠實態）／long（主標 12 字＝K3 換行往下長）／phrase（促購整句＝K4 小字塊收起）
   跑法：node test/browser/l012-shots.js [outDir]   預設輸出 docs/design-qa/layout-012-shots/ */
if (process.env.NODE_TEST_CONTEXT) { console.log("l012-shots：手動 design QA 實拍腳本（需 Chrome），node --test 下跳過——手動跑：node test/browser/l012-shots.js [outDir]"); return; } /* 沿 w1c/w1d 守門：pre-commit 的 node --test 不得重拍證據圖 */
const { chromium } = require("playwright-core");
const path = require("path");
const fs = require("fs");
const FILE = path.resolve(__dirname, "..", "..", "..", "..", "2026-AI自動化活動頁生成規劃", "MVP_Phase1_LeCreuset_活動頁Prototype_FrameTest.html");
const OUT = process.argv[2] ? path.resolve(process.argv[2]) : path.resolve(__dirname, "..", "..", "docs", "design-qa", "layout-012-shots");
fs.mkdirSync(OUT, { recursive: true });
const IMG = "file://" + path.resolve(__dirname, "..", "..", "..", "..", "2026-AI自動化活動頁生成規劃", "assets", "lecreuset-hero-source.jpg");
const DEV = { desktop: { q: "", vw: 1440, vh: 900 }, tablet: { q: "?device=tablet", vw: 768, vh: 1024 }, mobile: { q: "?device=mobile", vw: 375, vh: 812 } };
const prods = [
  { gdid: "901", name: "示意商品一 馬克杯 320ml（檢核專用非賣品）", img: IMG, price: 399, marketPrice: 598, tag: "導熱極佳均勻保溫" },
  { gdid: "902", name: "示意商品二 蛋蛋馬克杯 380ml 海岸藍", img: IMG, price: 1280, tag: "造型圓潤可愛討喜" },
  { gdid: "903", name: "示意商品三 馬克杯 400ml 鮭魚粉", img: IMG, price: 890, marketPrice: 1180, tag: "夢幻色彩飲水更美" },
];
const base = (hero, kv) => ({ page: { kvVariant: "layout-012", pageName: "design QA", kv: kv || { dateValue: "2026.09.09 ~ 09.30" }, hero }, products: prods });
const SLOT = (title) => [title, "限時 LIMITED", "整點開搶", "★ 陣區限時 ★｜整點開搶・數量有限"].join("\n");
const STATES = {
  data: base({ "slogan-left": SLOT("霓虹夜市 夜間限定"), "discount-digit": "85", "product-main": { gdids: ["901", "902", "903"] } }),
  empty: base({ "slogan-left": "", "discount-digit": "", "product-main": { gdids: [] } }, { dateValue: "" }),
  long: base({ "slogan-left": SLOT("霓虹夜市限時開搶整點特賣"), "discount-digit": "85", "product-main": { gdids: ["901", "902", "903"] } }),
  phrase: base({ "slogan-left": SLOT("霓虹夜市 夜間限定"), "discount-digit": "點數加倍送", "product-main": { gdids: ["901", "902"] } }),
};
(async () => {
  const browser = await chromium.launch({ channel: "chrome" });
  const rows = [];
  for (const [dev, D] of Object.entries(DEV)) for (const [st, draft] of Object.entries(STATES)) {
    const page = await browser.newPage({ viewport: { width: D.vw, height: D.vh } });
    const errs = [];
    page.on("pageerror", (e) => errs.push("PAGEERROR " + e.message));
    page.on("console", (m) => { if (m.type() === "error" && !/ERR_FILE_NOT_FOUND|net::/.test(m.text())) errs.push("CONSOLE " + m.text()); });
    await page.goto("file://" + FILE + D.q + "#exp=kv:layout-012", { waitUntil: "load" });
    await page.waitForTimeout(2200);
    await page.evaluate((d) => { loadDraftJson(d, "design QA"); }, draft);
    await page.waitForTimeout(1200);
    const measure = () => page.evaluate(() => {
      const st = document.getElementById("hv2-l012"); if (!st) return null;
      const r = st.getBoundingClientRect();
      const q = (sel) => { const el = st.querySelector(sel); if (!el) return null; const b = el.getBoundingClientRect(); return { x: +(b.left - r.left).toFixed(1), y: +(b.top - r.top).toFixed(1), w: +b.width.toFixed(1), h: +b.height.toFixed(1), display: getComputedStyle(el).display }; };
      return { stage: { w: r.width, h: r.height, overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth },
        col: q(".l12-col"), title: q(".l12-title"), promo: q(".l12-promo"), unit: q(".l12-promo-unit"), cards: Array.from(st.querySelectorAll(".l12-card")).map((c) => { const b = c.getBoundingClientRect(); return { x: +(b.left - r.left).toFixed(0), y: +(b.top - r.top).toFixed(0), w: +b.width.toFixed(0), h: +b.height.toFixed(0), was: getComputedStyle(c.querySelector(".l12-was")).display }; }),
        marquee: q(".l12-marquee"), dots: st.querySelectorAll(".l12-dot").length, dotOn: Array.from(st.querySelectorAll(".l12-dot")).findIndex((d) => d.classList.contains("on")) };
    });
    const m = await measure();
    const el = await page.$("#hv2-l012");
    const box = el ? await el.boundingBox() : null;
    const name = `${dev}-${st}.png`;
    if (box) await page.screenshot({ path: path.join(OUT, name), clip: { x: Math.max(0, box.x), y: Math.max(0, box.y), width: Math.min(D.vw, box.width), height: Math.min(D.vh + 400, box.height) } });
    rows.push({ name, m, errs });
    if (st === "data") { /* K6：等第一輪自動輪播（4s）跑完再量一次＝卡片換槽、DOM 依槽序歸位、主位圓點跟著移 */
      await page.waitForTimeout(4600); const m2 = await measure(); const b2 = await (await page.$("#hv2-l012")).boundingBox();
      const n2 = `${dev}-data-after1.png`;
      await page.screenshot({ path: path.join(OUT, n2), clip: { x: Math.max(0, b2.x), y: Math.max(0, b2.y), width: Math.min(D.vw, b2.width), height: Math.min(D.vh + 400, b2.height) } });
      rows.push({ name: n2, m: m2, errs });
      console.log(n2, `（第一輪輪播後）cards=${JSON.stringify(m2.cards)} dotOn=${m2.dotOn}`, errs.length ? "ERRS: " + errs.join(" | ") : "");
    }
    console.log(name, m ? `stage ${Math.round(m.stage.w)}x${Math.round(m.stage.h)} overflowX=${m.stage.overflowX} title.h=${m.title && m.title.h} promo.h=${m.promo && m.promo.h} unit=${m.unit && m.unit.display} cards=${JSON.stringify(m.cards)} dots=${m.dots}` : "STAGE MISSING", errs.length ? "ERRS: " + errs.join(" | ") : "");
    await page.close();
  }
  fs.writeFileSync(path.join(OUT, "measure.json"), JSON.stringify(rows, null, 1));
  await browser.close();
})();
