/* 「上線部署」改名「發佈內網預覽」＋主鈕改「下載 AEM 網頁檔」（2026-09-11 使用者裁 A 案＝69 號追加裁決）
   ------------------------------------------------------------------
   為什麼要有這條：那顆鈕推的是內網分享站（同事看預覽、做 QA 的地方），消費者看到的是同事上傳到 AEM 的檔。
   叫「上線」的鈕不是真上線、真上線的鈕叫「下載」——名字不說實話，跟同日「名字叫 AI、其實是機械」是同一族。
   守什麼：
     ①舊講法逐字不得回滲（含註解：留舊 UI 字會讓下一個人以為畫面還這樣寫）
     ②核可後任務條的主鈕＝下載 AEM 網頁檔、次鈕＝發佈／更新內網預覽（對 taskState 原始碼斷言，不用寬鬆選擇器）
     ③建立流程進度列末步＝核可交付
   不守什麼：「活動上線日」「上線日前不巡檢」——那是活動檔期（消費者真的看到的那天），語意正確；
             「正式樣式已上線」講的是版面引擎，與發佈無關。程式狀態值 live／deploy 不動。 */
"use strict";
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const UI = path.join(__dirname, "..", "..", "workbench", "public", "index.html");
const src = () => fs.readFileSync(UI, "utf8");

const BANNED = ["核可此版本", "核可並交付", "上線部署", "更新上線", "重試上線", "重新上線", "上線進行中", "上線已啟動", "上線完成", "上線沒有成功", "上線中止", "開始上線", "仍要上線", "核可並上線", "核可上線", "可以進行上線", "不擋上線", "正式上線", "上線給同事看", "上線後納入每日巡檢", "上線中的活動頁", "正式去處是內部分享站"];
const ALLOW = [/活動上線日/, /上線日前/, /早於上線日/, /正式樣式已上線/, /原名「[^」]*上線[^」]*」/ /* 歷史說明：註解裡以「原名『…』」引用舊 UI 名＝允許，其餘一律不准 */];

test("舊講法逐字不得回滲（介面主檔全文，含註解）", () => {
  const lines = src().split("\n"); const hits = [];
  lines.forEach((l, i) => {
    // 歷史引文「原名『…』」先剝掉再掃：註解裡用這個句式引用舊 UI 名＝允許（讀的人一眼知道是舊名），其餘一律不准
    const l2 = l.replace(/原名「[^」]*」/g, "");
    if (ALLOW.some((re) => re.test(l2)) && !BANNED.some((b) => l2.includes(b))) return;
    for (const b of BANNED) if (l2.includes(b)) hits.push(`${i + 1}: 「${b}」 ${l.trim().slice(0, 90)}`);
  });
  assert.deepStrictEqual(hits, [], "\n" + hits.join("\n"));
});

test("核可後、還沒做過檔：主鈕＝製作 AEM 網頁檔、次鈕＝發佈／更新內網預覽（對 taskState 原始碼斷言）", () => {
  const s = src();
  const m = s.match(/const previewSecondary = hasCap\("publish"\) \? \{ label: meta\.liveUrl \? "更新內網預覽" : "發佈內網預覽", action: deployRunUi \} : null;[^\n]*[\s\S]*?key: "deploy", sentence: "([^"]+)", btnLabel: "([^"]+)", topLabel: "([^"]+)", action: (\w+), secondary: previewSecondary, note: previewNote \};[\s\S]*?key: "redeploy", sentence: "([^"]+)", btnLabel: "([^"]+)", topLabel: "([^"]+)", action: (\w+), secondary: previewSecondary, note: previewNote \};/);
  assert.ok(m, "taskState 核可後兩態的形狀變了——請同步更新本測試與文案牆");
  /* 2026-09-11 第 5／6 題：這兩態是「已核可但還沒做過檔」＝該做的事是「製作」；
     「下載」只出現在檔已做好且還是最新的那一態（key: exported，見 ui_aem_flow.test.js）。 */
  assert.strictEqual(m[2], "製作 AEM 網頁檔"); assert.strictEqual(m[4], "exportAemUi");
  assert.strictEqual(m[6], "製作 AEM 網頁檔"); assert.strictEqual(m[8], "exportAemUi");
  assert.match(m[1], /^現在該做：/, "任務條句式＝「現在該做：＋一句人話」（08-26 定）");
  assert.match(m[5], /^現在該做：/);
});

