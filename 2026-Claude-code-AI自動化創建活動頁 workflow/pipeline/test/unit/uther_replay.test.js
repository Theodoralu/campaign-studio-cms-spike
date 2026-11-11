"use strict";
/**
 * uther 版抓取黃金對照——四種來源網址型（D6 店家；D7 活動／搜尋／品牌）。
 * 每個 test/fixtures/runs/<dir>/snapshot.uther.json 都是在能連 uther 的機器錄的真回應（卡帶在 test/fixtures/http/）；
 * 這裡離線回放 fetch_uther.js，輸出必須逐字相同，並通過 schema。改了 normalize／build_snapshot 的行為＝`npm run golden:regen:uther` 重產並在 commit 說明。
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const PIPE = path.resolve(__dirname, "..", "..");
const RUNS = path.join(PIPE, "test", "fixtures", "runs");
const KINDS = { "2026-10-27-wb-085823": "store", "act-806613": "activity", "search-iphone": "search", "brand-41168929": "brand" };

for (const dir of fs.readdirSync(RUNS)) {
  const gf = path.join(RUNS, dir, "snapshot.uther.json");
  if (!fs.existsSync(gf)) continue;
  const golden = JSON.parse(fs.readFileSync(gf, "utf8"));
  test(`uther 回放（${KINDS[dir] || dir}）：snapshot 與黃金夾具逐字相同、通過 schema`, () => {
    const out = fs.mkdtempSync(path.join(os.tmpdir(), "cs-uther-replay-"));
    const r = spawnSync(process.execPath, [path.join(PIPE, "fetch_uther.js"), golden.sourceUrl, out], {
      env: { ...process.env, CS_HTTP_MODE: "replay", CS_HTTP_CASSETTE_DIR: path.join(PIPE, "test", "fixtures", "http"), CS_NOW: golden.fetchedAt, TZ: "UTC" }, encoding: "utf8",
    });
    assert.strictEqual(r.status, 0, `fetch_uther 回放失敗：\n${r.stdout}\n${r.stderr}`);
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(path.join(out, "snapshot.json"), "utf8")), golden);
    const v = spawnSync(process.execPath, [path.join(PIPE, "tools", "schema", "validate.js"), path.join(PIPE, "schemas"), path.join(out, "snapshot.json")], { encoding: "utf8" });
    assert.strictEqual(v.status, 0, v.stdout + v.stderr);
    assert.strictEqual(golden.meta.kind, KINDS[dir]);
  });
  test(`uther 快照（${KINDS[dir] || dir}）：真值欄齊、價格規則成立、池量 ≥24`, () => {
    for (const p of golden.products) {
      assert.ok(p.gdid && p.name && p.url && p.imgs.length, `缺真值欄：${p.gdid}`);
      assert.ok(p.price != null, `無價：${p.gdid}`);
      if (p.currentPrice != null) assert.strictEqual(p.price, p.currentPrice); else assert.strictEqual(p.marketPrice, null, "沒有活動價就不劃線");
      assert.match(p.source, /^uther:/);
    }
    assert.ok(golden.products.length >= 24);
    assert.ok(golden.meta.totalhitcount > 0, "v1 總筆數要記下來");
  });
}

test("brand 型：數字 slug 直接當 brandId，不抓頁；品牌名由 filterTags「品牌」多數決", () => {
  const g = JSON.parse(fs.readFileSync(path.join(RUNS, "brand-41168929", "snapshot.uther.json"), "utf8"));
  assert.deepStrictEqual(g.meta.brandIds, ["41168929"]); assert.strictEqual(g.brand, "JESSICA");
  assert.ok(!g.meta.uther.some((c) => /tw\.buy\.yahoo\.com\/brands/.test(c.url)), "沒有抓品牌頁");
});

test("search 型：brand 為 null（跨店）；activity 型：活動 id 在 activities 裡且 count>0", () => {
  const s = JSON.parse(fs.readFileSync(path.join(RUNS, "search-iphone", "snapshot.uther.json"), "utf8"));
  assert.strictEqual(s.brand, null);
  const a = JSON.parse(fs.readFileSync(path.join(RUNS, "act-806613", "snapshot.uther.json"), "utf8"));
  assert.ok(a.activities["806613"] && a.activities["806613"].count > 0); assert.strictEqual(a.activities["806613"].liveness, "online");
});
