"use strict";
/**
 * tools/overview-mail.gs 單元測試（零新相依，僅 node:test＋vm；不觸網）
 *
 * 迴歸鎖（2026-07-29 送達性事故兩修訂，見 .gs 檔頭）：
 *   - 零外部連結機械強制：send() 出口消毒——非 docs.google.com 連結與 /Users/ 路徑一律遮蔽（⛔ 信原文
 *     轉貼伺服器錯誤訊息＝URL 回歸孔；Yahoo 閘道對外部 Gmail＋非 Google 連結信「靜默隔離」實證）。
 *   - 單封日報架構（使用者裁決）：未登記負責人的異常活動彙整為一封「異常日報」；已登記者照舊單發；
 *     心跳信每天必寄且保持極簡（死人開關）。常態＝每日 2 封。
 *   - 冪等不回歸：sent-<date> 完整寄畢才寫；warn-<date> 不擋補跑；closed-<id> 寄成才寫、終身去重。
 *
 * 執行方式：GAS 無法 require——以 vm 沙箱注入 SpreadsheetApp/MailApp/Utilities/PropertiesService stub
 * 後 eval 全檔，讓測試環境貼近 Apps Script（ES5、全域函式）。
 */
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const GS_PATH = path.join(__dirname, "..", "..", "tools", "overview-mail.gs");
const TODAY = "2026-07-29";
const SHEET_URL = "https://docs.google.com/spreadsheets/d/TEST-SHEET-ID/edit";

/** 建 stub 環境並載入 .gs；回傳 { run, sent, props } */
function loadGs(opts) {
  const o = opts || {};
  const sent = []; // 每筆＝{to, cc, subject, body}（3 參數字串形式正規化為物件）
  const props = Object.assign({}, o.props || {});
  const overview = o.overview || [];
  const sandbox = {
    SpreadsheetApp: {
      getActiveSpreadsheet: () => ({
        getSheetByName: (name) => {
          if (name === "總覽") return { getDataRange: () => ({ getValues: () => overview }) };
          throw new Error("07-29 起 .gs 不應再讀「" + name + "」分頁");
        },
        getUrl: () => SHEET_URL,
      }),
    },
    MailApp: {
      sendEmail: function (a, b, c) {
        const m = typeof a === "object" ? a : { to: a, subject: b, body: c };
        if (o.failSubject && m.subject.includes(o.failSubject)) throw new Error("Service invoked too many times for one day: email");
        sent.push(m);
      },
    },
    LockService: {
      getScriptLock: () => ({ tryLock: () => !o.lockBusy, releaseLock: () => {} }),
    },
    Utilities: {
      formatDate: (d, tz, fmt) => {
        assert.strictEqual(tz, "Asia/Taipei");
        // 測試以固定「今日」運行：+8 時區換算後取日期
        return new Date(d.getTime() + 8 * 3600e3).toISOString().slice(0, 10);
      },
    },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (k) => (k in props ? props[k] : null),
        setProperty: (k, v) => { props[k] = String(v); },
      }),
    },
    Date: makeFixedDate(o.now || TODAY + "T02:00:00Z"), // 台北 10:00
  };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(GS_PATH, "utf8"), sandbox, { filename: "overview-mail.gs" });
  return { run: () => vm.runInContext("dailyMail()", sandbox), sent, props };
}

/** 凍結時間的 Date（GAS 端用 new Date()/Date.now()） */
function makeFixedDate(iso) {
  const fixed = new Date(iso).getTime();
  function FixedDate(...args) { return args.length ? new Date(...args) : new Date(fixed); }
  FixedDate.now = () => fixed;
  FixedDate.prototype = Date.prototype;
  return FixedDate;
}

/** 總覽表 fixture：列1 心跳 meta、列2 表頭、列3 起資料 */
function sheet(metaOverride, rows) {
  const meta = Object.assign(
    ["巡檢日期", TODAY, "巡檢中", "4", "已結束", "0", "異常檔數", "2", "完成時間", "t-fin", "FrameTest巡檢", "2026-07-28"],
    metaOverride || []
  );
  return [meta, ["日期", "活動ID", "活動名", "負責人", "部門", "營運迄日", "商品數", "狀態", "變價", "待同步", "下架/失效", "連結異常", "無法驗證", "最後巡檢", "今日事件", "CMS 入口", "內部確認頁"]].concat(rows || []);
}

