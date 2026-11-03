"use strict";
/**
 * hero_stages.js —— 十二款版式的主視覺舞台尺寸（伺服器端 twin 表）
 *
 * 白話：引擎（FrameTest.html 的 HV2_STAGES）知道每款版式的主視覺在桌機／平板／手機各是多寬多高，
 * 但伺服器讀不到引擎。這支把同一組數字抄一份給伺服器用——上傳背景圖的體檢、背景製作說明包的尺寸表都靠它。
 *
 * 真源＝引擎 `HV2_STAGES`（規劃/MVP_Phase1_LeCreuset_活動頁Prototype_FrameTest.html）。
 * 兩邊要一致由 test/unit/engine_twin_tables.test.js 釘死（既有測試已釘「鍵集合」，本批加「w/h 值相等」）。
 * 只抄尺寸；trim／contentSel 是引擎桌機可視窗的事，這裡不需要、也不抄。
 *
 * 2026-09-27 立（78 號裁決批：自備主視覺背景圖）。
 */

/** 桌機基準視窗寬（canvasSpec ①：背景 cover 置中；桌機建議畫布寬＝1440 視窗 ×2＝2880） */
const DESKTOP_VIEWPORT_W = 1440;
/** 有必見主體時的超寬畫布（canvasSpec ②：3440×867，主體放中央 1600 安全區） */
const ULTRAWIDE_CANVAS = { w: 3440, h: 867, safeW: 1600 };
/** 出圖倍率 */
const SCALE = 2;

/** 各款舞台：w/h＝桌機板；tablet／mobile＝真裝置板 */
const HERO_STAGES = {
  "layout-001": { w: 1264, h: 560, tablet: { w: 768, h: 322 },    mobile: { w: 375, h: 472 } },
  "layout-002": { w: 1264, h: 560, tablet: { w: 768, h: 330 },    mobile: { w: 375, h: 424 } },
  "layout-003": { w: 1264, h: 560, tablet: { w: 768, h: 340 },    mobile: { w: 375, h: 496 } },
  "layout-004": { w: 1264, h: 560, tablet: { w: 768, h: 340.26 }, mobile: { w: 375, h: 452 } },
  "layout-005": { w: 1264, h: 560, tablet: { w: 768, h: 340.26 }, mobile: { w: 375, h: 452 } },
  "layout-006": { w: 1264, h: 560, tablet: { w: 768, h: 340.26 }, mobile: { w: 375, h: 480 } },
  "layout-007": { w: 1264, h: 560, tablet: { w: 768, h: 340.26 }, mobile: { w: 375, h: 528 } },
  "layout-008": { w: 1264, h: 560, tablet: { w: 768, h: 340.26 }, mobile: { w: 375, h: 550 } }, // mobile 532→550（2026-10-05 品名兩行批：掛角資訊卡加一行、舞台讓位；與引擎 HV2_STAGES／CSS 同批）
  "layout-009": { w: 1264, h: 560, tablet: { w: 768, h: 340.26 }, mobile: { w: 375, h: 582 } }, // mobile 564→582（同上）
  "layout-010": { w: 1264, h: 560, tablet: { w: 720, h: 318.99 }, mobile: { w: 375, h: 692 } },
  "layout-011": { w: 1440, h: 780, tablet: { w: 768, h: 560 },    mobile: { w: 375, h: 740 } },
  "layout-012": { w: 1440, h: 560, tablet: { w: 768, h: 460 },    mobile: { w: 375, h: 620 } },
};

/** 上傳格位 → 裝置 */
const SLOTS = ["desktop", "768", "375"];

/**
 * 三格各自的「最小像素」（只驗最小尺寸，不驗比例——cover 置中、寬螢幕從上下往中間裁，比例本來就不必對齊）。
 * 桌機：寬 ≥ 1440×2、高 ≥ 舞台高×2；有必見主體可交 3440×867 版（寬 ≥3440 亦過）。
 * 平板／手機：寬 ≥ 裝置視窗寬×2、高 ≥ 該裝置舞台高×2。
 */
function minSizeFor(layoutId, slot) {
  const st = HERO_STAGES[layoutId];
  if (!st) return null;
  if (slot === "desktop") return { w: DESKTOP_VIEWPORT_W * SCALE, h: Math.ceil(st.h * SCALE), altW: ULTRAWIDE_CANVAS.w, altH: ULTRAWIDE_CANVAS.h };
  if (slot === "768") return { w: st.tablet.w * SCALE, h: Math.ceil(st.tablet.h * SCALE) };
  if (slot === "375") return { w: st.mobile.w * SCALE, h: Math.ceil(st.mobile.h * SCALE) };
  return null;
}

/**
 * 體檢一張圖。回 { pass, reason, need:{w,h} }；reason 是給人看的白話句（技術細節收括號）。
 * 不裁、不改圖；重量（手機 ≤ weightGate）由呼叫端另驗。
 */
function checkSize(layoutId, slot, w, h) {
  const need = minSizeFor(layoutId, slot);
  if (!need) return { pass: false, reason: "這款版式還沒有登記舞台尺寸（技術：HERO_STAGES 缺鍵 " + layoutId + "）", need: null };
  const label = slot === "desktop" ? "桌機版" : slot === "768" ? "平板版" : "手機版";
  if (slot !== "375" && h > w) return { pass: false, reason: `${label}要橫的，這張是直的（${w}×${h}）`, need };
  if (slot === "375" && w > h) return { pass: false, reason: `手機版要直的，這張是橫的（${w}×${h}）`, need };
  const okNormal = w >= need.w && h >= need.h;
  const okUltra = slot === "desktop" && w >= need.altW && h >= need.altH;
  if (okNormal || okUltra) return { pass: true, reason: "", need };
  const alt = slot === "desktop" ? `；有必見主體也可交 ${need.altW}×${need.altH}` : "";
  return { pass: false, reason: `這張 ${w}×${h}，這款${label}至少 ${need.w}×${need.h}，請放大或重出${alt}`, need };
}

module.exports = { HERO_STAGES, SLOTS, SCALE, DESKTOP_VIEWPORT_W, ULTRAWIDE_CANVAS, minSizeFor, checkSize };
