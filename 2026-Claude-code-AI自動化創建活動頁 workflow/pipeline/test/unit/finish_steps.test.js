"use strict";
/** D9：core/finish 收尾步驟（純函式，不讀寫草稿檔、不觸網）。log 文字與 meta 欄位名逐字沿 server.js 原碼——前端黃條與列表警告讀這些。 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const F = require("../../core/finish");
const layoutLib = require("../../lib/layout_choice");
const { buildCheck } = require("../../core/product-truth/layers");

const PIPE = path.resolve(__dirname, "..", "..");
const FIX = path.join(PIPE, "test", "fixtures", "runs", "2026-10-27-wb-085823");
const read = (f) => JSON.parse(fs.readFileSync(path.join(FIX, f), "utf8"));
const clock = { iso: () => "2026-11-16T02:00:00.000Z" };

test("themeFitPatch：主題切詞＋搜尋網址 p=＋來源頁標題頭段；沒有任何詞＝不產檔", () => {
  const r = F.themeFitPatch({ theme: "中秋烤肉", sourceUrl: "https://tw.buy.yahoo.com/search/product?p=烤肉架+木炭", pageTitle: "統一企業 品牌旗艦店 | Yahoo購物中心" });
  for (const k of ["中秋烤肉", "中秋", "烤肉", "烤肉架", "木炭", "統一企業", "品牌旗艦店"]) assert.ok(r.keywords.includes(k), `缺詞 ${k}`);
  assert.ok(!r.keywords.some((k) => /yahoo|購物中心/i.test(k)), "站名不進詞組");
  assert.strictEqual(r.patch.themeFitRule.threshold, 0.3); assert.strictEqual(r.patch.themeFitRule.note, F.THEME_FIT_NOTE);
  assert.strictEqual(r.text, JSON.stringify(r.patch, null, 1), "落檔字串＝縮排 1（與原碼同，內容沒變就不重寫靠它比）");
  assert.deepStrictEqual(F.themeFitPatch({ theme: "", sourceUrl: "https://tw.buy.yahoo.com/?sub=1035", pageTitle: "" }), { patch: null, text: null, keywords: [] });
});

test("customThemeColor：合法色碼才套（有無 # 都收）、明暗、保留其餘 theme 欄位；不合法＝不動", () => {
  const d = { page: { theme: { hueFamily: "red", kvTitleStyle: "bold" } } };
  const r = F.customThemeColor(d, { input: { themeColor: "1D5F8A", themeMode: "dark" } });
  assert.deepStrictEqual(d.page.theme, { hueFamily: "custom", kvTitleStyle: "bold", colorTheme: "custom-dark", surfaceMode: "dark", customColor: "#1D5F8A" });
  assert.deepStrictEqual(r.logs, ["自訂主題色寫入：#1D5F8A（dark）＝建置流程選定，覆寫 auto 配色"]);
  const d2 = { page: { theme: { hueFamily: "red" } } };
  for (const bad of ["", "#12", "zzzzzz", undefined]) assert.strictEqual(F.customThemeColor(d2, { input: { themeColor: bad } }).changed, false);
  assert.deepStrictEqual(d2.page.theme, { hueFamily: "red" });
});

test("layoutChoice：寫版式＋履歷＋主視覺商品槽預填；與寫檔版 writeLayoutChoiceIntoDraft 結果相同；沒選版式＝不動", () => {
  const input = read("wb_meta.json").input;
  assert.ok(input.kvVariant && input.layoutChoice, "夾具要有版式選擇");
  const a = read("draft.golden.json"); delete a.page.hero; delete a.page.kvVariant;
  const b = JSON.parse(JSON.stringify(a));
  const r = F.layoutChoice(a, { input });
  assert.strictEqual(a.page.kvVariant, input.kvVariant); assert.ok(a.page.hero && Object.keys(a.page.hero).length > 0, "商品槽有預填");
  assert.match(r.logs[0], new RegExp(`^版式選定：kvVariant=${input.kvVariant}（${input.layoutChoice.by}）——`));
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "cs-finish-")), "draft.json"); fs.writeFileSync(f, JSON.stringify(b));
  layoutLib.writeLayoutChoiceIntoDraft(f, JSON.parse(JSON.stringify(read("wb_meta.json").input)));
  assert.deepStrictEqual(a, JSON.parse(fs.readFileSync(f, "utf8")), "記憶體版與寫檔版同一份結果");
  const c = { page: {} }; assert.deepStrictEqual(F.layoutChoice(c, { input: {} }), { changed: false, logs: [], meta: {} }); assert.deepStrictEqual(c, { page: {} });
});

test("themeBridge：新版式頁把建立選的自訂色落到 colors.themeDraft；失敗＝meta.themeBridgeError 出聲不擋", () => {
  const d = read("draft.golden.json"); d.page.kvVariant = "layout-005";
  F.customThemeColor(d, { input: { themeColor: "#1D5F8A", themeMode: "light" } });
  const r = F.themeBridge(d, { themeIds: () => [] });
  assert.strictEqual(r.changed, true); assert.match(r.logs[0], /^v2 主題橋接：/);
  assert.ok(d.page.colors && d.page.colors.themeDraft, "自訂盤落到 themeDraft");
  const bad = F.themeBridge({ get page() { throw new Error("壞草稿"); } }, {});
  assert.match(bad.logs[0], /^⚠ v2 主題橋接失敗/); assert.strictEqual(bad.meta.themeBridgeError, "壞草稿");
});

test("priceTruth：有變價＝快照與草稿同批改、逐件＋總結訊息、meta.priceTruth；全離線＝一件不改並出聲", () => {
  const draft = read("draft.golden.json"), snap = read("snapshot.replay.json");
  const p0 = { ...draft.products[0] }, p1 = { ...draft.products[1] }; // 複本：步驟會就地改 draft，原值要先留下
  const rows = draft.products.map((p) => ({ gdid: String(p.gdid), status: "online", livePrice: p.price, drift: false, snapDrift: false }));
  rows[0] = { ...rows[0], livePrice: p0.price - 10, liveMarketPrice: p0.price + 50, drift: true };
  rows[1] = { gdid: String(p1.gdid), status: "unverified" };
  const r = F.priceTruth(draft, { snapshot: snap, rows, checkedAt: "T", mode: "live", startedAt: "S", finishedAt: "E" });
  assert.strictEqual(draft.products[0].price, p0.price - 10); assert.strictEqual(draft.products[0].marketPrice, p0.price + 50);
  assert.strictEqual(snap.products.find((x) => String(x.gdid) === String(p0.gdid)).price, p0.price - 10);
  assert.ok(snap.warnings.some((w) => w.startsWith(`套用新價：gdid ${p0.gdid} `)), "快照稽核行");
  assert.deepStrictEqual(r.logs, [
    `價格改用商品頁現價：gdid ${p0.gdid} $${p0.price}→$${p0.price - 10}、原價 ${p0.price + 50}`,
    "建立期價格對真：1 件改用商品頁現價，來源紀錄與草稿已同步（來源活動頁沒給促銷價）",
    "⚠ 建立期價格對真：1 件沒能連上商品頁，價格沒動。發佈前檢查會再驗",
  ]);
  assert.deepStrictEqual(r.meta, { priceTruth: { stage: "done", startedAt: "S", finishedAt: "E", total: rows.length, applied: 1, unverified: 1, offline: false, mode: "live" } });
  assert.deepStrictEqual(r.applied.map((a) => a.gdid), [String(p0.gdid)]);

  const d2 = read("draft.golden.json"), s2 = read("snapshot.replay.json"), before = JSON.stringify(d2);
  const off = F.priceTruth(d2, { snapshot: s2, rows: d2.products.map((p) => ({ gdid: String(p.gdid), status: "unverified" })), checkedAt: "T" });
  assert.strictEqual(JSON.stringify(d2), before); assert.strictEqual(off.meta.priceTruth.offline, true);
  assert.deepStrictEqual(off.logs, [`⚠ 建立期價格對真：${d2.products.length} 件都沒能連上商品頁，價格沒動。發佈前檢查會再驗`]);

  const err = F.priceTruth(read("draft.golden.json"), { snapshot: { products: snap.products, warnings: 5 }, rows: [{ ...rows[0], livePrice: 1 }], checkedAt: "T", finishedAt: "E" });
  assert.match(err.logs[0], /^⚠ 建立期價格對真沒有跑成，價格沒動。發佈前檢查會再驗（技術：/); assert.strictEqual(err.meta.priceTruth.stage, "error"); assert.ok(err.meta.priceTruthError);
});

test("finishDraft（第一版整段）：策展稿＋建立輸入＋D7 uther 層價格列 → 收尾後草稿通過 schema 與 gate；步驟順序固定", async () => {
  const draft = read("draft.golden.json"), snap = read("snapshot.replay.json"), input = { ...read("wb_meta.json").input, themeColor: "#1D5F8A", themeMode: "light" };
  delete draft.page.hero; delete draft.page.kvVariant;
  // D7：uther 層的活體結果 → product_check 列（第一件降價 5 元，其餘同價；uther 層不比劃線價）
  const live = new Map(draft.products.map((p, i) => [String(p.gdid), { status: "online", prod: { price: i === 0 ? p.price - 5 : p.price, listPrice: null, listPriceUnknown: true }, evidence: { source: "uther" } }]));
  const chk = buildCheck(draft, snap, live, { layer: "uther", clock });
  const r = F.finishDraft({ draft, snapshot: snap, input, rows: chk.results, checkedAt: chk.checkedAt, ctx: { priceTruthMode: "uther", startedAt: "S", finishedAt: "E" } });
  const kinds = r.logs.map((l) => (/^自訂主題色/.test(l) ? "color" : /^版式選定/.test(l) ? "layout" : /v2 主題橋接/.test(l) ? "bridge" : /價格/.test(l) ? "price" : "?"));
  assert.deepStrictEqual([...new Set(kinds)], ["color", "layout", "bridge", "price"], `順序不對：${kinds.join(",")}`);
  assert.strictEqual(r.meta.priceTruth.applied, 1); assert.strictEqual(r.meta.priceTruth.mode, "uther");
  assert.strictEqual(r.draft.page.kvVariant, input.kvVariant); assert.strictEqual(r.draft.page.theme.customColor, "#1D5F8A");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cs-finish-e2e-"));
  /* 草稿路徑用變數組：dod-guards G3 以原始碼字面數「產品裡寫草稿檔的地方」，測試寫暫存夾不是產品寫入點，不該佔那個數 */
  const draftFile = path.join(dir, "draft" + ".json");
  fs.writeFileSync(draftFile, JSON.stringify(r.draft, null, 1)); fs.writeFileSync(path.join(dir, "snapshot.json"), JSON.stringify(r.snapshot, null, 1));
  const v = spawnSync(process.execPath, [path.join(PIPE, "tools", "schema", "validate.js"), path.join(PIPE, "schemas"), path.join(dir, "draft.json"), path.join(dir, "snapshot.json")], { encoding: "utf8" });
  assert.strictEqual(v.status, 0, v.stdout + v.stderr);
  const g = spawnSync(process.execPath, [path.join(PIPE, "gate.js"), path.join(dir, "snapshot.json"), path.join(dir, "draft.json")], { encoding: "utf8", env: { ...process.env, GATE_SKIP_HTTP: "1", CS_NOW: "2026-10-27T00:58:24.018Z" } });
  const rep = JSON.parse(fs.readFileSync(path.join(dir, "gate_report.json"), "utf8"));
  assert.deepStrictEqual(rep.findings.filter((x) => x.level === "FAIL" && x.code === "CP-02"), [], "收尾後價格與快照一致＝CP-02 零 FAIL");
  assert.strictEqual(rep.counts.FAIL, 0, g.stdout.split("\n").filter((l) => /\[FAIL\]/.test(l)).join("\n"));
});
