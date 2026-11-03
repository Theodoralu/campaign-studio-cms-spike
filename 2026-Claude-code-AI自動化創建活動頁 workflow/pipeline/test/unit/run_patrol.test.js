"use strict";
/**
 * run_patrol.js 單元測試（零新相依，僅 node:test；不觸網）
 *
 * 迴歸鎖（2026-07-28 run-patrol／activity-lifecycle story）：
 *   - 生命週期語意：兩端含當日、空值＝長青照巡、ended 停巡；收檔通知一次性（closedNoticeAt）。
 *   - summarizeCheck：needsAction 不含 unverified（誠實但不催人）；snapDrift/snapMissing 計入 drift 類。
 *   - 表列建構：價格逐字自報告（真值鐵律＝不得改寫）；總覽首列心跳摘要契約（Apps Script 依位置讀）。
 */
const { test } = require("node:test");
const assert = require("node:assert");
const rp = require("../../run_patrol.js");

test("lifecycleState：空值＝長青；兩端含當日；前後界外", () => {
  assert.strictEqual(rp.lifecycleState(null, "2026-07-28"), "evergreen");
  assert.strictEqual(rp.lifecycleState({}, "2026-07-28"), "evergreen");
  const lc = { activeFrom: "2026-07-10", activeUntil: "2026-07-28" };
  assert.strictEqual(rp.lifecycleState(lc, "2026-07-10"), "active", "上線日當天含");
  assert.strictEqual(rp.lifecycleState(lc, "2026-07-28"), "active", "失效日當天含");
  assert.strictEqual(rp.lifecycleState(lc, "2026-07-29"), "ended");
  assert.strictEqual(rp.lifecycleState(lc, "2026-07-09"), "upcoming");
  assert.strictEqual(rp.lifecycleState({ activeUntil: "2026-07-27" }, "2026-07-28"), "ended", "只設失效日");
  assert.strictEqual(rp.lifecycleState({ activeFrom: "bad-date" }, "2026-07-28"), "evergreen", "非法格式＝忽略該端");
  assert.ok(rp.shouldPatrol(null, "2026-07-28") && rp.shouldPatrol(lc, "2026-07-28") && !rp.shouldPatrol(lc, "2026-07-29"));
});

test("needsClosedNotice：ended 且未通知過＝true；記過 closedNoticeAt＝false（一次性）", () => {
  assert.strictEqual(rp.needsClosedNotice({ activeUntil: "2026-07-27" }, "2026-07-28"), true);
  assert.strictEqual(rp.needsClosedNotice({ activeUntil: "2026-07-27", closedNoticeAt: "2026-07-28" }, "2026-07-29"), false);
  assert.strictEqual(rp.needsClosedNotice({ activeUntil: "2026-07-30" }, "2026-07-28"), false, "還沒到期");
});

const REPORT = {
  checkedAt: "2026-07-28T00:30:00.000Z",
  results: [
    { gdid: "1", name: "正常品", status: "online", drift: false },
    { gdid: "2", name: "變價品", status: "online", drift: true, draftPrice: "$695", livePrice: "$591", where: "樓層1 卡1" },
    { gdid: "3", name: "原價漂移品", status: "online", drift: true, marketDrift: true, draftPrice: "$100", livePrice: "$100", draftMarketPrice: "$150", liveMarketPrice: null, where: "KV 主品 #1" },
    { gdid: "4", name: "池落後品", status: "online", drift: false, snapDrift: true, where: "品類牆1 卡2" },
    { gdid: "5", name: "暫下架品", status: "offline", where: "樓層2 卡3" },
    { gdid: "6", name: "售罄品", status: "dead", where: "樓層2 卡4" },
    { gdid: "7", name: "擋掉品", status: "unverified", where: "樓層3 卡1" },
  ],
  links: [
    { where: "延伸探索 #1", url: "https://tw.buy.yahoo.com/activity/x", status: "expired" },
    { where: "本期活動 #2", url: "https://tw.buy.yahoo.com/activity/y", status: "online", imgStatus: "dead" },
    { where: "圓卡 #1", url: "https://tw.buy.yahoo.com/gdsale/z", status: "online", imgStatus: "ok" },
    { where: "看更多", url: "https://tw.buy.yahoo.com/search/product?p=x", status: "dead", imgStatus: "dead" }, // 雙壞同列＝計 1（07-28 review #5）
    { where: "圓卡 #2", url: "https://tw.buy.yahoo.com/gdsale/w", status: "unverified" }, // 連結 unverified 不隱形（#10）
  ],
};

