"use strict";
/**
 * cms/jobs.js —— 背景工作（D13）
 * 建立活動、製作 HTML 檔要跑幾十秒，不能讓請求等著。做法：路由先回應「開始了」，工作在背景跑，進度寫進活動的狀態檔，畫面輪詢狀態。
 * 一檔活動同一時間只跑一件工作（busy(id) 回正在跑的工作名；路由據此回 409）。
 * 限制：工作跑在伺服器這個程序裡。伺服器重啟＝跑到一半的工作就沒了（狀態會停在中間階段）；第一版 1 個 replica 可接受，
 *       多台或要能接續時改成佇列（記在 docs/routes-D13.md「沒做完」）。
 */
function createJobs({ onError = (id, name, e) => console.error(`[job] ${name} ${id} 失敗：`, e && e.stack ? e.stack : e) } = {}) {
  const running = new Map(); // id → { name, promise, startedAt }
  return {
    busy: (id) => (running.has(id) ? running.get(id).name : null),
    /** 開始一件工作；已有工作在跑＝回 false（不排隊） */
    start(id, name, fn) {
      if (running.has(id)) return false;
      const promise = Promise.resolve().then(fn).catch((e) => onError(id, name, e)).finally(() => { if (running.get(id) && running.get(id).promise === promise) running.delete(id); });
      running.set(id, { name, promise, startedAt: Date.now() });
      return true;
    },
    /** 等某檔的工作跑完（測試用；正式流程靠輪詢狀態） */
    wait: (id) => (running.has(id) ? running.get(id).promise : Promise.resolve()),
    size: () => running.size,
  };
}
module.exports = { createJobs };
