"use strict";
/**
 * lib/proposal_pack.js 單元測試（零新相依，僅 node:test；不觸網）
 * 51 號 W1-A：提案包解析器負路徑窮舉＋kvVariant 拼法正規化＋登記簿值域載入。
 *
 * 注意（非 hermetic，刻意為之）：loadRegistries 直讀 monorepo 活真源（modules.json／design-assets
 * 四本／design-tokens）＝值域漂移絆線——pipeline repo 單獨 checkout 時本檔會紅，屬預期（依賴上層佈局）。
 *
 * 2026-08-24 第二版（code review F1/F4 修正）：themes 陣列形狀正例（green-light）＋rejected 排除＋
 * 大小寫負例＋version 型別錯訊＋layout 舊拼法負例釘死＋font/motion 負例＋themes 缺席 throw＋
 * ENUMS.kvVariant 鏡像絆線。
 */
const { test } = require("node:test");
const assert = require("node:assert");
const path = require("path");

const { normalizeKvVariant, loadRegistries, parseProposalPack } = require("../../lib/proposal_pack");

test("normalizeKvVariant：舊拼法正規化、裸值與未知值原樣", () => {
  assert.strictEqual(normalizeKvVariant("kv-new"), "new");
  assert.strictEqual(normalizeKvVariant("kv-legacy"), "legacy");
  assert.strictEqual(normalizeKvVariant("new"), "new");
  assert.strictEqual(normalizeKvVariant("layout-003"), "layout-003");
  assert.strictEqual(normalizeKvVariant("bogus"), "bogus");
  assert.strictEqual(normalizeKvVariant(null), null);
});

test("loadRegistries：五本真源可讀、值域形狀正確（含主題 slug 制）", () => {
  const r = loadRegistries();
  assert.ok(r.heroVariantIds.includes("new") && r.heroVariantIds.includes("legacy"));
  for (let i = 1; i <= 9; i++) {
    const id = `layout-00${i}`;
    assert.ok(r.heroVariantIds.includes(id), `heroVariantIds 缺 ${id}`);
    assert.ok(r.layoutIds.includes(id), `layoutIds 缺 ${id}`);
  }
  assert.ok(r.backgroundIds.includes("bg-005"));
  assert.ok(r.fontIds.includes("font-001"));
  assert.ok(r.layoutRecords.get("layout-006").slots.some((s) => s.key === "item-ring"));
  // 主題＝slug 制（F1 修正釘死）：真實 slug 在列、rejected（blue-dark/clash-dark）排除、無索引字串
  assert.ok(r.themeIds.includes("default"));
  assert.ok(r.themeIds.includes("green-light"), "themeIds 缺真實 slug green-light（F1 迴歸）");
  assert.ok(!r.themeIds.includes("blue-dark"), "rejected 主題不得入值域");
  assert.ok(!r.themeIds.includes("clash-dark"), "rejected 主題不得入值域");
  assert.ok(!r.themeIds.some((t) => /^\d+$/.test(t)), "themeIds 出現數字索引＝讀錯形狀（F1 迴歸）");
});

test("parseProposalPack：合法包通過（真實主題 slug）", () => {
  const r = loadRegistries();
  const res = parseProposalPack(
    { version: 1, layout: "layout-006", background: "bg-005", font: "font-001", motion: "static", theme: "green-light", qaStatus: "candidate-pass", extra: "容忍我" },
    r
  );
  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.pack.layout, "layout-006");
  assert.strictEqual(res.warnings.length, 0);
});

test("parseProposalPack：壞 JSON 字串＝出聲擋下", () => {
  const r = loadRegistries();
  const res = parseProposalPack("{這不是JSON", r);
  assert.strictEqual(res.ok, false);
  assert.match(res.errors[0], /不是合法 JSON/);
});

test("parseProposalPack：缺 version 與 version 型別錯＝分開出聲", () => {
  const r = loadRegistries();
  const miss = parseProposalPack({ layout: "layout-006" }, r);
  assert.strictEqual(miss.ok, false);
  assert.ok(miss.errors.some((e) => e.startsWith("缺 version")));
  const badType = parseProposalPack({ version: "1", layout: "layout-006" }, r);
  assert.strictEqual(badType.ok, false);
  assert.ok(badType.errors.some((e) => e.includes("version 不支援") && e.includes('"1"')), "型別錯要講「不支援」並帶原值，不得講「缺」");
});

