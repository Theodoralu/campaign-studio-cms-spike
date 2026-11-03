"use strict";
/**
 * workbench/curate_auto.js v2 主題橋接單元測試（2026-08-26 病例 214311 根治批）
 * 守的邏輯：建立所選的色必須到得了新版型——
 *  ①自訂 hex 路＝deriveThemeDraft 單一真源寫 colors.themeDraft（欄形與 hero_combo customColor 同形＝
 *    {source:"custom", seed, overrides:{}, themeDraft}，家族三欄 brand/brandSoft/brandNeon 齊）
 *  ②hue 家族路＝token 十主題有同名 slug 寫 themeId；沒有（pink/mono、rejected 款）＝家族代表色
 *    （campaign/accent 真值）走自訂盤路＋seedOrigin 履歷
 *  ③legacy/new 頁＝no-op：colorTheme 照舊、不寫新欄、draft 一字不動（零波及）
 *  ④不覆蓋：已有 themeId／colors.themeDraft（提案包先寫）＝不動
 *  ⑤惰性讀簿：值域函式只有家族路才呼叫（custom hex 路不得觸發登記簿讀取）
 *  ⑥檔案版：有變更才寫回；登錄絆線＝draft-writers.allow create-theme-bridge 行（G3 登錄制）
 * fixture 紀律：hermetic——kvVariant 用永不完工樣本 id（layout-014）、主題值域用字面陣列不讀真簿。
 */
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const CA = require("../../workbench/curate_auto"); // require 守門：不得誤跑 CLI main（跑了會 process.exit）
const TD = require("../../lib/theme_draft");

/* hermetic 主題值域＝鏡真簿形（default＋八款正式；blue-dark/clash-dark rejected 不在列） */
const THEME_IDS = ["default", "green-light", "green-dark", "gold-light", "gold-dark", "blue-light", "japanese", "clash"];

const mkDraft = (pageOver = {}) => ({
  page: {
    kvVariant: "layout-014",
    theme: { hueFamily: "pink", colorTheme: "pink-light", surfaceMode: "light", kvTitleStyle: "deep", moduleBorderStyle: "theme", labelStyle: "deep-plate" },
    ...pageOver,
  },
  meta: { engine: "auto" },
  products: [],
});

test("require 守門：取橋接函式不誤跑 CLI 主流程（gate.js 前例）", () => {
  assert.equal(typeof CA.bridgeThemeForV2, "function");
  assert.equal(typeof CA.bridgeThemeForV2IntoDraft, "function");
});

/* ---------- ①自訂 hex 路 ---------- */
test("自訂 hex 路＝deriveThemeDraft 單一真源、欄形與 hero_combo 同形、家族三欄齊（反例 145831 同路）", () => {
  const d = mkDraft({ theme: { hueFamily: "custom", colorTheme: "custom-light", surfaceMode: "light", customColor: "#112233" } }); // 2026-08-27 擋色制：改用擋級全過的種子（原 #2d9f55 標題檢查不過＝走 autopass 路、另測）
  const r = CA.bridgeThemeForV2(d, THEME_IDS);
  assert.equal(r.applied, true);
  assert.equal(r.mode, "custom-seed");
  const c = d.page.colors;
  assert.deepEqual(Object.keys(c).sort(), ["overrides", "seed", "source", "themeDraft"], "欄形＝hero_combo customColor 同形（編修頁可無縫接手）");
  assert.equal(c.source, "custom");
  assert.equal(c.seed, "#112233", "seed 正規化大寫");
  assert.deepEqual(c.overrides, {});
  const td = c.themeDraft;
  assert.equal(td.brand, "#112233", "brand＝seed 直通");
  assert.ok(TD.isHex6(td.brandSoft) && TD.isHex6(td.brandNeon), "家族三欄齊（palette-engine 三軌）");
  assert.equal(td.componentColors.title, "#112233", "忠實用色：標題＝主色原樣");
  assert.equal(td.price, "#EB0F29", "價格紅恆定（鐵律）");
  assert.equal(d.page.themeId, undefined, "自訂色上場＝不寫主題 slug（單一控制點）");
  assert.ok(d.meta.themeBridge && d.meta.themeBridge.mode === "custom-seed", "meta.themeBridge 履歷");
  /* 與 deriveThemeDraft 直呼 byte-identical＝真的沒有第二套推導（推導為純函式、同種子同產物） */
  assert.deepEqual(td, TD.deriveThemeDraft("#112233"), "themeDraft＝deriveThemeDraft 原樣產物");
});

test("自訂 hex 兜底 autopass（2026-08-27 擋色制）：不及格 hex 溜到橋接＝自動改用通過版＋原值記帳", () => {
  const d = mkDraft({ theme: { hueFamily: "custom", colorTheme: "custom-light", surfaceMode: "light", customColor: "#2d9f55" } });
  const r = CA.bridgeThemeForV2(d, THEME_IDS);
  assert.equal(r.applied, true);
  assert.equal(r.mode, "custom-seed-autopass");
  assert.equal(d.page.colors.seed, "#227840", "同色系調深到擋級全過的版本");
  assert.equal(d.page.colors.seedOrigin, "auto-pass:#2D9F55", "原值記在履歷");
  assert.ok(r.note.includes("#2D9F55") && r.note.includes("#227840"), "note 帶原值與採用值（不靜默）");
  assert.ok(TD.checkThemeDraft(d.page.colors.themeDraft).every((x) => x.pass || x.blocking === false), "帶入草案擋級全過");
});

