"use strict";
/**
 * D6 黃金對照（uther 版抓取）：離線回放 fetch_uther.js，snapshot 必須與夾具逐字相同。
 * 夾具：test/fixtures/http/（2026-11-10 在能連 uther 的機器錄：v1 店內搜尋 ×2、getProductsByStoreId、v3 products ×2）
 *       test/fixtures/runs/2026-10-27-wb-085823/snapshot.uther.json
 * 不觸網：CS_HTTP_MODE=replay；缺卡帶就 throw。
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const PIPE = path.resolve(__dirname, "..", "..");
const FIX = path.join(PIPE, "test", "fixtures", "runs", "2026-10-27-wb-085823");
const golden = JSON.parse(fs.readFileSync(path.join(FIX, "snapshot.uther.json"), "utf8"));

test("uther 版回放 snapshot 與黃金夾具逐字相同；通過 schema", () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), "cs-uther-replay-"));
  const r = spawnSync(process.execPath, [path.join(PIPE, "fetch_uther.js"), golden.sourceUrl, out], {
    env: { ...process.env, CS_HTTP_MODE: "replay", CS_HTTP_CASSETTE_DIR: path.join(PIPE, "test", "fixtures", "http"), CS_NOW: golden.fetchedAt, TZ: "UTC" }, encoding: "utf8",
  });
  assert.strictEqual(r.status, 0, `fetch_uther 回放失敗：\n${r.stdout}\n${r.stderr}`);
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(path.join(out, "snapshot.json"), "utf8")), golden);
  const v = spawnSync(process.execPath, [path.join(PIPE, "tools", "schema", "validate.js"), path.join(PIPE, "schemas"), path.join(out, "snapshot.json")], { encoding: "utf8" });
  assert.strictEqual(v.status, 0, v.stdout + v.stderr);
});

test("uther 版快照的真值欄：每件有 gdid／name／price／url／imgs，價格規則成立，熱銷排序在前", () => {
  for (const p of golden.products) {
    assert.ok(p.gdid && p.name && p.url && p.imgs.length, `缺真值欄：${p.gdid}`);
    assert.ok(p.price != null, `無價：${p.gdid}`);
    if (p.currentPrice != null) assert.strictEqual(p.price, p.currentPrice); else assert.strictEqual(p.marketPrice, null, "沒有活動價就不劃線");
    assert.match(p.source, /^uther:/);
  }
  assert.ok(golden.products.length >= 24, "池量守門");
  assert.ok(golden.products.slice(0, 5).every((p) => p.salesVolume > 0), "sort=-sales 的前幾件都有銷量");
});
