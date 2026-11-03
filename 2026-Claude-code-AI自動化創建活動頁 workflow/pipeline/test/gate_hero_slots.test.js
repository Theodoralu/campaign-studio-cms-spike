"use strict";
/**
 * 主視覺換品三道門・檢查器側（2026-09-26 使用者裁「乙」；病例＝run 2026-09-26-wb-150126）。
 *
 * 病例形狀：同一件商品同時在主視覺右槽 #2 與樓層 1 情境卡，發佈前檢查全綠（CP-18 只登記舊 KV 欄，新版主視覺槽零登記）；
 * 使用者把主視覺那件換掉後，它身上留著的「主視覺標題」殘值繼續被 CP-03 量寬度＝一條畫面上無處可改的永久紅燈。
 * 另外：我為了複現直接把版本備份 draft.v33.json 餵給檢查器，它把報告寫回同一個檔名、備份被蓋掉——輸出防呆補在同一批。
 *
 * 做法沿 gate_exposure_boundary.test.js：正向 fixture 為底、只動要驗的那一格、跑真實 CLI（離線）。
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const GATE = path.join(__dirname, "..", "gate.js");
const FIX = path.join(__dirname, "fixtures");
const LONG = "興達港歐董魚丸 回購組合(花枝蝦排X1+月亮花枝蝦餅X1+包蛋旗魚黑輪x1+蝦滋圈x1+牛蒡天婦羅x1+鮮蝦滑x1)"; // 病例原字（HERONAME 預算 760px 放不下）

function runGate(mutate, draftName = "draft.json") {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gate-hero-"));
  const snap = path.join(dir, "snapshot.json");
  const draftPath = path.join(dir, draftName);
  fs.copyFileSync(path.join(FIX, "gate_pass_snapshot.json"), snap);
  const draft = JSON.parse(fs.readFileSync(path.join(FIX, "gate_pass_draft.json"), "utf8"));
  if (mutate) mutate(draft);
  const bytes = JSON.stringify(draft, null, 1);
  fs.writeFileSync(draftPath, bytes);
  let status = 0, stdout = "", stderr = "";
  try { stdout = execFileSync("node", [GATE, snap, draftPath], { encoding: "utf8", env: { ...process.env, GATE_SKIP_HTTP: "1" }, stdio: ["ignore", "pipe", "pipe"] }); }
  catch (e) { status = e.status ?? 1; stdout = (e.stdout || "").toString(); stderr = (e.stderr || "").toString(); }
  const after = fs.readFileSync(draftPath, "utf8"); const reportExists = fs.existsSync(path.join(dir, "gate_report.json"));
  fs.rmSync(dir, { recursive: true, force: true });
  const lines = stdout.split("\n");
  return { status, stdout, stderr, draftUnchanged: after === bytes, reportExists,
    cp18: lines.filter((l) => /CP-18/.test(l) && /FAIL/.test(l)), cp18warn: lines.filter((l) => /CP-18/.test(l) && /WARN/.test(l)), cp03: lines.filter((l) => /CP-03/.test(l) && /FAIL/.test(l) && /主視覺商品標題/.test(l)),
    cp03info: lines.filter((l) => /CP-03/.test(l) && /INFO/.test(l) && /殘值/.test(l)) };
}
const rowOf = (d, g) => d.products.find((p) => String(p.gdid) === String(g));

test("原樣 fixture 仍全綠（新登記不製造假紅）", () => {
  const r = runGate(null); assert.strictEqual(r.status, 0, r.stdout); assert.deepStrictEqual(r.cp18, []); assert.deepStrictEqual(r.cp03, []);
});

test("門③｜新版主視覺槽的商品同時是樓層 1 的商品卡＝CP-18 提醒要叫（2026-10-05 裁決：主視覺可重複＝WARN 不阻擋）", () => {
  const r = runGate((d) => { d.page.hero = { "product-right": { gdids: [String(d.page.floors[0].productGdids[0])] } }; });
  assert.deepStrictEqual(r.cp18, [], `主視覺重複不再 FAIL\n${r.stdout}`);
  assert.ok(r.cp18warn.length >= 1, `應有 CP-18 WARN 提醒\n${r.stdout}`);
  assert.match(r.cp18warn.join("\n"), /主視覺（product-right）/, "要點名主視覺槽"); assert.match(r.cp18warn.join("\n"), /樓層 #1/, "要點名樓層 1");
});

test("門③｜主視覺槽 × 樓層 3 情境卡（sceneUrl）同一件＝也要提醒（WARN 不阻擋）", () => {
  const r = runGate((d) => { const g = String(d.page.floors[0].productGdids[1]); d.page.hero = { "product-left": { gdids: [g] } }; d.page.floors[0].productGdids.splice(1, 1); d.page.floors[2].sceneUrl = `https://tw.buy.yahoo.com/gdsale/gdsale.asp?gdid=${g}`; });
  assert.deepStrictEqual(r.cp18, [], `主視覺重複不再 FAIL\n${r.stdout}`);
  assert.ok(r.cp18warn.length >= 1, `應有 CP-18 WARN 提醒\n${r.stdout}`); assert.match(r.cp18warn.join("\n"), /主視覺（product-left）的商品「.+」（gd:\d+）與 樓層 #3 scene 卡/); /* 2026-10-07：訊息帶商品名＋貨號 */
});

