/* 「從活動出發」三步的介面截圖（P-6 甲，2026-09-15）：自起編修模式測試伺服器＋種子活動，拍左欄「內容策略」段三個狀態，存成產物 workbench/public/flow-shots/step-{1,2,3}.png。
   每次介面改動重跑＝圖永遠跟畫面一致；無頭截圖沒有書籤列與私人資訊（鐵律 11）。用法：node tools/shoot-flow-guide.mjs（需 Chrome）。 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url)); const PIPE = path.resolve(HERE, "..");
const pw = require(path.join(PIPE, "node_modules", "playwright-core"));
const OUT = path.join(PIPE, "workbench", "public", "flow-shots"); fs.mkdirSync(OUT, { recursive: true });
const SEED = "2026-09-14-wb-143442"; const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const runs = fs.mkdtempSync(path.join(os.tmpdir(), "shots-runs-")), briefs = fs.mkdtempSync(path.join(os.tmpdir(), "shots-briefs-")); const port = 23000 + Math.floor(Math.random() * 900);
fs.cpSync(path.join(PIPE, "runs", SEED), path.join(runs, SEED), { recursive: true }); fs.cpSync(path.join(PIPE, "briefs", "built-in"), path.join(briefs, "built-in"), { recursive: true });
/* 種子＝沒套過策略檔的樣子（拍的是「第一次來」） */
const mp = path.join(runs, SEED, "wb_meta.json"); const m = JSON.parse(fs.readFileSync(mp, "utf8")); m.input.briefFile = ""; m.input.theme = "中秋烤肉"; fs.writeFileSync(mp, JSON.stringify(m, null, 1));
const dp = path.join(runs, SEED, "draft.json"); const d = JSON.parse(fs.readFileSync(dp, "utf8")); if (d.meta) delete d.meta.brief; fs.writeFileSync(dp, JSON.stringify(d, null, 2));
const env = { ...process.env, CAMPAIGN_MODE: "editor", CAMPAIGN_RUNS_DIR: runs, CAMPAIGN_BRIEFS_DIR: briefs, CAMPAIGN_CAPS: "ai:0,publish:0,vendorSheet:0" }; delete env.WB_PASS;
const ch = spawn(process.execPath, [path.join(PIPE, "workbench", "server.js"), String(port)], { env, stdio: ["ignore", "pipe", "pipe"] });
let log = ""; ch.stdout.on("data", (x) => { log += x; }); ch.stderr.on("data", (x) => { log += x; });
let last = null; for (let i = 0; i < 200; i++) { try { if ((await fetch(`http://127.0.0.1:${port}/ping`)).status === 204) { last = null; break; } } catch (e) { last = e; } await sleep(300); }
if (last) { console.error("伺服器起不來：" + last.message + "\n" + log.slice(-600)); process.exit(1); }
const b = await pw.chromium.launch({ channel: "chrome", headless: true });
const ctx = await b.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 2 });
await ctx.addInitScript(() => { try { localStorage.setItem("cs-welcome-v1", "1"); } catch (e) { console.warn(e.message); } });
await ctx.grantPermissions(["clipboard-read", "clipboard-write"]).catch(() => { console.warn("剪貼簿權限拿不到，第 2 步會拍退路視窗"); });
const p = await ctx.newPage();
await p.goto(`http://127.0.0.1:${port}/`, { waitUntil: "domcontentloaded" }); await p.waitForSelector("#home-create-card", { timeout: 20000 }); await p.waitForTimeout(1200);
await p.evaluate((id) => openRun(id), SEED); await p.waitForTimeout(3500);
if (await p.$eval("#brief-float", (e) => e.hidden)) { await p.click("#lc-brief .lc-head"); await p.waitForTimeout(400); }
const shotCol = async (name) => { const el = await p.$("#brief-float"); await el.screenshot({ path: path.join(OUT, name) }); console.log("✓ " + name); }; // 拍浮動面板（2026-09-15 改浮層）
await shotCol("step-1.png");                                             // 第 1 步：左欄「內容策略」段＋三顆鈕（第一次來）
await p.click('#brief-panel [data-bp="copy"]'); await p.waitForTimeout(1200);
await shotCol("step-2.png");                                             // 第 2 步：按了「複製給 Gemini 的話」＝步 1 打勾
const raw = fs.readFileSync(path.join(briefs, "built-in", "05-時事主題-情境選品.md"), "utf8");
await p.click('#brief-panel [data-bp="paste"]'); await p.waitForTimeout(300); await p.fill("#bp-paste", raw); await p.click('#brief-panel [data-bp="paste-go"]'); await p.waitForTimeout(1500);
await shotCol("step-3.png");                                             // 第 3 步：貼回＝對帳卡＋重做鈕亮
await b.close(); ch.kill("SIGTERM");
for (const f of fs.readdirSync(OUT)) console.log(`  ${f} ${Math.round(fs.statSync(path.join(OUT, f)).size / 1024)} KB`);
