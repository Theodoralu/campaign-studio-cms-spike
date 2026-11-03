"use strict";
/**
 * lib/hero_combo.js 單元測試（51 號 W1-D，2026-08-25；hermetic＝mkdtemp 最小登記簿，沿 layout_choice.test.js 模式）
 * 守的邏輯：
 *   ①搬家/暫存/還原不變式：A→B→A 與 A→B→C→A page 深度 diff=0（九版式任取 3 組＝D3）
 *   ②機器可再生內容（預設補槽）換走不佔暫存；使用者內容才入暫存
 *   ③預設補槽不覆蓋搬家內容　④legacy 態：不改動＝零寫入；legacy→v2 固定對映；切回＝kv 全量還原
 *   ⑤真值鎖定：products[] 價格/URL、kv.dateValue/actid 逐欄不受任何切換影響（D5）
 *   ⑥背景處置：一般換版式＝保留＋池外黃燈句；kinRef 008↔009 特例＝池外換對方預設（51 §2.14）
 *   ⑦驗證負向：未知版式/停收/未知背景/rejected 主題＝throw　⑧寫入失敗＝throw（D9/鐵律 3）
 *   ⑨理由行履歷（§2.12）：手動改選保留原 AI 建議
 */
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const HC = require("../../lib/hero_combo");
const L = require("../../lib/layout_choice");

/* ---------- hermetic 登記簿（形狀照抄真檔 manifest v0.5.0） ---------- */
function layoutRec(id, over = {}) {
  return {
    id, thumbnail: `design-assets/layouts/thumbs/${id}.png`, name: `版式${id.slice(-3)}`,
    skeleton: "測試骨架", skin: "測試皮膚", useWhen: ["促銷"], backgroundType: 1,
    defaultBackground: "bg-005", backgroundPool: [], kinRef: null,
    slots: [{ key: "discount-digit", label: "關", state: "off" }],
    ...over,
  };
}
function buildFixtures(tweak = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hero-combo-fixture-"));
  const files = {
    modules: { modules: [{ module_id: "hero", variants: [
      { variant_id: "new" }, { variant_id: "legacy" },
      ...["001", "002", "003", "004", "005", "006", "007", "008", "009"].map((n) => ({ variant_id: `layout-${n}`, rollout: "trial" })),
    ] }] },
    layouts: { assets: [
      layoutRec("layout-001", { slots: [{ key: "product-left" }, { key: "title-center" }, { key: "time-band", state: "on" }, { key: "discount-digit", state: "off" }, { key: "product-right" }] }),
      layoutRec("layout-002", { defaultBackground: "bg-008", backgroundPool: ["bg-009", "bg-016"], kinRef: { promo: "layout-003" },
        slots: [{ key: "product-left" }, { key: "title-center" }, { key: "time-band", state: "off" }, { key: "discount-digit", state: "off" }, { key: "product-right" }] }),
      layoutRec("layout-003", { defaultBackground: "bg-008", backgroundPool: ["bg-009", "bg-016"], kinRef: { base: "layout-002" },
        slots: [{ key: "product-left" }, { key: "title-center" }, { key: "time-band", state: "on" }, { key: "discount-digit", state: "on" }, { key: "product-right" }] }),
      layoutRec("layout-004", { slots: [{ key: "slogan-left" }, { key: "collage-right" }, { key: "sub-capsule", state: "on" }] }),
      layoutRec("layout-005", { defaultBackground: "bg-009", slots: [{ key: "product-left" }, { key: "title-center" }, { key: "time-band", state: "on" }, { key: "product-right" }] }),
      layoutRec("layout-006", { kinRef: { promo: "layout-007" }, slots: [{ key: "title-center" }, { key: "item-ring" }, { key: "time-band", state: "off" }, { key: "discount-digit", state: "off" }] }),
      layoutRec("layout-007", { kinRef: { base: "layout-006" }, slots: [{ key: "title-center" }, { key: "item-ring" }, { key: "time-band", state: "on" }, { key: "discount-digit", state: "on" }] }),
      layoutRec("layout-008", { defaultBackground: "bg-017", backgroundPool: ["bg-006", "bg-018"], backgroundType: 2, kinRef: { promo: "layout-009" },
        slots: [{ key: "slogan-left" }, { key: "product-main" }, { key: "discount-digit", state: "off" }] }),
      layoutRec("layout-009", { defaultBackground: "bg-018", backgroundPool: ["bg-007", "bg-017"], backgroundType: 2, kinRef: { base: "layout-008" },
        slots: [{ key: "slogan-left" }, { key: "product-main" }, { key: "discount-digit", state: "on" }] }),
    ] },
    backgrounds: { assets: [
      { id: "bg-005", name: "灰底幾何", license: "A" },
      { id: "bg-006", name: "引言色塊", license: "C" },
      { id: "bg-007", name: "灰棚促銷", license: "C" },
      { id: "bg-008", name: "玻璃簾幕", license: "B", reviewDate: "2026-08-24", qaStatus: "pass" },
      { id: "bg-009", name: "環形燈圈", license: "B", reviewDate: "2026-08-24", qaStatus: "pass" },
      { id: "bg-016", name: "純白方塊牆", license: "B", reviewDate: "2026-08-24", qaStatus: "pass" },
      { id: "bg-017", name: "雙弧光帶", license: "B", reviewDate: "2026-08-24", qaStatus: "pass-with-note" },
      { id: "bg-018", name: "直線V形光", license: "B", reviewDate: "2026-08-24", qaStatus: "pass" },
    ] },
    fonts: { assets: [{ id: "font-001" }] },
    motion: { assets: [{ id: "motion-001" }] },
    tokens: { themes: [{ slug: "green-light" }, { slug: "gold-dark" }, { slug: "japanese" }, { slug: "blue-dark", rejected: true }] },
    ...tweak,
  };
  const P = {};
  for (const [k, v] of Object.entries(files)) {
    P[k] = path.join(dir, k + ".json");
    fs.writeFileSync(P[k], JSON.stringify(v));
  }
  return { paths: P, dir };
}
/* depsWith 預設把「完工名單」全開＝隔離變因（搬家/暫存/背景等既有語意測試不受滾動上架制干擾）；
   引擎完工閘專屬測試自行縮 deps.engineReady（沿 layout_choice.test.js ALL_READY 縫模式）。 */
