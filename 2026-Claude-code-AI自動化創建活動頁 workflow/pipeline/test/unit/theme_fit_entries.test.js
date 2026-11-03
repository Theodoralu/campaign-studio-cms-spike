"use strict";
/**
 * 主題契合一把尺（lib/theme_fit）＋ curate_auto --themeFit 入口預過濾（ENTRY-THEMEFIT-SELF-CHECK，2026-09-28）
 * 病例＝2026-09-28-wb-140838：系統自己挑的入口 #3（百貨週年慶，20 件只 1 件星巴克）被自己的 CP-14 判 5%＜30% FAIL，使用者無從修。
 * 守：①verdict 六種分支與 gate 原邏輯一對一 ②帶 --themeFit＝硬判不過的候選跳過、換下一檔、note 出聲 ③不帶＝逐位元組舊行為（入口照原序）
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs"); const os = require("os"); const path = require("path");
const { execFileSync } = require("child_process");
const PIPE = path.join(__dirname, "..", "..");
const TF = require(path.join(PIPE, "lib", "theme_fit.js"));
const CLI = path.join(PIPE, "workbench", "curate_auto.js");
const SNAP = path.join(PIPE, "test", "fixtures", "gate_pass_snapshot.json");

const mk = (actid, names) => names.map((n, i) => ({ gdid: String(actid) + String(i).padStart(2, "0"), name: n, price: 100 + i, marketPrice: 200, imgs: [`https://img.yec.tw/${actid}-${i}.jpg`], url: `https://tw.buy.yahoo.com/gdsale/gdsale.asp?gdid=${actid}${String(i).padStart(2, "0")}`, actid: String(actid) }));
const fit = { keywords: ["鍋具"], threshold: 0.3, source: "test" };
const snapA = { promotions: [{ actid: "1", title: "週年慶滿額折" }, { actid: "2", title: "鍋具節" }], products: [...mk("1", ["毛巾", "襪子", "拖鞋", "牙刷", "肥皂", "鍋具刷"]), ...mk("2", ["鍋具 A", "鍋具 B", "鍋具 C", "鍋具 D", "鍋具 E", "杯子"]), ...mk("3", ["鍋具 X", "鍋具 Y"])] };

test("entryFitVerdict：title／no-pool／no-global-hit／small-pool／pass／fail 六種分支", () => {
  assert.strictEqual(TF.entryFitVerdict({ actid: "2", title: "鍋具節", snap: snapA, themeFit: fit }).kind, "title", "活動標題含詞＝過");
  assert.strictEqual(TF.entryFitVerdict({ actid: "9", title: "沒有池", snap: snapA, themeFit: fit }).kind, "no-pool");
  assert.strictEqual(TF.entryFitVerdict({ actid: "1", title: "週年慶", snap: snapA, themeFit: { keywords: ["飛機"], threshold: 0.3 } }).kind, "no-global-hit", "全池零命中＝比對不可施作");
  assert.strictEqual(TF.entryFitVerdict({ actid: "3", title: "小池", snap: snapA, themeFit: fit }).kind, "small-pool");
  const f = TF.entryFitVerdict({ actid: "1", title: "週年慶滿額折", snap: snapA, themeFit: fit });
  assert.strictEqual(f.kind, "fail"); assert.strictEqual(f.hits, 1); assert.strictEqual(f.total, 6);
  const p = TF.entryFitVerdict({ actid: "2", title: "無關標題", snap: snapA, themeFit: fit });
  assert.strictEqual(p.kind, "pass"); assert.strictEqual(p.hits, 5);
  assert.strictEqual(TF.entryFitVerdict({ actid: 1, title: "x", snap: snapA, themeFit: fit, strictActid: true }).kind, "no-pool", "strictActid＝gate 原本的 === 比對（數字 1 對不到字串 \"1\"）");
  assert.strictEqual(TF.entryFitVerdict({ actid: 1, title: "x", snap: snapA, themeFit: fit }).kind, "fail", "curate 端 String() 比對＝對得到");
});

test("loadThemeFitRule：斜線別名展開＋小寫；threshold 數值或 {B_poolHitRate}；讀不到＝fallback", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tf-"));
  const f = path.join(dir, "feedback_patch.json");
  fs.writeFileSync(f, JSON.stringify({ themeFitRule: { keywords: ["Titanium/TITANIUM", "鈦"], threshold: { B_poolHitRate: 0.5 } } }));
  const r = TF.loadThemeFitRule(f, null);
  assert.deepStrictEqual(r.keywords, ["titanium", "鈦"]); assert.strictEqual(r.threshold, 0.5);
  assert.strictEqual(TF.loadThemeFitRule(path.join(dir, "nope.json"), null), null);
  fs.rmSync(dir, { recursive: true, force: true });
});

/* 真 CLI：夾具快照多加四檔活動（各 6 件、有圖、在線）——X 池 6 件只 1 件命中（該被跳過）、Y／Z／W 命中足 */
function runCli(withFit) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "curate-tf-"));
  const snap = JSON.parse(fs.readFileSync(SNAP, "utf8"));
  const far = Math.floor(Date.now() / 1000) + 86400 * 30;
  const acts = [["900001", "週年慶滿額折", ["毛巾", "襪子", "拖鞋", "牙刷", "肥皂", "鍋具刷"]], ["900002", "餐廚好物", ["鍋具 1", "鍋具 2", "鍋具 3", "鍋具 4", "鍋具 5", "杯子"]], ["900003", "居家選品", ["鍋具 a", "鍋具 b", "鍋具 c", "鍋具 d", "鍋具 e", "鍋具 f"]], ["900004", "鍋具聯名", ["鍋具 甲", "鍋具 乙", "鍋具 丙", "鍋具 丁", "鍋具 戊", "鍋具 己"]]];
  snap.promotions = acts.map(([actid, title]) => ({ actid, title, short: title, url: `https://tw.buy.yahoo.com/activity/onsale?actid=${actid}`, period: "2026.09.01 ~ 2026.12.31", endTs: far }));
  snap.products = [...acts.flatMap(([actid, , names]) => mk(actid, names)), ...snap.products];
  fs.writeFileSync(path.join(dir, "snapshot.json"), JSON.stringify(snap));
  const fp = path.join(dir, "feedback_patch.json"); fs.writeFileSync(fp, JSON.stringify({ themeFitRule: { keywords: ["鍋具"], threshold: 0.3 } }));
  const args = [CLI, dir, "--scenario", "", "--theme", "鍋具", ...(withFit ? ["--themeFit", fp] : [])];
  const out = execFileSync(process.execPath, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  const draft = JSON.parse(fs.readFileSync(path.join(dir, "draft.json"), "utf8"));
  fs.rmSync(dir, { recursive: true, force: true });
  return { out, draft };
}
test("不帶 --themeFit＝舊行為：入口照快照原序前三檔（含會被 CP-14 判 FAIL 的 900001）", () => {
  const { draft } = runCli(false);
  assert.deepStrictEqual((draft.page.promoEntries || []).map((e) => e.actid), ["900001", "900002", "900003"]);
  assert.ok(!(draft.meta.notes || []).some((n) => /本期活動入口跳過/.test(n)));
});
test("帶 --themeFit：900001（6 件只 1 件跟主題有關＝17%＜30%）跳過、換下一檔補滿三則、note 出聲；標題含詞的 900004 照 C 訊號直接過", () => {
  const { draft } = runCli(true);
  assert.deepStrictEqual((draft.page.promoEntries || []).map((e) => e.actid), ["900002", "900003", "900004"]);
  const note = (draft.meta.notes || []).find((n) => /本期活動入口跳過 actid 900001/.test(n));
  assert.ok(note, "要出聲說跳過了誰、為什麼：" + JSON.stringify(draft.meta.notes));
  assert.match(note, /6 件只有 1 件跟主題有關（17%＜30%）/);
});