test("parseProposalPack：未知貨號逐欄出聲（版式／背景／字體／動畫／主題）", () => {
  const r = loadRegistries();
  const res = parseProposalPack(
    { version: 1, layout: "layout-999", background: "bg-999", font: "font-999", motion: "motion-999", theme: "紫嘯鶇" },
    r
  );
  assert.strictEqual(res.ok, false);
  assert.ok(res.errors.some((e) => e.includes("未知版式貨號")));
  assert.ok(res.errors.some((e) => e.includes("未知背景貨號")));
  assert.ok(res.errors.some((e) => e.includes("未知字體貨號")));
  assert.ok(res.errors.some((e) => e.includes("未知動畫貨號")));
  assert.ok(res.errors.some((e) => e.includes("未知主題代號")));
});

test("parseProposalPack：layout 填舊拼法 kv-new＝擋下且錯訊帶原值（正規化不救版式欄）", () => {
  const r = loadRegistries();
  const res = parseProposalPack({ version: 1, layout: "kv-new" }, r);
  assert.strictEqual(res.ok, false);
  assert.ok(res.errors.some((e) => e.includes("未知版式貨號：kv-new")));
});

test("parseProposalPack：主題大小寫敏感（Default＝擋）", () => {
  const r = loadRegistries();
  const res = parseProposalPack({ version: 1, layout: "layout-006", theme: "Default" }, r);
  assert.strictEqual(res.ok, false);
  assert.ok(res.errors.some((e) => e.includes("未知主題代號：Default")));
});

test("parseProposalPack：qaStatus 非綠＝黃燈帶入不擋", () => {
  const r = loadRegistries();
  const res = parseProposalPack({ version: 1, layout: "layout-007", qaStatus: "needs-review" }, r);
  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.warnings.length, 1);
  assert.match(res.warnings[0], /黃燈/);
});

test("loadRegistries：路徑錯＝throw 出聲不靜默", () => {
  assert.throws(() => loadRegistries({ modules: "/tmp/不存在的登記簿.json" }), /登記簿讀取失敗/);
});

test("loadRegistries：tokens 缺 themes 陣列＝throw（不靜默縮值域）", () => {
  // 指向一份合法 JSON 但沒有 themes 陣列的檔（fonts manifest）＝形狀不符必炸
  const fontsPath = path.resolve(__dirname, "..", "..", "..", "..", "design-assets", "fonts", "manifest.json");
  assert.throws(() => loadRegistries({ tokens: fontsPath }), /主題真源缺席或形狀不符/);
});

test("R5 鏡像絆線：write_xlsx ENUMS.kvVariant 與 modules.json hero variants 零漂移", () => {
  const { ENUMS } = require("../../write_xlsx");
  const r = loadRegistries();
  assert.deepStrictEqual(ENUMS.kvVariant, r.heroVariantIds, "write_xlsx 硬編值域與登記簿漂移——兩邊同批改或改 runtime 讀");
});

/* ── 待審背景直通車（63 號 2026-08-31 使用者五題圈定）：訪客號段值域 ── */
test("待審簿：pending 號段載入＋提案包帶訪客號＝過（黃燈告知）＋未知號照擋", () => {
  const r = loadRegistries();
  // 待審簿至少一筆（走查開戶的 pending-0001；轉正後此斷言改抽測 promoted 排除即可）
  assert.ok(Array.isArray(r.pendingBackgroundIds), "registries 缺 pendingBackgroundIds");
  const pid = r.pendingBackgroundIds[0];
  if (pid) {
    // 正向：訪客號帶包＝ok＋浮水印告知黃燈（不擋）
    const ok = parseProposalPack({ version: 1, layout: "layout-006", background: pid }, r);
    assert.strictEqual(ok.ok, true, "pending 號帶包應放行");
    assert.ok(ok.warnings.some((w) => /待審臨時貨號/.test(w)), "應帶浮水印告知黃燈");
    assert.ok(r.pendingBackgroundRecords.get(pid).licenseAnswers, "待審筆應帶授權三答");
  }
  // 負向：號段格式相似但不存在＝整包擋下出聲
  const bad = parseProposalPack({ version: 1, layout: "layout-006", background: "pending-9999" }, r);
  assert.strictEqual(bad.ok, false, "未知訪客號必須擋");
  assert.ok(bad.errors.some((e) => /未知背景貨號/.test(e)));
  // 負向：promoted（已轉正）不算現役待審——由 filter 保證（結構斷言：現役清單無 promoted 態）
  for (const id of r.pendingBackgroundIds) {
    assert.notStrictEqual((r.pendingBackgroundRecords.get(id).review || {}).status, "promoted");
  }
});