test("summarizeCheck：口徑對齊既有系統（每列最多 1、變價/待同步分桶、unverified 含連結）", () => {
  const c = rp.summarizeCheck(REPORT);
  assert.deepStrictEqual(
    { products: c.products, drift: c.drift, snap: c.snap, offline: c.offline, dead: c.dead, unverified: c.unverified, linksBad: c.linksBad, imgDead: c.imgDead },
    { products: 7, drift: 2, snap: 1, offline: 1, dead: 1, unverified: 2, linksBad: 3, imgDead: 2 },
    "drift＝真變價；snap＝純待同步；status 壞＋圖壞同列計 1；unverified＝商品+連結");
  assert.strictEqual(c.needsAction, 2 + 1 + 1 + 1 + 3, "needsAction＝變價+待同步+下架+失效+連結（每列 1），不含 unverified");
  assert.strictEqual(rp.summarizeCheck(null).products, 0, "無報告＝零統計不炸");
});

function entryOf(state, extra = {}) {
  return rp.runEntry({ id: "r1", pageName: "盛夏測試", meta: { input: { ownerEmail: "o@x.com", ownerDept: "EC" }, liveUrl: "https://x/y", lifecycle: { activeUntil: "2026-08-01" } }, state, counts: rp.summarizeCheck(REPORT), checkedAt: REPORT.checkedAt, ...extra });
}

test("buildOverviewRows：首列心跳契約（含 FrameTest 欄）＋列值逐字＋欄序＝.gs 讀表契約", () => {
  const summary = { date: "2026-07-28", finishedAt: "t-fin", frametestLastRun: "2026-07-27", runs: [entryOf("active"), rp.runEntry({ id: "r2", pageName: "已收檔", meta: {}, state: "ended", endedToday: true })] };
  const rows = rp.buildOverviewRows(summary);
  assert.deepStrictEqual(rows[0], ["巡檢日期", "2026-07-28", "巡檢中", "1", "已結束", "1", "異常檔數", "1", "完成時間", "t-fin", "FrameTest巡檢", "2026-07-27"], "心跳摘要位置契約（overview-mail.gs 依 index 讀）");
  const isoRows = rp.buildOverviewRows({ ...summary, finishedAt: "2026-07-29T00:31:45.049Z" });
  assert.strictEqual(isoRows[0][9], "08:31", "完成時間 ISO → 台北 HH:mm 顯示（07-29；非時間字串照舊）");
  assert.strictEqual(rows[1][9], "待同步", "欄 9＝待同步（.gs r[9]）");
  assert.strictEqual(rows[1][15], "CMS 入口", "欄 15（.gs r[15]）");
  const r1 = rows[2];
  assert.strictEqual(r1[7], "⚠ 需處理 8 件");
  assert.strictEqual(r1[3], "o@x.com");
  assert.strictEqual(r1[8], "2", "變價欄＝純變價（不含待同步）");
  assert.strictEqual(r1[9], "1", "待同步欄獨立");
  const r2 = rows[3];
  assert.strictEqual(r2[7], "🏁 已結束");
  assert.strictEqual(r2[14], "收檔", "今日事件欄（資訊用；收檔信實際由 .gs 依狀態＋closed-<id> 去重觸發）");
});

test("buildDetailRows：價格逐字（真值鐵律）＋類型/動作指引＋雙壞同列一列", () => {
  const summary = { date: "2026-07-28", runs: [entryOf("active")] };
  const rows = rp.buildDetailRows(summary, { r1: REPORT });
  const types = rows.slice(1).map((r) => r[4]);
  assert.ok(types.includes("變價") && types.includes("下架（暫時）") && types.includes("下架（售罄/移除）") && types.includes("資料待同步") && types.includes("無法驗證") && types.includes("入口/連結"));
  const drift = rows.find((r) => r[7] === "2");
  assert.strictEqual(drift[8], "$695 → $591", "變化欄逐字取報告 draftPrice/livePrice");
  const market = rows.find((r) => r[7] === "3");
  assert.ok(market[8].includes("原價 $150 → 移除"), "原價漂移逐字：" + market[8]);
  const dualBad = rows.filter((r) => r[5] === "看更多");
  assert.strictEqual(dualBad.length, 1, "status 壞＋圖壞同列＝明細一列（與 needsAction 計 1 一致）");
  assert.strictEqual(dualBad[0][8], "連結失效", "status 壞優先於圖片失效標示");
  const linkUv = rows.filter((r) => r[4] === "無法驗證" && r[5] === "圓卡 #2");
  assert.strictEqual(linkUv.length, 1, "連結 unverified 出明細＝不隱形");
  const ended = rp.buildDetailRows({ date: "2026-07-28", runs: [entryOf("ended")] }, { r1: REPORT });
  assert.strictEqual(ended.length, 1, "已結束活動不出明細（只剩表頭）");
});
