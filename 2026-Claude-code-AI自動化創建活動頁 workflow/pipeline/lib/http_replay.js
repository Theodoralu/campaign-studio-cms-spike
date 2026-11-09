"use strict";
/**
 * lib/http_replay.js —— 對外 HTTP 的錄製／回放（D4，2026-11-06）
 *
 * 三種模式，由 CS_HTTP_MODE 決定；正式服務不設＝live，行為與原本 https.get 完全相同。
 *   live    ：直接打網路（預設）
 *   record  ：打網路，同時把每一次請求的回應存成卡帶（cassette）
 *   replay  ：不打網路，只從卡帶回答；卡帶沒有的網址＝throw 出聲（鐵律 3），不會偷偷上網
 *
 * CS_HTTP_CASSETTE_DIR：卡帶資料夾，預設 test/fixtures/http/
 * 卡帶一個網址一個檔：<sha1(url)>.json ＝ { url, statusCode, headers, body, recordedAt }；
 * 另有 index.json 讓人看得懂 hash 對哪個網址。只存 location／content-type 兩個 header。
 *
 * 提供兩個入口，簽名與 Node 原生一致，呼叫端零改動：
 *   get(url, opts, cb)   取代 https.get —— fetch_parse.js fetchOnce 用
 *   fetch(url, init)     取代 globalThis.fetch —— 之後 gate.js 圖片檢查、uther client 用
 * 兩者共用同一份卡帶。body 以 utf8 存（HTML／JSON）；二進位回應存 base64 並標 encoding。
 */
const fs = require("fs");
const path = require("path");
const https = require("https");
const http = require("http");
const crypto = require("crypto");
const { PassThrough, EventEmitter } = require("stream");
require("../lib/net_tuning"); // 絆線（net_tuning.test.js）：會對外抓的門都要接上同一份連線預算

const MODE = () => (process.env.CS_HTTP_MODE || "live").toLowerCase();
const DIR = () => process.env.CS_HTTP_CASSETTE_DIR || path.join(__dirname, "..", "test", "fixtures", "http");
const KEEP_HEADERS = ["location", "content-type"];

const keyOf = (method, url) => crypto.createHash("sha1").update(`${method.toUpperCase()} ${url}`).digest("hex");
const fileOf = (method, url) => path.join(DIR(), `${keyOf(method, url)}.json`);

function readCassette(method, url) {
  const f = fileOf(method, url);
  if (!fs.existsSync(f)) {
    throw new Error(`[http_replay] 回放模式找不到卡帶：${method.toUpperCase()} ${url}\n  期望檔案：${f}\n  請先用 CS_HTTP_MODE=record 跑一次，或檢查網址是否與錄製時逐字相同`);
  }
  return JSON.parse(fs.readFileSync(f, "utf8"));
}

function writeCassette(method, url, rec) {
  fs.mkdirSync(DIR(), { recursive: true });
  fs.writeFileSync(fileOf(method, url), JSON.stringify(rec, null, 2));
  const idxFile = path.join(DIR(), "index.json");
  let idx = {};
  try { idx = JSON.parse(fs.readFileSync(idxFile, "utf8")); } catch (_) { /* 第一次 */ }
  idx[keyOf(method, url)] = { method: method.toUpperCase(), url, statusCode: rec.statusCode, recordedAt: rec.recordedAt };
  fs.writeFileSync(idxFile, JSON.stringify(Object.fromEntries(Object.keys(idx).sort().map((k) => [k, idx[k]])), null, 2));
}

function pickHeaders(h) {
  const out = {};
  for (const k of KEEP_HEADERS) if (h && h[k] != null) out[k] = h[k];
  return out;
}

function isText(ct) { return !ct || /^(text\/|application\/(json|javascript|xml|x-www-form-urlencoded))/i.test(String(ct)); }

/** 用卡帶造一個長得像 IncomingMessage 的回應串流 */
function fakeResponse(rec) {
  const res = new PassThrough();
  res.statusCode = rec.statusCode;
  res.headers = rec.headers || {};
  res.statusMessage = "";
  const buf = rec.encoding === "base64" ? Buffer.from(rec.body, "base64") : Buffer.from(rec.body || "", "utf8");
  process.nextTick(() => { res.end(buf); });
  return res;
}

/** https.get 相容：get(url[, options][, callback]) */
function get(url, options, cb) {
  if (typeof options === "function") { cb = options; options = {}; }
  options = options || {};
  const href = typeof url === "string" ? url : url.href;
  const mode = MODE();

  if (mode === "replay") {
    const req = new EventEmitter();
    req.setTimeout = () => req;
    req.destroy = () => req;
    req.end = () => req;
    const rec = readCassette("GET", href);
    process.nextTick(() => cb && cb(fakeResponse(rec)));
    return req;
  }

  const mod = /^http:/.test(href) ? http : https;
  if (mode !== "record") return mod.get(url, options, cb);

  return mod.get(url, options, (res) => {
    const chunks = [];
    const tee = new PassThrough();
    tee.statusCode = res.statusCode;
    tee.headers = res.headers;
    tee.statusMessage = res.statusMessage;
    res.on("data", (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
    let saved = false; // 部分下載（img_probe 讀到圖頭就 destroy）不會有 end，改在 close 時以收到的部分存檔
    const save = () => {
      if (saved) return; saved = true;
      const body = Buffer.concat(chunks);
      const text = isText(res.headers["content-type"]);
      writeCassette("GET", href, {
        url: href, statusCode: res.statusCode, headers: pickHeaders(res.headers),
        encoding: text ? "utf8" : "base64", body: text ? body.toString("utf8") : body.toString("base64"),
        recordedAt: new Date().toISOString(), partial: res.complete === false || undefined,
      });
    };
    res.on("end", save); res.on("close", save);
    res.pipe(tee);
    cb && cb(tee);
  });
}

/** globalThis.fetch 相容（只處理 GET/HEAD、不含 request body 的情境） */
async function fetchCompat(url, init = {}) {
  const href = typeof url === "string" ? url : url.toString();
  const method = (init.method || "GET").toUpperCase();
  const mode = MODE();
  if (mode === "replay") {
    const rec = readCassette(method, href);
    const buf = rec.encoding === "base64" ? Buffer.from(rec.body, "base64") : Buffer.from(rec.body || "", "utf8");
    return new Response(buf, { status: rec.statusCode, headers: rec.headers || {} });
  }
  const res = await globalThis.fetch(url, init);
  if (mode !== "record") return res;
  const buf = Buffer.from(await res.clone().arrayBuffer());
  const headers = {}; for (const k of KEEP_HEADERS) if (res.headers.get(k)) headers[k] = res.headers.get(k);
  const text = isText(res.headers.get("content-type"));
  writeCassette(method, href, {
    url: href, statusCode: res.status, headers,
    encoding: text ? "utf8" : "base64", body: text ? buf.toString("utf8") : buf.toString("base64"),
    recordedAt: new Date().toISOString(),
  });
  return res;
}

module.exports = { get, fetch: fetchCompat, mode: MODE, cassetteDir: DIR, keyOf };
