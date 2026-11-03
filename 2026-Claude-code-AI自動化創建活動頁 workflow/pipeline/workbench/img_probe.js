"use strict";
/**
 * workbench/img_probe.js —— 圖片解析度探測＋編輯精選圓 img 候選鏈（2026-08-26 病例根治）
 *
 * 病例：AI 策展把 80×80 縮圖塞進 300px 的圓（資產 4B4A7CE400-SP-22208877.jpg＝80×80）。
 * 根因＝「圓 img 取 imgs[1] 第二張白底圖」慣例從未驗解析度——商品池（snapshot.products[].imgs）
 * 只存 URL 字串、沒有寬高欄位（來源頁 imageSet 有 width/height 但 fetch_parse 未落池），
 * 引擎端低解析防護（原寸置中＋console 出聲）只防變形不治根。
 *
 * 本檔＝單一真源（沿 product_fetch.js 抽件慣例：工廠可注入＝hermetic 測試不觸網）：
 *  - parseImageSize(buf)     ：JPEG／PNG／WebP／GIF 圖頭解析寬高（純函式、餵 bytes）
 *  - probeImageSize(url)     ：HTTP 部分下載抓圖頭（Range 頭＋拿到寬高即斷線；逾時／讀不懂＝reject 出聲）
 *  - pickCircleImg(imgs)     ：圓 img 候選鏈——imgs[1..] 依序驗「寬 ≥ CIRCLE_IMG_MIN_WIDTH」，
 *                              都不合格退主圖 imgs[0] 照實用＋notes 出聲（不吞、不留空）
 *
 * 消費端（同病一次修整類）：curate_auto 組圓／server editorial-add 圓補位／server enrich-ee 機械補生成／
 * server AI 引擎收尾複驗（prompt 教的 imgs[1]||imgs[0] 慣例無從自驗圖寬＝機械複驗兜底）。
 * 前端 applySwap 圓卡替換路（public/index*.html）＝使用者親眼挑圖、本批禁區不動（列帳交裁決）。
 */
const https = require("https");
require("../lib/net_tuning"); // 對外連線預算（唯一一份＝lib/net_tuning.js）：預設 250ms 太短會讓「人點得開、工具抓不到」

/** 編輯精選圓顯示尺寸＝300 級（設計板圓徑）：候選圖寬低於此＝放大糊圖或原寸縮一坨，一律不合格 */
const CIRCLE_IMG_MIN_WIDTH = 300;
/** 單張圖頭探測逾時（ms）：圖頭在檔案最前面、正常幾百 ms 內拿到；逾時＝出聲跳過該候選，不拖垮建立流程 */
const PROBE_TIMEOUT_MS = 2500;
/** 圖頭掃描上限（bytes）：JPEG 的尺寸段（SOF）通常在前幾 KB，64KB 仍找不到＝當「讀不懂」出聲，不整張下載 */
const PROBE_MAX_BYTES = 65536;

/**
 * 圖頭解析寬高（純函式）：認 JPEG／PNG／WebP（VP8/VP8L/VP8X）／GIF 四家格式。
 * @param {Buffer} buf 檔案開頭的 bytes（部分下載即可）
 * @returns {{type:string,width:number,height:number}|null} 解析不出＝null（bytes 不夠或非四家格式）
 */
