#!/usr/bin/env node
"use strict";
/**
 * tools/cassette_from_raw.js —— 把既有 run 的 raw/*.html 轉成 http_replay 卡帶（D4）
 *
 * 單機版每次抓取都把來源頁原文存在 runs/<id>/raw/（source_page.html、act_<actid>.html）。
 * 這支工具把它們轉成 lib/http_replay 的卡帶，讓沒有網路的環境（CI、公司外、以及這台開發機）
 * 也能用 CS_HTTP_MODE=replay 重跑 fetch_parse.js，而且產出的 snapshot 與當年那一份逐字相同。
 *
 * 用法：node tools/cassette_from_raw.js <runDir> [cassetteDir]
 *   runDir      含 snapshot.json 與 raw/ 的 run 資料夾
 *   cassetteDir 預設 test/fixtures/http/
 * 網址對應：source_page.html ← snapshot.sourceUrl；act_<actid>.html ← snapshot.promotions[].url（actid 相同者）
 * 狀態碼一律記 200（raw 只存頁身；fetch_parse 對 200／404 同樣處理，不影響解析）。
 */
const fs = require("fs");
const path = require("path");
const replay = require("../lib/http_replay");

const [runDir, cassetteDir] = process.argv.slice(2);
if (!runDir) { console.error("用法：node tools/cassette_from_raw.js <runDir> [cassetteDir]"); process.exit(1); }
if (cassetteDir) process.env.CS_HTTP_CASSETTE_DIR = cassetteDir;
process.env.CS_HTTP_MODE = "record";

const snap = JSON.parse(fs.readFileSync(path.join(runDir, "snapshot.json"), "utf8"));
const rawDir = path.join(runDir, "raw");
const map = { "source_page.html": snap.sourceUrl };
for (const p of snap.promotions || []) if (p.actid && p.url) map[`act_${p.actid}.html`] = p.url;

const dir = replay.cassetteDir();
fs.mkdirSync(dir, { recursive: true });
let idx = {};
try { idx = JSON.parse(fs.readFileSync(path.join(dir, "index.json"), "utf8")); } catch (_) { /* 第一次 */ }
let n = 0;
for (const f of fs.readdirSync(rawDir)) {
  const url = map[f];
  if (!url) { console.warn(`略過 ${f}：snapshot 裡找不到對應網址`); continue; }
  const key = replay.keyOf("GET", url);
  const rec = { url, statusCode: 200, headers: { "content-type": "text/html; charset=utf-8" }, encoding: "utf8",
    body: fs.readFileSync(path.join(rawDir, f), "utf8"), recordedAt: snap.fetchedAt, source: `${path.basename(runDir)}/raw/${f}` };
  fs.writeFileSync(path.join(dir, `${key}.json`), JSON.stringify(rec, null, 2));
  idx[key] = { method: "GET", url, statusCode: 200, recordedAt: snap.fetchedAt, source: rec.source };
  n++;
  console.log(`${key}  ←  raw/${f}\n           ${url}`);
}
fs.writeFileSync(path.join(dir, "index.json"), JSON.stringify(idx, Object.keys(idx).sort(), 2));
console.log(`完成：${n} 份卡帶 → ${dir}`);
