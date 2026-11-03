"use strict";
/**
 * hero_bg_license.test.js —— 背景授權狀態的唯一判斷（lib/hero_bg_license.js）五態全走一遍
 * registry A／已複查 B＝clear；C／pending＝watermark（63 號原樣）；own 未確認＝watermark＋擋；own 已確認（下一版旗標）＝clear；own 缺檔＝unknown＋擋。
 * 78 號 2026-09-27。
 */
const test = require("node:test");
const assert = require("node:assert");
const L = require("../../lib/hero_bg_license.js");

const bgRecs = new Map([
  ["bg-a", { id: "bg-a", license: "A" }],
  ["bg-b-ok", { id: "bg-b-ok", license: "B", qaStatus: "pass", reviewDate: "2026-09-01" }],
  ["bg-b-nodate", { id: "bg-b-nodate", license: "B", qaStatus: "pass" }],
  ["bg-c", { id: "bg-c", license: "C" }],
]);
const pendRecs = new Map([["pending-0001", { id: "pending-0001", review: { status: "pending" } }]]);
const own3 = { files: { desktop: "/api/runs/r1/hero-bg/desktop.png", "768": "/api/runs/r1/hero-bg/768.png", "375": "/api/runs/r1/hero-bg/375.png" }, sha256: "s1" };
const opts = { backgroundRecords: bgRecs, pendingBackgroundRecords: pendRecs };

test("① 登記簿：A 與已複查 B＝clear、不掛字、不擋；C＝掛「背景版權待審核」＋擋；B 缺複查日期＝unknown（交 CP-27）", () => {
  assert.strictEqual(L.resolveHeroBgLicense({ backgroundId: "bg-a" }, opts).state, "clear");
  assert.strictEqual(L.resolveHeroBgLicense({ backgroundId: "bg-b-ok" }, opts).state, "clear");
  const c = L.resolveHeroBgLicense({ backgroundId: "bg-c" }, opts);
  assert.strictEqual(c.state, "watermark"); assert.strictEqual(c.watermarkText, "背景版權待審核"); assert.match(c.exportBlock, /版權還在審核/);
  assert.strictEqual(L.resolveHeroBgLicense({ backgroundId: "bg-b-nodate" }, opts).state, "unknown");
});

test("② 待審訪客號＝掛「背景版權待審核」＋擋（63 號原樣）；缺欄＝走版式預設", () => {
  const p = L.resolveHeroBgLicense({ backgroundId: "pending-0001" }, opts);
  assert.strictEqual(p.kind, "pending"); assert.strictEqual(p.state, "watermark"); assert.match(p.exportBlock, /不能匯出到對外的 AEM/);
  assert.strictEqual(L.resolveHeroBgLicense({}, { ...opts, defaultBackground: "bg-a" }).state, "clear");
});

test("③ 你上傳的背景：三檔齊＋未確認＝掛「背景版權：活動負責人確認中」＋擋；9/30 版的擋句寫明下一版開放", () => {
  const r = L.resolveHeroBgLicense({ backgroundId: "own", heroBgOwn: own3 }, opts);
  assert.strictEqual(r.kind, "own"); assert.strictEqual(r.state, "watermark");
  assert.strictEqual(r.watermarkText, "背景版權：活動負責人確認中");
  assert.match(r.exportBlock, /下一版/);
});

test("④ 你上傳的背景：下一版旗標開＋確認紀錄 sha 相符＝clear；sha 不符或沒有帳號＝仍掛字", () => {
  const ok = L.resolveHeroBgLicense({ backgroundId: "own", heroBgOwn: own3 }, { ...opts, allowOwnConfirm: true, confirm: { sha256: "s1", by: "a@yahootwec.com", at: "2026-10-01" } });
  assert.strictEqual(ok.state, "clear"); assert.strictEqual(ok.exportBlock, null);
  assert.strictEqual(L.resolveHeroBgLicense({ backgroundId: "own", heroBgOwn: own3 }, { ...opts, allowOwnConfirm: true, confirm: { sha256: "other", by: "a@yahootwec.com" } }).state, "watermark");
  assert.strictEqual(L.resolveHeroBgLicense({ backgroundId: "own", heroBgOwn: own3 }, { ...opts, allowOwnConfirm: true, confirm: { sha256: "s1" } }).state, "watermark");
  assert.match(L.resolveHeroBgLicense({ backgroundId: "own", heroBgOwn: own3 }, { ...opts, allowOwnConfirm: true }).exportBlock, /還沒確認版權/); /* 2026-09-29 文案定稿＝與出口擋句同一份 */
});

