/* AEM 網頁檔：製作四態進任務條＋「製作／下載」一個動作一個名字（2026-09-11 使用者裁第 5 題甲、第 6 題乙）
   ------------------------------------------------------------------
   源起（使用者四張截圖）：核可後那顆亮著的鈕寫「下載 AEM 網頁檔」，按下去其實是「開始做一份」（約 1～3 分鐘）；
   做的過程中任務條句子與主鈕完全不變、進度只在標題旁的小徽章，再按一次只回一則兩秒提示＝「按了像系統壞掉」；
   做好之後對話框的主鈕又是「重新匯出」，真正要拿的檔卻縮成一行說明文字。

   根因不是設計取向，是那支狀態機（taskState）漏了一個分支：發佈有「發佈中」一態，製作沒有對等的一態。

   守四件：
     ①製作中要有自己的一態，且排在「發佈中」之後、「未儲存」之前（製作中伺服器擋內容寫入，人不該同時改稿）
     ②做好且還是最新＝主鈕直接下載（不再開一次對話框問人要不要）
     ③新舊判定只有一把尺＝檔案做好的時間 vs 核可時間（改內容→核可失效→製作要求已核可＝重新核可必晚於舊檔）；
       這條鏈任一環被拆掉，「過期」就會判錯，所以連伺服器那道「沒核可不准製作」的守門一起釘
     ④使用者眼前不再出現「匯出」講這件事（ZIP 那套 09-10 已退場、只剩無入口的死碼，整併批拆掉時這裡的豁免要一起拿掉）
   跟 ui_delivery_copy.test.js 的分工：那支守「核可／發佈」那條鏈的字，這支守 AEM 這條鏈的態與字。 */
"use strict";
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const UI = fs.readFileSync(path.resolve(__dirname, "..", "..", "workbench", "public", "index.html"), "utf8");
const SERVER = fs.readFileSync(path.resolve(__dirname, "..", "..", "workbench", "server.js"), "utf8");

/* ZIP 死碼區＝2026-09-10 使用者裁退場、無入口按不到，函式與路由留一個觀察期不刪（見選單註解）。
   掃「匯出」時先把這兩段切掉——這是豁免不是赦免：下次整併批把死碼拆了，這個 cut 也要一起刪。 */
function cutZipDeadCode(src, startMark, endMark){
  const a = src.indexOf(startMark), b = src.indexOf(endMark);
  assert.ok(a > 0 && b > a, `找不到 ZIP 死碼區的界標（${startMark.slice(0, 24)}…）——界標變了就更新這裡，別拿掉掃描`);
  return src.slice(0, a) + src.slice(b);
}

test("①製作中自成一態，排在發佈中之後、未儲存之前", () => {
  const fn = (UI.match(/function taskState\(meta, isDirty[\s\S]*?\n\}/) || [])[0] || "";
  assert.ok(fn, "找不到 taskState");
  const iDeploying = fn.indexOf('key: "deploying"');
  const iExporting = fn.indexOf('key: "exporting"');
  const iDirty = fn.indexOf('key: "dirty"');
  assert.ok(iExporting > 0, "taskState 沒有『製作中』那一態＝製作進行中任務條不會變＝使用者會以為壞掉");
  assert.ok(iDeploying < iExporting && iExporting < iDirty, "優先序錯了：製作中要排在發佈中之後、未儲存之前");
  const seg = fn.slice(iExporting, iExporting + 400);
  assert.match(seg, /disabled: true/, "製作中的主鈕要不能按（照「發佈中」那一態）");
  assert.match(seg, /AEM_CHIP\[ex\.stage\]/, "製作中的句子要講到第幾步——進度不能只留在標題旁的小徽章");
});

