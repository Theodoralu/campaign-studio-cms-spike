/* 編修模式（同事版）伺服器層絆線（2026-09-15 B 批；69 號 Phase 1＋牆第 6 題甲）。
   起一個真的伺服器子行程（CAMPAIGN_MODE=editor、runs 落到暫存夾、能力全關覆寫＝不會真的去叫 Claude），從最外層 HTTP 打進去：
   ①/api/version 帶 mode 與能力表 ②發佈／Google／試算表／線上改價路由逐條 403 且講白話 ③送 engine:"ai" 被擋、白話先講
   ④沒掛每日排程、綁 127.0.0.1 ⑤沒被擋的路由（export-zip）不是 403——名單只擋該擋的。
   為什麼要真起一台：介面藏了入口只是體貼，最後一道是伺服器；「一句話抄在四十處」的病在名單類判定最致命（鐵律 4）。 */
"use strict";
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

const PIPE = path.resolve(__dirname, "..", "..");
const PORT = 18000 + Math.floor(Math.random() * 1000);
const BASE = `http://127.0.0.1:${PORT}`;
const BLOCKED = ["deploy", "publish-public", "sheet-create", "sheet-read", "sheet-status", "sheet-unlink"]; // apply-live-price(-all) 2026-09-16 移出（牆 P-8 甲：只改本機快照、不碰線上頁；擋著＝同事遇變價死巷）
const UNBLOCKED_LOCAL_PRICE = ["apply-live-price", "apply-live-price-all"];

let child, out = "";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, ms, what) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { try { const v = await fn(); if (v) return v; } catch (e) { /* 還沒好 */ } await sleep(300); }
  throw new Error(`等不到 ${what}（${ms / 1000} 秒）；伺服器輸出：\n${out.slice(-1200)}`);
}

test.before(async () => {
  const runsDir = fs.mkdtempSync(path.join(os.tmpdir(), "wb-editor-runs-"));
  const env = { ...process.env, CAMPAIGN_MODE: "editor", CAMPAIGN_RUNS_DIR: runsDir, CAMPAIGN_CAPS: "ai:0,publish:0,vendorSheet:0" };
  delete env.WB_PASS;
  child = spawn(process.execPath, [path.join(PIPE, "workbench", "server.js"), String(PORT)], { env, stdio: ["ignore", "pipe", "pipe"] });
  child.stdout.on("data", (d) => { out += d; }); child.stderr.on("data", (d) => { out += d; });
  await waitFor(async () => (await fetch(`${BASE}/ping`)).status === 204, 60000, "/ping 204");
  await waitFor(async () => { const v = await (await fetch(`${BASE}/api/version`)).json(); return v.caps ? v : null; }, 30000, "能力表偵測完成");
});
test.after(() => { try { child.kill("SIGTERM"); } catch (e) { /* 已結束 */ } });

test("/api/version：mode=editor、能力三項皆無、覆寫的項標「未探測」", async () => {
  const v = await (await fetch(`${BASE}/api/version`)).json();
  assert.strictEqual(v.mode, "editor");
  assert.deepStrictEqual(v.caps, { ai: false, publish: false, vendorSheet: false });
  assert.match(v.capsDetail.ai.note, /未探測/);
  assert.ok(v.boot && v.html, "版本握手欄位照舊（前端 checkVersion 靠它）");
});

