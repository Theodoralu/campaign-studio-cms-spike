"use strict";
/**
 * W2 頁面組成面板瀏覽器驗收腳本（真點擊；playwright-core channel:chrome）
 * 用法：node test/browser/w2-content-modules-shots.js <serverPort> <outDir>
 * 前置：workbench server 起在 <serverPort>（測試埠 8796，勿碰 8787 正式服務）、
 *       runs/ 內有 QA 種子 2026-08-25-wb-cm1（建法＝docs/design-qa/content-modules-wave2-2026-08-25.md「可重跑」節；
 *       種子帶 approvedAt＝驗「加入區塊→核可失效」）。
 * 驗收面（story M3/M4/M6）：三 viewport 零水平溢出＋console 零 error；加入資訊卡→選版式→填內容（含真值欄
 * 人工照抄）→儲存→draft 落欄→非法 URL 被 400 白話擋→移除→核可失效（wb_meta.approvedAt 清空）；
 * 主打選品／促銷卡加入＋商品選擇器落 gdid；面板誠實告示（版面製作中）可見。
 */
if (process.env.NODE_TEST_CONTEXT) { // node --test 誤收本檔＝跳過（沿 w1d-combo-shots 守門）
  console.log("w2-content-modules-shots：手動 UI 驗收腳本（需 Chrome＋活 server），node --test 下跳過——手動跑：node test/browser/w2-content-modules-shots.js <serverPort> <outDir>");
  return;
}
const fs = require("fs");
const path = require("path");
const pw = require("playwright-core");

const PORT = process.argv[2] || "8796";
const OUT = process.argv[3] || path.join(__dirname, "..", "..", "docs", "design-qa", "content-modules-wave2-shots");
const BASE = `http://127.0.0.1:${PORT}`;
const RUNS = path.join(__dirname, "..", "..", "runs");
const SEED = "2026-08-25-wb-cm1";
fs.mkdirSync(OUT, { recursive: true });