test("②做好且最新＝主鈕直接下載；過期／沒做過＝主鈕是製作", () => {
  const fn = (UI.match(/function taskState\(meta, isDirty[\s\S]*?\n\}/) || [])[0] || "";
  const done = fn.match(/key: "exported",[\s\S]*?btnLabel: "([^"]+)", topLabel: "([^"]+)", action: (\w+)/);
  assert.ok(done, "找不到『做好且最新』那一態（key: exported）");
  assert.strictEqual(done[1], "下載 AEM 網頁檔");
  assert.strictEqual(done[3], "downloadAemFile", "做好之後主鈕要直接下載——再開一次對話框＝把人要的檔埋在第二層");
  const stale = fn.match(/key: "export-stale",[\s\S]*?btnLabel: "([^"]+)", topLabel: "([^"]+)", action: (\w+)/);
  assert.ok(stale, "找不到『做好但過期』那一態（key: export-stale）");
  assert.strictEqual(stale[1], "製作 AEM 網頁檔");
  assert.strictEqual(stale[3], "exportAemUi");
  const err = fn.match(/key: "export-error",[\s\S]*?btnLabel: "([^"]+)"/);
  assert.ok(err, "找不到『製作失敗』那一態（key: export-error）——失敗要出聲");
  assert.strictEqual(err[1], "看原因並重試");
  /* 直接下載不能用導頁：檔案不在時伺服器回的是 JSON，location.href 會把整個工作台換成一頁 JSON */
  const dl = (UI.match(/async function downloadAemFile\(\)\{[\s\S]*?\n\}/) || [])[0] || "";
  assert.ok(dl, "找不到 downloadAemFile");
  assert.doesNotMatch(dl, /location\.href/, "用導頁下載＝檔案不在時整頁變成 JSON");
  assert.match(dl, /if \(!r\.ok\)[\s\S]*toast\(/, "拿不到檔要講出來（失敗要出聲）");
});

test("③新舊判定只有一把尺，且三個消費端都問同一把", () => {
  const fresh = (UI.match(/function aemFresh\(ex, appr\)\{[\s\S]*?\n\}/) || [])[0] || "";
  assert.ok(fresh, "找不到 aemFresh");
  assert.match(fresh, /ex\.finishedAt/, "判定要看檔案做好的時間");
  assert.match(fresh, /Date\.parse\(appr\)|a = Date\.parse\(appr\)/, "判定要看核可時間");
  /* 同類幾處：任務條做好態、任務條過期態、發佈失敗態的次要出路——三處都得問 aemFresh／aemAct，不准自己抄一份時間比較 */
  const fn = (UI.match(/function taskState\(meta, isDirty[\s\S]*?\n\}/) || [])[0] || "";
  assert.match(fn, /key: "exported"[\s\S]*aemFresh\(ex, appr\)|aemFresh\(ex, appr\)[\s\S]*key: "exported"/, "做好態沒問 aemFresh");
  assert.match(fn, /secondary: aemAct\(ex, appr\)/, "發佈失敗態的 AEM 出路沒問 aemAct＝它會永遠寫同一個名字");
  const cmp = fn.match(/finishedAt[\s\S]{0,80}?(>=|>)[\s\S]{0,40}?approvedAt/);
  assert.ok(!cmp, "taskState 裡又出現一份自己寫的時間比較——判定要收在 aemFresh 一處");
});

