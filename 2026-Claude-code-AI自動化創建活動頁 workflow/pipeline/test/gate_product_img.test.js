"use strict";
/**
 * gate.js CP-02 商品圖真值（2026-09-04 補）：CMS 會向商品頁補抓前五張讓設計師挑主圖，這些圖不在快照 imgs 裡——
 * 同一件商品的圖檔名帶同一組尾碼（-Gd-<gdid>／-SP-<id>）＝放行；別件商品／來路不明＝照擋。
 * hermetic：沿 gate_hero_gates.test.js 的 runGate（GATE_SKIP_HTTP＋fixtures 登記簿注入）。
 */
const { test } = require("node:test");
const assert = require("node:assert");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const GATE = path.join(__dirname, "..", "gate.js");
const FIX = path.join(__dirname, "fixtures");
const REG = path.join(FIX, "registries");
const regOverrides = () => JSON.stringify({
  modules: path.join(REG, "modules.json"), layouts: path.join(REG, "layouts.manifest.json"),
  backgrounds: path.join(REG, "backgrounds.manifest.json"), fonts: path.join(REG, "fonts.manifest.json"),
  motion: path.join(REG, "motion.manifest.json"), tokens: path.join(REG, "tokens.json"),
});
function runGate(draft) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gate-img-"));
  const snapPath = path.join(dir, "snapshot.json"), draftPath = path.join(dir, "draft.json");
  fs.copyFileSync(path.join(FIX, "gate_pass_snapshot.json"), snapPath);
  fs.writeFileSync(draftPath, JSON.stringify(draft, null, 1));
  const env = { ...process.env, GATE_SKIP_HTTP: "1", GATE_REGISTRY_OVERRIDES: regOverrides() };
  let status = 0, stdout = "";
  try { stdout = execFileSync("node", [GATE, snapPath, draftPath], { encoding: "utf8", env }); }
  catch (e) { status = e.status ?? 1; stdout = (e.stdout || "").toString(); }
  finally { fs.rmSync(dir, { recursive: true, force: true }); }
  return { status, stdout };
}
const passDraft = () => JSON.parse(fs.readFileSync(path.join(FIX, "gate_pass_layout006_draft.json"), "utf8"));

test("CP-02 商品圖：同一件商品的圖（尾碼相同、不在快照）＝放行", () => {
  const d = passDraft(); const p = d.products[0];
  p.img = "https://img.yec.tw/zp/MerchandiseImages/FFFFFFFFFF-SP-18656577.jpg"; // 與快照 imgs 同尾碼 -SP-18656577
  const r = runGate(d);
  assert.ok(!/商品圖不在來源圖庫/.test(r.stdout), "同件商品的圖不得被擋：\n" + r.stdout.slice(0, 600));
  assert.strictEqual(r.status, 0, "pass fixture 換同件商品圖後仍應 PASS：\n" + r.stdout.slice(0, 600));
});

test("CP-02 商品圖：別件商品的圖（尾碼不同）＝照擋", () => {
  const d = passDraft(); const p = d.products[0];
  p.img = "https://img.yec.tw/zp/MerchandiseImages/FFFFFFFFFF-SP-99999999.jpg";
  const r = runGate(d);
  assert.notStrictEqual(r.status, 0);
  assert.ok(/商品圖不在來源圖庫，也不是這件商品的圖/.test(r.stdout), r.stdout.slice(0, 600));
});
