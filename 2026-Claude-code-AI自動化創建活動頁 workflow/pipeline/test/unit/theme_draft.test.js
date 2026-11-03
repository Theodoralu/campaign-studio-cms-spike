"use strict";
/**
 * lib/theme_draft.js＋lib/hero_combo.js theme 框架批單元測試（2026-08-25）
 * 守的邏輯：
 *  ①檔位表＝三檔制（使用者裁決）、預設檔乘數 1；schema 恆定槽（price/card/product）任何主色與微調都不動
 *  ②忠實用色：標題/膠囊＝主色原樣不擅自加深；檢查不過＝結構化黃燈＋suggestSeed（建議色自身必過檢）
 *  ③C 案 schema：15 槽齊、backgroundModules 五角色、bgOverrides 亮暗雙套、overrides 逐槽微調（鎖定槽忽略）
 *  ④applyCombo 寫入紀律：customColor/customSlot/pageBg/typography 全走同一寫入口；單一控制點
 *    （自訂色⇄主題 slug 互斥）；pageBg 換背景保留＋提醒；退場背景（retiredFromPool）容忍出聲不擋
 *  ⑤驗證負向：壞 hex／未知檔位／鎖定槽微調／無自訂色先微調＝throw 白話
 * fixture 紀律：hermetic 登記簿一律用永不完工樣本 id（layout-014/015、bg-99x），禁用真貨號。
 */
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const TD = require("../../lib/theme_draft");
const HC = require("../../lib/hero_combo");
const L = require("../../lib/layout_choice");

/* ---------- ① 檔位表與恆定槽 ---------- */
test("檔位表＝三檔制、預設檔乘數 1（2026-08-25 使用者裁決）", () => {
  assert.equal(TD.TYPO_SCALE_STEPS.length, 3);
  assert.deepEqual(TD.TYPO_SCALE_STEPS.map((s) => s.id), ["sm", "md", "lg"]);
  assert.equal(TD.TYPO_SCALE_STEPS.find((s) => s.id === "md").mul, 1);
  assert.deepEqual(TD.TITLE_WIDTH_STEPS.map((s) => s.id), ["narrow", "standard", "wide"]);
  assert.equal(TD.TITLE_WIDTH_STEPS.find((s) => s.id === "standard").mul, 1);
});

test("deriveThemeDraft：恆定槽不動（價格紅鐵律／商品卡白／商品圖底）＋忠實用色（標題/膠囊＝主色原樣）", () => {
  const td = TD.deriveThemeDraft("#7759FF");
  assert.equal(td.price, "#EB0F29");
  assert.equal(TD.slotValue(td, "card"), "#FFFFFF");
  assert.equal(TD.slotValue(td, "product"), "#F0F3F5");
  assert.equal(td.componentColors.title, "#7759FF"); // 忠實用色：不擅自加深
  assert.equal(td.cardBadge, "#7759FF");
  assert.equal(td.titleBadge, "#7759FF");
  // 恆定槽微調＝忽略（deriveThemeDraft 內鎖）
  const td2 = TD.deriveThemeDraft("#7759FF", { price: "#000000", card: "#000000", product: "#000000" });
  assert.equal(td2.price, "#EB0F29");
  assert.equal(TD.slotValue(td2, "card"), "#FFFFFF");
});

/* ---------- ② 檢查與建議色 ---------- */
test("checkThemeDraft：淺主色＝標題對主視覺底黃燈；suggestSeed 產出的建議色自身全過檢", () => {
  const light = "#EED9E2"; // 淺粉＝標題對淡底必不足 4.5
  const td = TD.deriveThemeDraft(light);
  const fails = TD.checkThemeDraft(td).filter((c) => !c.pass);
  assert.ok(fails.some((c) => c.name === "標題"), "淺主色標題檢查應亮黃燈");
  assert.equal(td.qaStatus, "needs-review");
  fails.forEach((c) => assert.ok(c.suggest, "每筆黃燈都要帶建議色"));
  const sug = TD.suggestSeed(light);
  const td3 = TD.deriveThemeDraft(sug);
  assert.ok(TD.checkThemeDraft(td3).every((c) => c.pass), `建議色 ${sug} 重推後應全過檢`);
  assert.equal(td3.qaStatus, "candidate-pass");
});

test("assessSeedColor：壞格式擋、太淺出聲可用", () => {
  assert.equal(TD.assessSeedColor("not-a-color").ok, false);
  const a = TD.assessSeedColor("#F4E9EE");
  assert.equal(a.ok, true);
  assert.ok(a.warn);
});

