"use strict";
/**
 * hero_bg_own.js —— 活動負責人自己上傳的主視覺背景（三張：桌機／平板／手機）
 *
 * 白話：圖住在這檔活動自己的資料夾 runs/<id>/hero-bg/，不進設計線的背景庫、不領號、不重跑背景地圖。
 * 系統只做三件事：驗（尺寸、方向、手機重量）、存（原檔）、記（尺寸、指紋、來源答案）。不裁、不改圖。
 * 三張齊了，呼叫端才把 page.backgroundId 指到 "own"（hero_combo.applyCombo 會再驗一次）。
 *
 * 78 號裁決批（2026-09-27）：三裝置各傳一張、只驗不裁；來源下拉＋兩題勾選必勾。
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { checkSize, minSizeFor, SLOTS } = require("./hero_stages");
const { OWN_BG_ID, OWN_SLOTS, ownFilesComplete, ownMissingSlots } = require("./hero_bg_license");

const MIME_EXT = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
const MAX_BYTES = 10 * 1024 * 1024;
const MOBILE_MAX_KB_DEFAULT = 400;
/* 檔案上限（2026-09-27 使用者裁四題照建議）：手機＝背景登記簿 weightGate（單一真源）；桌機 800／平板 500＝本檔常數（三張都會被 AEM 內嵌、大圖拖首屏） */
const TARGET_KB = { desktop: 800, "768": 500 };
/* 壓縮：等比縮到「剛好需要的尺寸」（永不放大、永不裁切、構圖不變）→ WebP 品質 85 往下試到 70；仍超標＝退件講明 */
const WEBP_QUALITIES = [85, 80, 75, 70];
const SOURCE_OPTIONS = ["設計部提供", "自己用 Gemini、ChatGPT 做的", "購買的圖庫", "其他"];
const SLOT_LABEL = { desktop: "桌機版", "768": "平板版", "375": "手機版" };
const DIRNAME = "hero-bg";

/** 手機版重量上限：讀背景登記簿 meta.weightGate.maxKB（單一真源），讀不到＝400 */
function mobileMaxKB(manifestPath) {
  try { const m = JSON.parse(fs.readFileSync(manifestPath, "utf8")); const v = Number(m && m.meta && m.meta.weightGate && m.meta.weightGate.maxKB); return v > 0 ? v : MOBILE_MAX_KB_DEFAULT; }
  catch (e) { return MOBILE_MAX_KB_DEFAULT; }
}

/** 給人看的錯誤：一律 { code, error }；error 白話先講、技術收括號 */
const fail = (code, error) => ({ ok: false, code, error });

/**
 * 驗＋存一格。
 * @param {object} a { runDir, layoutId, slot, mime, buf, name, answers:{source, link, commercial, responsibility}, uploadedBy, existing: page.heroBgOwn|null, mobileMaxKB, sharp }
 * @returns {{ok:true, heroBgOwn, complete, missing, note}} | {ok:false, code, error}
 */