const ALL_READY = ["new", "legacy", ...["001", "002", "003", "004", "005", "006", "007", "008", "009"].map((n) => `layout-${n}`)];
const depsWith = (tweak, ready) => { const d = L.loadLayoutDeps(buildFixtures(tweak).paths); d.engineReady = new Set(ready || ALL_READY); return d; };

/* 測試用 draft：products 真值欄齊全（價格/URL＝D5 鎖定斷言對象） */
function mkDraft(over = {}) {
  return {
    page: {
      pageName: "測試活動頁",
      kvVariant: "layout-002",
      kv: { titleLine1: "法式餐桌", titleLine2: "開伙好日子", eyebrowZh: "嚴選餐廚", eyebrow: "LA TABLE",
        dateValue: "08/20–09/30", actid: "act-123", keyProductGdids: ["1", "2", "3"] },
      /* 商品序刻意≠商品池預設序（["1","2"]/["3","4"]）：與機器預設逐字相同的內容＝可再生、換走不入暫存
         （行為正確——本測試要驗「使用者內容」的暫存/還原，值必須是使用者改過的樣子） */
      hero: { "product-left": { gdids: ["2", "5"] }, "title-center": "使用者改過的主標\n使用者副標", "product-right": { gdids: ["4", "1"] } },
      floors: [], walls: [],
      ...over,
    },
    products: [
      { gdid: "1", name: "鑄鐵鍋", price: 4290, url: "https://tw.buy.yahoo.com/gdsale/p-1.html" },
      { gdid: "2", name: "炒鍋", price: 1990, url: "https://tw.buy.yahoo.com/gdsale/p-2.html" },
      { gdid: "3", name: "清酒杯", price: 690, url: "https://tw.buy.yahoo.com/gdsale/p-3.html" },
      { gdid: "4", name: "砂鍋", price: 2490, url: "https://tw.buy.yahoo.com/gdsale/p-4.html" },
      { gdid: "5", name: "保鮮盒", price: 399, url: "https://tw.buy.yahoo.com/gdsale/p-5.html" },
    ],
    meta: { layoutChoice: { by: "ai", reason: "AI 代選：情境→版式002（51 號附錄 B）", decidedAt: "2026-08-24T00:00:00Z" } },
  };
}
const clone = (o) => JSON.parse(JSON.stringify(o));
const sw = (dj, kv, deps) => HC.applyCombo(dj, { kvVariant: kv }, deps);

/* ---------- ①搬家不變式：A→B→A 與 A→B→C→A page 深度 diff=0（D3；三組不同骨架對） ---------- */
for (const [A, B] of [["layout-002", "layout-004"], ["layout-006", "layout-008"], ["layout-001", "layout-004"]]) {
  test(`搬家不變式 ${A}→${B}→${A}：page 深度 diff=0（暫存收使用者內容、換回全還原）`, () => {
    const deps = depsWith();
    const dj = mkDraft({ kvVariant: A });
    if (A !== "layout-002") { // 讓起點 hero 對齊 A 的槽（用使用者自訂值＝必須走暫存不可被丟）
      dj.page.hero = A === "layout-006"
        ? { "title-center": "使用者主標", "item-ring": { gdids: ["4", "2", "1", "5"] } }
        : { "product-left": { gdids: ["2", "5"] }, "title-center": "使用者主標", "product-right": { gdids: ["4", "1"] } };
    }
    const before = clone(dj.page);
    sw(dj, B, deps);
    assert.notDeepStrictEqual(clone(dj.page), before, "A→B 必須有變化（防測試空轉）");
    sw(dj, A, deps);
    assert.deepStrictEqual(clone(dj.page), before, "A→B→A page 必須逐字還原");
  });
}

/* ---------- 排版檔位：行距兩檔（2026-09-04 晚場，使用者報「行距不能調整」） ---------- */
test("排版檔位：heroTitleLeading／heroSubtitleLeading 寫進 page.typography；標準檔或 null＝清欄；非檔位值＝白話 throw", () => {
  const deps = depsWith();
  const dj = mkDraft({ kvVariant: "layout-002" });
  HC.applyCombo(dj, { heroTitleLeading: "lg", heroSubtitleLeading: "sm" }, deps);
  assert.deepStrictEqual(dj.page.typography, { titleLeading: "lg", subtitleLeading: "sm" });
  HC.applyCombo(dj, { heroTitleLeading: "md", heroSubtitleLeading: null }, deps);
  assert.strictEqual(dj.page.typography, undefined, "全回標準檔＝欄位不留");
  assert.throws(() => HC.applyCombo(dj, { heroTitleLeading: "1.25" }, deps), /標題行距只能選固定檔位/);
});