/* ---------- ③ C 案 schema ---------- */
test("C 案 schema：15 槽齊＋backgroundModules 五角色＋bgOverrides 亮暗雙套＋overrides 逐槽微調", () => {
  assert.equal(TD.THEME_SLOTS.length, 15);
  assert.equal(TD.THEME_SLOTS.filter((s) => s.locked).length, 3);
  const td = TD.deriveThemeDraft("#2F6B4F", { title: "#112233", hero: "#EEF5F0" });
  for (const s of TD.THEME_SLOTS) assert.ok(TD.slotValue(td, s.key), `槽 ${s.key} 要有值`);
  assert.deepEqual(td.backgroundModules.map((m) => m.key), ["page", "hero", "section", "card", "product"]);
  assert.ok(td.bgOverrides.light && td.bgOverrides.dark, "亮暗雙套");
  assert.equal(td.bgOverrides.dark.card, "#FFFFFF"); // 卡片白恆定＝暗套也不翻
  assert.equal(td.componentColors.title, "#112233"); // 逐槽微調生效
  assert.equal(TD.slotValue(td, "hero"), "#EEF5F0");
  assert.deepEqual(td.designerOverrides.colorOverrides, { title: "#112233", hero: "#EEF5F0" });
});

/* ---------- ④ applyCombo 寫入紀律（hermetic 登記簿＝永不完工樣本 id） ---------- */
function buildDeps(tweak = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "theme-draft-fixture-"));
  const rec = (id, over = {}) => ({
    id, name: `樣本版式${id.slice(-3)}`, skeleton: "測試骨架", skin: "測試皮膚", useWhen: ["測試"],
    defaultBackground: "bg-990", backgroundPool: ["bg-991"], kinRef: null,
    slots: [{ key: "title-center" }, { key: "item-ring" }], thumbnail: null, ...over,
  });
  const files = {
    modules: { modules: [{ module_id: "hero", variants: [
      { variant_id: "new" }, { variant_id: "legacy" },
      { variant_id: "layout-014", rollout: "trial" }, { variant_id: "layout-015", rollout: "trial" }, { variant_id: "layout-016", rollout: "trial" },
    ] }] },
    layouts: { assets: [rec("layout-014", { titleFrame: true }), rec("layout-015", { defaultBackground: "bg-992" }), rec("layout-016", { defaultBackground: "bg-993", backgroundPool: [] })] },
    backgrounds: { assets: [
      { id: "bg-990", name: "樣本情境照", license: "A", bgClass: "scene", bridgeColor: "#F2F2F2" },
      { id: "bg-991", name: "樣本連續磚", license: "A", bgClass: "seamless" },
      { id: "bg-992", name: "樣本退場照", license: "A", bgClass: "scene", bridgeColor: "#101010", retiredFromPool: true, fullBleed: false },
      { id: "bg-993", name: "樣本底紋", license: "A", bgClass: "pattern" }, // 非照片底＝草案 hero 槽真的畫在標題後面（customSlot 測試用）
    ] },
    fonts: { assets: [{ id: "font-001", family: "Noto Sans TC", displayName: "思源黑體", css2: "Noto+Sans+TC:wght@100..900", pickable: true }, { id: "font-010", family: "Swei Gothic CJK TC", displayName: "獅尾黑體", pickable: true }] }, /* pickable（2026-09-08 字體簿補戶批）＝可挑選；值域只認 true */ // font-010＝無 css2（單檔 WebFont）樣本
    motion: { assets: [{ id: "motion-001" }] },
    typestyles: { assets: [ // 字風簿樣本：一款已審、一款待審、一款字型未載入已審（永不完工樣本 id）
      { id: "css-t1", displayName: "T1 樣本字風・已審", family: "Noto Sans TC", fontLoaded: true, review: { status: "approved" } },
      { id: "css-t2", displayName: "T2 樣本字風・待審", family: "Noto Sans TC", fontLoaded: true, review: { status: "pending" } },
      { id: "css-t3", displayName: "T3 樣本字風・字型未載", family: "SampleGothic", fontLoaded: false, review: { status: "approved" } },
    ] },
    tokens: { themes: [{ slug: "green-light" }, { slug: "gold-dark" }] },
    ...tweak,
  };
  const P = {};
  for (const [k, v] of Object.entries(files)) { P[k] = path.join(dir, k + ".json"); fs.writeFileSync(P[k], JSON.stringify(v)); }
  const deps = L.loadLayoutDeps(P);
  deps.engineReady = new Set(["new", "legacy", "layout-014", "layout-015", "layout-016"]);
  return deps;
}
function mkDraft() {
  return { page: { pageName: "測試檔", kvVariant: "layout-014", hero: {}, kv: { dateValue: "08/30–09/30" } },
    products: [{ gdid: "900001", name: "對板示意商品", price: 100, url: "https://example.invalid/x" }], meta: {} };
}

