"use strict";
/**
 * D10：檢查點清單（core/gate/catalog.js）與程式對得上，而且每一條都有測試資料。
 * 變異案例＝拿黃金夾具的草稿／快照改一處，在程式內跑檢查（不 spawn、不寫檔、不觸網），確認該檢查點真的會響。
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const G = require("../../core/gate");

const PIPE = path.resolve(__dirname, "..", "..");
const FIX = path.join(PIPE, "test", "fixtures", "runs", "2026-10-27-wb-085823");
const read = (f) => JSON.parse(fs.readFileSync(path.join(FIX, f), "utf8"));
process.env.CS_NOW = "2026-10-27T00:58:24.018Z";
const promo = (n, end) => ({ actid: "90000" + n, title: "測試活動" + n, short: "", url: "https://tw.buy.yahoo.com/activity/activity950?actid=90000" + n, endTs: Date.parse(end) / 1000 });

/** 代號 → [最重級別, 變異(draft, snapshot)] */
const CASES = {
  "CP-01": ["WARN", (d) => { d.page.kv.titleLine1 = "龘龘好物"; }],
  "CP-07": ["FAIL", (d, s) => { s.promotions = [1, 2, 3].map((n) => promo(n, "2026-10-01T00:00:00+08:00")); d.page.promoEntries = s.promotions.map((p) => ({ actid: p.actid, url: p.url, title: p.title })); }],
  "CP-08": ["FAIL", (d) => { d.page.promoEntries = d.products.slice(0, 3).map((p) => ({ url: p.url, title: p.name, img: "https://img.yec.tw/x/not-first.jpg" })); }],
  "CP-09": ["FAIL", (d) => { d.page.promoEntries = d.products.slice(0, 3).map((p) => ({ url: p.url, title: p.name, dateValue: "10/01-10/31" })); }],
  "CP-10": ["FAIL", (d) => { d.page.promoSourceMode = "whatever"; }],
  "CP-13": ["FAIL", (d) => { d.page.ctaText = "search p=鈦鍋"; }],
  "CP-17": ["FAIL", (d, s) => { s.promotions = [promo(1, "2026-12-01T00:00:00+08:00")]; d.page.promoEntries = [{ actid: "900001", url: s.promotions[0].url, title: "測試活動1" }, ...d.products.slice(0, 2).map((p) => ({ url: p.url, title: p.name }))]; }],
  "CP-20": ["FAIL", (d) => { d.page.curationTheme = "鈦"; }], // 主題說是鈦製品、商品全是鑄鐵鍋＝主從不一致。注意：這條只對同義表裡有的五個品類生效，其餘主題整條略過（見 docs/gate-export-D10.md）
};

test("清單與程式一致：gate.js 發得出來的代號都在清單上，清單上標 gate 的代號程式裡都有", () => {
  const src = fs.readFileSync(path.join(PIPE, "gate.js"), "utf8");
  const emitted = new Set([...src.matchAll(/add\([^,]+,\s*"(CP-\d+)"/g)].map((m) => m[1]));
  const listed = new Set(G.CATALOG.filter((c) => c.where === "gate").map((c) => c.code));
  assert.deepStrictEqual([...emitted].sort(), [...listed].sort());
  assert.strictEqual(new Set(G.CATALOG.map((c) => c.code)).size, G.CATALOG.length, "代號不重複");
  for (const c of G.NOT_IN_REPO) assert.ok(!emitted.has(c), `${c} 程式裡其實有，該移進清單`);
});

test("清單上每一條都有測試資料：既有測試檔存在且提到該代號，或在本檔有變異案例", () => {
  for (const c of G.CATALOG) {
    assert.ok(c.test.length, `${c.code} 沒登記測試`);
    for (const t of c.test) {
      if (t === "catalog") { assert.ok(CASES[c.code], `${c.code} 標 catalog 但本檔沒有變異案例`); continue; }
      if (t.startsWith("ci:")) continue; // CI 專屬 job（CP-32 需要真瀏覽器）
      const file = path.join(PIPE, "test", t);
      assert.ok(fs.existsSync(file), `${c.code} 登記的測試檔不存在：${t}`);
      assert.ok(fs.readFileSync(file, "utf8").includes(c.code), `${t} 沒提到 ${c.code}`);
    }
  }
});

test("基準：黃金夾具在程式內檢查＝與指令列產出的黃金報告相同（FAIL 0）", async () => {
  const snapRaw = fs.readFileSync(path.join(FIX, "snapshot.replay.json")), draftRaw = fs.readFileSync(path.join(FIX, "draft.golden.json"));
  const r = await G.check({ snapRaw, draftRaw, skipHttp: true });
  const gold = read("gate_report.golden.json");
  assert.deepStrictEqual(r.findings, gold.findings); assert.deepStrictEqual(r.counts, gold.counts);
  assert.strictEqual(r.draftSha256, gold.draftSha256); assert.strictEqual(r.snapshotSha256, gold.snapshotSha256);
  assert.strictEqual(G.blocking(r), false);
  assert.ok(G.byCheckpoint(r).every((x) => x.title), "報告裡每個代號清單上都有白話標題");
});

for (const [code, [level, mutate]] of Object.entries(CASES)) {
  test(`${code} 會響（${level}）：${G.CATALOG.find((c) => c.code === code).title}`, async () => {
    const d = read("draft.golden.json"), s = read("snapshot.replay.json");
    mutate(d, s);
    const r = await G.check({ snapshot: s, draft: d, skipHttp: true });
    const hit = r.findings.filter((f) => f.code === code && f.level === level);
    assert.ok(hit.length >= 1, `${code} 沒有 ${level}：${JSON.stringify(r.findings.filter((f) => f.code === code)).slice(0, 300)}`);
    if (level === "FAIL") assert.strictEqual(G.blocking(r), true);
  });
}

test("themeFitRule 直接傳物件（不落檔）＝與環境變數指定校準檔同一條路", async () => {
  const d = read("draft.golden.json"), s = read("snapshot.replay.json");
  const src = fs.readFileSync(path.join(PIPE, "gate.js"), "utf8");
  assert.ok(!/claude-\d+|-Users-/.test(src), "gate.js 不留個人暫存路徑");
  const a = await G.check({ snapshot: s, draft: d, skipHttp: true, themeFitRule: { keywords: ["鑄鐵鍋/琺瑯"], threshold: 0.3 } });
  assert.strictEqual(a.result, "PASS");
});