function parseImageSize(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 10) return null;
  // PNG：8 byte 簽名＋IHDR 塊（寬高各 4 byte big-endian，固定在 offset 16/20）
  if (buf.length >= 24 && buf.readUInt32BE(0) === 0x89504e47 && buf.readUInt32BE(4) === 0x0d0a1a0a &&
      buf.toString("ascii", 12, 16) === "IHDR") {
    return { type: "png", width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  }
  // GIF：GIF87a/89a 簽名＋邏輯畫布寬高（little-endian uint16，offset 6/8）
  const gifSig = buf.toString("ascii", 0, 6);
  if (gifSig === "GIF87a" || gifSig === "GIF89a") {
    return { type: "gif", width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) };
  }
  // WebP：RIFF 容器＋WEBP 標記，依第一個 chunk 分三型
  if (buf.length >= 30 && buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") {
    const fourcc = buf.toString("ascii", 12, 16);
    if (fourcc === "VP8X") { // 擴充容器：畫布寬高−1 各存 3 byte little-endian（offset 24/27）
      return { type: "webp", width: 1 + buf.readUIntLE(24, 3), height: 1 + buf.readUIntLE(27, 3) };
    }
    if (fourcc === "VP8 ") { // 有損：sync code 9D 01 2A 後跟 14-bit 寬高
      if (buf[23] === 0x9d && buf[24] === 0x01 && buf[25] === 0x2a) {
        return { type: "webp", width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
      }
      return null;
    }
    if (fourcc === "VP8L") { // 無損：簽名 0x2F 後 28 bit 內含寬高（各 14 bit，存值＝實寬−1）
      if (buf[20] !== 0x2f) return null;
      const bits = buf.readUInt32LE(21);
      return { type: "webp", width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
    }
    return null;
  }
  // JPEG：走 marker 鏈找 SOF 段（幀頭）——寬高在 SOF payload 的第 4~7 byte（big-endian）
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i + 3 < buf.length) {
      if (buf[i] !== 0xff) { i++; continue; } // 容錯：段間雜訊逐 byte 前進
      const marker = buf[i + 1];
      if (marker === 0xff) { i++; continue; } // 填充 0xFF
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) { i += 2; continue; } // 無長度段（TEM/RSTn/SOI/EOI）
      // SOF0~SOF15＝幀頭（排除同區段編碼的 DHT C4／JPG 擴充 C8／DAC CC）
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        if (i + 8 >= buf.length) return null; // bytes 不夠讀寬高＝要更多資料
        return { type: "jpeg", width: buf.readUInt16BE(i + 7), height: buf.readUInt16BE(i + 5) };
      }
      if (i + 3 >= buf.length) return null;
      const len = buf.readUInt16BE(i + 2);
      if (len < 2) return null; // 長度欄壞掉＝非法 JPEG
      i += 2 + len;
    }
    return null;
  }
  return null;
}

/**
 * HTTP 抓圖頭判尺寸：部分下載（帶 Range 頭；CDN 不理 Range 也只讀到解析出寬高就斷線）。
 * 失敗一律 reject 出聲（逾時／HTTP 非 200／讀不懂圖頭／非 https）——呼叫端決定跳過或退主圖，不靜默。
 * @param {string} url 圖片網址（https 限定，沿 urlStatus 慣例）
 * @param {{timeoutMs?:number, maxBytes?:number}} [opts]
 * @returns {Promise<{type:string,width:number,height:number}>}
 */
function probeImageSize(url, opts = {}) {
  const timeoutMs = opts.timeoutMs || PROBE_TIMEOUT_MS;
  const maxBytes = opts.maxBytes || PROBE_MAX_BYTES;
  const get = (href, redirectsLeft) => new Promise((resolve, reject) => {
    let u; try { u = new URL(String(href || "")); } catch (e) { return reject(new Error("圖址格式不對")); }
    if (u.protocol !== "https:") return reject(new Error("僅支援 https 圖址"));
    let settled = false;
    const done = (fn, v) => { if (!settled) { settled = true; fn(v); } };
    const req = https.get(u.href, { timeout: timeoutMs, headers: { Range: `bytes=0-${maxBytes - 1}` } }, (res) => {
      if ([301, 302, 307, 308].includes(res.statusCode) && res.headers.location && redirectsLeft > 0) {
        res.resume(); req.destroy();
        let r2; try { r2 = new URL(res.headers.location, u.href); } catch (e) { return done(reject, new Error(`轉址位置無效（HTTP ${res.statusCode}）`)); }
        return done(resolve, get(r2.href, redirectsLeft - 1));
      }
      if (res.statusCode !== 200 && res.statusCode !== 206) {
        res.resume(); req.destroy();
        return done(reject, new Error(`HTTP ${res.statusCode}`));
      }
      const chunks = []; let got = 0;
      res.on("data", (chunk) => {
        chunks.push(chunk); got += chunk.length;
        const size = parseImageSize(Buffer.concat(chunks));
        if (size) { req.destroy(); return done(resolve, size); } // 拿到寬高即棄身＝部分下載
        if (got >= maxBytes) { req.destroy(); return done(reject, new Error(`讀了 ${got} bytes 仍解析不出圖頭（非 JPEG/PNG/WebP/GIF 或圖頭太深）`)); }
      });
      res.on("end", () => {
        const size = parseImageSize(Buffer.concat(chunks));
        size ? done(resolve, size) : done(reject, new Error("圖檔讀完仍解析不出寬高"));
      });
    });
    req.on("timeout", () => { req.destroy(); done(reject, new Error(`逾時 ${timeoutMs}ms`)); });
    req.on("error", (e) => done(reject, e instanceof Error ? e : new Error(String(e))));
  });
  return get(url, 2); // 最多跟 2 層轉址（urlStatus 只跟 1 層＝夠用；圖床偶有雙跳）
}

