"use strict";
/**
 * doors-seed.js —— 「同一能力多道門」入口全掃（CMS-DOORS 第 1 層）的可重跑種子
 *
 * 為什麼有這支：09-07 一天六件同類病（牆面下拉鎖死／圓卡沒下拉／情境卡沒露臉…）都是「某一個入口沒人走過」——
 * 要讓機器每次都走遍每一道門，得先有一份**每一道門都有商品、而且每種門都有一件「只有一張圖」**的草稿，
 * 這樣「補抓商品頁前五張」那條路才會被真的踩到（全都 5 張圖的稿永遠測不到補抓）。
 *
 * 種子來源＝test/fixtures/doors/（去識別化的真實 run 快照：layout-005＋3 樓層＋3 品類牆＋編輯精選 2 圓卡＋牆面）
 *   ＋ test/fixtures/gate_pass_draft.json（現行版型＝主視覺 kv 下拉那道門只有舊殼才有）。
 * 寫到 runs/<id>/（runs/ 為 gitignore 產物區、不入庫；重跑＝整目錄覆蓋）。
 *
 * 用法：node test/browser/doors-seed.js            → 只造種子（給手動開工作台看）
 *       由 doors-sweep.js require 後呼叫 seedDoorsRuns()
 */
const fs = require("fs");
const path = require("path");

const PIPE = path.join(__dirname, "..", "..");
const RUNS = path.join(PIPE, "runs");
const FIX = path.join(PIPE, "test", "fixtures");

const V2_ID = "2026-09-08-wb-doors1";      // 新版式（layout-005）＝主視覺商品／樓層／情境卡／品類牆／編輯精選／本期活動
const LEGACY_ID = "2026-09-08-wb-doors2";  // 現行版型＝主視覺 kv 用圖下拉（data-kvimgsel）

const readJson = (p) => JSON.parse(fs.readFileSync(p, "utf8"));
const writeJson = (p, o) => fs.writeFileSync(p, JSON.stringify(o, null, 1));
const gdidOfUrl = (u) => { const m = String(u || "").match(/\/p-(\d{6,18})\.html|[?&]gdid=(p?\d{6,18})/i); return m ? (m[1] || m[2]) : null; };

/** 把某件商品在草稿與快照池裡都收成「只有一張圖」＝逼出補抓那條路 */
function trimToSingleImg(draft, snapshot, gdid) {
  const p = (draft.products || []).find((x) => String(x.gdid) === String(gdid));
  if (!p) throw new Error(`種子商品 ${gdid} 不在草稿裡（fixture 變了？）`);
  p.imgs = [p.img].filter(Boolean);
  delete p.imgOptions;
  const sp = (snapshot.products || []).find((x) => String(x.gdid) === String(gdid));
  if (sp) sp.imgs = [p.img].filter(Boolean);
  return p;
}

