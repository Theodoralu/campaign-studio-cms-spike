/* C 批介面接線絆線（2026-09-15；牆第 3／4／7 題甲＋過目牆 cms-c-batch-guidance-wall）：從最外層讀 index.html 字面（沿 ui_no_lifecycle 形式）。
   守：建立頁四步、策略檔格的門、外觀收折、AI 組在第 2 步底下、內容策略區與策略檔頁存在、文案單一真源（/api/flow-guide）而不是在 index.html 抄一份。 */
"use strict";
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const UI_RAW = fs.readFileSync(path.resolve(__dirname, "..", "..", "workbench", "public", "index.html"), "utf8");
const UI = UI_RAW.replace(/<!--[\s\S]*?-->/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
const COPY = JSON.parse(fs.readFileSync(path.resolve(__dirname, "..", "..", "lib", "flow_guide_copy.json"), "utf8"));

test("建立頁四步：1 商品來源／2 活動主題規劃／3 活動版型挑選（收折 details）／4 活動創建人；沒有第 5 步", () => {
  const nos = [...UI.matchAll(/<span class="fg-no">(\d)<\/span>(?:<svg[^>]*>[\s\S]*?<\/svg>)?([^<]+)/g)].map((m) => [m[1], m[2].trim()]); // 3 甲（09-15）：步號後多一個 SHP 圖示
  assert.deepStrictEqual(nos.map((x) => x[0]), ["1", "2", "3", "4"], JSON.stringify(nos));
  assert.match(nos[1][1], /^活動主題規劃/); assert.match(nos[2][1], /^活動版型挑選/); assert.match(nos[3][1], /^活動創建人/); // 2026-09-15 使用者改題名
  assert.match(UI, /<details class="fgroup look-set" id="create-look">/, "外觀要是收折的 details");
  assert.match(UI, /id="create-look-summary"/);
});

test("AI 那組搬進第 2 步底下、只在有 AI 時出現；標題「或者，讓 AI 從頭策展」", () => {
  const i2 = UI.indexOf('<span class="fg-no">2</span>'), i3 = UI.indexOf('<span class="fg-no">3</span>'), ie = UI.indexOf('id="engine-group"');
  assert.ok(i2 < ie && ie < i3, "engine-group 要在第 2 步與第 3 步之間");
  assert.match(UI, /id="engine-group" data-needs="ai" hidden/);
  assert.ok(UI.includes("或者，讓 AI 從頭策展"));
});

test("策略檔格：不上鎖（09-15 下午翻案）；策略檔帶型態＝自動帶入；只擋型態 A vs 策略檔 B（in-brief-mismatch）", () => {
  assert.ok(UI.includes('<option value="">先不用，產生後在編修頁補（建議）</option>'));
  assert.match(UI, /function syncBriefGate\(/); assert.match(UI, /function syncBriefMismatch\(/); assert.match(UI, /id="in-brief-mismatch"/);
  assert.doesNotMatch(UI, /sel\.disabled = true/, "策略檔格不得再 disabled");
  assert.doesNotMatch(UI, /sel\.classList\.add\("gated"\)/, "策略檔格不得再上鎖");
  assert.match(UI, /CO\.typeFromBrief/); assert.match(UI, /CO\.noTypeUnset/);
  assert.ok(COPY.createOptions.typeFromBrief && COPY.createOptions.noTypeUnset); assert.ok(!COPY.briefPanel.createGate, "閘句已退場");
});

test("內容策略區、策略檔頁、歡迎三格的容器與函式都在；文案只在 flow_guide_copy.json", () => {
  for (const tok of ['id="brief-panel"', 'id="view-briefs"', 'id="nav-briefs"', 'id="welcome-modal"', "function renderBriefPanel(", "function renderBriefsPage(", "function maybeShowWelcome(", "async function loadFlowGuide(", '"/api/flow-guide"']) assert.ok(UI.includes(tok), `缺 ${tok}`);
  for (const s of [COPY.welcome.cards[0].h, COPY.briefPanel.copy.label, COPY.briefPanel.redo.blocked, COPY.briefPanel.recon.mismatchTitle]) assert.ok(!UI.includes(s), `「${s}」不該寫死在 index.html（單一真源＝flow_guide_copy.json）`);
});

test("flow_guide_copy.json：三份引導（歡迎三格／Gemini 五步／建頁六步）齊、對帳卡句型齊", () => {
  assert.strictEqual(COPY.welcome.cards.length, 3); assert.strictEqual(COPY.fromActivity.steps.length, 3, "P-3 甲：從活動出發三步"); assert.strictEqual(COPY.createSteps.steps.length, 6);
  for (const k of ["none", "noneHint", "paste", "mineGroup"]) assert.ok(COPY.createOptions[k], `createOptions 缺 ${k}`);
  for (const k of ["purgeOne", "purgeAll", "daysLeft", "confirmTitle", "confirmBody", "purgeAllTitle"]) assert.ok(COPY.trash[k], `trash 缺 ${k}`);
  for (const k of ["view", "edit", "rename", "share", "delete", "editTitle", "shareBody", "deleteBody"]) assert.ok(COPY.mine[k], `mine 缺 ${k}`);
  for (const k of ["scenarioSame", "scenarioMissing", "mismatchTitle", "mismatchBody", "mismatchAdvice", "mismatchKeep", "btnFollow", "btnKeep", "afterFollow", "afterKeep", "floors", "floorZero", "exclude", "walls", "askGemini"]) assert.ok(COPY.briefPanel.recon[k], `recon 缺 ${k}`);
});

test("伺服器：flow-guide 端點、補選型態端點、三支策略檔端點都在", () => {
  const SRV = fs.readFileSync(path.resolve(__dirname, "..", "..", "workbench", "server.js"), "utf8");
  for (const tok of ['seg[1] === "flow-guide"', 'seg[3] === "scenario" && req.method === "POST"', 'seg[3] === "gemini-prompt"', 'seg[2] === "mine" && !seg[3] && req.method === "POST"', 'seg[3] === "redo-draft"']) assert.ok(SRV.includes(tok), `server 缺 ${tok}`);
});

test("分享站鏡像頁與文案真源同步（tools/gen-flow-guide.mjs --check；產物勿手改）", () => {
  const { spawnSync } = require("node:child_process");
  const r = spawnSync(process.execPath, [path.resolve(__dirname, "..", "..", "tools", "gen-flow-guide.mjs"), "--check"], { encoding: "utf8" });
  assert.strictEqual(r.status, 0, `鏡像頁過期或被手改：\n${r.stderr || r.stdout}\n修法＝node tools/gen-flow-guide.mjs`);
});

test("3 甲：建立頁寬幅、輸入欄另限寬、四步各一個 SHP 圖示；1 甲：貼上一份新的（選項文案讀單一真源）", () => {
  assert.match(UI, /#view-create\{max-width:1000px/); assert.match(UI, /#create-card input\[type=text\],#create-card select,#create-card textarea[^}]*max-width:680px/);
  for (const ic of ["i-link", "i-doc", "i-eye", "i-info"]) assert.ok(new RegExp(`<span class="fg-no">\\d</span><svg class="ic" aria-hidden="true"><use href="#${ic}"/></svg>`).test(UI), `第幾步缺圖示 ${ic}`);
  assert.match(UI, /op\.value = "__paste__"/); assert.match(UI, /function syncBriefPasteBox\(/); assert.match(UI, /id="in-brief-paste"/);
  assert.ok(!UI.includes(COPY.briefPanel.createPaste.option), "選項文案不該寫死在 index.html");
  /* 2026-09-24（病例 run 174314）：貼了沒按存不再靜默當沒選——「開始策展」先自動存起來帶進去；存不成擋下；空的講一句。文案住單一真源。 */
  assert.match(UI, /async function saveCreatePaste\(/, "建立頁貼上框存檔要抽成函式，鈕與自動存共用");
  assert.ok(UI.includes("const sv = await saveCreatePaste();"), "「開始策展」要先把貼上框存起來");
  assert.ok(UI.includes("TP.autoSaveFailed") && UI.includes("TP.autoSaved") && UI.includes("TP.emptyNone"), "三種結果都要講、都讀單一真源");
  for (const k of ["autoSaved", "emptyNone", "autoSaveFailed"]) assert.ok(COPY.briefPanel.createPaste[k], `createPaste 缺 ${k}`);
  for (const k of ["withBrief", "noBrief", "briefFailed"]) assert.ok(COPY.briefPanel.createDone[k], `createDone 缺 ${k}`);
  assert.ok(UI.includes("showCreateDone(id, st)") && UI.includes("CD.noBrief"), "完成框要講這次用了哪份策略檔／沒用");
  /* 對不到的層照商品補標題＝編修頁徽章＋一鍵換（真源 meta.brief.autoTitles） */
  for (const k of ["badge", "why", "whyNoWanted", "pick", "picked"]) assert.ok(COPY.briefPanel.autoTitle[k], `autoTitle 缺 ${k}`);
  assert.match(UI, /function autoTitleHintHtml\(/); assert.ok(UI.includes('autoTitleHintHtml("floor", i)') && UI.includes('autoTitleHintHtml("wall", i)'), "樓層與牆的標題欄都要掛");
  assert.match(UI, /\[data-auto-pick\]/, "一鍵換要接線");
  for (const s of [COPY.briefPanel.autoTitle.badge, COPY.briefPanel.createDone.noBrief, COPY.briefPanel.createPaste.autoSaved]) assert.ok(!UI.includes(s), `「${s}」不該寫死在 index.html`);
});