test("編修模式：發佈／對外／試算表／線上改價逐條 403，錯誤句白話先講、技術句尾", async () => {
  for (const r of BLOCKED) {
    const res = await fetch(`${BASE}/api/runs/some-run/${r}`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    assert.strictEqual(res.status, 403, `${r} 應為 403`);
    const j = await res.json();
    assert.match(j.error, /同事的編修版/, `${r} 錯誤句要講清楚這是同事版`);
    assert.match(j.error, /AEM 網頁檔/, `${r} 錯誤句要指路（交付＝下載 AEM 網頁檔）`);
    assert.match(j.error, /（技術：/, `${r} 技術訊息收句尾括號`);
  }
  const g = await fetch(`${BASE}/api/google/auth`);
  assert.strictEqual(g.status, 403, "Google 連結入口在編修模式也 403");
});

test("沒在名單上的路由不受影響（export-zip 不是 403）", async () => {
  const res = await fetch(`${BASE}/api/runs/some-run/export-zip`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
  assert.notStrictEqual(res.status, 403);
});

test("P-8：套用新價（單品／批次）在編修模式不是 403——同事遇變價要有路可走", async () => {
  for (const r of UNBLOCKED_LOCAL_PRICE) {
    const res = await fetch(`${BASE}/api/runs/some-run/${r}`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    assert.notStrictEqual(res.status, 403, `${r} 不該被編修模式擋（它只改本機快照）`);
  }
});

test("送 engine:\"ai\" 建立＝400 白話擋下（介面藏了卡、伺服器再擋一次）", async () => {
  const res = await fetch(`${BASE}/api/runs`, { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ url: "https://tw.buy.yahoo.com/search/product?p=x", ownerEmail: "qa@yahootwec.com", ownerDept: "QA", engine: "ai" }) });
  assert.strictEqual(res.status, 400);
  const j = await res.json();
  assert.match(j.error, /用不了 AI 智慧策展/);
  assert.match(j.error, /快速草稿/, "要指路：改選快速草稿");
});

test("啟動輸出：宣告編修模式、沒掛每日排程、綁 127.0.0.1", () => {
  assert.match(out, /模式：編修/);
  assert.doesNotMatch(out, /每日自我測試排程：已掛載/, "同事版不得有任何排程醒來");
  assert.match(out, /綁定：127\.0\.0\.1/);
});

/* 能力表重測（2026-09-21；story docs/stories/caps-recheck.md）。
   病例＝開機那一刻探一次就定終身：07:54:56 探到「OAuth 過期」→ 08:15 使用者重新登入 → 介面到 08:16 還掛橫幅，
   而且伺服器擋門讀同一份快取＝AI 策展是真的用不了。同事版更嚴重：沒看門狗、沒人可查。 */
test("POST /api/caps/recheck：重測回新的能力表，且編修模式不擋（同事版正需要這顆鈕）", async () => {
  const before = await (await fetch(`${BASE}/api/version`)).json();
  const res = await fetch(`${BASE}/api/caps/recheck`, { method: "POST" });
  assert.strictEqual(res.status, 200, "重測不在 EDITOR_BLOCKED_SUBROUTES，同事版要打得到");
  const j = await res.json();
  assert.deepStrictEqual(Object.keys(j).sort(), ["caps", "capsCheckedAt", "capsDetail"], "回傳形狀＝前端 applyCaps 吃得下");
  assert.deepStrictEqual(j.caps, { ai: false, publish: false, vendorSheet: false });
  assert.ok(new Date(j.capsCheckedAt) >= new Date(before.capsCheckedAt), "檢查時間要往前走＝真的重測過");
  const after = await (await fetch(`${BASE}/api/version`)).json();
  assert.strictEqual(after.capsCheckedAt, j.capsCheckedAt, "重測結果要寫回 CAPS，不是只回給呼叫端（擋門讀的是 CAPS）");
});

test("重測併發共用同一輪：同時三個請求只真的探一次（探針會花 AI 額度，同事機花的是他自己的）", async () => {
  const MARK = "使用者按了重新檢查";
  const n0 = out.split(MARK).length - 1;
  const rs = await Promise.all([1, 2, 3].map(() => fetch(`${BASE}/api/caps/recheck`, { method: "POST" }).then((r) => r.json())));
  await sleep(600); // 等 log 落地
  assert.strictEqual(out.split(MARK).length - 1 - n0, 1, `三個同時的重測只該探一次，實際 ${out.split(MARK).length - 1 - n0} 次`);
  assert.strictEqual(new Set(rs.map((r) => r.capsCheckedAt)).size, 1, "共用同一輪＝三個拿到同一個檢查時間");
});

test("GET 打重測端點不動作（只收 POST）", async () => {
  const MARK = "使用者按了重新檢查";
  const n0 = out.split(MARK).length - 1;
  const res = await fetch(`${BASE}/api/caps/recheck`);
  await sleep(300);
  assert.notStrictEqual(res.status, 200, "GET 不該觸發重測");
  assert.strictEqual(out.split(MARK).length - 1, n0, "GET 不得叫起探針");
});