/**
 * 編輯精選圓 img 候選鏈（規則＝2026-08-26 裁定）：
 *   ①首選照舊＝imgs[1]（第二張白底圖慣例），但必須實測「寬 ≥ minWidth（預設 300＝圓顯示級）」
 *   ②不合格依序試 imgs[2..]（探測失敗＝出聲跳過該候選）
 *   ③都不合格退主圖 imgs[0]；主圖也不合格＝照實用主圖＋notes 出聲（不吞、不留空；引擎低解析防護兜底顯示）
 * @param {string[]} imgs 商品圖庫（池 imgs 原序：主圖在前）
 * @param {{probe?:(url:string)=>Promise<{width:number,height:number}>, minWidth?:number}} [opts]
 *        probe 可注入＝測試不觸網；預設走 probeImageSize
 * @returns {Promise<{img:string, width:number|null, verified:boolean, notes:string[]}>}
 *          notes＝白話履歷（呼叫端接 wb.log／meta.notes 出聲）；verified=false＝解析度未達標或無從驗證
 */
async function pickCircleImg(imgs, opts = {}) {
  const minWidth = opts.minWidth || CIRCLE_IMG_MIN_WIDTH;
  const probe = opts.probe || probeImageSize;
  const list = (Array.isArray(imgs) ? imgs : []).filter((u) => typeof u === "string" && u);
  const notes = [];
  if (!list.length) return { img: "", width: null, verified: false, notes: ["商品沒有任何圖（imgs 空）＝圓 img 留空交上游守門"] };
  const chain = list.length > 1 ? list.slice(1).concat(list[0]) : [list[0]]; // 白底慣例序：imgs[1..] 依序、最後輪到主圖
  const seen = new Set();
  for (const u of chain) {
    if (seen.has(u)) continue; // 同 URL 去重（主圖常與候選重複）＝不重複探測
    seen.add(u);
    let size = null;
    try { size = await probe(u); }
    catch (e) { notes.push(`候選圖探測失敗（${(e && e.message) || e}）＝跳過：${u}`); continue; }
    if (size && Number(size.width) >= minWidth) return { img: u, width: Number(size.width), verified: true, notes };
    notes.push(`候選圖寬 ${size && size.width != null ? size.width : "?"}px＜${minWidth}px（圓顯示 300 級）＝跳過：${u}`);
  }
  notes.push(`所有候選圖都沒達 ${minWidth}px 寬（或無法驗證）＝照實用主圖 ${list[0]}（引擎低解析防護＝原寸置中顯示；建議更替商品或換圖）`);
  return { img: list[0], width: null, verified: false, notes };
}

module.exports = { CIRCLE_IMG_MIN_WIDTH, PROBE_TIMEOUT_MS, PROBE_MAX_BYTES, parseImageSize, probeImageSize, pickCircleImg };
