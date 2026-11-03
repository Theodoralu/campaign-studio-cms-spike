"use strict";
/**
 * 挑埠要分得出「自己人」和「別人」（2026-10-10 使用者裁「丙方案」）。
 *
 * 病例：原本 start-editor.sh 只問「有沒有人應門」（curl /ping），有人就 exit 0、
 * 把瀏覽器讓給對方——**它分不出應門的是同一個包還是別的工具**。
 * 使用者機上同時有開發版工作台（也佔 8787），於是每次測單機版都被無聲導到開發版：
 * 模式不同（負責人 vs 編修）、活動存的地方也不同，整趟走查走在錯的版本上
 * （2026-10-08 物證：那一檔活動住在專案 runs/，而單機版的家最後一次有東西是 10/02）。
 * 同事端同病：任何程式佔住 8787，他就被默默丟過去。
 *
 * 分辨依據＝伺服器 /api/version 的 mode 與 build：
 *   這個包＝mode:editor ＋ build:<workbench/VERSION 第一行>（開發樹沒那個檔＝dev）。
 * 本測試起一台假伺服器扮演各種角色，驗 pick-port.sh 的判斷與輸出格式。
 */
const { test } = require("node:test");
const assert = require("node:assert");
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { execFile } = require("node:child_process");
/* 一定要用非同步版：假伺服器跟測試在同一個行程，execFileSync 會卡住事件迴圈
   ⇒ 伺服器沒機會回應 ⇒ curl 每次都逾時，測出來的是假紅（2026-10-10 首跑實證：四筆各剛好 2 秒＝curl --max-time 2）。 */

const WB = path.join(__dirname, "..", "..", "workbench");
const PICKER = path.join(WB, "pick-port.sh");
const VERSION_FILE = path.join(WB, "VERSION");

/** 起一台只回 /api/version 的假伺服器 */
function fakeServer(port, payload) {
  const srv = http.createServer((req, res) => {
    if (req.url === "/api/version") { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify(payload)); return; }
    res.writeHead(204); res.end();
  });
  return new Promise((ok) => srv.listen(port, "127.0.0.1", () => ok(srv)));
}
const close = (s) => new Promise((ok) => s.close(ok));

function pick(startPort, tries = 5) {
  return new Promise((ok, no) => {
    execFile("zsh", [PICKER, String(startPort), String(tries)], { encoding: "utf8" }, (err, stdout) => {
      if (err) { err.stdout = String(stdout || "").trim(); return no(err); }
      ok(String(stdout).trim());
    });
  });
}

/* 用高位埠，避開真的在跑的 8787/8788 */
const P = 18787;

test("沒人應門＝直接用這個號碼（輸出格式 `<埠> free`）", async () => {
  assert.equal(await pick(P), `${P} free`);
});

test("應門的是別的工具（負責人模式）＝換下一個，不把人讓給它", async () => {
  const s = await fakeServer(P, { mode: "owner", build: "dev" });
  try { assert.equal(await pick(P), `${P + 1} free`); } finally { await close(s); }
});

test("應門的是同一個包＝回報 ours（呼叫端據此不再起第二台）", async () => {
  fs.writeFileSync(VERSION_FILE, "testbuild-abc\n");
  const s = await fakeServer(P, { mode: "editor", build: "testbuild-abc" });
  try { assert.equal(await pick(P), `${P} ours`); } finally { await close(s); fs.unlinkSync(VERSION_FILE); }
});

test("應門的是同模式但不同版本＝仍算別人，不可誤判成自己人", async () => {
  fs.writeFileSync(VERSION_FILE, "testbuild-abc\n");
  const s = await fakeServer(P, { mode: "editor", build: "別的版本" });
  try { assert.equal(await pick(P), `${P + 1} free`); } finally { await close(s); fs.unlinkSync(VERSION_FILE); }
});

test("都被佔著＝exit 非 0，不可悄悄回一個被佔的號碼", async () => {
  const a = await fakeServer(P, { mode: "owner", build: "dev" });
  const b = await fakeServer(P + 1, { mode: "owner", build: "dev" });
  try {
    await assert.rejects(() => pick(P, 2), (e) => e.code !== 0, "全被佔還回 0＝呼叫端會拿著被佔的號碼去綁，然後炸在別的地方");
  } finally { await close(a); await close(b); }
});

test("兩個入口都走同一支挑埠腳本（規則不得各寫一份）", () => {
  const starter = fs.readFileSync(path.join(WB, "start-editor.sh"), "utf8");
  const launcher = fs.readFileSync(path.join(__dirname, "..", "..", "tools", "pack-root", "啟動 Campaign Studio.command"), "utf8");
  assert.match(starter, /pick-port\.sh/, "start-editor.sh 要呼叫 pick-port.sh");
  assert.match(launcher, /pick-port\.sh/, "啟動 .command 要呼叫 pick-port.sh");
  assert.ok(!/curl[^\n]*\/ping[^\n]*exit 0/.test(starter), "舊的「有人應門就退場」寫法不得回滲");
  const packer = fs.readFileSync(path.join(__dirname, "..", "..", "tools", "pack-editor.sh"), "utf8");
  assert.match(packer, /chmod \+x[^\n]*pick-port\.sh/, "打包要把 pick-port.sh 設成可執行，否則同事端跑不起來");
});
