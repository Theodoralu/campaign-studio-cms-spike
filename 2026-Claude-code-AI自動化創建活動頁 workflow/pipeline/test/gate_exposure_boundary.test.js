"use strict";
/**
 * 發佈前檢查的「曝光邊界」——2026-09-25 使用者裁決（曝光邊界牆三題：甲／甲／乙）。
 *
 * 病例：白蘭 174314 同一件商品在「樓層 1 第 5 張卡」＋「樓層 3 情境大圖」，發佈前檢查全綠。
 * 兩件事疊在一起才讓它沉默：
 *   ① 曝光常數停在「每層前 3 張」（07-21 寫的），08-26 樓層改 3／7／11／15 件全畫後沒跟上——
 *      引擎、加商品、替換、編輯器四處早已全算，只有這道決定「擋不擋發佈」的閘落單；
 *   ② CP-18 聚合把「樓層 #1」「樓層 #3」一律剪成「樓層」＝同一個模組，跨樓層永遠不比。
 *
 * 做法沿 gate_entry_count.test.js：以正向 fixture 為底、只動要驗的那一格，跑真實 CLI（離線）。
 * 五顆＝兩正（甲／甲要叫）＋兩反（乙不叫、品類牆口徑不動）＋一顆原樣全綠（新聚合不製造假紅）。
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const GATE = path.join(__dirname, "..", "gate.js");
const FIX = path.join(__dirname, "fixtures");

/** 以正向 fixture 為底，mutate(draft) 後跑真實 CLI；回 { status, stdout, cp18: string[] } */
function runGate(mutate) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gate-cp18-"));
  const snap = path.join(dir, "snapshot.json");
  const draftPath = path.join(dir, "draft.json");
  fs.copyFileSync(path.join(FIX, "gate_pass_snapshot.json"), snap);
  const draft = JSON.parse(fs.readFileSync(path.join(FIX, "gate_pass_draft.json"), "utf8"));
  if (mutate) mutate(draft);
  fs.writeFileSync(draftPath, JSON.stringify(draft, null, 1));
  let status = 0, stdout = "";
  try {
    stdout = execFileSync("node", [GATE, snap, draftPath], { encoding: "utf8", env: { ...process.env, GATE_SKIP_HTTP: "1" } });
  } catch (e) { status = e.status ?? 1; stdout = (e.stdout || "").toString(); }
  finally { fs.rmSync(dir, { recursive: true, force: true }); }
  const cp18 = stdout.split("\n").filter((l) => /CP-18/.test(l) && /FAIL/.test(l));
  return { status, stdout, cp18 };
}

/* fixture 形狀（test/fixtures/gate_pass_draft.json）：三層樓各 3 張卡＋情境大圖；三面牆各 4 張。
   樓層 1 卡 1＝10937346；樓層 3 卡 1＝9793492；牆 1 卡 1＝10103933。 */
const urlOf = (g) => `https://tw.buy.yahoo.com/gdsale/gdsale.asp?gdid=${g}`;

test("原樣 fixture 仍全綠——樓層各自成模組不會製造假紅", () => {
  const r = runGate(null);
  assert.strictEqual(r.status, 0, `期望 exit 0\n${r.stdout}`);
  assert.deepStrictEqual(r.cp18, [], "原樣不得出現 CP-18");
});

test("第 2 題甲｜跨樓層：樓層 1 的商品卡 × 樓層 3 的情境大圖同一件＝要叫（白蘭病例的形狀）", () => {
  const r = runGate((d) => { d.page.floors[2].sceneUrl = urlOf(d.page.floors[0].productGdids[0]); });
  assert.ok(r.cp18.length >= 1, `應有 CP-18 FAIL\n${r.stdout}`);
  const line = r.cp18.join("\n");
  assert.match(line, /樓層 #1 商品卡 1/, "要點名樓層 1 那張卡");
  assert.match(line, /樓層 #3 scene 卡/, "要點名樓層 3 的情境大圖");
  assert.match(line, /gd:10937346/, "訊息要帶貨號——前端靠它把兩列框起來");
  assert.notStrictEqual(r.status, 0, "CP-18 是 FAIL＝要擋發佈");
});

test("第 1 題甲｜第 4 張以後也算曝光：樓層 1 第 4 張卡 × 樓層 3 第 1 張卡同一件＝要叫（原本前 3 張以外看不見）", () => {
  const r = runGate((d) => { d.page.floors[0].productGdids.push(d.page.floors[2].productGdids[0]); });
  assert.ok(r.cp18.length >= 1, `應有 CP-18 FAIL\n${r.stdout}`);
  const line = r.cp18.join("\n");
  assert.match(line, /樓層 #1 商品卡 4/, "第 4 張卡要在曝光名單裡（舊常數 3 會把它切掉）");
  assert.match(line, /樓層 #3 商品卡 1/);
  assert.match(line, /gd:9793492/);
});

test("第 3 題乙｜同一層兩張卡同商品＝刻意不加門（0 病例、加商品那道門已擋；記待辦）", () => {
  const r = runGate((d) => { d.page.floors[0].productGdids.push(d.page.floors[0].productGdids[0]); });
  assert.deepStrictEqual(r.cp18, [], `同一層內兩張卡同商品不由 CP-18 管——使用者裁乙\n${r.stdout}`);
});

test("口徑不動｜品類牆跨牆同商品：維持「所有牆＝一個模組」，不因樓層改法而連動", () => {
  const r = runGate((d) => { d.page.walls[1].productGdids[0] = d.page.walls[0].productGdids[0]; });
  assert.deepStrictEqual(r.cp18, [], `牆的口徑這批不動（牆上明寫「主視覺／本期活動／編輯精選／品類牆既有口徑不動」）\n${r.stdout}`);
});
