"use strict";
/**
 * lib/price_truth.js —— 建立期價格對真（丙-甲；2026-09-27 使用者裁，story docs/stories/first-draft-no-red.md）
 *
 * 它做什麼（一句話）
 * ----------------------------------------------------------------
 * 草稿一出生（建立／照策略檔重做）就拿商品頁現價對一次：商品狀態報告（伺服器實抓商品頁＝server.js productCheck）裡
 * 有變價的列，同一批套進快照（來源紀錄）與草稿，讓「發佈前檢查」不用叫人按「一鍵套用全部變價」收尾。
 *
 * 為什麼需要它（病例 run 2026-09-27-wb-142315／123617）
 * ----------------------------------------------------------------
 * 來源活動頁（actid 750682「結帳再享95折」）的 SSR 資料裡沒有促銷價、整頁找不到 1085 這個數字，快照照真值鐵律
 * 只能寫網路價 1142；商品頁才顯示 1085。策略檔「多放 組合」把這類商品拉進草稿＝一進來就是貴的價。
 *
 * 邊界（money-facing 自動改價，只准在這幾條裡）
 * ----------------------------------------------------------------
 *  1. 只在機器稿：建立（當下無核可）／照策略檔重做（redo-draft 端點已先 invalidateApproval）。編修期「只標示不改價」不動。
 *  2. 價格來源只有一條：商品頁實抓的列（productCheck 的 results）；本檔不算價、不猜價、不讀任何別的來源。
 *  3. 篩選與「一鍵套用全部變價」同一條：status=online 且（drift 或 snapDrift）且 livePrice 有值。
 *  4. 快照那一刀交給 patchSnapshotPrice（server.js）——它負責 price／marketPrice／disc／minDisc 與稽核行；本檔只把同一個結果
 *     寫回草稿列（price、marketPrice：原價高於現價才留欄＝沿 curate_auto／syncPoolEntry 慣例）。
 *  5. 離線（全部 unverified）＝一件都不改，回 offline=true 給呼叫端出聲；不在池的列跳過並回報。
 *
 * 純函式：不讀寫檔、不觸網——落盤、wb.log、product_check.json 同步都在呼叫端（server.js finishDraftAfterCurate）。
 */

/**
 * @param {object} p
 * @param {object} p.snap   snapshot.json 解析物（就地變更）
 * @param {object} p.draft  draft.json 解析物（就地變更）
 * @param {Array}  p.rows   productCheck 的 results 列
 * @param {string} [p.checkedAt] 報告時間（進快照稽核行）
 * @param {Function} p.patchSnapshotPrice server.js 的同名函式（snap, sp, row, checkedAt）→ { gdid, price, marketPrice }
 * @returns {{ applied: Array<{gdid:string, from:{price:number, marketPrice:number|null}, to:{price:number, marketPrice:number|null}}>,
 *            skippedNotInPool: string[], skippedNotInDraft: string[], unverified: number, offline: boolean, checked: number }}
 */
function applyPriceTruth({ snap, draft, rows, checkedAt, patchSnapshotPrice }) {
  if (typeof patchSnapshotPrice !== "function") throw new Error("applyPriceTruth：缺 patchSnapshotPrice（快照那一刀只能走 server.js 的同一支）");
  const results = Array.isArray(rows) ? rows.filter(Boolean) : [];
  const drift = results.filter((r) => r.status === "online" && (r.drift || r.snapDrift) && r.livePrice != null);
  const applied = [], skippedNotInPool = [], skippedNotInDraft = [];
  const pool = (snap && Array.isArray(snap.products)) ? snap.products : [];
  const list = (draft && Array.isArray(draft.products)) ? draft.products : [];
  for (const row of drift) {
    const gdid = String(row.gdid);
    if (!list.some((pr) => pr && String(pr.gdid) === gdid)) { skippedNotInDraft.push(gdid); continue; } // 只碰草稿上的商品（productCheck 本來就只驗草稿列；多給的列不動池）
    const sp = pool.find((x) => x && String(x.gdid) === gdid);
    if (!sp) { skippedNotInPool.push(gdid); continue; }
    const from = { price: sp.price, marketPrice: sp.marketPrice == null ? null : sp.marketPrice };
    const out = patchSnapshotPrice(snap, sp, row, checkedAt);
    for (const pr of list) {
      if (!pr || String(pr.gdid) !== gdid) continue;
      pr.price = out.price;
      if (out.marketPrice) pr.marketPrice = out.marketPrice; else delete pr.marketPrice;
    }
    applied.push({ gdid, from, to: { price: out.price, marketPrice: out.marketPrice || null } });
  }
  const unverified = results.filter((r) => r.status === "unverified").length;
  return { applied, skippedNotInPool, skippedNotInDraft, unverified, offline: results.length > 0 && unverified === results.length, checked: results.length };
}

module.exports = { applyPriceTruth };
