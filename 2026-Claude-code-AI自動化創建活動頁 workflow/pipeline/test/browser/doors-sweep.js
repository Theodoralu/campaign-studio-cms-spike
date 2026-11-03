"use strict";
/**
 * doors-sweep.js —— CMS「同一能力多道門」入口全掃（CMS-DOORS 第 1 層；真瀏覽器、真點擊）
 *
 * 為什麼有這支：2026-09-07 一天六件同類病——牆面圖下拉鎖死、圓卡沒下拉、情境卡沒露臉、換副標字型沒反應、
 * 建立貼包被擋卻記免改、待審字風三處沒講——共同結構＝**同一個能力被好幾道門各抄一份、修了一道別道還是舊的、
 * 而且從來沒有一支測試「從每一個入口打到底」**。這支就是那個「每個入口都有機器敲門」：
 * 開真的工作台、走遍每一個有商品圖下拉的區塊，對每一道門用同一把尺量：
 *   C1 有 ≥2 張圖＝下拉可選；換一張＝草稿該欄變了、列上縮圖跟著換、預覽（iframe）畫出那張圖
 *   C2 只有 1 張圖＝要去商品頁補抓（先顯示「取圖中…」、抓到就長出選項）——每種門都要有這條路
 *   C3 補抓失敗／只讀到一張＝要講「單圖」，不能靜默空白
 *   C4 每列都有「替換商品」入口（新版式主視覺＝「換」鈕；本期活動＝「取圖」鈕；其餘＝「替換商品」開替換視窗）
 * 商品頁與圖床全部用 playwright route 攔下來給假回應（hermetic：不打網路、結果可重跑）。
 *
 * 用法：node test/browser/doors-sweep.js [--port 8797] [--out <dir>] [--keep-server]
 *   自己起測試 server（勿碰 8787 正式服務）、自己造種子（doors-seed.js）、跑完自己關。
 *   node --test 下自動跳過（沿 w1c/w1d 守門）。
 *
 * 已知缺口名單（KNOWN_GAPS）＝第 1 層「只加測試不改行為」時已知會紅的門，第 2 層合併複本後翻綠時**必須**把它從名單移除
 * （名單型判定要對帳：名單裡的門若意外變綠＝腳本會叫、exit 1，逼人更新名單，不讓名單漂成假閘）。
 */
if (process.env.NODE_TEST_CONTEXT) {
  console.log("doors-sweep：入口全掃（需 Chrome＋自起測試 server），node --test 下跳過——手動跑：node test/browser/doors-sweep.js");
  return;
}
const fs = require("fs");
const path = require("path");
const http = require("http");
const { spawn } = require("child_process");
const pw = require("playwright-core");
const { seedDoorsRuns } = require("./doors-seed.js");

const argv = process.argv.slice(2);
const arg = (k, d) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : d);
const PORT = String(arg("--port", "8797"));
const PIPE = path.join(__dirname, "..", "..");
const OUT = path.resolve(arg("--out", path.join(PIPE, "docs", "design-qa", "cms-doors-sweep-shots")));
const BASE = `http://127.0.0.1:${PORT}`;
fs.mkdirSync(OUT, { recursive: true });

/* 已知缺口名單＝單一來源 doors-known-gaps.js（靜態單元測試讀同一張表）；第 2 層補洞時同批刪鍵 */
const { KNOWN_GAPS } = require("./doors-known-gaps.js");

const results = []; // { key, gapKey, name, pass, note, gap }
function ok(key, gapKey, name, pass, note) {
  const gap = !!gapKey && Object.prototype.hasOwnProperty.call(KNOWN_GAPS, gapKey);
  results.push({ key, gapKey: gapKey || null, name, pass, note: note || "", gap });
  const mark = pass ? (gap ? "◑" : "✔") : (gap ? "◌" : "✖");
  console.log(`${mark} ${name}${note ? "｜" + note : ""}${gap ? (pass ? "｜⚠ 已知缺口卻綠了＝請把它從 KNOWN_GAPS 移除" : "｜已知缺口（第 2 層）") : ""}`);
}

