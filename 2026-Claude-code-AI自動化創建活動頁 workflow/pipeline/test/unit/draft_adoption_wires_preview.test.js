"use strict";
/**
 * 「拿伺服器新稿」的每一處，都要把新稿推給預覽（2026-09-27 立）。
 * 病例：Excel 帶入成功（tofu-89 走查③實踩，run 2026-09-27-wb-123617）——draft.json、備份、imports/、wb.log、gate 全對，
 * 但左側預覽卡在帶入前的畫面，直到使用者隨便改一格（debounceApply 600ms）才整片跳出來＝看起來像隨機延遲、不知道有沒有套上。
 * 根因＝cmImportFile 收尾只做 draft=r.draft→renderEditor→afterDraftMutation，漏了 applyAndWire（預覽靠它 postMessage loadDraftJson）。
 * 全檔十處換稿點只有這一處漏＝鐵律 4「同一條規則多處各抄一份」的名單家族——這顆測試把「以後再開一個端點也不能漏」變成機器動作。
 * 做法：靜態掃 index.html 每個 `draft = r.draft`，往後 12 行內要看到 applyAndWire( 或 reloadPreview(（換殼＝乾淨重載，load 事件自帶 applyAndWire）。
 * 已知例外要寫理由加進 ALLOW；空名單＝現在十處全接。
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const UI = path.join(__dirname, "..", "..", "workbench", "public", "index.html");
const ALLOW = []; // { line: 行首片段, why: "為什麼不用推預覽" }

test("每一處 draft = r.draft 之後 12 行內都有 applyAndWire 或 reloadPreview", () => {
  const lines = fs.readFileSync(UI, "utf8").split("\n");
  const sites = [];
  lines.forEach((l, i) => { if (/\bdraft\s*=\s*r\.draft\b/.test(l)) sites.push(i); });
  assert.ok(sites.length >= 10, `換稿點應有 ≥10 處（現 ${sites.length}）——少了代表有人改寫了採稿語法，測試要跟著改`);
  const leaks = sites.filter((i) => {
    const win = lines.slice(i, i + 13).join("\n");
    const allowed = ALLOW.some((a) => lines[i].includes(a.line));
    return !allowed && !/applyAndWire\(|reloadPreview\(/.test(win);
  }).map((i) => `L${i + 1}: ${lines[i].trim().slice(0, 80)}`);
  assert.deepStrictEqual(leaks, [], `這些地方拿了新稿卻沒推給預覽：\n${leaks.join("\n")}`);
});

test("Excel 帶入收尾＝cmApply 同一口徑：afterDraftMutation(diskConsistent)→renderEditor→applyGateMarks→applyAndWire→捲到帶入的區塊", () => {
  const src = fs.readFileSync(UI, "utf8");
  const i = src.indexOf("async function cmImportFile(");
  assert.ok(i > 0);
  const fn = src.slice(i, src.indexOf("\n}\n", i));
  assert.match(fn, /draft = r\.draft; dirty = false; savedAtTxt = "";/);
  assert.match(fn, /await afterDraftMutation\(r, \{ diskConsistent: true \}\);/, "伺服器已落地新稿＝diskConsistent");
  assert.match(fn, /renderEditor\(\); applyGateMarks\(\); applyAndWire\(\);/);
  assert.match(fn, /syncPreviewTo\(CM_ANCHORS\[kind\], true\);/, "捲到帶入的區塊＝『有套上』的直接確認");
  assert.match(src, /const CM_ANCHORS = \{ mechanic: "sec-cm-mechanic", spotlight: "sec-cm-spotlight", promoCard: "sec-cm-promocard" \};/, "錨點表沒變（syncPreviewTo 吃 sec- id）");
});
