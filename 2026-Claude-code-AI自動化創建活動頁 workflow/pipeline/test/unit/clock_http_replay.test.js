"use strict";
/** D4：lib/clock 與 lib/http_replay 的單元測試（不觸網） */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const clock = require("../../lib/clock");
const replay = require("../../lib/http_replay");

test("clock：沒設 CS_NOW＝真實時間會走", async () => {
  delete process.env.CS_NOW;
  assert.strictEqual(clock.fixed(), false);
  const a = clock.now(); await new Promise((r) => setTimeout(r, 5));
  assert.ok(clock.now() >= a + 4);
});

test("clock：CS_NOW 固定＝恆回同一刻，ISO／秒／Date 一致", () => {
  process.env.CS_NOW = "2026-10-27T00:58:24.018Z";
  assert.strictEqual(clock.fixed(), true);
  assert.strictEqual(clock.iso(), "2026-10-27T00:58:24.018Z");
  assert.strictEqual(clock.unix(), Math.floor(Date.parse("2026-10-27T00:58:24.018Z") / 1000));
  assert.strictEqual(clock.date().getTime(), clock.now());
  process.env.CS_NOW = "1761526704018";
  assert.strictEqual(clock.now(), 1761526704018);
  process.env.CS_NOW = "not-a-date";
  assert.throws(() => clock.now(), /CS_NOW/);
  delete process.env.CS_NOW;
});

test("http_replay：replay 模式從卡帶回答，get() 長得像 https.get；缺卡帶＝throw", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cs-cassette-"));
  process.env.CS_HTTP_CASSETTE_DIR = dir; process.env.CS_HTTP_MODE = "replay";
  const url = "https://example.test/page?x=1";
  fs.writeFileSync(path.join(dir, `${replay.keyOf("GET", url)}.json`), JSON.stringify({ url, statusCode: 200, headers: { "content-type": "text/html" }, encoding: "utf8", body: "<h1>hi</h1>" }));
  const got = await new Promise((resolve, reject) => {
    const req = replay.get(url, { headers: {} }, (res) => { let s = ""; res.setEncoding("utf8"); res.on("data", (c) => (s += c)); res.on("end", () => resolve({ status: res.statusCode, body: s })); });
    req.on("error", reject); req.setTimeout(1000, () => {});
  });
  assert.deepStrictEqual(got, { status: 200, body: "<h1>hi</h1>" });
  assert.throws(() => replay.get("https://example.test/missing", {}, () => {}), /找不到卡帶/);
  const r = await replay.fetch(url);
  assert.strictEqual(r.status, 200); assert.strictEqual(await r.text(), "<h1>hi</h1>");
  delete process.env.CS_HTTP_MODE; delete process.env.CS_HTTP_CASSETTE_DIR;
});

test("http_replay：live 模式（預設）就是 https.get 本人，不碰卡帶", () => {
  delete process.env.CS_HTTP_MODE;
  assert.strictEqual(replay.mode(), "live");
});