test("applyCombo customColor：寫 page.colors（custom schema）＋清 themeId＋內容區塊 custom 主題；null＝清除", () => {
  const deps = buildDeps();
  const dj = mkDraft();
  dj.page.themeId = "green-light";
  const r = HC.applyCombo(dj, { customColor: "#2F6B4F" }, deps);
  assert.equal(r.changed, true);
  assert.equal(dj.page.colors.source, "custom");
  assert.equal(dj.page.colors.seed, "#2F6B4F");
  assert.equal(dj.page.colors.themeDraft.brandColor, "#2F6B4F");
  assert.equal(dj.page.themeId, undefined, "單一控制點：自訂色上場＝主題 slug 退位");
  assert.equal(dj.page.theme.colorTheme, "custom-light");
  const r2 = HC.applyCombo(dj, { customColor: null }, deps);
  assert.equal(r2.changed, true);
  assert.equal(dj.page.colors, undefined);
  assert.equal(dj.page.theme.colorTheme, "pink-light");
});

test("applyCombo customColor 擋色制（2026-08-27 令取代 2026-08-25 不硬擋）：淺主色＝擋下不寫入＋blocked 結構＋建議色；一鍵建議色＝成功寫入；壞 hex＝throw 白話", () => {
  const deps = buildDeps();
  const dj = mkDraft();
  const r = HC.applyCombo(dj, { customColor: "#EED9E2" }, deps);
  assert.equal(r.changed, false, "擋級檢查不過＝不寫入");
  assert.equal(dj.page.colors, undefined, "原稿完好（什麼都沒存）");
  assert.ok(r.info.blocked && r.info.blocked.kind === "customColor");
  assert.ok(Array.isArray(r.info.blocked.fails) && r.info.blocked.fails.length, "擋卡要列白話原因");
  assert.ok(TD.isHex6(r.info.blocked.seedSuggest), "擋卡要帶可用的建議色（選項）");
  const r2 = HC.applyCombo(dj, { customColor: r.info.blocked.seedSuggest }, deps);
  assert.equal(r2.changed, true, "一鍵建議色＝通過寫入");
  assert.equal(dj.page.colors.seed, TD.normHex(r.info.blocked.seedSuggest));
  assert.ok(!r2.info.blocked, "建議色自身不得再被擋（suggestSeed 全過檢迴路）");
  assert.throws(() => HC.applyCombo(mkDraft(), { customColor: "#12" }, deps), /調色盤重新選/);
});

test("applyCombo themeId：改選主題＝清 page.colors（單一控制點）＋出聲", () => {
  const deps = buildDeps();
  const dj = mkDraft();
  HC.applyCombo(dj, { customColor: "#2F6B4F" }, deps);
  const r = HC.applyCombo(dj, { themeId: "gold-dark" }, deps);
  assert.equal(dj.page.colors, undefined);
  assert.equal(dj.page.themeId, "gold-dark");
  assert.ok(r.info.notes.some((n) => n.includes("自訂顏色")));
});

test("applyCombo 提案包原子擋（2026-08-27 擋色制）：colors 擋級不過＝版式/背景/主題全不落地＋meta.proposalPack 不寫＋修正版選項", () => {
  const deps = buildDeps();
  const dj = mkDraft();
  const kvBefore = dj.page.kvVariant;
  const badColors = TD.deriveThemeDraft("#EED9E2"); // 淺主色草案＝標題擋級不過
  const r = HC.applyCombo(dj, { kvVariant: "layout-006", backgroundId: null, themeId: null, colors: badColors, proposalPack: { version: 1, layout: "layout-006" } }, deps);
  assert.equal(r.changed, false, "整包原子擋＝零變更");
  assert.equal(dj.page.kvVariant, kvBefore, "版式沒被半套（前置驗＝任何欄位落地之前）");
  assert.equal(dj.page.colors, undefined, "配色沒落地");
  assert.equal((dj.meta || {}).proposalPack, undefined, "meta.proposalPack 不寫（引擎有 meta 後備讀色路＝寫了等於被擋的色從後門上畫面）");
  assert.ok(r.info.blocked && r.info.blocked.kind === "pack");
  assert.ok(r.info.blocked.fixedColors, "帶「只調不及格字色」修正版選項");
  const r2 = HC.applyCombo(dj, { colors: r.info.blocked.fixedColors }, deps);
  assert.equal(r2.changed, true, "修正版自身過檢＝可帶入");
  assert.equal(dj.page.colors.source, "pack");
});