const results = [];
const ok = (name, pass, note) => { results.push({ name, pass, note }); console.log(`${pass ? "✔" : "✖"} ${name}${note ? "｜" + note : ""}`); };
const readDisk = () => JSON.parse(fs.readFileSync(path.join(RUNS, SEED, "draft.json"), "utf8"));
const readMeta = () => JSON.parse(fs.readFileSync(path.join(RUNS, SEED, "wb_meta.json"), "utf8"));

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
  const EXPECTED_404 = /\/(product_check|gate_report)\.json$/; // 既有報告探測 404（非本批波及；沿 w1d 白名單）
  const openRunUi = async (page, id) => {
    await page.goto(BASE + "/", { waitUntil: "networkidle" });
    const row = page.locator(`tr:has(.idc:text-is("${id}")), tr:has-text("${id}")`).first();
    await row.locator("button.edit-btn").click();
    await page.waitForSelector("#sec-compose", { timeout: 8000 });
    await page.evaluate(() => ensureSectionOpen("sec-compose"));
    await page.waitForTimeout(1200);
  };
  const noHScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

  /* ── ① 三 viewport：頁面組成面板 零水平溢出＋console 零 error（面板文字截圖＝過使用者用） ── */
  for (const [vw, vh, tag] of [[1440, 900, "1440"], [768, 1024, "768"], [375, 812, "375"]]) {
    const page = await newPage(vw, vh);
    await openRunUi(page, SEED);
    await page.locator("#sec-compose").scrollIntoViewIfNeeded();
    await shots(page, `compose-panel-${tag}.png`);
    ok(`頁面組成面板 ${tag}：零水平溢出`, await noHScroll(page));
    const badHttp = page._http404.filter((u) => !EXPECTED_404.test(u.split(" ")[1] || ""));
    const benign = page._errs.filter((e) => !/favicon/i.test(e) && !(/Failed to load resource/.test(e) && badHttp.length === 0));
    ok(`頁面組成面板 ${tag}：console 零 error（預期報告探測 404 除外）`, benign.length === 0 && badHttp.length === 0, benign.concat(badHttp).slice(0, 3).join(" / "));
    if (vw !== 1440) await page.close();
    else { page._keep = true; global.__p = page; }
  }
  const page = global.__p;

  /* ── ② 加入活動資訊卡（種子帶 approvedAt＝同步驗核可失效） ── */
  ok("加入前＝種子已核可（approvedAt 在案）", !!readMeta().approvedAt);
  await page.locator('#sec-compose [data-cm-add="mechanic"]').click();
  await page.waitForFunction(() => draft.page.mechanic && draft.page.mechanic.variant === "info-offer-rows", null, { timeout: 8000 });
  await page.waitForTimeout(900);
  ok("加入資訊卡＝節點落草稿（預設排版・3 列）", await page.evaluate(() => draft.page.mechanic.rows.length === 3));
  ok("加入＝核可失效（approvedAt 清空＋失效紀錄）", !readMeta().approvedAt && !!readMeta().approvalInvalidatedAt);
  ok("誠實告示可見（版面製作中・內容已保存）", await page.evaluate(() => /版面製作中/.test(document.querySelector("#sec-compose").textContent) && /還在製作中/.test((document.querySelector("#sec-cm-mechanic") || {}).textContent || "")));
  ok("側欄導航出現「資訊卡」錨點", await page.evaluate(() => [...document.querySelectorAll("#sec-nav a")].some((a) => a.textContent === "資訊卡")));
  await page.evaluate(() => ensureSectionOpen("sec-cm-mechanic"));
  await page.locator("#sec-cm-mechanic").scrollIntoViewIfNeeded();
  await shots(page, "mechanic-added-1440.png");

  /* ── ③ 換版式（滿額贈雙列＝2 列）＋填內容（真值欄人工照抄）＋儲存＝draft 落欄 ── */
  await page.locator('#cm-mech-cards [data-cm-variant="info-gift-rows"]').click();
  await page.waitForFunction(() => draft.page.mechanic.variant === "info-gift-rows" && draft.page.mechanic.rows.length === 2, null, { timeout: 8000 });
  await page.waitForTimeout(700);
  ok("選版式＝滿額贈雙列（列數 3→2、贈品圖欄出現）", await page.evaluate(() => !!document.querySelector('[data-path="page.mechanic.rows.0.rewardImgs.0"]')));
  await page.locator("#sec-cm-mechanic").scrollIntoViewIfNeeded();
  await shots(page, "mechanic-variant-gift-rows-1440.png");
  await page.fill('[data-path="page.mechanic.rows.0.label"]', "滿額優惠1");
  await page.fill('[data-path="page.mechanic.rows.0.thresholdText"]', "滿 $999");
  await page.fill('[data-path="page.mechanic.rows.0.rewardText"]', "送 保養體驗組");
  await page.fill('[data-path="page.mechanic.rows.0.ctaUrl"]', "https://tw.buy.yahoo.com/activity/onsale?actid=999999");
  await page.fill('[data-path="page.mechanic.banner.titleLine1"]', "全民運動日");
  await page.locator("#btn-save").click();
  await page.waitForFunction(() => dirty === false, null, { timeout: 8000 });
  const disk1 = readDisk();
  ok("儲存＝內容落磁碟 draft（真值欄逐字）", disk1.page.mechanic.rows[0].thresholdText === "滿 $999" && disk1.page.mechanic.rows[0].rewardText === "送 保養體驗組" && disk1.page.mechanic.banner.titleLine1 === "全民運動日");

  /* ── ④ 機器閘（M5）：非法搶購連結＝儲存被 400 白話擋、不落盤 ── */
  await page.fill('[data-path="page.mechanic.rows.0.ctaUrl"]', "https://evil.example.com/x");
  await page.locator("#btn-save").click();
  await page.waitForTimeout(1200);
  const disk2 = readDisk();
  ok("非法網址＝儲存被擋（磁碟稿未變）", disk2.page.mechanic.rows[0].ctaUrl === "https://tw.buy.yahoo.com/activity/onsale?actid=999999");
  ok("擋下有白話出聲（toast/訊息含網域指引）", await page.evaluate(() => /Yahoo購物中心的網址/.test(document.body.textContent)));
  await shots(page, "mechanic-badurl-blocked-1440.png");
  await page.fill('[data-path="page.mechanic.rows.0.ctaUrl"]', "https://tw.buy.yahoo.com/activity/onsale?actid=999999");
  await page.locator("#btn-save").click();
  await page.waitForFunction(() => dirty === false, null, { timeout: 8000 });

  /* ── ⑤ 主打選品＋促銷卡：加入＋商品選擇器落 gdid ── */
  await page.evaluate(() => ensureSectionOpen("sec-compose"));
  await page.locator('#sec-compose [data-cm-add="spotlight"]').click();
  await page.waitForFunction(() => !!draft.page.spotlight, null, { timeout: 8000 });
  await page.waitForTimeout(700);
  await page.evaluate(() => ensureSectionOpen("sec-cm-spotlight"));
  const gd1 = await page.evaluate(() => String(draft.products[0].gdid));
  await page.selectOption('[data-path="page.spotlight.heroCard.gdid"]', gd1);
  await page.fill('[data-path="page.spotlight.title"]', "主打選品測試標題");
  await page.locator("#btn-save").click();
  await page.waitForFunction(() => dirty === false, null, { timeout: 8000 });
  const disk3 = readDisk();
  ok("主打選品＝節點＋商品選擇器落 gdid（真值由商品主檔 join）", disk3.page.spotlight.title === "主打選品測試標題" && String(disk3.page.spotlight.heroCard.gdid) === gd1);
  await page.locator("#sec-cm-spotlight").scrollIntoViewIfNeeded();
  await shots(page, "spotlight-added-1440.png");
  await page.evaluate(() => ensureSectionOpen("sec-compose"));
  await page.locator('#sec-compose [data-cm-add="promoCard"]').click();
  await page.waitForFunction(() => Array.isArray(draft.page.promoCards) && draft.page.promoCards.length === 1, null, { timeout: 8000 }); // 2026-08-26 多卡批：節點形＝promoCards[] 陣列
  await page.waitForTimeout(700);
  ok("促銷卡＝節點落草稿（多卡制陣列一張）", true);
  await page.evaluate(() => ensureSectionOpen("sec-compose"));
  await page.locator("#sec-compose").scrollIntoViewIfNeeded();
  await shots(page, "compose-all-added-1440.png");

  /* ── ⑥ 重複加入防線：已加入＝面板無「＋加入」鈕（每型至多一實例） ── */
  ok("每型至多一實例＝已加入者不再出「＋加入」", await page.evaluate(() => document.querySelectorAll("#sec-compose [data-cm-add]").length === 0));

  /* ── ⑦ 移除（白話確認框）＝節點清乾淨 ── */
  await page.evaluate(() => ensureSectionOpen("sec-cm-promocard"));
  await page.locator('#sec-cm-promocard [data-cm-remove="promoCard"]').click();
  await page.waitForSelector("#dlg.open");
  await shots(page, "remove-confirm-1440.png");
  await page.locator("#dlg-yes").click();
  await page.waitForFunction(() => !draft.page.promoCards && !draft.page.promoCard, null, { timeout: 8000 }); // 多卡批：整區塊移除＝promoCards 鍵消失
  await page.waitForTimeout(700);
  const disk4 = readDisk();
  ok("移除促銷卡＝磁碟稿節點清除（其餘不動）", !("promoCard" in disk4.page) && !("promoCards" in disk4.page) && !!disk4.page.spotlight && !!disk4.page.mechanic);
  await page.evaluate(() => ensureSectionOpen("sec-cm-spotlight"));
  await page.locator('#sec-cm-spotlight [data-cm-remove="spotlight"]').click();
  await page.waitForSelector("#dlg.open"); await page.locator("#dlg-yes").click();
  await page.waitForFunction(() => !draft.page.spotlight, null, { timeout: 8000 });
  await page.evaluate(() => ensureSectionOpen("sec-cm-mechanic"));
  await page.locator('#sec-cm-mechanic [data-cm-remove="mechanic"]').click();
  await page.waitForSelector("#dlg.open"); await page.locator("#dlg-yes").click();
  await page.waitForFunction(() => !draft.page.mechanic, null, { timeout: 8000 });
  await page.waitForTimeout(700);
  const disk5 = readDisk();
  ok("三區塊全移除＝draft 三節點清乾淨", !("mechanic" in disk5.page) && !("spotlight" in disk5.page) && !("promoCard" in disk5.page) && !("promoCards" in disk5.page));
  await page.evaluate(() => ensureSectionOpen("sec-compose"));
  await page.locator("#sec-compose").scrollIntoViewIfNeeded();
  await shots(page, "compose-after-remove-1440.png");

  const badHttpEnd = page._http404.filter((u) => !EXPECTED_404.test(u.split(" ")[1] || "") && !/400 /.test(u.split(" ")[0] + " ")).filter((u) => !u.startsWith("400 "));
  const benignEnd = page._errs.filter((e) => !/favicon/i.test(e) && !/Failed to load resource/.test(e));
  ok("全程 console 零 error（動線 400 白話擋屬預期回應）", benignEnd.length === 0, benignEnd.slice(0, 3).join(" / "));
  await page.close();

  await browser.close();
  const fails = results.filter((r) => !r.pass);
  console.log(`\n結果：${results.length - fails.length}/${results.length} 過`);
  if (fails.length) { console.log("未過：" + fails.map((f) => f.name).join("、")); process.exit(1); }
})().catch((e) => { console.error("腳本失敗：", e); process.exit(1); });
