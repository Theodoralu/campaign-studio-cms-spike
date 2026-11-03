/* caps-journey：能力表制＋編修模式 旅程走查（2026-09-15 B 批；story docs/stories/capabilities-editor-mode.md Q1）
   P1 同事機（自起編修模式測試伺服器、能力全關、種子 run 標已交付）／P2 負責人機（現役 8787）／P3 Claude 沒登入（P1 伺服器＋攔 /api/version 假回應）／P4 舊資料開得起來（P1 種子＝09-14 真 run）。
   三寬度 1440／768／375 各拍首頁、建立頁、列表；零 pageerror、零橫向溢出。
   手動跑：node test/browser/caps-journey.js <outDir>   （需 Chrome、現役 8787、外網不必）；node --test 下跳過。 */
if (process.env.NODE_TEST_CONTEXT) { console.log("caps-journey：手動旅程走查（需 Chrome＋現役 8787），node --test 下跳過"); return; }
const fs = require("fs"), os = require("os"), path = require("path"), { spawn } = require("child_process");
const PIPE = path.resolve(__dirname, "..", "..");
const pw = require(path.join(PIPE, "node_modules", "playwright-core"));
const PASS = fs.readFileSync(path.join(PIPE, "workbench", ".wb-pass"), "utf8").trim();
const OUT = process.argv[2] || path.join(os.tmpdir(), "caps-journey"); fs.mkdirSync(OUT, { recursive: true });
const SEED = "2026-09-14-wb-143442";
let pass = 0, fail = 0; const ok = (name, cond, note = "") => { (cond ? pass++ : fail++); console.log(`${cond ? "✔" : "✖"} ${name}${note ? "　" + note : ""}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function startEditorServer() {
  const runs = fs.mkdtempSync(path.join(os.tmpdir(), "caps-runs-")); const port = 18000 + Math.floor(Math.random() * 1000);
  fs.cpSync(path.join(PIPE, "runs", SEED), path.join(runs, SEED), { recursive: true });
  const mp = path.join(runs, SEED, "wb_meta.json"); const m = JSON.parse(fs.readFileSync(mp, "utf8"));
  m.approvedAt = m.approvedAt || "2026-09-15T00:30:00.000Z"; m.exportAem = { stage: "done", file: "seed.html", bytes: 1, startedAt: "2026-09-15T00:31:00.000Z", downloadedAt: "2026-09-15T00:35:00.000Z" };
  fs.writeFileSync(mp, JSON.stringify(m, null, 1));
  const env = { ...process.env, CAMPAIGN_MODE: "editor", CAMPAIGN_RUNS_DIR: runs, CAMPAIGN_CAPS: "ai:0,publish:0,vendorSheet:0" }; delete env.WB_PASS;
  const ch = spawn(process.execPath, [path.join(PIPE, "workbench", "server.js"), String(port)], { env, stdio: ["ignore", "pipe", "pipe"] });
  let log = ""; ch.stdout.on("data", (d) => { log += d; }); ch.stderr.on("data", (d) => { log += d; });
  let lastErr = null; // 守門 G2：等待迴圈不吞錯——記最後一次原因，等不到時一起印
  for (let i = 0; i < 200; i++) { try { if ((await fetch(`http://127.0.0.1:${port}/ping`)).status === 204) break; } catch (e) { lastErr = e; } await sleep(300); }
  for (let i = 0; i < 100; i++) { try { const v = await (await fetch(`http://127.0.0.1:${port}/api/version`)).json(); if (v.caps) break; } catch (e) { lastErr = e; } await sleep(300); }
  if (lastErr) console.error(`（等待期間最後一次連線錯誤：${lastErr.message}）`);
  return { ch, port, log: () => log };
}
async function page(b, base, w, auth) {
  const ctx = await b.newContext({ viewport: { width: w, height: 1000 }, ...(auth ? { httpCredentials: { username: "yahoo", password: PASS } } : {}) });
  await ctx.addInitScript(() => { try { localStorage.setItem("cs-welcome-v1", "1"); } catch (e) { console.warn("localStorage 不可用：" + e.message); } }); // 歡迎三格（C 批）在 brief-flow-journey 驗；這裡先種旗標免得對話框吃掉點擊
  const p = await ctx.newPage(); p.errs = []; p.on("pageerror", (e) => p.errs.push(String(e)));
  await p.goto(base + "/", { waitUntil: "domcontentloaded" }); await p.waitForSelector("#home-create-card", { timeout: 20000 }); await p.waitForTimeout(1800);
  return p;
}
const overflow = (p) => p.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
const shot = (p, name) => p.screenshot({ path: path.join(OUT, name + ".png") });

(async () => {
  const b = await pw.chromium.launch({ channel: "chrome", headless: true });
  /* ── P1／P4 同事機 ── */
  const ed = await startEditorServer(); const EB = `http://127.0.0.1:${ed.port}`;
  for (const w of [1440, 768, 375]) {
    const p = await page(b, EB, w, false);
    if (w === 1440) {
      ok("P1 首頁：AI 那行不出現", await p.$eval('#home-create-card [data-needs="ai"]', (e) => e.hidden));
      ok("P1 首頁第三卡＝最近交付 1 檔＋再下載", /最近交付/.test(await p.$eval("#home-live .ct", (e) => e.textContent)) && (await p.$$("#home-live button")).length >= 1, await p.$eval("#home-live .ct", (e) => e.textContent.trim()));
      ok("P1 首頁沒有「已發佈預覽」字", !(await p.$eval("#view-home", (e) => e.innerText)).includes("已發佈預覽"));
    }
    await shot(p, `P1-home-${w}`);
    await p.click("#home-btn-create"); await p.waitForTimeout(1500);
    if (w === 1440) {
      ok("P1 建立頁：策展方式整組不出現", await p.$eval("#engine-group", (e) => e.hidden));
      ok("P1 建立頁：預設引擎＝快速草稿", (await p.$eval(".engine-card.on", (e) => e.dataset.engine)) === "auto");
      ok("P1 建立頁：型態卡沒有版面縮圖（甲）", (await p.$$("#recipe-cards .recipe-card .th")).length === 0);
      await p.click('#recipe-cards .recipe-card[data-scenario="時事主題-情境×選品"]'); await p.waitForTimeout(2500);
      const pick = await p.$eval("#layout-ai-pick", (e) => e.textContent).catch(() => "");
      ok("P1 建立頁：自動配卡講「現在會配：X」＋有縮圖", /現在會配：/.test(pick) && (await p.$$("#layout-ai-th img")).length === 1, pick.slice(0, 40));
      const reason = await p.$eval("#layout-reason", (e) => e.textContent).catch(() => "");
      ok("P1 理由句印卡名不印資料鍵", /抓一個時事話題選品/.test(reason) && !/時事主題-情境×選品/.test(reason), reason.slice(0, 60));
      const step5 = await p.evaluate(() => capCopy("step5Desc"));
      ok("P1 五步第 5 步說明＝無發佈版", !/發佈內網預覽/.test(step5), step5);
    }
    await shot(p, `P1-create-${w}`);
    await p.click("#nav-list").catch(() => {}); await p.waitForTimeout(1500);
    if (w === 1440) {
      const tabs = await p.$$eval("#view-tabs .vt", (els) => els.map((e) => e.textContent.replace(/\d+$/, "").trim()));
      ok("P1 列表分頁有「已交付」、沒有「已發佈預覽」", tabs.includes("已交付") && !tabs.includes("已發佈預覽"), tabs.join("/"));
      const th = await p.$$eval("#list-table thead th", (els) => els.map((e) => e.textContent.trim()));
      ok("P1 列表欄：沒有入口、有策略檔與合規", !th.includes("入口") && th.includes("策略檔") && th.includes("合規"), th.join("/"));
      await shot(p, "P1-list-1440");
      const row = await p.$eval("#list-table tbody tr", (tr) => tr.textContent); // textContent：欄位分級收合制在 1440 帶側欄時會收掉 col-p2／p3，innerText 看不到被收的欄
      ok("P4 舊資料（09-14 真 run）開得起來且狀態＝已交付", /已交付/.test(row), row.replace(/\s+/g, " ").slice(0, 90));
      ok("P1 商品狀態燈講上次檢查／未檢查", /上次檢查|未檢查/.test(row));
      ok("P1 情境欄印卡名", /抓一個時事話題選品/.test(row));
      await p.click("#list-table tbody tr .tl"); await p.waitForTimeout(3500);
      const tb = await p.$eval("#taskbar, .taskbar, #tb", (e) => e.innerText).catch(async () => (await p.evaluate(() => document.body.innerText)));
      ok("P1 編修頁任務條沒有「發佈內網預覽」次鈕", !/發佈內網預覽|更新內網預覽/.test(tb));
      ok("P1 同事版看不到「活動小卡」（上線網址那張；使用者 09-15 裁：沒部署鏈的人藏起來）", await p.$eval("#run-admin-card", (e) => e.hidden));
      await shot(p, "P1-editor-1440");
      const d = await fetch(`${EB}/api/runs/${SEED}/deploy`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
      ok("P1 直接打部署路由＝403", d.status === 403);
    }
    ok(`P1 ${w}px 零 pageerror 零橫向溢出`, p.errs.length === 0 && !(await overflow(p)), p.errs.join(" | ").slice(0, 120));
    await p.context().close();
  }
  /* ── P3 Claude 裝了沒登入（攔 /api/version） ── */
  { const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } }); await ctx.addInitScript(() => { try { localStorage.setItem("cs-welcome-v1", "1"); } catch (e) { console.warn(e.message); } }); const p = await ctx.newPage();
    await p.route("**/api/version", async (route) => { const r = await route.fetch(); const j = await r.json(); j.caps = { ai: false, publish: false, vendorSheet: false }; j.capsDetail = { ai: { installed: true, version: "2.1", loginOk: false, note: "Claude 還沒登入" }, publish: {}, vendorSheet: {} }; await route.fulfill({ response: r, json: j }); });
    await p.goto(EB + "/", { waitUntil: "domcontentloaded" }); await p.waitForSelector("#home-create-card", { timeout: 20000 }); await p.waitForTimeout(1500);
    const banner = await p.$eval("#caps-ai-banner-msg", (e) => e.textContent).catch(() => ""); // 2026-09-21：橫幅改成「字＋鈕」，字要讀 msg（整條 textContent 會把鈕的字串進來）
    ok("P3 橫幅出現且字＝第 3 條定稿", banner === "AI 智慧策展目前用不了：這台電腦的 Claude 還沒登入。快速草稿不受影響。", banner);
    await shot(p, "P3-banner-1440");

    /* ── P5 登入完按「重新檢查」（2026-09-21；story caps-recheck）──
       病例＝能力表開機只探一次，使用者 08:15 登入、08:16 介面還掛橫幅，而且伺服器擋門讀同一份＝AI 真的用不了。
       這段走完整條：字對 → 按下去鎖住並說在檢查 → 還沒好照實說 → 真的登入好了就把橫幅收掉。 */
    const btnTxt = await p.$eval("#caps-ai-recheck", (e) => e.textContent).catch(() => "");
    ok("P5 橫幅上有「重新檢查」鈕、字＝核可版", btnTxt === "登入好了，重新檢查", btnTxt);

    let loginNow = false; // 先演「還是沒登入」，再演「使用者去登入了」
    await p.route("**/api/caps/recheck", async (route) => {
      await new Promise((r) => setTimeout(r, 700)); // 慢一點＝「正在檢查」那一態抓得到（真環境約 15 秒）
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
        caps: { ai: loginNow, publish: false, vendorSheet: false },
        capsDetail: { ai: { installed: true, version: "2.1", loginOk: loginNow, note: loginNow ? "" : "Claude 還沒登入" }, publish: {}, vendorSheet: {} },
        capsCheckedAt: new Date().toISOString() }) });
    });

    await p.click("#caps-ai-recheck"); await p.waitForTimeout(250);
    const working = await p.$eval("#caps-ai-banner-msg", (e) => e.textContent).catch(() => "");
    const locked = await p.$eval("#caps-ai-recheck", (e) => e.disabled).catch(() => false);
    ok("P5 按下去＝說正在檢查、鈕鎖住（連點不重複叫 claude）", working === "…正在檢查，大約要等 15 秒" && locked === true, `${working}｜disabled=${locked}`);

    await p.waitForTimeout(1000);
    const failTxt = await p.$eval("#caps-ai-banner-msg", (e) => e.textContent).catch(() => "");
    const unlocked = await p.$eval("#caps-ai-recheck", (e) => e.disabled).catch(() => true);
    ok("P5 還是沒登入＝照實說，不假裝成功（鐵律 3）", failTxt === "還是連不上。請確認 Claude 已經登入，再試一次。", failTxt);
    ok("P5 失敗後鈕可以再按", unlocked === false);
    await shot(p, "P5-recheck-failed");

    loginNow = true; // 使用者去終端機登入了
    await p.unroute("**/api/version");
    await p.route("**/api/version", async (route) => { const r = await route.fetch(); const j = await r.json(); j.caps = { ai: true, publish: false, vendorSheet: false }; j.capsDetail = { ai: { installed: true, version: "2.1", loginOk: true, note: "" }, publish: {}, vendorSheet: {} }; await route.fulfill({ response: r, json: j }); });
    await p.click("#caps-ai-recheck"); await p.waitForTimeout(1400);
    ok("P5 登入好了再按＝橫幅自己收掉", (await p.$$("#caps-ai-banner")).length === 0);
    ok("P5 收掉之後 AI 那行自己長回來（沿用既有 applyCaps，不另寫一套）",
      !(await p.$eval('#home-create-card [data-needs="ai"]', (e) => e.hidden).catch(() => true)));
    await shot(p, "P5-recheck-ok");
    ok(`P5 零 pageerror`, (p.errs || []).length === 0, (p.errs || []).join(" | ").slice(0, 120)); // 這段的 page 是 ctx.newPage() 直接建的＝沒有 page() 掛的 errs 陣列
    await ctx.close(); }
  ed.ch.kill("SIGTERM");
  /* ── P2 負責人機（現役 8787） ── */
  for (const w of [1440, 768, 375]) {
    const p = await page(b, "http://127.0.0.1:8787", w, true);
    if (w === 1440) {
      ok("P2 首頁：AI 那行在", !(await p.$eval('#home-create-card [data-needs="ai"]', (e) => e.hidden)));
      ok("P2 首頁第三卡＝已發佈預覽", /已發佈預覽/.test(await p.$eval("#home-live .ct", (e) => e.textContent)));
      ok("P2 沒有 Claude 橫幅", (await p.$$("#caps-ai-banner")).length === 0);
    }
    await shot(p, `P2-home-${w}`);
    await p.click("#home-btn-create"); await p.waitForTimeout(1500);
    if (w === 1440) {
      ok("P2 建立頁：策展方式在、AI 卡在", !(await p.$eval("#engine-group", (e) => e.hidden)) && (await p.$$('.engine-card[data-engine="ai"]')).length === 1);
      ok("P2 負責人機看得到「活動小卡」（有部署鏈）", !(await p.$eval("#run-admin-card", (e) => e.hidden)));
      ok("P2 五步第 5 步說明＝有發佈版", /發佈內網預覽/.test(await p.evaluate(() => capCopy("step5Desc"))));
    }
    await shot(p, `P2-create-${w}`);
    await p.click("#nav-list").catch(() => {}); await p.waitForTimeout(1500);
    if (w === 1440) {
      const tabs = await p.$$eval("#view-tabs .vt", (els) => els.map((e) => e.textContent.replace(/\d+$/, "").trim()));
      ok("P2 列表分頁有「已發佈預覽」", tabs.includes("已發佈預覽"), tabs.join("/"));
      const th = await p.$$eval("#list-table thead th", (els) => els.map((e) => e.textContent.trim()));
      ok("P2 列表欄：有入口、有策略檔", th.includes("入口") && th.includes("策略檔"), th.join("/"));
    }
    await shot(p, `P2-list-${w}`);
    ok(`P2 ${w}px 零 pageerror 零橫向溢出`, p.errs.length === 0 && !(await overflow(p)), p.errs.join(" | ").slice(0, 120));
    await p.context().close();
  }
  await b.close();
  console.log(`\n旅程結果：pass=${pass} fail=${fail}　截圖：${OUT}`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error("JOURNEY EXC", e); process.exit(2); });
