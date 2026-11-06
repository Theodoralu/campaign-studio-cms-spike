"use strict";
/**
 * D4 黃金對照：離線回放 fetch_parse.js，snapshot 必須與夾具逐字相同。
 *
 * 夾具：test/fixtures/http/（三份卡帶＝2026-10-27 run 的 raw/ 轉來，tools/cassette_from_raw.js）
 *       test/fixtures/runs/2026-10-27-wb-085823/snapshot.replay.json（純抓取輸出；run 內的 snapshot.json 是事後套過價格真值的版本）
 * 不觸網：CS_HTTP_MODE=replay，卡帶缺檔就 throw。
 * 不看機器時區：CS_NOW 固定；檔期換算已寫死 +08:00（本檔用 TZ=UTC 跑一次確認）。
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const PIPE = path.resolve(__dirname, "..", "..");
const SEED = "2026-10-27-wb-085823";
const SOURCE_URL = "https://tw.buy.yahoo.com/?sub=1035";
const golden = () => JSON.parse(fs.readFileSync(path.join(PIPE, "test", "fixtures", "runs", SEED, "snapshot.replay.json"), "utf8"));

function replay(extraEnv = {}) {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), "cs-replay-"));
  const r = spawnSync(process.execPath, [path.join(PIPE, "fetch_parse.js"), SOURCE_URL, out], {
    env: { ...process.env, CS_HTTP_MODE: "replay", CS_HTTP_CASSETTE_DIR: path.join(PIPE, "test", "fixtures", "http"), CS_NOW: golden().fetchedAt, ...extraEnv },
    encoding: "utf8",
  });
  assert.strictEqual(r.status, 0, `fetch_parse 回放失敗：\n${r.stdout}\n${r.stderr}`);
  return JSON.parse(fs.readFileSync(path.join(out, "snapshot.json"), "utf8"));
}

test("回放產出的 snapshot 與黃金夾具逐字相同", () => {
  assert.deepStrictEqual(replay(), golden());
});

test("機器時區不影響結果（TZ=UTC 與 TZ=Asia/Taipei 同）", () => {
  assert.deepStrictEqual(replay({ TZ: "UTC" }), replay({ TZ: "Asia/Taipei" }));
});

test("回放模式碰到沒錄過的網址＝出聲失敗，不偷偷上網", () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), "cs-replay-miss-"));
  const r = spawnSync(process.execPath, [path.join(PIPE, "fetch_parse.js"), "https://tw.buy.yahoo.com/?sub=999999", out], {
    env: { ...process.env, CS_HTTP_MODE: "replay", CS_HTTP_CASSETTE_DIR: path.join(PIPE, "test", "fixtures", "http"), CS_NOW: golden().fetchedAt }, encoding: "utf8",
  });
  assert.notStrictEqual(r.status, 0);
  assert.match(r.stdout + r.stderr, /找不到卡帶/);
});