const PNG1 = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64");
const gdidOf = (u) => { const s = String(u || ""); const m = s.match(/\/p-(\d{6,18})\.html|[?&]gdid=(p?\d{6,18})|^(p?\d{6,18})$/i); return m ? (m[1] || m[2] || m[3]) : null; };
const stubImgs = (g) => [1, 2, 3, 4, 5].map((k) => `https://img.yec.tw/zp/MerchandiseImages/STUB${k}-Gd-${g}.jpg`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function ping() { return new Promise((res) => { http.get(BASE + "/ping", (r) => { r.resume(); res(r.statusCode >= 200 && r.statusCode < 300); }).on("error", () => res(false)); }); } // /ping 回 204
async function startServer() {
  if (await ping()) { console.log(`ⓘ ${PORT} 埠已有 server 在跑＝直接沿用（不另起）`); return null; }
  const hh = new Date(); const mm = hh.getHours() * 60 + hh.getMinutes();
  if ([8 * 60 + 30, 9 * 60 + 30].some((t) => Math.abs(mm - t) <= 2)) console.warn("⚠ 現在貼近 08:30／09:30 排程時刻——測試 server 與正式 server 同一份程式、排程無開關，建議等兩分鐘再跑");
  const env = { ...process.env }; delete env.WB_PASS; // 測試埠免登入（.wb-bind 要求開放但無密碼＝server 自己回落 127.0.0.1）
  const child = spawn(process.execPath, [path.join(PIPE, "workbench", "server.js"), PORT], { cwd: PIPE, env, stdio: ["ignore", "pipe", "pipe"] });
  const logs = [];
  child.stdout.on("data", (d) => logs.push(String(d)));
  child.stderr.on("data", (d) => logs.push(String(d)));
  for (let i = 0; i < 60; i++) { if (await ping()) return child; await sleep(250); }
  console.error(logs.join("")); throw new Error(`測試 server（${PORT}）15 秒內沒起來`);
}

(async () => {
  const seeds = seedDoorsRuns();
  console.log(`種子：${seeds.v2.id}（新版式）／${seeds.legacy.id}（現行版型）`);
  const FAIL_FETCH = new Set([String(seeds.v2.cases.edWall), String(seeds.v2.cases.promoFail)]); // 這兩件的補抓回錯誤＝驗 C3「單圖」要出聲
  const server = await startServer(); global.__doorsServer = server;
  const browser = await pw.chromium.launch({ channel: "chrome", headless: true });
  const shots = async (page, name) => page.screenshot({ path: path.join(OUT, name), fullPage: false });
  const EXPECTED_4XX = [/\/(product_check|gate_report)\.json$/, /\/api\/product-fetch$/]; // 種子沒有兩份報告＝進場探測 404（沿 w1d）；product-fetch 400＝本腳本的假失敗回應

  /* 補抓「閘門」：hold 住＝假商品頁不回應（畫面停在「取圖中…」給我們看）；release 後才回；inflight 讓我們等到全部收尾 */
  let holdP = null, releaseHold = null, inflight = 0;
  const holdFetch = () => { if (!holdP) holdP = new Promise((r) => { releaseHold = r; }); };
  const release = () => { if (releaseHold) releaseHold(); holdP = null; releaseHold = null; };
  const settled = async (page) => { for (let i = 0; i < 80 && inflight > 0; i++) await sleep(100); await page.waitForTimeout(350); }; // 收尾後多等一拍＝重繪完成

  async function newPage() {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    /* 2026-10-05：歡迎三格（2026-09-15 加的 #welcome-modal）會蓋住整頁、攔掉所有點擊＝本腳本自 09-15 起**完全跑不動**，
       而它只在有人手動跑時才會跑，所以壞了 20 天沒人發現（第 1 層那份「216 綠」是 09-08 的快照）。
       開場先把「看過了」那個旗標設好＝不出現；順帶讓本腳本不依賴瀏覽器殘留狀態（hermetic）。 */
    await page.addInitScript(() => { localStorage.setItem("cs-welcome-v1", "1"); }); /* 不包 try/catch：本機 http 起源一定有 localStorage，真的失敗要讓它出聲（鐵律 3；G2 空 catch 守門也會擋） */
    const errs = [], http4 = [];
    page.on("console", (m) => { if (m.type() === "error") errs.push(m.text()); });
    page.on("pageerror", (e) => errs.push(String(e)));
    page.on("response", (res) => { if (res.status() >= 400) http4.push(`${res.status()} ${res.url()}`); });
    page._errs = errs; page._http4 = http4;
    /* 圖床＝1×1 PNG（不打網路）；商品頁補抓＝假回應（FAIL_FETCH 那兩件回錯誤） */
    await page.route(/^https:\/\/(img\.yec\.tw|s\.yimg\.com|sp\.yimg\.com)\//, (route) => route.fulfill({ status: 200, contentType: "image/png", body: PNG1 }));
    await page.route("**/api/product-fetch", async (route) => {
      inflight++;
      try {
        let body = {}; try { body = JSON.parse(route.request().postData() || "{}"); } catch (e) { /* 空 body＝當沒編號 */ }
        const g = gdidOf(body.url);
        if (holdP) await holdP;
        await sleep(120);
        if (!g) return await route.fulfill({ status: 400, contentType: "application/json", body: JSON.stringify({ error: "測試樁：看不出賣場編號" }) });
        if (FAIL_FETCH.has(String(g))) return await route.fulfill({ status: 400, contentType: "application/json", body: JSON.stringify({ error: "測試樁：這件商品頁抓不到圖" }) });
        return await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ gdid: g, name: `補抓商品 ${g}`, price: 999, url: `https://tw.buy.yahoo.com/gdsale/p-${g}.html`, imgs: stubImgs(g) }) });
      } finally { inflight--; }
    });
    return page;
  }
  const openRunUi = async (page, id) => {
    await page.goto(BASE + "/", { waitUntil: "networkidle" });
    await page.evaluate(() => showList()); // 進站落「首頁」視圖（#view-list 隱藏）＝先切到「所有活動頁」清單再真點擊
    await page.waitForSelector("#view-list table tr button.edit-btn", { timeout: 8000 });
    await page.locator(`#view-list tr:has-text("${id}")`).first().locator("button.edit-btn").click();
    await page.waitForSelector("#editor-col fieldset", { timeout: 10000 });
    await page.waitForFunction(() => typeof snapImgsByGdid !== "undefined" && snapImgsByGdid.size > 0, null, { timeout: 8000 }); // 來源圖庫到位＝下拉選項集齊
    await page.waitForFunction(() => { const w = document.querySelector("#preview"); return w && w.contentWindow && typeof w.contentWindow.loadDraftJson === "function"; }, null, { timeout: 15000 });
    await page.waitForTimeout(600);
  };
  const listDoors = (page) => page.evaluate(() => [...document.querySelectorAll("#editor-col select.imgsel, #editor-col select[data-mimgpick]")].map((s) => {
    const attr = ["himgsel", "imgsel", "kvimgsel", "ecimgsel", "scimgsel", "mimgpick"].find((a) => s.dataset[a] !== undefined) || null;
    const row = s.closest(".prod-row");
    return { attr, idx: attr ? s.dataset[attr] : null, disabled: s.disabled, options: s.options.length, first: s.options.length ? s.options[0].textContent : "",
      /* 2026-10-05：停用態那一格自己帶 data-imgkey（貨號或 entry:<來源>）＝本期活動那一列沒有 data-gdid 也認得出來 */
      gdid: (row && row.dataset.gdid) || (s.dataset.imgkey ? String(s.dataset.imgkey).replace(/^entry:/, "") : null) || null,
      name: row ? ((row.querySelector(".pr-name") || {}).textContent || "").slice(0, 16) : "" };
  }));
  const chosenUrl = (page, d, k) => page.evaluate(([attr, idx, k]) => {
    if (attr === "himgsel" || attr === "imgsel") return imgOpts(draft.products[+idx])[k];
    if (attr === "scimgsel") return imgOpts(sceneProductOf(+idx, draft.page.floors[+idx]))[k];
    if (attr === "ecimgsel") return circleImgOpts(draft.page.editorial.circles[+idx])[k];
    if (attr === "kvimgsel") { const s = document.querySelector(`[data-kvimgsel="${idx}"]`); return imgOpts(draft.products[+s.dataset.pidx])[k]; }
    if (attr === "mimgpick") { const s = document.querySelector(`[data-mimgpick="${idx}"]`); return s.options[k].value; }
    return null;
  }, [d.attr, d.idx, k]);
  const targetField = (page, d) => page.evaluate(([attr, idx]) => {
    if (attr === "himgsel" || attr === "imgsel") return draft.products[+idx].img;
    if (attr === "scimgsel") return draft.page.floors[+idx].sceneImg;
    if (attr === "ecimgsel") return draft.page.editorial.circles[+idx].img;
    if (attr === "kvimgsel") return (draft.page.kv.images || [])[+idx];
    if (attr === "mimgpick") return draft.page.promoEntries[+idx].img;
    return null;
  }, [d.attr, d.idx]);
  const previewHas = (page, url) => page.waitForFunction((u) => { try { const w = document.querySelector("#preview").contentWindow; return !!(w && w.document && w.document.documentElement.innerHTML.includes(u)); } catch (e) { return false; } }, url, { timeout: 5000 }).then(() => true).catch(() => false);
  const editorHasImg = (page, url) => page.evaluate((u) => !!document.querySelector(`#editor-col img[src="${u}"]`), url);
  const rowText = (page, sel) => page.evaluate((s) => { const el = document.querySelector(s); const row = el && el.closest(".prod-row"); return row ? row.innerText : null; }, sel);

  /**
   * 對一個區塊走完整把尺：hold 住補抓 → 選段 → 讀「取圖中…」→ 放行 → 等補抓收尾 → 每道門換一張驗三處 → 替換入口
   * opts.door＝這段主要的門牌（gapKey 前綴）；opts.pendingRow／failRow＝要驗字樣的那一列（CSS 選擇器，落在該列任一元素）
   */
  async function sweepSection(page, secId, tag, opts) {
    opts = opts || {};
    const door = opts.door || "?";
    holdFetch();
    if (opts.select !== false) { await page.evaluate((id) => selectNode(id), secId); await page.waitForSelector(`#editor-col #${secId}`, { timeout: 8000 }); await page.waitForTimeout(150); }
    if (opts.pendingRow) {
      const t = (await rowText(page, opts.pendingRow)) || "";
      ok(`${tag}:pending`, `${door}:pending`, `${tag}：單圖商品補抓中先顯示「取圖中…」`, /取圖中/.test(t), /單圖|單張圖/.test(t) ? "一進場就寫「單圖／單張圖」＝沒有補抓那條路" : (t ? "" : "找不到那一列"));
    }
    release();
    await settled(page);
    if (opts.failRow) {
      const t = (await rowText(page, opts.failRow)) || "";
      ok(`${tag}:single-voice`, `${door}:single-voice`, `${tag}：補抓失敗那件講「單圖」（不靜默）`, /單圖|單張圖/.test(t), t ? `列文字含「${(t.match(/單圖|單張圖|取圖中/) || ["（沒有任何說法）"])[0]}」` : "找不到那一列");
    }
    const doors = await listDoors(page);
    ok(`${tag}:doors`, null, `${tag}：區塊裡有商品圖下拉`, doors.length > 0, `${doors.length} 道`);
    for (const d of doors) {
      if (!d.attr) { // 停用態（單圖／單張圖／取圖中）＝沒有 data-* 門牌
        if (d.gdid && FAIL_FETCH.has(String(d.gdid))) { ok(`${tag}:${d.gdid}:single-voice`, `${door}:single-voice`, `${tag}：補抓失敗那件講「單圖」（不靜默）`, /單圖/.test(d.first), `顯示「${d.first}」`); continue; }
        ok(`${tag}:${d.gdid || d.name}:fetch`, `${door}:fetch`, `${tag}：${d.name || d.gdid || "某列"} 只有一張圖卻沒補抓成功（停在「${d.first}」）`, false, "期待補抓後長出 5 個選項");
        continue;
      }
      if (d.disabled) { ok(`${tag}:${d.attr}[${d.idx}]:enabled`, null, `${tag}：${d.attr}[${d.idx}] 下拉可用`, false, "disabled"); continue; }
      const k = (Math.max(0, await page.evaluate(([a, i]) => document.querySelector(`[data-${a}="${i}"]`).selectedIndex, [d.attr, d.idx])) + 1) % d.options;
      const url = await chosenUrl(page, d, k);
      if (!url) { ok(`${tag}:${d.attr}[${d.idx}]:url`, null, `${tag}：${d.attr}[${d.idx}] 算不出第 ${k + 1} 張的網址`, false); continue; }
      await page.locator(`#editor-col [data-${d.attr}="${d.idx}"]`).selectOption({ index: k });
      await page.waitForTimeout(250);
      const now = await targetField(page, d);
      ok(`${tag}:${d.attr}[${d.idx}]:draft`, `${d.attr}:draft`, `${tag}：${d.attr}[${d.idx}] 換第 ${k + 1} 張＝草稿該欄更新`, now === url, now === url ? "" : `草稿＝${String(now).slice(-40)}`);
      ok(`${tag}:${d.attr}[${d.idx}]:thumb`, `${d.attr}:thumb`, `${tag}：${d.attr}[${d.idx}] 列上縮圖跟著換`, await editorHasImg(page, url));
      ok(`${tag}:${d.attr}[${d.idx}]:preview`, `${d.attr}:preview`, `${tag}：${d.attr}[${d.idx}] 預覽畫出那張圖`, await previewHas(page, url));
    }
    // 替換入口：每列一顆
    const swap = await page.evaluate(() => ({
      rows: document.querySelectorAll("#editor-col .prod-row:has(.pr-thumb)").length, // 有縮圖的列＝商品列（加一件／入口列另計）
      entryRows: document.querySelectorAll("#editor-col .prod-row:has([data-mimg])").length,
      swapBtns: document.querySelectorAll("#editor-col button[data-swap], #editor-col button[data-ecswap]").length,
      heroBtns: document.querySelectorAll('#editor-col button[onclick^="heroSwapProduct"]').length,
      fetchBtns: document.querySelectorAll("#editor-col button[data-mfetch]").length }));
    if (opts.swapKind === "hero") ok(`${tag}:swap`, null, `${tag}：每列有「換」入口`, swap.heroBtns >= swap.rows && swap.rows > 0, `${swap.heroBtns}/${swap.rows}`);
    else if (opts.swapKind === "promo") ok(`${tag}:swap`, null, `${tag}：每則入口有「取圖」入口`, swap.fetchBtns >= swap.entryRows && swap.entryRows > 0, `${swap.fetchBtns}/${swap.entryRows}`);
    else {
      ok(`${tag}:swap`, null, `${tag}：有「替換商品」鈕`, swap.swapBtns > 0, `${swap.swapBtns} 顆／${swap.rows} 列`);
      if (swap.swapBtns) {
        await page.locator("#editor-col button[data-swap], #editor-col button[data-ecswap]").first().click();
        const opened = await page.waitForSelector("#swap-modal.open", { timeout: 3000 }).then(() => true).catch(() => false);
        ok(`${tag}:swap-open`, null, `${tag}：按替換＝開替換視窗`, opened);
        if (opened) await page.locator("#swap-cancel").click();
      }
    }
    await shots(page, `doors-${tag}.png`);
  }
  const consoleCheck = (page, tag) => {
    const badHttp = page._http4.filter((u) => !EXPECTED_4XX.some((re) => re.test((u.split(" ")[1] || "").split("?")[0])));
    const benign = page._errs.filter((e) => !/favicon/i.test(e) && !(/Failed to load resource/.test(e) && badHttp.length === 0));
    ok(`${tag}:console`, null, `${tag}：console 零 error（報告探測 404／假商品頁 400 除外）`, benign.length === 0 && badHttp.length === 0, benign.concat(badHttp).slice(0, 4).join(" / "));
  };

  /* ── 新版式種子：主視覺（hero 商品）／本期活動／樓層 ×3（商品卡＋情境卡）／編輯精選（圓卡＋牆）／品類牆 ×3 ── */
  {
    const page = await newPage();
    const c = seeds.v2.cases;
    holdFetch(); // 主視覺是進場預設段＝補抓在開頁時就會發，先 hold 住才看得到「取圖中…」
    await openRunUi(page, seeds.v2.id);
    await sweepSection(page, "sec-kv", "主視覺-新版式", { select: false, door: "himgsel", pendingRow: `#editor-col #sec-kv .prod-row:has(img.pr-thumb[src*="${c.hero}"]) .pr-thumb, #editor-col #sec-kv .prod-row .pr-thumb`, swapKind: "hero" });
    await sweepSection(page, "sec-promo", "本期活動", { door: "mimgpick", pendingRow: '#editor-col [data-path="page.promoEntries.2.url"]', failRow: '#editor-col [data-path="page.promoEntries.1.url"]', swapKind: "promo" });
    await sweepSection(page, "sec-floor-0", "樓層1", { door: "imgsel", pendingRow: `#editor-col .prod-row[data-gdid="${c.floorCard}"] .pr-name` });
    await sweepSection(page, "sec-floor-1", "樓層2", { door: "imgsel" });
    await sweepSection(page, "sec-floor-2", "樓層3", { door: "imgsel" });
    await sweepSection(page, "sec-editorial", "編輯精選", { door: "ecimgsel", pendingRow: `#editor-col .prod-row:has(a[href*="${c.circle}"]) .pr-name`, failRow: `#editor-col .prod-row[data-gdid="${c.edWall}"] .pr-name` });
    await sweepSection(page, "sec-wall-0", "品類牆1", { door: "imgsel", pendingRow: `#editor-col .prod-row[data-gdid="${c.wall}"] .pr-name` });
    await sweepSection(page, "sec-wall-1", "品類牆2", { door: "imgsel" });
    await sweepSection(page, "sec-wall-2", "品類牆3", { door: "imgsel" });
    // 情境卡門有沒有真的出現（09-07 病例：樓層第一張情境商品沒露臉）
    await page.evaluate(() => selectNode("sec-floor-0")); await page.waitForSelector("#editor-col #sec-floor-0");
    const sceneDoors = await page.evaluate(() => document.querySelectorAll("#editor-col [data-scimgsel]").length);
    ok("scene:door", null, "樓層1：情境卡商品列有自己的用圖下拉", sceneDoors === 1, `${sceneDoors} 道`);
    consoleCheck(page, "新版式種子");
    await page.close();
  }
  /* ── 現行版型種子：主視覺 kv 用圖下拉（data-kvimgsel） ── */
  {
    const page = await newPage();
    holdFetch();
    await openRunUi(page, seeds.legacy.id);
    await sweepSection(page, "sec-kv", "主視覺-現行版型", { select: false, door: "kvimgsel", pendingRow: "#editor-col #sec-kv .prod-row .pr-name" });
    consoleCheck(page, "現行版型種子");
    await page.close();
  }

  await browser.close();
  if (server && !argv.includes("--keep-server")) server.kill();

  const unexpected = results.filter((r) => !r.pass && !r.gap);
  const gapsGreen = results.filter((r) => r.pass && r.gap);
  const gapsRed = results.filter((r) => !r.pass && r.gap);
  const staleGaps = Object.keys(KNOWN_GAPS).filter((g) => !results.some((r) => r.gapKey === g)); // 名單上有、這輪卻沒有任何檢查對到它＝名單漂了
  fs.writeFileSync(path.join(OUT, "results.json"), JSON.stringify({ at: new Date().toISOString(), seeds, knownGaps: KNOWN_GAPS, results }, null, 1));
  console.log(`\n合計 ${results.length} 項：✔ ${results.filter((r) => r.pass && !r.gap).length}｜✖ 非預期 ${unexpected.length}｜◌ 已知缺口 ${gapsRed.length}${gapsGreen.length ? `｜⚠ 已知缺口卻綠 ${gapsGreen.length}（名單過期）` : ""}${staleGaps.length ? `｜⚠ 名單上沒被任何檢查對到：${staleGaps.join("、")}` : ""}`);
  console.log(`截圖與 results.json → ${OUT}`);
  process.exit(unexpected.length || gapsGreen.length || staleGaps.length ? 1 : 0);
})().catch((e) => { console.error("✖ 入口全掃中斷：", e && e.stack || e); try { if (global.__doorsServer) global.__doorsServer.kill(); } catch (e2) { /* server 已不在 */ } process.exit(2); });
