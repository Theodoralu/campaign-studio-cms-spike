"use strict";
/**
 * D8：CurateEngine 介面＋04 號真值鐵律斷言＋留洞的行為（不觸網）。
 *
 * 真值鐵律（04 號 §1／03 schema）：草稿裡每一個價格、劃線價、折數、網址、品名、圖、活動檔期，都必須能在 snapshot 逐字找到；
 * 策展只挑選、不生成。這裡拿五份真快照（爬頁版 1、uther 版 4）各跑一次 rules 引擎，逐欄對回快照。
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { createRulesEngine, preparePool, CurateError } = require("../../core/curate");

const RUNS = path.join(__dirname, "..", "fixtures", "runs");
const read = (p) => JSON.parse(fs.readFileSync(p, "utf8"));
const pick = async (imgs) => ({ img: imgs[1] || imgs[0], notes: [] }); // 不探網：固定取第二張
const SNAPS = [
  ["scrape store", path.join(RUNS, "2026-10-27-wb-085823", "snapshot.replay.json")],
  ["uther store", path.join(RUNS, "2026-10-27-wb-085823", "snapshot.uther.json")],
  ["uther activity", path.join(RUNS, "act-806613", "snapshot.uther.json")],
  ["uther search", path.join(RUNS, "search-iphone", "snapshot.uther.json")],
  ["uther brand", path.join(RUNS, "brand-41168929", "snapshot.uther.json")],
];
const INPUT = { scenario: "同品類×跨品牌-優惠銷售", heroCount: 4 };

process.env.CS_NOW = "2026-11-11T02:00:00Z";

for (const [label, file] of SNAPS) {
  test(`真值鐵律（${label}）：草稿每個真值欄都能在 snapshot 逐字找到`, async () => {
    const snap = read(file);
    const engine = createRulesEngine({ pickCircleImg: pick });
    const { draft, outline } = await engine.curate(snap, { ...INPUT, runId: "t" });
    const byId = new Map(snap.products.map((p) => [String(p.gdid), p]));
    assert.ok(draft.products.length >= 20, `商品太少 ${draft.products.length}`);
    for (const dp of draft.products) {
      const sp = byId.get(String(dp.gdid));
      assert.ok(sp, `草稿商品 ${dp.gdid} 不在快照`);
      assert.strictEqual(dp.name, sp.name, `品名被改：${dp.gdid}`);
      assert.strictEqual(dp.price, sp.price, `價格被改：${dp.gdid}`);
      if (dp.marketPrice != null) assert.strictEqual(dp.marketPrice, sp.marketPrice, `劃線價被改：${dp.gdid}`);
      assert.strictEqual(dp.url, sp.url, `網址被改：${dp.gdid}`);
      assert.ok(sp.imgs.includes(dp.img), `主圖不在快照圖庫：${dp.gdid}`);
    }
    // 樓層／牆／主視覺引用的 gdid 都在草稿商品表裡，且不重複曝光
    const inDraft = new Set(draft.products.map((p) => String(p.gdid)));
    const seen = new Map();
    const ref = (where, g) => { assert.ok(inDraft.has(String(g)), `${where} 引用不在商品表：${g}`); assert.ok(!seen.has(String(g)), `${g} 重複曝光：${seen.get(String(g))} 與 ${where}`); seen.set(String(g), where); };
    for (const [slot, v] of Object.entries(draft.page.hero || {})) (v.gdids || []).forEach((g) => ref(`hero:${slot}`, g));
    draft.page.floors.forEach((f) => f.productGdids.forEach((g) => ref(f.pos, g)));
    draft.page.walls.forEach((w) => w.productGdids.forEach((g) => ref(w.pos, g)));
    // 本期活動入口：活動編號、標題、檔期、網址逐字來自快照 promotions（規則引擎只在這裡寫檔期；主視覺檔期一律留空等人填）
    assert.deepStrictEqual([draft.page.kv.dateValue, draft.page.kv.actid], ["", ""], "規則引擎不替主視覺填檔期／活動編號");
    for (const e of draft.page.promoEntries || []) {
      const pr = (snap.promotions || []).find((x) => String(x.actid) === String(e.actid));
      assert.ok(pr, `入口活動不在快照：${e.actid}`);
      assert.strictEqual(e.url, pr.url, `入口網址被改：${e.actid}`);
      assert.strictEqual(e.title, pr.title, `入口標題被改：${e.actid}`);
      assert.strictEqual(e.dateValue, pr.period || "", `入口檔期被改：${e.actid}`);
    }
    // 標題不含數字（04 號：ai-curated 標題無數字＝避開優惠宣稱）
    for (const f of draft.page.floors) if (f.titleSource === "ai-curated") assert.ok(!/\d/.test(f.title), `樓層標題含數字：${f.title}`);
    // outline 形狀
    assert.strictEqual(outline.engine, "rules"); assert.ok(outline.modules.some((m) => m.kind === "floor")); assert.deepStrictEqual(outline.pending, []);
    assert.strictEqual(outline.pool.order, "disc");
  });
}

test("真值鐵律（有入口的快照至少兩份）：入口斷言不是空過", async () => {
  let withEntries = 0;
  for (const [, file] of SNAPS) { const { draft } = await createRulesEngine({ pickCircleImg: pick }).curate(read(file), { ...INPUT, runId: "t" }); if ((draft.page.promoEntries || []).length) withEntries++; }
  assert.ok(withEntries >= 2, `只有 ${withEntries} 份快照產出入口`);
});

test("offer 逐字：快照有優惠短句＝標籤原字照抄（tagSource=offer）；太長才裁並留 tagOriginal", async () => {
  const snap = read(SNAPS[0][1]);
  snap.products.forEach((p, i) => { p.offer = i % 2 === 0 ? "超值組" : "這是一句非常非常長的優惠說明文字會超過標籤寬度預算"; });
  const { draft } = await createRulesEngine({ pickCircleImg: pick }).curate(snap, { ...INPUT, runId: "t" });
  const byId = new Map(snap.products.map((p) => [String(p.gdid), p]));
  const tagged = draft.products.filter((p) => p.tagSource === "offer");
  assert.ok(tagged.length >= 10, `offer 標籤太少：${tagged.length}`);
  for (const dp of tagged) {
    const offer = byId.get(String(dp.gdid)).offer;
    if (dp.tagOriginal) { assert.strictEqual(dp.tagOriginal, offer); assert.ok(offer.startsWith(dp.tag.replace(/…$/, "")), `裁切後不是原字前綴：${dp.tag}`); }
    else assert.strictEqual(dp.tag, offer, `offer 標籤被改寫：${dp.gdid}`);
    assert.strictEqual(dp.offer, offer);
  }
});

test("介面：plan → build 兩步可分開呼叫；build 沒拿 plan 的 outline＝出聲", async () => {
  const snap = read(SNAPS[1][1]);
  const engine = createRulesEngine({ pickCircleImg: pick });
  const outline = await engine.plan(snap, { ...INPUT, runId: "t" });
  assert.ok(!JSON.stringify(outline).includes('"_draft"'), "outline 序列化不帶內部草稿");
  const r = await engine.build(outline);
  assert.strictEqual(r.draft.page.id, "t");
  await assert.rejects(() => engine.build({ engine: "rules", modules: [] }), /build 需要 plan/);
});

test("池量守門：<6 件＝CurateError code 2（原 process.exit(2)）", async () => {
  const snap = read(SNAPS[1][1]); snap.products = snap.products.slice(0, 3);
  await assert.rejects(() => createRulesEngine({ pickCircleImg: pick }).curate(snap, INPUT), (e) => e instanceof CurateError && e.code === 2 && /商品池僅 3 件/.test(e.message));
});

test("洞 poolOrder=sales：只改池子預排，輸出仍通過真值鐵律；預設 disc 與黃金一致（由 e2e_golden 守）", async () => {
  const snap = read(SNAPS[1][1]);
  const a = preparePool(snap, { poolOrder: "sales" });
  assert.ok(a.snapshot.products[0].salesVolume >= a.snapshot.products[1].salesVolume);
  assert.match(a.notes[0], /poolOrder=sales/);
  const { draft } = await createRulesEngine({ pickCircleImg: pick }).curate(snap, { ...INPUT, runId: "t", poolOrder: "sales" });
  assert.ok(draft.products.length >= 20);
  const b = preparePool(snap, {}); assert.deepStrictEqual(b.snapshot.products.map((p) => p.gdid), snap.products.map((p) => p.gdid), "預設不動池序");
});

test("洞 excludeOutOfStock：uther 快照擋售完；爬頁快照無此欄＝不影響", () => {
  const u = read(SNAPS[1][1]); const n = u.products.filter((p) => p.stockStatus === "OUT_OF_STOCK").length; assert.ok(n >= 1, "夾具至少一件售完");
  const r = preparePool(u, { excludeOutOfStock: true }); assert.strictEqual(r.snapshot.products.length, u.products.length - n); assert.match(r.notes[0], /擋掉/);
  const s = read(SNAPS[0][1]); assert.strictEqual(preparePool(s, { excludeOutOfStock: true }).snapshot.products.length, s.products.length);
});