test("寫入層也認訪客號（2026-08-31 使用者報修迴歸鎖：包驗證放行、applyCombo 卻擋＝兩處值域只改一處）", () => {
  const hc = require("../../lib/hero_combo.js");
  const r = loadRegistries();
  const pid = r.pendingBackgroundIds[0];
  if (!pid) return; // 待審簿清空時本測自然略過（值域結構已由上一測把關）
  const os = require("node:os"), fsx = require("node:fs"), pathx = require("node:path");
  const tmp = fsx.mkdtempSync(pathx.join(os.tmpdir(), "combo-pending-"));
  const draftPath = pathx.join(tmp, "draft.json");
  fsx.copyFileSync(pathx.join(__dirname, "..", "fixtures", "gate_pass_draft.json"), draftPath);
  const layoutLib = require("../../lib/layout_choice.js");
  const deps = layoutLib.loadLayoutDeps(); // 正式配方（server 同款）——半套 deps 會在別的檢查點炸、測不到本題
  const pr = hc.packToChange(JSON.stringify({ version: 1, layout: "layout-006", background: pid }), deps.registries);
  assert.deepStrictEqual(pr.errors || [], [], "包驗證層應放行");
  hc.writeComboIntoDraft(draftPath, pr.change, deps); // 寫入層不得 throw「系統不認得」
  const d = JSON.parse(fsx.readFileSync(draftPath, "utf8"));
  assert.strictEqual(d.page.backgroundId, pid, "訪客號應寫進活動檔");
});

/* ---------- 字風一等欄 titleStyle（2026-09-04 字風落地批＝68 號第二批；活真源＝字風登記簿首批 27 款全 pending） ---------- */
test("loadRegistries：字風登記簿 27 款入 typestyleRecords；值域 typestyleIds 只認 approved（首批全 pending＝空）", () => {
  const r = loadRegistries();
  assert.ok(r.typestyleRecords instanceof Map && r.typestyleRecords.size >= 27, "27 款戶口");
  assert.ok(r.typestyleRecords.get("css-n3") && r.typestyleRecords.get("css-n3").displayName.includes("透視霓虹"));
  assert.ok(Array.isArray(r.typestyleIds));
  for (const id of r.typestyleIds) assert.equal(r.typestyleRecords.get(id).review.status, "approved", `${id} 在值域但非 approved`);
});

test("parseProposalPack：titleStyle 未知＝擋；pending＝擋且講明審查狀態；寫在舊位置（colors.titleStyle）＝黃燈不套用", () => {
  const r = loadRegistries();
  const base = { version: 1, layout: "layout-009" };
  const unknown = parseProposalPack({ ...base, titleStyle: "css-zzz" }, r);
  assert.equal(unknown.ok, false); assert.ok(unknown.errors.some((e) => e.includes("未知字風貨號")));
  const rec = r.typestyleRecords.get("css-n3");
  if (rec.review.status !== "approved") {
    const pend = parseProposalPack({ ...base, titleStyle: "css-n3" }, r);
    assert.equal(pend.ok, false); assert.ok(pend.errors.some((e) => e.includes("尚未審查通過") && e.includes(rec.displayName)), pend.errors.join("|"));
  } else {
    assert.equal(parseProposalPack({ ...base, titleStyle: "css-n3" }, r).ok, true);
  }
  const legacy = parseProposalPack({ ...base, colors: { titleStyle: "css-n3", typography: { title: { style: "css-n3" } } } }, r);
  assert.equal(legacy.ok, true, "舊位置＝不擋（相容既有包）");
  if (rec.review.status === "approved") { // 2026-09-04 傍晚相容：舊位置且已審＝照樣帶入＋提醒重新整理工具頁
    assert.equal(legacy.pack.titleStyle, "css-n3", "已審字風從舊位置帶入");
    assert.ok(legacy.warnings.some((w) => w.includes("舊位置") && w.includes("已照樣帶入")), legacy.warnings.join("|"));
  } else {
    assert.ok(legacy.warnings.some((w) => w.includes("舊位置") && w.includes("不會套用")), legacy.warnings.join("|"));
  }
  const legacyPend = parseProposalPack({ ...base, colors: { titleStyle: "css-a2" } }, r); // A2＝CDN 字型、pending
  assert.equal(legacyPend.ok, true); assert.equal(legacyPend.pack.titleStyle, undefined, "未審字風舊位置＝不帶");
  assert.ok(legacyPend.warnings.some((w) => w.includes("不會套用")), legacyPend.warnings.join("|"));
  const none = parseProposalPack(base, r);
  assert.equal(none.ok, true); assert.ok(!none.warnings.some((w) => w.includes("字風")), "沒帶字風＝不吵");
});

