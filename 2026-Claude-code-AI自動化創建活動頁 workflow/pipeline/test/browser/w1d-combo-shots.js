"use strict";
/**
 * W1-D 組合面板瀏覽器驗收腳本（真點擊；playwright-core channel:chrome）
 * 用法：node test/browser/w1d-combo-shots.js <serverPort> <outDir>
 * 前置：workbench server 起在 <serverPort>、runs/ 內有 QA 種子（2026-08-25-wb-combo1／-legacy1／-werr1；
 *       種子建法見 docs/design-qa/hero-wave1-combo-panel-2026-08-25.md「可重跑」節）。
 *       滾動上架制之後（2026-08-25 rebase）多版式動線要先解鎖：測試 server 啟動時帶
 *       GATE_REGISTRY_OVERRIDES='{"engineReady":["new","legacy","layout-002","layout-004","layout-006","layout-007"]}'
 *       （hermetic 注入通道＝gate.js 同一條；刻意不含 layout-008＝M1 引擎完工閘負向案例的樣本）。
 * 驗收面：三 viewport 零水平溢出＋console 零 error；換版式真點擊（卡→白話確認→套用）；
 *         折扣開關 kinRef 對換；背景/主題改選；legacy 專屬卡；中3 寫入失敗黃條（注入）；寫入失敗紅字（chmod 注入）；
 *         M1 引擎完工閘（未完工卡不出現＋提案包直傳被白話擋）；M2 偏離提案包徽章（pack 帶入→手動改＝徽章常駐）。
 */
if (process.env.NODE_TEST_CONTEXT) { // node --test 誤收本檔＝跳過（沿 w1c-cdp-shots 守門）
  console.log("w1d-combo-shots：手動 UI 驗收腳本（需 Chrome＋活 server），node --test 下跳過——手動跑：node test/browser/w1d-combo-shots.js <serverPort> <outDir>");
  return;
}
const fs = require("fs");
const path = require("path");
const pw = require("playwright-core");

const PORT = process.argv[2] || "8796";
const OUT = process.argv[3] || path.join(__dirname, "..", "..", "docs", "design-qa", "hero-wave1-combo-panel-shots");
const BASE = `http://127.0.0.1:${PORT}`;
const RUNS = path.join(__dirname, "..", "..", "runs");
fs.mkdirSync(OUT, { recursive: true });

const results = [];
const ok = (name, pass, note) => { results.push({ name, pass, note }); console.log(`${pass ? "✔" : "✖"} ${name}${note ? "｜" + note : ""}`); };

