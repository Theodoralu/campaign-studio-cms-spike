"use strict";
/**
 * curate_auto --heroCount（乙；2026-09-27 使用者裁「主視覺優先、下面讓位」維持）。
 * 病例形狀：products[] 永遠是 kv-main×3 → 第 1 層情境卡代表品 → …，四件槽版式的主視覺第 4 格必然吃到代表品（run 142315／123617）。
 * 驗四件事：①不帶參數＝舊行為（3 件主打、第 4 件就是情境卡代表品＝把那個陷阱記在測試裡）②帶 4＝預留 4 件、樓層從第 5 件起、
 * 舊 KV 節點仍 3 件、商品總數不變（只是搬位置）③新版式路主打只挑名字放得進兩行的④值域夾 3～8。
 * 跑真 CLI（fixture snapshot 落暫存夾；圓圖探測會觸網、離線＝退主圖照實用＝不影響本檔斷言）。
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const PIPE = path.join(__dirname, "..", "..");
const CLI = path.join(PIPE, "workbench", "curate_auto.js");
const SNAP = path.join(PIPE, "test", "fixtures", "gate_pass_snapshot.json");
const RULES = require(path.join(PIPE, "rules.json"));
const W = RULES.charLimits.widthModel;
const strW = (s) => [...(s || "")].reduce((a, c) => a + (c === " " ? W.space : c.charCodeAt(0) > 255 ? W.fullwidth : W.halfwidth), 0);
const heroBudget = RULES.charLimits.pxBudgets.heroName.budgetPx / RULES.charLimits.pxBudgets.heroName.fontPx;
const gdidOf = (u) => { const m = String(u || "").match(/[?&]gdid=(\w+)/); return m ? m[1] : null; };

function run(args, mutateSnap) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "curate-hc-"));
  const snap = JSON.parse(fs.readFileSync(SNAP, "utf8"));
  if (mutateSnap) mutateSnap(snap);
  fs.writeFileSync(path.join(dir, "snapshot.json"), JSON.stringify(snap));
  const out = execFileSync(process.execPath, [CLI, dir, "--scenario", "", "--theme", "", ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  const draft = JSON.parse(fs.readFileSync(path.join(dir, "draft.json"), "utf8"));
  fs.rmSync(dir, { recursive: true, force: true });
  return { out, draft };
}
const kvMain = (d) => d.products.filter((p) => p.position === "kv-main").map((p) => String(p.gdid));

test("不帶參數＝舊行為：主打 3 件、products[3] 就是第 1 層情境卡代表品（四件槽版式會撞的那個陷阱）、沒有預留提醒", () => {
  const { out, draft } = run([]);
  assert.deepStrictEqual(kvMain(draft).length, 3);
  assert.deepStrictEqual(draft.page.kv.keyProductGdids, kvMain(draft));
  assert.strictEqual(String(draft.products[3].gdid), gdidOf(draft.page.floors[0].sceneUrl), "第 4 件＝情境卡代表品（舊形狀，記在這裡當對照）");
  assert.strictEqual(draft.products[3].position, "featured-1-scene");
  assert.doesNotMatch(out, /主打商品預留/); assert.doesNotMatch(out, /主打商品跳過/);
});

test("--heroCount 4：主打 4 件、樓層從第 5 件起分、舊 KV 節點仍 3 件、商品總數與集合不變（只搬位置）、提醒出聲", () => {
  const base = run([]).draft;
  const { out, draft } = run(["--heroCount", "4"]);
  const kv = kvMain(draft);
  assert.strictEqual(kv.length, 4);
  assert.deepStrictEqual(draft.products.slice(0, 4).map((p) => p.position), ["kv-main", "kv-main", "kv-main", "kv-main"]);
  assert.strictEqual(String(draft.products[4].gdid), gdidOf(draft.page.floors[0].sceneUrl), "第 5 件才是情境卡代表品");
  assert.ok(!draft.page.floors.some((f) => kv.includes(gdidOf(f.sceneUrl)) || (f.productGdids || []).some((g) => kv.includes(String(g)))), "主打 4 件都不在樓層");
  assert.ok(!draft.page.walls.some((w) => (w.productGdids || []).some((g) => kv.includes(String(g)))), "也不在牆上");
  assert.strictEqual(draft.page.kv.keyProductGdids.length, 3, "舊 KV 節點固定 3 件（gate KV_KEY_PRODUCTS）"); assert.strictEqual(draft.page.kv.images.length, 3);
  assert.deepStrictEqual(draft.page.kv.keyProductGdids, kv.slice(0, 3));
  /* 多預留一件＝樓層／牆／編輯精選的餘量算法會跟著挪（總數可差幾件），守的是形狀不是數字：不重複、樓層層數與每層卡數同舊、全部來自來源紀錄 */
  const gd = draft.products.map((p) => String(p.gdid));
  assert.strictEqual(new Set(gd).size, gd.length, "products[] 不重複");
  assert.strictEqual(draft.page.floors.length, base.page.floors.length, "樓層層數同舊");
  draft.page.floors.forEach((f, i) => assert.strictEqual(f.productGdids.length, base.page.floors[i].productGdids.length, `第 ${i + 1} 層卡數同舊`));
  const snapIds = new Set(JSON.parse(fs.readFileSync(SNAP, "utf8")).products.map((p) => String(p.gdid)));
  assert.ok(gd.every((g) => snapIds.has(g)), "全部來自來源紀錄");
  assert.match(out, /主打商品預留 4 件，樓層從第 5 件起分。/);
  assert.ok(draft.meta.notes.includes("主打商品預留 4 件，樓層從第 5 件起分。"));
});

test("新版式路：名字放不進主視覺兩行的不當主打、往後排給樓層（尺＝rules.json heroName）；不帶參數＝長名照舊當主打", () => {
  const LONG = "興達港歐董魚丸 回購組合(花枝蝦排X1+月亮花枝蝦餅X1+包蛋旗魚黑輪x1+蝦滋圈x1+牛蒡天婦羅x1+鮮蝦滑x1)";
  assert.ok(strW(LONG) > heroBudget, "前置確認：病例原字確實放不進兩行");
  const old = run([]).draft;
  const firstGdid = String(old.products[0].gdid); // 舊路池頭第一件＝主打 #1
  const mut = (snap) => { const p = snap.products.find((x) => String(x.gdid) === firstGdid); p.name = LONG; };
  const oldLong = run([], mut).draft;
  assert.strictEqual(String(oldLong.products[0].gdid), firstGdid, "不帶參數＝長名照舊當主打（舊行為不動）");
  const { out, draft } = run(["--heroCount", "3"], mut);
  assert.ok(!kvMain(draft).includes(firstGdid), "新版式路：長名不當主打");
  assert.ok(draft.products.some((p) => String(p.gdid) === firstGdid && /^featured-1/.test(p.position)), "長名往後排＝進第 1 層（代表品或卡）");
  assert.ok(kvMain(draft).every((g) => strW(draft.products.find((p) => String(p.gdid) === g).name) <= heroBudget), "主打全部放得進兩行");
  assert.match(out, /主打商品跳過 1 件名字放不進兩行的，往後排給樓層。/);
});

test("值域夾 3～8：--heroCount 99＝8、--heroCount 1＝3、非數字＝3", () => {
  assert.strictEqual(kvMain(run(["--heroCount", "99"]).draft).length, 8);
  assert.strictEqual(kvMain(run(["--heroCount", "1"]).draft).length, 3);
  assert.strictEqual(kvMain(run(["--heroCount", "abc"]).draft).length, 3);
});
