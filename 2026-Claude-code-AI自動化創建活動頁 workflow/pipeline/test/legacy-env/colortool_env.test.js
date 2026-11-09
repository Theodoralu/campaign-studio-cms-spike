"use strict";
/**
 * 色彩工具環境格（2026-09-21 A「工具不猜環境」）絆線
 *
 * 守什麼：
 *   ①源頭工具頁一定有 /*CS_ENV*\/ 格、而且留空（環境中立——源頭不可以偷偷寫死某個站）
 *   ②injectEnv 填得進去、讀得回來、填兩次結果一樣（冪等）、找不到格＝出聲 throw
 *   ③CLI 真的會就地改寫檔案（部署腳本走的就是這條）
 *   ④工具頁裡不得再出現寫死的 localhost:8787 API 呼叫（只准留在提示文字與退路預設值）
 * 病例 2026-09-21：engineUrl 猜路徑＋兩處寫死 localhost，搬到台灣後線上預覽黑掉、字級檔位全落「標準」。
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { injectEnv, readEnv, defaultEnv, MARK_START, MARK_END } = require("../../lib/colortool_env.js");

const TOOL = path.join(__dirname, "..", "..", "..", "..", "2026-AI自動化活動頁生成規劃", "活動頁色彩策略工具.html");
const LIB = path.join(__dirname, "..", "..", "lib", "colortool_env.js");

test("① 源頭工具頁有環境格且留空（環境中立）", () => {
  const html = fs.readFileSync(TOOL, "utf8");
  assert.ok(html.includes(MARK_START) && html.includes(MARK_END), "源頭缺 /*CS_ENV*/ 標記——發佈鏈靠它填引擎位址");
  assert.deepStrictEqual(readEnv(html), defaultEnv(), "源頭的環境格必須全 null，不可寫死某個站");
});

test("② injectEnv：填得進、讀得回、冪等、找不到格出聲", () => {
  const html = fs.readFileSync(TOOL, "utf8");
  const env = { site: "workbench", engineBase: "/frametest/", apiBase: "", engineSameOrigin: true };
  const once = injectEnv(html, env);
  assert.deepStrictEqual(readEnv(once), env);
  assert.strictEqual(injectEnv(once, env), once, "填兩次要一樣（不能越填越長）");
  const design = injectEnv(html, { site: "design", engineBase: "https://x.pages.github.io/lecreuset-frametest/", engineSameOrigin: false });
  assert.deepStrictEqual(readEnv(design), { site: "design", engineBase: "https://x.pages.github.io/lecreuset-frametest/", apiBase: null, engineSameOrigin: false }, "沒給的欄位＝null（不是 undefined、不是漏掉）");
  assert.throws(() => injectEnv("<html>no marker</html>", env), /找不到環境格/, "沒有格＝要 throw，不可以靜默送出會亂猜的工具");
});

test("③ CLI 就地改寫（部署腳本走的那條路）", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cs-env-"));
  const f = path.join(dir, "tool.html");
  fs.writeFileSync(f, fs.readFileSync(TOOL, "utf8"));
  const r = spawnSync(process.execPath, [LIB, "--file", f, "--site", "design", "--engine", "https://x/lecreuset-frametest/", "--same-origin", "no"], { encoding: "utf8" });
  assert.strictEqual(r.status, 0, r.stderr);
  assert.deepStrictEqual(readEnv(fs.readFileSync(f, "utf8")), { site: "design", engineBase: "https://x/lecreuset-frametest/", apiBase: null, engineSameOrigin: false });
  const bad = spawnSync(process.execPath, [LIB, "--site", "design"], { encoding: "utf8" });
  assert.notStrictEqual(bad.status, 0, "沒給 --file 要非零出聲");
});

test("④ 工具頁不得再寫死 localhost:8787 的 API 呼叫", () => {
  const html = fs.readFileSync(TOOL, "utf8");
  const hits = html.split("\n").map((l, i) => [i + 1, l]).filter(([, l]) => /fetch\(\s*['"]http:\/\/localhost:8787/.test(l));
  assert.deepStrictEqual(hits.map(([n]) => n), [], "還有直接對 localhost 打的 fetch：第 " + hits.map(([n]) => n).join("、") + " 行——改讀 apiUrl()");
});
