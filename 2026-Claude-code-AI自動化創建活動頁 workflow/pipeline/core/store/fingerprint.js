"use strict";
/**
 * core/store/fingerprint.js —— 草稿內容指紋（D11，2026-11-18）
 * 內容相同＝指紋相同，跟鍵的順序、縮排、存檔時間無關。用途：核可綁的是「這一版內容」，內容沒變的存檔不該讓核可失效。
 * 作法：鍵排序後序列化再 sha256。陣列順序算內容（樓層順序、商品順序都是使用者看得到的）。undefined 與函式略過（同 JSON.stringify）。
 */
const crypto = require("crypto");
function canonical(v) {
  if (v === null || typeof v !== "object") return JSON.stringify(v === undefined ? null : v);
  if (Array.isArray(v)) return "[" + v.map(canonical).join(",") + "]";
  return "{" + Object.keys(v).filter((k) => v[k] !== undefined && typeof v[k] !== "function").sort().map((k) => JSON.stringify(k) + ":" + canonical(v[k])).join(",") + "}";
}
const fingerprint = (obj) => "fp_" + crypto.createHash("sha256").update(canonical(obj)).digest("hex").slice(0, 32);
module.exports = { fingerprint, canonical };