test("③-2 伺服器端「沒核可不准製作」這道守門還在（過期判定靠它才成立）", () => {
  const route = SERVER.slice(SERVER.indexOf('seg[3] === "export-aem"'), SERVER.indexOf('seg[3] === "export.aem.html"'));
  assert.ok(route.length > 100, "找不到 export-aem 路由");
  assert.match(route, /if \(!meta0\.approvedAt\) return sendJson\(res, 409/, "少了『先核可才能製作』的守門＝『重新核可必晚於舊檔』這條鏈斷了，過期會判錯");
  assert.match(route, /製作/, "409 的句子要用畫面上的名字（製作），不要留舊的「匯出」");
});

test("④使用者眼前不再用「匯出」講 AEM 這件事", () => {
  const ui = cutZipDeadCode(UI, "/* ---------- ZIP 匯出（2026-07-25 五題裁決）", "/* ---------- AEM 網頁檔製作（69 號 Phase 2")
    .replace(/<!--[\s\S]*?-->/g, (m) => m.replace(/[^\n]/g, "")); // HTML 註解不是使用者眼前的字（只清內容、保留行數，報告行號才對得上）——2026-09-14 更新頻次退場註解寫到「匯出」首次絆到
  const hits = [];
  ui.split("\n").forEach((l, i) => {
    if (!l.includes("匯出")) return;
    if (/試算表|工作簿|exportZip|ZIP/.test(l)) return; // Excel 匯出是另一個動作、名字沒變；ZIP 註解同理
    hits.push(`index.html ${i + 1}: ${l.trim().slice(0, 100)}`);
  });
  const sv = cutZipDeadCode(SERVER, "/* ---------- ZIP 匯出（2026-07-25 使用者五題裁決）", "/* ---------- AEM 網頁檔製作（69 號 Phase 2");
  const sv2 = cutZipDeadCode(sv, '      /* ZIP 匯出（2026-07-25 五題裁決）：POST 啟動背景管線；GET 下載成品 */', '      /* AEM 網頁檔製作（69 號 Phase 2）');
  sv2.split("\n").forEach((l, i) => {
    if (!l.includes("匯出")) return;
    if (/試算表|工作簿|exportZip|ZIP/.test(l)) return;
    if (!/error: "|error: `|_MSG = |KEY_ZH|note: "|appendLog/.test(l)) return; // 只掃會送到使用者眼前的（含 run 紀錄）
    hits.push(`server.js ${i + 1}: ${l.trim().slice(0, 100)}`);
  });
  assert.deepStrictEqual(hits, [], "\n" + hits.join("\n"));
});

test("④-2 動作名成雙成對出現：選單是製作、任務條做好才是下載", () => {
  assert.match(UI, /製作 AEM 網頁檔（單一 HTML）/, "設定選單那項要叫「製作」——拿檔的主動線在任務條");
  assert.doesNotMatch(UI, /下載 AEM 網頁檔（單一 HTML）/, "選單留著舊的「下載」＝同一個畫面兩個入口說同一個字");
  assert.match(UI, /dlg\("製作 AEM 網頁檔"/, "對話框標題要跟它做的事同名");
  assert.doesNotMatch(UI, /↻ 重新匯出[\s\S]{0,400}export-aem/, "AEM 對話框還留著「重新匯出」");
});

test("⑤未儲存態：任務條那顆是指路牌、降次要（第 7 題甲）", () => {
  const fn = (UI.match(/function taskState\(meta, isDirty[\s\S]*?\n\}/) || [])[0] || "";
  const d = fn.match(/key: "dirty",[\s\S]*?action: \(\) =>/);
  assert.ok(d, "找不到未儲存那一態");
  assert.match(d[0], /tier2: true/, "未儲存態眼前有兩顆主色（任務條「去儲存」＋儲存列「儲存」）——指路牌要降次要");
  const tb = (UI.match(/tb\.innerHTML = rail \+ [\s\S]{0,400}?;/) || [])[0] || "";
  assert.match(tb, /st\.tier2 \? "ghost" : "primary"/, "任務條主鈕沒吃 tier2＝降級標記寫了也沒用");
});

test("⑥檢查面板：同一個動作只畫一次（第 2 題甲）", () => {
  const fn = (UI.match(/function checkPanelHtml\(\)\{[\s\S]*?\n\}/) || [])[0] || "";
  assert.ok(fn, "找不到 checkPanelHtml");
  const stale = fn.slice(fn.indexOf("let staleHtml"), fn.indexOf("let head, body"));
  assert.ok(!stale.includes("data-chk-recheck"), "黃色提示條又自己帶按鈕了——它負責講「清單是舊的」，動作在標題列那一顆");
  const heads = (fn.slice(fn.indexOf("let head, body")).match(/data-chk-recheck/g) || []).length;
  assert.ok(heads >= 1, "標題列那顆「重新檢查」不見了");
  assert.match(UI, /<button type="button" class="linkish">看清單<\/button>/, "模組橫幅的「看清單」要是文字連結——它跟任務條那顆是同一件事的兩個入口");
});
