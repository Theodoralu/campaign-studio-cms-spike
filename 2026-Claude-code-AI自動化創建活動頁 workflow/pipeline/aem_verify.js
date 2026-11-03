/**
 * aem_verify.js —— 「下載 AEM HTML」成品的對板閘（69 號 Phase 2，2026-09-10）
 *
 * 用法：node aem_verify.js <slim.html> <期望 layout-NNN> [--ref <full.html>] [--out report.json]
 *
 * 白話：把瘦身後的單檔在 Chrome 裡真的打開（桌機＋有觸控的平板＋有觸控的手機），確認
 *  ①活動內容真的套上、版型殼對　②零 JS 錯誤　③內部鷹架看不見、沒有「資料沒載入」紅色橫幅
 *  ④頁面沒去抓任何相對路徑檔案（單檔自足＝上傳 AEM 不會缺圖缺樣式）　⑤三裝置都不橫向溢出、觸控裝置真的切到手機／平板版面
 *  ⑥（帶 --ref 時）跟「沒瘦身的參照版」比：DOM 一模一樣、截圖像素幾乎一樣＝瘦身沒剝壞任何東西。
 * 外部網路一律擋掉（字型／商品圖）＝測試不靳網路、兩版字型狀態一致；擋掉的網域列成「上傳 AEM 要放行的外連清單」。
 * 全過→exit 0；否則 exit 1（作匯出閘）。沿 export_verify.js 形狀。
 */
const { chromium } = require("playwright-core");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const args = process.argv.slice(2);
const slimPath = args[0], wantLayout = args[1] || "";
const refPath = args.includes("--ref") ? args[args.indexOf("--ref") + 1] : null;
const outPath = args.includes("--out") ? args[args.indexOf("--out") + 1] : null;
if (!slimPath || !fs.existsSync(slimPath) || !/^layout-\d{3}$/.test(wantLayout)) { console.error("用法：node aem_verify.js <slim.html> <layout-NNN> [--ref full.html] [--out report.json]"); process.exit(2); }

/* 三裝置與 file:// 網址＝lib/aem_probe.js 單一真源（量尺工具也讀同一份，改一處兩邊一起變）。
   2026-09-18：原本這裡自己寫一份，而量 AEM 大小的臨時腳本各自又寫一份＝同一組視窗尺寸有三份，
   誰改了誰不知道。收成一份之後，「對板閘看到的畫面」與「量尺量到的畫面」一定是同一個。 */
const { VIEWS, fileUrl } = require("./lib/aem_probe");
const PIXEL_TOLERANCE = 0.001; // 千分之一的像素可以不同（抗鋸齒／浮點）