test("門③反例｜同一件只在主視覺兩個槽（同模組）＝CP-18 不叫（槽內重複由編輯器擋）", () => {
  const r = runGate((d) => { const g = String(d.page.floors[0].productGdids[0]); d.page.floors[0].productGdids.splice(0, 1); d.page.hero = { "product-left": { gdids: [g] }, "product-right": { gdids: [g] } }; });
  assert.deepStrictEqual(r.cp18, [], `同模組不該叫\n${r.stdout}`);
});

test("門③反例｜舊 KV 欄與新版主視覺槽同時列同一批商品（layout-0NN 草稿的常態鏡像）＝CP-18 不叫（run 150126 實測抓到的假紅）", () => {
  const r = runGate((d) => { const gs = d.page.kv.keyProductGdids.map(String); d.page.hero = { "product-left": { gdids: gs.slice(0, 2) }, "product-right": { gdids: gs.slice(2) } }; });
  assert.deepStrictEqual(r.cp18, [], `鏡像不是兩處曝光\n${r.stdout}`);
  assert.deepStrictEqual(r.cp18warn, [], `鏡像也不該出主視覺重複提醒（KV 欄與槽是同一個主視覺）\n${r.stdout}`);
});

test("門①｜heroName 殘值（商品已不在主視覺槽）＝不再 FAIL，改 INFO 出聲", () => {
  const r = runGate((d) => { rowOf(d, d.page.floors[0].productGdids[0]).heroName = LONG; });
  assert.deepStrictEqual(r.cp03, [], `殘值不得再報太長\n${r.stdout}`);
  assert.ok(r.cp03info.length === 1, `要有一條 INFO 講殘值\n${r.stdout}`);
});

test("門①對照｜同一段長標題、商品還在主視覺槽裡＝照舊 FAIL（沒把真問題一起放掉）", () => {
  const r = runGate((d) => { const g = String(d.page.floors[0].productGdids[0]); d.page.floors[0].productGdids.splice(0, 1); d.page.hero = { "product-right": { gdids: [g] } }; rowOf(d, g).heroName = LONG; });
  assert.strictEqual(r.cp03.length, 1, `在槽內的長標題要叫\n${r.stdout}`); assert.deepStrictEqual(r.cp03info, []);
});

test("門④｜草稿檔名不是 draft.json＝拒跑、exit 2、輸入檔一個位元組都不動、不產報告（09-26 實踩：備份 draft.v33 被報告蓋掉）", () => {
  const r = runGate(null, "draft.v33.json");
  assert.strictEqual(r.status, 2, `期望 exit 2\n${r.stdout}\n${r.stderr}`);
  assert.ok(r.draftUnchanged, "輸入檔被改了"); assert.strictEqual(r.reportExists, false); assert.match(r.stderr, /拒絕執行/);
});
