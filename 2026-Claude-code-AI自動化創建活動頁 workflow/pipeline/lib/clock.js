"use strict";
/**
 * lib/clock.js —— 唯一的時鐘（D4，2026-11-06）
 *
 * 為什麼：snapshot／draft／gate 的 fetchedAt、generatedAt、checkedAt、檔期「現在」判斷散落十幾處 Date.now()，
 * 離線重跑永遠對不上。全部改讀這裡；正式服務什麼都不設＝真實時間。
 *
 * CS_NOW=<ISO 8601 或 epoch ms>  ＝固定時鐘（測試／回放用）。設了就恆回同一刻，不走動。
 *
 * 用法：const clock = require("./lib/clock");
 *   clock.now()      → epoch ms（取代 Date.now()）
 *   clock.date()     → Date 物件（取代 new Date()）
 *   clock.iso()      → ISO 字串（取代 new Date().toISOString()）
 *   clock.unix()     → epoch 秒（取代 Math.floor(Date.now()/1000)）
 *   clock.fixed()    → 是否被 CS_NOW 固定
 */
function parseFixed() {
  const v = process.env.CS_NOW;
  if (!v) return null;
  const ms = /^\d+$/.test(v) ? Number(v) : Date.parse(v);
  if (!Number.isFinite(ms)) throw new Error(`CS_NOW 不是合法時間：${v}（請給 ISO 8601 或 epoch ms）`);
  return ms;
}
function now() { const f = parseFixed(); return f == null ? Date.now() : f; }
module.exports = {
  now,
  date: () => new Date(now()),
  iso: () => new Date(now()).toISOString(),
  unix: () => Math.floor(now() / 1000),
  fixed: () => parseFixed() != null,
};
