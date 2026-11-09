"use strict";
/**
 * D5 端到端黃金對照（golden master）：回放抓取 → 規則版策展 → 機器閘，三段輸出都要與夾具逐字相同。
 *
 * 這是 D6（換 uther）、D8（抽策展）、D10（搬 gate）的總對照：改完程式跑這支，紅＝行為變了，
 * 要嘛是 bug，要嘛是刻意的改動——刻意的就重產黃金檔並在 commit 說明差異（規則 2：換前提的 commit 附差異報告）。
 *
 * 夾具：test/fixtures/runs/2026-10-27-wb-085823/
 *   snapshot.replay.json   回放抓取輸出（D4）
 *   draft.golden.json      curate_auto --scenario 同品類×跨品牌-優惠銷售 --heroCount 4 的輸出
 *   gate_report.golden.json gate.js（GATE_SKIP_HTTP=1）的輸出：PASS，FAIL 0／WARN 1／INFO 8
 * 固定：CS_NOW＝原 run 的 fetchedAt；CS_HTTP_MODE=replay；run 資料夾名固定（draft.page.id 由資料夾名來）。
 *
 * 重產黃金檔：npm run golden:regen
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const PIPE = path.resolve(__dirname, "..");
const SEED = "2026-10-27-wb-085823";
const FIX = path.join(PIPE, "test", "fixtures", "runs", SEED);
const SOURCE_URL = "https://tw.buy.yahoo.com/?sub=1035";
const SCENARIO = "同品類×跨品牌-優惠銷售";
const read = (p) => JSON.parse(fs.readFileSync(p, "utf8"));
const golden = { snapshot: read(path.join(FIX, "snapshot.replay.json")), draft: read(path.join(FIX, "draft.golden.json")), gate: read(path.join(FIX, "gate_report.golden.json")) };
const ENV = { ...process.env, CS_NOW: golden.snapshot.fetchedAt, CS_HTTP_MODE: "replay", CS_HTTP_CASSETTE_DIR: path.join(PIPE, "test", "fixtures", "http"), GATE_SKIP_HTTP: "1", TZ: "UTC" };

function run(script, args) {
  const r = spawnSync(process.execPath, [path.join(PIPE, script), ...args], { env: ENV, encoding: "utf8" });
  assert.strictEqual(r.status, 0, `${script} 失敗（exit ${r.status}）：\n${r.stdout}\n${r.stderr}`);
  return r;
}

test("回放抓取 → 策展 → 機器閘：三段輸出與黃金檔逐字相同", () => {
  const runDir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "cs-e2e-")), SEED); // 資料夾名＝run id，要和黃金檔一致
  fs.mkdirSync(runDir);
  run("fetch_parse.js", [SOURCE_URL, runDir]);
  assert.deepStrictEqual(read(path.join(runDir, "snapshot.json")), golden.snapshot, "① snapshot 變了");
  run("workbench/curate_auto.js", [runDir, "--scenario", SCENARIO, "--heroCount", "4"]);
  assert.deepStrictEqual(read(path.join(runDir, "draft.json")), golden.draft, "② draft 變了");
  run("gate.js", [path.join(runDir, "snapshot.json"), path.join(runDir, "draft.json")]);
  assert.deepStrictEqual(read(path.join(runDir, "gate_report.json")), golden.gate, "③ gate_report 變了");
});

test("黃金 draft 本身通過 schema（D3）且 gate 結果是 PASS", () => {
  assert.strictEqual(golden.gate.result, "PASS");
  assert.strictEqual(golden.gate.counts.FAIL, 0);
  const r = spawnSync(process.execPath, [path.join(PIPE, "tools", "schema", "validate.js"), path.join(PIPE, "schemas"), path.join(FIX, "draft.golden.json"), path.join(FIX, "snapshot.replay.json"), path.join(FIX, "gate_report.golden.json")], { encoding: "utf8" });
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
});