/* ---------- 排版檔位：字距（2026-09-05，使用者指示「四支控制每一款字風都要調得動」） ----------
   為什麼要有這條：字距那張檔位表是**加減制**（em），不是像字級／行距／寬度那樣的乘法表。
   原本 applyCombo 用「mul === 1」反推哪一檔是標準檔——遇到沒有 mul 欄的表會直接炸。
   判準改成寫在表自己身上的 default 旗標；這條測試就是釘住這件事。 */
test("排版檔位：heroTitleTracking 寫進 page.typography；標準檔或 null＝清欄；非檔位值＝白話 throw", () => {
  const deps = depsWith();
  const dj = mkDraft({ kvVariant: "layout-002" });
  HC.applyCombo(dj, { heroTitleTracking: "lg" }, deps);
  assert.deepStrictEqual(dj.page.typography, { titleTracking: "lg" });
  HC.applyCombo(dj, { heroTitleTracking: "md" }, deps);
  assert.strictEqual(dj.page.typography, undefined, "回標準檔＝欄位不留");
  HC.applyCombo(dj, { heroTitleTracking: "sm" }, deps);
  assert.deepStrictEqual(dj.page.typography, { titleTracking: "sm" });
  HC.applyCombo(dj, { heroTitleTracking: null }, deps);
  assert.strictEqual(dj.page.typography, undefined, "null＝欄位不留");
  assert.throws(() => HC.applyCombo(dj, { heroTitleTracking: "8%" }, deps), /標題字距只能選固定檔位/);
});

test("檔位表每一張都要自己說哪一檔是標準（default 旗標）——少一張就會在 applyCombo 炸掉", () => {
  const TD = require("../../lib/theme_draft.js");
  for (const [name, steps] of [["字級", TD.TYPO_SCALE_STEPS], ["標題寬", TD.TITLE_WIDTH_STEPS],
    ["行距", TD.TYPO_LEADING_STEPS], ["字距", TD.TYPO_TRACKING_STEPS]]) {
    const d = steps.filter((s) => s.default);
    assert.strictEqual(d.length, 1, `${name}檔位表要剛好一檔標為 default（現在 ${d.length} 檔）`);
  }
  assert.strictEqual(TD.TYPO_TRACKING_STEPS.find((s) => s.default).em, 0, "字距標準檔＝不加不減");
  assert.ok(TD.TYPO_TRACKING_STEPS.every((s) => typeof s.em === "number"), "字距是加減制＝每一檔都要有 em 值");
});

test("四支排版控制的檔位表與渲染端 hv2TypoMul 的複本同值（人肉同步的斷裂偵測）", () => {
  const TD = require("../../lib/theme_draft.js");
  const ft = fs.readFileSync(path.join(__dirname, "..", "..", "..", "..", "2026-AI自動化活動頁生成規劃",
    "MVP_Phase1_LeCreuset_活動頁Prototype_FrameTest.html"), "utf8");
  const grab = (re, what) => { const m = ft.match(re); assert.ok(m, `FrameTest 找不到${what}的複本表——改名了？`); return m[1]; };
  const S = grab(/const S = \{ sm: ([\d.]+), md: 1, lg: [\d.]+ \}/, "字級檔位");
  assert.strictEqual(Number(S), TD.TYPO_SCALE_STEPS.find((x) => x.id === "sm").mul, "字級 sm 兩處不同值");
  const L = grab(/L = \{ sm: ([\d.]+), md: 1, lg: [\d.]+ \}/, "行距檔位");
  assert.strictEqual(Number(L), TD.TYPO_LEADING_STEPS.find((x) => x.id === "sm").mul, "行距 sm 兩處不同值");
  const K = grab(/const K = \{ sm: (-?[\d.]+), md: 0, lg: [\d.]+ \}/, "字距檔位");
  assert.strictEqual(Number(K), TD.TYPO_TRACKING_STEPS.find((x) => x.id === "sm").em, "字距 sm 兩處不同值");
});

test("搬家不變式 A→B→C→A：page 深度 diff=0", () => {
  const deps = depsWith();
  const dj = mkDraft(); // A=002
  const before = clone(dj.page);
  sw(dj, "layout-004", deps);
  sw(dj, "layout-006", deps);
  sw(dj, "layout-002", deps);
  assert.deepStrictEqual(clone(dj.page), before);
});

