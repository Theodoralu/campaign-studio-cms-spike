"use strict";
/**
 * hero_bg_license.js —— 「這檔活動的主視覺背景現在能不能出門、頁尾要掛什麼字」的唯一判斷
 *
 * 白話：以前有五道門各自抄一份「待審背景不能對外」的規則（提案包驗證、寫入、出貨檢查、AEM 匯出、頁尾掛牌），
 * 09-01 就出過「改了一道漏了另一道」的事。從 2026-09-27 起（78 號），加上「你上傳的背景」這第三種來源，
 * 規則只寫在這一支；每道門改成來問它。
 *
 * 三種背景來源：
 *   registry ＝ 背景登記簿正式貨號（bg-0NN）：license A／已複查 B＝可出門；C＝掛「背景版權待審核」＋不得對外（63 號原樣）
 *   pending  ＝ 待審簿訪客號（pending-NNNN）：掛「背景版權待審核」＋不得對外（63 號原樣）
 *   own      ＝ 活動負責人自己上傳的三張圖（page.backgroundId="own"＋page.heroBgOwn）：
 *               9/30 版＝一律掛「背景版權：活動負責人確認中」＋不得對外（等同待審；AEM 確認制下一版才開）
 *               下一版＝wb_meta.heroBgLicenseConfirm 的 sha256 與 heroBgOwn.sha256 相符＝清牌可出 AEM
 *
 * 引擎（瀏覽器端）不能 require 這支——它只看 page.heroBgOwn 有沒有 confirmed 欄；兩邊的字面由 twin 測試釘死。
 */

const OWN_BG_ID = "own";
const OWN_SLOTS = ["desktop", "768", "375"];
const WATERMARK_TEXT = Object.freeze({
  pending: "背景版權待審核",
  own: "背景版權：活動負責人確認中",
});
const BG_REVIEW_PASS = ["pass", "pass-with-note"];

/** 三張圖都在＝上傳完成（缺一＝「已上傳未使用」態，指針不得指向 own） */
function ownFilesComplete(heroBgOwn) {
  const f = heroBgOwn && heroBgOwn.files;
  return !!(f && OWN_SLOTS.every((k) => typeof f[k] === "string" && f[k].trim()));
}
function ownMissingSlots(heroBgOwn) {
  const f = (heroBgOwn && heroBgOwn.files) || {};
  return OWN_SLOTS.filter((k) => !(typeof f[k] === "string" && f[k].trim()));
}

/** 這檔生效的背景是不是「你上傳的背景」 */
function isOwnBg(page) {
  return !!(page && page.backgroundId === OWN_BG_ID && page.heroBgOwn && typeof page.heroBgOwn === "object");
}

/**
 * 判斷授權狀態。
 * @param {object} page  draft.page
 * @param {object} opts  { backgroundRecords: Map, pendingBackgroundRecords: Map, defaultBackground: string|null, confirm: wb_meta.heroBgLicenseConfirm|null, allowOwnConfirm: boolean }
 * @returns {{ kind, bgId, state, watermarkText, exportBlock, note }}
 *   state: "clear"（可出門、不掛字）｜"watermark"（掛字、不得對外）｜"unknown"（查無：交 gate 原有 FAIL）
 */
function resolveHeroBgLicense(page, opts = {}) {
  const pg = page || {};
  const bgRec = opts.backgroundRecords || new Map();
  const pendRec = opts.pendingBackgroundRecords || new Map();
  let bgId = pg.backgroundId != null && pg.backgroundId !== "" ? pg.backgroundId : (opts.defaultBackground || null);

  if (bgId === OWN_BG_ID) {
    const own = pg.heroBgOwn && typeof pg.heroBgOwn === "object" ? pg.heroBgOwn : null;
    if (!own || !ownFilesComplete(own)) {
      return { kind: "own", bgId, state: "unknown", watermarkText: WATERMARK_TEXT.own, exportBlock: "這檔選了你上傳的背景，但三張圖還沒齊——請回編修頁把桌機、平板、手機三張補齊，或改回登記簿的背景", note: "own 三檔不齊" };
    }
    const confirm = opts.confirm || null;
    const confirmed = !!(opts.allowOwnConfirm && confirm && confirm.sha256 && own.sha256 && confirm.sha256 === own.sha256 && confirm.by);
    if (confirmed) return { kind: "own", bgId, state: "clear", watermarkText: null, exportBlock: null, note: `活動負責人 ${confirm.by} 於 ${confirm.at || "?"} 確認` };
    return {
      kind: "own", bgId, state: "watermark", watermarkText: WATERMARK_TEXT.own,
      exportBlock: opts.allowOwnConfirm
        ? EXPORT_HOLD_UNCONFIRMED /* 2026-09-29 確認制上線：句子與出口擋句同一份（過目定稿），不留兩種講法 */
        : "這檔用了你上傳的背景，這一版還不能製作 AEM 網頁檔；下一版會開放，並在製作前請你確認版權",
      note: "own 未確認",
    };
  }

  if (bgId == null) return { kind: "default", bgId: null, state: "unknown", watermarkText: null, exportBlock: null, note: "無背景可解析" };

  const brec = bgRec.get(bgId);
  const prec = !brec ? pendRec.get(bgId) : null;
  if (!brec && prec) {
    return { kind: "pending", bgId, state: "watermark", watermarkText: WATERMARK_TEXT.pending, exportBlock: `這檔活動的背景「${bgId}」版權還在審核中（只能內網展示），不能匯出到對外的 AEM——請先換成已過票的背景，或等審核通過`, note: "待審訪客號" };
  }
  if (!brec) return { kind: "registry", bgId, state: "unknown", watermarkText: null, exportBlock: null, note: "登記簿與待審簿皆查無" };
  const lic = brec.license;
  if (lic === "C") return { kind: "registry", bgId, state: "watermark", watermarkText: WATERMARK_TEXT.pending, exportBlock: `這檔活動的背景「${bgId}」版權還在審核中（只能內網展示），不能匯出到對外的 AEM——請先換成已過票的背景，或等審核通過`, note: "license C" };
  if (lic === "A") return { kind: "registry", bgId, state: "clear", watermarkText: null, exportBlock: null, note: "license A" };
  if (lic === "B") {
    const ok = BG_REVIEW_PASS.includes(brec.qaStatus) && !!brec.reviewDate;
    return ok
      ? { kind: "registry", bgId, state: "clear", watermarkText: null, exportBlock: null, note: "license B 已複查" }
      : { kind: "registry", bgId, state: "unknown", watermarkText: null, exportBlock: null, note: "license B 複查紀錄不齊（交 CP-27 判）" };
  }
  return { kind: "registry", bgId, state: "unknown", watermarkText: null, exportBlock: null, note: `license 欄值「${lic ?? "缺"}」非 A/B/C` };
}

