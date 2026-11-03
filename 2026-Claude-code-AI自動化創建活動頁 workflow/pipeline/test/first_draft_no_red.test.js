"use strict";
/**
 * 第一版草稿不該有商品類紅燈（2026-09-27 使用者裁 甲＋乙；story docs/stories/first-draft-no-red.md）。
 *
 * 病例：業務貼網址建立草稿、什麼都沒改，發佈前檢查就紅——主視覺右槽第 2 格永遠是第 1 層情境卡代表品（CP-18）、
 * 長名進主視覺（CP-03）。全庫 58 檔有主視覺商品槽的活動 35 檔在撞，四件槽版式（001～007）每次新建都撞、三件槽（008～012）從不撞。
 *
 * 做法＝真 CLI 走建立期那條路：fixture snapshot → curate_auto（帶 server 會帶的 --heroCount）→ writeLayoutChoiceIntoDraft（預填）→ gate（離線）。
 * 版式挑 002／003／005（左右商品槽）、004（拼貼）、006（環列）＝五種四件槽骨架；對照組＝舊式預填（不帶 opts）打同一份草稿必出 CP-18，證明測試會咬人。
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const PIPE = path.join(__dirname, "..");
const L = require(path.join(PIPE, "lib", "layout_choice.js"));
const CLI = path.join(PIPE, "workbench", "curate_auto.js");
const GATE = path.join(PIPE, "gate.js");
const SNAP = path.join(PIPE, "test", "fixtures", "gate_pass_snapshot.json");
const gdidOf = (u) => { const m = String(u || "").match(/[?&]gdid=(\w+)/); return m ? m[1] : null; };
const PRODUCT_SLOTS = Object.keys(L.HERO_PREFILL_TAKE);

function gate(dir) {
  let stdout = "", status = 0;
  try { stdout = execFileSync(process.execPath, [GATE, path.join(dir, "snapshot.json"), path.join(dir, "draft.json")], { encoding: "utf8", env: { ...process.env, GATE_SKIP_HTTP: "1" }, stdio: ["ignore", "pipe", "pipe"] }); }
  catch (e) { status = e.status ?? 1; stdout = (e.stdout || "").toString(); }
  const lines = stdout.split("\n");
  return { status, stdout, cp18: lines.filter((l) => /CP-18/.test(l) && /FAIL/.test(l)), cp18warn: lines.filter((l) => /CP-18/.test(l) && /WARN/.test(l)), cp03hero: lines.filter((l) => /CP-03/.test(l) && /FAIL/.test(l) && /主視覺商品標題/.test(l)), cp02: lines.filter((l) => /CP-02/.test(l) && /FAIL/.test(l)) };
}
function build(kv, heroArgs) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "first-draft-"));
  fs.copyFileSync(SNAP, path.join(dir, "snapshot.json"));
  execFileSync(process.execPath, [CLI, dir, "--scenario", "", "--theme", "", ...heroArgs], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  const draftPath = path.join(dir, "draft.json");
  L.writeLayoutChoiceIntoDraft(draftPath, { kvVariant: kv, layoutChoice: { by: "manual", reason: "測試：第一版草稿不該有商品類紅燈" } });
  return { dir, draftPath, draft: JSON.parse(fs.readFileSync(draftPath, "utf8")) };
}
const exposedOutsideHero = (d) => {
  const s = new Set();
  (d.page.floors || []).forEach((f) => { const g = gdidOf(f.sceneUrl); if (g) s.add(g); (f.productGdids || []).forEach((x) => s.add(String(x))); });
  (d.page.walls || []).forEach((w) => (w.productGdids || []).forEach((x) => s.add(String(x))));
  (d.products || []).forEach((p) => { if (p.position === "editorial-wall") s.add(String(p.gdid)); });
  return s;
};
const heroGdids = (d) => Object.entries(d.page.hero || {}).filter(([k]) => PRODUCT_SLOTS.includes(k)).flatMap(([, v]) => (v && v.gdids) || []).map(String);

for (const kv of ["layout-002", "layout-003", "layout-005", "layout-004", "layout-006"]) {
  test(`${kv}：新建完成當下 gate 零商品類 FAIL（CP-18／CP-03 主視覺）、主視覺商品槽放滿、沒有一件跟樓層／牆撞`, () => {
    const hc = L.heroCountArgs(kv);
    assert.strictEqual(hc.count, 4, `${kv} 主視覺容量應為 4（登記簿）`); assert.deepStrictEqual(hc.args, ["--heroCount", "4"]);
    const { dir, draft } = build(kv, hc.args);
    try {
      const hg = heroGdids(draft);
      assert.strictEqual(hg.length, 4, `主視覺商品槽要放滿 4 件，實得 ${JSON.stringify(draft.page.hero)}`);
      assert.strictEqual(new Set(hg).size, 4, "槽內不重複");
      const ex = exposedOutsideHero(draft);
      assert.deepStrictEqual(hg.filter((g) => ex.has(g)), [], "主視覺商品不得同時在樓層／牆／編輯精選牆");
      assert.match(draft.meta.layoutChoice.heroPrefill, /^骨架預填 \d 槽（建立期機器預設、可編修）$/, "放滿＝沒有補齊提醒");
      const g = gate(dir);
      assert.deepStrictEqual(g.cp18, [], "CP-18 必須 0：\n" + g.cp18.join("\n"));
      assert.deepStrictEqual(g.cp03hero, [], "CP-03 主視覺標題必須 0");
      assert.deepStrictEqual(g.cp02, [], "CP-02 必須 0（草稿逐字＝快照）：\n" + g.cp02.join("\n"));
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
}

test("對照組：舊式（照順序切、不避曝光）預填打同一批商品＝CP-18 必紅——證明上面的測試會咬人", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "first-draft-ctrl-"));
  try {
    fs.copyFileSync(SNAP, path.join(dir, "snapshot.json"));
    execFileSync(process.execPath, [CLI, dir, "--scenario", "", "--theme", ""], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }); // 不帶 heroCount＝舊形狀
    const draftPath = path.join(dir, "draft.json");
    const dj = JSON.parse(fs.readFileSync(draftPath, "utf8"));
    const rec = L.loadLayoutDeps().registries.layoutRecords.get("layout-002");
    dj.page.kvVariant = "layout-002";
    dj.page.hero = L.defaultHeroForLayout(rec, dj.page.pageName, dj.products, dj.page.kv); // 2026-09-27 前的預填
    assert.strictEqual(String(dj.page.hero["product-right"].gdids[1]), gdidOf(dj.page.floors[0].sceneUrl), "前置確認：右槽第 2 格＝第 1 層情境卡代表品");
    const bytes = JSON.stringify(dj, null, 1);
    fs.writeFileSync(draftPath, bytes);
    const g = gate(dir);
    /* 2026-10-05 使用者裁：主視覺×下方重複＝CP-18 降 WARN 提醒不阻擋——對照組跟著改抓 WARN（仍證明「會咬人」：有聲音、只是不擋） */
    assert.deepStrictEqual(g.cp18, [], "主視覺重複不再 FAIL（2026-10-05 裁決）：\n" + g.cp18.join("\n"));
    assert.ok(g.cp18warn.length >= 1, "舊式預填必出 CP-18 WARN 提醒：\n" + g.stdout.slice(-600));
    assert.match(g.cp18warn.join("\n"), /主視覺（product-right）的商品「.+」（gd:\d+）與 樓層 #1 scene 卡/); /* 2026-10-07：訊息帶商品名＋貨號（使用者反饋「不知道是哪兩個商品重複」） */
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