/* ---------- ④' 標題實際渲染底（2026-09-04 假閘修正；病例＝run 2026-09-04-wb-164258 白字壓白棚照 1.00:1 被放行） ---------- */
function darkPackColors() { // 色彩工具「深色主題」草案的最小形：近白標題族＋宣稱深藍 hero（照片版面上這塊底不存在）
  return { mainColorSource: "mood", brandColor: "#1E50A2", themeMode: "dark", cardBadge: "#7FCFD1", titleBadge: "#7FCFD1", latticeLine: "#7FCFD1",
    componentColors: { title: "#F0F2F4", subtitle: "#DDE0E3", eventLabel: "#DDE0E3", eventDate: "#F0F2F4" },
    backgroundModules: [{ key: "page", hex: "#18273E" }, { key: "hero", hex: "#274372" }, { key: "section", hex: "#213455" }] };
}
test("effectiveHeroSurface：照片版式＝登記簿 bridgeColor；退場照非預設＝回落版式預設；底紋／連續磚／現行版型＝null", () => {
  const deps = buildDeps();
  const s1 = HC.effectiveHeroSurface({ kvVariant: "layout-014" }, {}, deps);
  assert.equal(s1 && s1.hex, "#F2F2F2"); assert.equal(s1.bgId, "bg-990"); assert.ok(s1.label.includes("樣本版式014") && s1.label.includes("樣本情境照"));
  const s2 = HC.effectiveHeroSurface({ kvVariant: "layout-014", backgroundId: "bg-992" }, {}, deps); // 退場照、非本版式預設＝引擎回落預設
  assert.equal(s2 && s2.bgId, "bg-990");
  const s3 = HC.effectiveHeroSurface({ kvVariant: "layout-015" }, {}, deps); // 退場照但是本版式自己的預設＝照用
  assert.equal(s3 && s3.hex, "#101010");
  assert.equal(HC.effectiveHeroSurface({ kvVariant: "layout-016" }, {}, deps), null, "底紋跟主題＝草案宣稱即真");
  assert.equal(HC.effectiveHeroSurface({ kvVariant: "layout-014", backgroundId: "bg-991" }, {}, deps), null, "連續磚＝不假裝知道");
  assert.equal(HC.effectiveHeroSurface({ kvVariant: "new" }, {}, deps), null);
  const s4 = HC.effectiveHeroSurface({ kvVariant: "layout-016" }, { kvVariant: "layout-014" }, deps); // 這手要換的版式優先
  assert.equal(s4 && s4.hex, "#F2F2F2");
});

test("checkThemeDraft(td, {heroSurface})：標題族改對實際底算；未給＝照舊對草案 hero", () => {
  const td = darkPackColors();
  const plain = TD.checkThemeDraft(td);
  assert.ok(plain.filter((c) => c.name === "標題").every((c) => c.pass), "對宣稱深藍底：白字 8.78:1 過（＝假閘的算法）");
  const real = TD.checkThemeDraft(td, { heroSurface: { hex: "#F2F2F2", label: "「聯名促銷型」的照片背景" } });
  const t = real.find((c) => c.name === "標題");
  assert.equal(t.pass, false); assert.ok(t.ratio < 1.1); assert.equal(t.surface, "#F2F2F2");
  assert.ok(t.msg.includes("在「聯名促銷型」的照片背景上會看不見"), t.msg);
  assert.ok(TD.contrast(t.suggest, "#F2F2F2") >= 4.5, "建議色要對實際底過關");
  assert.equal(real.filter((c) => !c.pass && c.blocking !== false).length, 4, "標題族四槽全不過");
});

