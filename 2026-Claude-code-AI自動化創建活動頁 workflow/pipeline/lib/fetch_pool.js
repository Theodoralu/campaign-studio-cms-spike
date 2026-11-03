"use strict";
/**
 * fetch_pool.js —— 並行抓取池（2026-10-05 建置提速批，使用者裁 A＋B＋C 的 B）
 *
 * 白話：原本對外抓頁是「一件抓完才抓下一件、每件之間睡一下」＝排一條長隊。
 * 這裡改成「五個櫃檯同時服務，但整家店開工的節奏有上限」——併發抬速度、
 * 全池節流管禮貌（對 Yahoo 的瞬時請求密度壓在禮貌線內）。
 *
 * 契約：
 * - 結果照 items 原順序回（out[i] 對 items[i]）＝並行不改資料順序（策展決定論）。
 * - worker 自己負責 try/catch（丟出例外＝整池中止——沿呼叫端原本的錯誤邊界，不吞錯）。
 * - 全池節流＝兩次「開工」至少隔 minGapMs（毫秒），是整體速率上限、不是每工人各算：
 *   concurrency 5＋minGapMs 250 ＝ 最快每秒 4 件開工，比原本串行（每秒約 1 件）密 4 倍、
 *   仍是小流量；參數保守起步（52 號批判前置：對外風險那一題）。
 * - 回退開關：env CAMPAIGN_FETCH_POOL=off（或 opts.serial）＝單工人照舊排隊——
 *   對外請求節奏回到舊行為量級，出事一鍵切回（鐵律 3：降級要出聲由呼叫端記 log）。
 * - onProgress(done, total, result, index)＝每件完成叫一次（完成序、非提交序），供進度播報。
 * - needsGate(item, i)＝這一件要不要排「開工間隔」的隊——禮貌線管的是對外網路請求；
 *   不碰網路的件（例：建立期種子直用＝讀本地結果）回 false 免排隊（2026-10-05 實測 51 件全種子仍排 13 秒＝白等）。
 */
async function mapPool(items, worker, opts = {}) {
  const serial = opts.serial || String(process.env.CAMPAIGN_FETCH_POOL || "") === "off";
  const concurrency = serial ? 1 : Math.max(1, opts.concurrency || 5);
  const minGapMs = opts.minGapMs == null ? 250 : opts.minGapMs;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const out = new Array(items.length);
  let next = 0, done = 0, gateAt = 0;
  async function gate() {
    const now = Date.now();
    const wait = Math.max(0, gateAt - now);
    gateAt = Math.max(now, gateAt) + minGapMs;
    if (wait) await sleep(wait);
  }
  async function run() {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      if (!opts.needsGate || opts.needsGate(items[i], i)) await gate();
      out[i] = await worker(items[i], i);
      done++;
      if (opts.onProgress) { try { opts.onProgress(done, items.length, out[i], i); } catch (e) { /* 進度播報不影響抓取 */ } }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, Math.max(items.length, 1)) }, run));
  return out;
}
module.exports = { mapPool };