/* ---------- 副標題字體 subtitleFont（2026-09-04 使用者翻案 Q8） ---------- */
test("parseProposalPack：subtitleFont 值域＝字體簿貨號＋整百字重；舊位置 fontFamilyCss 對得上＝帶入＋提醒；對不上＝出聲不帶", () => {
  const r = loadRegistries();
  const base = { version: 1, layout: "layout-009" };
  assert.equal(parseProposalPack({ ...base, subtitleFont: { fontId: "font-009", weight: 500 } }, r).ok, true);
  const bad1 = parseProposalPack({ ...base, subtitleFont: { fontId: "font-999" } }, r); assert.equal(bad1.ok, false); assert.ok(bad1.errors.some((e) => e.includes("未知副標字體")));
  const bad2 = parseProposalPack({ ...base, subtitleFont: { fontId: "font-001", weight: 450 } }, r); assert.equal(bad2.ok, false); assert.ok(bad2.errors.some((e) => e.includes("整百")));
  const legacy = parseProposalPack({ ...base, colors: { typography: { subtitle: { font: "wdxl", fontFamilyCss: "'WDXL Lubrifont TC','Noto Sans TC',sans-serif", weightCss: 500 } } } }, r);
  assert.equal(legacy.ok, true); assert.deepEqual(legacy.pack.subtitleFont, { fontId: "font-009", weight: 500 });
  assert.ok(legacy.warnings.some((w) => w.includes("副標字體") && w.includes("舊位置")), legacy.warnings.join("|"));
  const miss = parseProposalPack({ ...base, colors: { typography: { subtitle: { fontFamilyCss: "'BiauKai','DFKai-SB',serif", weightCss: 700 } } } }, r);
  assert.equal(miss.ok, true); assert.equal(miss.pack.subtitleFont, undefined); assert.ok(miss.warnings.some((w) => w.includes("不在字體簿")));
});

/* ---------- 排版檔位一等欄 typography（2026-09-04 Q6 甲量化打包） ---------- */
test("parseProposalPack：typography 只收三個檔位；未知檔位＝擋；非檔位鍵＝略過出聲", () => {
  const r = loadRegistries();
  const base = { version: 1, layout: "layout-009" };
  assert.equal(parseProposalPack({ ...base, typography: { titleScale: "lg", subtitleScale: "sm", titleWidth: "wide" } }, r).ok, true);
  const bad = parseProposalPack({ ...base, typography: { titleScale: "xl" } }, r); assert.equal(bad.ok, false); assert.ok(bad.errors.some((e) => e.includes("sm｜md｜lg")));
  const extra = parseProposalPack({ ...base, typography: { titleScale: "md", sizePx: 63 } }, r); assert.equal(extra.ok, true); assert.ok(extra.warnings.some((w) => w.includes("sizePx") && w.includes("絕對值不帶")));
});