test("applyCombo 提案包・照片版式：深色草案白字＝對照片底擋下（原子）＋surface 揭示＋修正版對實際底過；同草案在底紋版式不擋", () => {
  const deps = buildDeps();
  const dj = mkDraft(); // layout-014＝照片版式（bg-990 #F2F2F2）
  const r = HC.applyCombo(dj, { kvVariant: "layout-014", backgroundId: null, themeId: null, colors: darkPackColors(), pageBg: null, proposalPack: { version: 1, layout: "layout-014" } }, deps);
  assert.equal(r.changed, false, "白字壓白照片＝擋");
  assert.equal(dj.page.colors, undefined, "原子擋：配色沒落地");
  assert.equal((dj.meta || {}).proposalPack, undefined);
  assert.equal(r.info.blocked.kind, "pack");
  assert.deepEqual(r.info.blocked.surface, { hex: "#F2F2F2", bgName: "樣本情境照", layoutName: "樣本版式014" });
  assert.ok(r.info.notes[0].startsWith("提案包沒有帶入：你的標題色在「樣本版式014」的照片背景「樣本情境照」上會看不見"), r.info.notes[0]);
  assert.ok(r.info.notes[0].includes("照片不會跟著配色變暗"));
  assert.ok(r.info.blocked.fixedColors, "帶修正版");
  const fixedTitle = r.info.blocked.fixedColors.componentColors.title;
  assert.ok(TD.contrast(fixedTitle, "#F2F2F2") >= 4.5, "修正版字色對實際照片底過關");
  const r2 = HC.applyCombo(dj, { colors: r.info.blocked.fixedColors, proposalPack: { version: 1, layout: "layout-014" } }, deps);
  assert.equal(r2.changed, true); assert.equal(dj.page.colors.source, "pack");
  assert.ok(r2.info.notes.some((n) => n.includes("活動頁底色會跟著照片的銜接色走（#F2F2F2）") && n.includes("#18273E")), "D2 出聲：頁底色會被照片銜接色壓過");
  /* 同一份深色草案、底紋版式（無照片）＝對草案自己的 hero 算＝過 */
  const dj3 = mkDraft(); dj3.page.kvVariant = "layout-016";
  const r3 = HC.applyCombo(dj3, { colors: darkPackColors() }, deps);
  assert.equal(r3.changed, true, "底紋版式：宣稱 hero 即真底＝白字對深藍 8.78:1 過");
  assert.ok(!r3.info.notes.some((n) => n.includes("銜接色")), "非照片版式不出頁底色提醒");
});

test("applyCombo customColor／customSlot・照片版式：淺主色對照片底擋；改 hero 槽不影響照片上的標題＝不擋", () => {
  const deps = buildDeps();
  const dj = mkDraft(); // 照片版式
  const r = HC.applyCombo(dj, { customColor: "#DDE0E3" }, deps); // 近白主色＝標題近白壓白照片
  assert.equal(r.changed, false); assert.equal(r.info.blocked.kind, "customColor");
  assert.ok(r.info.blocked.fails.some((f) => f.msg.includes("照片背景")), JSON.stringify(r.info.blocked.fails));
  HC.applyCombo(dj, { customColor: "#112233" }, deps);
  const r2 = HC.applyCombo(dj, { customSlot: { key: "hero", hex: "#1A2C3F" } }, deps); // 照片版式：hero 槽不畫在標題後面＝這手不會弄壞可讀性
  assert.equal(r2.changed, true, "照片是真底，改 hero 槽不擋");
});

test("packToChange：font／motion 沒接上＝出聲不靜默丟（font-001／static＝預設值不吵）", () => {
  const deps = buildDeps();
  const base = { version: 1, layout: "layout-014" };
  const quiet = HC.packToChange(JSON.stringify({ ...base, font: "font-001", motion: "static" }), deps.registries);
  assert.ok(quiet.ok); assert.equal(quiet.warnings.length, 0);
  const noisy = HC.packToChange(JSON.stringify({ ...base, font: "font-001", motion: "motion-001" }), deps.registries);
  assert.ok(noisy.ok);
  assert.ok(noisy.warnings.some((w) => w.includes("動畫") && w.includes("不會套用")), JSON.stringify(noisy.warnings));
  assert.ok(noisy.change.packWarnings.some((w) => w.includes("動畫")), "警告也進 draft 的 packWarnings");
});

test("applyCombo customSlot 擋色制：這手改壞＝擋＋複合修正（使用者底色＋連動字色）；既有病灶不擋無關槽", () => {
  const deps = buildDeps();
  const dj = mkDraft(); dj.page.kvVariant = "layout-016"; // 非照片版式（底紋）：主視覺底色槽真的畫在標題後面——照片版式另測（2026-09-04 假閘修正後語意分流）
  HC.applyCombo(dj, { customColor: "#112233" }, deps); // 擋級全過的基底
  const r = HC.applyCombo(dj, { customSlot: { key: "hero", hex: "#1A2C3F" } }, deps); // 把主視覺底改深＝標題(#112233)對深底變看不清＝這手新造成
  assert.equal(r.changed, false, "這手改壞＝不寫入");
  assert.equal((dj.page.colors.overrides || {}).hero, undefined, "使用者這手沒被存");
  assert.ok(r.info.blocked && r.info.blocked.kind === "customSlot");
  assert.ok(r.info.blocked.fixSlots && r.info.blocked.fixSlots.hero === "#1A2C3F", "複合修正保留使用者這手");
  assert.ok(Object.keys(r.info.blocked.fixSlots).length >= 2, "並帶連動字色修正（不是丟棄使用者底色只改字）");
  const r2 = HC.applyCombo(dj, { customSlots: Object.entries(r.info.blocked.fixSlots).map(([key, hex]) => ({ key, hex })) }, deps);
  assert.equal(r2.changed, true, "一鍵複合套組＝通過寫入");
  assert.equal(dj.page.colors.overrides.hero, "#1A2C3F");
  /* 既有病灶不擋無關槽：手動把 themeDraft 弄成含既有擋級病灶的存稿形（模擬換尺前存量稿），改別的槽不受牽連 */
  const dj2 = mkDraft(); dj2.page.kvVariant = "layout-016";
  HC.applyCombo(dj2, { customColor: "#112233" }, deps);
  dj2.page.colors.themeDraft.componentColors.title = "#EED9E2"; // 塞一個既有的標題病灶（存量稿）
  const r3 = HC.applyCombo(dj2, { customSlot: { key: "latticeLine", hex: "#AA88CC" } }, deps);
  assert.equal(r3.changed, true, "既有病灶（非這手造成）＝不擋無關槽微調");
});

