/* 廠商變更單 vendor_sheet.js 單元測試（node:test；零新相依）
 * 覆蓋：COLS/HEADER_ROWS 常數形狀、buildVendorRows baseline 快照＋系統索引欄、
 *       whereOf 定位、parseVendorEdits 真值安全（回錨/刪列/亂序/亂改索引/swap 格式/tag/note/舊版錯誤）。
 * fixture＝最小合成資料，不觸網路、不依賴 runs/ 大檔。 */
"use strict";

const { test } = require("node:test");
const assert = require("node:assert");

const { COLS, HEADER_ROWS, buildVendorRows, parseVendorEdits, whereOf } = require("../../vendor_sheet.js");

// ── 合成 draft：kv×1、主打樓層×2、品類牆×1、編輯精選牆×2，另 1 件未曝光（應被排除）──
function makeDraft() {
  return {
    page: {
      pageName: "測試活動頁",
      kv: { keyProductGdids: ["100001"] },
      floors: [{ productGdids: ["100002", "100003"] }],
      walls: [{ productGdids: ["100004"] }],
    },
    products: [
      { gdid: "100001", name: "商品A", tag: "熱銷", url: "https://x/1", price: 100, marketPrice: 200 },
      { gdid: "100002", name: "商品B", tag: "限量", url: "https://x/2", price: 300, marketPrice: 400 },
      { gdid: "100003", name: "商品C", tag: "",     url: "https://x/3", price: 500, marketPrice: 600 },
      { gdid: "100004", name: "商品D", tag: "推薦", url: "https://x/4", price: 700, marketPrice: 800 },
      { gdid: "100005", name: "編輯品E", tag: "編A", url: "https://x/5", price: 900,  marketPrice: 999,  position: "editorial-wall", order: 1 },
      { gdid: "100006", name: "編輯品F", tag: "編B", url: "https://x/6", price: 1100, marketPrice: 1200, position: "editorial-wall", order: 2 },
      { gdid: "999999", name: "未曝光品", tag: "", url: "https://x/9" }, // 無任何位置 ⇒ locateProduct=null ⇒ 排除
    ],
  };
}

// 期望位置（依 ord 排序後）＝ baseline / body 順序
const EXPECT_ORDER = ["100001", "100002", "100003", "100004", "100005", "100006"];
const EXPECT_POS = {
  "100001": "KV 主品 卡1",
  "100002": "主打樓層1 卡1",
  "100003": "主打樓層1 卡2",
  "100004": "品類牆1 卡1",
  "100005": "編輯精選商品牆 卡1",
  "100006": "編輯精選商品牆 卡2",
};

const clone2d = (rows) => rows.map((r) => (Array.isArray(r) ? r.slice() : r));
const findBody = (rows, origKey) => rows.find((r) => Array.isArray(r) && String(r[0]) === origKey);

// ── COLS / HEADER_ROWS 常數形狀 ──
test("COLS/HEADER_ROWS：第一欄=系統索引(origKey/🔒)、賣場編號=可改、可改欄集合正確", () => {
  assert.strictEqual(HEADER_ROWS, 5, "資訊 4 列＋表頭 1 列");
  assert.strictEqual(COLS.length, 9);
  // 第一欄＝系統索引回錨鍵
  assert.strictEqual(COLS[0].key, "origKey");
  assert.strictEqual(COLS[0].label, "系統索引");
  assert.strictEqual(COLS[0].lock, "🔒");
  // 賣場編號＝換品目標欄（可改），與系統索引分離
  assert.strictEqual(COLS[3].key, "gdid");
  assert.strictEqual(COLS[3].label, "賣場編號");
  assert.strictEqual(COLS[3].lock, "✍️");
  // 可改欄（✍️）＝賣場編號 / 標籤文案 / 廠商備註
  const editable = COLS.filter((c) => c.lock === "✍️").map((c) => c.key);
  assert.deepStrictEqual(editable.sort(), ["gdid", "note", "tag"]);
});