async function render(browser, htmlPath, v, opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: v.width, height: v.height }, isMobile: v.touch, hasTouch: v.touch, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const errs = [], external = new Set(), relative = [];
  const self = fileUrl(htmlPath);
  page.on("pageerror", (e) => errs.push(String(e).slice(0, 300)));
  await page.route("**/*", (route) => {
    const u = route.request().url();
    if (u === self || u.startsWith(self + "?") || u.startsWith(self + "#")) return route.continue();
    if (/^https?:/.test(u)) { external.add(new URL(u).host); return route.abort(); }
    relative.push(u.slice(0, 200)); return route.abort();
  });
  await page.addInitScript(() => { /* 凍結會動的東西＝兩版截圖可比（不動 rAF：引擎的排版量測靠它） */ window.setInterval = function () { return 0; }; });
  await page.goto(self, { waitUntil: "load", timeout: 60000 });
  await page.waitForFunction(() => document.body.classList.contains("shell-v2") && !!document.body.getAttribute("data-layout"), null, { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(1500);
  await page.addStyleTag({ content: "*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}" });
  await page.evaluate(async () => { for (let y = 0; y < document.body.scrollHeight; y += 600) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 30)); } window.scrollTo(0, 0); });
  await page.waitForTimeout(800);
  const facts = await page.evaluate(() => {
    const vis = (id) => { const e = document.getElementById(id); return !!(e && getComputedStyle(e).display !== "none" && e.offsetParent !== null); };
    /* 對板只比「看得見的 DOM」：display:none 的子樹（舊殼 KV、隱藏面板）不算——瘦身版把舊殼渲染器換成空殼，隱藏節點內容本來就會不同；
       視覺一致由像素比對守、互動元素由零錯誤守。先在活體標記再複製（clone 沒有 computed style）。 */
    document.body.querySelectorAll("*").forEach((e) => { if (getComputedStyle(e).display === "none") e.setAttribute("data-aemv-hidden", "1"); });
    const c = document.body.cloneNode(true);
    document.body.querySelectorAll("[data-aemv-hidden]").forEach((e) => e.removeAttribute("data-aemv-hidden"));
    c.querySelectorAll("[data-aemv-hidden]").forEach((n) => n.remove());
    c.querySelectorAll("script,style").forEach((n) => n.remove());
    ["#exp-panel", "#preview-watermark", "#draft-badge", "#draft-drop-overlay", "#device-preview-overlay", "#selftest-results"].forEach((s) => c.querySelectorAll(s).forEach((n) => n.remove()));
    const w = document.createTreeWalker(c, NodeFilter.SHOW_COMMENT); const dead = []; while (w.nextNode()) dead.push(w.currentNode); dead.forEach((n) => n.remove());
    const dom = c.innerHTML.replace(/\s+/g, " ").replace(/(\d+\.\d{2})\d+px/g, "$1px").trim(); // 小數第三位以後的排版浮點雜訊不算差異
    const banner = [...document.querySelectorAll("body > div")].some((d) => /活動資料沒有載入/.test(d.textContent || ""));
    return {
      maskLifted: !document.documentElement.classList.contains("aem-boot"), // 開機遮罩要在資料套上後掀掉（2026-09-10 使用者看到示範畫面閃現）
      shell: document.body.classList.contains("shell-v2"), layout: document.body.getAttribute("data-layout"),
      cards: document.querySelectorAll(".product-card").length, device: document.documentElement.dataset.device || null,
      scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth,
      scaffold: vis("exp-panel") || vis("draft-badge") || vis("preview-watermark"), banner, dom,
      title: document.title,
      /* 埋點存在性（75 號／62 D-6）：頁級參數推了沒、可見模組有沒有 slot 身分、商品卡有沒有貨號、掃描機有沒有出錯——漏一個＝紅燈擋交付 */
      ga: (() => { const dl = window.dataLayer || []; const pv = dl.filter((e) => e && e.event === "ec_page_view").pop();
        const secs = [...document.querySelectorAll("[data-ga-module]")].filter((el) => getComputedStyle(el).display !== "none");
        return { pageView: !!(pv && pv.promotion_id && pv.build_id && pv.content_group === "activity_ai"), errors: (window.__gaErrors || []).length,
          slotsMissing: secs.filter((el) => !el.getAttribute("data-ga-slot")).map((el) => el.id), secs: secs.length,
          cardsNoItem: [...document.querySelectorAll(".product-card")].filter((c) => !c.getAttribute("data-ga-item")).length, gtm: dl.some((e) => e && e.event === "gtm.js") }; })(),
    };
  });
  const shot = opts.screenshot ? await page.screenshot({ fullPage: true }) : null;
  await ctx.close();
  return { facts, errs, external: [...external].sort(), relative, shot, domHash: crypto.createHash("md5").update(facts.dom).digest("hex").slice(0, 10) };
}

async function pixelDiff(a, b) {
  const sharp = require("sharp");
  const [ma, mb] = await Promise.all([sharp(a).metadata(), sharp(b).metadata()]);
  if (ma.width !== mb.width || ma.height !== mb.height) return { sizeMismatch: `${ma.width}x${ma.height} vs ${mb.width}x${mb.height}` };
  const [ra, rb] = await Promise.all([sharp(a).raw().toBuffer(), sharp(b).raw().toBuffer()]);
  let d = 0; const ch = ma.channels || 3;
  for (let i = 0; i < ra.length; i += ch) if (Math.abs(ra[i] - rb[i]) > 8 || Math.abs(ra[i + 1] - rb[i + 1]) > 8 || Math.abs(ra[i + 2] - rb[i + 2]) > 8) d++;
  return { diffPixels: d, ratio: d / (ma.width * ma.height), size: `${ma.width}x${ma.height}` };
}

