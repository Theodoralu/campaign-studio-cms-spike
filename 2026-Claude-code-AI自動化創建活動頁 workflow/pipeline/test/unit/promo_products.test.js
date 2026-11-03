"use strict";
/**
 * lib/promo_products.js 單元測試（2026-09-04 復發病例＝主打選品舞台皮沒價格沒特色標）
 * 守的邏輯：①候選項必帶 price（08-30 那版 prodItem 剝掉價格＝補入條件永遠不成立的死修）
 *          ②缺真值＝跳過且回報原因、不塞半套 ③冪等 ④真 run 資料（read-only）走一遍＝四件都補得進
 */
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const P = require("../../lib/promo_products");

const snapProd = (g, over = {}) => ({ gdid: g, name: "商品" + g, price: 1234, marketPrice: 1500, url: `https://tw.buy.yahoo.com/gdsale/p-${g}.html`, imgs: [`https://img/${g}.jpg`], offer: "活動券", ...over });

test("promoPoolItem：候選項帶 price／marketPrice／imgs／offer（2026-08-30 prodItem 只有四欄＝復發真因）", () => {
  const it = P.promoPoolItem(snapProd("900001"));
  assert.equal(it.price, 1234); assert.equal(it.marketPrice, 1500); assert.equal(it.img, "https://img/900001.jpg"); assert.equal(it.offer, "活動券");
  assert.equal(P.promoPoolItem(null), null);
  const stripped = { gdid: "1", name: "x", img: "i", url: "u" }; // 舊 prodItem 形
  const r = P.ensurePromoProducts({ products: [] }, [{ gdid: "1" }], [stripped]);
  assert.deepEqual(r.added, []); assert.equal(r.skipped[0].reason, "missing:price", "舊形＝一定被跳過且講明缺 price（不再靜默）");
});

test("ensurePromoProducts：補入含真值欄；缺真值＝跳過出聲；不在池＝出聲；已在清單＝不重複", () => {
  const dj = { products: [{ gdid: "900002", name: "已在", price: 1 }] };
  const pool = [P.promoPoolItem(snapProd("900001")), P.promoPoolItem(snapProd("900003", { price: null })), P.promoPoolItem(snapProd("900002"))];
  const r = P.ensurePromoProducts(dj, [{ gdid: "900001" }, { gdid: "900003" }, { gdid: "900002" }, { gdid: "900004" }, { actid: "A1" }], pool);
  assert.deepEqual(r.added, ["900001"]);
  assert.deepEqual(r.skipped.map((s) => s.gdid + ":" + s.reason), ["900003:missing:price", "900004:not-in-pool"]);
  const p = dj.products.find((x) => x.gdid === "900001");
  assert.equal(p.price, 1234); assert.equal(p.marketPrice, 1500); assert.equal(p.offer, "活動券"); assert.deepEqual(p.imgs, ["https://img/900001.jpg"]);
  assert.equal(dj.products.length, 2);
  const r2 = P.ensurePromoProducts(dj, [{ gdid: "900001" }], pool); assert.deepEqual(r2.added, [], "冪等");
  assert.ok(P.describeSkipped(r.skipped).includes("2 則") && P.describeSkipped(r.skipped).includes("900003 missing:price"));
  assert.equal(P.describeSkipped([]), "");
});

test("真 run 資料（read-only）：2026-09-04-wb-164258 四則品牌推薦入口＝用 snapshot 真值全部補得進", { skip: !fs.existsSync(path.join(__dirname, "../../runs/2026-09-04-wb-164258/snapshot.json")) }, () => {
  const rd = path.join(__dirname, "../../runs/2026-09-04-wb-164258");
  const dj = JSON.parse(fs.readFileSync(path.join(rd, "draft.json"), "utf8"));
  const snap = JSON.parse(fs.readFileSync(path.join(rd, "snapshot.json"), "utf8"));
  const pool = (snap.products || []).map(P.promoPoolItem).filter(Boolean);
  const want = ["12060783", "11463406", "11257801", "11204189"];
  dj.products = dj.products.filter((x) => !want.includes(String(x.gdid))); // 先把四件拿掉＝不管草稿現況（使用者已重組過會已在清單），測的是「補得進」
  const before = dj.products.length;
  const r = P.ensurePromoProducts(dj, dj.page.promoEntries.filter((e) => want.includes(String(e.gdid))), pool);
  assert.equal(r.added.length, 4, JSON.stringify(r.skipped));
  assert.equal(dj.products.length, before + 4);
  for (const g of want) assert.ok(dj.products.find((x) => x.gdid === g && x.price > 0), g);
});