// ── buildVendorRows：baseline 快照＋第一欄=系統索引(origKey=原 gdid) ──
test("buildVendorRows：回傳 baseline 快照＋第一欄=系統索引(origKey=原 gdid)、含表頭定位錨", () => {
  const built = buildVendorRows(makeDraft(), "https://demo/preview");

  assert.strictEqual(built.headerRows, HEADER_ROWS);
  assert.deepStrictEqual(built.gdidOrder, EXPECT_ORDER);

  // baseline＝建表當下每列快照 [{gdid,name,tag,pos}]，長度＝曝光商品數（排除未曝光品）
  assert.strictEqual(built.baseline.length, EXPECT_ORDER.length);
  assert.deepStrictEqual(built.baseline[0], { gdid: "100001", name: "商品A", tag: "熱銷", pos: "KV 主品 卡1" });
  built.baseline.forEach((b, i) => {
    assert.strictEqual(b.gdid, EXPECT_ORDER[i]);
    assert.strictEqual(b.pos, EXPECT_POS[EXPECT_ORDER[i]]);
  });

  // rows＝資訊 4 列＋表頭 1 列＋商品 6 列
  assert.strictEqual(built.rows.length, 4 + 1 + EXPECT_ORDER.length);
  // 表頭列在 index 4，第一欄以「系統索引」開頭（讀回定位錨），欄數＝9
  const header = built.rows[HEADER_ROWS - 1];
  assert.strictEqual(header.length, COLS.length);
  assert.ok(String(header[0]).startsWith("系統索引"), "表頭第一欄需以系統索引起始");

  // 每筆商品列：第 0 欄(系統索引)＝原 gdid，建表當下第 0 欄===第 3 欄(賣場編號)
  EXPECT_ORDER.forEach((g) => {
    const row = findBody(built.rows, g);
    assert.ok(row, `應有商品列 ${g}`);
    assert.strictEqual(row[0], g, "第一欄=系統索引=原 gdid");
    assert.strictEqual(row[3], g, "建表時賣場編號初值=原 gdid");
    assert.strictEqual(row[1], EXPECT_POS[g], "模組位置標籤");
  });

  // 未曝光品不得出現
  assert.strictEqual(findBody(built.rows, "999999"), undefined);
});

// ── buildVendorRows：previewUrl 真值安全（F7-B 2026-07-29：未上線不出假連結）──
test("buildVendorRows：previewUrl 空值→資訊區落「活動尚未上線」指引文案（不出任何連結）；有值原樣帶出", () => {
  for (const empty of [null, undefined, ""]) {
    const built = buildVendorRows(makeDraft(), empty);
    const info = built.rows[1]; // 資訊區第 2 列＝預覽列
    assert.strictEqual(info[0], "活動頁預覽（demo）");
    assert.ok(String(info[1]).includes("活動尚未上線"), `previewUrl=${JSON.stringify(empty)} 需為上線指引文案`);
    assert.ok(String(info[1]).includes("我方會更新此欄"), "指引需標明行為者＝我方（讀者是外部廠商，不需自行操作）"); // 審查修：原文案「按『建立／更新廠商變更單』」主詞缺位——按鈕在內部 CMS、廠商按不到
    assert.ok(!/https?:\/\//.test(String(info[1])), "空值不得出現任何憑空組出的連結");
  }
  const withUrl = buildVendorRows(makeDraft(), "https://demo/preview");
  assert.strictEqual(withUrl.rows[1][1], "https://demo/preview", "有真值 URL 時原樣帶出");
});

// ── whereOf 定位 ──
test("whereOf：定位標籤／未曝光／null 安全", () => {
  const page = makeDraft().page;
  assert.strictEqual(whereOf(page, { gdid: "100001" }), "KV 主品 卡1");
  assert.strictEqual(whereOf(page, { gdid: "100002" }), "主打樓層1 卡1");
  assert.strictEqual(whereOf(page, { gdid: "999999" }), "（未曝光）");
  assert.strictEqual(whereOf(page, null), "（未曝光）");
  assert.strictEqual(whereOf(page, undefined), "（未曝光）");
});

// ── parseVendorEdits：未改動 ──
test("parseVendorEdits：未改動→ok、edits 空、unknown/missing 皆 0", () => {
  const built = buildVendorRows(makeDraft(), "https://demo");
  const res = parseVendorEdits(clone2d(built.rows), built.baseline);
  assert.strictEqual(res.ok, true);
  assert.deepStrictEqual(res.edits, []);
  assert.strictEqual(res.total, EXPECT_ORDER.length);
  assert.strictEqual(res.unknown, 0);
  assert.strictEqual(res.missing, 0);
});

// ── 真值安全：刪列 → missing++（以系統索引回錨，不靠列序）──
test("parseVendorEdits：廠商刪一列→missing++（回錨基準偵測遺漏）", () => {
  const built = buildVendorRows(makeDraft(), "https://demo");
  // 移除 100003 那一列（模擬廠商刪列）
  const rows = clone2d(built.rows).filter((r) => !(Array.isArray(r) && String(r[0]) === "100003"));
  const res = parseVendorEdits(rows, built.baseline);
  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.total, EXPECT_ORDER.length - 1);
  assert.strictEqual(res.unknown, 0);
  assert.strictEqual(res.missing, 1, "基準有、表上缺 ⇒ missing=1");
  assert.deepStrictEqual(res.edits, [], "純刪列不產生誤套 edit");
});

