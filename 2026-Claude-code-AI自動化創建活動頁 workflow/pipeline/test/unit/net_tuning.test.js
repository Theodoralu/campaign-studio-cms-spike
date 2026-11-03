/* 對外連線預算（2026-10-01，使用者測第五版單機版時阻斷）
   病例：家用網路握手 291ms > Node 預設的每位址 250ms ⇒ 對外一件都抓不到，
        而介面叫使用者「確認網址能在瀏覽器打開」——他的瀏覽器明明打得開，於是換什麼網址都被擋。
   守三件：①設定真的生效且高於 Node 預設（低於等於 250 等於沒調）
          ②環境變數可覆寫、壞字面退回預設且出聲（不靜默降級）
          ③**絆線**：會對外抓的檔必須 require 這支——同一條規則住五個門，
            改了門口那道、屋裡還有四道舊的（鐵律 4 第二問；卡＝20260831-one-rule-many-doors） */
"use strict";
const test = require("node:test");
const assert = require("node:assert");
const net = require("node:net");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const PIPE = path.resolve(__dirname, "../..");
const MOD = path.join(PIPE, "lib/net_tuning.js");

/* 子行程裡量——本行程可能已被其他測試載過、值會互相污染 */
function inChild(code, env = {}) {
  return execFileSync(process.execPath, ["-e", code], {
    cwd: PIPE, encoding: "utf8", env: { ...process.env, ...env },
  }).trim();
}

test("載入後，每位址預算高於 Node 預設 250ms（低於等於 250 等於沒調到）", () => {
  const out = inChild(`
    const net = require("node:net");
    const before = net.getDefaultAutoSelectFamilyAttemptTimeout();
    const m = require("${MOD}");
    console.log(JSON.stringify({ before, after: net.getDefaultAutoSelectFamilyAttemptTimeout(), applied: m.applied, ms: m.ATTEMPT_TIMEOUT_MS }));
  `);
  const r = JSON.parse(out);
  assert.strictEqual(r.applied, true, "這顆 Node 應該有 setDefaultAutoSelectFamilyAttemptTimeout");
  assert.strictEqual(r.before, 250, "Node 預設值變了＝這條守門的前提要重新評估");
  assert.strictEqual(r.after, r.ms);
  assert.ok(r.after > 250, `實際生效值 ${r.after} 必須大於 250，否則等於沒調`);
  assert.ok(r.after >= 291, `實測握手需求 291ms（2026-10-01 病例），生效值 ${r.after} 不得低於它`);
});

test("環境變數可覆寫（特殊網路／故障注入用）", () => {
  const out = inChild(`
    const net = require("node:net");
    require("${MOD}");
    console.log(net.getDefaultAutoSelectFamilyAttemptTimeout());
  `, { CAMPAIGN_CONNECT_ATTEMPT_MS: "5000" });
  assert.strictEqual(Number(out), 5000);
});

test("環境變數是壞字面＝退回預設並出聲，不靜默降級（鐵律 3）", () => {
  const r = execFileSync(process.execPath, ["-e", `
    const net = require("node:net");
    const m = require("${MOD}");
    console.log(net.getDefaultAutoSelectFamilyAttemptTimeout() + "|" + m.DEFAULT_MS);
  `], { cwd: PIPE, encoding: "utf8", env: { ...process.env, CAMPAIGN_CONNECT_ATTEMPT_MS: "大一點" }, stdio: ["pipe", "pipe", "pipe"] });
  const [got, def] = r.trim().split("|");
  assert.strictEqual(got, def, "壞字面要退回預設值");
});

/* ─────── 絆線：哪些檔會對外抓、它們有沒有接上 ─────── */

/** 已知會對外抓的門（2026-10-01 全庫掃描結果）。新開一個門＝這裡加一行＋那支檔 require net_tuning。 */
const KNOWN_DOORS = [
  "fetch_parse.js",
  "gate.js",
  "make_cutouts.js",
  "workbench/img_probe.js",
  "workbench/server.js",
];

const SKIP_DIRS = new Set(["node_modules", "test", "docs", "tools", "runs", ".git", ".githooks", "export"]);
const OUTBOUND = /https\.get\b|(?<![\w.])fetch\s*\(/; /* 2026-10-05 放寬：fetchPage 改成可注入（const get = opts.get || https.get）後「直接呼叫」那種認法會漏掉它——改成看到 https.get 這個名字就算門（多抓到＝紅燈叫你登記，是安全的那個方向） */
const LOOPBACK = /127\.0\.0\.1|localhost/;

function scanDoors() {
  const found = [];
  (function walk(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name.startsWith(".")) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) walk(full); continue; }
      if (!e.name.endsWith(".js")) continue;
      const src = fs.readFileSync(full, "utf8");
      const rel = path.relative(PIPE, full);
      if (rel === "lib/net_tuning.js") continue;
      const outbound = src.split("\n").some((ln) => OUTBOUND.test(ln) && !LOOPBACK.test(ln));
      if (outbound) found.push(rel);
    }
  })(PIPE);
  return found.sort();
}

test("絆線：會對外抓的檔，就是已知那幾個門——多一個沒登記就紅燈", () => {
  const found = scanDoors();
  assert.deepStrictEqual(found, [...KNOWN_DOORS].sort(),
    `對外抓取的檔變了。多出來的要：①在那支檔 require lib/net_tuning ②把它加進本測試的 KNOWN_DOORS。\n實際掃到：\n  ${found.join("\n  ")}`);
});

test("絆線：每一個門都 require 了 lib/net_tuning（漏一個＝那條路照樣會卡）", () => {
  const missing = KNOWN_DOORS.filter((rel) => !/require\(["'][^"']*lib\/net_tuning["']\)/.test(fs.readFileSync(path.join(PIPE, rel), "utf8")));
  assert.deepStrictEqual(missing, [], `這幾個門沒接上對外連線預算：${missing.join("、")}`);
});

test("絆線負例自驗：拿掉 require 的檔確實會被抓出來（一道從來沒紅過的閘跟沒有閘一樣）", () => {
  const src = fs.readFileSync(path.join(PIPE, "fetch_parse.js"), "utf8");
  const stripped = src.replace(/^.*require\(["'][^"']*lib\/net_tuning["']\).*$\n?/m, "");
  assert.notStrictEqual(stripped, src, "測試素材本身要先確認改得掉");
  assert.ok(!/require\(["'][^"']*lib\/net_tuning["']\)/.test(stripped), "拿掉之後偵測式就該找不到它");
});

test("本行程載入也生效（server.js 實際走的路徑）", () => {
  require(MOD);
  assert.ok(net.getDefaultAutoSelectFamilyAttemptTimeout() > 250);
});
