/* 「舊排程退場了就不准悄悄回來；新排程只准在開發機醒來」絆線（2026-09-14 舊管線退場批，69 號附錄 C）。
   ------------------------------------------------------------------
   源起：分散模型（同事各自裝 CMS、下載網頁檔手動上傳 AEM）下，08:30 活動巡檢與 09:30 價格巡檢守的都是
   「負責人這台的示範頁與分享站鏡像」，不是消費者看的那份。使用者裁：Q2 乙立刻關掉 08:30、Q4 甲停 09:30 排程。
   同日病例＝晨檢把兩天前的巡檢快照補推上線、線上 71 分鐘顯示過期價（經驗卡 20260914-stale-fix-is-not-truth）。

   守三件：
     ①兩條舊排程的程式路徑不得回到 server.js（RUN_PATROL_AFTER／spawn price_watch.sh／/api/patrol/* 端點）
     ②留下的每日引擎自我測試，setInterval 必須包在「開關檔存在」的判定裡——server.js 會整包給同事，
       沒包住＝同事電腦每天 09:30 叫醒 Chrome 跑測試（69 號 Phase 3 排除 .wb-*，開關檔天然不進包）
     ③到點只走 runDailySelftest 一條路，且只在判定塊內被呼叫
   從最外層斷言（讀原始碼字面），不單測 if——哪天有人把判定拆掉或把 spawn 加回來，這裡就紅。 */
"use strict";
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const SRC = fs.readFileSync(path.resolve(__dirname, "..", "..", "workbench", "server.js"), "utf8");

test("08:30 活動巡檢與 09:30 價格巡檢的排程路徑已從 server.js 移除", () => {
  assert.ok(!/RUN_PATROL_AFTER/.test(SRC), "RUN_PATROL_AFTER 回來了＝08:30 排程被重新掛上");
  assert.ok(!/price_watch\.sh"\]/.test(SRC), "server.js 又在 spawn price_watch.sh＝09:30 巡檢被重新掛上");
  assert.ok(!/seg\[1\] === "patrol"/.test(SRC), "/api/patrol/* 端點回來了（run 手動觸發或首頁巡檢摘要）");
  assert.ok(!/function patrolSummary\(/.test(SRC), "patrolSummary 回來了＝首頁會再長出「今天還沒巡檢」的假狀態");
});

test("每日引擎自我測試只在開關檔存在時掛排程（同事機零排程）", () => {
  assert.ok(SRC.includes('".wb-dev-schedules"'), "找不到開關檔常數 .wb-dev-schedules");
  /* 2026-09-15 B 批：判定多一層「編修模式一律不掛」——同事機就算誤帶了開關檔也不會有排程醒來（69 號 Phase 1） */
  const guard = 'if (MODE !== "editor" && fs.existsSync(DEV_SCHEDULES_FILE)) {';
  const gi = SRC.indexOf(guard);
  assert.ok(gi > 0, '找不到開關檔判定 if (MODE !== "editor" && fs.existsSync(DEV_SCHEDULES_FILE))——排程要同時看模式旗標與開關檔');
  const ge = SRC.indexOf("\n} else {", gi);
  assert.ok(ge > gi, "開關檔判定沒有 else 分支（未掛載時要在 console 講明，不能靜默）");
  const block = SRC.slice(gi, ge);
  assert.ok(block.includes("setInterval("), "自我測試的 setInterval 沒包在開關檔判定裡");
  assert.ok(block.includes("runDailySelftest(today, hhmm)"), "判定塊內沒有呼叫 runDailySelftest");
  const calls = SRC.split("runDailySelftest(today, hhmm);").length - 1; // 帶分號＝呼叫式；函式定義那行是 `) {` 不算
  assert.strictEqual(calls, 1, `runDailySelftest 被呼叫 ${calls} 次（預期只在判定塊內 1 次）`);
  // 判定塊之外不得再有任何 SELFTEST_AFTER 到點比對（防第二條沒包住的排程）
  const outside = SRC.slice(0, gi) + SRC.slice(ge);
  assert.ok(!/hhmm < SELFTEST_AFTER/.test(outside), "判定塊之外還有一條自我測試到點比對＝沒包住的排程");
});

test("自我測試失敗要出聲（console.error＋桌面通知），不得靜默", () => {
  const fi = SRC.indexOf("function runDailySelftest(");
  assert.ok(fi > 0);
  const fn = SRC.slice(fi, SRC.indexOf("\nif (fs.existsSync(DEV_SCHEDULES_FILE))", fi));
  assert.ok(/console\.error\(`\[selftest-daily\] 失敗/.test(fn), "exit≠0 沒有 console.error");
  assert.ok(/notifyMac\(`每日自我測試失敗/.test(fn), "exit≠0 沒有桌面通知");
  assert.ok(/child\.on\("error"/.test(fn), "spawn 起不來沒有處理（會變成靜默不跑）");
});
