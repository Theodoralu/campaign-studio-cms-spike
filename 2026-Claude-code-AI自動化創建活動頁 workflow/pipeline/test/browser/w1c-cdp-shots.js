"use strict";
/* W1-C UI 驗收截圖（headless Chrome CDP 真點擊，零相依——Node 24 全域 WebSocket）
   用法：node test/browser/w1c-cdp-shots.js <serverPort> <outDir>
        （選配環境變數：W1C_RUN_ID＝e2e run 驗編修頁引擎橫幅；W1C_RETRY_ID＝失敗 run 驗 retryCreate 回填）
   前置：workbench server 先起在 <serverPort>；截圖與 console 記錄對照 docs/design-qa/hero-wave1-form-selector-2026-08-24.md。
   入庫緣由（2026-08-24 review 輕2）：原只存 scratchpad＝design QA 不可重跑；收進 test/browser/ 供後續 wave 重跑。
   不掛 node --test（需要 Chrome＋活 server＝非 hermetic），手動執行。 */
const { spawn, execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const PORT = process.argv[2] || "8791";
const OUT = process.argv[3];
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const DBG = 9333;
/* node --test 會掃整個 test/ 目錄——本腳本非 hermetic（要 Chrome＋活 server＋outDir 參數），
   在測試跑者底下一律跳過出聲，不裝成綠燈測試也不把全庫測試弄紅；手動執行才真跑。 */
const UNDER_TEST_RUNNER = !!process.env.NODE_TEST_CONTEXT;
if (!UNDER_TEST_RUNNER) {
  if (!OUT) { console.error("用法：node test/browser/w1c-cdp-shots.js <serverPort> <outDir>"); process.exit(1); }
  fs.mkdirSync(OUT, { recursive: true });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const prof = fs.mkdtempSync("/tmp/w1c-chrome-");
  const ch = spawn(CHROME, [`--headless=new`, `--remote-debugging-port=${DBG}`, `--user-data-dir=${prof}`, "--no-first-run", "--disable-gpu", "--hide-scrollbars", "about:blank"], { stdio: "ignore" });
  process.on("exit", () => { try { ch.kill(); } catch (e) {} });
  await sleep(1800);
  // 開新分頁
  const t = await fetch(`http://127.0.0.1:${DBG}/json/new?about:blank`, { method: "PUT" }).then((r) => r.json());
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let mid = 0; const pend = new Map();
  const logs = [];
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pend.has(m.id)) { const { res, rej } = pend.get(m.id); pend.delete(m.id); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); }
    if (m.method === "Runtime.consoleAPICalled" && ["error", "warning"].includes(m.params.type)) logs.push(`[console.${m.params.type}] ` + m.params.args.map((a) => a.value || a.description || "").join(" "));
    if (m.method === "Runtime.exceptionThrown") logs.push("[pageerror] " + JSON.stringify(m.params.exceptionDetails.exception || m.params.exceptionDetails.text).slice(0, 300));
  };
  const cdp = (method, params = {}) => new Promise((res, rej) => { const id = ++mid; pend.set(id, { res, rej }); ws.send(JSON.stringify({ id, method, params })); });
  const evl = async (expression) => {
    const r = await cdp("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error("evaluate 失敗: " + JSON.stringify(r.exceptionDetails).slice(0, 400));
    return r.result.value;
  };
  await cdp("Page.enable"); await cdp("Runtime.enable");
  const setVp = (w, h) => cdp("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile: w < 500 });
  async function shot(name, fullpage = true) {
    let clip;
    if (fullpage) {
      const m = await evl("JSON.stringify({w:document.documentElement.scrollWidth,h:Math.min(document.documentElement.scrollHeight, 6000)})");
      const { w, h } = JSON.parse(m);
      clip = { x: 0, y: 0, width: w, height: h, scale: 1 };
    }
    const r = await cdp("Page.captureScreenshot", { format: "png", captureBeyondViewport: fullpage, ...(clip ? { clip } : {}) });
    fs.writeFileSync(path.join(OUT, name), Buffer.from(r.data, "base64"));
    console.log("📸", name);
  }
  const overflowCheck = async (label) => {
    const r = await evl("JSON.stringify({sw:document.documentElement.scrollWidth, iw:window.innerWidth})");
    const { sw, iw } = JSON.parse(r);
    console.log(sw > iw ? `❌ ${label}: 水平溢出 scrollWidth=${sw} > innerWidth=${iw}` : `✅ ${label}: 無水平溢出（${sw}<=${iw}）`);
  };

  await setVp(1440, 1000);
  await cdp("Page.navigate", { url: `http://127.0.0.1:${PORT}/` });
  await sleep(2500);
  await evl("setView('create'); 'ok'");
  await sleep(1800); // 等 catalog＋AI 代選預覽

  // S1 預設態：AI 卡選中＋理由行
  console.log("cards:", await evl("$$('#layout-cards .layout-card').length"));
  console.log("ai-selected:", await evl("$$('#layout-cards .layout-card.on')[0] && $$('#layout-cards .layout-card.on')[0].dataset.kind"));
  console.log("reason:", await evl("document.getElementById('layout-reason').textContent.slice(0,80)"));
  await evl("document.getElementById('layout-cards').scrollIntoView(); 'ok'");
  await shot("01-create-default-1440.png");
  await overflowCheck("1440 create");

  // S2 手選 002＋折扣開關 → 值=003
  await evl("(()=>{const c=$$('#layout-cards .layout-card').find(x=>x.dataset.base==='layout-002'); c.click(); return 'ok'})()");
  await sleep(300);
  console.log("val after 002:", await evl("document.getElementById('in-kv-variant').value"));
  await evl("(()=>{const c=$$('#layout-cards .layout-card').find(x=>x.dataset.base==='layout-002'); const t=c.querySelector('.dtoggle input'); t.checked=true; t.dispatchEvent(new Event('change')); return 'ok'})()");
  await sleep(300);
  console.log("val after 002+折扣:", await evl("document.getElementById('in-kv-variant').value"));
  await shot("02-manual-002-discount-1440.png");

  // S3 008 卡切換預告可見
  console.log("008 switchNote:", await evl("(()=>{const c=$$('#layout-cards .layout-card').find(x=>x.dataset.base==='layout-008'); return c && c.querySelector('.dnote') ? c.querySelector('.dnote').textContent : 'MISSING'})()"));

  // S4 提案包合法（qaStatus 黃燈）＝整組帶入＋選卡 006+開關（007）
  await evl(`document.getElementById('in-pack').value = JSON.stringify({version:1,layout:'layout-007',background:'bg-005',theme:'green-light',font:'font-001',motion:'static',qaStatus:'draft'}); document.getElementById('btn-pack-apply').click(); 'ok'`);
  await sleep(900);
  console.log("val after pack:", await evl("document.getElementById('in-kv-variant').value"));
  console.log("pack result head:", await evl("document.getElementById('pack-result').textContent.slice(0,60)"));
  await shot("03-pack-applied-yellow-1440.png");

  // S5 帶包後手動改版式＝偏離徽章
  await evl("(()=>{const c=$$('#layout-cards .layout-card').find(x=>x.dataset.base==='layout-004'); c.click(); return 'ok'})()");
  await sleep(400);
  console.log("deviate badge:", await evl("document.getElementById('pack-deviate').style.display !== 'none'"));
  await shot("04-pack-deviated-1440.png");

  // S6 提案包非法＝逐條錯誤、整包擋下（值不動）
  await evl(`document.getElementById('in-pack').value = JSON.stringify({layout:'layout-999',background:'bg-999'}); document.getElementById('btn-pack-apply').click(); 'ok'`);
  await sleep(900);
  console.log("val after bad pack（應不變 layout-004）:", await evl("document.getElementById('in-kv-variant').value"));
  await shot("05-pack-invalid-errors-1440.png");

  // S7 縮圖缺檔佔位（把一張圖 src 改壞驗 onerror 路徑）
  await evl("(()=>{const img=$$('#layout-cards .layout-card img')[0]; img.src='/api/layout-thumbs/no-such.png'; return 'ok'})()");
  await sleep(700);
  console.log("placeholder:", await evl("$$('#layout-cards .th .ph').length > 0"));

  // S8/S9 三 viewport 破版檢查
  await setVp(768, 1100); await sleep(400); await shot("06-create-768.png"); await overflowCheck("768 create");
  await setVp(375, 900); await sleep(400); await shot("07-create-375.png"); await overflowCheck("375 create");
  await setVp(1440, 1000); await sleep(400);

  // S10 編修頁引擎誠實橫幅（用 e2e run）
  const runId = process.env.W1C_RUN_ID || "";
  if (runId) {
    await evl(`openRun('${runId}'); 'ok'`);
    await sleep(3000);
    console.log("engine banner:", await evl("document.getElementById('layout-engine-note').textContent.slice(0,80) || 'HIDDEN'"));
    await shot("08-editor-engine-note-1440.png");
    await overflowCheck("1440 editor");
  }

  // S11 retryCreate 回填（用失敗 run）
  const retryId = process.env.W1C_RETRY_ID || "";
  if (retryId) {
    await evl(`setView('list'); 'ok'`); await sleep(600);
    await evl(`retryCreate('${retryId}'); 'ok'`);
    await sleep(1500);
    console.log("retry 回填 val:", await evl("document.getElementById('in-kv-variant').value"));
    console.log("retry 高亮卡:", await evl("(()=>{const c=$$('#layout-cards .layout-card.on')[0]; return c ? (c.dataset.base||c.dataset.kind) : 'NONE'})()"));
    await shot("09-retry-refill-1440.png");
  }

  console.log("---- console/pageerror 訊息（favicon 404 既有紅字除外）----");
  logs.forEach((l) => console.log(l));
  if (!logs.length) console.log("（無）");
  ws.close(); ch.kill();
}
if (UNDER_TEST_RUNNER) {
  console.log("w1c-cdp-shots：手動 UI 驗收腳本（需 Chrome＋活 server），node --test 下跳過——手動跑：node test/browser/w1c-cdp-shots.js <serverPort> <outDir>");
} else {
  main().catch((e) => { console.error("FAIL:", e.message); process.exit(1); });
}
