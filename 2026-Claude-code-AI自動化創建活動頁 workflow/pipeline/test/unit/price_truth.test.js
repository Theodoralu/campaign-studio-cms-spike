"use strict";
/**
 * lib/price_truth.js 單元測試（丙-甲 建立期價格對真；2026-09-27 使用者裁）。
 * 快照那一刀用 server.js 的真 patchSnapshotPrice（從原始碼抽出來跑，不另寫第二份）——測的是「同一把刀」。
 * 病例數字＝run 2026-09-27-wb-123617：11626712 快照 1142（活動頁網路價）、商品頁 1085／原價 1142。
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { applyPriceTruth } = require("../../lib/price_truth");

const serverSrc = fs.readFileSync(path.join(__dirname, "..", "..", "workbench", "server.js"), "utf8");
const m = serverSrc.match(/\nconst patchSnapshotPrice = \(snap, sp, row, checkedAt\) => \{[\s\S]*?\n\};/);
assert.ok(m, "server.js 要有 patchSnapshotPrice（快照那一刀的唯一實作）");
const ctx = {}; vm.createContext(ctx); vm.runInContext(m[0] + "\n;globalThis.__p = patchSnapshotPrice;", ctx);
const patchSnapshotPrice = ctx.__p;

const mk = () => ({
  snap: { products: [
    { gdid: "11626712", price: 1142, currentPrice: 1142, promotionPrice: null, marketPrice: null, disc: null },
    { gdid: "12233551", price: 170, marketPrice: null, disc: null },
    { gdid: "99", price: 500, marketPrice: 600, disc: 83 },
  ], warnings: [], minDisc: null },
  draft: { products: [
    { gdid: "11626712", position: "kv-main", price: 1142 },
    { gdid: "12233551", position: "featured-1-scene", price: 170 },
    { gdid: "99", position: "featured-1", price: 500, marketPrice: 600 },
  ] },
});

test("有變價＝快照與草稿同批改：price 換商品頁現價、原價高於現價才留欄、快照多一行稽核；沒變的不動", () => {
  const { snap, draft } = mk();
  const rows = [
    { gdid: "11626712", status: "online", draftPrice: 1142, livePrice: 1085, liveMarketPrice: 1142, drift: true, snapDrift: true },
    { gdid: "12233551", status: "online", draftPrice: 170, livePrice: 170, drift: false, snapDrift: false },
    { gdid: "99", status: "online", draftPrice: 500, livePrice: 500, liveMarketPrice: null, marketDrift: true, drift: true, snapDrift: true }, // 商品頁沒劃線了＝原價移除
  ];
  const r = applyPriceTruth({ snap, draft, rows, checkedAt: "2026-09-27T04:39:23Z", patchSnapshotPrice });
  assert.strictEqual(r.applied.length, 2); assert.strictEqual(r.checked, 3); assert.strictEqual(r.unverified, 0); assert.strictEqual(r.offline, false);
  assert.deepStrictEqual(r.applied[0], { gdid: "11626712", from: { price: 1142, marketPrice: null }, to: { price: 1085, marketPrice: 1142 } });
  assert.strictEqual(snap.products[0].price, 1085); assert.strictEqual(snap.products[0].marketPrice, 1142); assert.strictEqual(snap.products[0].disc, 95);
  assert.strictEqual(draft.products[0].price, 1085); assert.strictEqual(draft.products[0].marketPrice, 1142, "草稿列跟快照同一個值＝gate CP-02 現價／原價都對得上");
  assert.strictEqual(draft.products[1].price, 170, "沒變價的不動");
  assert.strictEqual(snap.products[2].marketPrice, null); assert.strictEqual(draft.products[2].marketPrice, undefined, "商品頁沒劃線＝草稿原價欄刪掉（不留 null）");
  assert.deepStrictEqual(r.applied[1].to, { price: 500, marketPrice: null });
  assert.strictEqual(snap.warnings.length, 2, "每件改價一行快照稽核（patchSnapshotPrice 寫）"); assert.match(snap.warnings[0], /套用新價：gdid 11626712 price 1142→1085/);
});

test("篩選與「一鍵套用全部變價」同一條：offline／dead／unverified／沒 livePrice 的都不碰；不在草稿的不動池、不在池的列跳過並回報", () => {
  const { snap, draft } = mk();
  snap.products.push({ gdid: "55", price: 100, marketPrice: null }); // 池有、草稿沒有＝productCheck 不會驗到它；多給的列不准動池
  const rows = [
    { gdid: "11626712", status: "offline", livePrice: null, drift: true },
    { gdid: "12233551", status: "unverified", note: "timeout" },
    { gdid: "99", status: "online", livePrice: 450, drift: true, snapDrift: true },
    { gdid: "77777", status: "online", livePrice: 1, drift: true },
    { gdid: "55", status: "online", livePrice: 90, drift: true },
  ];
  const r = applyPriceTruth({ snap, draft, rows, patchSnapshotPrice });
  assert.deepStrictEqual(r.applied.map((a) => a.gdid), ["99"]);
  assert.deepStrictEqual(r.skippedNotInPool, []); assert.deepStrictEqual(r.skippedNotInDraft.sort(), ["55", "77777"], "不在草稿＝先擋（77777 連池都沒有，也歸這類）");
  assert.strictEqual(snap.products[3].price, 100, "池有、草稿沒有的那件不動");
  assert.strictEqual(r.unverified, 1); assert.strictEqual(r.offline, false);
  assert.strictEqual(snap.products[0].price, 1142, "offline 的不改"); assert.strictEqual(draft.products[0].price, 1142);
});

test("離線＝全部 unverified：一件都不改、offline=true 給呼叫端出聲；空報告＝checked 0、offline=false", () => {
  const { snap, draft } = mk();
  const rows = snap.products.map((p) => ({ gdid: p.gdid, status: "unverified", note: "測試樁：離線" }));
  const r = applyPriceTruth({ snap, draft, rows, patchSnapshotPrice });
  assert.strictEqual(r.applied.length, 0); assert.strictEqual(r.offline, true); assert.strictEqual(r.unverified, 3);
  assert.strictEqual(snap.warnings.length, 0); assert.strictEqual(draft.products[0].price, 1142);
  const r0 = applyPriceTruth({ snap, draft, rows: [], patchSnapshotPrice });
  assert.deepStrictEqual({ checked: r0.checked, offline: r0.offline, applied: r0.applied.length }, { checked: 0, offline: false, applied: 0 });
  assert.throws(() => applyPriceTruth({ snap, draft, rows }), /缺 patchSnapshotPrice/, "快照那一刀只能走 server.js 的同一支");
});
