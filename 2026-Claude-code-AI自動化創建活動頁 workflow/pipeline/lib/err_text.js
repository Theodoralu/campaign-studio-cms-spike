"use strict";
/**
 * err_text.js —— 把一顆 Error 變成「人看得懂、機器分得清」（CMS-OFFLINE-HONESTY 第①②件，2026-09-24 使用者裁甲）
 *
 * 病例（2026-09-22 同事第三版包實測）：連線層失敗時 Node 丟的是 AggregateError，message 是空字串、真正原因在 errors[]；
 * server.js 的 catch 只印 e.message（全檔 89 處、讀 cause／errors 零處）→ 畫面「技術訊息：」後面空白，
 * 而結語把責任指向網址（「換個來源再試」），照著做一小時都不會好。
 *
 * 兩支函式、一個判準：
 *   errText(e)   ＝ 可讀原因：message → code → errors[]（去重、最多列 4 個）→ cause 鏈；全空才退到 name／String(e)。
 *   errKind(e)   ＝ network（這台連不到）｜http（對方回了但不是 200/404）｜dead（活動頁空殼）｜other。
 *   sourceFailVerdict(e) ＝ 來源網址探測失敗時給使用者的白話結論（文案照 workbench/ux-writing.md：先講發生什麼、再講怎麼辦，
 *                          技術訊息收句尾括號；用詞待使用者過目——CLAUDE.md「CMS 介面溝通文字改動先給使用者過目」）。
 * 鐵律 4「同類幾處」：server.js 那 89 處 e.message 一次全換成 errText(e)，不逐處補。
 */
const NET_CODES = new Set([
  "ENOTFOUND", "EAI_AGAIN", "EAI_FAIL", "EAI_NODATA", "EAI_NONAME",
  "ECONNREFUSED", "ECONNRESET", "ECONNABORTED", "ETIMEDOUT", "EHOSTUNREACH", "ENETUNREACH", "ENETDOWN", "EPIPE",
  "ERR_SOCKET_CONNECTION_TIMEOUT", "ERR_SOCKET_CLOSED", "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_SOCKET",
]);

function errText(e, opt = {}) {
  const max = opt.max || 400;
  const seen = opt._seen || new Set();
  if (e == null) return "";
  if (typeof e === "string") return e;
  if (typeof e !== "object") return String(e);
  if (seen.has(e)) return "";
  seen.add(e);
  const parts = [];
  const msg = typeof e.message === "string" ? e.message.trim() : "";
  if (msg) parts.push(msg);
  if (e.code && !parts.join(" ").includes(String(e.code))) parts.push(String(e.code));
  if (Array.isArray(e.errors) && e.errors.length) {
    const subs = [...new Set(e.errors.map((x) => errText(x, { max, _seen: seen })).filter(Boolean))];
    if (subs.length) parts.push(`（${subs.slice(0, 4).join("；")}${subs.length > 4 ? `；…共 ${subs.length} 種` : ""}）`);
  }
  if (e.cause) {
    const c = errText(e.cause, { max, _seen: seen });
    if (c && !parts.join(" ").includes(c)) parts.push("← " + c);
  }
  let s = parts.join(" ").trim();
  if (!s) {
    // 全部空白時的退路：有意義的 name（TypeError…）＞ String(e)（但 "Error"／"[object Object]" 這種等於沒講）＞「未知錯誤」
    const str = (() => { try { return String(e); } catch (_) { return ""; } })();
    const meaningless = !str || str === "Error" || str === e.name || /^\[object /.test(str);
    s = (e.name && e.name !== "Error" ? e.name : "") || (meaningless ? "" : str) || "未知錯誤";
  }
  return s.length > max ? s.slice(0, max) + "…" : s;
}

function errKind(e, _seen = new Set()) {
  if (e == null || typeof e !== "object" || _seen.has(e)) return "other";
  _seen.add(e);
  const msg = typeof e.message === "string" ? e.message : "";
  if (e.code && NET_CODES.has(String(e.code))) return "network";
  if (/^timeout$/i.test(msg.trim()) || /\btimed? ?out\b/i.test(msg) || /socket hang up/i.test(msg)) return "network";
  if (Array.isArray(e.errors) && e.errors.length) {
    const kinds = e.errors.map((x) => errKind(x, _seen));
    if (kinds.some((k) => k === "network")) return "network"; // 多位址全部連不上＝AggregateError；任一位址是連線錯就算連線層
  }
  if (e.cause) { const k = errKind(e.cause, _seen); if (k !== "other") return k; }
  if (/＝dead/.test(msg)) return "dead";
  if (/^HTTP \d{3}\b/.test(msg)) return "http";
  return "other";
}

/* 來源探測失敗的白話結論。四種都是「先講發生什麼、再講怎麼辦」；連線層那句把責任從網址身上拿掉。 */
function sourceFailVerdict(e) {
  const kind = errKind(e);
  const tech = errText(e);
  const tail = `（技術訊息：${tech}）`;
  const verdict = kind === "network"
    ? `這台電腦現在連不到 Yahoo 購物，不是網址的問題——先確認網路有通（用瀏覽器打開 tw.buy.yahoo.com 試試），好了再按一次「開始策展」。瀏覽器開得了、這裡還是失敗的話，把工具關掉重開一次。${tail}`
    : kind === "http"
    ? `Yahoo 這一頁暫時沒有正常回應，不是你的網路、也不一定是網址的問題——請過幾秒再按一次「開始策展」；連續幾次都這樣，再換一個來源試。${tail}`
    : kind === "dead"
    ? `這個活動頁看起來已經下架或只剩空殼——請改貼品牌頁、活動賣場或搜尋結果頁。${tail}`
    : `讀取這個頁面時沒有成功，原因不在網路或網址的常見幾種——請再按一次「開始策展」；一直失敗，把括號裡這行技術訊息交給系統管理員。${tail}`;
  return { kind, verdict, tech };
}

module.exports = { errText, errKind, sourceFailVerdict, NET_CODES };
