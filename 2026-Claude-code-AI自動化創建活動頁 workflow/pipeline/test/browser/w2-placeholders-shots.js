"use strict";
/**
 * 內文模組「示範態」旅程走查腳本（70 號 2026-09-09；真點擊；playwright-core channel:chrome）
 * 用法：node test/browser/w2-placeholders-shots.js <serverPort> <outDir>
 * 前置：workbench server 起在 <serverPort>（測試埠 8796，勿碰 8787 正式服務）；runs/ 內有 QA 種子 2026-08-25-wb-cm1。
 * 走的是使用者的路（52 號 §3-1a）：從活動清單點「編修」→ 左欄「可加入的區塊」小卡 → 加資訊卡 → 看四張真圖版面卡與欄位提示
 *   → 右邊預覽長出灰字示範句 → 點灰字左欄獲焦 → 打字那格換真字其他格仍灰 → 換版面（贈品圖／搶購鈕灰件）→ 主打選品／促銷卡同套
 *   → 反向：廠商 ?draftUrl= 頁零灰字 → 出貨閘 CP-31 對沒填完的稿紅燈。
 * 零件（不是旅程）：引擎三裝置示範態元素截圖＋每個灰件都落在自己模組框內、零水平溢出、零 console error（掃全部、不抽樣）。
 * 收尾把加進去的三塊移除＝種子回到乾淨態（沿 w2-content-modules-shots 慣例）。
 */
if (process.env.NODE_TEST_CONTEXT) { console.log("w2-placeholders-shots：手動 UI 驗收腳本（需 Chrome＋活 server），node --test 下跳過"); return; }
const fs = require("fs");
const path = require("path");
const os = require("os");
const { execFileSync } = require("child_process");
const pw = require("playwright-core");

const PORT = process.argv[2] || "8796";
const OUT = process.argv[3] || path.join(__dirname, "..", "..", "docs", "design-qa", "content-modules-placeholders-2026-09-09");
const BASE = `http://127.0.0.1:${PORT}`;
const RUNS = path.join(__dirname, "..", "..", "runs");
/* 2026-09-09 病例：走查直接用種子 2026-08-25-wb-cm1、收尾把三模組移除——使用者同一時間也在用那檔手測，畫面成了舊稿、換版面被擋「頁面上還沒有」。
   改＝每次走查先把種子複製成專用暫存檔（沿 design-qa 文件「種子建法」＝複製 run 目錄、改 page.id），跑完整個刪掉；種子與使用者手上的檔一律不碰。 */
const SEED_SRC = "2026-08-25-wb-cm1";
const SEED = "2026-09-09-wb-ghostqa-tmp";
function cloneSeed() {
  const from = path.join(RUNS, SEED_SRC), to = path.join(RUNS, SEED);
  if (fs.existsSync(to)) fs.rmSync(to, { recursive: true, force: true });
  fs.mkdirSync(to, { recursive: true });
  for (const f of ["draft.json", "snapshot.json", "wb_meta.json", "feedback_patch.json", "product_check.json"]) { const src = path.join(from, f); if (fs.existsSync(src)) fs.copyFileSync(src, path.join(to, f)); }
  const d = JSON.parse(fs.readFileSync(path.join(to, "draft.json"), "utf8"));
  if (d.page) { d.page.id = SEED; d.page.pageName = "走查暫存（自動建立、跑完即刪）"; delete d.page.mechanic; delete d.page.spotlight; delete d.page.promoCards; delete d.page.promoCard; }
  fs.writeFileSync(path.join(to, "draft.json"), JSON.stringify(d, null, 1));
}
function dropSeed() { try { fs.rmSync(path.join(RUNS, SEED), { recursive: true, force: true }); } catch (e) { console.warn("暫存檔刪不掉：", e.message); } }
cloneSeed();
process.on("exit", dropSeed);
fs.mkdirSync(OUT, { recursive: true });

const results = [];
const ok = (name, pass, note) => { results.push({ name, pass: !!pass, note: note || "" }); console.log(`${pass ? "✔" : "✖"} ${name}${note ? "｜" + note : ""}`); };
const readDisk = () => JSON.parse(fs.readFileSync(path.join(RUNS, SEED, "draft.json"), "utf8"));
const strip = (t) => String(t || "").replace(/\*\*/g, "");

