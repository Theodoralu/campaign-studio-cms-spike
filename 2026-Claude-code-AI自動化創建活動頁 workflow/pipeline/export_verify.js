/**
 * export_verify.js —— ZIP 匯出成品的「跨裝置渲染驗證」（2026-07-25 使用者需求）
 *
 * 用法：node export_verify.js <匯出index.html 路徑> <期望pageName> [輸出.json]
 *
 * 為何不用 selftest_run：selftest 是模板迴歸測試（驗 5 個示範資料集切換），與「單一活動交付檔」
 * 無關，且注入後的 dataset 切換自測不穩（2026-07-25 DJI 事故連鎖實證）。本檔改驗「成品實際渲染」：
 * 無 hash 直載（＝使用者雙擊/上傳後的真實情境）→ 三視窗（桌機/平板/手機）確認活動內容真的渲染出來
 *（KV 標題非預設、商品卡數量 >0、無 pageerror）＝更貼近使用者，也不被注入干擾。
 * 全視窗過→exit 0，否則 exit 1（作匯出閘）。
 */
const { chromium } = require("playwright-core");
const fs = require("fs");
const path = require("path");

const ftPath = process.argv[2];
const wantName = process.argv[3] || "";
const outPath = process.argv[4] || null;
if (!ftPath || !fs.existsSync(ftPath)) { console.error("用法：node export_verify.js <index.html> <pageName> [out.json]"); process.exit(2); }

const VIEWS = [
  { key: "desktop", width: 1440, height: 1000 },
  { key: "tablet", width: 768, height: 1024 },
  { key: "mobile", width: 375, height: 812 },
];

(async () => {
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const out = [];
  for (const v of VIEWS) {
    const page = await browser.newPage({ viewport: { width: v.width, height: v.height } });
    const pageErrors = [];
    page.on("pageerror", (e) => pageErrors.push(String(e).slice(0, 300)));
    const checks = [];
    try {
      await page.goto("file://" + encodeURI(path.resolve(ftPath)), { waitUntil: "load", timeout: 60000 });
      // 等注入的 loadDraftJson 套用（KV 標題脫離預設 Le Creuset；v2 殼 draft＝改等 shell-v2 掛上——
      // W1-E：kvVariant=layout-* 時 kv 節點休眠（14 §2.13），舊等待條件會空等 30s×3 視窗）
      await page.waitForFunction(() => {
        if (document.body.classList.contains("shell-v2")) return true;
        const t1 = document.getElementById("kv-title-1");
        return t1 && t1.textContent && t1.textContent.indexOf("法式") < 0;
      }, null, { timeout: 30000 }).catch(() => {});
      const kvTitle = await page.evaluate(() => (document.getElementById("kv-title-1") || {}).textContent || "");
      // 商品卡計數選擇器＝.product-card（W1-E 相容確認：v2 殼只換 hero、非 hero 模組卡照渲染＝選擇器不誤殺；
      // 新版式 hero 商品槽的「新卡結構」斷言＝W1-B 樣式落地後補列，此處註記不預先硬編未知結構）
      const cards = await page.evaluate(() => document.querySelectorAll(".product-card").length);
      const applied = await page.evaluate(() => window.activeDatasetKey === "draft" || (typeof draftMeta !== "undefined" && draftMeta !== null));
      // W1-E：draft 宣告 layout-*（含 kv- 前綴舊拼法正規化）＝匯出成品必須真的掛上 v2 殼且貨號一致
      const shell = await page.evaluate(() => {
        const dj = (typeof window.__WB_DRAFT__ === "object" && window.__WB_DRAFT__) || {};
        let want = dj.page && dj.page.kvVariant != null ? String(dj.page.kvVariant).trim() : null;
        if (want === "kv-new") want = "new"; else if (want === "kv-legacy") want = "legacy";
        const wantV2 = !!(want && /^layout-\d{3}$/.test(want));
        return { wantV2, want, hasV2: document.body.classList.contains("shell-v2"), got: document.body.getAttribute("data-layout") };
      });
      checks.push(["活動內容已套用（非預設集）", applied === true]);
      if (shell.wantV2) {
        checks.push([`版式殼一致（draft 宣告 ${shell.want}＝body 掛 shell-v2＋data-layout）`, shell.hasV2 && shell.got === shell.want]);
        // KV 標題檢查＝v2 殼不適用（kv 節點休眠不渲染＝14 §2.13）；hero 內容渲染斷言隨 W1-B 真樣式落地後補
      } else {
        checks.push(["KV 標題已渲染", !!kvTitle]);
        checks.push(["未宣告版式＝不得掛 v2 殼（雙殼互不相涉）", shell.hasV2 === false]);
      }
      checks.push(["商品卡有渲染（>0）", cards > 0]);
      // 消費者版純淨度：內部原型鷹架不得可見（2026-07-25 使用者指示）
      const scaffold = await page.evaluate(() => {
        const vis = (id) => { const e = document.getElementById(id); return !!(e && getComputedStyle(e).display !== "none" && e.offsetParent !== null); };
        return { exp: vis("exp-panel"), badge: vis("draft-badge"), wm: vis("preview-watermark") };
      });
      checks.push(["無 JS 執行錯誤", pageErrors.length === 0]);
      checks.push(["無內部主題切換面板（消費者版）", scaffold.exp === false]);
      checks.push(["無草稿徽章／預覽浮水印", scaffold.badge === false && scaffold.wm === false]);
    } catch (e) { checks.push(["頁面載入", false, String(e).slice(0, 200)]); }
    const fail = checks.filter((c) => !c[1]);
    out.push({ view: v.key, pass: checks.length - fail.length, fail: fail.length, failChecks: fail.map((c) => c[0] + (c[2] ? "：" + c[2] : "")), pageErrors });
    console.error(`[${v.key}] pass=${checks.length - fail.length} fail=${fail.length}${fail.length ? " ← " + fail.map((c) => c[0]).join("、") : ""}`);
    await page.close();
  }
  await browser.close();
  const json = JSON.stringify(out, null, 1);
  if (outPath) fs.writeFileSync(outPath, json); else console.log(json);
  process.exit(out.some((r) => r.fail > 0) ? 1 : 0);
})().catch((e) => { console.error("EXPORT-VERIFY 例外：" + e.message); process.exit(3); });