test("applyCombo customSlot：逐槽微調重推＋重過檢；鎖定槽/未知槽/未選主色＝throw 白話", () => {
  const deps = buildDeps();
  const dj = mkDraft();
  assert.throws(() => HC.applyCombo(mkDraft(), { customSlot: { key: "title", hex: "#112233" } }, deps), /先在主題配色選/);
  HC.applyCombo(dj, { customColor: "#2F6B4F" }, deps);
  const r = HC.applyCombo(dj, { customSlot: { key: "title", hex: "#112233" } }, deps);
  assert.equal(r.changed, true);
  assert.equal(dj.page.colors.overrides.title, "#112233");
  assert.equal(dj.page.colors.themeDraft.componentColors.title, "#112233");
  HC.applyCombo(dj, { customSlot: { key: "title", hex: null } }, deps); // 清微調＝回推導值
  assert.equal(dj.page.colors.overrides.title, undefined);
  assert.equal(dj.page.colors.themeDraft.componentColors.title, "#2F6B4F");
  assert.throws(() => HC.applyCombo(dj, { customSlot: { key: "price", hex: "#112233" } }, deps), /固定色不能改/);
  assert.throws(() => HC.applyCombo(dj, { customSlot: { key: "nope", hex: "#112233" } }, deps), /不認得/);
});

test("applyCombo pageBg：手調＝存 pageBgOverride；換背景＝保留＋提醒；null＝回自動；退場背景＝容忍出聲", () => {
  const deps = buildDeps();
  const dj = mkDraft();
  const r = HC.applyCombo(dj, { pageBg: "#101820" }, deps);
  assert.equal(dj.page.pageBgOverride, "#101820");
  assert.ok(r.changed);
  const r2 = HC.applyCombo(dj, { backgroundId: "bg-991" }, deps);
  assert.equal(dj.page.pageBgOverride, "#101820", "換背景＝手調保留");
  assert.ok(r2.info.notes.some((n) => n.includes("回自動")), "換背景要提醒手調仍在");
  const r3 = HC.applyCombo(dj, { pageBg: null }, deps);
  assert.equal(dj.page.pageBgOverride, undefined);
  assert.ok(r3.info.notes.some((n) => n.includes("自動")));
  assert.throws(() => HC.applyCombo(dj, { pageBg: "红色" }, deps), /調色盤重新選/);
  const r4 = HC.applyCombo(dj, { backgroundId: "bg-992" }, deps); // 退場背景＝黃燈不擋（非本版式預設＝回落預設語意）
  assert.equal(dj.page.backgroundId, "bg-992");
  assert.ok(r4.info.notes.some((n) => n.includes("已停用")));
});

test("applyCombo typography：檔位寫入/回標準檔清欄/未知檔位 throw；標準檔全清＝節點不留", () => {
  const deps = buildDeps();
  const dj = mkDraft();
  const r = HC.applyCombo(dj, { heroTitleScale: "lg", heroTitleWidth: "wide" }, deps);
  assert.ok(r.changed);
  assert.deepEqual(dj.page.typography, { titleScale: "lg", titleWidth: "wide" });
  HC.applyCombo(dj, { heroSubtitleScale: "sm" }, deps);
  assert.equal(dj.page.typography.subtitleScale, "sm");
  HC.applyCombo(dj, { heroTitleScale: "md", heroTitleWidth: "standard", heroSubtitleScale: null }, deps);
  assert.equal(dj.page.typography, undefined, "全回標準檔＝typography 節點不留");
  assert.throws(() => HC.applyCombo(dj, { heroTitleScale: "huge" }, deps), /固定檔位/);
});

