"use strict";
/**
 * lib/proposal_pack.js loadRegistries 擴充欄單元測試（51 號 W1-E）：
 * backgroundRecords／backgroundsMeta／motionRecords／heroVariantRecords＝gate CP-25/27 消費面。
 *
 * hermetic（W1-A review 教訓＝proposal_pack.test.js 直讀活真源屬絆線設計、單獨 checkout 會紅）：
 * 本檔一律經 overridePaths 注入 test/fixtures/registries/ 最小複本——不依賴主 repo 佈局。
 */
const { test } = require("node:test");
const assert = require("node:assert");
const path = require("node:path");

const { loadRegistries } = require("../../lib/proposal_pack");

const REG = path.join(__dirname, "..", "fixtures", "registries");
const P = (opts = {}) => ({
  modules: path.join(REG, "modules.json"),
  layouts: path.join(REG, "layouts.manifest.json"),
  backgrounds: path.join(REG, opts.noTerms ? "backgrounds.noterms.manifest.json" : "backgrounds.manifest.json"),
  fonts: path.join(REG, "fonts.manifest.json"),
  motion: path.join(REG, "motion.manifest.json"),
  tokens: path.join(REG, "tokens.json"),
});

test("backgroundRecords：逐貨號紀錄可查 license 與複查欄（CP-27 消費形）", () => {
  const r = loadRegistries(P());
  assert.strictEqual(r.backgroundRecords.get("bg-005").license, "A");
  assert.strictEqual(r.backgroundRecords.get("bg-001").license, "C");
  const b8 = r.backgroundRecords.get("bg-008");
  assert.strictEqual(b8.license, "B");
  assert.strictEqual(b8.qaStatus, "pass");
  assert.strictEqual(r.backgroundRecords.get("bg-009").qaStatus, "pass-with-note");
  assert.strictEqual(r.backgroundRecords.get("bg-010").qaStatus, undefined, "未複查＝欄缺席（gate 據此 FAIL）");
  assert.strictEqual(r.backgroundRecords.get("bg-012").qaStatus, "conditional");
  assert.strictEqual(r.backgroundRecords.get("bg-999"), undefined, "值域外＝undefined（gate 據此 FAIL 不誤放）");
});

test("backgroundsMeta：termsVerification 在場／缺席兩形都如實透出（B 級商用條款前提）", () => {
  const withTerms = loadRegistries(P());
  assert.ok(typeof withTerms.backgroundsMeta.termsVerification === "string" && withTerms.backgroundsMeta.termsVerification.length > 0);
  const noTerms = loadRegistries(P({ noTerms: true }));
  assert.strictEqual(noTerms.backgroundsMeta.termsVerification, undefined, "缺席要如實回 undefined，不得兜底假值");
});

test("motionRecords：license 可查（E7）；motionIds 與紀錄同源", () => {
  const r = loadRegistries(P());
  assert.strictEqual(r.motionRecords.get("motion-002").license, "C");
  assert.strictEqual(r.motionRecords.get("motion-901").license, "A");
  assert.deepStrictEqual([...r.motionRecords.keys()], r.motionIds, "ids 與 records 必同一份 assets 導出（防雙源漂移）");
});

test("heroVariantRecords：rollout 旗標透出（trial／closed／缺席＝開放）；與 heroVariantIds 同源", () => {
  const r = loadRegistries(P());
  assert.strictEqual(r.heroVariantRecords.get("layout-006").rollout, "trial");
  assert.strictEqual(r.heroVariantRecords.get("layout-016").rollout, "closed");
  assert.strictEqual(r.heroVariantRecords.get("legacy").rollout, undefined, "欄缺席＝開放（預設不停新案）");
  assert.deepStrictEqual([...r.heroVariantRecords.keys()], r.heroVariantIds, "ids 與 records 必同一份 variants 導出");
});
