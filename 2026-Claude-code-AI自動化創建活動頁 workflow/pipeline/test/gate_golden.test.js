"use strict";
/**
 * gate.js（money 閘，46 規則）golden 迴歸 —— 零新相依（僅 node:test / node:assert）。
 *
 * 做法：以 execFileSync 跑真實 CLI `node gate.js <snapshot> <draft>`，斷言 exit code
 *       ＋stdout 命中的 CP 規則碼（gate.js 尾端 console.log 逐行印 `  [LEVEL] CODE msg`）。
 *
 * 環境：一律帶 GATE_SKIP_HTTP=1 → 跳過 CP-04 圖片 HTTP／CP-22 search GET 網路檢查（離線可重跑）。
 *
 * fixture（test/fixtures/，皆自 run 2026-07-22-wb-220414 之真檔，非 runs/ 大檔依賴）：
 *   gate_pass_snapshot.json  來源快照（{products, promotions, ...}）
 *   gate_pass_draft.json     已知會過的策展初稿 → 現行 gate.js 判 PASS（FAIL 0）
 *   gate_fail_draft.json     ＝正向 draft 僅把 products[0].price 2199→9999（與快照不符）
 *                            → 觸發 CP-02「現價 9999 ≠ 來源 2199」FAIL、exit 1
 *
 * 隔離：gate.js 會把報告寫到 draftPath.replace(/draft\.json$/, "gate_report.json")；
 *       故每次把 fixture 複製進一次性 tmp 夾再跑，產出的 gate_report.json 落在 tmp、
 *       不污染 test/fixtures/（同時規避「draft 檔名不以 draft.json 結尾會被就地覆寫」的坑）。
 */
const { test } = require("node:test");
const assert = require("node:assert");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const GATE = path.join(__dirname, "..", "gate.js");
const FIX = path.join(__dirname, "fixtures");

// 跑真實 CLI；回傳 { status, stdout }。execFileSync 於非零 exit 會 throw，
// 由 e.status／e.stdout 取回，讓正負向都拿得到 exit code 與輸出。
function runGate(snapshotFixture, draftFixture) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gate-golden-"));
  const snap = path.join(dir, "snapshot.json");
  const draft = path.join(dir, "draft.json");
  fs.copyFileSync(path.join(FIX, snapshotFixture), snap);
  fs.copyFileSync(path.join(FIX, draftFixture), draft);
  let status = 0;
  let stdout = "";
  try {
    stdout = execFileSync("node", [GATE, snap, draft], {
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

test("正向：已知會過的 run（wb-220414）→ exit 0、判 PASS、無任何 FAIL 行", () => {
  const { status, stdout } = runGate("gate_pass_snapshot.json", "gate_pass_draft.json");
  assert.strictEqual(status, 0, `期望 exit 0，實得 ${status}\n${stdout}`);
  assert.match(stdout, /機器閘：PASS/, "摘要列應為 PASS");
  assert.match(stdout, /FAIL 0/, "FAIL 計數應為 0");
  assert.doesNotMatch(stdout, /\[FAIL\]/, "不得出現任何 [FAIL] 明細列");
});

test("負向：draft 商品現價竄改 → exit 1、判 FAIL、命中 CP-02 真值閘", () => {
  const { status, stdout } = runGate("gate_pass_snapshot.json", "gate_fail_draft.json");
  assert.strictEqual(status, 1, `期望 exit 1，實得 ${status}\n${stdout}`);
  assert.match(stdout, /機器閘：FAIL/, "摘要列應為 FAIL");
  assert.match(stdout, /\[FAIL\] CP-02/, "應命中 CP-02（AI 可寫欄真值閘）");
  // load-bearing：正是注入的破壞（現價與快照不符），確認命中的是這條而非別的偶發 FAIL
  assert.match(stdout, /現價 9999 ≠ 來源 2199/, "CP-02 訊息應載明竄改後現價與來源價");
});

test("golden 不變量：負向 fixture 僅在 products[0].price 一處異於正向（單點破壞）", () => {
  const pass = JSON.parse(fs.readFileSync(path.join(FIX, "gate_pass_draft.json"), "utf8"));
  const fail = JSON.parse(fs.readFileSync(path.join(FIX, "gate_fail_draft.json"), "utf8"));
  assert.strictEqual(pass.products[0].price, 2199, "正向 fixture 基準價應為 2199");
  assert.strictEqual(fail.products[0].price, 9999, "負向 fixture 應把該價竄改為 9999");
  // 除了刻意注入的 price 與 meta.__fixture 註記，其餘 products 內容應與正向逐一致
  assert.strictEqual(fail.products.length, pass.products.length, "商品筆數不應改變");
  pass.products.forEach((p, i) => {
    const f = { ...fail.products[i] };
    const g = { ...p };
    if (i === 0) { delete f.price; delete g.price; }
    assert.deepStrictEqual(f, g, `products[${i}] 除注入點外不應有其他差異`);
  });
});
