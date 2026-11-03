/* 「說是 AI、其實是機械」禁詞絆線（2026-09-11 文案牆第 4 題甲案）。
   ------------------------------------------------------------------
   背景：CMS 有五組地方名字掛著 AI、實體卻是查表或排序，零 AI 呼叫——
     ①版式自動配（lib/layout_choice.js SCENARIO_LAYOUT_MAP 五筆固定對照）
     ②依主題自動配色（workbench/curate_auto.js HUE_KEYWORDS 關鍵字表）
     ③補一件折數最好的（workbench/server.js autoPickFromPool 池過濾＋折數排序）
     ④整頁區塊自動排（照商品數量的固定規則）＋首頁與列表的招呼句
     ⑤選引擎「之前」就顯示的兩句通用說明（活動定位欄說明、建立流程進度列第 2 節點）——
       這兩處原本寫 AI，但建立頁預設引擎是快速草稿（data-engine="auto"）＝預設路徑沒有 AI（2026-09-11 使用者裁）
   同事版上路後這些話在沒有 AI 的電腦上照樣成立，使用者會誤以為自己有 AI。
   2026-09-11 一次改齊，本絆線防它長回來。

   ⚠ 白名單（真的會叫 AI，名字必須留著，絆線不得誤傷）：
     「AI 智慧策展」（server.js:269 claude -p）與商品標籤自動撰寫（server.js:1961 claude -p --model haiku）。
     同事版沒有 AI 就跑不動這兩項，名字留著才知道哪些功能需要 AI 帳號。

   ⚠ 本絆線的極限，誠實寫明：它比對的是「這批改掉的那些確切講法」，
     擋得住原字回滲，擋不住全新發明的講法（例：「智慧幫你補一件」）。
     2026-09-11 病例＝第一輪掃描樣式太嚴，漏了「AI 挑選中…」「AI 已自動補」「AI 依商品量自動排出」三種寫法，
     複掃才補到——新增功能時仍要人看一眼「這句話在沒有 AI 的電腦上成不成立」。
     結構性那半＝test/unit/layout_choice.test.js 的顯示欄 BAN 正則（對實際回傳值掃，含 AI 二字）。 */
"use strict";
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..", "..");
const TARGETS = [
  ["workbench/public/index.html", "CMS 介面主檔"],
  ["workbench/server.js", "工作台伺服器（錯誤訊息與履歷）"],
  ["lib/content_modules.js", "模組庫（區塊加好時的說明句）"],
  ["lib/layout_choice.js", "版式選擇器（顯示欄）"],
];

/* 這批改掉的確切講法＝一個都不准回來。含註解一併管：
   註解留著舊 UI 字＝下一個人 grep 舊字會以為畫面還在這樣寫（2026-09-11 清過一輪，維持乾淨）。

   刻意不收的兩個短代號＝「AI 代選」與「AI 自動補」：它們是 kvVariant="ai" ／ body.auto 那兩條程式路的
   內部代號（資料值真的叫 "ai"，是永久欄位），只出現在註解與機器履歷、不上畫面，收進來只會逼人把
   正確的內部名稱改掉。這兩條路的「顯示層」由 test/unit/layout_choice.test.js 的 BAN 正則直接對
   reasonDisplay／engineNote／throw 白話段掃 AI 二字＝結構性守法，比字串比對嚴。 */
const BANNED = [
  "AI 自動補一件",
  "AI 挑選中",
  "AI 已自動補",
  "AI 自動配色",
  "AI 依商品量自動排出",
  "AI 幫你選",
  "AI 挑版面",
  "AI 沒辦法幫",
  "AI 把商品變成",
  "AI 會把商品變成",
  "AI 依商品自行決定",
  "交給 AI 判斷",
  "交給 AI 挑",
  "由 AI 判斷",
  "AI 用這一區挑商品",
  "AI 策展完成",
  "AI 挑商品、分樓層",
];

/* 例外＝機器履歷欄 reason（存 draft.meta 供追溯、不上畫面；2026-08-25 使用者裁決 reason／reasonDisplay 分工）。
   只放行「reason:」這一欄的行，reasonDisplay 不在此列。 */
const isMachineTrailLine = (line) => /^\s*(reason:|`AI 代選：)/.test(line) || /\breason:\s*`AI 代選：/.test(line);

test("CMS 顯示文案：五組不得自稱 AI（真 AI 白名單不受影響）", () => {
  const hits = [];
  for (const [rel, human] of TARGETS) {
    const abs = path.join(ROOT, rel);
    assert.ok(fs.existsSync(abs), `掃描目標不存在（檔案搬家了要同步改本測試）：${rel}`);
    const lines = fs.readFileSync(abs, "utf8").split("\n");
    lines.forEach((line, i) => {
      if (isMachineTrailLine(line)) return;
      for (const bad of BANNED) {
        if (line.includes(bad)) hits.push(`${rel}:${i + 1}（${human}）含「${bad}」→ ${line.trim().slice(0, 110)}`);
      }
    });
  }
  assert.deepStrictEqual(hits, [], `以下位置把機械功能講成 AI：\n${hits.join("\n")}`);
});

test("真 AI 白名單還在（絆線不得把需要 AI 帳號的功能名字一起洗掉）", () => {
  const ui = fs.readFileSync(path.join(ROOT, "workbench/public/index.html"), "utf8");
  assert.match(ui, /AI 智慧策展/, "「AI 智慧策展」是真的會叫 claude -p，名字要留著");
  assert.match(ui, /AI 會自動撰寫商品標籤/, "商品標籤自動撰寫是真的會叫 AI，名字要留著");
});

test("五組的新名字都在畫面上（改名有真的落地，不是只把舊字刪掉）", () => {
  const ui = fs.readFileSync(path.join(ROOT, "workbench/public/index.html"), "utf8");
  for (const want of [
    "照活動型態自動配", "依主題自動配色", "補一件折數最好的", "整頁區塊照商品數量自動排",
    "這一區決定挑哪些商品、文案怎麼寫", 'short: "策展"',
  ]) {
    assert.ok(ui.includes(want), `新文案沒出現在介面：「${want}」`);
  }
});

/* 真 AI 的進行狀態句要留著（絆線加了「AI 策展完成」之後，別把正在跑 AI 時該講的話一起洗掉）：
   這幾句只在 AI 引擎真的在跑時出現，講的是實況，不是對預設路徑的承諾。 */
test("AI 引擎真的在跑時的狀態句還在", () => {
  const ui = fs.readFileSync(path.join(ROOT, "workbench/public/index.html"), "utf8");
  for (const want of ["AI 策展中", "AI 策展進行中", "AI 策展逾時"]) {
    assert.ok(ui.includes(want), `真 AI 的實況句被誤刪：「${want}」`);
  }
});