(async () => {
  const browser = await pw.chromium.launch({ channel: "chrome", headless: true });
  const shots = async (page, name) => page.screenshot({ path: path.join(OUT, name), fullPage: false });

  async function newPage(vw, vh) {
    const page = await browser.newPage({ viewport: { width: vw, height: vh } });
    const errs = [];
    const http404 = [];
    page.on("console", (m) => { if (m.type() === "error") errs.push(m.text()); });
    page.on("pageerror", (e) => errs.push(String(e)));
    page.on("response", (res) => { if (res.status() >= 400) http404.push(`${res.status()} ${res.url()}`); });
    page._errs = errs; page._http404 = http404;
    return page;
  }
  /* 既有行為的預期 404（非 W1-D 波及）：fresh run 進場 prefill 會探測報告檔——app 以 r.ok 分支處理、
     Chrome 仍記 console error。白名單只放這兩支報告探測；其他 4xx 一律算失敗。 */
  const EXPECTED_404 = /\/(product_check|gate_report)\.json$/;
  const openRunUi = async (page, id) => { // 真點擊列表「✏️ 編修」
    await page.goto(BASE + "/", { waitUntil: "networkidle" });
    const row = page.locator(`tr:has(.idc:text-is("${id}")), tr:has-text("${id}")`).first();
    await row.locator("button.edit-btn").click();
    await page.waitForSelector("#sec-combo", { timeout: 8000 });
    await page.evaluate(() => ensureSectionOpen("sec-combo")); // 區塊預設收合＝展開（偏好寫 localStorage，後續重繪保持開）
    await page.waitForTimeout(1200); // 預覽 iframe 注入
  };
  const noHScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

  /* ── ① 三 viewport：編修頁＋組合面板 零水平溢出＋console 零 error ── */
  for (const [vw, vh, tag] of [[1440, 900, "1440"], [768, 1024, "768"], [375, 812, "375"]]) {
    const page = await newPage(vw, vh);
    await openRunUi(page, "2026-08-25-wb-combo1");
    await page.locator("#sec-combo").scrollIntoViewIfNeeded();
    await shots(page, `combo-panel-${tag}.png`);
    ok(`組合面板 ${tag}：零水平溢出`, await noHScroll(page));
    const badHttp = page._http404.filter((u) => !EXPECTED_404.test(u.split(" ")[1] || ""));
    const benign = page._errs.filter((e) => !/favicon/i.test(e) && !(/Failed to load resource/.test(e) && badHttp.length === 0));
    ok(`組合面板 ${tag}：console 零 error（預期報告探測 404 除外）`, benign.length === 0 && badHttp.length === 0, benign.concat(badHttp).slice(0, 3).join(" / "));
    await page.close();
  }

  /* ── ② 換版式真點擊：006 卡態→點 004 卡→白話確認→套用（stash 列可見） ── */
  const page = await newPage(1440, 1000);
  await openRunUi(page, "2026-08-25-wb-combo1");
  ok("現值卡高亮（006）", await page.evaluate(() => { const el = document.querySelector('#sec-combo [data-combo-card="layout-006"]'); return el && el.classList.contains("on"); }));
  ok("理由行常駐（自動配版面緣由；顯示層＝reasonDisplay 無貨號版）", await page.evaluate(() => { const t = (document.querySelector("#sec-combo .combo-reason") || {}).textContent || ""; return /所以配上|先用/.test(t) && !/layout-\d{3}/.test(t) && !/\bAI\b/.test(t); }));
  // 先讓 006 有「使用者內容」＝驗暫存列會出現：文字槽走真輸入（DOM 綁定欄；直接改 draft 會被 collect() 蓋回）
  await page.evaluate(() => ensureSectionOpen("sec-kv"));
  await page.fill('textarea[data-path="page.hero.title-center"]', "使用者主標（QA）");
  await page.evaluate(() => { draft.page.hero["item-ring"] = { gdids: ["8458445", "11426208", "10325234", "11713254"] }; setDirty(true); }); // 商品槽無編修欄＝直改（模擬使用者調過商品序）
  await page.locator('#sec-combo [data-combo-card="layout-004"]').click();
  await page.waitForSelector("#dlg.open");
  await shots(page, "combo-switch-confirm-1440.png"); // 白話確認框
  await page.locator("#dlg-yes").click();
  await page.waitForFunction(() => draft.page.kvVariant === "layout-004", null, { timeout: 8000 });
  await page.waitForTimeout(800);
  ok("換版式落草稿（006→004）", true);
  ok("暫存列可見（未上場暫存）", await page.evaluate(() => /未上場暫存/.test((document.querySelector("#sec-combo .combo-stash") || {}).textContent || "")));
  ok("手動改選履歷（原 AI 建議）", await page.evaluate(() => /已手動改選（原 AI 建議/.test((document.querySelector("#sec-combo .combo-reason") || {}).textContent || "")));
  await page.locator("#sec-combo").scrollIntoViewIfNeeded();
  await shots(page, "combo-after-switch-004-1440.png");

  /* ── ③ 換回 006＝暫存還原＋強制重驗黃條 ── */
  await page.locator('#sec-combo [data-combo-card="layout-006"]').click();
  await page.waitForSelector("#dlg.open"); await page.locator("#dlg-yes").click();
  await page.waitForFunction(() => draft.page.kvVariant === "layout-006", null, { timeout: 8000 });
  await page.waitForTimeout(800);
  ok("換回還原（title 還原）", await page.evaluate(() => draft.page.hero["title-center"] === "使用者主標（QA）"));
  ok("強制重驗黃條可見", await page.evaluate(() => /驗完之前不能核可/.test((document.querySelector("#sec-combo .combo-warn:last-of-type") || document.querySelector("#sec-combo .combo-warn") || {}).textContent || "")));
  await page.locator("#sec-combo").scrollIntoViewIfNeeded();
  await shots(page, "combo-restore-recheck-1440.png");

  /* ── ④ 折扣開關（006→007 kinRef 對換） ── */
  await page.locator('#sec-combo [data-combo-card="layout-006"] .dtoggle input').click();
  await page.waitForSelector("#dlg.open");
  await shots(page, "combo-discount-confirm-1440.png");
  await page.locator("#dlg-yes").click();
  await page.waitForFunction(() => draft.page.kvVariant === "layout-007", null, { timeout: 8000 });
  ok("折扣開關＝kinRef 貨號對換（006→007）", true);
  await page.waitForTimeout(600);

  /* ── ⑤ 背景／主題改選 ── */
  await page.selectOption("#combo-bg", "bg-009");
  await page.waitForFunction(() => draft.page.backgroundId === "bg-009", null, { timeout: 8000 });
  ok("背景改選落草稿（bg-009・池外黃燈）", await page.evaluate(() => !!document.querySelector("#sec-combo .combo-note")));
  await page.selectOption("#combo-theme", "green-light");
  await page.waitForFunction(() => draft.page.themeId === "green-light", null, { timeout: 8000 });
  ok("主題改選落草稿（green-light）", true);
  await page.waitForTimeout(500);
  await page.locator("#sec-combo").scrollIntoViewIfNeeded();
  await shots(page, "combo-bg-theme-1440.png");

  /* ── ⑤b M2 偏離提案包徽章：pack 帶入＝無徽章→手動改＝徽章常駐 ── */
  await page.evaluate(() => { document.querySelector("#sec-combo details").open = true; });
  await page.fill("#combo-pack", JSON.stringify({ version: 1, layout: "layout-006", background: "bg-005", theme: "green-light", qaStatus: "candidate-pass" }));
  await page.locator("#combo-pack-apply").click();
  await page.waitForFunction(() => draft.page.kvVariant === "layout-006" && draft.meta.proposalPack && draft.meta.proposalPack.deviated === false, null, { timeout: 8000 });
  await page.waitForTimeout(600);
  ok("提案包帶入＝deviated:false、無偏離徽章", await page.evaluate(() => !/已偏離提案包/.test(document.querySelector("#sec-combo").textContent)));
  await page.selectOption("#combo-theme", "gold-dark"); // 手動改＝翻偏離
  await page.waitForFunction(() => draft.meta.proposalPack && draft.meta.proposalPack.deviated === true, null, { timeout: 8000 });
  await page.waitForTimeout(500);
  ok("手動改選後＝「已偏離提案包」徽章常駐", await page.evaluate(() => /已偏離提案包/.test(document.querySelector("#sec-combo").textContent)));
  await page.locator("#sec-combo").scrollIntoViewIfNeeded();
  await shots(page, "combo-m2-deviate-badge-1440.png");

  /* ── ⑤c M1 引擎完工閘：未完工卡不出現＋提案包直傳未完工＝白話擋（008 刻意不在解鎖名單） ── */
  ok("未完工版式（008）＝面板卡不出現", await page.evaluate(() => !document.querySelector('#sec-combo [data-combo-card="layout-008"]')));
  await page.evaluate(() => { document.querySelector("#sec-combo details").open = true; });
  await page.fill("#combo-pack", JSON.stringify({ version: 1, layout: "layout-008", qaStatus: "candidate-pass" }));
  await page.locator("#combo-pack-apply").click();
  await page.waitForFunction(() => (document.querySelector("#combo-error") || {}).style && document.querySelector("#combo-error").style.display === "block", null, { timeout: 8000 });
  ok("提案包帶入未完工版式＝白話擋（M1 後門收口）", await page.evaluate(() => /還在製作中/.test(document.querySelector("#combo-error").textContent)));
  ok("擋下後草稿未動（kvVariant 仍 006）", await page.evaluate(() => draft.page.kvVariant === "layout-006"));
  await page.locator("#sec-combo").scrollIntoViewIfNeeded();
  await shots(page, "combo-m1-engine-gate-1440.png");
  await page.evaluate(() => { document.querySelector("#combo-pack").value = ""; }); // 清場（後續步驟不受殘值影響）

  /* ── ⑥ 寫入失敗注入（chmod run 目錄唯讀）＝面板紅字出聲（D9／中3 家族） ── */
  const runDir = path.join(RUNS, "2026-08-25-wb-combo1");
  fs.chmodSync(runDir, 0o500);
  try {
    await page.selectOption("#combo-bg", "bg-016");
    /* M1 步驟的紅字常駐（設計行為）＝不能只等 display:block，要等「寫入失敗」新訊息本身出現 */
    await page.waitForFunction(() => { const el = document.querySelector("#combo-error"); return el && el.style.display === "block" && /組合變更失敗|寫入/.test(el.textContent); }, null, { timeout: 8000 });
    ok("寫入失敗＝面板紅字出聲（注入實測）", true);
    await page.waitForTimeout(500);
    await page.locator("#sec-combo").scrollIntoViewIfNeeded();
    await shots(page, "combo-write-fail-1440.png");
  } finally { fs.chmodSync(runDir, 0o700); }
  await page.close();

  /* ── ⑦ legacy 態：專屬卡不混九卡＋展開 ── */
  const lp = await newPage(1440, 1000);
  await openRunUi(lp, "2026-08-25-wb-legacy1");
  ok("legacy 態＝專屬卡一張（不混九卡）", await lp.evaluate(() => document.querySelectorAll("#sec-combo [data-combo-card]").length === 1));
  ok("legacy 態＝背景欄「不適用」", await lp.evaluate(() => /不適用/.test(document.querySelector("#sec-combo").textContent)));
  await lp.locator("#sec-combo").scrollIntoViewIfNeeded();
  await shots(lp, "combo-legacy-1440.png");
  await lp.locator("#combo-expand").click();
  await lp.waitForSelector('#sec-combo [data-combo-card="layout-006"]');
  ok("legacy 展開＝九貨號卡列出現", true);
  await lp.locator("#sec-combo").scrollIntoViewIfNeeded();
  await shots(lp, "combo-legacy-expanded-1440.png");
  ok("legacy 未改動＝draft 零請求（dirty=false）", await lp.evaluate(() => dirty === false));
  await lp.close();

  /* ── ⑧ 中3 遺留義務：版式寫入失敗黃條（meta.layoutChoiceWriteError 注入） ── */
  const wp = await newPage(1440, 1000);
  await openRunUi(wp, "2026-08-25-wb-werr1");
  ok("中3 注入＝進場黃條可見", await wp.evaluate(() => { const n = document.querySelector("#layout-engine-note"); return n && n.style.display === "block" && /版式選擇沒有存進/.test(n.textContent); }));
  await shots(wp, "combo-write-error-banner-1440.png");
  await wp.close();

  await browser.close();
  const fails = results.filter((r) => !r.pass);
  console.log(`\n結果：${results.length - fails.length}/${results.length} 過`);
  if (fails.length) { console.log("未過：" + fails.map((f) => f.name).join("、")); process.exit(1); }
})().catch((e) => { console.error("腳本失敗：", e); process.exit(1); });