async function uploadOwnSlot(a) {
  const slot = String(a.slot || "");
  if (!OWN_SLOTS.includes(slot)) return fail(400, "不認得的上傳格位——只有桌機、平板、手機三格。（技術：slot 需 desktop|768|375）");
  if (!/^layout-\d{3}$/.test(String(a.layoutId || ""))) return fail(400, "這檔活動還沒有選新版式，先在組合面板選一款版面再上傳背景。（技術：kvVariant 非 layout-*）");
  const ext = MIME_EXT[String(a.mime || "")];
  if (!ext) return fail(400, "只收 JPG／PNG／WebP——瀏覽器讀不出來的格式（如 HEIC）沒辦法當背景");
  const buf = a.buf;
  if (!buf || !buf.length) return fail(400, "沒收到圖檔內容");
  if (buf.length > MAX_BYTES) return fail(413, "圖太大——上限 10MB，請壓一下再上傳");
  const ans = a.answers || {};
  const source = String(ans.source || "").trim();
  if (!SOURCE_OPTIONS.includes(source)) return fail(400, `請先選「這張圖哪來的」（${SOURCE_OPTIONS.join("／")}）`);
  const link = String(ans.link || "").trim();
  if (source === "購買的圖庫" && !link) return fail(400, "選了「購買的圖庫」要附圖庫連結（之後查授權靠它）");
  if (ans.commercial !== true) return fail(400, "請勾「這張圖可以用在 Yahoo 購物活動頁（我確認過來源與授權）」");
  if (ans.responsibility !== true) return fail(400, "先勾責任確認 → 才能上傳"); /* 使用者 2026-09-27 裁：圖上文字（含價格折數日期）由用戶自寫自負、平台不核對；確認即承擔（78 號 §三之二） */

  const sharp = a.sharp || require("sharp");
  let md;
  try { md = await sharp(buf).metadata(); } catch (e) { return fail(400, "這張圖讀不出尺寸——檔案可能壞了或不是圖片。（技術：" + String(e && e.message).slice(0, 80) + "）"); }
  const w = Number(md.width) || 0, h = Number(md.height) || 0;
  if (!w || !h) return fail(400, "這張圖讀不出尺寸——檔案可能壞了或不是圖片");
  const chk = checkSize(a.layoutId, slot, w, h);
  if (!chk.pass) return fail(400, chk.reason);
  const maxKB = slot === "375" ? (Number(a.mobileMaxKB) > 0 ? Number(a.mobileMaxKB) : MOBILE_MAX_KB_DEFAULT) : TARGET_KB[slot];

  /* 自動處理（使用者 2026-09-27 裁：不必再用別的工具壓圖）：照 EXIF 轉正、統一 sRGB、比需要大就等比縮到剛好（cover 判準：兩邊都不低於最小尺寸）、轉 WebP 逐級降品質到上限內 */
  const need = chk.need || minSizeFor(a.layoutId, slot);
  const scale = Math.min(1, Math.max(need.w / w, need.h / h));
  const outW = Math.round(w * scale), outH = Math.round(h * scale);
  let pipeline = sharp(buf).rotate().toColorspace("srgb");
  if (scale < 1) pipeline = pipeline.resize({ width: outW, height: outH, fit: "fill", kernel: "lanczos3" });
  let outBuf = null, usedQ = null;
  for (const q of WEBP_QUALITIES) {
    let cand; try { cand = await pipeline.clone().webp({ quality: q, effort: 4 }).toBuffer(); } catch (e) { return fail(500, "圖片處理失敗，請換一張再試。（技術：sharp " + String(e && e.message).slice(0, 80) + "）"); }
    outBuf = cand; usedQ = q;
    if (cand.length <= maxKB * 1024) break;
  }
  if (outBuf.length > maxKB * 1024) return fail(413, `${SLOT_LABEL[slot]}壓到最小還有 ${Math.round(outBuf.length / 1024)}KB，超過 ${maxKB}KB——這張圖細節太多，請換一張畫面單純一點的（或先自己縮到 ${need.w}×${need.h} 再傳）`);

  const dir = path.join(a.runDir, DIRNAME);
  fs.mkdirSync(dir, { recursive: true });
  for (const old of fs.readdirSync(dir)) { if (old.startsWith(slot + ".") || old.startsWith(`original-${slot}.`)) { try { fs.unlinkSync(path.join(dir, old)); } catch (e) { console.warn("[hero-bg-own] 舊檔刪不掉（照常覆寫）：" + e.message); } } } // 同格重傳＝換掉舊檔（含原檔）
  const fname = `${slot}.webp`;
  fs.writeFileSync(path.join(dir, fname), outBuf);
  fs.writeFileSync(path.join(dir, `original-${slot}.${ext}`), buf); /* 原檔另存＝紀錄與可重做（63 號「展示用圖必須有紀錄與存檔」）；頁面用的是處理後那張 */
  const sha = crypto.createHash("sha256").update(outBuf).digest("hex"); /* 指紋＝頁面實際用的檔 */
  const originalSha = crypto.createHash("sha256").update(buf).digest("hex");

  const prev = (a.existing && typeof a.existing === "object") ? a.existing : {};
  /* 三格狀態一律從資料夾重建（2026-09-27 走查抓到：連傳三格、草稿還沒回寫時，只看 existing 會漏前兩格）——磁碟是真相，existing 只補原檔名 */
  const disk = await rebuildFromDisk(dir, a.runId, a.layoutId, sharp);
  const files = { ...disk.files };
  const sizeCheck = { ...disk.sizeCheck };
  const shaBySlot = { ...disk.shaBySlot };
  const originals = { ...(prev.originals || {}) };
  files[slot] = `/api/runs/${encodeURIComponent(a.runId)}/hero-bg/${fname}`;
  sizeCheck[slot] = { w: outW, h: outH, bytes: outBuf.length, pass: true, need: need ? { w: need.w, h: need.h } : null,
    original: { w, h, bytes: buf.length, ext, sha256: originalSha }, webpQuality: usedQ, scaled: scale < 1 };
  shaBySlot[slot] = sha;
  originals[slot] = String(a.name || fname).slice(0, 120);

  let bridgeColor = disk.bridgeColor || prev.bridgeColor || null; /* 銜接色跟著磁碟上的桌機圖走（連傳三格時不會被後兩格洗掉） */
  if (slot === "desktop") { try { bridgeColor = await sampleBridgeColor(sharp, buf, w, h); } /* 量原檔（WebP 有損會讓色值漂 ±1） */ catch (e) { console.warn("[hero-bg-own] 銜接色量不到（引擎端會現量）：" + e.message); bridgeColor = prev.bridgeColor || null; } }

  const heroBgOwn = {
    files, sizeCheck, shaBySlot, originals, bridgeColor,
    sha256: combinedSha(shaBySlot),
    layoutId: a.layoutId,
    uploadedAt: new Date().toISOString(),
    uploadedBy: String(a.uploadedBy || "").slice(0, 120) || null,
    attest: { source, link: link || null, commercial: true, responsibility: true, at: new Date().toISOString() },
  };
  const complete = ownFilesComplete(heroBgOwn);
  const missing = ownMissingSlots(heroBgOwn);
  const kb = (n) => (n >= 1024 * 1024 ? (n / 1024 / 1024).toFixed(1) + "MB" : Math.round(n / 1024) + "KB");
  /* 文案規則（2026-09-27 使用者裁）：一則訊息一件事，「主詞・狀態 → 動作」；為什麼與之後怎樣不前置、收面板提示 */
  const state = `${SLOT_LABEL[slot]}・已收 ${outW}×${outH}、${kb(outBuf.length)}${scale < 1 ? "（原 " + kb(buf.length) + "）" : ""}`;
  const note = complete
    ? `${state} → 三張齊，已套用`
    : (files.desktop
      ? `${state} → 預覽已換上，還缺${missing.map((m) => SLOT_LABEL[m]).join("、")}`
      : `${state} → 先補桌機版，預覽才會換上`);
  return { ok: true, heroBgOwn, complete, missing, note, slot, w: outW, h: outH, original: { w, h, bytes: buf.length }, bytes: outBuf.length, webpQuality: usedQ };
}