test("⑤ 你上傳的背景缺檔＝unknown＋擋句講缺哪些；三檔齊判定與缺格清單", () => {
  const two = { files: { desktop: "/api/runs/r1/hero-bg/desktop.png", "768": "/api/runs/r1/hero-bg/768.png" } };
  const r = L.resolveHeroBgLicense({ backgroundId: "own", heroBgOwn: two }, opts);
  assert.strictEqual(r.state, "unknown"); assert.match(r.exportBlock, /三張圖還沒齊/);
  assert.strictEqual(L.ownFilesComplete(own3), true);
  assert.deepEqual(L.ownMissingSlots(two), ["375"]);
  assert.deepEqual(L.ownMissingSlots(null), ["desktop", "768", "375"]);
});

test("⑥ 出口擋句三態（2026-09-29 牆 1 甲／4 乙＋文案過目定稿）：未確認句／換圖句／相符放行；藏標題不再擋", () => {
  assert.strictEqual(L.exportHoldReason({ backgroundId: "own", heroBgOwn: own3 }), L.EXPORT_HOLD_UNCONFIRMED, "沒有任何確認紀錄＝還沒確認句（指路去主視覺背景區）");
  assert.strictEqual(L.exportHoldReason({ backgroundId: "own", heroBgOwn: own3 }, { confirm: { sha256: "s1", by: "a@yahootwec.com", at: "2026-09-29" } }), null);
  assert.strictEqual(L.exportHoldReason({ backgroundId: "own", heroBgOwn: own3 }, { confirm: { sha256: "other", by: "a@yahootwec.com", at: "2026-09-29" } }), L.EXPORT_HOLD_CHANGED, "換過圖＝sha 不符＝換圖句（重做一次是設計不是故障）");
  assert.strictEqual(L.exportHoldReason({ backgroundId: "own", heroBgOwn: own3 }, { confirm: { sha256: "s1" } }), L.EXPORT_HOLD_UNCONFIRMED, "確認紀錄沒有帳號＝不算＝還沒確認句");
  assert.strictEqual(L.exportHoldReason({ backgroundId: "bg-a", heroTitleHidden: true }), null, "藏標題 2026-09-29 起放行（文字責任在上傳背景的具結）");
  assert.strictEqual(L.exportHoldReason({ backgroundId: "bg-a" }), null);
  /* 句子格式＝2026-09-29 使用者過目定稿「主詞・狀態 → 動作」；禁內部代號 */
  for (const s of [L.EXPORT_HOLD_UNCONFIRMED, L.EXPORT_HOLD_CHANGED, L.DEPLOY_HOLD_UNCONFIRMED, L.CONFIRM_DONE_MSG]) {
    assert.match(s, /・.+→/, "拆分訊息格式：主詞・狀態 → 動作");
    assert.doesNotMatch(s, /layout-\d{3}|具結|清牌|wb_meta|sha/i);
  }
  assert.match(L.DEPLOY_HOLD_UNCONFIRMED, /就能發佈$/, "發佈路自己那句收在「就能發佈」");
  assert.match(L.EXPORT_HOLD_UNCONFIRMED, /就能製作$/, "製作路收在「就能製作」");
});

test("⑥-2 ownConfirmMatches：sha＋帳號齊而且對得上才算（真源＝wb_meta.heroBgLicenseConfirm）", () => {
  assert.strictEqual(L.ownConfirmMatches({ heroBgOwn: own3 }, { sha256: "s1", by: "a@yahootwec.com" }), true);
  assert.strictEqual(L.ownConfirmMatches({ heroBgOwn: own3 }, { sha256: "s2", by: "a@yahootwec.com" }), false);
  assert.strictEqual(L.ownConfirmMatches({ heroBgOwn: own3 }, { sha256: "s1" }), false);
  assert.strictEqual(L.ownConfirmMatches({ heroBgOwn: own3 }, null), false);
  assert.strictEqual(L.ownConfirmMatches({ heroBgOwn: { files: own3.files } }, { sha256: "s1", by: "x" }), false, "own 自己沒 sha＝不算");
});
