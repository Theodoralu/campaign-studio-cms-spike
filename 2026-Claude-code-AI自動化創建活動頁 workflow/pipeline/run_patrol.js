"use strict";
/**
 * run_patrol.js —— 活動 run 每日巡檢的純函式層（2026-07-28，docs/stories/run-patrol.md）
 *
 * ⚠ 2026-09-14 部分封存（69 號附錄 C Q2 乙＋Q3 甲）：08:30 每日巡檢（server.js runPatrolAll）與活動檔期欄位已退場，
 *   lifecycleState／shouldPatrol／needsClosedNotice／buildOverviewRows／buildDetailRows 自此無消費端（留檔不刪＝回來時不用重寫；
 *   單元測試照跑）。**仍在用**＝summarizeCheck（列表與首頁的商品狀態燈）。回來的條件＝CMS 搬進內網重新規劃活動管理流程。
 *
 * 只放可單元測試的純邏輯：生命週期判定、product_check 報告摘要、總覽表/明細表列建構。
 * 巡檢的 IO 與排程（逐檔跑 productCheck、寫彙總檔、更新總覽表）在 workbench/server.js（runPatrolAll）
 * ——productCheck 是 server.js 內部函式，不在此重複實作（一套偵測邏輯、多個消費端）。
 *
 * 生命週期語意（docs/stories/activity-lifecycle.md）：營運檔期存 wb_meta.lifecycle（meta 層＝改它不動
 * draft、不觸核可失效）；兩端皆含當日；空值＝長青（evergreen）照巡。
 */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** 生命週期判定：meta.lifecycle {activeFrom, activeUntil} × 今日（YYYY-MM-DD）→ 狀態 */
function lifecycleState(lifecycle, todayStr) {
  const lc = lifecycle || {};
  const from = DATE_RE.test(lc.activeFrom || "") ? lc.activeFrom : null;
  const until = DATE_RE.test(lc.activeUntil || "") ? lc.activeUntil : null;
  if (!from && !until) return "evergreen";
  if (from && todayStr < from) return "upcoming";
  if (until && todayStr > until) return "ended";
  return "active";
}
const shouldPatrol = (lifecycle, todayStr) => ["evergreen", "active"].includes(lifecycleState(lifecycle, todayStr));

/** 失效日跨越偵測：今天已過失效日且尚未發過收檔通知＝要發（一次性）。回傳 true 的呼叫端須記 closedNoticeAt。 */
function needsClosedNotice(lifecycle, todayStr) {
  const lc = lifecycle || {};
  return lifecycleState(lc, todayStr) === "ended" && !lc.closedNoticeAt;
}

/** product_check.json 報告 → 通知用分類統計。
 *  口徑對齊既有系統（07-28 review #5/#9/#10/#24 修）：
 *  - 連結列「每列最多計 1」（status 壞或圖壞都算同一件＝同部署第⓪關 isLinkProblem）；imgDead 另存純供顯示。
 *  - drift＝真變價（含劃線），snap＝純來源紀錄待同步（snapDrift/snapMissing 且無變價）——分開欄位不虛報「變價」。
 *  - unverified（商品＋連結）不計 needsAction（誠實但不催人），但要進「無法驗證」欄與明細＝不隱形。 */
function summarizeCheck(report) {
  const rows = (report && report.results) || [];
  const links = (report && report.links) || [];
  const linkBadRow = (l) => ["expired", "dead", "empty", "offline"].includes(l.status) || l.imgStatus === "dead";
  const c = {
    products: rows.length,
    drift: rows.filter((r) => r.status === "online" && r.drift).length,
    snap: rows.filter((r) => r.status === "online" && !r.drift && (r.snapDrift || r.snapMissing)).length,
    offline: rows.filter((r) => r.status === "offline").length,
    dead: rows.filter((r) => r.status === "dead").length,
    unverified: rows.filter((r) => r.status === "unverified").length + links.filter((l) => l.status === "unverified").length,
    linksBad: links.filter(linkBadRow).length,
    imgDead: links.filter((l) => l.imgStatus === "dead").length,
  };
  c.needsAction = c.drift + c.snap + c.offline + c.dead + c.linksBad;
  return c;
}

/** 單一 run 的巡檢彙總項（summary.json 的一列；也是表列建構的輸入） */
function runEntry({ id, pageName, meta, state, counts, checkedAt, error, endedToday }) {
  const input = (meta && meta.input) || {};
  return {
    id, pageName: pageName || id,
    ownerEmail: input.ownerEmail || "", ownerDept: input.ownerDept || "",
    liveUrl: (meta && meta.liveUrl) || "",
    lifecycle: (meta && meta.lifecycle) || null, state,
    counts: counts || null, checkedAt: checkedAt || null,
    error: error || null, endedToday: !!endedToday,
  };
}

const CMS_URL = "https://solid-pancake-38klg7k.pages.github.io/"; // 遷移 #5（2026-08-04）：tunnel/跳板退役——「CMS 入口」欄過渡期指內網分享站（同仁看成果；建置操作＝Tofu 本機，A 案內網 VM 核准後恢復多人通道）
/* 欄序＝Apps Script（tools/overview-mail.gs）讀表契約——改欄位兩邊要一起動＋test 鎖 */
const OVERVIEW_HEADER = ["日期", "活動ID", "活動名", "負責人", "部門", "營運迄日", "商品數", "狀態", "變價", "待同步", "下架/失效", "連結異常", "無法驗證", "最後巡檢", "今日事件", "CMS 入口", "內部確認頁"];
const DETAIL_HEADER = ["日期", "活動ID", "活動名", "負責人", "類型", "位置", "名稱/連結", "編號", "變化", "建議動作"];