/** 資料夾裡現有的三格（檔名 <slot>.<ext>）→ files／sizeCheck／shaBySlot；尺寸照本版式重驗（換過版式的舊檔會被標 pass:false） */
async function rebuildFromDisk(dir, runId, layoutId, sharp) {
  const out = { files: {}, sizeCheck: {}, shaBySlot: {}, bridgeColor: null };
  if (!fs.existsSync(dir)) return out;
  for (const f of fs.readdirSync(dir)) {
    const m = /^(desktop|768|375)\.(jpg|png|webp)$/.exec(f); if (!m) continue; /* original-<slot>.* 是留檔，不是頁面用的 */
    const slot = m[1]; const abs = path.join(dir, f);
    try {
      const b = fs.readFileSync(abs); const md = await sharp(b).metadata();
      const w = Number(md.width) || 0, h = Number(md.height) || 0;
      const chk = checkSize(layoutId, slot, w, h);
      out.files[slot] = `/api/runs/${encodeURIComponent(runId)}/hero-bg/${f}`;
      out.sizeCheck[slot] = { w, h, bytes: b.length, pass: !!chk.pass, need: chk.need ? { w: chk.need.w, h: chk.need.h } : null };
      out.shaBySlot[slot] = crypto.createHash("sha256").update(b).digest("hex");
      if (slot === "desktop") { try {
        const orig = fs.readdirSync(dir).find((x) => /^original-desktop\./.test(x)); /* 有原檔就量原檔（與上傳當下同一把尺） */
        const ob = orig ? fs.readFileSync(path.join(dir, orig)) : b; const om = orig ? await sharp(ob).metadata() : { width: w, height: h };
        out.bridgeColor = await sampleBridgeColor(sharp, ob, Number(om.width) || w, Number(om.height) || h); } catch (e) { console.warn("[hero-bg-own] 銜接色量不到（引擎端會現量）：" + e.message); } }
    } catch (e) { console.warn("[hero-bg-own] 重建格位失敗（略過該檔）：" + f + " " + e.message); }
  }
  return out;
}