/* ---------- ②暫存語意：搬不過去＝入暫存（不渲染節點）；機器預設內容＝不佔暫存 ---------- */
test("換版式：同名槽直搬、使用者內容入暫存、目標缺槽補預設（不覆蓋搬家內容）", () => {
  const deps = depsWith();
  const dj = mkDraft(); // 002: product-left/title-center/product-right（皆使用者內容）
  const r = sw(dj, "layout-006", deps); // 006: title-center/item-ring
  assert.strictEqual(dj.page.kvVariant, "layout-006");
  assert.strictEqual(dj.page.hero["title-center"], "使用者改過的主標\n使用者副標", "同名槽直搬");
  assert.deepStrictEqual(dj.page.heroSlotStash["product-left"], { gdids: ["2", "5"] }, "搬不過去＝入暫存");
  assert.deepStrictEqual(dj.page.heroSlotStash["product-right"], { gdids: ["4", "1"] });
  assert.ok(dj.page.hero["item-ring"] && dj.page.hero["item-ring"].gdids.length === 4, "目標缺槽＝預設補槽（商品池前 4 件）");
  assert.ok(r.info.stashedKeys.includes("product-left") && r.info.filledKeys.includes("item-ring"));
});

test("機器預設內容換走＝直接丟（可再生），不佔暫存", () => {
  const deps = depsWith();
  const dj = mkDraft();
  sw(dj, "layout-006", deps); // item-ring＝機器補的預設
  const stashKeysBefore = Object.keys(dj.page.heroSlotStash);
  sw(dj, "layout-002", deps); // 換回：item-ring 是預設值＝丟（droppedKeys）非暫存
  assert.deepStrictEqual(Object.keys(dj.page.heroSlotStash || {}), [], "預設 item-ring 不得殘留暫存");
  assert.ok(stashKeysBefore.length >= 2, "前置確認：002 的商品槽確實曾入暫存");
});

test("預設補槽不覆蓋暫存還原內容（還原優先）", () => {
  const deps = depsWith();
  const dj = mkDraft();
  dj.page.hero["title-center"] = "自訂標題";
  sw(dj, "layout-004", deps); // title-center 入暫存（004 無此槽）
  assert.strictEqual(dj.page.heroSlotStash["title-center"], "自訂標題");
  sw(dj, "layout-006", deps); // 006 有 title-center：自暫存還原、預設（pageName）不得蓋掉
  assert.strictEqual(dj.page.hero["title-center"], "自訂標題");
});

/* ---------- ③換回還原＝restoredGdids（強制重驗的名單來源＝D4） ---------- */
test("換回還原：restoredGdids 列出自暫存回到頁面的商品", () => {
  const deps = depsWith();
  const dj = mkDraft();
  sw(dj, "layout-004", deps);
  const r = sw(dj, "layout-002", deps);
  assert.deepStrictEqual([...new Set(r.info.restoredGdids)].sort(), ["1", "2", "4", "5"]);
});

/* ---------- ④legacy 態（D7） ---------- */
test("legacy 態：kvVariant 缺席＋選『現行版型』＝零變更（不寫檔）", () => {
  const deps = depsWith();
  const dj = mkDraft({ kvVariant: undefined });
  delete dj.page.kvVariant; delete dj.page.hero;
  const before = clone(dj);
  const r = HC.applyCombo(dj, { kvVariant: "new" }, deps);
  assert.strictEqual(r.changed, false);
  assert.deepStrictEqual(clone(dj), before, "legacy 不改動＝draft 零 diff");
});

test("legacy→v2：固定對映（主標＋副標→標題槽、主打商品→商品槽）；切回＝kv 未動全量還原", () => {
  const deps = depsWith();
  const dj = mkDraft({ kvVariant: undefined });
  delete dj.page.kvVariant; delete dj.page.hero;
  const kvBefore = clone(dj.page.kv);
  HC.applyCombo(dj, { kvVariant: "layout-002" }, deps);
  assert.strictEqual(dj.page.hero["title-center"], "法式餐桌開伙好日子\n嚴選餐廚", "主標（兩行相連）＋副標（眉標中文）→標題槽");
  assert.deepStrictEqual(dj.page.hero["product-left"], { gdids: ["1", "2"] }, "kv 主打商品→商品槽（依骨架容量順填）");
  assert.deepStrictEqual(dj.page.hero["product-right"], { gdids: ["3"] });
  assert.deepStrictEqual(dj.page.kv, kvBefore, "kv 節點不動（休眠非搬空）");
  HC.applyCombo(dj, { kvVariant: "legacy" }, deps);
  assert.deepStrictEqual(dj.page.kv, kvBefore, "切回＝kv 全量還原（原本就沒動過）");
  assert.strictEqual(dj.page.hero, undefined, "切回＝hero 節點收起");
  assert.deepStrictEqual(dj.page.heroSlotStash, undefined, "對映內容可再生＝不佔暫存");
});

/* ---------- ⑤真值鎖定（D5）：任何切換不碰 products[] 與 kv 真值欄 ---------- */
test("真值鎖定：連續切換後 products[] 價格/URL、kv.dateValue/actid 逐欄原值", () => {
  const deps = depsWith();
  const dj = mkDraft();
  const productsBefore = clone(dj.products);
  const truthBefore = { dateValue: dj.page.kv.dateValue, actid: dj.page.kv.actid };
  for (const t of ["layout-004", "layout-008", "layout-006", "layout-003", "layout-002"]) sw(dj, t, deps);
  assert.deepStrictEqual(clone(dj.products), productsBefore);
  assert.strictEqual(dj.page.kv.dateValue, truthBefore.dateValue);
  assert.strictEqual(dj.page.kv.actid, truthBefore.actid);
});

