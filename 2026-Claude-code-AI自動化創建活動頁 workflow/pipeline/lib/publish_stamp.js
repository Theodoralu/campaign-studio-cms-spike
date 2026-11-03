"use strict";
/**
 * publish_stamp —— 發佈內網預覽時，把「這一版當下核可了沒」蓋進送出去的那份資料
 * （2026-09-14 三題牆第 1 題甲；半天工單 CMS-PREVIEW-UNAPPROVED-MARK）
 *
 * 為什麼要有：預覽連結可以在沒核可的狀態下發出去（流程刻意允許，2026-09-11 裁不收緊）。
 * 操作的人有三道提醒，但**拿到連結的人零提醒**——已核可與沒核可的頁長得一模一樣，
 * 而他可能拿它去開會。發佈鏈原本只把一句「產物勿改」的註解塞進網頁原始碼（看不見），
 * 核可狀態根本沒往下傳。這支就是那條缺掉的線。
 *
 * 蓋的是**發佈當下的快照**，不是活的狀態：預覽頁在同事的瀏覽器裡打開，連不回工作台
 * （單機版的前提就是連不到），所以「現在核可了沒」問不到；能誠實講的只有「發佈的那一刻」。
 * 也因此核可之後橫幅不會自己消失——要再發佈一次預覽才會；那句提醒由工作台任務條負責講。
 *
 * 鍵名 publish 是 draft 的頂層新鍵，渲染端只讀 page／products／assets＝不影響任何既有欄位；
 * 內容位元組不動（只加一鍵）＝gate 驗過的那份內容仍原樣送出。
 */

/** 發佈當下的核可快照。meta＝run 的 wb_meta.json（核可時間住 approvedAt）。 */
function publishStamp(meta, now) {
  const approvedAt = (meta && meta.approvedAt) || null;
  return {
    approved: !!approvedAt,                                   // 前台只看這一格決定亮不亮橫幅
    approvedAt,                                               // 沒核可＝null
    publishedAt: (now instanceof Date ? now : new Date()).toISOString(),
  };
}

/**
 * 把快照蓋進 draft JSON 文字，回傳要寫出去的文字。
 * 解析不了＝**原文原樣回傳**（不加鍵、不丟例外）——發佈鏈不該因為多蓋一個標記而整個倒掉，
 * 而前台對「沒有 publish 欄位」的處置是不亮橫幅＝退回本功能上線前的行為，不會誤標。
 * 回傳第二格 stamped 讓呼叫端能誠實記一筆（鐵律 3：降級了要出聲，不靜默）。
 */
function stampDraftJson(text, meta, now) {
  let obj;
  try { obj = JSON.parse(text); } catch (_) { return { text, stamped: false, reason: "draft.json 解析不了" }; }
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return { text, stamped: false, reason: "draft.json 不是物件" };
  obj.publish = publishStamp(meta, now);
  return { text: JSON.stringify(obj, null, 1) + "\n", stamped: true, reason: "" };
}

module.exports = { publishStamp, stampDraftJson };
