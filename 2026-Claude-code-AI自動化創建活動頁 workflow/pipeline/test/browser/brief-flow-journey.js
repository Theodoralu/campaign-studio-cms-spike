/* brief-flow-journey：C 批旅程走查（2026-09-15；story docs/stories/brief-first-create-flow.md Q1 C1～C7）
   C1 同事機從零（自起編修伺服器＋種子 run）：內容策略區三顆鈕、貼回型態寫錯→對帳卡不一致→照策略檔→重做→新草稿；C2 老手快車道（建立頁選檔型態不一致黃字＋一鍵）；
   C3 先不指定＝格關、編修頁補選；C4 策略檔頁三段；C6 舊資料；C7 歡迎三格。三寬度零 pageerror 零溢出。
   手動跑：node test/browser/brief-flow-journey.js <outDir>（需 Chrome、現役 8787）；node --test 下跳過。 */
if (process.env.NODE_TEST_CONTEXT) { console.log("brief-flow-journey：手動旅程走查（需 Chrome＋現役 8787），node --test 下跳過"); return; }
const fs = require("fs"), os = require("os"), path = require("path"), { spawn } = require("child_process");
const PIPE = path.resolve(__dirname, "..", "..");
const pw = require(path.join(PIPE, "node_modules", "playwright-core"));
const PASS = fs.readFileSync(path.join(PIPE, "workbench", ".wb-pass"), "utf8").trim();
const OUT = process.argv[2] || path.join(os.tmpdir(), "brief-flow-journey"); fs.mkdirSync(OUT, { recursive: true });
const SEED = "2026-09-14-wb-143442", SEED2 = "2026-09-14-wb-143442-noscen";
let pass = 0, fail = 0; const ok = (n, c, note = "") => { (c ? pass++ : fail++); console.log(`${c ? "✔" : "✖"} ${n}${note ? "　" + String(note).slice(0, 140) : ""}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function startEditorServer() {
  const runs = fs.mkdtempSync(path.join(os.tmpdir(), "bf-runs-")), briefs = fs.mkdtempSync(path.join(os.tmpdir(), "bf-briefs-")); const port = 20000 + Math.floor(Math.random() * 900);
  fs.cpSync(path.join(PIPE, "runs", SEED), path.join(runs, SEED), { recursive: true }); fs.cpSync(path.join(PIPE, "runs", SEED), path.join(runs, SEED2), { recursive: true });
  /* 種子是「活的」真實 run——負責人在 CMS 上每做一次商品檢查／套用變價就多一個 draft.vN.json，會跟著複製過來。
     C1 斷言的是「draft.v1.json 存在」＝種子自己帶 v1 進來就會**假綠**：測試根本沒做備份也會過
     （2026-09-21 病例：10:53 一筆真實的「一鍵套用全部變價：6 件」留下 v1／v2；同族的
     server_brief_flow ⑥ 因為斷言「等於 v1」而是假紅，這支斷言「存在」所以是假綠，更難發現）。
     清掉帶過來的備份＝C1 驗到的一定是這一趟自己做的那次。真實 runs 不動。 */
  for (const dir of [SEED, SEED2]) {
    for (const f of fs.readdirSync(path.join(runs, dir))) {
      if (/^draft\.v\d+\.json$/.test(f)) fs.rmSync(path.join(runs, dir, f));
    }
  }
  fs.cpSync(path.join(PIPE, "briefs", "built-in"), path.join(briefs, "built-in"), { recursive: true });
  const m2p = path.join(runs, SEED2, "wb_meta.json"); const m2 = JSON.parse(fs.readFileSync(m2p, "utf8")); m2.id = SEED2; m2.input.scenario = ""; m2.input.briefFile = ""; fs.writeFileSync(m2p, JSON.stringify(m2, null, 1));
  const env = { ...process.env, CAMPAIGN_MODE: "editor", CAMPAIGN_RUNS_DIR: runs, CAMPAIGN_BRIEFS_DIR: briefs, CAMPAIGN_CAPS: "ai:0,publish:0,vendorSheet:0" }; delete env.WB_PASS;
  const ch = spawn(process.execPath, [path.join(PIPE, "workbench", "server.js"), String(port)], { env, stdio: ["ignore", "pipe", "pipe"] });
  let log = "", lastErr = null; ch.stdout.on("data", (d) => { log += d; }); ch.stderr.on("data", (d) => { log += d; });
  for (let i = 0; i < 200; i++) { try { if ((await fetch(`http://127.0.0.1:${port}/ping`)).status === 204) { lastErr = null; break; } } catch (e) { lastErr = e; } await sleep(300); }
  if (lastErr) throw new Error("編修伺服器起不來：" + lastErr.message + "\n" + log.slice(-600));
  return { ch, port, runs, briefs, log: () => log };
}
const overflow = (p) => p.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
const shot = (p, n) => p.screenshot({ path: path.join(OUT, n + ".png") });
async function ctxPage(b, w, auth, keepWelcome) {
  const ctx = await b.newContext({ viewport: { width: w, height: 1000 }, ...(auth ? { httpCredentials: { username: "yahoo", password: PASS } } : {}) });
  if (!keepWelcome) await ctx.addInitScript(() => { try { localStorage.setItem("cs-welcome-v1", "1"); } catch (e) { console.warn("localStorage 不可用：" + e.message); } }); // 歡迎三格只在 C7 那段驗，其他段先種旗標免得對話框吃掉點擊
  await ctx.grantPermissions(["clipboard-read", "clipboard-write"]).catch(() => {});
  const p = await ctx.newPage(); p.errs = []; p.on("pageerror", (e) => p.errs.push(String(e))); return p;
}

(async () => {
  const b = await pw.chromium.launch({ channel: "chrome", headless: true });
  const ed = await startEditorServer(); const EB = `http://127.0.0.1:${ed.port}`;
  const brief05 = fs.readFileSync(path.join(ed.briefs, "built-in", "05-時事主題-情境選品.md"), "utf8");

  /* ── C7 歡迎三格（首次） ── */
  { const p = await ctxPage(b, 1440, false, true);
    await p.goto(EB + "/", { waitUntil: "domcontentloaded" }); await p.waitForSelector("#home-create-card", { timeout: 20000 }); await p.waitForTimeout(1800);
    const shown = await p.$eval("#welcome-modal", (e) => !e.hidden); const cards = await p.$$eval("#welcome-modal .wm-cards > div", (els) => els.length);
    ok("C7 歡迎三格第一次出現、三格", shown && cards === 3);
    await shot(p, "C7-welcome-1440");
    await p.click("#wm-later"); await p.waitForTimeout(300);
    ok("C7 按「下次再說」收起", await p.$eval("#welcome-modal", (e) => e.hidden));
    await p.reload({ waitUntil: "domcontentloaded" }); await p.waitForSelector("#home-create-card", { timeout: 20000 }); await p.waitForTimeout(1500);
    ok("C7 重新整理不再出現", await p.$eval("#welcome-modal", (e) => e.hidden));
    ok("首頁建立卡有「請 Gemini 幫你寫內容策略」那行", /請 Gemini 幫你寫內容策略/.test(await p.$eval("#home-create-card", (e) => e.innerText)));

    /* ── C3 建立頁：型態沒選＝策略檔格關、外觀收折、四步 ── */
    await p.click("#home-btn-create"); await p.waitForTimeout(1500);
    const nos = await p.$$eval("#create-card .fg-no", (els) => els.map((e) => e.textContent.trim()));
    ok("建立頁四步 1～4", nos.join("") === "1234", nos.join(","));
    ok("外觀預設收折", !(await p.$eval("#create-look", (e) => e.open)));
    ok("型態沒選＝策略檔格照常可用（09-15 下午翻案）", await p.$eval("#in-brief", (e) => !e.disabled && !e.classList.contains("gated")));
    await p.selectOption("#in-brief", "__paste__"); await p.waitForTimeout(300); await p.fill("#in-brief-paste-text", brief05); await p.click("#in-brief-paste-go"); await p.waitForTimeout(1500);
    ok("還不確定＋貼上有寫型態的檔＝型態自動帶入（卡切到時事）＋講一句「型態照策略檔」", (await p.$eval("#in-scenario", (e) => e.value)) === "時事主題-情境×選品" && /型態照策略檔：抓一個時事話題選品/.test(await p.$eval("#in-brief-note", (e) => e.textContent)), await p.$eval("#in-brief-note", (e) => e.textContent));
    await shot(p, "C3-type-from-brief-1440");
    await p.selectOption("#in-brief", ""); await p.waitForTimeout(300);
    ok("同事機沒有 AI 那組", await p.$eval("#engine-group", (e) => e.hidden));
    await p.click('#recipe-cards .recipe-card[data-scenario="單一品牌-優惠/曝光"]'); await p.fill("#in-theme", "Le Creuset"); await p.waitForTimeout(2800);
    ok("選項字＝「先不用…」", await p.$eval("#in-brief", (e) => /先不用/.test(e.options[0].textContent)));
    const sum = await p.$eval("#create-look-summary", (e) => e.textContent);
    ok("外觀收折列講後果（照「只講一個品牌」＋「Le Creuset」配上「…」版面）", /照「只講一個品牌」＋「Le Creuset」配上「.+」版面/.test(sum), sum);
    /* ── 1 甲：建立頁貼上一份新的 Gemini 文件＝存進我的、自動選中；型態不同＝黃字接手 ── */
    const vw = await p.$eval("#view-create", (e) => parseInt(getComputedStyle(e).maxWidth, 10)); const iw = await p.$eval("#in-url", (e) => e.getBoundingClientRect().width);
    ok("3 甲 寬幅 1000、輸入欄不超過 680", vw === 1000 && iw <= 680, `${vw}/${Math.round(iw)}`);
    ok("3 甲 四步標題各一個圖示", (await p.$$("#create-card .fg-title > svg.ic")).length === 4);
    await p.selectOption("#in-brief", "__paste__"); await p.waitForTimeout(300);
    ok("1 甲 選「貼上一份新的」＝貼上框展開", await p.$eval("#in-brief-paste", (e) => e.style.display !== "none"));
    { const gt = await p.$eval("#in-brief-guide", (e) => e.textContent); // 細節預設收合＝innerText 看不到，用 textContent
      ok("第一次用 Gemini 的引導＝四個目的、每列一顆鈕", /第一次用 Gemini 寫內容策略/.test(gt) && (await p.$$("#in-brief-guide .pg-row")).length === 4 && (await p.$$("#in-brief-guide .pg-row button")).length === 4 && (await p.$$("#in-brief-guide-copy")).length === 1 && (await p.$$("#in-brief-guide-see")).length === 1 && (await p.$$("#in-brief-guide-none")).length === 1 && (await p.$$("#in-brief-guide-paste")).length === 1);
      ok("每一步都標明在哪個畫面（建立頁／活動編輯畫面／Gemini）", (await p.$$("#in-brief-guide .pg-where")).length >= 10 && /活動編輯畫面/.test(gt) && /Gemini/.test(gt) && !/編修頁/.test(gt), gt.slice(0, 80));
      ok("只有建議那一列是主鈕", (await p.$$("#in-brief-guide .pg-row button.primary")).length === 1 && (await p.$eval("#in-brief-guide-none", (e) => e.classList.contains("primary"))));
      ok("四列細節預設收合、只看到目的＋鈕", (await p.$$eval("#in-brief-guide .pg-body", (els) => els.every((e) => e.hidden))) && !/活動編輯畫面/.test(await p.$eval("#in-brief-guide", (e) => e.innerText)));
      await p.click("#in-brief-guide .pg-row:nth-of-type(2) .pg-h"); await p.waitForTimeout(200);
      ok("點目的＝展開步驤、其他列仍收合（一次一列）", (await p.$eval("#in-brief-guide .pg-row:nth-of-type(2) .pg-body", (e) => !e.hidden)) && (await p.$$eval("#in-brief-guide .pg-body", (els) => els.filter((e) => !e.hidden).length)) === 1 && /活動編輯畫面/.test(await p.$eval("#in-brief-guide", (e) => e.innerText)));
      await p.click("#in-brief-guide .pg-row:nth-of-type(4) .pg-h"); await p.waitForTimeout(200);
      ok("點另一列＝換開那列", (await p.$eval("#in-brief-guide .pg-row:nth-of-type(4) .pg-body", (e) => !e.hidden)) && (await p.$eval("#in-brief-guide .pg-row:nth-of-type(2) .pg-body", (e) => e.hidden))); }
    await p.click("#in-brief-guide-see"); await p.waitForTimeout(800); ok("「看範本、複製一份」＝開範本檢視、主鈕是「複製一份到我的、照著改」", /寫好的長這樣/.test(await p.$eval("#dlg-title", (e) => e.textContent)) && /複製一份到我的/.test(await p.$eval("#dlg-yes", (e) => e.textContent))); await p.click("#dlg-no"); await p.waitForTimeout(200);
    await p.click("#in-brief-guide-none"); await p.waitForTimeout(400); ok("「改選先不用、直接開始」＝下拉回到先不用、貼上框收起", (await p.$eval("#in-brief", (e) => e.value)) === "" && (await p.$eval("#in-brief-paste", (e) => e.style.display === "none")));
    await p.selectOption("#in-brief", "__paste__"); await p.waitForTimeout(300);
    await p.fill("#in-brief-paste-text", brief05); await p.click("#in-brief-paste-go"); await p.waitForTimeout(1500);
    const selv = await p.$eval("#in-brief", (e) => e.value);
    ok("1 甲 貼上＝存進我的、自動選中", /^mine\//.test(selv), selv);
    ok("1 甲 貼的檔照別型態寫＝黃字接手", await p.$eval("#in-brief-mismatch", (e) => e.style.display !== "none" && /型態不一致/.test(e.innerText)));
    await shot(p, "C2b-create-paste-1440");
    /* ── C2 快車道：選事先寫好的檔、型態不一致＝黃字＋一鍵 ── */
    const optVals = await p.$$eval("#in-brief option", (o) => o.map((x) => x.value));
    ok("P-2 甲 下拉不列範本、只有先不用／貼上／我的", !optVals.some((v) => /^built-in\//.test(v)) && optVals.includes("__paste__"), optVals.join("|"));
    ok("P-1 甲 先不用那一行講下一步", /產生後在活動編輯畫面按一顆鈕/.test(await p.$eval("#in-brief option", (o) => o.textContent)));
    await p.selectOption("#in-brief", ""); await p.waitForTimeout(300);
    ok("P-1 甲 選先不用＝下方提示講怎麼開始", /先產生 30 秒草稿/.test(await p.$eval("#in-brief-note", (e) => e.textContent)));
    await p.selectOption("#in-brief", selv); await p.waitForTimeout(500);
    const mm = await p.$eval("#in-brief-mismatch", (e) => ({ shown: e.style.display !== "none", text: e.innerText }));
    ok("C2 選了照別型態寫的檔＝型態不一致黃字＋兩顆鈕", mm.shown && /型態不一致/.test(mm.text) && /照策略檔，改成「抓一個時事話題選品」/.test(mm.text), mm.text.slice(0, 60));
    await shot(p, "C2-create-mismatch-1440");
    await p.click('#in-brief-mismatch [data-bm="follow"]'); await p.waitForTimeout(600);
    ok("C2 按「照策略檔」＝型態卡切到時事、黃字收起", (await p.$eval("#in-scenario", (e) => e.value)) === "時事主題-情境×選品" && (await p.$eval("#in-brief-mismatch", (e) => e.style.display === "none")));
    ok(`建立頁 1440 零 pageerror 零溢出`, p.errs.length === 0 && !(await overflow(p)), p.errs.join(" | "));
    await p.context().close(); }

  /* ── C1／C6 編修頁內容策略區（種子＝09-14 真 run，型態已選） ── */
  { const p = await ctxPage(b, 1440, false);
    await p.goto(EB + "/", { waitUntil: "domcontentloaded" }); await p.waitForSelector("#home-create-card", { timeout: 20000 }); await p.waitForTimeout(1200);
    await p.evaluate(() => { try { localStorage.setItem("cs-welcome-v1", "1"); } catch (e) { console.warn("localStorage 不可用：" + e.message); } });
    await p.click("#nav-list"); await p.waitForTimeout(1200);
    await p.evaluate((id) => openRun(id), SEED); await p.waitForTimeout(3500); // 列表兩筆同建立時間、第一列可能是「先不指定」那份＝指名開種子 run
    ok("左欄：這檔已有策略檔＝預設開「頁面組成」、內容策略只剩一行狀態", (await p.$eval("#lc-tree", (e) => e.classList.contains("open"))) && /照策略檔帶入 \d+ 處/.test(await p.$eval("#brief-status", (e) => e.textContent)), await p.$eval("#brief-status", (e) => e.textContent));
    ok("頂部沒有黃色「正式樣式已上線」橫幅", (await p.$eval("#layout-engine-note", (e) => e.style.display === "none" || !e.textContent.trim())));
    await p.click("#lc-brief .lc-head"); await p.waitForTimeout(400);
    ok("點內容策略那一行＝浮動面板打開、頁面組成仍在", !(await p.$eval("#brief-float", (e) => e.hidden)) && (await p.$eval("#lc-tree", (e) => e.classList.contains("open"))));
    ok("面板頭一行有目的句（與建立頁引導、策略檔頁標題同一套）", /讓這檔的內容照你的想法寫/.test(await p.$eval("#brief-panel", (e) => e.innerText)));
    let head = await p.$eval("#brief-panel .bp-head", (e) => e.textContent).catch(() => "");
    ok("C6 舊資料開得起來；內容策略區頭一行重述型態與主題", /這檔用的策略檔|這檔你選的是：抓一個時事話題選品/.test(head), head);
    const labels = await p.$$eval("#brief-panel [data-bp]", (els) => els.map((e) => e.textContent.trim()));
    ok("三顆鈕照做的順序：複製給 Gemini 的話／貼上 Gemini 給你的文件／照策略檔重做草稿", labels.join("|") === "複製給 Gemini 的話|貼上 Gemini 給你的文件|照策略檔重做草稿", labels.join("|"));
    ok("重做鈕一開始不亮（還沒貼）", await p.$eval('#brief-panel [data-bp="redo"]', (e) => e.disabled));
    await p.click('#brief-panel [data-bp="copy"]'); await p.waitForTimeout(1500);
    const clip = await p.evaluate(() => navigator.clipboard.readText().catch(() => "")).catch(() => "");
    const fallbackDlg = (await p.$$("textarea[readonly]")).length > 0;
    ok("C1 複製給 Gemini 的話＝帶卡名與商品名清單（剪貼簿或退路視窗）", /這檔是哪一種活動：抓一個時事話題選品/.test(clip) || fallbackDlg, clip ? clip.slice(0, 60) : "退路視窗");
    if (fallbackDlg) { await p.keyboard.press("Escape").catch(() => {}); await p.waitForTimeout(300); }
    ok("步 1 打勾", await p.$eval("#brief-panel .bp-step .no", (e) => e.classList.contains("done")));
    await shot(p, "C1-panel-before-paste-1440");
    /* 貼回一份「型態寫錯」的 */
    await p.click('#brief-panel [data-bp="paste"]'); await p.waitForTimeout(300);
    await p.fill("#bp-paste", brief05.replace("這檔是哪一種活動：抓一個時事話題選品", "這檔是哪一種活動：只講一個品牌"));
    await p.click('#brief-panel [data-bp="paste-go"]'); await p.waitForTimeout(1500);
    let recon = await p.$eval("#brief-panel .recon", (e) => e.innerText).catch(() => "");
    ok("C1 貼回型態寫錯＝對帳卡第一條「型態不一致」＋兩顆鈕", /型態不一致/.test(recon) && /照策略檔，改成「只講一個品牌」/.test(recon), recon.slice(0, 80));
    ok("C1 型態未對齊＝重做不亮＋講原因", (await p.$eval('#brief-panel [data-bp="redo"]', (e) => e.disabled)) && /先把型態對齊/.test(await p.$eval("#brief-panel", (e) => e.innerText)));
    ok("C1 對帳卡有分層／避開／牆的帳", /分層 \d 層：對到 \d 層/.test(recon) && /避開：排掉 \d+ 件/.test(recon) && /牆 \d 面/.test(recon), recon.replace(/\n/g, " / ").slice(0, 160));
    ok("C1 對不上的層附「回 Gemini 這樣說」可複製", /回 Gemini 這樣說/.test(recon) && (await p.$$('#brief-panel [data-bp="copy-ask"]')).length >= 1);
    await shot(p, "C1-panel-mismatch-1440");
    await p.click('#brief-panel [data-bp="follow"]'); await p.waitForTimeout(400);
    recon = await p.$eval("#brief-panel .recon", (e) => e.innerText);
    ok("C1 按「照策略檔」＝型態：只講一個品牌（照策略檔）、重做亮起", /型態：只講一個品牌（照策略檔）/.test(recon) && !(await p.$eval('#brief-panel [data-bp="redo"]', (e) => e.disabled)));
    await p.click('#brief-panel [data-bp="redo"]'); await p.waitForTimeout(800);
    const dlgOpen = await p.$eval("#dlg", (e) => e.classList.contains("open")).catch(() => false);
    ok("C1 這一版有手改過＝重做前先問一句（確認框）", dlgOpen, dlgOpen ? await p.$eval("#dlg-title", (e) => e.textContent) : "沒跳確認框");
    if (dlgOpen) { await p.click("#dlg-yes"); }
    let done = false; for (let i = 0; i < 60; i++) { await sleep(2000); head = await p.$eval("#brief-panel .bp-head", (e) => e.textContent).catch(() => ""); if (/這檔用的策略檔/.test(head)) { done = true; break; } }
    ok("C1 照策略檔重做＝跑完重載，頭一行改講「這檔用的策略檔：…（照「只講一個品牌」寫）」", done && /照「只講一個品牌」寫/.test(head), head);
    const m = JSON.parse(fs.readFileSync(path.join(ed.runs, SEED, "wb_meta.json"), "utf8"));
    ok("C1 伺服器：型態改為單一品牌、策略檔＝mine/…、備份 draft.v1、核可失效", m.input.scenario === "單一品牌-優惠/曝光" && /^mine\//.test(m.input.briefFile) && fs.existsSync(path.join(ed.runs, SEED, "draft.v1.json")) && !m.approvedAt, `${m.input.scenario} ${m.input.briefFile}`);
    await shot(p, "C1-panel-after-redo-1440");
    ok(`編修頁 1440 零 pageerror 零溢出`, p.errs.length === 0 && !(await overflow(p)), p.errs.join(" | "));
    /* ── C4 策略檔頁 ── */
    await p.click("#nav-briefs"); await p.waitForTimeout(1500);
    const secs = await p.$$eval("#view-briefs .bf-sec h3", (els) => els.map((e) => e.textContent.trim()));
    ok("C4／P-3 策略檔頁三段：想讓內容對得上這檔的商品？從活動出發／我的策略檔／不用 Gemini、想自己手寫？從範本開始", secs.join("|") === "想讓內容對得上這檔的商品？從活動出發|我的策略檔|不用 Gemini、想自己手寫？從範本開始", secs.join("|"));
    ok("範本段預設收合、說明句講適合與不適合", !(await p.$eval("#view-briefs details.bf-tpl", (e) => e.open)) && /示範主題不是你的商品/.test(await p.$eval("#view-briefs details.bf-tpl", (e) => e.textContent))); // 收合中的內容 innerText 不算，用 textContent
    await p.click("#view-briefs details.bf-tpl > summary"); await p.waitForTimeout(300);
    ok("點開＝五份範本、每列一顆主鈕「複製一份、開始改」", (await p.$$("#view-briefs details.bf-tpl tbody tr")).length === 5 && (await p.$$("#view-briefs details.bf-tpl tbody button.primary")).length === 5 && /複製一份、開始改/.test(await p.$eval("#view-briefs details.bf-tpl tbody button.primary", (e) => e.textContent)));
    await p.click("#view-briefs details.bf-tpl tbody tr:first-child button.primary"); await p.waitForTimeout(900);
    ok("複製一份＝直接開編輯框（主鈕存檔）", /編輯策略檔/.test(await p.$eval("#dlg-title", (e) => e.textContent)) && (await p.$$("#bf-edit-text")).length === 1);
    await p.click("#dlg-yes"); await p.waitForTimeout(900);
    ok("存檔後回列表、我的策略檔多一份「-我的」", /-我的/.test(await p.$eval("#view-briefs .bf-sec:nth-child(2)", (e) => e.innerText)));
    ok("P-3 三步＋去我的活動鈕＋通用指令收起；範本列 5", (await p.$$("#view-briefs .bf-steps > div")).length === 3 && (await p.$$("#bf-go-list")).length === 1 && !(await p.$eval("details.bf-generic", (e) => e.open)) && (await p.$$("#view-briefs .bf-sec:nth-child(3) tbody tr")).length === 5);
    const mine = await p.$eval("#view-briefs .bf-sec:nth-child(2)", (e) => e.innerText);
    ok("C4 我的策略檔列出剛貼的那份＋用過它的活動幾檔", /用過它的活動/.test(mine) && /\d 檔/.test(mine), mine.replace(/\s+/g, " ").slice(0, 120));
    ok("用過它的活動＝可點回那檔（本機還在）", (await p.$$("#view-briefs .bf-sec:nth-child(2) a[data-open-run]")).length >= 1);
    ok("P-4 我的策略檔＝列表制（欄：策略檔／用過它的活動／最後修改）、每列一顆主鈕「編輯」、次要滑過才浮現", (await p.$$eval("#view-briefs .bf-sec:nth-child(2) .bf-table thead th", (els) => els.map((e) => e.textContent.trim()).slice(0, 3).join("|"))) === "策略檔|用過它的活動|最後修改" && (await p.$$eval("#view-briefs .bf-sec:nth-child(2) tbody tr:first-child .ops > button.primary", (els) => els.map((e) => e.textContent.trim()))).join() === "編輯" && (await p.$eval("#view-briefs .bf-sec:nth-child(2) tbody tr:first-child .ops .sec", (e) => getComputedStyle(e).opacity === "0")));
    await p.click("#view-briefs .bf-sec:nth-child(2) tbody tr:first-child .tl"); await p.waitForTimeout(600);
    ok("P-4 點名稱＝檢視框、只有一顆主鈕「編輯」", (await p.$eval("#dlg-yes", (e) => e.textContent.trim())) === "編輯" && (await p.$$("#dlg-body button")).length === 0);
    await p.click("#dlg-no"); await p.waitForTimeout(200);
    await p.hover("#view-briefs .bf-sec:nth-child(2) tbody tr:first-child"); await p.click('#view-briefs .bf-sec:nth-child(2) tbody tr:first-child [data-bf="rename"]'); await p.waitForTimeout(300);
    await p.fill("#bf-rename-input", "走查改名"); await p.click("#dlg-yes"); await p.waitForTimeout(1200);
    ok("P-4 改名＝列表更新", /走查改名/.test(await p.$eval("#view-briefs .bf-sec:nth-child(2)", (e) => e.innerText)));
    await p.hover("#view-briefs .bf-sec:nth-child(2) tbody tr:first-child"); await p.click('#view-briefs .bf-sec:nth-child(2) tbody tr:first-child [data-bf="delete"]'); await p.waitForTimeout(300);
    ok("P-4 刪除＝一個確認框、一顆主鈕「刪除」", (await p.$eval("#dlg-yes", (e) => e.textContent.trim())) === "刪除" && /刪除這份策略檔/.test(await p.$eval("#dlg-title", (e) => e.textContent)));
    await p.click("#dlg-no"); await p.waitForTimeout(200);
    await shot(p, "C4-briefs-1440");
    ok(`策略檔頁 1440 零 pageerror 零溢出`, p.errs.length === 0 && !(await overflow(p)), p.errs.join(" | "));
    await p.context().close(); }

  /* ── C3 乙：先不指定的活動，在內容策略區補選型態 ── */
  { const p = await ctxPage(b, 1440, false);
    await p.goto(EB + "/", { waitUntil: "domcontentloaded" }); await p.waitForSelector("#home-create-card", { timeout: 20000 }); await p.waitForTimeout(1200);
    await p.evaluate(() => { try { localStorage.setItem("cs-welcome-v1", "1"); } catch (e) { console.warn("localStorage 不可用：" + e.message); } });
    await p.goto(EB + "/#", { waitUntil: "domcontentloaded" }); await p.waitForTimeout(800);
    await p.evaluate((id) => openRun(id), SEED2); await p.waitForTimeout(3500);
    ok("C3 段頭狀態＝先選這檔是哪一種活動（琥珀點）", /先選這檔是哪一種活動/.test(await p.$eval("#brief-status", (e) => e.textContent)) && (await p.$eval("#brief-dot", (e) => e.classList.contains("amber"))));
    if (await p.$eval("#brief-float", (e) => e.hidden)) { await p.click("#lc-brief .lc-head"); await p.waitForTimeout(400); }
    ok("C3 沒選型態＝內容策略區先講「先選這檔是哪一種活動」＋五張小卡、三顆鈕灰", /先選這檔是哪一種活動/.test(await p.$eval("#brief-panel", (e) => e.innerText)) && (await p.$$("#brief-panel .mini-cards .recipe-card")).length === 5 && (await p.$eval('#brief-panel [data-bp="copy"]', (e) => e.disabled)));
    await shot(p, "C3-panel-pick-type-1440");
    await p.click('#brief-panel .mini-cards .recipe-card[data-sc="同品類-情境×優惠"]'); await p.waitForTimeout(2000);
    ok("C3 補選型態＝頭一行改講這檔的型態（用一個生活場景帶出優惠）、鈕亮", /用一個生活場景帶出優惠/.test(await p.$eval("#brief-panel .bp-head", (e) => e.textContent)) && !(await p.$eval('#brief-panel [data-bp="copy"]', (e) => e.disabled)), await p.$eval("#brief-panel .bp-head", (e) => e.textContent)); // 種子草稿本來就套過策略檔＝頭一行講「用的策略檔…（照「X」寫）」，型態同樣要換
    await p.context().close(); }

  /* ── 三寬度（同事機建立頁／編修頁） ── */
  for (const w of [768, 375]) { const p = await ctxPage(b, w, false);
    await p.goto(EB + "/", { waitUntil: "domcontentloaded" }); await p.waitForSelector("#home-create-card", { timeout: 20000 }); await p.waitForTimeout(1200);
    await p.evaluate(() => { try { localStorage.setItem("cs-welcome-v1", "1"); } catch (e) { console.warn("localStorage 不可用：" + e.message); } });
    await p.click("#home-btn-create"); await p.waitForTimeout(1200); await shot(p, `create-${w}`);
    await p.evaluate((id) => openRun(id), SEED); await p.waitForTimeout(3000); await shot(p, `editor-${w}`);
    ok(`${w}px 零 pageerror 零溢出`, p.errs.length === 0 && !(await overflow(p)), p.errs.join(" | ")); await p.context().close(); }
  ed.ch.kill("SIGTERM");

  /* ── 負責人機 8787：建立頁四步與 AI 那組在第 2 步底下 ── */
  { const p = await ctxPage(b, 1440, true);
    await p.goto("http://127.0.0.1:8787/", { waitUntil: "domcontentloaded" }); await p.waitForSelector("#home-create-card", { timeout: 20000 }); await p.waitForTimeout(1500);
    await p.evaluate(() => { try { localStorage.setItem("cs-welcome-v1", "1"); } catch (e) { console.warn("localStorage 不可用：" + e.message); } });
    await p.click("#home-btn-create"); await p.waitForTimeout(1500);
    ok("負責人機：AI 那組在第 2 步底下、標題「或者，讓 AI 從頭策展」", !(await p.$eval("#engine-group", (e) => e.hidden)) && /或者，讓 AI 從頭策展/.test(await p.$eval("#engine-group", (e) => e.innerText)) && (await p.$eval("#engine-group", (e) => !!e.closest(".fgroup") && e.closest(".fgroup").querySelector(".fg-no").textContent === "2")));
    await shot(p, "owner-create-1440");
    ok(`負責人機建立頁 1440 零 pageerror 零溢出`, p.errs.length === 0 && !(await overflow(p)), p.errs.join(" | "));
    await p.context().close(); }
  await b.close();
  console.log(`\n旅程結果：pass=${pass} fail=${fail}　截圖：${OUT}`); process.exit(fail ? 1 : 0);
})().catch((e) => { console.error("JOURNEY EXC", e); process.exit(2); });