test("parseProposalPack：typography 行距兩檔 titleLeading／subtitleLeading 照收（2026-09-04 晚場）；未知檔位＝擋", () => {
  const r = loadRegistries();
  const base = { version: 1, layout: "layout-009" };
  const ok = parseProposalPack({ ...base, typography: { titleLeading: "lg", subtitleLeading: "sm" } }, r);
  assert.equal(ok.ok, true); assert.ok(!ok.warnings.some((w) => w.includes("titleLeading")), "行距是檔位欄，不得被當成非檔位鍵略過");
  const bad = parseProposalPack({ ...base, typography: { titleLeading: "1.25" } }, r); assert.equal(bad.ok, false); assert.ok(bad.errors.some((e) => e.includes("titleLeading") && e.includes("sm｜md｜lg")));
});

/* ---------- 登記簿一致性（活真源絆線）：版式預設背景不得是退役背景 ----------
   病例 2026-09-04：layouts 簿 008→bg-017、009→bg-018 是 08-25 退役的「舞台」背景，工具換版型仍自動套上、CMS 回預設也回到它＝使用者看到淘汰的舊設計。 */
test("登記簿一致性：每款版式的 defaultBackground 存在且未退役（retiredFromPool）", () => {
  const r = loadRegistries();
  for (const [id, rec] of r.layoutRecords) {
    const bg = r.backgroundRecords.get(rec.defaultBackground);
    assert.ok(bg, `${id} 的預設背景 ${rec.defaultBackground} 不在背景簿`);
    assert.ok(!bg.retiredFromPool, `${id} 的預設背景 ${rec.defaultBackground}（${bg.name}）已退役——換一張現役的當預設`);
  }
});


/* ---------- 工具量不到引擎基準（2026-09-21 B）：typographyMeasured:false → 黃燈警告，不擋、不靜默 ----------
   病例 2026-09-21：線上設計站的工具連不到引擎，每一檔都落到「標準」、包裡沒有 typography，
   CMS「整組帶入」把頁面字級靜靜重設回標準，畫面上沒有任何一句話。 */
test("typographyMeasured:false → 警告「沒有量到引擎」；沒標＝不吵", () => {
  const r = loadRegistries();
  const layout = r.layoutIds[0];
  const flagged = parseProposalPack({ version: 1, layout, typographyMeasured: false }, r);
  assert.ok(flagged.ok, `旗標不該擋：${JSON.stringify(flagged.errors)}`);
  assert.ok(flagged.warnings.some((w) => /沒有量到引擎/.test(w)), "應出黃燈講清楚字級沒帶進來");
  const plain = parseProposalPack({ version: 1, layout }, r);
  assert.ok(plain.ok);
  assert.ok(!plain.warnings.some((w) => /沒有量到引擎/.test(w)), "沒標旗標的包不該多一句");
  const odd = parseProposalPack({ version: 1, layout, typographyMeasured: "yes" }, r);
  assert.ok(odd.ok && !odd.warnings.some((w) => /沒有量到引擎/.test(w)), "非 false 的值＝未知欄容忍、不吵");
});

/* ---------- 登記簿指紋（2026-09-21 C）：檢查結果會不會過期，看內容不看時間 ---------- */
test("registriesFingerprint：八本簿各有指紋、同內容同指紋、舊報告沒指紋＝全部要重檢", () => {
  const { registriesFingerprint, registriesChanged, REGISTRY_LABELS } = require("../../lib/proposal_pack");
  const a = registriesFingerprint(), b = registriesFingerprint();
  assert.strictEqual(a.sha, b.sha, "同一份內容兩次算要一樣");
  assert.deepStrictEqual(Object.keys(a.files).sort(), Object.keys(REGISTRY_LABELS).sort(), "八本簿一本不少");
  assert.ok(Object.values(a.files).every((v) => v !== "missing"), "活真源八本都讀得到");
  assert.strictEqual(registriesChanged(a, b).length, 0, "沒變＝沒有簿要重檢");
  assert.strictEqual(registriesChanged(null, a).length, 8, "舊報告沒指紋＝八本全列（寧可多跑一次快檢）");
  const tampered = { sha: "x", files: { ...a.files, pendingBackgrounds: "deadbeef" } };
  assert.deepStrictEqual(registriesChanged(tampered, a), ["待審背景簿"], "只變一本＝只點名那一本，用人看得懂的名字");
});