/* ---------- ⑥背景處置 ---------- */
test("一般換版式：明選背景池外＝保留＋黃燈句（彈性三原則，不阻擋）", () => {
  const deps = depsWith();
  const dj = mkDraft();
  dj.page.backgroundId = "bg-005"; // 不在 006 的池（006 池空、預設 bg-005……改用 002 池外值）
  dj.page.backgroundId = "bg-017"; // 不在 002→006 目標池
  const r = sw(dj, "layout-006", deps);
  assert.strictEqual(dj.page.backgroundId, "bg-017", "一般切換＝保留使用者原選");
  assert.ok(r.info.notes.some((n) => /不是.*建議背景.*保留/.test(n)), "黃燈句必須講明（顯示名稱、不印貨號裸碼）");
  assert.ok(r.info.notes.some((n) => /「雙弧光帶」/.test(n)), "黃燈句用登記簿名稱稱呼背景（bg-017＝雙弧光帶）");
});

test("kinRef 008↔009 特例：原選在對方池內＝保留；池外＝換對方預設＋黃燈（51 §2.14）", () => {
  const deps = depsWith();
  const dj = mkDraft({ kvVariant: "layout-008" });
  dj.page.hero = { "slogan-left": "話題標語", "product-main": { gdids: ["1"] } };
  dj.page.backgroundId = "bg-017"; // 在 009 的池（bg-007/bg-017）＝保留
  sw(dj, "layout-009", deps);
  assert.strictEqual(dj.page.backgroundId, "bg-017");
  const dj2 = mkDraft({ kvVariant: "layout-008" });
  dj2.page.hero = { "slogan-left": "話題標語", "product-main": { gdids: ["1"] } };
  dj2.page.backgroundId = "bg-005"; // 不在 009 的池＝換對方預設
  const r2 = sw(dj2, "layout-009", deps);
  assert.strictEqual(dj2.page.backgroundId, "bg-018");
  assert.ok(r2.info.notes.some((n) => /對換特例/.test(n)));
});

test("背景/主題改選：合法值寫入、null＝清除回預設；主題 rejected/未知＝throw", () => {
  const deps = depsWith();
  const dj = mkDraft();
  HC.applyCombo(dj, { backgroundId: "bg-009", themeId: "green-light" }, deps);
  assert.strictEqual(dj.page.backgroundId, "bg-009");
  assert.strictEqual(dj.page.themeId, "green-light");
  HC.applyCombo(dj, { backgroundId: null, themeId: null }, deps);
  assert.ok(!("backgroundId" in dj.page) && !("themeId" in dj.page), "null＝欄位清除（回版式預設）");
  assert.throws(() => HC.applyCombo(dj, { themeId: "blue-dark" }, deps), /主題系統不認得/, "rejected 主題不收（錯誤白話先講、代號收技術括號）");
  assert.throws(() => HC.applyCombo(dj, { backgroundId: "bg-999" }, deps), /背景系統不認得/);
});

/* ---------- ⑦版式驗證負向 ---------- */
test("換版式負向：未知貨號／rollout closed＝throw（出貨可選判定與表單同套；文案白話先講、代號收技術括號）", () => {
  assert.throws(() => sw(mkDraft(), "layout-999", depsWith()), /版面代號系統不認得/);
  const depsClosed = depsWith({ modules: { modules: [{ module_id: "hero", variants: [
    { variant_id: "new" }, { variant_id: "legacy" },
    ...["001", "002", "003", "004", "005", "006", "007", "008", "009"].map((n) => ({ variant_id: `layout-${n}`, rollout: n === "004" ? "closed" : "trial" })),
  ] }] } });
  assert.throws(() => sw(mkDraft(), "layout-004", depsClosed), /暫停使用/);
});

/* ---------- ⑦b 引擎完工閘（滾動上架制 2026-08-25；review M1）：面板換版式／提案包帶入同吃 ENGINE 完工名單＝無後門 ---------- */
test("引擎完工閘：換到未完工版式＝白話擋；提案包帶入未完工＝同一道閘擋；完工一款＝解鎖一款", () => {
  const deps = depsWith(undefined, ["new", "legacy", "layout-006"]); // 現實名單形（draft 現值 002 未完工＝不影響原地編修）
  const dj = mkDraft(); // 現值 layout-002（未完工）——只改背景主題＝不受閘限制（閘只管「換過去」的目標）
  assert.strictEqual(HC.applyCombo(dj, { backgroundId: "bg-009" }, deps).changed, true, "未完工現值仍可改背景主題");
  assert.throws(() => sw(mkDraft(), "layout-004", deps), /還在製作中/, "手動換到未完工＝白話擋");
  const packed = HC.packToChange(JSON.stringify({ version: 1, layout: "layout-004" }), deps.registries);
  assert.ok(packed.ok, "前置確認：提案包格式/值域驗證本身不管完工（各管各的）");
  assert.throws(() => HC.applyCombo(mkDraft(), packed.change, deps), /還在製作中/, "提案包帶入未完工＝同閘擋（M1 後門收口）");
  deps.engineReady.add("layout-004");
  assert.strictEqual(HC.applyCombo(mkDraft(), { kvVariant: "layout-004" }, deps).changed, true, "完工一款＝自動解鎖");
});

