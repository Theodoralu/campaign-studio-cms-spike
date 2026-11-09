/* 策略檔流程伺服器層（2026-09-15 C 批，牆第 3 題甲）：起編修模式子行程（runs／briefs 都落暫存夾＝不碰真資料），從 HTTP 打進去：
   ①/api/briefs 列表帶第一行型態與主題 ②組「給 Gemini 的話」帶型態、主題、真實商品名、範本 ③貼上就存＋驗＋對帳（型態不一致算得出來；夾價格＝400 不存）
   ④選檔對帳 ⑤建立帶策略檔但沒選型態＝400 白話 ⑥照策略檔重做：先備份、同批商品重排、meta.brief 落檔、核可失效、跑完 ready。 */
"use strict";
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

const PIPE = path.resolve(__dirname, "..", "..");
const SEED = "2026-09-14-wb-143442";
const PORT = 19000 + Math.floor(Math.random() * 900);
const BASE = `http://127.0.0.1:${PORT}`;
let child, out = "", runs, briefs;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, ms, what) { const t0 = Date.now(); let last = null; while (Date.now() - t0 < ms) { try { const v = await fn(); if (v) return v; } catch (e) { last = e; } await sleep(400); } throw new Error(`等不到 ${what}（${ms / 1000} 秒）${last ? "：" + last.message : ""}\n${out.slice(-1500)}`); }
const J = async (p, init) => { const r = await fetch(BASE + p, init); let j = null; try { j = await r.json(); } catch (e) { j = null; } return { status: r.status, j }; };
const POST = (p, body) => J(p, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const seedMeta = () => JSON.parse(fs.readFileSync(path.join(runs, SEED, "wb_meta.json"), "utf8"));

test.before(async () => {
  runs = fs.mkdtempSync(path.join(os.tmpdir(), "wb-brief-runs-")); briefs = fs.mkdtempSync(path.join(os.tmpdir(), "wb-brief-briefs-"));
  fs.cpSync(path.join(PIPE, "runs", SEED), path.join(runs, SEED), { recursive: true });
  /* 種子是活的真實 run，它的 wb.log 會被日常使用一直往後接——把別人的舊紀錄留在考卷上，
     斷言「這一輪有沒有寫某句話」就會被歷史汙染（2026-10-10 病例：使用者當天早上在 CMS 實測建置，
     寫進 48 筆「價格改用商品頁現價」，直接讓 offline 樁紅燈、pre-commit 全擋）。
     清空複本的紀錄＝這一輪寫什麼就驗什麼；要驗的行為一條都沒放過。 */
  fs.writeFileSync(path.join(runs, SEED, "wb.log"), "");
  /* 種子是「活的」真實 run——負責人隨時可能在 CMS 上對它做商品檢查／套用變價，每做一次就多一個 draft.vN.json。
     那些備份會跟著 cpSync 複製過來，讓 ⑥ 的「第一次備份＝draft.v1.json」變成 v3、v4…（2026-09-21 病例：
     10:53 一筆真實的「一鍵套用全部變價：6 件」留下 v1／v2，當天起全套就紅，而且跟任何程式改動都無關）。
     這裡把帶過來的備份清掉＝測試自己的第一次備份一定是 v1。真實 runs 不動（那是變價操作的回溯點）。 */
  for (const f of fs.readdirSync(path.join(runs, SEED))) {
    if (/^draft\.v\d+\.json$/.test(f)) fs.rmSync(path.join(runs, SEED, f));
  }
  fs.cpSync(path.join(PIPE, "briefs", "built-in"), path.join(briefs, "built-in"), { recursive: true });
  const m = seedMeta(); m.approvedAt = "2026-09-15T00:00:00.000Z"; fs.writeFileSync(path.join(runs, SEED, "wb_meta.json"), JSON.stringify(m, null, 1));
  /* CAMPAIGN_PRICE_TRUTH=off（2026-09-27）：建立期價格對真會逐品實抓商品頁（觸網、約 40 秒）——本檔測的是策略檔流程、要 hermetic；價格對真有自己的測試（server_price_truth_flow.test.js） */
  const env = { ...process.env, CAMPAIGN_MODE: "editor", CAMPAIGN_RUNS_DIR: runs, CAMPAIGN_BRIEFS_DIR: briefs, CAMPAIGN_CAPS: "ai:0,publish:0,vendorSheet:0", CAMPAIGN_PRICE_TRUTH: "off" }; delete env.WB_PASS;
  child = spawn(process.execPath, [path.join(PIPE, "workbench", "server.js"), String(PORT)], { env, stdio: ["ignore", "pipe", "pipe"] });
  child.stdout.on("data", (d) => { out += d; }); child.stderr.on("data", (d) => { out += d; });
  await waitFor(async () => (await fetch(`${BASE}/ping`)).status === 204, 60000, "/ping");
});
test.after(() => { try { child.kill("SIGTERM"); } catch (e) { /* 已結束 */ } });

test("① /api/briefs：內建五份都帶第一行的型態與主題", async () => {
  const { j } = await J("/api/briefs");
  const rows = j.briefs.filter((b) => b.kind === "built-in");
  assert.strictEqual(rows.length, 5);
  for (const b of rows) { assert.ok(b.scenario, `${b.file} 沒讀到型態`); assert.ok(b.scenarioTitle, "要有卡名"); assert.ok(b.theme, `${b.file} 沒讀到主題`); }
  assert.ok(rows.some((b) => b.scenario === "時事主題-情境×選品" && b.theme === "中秋烤肉"));
});

test("② 組「給 Gemini 的話」：帶卡名、主題、真實商品名清單、該型態範本正文", async () => {
  const { status, j } = await J(`/api/runs/${SEED}/gemini-prompt`);
  assert.strictEqual(status, 200); assert.strictEqual(j.ok, true);
  assert.strictEqual(j.scenario, "時事主題-情境×選品"); assert.strictEqual(j.scenarioTitle, "抓一個時事話題選品");
  assert.ok(j.productCount >= 30, `商品名要真的帶到（${j.productCount}）`);
  assert.match(j.text, /這檔是哪一種活動：抓一個時事話題選品/); assert.match(j.text, /共 \d+ 件/); assert.match(j.text, /# 主標/); assert.ok(j.usedBuiltin, "要用該型態的內建範本正文");
  assert.doesNotMatch(j.text, /\$\d|NT\$/, "只帶名稱，不帶價格（71 號裁）");
});

test("③ 貼上就存＋對帳：型態寫成別張卡＝算出 different；檔存進 mine 且同名不覆蓋", async () => {
  const raw = fs.readFileSync(path.join(briefs, "built-in", "05-時事主題-情境選品.md"), "utf8").replace("這檔是哪一種活動：抓一個時事話題選品", "這檔是哪一種活動：只講一個品牌");
  const a = await POST("/api/briefs/mine", { text: raw, name: "測試貼上", runId: SEED });
  assert.strictEqual(a.status, 200, JSON.stringify(a.j).slice(0, 200));
  assert.match(a.j.file, /^mine\/測試貼上-\d{4}-\d{2}-\d{2}\.md$/); assert.ok(fs.existsSync(path.join(briefs, a.j.file)));
  assert.strictEqual(a.j.scenario, "單一品牌-優惠/曝光");
  assert.strictEqual(a.j.recon.scenario.match, "different"); assert.strictEqual(a.j.recon.scenario.runTitle, "抓一個時事話題選品");
  assert.strictEqual(a.j.recon.summary.floorsTotal, 3); assert.ok(a.j.recon.poolSize >= 30);
  const b = await POST("/api/briefs/mine", { text: raw, name: "測試貼上", runId: SEED });
  assert.notStrictEqual(b.j.file, a.j.file, "同名要加序號，不覆蓋");
});

test("③b 貼上夾價格＝400 不存、白話講哪一段", async () => {
  const bad = "這檔是哪一種活動：抓一個時事話題選品｜活動主題：中秋\n\n# 這檔在賣什麼\n烤肉\n\n# 主標\n只要 $399 帶回家\n";
  const before = fs.readdirSync(path.join(briefs, "mine")).length;
  const r = await POST("/api/briefs/mine", { text: bad });
  assert.strictEqual(r.status, 400); assert.match(r.j.error, /沒通過檢查/); assert.match(r.j.error, /主標/);
  assert.strictEqual(fs.readdirSync(path.join(briefs, "mine")).length, before, "沒通過＝不落檔");
});

test("④ 選檔對帳：內建 05 對這檔＝型態 same", async () => {
  const { j } = await J(`/api/briefs/recon?file=${encodeURIComponent("built-in/05-時事主題-情境選品.md")}&run=${SEED}`);
  assert.strictEqual(j.ok, true); assert.strictEqual(j.recon.scenario.match, "same");
});

test("⑤ 建立帶策略檔但沒選型態＝從策略檔第一行補型態（09-15 下午翻案：策略檔是型態真源）", async () => {
  const r = await POST("/api/runs", { url: "https://tw.buy.yahoo.com/search/product?p=x", ownerEmail: "qa@yahootwec.com", ownerDept: "QA", engine: "auto", scenario: "", briefFile: "built-in/05-時事主題-情境選品.md" });
  assert.strictEqual(r.status, 200, JSON.stringify(r.j)); assert.ok(r.j.id);
  const m = JSON.parse(fs.readFileSync(path.join(runs, r.j.id, "wb_meta.json"), "utf8"));
  assert.strictEqual(m.input.scenario, "時事主題-情境×選品", "型態要從策略檔第一行補上");
  /* 2026-09-25 使用者裁「頁面名稱也要跟策略檔主題走」：主題同樣從第一行補——原本只補型態、主題留空，
     機器策展退回品牌名，頁面名稱／頁尾／看更多全變「白蘭…」（重播 2026-09-25-wb-131014 病例）。 */
  assert.strictEqual(m.input.theme, "中秋烤肉", "主題也要從策略檔第一行補上");
});

test("⑤b 人有填主題＝人的優先，策略檔不覆蓋", async () => {
  const r = await POST("/api/runs", { url: "https://tw.buy.yahoo.com/search/product?p=x", ownerEmail: "qa@yahootwec.com", ownerDept: "QA", engine: "auto", scenario: "", theme: "自己取的主題", briefFile: "built-in/05-時事主題-情境選品.md" });
  assert.strictEqual(r.status, 200, JSON.stringify(r.j));
  const m = JSON.parse(fs.readFileSync(path.join(runs, r.j.id, "wb_meta.json"), "utf8"));
  assert.strictEqual(m.input.theme, "自己取的主題");
});

test("⑥ 照策略檔重做：先備份、同批商品重排、核可失效、meta.brief 落檔、跑完 ready", async () => {
  const themeBefore = String((seedMeta().input || {}).theme || "").trim(); // 舊檔建立時可能沒補到主題
  const r = await POST(`/api/runs/${SEED}/redo-draft`, { briefFile: "built-in/05-時事主題-情境選品.md" });
  assert.strictEqual(r.status, 200, JSON.stringify(r.j).slice(0, 200)); assert.strictEqual(r.j.backup, "draft.v1.json");
  assert.ok(fs.existsSync(path.join(runs, SEED, "draft.v1.json")), "重做前要備份");
  const m = await waitFor(() => { const mm = seedMeta(); return mm.stage === "ready" || mm.stage === "error" ? mm : null; }, 120000, "重做跑完");
  assert.strictEqual(m.stage, "ready", `重做失敗：${m.error}\n${fs.readFileSync(path.join(runs, SEED, "wb.log"), "utf8").slice(-800)}`);
  assert.strictEqual(m.approvedAt, null, "重做＝核可失效（跟手改一樣）"); assert.ok(m.redo && m.redo.doneAt);
  assert.strictEqual(m.input.briefFile, "built-in/05-時事主題-情境選品.md");
  const d = JSON.parse(fs.readFileSync(path.join(runs, SEED, "draft.json"), "utf8"));
  assert.ok(d.meta && d.meta.brief && d.meta.brief.file === "built-in/05-時事主題-情境選品.md", "新草稿要記策略檔來源");
  assert.ok(d.page && d.page.kvVariant, "版式要保住（建立時的收尾同一支）");
  assert.match(fs.readFileSync(path.join(runs, SEED, "wb.log"), "utf8"), /照策略檔重做完成/);
  /* 2026-09-25：重做也要補主題——沒填的補成策略檔的「中秋烤肉」且頁面名稱跟著走；人有填的不動。 */
  if (!themeBefore) {
    assert.strictEqual(m.input.theme, "中秋烤肉", "重做時主題要從策略檔補上");
    assert.ok(String(d.page.pageName || "").startsWith("中秋烤肉_"), "頁面名稱要跟策略檔主題走，實得：" + d.page.pageName);
    assert.strictEqual(d.page.curationTheme, "中秋烤肉");
  } else {
    assert.strictEqual(m.input.theme, themeBefore, "人填的主題不得被策略檔覆蓋");
  }
});

/* 2026-10-14 使用者裁：公司信箱改 userid@yahootwec.com、舊網域直接擋——從最外層建立入口打到底（鐵律 4：同一條規則前後端各一份，最怕只改一邊）。
   舊網域會走到後端的，幾乎只有升級前就開著的分頁：它只會 toast 這一句＝句子本身要帶出路。 */
test("⑦ 建立活動：舊網域 @yahooinc.com 擋下並指路「重新整理」、外部信箱擋下指路 Outlook、新網域放行；擋下的不落檔", async () => {
  const before = fs.readdirSync(runs).length;
  const old = await POST("/api/runs", { url: "https://tw.buy.yahoo.com/search/product?p=x", ownerEmail: "qa@yahooinc.com", ownerDept: "QA", engine: "auto" }); // secret-scan: allow 測試用假信箱，驗舊網域被擋
  assert.strictEqual(old.status, 400); assert.match(old.j.error, /頁面是舊版 → 重新整理頁面/); assert.match(old.j.error, /@yahootwec\.com/);
  const ext = await POST("/api/runs", { url: "https://tw.buy.yahoo.com/search/product?p=x", ownerEmail: "qa@gmail.com", ownerDept: "QA", engine: "auto" });
  assert.strictEqual(ext.status, 400); assert.match(ext.j.error, /需要公司帳號 → 填 Outlook 寄件人/);
  assert.strictEqual(fs.readdirSync(runs).length, before, "擋下的不建活動");
  const ok = await POST("/api/runs", { url: "https://tw.buy.yahoo.com/search/product?p=x", ownerEmail: "qa@yahootwec.com", ownerDept: "QA", engine: "auto" });
  assert.strictEqual(ok.status, 200, JSON.stringify(ok.j));
});