test("建立流程進度列末步＝核可交付（label／short／desc 三處都不講上線）", () => {
  const s = src();
  const m = s.match(/const STEP_DEFS = \[[\s\S]*?\];/);
  assert.ok(m, "找不到 STEP_DEFS");
  const last = m[0].split("\n").filter((l) => /^\s*\{ label:/.test(l)).pop();
  assert.match(last, /short: "核可交付"/);
  assert.match(last, /label: "核可這一版，之後就能交付"/); /* 丙案：提示字講先後，不寫「核可並交付」 */
  assert.doesNotMatch(last, /上線/);
});

test("「核可」這個動作在畫面上只有一個名字：核可這一版（鈕／右上／對話框；2026-09-11 使用者裁丙案）", () => {
  const s = src();
  const m = s.match(/key: "approve", sentence: "([^"]+)", btnLabel: "([^"]+)", topLabel: "([^"]+)", action: approveRun/);
  assert.ok(m, "taskState approve 分支形狀變了——請同步更新本測試與文案牆");
  assert.strictEqual(m[2], "核可這一版"); assert.strictEqual(m[3], "核可這一版");
  assert.match(m[1], /核可這一版，接著就能製作 AEM 網頁檔交付/, "任務條句要把「核可」與「交付」的先後接起來（節點講階段、按鈕講動作、句子講先後）；2026-09-11 第 6 題乙：核可之後那一步的名字是「製作」，做好才輪到「下載」");
  assert.match(s, /dlg\("核可這一版？"/, "核可對話框標題要跟按鈕同一個名字");
  /* 使用者實測抓到的病（2026-09-11）：進度列說「核可交付」、按鈕說「核可這一版」、右上說「核可此版本」——同一個動作三個名字。
     掃舊字（「上線」）抓不到這種「本來就不叫舊名、但跟新名不一致」的殘骸，所以這條直接對動作名斷言。 */
});

test("進度列末步：節點字是階段名、提示字講先後，兩者不得互相矛盾也不得讓按鈕多說一件事", () => {
  const s = src();
  const m = s.match(/const STEP_DEFS = \[[\s\S]*?\];/);
  const last = m[0].split("\n").filter((l) => /^\s*\{ label:/.test(l)).pop();
  assert.match(last, /short: "核可交付"/, "節點字＝階段名「核可交付」（核可→交付）");
  assert.match(last, /label: "核可這一版，之後就能交付"/, "提示字講先後（不寫「核可並交付」＝那會讓人以為按核可就交付了）");
  /* 同型病：改了 short 沒改 label（b3 2026-09-11 審稿補到）。 */
});

/* 伺服器端也會把字送到使用者眼前（409 error／setDeploy error／KEY_ZH／鎖訊息）——b3 2026-09-11 審稿抓到：
   改了鈕名、指路句沒跟上（「請再按一次『上線部署』重試」而那顆鈕已叫「發佈內網預覽」），與「叫人按已退場的下載 ZIP」同型。
   判準＝「這個字串會不會送到使用者眼前」，不是「它住在哪支檔」。appendLog 履歷不在此掃（另議）。 */
const SERVER = path.join(__dirname, "..", "..", "workbench", "server.js");
const SERVER_BANNED = ["上線部署", "上線進行中", "等上線完成", "已停止上線", "再上線", "ZIP 匯出正在進行中", "ZIP 匯出進行中"];
test("server.js 會上畫面的句子（error／_MSG／KEY_ZH／部署訊息）不得再講「上線部署」或退場的 ZIP", () => {
  const lines = fs.readFileSync(SERVER, "utf8").split("\n"); const hits = [];
  lines.forEach((l, i) => {
    if (!/_MSG = |error: "|error: `|KEY_ZH|deploy-ghe-pages\.sh"/.test(l)) return;
    const l2 = l.replace(/原名「[^」]*」/g, "").replace(/\/\*.*?\*\//g, "");
    for (const b of SERVER_BANNED) if (l2.includes(b)) hits.push(`${i + 1}: 「${b}」 ${l.trim().slice(0, 100)}`);
  });
  assert.deepStrictEqual(hits, [], "\n" + hits.join("\n"));
});

/* 未定稿預覽提醒（2026-09-14 三題牆第 1 題甲；2026-09-16 落地）
   ------------------------------------------------------------------
   為什麼要有這條：頁頂那條「這一版還沒定稿」橫幅**不會自己消失**——預覽頁在同事的瀏覽器裡連不回工作台，
   問不到「現在核可了沒」，所以核可完要再發佈一次它才會撤。這件事一旦沒人講，就變成靠人記得，
   而「記得」正是這整張工單要消滅的東西。
   守什麼：①那句提醒逐字還在 ②判定沿用 aemFresh 同一把尺（時間比對），不另立第二套規則
           ③提醒行真的被畫出來（有 note 才產節點、產了要填字），不是算出來就沒下文。 */
test("未定稿預覽提醒：句子逐字在、判定用時間比對、提醒行真的會畫出來", () => {
  const s = src();
  assert.match(s, /內網預覽還是沒核可的版本，記得更新一次，看的人才不會再看到「還沒定稿」。/,
    "牆上過目的那句要逐字在——改字請回 2026-09-14 三題牆，不要在這裡改");
  const fn = s.match(/function previewStale\(meta, appr\)\{[\s\S]*?\n\}/);
  assert.ok(fn, "判定要有自己的函式（單一真源，勿在各態各抄一份）");
  assert.match(fn[0], /Date\.parse\(dep\.finishedAt\)[\s\S]*Date\.parse\(appr\)/,
    "判定＝發佈完成時間 vs 核可時間（與 aemFresh 同一把尺）");
  assert.match(fn[0], /Number\.isFinite/, "量不到時間要當作不過期，不無端叫人重發");
  assert.match(s, /tb\.querySelector\("\.tb-note"\)\.textContent = st\.note/,
    "算出來要真的畫出來——只算不畫等於沒做");
  assert.match(s, /st\.note \? '<span class="tb-note"><\/span>' : ""/,
    "沒有提醒時不該留一個空節點在那裡");
});