/* ---------- ⑧寫檔路（writeComboIntoDraft）：讀不到／寫不進＝throw；成功＝落版備份 ---------- */
test("writeComboIntoDraft：draft 讀不到＝throw（D9 失敗要出聲）", () => {
  const deps = depsWith();
  assert.throws(() => HC.writeComboIntoDraft(path.join(os.tmpdir(), "not-exist-w1d", "draft.json"), { kvVariant: "layout-006" }, deps), /讀取草稿/);
});

test("writeComboIntoDraft：成功＝寫回＋draft.v1 備份；沒有變更＝不寫檔", () => {
  const deps = depsWith();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hero-combo-run-"));
  const dp = path.join(dir, "draft.json");
  fs.writeFileSync(dp, JSON.stringify(mkDraft(), null, 1));
  const r = HC.writeComboIntoDraft(dp, { kvVariant: "layout-006" }, deps);
  assert.strictEqual(r.changed, true);
  assert.strictEqual(r.backup, "draft.v1.json");
  assert.ok(fs.existsSync(path.join(dir, "draft.v1.json")));
  const onDisk = JSON.parse(fs.readFileSync(dp, "utf8"));
  assert.strictEqual(onDisk.page.kvVariant, "layout-006");
  const mtime = fs.statSync(dp).mtimeMs;
  const r2 = HC.writeComboIntoDraft(dp, { kvVariant: "layout-006" }, deps); // 同值＝零變更
  assert.strictEqual(r2.changed, false);
  assert.strictEqual(fs.statSync(dp).mtimeMs, mtime, "零變更＝不碰檔案");
});

test("writeComboIntoDraft：寫入失敗＝throw（備份目錄不可寫）", () => {
  const deps = depsWith();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hero-combo-ro-"));
  const dp = path.join(dir, "draft.json");
  fs.writeFileSync(dp, JSON.stringify(mkDraft(), null, 1));
  fs.chmodSync(dir, 0o500); // 目錄唯讀＝draft.v1 備份與回寫都寫不進
  try {
    assert.throws(() => HC.writeComboIntoDraft(dp, { kvVariant: "layout-006" }, deps), /寫入草稿/);
  } finally { fs.chmodSync(dir, 0o700); }
});

/* ---------- ⑨理由行履歷（§2.12） ---------- */
test("面板改選＝meta.layoutChoice 換手動履歷、原 AI 建議保留（aiOriginal）＋舊履歷入 log", () => {
  const deps = depsWith();
  const dj = mkDraft();
  HC.applyCombo(dj, { kvVariant: "layout-006" }, deps);
  const lc = dj.meta.layoutChoice;
  assert.strictEqual(lc.by, "manual");
  assert.match(lc.reason, /組合面板改選/);
  assert.match(lc.aiOriginal, /AI 代選/);
  assert.strictEqual(dj.meta.layoutChoiceLog.length, 1);
  /* 顯示欄雙欄制（2026-08-25 文案條款；review M3）：reasonDisplay＝介面用、禁貨號/文件編號絆線 */
  assert.match(lc.reasonDisplay, /你在編修頁改了版式/);
  assert.match(lc.reasonDisplay, /「版式006」/, "顯示欄用登記簿名稱稱呼版式");
  assert.doesNotMatch(lc.reasonDisplay, /layout-\d{3}|bg-\d{3}|§|\b51 號|CP-\d/, "顯示欄禁貨號與文件編號");
});

/* ---------- ⑩提案包→組合變更（D6 第四路徑） ---------- */
test("packToChange：合法包＝整組帶入（layout/background/theme＋qaStatus 黃燈映射）；非法＝逐條出聲", () => {
  const deps = depsWith();
  const ok = HC.packToChange(JSON.stringify({ version: 1, layout: "layout-006", background: "bg-009", theme: "green-light", qaStatus: "candidate-pass" }), deps.registries);
  assert.ok(ok.ok);
  assert.strictEqual(ok.change.kvVariant, "layout-006");
  assert.strictEqual(ok.change.backgroundId, "bg-009");
  assert.strictEqual(ok.change.themeId, "green-light");
  assert.strictEqual(ok.change.heroQaStatus, "candidate-pass");
  const warn = HC.packToChange(JSON.stringify({ version: 1, layout: "layout-006", qaStatus: "needs-review" }), deps.registries);
  assert.ok(warn.ok);
  assert.strictEqual(warn.change.heroQaStatus, "needs-review", "qaStatus 非綠＝黃燈帶入");
  const bad = HC.packToChange(JSON.stringify({ version: 1, layout: "layout-xxx" }), deps.registries);
  assert.strictEqual(bad.ok, false);
  assert.ok(bad.errors.length);
});

/* ---------- ⑪R4 四路徑 table-driven（D6）：四種變更形全部走同一寫入口＝changed:true→端點單點 invalidateApproval；
   allow 檔登錄絆線＝combo-apply 行在案（寫入點登記制） ---------- */
