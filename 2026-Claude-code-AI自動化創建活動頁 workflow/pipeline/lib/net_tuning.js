"use strict";
/**
 * lib/net_tuning.js —— 對外連線的一條共用設定（唯一一份；凡是會往外抓的檔都 require 這支）
 *
 * 白話：Node 連一個網站時，會把那個網站的好幾個位址各試一下，挑最快通的。
 * 但它給「每一個位址」的時間預設只有 **250 毫秒**——網路稍微慢一點，每個都來不及握手就被它自己砍掉，
 * 最後回報「連線逾時」。瀏覽器和 curl 沒有這個限制，所以會出現**人點得開、工具抓不到**的鬼打牆。
 *
 * 病例（2026-10-01，使用者測第五版單機版時阻斷）：
 *   家用網路連 tw.buy.yahoo.com，TCP 握手實測 **291 毫秒** > 預設 250 毫秒。
 *   DNS 回 6 個位址（3 個 IPv4 ＋ 3 個 IPv6），IPv4 全部 ETIMEDOUT（預算不夠）、IPv6 全部 ECONNREFUSED
 *   （該網路的 IPv6 是壞的）⇒ 1.26 秒後全滅（6 × 250ms 不到就收工）。
 *   後果＝檢查商品、替換商品、手動更換探索卡連結、修價、策展驗價**全部**失敗；
 *   而介面訊息寫「請確認網址能在瀏覽器打開後再試一次」——使用者的瀏覽器明明打得開，
 *   於是他一直換網址、換什麼都被擋（真實反應：「用戶換什麼 url 都被擋」）。
 *   同時 Node 丟的是 `AggregateError`，它的 `.message` 是**空字串**，所以畫面印出「（技術訊息：）」後面什麼都沒有。
 *
 * 為什麼是「調高預算」而不是「關掉自動選擇」：
 *   關掉之後只照 DNS 順序連第一個，而上面那個網路的 IPv6 是壞的——運氣不好就卡更久。
 *   調高預算保留「IPv6 不通就快速退回 IPv4」的好處，只是把退回的判斷時間放寬到合理值。
 *
 * 公司網路／VPN 的延遲比家用更高，所以預設值取 2000 毫秒（實測需求 291ms，留足餘裕）；
 * 要在測試或特殊網路改值＝環境變數 `CAMPAIGN_CONNECT_ATTEMPT_MS`。
 *
 * 絆線：`test/unit/net_tuning.test.js` 會掃「哪些檔會對外抓」，少 require 一個就紅燈——
 * 因為同一條規則抄在五個門上，改了門口那道、屋裡還有四道舊的（鐵律 4 第二問）。
 */
const net = require("net");

const FLOOR_MS = 250;      // Node 的預設值；低於或等於這個數字等於沒調
const DEFAULT_MS = 2000;

function pick() {
  const raw = process.env.CAMPAIGN_CONNECT_ATTEMPT_MS;
  if (raw === undefined || raw === "") return DEFAULT_MS;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) {
    console.warn(`ⓘ [net_tuning] CAMPAIGN_CONNECT_ATTEMPT_MS=「${raw}」不是有效毫秒數——沿用預設 ${DEFAULT_MS}ms`);
    return DEFAULT_MS;
  }
  return n;
}

const ATTEMPT_TIMEOUT_MS = pick();

/* 這支 API 自 Node 18.18／20 起有；舊版就只能退回啟動旗標。不出聲地跳過＝靜默降級（鐵律 3），所以要講。 */
let applied = false;
if (typeof net.setDefaultAutoSelectFamilyAttemptTimeout === "function") {
  net.setDefaultAutoSelectFamilyAttemptTimeout(ATTEMPT_TIMEOUT_MS);
  applied = true;
} else {
  console.warn(
    "⚠ [net_tuning] 這顆 Node 沒有 setDefaultAutoSelectFamilyAttemptTimeout——" +
    "網路慢的時候對外抓取可能會回「連線逾時」。解法＝啟動時加 " +
    `--network-family-autoselection-attempt-timeout=${ATTEMPT_TIMEOUT_MS}`
  );
}

module.exports = { ATTEMPT_TIMEOUT_MS, DEFAULT_MS, FLOOR_MS, applied };
