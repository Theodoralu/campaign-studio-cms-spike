"use strict";
/* install_sh_netcheck.test.js —— 第④件驗收（故障注入）：安裝腳本連不到 Yahoo 時要「⚠ 提醒、不擋」；連得到時要 ✓。
   HOME 指到暫存夾（腳本會建 ~/CampaignStudio）；CS_INSTALL_NO_LAUNCH=1 走到第 6 步就停、不啟動工具。

   2026-10-01 改版：探測工具從 curl 換成 Node。
   病例＝使用者家用網路 curl 通（HTTP 200／2.2s）、Node 不通（TCP 握手 291ms > Node 每位址預算 250ms）
   ⇒ curl 版在那條網路上會印「✓ 連得到 Yahoo 購物」，而產品一件商品都抓不到。
   **量的工具要跟真正要連的工具是同一個**，所以本檔多守一條「不准改回 curl」的絆線。
   卡＝20261001-browser-opens-it-tool-cannot。 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const { spawn } = require("node:child_process");

const SH = path.resolve(__dirname, "..", "..", "tools", "pack-root", "install.sh");
/* 非同步跑：第二案的假 Yahoo 伺服器住在同一個 node 行程裡，spawnSync 會把事件迴圈卡住＝伺服器永遠回不了探測 */
function run(probeUrl) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "cs-install-home-"));
  return new Promise((resolve) => {
    const ch = spawn("zsh", [SH], { env: { ...process.env, HOME: home, CS_YAHOO_PROBE_URL: probeUrl, CS_INSTALL_NO_LAUNCH: "1" } });
    let out = ""; ch.stdout.on("data", (d) => { out += d; }); ch.stderr.on("data", (d) => { out += d; });
    ch.on("close", (code) => resolve({ code, out, home }));
  });
}

test("連不到（指到沒人聽的埠）→ 印 ⚠、講「先用瀏覽器試」、安裝照樣走完（exit 0）", async () => {
  const { code, out, home } = await run("http://127.0.0.1:9/");
  assert.strictEqual(code, 0, out);
  assert.match(out, /5\. 檢查連得到 Yahoo 購物/);
  assert.match(out, /⚠ 現在連不到 Yahoo 購物/);
  assert.match(out, /瀏覽器打開 tw\.buy\.yahoo\.com/);
  /* 技術訊息要真的有東西——空括號等於沒給線索（病例：畫面印「（技術訊息：）」後面空白） */
  const m = out.match(/（技術訊息：([^）]*)）/);
  assert.ok(m, `應該印出技術訊息\n${out}`);
  assert.ok(m[1].trim().length > 0, `技術訊息不得為空，實際：「${m[1]}」`);
  assert.match(m[1], /ECONNREFUSED|ETIMEDOUT|ENOTFOUND|timeout/, `技術訊息要是可查的錯誤碼，實際：「${m[1]}」`);
  assert.match(out, /6\. 設定可以執行/); // 沒被擋，繼續往下
  assert.ok(fs.existsSync(path.join(home, "CampaignStudio", "briefs", "mine")));
});

test("連得到（本機假 Yahoo 回 200）→ ✓ 連得到，並講明是用工具自己的方式測的", async () => {
  const srv = http.createServer((req, res) => { res.writeHead(200); res.end("ok"); });
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  try {
    const { code, out } = await run(`http://127.0.0.1:${srv.address().port}/`);
    assert.strictEqual(code, 0, out);
    assert.match(out, /✓ 連得到 Yahoo 購物/);
    assert.match(out, /用工具自己的方式測的/, "要講明用哪把尺量的——不然下次沒人知道綠燈代表什麼");
    assert.doesNotMatch(out, /⚠/);
  } finally { srv.close(); }
});

test("對方回非 2xx／3xx → 不印綠燈（連得到不等於可用）", async () => {
  const srv = http.createServer((req, res) => { res.writeHead(503); res.end("nope"); });
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  try {
    const { out } = await run(`http://127.0.0.1:${srv.address().port}/`);
    assert.doesNotMatch(out, /✓ 連得到 Yahoo 購物/);
    assert.match(out, /⚠/);
    assert.match(out, /503/);
  } finally { srv.close(); }
});

/* ─────── 絆線：不准改回 curl、不准把「沒測到」印成綠燈 ─────── */

const SRC = fs.readFileSync(SH, "utf8");
const STEP5 = SRC.slice(SRC.indexOf('step "5. 檢查連得到'), SRC.indexOf('step "6. 設定可以執行"'));

test("絆線：第 5 步不得用 curl 探測（curl 通、Node 不通是真實病例）", () => {
  assert.ok(STEP5.length > 0, "找不到第 5 步——腳本結構變了，這條絆線要跟著改");
  const curlLines = STEP5.split("\n").filter((ln) => /(^|[^\w-])curl\b/.test(ln) && !/^\s*#/.test(ln));
  assert.deepStrictEqual(curlLines, [],
    `第 5 步不得用 curl 量連線能力——真正在抓的是 Node，兩把尺不同會印假綠燈。實際：\n${curlLines.join("\n")}`);
  assert.match(STEP5, /\$NODE|\$\{NODE/, "要用包裡那顆 Node 探測");
});

test("絆線：探測要載入產品自己的連線設定（同一把尺）", () => {
  assert.match(STEP5, /net_tuning\.js/,
    "探測要先載入 lib/net_tuning.js，才跟伺服器用同一個連線預算（這支檔在 main，本分支併上去之後才存在）");
});

test("絆線：探不到時要說「沒量到」，不得印成綠燈（承開工三查 ④-2 的教訓）", () => {
  assert.match(STEP5, /沒測到/, "找不到 Node 或探測無回應＝要明說沒量到");
  const fallback = STEP5.slice(STEP5.lastIndexOf("*)"));
  assert.doesNotMatch(fallback, /\bok\s/, "兜底分支不得走 ok（綠燈）");
});

test("絆線負例自驗：把 curl 塞回第 5 步，偵測式確實抓得到", () => {
  const poisoned = STEP5.replace('PROBE_OUT=""', 'PROBE_OUT=""\nif curl -sS "$PROBE_URL"; then :; fi');
  const curlLines = poisoned.split("\n").filter((ln) => /(^|[^\w-])curl\b/.test(ln) && !/^\s*#/.test(ln));
  assert.strictEqual(curlLines.length, 1, "偵測式必須抓到被塞回去的 curl，否則上面那條是假閘");
});