function row(over) {
  return Object.assign(
    [TODAY, "run-id-1", "活動甲", "", "", "", "27", "✅ 正常", "0", "0", "0", "0", "0", "10:00", "", "https://cms.example/x", "https://page.example/y"],
    over || []
  );
}

test("單封日報：未登記負責人的異常活動彙整一封＋心跳＝共 2 封；日報含各檔名與統計", () => {
  const env = loadGs({
    overview: sheet(null, [
      row({ 1: "run-a", 2: "活動甲", 7: "⚠ 需處理 27 件", 8: "27" }),
      row({ 1: "run-b", 2: "活動乙", 7: "⚠ 需處理 3 件", 8: "1", 11: "2" }),
      row({ 1: "run-c", 2: "活動丙", 7: "✅ 正常" }),
    ]),
  });
  env.run();
  assert.strictEqual(env.sent.length, 2, "日報 1＋心跳 1");
  const digest = env.sent[0];
  assert.match(digest.subject, /異常日報｜2026-07-29：2 檔需處理/);
  assert.match(digest.body, /活動甲/);
  assert.match(digest.body, /活動乙/);
  assert.match(digest.body, /變價 27/);
  assert.doesNotMatch(digest.body, /活動丙/, "正常檔不入日報");
  assert.match(digest.body, /docs\.google\.com/, "唯一連結＝總覽表");
  const hb = env.sent[1];
  assert.match(hb.subject, /每日心跳/);
  assert.match(hb.body, /0 檔已單發負責人.*2 檔未登記負責人＝彙整於異常日報/);
  assert.strictEqual(env.props["sent-" + TODAY], "ok:2", "完整寄畢才寫＝alertRuns 2");
});

test("已登記負責人＝單發該負責人＋操作者副本；未登記者仍走日報", () => {
  const env = loadGs({
    overview: sheet(null, [
      row({ 1: "run-a", 2: "活動甲", 3: "owner@yahootwec.com", 7: "⚠ 需處理 5 件" }),
      row({ 1: "run-b", 2: "活動乙", 7: "⚠ 需處理 3 件" }),
    ]),
  });
  env.run();
  assert.strictEqual(env.sent.length, 3, "單發 1＋日報 1＋心跳 1");
  const solo = env.sent[0];
  assert.strictEqual(solo.to, "owner@yahootwec.com");
  assert.strictEqual(solo.cc, "tofu@yahootwec.com");
  assert.match(solo.body, /活動甲/);
  assert.match(env.sent[2].body, /1 檔已單發負責人.*1 檔未登記負責人/);
});

test("零外部連結機械強制：⛔ 信體的伺服器錯誤訊息＝URL 與本機路徑被遮蔽；docs.google.com 放行", () => {
  const env = loadGs({
    overview: sheet(null, [
      row({ 1: "run-a", 2: "活動甲", 7: "⛔ 巡檢失敗", 14: "巡檢異常：HTTP 503 for https://tw.buy.yahoo.com/gdsale/x.html（ENOENT /Users/tofu/x/draft.json）" }), // secret-scan: allow 測試資料：驗出口會遮蔽 /Users/ 路徑
    ]),
  });
  env.run();
  const digest = env.sent[0];
  assert.doesNotMatch(digest.body, /tw\.buy\.yahoo\.com/, "外部 URL 必遮");
  assert.doesNotMatch(digest.body, /\/Users\/tofu/, "本機路徑必遮（資訊外露）");
  assert.match(digest.body, /（連結略，見伺服器紀錄）/);
  assert.match(digest.body, /docs\.google\.com\/spreadsheets/, "總覽表連結放行");
});

