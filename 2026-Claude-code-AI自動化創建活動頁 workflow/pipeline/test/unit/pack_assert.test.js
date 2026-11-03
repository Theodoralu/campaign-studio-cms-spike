"use strict";
/* pack_assert 負向測試（69 號 Phase 3 開工前置第 1 條：「故意放一個假 token 檔跑一次，確認它真的會擋」）
   兩層：①純函式 assertEntries 吃清單（快、不碰磁碟）②真 zip 端到端（zip CLI 建包 → 跑 CLI → 看結束碼與訊息）。
   該紅會紅、該綠會綠，兩邊都要有——只測紅不測綠＝斷言太寬也看不出來。 */
const { test } = require("node:test");
const assert = require("node:assert");
const { execFileSync, spawnSync } = require("child_process");
const fs = require("fs"), os = require("os"), path = require("path");
const PIPE = path.resolve(__dirname, "..", "..");
const TOOL = path.join(PIPE, "tools", "pack_assert.js");
const { assertEntries, FORBIDDEN } = require(TOOL);

const P = "CampaignStudio/2026-Claude-code-AI自動化創建活動頁 workflow/pipeline/";
const CLEAN = [
  `${P}workbench/VERSION`, `${P}workbench/server.js`, `${P}workbench/start-editor.sh`,
  "CampaignStudio/先看我.txt", "CampaignStudio/這一版有什麼新的.txt", // 包根兩份 txt（先看我＝P-7；這一版有什麼新的＝Q3(b) 2026-09-21）
  "CampaignStudio/install.sh", "CampaignStudio/安裝.command", "CampaignStudio/啟動 Campaign Studio.command", // 包根 P-7 三件
  `${P}briefs/built-in/01-同品類跨品牌-優惠銷售.md`, `${P}briefs/mine/.gitkeep`,
  `${P}tools/build_cms_hints.js`, `${P}node_modules/sharp/package.json`,
  "CampaignStudio/design-tokens/palette-engine.js",
  "CampaignStudio/2026-AI自動化活動頁生成規劃/deploy-site/lecreuset-frametest/index.html",
];
const kinds = (r) => r.problems.map((p) => p.kind + ":" + p.entry.split("/").slice(-2).join("/"));

test("乾淨清單＝零問題（綠要真的綠）", () => {
  const r = assertEntries(CLEAN);
  assert.deepStrictEqual(r.problems, []);
  assert.ok(r.versionEntry && /VERSION$/.test(r.versionEntry));
});

test("假 Google token 與 config＝紅、訊息點名檔案與白話理由", () => {
  const r = assertEntries([...CLEAN, `${P}.google-token.json`, `${P}.google-config.json`]);
  assert.strictEqual(r.problems.length, 2);
  assert.ok(r.problems.every((p) => p.kind === "forbidden" && /Google 憑證/.test(p.why)));
});

test("負責人策略檔 briefs/mine/*.md＝紅；built-in 與 .gitkeep 不算", () => {
  const r = assertEntries([...CLEAN, `${P}briefs/mine/靈魂之窗保養之道-2026-09-15.md`]);
  assert.deepStrictEqual(kinds(r), ["forbidden:mine/靈魂之窗保養之道-2026-09-15.md"]);
});

test("其餘禁止樣式各命中一次：.wb-pass／.wb.log／fatal.log／.git／plist／runs／.trash／退場腳本／負責人腳本", () => {
  const bad = [`${P}workbench/.wb-pass`, `${P}workbench/.wb.log`, `${P}workbench/fatal.log`, `${P}.git/HEAD`,
    "CampaignStudio/com.campaign.wb.plist", `${P}runs/2026-09-14-wb-143442/draft.json`, `${P}briefs/.trash/x.md`,
    `${P}price_watch.sh`, `${P}tools/overview-mail.gs`, `${P}workbench/deploy-ghe-pages.sh`, `${P}workbench/wb-autostart.command`];
  const r = assertEntries([...CLEAN, ...bad]);
  assert.strictEqual(r.problems.filter((p) => p.kind === "forbidden").length, bad.length, kinds(r).join("\n"));
});