test("packToChange：包帶 colors＝themeDraft 進 change（pageBg 歸零回自動）", () => {
  const deps = buildDeps();
  const pack = JSON.stringify({ version: 1, layout: "layout-014", theme: "green-light", qaStatus: "candidate-pass",
    colors: { brandColor: "#2F6B4F", cardBadge: "#2F6B4F", componentColors: { title: "#2F6B4F" } } });
  const r = HC.packToChange(pack, deps.registries);
  assert.equal(r.ok, true);
  assert.equal(r.change.colors.brandColor, "#2F6B4F");
  assert.equal(r.change.pageBg, null);
  // 帶入 draft：page.colors.source=pack
  const dj = mkDraft();
  const a = HC.applyCombo(dj, r.change, deps);
  assert.ok(a.changed);
  assert.equal(dj.page.colors.source, "pack");
  assert.equal(dj.page.colors.themeDraft.brandColor, "#2F6B4F");
});

/* ---------- 字風寫入（2026-09-04 字風落地批＝68 號第二批） ---------- */
test("applyCombo titleStyle：approved 寫入＋履歷標籤；pending／未知＝throw 白話；字型未載入＝寫入但出聲；null＝清欄", () => {
  const deps = buildDeps();
  const dj = mkDraft();
  const r = HC.applyCombo(dj, { titleStyle: "css-t1" }, deps);
  assert.equal(r.changed, true); assert.equal(dj.page.titleStyle, "css-t1");
  assert.ok(r.info.summary.includes("標題字風"), r.info.summary);
  assert.ok(dj.meta.layoutChoice.reasonDisplay.includes("字風「T1 樣本字風・已審」"), dj.meta.layoutChoice.reasonDisplay);
  assert.throws(() => HC.applyCombo(mkDraft(), { titleStyle: "css-t2" }, deps), /還沒審查通過/);
  assert.throws(() => HC.applyCombo(mkDraft(), { titleStyle: "css-nope" }, deps), /系統不認得/);
  const dj3 = mkDraft();
  const r3 = HC.applyCombo(dj3, { titleStyle: "css-t3" }, deps);
  assert.equal(dj3.page.titleStyle, "css-t3");
  assert.ok(r3.info.notes.some((n) => n.includes("SampleGothic") && n.includes("後備字型")), "字型未載入要出聲");
  const r4 = HC.applyCombo(dj, { titleStyle: null }, deps);
  assert.equal(r4.changed, true); assert.equal(dj.page.titleStyle, undefined);
  assert.equal(HC.applyCombo(dj, { titleStyle: null }, deps).changed, false, "已空再清＝零變更");
});

test("packToChange：titleStyle 一等欄進 change（整組帶入語意：包沒帶＝null 清回版式原字）；pending 在解析層就擋", () => {
  const deps = buildDeps();
  const ok = HC.packToChange(JSON.stringify({ version: 1, layout: "layout-014", titleStyle: "css-t1" }), deps.registries);
  assert.ok(ok.ok); assert.equal(ok.change.titleStyle, "css-t1");
  const none = HC.packToChange(JSON.stringify({ version: 1, layout: "layout-014" }), deps.registries);
  assert.equal(none.change.titleStyle, null);
  const pend = HC.packToChange(JSON.stringify({ version: 1, layout: "layout-014", titleStyle: "css-t2" }), deps.registries);
  assert.equal(pend.ok, false); assert.ok(pend.errors.some((e) => e.includes("尚未審查通過")));
  /* 端到端：包帶 approved 字風＋照片版式可讀配色 → 草稿落 titleStyle */
  const dj = mkDraft();
  const r = HC.applyCombo(dj, ok.change, deps);
  assert.equal(r.changed, true); assert.equal(dj.page.titleStyle, "css-t1"); assert.equal(dj.meta.proposalPack.pack.titleStyle, "css-t1");
});