test("惰性讀簿：自訂 hex 路不得觸發主題值域讀取（登記簿壞掉也不影響 hex 路）", () => {
  const d = mkDraft({ theme: { hueFamily: "custom", colorTheme: "custom-light", surfaceMode: "light", customColor: "#336699" } });
  const r = CA.bridgeThemeForV2(d, () => { throw new Error("不該被呼叫"); });
  assert.equal(r.applied, true);
  assert.equal(r.mode, "custom-seed");
});

/* ---------- ②hue 家族路 ---------- */
test("token 家族路：green（light）→ themeId=green-light；legacy colorTheme 照舊、不寫 colors", () => {
  const d = mkDraft({ theme: { hueFamily: "green", colorTheme: "green-light", surfaceMode: "light" } });
  const r = CA.bridgeThemeForV2(d, THEME_IDS);
  assert.equal(r.applied, true);
  assert.equal(r.mode, "token-theme");
  assert.equal(d.page.themeId, "green-light");
  assert.equal(d.page.colors, undefined, "token 主題＝不落自訂盤");
  assert.equal(d.page.theme.colorTheme, "green-light", "legacy 欄照舊（舊引擎續吃）");
});

test("token 家族路：surfaceMode dark → 對 dark slug（gold-dark）", () => {
  const d = mkDraft({ theme: { hueFamily: "gold", colorTheme: "gold-dark", surfaceMode: "dark" } });
  const r = CA.bridgeThemeForV2(d, THEME_IDS);
  assert.equal(r.mode, "token-theme");
  assert.equal(d.page.themeId, "gold-dark");
});

test("hueFamily 缺席（AI 漏欄）→ 從 colorTheme 十枚舉拆家族（gold-dark）", () => {
  const d = mkDraft({ theme: { colorTheme: "gold-dark" } });
  const r = CA.bridgeThemeForV2(d, THEME_IDS);
  assert.equal(r.mode, "token-theme");
  assert.equal(d.page.themeId, "gold-dark");
});

test("病例 214311 重演：pink（token 沒有）→ 家族代表色走自訂盤＋機選自動用通過版（2026-08-27 使用者裁決）", () => {
  const d = mkDraft(); // 預設 pink-light（＝214311 的 theme 欄原樣）
  const r = CA.bridgeThemeForV2(d, THEME_IDS);
  assert.equal(r.applied, true);
  assert.equal(r.mode, "family-seed");
  const c = d.page.colors;
  assert.equal(c.seed, "#BF1047", "代表色 #F26591 擋級檢查不過＝自動改用同色系通過版（機選自動用通過版裁決）");
  assert.equal(c.seedOrigin, "auto-hue-pass:pink-light", "機選＋自動通過版履歷（≠使用者親選；原代表色記在 note）");
  assert.ok(r.note.includes("#F26591"), "原代表色值記帳可考");
  assert.equal(c.source, "custom", "source=custom＝編修頁逐槽微調可接手");
  assert.ok(TD.isHex6(c.themeDraft.brandSoft) && TD.isHex6(c.themeDraft.brandNeon), "家族三欄齊＝新模組主色件到得了");
  assert.ok(TD.checkThemeDraft(c.themeDraft).every((x) => x.pass || x.blocking === false), "帶入的草案擋級全過＝建立即可上線零卡關");
  assert.equal(d.page.themeId, undefined);
});

test("rejected 款 fallback：blue＋dark（token 無 blue-dark）→ 家族代表色 #6EA6D4 自訂盤", () => {
  const d = mkDraft({ theme: { hueFamily: "blue", colorTheme: "blue-dark", surfaceMode: "dark" } });
  const r = CA.bridgeThemeForV2(d, THEME_IDS);
  assert.equal(r.mode, "family-seed");
  assert.equal(d.page.colors.seed, "#2E6A9B", "代表色 #6EA6D4 不過檢＝自動通過版（2026-08-27 裁決）");
  assert.equal(d.page.colors.seedOrigin, "auto-hue-pass:blue-dark");
});

test("mono 家族（token 沒有）→ 代表色 #6E7780 自訂盤", () => {
  const d = mkDraft({ theme: { hueFamily: "mono", colorTheme: "mono-light", surfaceMode: "light" } });
  const r = CA.bridgeThemeForV2(d, THEME_IDS);
  assert.equal(r.mode, "family-seed");
  assert.equal(d.page.colors.seed, "#5E656D", "代表色 #6E7780 不過檢＝自動通過版（2026-08-27 裁決）");
});