(async () => {
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const out = { file: slimPath, bytes: fs.statSync(slimPath).size, layout: wantLayout, ref: refPath, views: [], externalHosts: new Set() };
  let allOk = true;
  for (const v of VIEWS) {
    const checks = [];
    let s, r = null;
    try {
      s = await render(browser, slimPath, v, { screenshot: !!refPath });
      if (refPath) r = await render(browser, refPath, v, { screenshot: true });
    } catch (e) { checks.push(["頁面載入", false, String(e).slice(0, 200)]); }
    if (s) {
      s.external.forEach((h) => out.externalHosts.add(h));
      checks.push([`版型殼一致（body 掛 shell-v2＋data-layout=${wantLayout}）`, s.facts.shell && s.facts.layout === wantLayout, `got ${s.facts.layout}`]);
      checks.push(["商品卡有渲染（>0）", s.facts.cards > 0, `cards=${s.facts.cards}`]);
      checks.push(["無 JS 執行錯誤", s.errs.length === 0, s.errs.slice(0, 2).join(" | ")]);
      checks.push(["無內部鷹架可見", s.facts.scaffold === false]);
      checks.push(["開機遮罩已掀（資料套上後不再蓋著）", s.facts.maskLifted === true]);
      checks.push(["無「活動資料沒有載入」紅色橫幅", s.facts.banner === false]);
      checks.push(["埋點：頁級參數已推（ec_page_view 含 promotion_id＋build_id）", s.facts.ga.pageView]);
      checks.push([`埋點：可見模組皆有 slot 身分（${s.facts.ga.secs} 塊）`, s.facts.ga.slotsMissing.length === 0, s.facts.ga.slotsMissing.join(",")]);
      checks.push(["埋點：商品卡皆帶貨號 data-ga-item", s.facts.ga.cardsNoItem === 0, `缺 ${s.facts.ga.cardsNoItem}`]);
      checks.push(["埋點：掃描機零錯誤（window.__gaErrors）", s.facts.ga.errors === 0, `errors=${s.facts.ga.errors}`]);
      checks.push(["單檔自足：沒去抓任何相對路徑檔案", s.relative.length === 0, s.relative.slice(0, 3).join(" | ")]);
      checks.push([`不橫向溢出（scrollWidth ${s.facts.scrollWidth} ≤ 視窗 ${s.facts.innerWidth}）`, s.facts.scrollWidth <= s.facts.innerWidth + 2]);
      if (v.wantDevice) checks.push([`觸控裝置切到 ${v.wantDevice} 版面（data-device）`, s.facts.device === v.wantDevice, `got ${s.facts.device}`]);
      else checks.push(["桌機不套裝置版面", s.facts.device === null, `got ${s.facts.device}`]);
      if (r) {
        checks.push(["對板：DOM 與未瘦身參照版一致", s.domHash === r.domHash, `${s.domHash} vs ${r.domHash}`]);
        checks.push(["對板：參照版本身零錯誤", r.errs.length === 0, r.errs.slice(0, 2).join(" | ")]);
        try {
          const pd = await pixelDiff(s.shot, r.shot);
          if (pd.sizeMismatch) checks.push(["對板：截圖尺寸一致", false, pd.sizeMismatch]);
          else checks.push([`對板：截圖像素差 ${(pd.ratio * 100).toFixed(3)}%（${pd.diffPixels} px／${pd.size}）`, pd.ratio <= PIXEL_TOLERANCE]);
        } catch (e) { checks.push(["對板：像素比對", false, String(e).slice(0, 120)]); }
        if (s.domHash !== r.domHash) { // 首個差異處寫進報告，省人肉找
          const a = s.facts.dom, b = r.facts.dom; let i = 0; while (i < Math.min(a.length, b.length) && a[i] === b[i]) i++;
          checks.push(["對板：DOM 首個差異處", false, `瘦：${a.slice(Math.max(0, i - 60), i + 120)}\n     參：${b.slice(Math.max(0, i - 60), i + 120)}`]);
        }
      }
    }
    const fail = checks.filter((c) => !c[1]); if (fail.length) allOk = false;
    out.views.push({ view: v.key, pass: checks.length - fail.length, fail: fail.length, checks: checks.map((c) => ({ name: c[0], ok: c[1], note: c[2] || "" })) });
    console.error(`[${v.key}] pass=${checks.length - fail.length} fail=${fail.length}${fail.length ? "\n  ← " + fail.map((c) => c[0] + (c[2] ? "：" + c[2] : "")).join("\n  ← ") : ""}`);
  }
  /* 沒有 JavaScript 的環境（Finder 空白鍵預覽、被擋 script 的平台）：不得露出引擎內建的示範畫面——整頁該藏住並顯示白話說明 */
  {
    const checks = [];
    try {
      const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, javaScriptEnabled: false });
      const page = await ctx.newPage();
      await page.route("**/*", (route) => (route.request().url().startsWith("file://") ? route.continue() : route.abort()));
      await page.goto(fileUrl(slimPath), { waitUntil: "load", timeout: 60000 });
      const f = await page.evaluate(() => {
        const main = document.querySelector("main") || document.body.firstElementChild;
        const shown = [...document.body.children].filter((e) => getComputedStyle(e).visibility !== "hidden" && e.tagName !== "SCRIPT" && e.tagName !== "STYLE").length;
        const after = getComputedStyle(document.body, "::after").content || "";
        return { shown, after, mainVisible: main ? getComputedStyle(main).visibility : "(無 main)", demo: /Le ?Creuset|法式|鑄鐵/.test(document.body.innerText || "") };
      });
      checks.push(["無 JS 時整頁藏住（body 直屬元素全 hidden）", f.shown === 0, `shown=${f.shown} main=${f.mainVisible}`]);
      checks.push(["無 JS 時顯示白話說明（需要開啟 JavaScript）", /JavaScript/.test(f.after), f.after.slice(0, 60)]);
      await ctx.close();
    } catch (e) { checks.push(["無 JS 檢查", false, String(e).slice(0, 160)]); }
    const fail = checks.filter((c) => !c[1]); if (fail.length) allOk = false;
    out.views.push({ view: "no-js", pass: checks.length - fail.length, fail: fail.length, checks: checks.map((c) => ({ name: c[0], ok: c[1], note: c[2] || "" })) });
    console.error(`[no-js] pass=${checks.length - fail.length} fail=${fail.length}${fail.length ? "\n  ← " + fail.map((c) => c[0] + (c[2] ? "：" + c[2] : "")).join("\n  ← ") : ""}`);
  }
  await browser.close();
  out.externalHosts = [...out.externalHosts];
  console.error(`外連網域（上傳 AEM 需放行）：${out.externalHosts.join(", ") || "(無)"}`);
  /* AEM 頁面編輯上限的尺（2026-09-17）：只量、印、寫進報告，不算紅燈——硬閘等靜態化匯出器上線（story aem-static-export.md Q8） */
  try { out.budget = require("./lib/aem_export").measureAemBudget(fs.readFileSync(slimPath, "utf8")); console.error(`AEM 頁面編輯上限：編碎後 ${out.budget.encoded}／${out.budget.cap}＝${out.budget.ratio} 倍${out.budget.fits ? "（過）" : "（超標，只記不擋）"}`); }
  catch (e) { console.error("AEM 上限量尺失敗（不影響判定）：" + e.message); }
  console.error(allOk ? `✅ aem_verify 全過（${(out.bytes / 1024).toFixed(0)}KB）` : "❌ aem_verify 有紅燈");
  if (outPath) fs.writeFileSync(outPath, JSON.stringify(out, null, 1));
  process.exit(allOk ? 0 : 1);
})().catch((e) => { console.error("aem_verify 例外：" + e.message); process.exit(1); });
