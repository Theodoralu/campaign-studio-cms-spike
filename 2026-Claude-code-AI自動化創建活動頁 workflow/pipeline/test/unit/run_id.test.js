"use strict";
/**
 * workbench/run_id.js 單元測試（零新相依，僅 node:test；不觸網、暫存資料夾 hermetic）
 *
 * 迴歸鎖（2026-08-31 同秒相撞根治）：同一秒連發多筆建檔，每筆必須拿到「彼此不同」的 id
 * 與「當場已建立」的專屬資料夾——原病＝時分秒 id＋recursive mkdir 不吭聲，三檔擠進同一資料夾
 * 互相覆寫（實證 run 2026-08-31-wb-085542：meta 記寢具、draft 卻是運動鞋）。
 */
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { allocRunId } = require("../../workbench/run_id.js");

function tmpRuns() { return fs.mkdtempSync(path.join(os.tmpdir(), "runid-test-")); }

test("單發＝原格式 id、不帶尾綴、資料夾已建", () => {
  const runs = tmpRuns();
  const now = new Date(2026, 7, 31, 8, 55, 42);
  const r = allocRunId(runs, now);
  assert.strictEqual(r.id, "2026-08-31-wb-085542");
  assert.strictEqual(r.yielded, false);
  assert.ok(fs.existsSync(r.runDir));
});

test("同秒四連發＝四個不同 id、四個不同資料夾（原病迴歸鎖）", () => {
  const runs = tmpRuns();
  const now = new Date(2026, 7, 31, 8, 55, 42);
  const got = [1, 2, 3, 4].map(() => allocRunId(runs, now));
  const ids = got.map((r) => r.id);
  assert.strictEqual(new Set(ids).size, 4, "四筆 id 必須互不相同");
  assert.deepStrictEqual(ids, ["2026-08-31-wb-085542", "2026-08-31-wb-085542-2", "2026-08-31-wb-085542-3", "2026-08-31-wb-085542-4"]);
  assert.deepStrictEqual(got.map((r) => r.yielded), [false, true, true, true], "讓位旗標＝呼叫端記 log 出聲的依據");
  for (const r of got) assert.ok(fs.existsSync(r.runDir), r.id + " 資料夾必須當場建立");
});

test("runs 根目錄不存在＝自動建（recursive 只用在根、不用在 run 資料夾）", () => {
  const runs = path.join(tmpRuns(), "deep", "runs");
  const r = allocRunId(runs, new Date(2026, 7, 31, 9, 0, 0));
  assert.ok(fs.existsSync(r.runDir));
});