test("R4 四路徑 table-driven：換版式/折扣開關/貼提案包/改背景主題＝全 changed（單一寫入口必觸發核可失效）", () => {
  const deps = depsWith();
  const packed = HC.packToChange(JSON.stringify({ version: 1, layout: "layout-005", background: "bg-009", theme: "gold-dark", qaStatus: "candidate-pass" }), deps.registries);
  const rows = [
    ["換版式", { kvVariant: "layout-004" }],
    ["折扣開關（kinRef 對換 002→003）", { kvVariant: "layout-003" }],
    ["貼提案包（整組帶入）", packed.change],
    ["面板改背景主題", { backgroundId: "bg-009", themeId: "green-light" }],
  ];
  for (const [name, change] of rows) {
    const r = HC.applyCombo(mkDraft(), change, deps);
    assert.strictEqual(r.changed, true, `${name} 必須 changed=true（端點據此 invalidateApproval）`);
  }
  const allow = fs.readFileSync(path.join(__dirname, "..", "..", "scripts", "draft-writers.allow"), "utf8");
  assert.match(allow, /combo-apply\s+lib\/hero_combo\.js\s+writeComboIntoDraft\s+invalidateApproval ✓/, "寫入點必須登錄 draft-writers.allow（絆線）");
});

/* ---------- ⑫偏離標記（51 §2.13 語意；review M2）：帶入過提案包＋手動改＝deviated:true；
   語意邊界＝一經手動改動即偏離（改回原值不自動復位）；重貼提案包＝重新對齊歸 false ---------- */
test("偏離標記：pack 帶入＝false；手動改＝翻 true＋note；零變更不翻；無包在案不生欄；重貼包＝重新對齊", () => {
  const deps = depsWith();
  const packed = HC.packToChange(JSON.stringify({ version: 1, layout: "layout-005", background: "bg-009", theme: "gold-dark", qaStatus: "candidate-pass" }), deps.registries);
  const dj = mkDraft();
  HC.applyCombo(dj, packed.change, deps);
  assert.strictEqual(dj.meta.proposalPack.deviated, false, "pack 帶入＝未偏離");
  const r0 = HC.applyCombo(dj, { themeId: "gold-dark" }, deps); // 手動送同值＝零變更
  assert.strictEqual(r0.changed, false);
  assert.strictEqual(dj.meta.proposalPack.deviated, false, "零變更＝不翻偏離");
  const r1 = HC.applyCombo(dj, { themeId: "green-light" }, deps); // 手動真改
  assert.strictEqual(dj.meta.proposalPack.deviated, true, "手動改動＝翻偏離");
  assert.match(dj.meta.proposalPack.deviatedNote, /手動改動/);
  assert.ok(dj.meta.proposalPack.deviatedAt, "偏離時刻入檔（審計）");
  assert.ok(r1.info.notes.some((n) => /已偏離提案包/.test(n)), "面板黃燈句講明偏離");
  assert.deepStrictEqual(dj.meta.proposalPack.pack, packed.pack, "包內容原樣保留（只標記不塗改）");
  const r2 = HC.applyCombo(dj, { backgroundId: "bg-016" }, deps); // 已偏離再改＝不重複刷欄
  assert.strictEqual(dj.meta.proposalPack.deviated, true);
  assert.ok(!r2.info.notes.some((n) => /已偏離提案包/.test(n)), "已偏離者不重複出黃燈句（徽章常駐即可）");
  HC.applyCombo(dj, packed.change, deps); // 重貼提案包＝整組帶回＝重新對齊
  assert.strictEqual(dj.meta.proposalPack.deviated, false, "重貼包＝deviated 歸 false");
  const dj2 = mkDraft(); // 反向：沒帶過包的草稿
  HC.applyCombo(dj2, { themeId: "green-light" }, deps);
  assert.strictEqual((dj2.meta || {}).proposalPack, undefined, "無包在案＝手動改不生偏離欄");
});

/* ── 主題單一控制點（2026-08-25 使用者裁決＝兩欄統整）：themeId 同步驅動舊制內容配色＋預設還原 ── */
test("主題統整：家族同名 1:1 對映；無對應款＝內容走預設＋出聲；null＝雙軌回預設（還原鍵）", () => {
  const deps = depsWith();
  const dj = mkDraft();
  HC.applyCombo(dj, { themeId: "green-light" }, deps);
  assert.strictEqual(dj.page.themeId, "green-light");
  assert.strictEqual(dj.page.theme.colorTheme, "green-light", "內容區塊舊制同步 1:1");
  HC.applyCombo(dj, { themeId: "japanese" }, deps);
  assert.strictEqual(dj.page.themeId, "japanese");
  assert.strictEqual(dj.page.theme.colorTheme, "pink-light", "無舊制對應＝內容走預設");
  const r3 = HC.applyCombo(dj, { themeId: null }, deps);
  assert.ok(!("themeId" in dj.page), "還原鍵＝themeId 清空");
  assert.strictEqual(dj.page.theme.colorTheme, "pink-light", "還原鍵＝內容回預設銜接配色");
  assert.ok(r3.info.notes.some((n) => /回復預設配色/.test(n)), "還原出聲");
});