/* ---------- 副標題字體寫入（2026-09-04 使用者翻案 Q8） ---------- */
test("applyCombo subtitleFont：寫入帶 family／css2；無 css2＝寫入出聲；未知貨號／壞字重＝throw；null＝清欄；packToChange 整組語意", () => {
  const deps = buildDeps();
  const dj = mkDraft();
  const r = HC.applyCombo(dj, { subtitleFont: { fontId: "font-001", weight: 300 } }, deps);
  assert.equal(r.changed, true);
  assert.deepEqual(dj.page.subtitleFont, { fontId: "font-001", family: "Noto Sans TC", weight: 300, css2: "Noto+Sans+TC:wght@100..900" });
  assert.ok(r.info.summary.includes("副標題字體"));
  assert.ok(dj.meta.layoutChoice.reasonDisplay.includes("副標字體「思源黑體」"));
  const r2 = HC.applyCombo(dj, { subtitleFont: { fontId: "font-010" } }, deps);
  assert.equal(dj.page.subtitleFont.css2, undefined); assert.ok(r2.info.notes.some((n) => n.includes("沒有網路字型檔")));
  assert.throws(() => HC.applyCombo(mkDraft(), { subtitleFont: { fontId: "font-404" } }, deps), /系統不認得/);
  assert.throws(() => HC.applyCombo(mkDraft(), { subtitleFont: { fontId: "font-001", weight: 350 } }, deps), /整百/);
  const r3 = HC.applyCombo(dj, { subtitleFont: null }, deps); assert.equal(r3.changed, true); assert.equal(dj.page.subtitleFont, undefined);
  const pc = HC.packToChange(JSON.stringify({ version: 1, layout: "layout-014", subtitleFont: { fontId: "font-001", weight: 300 } }), deps.registries);
  assert.deepEqual(pc.change.subtitleFont, { fontId: "font-001", weight: 300 });
  assert.equal(HC.packToChange(JSON.stringify({ version: 1, layout: "layout-014" }), deps.registries).change.subtitleFont, null);
});

test("packToChange：typography 檔位 → heroTitleScale／heroSubtitleScale／heroTitleWidth；包沒帶＝null 回標準檔", () => {
  const deps = buildDeps();
  const pc = HC.packToChange(JSON.stringify({ version: 1, layout: "layout-014", typography: { titleScale: "lg", titleWidth: "narrow" } }), deps.registries);
  assert.equal(pc.change.heroTitleScale, "lg"); assert.equal(pc.change.heroSubtitleScale, null); assert.equal(pc.change.heroTitleWidth, "narrow");
  const dj = mkDraft(); const r = HC.applyCombo(dj, pc.change, deps);
  assert.equal(r.changed, true); assert.deepEqual(dj.page.typography, { titleScale: "lg", titleWidth: "narrow" });
  const none = HC.packToChange(JSON.stringify({ version: 1, layout: "layout-014" }), deps.registries);
  HC.applyCombo(dj, none.change, deps); assert.equal(dj.page.typography, undefined, "包沒帶＝清回標準檔");
});

test("titleFrame：包 off→草稿 off；on／沒帶＝清欄；壞值 throw；版式沒裝飾線＝解析黃燈", () => {
  const deps = buildDeps();
  const dj = mkDraft();
  const pc = HC.packToChange(JSON.stringify({ version: 1, layout: "layout-014", titleFrame: "off" }), deps.registries);
  assert.equal(pc.change.titleFrame, "off"); assert.equal(pc.warnings.some((w) => w.includes("不作用")), false);
  const r = HC.applyCombo(dj, pc.change, deps); assert.equal(r.changed, true); assert.equal(dj.page.titleFrame, "off"); assert.ok(r.info.summary.includes("主標兩側裝飾線"));
  const r2 = HC.applyCombo(dj, { titleFrame: "on" }, deps); assert.equal(r2.changed, true); assert.equal(dj.page.titleFrame, undefined);
  assert.throws(() => HC.applyCombo(mkDraft(), { titleFrame: "maybe" }, deps), /開／關/);
  const pc2 = HC.packToChange(JSON.stringify({ version: 1, layout: "layout-016", titleFrame: "off" }), deps.registries);
  assert.ok(pc2.warnings.some((w) => w.includes("沒有裝飾線")), "016 沒登 titleFrame＝黃燈");
});

/* ---------- 被審查制丟掉的字風要進面板黃燈（2026-09-08 病例 run 150043） ---------- */
test("applyCombo（by=pack）：包帶待審字風（舊位置）＝丟掉＋info.notes 出聲「沒有帶入…待審」；帶已審字風＝不吵", () => {
  const deps = buildDeps();
  const pend = HC.packToChange(JSON.stringify({ version: 1, layout: "layout-014", colors: { titleStyle: "css-t2" } }), deps.registries);
  assert.ok(pend.ok && pend.change.droppedTitleStyle && pend.change.droppedTitleStyle.id === "css-t2", JSON.stringify(pend));
  const r = HC.applyCombo(mkDraft(), pend.change, deps);
  assert.ok(r.info.notes.some((n) => n.includes("字風「T2 樣本字風・待審」沒有帶入") && n.includes("待審")), JSON.stringify(r.info.notes));
  const okp = HC.packToChange(JSON.stringify({ version: 1, layout: "layout-014", titleStyle: "css-t1" }), deps.registries);
  const r2 = HC.applyCombo(mkDraft(), okp.change, deps);
  assert.ok(!r2.info.notes.some((n) => n.includes("沒有帶入")), JSON.stringify(r2.info.notes));
  assert.equal(r2.info.changedFields.includes("titleStyle"), true);
});