// ── 真值安全：改系統索引成不存在值 → unknown++（安全略過不誤套）──
test("parseVendorEdits：改系統索引成不存在值→unknown++（幽靈殘列安全略過）", () => {
  const built = buildVendorRows(makeDraft(), "https://demo");
  const rows = clone2d(built.rows);
  const row = findBody(rows, "100004");
  row[0] = "555555"; // 竄改系統索引為基準不存在的值
  // 同時把賣場編號也改成有效換品值，證明「索引不匹配時連 swap 都不採用」
  row[3] = "666666";
  const res = parseVendorEdits(rows, built.baseline);
  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.unknown, 1, "系統索引不在基準 ⇒ unknown=1");
  assert.strictEqual(res.missing, 1, "原 100004 基準列失去對應 ⇒ missing=1");
  // 該幽靈列不得產生任何 edit（避免把 555555/666666 誤套）
  assert.ok(!res.edits.some((e) => e.oldGdid === "555555" || e.swapGdid === "666666"));
});

// ── 真值安全：swapGdid 僅接受 6~10 位數字 ──
test("parseVendorEdits：swapGdid 僅接受 6~10 位數字，其餘一律不換品", () => {
  const built = buildVendorRows(makeDraft(), "https://demo");
  const baseline = built.baseline;

  const swapOf = (newVal) => {
    const rows = clone2d(built.rows);
    findBody(rows, "100001")[3] = newVal; // 只改賣場編號(第 3 欄)，不動系統索引(第 0 欄)
    const res = parseVendorEdits(rows, baseline);
    const e = res.edits.find((x) => x.oldGdid === "100001");
    return e ? e.swapGdid : undefined;
  };

  // 合法：6 與 10 位數字
  assert.strictEqual(swapOf("222222"), "222222", "6 位數字→接受");
  assert.strictEqual(swapOf("1234567890"), "1234567890", "10 位數字→接受");
  // 非法：5 位、11 位、含字母、含符號 ⇒ 不換品
  assert.strictEqual(swapOf("12345"), undefined, "5 位→拒絕");
  assert.strictEqual(swapOf("123456789012"), undefined, "12 位→拒絕");
  assert.strictEqual(swapOf("12ab56"), undefined, "含字母→拒絕");
  assert.strictEqual(swapOf("100 001"), undefined, "含空白→拒絕");
  // 與系統索引相同 ⇒ 非換品，不產生 swap
  assert.strictEqual(swapOf("100001"), undefined, "等於原索引→非換品");

  // 換品時 edit 應保留系統索引回錨得到的 oldGdid/oldName/pos，與 swapGdid 分離
  const rows = clone2d(built.rows);
  findBody(rows, "100001")[3] = "888888";
  const res = parseVendorEdits(rows, baseline);
  const e = res.edits.find((x) => x.oldGdid === "100001");
  assert.deepStrictEqual(e, { pos: "KV 主品 卡1", oldGdid: "100001", oldName: "商品A", swapGdid: "888888" });
});

