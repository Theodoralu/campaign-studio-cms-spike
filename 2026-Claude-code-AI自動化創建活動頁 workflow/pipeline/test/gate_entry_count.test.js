"use strict";
/**
 * CP-15 入口數量一正一負 fixture 測試（DoD 第 7 條：改 rules/gate 必附）。
 *
 * 2026-08-26 使用者裁決：「本期活動模組可以開放給用戶最多可以增加到 12 個內容入口」
 *   —— promoEntries 數量約束 3~4 → 3~12（上限 PROMO_ENTRY_COUNT.max 4→12；下限 3 不變；
 *   恰 3 則＝等比放大版型 INFO 語意保留；>3 全裝置左右滑動列＝渲染端互動另批）。
 *
 * 做法：沿 gate_golden.test.js 模式——以正向 fixture（gate_pass_draft.json）為底，
 *   在記憶體注入「人工手動入稿」promoEntries（promoSourceMode=manual＋每則 entrySource=manual
 *   ＝v13 通道：真值/圖源/過期/契合豁免、網域照檢——讓本測只對 CP-15 數量發力，不誤踩他閘），
 *   寫進一次性 tmp 夾後跑真實 CLI `node gate.js <snapshot> <draft>`（GATE_SKIP_HTTP=1 離線）。
 *
 *   正向：12 則 → exit 0、PASS、無任何 [FAIL]（上限放寬生效）
 *   負向：13 則 → exit 1、[FAIL] CP-15、訊息載明「13 則」與「上限 12」
 *   附驗：恰 3 則 → exit 0＋INFO 3 則版型（等比放大語意保留＝渲染端既有）
 */
const { test } = require("node:test");
const assert = require("node:assert");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const GATE = path.join(__dirname, "..", "gate.js");
const FIX = path.join(__dirname, "fixtures");

/* 人工手動入稿入口 ×n：每則 URL 唯一（tw.buy.yahoo.com 網域照檢；唯一＝不誤踩 CP-06/CP-18/CP-22） */
function manualEntries(n) {
  return Array.from({ length: n }, (_, i) => ({
    entrySource: "manual", manualKind: "search", destinationType: "manual",
    chip: `入口${i + 1}`, copy: `人工入稿驗證第 ${i + 1} 則`, dateValue: "",
    img: "", url: `https://tw.buy.yahoo.com/search/product?p=cp15-manual-${i + 1}`,
  }));
}

// 以正向 fixture 為底注入 n 則 manual 入口，跑真實 CLI；回傳 { status, stdout }
function runGateWithEntries(n) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gate-cp15-"));
  const snap = path.join(dir, "snapshot.json");
  const draftPath = path.join(dir, "draft.json");
  fs.copyFileSync(path.join(FIX, "gate_pass_snapshot.json"), snap);
  const draft = JSON.parse(fs.readFileSync(path.join(FIX, "gate_pass_draft.json"), "utf8"));
  draft.page.promoSourceMode = "manual";
  draft.page.promoEntries = manualEntries(n);
  fs.writeFileSync(draftPath, JSON.stringify(draft, null, 1));
  let status = 0;
  let stdout = "";
  try {
    stdout = execFileSync("node", [GATE, snap, draftPath], {
      encoding: "utf8",
      env: { ...process.env, GATE_SKIP_HTTP: "1" },
    });
  } catch (e) {
    status = e.status ?? 1;
    stdout = (e.stdout || "").toString();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  return { status, stdout };
}

test("正向 fixture：manual 入口 12 則（新上限）→ exit 0、PASS、無任何 FAIL 行", () => {
  const { status, stdout } = runGateWithEntries(12);
  assert.strictEqual(status, 0, `期望 exit 0，實得 ${status}\n${stdout}`);
  assert.match(stdout, /機器閘：PASS/, "摘要列應為 PASS");
  assert.doesNotMatch(stdout, /\[FAIL\]/, "12 則＝上限內，不得出現任何 [FAIL] 明細列");
});

test("負向 fixture：manual 入口 13 則（超編一則）→ exit 1、[FAIL] CP-15、訊息載明超過上限 12", () => {
  const { status, stdout } = runGateWithEntries(13);
  assert.strictEqual(status, 1, `期望 exit 1，實得 ${status}\n${stdout}`);
  assert.match(stdout, /機器閘：FAIL/, "摘要列應為 FAIL");
  assert.match(stdout, /\[FAIL\] CP-15/, "應命中 CP-15（入口數量閘）");
  // load-bearing：確認擋的是「13 則超過上限 12」這一條，而非別的偶發 FAIL
  assert.match(stdout, /13 則/, "訊息應載明實際則數 13");
  assert.match(stdout, /上限 12/, "訊息應載明上限 12（2026-08-26 放寬後值）");
});

test("語意保留：恰 3 則 → exit 0＋INFO 記 3 則版型（等比放大＝渲染側 09 §2.10 既有）", () => {
  const { status, stdout } = runGateWithEntries(3);
  assert.strictEqual(status, 0, `期望 exit 0，實得 ${status}\n${stdout}`);
  assert.match(stdout, /\[INFO\] CP-15/, "恰 3 則應記 INFO");
  assert.match(stdout, /3 則版型/, "INFO 應載明觸發 3 則版型（等比放大語意保留）");
});