/** 三格 sha 合成一個指紋（順序固定）＝下一版 AEM 確認制記在 wb_meta 的那個值 */
function combinedSha(shaBySlot) {
  const parts = OWN_SLOTS.map((k) => `${k}:${(shaBySlot && shaBySlot[k]) || ""}`).join("|");
  return crypto.createHash("sha256").update(parts).digest("hex");
}

/** 桌機圖底緣 8% 的平均色＝銜接色（沿登記簿 bridgeColorNote 做法；引擎頁底與銜接帶靠它） */
async function sampleBridgeColor(sharp, buf, w, h) {
  const band = Math.max(1, Math.round(h * 0.08));
  const st = await sharp(buf).extract({ left: 0, top: h - band, width: w, height: band }).stats();
  const ch = st.channels || [];
  if (ch.length < 3) return null;
  const hex = (v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0").toUpperCase();
  return `#${hex(ch[0].mean)}${hex(ch[1].mean)}${hex(ch[2].mean)}`;
}

/** 移除：刪檔、回 null（呼叫端把 page.heroBgOwn 刪掉並清指針） */
function removeOwnBg(runDir) {
  const dir = path.join(runDir, DIRNAME);
  let n = 0;
  if (fs.existsSync(dir)) { for (const f of fs.readdirSync(dir)) { try { fs.unlinkSync(path.join(dir, f)); n++; } /* 含 original-* 原檔 */ catch (e) { console.warn("[hero-bg-own] 檔刪不掉：" + f + " " + e.message); } } try { fs.rmdirSync(dir); } catch (e) { console.warn("[hero-bg-own] 資料夾刪不掉（可能仍有檔）：" + e.message); } }
  return n;
}

/** 供 GET /api/runs/:id/hero-bg/:file 用：只放行三格檔名 */
function isOwnFileName(name) { return /^(desktop|768|375)\.(jpg|png|webp)$/.test(String(name || "")); }

/* ── 「你上傳的背景」的路徑規則＝只在這裡立法（鐵律 4：AEM 內嵌／ZIP 隨包／發佈複製三條出口共用，2026-09-29 牆）──
   draft 裡的 files 一律長 /api/runs/<id>/hero-bg/<slot>.<ext>；出口各自改寫前先經 parseOwnApiPath 驗形。 */
const OWN_API_RE = /^\/api\/runs\/([^/]+)\/hero-bg\/([A-Za-z0-9_.-]+)$/;
/** 驗一條 files 值的形：合法＝{ runId, file }；data URI 或不合形＝null */
function parseOwnApiPath(rel) { const m = OWN_API_RE.exec(String(rel || "")); return m && isOwnFileName(m[2]) ? { runId: decodeURIComponent(m[1]), file: m[2] } : null; }
const EXT_MIME = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp" };
/**
 * 把 page.heroBgOwn.files 逐格對到磁碟上的實檔。
 * @returns {{ [slot]: { abs, file, mime } }}　只含「還是路徑型」的格（已是 data: 的跳過）
 * @throws 缺檔或路徑不合形＝丟錯出聲（失敗要出聲：靜默缺圖的檔比擋住更糟——2026-09-29 病例）
 */
function resolveOwnFileMap(page, runDir) {
  const own = page && page.heroBgOwn;
  const out = {};
  for (const [slot, rel] of Object.entries((own && own.files) || {})) {
    if (/^data:/.test(String(rel))) continue;
    const p = parseOwnApiPath(rel);
    const abs = p && path.join(runDir, DIRNAME, p.file);
    if (!abs || !fs.existsSync(abs)) throw new Error(`你上傳的背景（${SLOT_LABEL[slot] || slot}）在活動資料夾裡找不到，請重新上傳後再製作。（技術：files.${slot}＝${String(rel).slice(0, 80)}）`);
    out[slot] = { abs, file: p.file, mime: EXT_MIME[path.extname(p.file).slice(1).toLowerCase()] || "application/octet-stream" };
  }
  return out;
}
/** 讀實檔轉 data URI（AEM 內嵌路用） */
function ownFileDataUri(entry) { return `data:${entry.mime};base64,${fs.readFileSync(entry.abs).toString("base64")}`; }

module.exports = { DIRNAME, MIME_EXT, EXT_MIME, MAX_BYTES, SOURCE_OPTIONS, SLOT_LABEL, OWN_BG_ID, SLOTS, TARGET_KB, WEBP_QUALITIES, uploadOwnSlot, removeOwnBg, rebuildFromDisk, mobileMaxKB, minSizeFor, combinedSha, isOwnFileName, parseOwnApiPath, resolveOwnFileMap, ownFileDataUri };