function statusLabel(e) {
  if (e.state === "ended") return "🏁 已結束";
  if (e.state === "upcoming") return "⏳ 未開始";
  if (e.error) return "⛔ 巡檢失敗";
  if (!e.counts) return "⚪ 未巡檢";
  return e.counts.needsAction > 0 ? `⚠ 需處理 ${e.counts.needsAction} 件` : "✅ 正常";
}

/** ISO 時戳 → 台北 HH:mm（表上顯示用；summary.json 保持 ISO 機器可讀）；非時間字串照舊回傳 */
function fmtTaipeiHM(iso) {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat("zh-TW", { timeZone: "Asia/Taipei", hour12: false, hour: "2-digit", minute: "2-digit" }).format(d);
}

/** 巡檢彙總 → 總覽頁籤列（首列＝心跳摘要、次列＝表頭；Apps Script 依此結構讀） */
function buildOverviewRows(summary) {
  const runs = summary.runs || [];
  const active = runs.filter((e) => ["active", "evergreen"].includes(e.state));
  const meta = ["巡檢日期", summary.date, "巡檢中", String(active.length), "已結束", String(runs.filter((e) => e.state === "ended").length),
    "異常檔數", String(active.filter((e) => e.counts && e.counts.needsAction > 0).length + active.filter((e) => e.error).length),
    "完成時間", summary.finishedAt ? fmtTaipeiHM(summary.finishedAt) : "", "FrameTest巡檢", summary.frametestLastRun || "（無紀錄）"];
  const rows = runs.map((e) => [
    summary.date, e.id, e.pageName, e.ownerEmail, e.ownerDept,
    (e.lifecycle && e.lifecycle.activeUntil) || "長青", e.counts ? String(e.counts.products) : "",
    statusLabel(e),
    e.counts ? String(e.counts.drift) : "", e.counts ? String(e.counts.snap) : "",
    e.counts ? String(e.counts.offline + e.counts.dead) : "",
    e.counts ? String(e.counts.linksBad) : "", e.counts ? String(e.counts.unverified) : "",
    e.checkedAt || "", e.endedToday ? "收檔" : e.error ? `巡檢異常：${e.error}` : "",
    CMS_URL, e.liveUrl,
  ]);
  return [meta, OVERVIEW_HEADER, ...rows];
}

/** 巡檢彙總＋各 run 的 product_check 報告 → 明細頁籤列（異常信的逐件內容源；價格逐字自報告＝實抓真值） */
function buildDetailRows(summary, reportsById) {
  const out = [DETAIL_HEADER];
  for (const e of summary.runs || []) {
    if (!["active", "evergreen"].includes(e.state)) continue;
    const rep = reportsById[e.id];
    if (!rep) continue;
    for (const r of rep.results || []) {
      if (r.status === "offline" || r.status === "dead") {
        out.push([summary.date, e.id, e.pageName, e.ownerEmail, r.status === "dead" ? "下架（售罄/移除）" : "下架（暫時）", r.where || "", r.name || "", r.gdid, r.status, "開 CMS →「替換商品」"]);
      } else if (r.status === "online" && (r.drift || r.snapDrift || r.snapMissing)) {
        const change = r.drift ? `${r.draftPrice || "?"} → ${r.livePrice || "?"}${r.marketDrift ? `（原價 ${r.draftMarketPrice || "無"} → ${r.liveMarketPrice || "移除"}）` : ""}` : "來源紀錄待同步";
        out.push([summary.date, e.id, e.pageName, e.ownerEmail, r.drift ? "變價" : "資料待同步", r.where || "", r.name || "", r.gdid, change, r.drift ? "開 CMS →「套用新價」" : "開 CMS →「套用新價／重建來源紀錄」"]);
      } else if (r.status === "unverified") {
        out.push([summary.date, e.id, e.pageName, e.ownerEmail, "無法驗證", r.where || "", r.name || "", r.gdid, "Yahoo 暫擋自動檢查", "不需動作（次日自動重查）"]);
      }
    }
    for (const l of rep.links || []) {
      const statusBad = ["expired", "dead", "empty", "offline"].includes(l.status);
      if (statusBad || l.imgStatus === "dead") {
        out.push([summary.date, e.id, e.pageName, e.ownerEmail, "入口/連結", l.where || l.kind || "", l.url || "", "",
          l.status === "expired" ? "檔期已結束" : l.status === "empty" ? "搜尋無結果" : !statusBad ? "圖片失效" : "連結失效",
          "開 CMS →「重新生成探索內容」或更換連結"]);
      } else if (l.status === "unverified") { // 連結層 unverified 不隱形（07-28 review #10）
        out.push([summary.date, e.id, e.pageName, e.ownerEmail, "無法驗證", l.where || l.kind || "", l.url || "", "", "Yahoo 暫擋自動檢查", "不需動作（次日自動重查）"]);
      }
    }
  }
  return out;
}

module.exports = { lifecycleState, shouldPatrol, needsClosedNotice, summarizeCheck, runEntry, buildOverviewRows, buildDetailRows, CMS_URL, DATE_RE };
