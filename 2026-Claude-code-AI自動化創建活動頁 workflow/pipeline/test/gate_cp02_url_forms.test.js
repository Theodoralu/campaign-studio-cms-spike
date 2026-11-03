"use strict";
/**
 * CP-02 商品網址兩式等價（2026-10-04；病例＝run 2026-10-04-wb-211607 gdid 7460184）。
 *
 * 病例形狀：使用者輸入賣場編號加商品→productFetch 組出 gdsale.asp 式、實抓卻走 p- 式、回報輸入式→
 * 貼稿真值同步把 asp 式寫進快照，而草稿與其餘 59 筆池內紀錄都是 p- 式→gate 字串硬比對判
 * 「連結與來源不符」；使用者把商品從樓層移除（商品留在池）紅燈照舊＝死鎖。
 * 因果已在事發 run 上實證：只把快照那一個 url 換式，FAIL 1→PASS（2026-10-04 對照實驗）。
 *
 * 做法沿 gate_hero_slots.test.js：正向 fixture 為底、只動要驗的那一格、跑真實 CLI（離線）。
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const GATE = path.join(__dirname, "..", "gate.js");
const FIX = path.join(__dirname, "fixtures");

function runGate({ mutateDraft, mutateSnap } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gate-urlforms-"));
  const snapPath = path.join(dir, "snapshot.json");
  const draftPath = path.join(dir, "draft.json");
  const snap = JSON.parse(fs.readFileSync(path.join(FIX, "gate_pass_snapshot.json"), "utf8"));
  const draft = JSON.parse(fs.readFileSync(path.join(FIX, "gate_pass_draft.json"), "utf8"));
  if (mutateSnap) mutateSnap(snap);
  if (mutateDraft) mutateDraft(draft);
  fs.writeFileSync(snapPath, JSON.stringify(snap, null, 1));
  fs.writeFileSync(draftPath, JSON.stringify(draft, null, 1));
  let status = 0, stdout = "";
  try { stdout = execFileSync("node", [GATE, snapPath, draftPath], { encoding: "utf8", env: { ...process.env, GATE_SKIP_HTTP: "1" }, stdio: ["ignore", "pipe", "pipe"] }); }
  catch (e) { status = e.status ?? 1; stdout = (e.stdout || "").toString(); }
  fs.rmSync(dir, { recursive: true, force: true });
  const lines = stdout.split("\n");
  return { status, stdout,
    urlFails: lines.filter((l) => /FAIL/.test(l) && /連結與來源不符/.test(l)),
    entryUrlFails: lines.filter((l) => /FAIL/.test(l) && /連結非來源逐字/.test(l)) };
}

const G0 = () => JSON.parse(fs.readFileSync(path.join(FIX, "gate_pass_draft.json"), "utf8")).products[0].gdid;

test("同一件商品、兩種網址寫法＝等價不誤殺：草稿 p- 式 vs 快照 asp 式→零「連結與來源不符」", () => {
  const g = G0();
  const r = runGate({ mutateDraft: (d) => { d.products[0].url = `https://tw.buy.yahoo.com/gdsale/p-${g}.html`; } });
  assert.deepStrictEqual(r.urlFails, [], "兩式同賣場編號＝同一件商品，不得判「被改過」");
});

test("事發形狀重演（快照側被換式）：快照 p- 式 vs 草稿 asp 式→同樣不誤殺", () => {
  const g = G0();
  const r = runGate({ mutateSnap: (s) => { const p = s.products.find((x) => String(x.gdid) === String(g)); p.url = `https://tw.buy.yahoo.com/gdsale/p-${g}.html`; } });
  assert.deepStrictEqual(r.urlFails, [], "汙染方向與病例相同（快照被真值同步換式）＝修後不再紅");
});

test("負向控制：草稿 url 指到別的賣場編號＝照樣 FAIL（等價判定不是放水）", () => {
  const r = runGate({ mutateDraft: (d) => { d.products[0].url = "https://tw.buy.yahoo.com/gdsale/p-99999999.html"; } });
  assert.strictEqual(r.urlFails.length, 1, "不同商品的連結必須照擋");
  assert.match(r.urlFails[0], new RegExp(`\\[${G0()}\\]`));
});

test("入口連結同病同修：活動網址（解不出賣場編號）仍走字串逐字＝行為不變", () => {
  // 入口是活動頁網址＝productUrlKey 回 null＝回退逐字；改一個字元就該 FAIL
  const r = runGate({ mutateDraft: (d) => {
    const e = (d.page.promoEntries || []).find((x) => x && x.actid && x.url);
    if (!e) return; // fixture 無活動型入口＝本測自動略過（下一行斷言 0 筆成立）
    e.url = e.url + "?x=1";
  } });
  const d0 = JSON.parse(fs.readFileSync(path.join(FIX, "gate_pass_draft.json"), "utf8"));
  const hasActEntry = (d0.page.promoEntries || []).some((x) => x && x.actid && x.url);
  assert.strictEqual(r.entryUrlFails.length, hasActEntry ? 1 : 0);
});