test("冪等：sent-<date> 已存在＝整日不重寄；warn 不擋補跑", () => {
  const rows = [row({ 7: "⚠ 需處理 1 件" })];
  const already = loadGs({ overview: sheet(null, rows), props: { ["sent-" + TODAY]: "ok:1" } });
  already.run();
  assert.strictEqual(already.sent.length, 0, "當日已寄＝跳過");

  // 巡檢未更新（表日期＝昨日）：寄一封警告＋寫 warn；warn 存在後再跑不重寄，但不寫 sent-（補跑資格保留）
  const stale = loadGs({ overview: sheet([, "2026-07-28"], rows) });
  stale.run();
  assert.strictEqual(stale.sent.length, 1);
  assert.match(stale.sent[0].subject, /今日巡檢未更新/);
  assert.strictEqual(stale.props["warn-" + TODAY], "1");
  assert.strictEqual(stale.props["sent-" + TODAY], undefined, "警告不消耗當日寄信資格");
  stale.run();
  assert.strictEqual(stale.sent.length, 1, "warn 已寫＝不重複警告");
});

test("收檔信：🏁＋closed-<id> 終身去重；寄成才寫標記", () => {
  const rows = [row({ 1: "run-end", 2: "活動甲", 5: "2026-07-28", 7: "🏁 已結束" })];
  const env = loadGs({ overview: sheet(null, rows) });
  env.run();
  const closed = env.sent.filter((m) => /已到期收檔/.test(m.subject));
  assert.strictEqual(closed.length, 1);
  assert.doesNotMatch(closed[0].body, /https?:\/\/(?!docs\.google\.com)/, "收檔信信體零外部連結");
  assert.strictEqual(env.props["closed-run-end"], TODAY);

  const again = loadGs({ overview: sheet(null, rows), props: { "closed-run-end": TODAY, ["sent-" + TODAY]: undefined } });
  delete again.props["sent-" + TODAY];
  again.run();
  assert.strictEqual(again.sent.filter((m) => /已到期收檔/.test(m.subject)).length, 0, "一 run 一生只寄一次");
});

test("心跳寄失敗＝不寫 sent-（當日不鎖死，手動補跑可整日重寄）；寄成才寫", () => {
  const rows = [row({ 7: "⚠ 需處理 1 件" })];
  const env = loadGs({ overview: sheet(null, rows), failSubject: "每日心跳" });
  env.run();
  assert.strictEqual(env.props["sent-" + TODAY], undefined, "心跳失敗＝不鎖日");
  assert.strictEqual(env.sent.length, 1, "日報仍寄出（各自 try/catch）");
});

test("消毒補強：裸網域（ENOTFOUND）與裸 IP 也遮蔽；docs.google.com 裸寫放行", () => {
  const env = loadGs({
    overview: sheet(null, [
      row({ 7: "⛔ 巡檢失敗", 14: "getaddrinfo ENOTFOUND tw.buy.yahoo.com；connect ETIMEDOUT 34.102.1.9:443" }),
    ]),
  });
  env.run();
  const digest = env.sent[0];
  assert.doesNotMatch(digest.body, /tw\.buy\.yahoo\.com/, "裸網域必遮");
  assert.doesNotMatch(digest.body, /34\.102\.1\.9/, "裸 IP 必遮");
  assert.match(digest.body, /docs\.google\.com\/spreadsheets/, "總覽表連結仍放行");
});

test("併行防護：拿不到鎖＝直接讓路，一封不寄、不動任何標記", () => {
  const env = loadGs({ overview: sheet(null, [row({ 7: "⚠ 需處理 1 件" })]), lockBusy: true });
  env.run();
  assert.strictEqual(env.sent.length, 0);
  assert.deepStrictEqual(env.props, {});
});

test("心跳信：乾淨日一樣寄（沒收到＝故障訊號）；FrameTest 早於昨日＝點名排查", () => {
  const clean = loadGs({ overview: sheet([, , , "2", , "0", , "0"], [row(), row({ 1: "run-b" })]) });
  clean.run();
  assert.strictEqual(clean.sent.length, 1, "全綠仍寄心跳");
  assert.match(clean.sent[0].subject, /✅/);
  assert.match(clean.sent[0].body, /全部正常，無需動作/);

  const staleFt = loadGs({ overview: sheet([, , , , , , , , , , , "2026-07-20"], [row()]) });
  staleFt.run();
  assert.match(staleFt.sent[0].body, /巡檢鏈可能死了，請排查/);
});