/* 出口擋句（2026-09-29 牆裁決批・使用者過目「文案 ok」）：三態各一句、格式「主詞・狀態 → 動作」。
   確認框住在編修頁「上傳自己的背景圖」區塊＝句子指路到那裡（過目稿原句「上方的」依實際位置改為「主視覺背景區的」，2026-09-29 回報時已標）。 */
const EXPORT_HOLD_UNCONFIRMED = "你上傳的背景・還沒確認版權 → 先完成主視覺背景區的版權確認，就能製作";
const EXPORT_HOLD_CHANGED = "背景圖・換過了 → 版權確認要重做一次";
const DEPLOY_HOLD_UNCONFIRMED = "你上傳的背景・還沒確認版權 → 先完成主視覺背景區的版權確認，就能發佈";
const CONFIRM_DONE_MSG = "背景版權・已確認 → 可以製作與發佈";
/** @deprecated 9/30 版舊句——2026-09-29 確認制上線後不再發出；留給讀舊 log 的人對照 */
const EXPORT_HOLD_MSG = "這檔用了你上傳的背景或關掉了主視覺文字，這一版還不能製作 AEM 網頁檔；下一版會開放，並在製作前請你確認版權";

/** 確認紀錄與「現在這組圖」相符嗎（真源＝wb_meta.heroBgLicenseConfirm；78 號 §六：出 AEM 須紀錄存在且 sha 相符——換過圖＝sha 變＝確認自動失效） */
function ownConfirmMatches(page, confirm) {
  const own = page && page.heroBgOwn;
  return !!(confirm && confirm.sha256 && confirm.by && own && own.sha256 && confirm.sha256 === own.sha256);
}

/**
 * 出口統一擋句（AEM／ZIP 路由層＋組裝器雙保險共用；發佈路自帶「就能發佈」版）。
 * 2026-09-29 牆裁決（1 甲／4 乙）：藏標題不再擋；own＝有相符的版權確認才放行。
 * @param {object} opts { confirm: wb_meta.heroBgLicenseConfirm|null }
 * @returns {string|null} null＝放行；字串＝給使用者看的那一句
 */
function exportHoldReason(page, opts = {}) {
  const pg = page || {};
  if (!isOwnBg(pg)) return null; /* 藏標題（heroTitleHidden）＝2026-09-29 起可出貨：文字責任在上傳背景那一步的具結，關掉系統字本身無版權面 */
  const confirm = opts.confirm || null;
  if (ownConfirmMatches(pg, confirm)) return null;
  const own = pg.heroBgOwn || {};
  /* 曾確認過、但指紋對不上＝圖換過了（比「還沒確認」講得準；換圖重做一次是設計，不是故障） */
  if (confirm && confirm.sha256 && own.sha256 && confirm.sha256 !== own.sha256) return EXPORT_HOLD_CHANGED;
  return EXPORT_HOLD_UNCONFIRMED;
}

module.exports = { OWN_BG_ID, OWN_SLOTS, WATERMARK_TEXT, BG_REVIEW_PASS, EXPORT_HOLD_MSG, EXPORT_HOLD_UNCONFIRMED, EXPORT_HOLD_CHANGED, DEPLOY_HOLD_UNCONFIRMED, CONFIRM_DONE_MSG, ownFilesComplete, ownMissingSlots, isOwnBg, resolveHeroBgLicense, exportHoldReason, ownConfirmMatches };