/* ---------- 字風妝容跟主題走（2026-09-05 換妝接線上） ---------- */
test("titleStyleThemed：true 寫入、null/false 清欄、其他值白話 throw", () => {
  const deps = depsWith();
  const dj = mkDraft({ kvVariant: "layout-002" });
  HC.applyCombo(dj, { titleStyleThemed: true }, deps);
  assert.strictEqual(dj.page.titleStyleThemed, true);
  HC.applyCombo(dj, { titleStyleThemed: null }, deps);
  assert.strictEqual(dj.page.titleStyleThemed, undefined, "清欄＝欄位不留");
  HC.applyCombo(dj, { titleStyleThemed: true }, deps);
  HC.applyCombo(dj, { titleStyleThemed: false }, deps);
  assert.strictEqual(dj.page.titleStyleThemed, undefined);
  assert.throws(() => HC.applyCombo(dj, { titleStyleThemed: "yes" }, deps), /字風妝容跟主題走只有開／關兩種/);
});

test("titleGroupWarp：true 寫入、null/false 清欄、其他值白話 throw", () => {
  const deps = depsWith();
  const dj = mkDraft({ kvVariant: "layout-002" });
  HC.applyCombo(dj, { titleGroupWarp: true }, deps);
  assert.strictEqual(dj.page.titleGroupWarp, true);
  HC.applyCombo(dj, { titleGroupWarp: false }, deps);
  assert.strictEqual(dj.page.titleGroupWarp, undefined);
  assert.throws(() => HC.applyCombo(dj, { titleGroupWarp: 1 }, deps), /同組文字一起變形只有開／關兩種/);
});

/* ---------- 2026-09-27：換版式補槽跟建立期同一把尺（病例 run 142315／123617：主視覺右槽第 2 格撞第 1 層情境卡代表品） ---------- */
test("換版式補槽：跳過已在樓層／牆上的商品、補不滿出聲；新舊兩種機器預填換走都算可再生（不佔暫存）；A→B→A 有樓層時仍 diff=0", () => {
  const deps = depsWith();
  /* 賣場編號用 7 碼（真實形狀；情境卡只存 URL、gdidOf 認 6 碼以上——mkDraft 的 1～5 短碼會像「沒有情境卡」一樣被略過） */
  const G = ["7000001", "7000002", "7000003", "7000004", "7000005"];
  const withRealGdids = (dj) => { dj.products = dj.products.map((p, i) => ({ ...p, gdid: G[i] })); dj.page.kv.keyProductGdids = G.slice(0, 3); return dj; };
  const floors = [{ pos: "featured-1", sceneUrl: `https://tw.buy.yahoo.com/gdsale/gdsale.asp?gdid=${G[0]}`, productGdids: [G[1]] }];
  const walls = [{ pos: "category-1", productGdids: [G[2]] }];
  /* ① 002（使用者只填了左槽）→ 006：item-ring 要補 4 件，但 G0（情境卡）、G1（卡）、G2（牆）都在頁上＝只剩 G3、G4 可用 → 放 2 件＋出聲 */
  const dj = withRealGdids(mkDraft({ floors, walls }));
  dj.page.hero = { "title-center": "使用者主標", "product-left": { gdids: [G[3], G[4]] } };
  const r = sw(dj, "layout-006", deps);
  assert.deepStrictEqual(dj.page.hero["item-ring"], { gdids: [G[3], G[4]] }, "跳過已曝光的三件，不拿它們湊數");
  assert.ok(r.info.notes.some((n) => /^環列商品槽放了 2 件，這款要 4 件。/.test(n) && /其餘候選已在樓層或牆上/.test(n)), "補不滿＝白話講哪格少幾件、跳過了什麼：" + JSON.stringify(r.info.notes));
  /* ② 新式預填（避開曝光）換走＝可再生：006→002 時 item-ring 直接丟、不入暫存；A→B→A 深度 diff=0 */
  const dj2 = withRealGdids(mkDraft({ floors, walls }));
  dj2.page.hero = { "product-left": { gdids: [G[3], G[4]] }, "title-center": "使用者改過的主標\n使用者副標", "product-right": { gdids: [G[1], G[0]] } };
  const before = clone(dj2.page);
  sw(dj2, "layout-006", deps);
  const r2 = sw(dj2, "layout-002", deps);
  assert.ok(r2.info.droppedKeys.includes("item-ring"), "新式補的 item-ring＝機器內容、換走直接丟");
  assert.deepStrictEqual(clone(dj2.page), before, "A→B→A 逐字還原");
  /* ③ 舊式預填（2026-09-27 前、照順序切、會撞情境卡）的舊稿換版式：那份也算機器內容、不入暫存 */
  const dj3 = withRealGdids(mkDraft({ floors: [{ pos: "featured-1", sceneUrl: `https://tw.buy.yahoo.com/gdsale/gdsale.asp?gdid=${G[3]}`, productGdids: [] }], walls: [] }));
  const rec002 = deps.registries.layoutRecords.get("layout-002");
  dj3.page.hero = L.defaultHeroForLayout(rec002, dj3.page.pageName, dj3.products, dj3.page.kv); // 舊演算法：右槽＝[G2,G3]，G3 是情境卡代表品
  assert.deepStrictEqual(dj3.page.hero["product-right"], { gdids: [G[2], G[3]] }, "前置確認：舊式預填確實會撞");
  const r3 = sw(dj3, "layout-004", deps);
  assert.ok(r3.info.droppedKeys.includes("product-right") && r3.info.droppedKeys.includes("product-left"), "舊式機器預填換走＝丟，不佔暫存");
  assert.strictEqual(dj3.page.heroSlotStash, undefined, "暫存不留機器內容");
});