(async () => {
  const hints = await (await fetch(`${BASE}/public/cms-hints.json`)).json();
  const browser = await pw.chromium.launch({ channel: "chrome", headless: true });
  const shot = (page, name) => page.screenshot({ path: path.join(OUT, name), fullPage: false });
  async function newPage(vw, vh) {
    const page = await browser.newPage({ viewport: { width: vw, height: vh } });
    const errs = [], bad = [];
    page.on("console", (m) => { if (m.type() === "error") errs.push(m.text()); });
    page.on("pageerror", (e) => errs.push(String(e)));
    page.on("response", (r) => { if (r.status() >= 400) bad.push(`${r.status()} ${r.url()}`); });
    page._errs = errs; page._bad = bad; return page;
  }
  const EXPECTED_404 = /\/(product_check|gate_report|price_qa_report)\.json$|\/favicon/;
  const cleanErrs = (page) => page._errs.filter((e) => !/favicon/i.test(e) && !(/Failed to load resource/.test(e) && page._bad.every((u) => EXPECTED_404.test(u))));
  const frameOf = (page) => page.frames().find((f) => /\/frametest\//.test(f.url()));
  const waitFrame = async (page, fn, arg, timeout = 12000) => {
    const t0 = Date.now();
    for (;;) {
      const fr = frameOf(page);
      if (fr) { try { if (await fr.evaluate(fn, arg)) return fr; } catch (e) { /* frame reloading */ } }
      if (Date.now() - t0 > timeout) throw new Error("waitFrame timeout: " + fn.toString().slice(0, 80));
      await page.waitForTimeout(250);
    }
  };
  const ghostCount = (fr, sel) => fr.evaluate((s) => document.querySelectorAll(s).length, sel);
  /* 點灰件前先把它捲到 iframe 視窗正中：引擎頁底有固定浮動導覽列，Playwright 預設只捲到「剛好看得到」＝常被導覽列蓋住、點到導覽列 */
  const clickGhost = async (fr, gp) => { const sel = `[data-ghost-path="${gp}"]`; await fr.locator(sel).first().evaluate((el) => el.scrollIntoView({ block: "center", inline: "nearest" })); await fr.waitForTimeout(250); await fr.locator(sel).first().click(); };

  /* ── 旅程 ── */
  const page = await newPage(1440, 900);
  await page.goto(BASE + "/", { waitUntil: "networkidle" });
  /* 清單頁的「編修」鈕在收合列裡不可見（QA 種子排在後段）——照鈕上綁的同一個 openRun(id) 進編修頁（同一條路、同一支程式） */
  const btn = page.locator(`tr:has-text("${SEED}")`).first().locator("button.edit-btn");
  if (await btn.count() && await btn.isVisible()) await btn.click(); else await page.evaluate((id) => openRun(id), SEED);
  await page.waitForSelector("#page-tree", { timeout: 10000 });
  await page.waitForFunction(() => typeof CMS_HINTS !== "undefined" && CMS_HINTS && draft, null, { timeout: 10000 });
  /* 種子有 33 件待修＝一進編修頁「發佈前檢查」浮窗自動打開、蓋住預覽——使用者會按 × 關掉（浮窗本身不在本批範疇），截圖才看得到預覽 */
  const chkClose = page.locator("#chk-float-close");
  if (await chkClose.count() && await chkClose.isVisible()) await chkClose.click();
  /* 起點清乾淨：種子若殘留三模組（上一輪測試），走正式移除通道拿掉 */
  for (const k of ["mechanic", "spotlight", "promoCard"]) {
    const has = await page.evaluate((k) => !!cmNodeOf(draft.page, k), k);
    if (has) { await page.evaluate((k) => cmApply({ kind: k, action: "remove" }), k); await page.waitForFunction((k) => !cmNodeOf(draft.page, k), k, { timeout: 8000 }); }
  }
  await page.waitForTimeout(600);

  // 1. 可加入的區塊＝縮圖＋名＋一句話
  const card = page.locator('#tree-add .ta-card[data-tree-add="mechanic"]');
  ok("①可加入的區塊：活動資訊卡小卡在（縮圖＋名＋一句話）", await card.count() === 1);
  await page.waitForFunction(() => { const i = document.querySelector('#tree-add .ta-card[data-tree-add="mechanic"] img'); return i && i.complete && i.naturalWidth > 0; }, null, { timeout: 8000 }).catch(() => {});
  ok("①小卡縮圖真的載到（母版圖）", await page.evaluate(() => { const i = document.querySelector('#tree-add .ta-card[data-tree-add="mechanic"] img'); return !!(i && i.naturalWidth > 0); }));
  ok("①小卡一句話＝欄位字典 MODULE_PLAIN.one", await page.evaluate(() => document.querySelector('#tree-add .ta-card[data-tree-add="mechanic"] .ta-one').textContent) === hints.modules.mechanic.one);
  ok("①三張小卡都在（主打選品／促銷卡）", await page.locator("#tree-add .ta-card").count() === 3);
  await shot(page, "01-tree-add-cards-1440.png");

  // 2. 加入資訊卡 → 版面卡真圖＋白話；欄位 placeholder
  await card.click();
  await page.waitForFunction(() => draft.page.mechanic && draft.page.mechanic.variant === "info-offer-rows", null, { timeout: 10000 });
  await page.waitForSelector("#cm-mech-cards .layout-card", { timeout: 8000 });
  await page.waitForFunction(() => [...document.querySelectorAll("#cm-mech-cards .layout-card .th img")].every((i) => i.complete && i.naturalWidth > 0) && document.querySelectorAll("#cm-mech-cards .layout-card .th img").length === 4, null, { timeout: 10000 }).catch(() => {});
  ok("②四張版面卡＝真長相圖（4 張全載到）", await page.evaluate(() => { const im = [...document.querySelectorAll("#cm-mech-cards .layout-card .th img")]; return im.length === 4 && im.every((i) => i.naturalWidth > 0); }));
  const names = await page.evaluate(() => [...document.querySelectorAll("#cm-mech-cards .layout-card b")].map((b) => b.textContent));
  ok("②版面卡名字＝欄位字典 VARIANT_PLAIN.name（與分析師頁同名）", JSON.stringify(names) === JSON.stringify(Object.values(hints.variants.mechanic).map((v) => v.name)), names.join("／"));
  const gl0 = await page.evaluate(() => document.querySelector("#cm-mech-cards .layout-card .gl").textContent);
  ok("②版面卡白話＝VARIANT_PLAIN.note（去粗體記號）", gl0 === strip(hints.variants.mechanic["info-offer-rows"].note));
  const phT = await page.getAttribute('[data-path="page.mechanic.rows.0.thresholdText"]', "placeholder");
  ok("②欄位框淺灰提示＝欄位字典 ph（滿額門檻）", phT === hints.fields.mechanic["rows[].thresholdText"].ph, phT);
  ok("②banner 圖 1 提示＝banner.imgs[] ph", await page.getAttribute('[data-path="page.mechanic.banner.imgs.0"]', "placeholder") === hints.fields.mechanic["banner.imgs[]"].ph);
  ok("②每個內文模組文字欄都有 placeholder（零漏）", await page.evaluate(() => [...document.querySelectorAll('#sec-cm-mechanic input[type="text"][data-path^="page.mechanic."]')].every((i) => (i.getAttribute("placeholder") || "").trim().length > 0)));

  // 3. 預覽長出灰字示範句
  const fr = await waitFrame(page, () => document.querySelectorAll("#cm-mechanic-body .cm-ghost").length >= 10);
  const gN = await ghostCount(fr, "#cm-mechanic-body .cm-ghost");
  ok("③預覽：資訊卡三列全空＝灰字示範句（≥15 格＋banner 框）", gN >= 15, "灰件 " + gN);
  ok("③灰字內容＝欄位字典 ghost（店家名）", await fr.evaluate(() => (document.querySelector('[data-ghost-path="page.mechanic.rows.0.brandName"]') || {}).textContent) === hints.fields.mechanic["rows[].brandName"].ghost);
  ok("③banner 空＝整框可點（data-ghost-path 指第一張圖）", await ghostCount(fr, '#cm-mechanic-body .cmm-banner[data-ghost-path="page.mechanic.banner.imgs.0"]') === 1);
  ok("③預覽沒有舊式「優惠內容待填」虛線框（示範態取代）", await fr.evaluate(() => !/優惠內容待填/.test(document.querySelector("#cm-mechanic-body").textContent)));
  await page.evaluate(() => syncPreviewTo("sec-cm-mechanic", true));
  await page.waitForTimeout(800);
  await shot(page, "02-mechanic-ghost-1440.png");

  // 4. 點灰字 → 左欄那格獲焦；打字 → 那格換真字、其他格仍灰
  await clickGhost(fr, "page.mechanic.rows.0.brandName");
  let focused = false;
  try { await page.waitForFunction(() => document.activeElement && document.activeElement.dataset && document.activeElement.dataset.path === "page.mechanic.rows.0.brandName", null, { timeout: 6000 }); focused = true; } catch (e) { /* 等不到＝下一行 ok() 會紅並印原因，不吞 */ }
  ok("④點預覽灰字＝左欄對應欄位獲焦（店家名）", focused, await page.evaluate(() => (document.activeElement && document.activeElement.dataset && document.activeElement.dataset.path) || document.activeElement.tagName));
  await page.fill('[data-path="page.mechanic.rows.0.brandName"]', "ASICS 亞瑟士官方旗艦");
  await waitFrame(page, () => { const b = document.querySelector("#cm-mechanic-body .cmm-row .cmm-brand:not(.cm-ghost)"); return b && b.textContent === "ASICS 亞瑟士官方旗艦"; });
  const fr2 = frameOf(page);
  ok("④打字＝那格換成真字", await fr2.evaluate(() => !!document.querySelector("#cm-mechanic-body .cmm-brand:not(.cm-ghost)") && !document.querySelector('[data-ghost-path="page.mechanic.rows.0.brandName"]')));
  ok("④其他格仍灰（第 2 列店家名、第 1 列滿額門檻）", await ghostCount(fr2, '[data-ghost-path="page.mechanic.rows.1.brandName"]') === 1 && await ghostCount(fr2, '[data-ghost-path="page.mechanic.rows.0.thresholdText"]') === 1);
  await shot(page, "03-mechanic-half-filled-1440.png");

  // 5. 換版面（滿額贈雙列）＝贈品圖灰框＋灰「搶購去」鈕
  /* 2026-09-09 使用者裁：換版面＝先列出會清掉什麼、確認後才換；店家名不在「滿額贈雙列」＝會被清掉 */
  await page.locator('#cm-mech-cards [data-cm-variant="info-gift-rows"]').click();
  await page.waitForSelector("#dlg.open", { timeout: 6000 });
  const dlgTxt = await page.locator("#dlg-body").textContent();
  ok("⑤換版面前先問：確認框列出「第 1 列的店家名」會被清掉", /第 1 列的店家名/.test(dlgTxt), dlgTxt.slice(0, 80));
  await page.locator("#dlg-yes").click();
  await page.waitForFunction(() => draft.page.mechanic.variant === "info-gift-rows", null, { timeout: 8000 });
  await page.waitForFunction(() => !document.querySelector('[data-path="page.mechanic.rows.0.brandName"]') && !!document.querySelector('[data-path="page.mechanic.rows.0.rewardImgs.0"]'), null, { timeout: 8000 }).catch(() => {}); /* 右欄重繪在核可徽章刷新之後一拍 */
  ok("⑤確認後：店家名資料清掉、面板不再顯示店家名／活動文案欄位（欄位跟著版面走）", await page.evaluate(() => draft.page.mechanic.rows[0].brandName === "" && !document.querySelector('[data-path="page.mechanic.rows.0.brandName"]') && !document.querySelector('[data-path="page.mechanic.rows.0.offerText"]')));
  ok("⑤面板出現搶購鈕文字欄＋建議字數（滿額贈雙列＝3 字）", await page.evaluate(() => { const el = document.querySelector('[data-path="page.mechanic.rows.0.ctaText"]'); return !!el && /最多 3 個字/.test(el.previousElementSibling ? el.previousElementSibling.textContent : ""); }));
  const fr3 = await waitFrame(page, () => document.querySelectorAll('#cm-mechanic-body [data-ghost-path$=".rewardImgs.0"]').length === 2);
  ok("⑤換版面＝2 列＋贈品圖灰框 ×2＋灰搶購鈕 ×2", await ghostCount(fr3, "#cm-mechanic-body .cm-ghost.cmm-btn") === 2 && await ghostCount(fr3, "#cm-mechanic-body .cm-ghost.cmm-gimg") === 2);
  ok("⑤換版面後左欄贈品圖欄有提示", (await page.getAttribute('[data-path="page.mechanic.rows.0.rewardImgs.0"]', "placeholder")) === hints.fields.mechanic["rows[].rewardImgs[]"].ph);
  ok("⑤重疊欄位保留：第 1 列滿額門檻等未被動到（只清不重疊的）", await page.evaluate(() => draft.page.mechanic.rows.length === 2 && draft.page.mechanic.rows[0].label === "" && Array.isArray(draft.page.mechanic.rows[0].rewardImgs)));
  await shot(page, "04-mechanic-gift-rows-ghost-1440.png");

  // 6. 主打選品
  await page.locator('#tree-add [data-tree-add="spotlight"]').click();
  await page.waitForFunction(() => !!draft.page.spotlight, null, { timeout: 10000 });
  const fr4 = await waitFrame(page, () => document.querySelectorAll("#cm-spotlight-body .cm-ghost").length >= 6);
  ok("⑥主打選品加入＝灰字（螢光標／大標題／副標／膠囊／斜帶）＋灰主打卡＋灰商品卡 ×2", await ghostCount(fr4, "#cm-spotlight-body .cm-ghost") >= 8, "灰件 " + await ghostCount(fr4, "#cm-spotlight-body .cm-ghost"));
  ok("⑥主打商品位＝誠實佔位卡＋欄位字典那句（不畫假商品）", await fr4.evaluate(() => (document.querySelector('[data-ghost-path="page.spotlight.heroCard.gdid"]') || {}).textContent) === hints.fields.spotlight["heroCard.gdid"].ghost);
  await page.evaluate(() => syncPreviewTo("sec-cm-spotlight", true)); await page.waitForTimeout(500);
  await clickGhost(fr4, "page.spotlight.heroCard.gdid");
  let f2 = false; try { await page.waitForFunction(() => document.activeElement && document.activeElement.dataset && document.activeElement.dataset.path === "page.spotlight.heroCard.gdid", null, { timeout: 6000 }); f2 = true; } catch (e) { /* 等不到＝下一行 ok() 會紅並印原因，不吞 */ }
  ok("⑥點灰主打卡＝左欄「大卡主打商品」下拉獲焦", f2);
  await shot(page, "05-spotlight-ghost-1440.png");

  // 7. 促銷卡
  await page.locator('#tree-add [data-tree-add="promoCard"]').click();
  await page.waitForFunction(() => !!cmNodeOf(draft.page, "promoCard"), null, { timeout: 10000 });
  const fr5 = await waitFrame(page, () => document.querySelectorAll("#cm-promocard-body .cm-ghost").length >= 3);
  ok("⑦促銷卡加入＝灰膠囊＋灰斜角＋灰商品卡", await ghostCount(fr5, "#cm-promocard-body .cm-ghost") >= 3);
  await page.evaluate(() => syncPreviewTo("sec-cm-promocard", true)); await page.waitForTimeout(500);
  await clickGhost(fr5, "page.promoCards.0.gdid");
  let f3 = false; try { await page.waitForFunction(() => document.activeElement && document.activeElement.dataset && document.activeElement.dataset.path === "page.promoCards.0.gdid", null, { timeout: 6000 }); f3 = true; } catch (e) { /* 等不到＝下一行 ok() 會紅並印原因，不吞 */ }
  ok("⑦點灰商品卡＝左欄促銷卡商品下拉獲焦", f3);
  await shot(page, "06-promocard-ghost-1440.png");
  await page.locator("#btn-save").click().catch(() => {});
  await page.waitForFunction(() => dirty === false, null, { timeout: 8000 }).catch(() => {});
  ok("旅程頁 console 零 error", cleanErrs(page).length === 0, cleanErrs(page).slice(0, 2).join(" / "));

  // 8. 反向：廠商 ?draftUrl= 頁零灰字；草稿檔零示範句
  const vend = await newPage(1440, 900);
  await vend.goto(`${BASE}/frametest/?draftUrl=/api/runs/${SEED}/draft.json&r=${Date.now()}#exp=panel:0`, { waitUntil: "networkidle" });
  await vend.waitForFunction(() => document.body.classList.contains("draft-mode"), null, { timeout: 15000 });
  await vend.waitForTimeout(800);
  ok("⑧廠商變更單頁（?draftUrl=）：零 .cm-ghost、零 data-ghost-path", await vend.evaluate(() => document.querySelectorAll(".cm-ghost,[data-ghost-path]").length === 0));
  const disk = readDisk();
  const ghostStrings = Object.values(hints.fields).flatMap((f) => Object.values(f).flatMap((x) => [x.ph, x.ghost])).filter(Boolean);
  const diskTxt = JSON.stringify(disk);
  ok("⑧草稿檔零示範句（真值鐵律：提示一個字都沒進資料）", ghostStrings.every((g) => !diskTxt.includes(g)));
  await vend.screenshot({ path: path.join(OUT, "07-vendor-draftUrl-no-ghost-1440.png") });
  await vend.close();

  // 9. 出貨閘：沒填完的稿＝CP-31 紅（走真實 gate CLI）
  {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gate-ph-"));
    const snap = fs.existsSync(path.join(RUNS, SEED, "snapshot.json")) ? path.join(RUNS, SEED, "snapshot.json") : path.join(__dirname, "..", "fixtures", "gate_pass_snapshot.json");
    const dp = path.join(dir, "draft.json"); fs.writeFileSync(dp, JSON.stringify(disk, null, 1));
    let out = "", status = 0;
    try { out = execFileSync("node", [path.join(__dirname, "..", "..", "gate.js"), snap, dp], { encoding: "utf8", env: { ...process.env, GATE_SKIP_HTTP: "1" } }); } catch (e) { status = e.status ?? 1; out = String(e.stdout || ""); }
    const cp31 = out.split("\n").filter((l) => /CP-31/.test(l));
    ok("⑨出貨閘：模組加了沒填完＝CP-31 紅燈（資訊卡列／主打選品／促銷卡）", status !== 0 && cp31.some((l) => /活動資訊卡第 1 列/.test(l)) && cp31.some((l) => /主打選品還沒挑主打商品/.test(l)) && cp31.some((l) => /促銷卡第 1 張/.test(l)), cp31.length + " 條");
    fs.writeFileSync(path.join(OUT, "gate-cp31-stdout.txt"), out);
  }

  // 9b. 使用者真正看到紅燈的地方＝CMS「發佈前檢查」面板按「重新檢查」（核可鈕本身不跑閘；部署鏈另跑 gate 全檢）
  {
    const opener = page.locator('button:has-text("發佈前還差"), button:has-text("發佈前檢查")').first();
    if (await opener.count()) await opener.click();
    await page.waitForSelector("#chk-float-body", { timeout: 8000 });
    const rerun = page.locator('#chk-float button:has-text("重新檢查")').first();
    if (await rerun.count()) await rerun.click();
    let seen = false;
    try { await page.waitForFunction(() => /活動資訊卡第 1 列還沒填/.test((document.querySelector("#chk-float-body") || {}).textContent || ""), null, { timeout: 30000 }); seen = true; } catch (e) { /* 等不到＝下一行 ok() 會紅並印原因，不吞 */ }
    ok("⑨b CMS「發佈前檢查」面板：重新檢查後看得到「活動資訊卡第 1 列還沒填」白話項", seen);
    ok("⑨b 面板同時列出主打選品／促銷卡沒挑商品", await page.evaluate(() => { const t = (document.querySelector("#chk-float-body") || {}).textContent || ""; return /主打選品還沒挑主打商品/.test(t) && /促銷卡第 1 張還沒挑商品/.test(t); }));
    await shot(page, "08-check-panel-cp31-1440.png");
    const cc2 = page.locator("#chk-float-close"); if (await cc2.count() && await cc2.isVisible()) await cc2.click();
  }

  // 9c. 本期活動：欄位跟著排版走（2026-09-09）——圓形時看不到舞台文字欄；點「主打選品舞台」先跳確認框列出會清掉的檔期；按取消＝零改動（不動種子的活動資料）
  {
    await page.evaluate(() => selectNode("sec-promo"));
    await page.waitForSelector("#cm-promo-cards", { timeout: 8000 });
    ok("⑨c 圓形入口卡：面板沒有「右欄副標／斜帶字」欄位（預覽也沒畫）", await page.evaluate(() => !document.querySelector('[data-path="page.promoSpotSubtitle"]') && !document.querySelector('[data-path="page.promoSpotDiagonal"]')));
    await page.locator('#cm-promo-cards [data-cm-promo-variant="spotlight-stage"]').click();
    let dlgOpen = false; try { await page.waitForSelector("#dlg.open", { timeout: 4000 }); dlgOpen = true; } catch (e) { /* 等不到＝下一行 ok() 會紅並印原因，不吞 */ }
    const txt = dlgOpen ? await page.locator("#dlg-body").textContent() : "";
    ok("⑨c 換成舞台＝先問：確認框列出會清掉的檔期或第 4 則起", dlgOpen && /檔期|第 4/.test(txt), txt.slice(0, 80));
    if (dlgOpen) await page.locator("#dlg-no").click();
    await page.waitForTimeout(400);
    ok("⑨c 按取消＝排版不變、資料零改動", await page.evaluate(() => (draft.page.promoVariant || "entry-circles") === "entry-circles"));
    await shot(page, "09-promo-variant-confirm-1440.png");
  }

  // 10. 零件：引擎三裝置示範態（全掃：每個灰件落在自己模組框內、零水平溢出、零 error）
  const draftNow = readDisk();
  for (const [dev, vw, vh] of [["", 1440, 900], ["tablet", 768, 1024], ["mobile", 375, 812]]) {
    const p = await newPage(vw, vh);
    await p.goto(`${BASE}/frametest/?${dev ? `device=${dev}&` : ""}r=${Date.now()}#exp=panel:0`, { waitUntil: "networkidle" });
    await p.waitForFunction(() => typeof loadDraftJson === "function", null, { timeout: 15000 });
    await p.evaluate(([d, h]) => loadDraftJson(d, "工作台即時編修", { cmsPreview: true, hints: h }), [draftNow, hints]);
    await p.waitForFunction(() => document.querySelectorAll(".cm-ghost").length > 0, null, { timeout: 10000 });
    await p.waitForTimeout(600);
    const tag = dev || "desktop";
    const geo = await p.evaluate(() => {
      const W = window.innerWidth; const bad = [];
      for (const g of document.querySelectorAll("[data-ghost-path]")) {
        const r = g.getBoundingClientRect(); const sec = g.closest("section"); const sr = sec ? sec.getBoundingClientRect() : null;
        if (r.width === 0 || r.height === 0) continue;
        if (r.right > W + 1 || r.left < -1) bad.push(g.dataset.ghostPath + " 溢出視窗 " + Math.round(r.right));
        const tf = getComputedStyle(g).transform; const rotated = /^matrix\(/.test(tf) && Math.abs(parseFloat(tf.split(",")[1])) > 0.01; /* 斜帶＝旋轉裝飾、設計上掛在卡角伸出模組框（真字同樣）＝只驗不溢出視窗 */
        if (!rotated && sr && (r.right > sr.right + 2 || r.left < sr.left - 2 || r.bottom > sr.bottom + 2 || r.top < sr.top - 2)) bad.push(g.dataset.ghostPath + " 出模組框");
      }
      return { n: document.querySelectorAll("[data-ghost-path]").length, bad, hscroll: document.documentElement.scrollWidth > W + 1 };
    });
    ok(`⑩引擎 ${tag}：${geo.n} 個灰件全在模組框內、零水平溢出`, geo.bad.length === 0 && !geo.hscroll, geo.bad.slice(0, 3).join("；"));
    for (const [id, nm] of [["sec-cm-mechanic", "mechanic"], ["sec-cm-spotlight", "spotlight"], ["sec-cm-promocard", "promocard"]]) {
      const el = p.locator("#" + id);
      if (await el.count()) { await el.scrollIntoViewIfNeeded(); await p.waitForTimeout(200); await el.screenshot({ path: path.join(OUT, `engine-${nm}-${tag}.png`) }).catch((e) => ok(`截圖 ${nm} ${tag}`, false, e.message)); }
    }
    ok(`⑩引擎 ${tag}：console 零 error`, cleanErrs(p).length === 0, cleanErrs(p).slice(0, 2).join(" / "));
    /* ⑩b 示範態不得改變版面幾何（使用者 2026-09-09 實測「加了示範句左右兩卡不等高」）：同一份稿，全空（示範態）vs 填滿真字，
       資訊卡的卡高必須一樣（±4px）；桌機／平板左 banner 與右卡同高（±4px）。兩款版面各驗一次。 */
    for (const variant of ["info-offer-rows", "info-gift-rows"]) {
      const mk = (filled) => { const d = JSON.parse(JSON.stringify(draftNow)); const need = variant === "info-gift-rows" ? 2 : 3;
        d.page.mechanic = { variant, banner: { img: "", imgs: ["", "", ""], badgeText: "", titleLine1: "", titleLine2: "", url: "" },
          rows: Array.from({ length: need }, (_, i) => filled ? { label: `618｜好禮${i + 1}`, brandName: "ASICS 亞瑟士官方旗艦", offerText: "秋冬新品 9 折起", thresholdText: "滿 $3,000", rewardText: "折 $300", rewardImgs: [], ctaUrl: "" } : { label: "", brandName: "", offerText: "", thresholdText: "", rewardText: "", rewardImgs: [], ctaUrl: "" }) };
        return d; };
      const measure = () => p.evaluate(() => { const c = document.querySelector("#cm-mechanic-body .cmm-card"), b = document.querySelector("#cm-mechanic-body .cmm-banner"); const rows = [...document.querySelectorAll("#cm-mechanic-body .cmm-row")].map((r) => Math.round(r.getBoundingClientRect().height)); return { card: c ? Math.round(c.getBoundingClientRect().height) : -1, banner: b ? Math.round(b.getBoundingClientRect().height) : -1, rows }; });
      await p.evaluate(([d, h]) => loadDraftJson(d, "工作台即時編修", { cmsPreview: true, hints: h }), [mk(false), hints]); await p.waitForTimeout(300);
      const g = await measure();
      await p.evaluate(([d, h]) => loadDraftJson(d, "工作台即時編修", { cmsPreview: true, hints: h }), [mk(true), hints]); await p.waitForTimeout(300);
      const f = await measure();
      const rowsEq = g.rows.length === f.rows.length && g.rows.every((h, i) => Math.abs(h - f.rows[i]) <= 4);
      ok(`⑩b ${tag} ${variant}：示範態卡高＝填滿卡高（±4）且每列同高`, Math.abs(g.card - f.card) <= 4 && rowsEq, `示範 ${g.card}／填滿 ${f.card}；列 ${g.rows.join(",")} vs ${f.rows.join(",")}`);
      if (tag !== "mobile") ok(`⑩b ${tag} ${variant}：示範態左 banner 與右卡同高（±4）`, Math.abs(g.card - g.banner) <= 4, `卡 ${g.card}／banner ${g.banner}`);
    }
    await p.close();
  }

  // 11. 收尾：三塊移除＝種子回乾淨態
  for (const k of ["promoCard", "spotlight", "mechanic"]) {
    await page.evaluate((k) => cmApply({ kind: k, action: "remove" }), k);
    await page.waitForFunction((k) => !cmNodeOf(draft.page, k), k, { timeout: 8000 });
  }
  ok("收尾：三模組移除通道正常（暫存檔隨後整個刪掉，種子與使用者手上的檔未被碰）", !readDisk().page.mechanic && !readDisk().page.spotlight && !readDisk().page.promoCards && fs.existsSync(path.join(RUNS, SEED_SRC, "draft.json")));
  await browser.close();

  const fails = results.filter((r) => !r.pass);
  fs.writeFileSync(path.join(OUT, "results.json"), JSON.stringify({ at: new Date().toISOString(), port: PORT, seed: SEED, results }, null, 1));
  console.log(`\n${fails.length ? "✖" : "✔"} 示範態旅程走查：${results.length - fails.length}/${results.length} 過${fails.length ? "；未過＝" + fails.map((f) => f.name).join("、") : ""}\n截圖＝${OUT}`);
  process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error("✖ 腳本中斷：", e); process.exit(2); });
