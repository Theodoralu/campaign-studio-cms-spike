/**
 * selftest_run.js —— FrameTest 頁內自測（runSelfTest）headless 執行器
 *
 * 用法：node selftest_run.js <FrameTest.html 路徑> [輸出.json]
 *   （輸出省略時寫 stdout；stderr 印逐集摘要）
 *
 * 機制：playwright-core + 系統 Chrome（channel:"chrome"，免下載瀏覽器），
 * 逐資料集載入 file://…#exp=test:1[,dataset:key]，等 document.title 出
 * SELFTEST:PASS/FAIL，收 #selftest-results 逐行＋console/pageerror/requestfailed。
 * 輸出格式對齊 qa/<日期夾>/results/selftest-out.json（key/title/pass/fail/error/failLines/...）。
 * 全集 fail=0 且 error=0 → exit 0，否則 exit 1（可與 price_qa 同作部署閘）。
 *
 * 2026-07-21 設立：先前 runner 存於 session scratchpad 隨清理滅失（07-20 收工快照記載），
 * 依三層保存規則入真相層、只升版不留舊檔。
 */
const { chromium } = require("playwright-core");
const fs = require("fs");
const path = require("path");

const ftPath = process.argv[2];
if (!ftPath || !fs.existsSync(ftPath)) {
  console.error("用法：node selftest_run.js <FrameTest.html 路徑> [輸出.json]");
  process.exit(2);
}
const outPath = process.argv[3] || null;

const DATASETS = [
  { key: "lecreuset(default)", hash: "#exp=test:1" },
  { key: "camping", hash: "#exp=test:1,dataset:camping" },
  { key: "keyboard", hash: "#exp=test:1,dataset:keyboard" },
  { key: "fashion", hash: "#exp=test:1,dataset:fashion" },
  { key: "titanium", hash: "#exp=test:1,dataset:titanium" },
  /* 第六集（51 號 W1-E E4，2026-08-24）：layout-006 掛 v2 殼跑迴歸——經 51 §7 煙霧通道 #exp=kv:layout-006。
   * 誠實註記涵蓋範圍：九版式真樣式未落地（W1-B 在途）＝本集只驗「不炸＋殼有掛＋legacy 內容零波及」
   * 三層（mode:shell-smoke＝runner 端顯式斷言），不跑頁內 152 斷言——實測掛殼跑全斷言＝1 紅
   * （U17 圓形圖等比公式寫死 1200 版心 vs v2 殼 --content-w:1224），該紅屬 W1-B 樣式批的斷言升級義務、
   * 不在此以豁免名單遮掉（假綠比紅更危險）；W1-B 落地＋selftest 斷言版心改讀變數後，本集改回 test:1 全斷言。 */
  { key: "layout006-shellv2(smoke)", hash: "#exp=kv:layout-006", mode: "shell-smoke", layout: "layout-006" },
];

/* shell-smoke 模式的 runner 端斷言（在頁面 context 執行；回傳 [名稱, 通過] 清單） */
async function shellSmokeChecks(page, d) {
  return page.evaluate((layout) => {
    const vis = (el) => !!(el && getComputedStyle(el).display !== "none");
    const checks = [];
    checks.push(["v2 殼已掛（body.shell-v2）", document.body.classList.contains("shell-v2")]);
    checks.push([`data-layout＝${layout}`, document.body.getAttribute("data-layout") === layout]);
    checks.push(["legacy 兩式 KV 已隱藏（雙殼互斥）", !vis(document.querySelector(".kv-variant-new")) && !vis(document.querySelector(".kv-variant-legacy"))]);
    checks.push(["v2 佔位骨架顯示（hero-v2）", vis(document.getElementById("hero-v2"))]);
    checks.push(["legacy 內容零波及：商品卡照渲染（>0）", document.querySelectorAll(".product-card").length > 0]);
    checks.push(["legacy 內容零波及：hero 以外模組照渲染（floors/walls 錨點在）", !!document.getElementById("sec-featured-1") || document.querySelectorAll("section[id^='sec-']").length > 3]);
    return checks;
  }, d.layout);
}

(async () => {
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const out = [];
  for (const d of DATASETS) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const consoleErrors = [], pageErrors = [], reqFailed = [];
    page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text().slice(0, 300)); });
    page.on("pageerror", (e) => pageErrors.push(String(e).slice(0, 300)));
    page.on("requestfailed", (r) => { const f = r.failure(); reqFailed.push(r.url().slice(0, 160) + " :: " + (f ? f.errorText : "?")); });
    await page.goto("file://" + encodeURI(path.resolve(ftPath)) + d.hash, { waitUntil: "load", timeout: 60000 });
    if (d.mode === "shell-smoke") {
      /* W1-E E4：不等頁內自測（未跑 test:1），runner 端顯式斷言＝不炸＋掛殼＋legacy 內容零波及 */
      await page.waitForFunction(() => document.body.classList.contains("shell-v2"), null, { timeout: 30000 })
        .catch(() => {}); // 掛殼失敗＝下面斷言如實紅，不在此吞掉
      const checks = await shellSmokeChecks(page, d);
      const failLines = checks.filter((c) => !c[1]).map((c) => "FAIL " + c[0]);
      if (pageErrors.length) failLines.push("FAIL 無 JS 執行錯誤（不炸）：" + pageErrors[0]);
      const title = failLines.length ? `SHELLSMOKE:FAIL(${failLines.length})` : "SHELLSMOKE:PASS";
      out.push({ key: d.key, title, pass: checks.length - failLines.length, fail: failLines.length, error: 0,
                 failLines, consoleErrors, pageErrors, reqFailed,
                 note: "驗證層級＝不炸＋掛殼＋legacy 內容零波及（W1-B 樣式落地後改回 test:1 全斷言）" });
      console.error(`[${d.key}] ${title}  pass=${checks.length - failLines.length} fail=${failLines.length}（smoke 層級）`);
      await page.close();
      continue;
    }
    await page.waitForFunction(() => /SELFTEST:(PASS|FAIL|SKIP)/.test(document.title), null, { timeout: 120000 });
    const title = await page.title();
    const lines = (await page.evaluate(() => document.getElementById("selftest-results").textContent)).split("\n");
    const pass = lines.filter((l) => l.startsWith("PASS")).length;
    const failLines = lines.filter((l) => l.startsWith("FAIL"));
    const errLines = lines.filter((l) => l.startsWith("ERROR"));
    out.push({ key: d.key, title, pass, fail: failLines.length, error: errLines.length,
               failLines: failLines.concat(errLines), consoleErrors, pageErrors, reqFailed });
    console.error(`[${d.key}] ${title}  pass=${pass} fail=${failLines.length} error=${errLines.length}`);
    await page.close();
  }
  await browser.close();
  const json = JSON.stringify(out, null, 1);
  if (outPath) fs.writeFileSync(outPath, json); else console.log(json);
  const bad = out.some((r) => r.fail > 0 || r.error > 0 || !/(SELFTEST|SHELLSMOKE):PASS/.test(r.title));
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error("RUNNER FATAL:", e); process.exit(1); });
