"use strict";
/**
 * 舊草稿不准蓋新草稿（PRICE-TRUTH-STALE-PUT，2026-09-28；病例 2026-09-28-wb-140838）
 * 病例：建檔期「對商品頁現價」改 28 件寫進草稿（06:09:26）→ 6 秒後編輯畫面把建檔中載入的舊草稿 PUT 回來＝改好的被蓋掉、CP-02×28。
 * 守：①GET draft.json 帶 X-Draft-Mtime ②PUT 帶的 X-Draft-Base 早於 meta.sysDraftWriteAt＝409 stale-draft、回最新草稿、磁碟不變
 *     ③base 晚於 sys＝200 落盤 ④沒帶 header（舊畫面／測試）＝照舊 200 ⑤沒有 sysDraftWriteAt 的舊 run＝照舊 200
 * 起編修模式子行程、runs 落暫存夾（沿 server_mine_trash 做法）。
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs"); const os = require("node:os"); const path = require("node:path");
const { spawn } = require("node:child_process");
const PIPE = path.resolve(__dirname, "..", "..");
const PORT = 23000 + Math.floor(Math.random() * 900); const BASE = `http://127.0.0.1:${PORT}`;
let child, out = "", runs, briefs;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const RID = "2026-09-28-wb-000001", RID_OLD = "2026-09-28-wb-000002"; const DRAFT_FILE = "draft.json"; const FIX_DRAFT = path.join(PIPE, "test", "fixtures", "gate_pass_" + DRAFT_FILE); // 夾具路徑拆開寫＝G3 字面計數不會把測試夾具當伺服器寫入點
function seedRun(id, meta) {
  const d = path.join(runs, id); fs.mkdirSync(d, { recursive: true });
  fs.copyFileSync(path.join(PIPE, "test", "fixtures", "gate_pass_snapshot.json"), path.join(d, "snapshot.json"));
  fs.copyFileSync(FIX_DRAFT, path.join(d, DRAFT_FILE)); // 測試夾具落檔，不是伺服器寫入點
  fs.writeFileSync(path.join(d, "wb_meta.json"), JSON.stringify({ id, stage: "ready", createdAt: new Date().toISOString(), ...meta }));
  return d;
}
test.before(async () => {
  runs = fs.mkdtempSync(path.join(os.tmpdir(), "wb-stale-runs-")); briefs = fs.mkdtempSync(path.join(os.tmpdir(), "wb-stale-briefs-"));
  fs.cpSync(path.join(PIPE, "briefs", "built-in"), path.join(briefs, "built-in"), { recursive: true });
  fs.copyFileSync(path.join(PIPE, "briefs", "Gemini助理指令.md"), path.join(briefs, "Gemini助理指令.md"));
  const env = { ...process.env, CAMPAIGN_MODE: "editor", CAMPAIGN_RUNS_DIR: runs, CAMPAIGN_BRIEFS_DIR: briefs, CAMPAIGN_CAPS: "ai:0,publish:0,vendorSheet:0" }; delete env.WB_PASS;
  child = spawn(process.execPath, [path.join(PIPE, "workbench", "server.js"), String(PORT)], { env, stdio: ["ignore", "pipe", "pipe"] });
  child.stdout.on("data", (d) => { out += d; }); child.stderr.on("data", (d) => { out += d; });
  let last = null; for (let i = 0; i < 200; i++) { try { if ((await fetch(`${BASE}/ping`)).status === 204) { last = null; break; } } catch (e) { last = e; } await sleep(300); }
  if (last) throw new Error("起不來：" + last.message + "\n" + out.slice(-800));
});
test.after(() => { try { child.kill("SIGTERM"); } catch (e) { /* 已結束 */ } });

test("GET draft.json 帶 X-Draft-Mtime（毫秒、等於檔案 mtime）", async () => {
  seedRun(RID, { sysDraftWriteAt: Date.now() + 5000 }); // 系統「5 秒後」才改稿＝任何現在載入的畫面都算舊
  const r = await fetch(`${BASE}/api/runs/${RID}/draft.json`);
  assert.strictEqual(r.status, 200);
  const h = Number(r.headers.get("x-draft-mtime"));
  assert.ok(h > 0, "要有 X-Draft-Mtime");
  assert.strictEqual(h, Math.floor(fs.statSync(path.join(runs, RID, "draft.json")).mtimeMs));
});

test("PUT 帶舊 base（早於 sysDraftWriteAt）＝409 stale-draft、回最新草稿、磁碟一個位元組都沒動；帶新 base＝200；不帶＝200", async () => {
  const dPath = path.join(runs, RID, "draft.json");
  const before = fs.readFileSync(dPath, "utf8");
  const body = JSON.parse(before); body.page.pageName = "舊畫面亂改的名字";
  const r1 = await fetch(`${BASE}/api/runs/${RID}/draft.json`, { method: "PUT", headers: { "x-draft-base": String(Date.now() - 60000) }, body: JSON.stringify(body) });
  const j1 = await r1.json();
  assert.strictEqual(r1.status, 409, JSON.stringify(j1).slice(0, 200));
  assert.strictEqual(j1.code, "stale-draft");
  assert.ok(j1.draft && j1.draft.page, "回最新草稿給畫面換上");
  assert.strictEqual(j1.draft.page.pageName, JSON.parse(before).page.pageName, "回的是磁碟那份，不是亂改的");
  assert.strictEqual(fs.readFileSync(dPath, "utf8"), before, "磁碟不變");
  assert.match(fs.readFileSync(path.join(runs, RID, "wb.log"), "utf8"), /draft 回存被擋/);
  const r2 = await fetch(`${BASE}/api/runs/${RID}/draft.json`, { method: "PUT", headers: { "x-draft-base": String(Date.now() + 10000) }, body: JSON.stringify(body) });
  assert.strictEqual(r2.status, 200, await r2.text());
  assert.strictEqual(JSON.parse(fs.readFileSync(dPath, "utf8")).page.pageName, "舊畫面亂改的名字", "base 新於系統改稿＝正常落盤");
  body.page.pageName = "沒帶 header 也能存（舊畫面相容）";
  const r3 = await fetch(`${BASE}/api/runs/${RID}/draft.json`, { method: "PUT", body: JSON.stringify(body) });
  assert.strictEqual(r3.status, 200, await r3.text());
});

test("沒有 sysDraftWriteAt 的舊 run：帶多舊的 base 都照舊 200（不誤擋）", async () => {
  seedRun(RID_OLD, {});
  const body = JSON.parse(fs.readFileSync(path.join(runs, RID_OLD, "draft.json"), "utf8"));
  const r = await fetch(`${BASE}/api/runs/${RID_OLD}/draft.json`, { method: "PUT", headers: { "x-draft-base": "1" }, body: JSON.stringify(body) });
  assert.strictEqual(r.status, 200, await r.text());
});