test("包根五件缺了＝紅（兩份 txt／install.sh／兩顆 .command），一件一句白話", () => {
  const r = assertEntries(CLEAN.filter((e) => !/^CampaignStudio\/[^\/]+$/.test(e)));
  assert.deepStrictEqual(kinds(r).sort(), ["missing:*.command", "missing:install.sh", "missing:*.txt"].sort());
  const oneCommand = assertEntries(CLEAN.filter((e) => e !== "CampaignStudio/安裝.command"));
  assert.deepStrictEqual(kinds(oneCommand), ["missing:*.command"], "只剩一顆 .command 也要紅（安裝與啟動都要在）");
});

/* 這條專抓「名單只改了一道門」：打包機產了第五件，但斷言還停在「有一個 txt 就算過」。
   2026-09-01 病例（hook 清單 9 條 vs sync.sh 18 條）就是同一個病型——所以從最外層的清單打進來驗。 */
test("只有先看我、缺「這一版有什麼新的」＝紅（一份 txt 不算過關）", () => {
  const onlyReadme = assertEntries(CLEAN.filter((e) => e !== "CampaignStudio/這一版有什麼新的.txt"));
  assert.deepStrictEqual(kinds(onlyReadme), ["missing:*.txt"], "包根只剩一份 txt 也要紅（同事會不知道這版值不值得換）");
  const onlyWhatsnew = assertEntries(CLEAN.filter((e) => e !== "CampaignStudio/先看我.txt"));
  assert.deepStrictEqual(kinds(onlyWhatsnew), ["missing:*.txt"], "反過來缺先看我也要紅");
});

test("缺 VERSION＝紅", () => {
  const r = assertEntries(CLEAN.filter((e) => !/VERSION$/.test(e)));
  assert.deepStrictEqual(kinds(r), ["missing:workbench/VERSION"]);
});

test("--expect-hash：記號尾段等於 hash＝綠；不等＝紅並印出兩邊", () => {
  assert.deepStrictEqual(assertEntries(CLEAN, { expectHash: "abc1234", versionText: "2026-09-16-abc1234\n" }).problems, []);
  const r = assertEntries(CLEAN, { expectHash: "abc1234", versionText: "2026-09-15-deadbee" });
  assert.strictEqual(r.problems.length, 1);
  assert.ok(/deadbee/.test(r.problems[0].why) && /abc1234/.test(r.problems[0].why));
});

test("FORBIDDEN 每條都有白話理由（不准只丟正則）", () => {
  for (const [re, why] of FORBIDDEN) { assert.ok(re instanceof RegExp); assert.ok(typeof why === "string" && why.length >= 4, String(re)); }
});

/* ── 端到端：真 zip ── */
function mkzip(files) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "pack-assert-"));
  for (const [rel, content] of Object.entries(files)) { const f = path.join(d, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, content); }
  const z = path.join(d, "pkg.zip"); execFileSync("zip", ["-qr", z, "CampaignStudio"], { cwd: d }); return z;
}
const runCli = (z, args = []) => spawnSync(process.execPath, [TOOL, z, ...args], { encoding: "utf8" });
const CLEAN_FILES = Object.fromEntries(CLEAN.map((e) => [e, /VERSION$/.test(e) ? "2026-09-16-abc1234\n" : "x"]));

test("端到端：乾淨 zip＋正確 hash＝exit 0", () => {
  const r = runCli(mkzip(CLEAN_FILES), ["--expect-hash", "abc1234"]);
  assert.strictEqual(r.status, 0, r.stderr); assert.ok(/可出貨/.test(r.stdout));
});

test("端到端：故意放假 .google-token.json＝exit 1、stderr 點名它（69 號開工前置第 1 條的負向演練）", () => {
  const r = runCli(mkzip({ ...CLEAN_FILES, [`${P}.google-token.json`]: '{"refresh_token":"FAKE"}' }));
  assert.strictEqual(r.status, 1);
  assert.ok(/\.google-token\.json/.test(r.stderr) && /不能出貨/.test(r.stderr), r.stderr);
});

test("端到端：hash 不符＝exit 1", () => {
  const r = runCli(mkzip(CLEAN_FILES), ["--expect-hash", "0000000"]);
  assert.strictEqual(r.status, 1); assert.ok(/不等於打包當下/.test(r.stderr), r.stderr);
});

test("端到端：找不到 zip＝exit 2（用法錯不假裝紅燈也不假裝綠燈）", () => {
  assert.strictEqual(runCli("/nonexistent/x.zip").status, 2);
});