// ── tag / note 差異擷取（含 oldTag）──
test("parseVendorEdits：tag/note 差異正確擷取（含 oldTag），未動欄不誤報", () => {
  const built = buildVendorRows(makeDraft(), "https://demo");
  const rows = clone2d(built.rows);
  const row = findBody(rows, "100002"); // baseline tag=限量
  row[7] = "新標籤文案"; // 標籤文案(第 7 欄)
  row[8] = "此品缺貨中"; // 廠商備註(第 8 欄)
  const res = parseVendorEdits(rows, built.baseline);

  assert.strictEqual(res.edits.length, 1);
  const e = res.edits[0];
  assert.strictEqual(e.pos, "主打樓層1 卡1");
  assert.strictEqual(e.oldGdid, "100002");
  assert.strictEqual(e.oldName, "商品B");
  assert.strictEqual(e.tag, "新標籤文案");
  assert.strictEqual(e.oldTag, "限量");
  assert.strictEqual(e.note, "此品缺貨中");
  assert.ok(!("swapGdid" in e), "未改賣場編號 ⇒ 無 swapGdid");

  // 原 tag 為空的商品(100003)保持空白 ⇒ 不應報 tag 差異
  const rows2 = clone2d(built.rows);
  findBody(rows2, "100003")[8] = "只加備註";
  const res2 = parseVendorEdits(rows2, built.baseline);
  const e2 = res2.edits.find((x) => x.oldGdid === "100003");
  assert.deepStrictEqual(e2, { pos: "主打樓層1 卡2", oldGdid: "100003", oldName: "商品C", note: "只加備註" });
  assert.ok(!("tag" in e2), "tag 空對空 ⇒ 不誤報差異");
});

// ── 真值安全：亂序（打亂列序）仍以系統索引正確歸屬 ──
test("parseVendorEdits：廠商打亂列序→回錨免疫（歸屬靠系統索引非列序）", () => {
  const built = buildVendorRows(makeDraft(), "https://demo");
  const rows = clone2d(built.rows);
  // 保留資訊+表頭(前 5 列)，將商品列反序
  const head = rows.slice(0, HEADER_ROWS);
  const body = rows.slice(HEADER_ROWS).reverse();
  // 在亂序後改「品類牆1 卡1」(100004)的標籤
  body.find((r) => String(r[0]) === "100004")[7] = "亂序後改標籤";
  const shuffled = [...head, ...body];

  const res = parseVendorEdits(shuffled, built.baseline);
  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.total, EXPECT_ORDER.length);
  assert.strictEqual(res.unknown, 0);
  assert.strictEqual(res.missing, 0, "列序改變不應誤判為刪列");
  assert.strictEqual(res.edits.length, 1);
  // 歸屬仍指向 baseline 中 100004 的正確位置，非亂序後的列位置
  assert.deepStrictEqual(res.edits[0], {
    pos: "品類牆1 卡1", oldGdid: "100004", oldName: "商品D",
    tag: "亂序後改標籤", oldTag: "推薦",
  });
});

// ── 舊版無系統索引欄 → ok:false 友善錯誤 ──
test("parseVendorEdits：舊版表(無系統索引表頭)→ok:false 友善錯誤", () => {
  const built = buildVendorRows(makeDraft(), "https://demo");
  // 模擬舊版：把表頭第一欄換成非「系統索引」起始（例如舊版以「模組位置」為首欄）
  const rows = clone2d(built.rows);
  const header = rows[HEADER_ROWS - 1];
  header[0] = "模組位置 🔒";
  const res = parseVendorEdits(rows, built.baseline);
  assert.strictEqual(res.ok, false);
  assert.deepStrictEqual(res.edits, []);
  assert.ok(typeof res.error === "string" && res.error.length > 0, "需附友善錯誤訊息");
  assert.ok(/舊版|系統索引|重建/.test(res.error));
});

// ── 缺 baseline（建表基準遺失）→ ok:false 友善錯誤 ──
test("parseVendorEdits：缺 baseline→ok:false 友善錯誤（提示重建）", () => {
  const built = buildVendorRows(makeDraft(), "https://demo");
  for (const bad of [null, undefined, "not-an-array", 123]) {
    const res = parseVendorEdits(clone2d(built.rows), bad);
    assert.strictEqual(res.ok, false, `baseline=${JSON.stringify(bad)} 應 ok:false`);
    assert.deepStrictEqual(res.edits, []);
    assert.ok(/重建|基準/.test(res.error));
  }
});
