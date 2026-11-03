"use strict";
/* source_check_offline.test.js —— 第①件端對端故障注入：整台「連不到」時，來源探測要回 kind=network、結論不叫人換網址、技術訊息印得出原因。
   做法：用 CS_FETCH_SIMULATE_OFFLINE=1 起一顆 server（fetchPage 會丟多位址全掛的 AggregateError），對 /api/source-check 貼一個好網址。
   對照＝09-22 病例：同一個網址在畫面上被說「這個網址目前還不能用——換個來源再試」，技術訊息空白。 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

const PIPE = path.resolve(__dirname, "..", "..");
const PORT = 24000 + Math.floor(Math.random() * 900);
const BASE = `http://127.0.0.1:${PORT}`;
let child, out = "";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test.before(async () => {
  const runs = fs.mkdtempSync(path.join(os.tmpdir(), "wb-offline-runs-"));
  const env = { ...process.env, CAMPAIGN_MODE: "editor", CAMPAIGN_RUNS_DIR: runs, CAMPAIGN_CAPS: "ai:0,publish:0,vendorSheet:0", CS_FETCH_SIMULATE_OFFLINE: "1" };
  delete env.WB_PASS;
  child = spawn(process.execPath, [path.join(PIPE, "workbench", "server.js"), String(PORT)], { env, stdio: ["ignore", "pipe", "pipe"] });
  child.stdout.on("data", (d) => { out += d; }); child.stderr.on("data", (d) => { out += d; });
  let last = null;
  for (let i = 0; i < 200; i++) { try { if ((await fetch(`${BASE}/ping`)).status === 204) { last = null; break; } } catch (e) { last = e; } await sleep(300); }
  if (last) throw new Error("起不來：" + last.message + "\n" + out.slice(-800));
});
test.after(() => { try { child.kill(); } catch (e) { console.warn("收工殺不掉測試 server（多半已自己退了）：" + e.message); } });

test("整台連不到：好網址的探測回 kind=network，結論講網路不講換網址，技術訊息有 ECONNREFUSED", async () => {
  const r = await fetch(`${BASE}/api/source-check`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url: "https://tw.buy.yahoo.com/brands/41193409" }) });
  assert.strictEqual(r.status, 200);
  const j = await r.json();
  assert.strictEqual(j.ok, false);
  assert.strictEqual(j.kind, "network");
  assert.match(j.verdict, /連不到 Yahoo/);
  assert.match(j.verdict, /不是網址的問題/);
  assert.doesNotMatch(j.verdict, /換個來源|改貼品牌頁/);
  assert.match(j.tech, /ECONNREFUSED/);
  assert.match(j.verdict, /（技術訊息：.+）$/);
  await sleep(200);
  assert.match(out, /\[source-check\] 讀取失敗（network）/); // 失敗要出聲：server 端留痕
});

test("前置擋（非 Yahoo 網域）不受影響：沒有 kind、維持原結論", async () => {
  const r = await fetch(`${BASE}/api/source-check`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url: "https://example.com/x" }) });
  const j = await r.json();
  assert.strictEqual(j.ok, false); assert.strictEqual(j.kind, undefined); assert.match(j.verdict, /只支援 Yahoo購物中心/);
});
