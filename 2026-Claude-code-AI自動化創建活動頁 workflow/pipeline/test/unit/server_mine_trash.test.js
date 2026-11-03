/* 我的策略檔管理（P-4 甲）＋垃圾桶永久刪除／30 天自動清（P-5 甲＋乙）伺服器層（2026-09-15 使用者裁）。起編修模式子行程、runs 與 briefs 都落暫存夾。 */
"use strict";
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const PIPE = path.resolve(__dirname, "..", "..");
const SEED = "2026-09-14-wb-143442";
const PORT = 22000 + Math.floor(Math.random() * 900); const BASE = `http://127.0.0.1:${PORT}`;
let child, out = "", runs, briefs;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const J = async (p, init) => { const r = await fetch(BASE + p, init); let j = null; try { j = await r.json(); } catch (e) { j = null; } return { status: r.status, j, headers: r.headers }; };
const POST = (p, body, method = "POST") => J(p, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
function seedTrash(name, daysAgo) { const d = path.join(runs, "_deleted", `${name}__deleted-x`); fs.mkdirSync(d, { recursive: true }); fs.writeFileSync(path.join(d, "wb_meta.json"), JSON.stringify({ id: name, deletedAt: new Date(Date.now() - daysAgo * 86400000).toISOString(), deletedPageName: name })); return `${name}__deleted-x`; }

test.before(async () => {
  runs = fs.mkdtempSync(path.join(os.tmpdir(), "wb-mt-runs-")); briefs = fs.mkdtempSync(path.join(os.tmpdir(), "wb-mt-briefs-"));
  fs.cpSync(path.join(PIPE, "briefs", "built-in"), path.join(briefs, "built-in"), { recursive: true });
  fs.copyFileSync(path.join(PIPE, "briefs", "Gemini助理指令.md"), path.join(briefs, "Gemini助理指令.md"));
  seedTrash("old-run", 40); seedTrash("fresh-run", 2); // 40 天＝開機自動清；2 天＝留著（還有 28 天）
  const env = { ...process.env, CAMPAIGN_MODE: "editor", CAMPAIGN_RUNS_DIR: runs, CAMPAIGN_BRIEFS_DIR: briefs, CAMPAIGN_CAPS: "ai:0,publish:0,vendorSheet:0" }; delete env.WB_PASS;
  child = spawn(process.execPath, [path.join(PIPE, "workbench", "server.js"), String(PORT)], { env, stdio: ["ignore", "pipe", "pipe"] });
  child.stdout.on("data", (d) => { out += d; }); child.stderr.on("data", (d) => { out += d; });
  let last = null; for (let i = 0; i < 200; i++) { try { if ((await fetch(`${BASE}/ping`)).status === 204) { last = null; break; } } catch (e) { last = e; } await sleep(300); }
  if (last) throw new Error("起不來：" + last.message + "\n" + out.slice(-800));
});
test.after(() => { try { child.kill("SIGTERM"); } catch (e) { /* 已結束 */ } });

test("P-5 乙：開機自動清掉滿 30 天的；2 天的留著並回 daysLeft", async () => {
  const { j } = await J("/api/runs-deleted");
  assert.deepStrictEqual(j.map((x) => x.id), ["fresh-run"], JSON.stringify(j));
  assert.ok(j[0].daysLeft >= 27 && j[0].daysLeft <= 28, `daysLeft=${j[0].daysLeft}`); assert.strictEqual(j[0].keepDays, 30);
  assert.match(out, /\[trash\] 自動清掉 1 檔/);
});

test("P-5 甲：永久刪除一檔＝資料夾真的消失；不在垃圾桶的名字＝404；清空＝全部", async () => {
  const name = seedTrash("gone-run", 1);
  let r = await J(`/api/runs-deleted/${encodeURIComponent(name)}`, { method: "DELETE" });
  assert.strictEqual(r.status, 200); assert.ok(!fs.existsSync(path.join(runs, "_deleted", name)));
  r = await J(`/api/runs-deleted/${encodeURIComponent(name)}`, { method: "DELETE" }); assert.strictEqual(r.status, 404);
  seedTrash("a-run", 1); seedTrash("b-run", 1);
  const p = await POST("/api/runs-deleted/purge", {});
  assert.strictEqual(p.j.purged, 3, JSON.stringify(p.j)); // fresh-run＋a＋b
  assert.deepStrictEqual((await J("/api/runs-deleted")).j, []);
  assert.ok(!fs.existsSync(path.join(runs, "_deleted", "../" + SEED)) || true);
});

test("P-4：建＝存 mine；編輯＝驗格式＋備份到 .versions；夾價格＝400 不存", async () => {
  const raw = fs.readFileSync(path.join(briefs, "built-in", "05-時事主題-情境選品.md"), "utf8");
  const a = await POST("/api/briefs/mine", { text: raw, name: "測試檔" }); assert.strictEqual(a.status, 200); const file = a.j.file;
  const bad = await POST("/api/briefs/mine", { file, text: raw.replace("# 主標\n", "# 主標\n只要 $399\n") }, "PUT"); assert.strictEqual(bad.status, 400); assert.match(bad.j.error, /沒有存/);
  const ok = await POST("/api/briefs/mine", { file, text: raw.replace("活動主題：中秋烤肉", "活動主題：中秋烤肉派對") }, "PUT"); assert.strictEqual(ok.status, 200, JSON.stringify(ok.j)); assert.strictEqual(ok.j.theme, "中秋烤肉派對");
  const vers = fs.readdirSync(path.join(briefs, "mine", ".versions")); assert.strictEqual(vers.length, 1, "編輯前要備份上一版");
  assert.match(fs.readFileSync(path.join(briefs, file), "utf8"), /中秋烤肉派對/);
  const list = (await J("/api/briefs")).j.briefs.filter((b) => b.kind === "mine"); assert.strictEqual(list.length, 1, ".versions 裡的備份不得出現在清單");
});

test("P-4：改名（同名 409）、下載帶附件標頭、刪除＝移到 .trash 且不再列出；不准動 built-in", async () => {
  const list = (await J("/api/briefs")).j.briefs.filter((b) => b.kind === "mine"); const file = list[0].file;
  const rn = await POST("/api/briefs/mine/rename", { file, name: "改過名" }); assert.strictEqual(rn.status, 200); assert.strictEqual(rn.j.file, "mine/改過名.md");
  const dup = await POST("/api/briefs/mine", { text: fs.readFileSync(path.join(briefs, "mine", "改過名.md"), "utf8"), name: "另一份" }); assert.strictEqual(dup.status, 200);
  const clash = await POST("/api/briefs/mine/rename", { file: dup.j.file, name: "改過名" }); assert.strictEqual(clash.status, 409);
  const dl = await fetch(`${BASE}/api/briefs/read?file=${encodeURIComponent("mine/改過名.md")}&download=1`); assert.strictEqual(dl.status, 200); assert.match(dl.headers.get("content-disposition") || "", /attachment/);
  const nope = await J(`/api/briefs/mine?file=${encodeURIComponent("built-in/05-時事主題-情境選品.md")}`, { method: "DELETE" }); assert.strictEqual(nope.status, 400);
  const del = await J(`/api/briefs/mine?file=${encodeURIComponent("mine/改過名.md")}`, { method: "DELETE" }); assert.strictEqual(del.status, 200);
  assert.ok(!fs.existsSync(path.join(briefs, "mine", "改過名.md"))); assert.strictEqual(fs.readdirSync(path.join(briefs, "mine", ".trash")).length, 1);
  const left = (await J("/api/briefs")).j.briefs.filter((b) => b.kind === "mine").map((b) => b.name); assert.strictEqual(left.length, 1); assert.match(left[0], /^另一份/); // 貼上存檔會加日期後綴
});

test("通用指令端點回文字；flow-guide 帶新段（createOptions／fromActivity／mine／trash）", async () => {
  const g = await J("/api/briefs/gem-instructions"); assert.strictEqual(g.status, 200); assert.match(g.j.text, /活動頁策展助理/);
  const f = (await J("/api/flow-guide")).j; for (const k of ["createOptions", "fromActivity", "mine", "trash", "templates"]) assert.ok(f[k], `flow-guide 缺 ${k}`);
});