test("FAMILY_ACCENT 表＝五家族×亮暗十格、值全合法 hex（campaign/accent 真值鏡像）", () => {
  const keys = Object.keys(CA.FAMILY_ACCENT).sort();
  assert.equal(keys.length, 10);
  for (const fam of ["pink", "gold", "green", "blue", "mono"]) {
    assert.ok(keys.includes(`${fam}-light`) && keys.includes(`${fam}-dark`), `${fam} 亮暗齊`);
  }
  for (const v of Object.values(CA.FAMILY_ACCENT)) assert.ok(TD.isHex6(v));
});

/* ---------- ③legacy no-op／④不覆蓋／值域外 ---------- */
test("legacy 路（kvVariant=new）：不寫新欄、draft 一字不動、colorTheme 照舊", () => {
  const d = mkDraft({ kvVariant: "new" });
  const before = JSON.stringify(d);
  const r = CA.bridgeThemeForV2(d, THEME_IDS);
  assert.equal(r.applied, false);
  assert.equal(r.mode, "legacy");
  assert.equal(JSON.stringify(d), before, "零波及（含 meta 不加履歷）");
});

test("不覆蓋：已有 themeId（提案包/先行寫入）＝no-op", () => {
  const d = mkDraft({ themeId: "japanese" });
  const r = CA.bridgeThemeForV2(d, THEME_IDS);
  assert.equal(r.applied, false);
  assert.equal(r.mode, "present");
  assert.equal(d.page.themeId, "japanese");
});

test("不覆蓋：已有 colors.themeDraft ＝no-op（145831 這類已修好的頁不重寫）", () => {
  const td = TD.deriveThemeDraft("#2D9F55");
  const d = mkDraft({ colors: { source: "custom", seed: "#2D9F55", overrides: {}, themeDraft: td } });
  const r = CA.bridgeThemeForV2(d, THEME_IDS);
  assert.equal(r.applied, false);
  assert.equal(r.mode, "present");
  assert.equal(d.page.colors.themeDraft, td);
});

test("值域外家族（hueFamily 與 colorTheme 皆自創值）：不橋接、出聲不裝懂、draft 不動", () => {
  const d = mkDraft({ theme: { hueFamily: "warm", colorTheme: "warm-light", surfaceMode: "light" } });
  const before = JSON.stringify(d);
  const r = CA.bridgeThemeForV2(d, THEME_IDS);
  assert.equal(r.applied, false);
  assert.equal(r.mode, "unknown-hue");
  assert.match(r.note, /warm/);
  assert.equal(JSON.stringify(d), before);
});

test("hueFamily 值域外但 colorTheme 合法＝以 colorTheme 救回（gate 枚舉欄較強治理）", () => {
  const d = mkDraft({ theme: { hueFamily: "warm", colorTheme: "pink-light", surfaceMode: "light" } });
  const r = CA.bridgeThemeForV2(d, THEME_IDS);
  assert.equal(r.mode, "family-seed");
  assert.equal(d.page.colors.seed, "#BF1047", "colorTheme 救回＋自動通過版（2026-08-27 裁決）");
});

/* ---------- ⑥檔案版＋登錄絆線 ---------- */
test("檔案版：v2 有變更才寫回、legacy 檔案 byte 不動", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "theme-bridge-"));
  try {
    const p = path.join(dir, "draft.json");
    fs.writeFileSync(p, JSON.stringify(mkDraft(), null, 1));
    const r = CA.bridgeThemeForV2IntoDraft(p, THEME_IDS);
    assert.equal(r.applied, true);
    const dj = JSON.parse(fs.readFileSync(p, "utf8"));
    assert.equal(dj.page.colors.seed, "#BF1047"); // 機選自動用通過版（2026-08-27 裁決）
    assert.ok(dj.meta.themeBridge, "meta.themeBridge 履歷落檔");

    const p2 = path.join(dir, "draft-legacy.json");
    const legacyRaw = JSON.stringify(mkDraft({ kvVariant: "legacy" }), null, 1);
    fs.writeFileSync(p2, legacyRaw);
    const r2 = CA.bridgeThemeForV2IntoDraft(p2, THEME_IDS);
    assert.equal(r2.applied, false);
    assert.equal(fs.readFileSync(p2, "utf8"), legacyRaw, "no-op＝檔案 byte 不動");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("檔案版：讀不到＝throw 白話出聲（不靜默降級）", () => {
  assert.throws(() => CA.bridgeThemeForV2IntoDraft(path.join(os.tmpdir(), "不存在的-draft.json"), THEME_IDS), /v2 主題橋接失敗（讀取/);
});

test("登錄絆線：draft-writers.allow CREATE 節必須登錄 create-theme-bridge（G3 登錄制）", () => {
  const allow = fs.readFileSync(path.join(__dirname, "..", "..", "scripts", "draft-writers.allow"), "utf8");
  assert.match(allow, /create-theme-bridge\s+workbench\/curate_auto\.js\s+bridgeThemeForV2IntoDraft/, "新寫入點必須登錄 draft-writers.allow（絆線）");
});