function seedV2() {
  const draft = readJson(path.join(FIX, "doors", "v2-draft.json"));
  const snapshot = readJson(path.join(FIX, "doors", "v2-snapshot.json"));
  const meta = readJson(path.join(FIX, "doors", "v2-wb_meta.json"));
  const pg = draft.page;
  meta.id = V2_ID; pg.id = V2_ID; pg.pageName = "入口全掃種子（新版式）";
  meta.updatedAt = new Date().toISOString();

  /* 本期活動入口 ×3（fixture 原本 0 則＝這道門沒得測）：商品型入口走 products[] 圖集（mOpts 回查 imgOpts）
     第 1 則＝本來就有 ≥2 張圖的商品（下拉直接可選）；第 2 則＝單圖且補抓失敗（要講「單圖」）；第 3 則＝單圖、補抓成功（長出 5 個選項） */
  const richUnused = draft.products.find((p) => (p.imgs || []).length >= 2 && ![...pg.hero["product-left"].gdids, ...pg.hero["product-right"].gdids, ...pg.floors[0].productGdids, ...pg.walls[0].productGdids].map(String).includes(String(p.gdid)) && p.position !== "editorial-wall" && !/-scene$/.test(String(p.position || "")));
  const promoSrc = [String(richUnused.gdid), ...pg.walls[1].productGdids.slice(0, 2)]; // 後兩件取品類牆 2（避開下面要「收成單圖」的品類牆 1 第一件）
  pg.promoEntries = promoSrc.map((g, i) => {
    const p = draft.products.find((x) => String(x.gdid) === String(g));
    return { entrySource: "manual", manualKind: "product", destinationType: "manual", chip: `入口${i + 1}`, copy: String(p.name || "").slice(0, 12), dateValue: "", img: p.img, url: p.url, gdid: String(p.gdid) };
  });
  pg.promoSourceMode = "manual";

  /* 每種門各挑一件「只有一張圖」——這些列在畫面上要先出「取圖中…」、補抓後長出 5 個選項 */
  const cases = {
    hero: pg.hero["product-left"].gdids[0],                                        // 主視覺商品（data-himgsel）
    floorCard: pg.floors[0].productGdids[0],                                       // 樓層商品卡（data-imgsel）
    scene: draft.products.find((p) => p.position === "featured-1-scene").gdid,     // 樓層情境卡（data-scimgsel）
    wall: pg.walls[0].productGdids[0],                                             // 品類牆商品卡（data-imgsel）
    edWall: draft.products.find((p) => p.position === "editorial-wall").gdid,      // 編輯精選牆面（data-imgsel）
    promo: promoSrc[2],                                                            // 本期活動入口（data-mimgpick）：單圖、補抓成功
    promoFail: promoSrc[1],                                                        // 本期活動入口：單圖、補抓失敗（sweep 的假商品頁對這件回錯誤）
    circle: gdidOfUrl(pg.editorial.circles[0].url),                                // 編輯精選圓卡（data-ecimgsel）
  };
  const uniq = new Set(Object.values(cases).map(String));
  if (uniq.size !== Object.keys(cases).length) throw new Error("種子案例的商品撞號（同一件被兩道門共用＝互相干擾）：" + JSON.stringify(cases));
  for (const k of ["hero", "floorCard", "scene", "wall", "edWall", "promo", "promoFail"]) trimToSingleImg(draft, snapshot, cases[k]);
  { const c = pg.editorial.circles[0]; delete c.imgs; delete c.gdid; // 圓卡只留 img+url（09-07 病例的原始形）
    const sp = (snapshot.products || []).find((x) => String(x.gdid) === String(cases.circle)); if (sp) sp.imgs = [c.img].filter(Boolean); }
  /* 情境卡：引擎讀 floors[i].sceneImg；把它對齊該件 img（單圖態）＝下拉現值有錨 */
  pg.floors[0].sceneImg = draft.products.find((p) => String(p.gdid) === String(cases.scene)).img;

  const dir = path.join(RUNS, V2_ID);
  fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
  writeJson(path.join(dir, "draft.json"), draft);
  writeJson(path.join(dir, "snapshot.json"), snapshot);
  writeJson(path.join(dir, "wb_meta.json"), meta);
  return { id: V2_ID, cases };
}

function seedLegacy() {
  const draft = readJson(path.join(FIX, "gate_pass_draft.json"));
  const snapshot = readJson(path.join(FIX, "gate_pass_snapshot.json"));
  const pg = draft.page;
  delete pg.kvVariant; // 現行版型態（§2.8 legacy）＝主視覺走舊殼 kvHtml＝data-kvimgsel 那道門
  pg.id = LEGACY_ID; pg.pageName = "入口全掃種子（現行版型）";
  const cases = { kv: pg.kv.keyProductGdids[0] };
  trimToSingleImg(draft, snapshot, cases.kv);
  if (Array.isArray(pg.kv.images)) pg.kv.images[0] = draft.products.find((p) => String(p.gdid) === String(cases.kv)).img;
  const meta = { id: LEGACY_ID, stage: "ready", engine: "auto", engineUsed: "auto", createdAt: "2026-09-08T00:00:00.000Z", updatedAt: new Date().toISOString(),
    input: { url: snapshot.sourceUrl || "https://tw.buy.yahoo.com/", scenario: "", theme: "", ownerEmail: "qa@example.com", ownerDept: "QA", engine: "auto" } };
  const dir = path.join(RUNS, LEGACY_ID);
  fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
  writeJson(path.join(dir, "draft.json"), draft);
  writeJson(path.join(dir, "snapshot.json"), snapshot);
  writeJson(path.join(dir, "wb_meta.json"), meta);
  return { id: LEGACY_ID, cases };
}

function seedDoorsRuns() { return { v2: seedV2(), legacy: seedLegacy() }; }

module.exports = { seedDoorsRuns, V2_ID, LEGACY_ID };

if (require.main === module) {
  const r = seedDoorsRuns();
  console.log("種子已寫入 runs/：", JSON.stringify(r, null, 1));
}
