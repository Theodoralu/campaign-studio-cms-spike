/* 能力表偵測（2026-09-15 B 批，牆第 6 題甲）：介面看能力、伺服器看旗標。
   守三件：①三項能力的判定條件（含「claude 裝了但沒登入＝ai:false 且 note 講得出原因」）
          ②編修模式一律 publish／vendorSheet false（旗標蓋過探針）
          ③CAMPAIGN_CAPS 覆寫可用於 hermetic 測試與同事包，壞字面略過並回報、不炸 */
"use strict";
const test = require("node:test");
const assert = require("node:assert");
const C = require("../../lib/capabilities.js");

const probes = (o = {}) => ({
  claudeInstalled: () => ({ ok: o.installed !== false, detail: "2.1.0" }),
  claudeLogin: () => ({ ok: o.login !== false, detail: o.login === false ? "Not logged in" : "登入正常" }),
  deployChain: () => ({ ok: o.chain !== false, detail: "部署腳本與鏡像都在" }),
  googleToken: () => ({ ok: o.google !== false, detail: "Google 已連結" }),
});

test("負責人機、全部探針過＝三項都有", () => {
  const r = C.detectCapabilities({ mode: "owner", probes: probes() });
  assert.deepStrictEqual(r.caps, { ai: true, publish: true, vendorSheet: true });
  assert.strictEqual(r.mode, "owner");
  assert.deepStrictEqual(r.overrides, []);
});

test("claude 裝了但沒登入＝ai:false，說明講得出「還沒登入」（介面橫幅用這句）", () => {
  const r = C.detectCapabilities({ mode: "owner", probes: probes({ login: false }) });
  assert.strictEqual(r.caps.ai, false);
  assert.strictEqual(r.detail.ai.installed, true);
  assert.strictEqual(r.detail.ai.loginOk, false);
  assert.match(r.detail.ai.note, /還沒登入/);
});

test("claude 沒裝＝ai:false、不跑登入探針（同事機常態，不能因為沒裝就慢 15 秒）", () => {
  let loginCalled = false;
  const p = probes({ installed: false }); p.claudeLogin = () => { loginCalled = true; return { ok: true, detail: "" }; };
  const r = C.detectCapabilities({ mode: "owner", probes: p });
  assert.strictEqual(r.caps.ai, false);
  assert.strictEqual(loginCalled, false);
  assert.match(r.detail.ai.note, /沒有 Claude 指令/);
});

test("編修模式＝publish／vendorSheet 一律 false，探針說有也不算（旗標蓋探針＝安全層）", () => {
  const r = C.detectCapabilities({ mode: "editor", probes: probes() });
  assert.strictEqual(r.caps.publish, false);
  assert.strictEqual(r.caps.vendorSheet, false);
  assert.strictEqual(r.caps.ai, true, "AI 跟模式無關：同事有登入 claude 就能用");
  assert.match(r.detail.publish.note, /編修模式/);
});

test("負責人機缺鏡像＝publish:false 並講缺什麼", () => {
  const r = C.detectCapabilities({ mode: "owner", probes: probes({ chain: false }) });
  assert.strictEqual(r.caps.publish, false);
});

test("CAMPAIGN_CAPS 覆寫：關掉 ai 與 publish 給 hermetic 測試用；被覆寫的項不跑真探針（測試不會真的去叫 Claude）", () => {
  let probed = [];
  const p = probes(); for (const k of Object.keys(p)) { const f = p[k]; p[k] = () => { probed.push(k); return f(); }; }
  const r = C.detectCapabilities({ mode: "owner", probes: p, override: "ai:0,publish:false" });
  assert.deepStrictEqual(r.caps, { ai: false, publish: false, vendorSheet: true });
  assert.deepStrictEqual(probed, ["googleToken"], "只有沒被覆寫的 vendorSheet 才真的探");
  assert.match(r.detail.ai.note, /未探測/);
  assert.ok(r.overrides.length === 0 || r.overrides.every((s) => /→/.test(s)), "覆寫紀錄只記真的改變了的（探針沒跑＝原值 false→false 不記）");
});

test("CAMPAIGN_CAPS 壞字面＝略過並回報，不炸、不影響其他項", () => {
  const r = C.detectCapabilities({ mode: "owner", probes: probes(), override: "ai:maybe,foo:1,vendorSheet:0" });
  assert.strictEqual(r.caps.ai, true);
  assert.strictEqual(r.caps.vendorSheet, false);
  assert.ok(r.overrides.some((s) => /略過無法解析/.test(s) && /ai:maybe/.test(s) && /foo:1/.test(s)));
});

test("KEYS 就是介面 data-needs 的合法值域（前端只准用這三個字）", () => {
  assert.deepStrictEqual(C.KEYS, ["ai", "publish", "vendorSheet"]);
});
