"use strict";
/**
 * create_speedup_abc.test.js —— 建置提速 A＋B＋C 絆線（2026-10-05 使用者裁「依建議開工」）
 *
 * A＝同一頁不抓兩次：清單逐品實抓落種子（price_truth_seed.json），建立期價格對真新鮮度窗內直用；
 *    「重新檢查」那條路永遠現抓（檢查那一刻就該抓那一刻的價）。
 * B＝五路並行取代逐件排隊：全池開工間隔 250ms＝整體 ≤4 件/秒（禮貌線）；CAMPAIGN_FETCH_POOL=off 回退。
 * C＝誠實進度：估時照實測（0.27/1.05 秒/件）、建置畫面畫出「對價格中 n/N」。
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..", "..");
const { mapPool } = require(path.join(ROOT, "lib", "fetch_pool.js"));
const server = fs.readFileSync(path.join(ROOT, "workbench/server.js"), "utf8");
const fetchParse = fs.readFileSync(path.join(ROOT, "fetch_parse.js"), "utf8");
const ui = fs.readFileSync(path.join(ROOT, "workbench/public/index.html"), "utf8");

test("B｜mapPool：結果照原序、全池節流有效、serial 回退單工、onProgress 每件一叫", async () => {
  const t0 = Date.now();
  const out = await mapPool([30, 10, 20], async (ms) => { await new Promise((r) => setTimeout(r, ms)); return ms * 2; }, { concurrency: 3, minGapMs: 40 });
  assert.deepStrictEqual(out, [60, 20, 40], "完成序會亂、結果序不可以亂（策展決定論）");
  assert.ok(Date.now() - t0 >= 80, "三件開工至少隔兩個 40ms＝全池節流在管");
  let calls = 0;
  await mapPool([1, 2], async () => {}, { minGapMs: 1, onProgress: () => { calls++; } });
  assert.strictEqual(calls, 2);
  const skip = []; const t2 = Date.now();
  await mapPool([1, 2, 3, 4], async (x) => { skip.push(x); }, { minGapMs: 200, needsGate: (x) => x === 4 });
  assert.ok(Date.now() - t2 < 180, "needsGate=false 的件不排開工間隔（種子件零網路＝免等）");
  const t1 = Date.now();
  await mapPool([1, 2, 3], async () => {}, { serial: true, minGapMs: 60 });
  assert.ok(Date.now() - t1 >= 120, "serial＝單工照舊排隊（回退開關的行為）");
});

test("A｜種子鏈：enrich 落檔（同一支探測器的產物）→ 建立期讀檔（10 分鐘新鮮度窗）→ 只有建立那條路傳 seed", () => {
  assert.match(fetchParse, /price_truth_seed\.json/, "enrich 要落種子檔");
  assert.match(fetchParse, /seedRows\[String\(h\.gdid\)\]/, "種子逐件記（含非 online＝誠實保留狀態）");
  assert.match(fetchParse, /probeProductLiveness\(\{ gdid: h\.gdid/, "種子來源＝同一支探測器（不另立第二套萃取）");
  assert.match(server, /SEED_FRESH_MS = 10 \* 60 \* 1000/, "新鮮度窗 10 分鐘、一處宣告");
  assert.match(server, /age >= 0 && age <= SEED_FRESH_MS/, "過窗＝整份不用（時鐘倒退也不用）");
  const seedPassers = server.match(/productCheck\(id, runDir, \{ seed:/g) || [];
  assert.strictEqual(seedPassers.length, 1, "全檔只有建立期那一處傳 seed——「重新檢查」永遠現抓");
  assert.match(server, /const sdPC = seedRowsPC && seedRowsPC\[String\(p\.gdid\)\]/, "productCheck 內種子只換掉網路那一步，drift/快照比對照舊");
});

test("B｜兩段迴圈都接上池、沒有殘留的逐件睡眠", () => {
  assert.match(server, /const rowsPC = await mapPool\(prodsPC/, "商品掃描走池");
  assert.match(server, /const rowsLN = await mapPool\(allLinks/, "連結檢查走池");
  assert.doesNotMatch(server, /results\.push\(row\);\n\s*appendLog\(id, `商品狀態 \[/, "舊的串行 push＋log 形不可殘留");
  const sleeps300 = (server.match(/await new Promise\(\(r\) => setTimeout\(r, 300\)\)/g) || []).length;
  assert.strictEqual(sleeps300, 0, "掃描兩迴圈的逐件 300ms 睡眠全拆（節流改由全池間隔管）");
  assert.match(fetchParse, /await mapPool\(take/, "清單實抓走池");
  assert.doesNotMatch(fetchParse, /await sleep\(250\); \/\/ 節流/, "enrich 的逐件睡眠已由全池節流取代");
});

test("C｜估時照實測、進度畫得出來", () => {
  assert.doesNotMatch(server, /\* 0\.65\)/, "舊公式 ×0.65（少報四成）要走");
  assert.match(server, /\? 1\.05 : 0\.27/, "串行 1.05／並行 0.27 秒每件（run 135630 實測校正）");
  assert.match(server, /Math\.min\(listing, 60\) \* 0\.3/, "來源檢查預告同批校正");
  assert.match(server, /done: dN, total: tN/, "對價進度回寫 meta（status 端點原樣帶給前端）");
  assert.match(ui, /正在對商品頁價格（\$\{st\.priceTruth\.done \|\| 0\}/, "建置畫面畫出 n/N");
});
