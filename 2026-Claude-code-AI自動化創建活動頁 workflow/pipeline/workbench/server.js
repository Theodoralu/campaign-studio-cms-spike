/**
 * 策展工作台 v0 —— 本機伺服器（零外部依賴；13 號平台 Stage A 前台 spike）
 * 用法：node workbench/server.js [port]（預設 8787）→ 開 http://localhost:8787
 *
 * 職責：
 *  - 前台 UI（public/index.html）：URL＋情境＋主題輸入 → 策展 → 預覽 → 編修 → 回存 → 送機器閘
 *  - 掛 FrameTest（deploy-site 同步版）於 /frametest/ ＝同源 → loader ?draftUrl= 相對路徑白名單直通
 *  - 橋接既有管線：fetch_parse.js（stage1）／workbench/curate_auto.js（機械）／claude -p（AI 策展）
 *    ／gate.js＋write_xlsx.js（stage2）——工作台不重寫任何規則（單一來源鐵律）
 *  - draft 回存版本化：每次 PUT 前備份 draft.v<N>.json（誤存可回復）
 *
 * 邊界：本機工具（spike）——未上線資料不出本機；線上多人版＝13/15 號平台裁決範圍。
 */
const http = require("http");
const https = require("https"); // 連結內容檢查 urlStatus（2026-07-27）
require("../lib/net_tuning"); // 對外連線預算（唯一一份＝lib/net_tuning.js）：預設 250ms 太短會讓「人點得開、工具抓不到」
const fs = require("fs");
const path = require("path");
const { spawn, spawnSync } = require("child_process");
const { allocRunId } = require("./run_id.js"); // run id 同秒讓位（2026-08-31 修；hermetic 抽件沿 product_fetch 先例）
const { errText, sourceFailVerdict } = require("../lib/err_text.js"); // 2026-09-24 CMS-OFFLINE-HONESTY：錯誤要講人話——空 message 的 AggregateError 也要印出原因；全檔 e.message 一次換成 errText(e)（鐵律 4 同類一次修）

/* 頂層例外防護（2026-07-29 資安加固批事故根治）：原本任一未捕捉例外＝整台平台程序退出、
   要等看門狗 ~60 秒才拉起（當日實證：登入鎖定初版誤用區域變數 warn，首次失敗登入即讓平台停擺）。
   本防護＝「出聲但不死」：例外落 stdout（/tmp/wb-server.log）＋ workbench/fatal.log（重啟不失憶，供事後追查），
   程序繼續服務其他請求（出事的那個請求會逾時，不影響其他人）。
   ⚠ 不吞錯：一定記錄；且 60 秒內連 5 次＝判定狀態可能已損壞，主動退出交看門狗重啟乾淨程序（防帶病續跑）。 */
const FATAL_LOG = path.join(__dirname, "fatal.log");
let fatalN = 0, fatalSince = 0;
let serverListening = false; // server.listen 成功才 true——之前的例外＝安裝不完整或缺檔，不該靜靜結束（2026-09-16 打包前總檢 A-高2）
function onFatal(kind, err) {
  const now = Date.now();
  if (!fatalSince || now - fatalSince > 60000) { fatalSince = now; fatalN = 0; }
  fatalN++;
  const line = `[fatal] ${new Date().toISOString()} ${kind}（60 秒內第 ${fatalN} 次）: ${(err && err.stack) || err}`;
  try { console.error(line); } catch (e) { /* console 故障＝下行 fatal.log 補位；fatal 路徑不可再拋 */ }
  try { fs.appendFileSync(FATAL_LOG, line + "\n"); } catch (e) { /* fatal.log 寫入失敗＝上行 console 已出聲；fatal 路徑不可再拋 */ }
  if (!serverListening) {
    /* 還沒開始服務就炸＝多半是同事包缺檔（例：design-tokens 不在）或安裝不完整。原本 uncaughtException 被接走後
       server.listen 永遠沒跑到、事件迴圈空、程序 exit 0 靜靜結束＝start-editor.sh 也回 0（2026-09-16 打包前總檢 A-高2）。
       MODE 在此行之下才宣告，改讀 env 免 TDZ。 */
    try { console.error(process.env.CAMPAIGN_MODE === "editor"
      ? "[fatal] 工具還沒開始服務就出錯了——多半是同事包少了檔案或安裝不完整。請重新下載完整的包再試；如果還是這樣，把上面那行錯誤截圖給負責人。"
      : "[fatal] 伺服器在 listen 之前就出錯（見上行）＝啟動失敗，結束碼 1。"); } catch (e) { /* 盡力而為；exit(1) 本身即出聲 */ }
    process.exit(1);
  }
  if (fatalN >= 5) {
    try { console.error(process.env.CAMPAIGN_MODE === "editor"
      ? "[fatal] 60 秒內連續出錯 5 次，工具已停止。請關掉這個視窗、重新執行啟動檔；若一直發生，把這個視窗截圖給負責人。"
      : "[fatal] 60 秒內 5 次未捕捉例外＝主動退出，交看門狗重啟乾淨程序"); } catch (e) { /* 臨退出訊息盡力而為；exit(1) 本身即出聲（看門狗記重啟） */ }
    process.exit(1);
  }
}
process.on("uncaughtException", (e) => onFatal("uncaughtException", e));
process.on("unhandledRejection", (e) => onFatal("unhandledRejection", e));

const PORT = Number(process.argv[2]) || 8787;
/* 版本記號（69 號 Phase 3；2026-09-16 開工）：workbench/VERSION 由 tools/pack-editor.sh 打包時寫入（第一行＝日期-hash），
   開發樹沒有這個檔＝"dev"。經 /api/version.build 給介面右上角顯示——同事回報問題時我們知道他手上是哪一版。 */
const BUILD = (() => { try { return fs.readFileSync(path.join(__dirname, "VERSION"), "utf8").split("\n")[0].trim() || "dev"; } catch (e) { return "dev"; } })();
/* 編修模式旗標（69 號 Phase 1；2026-09-15 B 批落地，牆 cms-solo-create-flow-ia 第 6 題甲＋69 號附錄 D）：
   CAMPAIGN_MODE=editor＝同事版：一律綁 127.0.0.1、免登入、不掛排程、發佈／Google 路由 403。
   兩層不混——「伺服器看旗標擋路由；介面看能力表決定長相」（能力表＝lib/capabilities.js，經 /api/version 給前端）。 */
const MODE = process.env.CAMPAIGN_MODE === "editor" ? "editor" : "owner";
/* 綁定位址開關（2026-08-05 過渡方案＝docs/stories/lan-direct-access.md 設計 1）：檔案制而非環境變數——
   看門狗在 launchd 模式繼承不到終端環境（plist EnvironmentVariables 只有 PATH）＝env 路線一經看門狗重啟必回落 loopback。
   三態：`workbench/.wb-bind` 內容 trim 後＝0.0.0.0 → 對內網開放；無檔＝127.0.0.1 純本機（＝開關前的行為，不變）；
   內容非法（typo／填了具體 IP／垃圾）→ 回落 127.0.0.1＋出聲，絕不把讀到的字串原樣餵給 listen()（鐵律 3）。 */
const BIND_FILE = path.join(__dirname, ".wb-bind");
const BIND_REFUSE_MARKER = "/tmp/wb-bind-refused"; // 拒啟表態檔：看門狗據此停止無限重試（設計 2）
function resolveBind() {
  if (MODE === "editor") return { host: "127.0.0.1", open: false }; // 編修模式不讀 .wb-bind：同事版永遠純本機（也免得測試環境誤觸「內網開放未生效」通知與拒啟 marker）
  let raw;
  try { raw = fs.readFileSync(BIND_FILE, "utf8"); } catch (e) { return { host: "127.0.0.1", open: false }; }
  const v = String(raw).trim();
  if (v === "0.0.0.0") return { host: "0.0.0.0", open: true };
  console.error(`⚠ ${BIND_FILE} 的內容不是 0.0.0.0（讀到 ${JSON.stringify(v.slice(0, 40))}）＝視為未開放，本次以純本機 127.0.0.1 啟動。要對內網開放請把該檔內容改成單獨一行 0.0.0.0；不想開放請直接刪除該檔。`);
  return { host: "127.0.0.1", open: false };
}
const BIND = resolveBind();
const SERVER_BOOT = new Date().toISOString(); // 版本握手用（2026-07-25）
const PIPE = path.join(__dirname, "..");
const RUNS = process.env.CAMPAIGN_RUNS_DIR ? path.resolve(process.env.CAMPAIGN_RUNS_DIR) : path.join(PIPE, "runs"); // 同事版可指定落點（69 號 Phase 1）
try { fs.mkdirSync(RUNS, { recursive: true }); } catch (e) { console.error(`runs 目錄建立失敗（${RUNS}）：${errText(e)}`); }
/* 能力表（介面看它決定長相；null＝偵測中，前端 fail-closed 先不渲染能力門後的東西）。偵測跑在子行程＝探針最長 23 秒不卡主迴圈。
   2026-09-21 改為可重測（story `docs/stories/caps-recheck.md`）：原本只在開機探一次＝登入狀態中途變了介面永遠跟不上——
   病例：07:54:56 探針回「OAuth 過期」→ 使用者 08:15:01 重新登入 → 08:16 介面仍掛橫幅、且 server 擋門（下方 engine:"ai" 那段）
   讀同一份快取＝AI 策展是真的用不了，直到重啟。三項能力全中同一個形狀（ai／publish／vendorSheet），消費端兩處（介面＋擋門）。
   併發共用同一輪＝連按「重新檢查」不會重複叫 claude（登入探針是真呼叫，同事機花的是他自己的額度）；
   刻意不做定時自動重測，理由同上（單機版會變成整天持續扣額度）。 */
let CAPS = null;
let capsInflight = null; // 進行中的那一輪（Promise）；null＝閒置
function detectCaps(reason) {
  if (capsInflight) return capsInflight; // 已有一輪在跑＝共用它，不重複 spawn
  capsInflight = new Promise((resolve) => {
    const ch = spawn(process.execPath, [path.join(PIPE, "lib", "capabilities.js")], { env: { ...process.env, CAMPAIGN_MODE: MODE, CAMPAIGN_PIPE: PIPE }, stdio: ["ignore", "pipe", "pipe"] });
    let out = "", err = "", settled = false;
    ch.stdout.on("data", (d) => { out += d; }); ch.stderr.on("data", (d) => { err += d; });
    const done = () => { if (settled) return; settled = true; capsInflight = null; resolve(CAPS); }; // 一定要清 inflight，否則一次失敗就永遠測不了（R2）
    const fail = (why) => { CAPS = { caps: { ai: false, publish: false, vendorSheet: false }, detail: { error: why }, mode: MODE, checkedAt: new Date().toISOString(), overrides: [] }; console.error(`[caps] 能力偵測失敗＝全部視為沒有（${why}）`); done(); };
    ch.on("error", (e) => fail(errText(e)));
    ch.on("close", (code) => {
      if (code !== 0) return fail(`exit ${code} ${err.trim().slice(0, 200)}`);
      try { CAPS = JSON.parse(out); } catch (e) { return fail("輸出不是 JSON：" + errText(e)); }
      const c = CAPS.caps;
      console.log(`[caps] 能力表（${reason || "啟動"}）：AI ${c.ai ? "有" : "無"}${CAPS.detail.ai && CAPS.detail.ai.note ? `（${CAPS.detail.ai.note}）` : ""}｜發佈 ${c.publish ? "有" : "無"}｜Google 試算表 ${c.vendorSheet ? "有" : "無"}${CAPS.overrides.length ? `｜覆寫 ${CAPS.overrides.join(" ")}` : ""}`);
      done();
    });
  });
  return capsInflight;
}
const PUB = path.join(__dirname, "public");
const FRAMETEST_DIR = path.join(PIPE, "..", "..", "2026-AI自動化活動頁生成規劃", "deploy-site", "lecreuset-frametest");
const PLAN_DIR = path.join(PIPE, "..", "..", "2026-AI自動化活動頁生成規劃"); // 色彩工具同源掛載（/colortool/，68 號第一批）

const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8", ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml", ".woff2": "font/woff2" };

const send = (res, code, body, type) => { res.writeHead(code, { "Content-Type": type || "application/json; charset=utf-8", "Cache-Control": "no-store" }); res.end(body); };
const sendJson = (res, code, obj) => send(res, code, JSON.stringify(obj));
const EDITOR_BLOCKED_SUBROUTES = new Set(["deploy", "publish-public", "sheet-create", "sheet-read", "sheet-status", "sheet-unlink"]); // 編修模式 403 名單（69 號 Phase 1＋71 號 §8.5）。apply-live-price(-all) 2026-09-16 移出（牆 P-8 甲）：它只改本機 runs/<id>/snapshot.json 與 product_check.json、不碰線上頁，原註解「動的是線上頁」經打包前總檢查證不成立；擋著＝同事機遇變價無路可走（鈕在、按了 403）
const readBody = (req) => new Promise((r) => { const bufs = []; req.on("data", (c) => bufs.push(c)); req.on("end", () => r(Buffer.concat(bufs).toString("utf8"))); });
/* 限量版 body 讀取（63 號上傳端點 2026-08-31）：超限＝回 null 並斷線——免登入端點不吃無上限 body */
const readBodyLimited = (req, limit) => new Promise((r) => {
  const bufs = []; let n = 0, over = false;
  req.on("data", (c) => { if (over) return; n += c.length; if (n > limit) { over = true; try { req.destroy(); } catch (e) { console.error("[readBodyLimited] 超限斷線失敗（不影響拒收）：" + ((e && errText(e)) || e)); } return r(null); } bufs.push(c); });
  req.on("end", () => { if (!over) r(Buffer.concat(bufs).toString("utf8")); });
  req.on("error", () => { if (!over) { over = true; r(null); } });
});
/* 防 DNS rebinding（QA 2026-07-27）：Google 憑證相關端點（會用 OAuth token 讀寫 Sheets/Drive、回傳 email/apiKey）只准本機存取。
   2026-08-05 升級為雙判（lan-direct-access story 設計 4＝紅隊 blocking）：原本只驗 Host 標頭，而 Host 是客戶端可控——
   tunnel 時代 socket 恆為 127.0.0.1 且威脅模型是瀏覽器 DNS rebinding（JS 改不了 Host）＝單驗足夠；
   但綁 0.0.0.0 後威脅模型變成「任意 LAN client」，一句 `curl -H "Host: localhost"` 即可繞過並取走 Google access token。
   故加驗 socket 來源位址；與 authKeyOf 同一根因＝tunnel 時代信任了客戶端可控輸入，一次修整類（鐵律 4）。 */
const isLoopbackAddr = (a) => /^(::ffff:)?127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(String(a || "")) || String(a || "") === "::1";
const isLoopbackHost = (req) => /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i.test(String((req.headers && req.headers.host) || ""))
  && isLoopbackAddr(req.socket && req.socket.remoteAddress);
const srcOf = (req) => String((req.socket && req.socket.remoteAddress) || "?").replace(/^::ffff:/, ""); // 稽核用來源（設計 5；機器級非人員級）
// ↑ 2026-07-23 修：原 `b += c` 逐 chunk 隱式 toString——多位元組 UTF-8 字元被 chunk 邊界切斷＝U+FFFD 損毀
//   （tunnel 傳輸 chunk 較碎必踩；實例＝221556 線上編修「經典米奇」→「經典���奇」）；Buffer.concat 後一次解碼。

function serveFile(res, absPath) {
  fs.stat(absPath, (e, st) => {
    if (e) return sendJson(res, 404, { error: "not found" });
    if (st.isDirectory()) absPath = path.join(absPath, "index.html");
    fs.readFile(absPath, (e2, buf) => {
      if (e2) return sendJson(res, 404, { error: "not found" });
      send(res, 200, buf, MIME[path.extname(absPath).toLowerCase()] || "application/octet-stream");
    });
  });
}
const safeJoin = (root, rel) => { // 路徑穿越守門
  /* 2026-09-11 補洞：原本只判 startsWith(root)，那會讓「同前綴的姊妹資料夾」通過——
     root=/x/briefs 配 rel=../briefs-evil/a 正規化成 /x/briefs-evil/a，startsWith 為真。
     改成必須等於 root 或落在 root/ 之下。本機單人工具風險低，但這是守門、不是提示。 */
  const base = path.resolve(root);
  const p = path.resolve(base, rel);
  return p === base || p.startsWith(base + path.sep) ? p : null;
};

/* ---------- run 狀態（wb_meta.json） ---------- */
const metaPath = (id) => path.join(RUNS, id, "wb_meta.json");
const readMeta = (id) => { try { return JSON.parse(fs.readFileSync(metaPath(id), "utf8")); } catch (e) { return null; } };
const writeMeta = (id, patch) => {
  const m = { ...(readMeta(id) || {}), ...patch, updatedAt: new Date().toISOString() };
  fs.writeFileSync(metaPath(id), JSON.stringify(m, null, 1));
  return m;
};
const appendLog = (id, line) => fs.appendFileSync(path.join(RUNS, id, "wb.log"), `[${new Date().toISOString()}] ${line}\n`);
/* 核可失效（QA 2026-07-27 #4）：任何直接改寫 draft.json 的旁路端點（enrich-ee/editorial-add/promo-recompose）都要比照 PUT draft.json
   在內容變更後清掉核可，否則「核可＝鎖此版」語意被繞過。回傳是否失效供前端同步清 approvedAt。 */
const invalidateApproval = (id) => { const m = readMeta(id) || {}; if (m.approvedAt) { writeMeta(id, { approvedAt: null, approvalInvalidatedAt: new Date().toISOString(), approvedAtPrev: m.approvedAt }); appendLog(id, `核可失效：核可（${m.approvedAt}）後內容經編輯端點變更——需重新核可`); return true; } return false; };
const exploreFixLocks = new Set(); // 探索卡修復互斥（QA #5/#8：驗活 5–10 秒窗口、並發修復會互蓋）
const EXPLORE_ITEMS_CAP = 4; /* 探索入口上限（2026-10-07 使用者需求「新增入口」＋三裝置實測定值：桌機 1440 單排整齊放到 4、5 起折兩排出孤兒卡；手機 2 欄雙數最整齊）。引擎 slice(0,4) 同值＝畫面端背板，這裡是寫入門。 */
/* 套用實抓新價到快照商品（共用：單品 apply-live-price 與批次 apply-live-price-all；價格真值取自 product_check 伺服器實抓） */
const patchSnapshotPrice = (snap, sp, row, checkedAt) => {
  const oldP = sp.price, oldM = sp.marketPrice || null;
  sp.price = row.livePrice;
  if (row.liveMarketPrice && row.liveMarketPrice > row.livePrice) { sp.marketPrice = row.liveMarketPrice; sp.disc = Math.round((row.livePrice / row.liveMarketPrice) * 100); }
  else { sp.marketPrice = null; sp.disc = null; }
  snap.warnings = snap.warnings || [];
  snap.warnings.push(`套用新價：gdid ${sp.gdid} price ${oldP}→${sp.price}、marketPrice ${oldM}→${sp.marketPrice}（真值＝product_check ${checkedAt || "?"} 伺服器實抓；Q4-A）`);
  // minDisc 同口徑重算（fetch_parse 建快照公式；QA #3：套價清掉虛深折數後，write_xlsx 互證列不可殘留「實算最低 28 折」舊語意）
  const _ds = (snap.products || []).map((p) => p.disc).filter((d) => d && d > 0 && d < 100);
  snap.minDisc = _ds.length ? Math.min(..._ds) : null;
  return { gdid: String(sp.gdid), price: sp.price, marketPrice: sp.marketPrice || null };
};
/* 商品狀態統計（productCheck 與 patchProductCheckFile 共用口徑；drift 含快照落後 snapDrift）。
   暫存品（僅存在 page.heroSlotStash＝不渲染不出貨；51 號 W1-D）不計主計數、另列 stashed N 件（14 §2.13）。 */
const pcSummaryOf = (results) => {
  const act = results.filter((r) => !r.stashed);
  return {
    online: act.filter((r) => r.status === "online" && !r.drift && !r.snapDrift).length,
    drift: act.filter((r) => r.drift || r.snapDrift).length,
    offline: act.filter((r) => r.status === "offline").length,
    dead: act.filter((r) => r.status === "dead").length,
    unverified: act.filter((r) => r.status === "unverified").length,
    snapMissing: act.filter((r) => r.snapMissing).length,
    stashed: results.length - act.length,
  };
};
/* 「要處理幾件」單一口徑（2026-09-16 打包前總檢 C-H1／牆 P-9 甲）：unverified（連不上 Yahoo、沒能驗價）算問題、擋交付——
   原本 deployRun／exportZip／exportAem 三處各抄一份且都漏了它＝同事機沒網路時綠燈放行、出貨建檔當天的舊價，README 還寫「通過」。
   前端 pcBad（index.html）同口徑。 */
const pcBlockingCount = (s, badLinks) => (s.dead || 0) + (s.offline || 0) + (s.drift || 0) + (s.snapMissing || 0) + (s.unverified || 0) + (badLinks || 0);
const pcBlockMessage = (s, n, verb) => ((s.unverified || 0) > 0
  ? `有 ${s.unverified} 件商品連不上 Yahoo、沒能驗價（共 ${n} 項要處理）——請確認這台電腦連得上 tw.buy.yahoo.com，按「重新檢查」後再${verb}`
  : `商品狀態檢查未過（要處理 ${n} 項）——開「發佈前檢查」清單，照每條的按鈕與指引處理後再${verb}`);
/* 套價／重建來源紀錄後回寫磁碟商品狀態報告（2026-07-27 QA #3/#5/#8）：只 patch snapshot 不回寫報告
   ＝F5 重載後 prefill 讀舊檔、snapDrift/snapMissing 殭屍復活（紅字＋幽靈「套用新價」鈕再打核可） */
function patchProductCheckFile(runDir, gdid, patch) {
  const p = path.join(runDir, "product_check.json");
  let pc = null;
  try { pc = JSON.parse(fs.readFileSync(p, "utf8")); } catch (e) { return; } // 沒報告＝沒東西要同步
  const row = (pc.results || []).find((x) => String(x.gdid) === String(gdid));
  if (!row) return;
  patch(row);
  pc.summary = pcSummaryOf(pc.results || []);
  fs.writeFileSync(p, JSON.stringify(pc, null, 1));
}
/* 商品體檢報告對帳（2026-08-30 使用者病例＝面板叫你「重建小潘的來源紀錄」、按下去伺服器回「頁面上沒有這件商品」死巷）：
   根因＝草稿商品被換掉/移除後，product_check.json 的那一列還留著（幽靈列）——面板照報告畫按鈕、按鈕照草稿查資料，兩邊不同步。
   與 patchProductCheckFile 同一類根因（動作沒同步依賴報告，鐵律 3）；差別是那支修「值」、這支修「列的存在」。
   收口＝每次 draft.json 落盤後呼叫一次：草稿沒有的 gdid＝整列刪掉、重算 summary。回傳被清掉的列數供記帳。 */
function reconcileProductCheckFile(runDir, draftObj) {
  const p = path.join(runDir, "product_check.json");
  let pc = null;
  try { pc = JSON.parse(fs.readFileSync(p, "utf8")); } catch (e) { return 0; } // 沒報告＝沒東西要對帳
  const rows = pc.results || [];
  if (!rows.length) return 0;
  const alive = new Set((draftObj.products || []).map((x) => String(x && x.gdid)));
  const kept = rows.filter((r) => alive.has(String(r.gdid)));
  const dropped = rows.length - kept.length;
  if (!dropped) return 0;
  pc.results = kept;
  pc.summary = pcSummaryOf(kept);
  fs.writeFileSync(p, JSON.stringify(pc, null, 1));
  return dropped;
}
/* 連結內容問題判定（前端 pcLinkBad／deployRun 同口徑：unverified＝暫時性不算問題、每列最多計 1） */
const isLinkProblem = (l) => ["dead", "expired", "empty", "offline"].includes(l.status) || l.imgStatus === "dead";

function runNode(id, script, args, cwd) { // pipeline 腳本橋接：stdout/stderr 全入 wb.log
  return new Promise((resolve) => {
    const ch = spawn(process.execPath, [script, ...args], { cwd: cwd || PIPE });
    ch.stdout.on("data", (d) => appendLog(id, d.toString().trimEnd()));
    ch.stderr.on("data", (d) => appendLog(id, "ERR " + d.toString().trimEnd()));
    ch.on("close", (code) => resolve(code));
  });
}

/* 來源頁詞派生（2026-07-25 裁決 Q1-B1＝U23 同源）：搜尋 p= 詞＋來源頁 title 頭段分詞——
   抽象主題（拍出精彩人生）2-gram 全滅家族的主治：品類詞其實在輸入端就有（實測相機案 0%→50/60/100%） */
function deriveSourceKeywords(runDir, srcUrl) {
  const kws = new Set();
  try { const u = new URL(srcUrl || ""); const q = u.searchParams.get("p");
    if (q) decodeURIComponent(q).split(/[\s+]+/).forEach((w) => { const t = w.trim().toLowerCase(); if (t.length >= 2) kws.add(t); });
  } catch (e) {}
  try {
    const raw = fs.readFileSync(path.join(runDir, "raw", "source_page.html"), "utf8");
    const tm = raw.match(/<title>([^<]*)<\/title>/i);
    if (tm) {
      const head = tm[1].split(/[,，|｜]/)[0].replace(/優惠推薦.*$/, "").trim();
      head.split(/[\/、\s\-]+/).forEach((w) => { const t = w.trim().toLowerCase(); if (t.length >= 2 && !/yahoo|購物中心/i.test(t)) kws.add(t); });
    }
  } catch (e) {}
  return [...kws];
}

/* CP-14 主題契合詞組派生（單一實作＝createRun 與 promoLayerOptions 共用；2026-07-25 design QA 去重複） */
const { deriveThemeKeywords } = require("../lib/theme_keywords"); // 2026-09-11 搬進 lib：策略檔「來源對不對得上」預檢與 CP-14 詞組派生共用同一把切詞刀（勿在此重抄）
const { stampDraftJson } = require("../lib/publish_stamp"); // 2026-09-16：發佈內網預覽時把「這一版當下核可了沒」蓋進送出去的資料（三題牆第 1 題甲）

/* ---------- 策展批次建立（stage1 → 引擎策展 → 自動 gate 初判） ---------- */
/* 策展之後、檢查之前的收尾（2026-09-15 C 批抽函式；鐵律 4「同類幾處」）：詞組校準、自訂色、版式與提案包寫入、v2 主題橋接、策略檔套用。
   建立（createRun）與「照策略檔重做」（redo-draft）共用同一支——重做不是第二份流程。零行為變化：內容原樣搬自 createRun。 */
/* CP-14 主題契合詞組＝U14 校準通道自動化（2026-07-22：gate 預設詞組硬編鈦案，非鈦主題全滅 0%）：
   自 curationTheme 機械派生（全串＋中文 2-gram＋數字/英文詞）＋來源頁詞（2026-07-25 裁決 Q1-B1；空主題也必寫）寫 run 級 feedback_patch.json；gate 經 GATE_THEME_FIT_PATCH 讀取。
   2026-09-28（ENTRY-THEMEFIT-SELF-CHECK）：抽成函式、在 curate_auto 之前先寫，回傳 `--themeFit <檔>` 讓 curate 挑本期活動入口時用同一把尺過濾
   ＝系統自己挑的入口不再被自己的檢查判不合格（病例 140838 入口 #3 5%＜30% FAIL）。內容沒變就不重寫不重印（建立流程會叫兩次）。 */
function ensureThemeFitPatch(id, runDir, input) {
  try {
    const kws = [...new Set([...deriveThemeKeywords(input.theme), ...deriveSourceKeywords(runDir, input.url)])];
    if (!kws.length) return [];
    const fp = path.join(runDir, "feedback_patch.json");
    const next = JSON.stringify({ themeFitRule: { keywords: kws, threshold: 0.3,
      note: "機械派生＝curationTheme＋來源頁詞（2026-07-25 裁決 Q1-B1、U23 同源；30% 門檻不變；人工詞組可直接改本檔或經工作台「主題詞組」卡）" } }, null, 1);
    let cur = null; try { cur = fs.readFileSync(fp, "utf8"); } catch (e) { /* 檔還不在＝第一次寫，cur=null 自然 !== next */ }
    if (cur !== next) { fs.writeFileSync(fp, next); appendLog(id, `CP-14 主題詞組校準檔產出（${kws.length} 詞＝主題派生＋來源頁詞）`); }
    return ["--themeFit", fp];
  } catch (e) { appendLog(id, "主題詞組校準檔略過：" + errText(e)); return []; }
}
async function finishDraftAfterCurate(id, runDir, input) {
  ensureThemeFitPatch(id, runDir, input); // CP-14 詞組校準檔（U14）：auto 路在 curate 之前已寫（同內容不重寫）；這行保留給 AI 策展路（不經 curate_auto）
  /* 自訂品牌色寫入。這個 try 原本同時透傳「更新頻次」到 page.refreshPolicy（14 號提案⑥）——2026-09-14 停寫（單機版建頁流程牆第 1 題甲）：
     從 07-22 起沒有任何排程或匯出讀過它、介面那句「會帶進檔期提案」從未接上；既有 draft 的 page.refreshPolicy 原樣保留不刪。
     回來條件＝有排程消費端且提案匯出真的帶它。沒選自訂色＝不再重寫 draft.json。 */
  try {
    const dPath = path.join(runDir, "draft.json");
    const dj = JSON.parse(fs.readFileSync(dPath, "utf8"));
    /* 建置流程即選的自訂品牌色（2026-07-26 使用者需求：一開始就能設）：覆寫 curate 的 auto hue，保留其餘 theme 欄位。
       色碼合法才套；可讀性把關（2026-08-27 擋色制）＝表單端 /api/theme-check 同尺前置擋＋橋接端（curate_auto
       bridgeThemeForV2）擋級不過自動用通過版兜底——舊註解「前端 assessSeedColor 擋過」不實（那把尺只擋格式與極淺色＝薄荷綠漏網口）。 */
    if (input.themeColor && /^#?[0-9a-fA-F]{6}$/.test(String(input.themeColor).replace("#", ""))) {
      const hex = input.themeColor[0] === "#" ? input.themeColor : "#" + input.themeColor;
      const mode = input.themeMode === "dark" ? "dark" : "light";
      dj.page.theme = { ...(dj.page.theme || {}), hueFamily: "custom", colorTheme: `custom-${mode}`, surfaceMode: mode, customColor: hex };
      fs.writeFileSync(dPath, JSON.stringify(dj, null, 1));
      appendLog(id, `自訂主題色寫入：${hex}（${mode}）＝建置流程選定，覆寫 auto 配色`);
    }
  } catch (e) { appendLog(id, "自訂主題色寫入略過：" + errText(e)); }
  /* 版式與提案包寫入（51 號 W1-C，2026-08-24）：page.kvVariant 裸值（值已在建立端點過值域驗證）＋
     meta.layoutChoice 理由行履歷（by=ai|manual|pack；C3c）＋meta.proposalPack（W1-D 組合面板接手背景/主題/字體/動畫）。
     建立期寫入＝草稿誕生、當下無核可可失效（沿 curate-initial 語意；draft-writers.allow CREATE 節登錄）。
     引擎誠實條款（C3d）：layoutChoice.engineNote 由解析端寫入——W1-B 樣稿引擎落地前 layout-* 一律帶
     「新版式樣稿引擎建置中、預覽暫以現行版型呈現」，前端建立完成畫面與編修頁常駐顯示，不准靜默裝懂。
     失敗要出聲（2026-08-24 review 中3 修）：寫入獨立 try——失敗＝meta.layoutChoiceWriteError、
     status／列表回應轉 layoutChoiceError 白話警告（前端建立完成畫面黃字＋編修頁黃條）。
     原版把它併在 refreshPolicy 的 catch 裡只記 log＋meta 零讀取點＝畫面照樣稱成功。 */
  if (input.kvVariant && input.layoutChoice) {
    try {
      layoutLib.writeLayoutChoiceIntoDraft(path.join(runDir, "draft.json"), input);
      appendLog(id, `版式選定：kvVariant=${input.kvVariant}（${input.layoutChoice.by}）——${input.layoutChoice.reason}${input.layoutChoice.engineNote ? "｜" + input.layoutChoice.engineNote : ""}`);
    } catch (e) {
      appendLog(id, "版式選擇寫入失敗：" + errText(e));
      writeMeta(id, { layoutChoiceWriteError: errText(e) });
    }
    /* 建立時貼包＝收尾整組落地（2026-08-30 根治二之二）：原設計「表單誠實只落版式、背景/主題/配色等
       編修頁接手」＝使用者建立貼包後看到預設背景，以為包沒生效。組合面板（W1-D）已完工——沿編修頁
       同一寫入口 packToChange→writeComboIntoDraft（單一實作不二寫），背景/主題/配色草案收尾一次落地；
       也一併治好「AI 收尾重寫 draft、蓋掉策展中手動組合」的競態（收尾以建立的包為準重申）。
       失敗照 layoutChoiceWriteError 模式出聲不吞。 */
    if (input.proposalPack) {
      try {
        const depsP = layoutLib.loadLayoutDeps();
        const prP = heroCombo.packToChange(JSON.stringify(input.proposalPack), depsP.registries);
        if (!prP.ok) throw new Error(prP.errors.join("；"));
        const rP = heroCombo.writeComboIntoDraft(path.join(runDir, "draft.json"), prP.change, depsP);
        if (!rP.changed && rP.info && rP.info.blocked) {
          /* 2026-09-07 使用者病例（run 135602）：擋色制把整包擋下（標題色壓自帶照片對比 3.59:1）＝什麼都沒落地，
             這裡原本只看 changed＝false 就記「與現值一致（免改）」＝擋下的理由被吞、建立完成畫面與編修頁零提示，
             設計師以為「包沒生效」。改＝擋下＝記白話理由＋走 layoutChoiceWriteError 同一條黃條路出聲。 */
          let whyP = (rP.info.notes || []).filter(Boolean).join("；") || "提案包的配色沒通過可讀性檢查，背景／主題／字風都沒有帶入";
          /* 建立畫面沒有「修正版」按鈕（那顆在編修頁的版型與配色面板，index.html comboBlocked.fixedColors）——有修正版就指路過去，不讓人回工具重做一輪 */
          if (rP.info.blocked.fixedColors) whyP += "（怎麼接受修正版：進編修頁左欄「版型與配色」，把同一份提案包再貼一次，會出現「只調不及格字色」的按鈕）";
          appendLog(id, "建立提案包整組落地被擋（版式已保存；背景／主題／字風都沒落地）：" + whyP);
          writeMeta(id, { layoutChoiceWriteError: whyP, layoutChoiceWriteKind: "pack-blocked" }); /* 2026-09-08 病例（run 150043）：擋色理由套進「版式沒存進去、請重選版式重建」的包裝＝錯指路（版式明明存了）；kind 讓黃條講對的話 */
        } else {
          appendLog(id, `建立提案包整組落地：${rP.changed ? rP.info.summary : "與現值一致（免改）"}${rP.backup ? `（備份 ${rP.backup}）` : ""}`);
        }
      } catch (e) {
        appendLog(id, "建立提案包整組落地失敗（版式已保存；背景/主題可到編修頁重貼提案包）：" + errText(e));
        writeMeta(id, { layoutChoiceWriteError: errText(e) });
      }
    }
  }
  /* v2 主題橋接（2026-08-26 病例 214311 根治：建立選的色到不了新版型）：新版式（layout-*）殼只吃
     page.themeId（token 十主題）／page.colors.themeDraft（自訂盤），看不見 legacy theme.colorTheme——
     建立所選的色在此落新欄位（自訂 hex＝deriveThemeDraft 單一真源；hue 家族＝token slug 或家族代表色）。
     必須排在版式寫入之後（橋接看 page.kvVariant 分流）；legacy/new 頁＝橋接內部 no-op（colorTheme 照舊、
     檔案不動＝零波及）。失敗要出聲＝獨立 try＋meta.themeBridgeError（沿 layoutChoiceWriteError 模式）；
     配色缺席只影響外觀不擋建立——編修頁組合面板可重選主題/自訂色。 */
  try {
    const br = curateBridge.bridgeThemeForV2IntoDraft(path.join(runDir, "draft.json"),
      () => layoutLib.loadLayoutDeps().registries.themeIds); // 惰性讀簿：只有 hue 家族路需要值域；讀不到＝throw 不靜默降級
    if (br.applied) appendLog(id, `v2 主題橋接：${br.note}`);
    else if (br.mode === "unknown-hue") appendLog(id, `⚠ v2 主題橋接未套用：${br.note}`);
  } catch (e) {
    appendLog(id, "⚠ v2 主題橋接失敗（新版式暫以預設主題渲染；可到編修頁組合面板重選主題或自訂色）：" + errText(e));
    writeMeta(id, { themeBridgeError: errText(e) });
  }
  /* 活動策略檔套用（71 號／2026-09-11 裁決牆）：排在策展、版式、主題之後，檢查之前——
     ①策展先跑完才有樓層可以對得上 ②排在檢查之前＝策略檔寫進去的文字照樣過既有 26 項把關，
     不因為「是人寫的」就少一道。只動主標與樓層標題，真值一根寒毛都不碰（lib 內第二道防線）。
     失敗要出聲但不擋建立（沿主題橋接同款處理）：頁面照樣建得出來，只是文案回機械預設。 */
  if (input.briefFile) {
    try {
      const bf = briefResolve(String(input.briefFile));
      if (!bf || !/\.md$/.test(bf)) throw new Error(`策略檔路徑不在 briefs 資料夾內：${input.briefFile}`);
      const parsed = briefLib.parseBrief(fs.readFileSync(bf, "utf8"));
      if (!parsed.ok) throw new Error("策略檔沒通過檢查：" + parsed.errors.map((e) => e.say).join("；"));
      const dPathB = path.join(runDir, "draft.json");
      const dj = JSON.parse(fs.readFileSync(dPathB, "utf8"));
      /* 階段一接線（71 號方案 A，2026-09-14）：對不對得上要拿「商品池」比（snapshot），不是拿已經挑過的商品比——挑過的會偏；
         門檻沿 CP-14 同一份校準檔（run 級 feedback_patch.json themeFitRule.threshold，沒有＝lib 預設 0.3） */
      let poolNames = [], fitThreshold;
      try { poolNames = (JSON.parse(fs.readFileSync(path.join(runDir, "snapshot.json"), "utf8")).products || []).map((p) => (p && p.name) || "").filter(Boolean); } catch (e) { appendLog(id, "策略檔對不對得上：讀不到商品池名單，這次不比（" + errText(e) + "）"); }
      try { const t = JSON.parse(fs.readFileSync(path.join(runDir, "feedback_patch.json"), "utf8")).themeFitRule.threshold; if (Number.isFinite(t)) fitThreshold = t; } catch (e) { /* 沒校準檔＝lib 預設門檻 */ }
      const ap = briefLib.applyBriefToDraft(dj, parsed, { file: String(input.briefFile), productNames: poolNames, fitThreshold });
      fs.writeFileSync(dPathB, JSON.stringify(dj, null, 2)); // meta.brief（選品帳折句＋對不對得上）不論有沒有改到文案都要落檔
      if (ap.changed) {
        appendLog(id, `活動策略檔「${input.briefFile}」已套用：${ap.applied.join("、")}${ap.notes.length ? "；提醒 " + ap.notes.length + " 則" : ""}`);
      } else {
        appendLog(id, `活動策略檔「${input.briefFile}」沒有可套用的內容（主標、分層、選品都留白或沒對到）——文案與選品維持系統預設${ap.notes.length ? "；提醒 " + ap.notes.length + " 則" : ""}`);
      }
    } catch (e) {
      appendLog(id, "⚠ 活動策略檔沒有套用（文案維持系統預設，可到編修頁自己改）：" + errText(e));
      writeMeta(id, { briefApplyError: errText(e) });
    }
  }
  /* 建立期價格對真（丙-甲；2026-09-27 使用者裁）：來源活動頁的 SSR 只給網路價、沒給結帳級促銷價
     （run 142315 raw/act_750682.html：20 件 promotionPrice 全 null、整頁找不到 1085），快照照真值鐵律只能寫 1142；
     商品頁才顯示 1085。草稿一出生就拿商品頁現價對一次——同一條路＝productCheck 逐品實抓＋patchSnapshotPrice 快照稽核行
     （lib/price_truth.js applyPriceTruth 把同一個結果寫回草稿列），對不上的把快照與草稿一起改：機器稿、尚無人工編修＝系統對齊，
     不叫人按「一鍵套用」收尾；編修期「只標示不改價」（2026-07-27 方案A）不動。
     邊界：建立當下無核可、重做端點已先 invalidateApproval；離線＝不改＋出聲＋不擋建立；每一件改價都進 wb.log 與快照稽核行。
     排在策略檔套用之後、runGate 之前＝檢查看到的是對齊後的價。stage 值域（前端白名單 fetching/curating/curating_ai/gating）不加新字：
     進度用 meta.priceTruth 子狀態＋wb.log 出聲。
     CAMPAIGN_PRICE_TRUTH（測試／同事機用）＝off：關閉、出聲｜offline-stub：測試樁、當作全部連不上｜report:<檔>：測試樁、拿檔內 results 當實抓結果（不觸網）。 */
  {
    const dPathP = path.join(runDir, "draft.json"), snapPathP = path.join(runDir, "snapshot.json");
    const modeP = String(process.env.CAMPAIGN_PRICE_TRUTH || "");
    if (modeP === "off") {
      appendLog(id, "建立期價格對真：已關閉（CAMPAIGN_PRICE_TRUTH=off），發佈前檢查會驗價格");
    } else {
      try {
        const { applyPriceTruth } = require(path.join(PIPE, "lib", "price_truth.js"));
        const productsP = (() => { try { return JSON.parse(fs.readFileSync(dPathP, "utf8")).products || []; } catch (e) { return []; } })();
        /* 種子（提速 A，2026-10-05 使用者裁 A＋B＋C）：清單逐品實抓幾分鐘前剛問過同一批商品頁（同一支探測器、
           同一次建置）＝新鮮度窗內直接用、同一頁不付兩次網路錢。窗＝10 分鐘（同一次建置內必然遠小於此；
           過窗或缺檔＝整份不用、照舊現抓，慢但不錯）。只有建立期走種子；「重新檢查」那條路不傳 seed。 */
        const SEED_FRESH_MS = 10 * 60 * 1000;
        const seedP = (() => {
          try {
            const sj = JSON.parse(fs.readFileSync(path.join(runDir, "price_truth_seed.json"), "utf8"));
            const age = Date.now() - new Date(sj.fetchedAt).getTime();
            if (!(age >= 0 && age <= SEED_FRESH_MS)) return null;
            return { rows: sj.rows || {}, ageSec: Math.round(age / 1000) };
          } catch (e) { return null; }
        })();
        const seededN = seedP ? productsP.filter((pp) => pp && seedP.rows[String(pp.gdid)]).length : 0;
        const unseededN = productsP.length - seededN;
        writeMeta(id, { priceTruth: { stage: "running", startedAt: new Date().toISOString(), total: productsP.length, done: 0, seeded: seededN, mode: modeP || "live" } });
        /* 估時照實測（提速 C）：並行池約 0.27 秒/件、串行回退約 1.05 秒/件（2026-10-05 run 135630 實測 64.9s/63 件校正；原 ×0.65 少報四成） */
        const perItemP = String(process.env.CAMPAIGN_FETCH_POOL || "") === "off" ? 1.05 : 0.27;
        appendLog(id, `對商品頁價格中：${productsP.length} 件${seededN ? `（${seededN} 件建立時剛抓過＝直接用，實際要抓 ${unseededN} 件）` : ""}、約 ${Math.max(1, Math.ceil(unseededN * perItemP))} 秒`);
        let pcP;
        if (modeP === "offline-stub") pcP = { checkedAt: new Date().toISOString(), results: productsP.map((p) => ({ gdid: String(p.gdid), status: "unverified", note: "測試樁：離線" })) };
        else if (modeP.startsWith("report:")) pcP = JSON.parse(fs.readFileSync(modeP.slice("report:".length), "utf8"));
        else {
          /* 連線探針（主線 review 補，2026-09-27）：productCheck 是逐品串行、每件 fetch 逾時 30 秒＋重試一次——網路「掛著不回」（不是 DNS 失敗）時
             63 件最壞等一小時，建立會像卡死。先拿第一件商品頁探 6 秒：連不上＝整批當離線（不改、出聲、不擋），不逐件耗逾時。DNS 直接失敗本來就快，探針只多 6 秒上限。 */
          const probeUrl = unseededN > 0 ? productsP.find((pp) => pp && /^https?:\/\//.test(String(pp.url || "")) && (!seedP || !seedP.rows[String(pp.gdid)])) : null; /* 全部有種子＝零網路、免探針 */
          let probeOk = true;
          if (probeUrl) {
            probeOk = await Promise.race([fetchPage(probeUrl.url).then(() => true, () => false), new Promise((r) => setTimeout(() => r(false), 6000))]);
          }
          if (probeOk) pcP = await productCheck(id, runDir, { seed: seedP && seedP.rows, onProgress: (dN, tN) => { const mNow = (readMeta(id) || {}).priceTruth || {}; writeMeta(id, { priceTruth: { ...mNow, done: dN, total: tN } }); } });
          else { appendLog(id, "⚠ 建立期價格對真：6 秒內連不上商品頁，這批價格先不對（發佈前檢查會再驗）"); pcP = { checkedAt: new Date().toISOString(), results: productsP.map((p) => ({ gdid: String(p.gdid), status: "unverified", note: "連線探針：6 秒內連不上商品頁" })) }; }
        }
        const snapP = JSON.parse(fs.readFileSync(snapPathP, "utf8"));
        const djP = JSON.parse(fs.readFileSync(dPathP, "utf8"));
        const rP = applyPriceTruth({ snap: snapP, draft: djP, rows: pcP.results, checkedAt: pcP.checkedAt, patchSnapshotPrice });
        if (rP.applied.length) {
          fs.writeFileSync(snapPathP, JSON.stringify(snapP, null, 1));
          fs.writeFileSync(dPathP, JSON.stringify(djP, null, 1));
          for (const a of rP.applied) {
            patchProductCheckFile(runDir, a.gdid, (r0) => { r0.draftPrice = a.to.price; r0.drift = false; r0.marketDrift = false; delete r0.draftMarketPrice; r0.snapPrice = a.to.price; r0.snapDrift = false; });
            appendLog(id, `價格改用商品頁現價：gdid ${a.gdid} $${a.from.price}→$${a.to.price}${a.to.marketPrice ? `、原價 ${a.to.marketPrice}` : a.from.marketPrice ? "、原價移除" : ""}`);
          }
          appendLog(id, `建立期價格對真：${rP.applied.length} 件改用商品頁現價，來源紀錄與草稿已同步（來源活動頁沒給促銷價）`);
        } else if (rP.offline) {
          appendLog(id, `⚠ 建立期價格對真：${rP.checked} 件都沒能連上商品頁，價格沒動。發佈前檢查會再驗`);
        } else {
          appendLog(id, `建立期價格對真：${rP.checked} 件與商品頁一致`);
        }
        if (rP.unverified && !rP.offline) appendLog(id, `⚠ 建立期價格對真：${rP.unverified} 件沒能連上商品頁，價格沒動。發佈前檢查會再驗`);
        if (rP.skippedNotInPool.length) appendLog(id, `⚠ 建立期價格對真：${rP.skippedNotInPool.length} 件不在來源紀錄裡、沒改（gdid ${rP.skippedNotInPool.join("、")}）`);
        if (rP.skippedNotInDraft.length) appendLog(id, `建立期價格對真：${rP.skippedNotInDraft.length} 件不在草稿上、沒動（報告多給的列）`);
        const startedP = ((readMeta(id) || {}).priceTruth || {}).startedAt;
        writeMeta(id, { priceTruth: { stage: "done", startedAt: startedP, finishedAt: new Date().toISOString(), total: rP.checked, applied: rP.applied.length, unverified: rP.unverified, offline: rP.offline, mode: modeP || "live" } });
      } catch (e) {
        appendLog(id, "⚠ 建立期價格對真沒有跑成，價格沒動。發佈前檢查會再驗（技術：" + e.message + "）");
        writeMeta(id, { priceTruth: { stage: "error", error: e.message, finishedAt: new Date().toISOString() }, priceTruthError: e.message });
      }
    }
  }
}

async function createRun(input) {
  /* run id 配號改走 allocRunId（2026-08-31 使用者裁決修同秒相撞）：原「時分秒 id＋recursive mkdir」
     同秒多筆共用資料夾互相覆寫且不出聲（實證＝2026-08-31-wb-085542 三檔互撞）——讓位尾綴＋佔位一體，細節見 run_id.js。 */
  const { id, runDir, yielded } = allocRunId(RUNS, new Date());
  writeMeta(id, { id, stage: "fetching", input, engine: input.engine || "auto", createdAt: new Date().toISOString() });
  appendLog(id, `建立策展批次：${JSON.stringify(input)}`);
  if (yielded) appendLog(id, `同秒讓位：本批與另一筆建檔撞同一秒，id 已自動配流水尾綴（原病＝同秒共用資料夾互相覆寫，2026-08-31 修）`);

  (async () => {
    const c1 = await runNode(id, path.join(PIPE, "fetch_parse.js"), [input.url, runDir]);
    if (c1 !== 0 || !fs.existsSync(path.join(runDir, "snapshot.json"))) { writeMeta(id, { stage: "error", error: "讀取來源頁沒有成功——請確認網址能在瀏覽器打開，或改貼品牌頁／活動賣場的網址再試一次" }); return; }
    writeMeta(id, { stage: input.engine === "ai" ? "curating_ai" : "curating" });

    if (input.engine === "ai") {
      const tpl = fs.readFileSync(path.join(__dirname, "curate_prompt.md"), "utf8");
      const prompt = tpl
        .replaceAll("{RUN_DIR}", runDir)
        .replaceAll("{SCENARIO}", input.scenario || "（未指定＝T1，由 AI 依商品池判定）")
        .replaceAll("{THEME}", input.theme || "（未指定＝T1，由 AI 依商品池提案）")
        .replaceAll("{PIPE}", PIPE)
        .replaceAll("{DOC04}", path.join(PIPE, "..", "04_策展輸入與模組選用規則_v1.md"));
      // 引擎模型釘選（2026-08-27 使用者裁決 Q1，35 號 §2.1 分站配置表；補 28 號 C4 缺口）：
      // 原本不帶 --model＝落到各機 ~/.claude/settings.json 預設，換機或改預設就默默換腦、過閘率不可比。
      // 釘 claude-opus-5＝2026-07-22 A/B gate 全綠時的實際檔位（釘選只固定既成事實，不改已驗證行為）；
      // sonnet 同時長但 6 FAIL（超寬折數標籤/讓位序違反/發明 warm-light 主題值）＝不採。
      // Fable 5 不採：官方標示 latency 較慢，本站有 20 分鐘硬砍線（現況中位 9 分）＝逾時風險換不到已量測收益。
      // 覆寫序：input.model（顯式指定，A/B 用）> CAMPAIGN_CURATE_MODEL 環境變數 > 釘選預設。
      const CURATE_MODEL_DEFAULT = "claude-opus-5";
      const curateModel = input.model || process.env.CAMPAIGN_CURATE_MODEL || CURATE_MODEL_DEFAULT;
      const modelArgs = ["--model", curateModel];
      appendLog(id, `claude -p AI 策展啟動（模型 ${curateModel}${input.model ? "＝顯式指定" : process.env.CAMPAIGN_CURATE_MODEL ? "＝環境變數覆寫" : "＝釘選預設"}；Read/Write/Glob/Grep；--strict-mcp-config 跳過 MCP 載入；逾時 20 分鐘）`);
      /* 版式早戳章（2026-08-30 使用者報修「建置頁貼包卻套舊版」根治一之二）：原本版式要等 AI 全程收工
         才寫進 draft——AI 策展的幾分鐘到二十分鐘窗口裡，預覽草稿沒有版式欄＝一律渲染舊殼，使用者以為套錯版。
         改為輪詢：draft.json 一出生（AI 用 Write 產檔的當下）就冪等輕戳 kvVariant＋meta；AI 若中途重寫檔
         把章洗掉＝下一輪再戳。半寫入的暫時解析失敗＝下輪重試不吵（真失敗由收尾完整寫入出聲）。 */
      let earlyStamp = null;
      if (input.kvVariant && input.layoutChoice) {
        earlyStamp = setInterval(() => {
          try {
            const dpS = path.join(runDir, "draft.json");
            if (!fs.existsSync(dpS)) return;
            const djS = JSON.parse(fs.readFileSync(dpS, "utf8"));
            if (djS.page && djS.page.kvVariant === input.kvVariant) return;
            layoutLib.writeLayoutChoiceIntoDraft(dpS, input);
            appendLog(id, `版式早戳章：kvVariant=${input.kvVariant}（AI 策展進行中，預覽已可用正確版式）`);
          } catch (e) { /* draft 半寫入＝下輪再試；持久性失敗由收尾寫入走 layoutChoiceWriteError 出聲 */ }
        }, 4000);
      }
      const code = await new Promise((resolve) => {
        const ch = spawn("claude", ["-p", prompt, "--allowedTools", "Read,Write,Glob,Grep", "--permission-mode", "acceptEdits", "--strict-mcp-config", ...modelArgs],
          { cwd: runDir, stdio: ["ignore", "pipe", "pipe"] });
        const to = setTimeout(() => { ch.kill("SIGTERM"); appendLog(id, "AI 策展逾時（20 分鐘）已中止"); }, 20 * 60 * 1000);
        ch.stdout.on("data", (dd) => appendLog(id, "AI｜" + dd.toString().trimEnd()));
        ch.stderr.on("data", (dd) => appendLog(id, "AI ERR｜" + dd.toString().trimEnd()));
        ch.on("close", (c) => { clearTimeout(to); resolve(c); });
        ch.on("error", (e) => { clearTimeout(to); appendLog(id, "AI 策展啟動失敗（claude CLI）：" + errText(e)); resolve(-1); }); // spawn 失敗原本無人接＝close 永不觸發、stage 卡 curating_ai（220414 病例同形）
      });
      if (earlyStamp) clearInterval(earlyStamp);
      if (!fs.existsSync(path.join(runDir, "draft.json"))) {
        appendLog(id, `AI 策展未產出 draft.json（exit ${code}）→ 降級機械策展 v0`);
        const hcF = layoutLib.heroCountArgs(input.kvVariant); if (hcF.note) appendLog(id, hcF.note); // 乙（2026-09-27）：主打預留件數＝版式主視覺容量
        const cf = await runNode(id, path.join(__dirname, "curate_auto.js"), [runDir, "--scenario", input.scenario || "", "--theme", input.theme || "", ...briefArgs(input), ...hcF.args, ...ensureThemeFitPatch(id, runDir, input)]); // 策略檔也要帶（71 號階段二）：降級路的選品同樣要聽人話
        if (cf !== 0 || !fs.existsSync(path.join(runDir, "draft.json"))) { // 2026-07-22 修：降級也失敗＝明確標 error（原漏檢→曖昧顯示「未完成」）
          const lastErr = (() => { try { const t = fs.readFileSync(path.join(runDir, "wb.log"), "utf8").split("\n").filter(l => l.includes("策展中止") || l.includes("ERR")).pop(); return (t || "").replace(/^\[[^\]]+\]\s*(ERR\s*)?/, "").slice(0, 180); } catch (e) { return ""; } })();
          writeMeta(id, { stage: "error", error: lastErr || "AI 和快速草稿都沒能排出草稿（多半是這個來源的商品資料太少）——請改貼品牌頁或活動賣場的網址再試一次" });
          return;
        }
        writeMeta(id, { engineUsed: "auto（AI 降級）" });
      } else {
        const dPath = path.join(runDir, "draft.json"); // 2026-08-26 修（靜默失敗類）：原 const 宣告在下方 try 塊內＝moduleImages 清理段（塊外）拿不到、每跑必拋 ReferenceError 落自家 catch——興波案防呆 07-29 上線以來從未真跑（wb.log「覆寫欄清理略過…dPath is not defined」實證）；提升到分支作用域一次救活後續各後處理段
        try { // 值域正規化後處理（記 log 非靜默）：tagSource 同義筆誤 desc→feature（2026-07-22 定版驗證批 20 筆前例；內容不動、僅枚舉標籤）
          const dj = JSON.parse(fs.readFileSync(dPath, "utf8"));
          let fixed = 0;
          (dj.products || []).forEach((pr) => { if (pr && pr.tagSource === "desc") { pr.tagSource = "feature"; fixed++; } });
          /* 2026-07-23 真值收斂後處理 ×2（AI 已知失誤家族，雙層固化＝prompt 硬化＋本段；記 log 非靜默）：
             ①feature 標籤缺 tagOriginal——tag 逐字可溯源 desc 某行＝補原文鍵（不可溯源＝不補、交 gate 裁決）
             ②products[].url 與快照不符＝以快照真值覆寫（🔒 欄、AI 禁改） */
          let fixedTagOrig = 0, fixedUrl = 0, fixedTagW = 0, fixedMk = 0;
          try {
            const snapN = JSON.parse(fs.readFileSync(path.join(runDir, "snapshot.json"), "utf8"));
            const byG = new Map((snapN.products || []).map((p) => [String(p.gdid), p]));
            /* ③標籤機械寬度夾（2026-07-25 design QA）：AI 通道原僅有 prompt 散文「102px 內」約束＝無程式化量寬
               （「24-200mm高解析」104px 家族）——與 gate 同模型（空格 0.3/半形 0.55/全形 1、預算 102px@14px） */
            const TAG_EM = 102 / 14;
            const wEm = (s) => [...String(s)].reduce((a, c) => a + (c === " " ? 0.3 : c.charCodeAt(0) > 255 ? 1 : 0.55), 0);
            const cutEm = (s) => { let acc = 0, out = ""; for (const ch of String(s)) { acc += ch === " " ? 0.3 : ch.charCodeAt(0) > 255 ? 1 : 0.55; if (acc > TAG_EM) break; out += ch; } return out; };
            (dj.products || []).forEach((pr) => {
              if (!pr || !pr.gdid) return;
              const src = byG.get(String(pr.gdid));
              if (!src) return;
              if (pr.tagSource === "feature" && pr.tag && !pr.tagOriginal) {
                const line = (src.desc || []).find((ln) => ln && ln.includes(pr.tag));
                if (line) { pr.tagOriginal = line.trim(); fixedTagOrig++; }
              }
              if (pr.url && src.url && !sameProductUrl(pr.url, src.url)) { pr.url = src.url; fixedUrl++; } /* 等價兩式＝不算不符、不改稿（2026-10-04；真正不符仍以池為準覆寫） */
              { /* 原價真值收斂（2026-07-29 3M 案根治：AI 以 vendorMarketPrice 混填原價 ×27＝CP-02 全滅、使用者無從自解）
                   ——逐字對齊池 marketPrice（null 含）；廠商建議售價 vendorMarketPrice≠劃線價（07-27 裁決），機械強制不信任 AI 遵守 */
                const smMk = src.marketPrice == null ? null : src.marketPrice;
                const dmMk = pr.marketPrice == null ? null : pr.marketPrice;
                if (dmMk !== smMk) { if (smMk == null) delete pr.marketPrice; else pr.marketPrice = smMk; fixedMk++; }
              }
              if (pr.tag && wEm(pr.tag) > TAG_EM) {
                if (pr.tagSource === "offer") { // offer 不可裁切（殘缺價格宣稱）＝改走 desc 前綴（同機械引擎規則）
                  const line = ((src.desc || [])[0] || "").trim();
                  if (line) { pr.tagOriginal = line; pr.tag = cutEm(line); pr.tagSource = "feature"; fixedTagW++; }
                } else { pr.tag = cutEm(pr.tag); fixedTagW++; } // 前綴裁切＝仍為 tagOriginal 子串（可溯源不變）
              }
            });
          } catch (e) { appendLog(id, "真值收斂後處理略過：" + errText(e)); }
          if (fixed || fixedTagOrig || fixedUrl || fixedTagW || fixedMk) {
            fs.writeFileSync(dPath, JSON.stringify(dj, null, 1));
            const parts = [];
            if (fixed) parts.push(`tagSource desc→feature ×${fixed}`);
            if (fixedTagOrig) parts.push(`feature 標籤補 tagOriginal ×${fixedTagOrig}（tag＝desc 逐字可溯源）`);
            if (fixedUrl) parts.push(`products[].url 快照真值覆寫 ×${fixedUrl}`);
            if (fixedTagW) parts.push(`標籤寬度夾裁切 ×${fixedTagW}（gate 同模型 102px@14px）`);
            if (fixedMk) parts.push(`原價逐字收斂池值 ×${fixedMk}（vendorMarketPrice 混填防呆）`);
            appendLog(id, `後處理：${parts.join("；")}（值域/真值正規化）`);
          }
        } catch (e) { appendLog(id, "後處理略過（draft 解析失敗交 gate 裁決）：" + errText(e)); }
        /* 覆寫欄生成期防呆（2026-07-29 興波案根治）：策展階段 assets.moduleImages 全為機器寫入（人工覆寫只發生在編修期），
           曾實證 AI 把錯位預設圖登錄進覆寫通道→永久蓋住 e.img/kv.images 且編修無效。一律清空＝渲染回落資料層真相；
           編修期人工覆寫走 syncImgOverride 通道寫入，不受影響。 */
        try {
          const djMI = JSON.parse(fs.readFileSync(dPath, "utf8"));
          const mi0 = djMI.assets && djMI.assets.moduleImages;
          if (mi0 && Object.keys(mi0).length) {
            const nMI = Object.keys(mi0).length; djMI.assets.moduleImages = {};
            fs.writeFileSync(dPath, JSON.stringify(djMI, null, 1));
            appendLog(id, `後處理：assets.moduleImages 清機器預設 ×${nMI}（覆寫通道留給編修期人工；渲染回落 e.img/kv.images）`);
          }
        } catch (e) { appendLog(id, "覆寫欄清理略過（交 gate 裁決）：" + errText(e)); }
        /* 編輯精選圓 img 解析度守門（2026-08-26 80×80 病例根治；雙層固化家族＝prompt 慣例照舊＋本段機械複驗）：
           AI 引擎照 curate_prompt「img＝imgs[1]||imgs[0]」組圓、無從自驗圖寬——收尾以 HTTP 圖頭探測複驗，
           候選鏈同 curate_auto（imgs[1..]→退主圖；全不合格照實用主圖＋wb.log 出聲）＝img_probe 單一真源。 */
        try {
          const djC = JSON.parse(fs.readFileSync(dPath, "utf8"));
          const circlesC = ((djC.page || {}).editorial || {}).circles;
          if (Array.isArray(circlesC) && circlesC.length) {
            const snapC = JSON.parse(fs.readFileSync(path.join(runDir, "snapshot.json"), "utf8"));
            const byGC = new Map((snapC.products || []).map((p) => [String(p.gdid), p]));
            let changedC = 0;
            for (const c of circlesC) {
              const g = c && gdidOf(c.url || "");
              const src = g && byGC.get(String(g));
              if (!src || !(src.imgs && src.imgs[0])) continue; // 圓只存 url＝反解 gdid 對池；池外圓（不應發生）＝不動、交 gate CP-02 裁決
              const pickC = await imgProbe.pickCircleImg(src.imgs);
              pickC.notes.forEach((n) => appendLog(id, `編輯精選圓（gdid ${g}）：${n}`));
              if (pickC.img && c.img !== pickC.img) { c.img = pickC.img; changedC++; }
            }
            if (changedC) {
              fs.writeFileSync(dPath, JSON.stringify(djC, null, 1));
              appendLog(id, `後處理：編輯精選圓 img 解析度守門改圖 ×${changedC}（候選實測寬 ≥${imgProbe.CIRCLE_IMG_MIN_WIDTH}px；鏈＝imgs[1..]→主圖）`);
            }
          }
        } catch (e) { appendLog(id, "圓圖解析度守門略過（交 gate 裁決）：" + errText(e)); }
        writeMeta(id, { engineUsed: "ai" });
      }
    } else {
      const hc2 = layoutLib.heroCountArgs(input.kvVariant); if (hc2.note) appendLog(id, hc2.note); // 乙（2026-09-27）：主打預留件數＝版式主視覺容量（4 件槽版式不再吃到第 1 層情境卡）
      const c2 = await runNode(id, path.join(__dirname, "curate_auto.js"), [runDir, "--scenario", input.scenario || "", "--theme", input.theme || "", ...briefArgs(input), ...hc2.args, ...ensureThemeFitPatch(id, runDir, input)]); // 策略檔指導選品（71 號階段二，2026-09-14）：先讀策略檔、再分商品、標題照落（下方套用區）
      if (c2 !== 0) { writeMeta(id, { stage: "error", error: "沒能從這批商品排出草稿——請換一個商品更多的來源（品牌頁／活動賣場）再試一次" }); return; }
      writeMeta(id, { engineUsed: "auto" });
    }
    await finishDraftAfterCurate(id, runDir, input);
    writeMeta(id, { stage: "gating", sysDraftWriteAt: Date.now() }); // 系統最後改稿時刻：畫面在這之前載入的草稿不准存回（PRICE-TRUTH-STALE-PUT）
    await runGate(id, true); // 初判快檢＝跳過圖片 HTTP（正式送建置時走全檢）
    writeMeta(id, { stage: "ready" });
  })().catch((e) => { appendLog(id, "EXC " + errText(e)); writeMeta(id, { stage: "error", error: errText(e) }); });

  return id;
}

async function runGate(id, skipHttp) {
  const runDir = path.join(RUNS, id);
  return new Promise((resolve) => {
    const patch = path.join(runDir, "feedback_patch.json"); // U14 主題契合校準（存在即帶）
    const ch = spawn(process.execPath, [path.join(PIPE, "gate.js"), path.join(runDir, "snapshot.json"), path.join(runDir, "draft.json")],
      { cwd: PIPE, env: { ...process.env, ...(skipHttp ? { GATE_SKIP_HTTP: "1" } : {}), ...(fs.existsSync(patch) ? { GATE_THEME_FIT_PATCH: patch } : {}) } });
    const bufs = []; // 2026-07-23 修：同 readBody chunk 邊界問題（gate 輸出含中文報告字句）
    ch.stdout.on("data", (d) => bufs.push(d));
    ch.stderr.on("data", (d) => bufs.push(d));
    ch.on("close", (code) => {
      appendLog(id, `gate exit ${code}${skipHttp ? "（快檢：跳過圖片 HTTP）" : "（全檢）"}`);
      resolve({ exit: code, output: Buffer.concat(bufs).toString("utf8") });
    });
  });
}

/* ---------- 上線部署（POST /api/runs/:id/deploy 背景流程） ----------
   語意：把核可後的 draft 發佈到內網分享站（U26 資料曝險裁決＝未上線價格/檔期僅走受保護路徑；
   遷移 #5 起＝GHES Pages、Okta 內網門）；活動頁入口＝FrameTest ?draftUrl=../live-drafts/<id>.json（遷移 #4 改頁面相對路徑＝兩站通吃：絕對路徑 /live-drafts/… 在 GHE Pages 前綴 /pages/tofu/activity-share-site/ 下會斷鏈）。
   閘序＝部署 SOP（2026-07-29 F11 根治＝發佈移到兩閘之後：閘擋下時未過閘內容不落地部署目錄，
   杜絕後續任何全站部署把殘留檔搭便車帶上線——story docs/stories/deploy-gate-order.md）：
   ①本批 gate 全檢（FAIL＝中止）②站級兩閘 selftest＋price_qa（sync.sh 先行）③發佈 draft＋重出 batches 快照（兩閘全綠才寫入）④GHES Pages 部署（守門；2026-08-04 遷移 #5 起唯一主通道，Netlify 已退役刪站）。 */
const DEPLOY_SITE = path.join(PIPE, "..", "..", "2026-AI自動化活動頁生成規劃", "deploy-site");
const NETLIFY_SITE_ID = "7392e5fe-6051-4295-9313-85775a48566c"; // 已退役（遷移 #5：站已刪除）——留供歷史對照，勿再使用
const LIVE_BASE = "https://solid-pancake-38klg7k.pages.github.io"; // 遷移 #5（2026-08-04）：GHE 轉正＝唯一守門部署站；liveUrl＝內網確認頁（Okta 門）

/* 帳號解耦（2026-07-28）：netlify CLI「現用帳號」是全域可變狀態——他處 netlify login/switch 就被切走
   ＝部署停擺（07-27/07-28 兩度發生）。一律改用 CLI 設定檔內 tofu@yahooinc.com 的 token
   （NETLIFY_AUTH_TOKEN 環境變數優先於現用帳號）；每次呼叫現讀設定檔＝重新 login 後免重啟。
   ⚠ 遷移 #5（2026-08-04）退役：Netlify 站已刪、deployRun 改走 deploy-ghe-pages.sh——本函式已無活呼叫端
   （僅 publishPublic 退役死碼後方仍引用），與 workbench/netlify-auth.sh 同步保留為歷史參考。
   shell 端同邏輯＝workbench/netlify-auth.sh——修改判定規則時兩處要一起動。 */
const NETLIFY_DEPLOY_EMAIL = "tofu@yahooinc.com";
function netlifyAuthEnv(id) {
  // 出聲但不擋路：log 寫不進（run 目錄異常）退 console＝進 /tmp/wb-server.log，不讓日誌問題打斷部署
  const warn = (msg) => { try { appendLog(id, msg); } catch (e) { console.error(msg); } };
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(process.env.HOME || "", "Library/Preferences/netlify/config.json"), "utf8"));
    for (const u of Object.values(cfg.users || {})) {
      if (u && u.email === NETLIFY_DEPLOY_EMAIL && u.auth && u.auth.token) return { ...process.env, NETLIFY_AUTH_TOKEN: u.auth.token };
    }
    warn(`⚠ CLI 設定檔沒有 ${NETLIFY_DEPLOY_EMAIL} 的部署 token＝改以現用帳號嘗試（可能失敗）——SOP：netlify login --new 登入該帳號（不帶 --new 會被 Already logged in 擋住不進登入流程）`);
  } catch (e) {
    warn(`⚠ 讀取 netlify CLI 設定檔失敗（${errText(e)}）＝改以現用帳號嘗試（可能失敗）——非帳號問題，檢查 config.json 是否損壞/可讀`);
  }
  return null;
}
function sh(id, cmd, args, cwd, envExtra) {
  const base = (cmd === "netlify" && netlifyAuthEnv(id)) || process.env;
  const env = envExtra ? { ...base, ...envExtra } : base; // envExtra＝單次呼叫的額外環境變數（2026-09-16 起：部署鏈的在途改動宣告）
  return new Promise((resolve) => {
    const ch = spawn(cmd, args, { cwd, env });
    const bufs = []; // 2026-07-23 修：chunk 邊界 UTF-8 損毀防護（同 readBody）
    ch.stdout.on("data", (d) => bufs.push(d));
    ch.stderr.on("data", (d) => bufs.push(d));
    ch.on("close", (code) => resolve({ code, out: Buffer.concat(bufs).toString("utf8") }));
  });
}
const setDeploy = (id, patch) => { const m = readMeta(id) || {}; writeMeta(id, { deploy: { ...(m.deploy || {}), ...patch } }); };
/* 部署窗口寫入鎖（2026-07-25 design QA blocker 修）：五階段進行中若允許回存/核可/重組，
   ③發佈階段會把「未經本輪 gate 全檢的新版 draft」直接發佈＝合規閘被繞過——一律 409
   （2026-07-29 F11 移序後此鎖也是「晚複製＝①驗過的同一份位元組」的前提） */
const deployBusyStage = (id) => { const d = (readMeta(id) || {}).deploy; return d && d.stage && !["done", "error"].includes(d.stage) ? d.stage : null; };
/* 2026-07-25 工程 QA：匯出管線也是「gate 全檢→稍後讀 draft 組裝」的 TOCTOU 窗口，需與部署同級鎖＝
   匯出進行中禁一切內容寫入/部署，否則會打包出未經本次全檢的內容（同部署鎖的合規繞道類） */
const exportBusyStage = (id) => { const m = readMeta(id) || {}; for (const e of [m.exportZip, m.exportAem]) if (e && e.stage && !["done", "error"].includes(e.stage)) return e.stage; return null; }; // ZIP 與 AEM 兩種匯出共用同一把忙碌鎖（2026-09-10）
const busyLock = (id) => deployBusyStage(id) ? DEPLOY_LOCK_MSG : exportBusyStage(id) ? EXPORT_LOCK_MSG : null;
const DEPLOY_LOCK_MSG = "發佈內網預覽正在進行中——為確保發佈內容與合規檢查一致，發佈完成前暫停內容變更。請等發佈跑完（畫面上方會顯示結果）再操作"; /* 2026-09-11 A 案：原名「上線部署」 */
const EXPORT_LOCK_MSG = "AEM 網頁檔正在製作中——為確保做出來的檔與合規檢查一致，製作完成前暫停內容變更。請等這一輪跑完再操作"; /* 2026-09-11：ZIP 09-10 已退場、現役＝AEM 網頁檔；第 6 題乙＝使用者眼前的「匯出」一律改「製作」 */

async function deployRun(id, runDir) {
  /* 第 0 關（2026-07-22 使用者需求）：商品狀態檢查——下架/失效/價格漂移＝中止，回介面就地更替 */
  setDeploy(id, { stage: "product_check", startedAt: new Date().toISOString(), error: null });
  appendLog(id, "發佈內網預覽啟動：⓪ 商品狀態檢查（逐品實抓在售/價格）");
  const pc = await productCheck(id, runDir);
  const badLinks = (pc.links || []).filter(isLinkProblem).length; // 連結內容失效也擋上線（每列計 1、unverified 不算＝與前端 pcLinkBad 同口徑）
  const bad = pcBlockingCount(pc.summary, badLinks);
  if (bad > 0) {
    const parts = [];
    if (pc.summary.dead) parts.push(`連結失效 ×${pc.summary.dead}`);
    if (pc.summary.offline) parts.push(`已下架 ×${pc.summary.offline}`);
    if (pc.summary.drift) parts.push(`價格變動 ×${pc.summary.drift}`);
    if (pc.summary.snapMissing) parts.push(`不在來源清單 ×${pc.summary.snapMissing}`);
    if (pc.summary.unverified) parts.push(`連不上 Yahoo、沒能驗價 ×${pc.summary.unverified}`);
    if (badLinks) parts.push(`頁面連結內容失效 ×${badLinks}（延伸探索／編輯精選／本期活動）`);
    setDeploy(id, { stage: "error", error: `商品狀態檢查未過：${parts.join("、")}——開「發佈前檢查」清單，照每條的按鈕與指引處理後重試` });
    return;
  }
  setDeploy(id, { stage: "gate_full" });
  appendLog(id, "① gate 全檢（含圖片 HTTP）");
  const g = await runGate(id, false);
  if (g.exit !== 0) { setDeploy(id, { stage: "error", error: "合規檢查發現必修問題，已停止發佈（保護內網預覽頁）——請開「發佈前檢查」清單修正必修項目後再按一次「發佈內網預覽」" }); return; }

  setDeploy(id, { stage: "site_gates" });
  appendLog(id, "② 來源同步（sync.sh）＋站級兩閘：selftest＋price_qa（約 5~8 分鐘）");
  const sy = await sh(id, "/bin/zsh", [path.join(DEPLOY_SITE, "sync.sh")], DEPLOY_SITE); // 2026-07-22 補：FrameTest/文件來源修正納入部署（原缺＝來源改了站上不更新）
  if (sy.code !== 0) { setDeploy(id, { stage: "error", error: "發佈前的檔案同步沒有成功，已停止發佈——請再按一次「發佈內網預覽」重試；連續失敗請聯絡系統管理員（技術訊息已保存）" }); appendLog(id, sy.out.slice(-600)); return; }
  const st = await sh(id, process.execPath, [path.join(PIPE, "selftest_run.js"), path.join(DEPLOY_SITE, "lecreuset-frametest", "index.html")], PIPE);
  if (st.code !== 0) { setDeploy(id, { stage: "error", error: "整站自動測試沒有全部通過，已停止發佈（保護內網預覽頁）——請再按一次「發佈內網預覽」重試；連續失敗請聯絡系統管理員（技術訊息已保存）" }); appendLog(id, st.out.slice(-800)); return; }
  const pq = await sh(id, process.execPath, [path.join(PIPE, "price_qa.js"), path.join(DEPLOY_SITE, "lecreuset-frametest", "index.html"), "all"], PIPE);
  /* 示範資料的價格「只量不擋」（2026-09-30 使用者裁「乙」；比照 AEM 頁面上限那把尺 2026-09-17 起只量不擋）：
     本閘只讀 lecreuset-frametest/index.html＝五組示範資料（lecreuset/camping/keyboard/fashion/titanium），
     **不讀 live-drafts**＝與本批活動零交集。原本一紅就中止發佈，造成的是死鎖而非把關：
     ①擋住使用者的是他碰不到的別人的資料 ②訊息叫他去按「發佈前檢查→重新檢查」，而那顆鈕只跑本檔的
     productCheck＋gate（index.html runAllChecksUi），永遠清不掉這道紅 ③09-14 每日價格巡檢停排程後，
     示範資料漂移只增不減＝對所有活動、所有使用者永久紅。病例＝2026-09-30 wb-112554 發佈失敗（使用者鬼打牆）。
     本批活動的價格真值把關**不受影響、仍硬擋**：⓪ productCheck 逐品實抓 + ① gate 全檢 CP-02。
     降級≠吞錯（鐵律 3）：照樣跑、完整技術訊息照樣進 wb.log，筆數留在 deploy.siteDemoPriceDrift 讓我們自己看得見；
     修示範頁價格＝手動 zsh price_watch.sh。根治（示範資料不進上線與出貨那份）＝行事曆 DEMO-DATA-STRIP-ONLINE。 */
  {
    const n = ((pq.out.match(/｜DRIFT (\d+)｜/) || [])[1]) || null;
    if (pq.code !== 0) {
      appendLog(id, `⚠ 示範資料價格對不上 ${n === null ? "（筆數讀不出）" : n + " 件"}——只記錄不中止（2026-09-30 裁「乙」）。本批活動的價格把關走 ⓪ 商品狀態檢查＋① 合規全檢，不受影響；要修示範頁價格＝手動 zsh price_watch.sh`);
      appendLog(id, pq.out.slice(-800));
    }
    setDeploy(id, { siteDemoPriceDrift: pq.code === 0 ? 0 : (n === null ? -1 : Number(n)) });
  }

  /* ③ 發佈＝兩閘全綠之後才把 draft 落地部署目錄（2026-07-29 F11 根治）：原「先複製再過閘」＝閘擋下後
     live-drafts/<id>.json 已在本地部署目錄，之後任何全站 netlify deploy --dir . 都會把未過閘內容搭便車帶上線
     （2026-07-29 實證兩檔）。兩閘只讀 lecreuset-frametest/index.html、不讀 live-drafts/batches＝移序不縮小檢查面；
     draft 內容①gate 全檢已驗＋部署寫入鎖（busyLock）保證期間不可變＝晚複製位元組相同。 */
  setDeploy(id, { stage: "publish" });
  const liveDir = path.join(DEPLOY_SITE, "live-drafts");
  fs.mkdirSync(liveDir, { recursive: true });
  /* 核可狀態隨資料一起送出去（2026-09-14 三題牆第 1 題甲）：原本是純 copyFileSync＝拿到連結的人
     看不出這一版定了沒。改成蓋一枚「發佈當下核可了沒」的快照（draft 頂層新鍵 publish，內容一個字不動），
     前台沒核可時在頁頂亮一條橫幅。蓋不上＝出聲記一筆並照原樣送（前台對「沒有這一格」的處置是不亮，
     等於退回本功能上線前的行為，不會誤標已定稿的頁）。 */
  let draftRaw = fs.readFileSync(path.join(runDir, "draft.json"), "utf8");
  /* 背景的家甲案（2026-09-29 牆 2 乙＋第 1 題交辦；story hero-bg-own-where-images-live.md）：
     own 圖住 runs/<id>/hero-bg/、發佈的頁抓不到——把三張實檔複製進站（deploy-site/活動自備背景/<id>/，
     抄「活動版型待審背景」現成先例），live-drafts 裡的 files 改寫成頁面相對路徑（../活動自備背景/<id>/<檔>；
     指紋 ?v= 對路徑型網址照常有效＝換圖不吃快取）。路由層已驗過版權確認相符才走得到這裡；
     confirmed 欄同步以 wb_meta 真源投影（內網頁不掛浮水印）。缺檔＝硬擋出聲（不發沒背景的頁）。 */
  {
    let djD = null; try { djD = JSON.parse(draftRaw); } catch (e) { setDeploy(id, { stage: "error", error: "草稿讀不出來，已停止發佈——請再試一次（技術：draft.json 非 JSON）" }); appendLog(id, "DEPLOY draft 解析失敗：" + e.message); return; }
    if (djD && djD.page && heroBgLic.isOwnBg(djD.page)) {
      let fmapD; try { fmapD = heroBgOwn.resolveOwnFileMap(djD.page, runDir); } catch (e) { setDeploy(id, { stage: "error", error: String((e && e.message) || e) }); appendLog(id, "DEPLOY own 背景複製失敗：" + ((e && e.message) || e)); return; }
      const ownSiteDir = path.join(DEPLOY_SITE, "活動自備背景", id);
      fs.rmSync(ownSiteDir, { recursive: true, force: true }); fs.mkdirSync(ownSiteDir, { recursive: true });
      const filesD = { ...djD.page.heroBgOwn.files };
      for (const [slot, ent] of Object.entries(fmapD)) { fs.copyFileSync(ent.abs, path.join(ownSiteDir, ent.file)); filesD[slot] = `../活動自備背景/${id}/${ent.file}`; }
      const confDp = (readMeta(id) || {}).heroBgLicenseConfirm || null;
      const ownOut = { ...djD.page.heroBgOwn, files: filesD };
      if (heroBgLic.ownConfirmMatches(djD.page, confDp)) ownOut.confirmed = { at: confDp.at, by: confDp.by }; else delete ownOut.confirmed;
      djD.page = { ...djD.page, heroBgOwn: ownOut };
      draftRaw = JSON.stringify(djD, null, 1);
      appendLog(id, `你上傳的背景隨發佈進站 ${Object.keys(fmapD).length} 張 → deploy-site/活動自備背景/${id}/`);
    }
  }
  const stamp = stampDraftJson(draftRaw, readMeta(id) || {});
  if (!stamp.stamped) appendLog(id, `⚠ 核可狀態沒能寫進發佈的資料（${stamp.reason}）——頁面不會顯示「還沒定稿」橫幅，發連結時請自己講一聲`);
  fs.writeFileSync(path.join(liveDir, `${id}.json`), stamp.text);
  const liveUrl = `${LIVE_BASE}/lecreuset-frametest/?draftUrl=../live-drafts/${id}.json`; // 遷移 #4：draftUrl 頁面相對化（兩站通吃；白名單「無 scheme＝同站相對」路徑照過）
  // 2026-07-23 收斂會驗證修：liveUrl 移至 stage done 才寫（原於此提前寫入＝上傳/晉升失敗後 publish-public 守門會被空穴放行）
  appendLog(id, `③ 發佈 draft → live-drafts/${id}.json；重出 batches 快照`);
  const eb = await sh(id, process.execPath, [path.join(__dirname, "export_batches.js"), path.join(DEPLOY_SITE, "activity-creation", "batches.json")], PIPE);
  if (eb.code !== 0) appendLog(id, `⚠ batches 快照重出沒有成功（exit ${eb.code}）——本輪沿用 sync.sh 產出的較舊快照續跑上傳（batches.json 非活動頁內容、不擋上線）。技術訊息：${(eb.out || "").slice(-400)}`); // F11 相鄰觀察審查補：失敗要出聲（原退出碼未檢查＝靜默續跑）

  /* ④ 發佈到內網站（2026-09-21：目標從美國 GHES 改為台灣組織空間＝分享站認養案）
     失敗＝硬擋；腳本＝規劃/tools/publish-docs-site.sh（在途改動健檢→組裝 22 塊→死連結守門→push gh-pages→遠端 SHA 比對）。
     為什麼換：原本呼叫的 workbench/deploy-ghe-pages.sh 推的是 git.ouryahoo.com（美國帳號 2026-09-19 停權）＝
     這顆鈕從那天起按下去必定失敗。LIVE_BASE（給同事的預覽網址）9/18 就已經改成台灣，錯的只有「怎麼推上去」這一步。 */
  setDeploy(id, { stage: "upload" });
  appendLog(id, "④ GHES Pages 部署（內網分享站＝主通道，失敗即停）");
  /* 在途改動宣告（2026-09-16 DEPLOY-DIRTY-TREE-GUARD）：本流程只寫 live-drafts/<id>.json 與 activity-creation/batches.json＝
     宣告成本線範圍；範圍外的在途改動會被部署腳本列進本 run 的履歷＝留紀錄。

     **這顆鈕不擋（2026-09-16 使用者裁決，理由已更正）**：
     使用者問「如果我可以發佈、又有能力部署上線，要擋的原因是什麼？」——答不出來，所以不擋。
     ①按鈕的主人有權限、有能力，按下去的意思就是「現在發佈」；在一個有授權的人做份內事情前面放路障要有很強的理由。
     ②**搭便車的東西是 Claude 放的，不是他放的**——半成品躺在待發佈區是我們的作業狀態。
       正解是「不要把半成品留在那裡」（沒改完就先別同步、改完立刻推掉），不是叫使用者在按鈕前面處理我們的爛攤子。
     ③兩次病例（2026-09-14）**都發生在終端機部署**，按鈕這條路零案例。

     （原本寫的理由是「畫面上沒有認領的操作、擋了就是死路」——那不成立：唯一看得到這顆鈕的就是負責人本人，
      他那台機器有終端機，是最有能力處理的人。理由錯了會讓下一個人照錯的理由重新討論一次，故更正。）

     分界＝終端機跑的部署會擋（price_watch 與人工，走那條路的是 Claude，減速丘零成本）；按鈕只留紀錄。 */
  const gh = await sh(id, "/bin/zsh", [path.join(__dirname, "..", "..", "..", "2026-AI自動化活動頁生成規劃", "tools", "publish-docs-site.sh"), "CMS 發佈內網預覽"], DEPLOY_SITE, {
    DEPLOY_MINE: "live-drafts:activity-creation/batches.json:活動自備背景", /* 活動自備背景＝deployRun 剛寫的 own 圖（背景的家甲案 2026-09-29） */
    DEPLOY_CARRY: "CMS 發佈內網預覽（使用者按下發佈＝已授權本次發佈）",
  });
  if (gh.code !== 0) { setDeploy(id, { stage: "error", error: "發佈到分享站沒有成功，已停止——最常見原因是目前不在公司網路；連上公司網路後再按一次「發佈內網預覽」，連續失敗請聯絡系統管理員（技術訊息已保存）" }); appendLog(id, (gh.out || "").slice(-800)); return; }
  const shaM = (gh.out || "").match(/(?:已發佈|已上線|push 完成) ([0-9a-f]{8})/); // 已發佈＝publish-docs-site.sh 的字樣（2026-09-21 換鏈；舊字樣留著讀得懂歷史 log）
  const deployId = (shaM && shaM[1]) || "ghe";
  writeMeta(id, { liveUrl }); // 部署全過才落 liveUrl（每日巡檢與守門依據；:1855 只巡有 liveUrl 的 run）
  setDeploy(id, { stage: "done", deployId, liveUrl, gheDeploy: "ok", finishedAt: new Date().toISOString() });
  appendLog(id, `上線完成：${liveUrl}（GHE ${deployId}）`);
}

/* ---------- ZIP 匯出（2026-07-25 使用者五題裁決）：合規全檢 → 組裝獨立 HTML（資料內嵌、圖連 Yahoo 圖床）
   → 5 裝置工程自測 → 打包 ZIP（頁面乾淨、匯出資訊記 README）——交付使用者自行上傳 FTP/網站空間。
   守門＝已核可＋全檢綠（五題之二）；流程定位＝工作台預覽→內部上線（跨部門確認）→ZIP 交付（五題之五）。 ---------- */
const setExport = (id, patch) => { const m = readMeta(id) || {}; writeMeta(id, { exportZip: { ...(m.exportZip || {}), ...patch } }); };
async function exportZip(id, runDir) {
  /* 第⓪關（2026-07-27 QA #2）：與上線同一道商品狀態關——原匯出無此關＝舊核可 run 的錯誤劃線價/失效連結
     可原樣交付到消費者頁面（deploy 有擋、export 沒擋＝同一紅線兩出口一鬆一緊） */
  setExport(id, { stage: "product_check", startedAt: new Date().toISOString(), error: null, file: null });
  appendLog(id, "ZIP 匯出啟動：⓪ 商品狀態檢查（逐品實抓＋頁面連結內容；與上線同一關）");
  const pc0 = await productCheck(id, runDir);
  const badL0 = (pc0.links || []).filter(isLinkProblem).length;
  const bad0 = pcBlockingCount(pc0.summary, badL0);
  if (bad0 > 0) {
    setExport(id, { stage: "error", error: pcBlockMessage(pc0.summary, bad0, "匯出") });
    return;
  }
  setExport(id, { stage: "gate_full" });
  appendLog(id, "① 合規全檢");
  const g = await runGate(id, false);
  if (g.exit !== 0) { setExport(id, { stage: "error", error: "合規檢查發現必修問題，已停止匯出（把關交付品質）——請開「發佈前檢查」清單修正必修項目後再匯出" }); return; }
  setExport(id, { stage: "build" });
  appendLog(id, "② 組裝獨立 HTML（活動資料內嵌；圖片連 Yahoo 圖床）");
  const FRAME = path.join(DEPLOY_SITE, "lecreuset-frametest");
  const tpl = fs.readFileSync(path.join(FRAME, "index.html"), "utf8");
  const dj = JSON.parse(fs.readFileSync(path.join(runDir, "draft.json"), "utf8"));
  /* 活動資料放外掛 data.js（勿改為內嵌！）：大 JSON 內嵌 index.html 會污染工程自測的原始碼掃描
     （2026-07-25 實證＝datasets 1-4 各 4 FAIL；外部腳本內容不入 index.html 原始碼與 DOM textContent）。
     自測情境（hash 帶 test:1/dataset:、query 帶 dataset/draftUrl）＝注入讓路，避免蓋掉比對基準。 */
  /* 消費者版＝純活動展示頁：徹底隱藏所有內部原型鷹架（實驗面板/主題切換/示範資料集/草稿徽章/預覽浮水印/
     拖放覆層/自測結果）——2026-07-25 使用者指示「ZIP 是給消費者探索的完整活動頁，不是內部展示頁」。
     用 CSS !important 隱藏而非刪 DOM＝不破壞模板初始化 JS 對這些元素的引用。 */
  const inject = `<script src="data.js"></script>
<style>#exp-panel,#preview-watermark,#draft-badge,#dropzone,#selftest-results,.ep-head,.ep-body{display:none!important}</style>
<script>/* 匯出版啟動器（2026-07-25 ZIP 匯出裁決）：資料在 data.js（window.__WB_DRAFT__） */
(function(){var q=new URLSearchParams(location.search);var h=location.hash||"";
if(q.has("dataset")||q.has("draftUrl")||h.indexOf("test:1")>=0||h.indexOf("dataset:")>=0)return;
function clean(){["exp-panel","preview-watermark","draft-badge","dropzone"].forEach(function(id){var e=document.getElementById(id);if(e&&e.remove)e.remove();});}
function go(){try{loadDraftJson(window.__WB_DRAFT__,"");clean();setTimeout(clean,400);}catch(e){setTimeout(go,120);}}
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",go);else go();})();
</script>
</body>`;
  const bodyEnd = tpl.lastIndexOf("</body>");
  if (bodyEnd < 0) { setExport(id, { stage: "error", error: "匯出檔案組裝時發生問題，已停止匯出——請再試一次；連續失敗請聯絡系統管理員（技術訊息已保存）" }); return; }
  const html = tpl.slice(0, bodyEnd) + inject + tpl.slice(bodyEnd + "</body>".length);
  const expDir = path.join(runDir, "export");
  fs.rmSync(expDir, { recursive: true, force: true });
  fs.mkdirSync(path.join(expDir, "assets"), { recursive: true });
  fs.mkdirSync(path.join(expDir, "figma-assets"), { recursive: true });
  fs.writeFileSync(path.join(expDir, "index.html"), html);
  /* 你上傳的背景隨包（2026-09-29 牆 1 甲）：own 圖住 runs/<id>/hero-bg/、不在背景地圖——下面「隨包背景圖」那段抓不到它，
     原第七道門擋的就是這個「靜默無圖」。這裡把三張實檔複製進 zip 的 hero-bg/、data.js 的 files 改寫成相對路徑
     （路徑規則單一立法＝hero_bg_own.resolveOwnFileMap）；缺檔＝停止匯出出聲，不交付沒背景的包。 */
  if (heroBgLic.isOwnBg(dj.page)) {
    try {
      const fmap = heroBgOwn.resolveOwnFileMap(dj.page, runDir);
      fs.mkdirSync(path.join(expDir, "hero-bg"), { recursive: true });
      const ownFiles = { ...dj.page.heroBgOwn.files };
      for (const [slot, ent] of Object.entries(fmap)) { fs.copyFileSync(ent.abs, path.join(expDir, "hero-bg", ent.file)); ownFiles[slot] = `hero-bg/${ent.file}`; }
      dj.page = { ...dj.page, heroBgOwn: { ...dj.page.heroBgOwn, files: ownFiles } };
      appendLog(id, `隨包你上傳的背景 ${Object.keys(fmap).length} 張 → hero-bg/`);
    } catch (e) { setExport(id, { stage: "error", error: String((e && e.message) || e) }); appendLog(id, "EXPORT own 背景隨包失敗：" + ((e && e.message) || e)); return; }
  }
  fs.writeFileSync(path.join(expDir, "data.js"), `window.__WB_DRAFT__=${JSON.stringify(dj)};`);
  for (const [sub, f] of [["assets", "lecreuset-hero-source.jpg"], ["figma-assets", "yahoo-shopping-logo-hrz-white.svg"]]) {
    try { fs.copyFileSync(path.join(FRAME, sub, f), path.join(expDir, sub, f)); } catch (e) { appendLog(id, `匯出資產缺漏（${sub}/${f}）：` + errText(e)); }
  }
  /* B11（W1-E 匯出實測紅燈）：新版式（layout-*）殼靠 tokens.css 上色，applyHeroShell 首選同層路徑——
     匯出包必須隨帶，複製不到＝停止匯出出聲（缺色票的殘包不交付）；現行版型不帶（legacy/new 永不載入）。 */
  if (/^layout-\d{3}$/.test(String((dj.page || {}).kvVariant || ""))) {
    const tokensSrc = path.join(DEPLOY_SITE, "..", "..", "design-tokens", "tokens.css"); // 真源＝專案根 design-tokens（34 號中央廚房產物；FrameTest 源頭 fallback ../design-tokens 同指此處）
    try { fs.copyFileSync(tokensSrc, path.join(expDir, "tokens.css")); appendLog(id, "隨包 tokens.css（新版式色票）"); }
    catch (e) { setExport(id, { stage: "error", error: "新版式色票檔（tokens.css）複製失敗，已停止匯出——缺色票的頁面會沒有顏色，請聯絡系統管理員（技術訊息已保存）" }); appendLog(id, "EXPORT tokens.css 複製失敗：" + errText(e)); return; }
    /* 背景替換隨包（2026-08-25 背景下滲批＝預覽與出貨同一套）：bg-map.js＋此檔選用/預設背景圖檔。
       複製不到＝停止匯出出聲（沒背景的頁不交付）；bg-005 類純變數款＝無檔可帶、地圖照帶。 */
    try {
      const bgSrcDir = path.join(DEPLOY_SITE, "..", "assets", "hero-bg");
      const mapPath = path.join(bgSrcDir, "bg-map.js");
      fs.mkdirSync(path.join(expDir, "assets", "hero-bg"), { recursive: true });
      fs.copyFileSync(mapPath, path.join(expDir, "assets", "hero-bg", "bg-map.js"));
      const bgMap = JSON.parse(fs.readFileSync(mapPath, "utf8").replace(/^[\s\S]*?window\.__BG_MAP__ = /, "").replace(/;\s*$/, ""));
      let bgId = dj.page.backgroundId;
      if (!bgId) { try { const rec = layoutLib.loadLayoutDeps().registries.layoutRecords.get(dj.page.kvVariant); bgId = rec && rec.defaultBackground; } catch (e) { appendLog(id, "匯出背景預設解析失敗（照地圖略過）：" + errText(e)); } }
      const ent = bgId && bgMap[bgId];
      if (ent && ent.file) { fs.copyFileSync(path.join(DEPLOY_SITE, "..", ent.file), path.join(expDir, ent.file)); appendLog(id, `隨包背景圖 ${bgId}`); }
    } catch (e) { setExport(id, { stage: "error", error: "新版式背景素材隨包失敗，已停止匯出——缺背景的頁不交付，請聯絡系統管理員（技術訊息已保存）" }); appendLog(id, "EXPORT 背景隨包失敗：" + errText(e)); return; }
  }
  const now = new Date().toISOString();
  fs.writeFileSync(path.join(expDir, "README.txt"),
`活動頁匯出包
====================
活動名稱：${dj.page.pageName || id}
來源活動編號：${id}
匯出時間：${now}
合規檢查：全檢通過（gate v14）
跨裝置測試：5 種裝置自動測試通過

上傳說明
--------
1. 解壓縮後，把整個資料夾內容上傳到你的網站空間（FTP 等），保持資料夾結構不變。
2. 入口檔案是 index.html；活動內容資料在 data.js（兩檔必須放同一目錄）。
3. 商品圖片連向 Yahoo 圖床（s.yimg.com）＝永遠顯示商品頁最新圖；放置的網站需可外連。
4. 商品連結全部指向 tw.buy.yahoo.com 商品頁，可正常導購。
5. 內容有修改時請回 CMS 重新匯出一份（本包是匯出當下的版本快照）。
`);
  setExport(id, { stage: "selftest" });
  appendLog(id, "③ 跨裝置渲染驗證（桌機/平板/手機）＝跑在匯出成品上");
  const st = await sh(id, process.execPath, [path.join(PIPE, "export_verify.js"), path.join(expDir, "index.html"), dj.page.pageName || id], PIPE);
  if (st.code !== 0) { setExport(id, { stage: "error", error: "跨裝置顯示檢查沒有通過（匯出的成品沒能正確顯示活動內容），已停止匯出——請再試一次；連續失敗請聯絡系統管理員（技術訊息已保存）" }); appendLog(id, st.out.slice(-800)); return; }
  setExport(id, { stage: "zip" });
  appendLog(id, "④ 打包 ZIP");
  const zipName = `activity-${id}.zip`;
  try { fs.rmSync(path.join(expDir, zipName), { force: true }); } catch (e) {}
  const zp = await sh(id, "/usr/bin/zip", ["-r", "-X", "-q", zipName, "index.html", "data.js", "README.txt", "assets", "figma-assets"], expDir);
  if (zp.code !== 0 || !fs.existsSync(path.join(expDir, zipName))) { setExport(id, { stage: "error", error: "打包壓縮檔沒有成功——請再試一次；連續失敗請聯絡系統管理員（技術訊息已保存）" }); appendLog(id, zp.out.slice(-400)); return; }
  setExport(id, { stage: "done", file: zipName, finishedAt: new Date().toISOString() });
  appendLog(id, `ZIP 匯出完成：export/${zipName}（${Math.round(fs.statSync(path.join(expDir, zipName)).size / 1024)} KB）`);
}

/* ---------- AEM 網頁檔製作（69 號 Phase 2，2026-09-10 團隊反饋批「HTML 太重、只留這頁需要的」）
   2026-09-11 第 6 題乙：使用者眼前的字一律「製作／下載」，資料鍵 exportAem 與內部代號不動。
   單一 HTML、素材全內嵌、只裝這頁用到的版型／字風／背景／程式（lib/aem_export.js）；交同事上傳 Adobe Experience Manager（消費者終點、頁面最多活兩週）。
   閘序＝⓪商品狀態 ①合規全檢（與上線／ZIP 同一關）②組裝瘦身版＋未瘦身參照版 ③aem_verify 對板（三裝置含觸控：零錯誤／單檔自足／不溢出／DOM 與參照版一致／像素差 <0.1%）
   ——對板沒過的檔不交付（瘦身不能剝壞任何東西＝這道閘就是證明）。輸出 runs/<id>/export/aem/。 ---------- */
const setExportAem = (id, patch) => { const m = readMeta(id) || {}; writeMeta(id, { exportAem: { ...(m.exportAem || {}), ...patch } }); };
async function exportAem(id, runDir) {
  setExportAem(id, { stage: "product_check", startedAt: new Date().toISOString(), error: null, file: null, bytes: null });
  appendLog(id, "AEM 網頁檔製作啟動：⓪ 商品狀態檢查（逐品實抓＋頁面連結內容；與上線同一關）");
  const pc0 = await productCheck(id, runDir);
  const badL0 = (pc0.links || []).filter(isLinkProblem).length;
  const bad0 = pcBlockingCount(pc0.summary, badL0);
  if (bad0 > 0) { setExportAem(id, { stage: "error", error: pcBlockMessage(pc0.summary, bad0, "製作") }); return; }
  setExportAem(id, { stage: "gate_full" });
  appendLog(id, "① 合規全檢");
  const g = await runGate(id, false);
  if (g.exit !== 0) { setExportAem(id, { stage: "error", error: "合規檢查發現必修問題，已停止製作（把關交付品質）——請開「發佈前檢查」清單修正必修項目後再製作" }); return; }
  setExportAem(id, { stage: "build" });
  appendLog(id, "② 組裝單一 HTML（只裝這頁用到的版型／字風／背景；素材內嵌；剝內部說明與工具程式）");
  const aem = require("../lib/aem_export");
  const FRAME = path.join(DEPLOY_SITE, "lecreuset-frametest");
  const outDir = path.join(runDir, "export", "aem");
  let dj, slimPath, fullPath, layout, report;
  try {
    const tpl = fs.readFileSync(path.join(FRAME, "index.html"), "utf8");
    dj = JSON.parse(fs.readFileSync(path.join(runDir, "draft.json"), "utf8"));
    layout = String((dj.page || {}).kvVariant || "").trim();
    let defaultBackground = null;
    try { const rec = layoutLib.loadLayoutDeps().registries.layoutRecords.get(layout); defaultBackground = rec && rec.defaultBackground; } catch (e) { appendLog(id, "AEM 製作：版型預設背景解析失敗（照背景地圖預設表）：" + errText(e)); }
    const deps = aem.loadDeps({ frameDir: FRAME, projectRoot: path.join(DEPLOY_SITE, "..", ".."), defaultBackground });
    const holdOpts = { confirm: (readMeta(id) || {}).heroBgLicenseConfirm || null }; /* 78 號 §六：出 AEM 的確認真源＝wb_meta.heroBgLicenseConfirm（sha 相符才算） */
    const slim = await aem.assembleAemHtml({ template: tpl, draft: dj, deps, mode: "slim", opts: { runDir, holdOpts } });
    const full = await aem.assembleAemHtml({ template: tpl, draft: dj, deps, mode: "full", opts: { runDir, holdOpts } });
    fs.rmSync(outDir, { recursive: true, force: true }); fs.mkdirSync(outDir, { recursive: true });
    const fileName = `activity-${id}.html`;
    slimPath = path.join(outDir, fileName); fullPath = path.join(outDir, "_reference-full.html");
    fs.writeFileSync(slimPath, slim.html); fs.writeFileSync(fullPath, full.html);
    report = slim.report;
    fs.writeFileSync(path.join(outDir, "aem-build-report.json"), JSON.stringify(report, null, 1));
    appendLog(id, `組裝完成：${fileName} ${Math.round(report.bytes / 1024)} KB（模板 ${Math.round(report.steps[0].bytes / 1024)} KB；舞台移除 ${(report.removedStages || []).length} 款、他款版型函式 ${(report.stubbedOtherLayoutFns || []).length} 支空殼、示範資料 ${(report.nulledConsts || []).length} 組置空）` + (report.warnings.length ? `；警告：${report.warnings.join("；")}` : ""));
    if (report.aemBudget) appendLog(id, `AEM 頁面編輯上限的尺（2026-09-17 起只量不擋）：編碎後 ${report.aemBudget.encoded}／上限 ${report.aemBudget.cap}＝${report.aemBudget.ratio} 倍${report.aemBudget.fits ? "（過）" : "（超標；貼進 AEM 頁面前需瘦身）"}`);
  } catch (e) {
    setExportAem(id, { stage: "error", error: /版權還在審核|沒有宣告新版型|尚未支援這款版型|這一版還不能製作 AEM 網頁檔|還沒確認版權|版權確認要重做一次|找不到，請重新上傳/.test(errText(e)) ? errText(e) : `網頁檔組裝時發生問題，已停止製作——請再試一次；連續失敗請聯絡系統管理員（技術訊息：${String(errText(e)).slice(0, 160)}）` });
    appendLog(id, "AEM EXPORT 組裝失敗：" + errText(e)); return;
  }
  setExportAem(id, { stage: "verify" });
  appendLog(id, "③ 對板檢查（三裝置含觸控：零錯誤／單檔自足／不溢出／與未瘦身版 DOM 與像素一致）");
  const verifyJson = path.join(outDir, "aem-verify.json");
  const st = await sh(id, process.execPath, [path.join(PIPE, "aem_verify.js"), slimPath, layout, "--ref", fullPath, "--out", verifyJson], PIPE);
  if (st.code !== 0) { setExportAem(id, { stage: "error", error: "做好的網頁檔顯示檢查沒有通過（瘦身後的頁面與原版不一致、或有程式錯誤），已停止製作——沒過檢查的檔不交付；請再試一次，連續失敗請聯絡系統管理員（技術訊息已保存）" }); appendLog(id, st.out.slice(-1200)); return; }
  let hosts = []; try { hosts = JSON.parse(fs.readFileSync(verifyJson, "utf8")).externalHosts || []; } catch (e) { appendLog(id, "AEM 製作：讀對板報告的外連清單失敗（README 省略該段）：" + errText(e)); }
  const bytes = fs.statSync(slimPath).size;
  fs.writeFileSync(path.join(outDir, "README.txt"),
`活動頁 AEM 網頁檔
====================
活動名稱：${(dj.page || {}).pageName || id}
活動編號：${id}
檔案：activity-${id}.html（${Math.round(bytes / 1024)} KB，單一檔案、圖片與樣式都在裡面）
AEM 頁面編輯上限對照：本檔網址編碼後 ${report.aemBudget ? report.aemBudget.encoded : "—"} 字／上限 ${report.aemBudget ? report.aemBudget.cap : 131072} 字${report.aemBudget && !report.aemBudget.fits ? `（超過 ${report.aemBudget.ratio} 倍；貼進 AEM 頁面編輯器前需經瘦身）` : ""}
製作時間：${new Date().toISOString()}
檢查：商品狀態＋合規全檢通過；三裝置顯示檢查通過（桌機／平板／手機）

怎麼用
--------
1. 把 activity-${id}.html 上傳到 Adobe Experience Manager 的活動頁位置（整頁 HTML；頁面自帶 Yahoo 購物站頭與頁尾）。
2. 頁面需要能連到這些網域才會完整顯示：${hosts.join("、") || "img.yec.tw（商品圖）、fonts.googleapis.com（字型）"}。
3. 內容是製作當下的快照；商品價格或檔期有變動，回 CMS 改好後重新下載一份再上傳。
4. 活動頁在 AEM 上最多兩週就下架，不做長期維護。
`);
  setExportAem(id, { stage: "done", file: `activity-${id}.html`, bytes, budget: report.aemBudget || null, finishedAt: new Date().toISOString() });
  appendLog(id, `AEM 網頁檔製作完成：export/aem/activity-${id}.html（${Math.round(bytes / 1024)} KB）`);
}

/* ---------- 本期活動內容主題（E0）工作台化（2026-07-23 使用者四題裁決） ----------
   promo-options＝三層即時可用量＋候選清單（選單灰掉邏輯的資料源）；promo-recompose＝伺服器即時重組（Q1）
   ——同端點供「更替入口」（client 指定 actids/gdids＝同層換檔）；標題/dock 依型別機械重寫（Q4）；
   manual 模式＝client 端編修、經一般 draft 回存，不走本端點 */
const cutFull = (s, n) => { let w = 0, out = ""; for (const ch of String(s)) { w += ch.charCodeAt(0) > 255 ? 1 : 0.55; if (w > n) break; out += ch; } return out; };
const wFull = (s) => [...String(s)].reduce((a, c) => a + (c.charCodeAt(0) > 255 ? 1 : 0.55), 0);
function promoLayerOptions(runDir) {
  const dj = JSON.parse(fs.readFileSync(path.join(runDir, "draft.json"), "utf8"));
  const snap = JSON.parse(fs.readFileSync(path.join(runDir, "snapshot.json"), "utf8"));
  let kws = null;
  try { kws = JSON.parse(fs.readFileSync(path.join(runDir, "feedback_patch.json"), "utf8")).themeFitRule.keywords; } catch (e) {}
  if (!kws || !kws.length) { // 後備：主題＋來源頁詞派生（同建 run 邏輯；2026-07-25 Q1-B1 同步擴源）
    let srcUrl = ""; try { srcUrl = (JSON.parse(fs.readFileSync(path.join(runDir, "wb_meta.json"), "utf8")).input || {}).url || ""; } catch (e) {}
    kws = [...new Set([...deriveThemeKeywords(dj.page.curationTheme), ...deriveSourceKeywords(runDir, srcUrl)])];
  }
  const fitOf = (pool) => { if (!pool.length || !kws.length) return null;
    const hits = pool.filter((x) => { const nm = String(x.name || "").toLowerCase(); return kws.some((k) => nm.includes(String(k).toLowerCase())); }).length;
    return hits / pool.length; };
  // 第 1 層：在線活動（未過期＋該檔有池商品）＋CP-14 契合率
  const acts = [];
  for (const pr of snap.promotions || []) {
    if (!pr || !pr.actid || !pr.url || !pr.title) continue;
    if (typeof pr.endTs === "number" && pr.endTs * 1000 < Date.now()) continue;
    const pool = (snap.products || []).filter((p) => p && String(p.actid || "") === String(pr.actid));
    const first = pool.find((p) => p.imgs && p.imgs[0]);
    if (!first) continue;
    const fit = fitOf(pool.slice(0, 20));
    acts.push({ actid: String(pr.actid), title: pr.title, chip: pr.short || pr.title, period: pr.period || "",
      url: pr.url, img: first.imgs[0], fit: fit == null ? null : Math.round(fit * 100), eligible: fit == null ? true : fit >= 0.3 });
  }
  // 已曝光集合（CP-18：商品層選品排除）——promo 入口本身不佔 products[] 列
  const exposed = new Set();
  (dj.products || []).forEach((p) => p && p.gdid && exposed.add(String(p.gdid)));
  (((dj.page || {}).kv || {}).keyProductGdids || []).forEach((g) => g && exposed.add(String(g)));
  const prodsBy = new Map((snap.products || []).map((p) => [String(p.gdid), p]));
  // 第 2 層：品牌頁推薦清單（hits/hotSales；項目以 url→gdid 對映回商品池）
  const recIds = new Set();
  for (const k of ["hits", "hotSales"]) (Array.isArray(snap[k]) ? snap[k] : []).forEach((x) => {
    const g = (x && typeof x === "object") ? (x.gdid || gdidOf(x.url || "")) : gdidOf(String(x));
    if (g) recIds.add(String(g));
  });
  const rec = [...recIds].map((g) => prodsBy.get(g)).filter((p) => p && p.imgs && p.imgs[0] && !exposed.has(String(p.gdid)));
  // 第 3 層：主題契合的未曝光池商品
  const fb = (snap.products || []).filter((p) => p && p.gdid && p.name && p.imgs && p.imgs[0] && !exposed.has(String(p.gdid)) &&
    (!kws.length || kws.some((k) => String(p.name).toLowerCase().includes(String(k).toLowerCase()))));
  const prodItem = (p) => promoProducts.promoPoolItem(p); /* 2026-09-04 復發真因：原本只留 gdid/name/img/url 四欄、價格被剝掉＝下游「收進 products[]」的守門條件永遠不成立；改用同一支純函式帶全真值欄 */
  return { dj, layers: {
    "promo-activity": { count: acts.filter((a) => a.eligible).length, items: acts },
    "brand-recommend": { count: rec.length, items: rec.slice(0, 12).map(prodItem) },
    "product-fallback": { count: fb.length, items: fb.slice(0, 12).map(prodItem) },
  } };
}

/* ---------- 商品替換：URL 驗證＋實抓（POST /api/product-fetch）----------
   檢查鏈：①網域白名單（CP-04）②必須是商品頁 gdsale 連結 ③實抓存活三態（price_qa classifyProductLiveness）
   ④全頁互斥預檢（CP-18：gdid 已在頁上＝拒）；圖庫＝og:image 後綴同組依出現序（第一張/第二張供選）。
   真值鐵律：name/price/marketPrice 逐字自商品頁 SSR；offer 不可得＝留空（不捏造）。 */
const { fetchPage, parseBrandPage, parseFlagshipPage, parseActivityLinks, parseListingHits, parseActivityPage, classifyLiveness } = require(path.join(PIPE, "fetch_parse.js"));
const { mapPool } = require(path.join(PIPE, "lib", "fetch_pool.js")); // 並行抓取池（2026-10-05 提速 B）：商品掃描與連結檢查共用、回退＝CAMPAIGN_FETCH_POOL=off
const { classifyProductLiveness } = require(path.join(PIPE, "price_qa.js"));
const { classifyLinkTarget, classifySearchLiveness, collectPageLinks, upsertPoolEntry, normalizeLinkUrl, sameProductUrl, pickLivePromo, isShellPage } = require(path.join(__dirname, "content_checks.js")); // 連結內容檢查＋更替真值同步＋探索修復（2026-07-27）；sameProductUrl＝商品網址兩式等價（2026-10-04）
const gs = require(path.join(PIPE, "google_sheets.js"));       // Google OAuth＋Sheets/Drive（2026-07-27）
const vsheet = require(path.join(PIPE, "vendor_sheet.js"));    // 廠商變更單建表/讀回
const layoutLib = require(path.join(PIPE, "lib", "layout_choice.js"));
const briefLib = require(path.join(PIPE, "lib", "curation_brief.js")); // 策展劇本解析（71 號，2026-09-11）
const briefFmt = require(path.join(PIPE, "lib", "curation_brief_format.js")); // 格式真源（哪些段系統會用）——建立頁「這份會帶入」那句從這裡算，不寫死
/* 選品引擎要吃的策略檔參數（71 號階段二，2026-09-14）：兩個呼叫點（快速草稿／AI 逾時降級）都經這裡，
   免得一處改了路徑規則另一處還是舊的。路徑不在 briefs 資料夾內＝不帶（套用區會擋並記 briefApplyError，這裡不重複出聲）。 */
function briefArgs(input) {
  if (!input || !input.briefFile) return [];
  const bf = briefResolve(String(input.briefFile));
  return bf && /\.md$/.test(bf) ? ["--brief", bf] : [];
}
/* 策略檔第一行＝型態與主題的真源（2026-09-15 型態；2026-09-25 使用者裁「頁面名稱也要跟策略檔主題走」補主題）。
   沒填的欄從第一行補；人有填＝人的優先、不覆蓋。建立與「照策略檔重做」兩個入口都經這裡。
   病例＝從清單選檔建立時型態會補、主題不會 ⇒ curate_auto 拿不到主題就退回品牌名，頁面名稱／頁尾標題／看更多
   全變「白蘭…」（重播 2026-09-25-wb-131014）；「貼上策略檔」那條路早就會把主題寫進 input，這裡把另兩條補齊。
   回傳補了哪些欄（給 log）；讀不到＝原樣回、套用階段會出聲。 */
function fillInputFromBrief(input) {
  const filled = [];
  if (!input || !input.briefFile) return filled;
  try {
    const bf = safeJoin(BRIEFS_DIR, String(input.briefFile));
    const p = bf && /\.md$/.test(bf) && fs.existsSync(bf) ? briefLib.parseBrief(fs.readFileSync(bf, "utf8")) : null;
    const data = (p && p.data) || {};
    if (!String(input.scenario || "").trim() && data.scenario) { input.scenario = data.scenario; filled.push("scenario"); }
    if (!String(input.theme || "").trim() && String(data.theme || "").trim()) { input.theme = String(data.theme).trim(); filled.push("theme"); }
  } catch (e) { /* 讀不到＝照原樣建立，套用階段會出聲 */ }
  return filled;
}
const BRIEFS_DIR = process.env.CAMPAIGN_BRIEFS_DIR ? path.resolve(process.env.CAMPAIGN_BRIEFS_DIR) : path.join(PIPE, "briefs"); // 策展檔只讀這裡底下，safeJoin 守門；CAMPAIGN_BRIEFS_DIR＝測試與同事包可換位置（2026-09-15 C 批）
/* 策略檔有兩個實體根（2026-09-22 使用者核准的設計；病例＝同事第三版包實測）：
   ・內建範本＝留在包裡（BRIEFS_DIR/built-in），隨新版包更新，唯讀
   ・自己寫的＝搬到家目錄（MY_BRIEFS_DIR），跟著人走，可寫
   原本兩種住同一個資料夾，而啟動器只交代了 CAMPAIGN_RUNS_DIR、沒交代策略檔——
   於是同事寫的策略檔被存在包裡面，換一顆包就消失，而第二版包的說明親口寫著「換電腦都帶得走」。
   沒給 CAMPAIGN_MY_BRIEFS_DIR＝沿舊行為（開發機與既有測試一個字都不用改）。 */
const MY_BRIEFS_DIR = process.env.CAMPAIGN_MY_BRIEFS_DIR ? path.resolve(process.env.CAMPAIGN_MY_BRIEFS_DIR) : path.join(BRIEFS_DIR, "mine");
try { fs.mkdirSync(MY_BRIEFS_DIR, { recursive: true }); } catch (e) { console.error(`策略檔資料夾建立失敗（${MY_BRIEFS_DIR}：${errText(e)}）——貼上策略檔會存不了`); }

/* 邏輯路徑 → 實體路徑的單一真源。對外的 file 一律長 "mine/x.md" 或 "built-in/y.md"，
   API 與前端都不必知道它們住在不同地方（鐵律 4：一條規則只留一個門）。 */
const briefResolve = (rel) => {
  const r = String(rel || "");
  return /^mine\//.test(r) ? safeJoin(MY_BRIEFS_DIR, r.slice(5)) : safeJoin(BRIEFS_DIR, r);
};
const myBriefPath = (...seg) => path.join(MY_BRIEFS_DIR, ...seg);

/* 一次性搬家：舊位置（包裡）還留著的策略檔搬到新位置。只補不覆蓋、失敗要出聲。
   刻意用複製不用移動——包本來就是可丟的，而搬一半失敗會弄丟同事寫的東西。 */
(function migrateMyBriefs() {
  const legacy = path.join(BRIEFS_DIR, "mine");
  if (path.resolve(legacy) === path.resolve(MY_BRIEFS_DIR)) return; // 沒換位置＝不用搬
  let moved = 0, kept = 0;
  try {
    if (!fs.existsSync(legacy)) return;
    for (const f of fs.readdirSync(legacy)) {
      if (!/\.md$/i.test(f)) continue;
      const dest = path.join(MY_BRIEFS_DIR, f);
      if (fs.existsSync(dest)) { kept++; continue; }
      fs.copyFileSync(path.join(legacy, f), dest);
      moved++;
    }
  } catch (e) {
    console.error(`策略檔搬家沒有成功（${errText(e)}）——你之前寫的策略檔可能還留在包裡面：${legacy}`);
    return;
  }
  if (moved) console.log(`策略檔搬家：從包裡搬出 ${moved} 份到 ${MY_BRIEFS_DIR}（舊版存在包裡面、換包會消失，已修）${kept ? `；另有 ${kept} 份同名的以新位置為準` : ""}`);
})();
const scenLib = require(path.join(PIPE, "lib", "scenario_names.js"));   // 五型態名冊（機器真源，2026-09-15）
const briefRecon = require(path.join(PIPE, "lib", "brief_recon.js"));    // 策略檔對帳（貼上／選檔後算給對帳卡）
const geminiPrompt = require(path.join(PIPE, "lib", "gemini_prompt.js")); // 「複製給 Gemini 的話」組句 // 版式選擇器＋AI 代選＋提案包（51 號 W1-C，2026-08-24）
const heroCombo = require(path.join(PIPE, "lib", "hero_combo.js"));
const heroBgOwn = require(path.join(PIPE, "lib", "hero_bg_own.js")); /* 你上傳的背景（78 號 2026-09-27）：驗、存、記；不寫草稿（寫草稿仍走 hero-combo 同一入口） */
const heroBgLic = require(path.join(PIPE, "lib", "hero_bg_license.js"));
const heroBgKit = require(path.join(PIPE, "lib", "hero_bg_kit.js")); // 編修組合面板：搬家/暫存/還原＋背景主題（51 號 W1-D，2026-08-25）
const themeDraftSrv = require(path.join(PIPE, "lib", "theme_draft.js")); // 主題色把關 API（2026-08-27 擋色制）：建立表單與編修面板同一把尺
const curateBridge = require(path.join(__dirname, "curate_auto.js")); // v2 主題橋接：建立所選色 → themeId/colors.themeDraft（2026-08-26 病例 214311 根治；curate_auto 有 require 守門不誤跑 CLI）
const contentModules = require(path.join(PIPE, "lib", "content_modules.js")); // 頁面組成面板：內文模組加入/移除/換版式（W2 第一批，2026-08-25）
const sheetImport = require(path.join(PIPE, "lib", "sheet_import.js")); // Excel／Google Sheets 下載檔帶入三個內文模組（2026-09-26；story docs/stories/sheet-import-content-modules.md）
const PROMO_ENTRY_LIMITS = require(path.join(PIPE, "gate.js")).RULES.entryChecks.entryCount; // CP-15 入口數量單一來源（gate 抽頂常數；2026-08-26 上限 4→12——不在此鏡像數字＝R5 防範）
const { parseProposalPack: parsePackStrict, registriesFingerprint, registriesChanged } = require(path.join(PIPE, "lib", "proposal_pack.js"));
const colortoolEnv = require(path.join(PIPE, "lib", "colortool_env.js")); // 2026-09-21 A：色彩工具環境格（/colortool/ 送檔時填「引擎在哪、API 在哪」，工具不猜） // registriesFingerprint／registriesChanged＝2026-09-21 C：活動列表判「檢查結果是否已被登記簿變動甩在後面」
const promoProducts = require(path.join(PIPE, "lib", "promo_products.js")); // 本期活動入口商品進清單（2026-09-04；純函式＋單元測試）
/* 版式寫入失敗＝白話警告（2026-08-24 review 中3）：meta.layoutChoiceWriteError → status／列表回應的
   layoutChoiceError——前端建立完成畫面顯黃字、編修頁顯黃條（錯誤公式＝白話先講、技術訊息收句尾括號）。 */
/* 版面名稱查表（2026-08-25 文案條款：介面顯示名稱不顯貨號）——行程內快取、載入失敗退貨號並出聲 */
let _layoutNameCache = null;
const layoutLabelOf = (kv) => {
  if (!kv) return null;
  if (kv === "new" || kv === "legacy") return "現行版型";
  if (!_layoutNameCache) {
    _layoutNameCache = {};
    try { layoutLib.loadLayoutDeps().registries.layoutRecords.forEach((r) => { _layoutNameCache[r.id] = r.name; }); }
    catch (e) { console.error("[layoutLabel] 登記簿名稱表載入失敗（介面退回顯示貨號）：" + errText(e)); }
  }
  return _layoutNameCache[kv] || kv;
};
const layoutChoiceErrorOf = (meta) => {
  if (!meta || !meta.layoutChoiceWriteError) return null;
  /* 兩種病兩句話（2026-09-08 病例 run 150043）：
     pack-blocked＝版式有存、只是提案包被可讀性檢查擋下（訊息本身已是白話、含數字與下一步）——不准再套「版式沒存進去、請重選版式重建」；
     其餘（真寫入失敗）＝沿 2026-08-24 review 中3 原句。 */
  if (meta.layoutChoiceWriteKind === "pack-blocked") return `這檔的版面有存進去，但提案包的配色沒過可讀性檢查、整包沒帶入——${String(meta.layoutChoiceWriteError).replace(/^提案包沒有帶入：/, "")}`;
  return `版式選擇沒有存進這檔的草稿——請重選版式重建這檔，或回報管理者（技術訊息：${meta.layoutChoiceWriteError}）`;
};
/* 版式縮圖唯讀靜態來源（51 §2.7）：主 repo design-assets/layouts/thumbs/——路徑解析沿 lib/proposal_pack 的 REPO_ROOT 模式
   （pipeline → workflow 資料夾 → repo 根）；只掛 GET、safeJoin 防穿越，工作台不寫入素材庫（R1）。 */
const LAYOUT_THUMBS_DIR = path.join(PIPE, "..", "..", "design-assets", "layouts", "thumbs");
/* productFetch＝2026-08-26 主打選品貼稿批抽出至 workbench/product_fetch.js（邏輯零改動；
   工廠注入 fetchPage/classifyProductLiveness＝hermetic 測試可注入樁）；gdidOf 同檔同批搬遷。
   本檔綁定真依賴＝行為與抽出前 byte 級一致；檢查鏈與真值鐵律註解見 product_fetch.js 檔頭。 */
const { gdidOf, createProductFetch, probeProductLiveness, evidenceLine } = require(path.join(__dirname, "product_fetch.js"));
const productFetch = createProductFetch({ fetchPage, classifyProductLiveness });
/* 商品在不在，全站只問這一支（PRODUCT-DEAD-TWO-URLS，2026-09-28）：商品狀態檢查／連結內容檢查／探索入口貼商品網址 三處
   原各抄一份「網址怎麼拼＋只問一次」＝一次 404 空殼就寫「連結已失效」（病例 213533 gdid 12087726 在售 $497）。 */
const productLiveness = (args) => probeProductLiveness({ ...args, fetchPage, classifyProductLiveness });
const imgProbe = require(path.join(__dirname, "img_probe.js")); // 編輯精選圓 img 解析度守門（2026-08-26 80×80 病例根治；候選鏈單一真源＝與 curate_auto 同檔）

/* 全頁曝光集合（2026-08-26 三處併一；★大體檢 CT-1 修 2026-08-27）：原把 products[] 全列當曝光代理——
   S11 起「刪層/刪牆＝商品留池不刪列」，池≠頁：被刪那層的商品會被誤判「已經在頁面上」＝pick/AI 補/替換全拒收（死路）。
   改照真曝光面收集（與 lib gdidUsedOnPage 同語意）：KV＋樓層/牆清單＋編輯精選（牆列 position＋圓 url 反解）＋
   本期活動（gdid＋url 反解）＋主打選品位＋促銷卡＋探索卡。 */
/* 主視覺商品集合（2026-10-05 使用者裁「主視覺可與下方重複曝光」）：阻擋型的互斥門用它把主視覺從
   曝光面扣掉＝重複改由 gate CP-18 WARN 提醒；AI 選品池（autoPickFromPool／enrich）不扣＝機器自動挑仍避重複。 */
function heroGdidSet(dj) {
  const s = new Set(); const pg = (dj || {}).page || {};
  (((pg.kv) || {}).keyProductGdids || []).forEach((g) => g && s.add(String(g)));
  Object.values(pg.hero || {}).forEach((sv) => { if (sv && Array.isArray(sv.gdids)) sv.gdids.forEach((g) => g && s.add(String(g))); });
  return s;
}
function pageExposedGdids(dj) {
  const exposed = new Set();
  const pg = dj.page || {};
  ((pg.kv || {}).keyProductGdids || []).forEach((g) => g && exposed.add(String(g)));
  /* 新版主視覺槽（page.hero[*].gdids）也是曝光面（2026-09-26 修）：原本只收舊 KV 欄 ⇒ 模組換品／自動補件可以挑到主視覺槽裡的商品。
     同一條「它在頁上哪裡」規則四處消費端（本函式／lib gdidUsedOnPage／編輯器 usedGdidSet／gate CP-18 claim）同批一起改。 */
  Object.values(pg.hero || {}).forEach((sv) => { if (sv && Array.isArray(sv.gdids)) sv.gdids.forEach((g) => g && exposed.add(String(g))); });
  (pg.floors || []).forEach((f) => ((f && f.productGdids) || []).forEach((g) => g && exposed.add(String(g))));
  /* 情境卡代表品也是曝光面（2026-09-24 修）：契約＝「代表品不入卡列」（vendor_sheet.js 檔頭）。
     本集合原本只收 productGdids ⇒「替換商品」與「補一件折數最好的」都可能挑到那層的代表品，
     換下去即成立 CP-18。病例＝使用者實測「商品替換後主打品會同步更新成一樣的商品」。
     ⚠️ 這條規則有兩處消費端：本函式與 lib/content_modules.js 的 gdidUsedOnPage（註解本來就寫「同語意」）。
     2026-09-24 先只修了後者，結果「加入擋住了、替換還是穿過去」——兩處必須一起改。 */
  (pg.floors || []).forEach((f) => { const g = f && f.sceneUrl && gdidOf(String(f.sceneUrl)); if (g) exposed.add(String(g)); });
  (pg.walls || []).forEach((w) => ((w && w.productGdids) || []).forEach((g) => g && exposed.add(String(g))));
  (dj.products || []).forEach((p) => { if (p && p.gdid && p.position === "editorial-wall") exposed.add(String(p.gdid)); }); // 編輯精選牆列＝position 標記制
  const sp = pg.spotlight || {};
  if (sp.heroCard && sp.heroCard.gdid) exposed.add(String(sp.heroCard.gdid));
  (sp.productRefs || []).forEach((g) => g && exposed.add(String(g)));
  (Array.isArray(pg.promoCards) ? pg.promoCards : (pg.promoCard && !Array.isArray(pg.promoCard) ? [pg.promoCard] : [])).forEach((c) => c && c.gdid && exposed.add(String(c.gdid)));
  (pg.promoEntries || []).forEach((e) => { if (!e) return; if (e.gdid) exposed.add(String(e.gdid)); const g = gdidOf(e.url || ""); if (g) exposed.add(String(g)); });
  ((pg.editorial || {}).circles || []).forEach((c) => { const g = c && gdidOf(c.url || ""); if (g) exposed.add(String(g)); }); // QA #3：編輯精選圓只存 url、無 gdid，漏算會讓自動補選到重複商品
  ((pg.explore || {}).items || []).forEach((e) => { const g = e && gdidOf(e.url || ""); if (g) exposed.add(String(g)); }); // 探索入口卡同理
  return exposed;
}
/* 🤖 補一件折數最好的（2026-08-26 抽出＝原 editorial-add auto 分支同邏輯，供編輯精選與牆/樓層共用）：
   從來源商品池挑未曝光、折數最佳者，逐一（最多 10 名）productFetch 即時驗證在售＋最新真值（不捏造、不補失效品）。 */
async function autoPickFromPool(runDir, exposed) {
  const snapA = JSON.parse(fs.readFileSync(path.join(runDir, "snapshot.json"), "utf8"));
  const pool = (snapA.products || []).filter((p) => p && p.gdid && p.name && typeof p.price === "number" && p.imgs && p.imgs[0] && !exposed.has(String(p.gdid)));
  if (!pool.length) return { error: "這批商品已經沒有多的可以自動補了——請改用賣場編號自己挑一件加入，或讓這個區塊留空", needManual: true };
  pool.sort((a, b) => (a.disc == null ? 999 : a.disc) - (b.disc == null ? 999 : b.disc)); // 折數最佳優先（同 enrich-ee 慣例）
  /* 2026-07-27 根治(AC-16，真值漂移類)：不直接信任快照池（可能補進已失效/跳價品）——逐一即時重抓驗證；
     掃到 10 名（原 5＝前 5 全失效但第 6 名在售會誤報「全失效」＝假陰性）；設上限避免長時間序列抓取佔鎖。 */
  for (const cand of pool.slice(0, 10)) {
    const rf = await productFetch({ url: String(cand.gdid) });
    if (rf.code === 200 && rf.product && rf.product.gdid && !exposed.has(String(rf.product.gdid))) return { product: rf.product };
  }
  return { error: "自動挑到的商品目前都失效或缺資料，補不進來——請改用賣場編號自己挑一件在售商品", needManual: true };
}

/* ---------- 商品狀態檢查（上線前逐品實抓）----------
   對 draft.products 逐品實抓商品頁：在售（online）／已下架（offline＝200 無現價，含補貨/售罄空殼）／
   連結失效（dead＝404）＋價格漂移（live 現價 ≠ draft 現價＝CP-19 真值時效）。
   節流 300ms/請求（price_qa 慣例）；結果落 product_check.json；部署管線第一關引用。 */
/* 圖片/一般網址存活（HEAD 級 GET＋跟一層轉址即棄身；沿 gate.js CP-04 慣例） */
function urlStatus(url) {
  return new Promise((resolve) => {
    let u; try { u = new URL(String(url || "")); } catch (e) { return resolve(-1); }
    if (u.protocol !== "https:") return resolve(-1);
    const req = https.get(u.href, { timeout: 10000 }, (res) => {
      if ([301, 302, 307, 308].includes(res.statusCode) && res.headers.location) {
        res.resume();
        let r2u; try { r2u = new URL(res.headers.location, u.href); } catch (e) { return resolve(res.statusCode); }
        // https→http 降級轉址：https.get 會在本 callback 內「同步」throw ERR_INVALID_PROTOCOL＝Promise 接不到、
        // 整台 server 崩潰（2026-07-27 QA 對抗覆核已本機重現）——非 https 一律視為連結失效
        if (r2u.protocol !== "https:") return resolve(-1);
        const g = https.get(r2u.href, { timeout: 10000 }, (r2) => { r2.resume(); resolve(r2.statusCode); });
        g.on("error", () => resolve(-1)); g.on("timeout", () => { g.destroy(); resolve(-1); });
      } else { res.resume(); resolve(res.statusCode); }
    });
    req.on("error", () => resolve(-1));
    req.on("timeout", () => { req.destroy(); resolve(-1); });
  });
}

async function productCheck(id, runDir, opts = {}) { /* opts.seed＝建立期種子（提速 A；只有建立那條路傳）；opts.onProgress(done,total)＝進度播報（提速 C） */
  const dj = JSON.parse(fs.readFileSync(path.join(runDir, "draft.json"), "utf8"));
  /* 快照池比對（2026-07-27 DJI 死循環根治第二層）：來源紀錄（snapshot）落後 live 也算變價——
     否則 draft==live 時無 drift、無「套用新價」鈕，而 gate CP-02 驗「draft＝快照」必 FAIL＝介面上無動作可解 */
  let snapByGdid = new Map();
  try {
    const sj = JSON.parse(fs.readFileSync(path.join(runDir, "snapshot.json"), "utf8"));
    snapByGdid = new Map((sj.products || []).map((x) => [String(x.gdid), x]));
  } catch (e) { appendLog(id, `商品狀態：讀不到快照（${errText(e)}）——這輪略過來源紀錄比對`); }
  const results = [];
  /* hero 槽位與未上場暫存（51 號 W1-D，2026-08-25）：kvVariant=layout-* 時主視覺商品在 page.hero 槽；
     「僅」被 heroSlotStash 引用的商品＝暫存品（不渲染不出貨）＝不計主計數、另列（14 §2.13）。 */
  const heroObj = (dj.page.hero && typeof dj.page.hero === "object") ? dj.page.hero : {};
  const stashObj = (dj.page.heroSlotStash && typeof dj.page.heroSlotStash === "object") ? dj.page.heroSlotStash : {};
  const isV2Page = /^layout-\d{3}$/.test(String(dj.page.kvVariant || "").replace(/^kv-/, ""));
  const activeGdids = new Set();
  if (!isV2Page) ((dj.page.kv || {}).keyProductGdids || []).forEach((g) => activeGdids.add(String(g))); // v2 頁 kv 節點休眠＝不算在場（14 §2.13）
  for (const v of Object.values(heroObj)) if (v && Array.isArray(v.gdids)) v.gdids.forEach((g) => activeGdids.add(String(g)));
  (dj.page.floors || []).forEach((f) => (f.productGdids || []).forEach((g) => activeGdids.add(String(g))));
  (dj.page.walls || []).forEach((w) => (w.productGdids || []).forEach((g) => activeGdids.add(String(g))));
  (dj.products || []).forEach((p) => { if (p && p.position === "editorial-wall") activeGdids.add(String(p.gdid)); });
  const stashGdids = new Set();
  for (const v of Object.values(stashObj)) if (v && Array.isArray(v.gdids)) v.gdids.forEach((g) => stashGdids.add(String(g)));
  const isStashedOnly = (g) => stashGdids.has(String(g)) && !activeGdids.has(String(g));
  const whereOf = (g) => {
    if (isStashedOnly(g)) return "未上場暫存（不出貨）";
    const kvI = (dj.page.kv.keyProductGdids || []).map(String).indexOf(String(g));
    if (kvI >= 0 && !isV2Page) return `KV 主品 #${kvI + 1}`;
    for (const [slotK, v] of Object.entries(heroObj)) { if (v && Array.isArray(v.gdids)) { const j = v.gdids.map(String).indexOf(String(g)); if (j >= 0) return `主視覺槽 ${slotK} #${j + 1}`; } }
    for (let i = 0; i < (dj.page.floors || []).length; i++) { const j = (dj.page.floors[i].productGdids || []).map(String).indexOf(String(g)); if (j >= 0) return `樓層${i + 1} 卡${j + 1}`; }
    for (let i = 0; i < (dj.page.walls || []).length; i++) { const j = (dj.page.walls[i].productGdids || []).map(String).indexOf(String(g)); if (j >= 0) return `品類牆${i + 1} 卡${j + 1}`; }
    for (let i = 0; i < (dj.page.floors || []).length; i++) { if (gdidOf(dj.page.floors[i].sceneUrl || "") === String(g)) return `樓層${i + 1} 情境代表品`; } // 原顯示「—」＝使用者找不到這件在頁面哪裡
    if (kvI >= 0) return `KV 主品 #${kvI + 1}（新版式頁休眠）`;
    return "—";
  };
  // 網路層失敗重試一次（price_qa 慣例；2026-07-27 實測 Yahoo 搜尋端點會間歇 500＝暫時性，重試可壓掉大半 unverified 雜訊）
  const fetchRetry = async (u) => { try { return await fetchPage(u); } catch (e) { await new Promise((r) => setTimeout(r, 800)); return fetchPage(u); } };
  const liveByEntity = new Map(); // 連結內容檢查重用：同一商品不重抓（省時＋結果一致）
  /* 並行抓取池（2026-10-05 提速 B，使用者裁 A＋B＋C）：原本一件接一件＋每件睡 300ms＝49 件走 50 秒；
     改五路並行、全池開工間隔 250ms（整體最快 4 件/秒＝禮貌線內），結果照草稿商品原序回（mapPool 契約）。
     種子（提速 A）＝幾分鐘前清單逐品實抓剛問過同一頁、同一支探測器 probeProductLiveness 的產物
     （fetch_parse 落檔 price_truth_seed.json）——只在建立期由呼叫端傳入；人按「重新檢查」的路不傳 seed
     ＝永遠現抓（檢查那一刻就該抓那一刻的價，真值鐵律）。回退＝CAMPAIGN_FETCH_POOL=off（單工人照舊排隊）。 */
  const prodsPC = (dj.products || []).filter((p) => p && p.gdid);
  let donePC = 0;
  const seedRowsPC = opts.seed || null;
  const rowsPC = await mapPool(prodsPC, async (p) => {
    /* 商品頁實體 id 依 URL 尾碼（price_qa 慣例）——draft gdid 與頁面實體 id 是兩套編號（鈦案實證），用錯全判下架 */
    const entityId = gdidOf(p.url || "") || String(p.gdid);
    /* 網址怎麼拼＝product_fetch.js productFetchUrls 唯一一份（2026-09-28 收掉此處那份三元式） */
    let row = { gdid: String(p.gdid), name: p.name, where: whereOf(p.gdid), draftPrice: p.price };
    if (isStashedOnly(p.gdid)) row.stashed = true; // 暫存品：照驗（換回會重新上場），但不計主計數（pcSummaryOf 另列）
    try {
      /* 兩種拼法都問過才判死＋每次問了什麼留在 evidence（PRODUCT-DEAD-TWO-URLS，2026-09-28；原本只拼一種、只問一次） */
      const sdPC = seedRowsPC && seedRowsPC[String(p.gdid)];
      const live = sdPC
        ? (sdPC.status === "online"
          ? { status: "online", prod: { price: sdPC.price, listPrice: sdPC.listPrice || null }, evidence: { fetchUrl: sdPC.fetchUrl, seeded: true } }
          : { status: sdPC.status, evidence: null }) /* 非 online 種子不帶 evidence＝不走 evidenceLine（它只認 attempts 形）；note 下面講 */
        : await productLiveness({ gdid: entityId, url: p.url });
      if (sdPC) { row.seeded = true; if (sdPC.status !== "online") row.note = "建立時剛抓過＝清單實抓當下即此狀態"; }
      row.evidence = live.evidence;
      row.status = live.status; // online | offline | dead
      if (live.status === "online") {
        row.livePrice = live.prod.price;
        if (live.prod.listPrice) row.liveMarketPrice = live.prod.listPrice;
        /* 原價（劃線價）不符也算變價（2026-07-27 劃線價真值修，gdid 11581454 實證：商品頁無劃線、
           活動頁卻顯示 marketPrice 灰價）——「套用新價」本來就同步 marketPrice（含清空），一顆鈕可解 */
        const liveM = live.prod.listPrice || null, draftM = p.marketPrice || null;
        row.marketDrift = liveM !== draftM;
        if (row.marketDrift) row.draftMarketPrice = draftM;
        row.drift = live.prod.price !== p.price || row.marketDrift;
        const sp = snapByGdid.get(String(p.gdid));
        if (sp) { row.snapPrice = sp.price; row.snapDrift = live.prod.price !== sp.price || (sp.marketPrice || null) !== liveM; }
        else if (snapByGdid.size) row.snapMissing = true; // 不在來源清單＝合規檢查會擋（真值鏈斷），提前顯示
      }
    } catch (e) { row.status = "unverified"; row.note = errText(e); if (e.attempts) row.evidence = { attempts: e.attempts }; }
    if (row.status !== "online" && row.evidence) { const ev = evidenceLine(row.evidence); row.note = row.note ? `${row.note}；${ev}` : ev; appendLog(id, `商品狀態 gdid=${row.gdid} ${row.status}：${ev}`); } // 判死要說得出問了誰、對方回什麼
    liveByEntity.set(entityId, row);
    donePC++;
    appendLog(id, `商品狀態 [${donePC}/${prodsPC.length}] gdid=${row.gdid} ${row.status}${row.seeded ? "（建立時剛抓過＝直接用）" : ""}${row.drift || row.snapDrift ? "（價格變動 $" + row.draftPrice + "→$" + row.livePrice + (row.marketDrift ? "；原價 " + (row.draftMarketPrice || "無") + "→" + (row.liveMarketPrice || "移除") : "") + (row.snapDrift && !row.drift ? "；來源紀錄未更新" : "") + "）" : ""}`);
    if (opts.onProgress) { try { opts.onProgress(donePC, prodsPC.length); } catch (e) { /* 進度播報失敗不影響檢查本體 */ } }
    return row;
  }, { concurrency: 5, minGapMs: 250, needsGate: (pp) => !(seedRowsPC && seedRowsPC[String(pp.gdid)]) }); /* 種子件零網路＝免排禮貌隊（2026-10-05 實測 51 件全種子仍排 13 秒） */
  results.push(...rowsPC);
  /* —— 連結內容檢查（2026-07-27 使用者需求：延伸探索失效沒被檢查；同類盲區一次補齊）——
     範圍＝延伸探索 items＋看更多、編輯精選圓卡、本期活動入口：連結分型判活（活動頁＝檔期、搜尋頁＝有無結果、
     商品頁＝在售三態）＋圖檔 HTTP 存活。活動頁連活的都回 404（前端殼）＝判活看內容不看狀態碼。 */
  const links = [];
  const allLinks = collectPageLinks(dj.page || {});
  let doneLN = 0; // 連結檢查同吃並行池（提速 B）；結果照序（商品段已先收完＝liveByEntity 快取有效）
  const rowsLN = await mapPool(allLinks, async (ln) => {
    const t = classifyLinkTarget(ln.url);
    const row = { ...ln, kind: t.kind };
    try {
      if (!ln.url) { row.status = "dead"; row.note = "缺連結"; }
      else if (t.kind === "invalid") { row.status = "dead"; row.note = "連結格式不對"; }
      else if (t.kind === "product") {
        const cached = liveByEntity.get(t.gdid);
        if (cached) { row.status = cached.status; row.note = "同頁商品清單已檢"; }
        else {
          const live = await productLiveness({ gdid: t.gdid, url: ln.url }); // 兩種拼法都問過才判死（PRODUCT-DEAD-TWO-URLS，2026-09-28）
          row.status = live.status;
          if (live.status !== "online") { row.evidence = live.evidence; row.note = evidenceLine(live.evidence); }
        }
      } else if (t.kind === "activity" && t.evergreen) { // 常設賣場頁（2026-08-28）：HTTP＋殼判活、不做檔期判定
        const sc = await urlStatus(ln.url);
        row.status = sc === 200 ? "online" : "dead";
        if (sc !== 200) row.note = `HTTP ${sc}`;
      } else if (t.kind === "activity") {
        let res = await fetchRetry(ln.url);
        let live = classifyLiveness(res.html, res.statusCode);
        if (live.status !== "online" && isShellPage(live.evidence)) { // 軟擋殼頁＝內容層再試一次（網路層 fetchRetry 救不到 200/404 的殼）
          await new Promise((r) => setTimeout(r, 1500));
          res = await fetchRetry(ln.url);
          live = classifyLiveness(res.html, res.statusCode);
        }
        if (live.status !== "online" && isShellPage(live.evidence)) { row.status = "unverified"; row.note = "Yahoo 回應不完整（可能暫時擋自動檢查）——過幾分鐘到「發佈前檢查」按「重新檢查」"; }
        else row.status = live.status === "archived" ? "expired" : live.status; // expired＝檔期已結束（頁面真值）
      } else if (t.kind === "search") {
        const res = await fetchRetry(ln.url);
        row.status = classifySearchLiveness(res.html, res.statusCode); // online | unverified（認不出商品）| dead（2026-09-25 三態）
        if (row.status === "unverified") row.note = "我認不出這頁有沒有商品——請點開看一眼，有商品就不用改";
      } else { // other／external：只驗 HTTP 可達
        const sc = await urlStatus(ln.url);
        row.status = sc === 200 ? "online" : "dead";
        if (sc !== 200) row.note = `HTTP ${sc}`;
      }
    } catch (e) { row.status = "unverified"; row.note = errText(e); }
    if (ln.img) {
      const isc = await urlStatus(ln.img);
      row.imgStatus = isc === 200 ? "ok" : "dead";
    }
    doneLN++;
    appendLog(id, `連結內容 [${doneLN}/${allLinks.length}] ${row.where}：${row.status}${row.imgStatus === "dead" ? "（圖片失效）" : ""}`);
    return row;
  }, { concurrency: 5, minGapMs: 250 });
  links.push(...rowsLN);
  const summary = pcSummaryOf(results); // drift 含「來源紀錄落後」snapDrift＝同一顆「套用新價」可解

  const linksSummary = {
    online: links.filter((l) => l.status === "online").length,
    expired: links.filter((l) => l.status === "expired").length,
    empty: links.filter((l) => l.status === "empty").length,
    dead: links.filter((l) => l.status === "dead" || l.status === "offline").length,
    unverified: links.filter((l) => l.status === "unverified").length,
    imgDead: links.filter((l) => l.imgStatus === "dead").length
  };
  const report = { checkedAt: new Date().toISOString(), summary, results, links, linksSummary };
  fs.writeFileSync(path.join(runDir, "product_check.json"), JSON.stringify(report, null, 1));
  /* 換回還原的強制重驗旗（51 號 W1-D；14 §2.13「未驗完擋核可」）：本報告時刻已覆蓋旗立時刻＝該批已重驗，清旗解鎖核可 */
  const mFlag = readMeta(id) || {};
  if (mFlag.heroRestoreRecheck && mFlag.heroRestoreRecheck.at && report.checkedAt >= mFlag.heroRestoreRecheck.at) {
    writeMeta(id, { heroRestoreRecheck: null });
    appendLog(id, `換回還原商品的強制重驗已完成（${mFlag.heroRestoreRecheck.gdids.length} 件涵蓋於本輪報告）——核可解鎖`);
  }
  return report;
}

/* ---------- 對外發佈（過渡期試驗：個人 Netlify 公開站）----------
   2026-07-22 使用者裁決：正式對外需接 Yahoo 網域＝過渡期先以個人帳號公開站承載試驗，
   後續接「Yahoo 網域的產品規劃流程」（13 號平台／N-21）後本通道退場。
   守門＝只發佈已通過內部上線管線（liveUrl 存在）的活動；站＝ai-activity-pages-live（無 auth、noindex）。 */
const PUBLIC_SITE_DIR = path.join(PIPE, "..", "..", "2026-AI自動化活動頁生成規劃", "deploy-site-public");
const PUBLIC_SITE_ID = "b492ef0c-83ac-48fc-8947-8f7b01fb2067";
const PUBLIC_BASE = "https://ai-activity-pages-live.netlify.app";
const setPublic = (id, patch) => { const m = readMeta(id) || {}; writeMeta(id, { publicDeploy: { ...(m.publicDeploy || {}), ...patch } }); };

async function publishPublic(id, runDir) {
  // 2026-08-03 使用者裁決：外部平台全面退場——對外試驗站 ai-activity-pages-live 已刪除（站上僅測試檔、未真正曝光）。
  // 正式對外發佈待 Yahoo 網域（N-21）接通後，以新托管改寫本函式；在此之前一律早退出聲，不得靜默失敗。
  setPublic(id, { stage: "error", startedAt: new Date().toISOString(), error: "對外發佈通道已於 2026-08-03 停用（外部平台全面退場、對外試驗站已刪除）；正式對外發佈待 Yahoo 網域接通後恢復。" });
  appendLog(id, "PUBLIC RETIRED 對外發佈通道已停用（2026-08-03 外部平台退場裁決；試驗站已刪）");
  return;
  setPublic(id, { stage: "sync", startedAt: new Date().toISOString(), error: null });
  appendLog(id, "對外發佈啟動（過渡期試驗站）：① 同步渲染器＋對外化");
  const sy = await sh(id, "/bin/zsh", [path.join(PUBLIC_SITE_DIR, "sync-public.sh")], PUBLIC_SITE_DIR);
  if (sy.code !== 0) { setPublic(id, { stage: "error", error: "對外發佈前的檔案同步沒有成功，已停止發佈——請再按一次「對外發佈」重試；連續失敗請聯絡系統管理員（技術訊息已保存）" }); appendLog(id, sy.out.slice(-400)); return; }

  setPublic(id, { stage: "publish" });
  fs.mkdirSync(path.join(PUBLIC_SITE_DIR, "live-drafts"), { recursive: true });
  fs.copyFileSync(path.join(runDir, "draft.json"), path.join(PUBLIC_SITE_DIR, "live-drafts", `${id}.json`));
  const dj = JSON.parse(fs.readFileSync(path.join(runDir, "draft.json"), "utf8"));
  const publicUrl = `${PUBLIC_BASE}/lecreuset-frametest/?draftUrl=/live-drafts/${id}.json`;
  /* live.json 清單 upsert（公開站首頁資料源） */
  const livePath = path.join(PUBLIC_SITE_DIR, "live.json");
  let live = { activities: [] };
  try { live = JSON.parse(fs.readFileSync(livePath, "utf8")); } catch (e) {}
  live.activities = (live.activities || []).filter((a) => a.id !== id);
  live.activities.unshift({ id, title: dj.page.pageName || id, subtitle: dj.page.curationTheme || "",
    hue: (dj.page.theme && dj.page.theme.hueFamily) || "pink", url: `/lecreuset-frametest/?draftUrl=/live-drafts/${id}.json`,
    publishedAt: new Date().toISOString() });
  live.updatedAt = new Date().toISOString();
  fs.writeFileSync(livePath, JSON.stringify(live, null, 1));
  appendLog(id, `② 發佈 live-drafts/${id}.json＋live.json 清單更新`);

  setPublic(id, { stage: "upload" });
  const nd = await sh(id, "netlify", ["deploy", "--dir", ".", "--site", PUBLIC_SITE_ID, "--json"], PUBLIC_SITE_DIR);
  let deployId = null;
  try { deployId = JSON.parse(nd.out.slice(nd.out.indexOf("{"))).deploy_id; } catch (e) {}
  if (!deployId) { const m = nd.out.match(/([0-9a-f]{24})--/); deployId = m && m[1]; }
  if (!deployId) { setPublic(id, { stage: "error", error: "上傳到公開站沒有成功，已停止對外發佈——請再按一次「對外發佈」重試；連續失敗請聯絡系統管理員（技術訊息已保存）" }); appendLog(id, nd.out.slice(-500)); return; }
  setPublic(id, { stage: "promote", deployId });
  // 2026-07-25 design QA 修：晉升結果須驗證（原無條件寫 done＝晉升失敗仍顯示「發佈完成」而公開站是舊內容）
  const prp = await sh(id, "netlify", ["api", "restoreSiteDeploy", "--data", JSON.stringify({ site_id: PUBLIC_SITE_ID, deploy_id: deployId })], PUBLIC_SITE_DIR);
  if (!prp.out.includes('"ready"') && !prp.out.includes('"state"')) { setPublic(id, { stage: "error", error: "對外發佈的最後一步（切換到新版本）沒有成功——公開站可能還是舊內容，請再按一次「對外發佈」重試；連續失敗請聯絡系統管理員（技術訊息已保存）" }); appendLog(id, prp.out.slice(-500)); return; }
  writeMeta(id, { publicUrl, publicAt: new Date().toISOString() });
  setPublic(id, { stage: "done", deployId, publicUrl, finishedAt: new Date().toISOString() });
  appendLog(id, `對外發佈完成（過渡期試驗站）：${publicUrl}`);
}

/* ---------- HTTP 路由 ---------- */
/* 對外模式防護（2026-07-22 使用者指示上線）：env WB_PASS 設定時全站 Basic Auth（帳號 WB_USER 預設 yahoo）——
   Tunnel 對外必開；本機純內用（未設 WB_PASS）不變。憑證比對常數時間無需（低風險內部工具），但絕不記 log。 */
const WB_USER = process.env.WB_USER || "yahoo";
const WB_PASS = process.env.WB_PASS || "";
/* 連續失敗鎖定（2026-07-29 資安盤點 R2 根治）：原本只比對密碼、無失敗鎖定/限速/記錄——
   配上「/cms/ 公開頁曾印出 tunnel 網址」＝知道門在哪且可無限猜。雙層設計：
   ①每來源鍵 10 次失敗 → 鎖 15 分　②全域 30 次/10 分 → 全域鎖 15 分（總量後衛）
   絕不記密碼與 Authorization 標頭內容；/ping 在 auth 之前＝看門狗存活判定不受影響。
   2026-08-05（lan-direct-access 設計 3）：來源鍵由「CF-Connecting-IP 優先、socket 次之」改為**只認 socket**——
   原設計是 tunnel 時代產物（當時所有連線的 socket IP 都是 127.0.0.1，只有 CF 標頭有鑑別度）；tunnel 已於
   08-04 退役，該標頭從此只剩偽造用途（輪換假鍵繞過①、或冒用他人 IP 觸發鎖定害人）。與 isLoopbackHost 同一
   根因＝tunnel 時代信任客戶端可控輸入，一次修整類（鐵律 4）。
   ⚠ 已知殘留（過渡期列風險不修，見 story 風險節）：全域鎖會連帶鎖住所有合法使用者含管理者。 */
const authLog = (m) => { try { console.warn(`[auth] ${new Date().toISOString()} ${m}`); } catch (e) { /* 記錄器自身故障無處可報；勿再拋＝防 07-29 崩程序事故重演 */ } }; // 全域安全記錄（server.js 無全域 warn——:328 那個是區域變數，2026-07-29 實證會 ReferenceError 崩程序）
const AUTH_FAIL_MAX = 10, AUTH_LOCK_MS = 15 * 60 * 1000;
const AUTH_GLOBAL_MAX = 30, AUTH_GLOBAL_WINDOW_MS = 10 * 60 * 1000;
const authFails = new Map();          // key → { n, until }
let authGlobal = { n: 0, since: 0, until: 0 };
const authKeyOf = (req) => String((req.socket && req.socket.remoteAddress) || "unknown").slice(0, 64); // 只認 socket＝不可偽造（2026-08-05）
function authLockState(key, now) {     // → null（未鎖）｜{ scope, retryAfter }
  if (authGlobal.until > now) return { scope: "global", retryAfter: Math.ceil((authGlobal.until - now) / 1000) };
  const e = authFails.get(key);
  if (e && e.until > now) return { scope: "key", retryAfter: Math.ceil((e.until - now) / 1000) };
  return null;
}
function authNoteFail(key, now) {
  const e = authFails.get(key) || { n: 0, until: 0 };
  e.n++;
  if (e.n >= AUTH_FAIL_MAX) { e.until = now + AUTH_LOCK_MS; e.n = 0; authLog(`⚠ 登入連續失敗達 ${AUTH_FAIL_MAX} 次，來源 ${key} 鎖定 ${AUTH_LOCK_MS / 60000} 分鐘`); }
  authFails.set(key, e);
  if (!authGlobal.since || now - authGlobal.since > AUTH_GLOBAL_WINDOW_MS) authGlobal = { n: 0, since: now, until: authGlobal.until };
  authGlobal.n++;
  if (authGlobal.n >= AUTH_GLOBAL_MAX) { authGlobal = { n: 0, since: now, until: now + AUTH_LOCK_MS }; authLog(`⚠ 全站登入失敗 ${AUTH_GLOBAL_MAX} 次/${AUTH_GLOBAL_WINDOW_MS / 60000} 分（疑來源輪換），全域鎖定 ${AUTH_LOCK_MS / 60000} 分鐘`); }
  else authLog(`登入失敗（來源 ${key}；該來源累計 ${e.n}／全站 ${authGlobal.n}）`);
  if (authFails.size > 5000) for (const [k, v] of authFails) if (v.until <= now && v.n === 0) authFails.delete(k); // 記憶體上限（掃過期）
}
/* 跨站請求防護（2026-08-05 紅隊 C2；與 isLoopbackHost／authKeyOf 同一根因家族＝未驗證請求來源，一次修整類）：
   Basic Auth 憑證由瀏覽器自動重送——綁 0.0.0.0 後，同事只要曾登入過工作台，他之後開的任何網站都能對
   `http://<內網IP>:8787/api/runs/<id>/deploy` 發一個跨站 POST（HTML form 或 no-cors fetch 都不觸發 preflight，
   而 deploy 端點根本不讀 body），瀏覽器會自動附上憑證＝盲打式觸發上線（money-facing）。
   判定：瀏覽器發跨站請求必帶 Origin（POST）或 Sec-Fetch-Site；非瀏覽器客戶端（curl／巡檢腳本）兩者皆無＝放行。 */
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
function crossSiteReason(req) {
  if (SAFE_METHODS.has(req.method)) return null;
  const sfs = String(req.headers["sec-fetch-site"] || "");
  if (sfs && !["same-origin", "same-site", "none"].includes(sfs)) return `Sec-Fetch-Site=${sfs}`;
  const origin = String(req.headers.origin || "");
  if (!origin) return null;
  let oh; try { oh = new URL(origin).host; } catch (e) { return "Origin 無法解析"; }
  return oh === String(req.headers.host || "") ? null : `Origin ${oh} ≠ Host ${req.headers.host}`;
}
function authOk(req) {
  if (!WB_PASS) return true;
  const h = req.headers.authorization || "";
  if (!h.startsWith("Basic ")) return false;
  try { const [us, pw] = Buffer.from(h.slice(6), "base64").toString("utf8").split(":"); return us === WB_USER && pw === WB_PASS; } catch (e) { return false; }
}
const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, "http://x");
  const seg = u.pathname.split("/").filter(Boolean);
  /* 編修模式安全層（69 號 Phase 1／71 號 §8.5）：發佈、對外、Google 試算表、對線上頁改價一律 403 並講白話——
     介面同時依能力表藏入口；這裡是「藏了還被打到」的最後一道。 */
  if (MODE === "editor" && seg[0] === "api" && (seg[1] === "google" || (seg[1] === "runs" && EDITOR_BLOCKED_SUBROUTES.has(seg[3] || "")))) {
    return sendJson(res, 403, { error: `這台是同事的編修版，不發佈、不連 Google 試算表；要交付請製作並下載 AEM 網頁檔。（技術：編修模式停用 ${u.pathname}）` });
  }
  /* 免登入探測端點（固定入口 /cms/ 跳板頁探測用，2026-07-25）：204 無內容＝不洩漏資料；
     ACAO 讓跳板頁 cors fetch 能確認「真的是平台在回應」（Cloudflare 530 錯誤頁無此標頭＝fetch 會 reject） */
  if (u.pathname === "/ping") {
    res.writeHead(204, { "Access-Control-Allow-Origin": "*", "Cache-Control": "no-store" });
    return res.end();
  }
  /* 商品圖抓取（2026-08-25 設計站色彩工具「商品卡內容」面板）：唯讀、僅 tw.buy.yahoo.com、
     回前 5 張圖 URL；置於帳密鎖前（無敏感資料、不寫任何狀態）；ACAO 全開＝設計站（GHE Pages）跨源取用。
     解析雙軌＝JSON-LD image 陣列（價格真值同源）＋ Shopping_ProductImage imageSet（與 fetch_parse 活動頁同語意） */
  if (u.pathname === "/api/product-images") {
    (async () => {
      const cors = { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" };
      const fail = (code, msg) => { try { res.writeHead(code, cors); res.end(JSON.stringify({ error: msg })); } catch (e) { console.error("[product-images] 回應寫入失敗（標頭可能已送出）：" + ((e && errText(e)) || e)); } };
      /* 節流（c9 代審跟進 2026-08-25）：免登入端點＝內網開放模式（.wb-bind）下防代抓濫用——每來源 IP 每分鐘 12 次 */
      const rl = (globalThis.__pimgRate = (globalThis.__pimgRate && Date.now() - globalThis.__pimgRate.t < 60000) ? globalThis.__pimgRate : { t: Date.now(), m: new Map() });
      const rlIp = String((req.socket && req.socket.remoteAddress) || "?");
      const rlN = (rl.m.get(rlIp) || 0) + 1; rl.m.set(rlIp, rlN);
      if (rlN > 12) { try { res.writeHead(429, Object.assign({ "Retry-After": "60" }, cors)); res.end(JSON.stringify({ error: "節流：每 IP 每分鐘 12 次，稍候再試" })); } catch (e) { console.error("[product-images] 429 回應失敗：" + ((e && errText(e)) || e)); } return; }
      try {
        let ref = String(u.searchParams.get("ref") || "").trim();
        if (!ref) return fail(400, "ref required");
        const rawRef = ref;
        if (/^\d{5,}$/.test(ref)) ref = "https://tw.buy.yahoo.com/gdsale/gdsale.asp?gdid=" + ref;
        let host; try { host = new URL(ref).hostname; } catch (e) { return fail(400, "bad url"); }
        if (!/(^|\.)tw\.buy\.yahoo\.com$/.test(host)) return fail(400, "only tw.buy.yahoo.com");
        const page = await fetchPage(ref);
        const html = String((page && page.html) || "");
        const seen = new Set(); const imgs = [];
        const push = (raw) => {
          if (!raw) return;
          // SSR 兩種跳脫都解：\u002F（JSON-LD）與 \/（gqlstate）
          const url2 = raw.replace(/\\u002F/gi, "/").replace(/\\\//g, "/");
          if (!/^https?:\/\//.test(url2) || seen.has(url2)) return;
          seen.add(url2); imgs.push(url2);
        };
        /* 圖庫來源（2026-08-25 二修）：商品頁真圖庫＝JSON-LD @type=Product 的 image 陣列
           （MerchandiseImages，次序＝商品頁圖庫序、第二張＝白底語意同 02 §10）；
           一修的教訓：頁面級 Shopping_ProductImage 在商品頁上全是行銷 banner（MipBanners）＝已銷毀該備援；
           次源＝主商品實體 imageSet（活動頁型資料才有，商品頁通常無）。 */
        const gd = (/^\d{5,}$/.test(rawRef) ? rawRef : null)
          || (ref.match(/[?&]gdid=(\d{5,})/) || [])[1]
          || (ref.match(/-(\d{5,})\.html/) || [])[1]
          || (String((page && page.finalUrl) || "").match(/[?&]gdid=(\d{5,})/) || [])[1] || null;
        const ldAt = html.search(/"@type"\s*:\s*"Product"/);
        if (ldAt >= 0) {
          const seg = html.slice(ldAt, ldAt + 12000);
          const im = seg.match(/"image"\s*:\s*\[([^\]]+)\]/);
          if (im) for (const m of im[1].matchAll(/"(https?:[^"]+?)"/g)) push(m[1]);
        }
        if (!imgs.length && gd) {
          const at = html.indexOf('"Shopping_Product:' + gd + '":');
          if (at >= 0) {
            const isAt = html.indexOf('"imageSet":', at);
            if (isAt >= 0 && isAt - at < 60000) {
              const end = html.indexOf(']]', isAt);
              const zone = html.slice(isAt, end > 0 ? end + 2 : isAt + 20000);
              for (const m of zone.matchAll(/\[\{"__typename":"Shopping_ProductImage","url":"([^"]+)"/g)) push(m[1]);
            }
          }
        }
        res.writeHead(200, cors);
        return res.end(JSON.stringify({ images: imgs.slice(0, 5), source: page && page.finalUrl || ref }));
      } catch (e) { return fail(502, String((e && errText(e)) || e).slice(0, 200)); }
    })();
    return;
  }
  /* 待審背景上傳（63 號直通車 2026-08-31，使用者五題圈定＋全段建置裁決）：設計站色彩工具「帶著走」
     跨源上傳自帶背景→存 deploy-site/活動版型待審背景/＋pending.json 開戶（pending-NNNN 訪客號段）→回號碼與網址。
     置於帳密鎖前＝沿 /api/product-images 先例（設計站 GHE Pages 跨源、瀏覽器無憑證可帶）；防護＝節流（每 IP 每分鐘 6 次）
     ＋mime 白名單＋10MB 上限＋檔名淨化；收進來的圖天生隔離在待審簿＝掛浮水印才能上線、出貨閘照擋（風險有界）。 */
  if (u.pathname === "/api/pending-bg") {
    const pbCors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type", "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" };
    if (req.method === "OPTIONS") { res.writeHead(204, pbCors); return res.end(); }
    if (req.method !== "POST") { res.writeHead(405, pbCors); return res.end(JSON.stringify({ error: "POST only" })); }
    (async () => {
      const pbFail = (code, msg) => { try { res.writeHead(code, pbCors); res.end(JSON.stringify({ error: msg })); } catch (e) { console.error("[pending-bg] 回應寫入失敗：" + ((e && errText(e)) || e)); } };
      const rl = (globalThis.__pbgRate = (globalThis.__pbgRate && Date.now() - globalThis.__pbgRate.t < 60000) ? globalThis.__pbgRate : { t: Date.now(), m: new Map() });
      const rlIp = String((req.socket && req.socket.remoteAddress) || "?");
      const rlN = (rl.m.get(rlIp) || 0) + 1; rl.m.set(rlIp, rlN);
      if (rlN > 6) return pbFail(429, "節流：每 IP 每分鐘 6 次，稍候再試");
      try {
        const raw = await readBodyLimited(req, 15 * 1024 * 1024); // base64 膨脹 1.37x → 10MB 圖約 13.7MB body
        if (raw === null) return pbFail(413, "圖太大——上限 10MB，請壓一下再上傳");
        let body; try { body = JSON.parse(raw); } catch (e) { return pbFail(400, "body 不是 JSON"); }
        const MIME_EXT = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
        const ext = MIME_EXT[String(body.mime || "")];
        if (!ext) return pbFail(400, "只收 JPG／PNG／WebP——瀏覽器讀不出來的格式（如 HEIC）沒辦法當背景");
        const buf = Buffer.from(String(body.dataBase64 || ""), "base64");
        if (!buf.length) return pbFail(400, "沒收到圖檔內容");
        if (buf.length > 10 * 1024 * 1024) return pbFail(413, "圖太大——上限 10MB，請壓一下再上傳");
        const ans = body.answers || {};
        const a1 = String(ans.source || "").trim(), a2 = String(ans.commercial || "").trim(), a3 = String(ans.link || "").trim();
        if (!a1 || !a2) return pbFail(400, "授權三答至少要答前兩題（圖哪來的／能不能商用）——這是之後審核放行的依據");
        /* 開戶＝配號與落檔一體（run_id 同款道理：單執行緒同步段＝查與寫不被插隊） */
        const PENDING_PATH = path.join(PIPE, "..", "..", "design-assets", "backgrounds", "pending.json");
        const book = JSON.parse(fs.readFileSync(PENDING_PATH, "utf8"));
        const maxN = book.entries.reduce((m, e) => Math.max(m, Number(String(e.id || "").replace(/^pending-/, "")) || 0), 0);
        const id = "pending-" + String(maxN + 1).padStart(4, "0");
        const safe = String(body.name || "bg").replace(/\.[A-Za-z0-9]+$/, "").replace(/[^\w一-鿿-]+/g, "-").slice(0, 40) || "bg";
        const fname = `${id}-${safe}.${ext}`;
        const dir = path.join(DEPLOY_SITE, "活動版型待審背景");
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, fname), buf);
        const nameFull = String(body.name || fname);
        const nameExt = (nameFull.match(/\.[A-Za-z0-9]{1,5}$/) || [""])[0];
        const nameShown = nameFull.length <= 120 ? nameFull : nameFull.slice(0, 120 - nameExt.length - 1) + "…" + nameExt; /* 2026-09-08：原 slice(0,80) 把「….png」截成「….pn」進黃條與登記簿；改保留副檔名、主檔名過長才加省略號 */
        const entry = { id, file: "活動版型待審背景/" + fname, name: nameShown,
          uploadedBy: String(body.uploadedBy || "").slice(0, 60) || null, uploadedAt: new Date().toISOString(),
          licenseAnswers: { source: a1.slice(0, 200), commercial: a2.slice(0, 200), link: a3.slice(0, 300) || null },
          sizeCheck: body.sizeCheck || null,
          bridgeColor: /^#[0-9a-fA-F]{6}$/.test(String(body.bridgeColor || "")) ? String(body.bridgeColor).toUpperCase() : null, /* 圖底邊平均色（工具上傳時量）＝銜接色：bg-map／CMS 真底色檢查都靠它（2026-09-04） */
          usedIn: [], review: { status: "pending", date: null, reason: null } };
        book.entries.push(entry);
        fs.writeFileSync(PENDING_PATH, JSON.stringify(book, null, 1));
        /* 上傳即入地圖（旅程走查抓的缺口）：bg-map 是生成物、平常隨 sync 重跑——設計師上傳完就要能在
           CMS/預覽查到號，當場重跑生成器；失敗出聲（開戶已成、地圖沒跟上＝回應照實講）。 */
        const bgm = spawnSync(process.execPath, [path.join(PIPE, "tools", "build_bg_map.js")], { encoding: "utf8", timeout: 30000 });
        const bgmOk = bgm.status === 0;
        if (!bgmOk) console.error("[pending-bg] 背景地圖重跑失敗：", String(bgm.stderr || bgm.stdout || "").slice(0, 300));
        res.writeHead(200, pbCors);
        return res.end(JSON.stringify({ id, url: "../活動版型待審背景/" + fname, mapRebuilt: bgmOk, note: bgmOk ? "已領臨時貨號——這張圖現在能跟著提案包進 CMS；上線會掛「背景版權待審核」浮水印（內網展示限定），正式出貨要等審核轉正。" : "已領臨時貨號，但背景地圖沒更新成功——CMS 可能暫時查不到這張圖，請回報系統管理員（號碼與圖檔都已保存）。" }));
      } catch (e) { return pbFail(500, String((e && errText(e)) || e).slice(0, 200)); }
    })();
    return;
  }
  /* 版本握手（2026-07-25 DJI 預覽事故根治）：工作台分頁定期比對——程式更新過＝提示重新整理，
     杜絕「舊分頁配新伺服器」整族問題（舊版無自癒機制的預覽注入卡死即此族） */
  if (u.pathname === "/api/version") {
    let html = 0; try { html = fs.statSync(path.join(PUB, "index.html")).mtimeMs; } catch (e) {}
    /* 半新半舊偵測（2026-10-08 病例：8787 行程 10/7 早上起、介面檔 10/8 新——新按鈕打到舊伺服器＝「找不到這張探索卡」）：
       介面檔比行程新＝伺服器要重啟。既有橫幅只管「磁碟比分頁新＝請重新整理」，這面管另一半。 */
    let srvm = 0; try { srvm = fs.statSync(__filename).mtimeMs; } catch (e) { /* 量不到 server.js mtime＝當 0，不影響既有 index.html 判定 */ }
    const staleServer = Math.max(html, srvm) > Date.parse(SERVER_BOOT); /* server.js 自己也算（2026-10-08 當天就踩到只改伺服器檔的盲區） */
    return sendJson(res, 200, { boot: SERVER_BOOT, html, staleServer, mode: MODE, build: BUILD, caps: CAPS ? CAPS.caps : null, capsDetail: CAPS ? CAPS.detail : null, capsCheckedAt: CAPS ? CAPS.checkedAt : null }); // 2026-09-15：能力表隨版本握手送前端（12 秒輪詢＝介面自動跟上）
  }
  if (WB_PASS) { // 失敗鎖定（R2）：鎖定中一律 429，不比對密碼＝猜測無回饋
    const _now = Date.now(), _key = authKeyOf(req), _lock = authLockState(_key, _now);
    if (_lock) {
      try { res.writeHead(429, { "Retry-After": String(_lock.retryAfter), "Content-Type": "text/plain; charset=utf-8" }); } catch (e) { authLog(`429 writeHead 失敗（可能標頭已送出）：${errText(e)}`); }
      return res.end(`登入嘗試過於頻繁，已暫時鎖定（約 ${Math.ceil(_lock.retryAfter / 60)} 分鐘後自動解除）。若是你自己被鎖到，請聯絡系統管理員或稍候再試。`);
    }
    if (!authOk(req)) {
      if ((req.headers.authorization || "").startsWith("Basic ")) authNoteFail(_key, _now); // 只計「送了憑證但錯」＝瀏覽器首次無標頭的 401 不算失敗
    } else { authFails.delete(_key); }
  }
  if (!authOk(req)) { // realm 必須 ASCII（HTTP 標頭禁非 ASCII＝2026-07-22 崩潰教訓 ERR_INVALID_CHAR）
    try { res.writeHead(401, { "WWW-Authenticate": 'Basic realm="Activity-Workbench"', "Content-Type": "text/plain; charset=utf-8" }); } catch (e) {}
    return res.end("需要登入（帳密向 Tofu 索取）");
  }
  const _xs = crossSiteReason(req); // 已登入才檢查＝未登入一律先 401，不洩漏端點存在
  if (_xs) {
    authLog(`⚠ 阻擋跨站狀態變更請求（${_xs}；來源 ${srcOf(req)}；${req.method} ${u.pathname}）`);
    return sendJson(res, 403, { error: "這個操作被安全防護擋下（來源不是工作台自己的頁面）——請直接在工作台頁面內操作。" });
  }

  try {
    /* 能力表重測（2026-09-21；story docs/stories/caps-recheck.md）：介面橫幅那顆「登入好了，重新檢查」打這裡。
       刻意放在登入守門「之後」——它會真的叫一次 claude（花額度），不能像 /api/version 那樣裸奔在免登入區；
       同事版（editor）本來就免登入，照樣打得到，也不在 EDITOR_BLOCKED_SUBROUTES 名單（同事正需要它）。
       併發由 detectCaps 自己共用同一輪，這裡不另做節流。 */
    if (u.pathname === "/api/caps/recheck" && req.method === "POST") {
      const r = await detectCaps("使用者按了重新檢查");
      return sendJson(res, 200, { caps: r ? r.caps : null, capsDetail: r ? r.detail : null, capsCheckedAt: r ? r.checkedAt : null });
    }

    /* 前台 */
    if (u.pathname === "/" ) return serveFile(res, path.join(PUB, "index.html"));
    if (seg[0] === "public") { const f = safeJoin(PUB, seg.slice(1).join("/")); return f ? serveFile(res, f) : sendJson(res, 400, { error: "bad path" }); }

    /* 色彩策略工具同源掛載（68 號第一批 Q3，2026-09-04）：工具在 /colortool/ 開＝與 /frametest/ 同源＝iframe.contentWindow.loadProposalPack 叫得到。
       工具頁的相對引用：deliverables/…（規劃資料夾）、../design-assets/…（repo）、../design-proposal-kit/…（kit）三條路一起掛；唯讀。 */
    if (seg[0] === "colortool") {
      const rel = seg.slice(1).join("/");
      if (!rel) {
        /* 2026-09-21 A「工具不猜環境」：送工具主頁時把環境格填好——引擎＝同站 /frametest/、同網域、工作台 API 就在本站。
           源頭檔永遠留空；填法＝lib/colortool_env.js（設計站部署腳本填的是同一格、同一支）。注入失敗＝出聲並照原檔送，工具會退回舊的猜路徑法。 */
        try {
          const html = colortoolEnv.injectEnv(fs.readFileSync(path.join(PLAN_DIR, "活動頁色彩策略工具.html"), "utf8"),
            { site: "workbench", engineBase: "/frametest/", apiBase: "", engineSameOrigin: true });
          return send(res, 200, Buffer.from(html, "utf8"), MIME[".html"]);
        } catch (e) { console.error(`[colortool] 環境格注入失敗（${errText(e)}）——照原檔送出，工具退回猜路徑法`); }
      }
      const f = safeJoin(PLAN_DIR, rel ? decodeURIComponent(rel) : "活動頁色彩策略工具.html");
      return f ? serveFile(res, f) : sendJson(res, 400, { error: "bad path" });
    }
    if (seg[0] === "ds-site-nav.js" && seg.length === 1) return serveFile(res, path.join(PLAN_DIR, "tools", "ds-site-nav.js")); // 色彩工具頁引用站根的跨站導航（分享站有、工作台補同路徑＝不出資源 404）
    if (seg[0] === "design-assets") { const f = safeJoin(path.join(PIPE, "..", "..", "design-assets"), decodeURIComponent(seg.slice(1).join("/"))); return f ? serveFile(res, f) : sendJson(res, 400, { error: "bad path" }); }
    if (seg[0] === "design-proposal-kit") { const f = safeJoin(path.join(PIPE, "..", "..", "design-proposal-kit"), decodeURIComponent(seg.slice(1).join("/"))); return f ? serveFile(res, f) : sendJson(res, 400, { error: "bad path" }); }
    /* FrameTest 同源掛載（含 assets） */
    if (seg[0] === "frametest") {
      /* hero-bg 圖庫改讀真源（63 號直通車二缺口 2026-08-31）：上傳端點重跑的是規劃/assets/hero-bg（真源），
         deploy-site 複本要等 sync 才更新——原本本機預覽讀複本＝剛上傳的待審圖看不到（實測 pending-0002 空手而回）。
         本機預覽直讀真源＝上傳即可見；分享站照舊吃 sync 複本（部署鏈自帶保鮮）。 */
      if (seg[1] === "assets" && seg[2] === "hero-bg") {
        const fh = safeJoin(path.join(PIPE, "..", "..", "2026-AI自動化活動頁生成規劃", "assets", "hero-bg"), seg.slice(3).join("/")); // 兩層＝FRAMETEST_DIR 同深度（首版少爬一層＝路由永不命中）
        if (fh && fs.existsSync(fh)) return serveFile(res, fh);
      }
      const f = safeJoin(FRAMETEST_DIR, seg.slice(1).join("/") || "index.html"); return f ? serveFile(res, f) : sendJson(res, 400, { error: "bad path" }); }
    /* 去背商品圖庫同源掛載（2026-08-28 使用者圖庫批）：deploy-site/活動版型去背商品——
       稿內存頁面相對路徑 ../活動版型去背商品/<檔>＝本機（editor 根/預覽 iframe /frametest/）與 GHE Pages（前綴路徑）兩站通吃（遷移 #4 同招）；
       GHE 直連 URL 在 Okta 門後、localhost 嵌第三方圖 cookie 帶不過＝破圖正主 */
    if (decodeURIComponent(seg[0] || "") === "活動版型去背商品") { const f = safeJoin(path.join(DEPLOY_SITE, "活動版型去背商品"), decodeURIComponent(seg.slice(1).join("/"))); return f ? serveFile(res, f) : sendJson(res, 400, { error: "bad path" }); }
    /* 待審背景同源掛載（63 號直通車 2026-08-31）：與去背圖庫同款——稿內存 ../活動版型待審背景/<檔>，本機與 GHE 兩站通吃 */
    if (decodeURIComponent(seg[0] || "") === "活動版型待審背景") { const f = safeJoin(path.join(DEPLOY_SITE, "活動版型待審背景"), decodeURIComponent(seg.slice(1).join("/"))); return f ? serveFile(res, f) : sendJson(res, 400, { error: "bad path" }); }

    /* API */
    if (seg[0] === "api" && seg[1] === "rules.json") return serveFile(res, path.join(PIPE, "rules.json"));
    if (seg[0] === "api" && seg[1] === "product-fetch" && req.method === "POST") {
      const body = JSON.parse(await readBody(req) || "{}");
      const r = await productFetch(body);
      return sendJson(res, r.code, r.code === 200 ? r.product : { error: r.error });
    }
    /* ===== Google Sheets 整合（2026-07-27）：per-user OAuth（授權碼流程）＋廠商變更單建立/讀回 =====
       redirect_uri 固定 localhost（Google 憑證登記值；使用者連結時用 localhost 開工作台，即使有 tunnel 也走本機回呼）。 */
    if (seg[0] === "api" && seg[1] === "google") {
      if (!isLoopbackHost(req)) return sendJson(res, 403, { error: "此功能僅限本機存取" }); // QA：防 DNS rebinding——涵蓋 status(洩 email/apiKey)/config/auth/callback/folder/token/disconnect
      const GOOGLE_REDIRECT = "http://localhost:" + PORT + "/api/google/callback";
      if (seg[2] === "status" && req.method === "GET") return sendJson(res, 200, gs.status());
      if (seg[2] === "config" && req.method === "POST") {
        const b = JSON.parse(await readBody(req) || "{}");
        const patch = {};
        if (b.clientId !== undefined || b.clientSecret !== undefined) {
          const clientId = String(b.clientId || "").trim(), clientSecret = String(b.clientSecret || "").trim();
          if (!clientId || !clientSecret) return sendJson(res, 400, { error: "請填入 client_id 與 client_secret（Google Cloud OAuth 用戶端）" });
          patch.clientId = clientId; patch.clientSecret = clientSecret;
        }
        if (b.apiKey !== undefined) patch.apiKey = String(b.apiKey || "").trim();
        if (b.projectNumber !== undefined) patch.projectNumber = String(b.projectNumber || "").trim();
        if (!Object.keys(patch).length) return sendJson(res, 400, { error: "沒有可儲存的設定——請先填好內容再按儲存" });
        gs.saveConfig(patch);
        return sendJson(res, 200, { ok: true, ...gs.status() });
      }
      if (seg[2] === "token" && req.method === "GET") { // 供前端 Picker 用的短效 access token（使用者自己的 token、本機、經工作台鎖）
        if (!isLoopbackHost(req)) return sendJson(res, 403, { error: "此功能僅限本機存取" }); // QA #7：防 DNS rebinding 讀走 access token（2026-08-05：原行內重複的 Host-only regex 收斂為共用雙判函式，鐵律 4 同類一次修）
        try { return sendJson(res, 200, { access_token: await gs.getAccessToken() }); }
        catch (e) { return sendJson(res, ["NO_CONFIG", "NOT_CONNECTED", "AUTH_EXPIRED"].includes(e.code) ? 400 : 502, { error: errText(e), code: e.code }); }
      }
      if (seg[2] === "auth" && req.method === "GET") {
        try { res.writeHead(302, { Location: gs.getAuthUrl(GOOGLE_REDIRECT) }); return res.end(); }
        catch (e) { return sendJson(res, 400, { error: errText(e), code: e.code }); }
      }
      if (seg[2] === "callback" && req.method === "GET") {
        const back = (msg, ok) => { res.writeHead(302, { Location: "/?google=" + (ok ? "connected" : "error") + "&msg=" + encodeURIComponent(String(msg).slice(0, 160)) }); return res.end(); };
        const gerr = u.searchParams.get("error"), code = u.searchParams.get("code");
        if (gerr) return back(gerr, false);
        if (!code) return back("缺少授權碼", false);
        if (!gs.verifyState(u.searchParams.get("state"))) return back("安全驗證失敗（state 不符）——請重新點「用 Google 登入」", false); // QA #5 防 CSRF
        try { const t = await gs.exchangeCode(code, GOOGLE_REDIRECT); return back(t.email || "已連結", true); }
        catch (e) { console.error("[google] OAuth callback 失敗：" + errText(e)); return back(errText(e), false); }
      }
      if (seg[2] === "disconnect" && req.method === "POST") { gs.clearToken(); return sendJson(res, 200, { ok: true, ...gs.status() }); }
      if (seg[2] === "folder" && req.method === "POST") {
        const b = JSON.parse(await readBody(req) || "{}");
        const name = String(b.name || "").trim() || undefined;
        if (b.mode === "reset") { gs.saveConfig({ folderId: null, folderName: null }); return sendJson(res, 200, { ok: true, folder: null, ...gs.status() }); } // 移除關聯（不呼叫 Drive）＝下次建表再自動建新資料夾
        if (b.mode === "pick") { // Picker 選中的既有資料夾：驗證可存取＋取真名再存
          const fid = String(b.folderId || "").trim(); if (!fid) return sendJson(res, 400, { error: "沒有選到資料夾——請重新選一個資料夾" });
          try {
            const f = await gs.getFolder(fid);
            if (!f || f.mimeType !== "application/vnd.google-apps.folder") return sendJson(res, 400, { error: "選到的不是資料夾——請改選一個資料夾" });
            gs.saveConfig({ folderId: f.id, folderName: f.name });
            return sendJson(res, 200, { ok: true, folder: { id: f.id, name: f.name }, ...gs.status() });
          } catch (e) { return sendJson(res, ["NO_CONFIG", "NOT_CONNECTED", "AUTH_EXPIRED"].includes(e.code) ? 400 : 502, { error: errText(e), code: e.code }); }
        }
        try {
          const f = b.mode === "new" ? await gs.newFolder(name) : b.mode === "rename" ? await gs.renameFolder(name) : await gs.ensureFolder(name);
          return sendJson(res, 200, { ok: true, folder: f, ...gs.status() });
        } catch (e) { return sendJson(res, ["NO_CONFIG", "NOT_CONNECTED", "AUTH_EXPIRED"].includes(e.code) ? 400 : 502, { error: errText(e), code: e.code }); }
      }
      return sendJson(res, 404, { error: "unknown google endpoint" });
    }
    /* 防 DNS rebinding（QA）：所有 sheet-* 端點用 OAuth token 讀寫 Sheets、sheet-read 直接回傳 Sheet 內容，只准本機 Host */
    if (seg[0] === "api" && seg[1] === "runs" && seg[2] && /^sheet-/.test(seg[3] || "") && !isLoopbackHost(req)) return sendJson(res, 403, { error: "此功能僅限本機存取" });
    /* 廠商 Sheet 連結狀態（透明化：顯示這個活動目前連的是哪張表） */
    if (seg[0] === "api" && seg[1] === "runs" && seg[2] && seg[3] === "sheet-status" && req.method === "GET") {
      const m = readMeta(seg[2]) || {}, v = m.vendorSheet;
      return sendJson(res, 200, { linked: !!(v && v.spreadsheetId), url: (v && v.url) || null, updatedAt: (v && v.updatedAt) || null });
    }
    /* 解除連結：清掉這個活動的 vendorSheet，下次建立＝在目前資料夾建全新一張（解決「更新一直救回舊表」鬼打牆） */
    if (seg[0] === "api" && seg[1] === "runs" && seg[2] && seg[3] === "sheet-unlink" && req.method === "POST") {
      writeMeta(seg[2], { vendorSheet: null });
      appendLog(seg[2], "解除廠商 Sheet 連結（下次重新建立）");
      return sendJson(res, 200, { ok: true });
    }
    /* 每活動：建立/更新廠商 Google Sheet ＋ 讀回廠商變更（差異，供人工確認再套用） */
    if (seg[0] === "api" && seg[1] === "runs" && seg[2] && (seg[3] === "sheet-create" || seg[3] === "sheet-read") && req.method === "POST") {
      const id = seg[2]; const runDir = safeJoin(RUNS, id); if (!runDir) return sendJson(res, 400, { error: "bad id" });
      let draft; try { draft = JSON.parse(fs.readFileSync(path.join(runDir, "draft.json"), "utf8")); } catch (e) { return sendJson(res, 400, { error: "讀不到這個活動的草稿——請重新整理頁面後再試一次" }); }
      const meta = readMeta(id) || {};
      const codeToStatus = (e) => ["NO_CONFIG", "NOT_CONNECTED", "AUTH_EXPIRED"].includes(e.code) ? 400 : 502;
      if (seg[3] === "sheet-create") {
        /* F7-B（2026-07-29）：未上線活動不憑空組 live-drafts URL（檔案不在線上＝假連結；夏日淨計畫變更單實證）——
           空值交 vendor_sheet 落「活動尚未上線」指引文案；liveUrl/publicUrl 皆五階段全過才寫＝真值 */
        const previewUrl = meta.liveUrl || meta.publicUrl || null;
        const built = vsheet.buildVendorRows(draft, previewUrl);
        try {
          const existing = meta.vendorSheet && meta.vendorSheet.spreadsheetId;
          const alive = existing ? await gs.sheetAlive(existing) : false; // 防鬼打牆：舊表已丟垃圾桶/刪除＝改建新表
          let out;
          if (alive) { await gs.updateSheetValues(existing, built.rows); await gs.ensureInFolder(existing); out = { spreadsheetId: existing, url: meta.vendorSheet.url }; }
          else out = await gs.createSheet(built.title, built.rows, { headerRows: built.headerRows });
          // baseline＝建表當下的每列快照，讀回時當對齊真值基準（QA critical 根治：不靠列序/即時 draft）
          writeMeta(id, { vendorSheet: { spreadsheetId: out.spreadsheetId, url: out.url, updatedAt: new Date().toISOString(), rowCount: built.gdidOrder.length, baseline: built.baseline } });
          appendLog(id, `廠商 Google Sheet ${alive ? "更新" : "建立"}（${built.gdidOrder.length} 品）：${out.url}${existing && !alive ? "（舊表已刪＝改建新表）" : ""}`);
          return sendJson(res, 200, { ok: true, url: out.url, spreadsheetId: out.spreadsheetId, updated: alive, recreated: !!(existing && !alive), rowCount: built.gdidOrder.length });
        } catch (e) { return sendJson(res, codeToStatus(e), { error: errText(e), code: e.code }); }
      }
      // sheet-read
      const sid = meta.vendorSheet && meta.vendorSheet.spreadsheetId;
      if (!sid) return sendJson(res, 400, { error: "這個活動還沒建立廠商變更單——請先按「建立廠商變更單」" });
      try {
        const rows = await gs.readSheet(sid);
        const diff = vsheet.parseVendorEdits(rows, meta.vendorSheet.baseline); // 以建表鎖存的 baseline 對齊，非即時 draft
        appendLog(id, `讀回廠商 Sheet：${diff.ok ? diff.edits.length + " 筆變更" : "格式不符/需重建"}`);
        return sendJson(res, 200, { ok: diff.ok, url: meta.vendorSheet.url, ...diff });
      } catch (e) { return sendJson(res, codeToStatus(e), { error: errText(e), code: e.code }); }
    }
    /* R3 自動入池（2026-07-23 收斂會裁決＝更替商品自動 R3）：swap 套用時把 product-fetch 實抓真值
       寫入該 run 快照池＝CP-02 池存在性驗證鏈不斷（原人工 fetch_parse 檔頭 R3 機制的工作台自動化）；
       稽核＝snapshot.warnings 註記＋wb.log；desc 未抓（swap 標籤走 manual 豁免）、offer 留空不捏造 */
    if (seg[0] === "api" && seg[1] === "runs" && seg[3] === "r3-add" && req.method === "POST") {
      const id = seg[2]; const runDirR3 = safeJoin(RUNS, id); // 路徑穿越守門（同 :529 慣例）
      if (!runDirR3) return sendJson(res, 400, { error: "bad path" });
      const snapPath = path.join(runDirR3, "snapshot.json");
      if (!fs.existsSync(snapPath)) return sendJson(res, 404, { error: "run 或快照不存在" });
      const { product: p = {} } = JSON.parse(await readBody(req) || "{}");
      if (!p.gdid || !p.name || p.price == null || !p.url) { appendLog(id, `R3 入池拒絕：product-fetch 結果缺欄（gdid/name/price/url）——快照池可能缺 swap 品，gate CP-02 為後防`); return sendJson(res, 400, { error: "無法加入這件商品：讀不到它的必要資料（名稱／價格／連結）——請改用賣場編號重新挑一件在售商品" }); }
      const snap = JSON.parse(fs.readFileSync(snapPath, "utf8"));
      snap.products = snap.products || [];
      /* 2026-07-27 v2 根治（DJI 11697562 實證死循環）：既有 gdid＝重抓同一商品→同步「整組」來源真值
        （name/price/marketPrice/disc/url/imgs）。原「只刷 imgs、價格不動＝仍走套用新價」的假設不成立：
         applySwap 已把實抓價寫進 draft 列→draft==live→商品狀態無 drift、無「套用新價」鈕，而池價仍舊
         →CP-02「現價≠來源」永久 FAIL 且無動作可解。實抓真值信任等級同 apply-live-price（伺服器自抓）。 */
      const up = upsertPoolEntry(snap, p);
      if (up.mode === "sync" && !up.changed.length) return sendJson(res, 200, { ok: true, already: true });
      snap.warnings = snap.warnings || [];
      if (up.mode === "sync") snap.warnings.push(`R3 真值同步：gdid ${p.gdid} 更替重抓→同步 ${up.changed.join("、")}（${new Date().toISOString()}；根治 CP-02 現價≠來源／圖不在來源圖庫死循環）`);
      else snap.warnings.push(`R3 自動入池：gdid ${p.gdid}「${p.name}」＝工作台更替實抓真值（${new Date().toISOString()}；2026-07-23 收斂會裁決）；desc 未抓、offer 留空不捏造`);
      fs.writeFileSync(snapPath, JSON.stringify(snap, null, 1));
      appendLog(id, up.mode === "sync" ? `R3 真值同步：gdid ${p.gdid} 更替重抓→同步 ${up.changed.join("、")}` : `R3 自動入池：gdid ${p.gdid}（更替商品＝CP-02 池存在性收斂；2026-07-23 裁決）`);
      // 快照真值變動＝原核可 draft 脫鉤（同 apply-live-price 治理裁決：money-facing 需重新核可）；純新增入池不動既有真值＝不失效
      const approvalInvalidatedR3 = up.mode === "sync" ? invalidateApproval(id) : false;
      return sendJson(res, 200, { ok: true, mode: up.mode, refreshed: up.changed, approvalInvalidated: approvalInvalidatedR3 });
    }
    /* 編輯精選人工挑選（2026-07-25 使用者需求：AI 選不出品項時保留人工入稿）：以賣場編號/URL 手動加商品進
       編輯精選牆＋圓；真值走 productFetch＋r3-add 入池（CP-02 池存在性、CP-18 全頁互斥前置檢查）。 */
    if (seg[0] === "api" && seg[1] === "runs" && seg[3] === "editorial-add" && req.method === "POST") {
      const id = seg[2]; const rd = safeJoin(RUNS, id);
      if (!rd || !fs.existsSync(path.join(rd, "draft.json"))) return sendJson(res, 404, { error: "run 或 draft 不存在" });
      if (!fs.existsSync(path.join(rd, "snapshot.json"))) return sendJson(res, 409, { error: "這個活動缺少來源商品資料，無法自動補入商品——請重新建立這個活動，或改到其他區塊編修", needManual: true }); // 2026-07-27 根治(AC-17)：原 auto 分支/入池直接 readFileSync 缺檔＝拋例外落外層 catch 回 500 raw；前置存在性守衛回友善 needManual
      const _bl = busyLock(id); if (_bl) return sendJson(res, 409, { error: _bl });
      const body = JSON.parse(await readBody(req) || "{}");
      const dj = JSON.parse(fs.readFileSync(path.join(rd, "draft.json"), "utf8"));
      const exposed = pageExposedGdids(dj); // 2026-08-26 抽出共用（牆/樓層加商品批）：邏輯零改動
      let np, autoPicked = false;
      if (body.auto) { // 🤖 AI 自動補（2026-07-27）：抽出共用 autoPickFromPool——池過濾＋折數最佳＋即時驗證（訊息原樣）
        const ap = await autoPickFromPool(rd, exposed);
        if (ap.error) return sendJson(res, 409, ap);
        np = ap.product; autoPicked = true;
      } else {
        const r = await productFetch({ url: body.url });
        if (r.code !== 200) return sendJson(res, r.code, { error: r.error });
        np = r.product;
        if (exposed.has(String(np.gdid)) && !heroGdidSet(dj).has(String(np.gdid))) return sendJson(res, 409, { error: `這件商品已經用在頁面其他地方了（每件商品只能出現一次；主視覺除外＝2026-10-05 裁決可重複）——請換一件` });
      }
      const cutW = (s, n) => { let w = 0, out = ""; for (const ch of String(s)) { w += ch.charCodeAt(0) > 255 ? 1 : 0.55; if (w > n) break; out += ch; } return out; };
      // 入池真值（同 r3-add 稽核形；2026-07-27 v2 改 upsert＝既有 gdid 也同步整組真值，與 r3-add 同一類死循環根治）
      const snapPath = path.join(rd, "snapshot.json"); const snap = JSON.parse(fs.readFileSync(snapPath, "utf8"));
      const upE = upsertPoolEntry(snap, np, "R3:editorial-manual");
      { const aE = contentModules.alignDraftRowTruth(dj.products, np); if (aE.length) appendLog(id, `編輯精選挑品：草稿名稱同批收斂（gdid ${np.gdid}）`); } // 名稱兩式 2026-10-05：本流程稍後本來就會寫草稿
      if (upE.mode === "add" || upE.changed.length) {
        snap.warnings = (snap.warnings || []).concat(upE.mode === "add"
          ? `R3 入池（編輯精選人工挑選）：gdid ${np.gdid}「${np.name}」（${new Date().toISOString()}）`
          : `R3 真值同步（編輯精選）：gdid ${np.gdid} 同步 ${upE.changed.join("、")}（${new Date().toISOString()}）`);
        fs.writeFileSync(snapPath, JSON.stringify(snap, null, 2));
      }
      if (!dj.page.editorial) dj.page.editorial = { title: [cutW(dj.page.curationTheme || dj.page.pageName || "編輯精選", 6), "嚴選推薦", "編輯室嚴選提案"], circles: [] };
      const edWall = (dj.products || []).filter((p) => p && p.position === "editorial-wall");
      const order = edWall.length + 1;
      dj.products.push(Object.assign({ gdid: String(np.gdid), position: "editorial-wall", order,
        name: np.name, price: np.price, url: np.url, img: (np.imgs || [])[0], sceneImg: (np.imgs || [])[1] || (np.imgs || [])[0],
        imgOptions: (np.imgs || []).slice(0, 5), offer: "", tag: "", tagSource: "manual" },
        (typeof np.marketPrice === "number" && np.marketPrice > np.price) ? { marketPrice: np.marketPrice } : {},
        np.store ? { store: np.store } : {})); // 賣場名稱（2026-08-26 店名欄）：實抓有才帶、缺席不留空字串
      // 前 2 件牆商品同步當精選圓（缺圓才補；圓文案人工可再改）
      if ((dj.page.editorial.circles || []).length < 2) {
        // 圓 img 解析度守門（2026-08-26 80×80 病例根治）：候選鏈 imgs[1..]→退主圖、實測寬 ≥300（img_probe 單一真源）；探測失敗/全不合格＝wb.log 出聲照實用
        const pickC = await imgProbe.pickCircleImg(np.imgs);
        pickC.notes.forEach((n) => appendLog(id, `編輯精選圓（gdid ${np.gdid}）：${n}`));
        dj.page.editorial.circles = (dj.page.editorial.circles || []).concat([{ tag: cutW(np.name, 7), copy: cutW(np.name, 18), date: "", img: pickC.img, url: np.url }]);
      }
      let v = 1; while (fs.existsSync(path.join(rd, `draft.v${v}.json`))) v++;
      fs.copyFileSync(path.join(rd, "draft.json"), path.join(rd, `draft.v${v}.json`));
      fs.writeFileSync(path.join(rd, "draft.json"), JSON.stringify(dj, null, 1));
      reconcileProductCheckFile(rd, dj); // 幽靈列對帳（2026-08-30 同類全掛：編輯精選加一件也會動 products[]）
      appendLog(id, `編輯精選${autoPicked ? "自動補一件" : "人工加入"}：gdid ${np.gdid}「${cutW(np.name, 16)}」＝牆第 ${order} 件（備份 draft.v${v}.json）`);
      const approvalInvalidatedE = invalidateApproval(id);
      return sendJson(res, 200, { ok: true, draft: dj, wallCount: order, gdid: String(np.gdid), name: np.name, autoPicked, approvalInvalidated: approvalInvalidatedE });
    }
    /* editorial/explore 機械補生成（2026-07-23 使用者指示＝14 §8 待審②③定案）：功能上線前的舊稿一鍵補內容。
       選品＝未曝光池（對現稿全曝光集合過濾＝CP-18 天然安全）；探索目的地＝真值 URL 限定（來源頁＋首則在線活動）；
       備份 draft.vN＋wb.log 稽核（同 PUT 回存慣例）；新稿由引擎內建生成、本端點僅供既有活動補齊 */
    if (seg[0] === "api" && seg[1] === "runs" && seg[3] === "enrich-ee" && req.method === "POST") {
      const id = seg[2]; const runDirE = safeJoin(RUNS, id);
      if (!runDirE) return sendJson(res, 400, { error: "bad path" });
      const _bl = busyLock(id); if (_bl) return sendJson(res, 409, { error: _bl });
      const dp = path.join(runDirE, "draft.json"), sp = path.join(runDirE, "snapshot.json");
      if (!fs.existsSync(dp) || !fs.existsSync(sp)) return sendJson(res, 404, { error: "run 缺 draft 或 snapshot" });
      const dj = JSON.parse(fs.readFileSync(dp, "utf8"));
      const snapE = JSON.parse(fs.readFileSync(sp, "utf8"));
      const exposed = pageExposedGdids(dj); // 2026-08-26 抽出共用（牆/樓層加商品批）：邏輯零改動
      const poolE = (snapE.products || []).filter((p) => p && p.gdid && p.name && typeof p.price === "number" && p.imgs && p.imgs[0] && !exposed.has(String(p.gdid)));
      if (poolE.length < 6) return sendJson(res, 409, { needManual: true, available: poolE.length,
        error: `這個活動的商品不夠自動生成編輯精選——目前只剩 ${poolE.length} 件沒被其他區塊用到（需要至少 6 件：2 個精選圓＋4 件商品牆）。你可以改用「人工挑選商品加入」用賣場編號自己加，或讓這個區塊留空。` });
      poolE.sort((a, b) => (a.disc == null ? 999 : a.disc) - (b.disc == null ? 999 : b.disc));
      const cutW = (s, n) => { let w = 0, out = ""; for (const ch of String(s)) { w += ch.charCodeAt(0) > 255 ? 1 : 0.55; if (w > n) break; out += ch; } return out; };
      const circles = poolE.slice(0, 2); let cur = 2;
      let take = 0; for (const s of [12, 8, 4]) if (poolE.length - cur >= s) { take = s; break; }
      const wallItems = poolE.slice(cur, cur + take); cur += take;
      const themeLabel = dj.page.curationTheme || dj.page.pageName || "本檔";
      const l1 = cutW(themeLabel, 6);
      const l2 = String(themeLabel).slice(l1.length) ? cutW(String(themeLabel).slice(l1.length), 6) : "嚴選推薦";
      // 圓 img 解析度守門（2026-08-26 80×80 病例根治）：候選鏈 imgs[1..]→退主圖、實測寬 ≥300（img_probe 單一真源）；探測失敗/全不合格＝wb.log 出聲照實用
      const circleRows = [];
      for (const p of circles) {
        const pickC = await imgProbe.pickCircleImg(p.imgs);
        pickC.notes.forEach((n) => appendLog(id, `編輯精選圓（gdid ${p.gdid}）：${n}`));
        circleRows.push({ tag: cutW(p.offer || p.name, 7), copy: cutW(p.name, 18), date: "", img: pickC.img, url: p.url });
      }
      dj.page.editorial = {
        title: [l1, l2, "編輯室嚴選提案"],
        circles: circleRows
      };
      dj.products = (dj.products || []).filter((p) => !(p && p.position === "editorial-wall"));
      wallItems.forEach((p, i) => dj.products.push(Object.assign(
        { gdid: String(p.gdid), position: "editorial-wall", order: i + 1,
          name: p.name, price: p.price, url: p.url, img: p.imgs[0], sceneImg: p.imgs[1] || p.imgs[0],
          offer: p.offer || "", tag: p.offer || "", tagSource: p.offer ? "offer" : null },
        (typeof p.marketPrice === "number" && p.marketPrice > p.price) ? { marketPrice: p.marketPrice } : {},
        p.store ? { store: p.store } : {}))); // 賣場名稱（2026-08-26 店名欄）：池有才帶、缺席不留空字串
      const exploreItemsE = [];
      const srcUrl = snapE.sourceUrl || (dj.meta || {}).sourceUrl || "";
      if (srcUrl) exploreItemsE.push({ label: cutW(`前往${themeLabel}來源頁`, 12), sub: "完整選品一次看", img: (poolE[cur] || poolE[0]).imgs[0], url: srcUrl });
      const nowS = Math.floor(Date.now() / 1000);
      const prE = (snapE.promotions || []).find((x) => x && x.url && x.title && !(typeof x.endTs === "number" && x.endTs < nowS));
      if (prE) { const fi = (snapE.products || []).find((p) => p && String(p.actid || "") === String(prE.actid) && p.imgs && p.imgs[0]);
        if (fi && String(prE.url) !== String(srcUrl)) exploreItemsE.push({ label: "看更多優惠活動", sub: "檔期優惠一覽", img: fi.imgs[0], url: prE.url }); }
      if (exploreItemsE.length) dj.page.explore = { moreUrl: srcUrl || exploreItemsE[0].url, ctaText: dj.page.ctaText || `看更多${themeLabel}選品`, items: exploreItemsE };
      let v = 1; while (fs.existsSync(path.join(runDirE, `draft.v${v}.json`))) v++;
      fs.copyFileSync(dp, path.join(runDirE, `draft.v${v}.json`));
      fs.writeFileSync(dp, JSON.stringify(dj, null, 1));
      appendLog(id, `editorial/explore 機械補生成（14 §8 ②③定案 2026-07-23）：圓×2＋牆 ${take} 件＋探索 ${exploreItemsE.length} 卡＝未曝光池；備份 draft.v${v}.json`);
      const approvalInvalidatedEE = invalidateApproval(id);
      return sendJson(res, 200, { ok: true, draft: dj, wallCount: take, exploreCount: exploreItemsE.length, backup: `draft.v${v}.json`, approvalInvalidated: approvalInvalidatedEE });
    }
    /* 延伸探索失效修復（2026-07-27 使用者需求：檢查得到「活動已結束」但沒有出路——⚙ 重新生成是整批重排、
       且探索目的地取自可能已過期的快照促銷）。單卡兩通道，真值全伺服器實抓：
       auto＝重抓「來源頁」現在在檔的活動（parseBrandPage ec_promotions→pickLivePromo→驗活動頁在線＋取檔內商品圖）；
             無在檔活動＝退主題搜尋目的地（驗有結果）；都沒有＝回 needManual 引導手動。
       manual＝人工貼站內連結（僅 tw.buy.yahoo.com；依類型驗活：活動在檔／搜尋有結果／商品在售）。
       兩通道皆：CP-12 同模組唯一守門＋draft.vN 備份＋wb.log 稽核＋invalidateApproval（G3 已登記 draft-writers.allow）。 */
    if (seg[0] === "api" && seg[1] === "runs" && seg[3] === "explore-fix" && req.method === "POST") {
      const id = seg[2]; const rdX = safeJoin(RUNS, id);
      if (!rdX) return sendJson(res, 400, { error: "bad path" });
      const _bl = busyLock(id); if (_bl) return sendJson(res, 409, { error: _bl });
      // 修復互斥（QA #5/#8）：驗活耗時 5–10 秒，同 run 並發修復＝後寫盤者以舊 draft 蓋掉先完成者
      if (exploreFixLocks.has(id)) return sendJson(res, 409, { error: "另一張探索卡正在修復中——等它完成（約 10 秒）再操作" });
      exploreFixLocks.add(id);
      try {
      const dpX = path.join(rdX, "draft.json"), spXp = path.join(rdX, "snapshot.json");
      if (!fs.existsSync(dpX)) return sendJson(res, 404, { error: "run 或 draft 不存在" });
      const bodyX = JSON.parse(await readBody(req) || "{}");
      const djX = JSON.parse(fs.readFileSync(dpX, "utf8"));
      const itemsX = (((djX.page || {}).explore || {}).items) || [];
      /* 「看更多」按鈕的去向（2026-09-25 使用者裁甲-1）。
         病例：使用者反覆被同一條紅字擋住——「換掉延伸探索卡『看更多⋯』的去向」。
         那顆按鈕**真的存在也真的可以點**（2026-09-25 使用者在預覽上親眼確認＋實測可點擊），
         href 指向查無結果的分類頁 ⇒ 消費者按下去會進空頁。
         但畫面上唯一能按的「重新生成探索內容」其實是 jumpToEnrich()——只是跳去別的面板、
         不修這個欄位；而 moreUrl 的產生公式是 `snap.sourceUrl || exploreItems[0].url`，
         來源頁本身查無結果時**重生成幾次都會再指回同一個壞連結**＝反覆按也出不來。
         做法＝改指向第一張探索卡的去向（那張已經驗過活），語意上「看更多」帶去同一個主題。
         ⚠️ 2026-09-24 曾一度判定「這條檢查在抓幽靈」而要把它關掉，動手前最後一驗才發現
         按鈕是真的——**關掉等於讓壞按鈕悄悄上線給消費者點**。這段註解留著，免得下一個人再判一次。 */
      if (String(bodyX.target || "") === "more") {
        /* 2026-09-25 使用者裁「甲改」：原設計是「複製第一張探索卡的去向」，但實測發現
           第一張卡本身也可能指向同一個壞連結（本例兩者都是 category/4436714）⇒ 複製過去等於沒改，
           換個位置的死路。改用**跟探索卡完全同一套**：去來源頁實抓、挑還在檔期的活動、
           逐一驗活動頁本身在線才套用（不盲信列表檔期——2026-07-27 實證列表說在檔、頁面已結束）。 */
        const exX = (djX.page || {}).explore || {};
        const snapM = fs.existsSync(spXp) ? JSON.parse(fs.readFileSync(spXp, "utf8")) : null;
        const nowSM = Math.floor(Date.now() / 1000);
        const fetchRM = async (u) => { try { return await fetchPage(u); } catch (e) { await new Promise((r) => setTimeout(r, 800)); return fetchPage(u); } };
        let candM = [];
        if (snapM && snapM.sourceUrl) {
          try { candM = parseBrandPage((await fetchRM(snapM.sourceUrl)).html).promotions || []; }
          catch (e) { appendLog(id, `看更多修復：來源頁重抓失敗（${e.message}）——改用快照促銷清單（仍逐一驗頁活）`); }
        }
        if (!candM.length && snapM) candM = snapM.promotions || [];
        /* 已用過的目的地不重複（含探索卡與現在的 moreUrl）——「看更多」跟卡片指同一個地方沒有意義 */
        const triedM = new Set((exX.items || []).map((it) => it && it.url).filter(Boolean).map(normalizeLinkUrl));
        if (exX.moreUrl) triedM.add(normalizeLinkUrl(exX.moreUrl));
        let pickedM = null, howM = "", shellM = 0;
        for (let k = 0; k < 6 && !pickedM; k++) {
          const cand = pickLivePromo(candM, triedM, nowSM);
          if (!cand) break;
          triedM.add(normalizeLinkUrl(cand.url));
          try {
            const rAct = await fetchRM(cand.url);
            const clA = classifyLiveness(rAct.html, rAct.statusCode);
            if (clA.status !== "online" && isShellPage(clA.evidence)) { shellM++; appendLog(id, `看更多修復：候選 actid ${cand.actid} 遭 Yahoo 殼頁——跳過`); continue; }
            if (clA.status !== "online") { appendLog(id, `看更多修復：候選 actid ${cand.actid}「${cand.title}」非在線（${clA.status}）——試下一檔`); continue; }
            pickedM = cand;
            howM = `改指向在檔活動「${cand.title}」（來源頁實抓、頁面驗證在檔；檔期 ${cand.period || "—"}）`;
          } catch (e) { appendLog(id, `看更多修復：候選驗證失敗（${e.message}）——試下一檔`); }
        }
        if (!pickedM) {
          return sendJson(res, 400, { needManual: true, error: shellM
            ? `目前讀不到來源頁的活動清單（Yahoo 暫時擋住自動驗證，跳過 ${shellM} 檔）——請稍後再試，或用「手動改連結」自己貼一個。`
            : "來源頁上目前找不到還在檔期、而且頁面上還沒用過的活動——請用「手動改連結」自己貼一個站內連結。" });
        }
        const beforeM = String(exX.moreUrl || "");
        exX.moreUrl = String(pickedM.url);
        djX.page.explore = exX;
        fs.writeFileSync(dpX, JSON.stringify(djX, null, 2));
        appendLog(id, `探索「看更多」去向：${beforeM} → ${pickedM.url}（${howM}）`);
        return sendJson(res, 200, { ok: true, target: "more", moreUrl: exX.moreUrl, how: howM, draft: djX });
      }
      /* 新增一張（2026-10-07 使用者需求）：append＝idx 落在尾端新位，驗證與寫入沿用修復同一條路（不另寫一套驗證） */
      const appendX = bodyX.append === true;
      if (appendX && itemsX.length >= EXPLORE_ITEMS_CAP) return sendJson(res, 400, { error: `探索入口最多 ${EXPLORE_ITEMS_CAP} 個（桌機一排放得下的上限）——要放更多內容，用品類牆或樓層` });
      if (appendX && String(bodyX.mode || "") === "manual" && !String(bodyX.label || "").trim()) return sendJson(res, 400, { error: "新增探索入口要先給「主文案」——卡片上那行粗體字（之後在面板還能改）" });
      const idxX = appendX ? itemsX.length : Number(bodyX.index);
      if (!Number.isInteger(idxX) || idxX < 0 || (!appendX && idxX >= itemsX.length)) return sendJson(res, 400, { error: "找不到這張探索卡——請重新整理頁面再試" });
      /* 移除一張探索卡（2026-10-07 使用者反饋：系統生了第二個入口、只能換連結不能刪＝多餘的卡把人卡死）。
         守門：至少留一張——0 張＝引擎整區隱藏降級，那個型態沒驗證過；要連整區收掉屬版面裁決，不在這裡開門。
         家族行為照 editorial 補生成：寫盤前備份 draft.vN＋核可失效；gate 消費端（曝光集、連結檢查鍵）都是逐張讀陣列＝少一張自然跟上。 */
      if (String(bodyX.action || "") === "remove") {
        if (itemsX.length <= 1) return sendJson(res, 400, { error: "只剩一張探索卡，至少要留一張——要連「延伸探索」整區收掉屬版面調整，請跟負責人說一聲" });
        let vR = 1; while (fs.existsSync(path.join(rdX, `draft.v${vR}.json`))) vR++;
        fs.copyFileSync(dpX, path.join(rdX, `draft.v${vR}.json`));
        const removedX = itemsX.splice(idxX, 1)[0] || {};
        djX.page.explore.items = itemsX;
        fs.writeFileSync(path.join(rdX, "draft.json"), JSON.stringify(djX, null, 1)); // 字面路徑＝G3 絆線可計數（勿改用變數）；縮排 null,1 與修復路一致——審查高-2（2026-10-08）
        const approvalInvalidatedR = invalidateApproval(id);
        appendLog(id, `探索卡 #${idxX + 1} 移除：「${String(removedX.label || "")}」→ ${String(removedX.url || "")}（剩 ${itemsX.length} 張；備份 draft.v${vR}.json）`);
        return sendJson(res, 200, { ok: true, removed: true, index: idxX, itemsLeft: itemsX.length, backup: `draft.v${vR}.json`, draft: djX, approvalInvalidated: approvalInvalidatedR });
      }
      const itemX = itemsX[idxX] || {};
      const cutX = (s, n) => { let w = 0, out = ""; for (const ch of String(s || "")) { w += ch.charCodeAt(0) > 255 ? 1 : 0.55; if (w > n) break; out += ch; } return out; };
      // 整頁已用目的地（排除本卡）＝CP-12 同模組唯一（FAIL 級）＋避免跨模組重複（WARN 級）
      const usedX = new Set();
      itemsX.forEach((e, i) => { if (i !== idxX && e && e.url) usedX.add(normalizeLinkUrl(e.url)); });
      if (djX.page.explore.moreUrl) usedX.add(normalizeLinkUrl(djX.page.explore.moreUrl));
      (djX.page.promoEntries || []).forEach((e) => e && e.url && usedX.add(normalizeLinkUrl(e.url)));
      (((djX.page.editorial || {}).circles) || []).forEach((c) => c && c.url && usedX.add(normalizeLinkUrl(c.url)));
      (djX.page.floors || []).forEach((f) => f && f.sceneUrl && usedX.add(normalizeLinkUrl(f.sceneUrl)));

      let nextX = null, howX = "", manualUnsureX = ""; // manualUnsureX＝人工填入但我們認不出頁上有無商品（2026-09-25 三態）
      if (bodyX.mode === "manual") {
        const mu = String(bodyX.url || "").trim();
        const tX = classifyLinkTarget(mu);
        if (tX.kind === "invalid" || tX.kind === "external") return sendJson(res, 400, { error: "只接受 Yahoo購物中心站內連結（https://tw.buy.yahoo.com/…）——活動頁、搜尋頁或商品頁都可以" });
        if (usedX.has(normalizeLinkUrl(mu))) return sendJson(res, 409, { error: "這個連結已用在頁面上其他入口——同一個目的地整頁只放一次，請換一個" });
        let r0 = null; /* 提出 try 外（2026-10-07 新增入口批）：新增的卡沒有舊圖可沿用，驗完要用同一份 html 盡力抓第一件商品圖 */
        try { // 真值鐵律：伺服器驗活後才收，不收會把訪客帶去空頁的連結
          r0 = tX.kind === "product" ? null : await fetchPage(mu); // 商品頁不在這裡抓——走 productLiveness（兩種拼法＋證據，PRODUCT-DEAD-TWO-URLS）
          if (tX.kind === "activity") {
            const c0 = classifyLiveness(r0.html, r0.statusCode);
            if (c0.status !== "online" && isShellPage(c0.evidence)) return sendJson(res, 503, { error: "Yahoo 暫時擋住了自動驗證（頁面讀不到內容）——請過幾分鐘再試一次" });
            if (c0.status !== "online") return sendJson(res, 400, { error: c0.status === "dead" ? "這個活動頁打不開——請確認網址" : "這檔活動已結束——請換一檔還在檔期的活動" });
          } else if (tX.kind === "search") {
            /* 三態（2026-09-25）：只有「頁面打不開」才擋。原本 !== "online" 一律擋，等於把
               「我認不出」當成「它是空的」——使用者貼了有 56 件商品的分類頁照樣被 400 擋死、
               而且畫面上沒有第二條路可走（病例＝category/31012821）。認不出＝收下＋出聲請他確認。 */
            const svX = classifySearchLiveness(r0.html, r0.statusCode);
            if (svX === "dead") return sendJson(res, 400, { error: "這個頁面打不開——請確認網址能在瀏覽器開啟後再貼一次" });
            if (svX === "unverified") manualUnsureX = "（我認不出這頁有沒有商品，已照你貼的收下——請自己點開確認一次）";
          } else if (tX.kind === "product") {
            const c0 = await productLiveness({ gdid: tX.gdid, url: mu });
            if (c0.status !== "online") return sendJson(res, 400, { error: "這件商品目前不能用（已下架或連結失效）——請換一件在售商品", evidence: c0.evidence });
          } else if (r0.statusCode !== 200) { // other 型（分類頁等站內合法頁）：至少驗 HTTP 200（QA #4：原 404 也照收、還記「已驗有效」）
            return sendJson(res, 400, { error: `這個連結打不開（HTTP ${r0.statusCode}）——請確認網址能在瀏覽器開啟後再貼` });
          }
        } catch (e) { return sendJson(res, 502, { error: "讀取這個連結失敗——請確認網址能在瀏覽器打開後再試一次（技術訊息：" + errText(e) + "）" }); }
        nextX = { label: cutX(bodyX.label || itemX.label, 12) || itemX.label || "", sub: cutX(bodyX.sub || itemX.sub, 14) || (appendX ? "完整選品一次看" : ""), img: itemX.img || "", url: mu };
        /* 卡沒有圖（2026-10-07 新增；2026-10-08 擴到修復路＋搜尋頁解析）：盡力從剛驗過的頁面抓第一件商品圖；抓不到＝留空、引擎端畫中性圓不破圖 */
        if (!nextX.img && r0 && r0.html) {
          try { const paA = parseActivityPage(r0.html); const fpA = (paA.products || []).find((p) => p && p.imgs && p.imgs[0]); if (fpA) nextX.img = fpA.imgs[0]; } catch (e) { /* 活動頁解析失敗＝試下一招 */ }
          if (!nextX.img) { try { const hsM = parseListingHits(r0.html) || []; const hM = hsM.find((x) => x && (x.img || (x.imgs && x.imgs[0]))); if (hM) nextX.img = hM.img || hM.imgs[0]; } catch (e) { /* 搜尋頁也抓不到＝留空 */ } }
        }
        howX = manualUnsureX ? ("人工填入" + manualUnsureX) : "人工填入（伺服器已驗連結有效）"; // 認不出時不得自稱「已驗有效」＝不吞不確定
      } else {
        // auto：來源頁實抓「現在在檔」活動→逐候選驗頁活＋取該檔第一件商品圖（圖與內容同檔＝不掛羊頭）
        let snapX2 = null; try { snapX2 = JSON.parse(fs.readFileSync(spXp, "utf8")); } catch (e) { appendLog(id, "探索修復：讀不到快照（" + errText(e) + "）——僅能走搜尋退路"); }
        const nowSX = Math.floor(Date.now() / 1000);
        const fetchRX = async (u) => { try { return await fetchPage(u); } catch (e) { await new Promise((r) => setTimeout(r, 800)); return fetchPage(u); } }; // Yahoo 搜尋端點會間歇 500＝重試一次（price_qa 慣例；e2e 實證兩路徑同時被 500 打死）
        // 候選池：來源頁實抓為主（最新檔）；實抓失敗＝退快照 promotions（仍逐一驗頁活、不盲信舊檔期）
        let candX = [];
        if (snapX2 && snapX2.sourceUrl) {
          try { candX = parseBrandPage((await fetchRX(snapX2.sourceUrl)).html).promotions || []; }
          catch (e) { appendLog(id, `探索修復：來源頁重抓失敗（${errText(e)}）——改用快照促銷清單（仍逐一驗頁活）`); }
        }
        if (!candX.length && snapX2) candX = snapX2.promotions || [];
        /* 逐一驗證（最多 6 檔）：列表檔期與活動頁自身檔期會不同步（2026-07-27 實證：列表說到今晚、
           頁面已標結束）——一律以「活動頁本身」classifyLiveness 為準，絕不把列表檔期傳入判活。 */
        const triedX = new Set(usedX);
        let shellSkips = 0; // Yahoo 軟擋殼頁跳過數（訊息要誠實：讀不到≠沒有在檔活動）
        for (let k = 0; k < 6 && !nextX; k++) {
          const picked = pickLivePromo(candX, triedX, nowSX);
          if (!picked) break;
          triedX.add(normalizeLinkUrl(picked.url));
          try {
            const rAct = await fetchRX(picked.url);
            const clA = classifyLiveness(rAct.html, rAct.statusCode);
            if (clA.status !== "online" && isShellPage(clA.evidence)) { shellSkips++; appendLog(id, `探索修復：候選 actid ${picked.actid} 遭 Yahoo 殼頁（暫時擋自動驗證）——跳過`); continue; }
            if (clA.status !== "online") { appendLog(id, `探索修復：候選 actid ${picked.actid}「${cutX(picked.title, 12)}」頁面非在線（${clA.status}）——試下一檔`); continue; }
            let imgX = itemX.img || "";
            const pa = parseActivityPage(rAct.html);
            const fp = (pa.products || []).find((p) => p && p.imgs && p.imgs[0]);
            if (fp) imgX = fp.imgs[0];
            nextX = { label: cutX(picked.title, 12) || itemX.label || "", sub: "檔期優惠一覽", img: imgX, url: picked.url };
            howX = `AI 換成在檔活動「${picked.title}」（來源頁實抓、頁面驗證在檔；檔期 ${picked.period || "—"}）`;
            if (snapX2) { // 真值稽核：新促銷入快照 promotions（gate/後續重組可溯源）
              snapX2.promotions = snapX2.promotions || [];
              if (!snapX2.promotions.some((x) => String(x.actid) === String(picked.actid))) {
                snapX2.promotions.push(picked);
                snapX2.warnings = (snapX2.warnings || []).concat(`探索修復：actid ${picked.actid}「${picked.title}」＝來源頁重抓在檔活動（${new Date().toISOString()}）`);
                fs.writeFileSync(spXp, JSON.stringify(snapX2, null, 1));
              }
            }
          } catch (e) { appendLog(id, `探索修復：候選活動頁讀取失敗（${errText(e)}）——試下一檔`); }
        }
        if (!nextX) { // 搜尋退路：主題詞、驗有結果
          const kwX = String(djX.page.curationTheme || djX.page.pageName || "").split(/[_｜|]/)[0].trim();
          const suX = "https://tw.buy.yahoo.com/search/product?p=" + encodeURIComponent(kwX);
          if (kwX && !usedX.has(normalizeLinkUrl(suX))) {
            try {
              const rS = await fetchRX(suX);
              /* 這裡刻意維持「只收 online」——與上面手動填入放寬 unverified 是不對稱的，而且是故意的：
                 手動＝人自己挑的目的地，我們沒資格因為認不出就擋他；自動＝我們替他決定，
                 認不出就不該自作主張塞進頁面。放寬這裡＝AI 可能自動換上一個空頁（2026-09-25）。 */
              if (classifySearchLiveness(rS.html, rS.statusCode) === "online") {
                /* 搜尋退路也要帶圖（2026-10-08 使用者實測：新增兩張搜尋目的地卡全破圖）——搜尋頁用 parseListingHits 取第一件商品圖 */
                let imgS = itemX.img || "";
                if (!imgS) { try { const hs0 = parseListingHits(rS.html) || []; const h0 = hs0.find((x) => x && (x.img || (x.imgs && x.imgs[0]))); if (h0) imgS = h0.img || h0.imgs[0]; } catch (e) { /* 抓不到圖不擋 */ } }
                nextX = { label: cutX(`更多${kwX}選品`, 12), sub: "搜尋結果一次看", img: imgS, url: suX };
                howX = `AI 換成搜尋目的地「${kwX}」（來源頁暫無在檔活動；已驗有結果）`;
              }
            } catch (e) { appendLog(id, `探索修復：搜尋退路驗證失敗（${errText(e)}）`); }
          }
        }
        if (!nextX) return sendJson(res, 409, { needManual: true, error: shellSkips
          ? "Yahoo 暫時擋住了自動驗證（候選活動頁讀不到內容）——請過幾分鐘再按一次「AI 換在檔內容」，或改用「手動改連結」"
          : "來源頁目前沒有還在檔期的活動、主題搜尋也沒有結果——請用「手動改連結」貼一個站內連結（活動頁／搜尋頁／商品頁都可以）" });
      }
      /* 寫盤前重讀合併（QA #5/#7）：驗活耗時 5–10 秒，期間使用者可能已儲存其他編修——
         整份用開頭讀的舊 djX 寫回＝把那些編修蓋掉。改為只把「這張卡」落到最新磁碟稿上。 */
      const djW = JSON.parse(fs.readFileSync(dpX, "utf8"));
      const itemsW = (((djW.page || {}).explore || {}).items) || [];
      if (appendX) { /* 新增：重讀後再驗一次上限（驗活的 5~10 秒窗口內可能有別的操作加了卡） */
        if (!djW.page || !djW.page.explore) return sendJson(res, 409, { error: "這檔目前沒有「延伸探索」區塊——先到「編輯精選」按「一鍵生成」把整區補上，再來新增入口" }); /* 審查中-1（2026-10-08）：原本缺節點＝push 進孤兒陣列、回 200 卻沒寫進草稿＝靜默丟卡 */
        if (itemsW.length >= EXPLORE_ITEMS_CAP) return sendJson(res, 409, { error: `探索入口已滿 ${EXPLORE_ITEMS_CAP} 個（操作期間有別的變更）——請重新整理頁面確認` });
        itemsW.push(nextX);
        djW.page.explore.items = itemsW; /* items 原缺鍵時 itemsW 是預設空陣列＝掛回去（節點在、items 缺的半種） */
      } else {
        if (idxX >= itemsW.length) return sendJson(res, 409, { error: "探索卡數量已變動（可能剛重新生成過）——請到「發佈前檢查」按「重新檢查」更新報告後再操作" });
        itemsW[idxX] = nextX;
      }
      let vX = 1; while (fs.existsSync(path.join(rdX, `draft.v${vX}.json`))) vX++;
      fs.copyFileSync(path.join(rdX, "draft.json"), path.join(rdX, `draft.v${vX}.json`));
      fs.writeFileSync(path.join(rdX, "draft.json"), JSON.stringify(djW, null, 1)); // 字面路徑＝G3 絆線可計數（勿改用變數）
      reconcileProductCheckFile(rdX, djW); // 幽靈列對帳（2026-08-30 同類全掛：編輯精選整牆重建會整批換 products[] 的 editorial-wall 列）
      appendLog(id, appendX ? `探索卡 #${idxX + 1} 新增：${howX}→${nextX.url}（共 ${itemsW.length} 張；備份 draft.v${vX}.json）` : `探索卡 #${idxX + 1} 連結修復：${howX}→${nextX.url}（備份 draft.v${vX}.json）`);
      const approvalInvalidatedX = invalidateApproval(id);
      return sendJson(res, 200, { ok: true, index: idxX, item: nextX, how: howX, appended: appendX, itemsCount: itemsW.length, draft: djW, backup: `draft.v${vX}.json`, approvalInvalidated: approvalInvalidatedX });
      } finally { exploreFixLocks.delete(id); }
    }
    /* CP-14 主題契合詞組檢視/編修（2026-07-25 design QA：CP-14 條文早允許人工詞組、原僅能手改磁碟檔＝UI 斷點） */
    if (seg[0] === "api" && seg[1] === "runs" && seg[3] === "feedback-patch") {
      const id = seg[2]; const rdF = safeJoin(RUNS, id);
      if (!rdF || !fs.existsSync(rdF)) return sendJson(res, 404, { error: "run 不存在" });
      const fp = path.join(rdF, "feedback_patch.json");
      if (req.method === "GET") {
        let j = null; try { j = JSON.parse(fs.readFileSync(fp, "utf8")); } catch (e) {}
        return sendJson(res, 200, { themeFitRule: (j && j.themeFitRule) || null });
      }
      if (req.method === "PUT") {
        const _bl = busyLock(id); if (_bl) return sendJson(res, 409, { error: _bl });
        const body = JSON.parse(await readBody(req) || "{}");
        const kws = Array.isArray(body.keywords) ? body.keywords.map((k) => String(k).trim()).filter(Boolean).slice(0, 30) : [];
        if (!kws.length) return sendJson(res, 400, { error: "至少要留一個關鍵詞——全部清空的話，就無法檢查商品和主題相不相符了" });
        let j = {}; try { j = JSON.parse(fs.readFileSync(fp, "utf8")); } catch (e) {}
        j.themeFitRule = { ...(j.themeFitRule || { threshold: 0.3 }), keywords: kws,
          note: `人工詞組（工作台編修 ${new Date().toISOString().slice(0, 10)}；30% 門檻不變）` };
        fs.writeFileSync(fp, JSON.stringify(j, null, 1));
        appendLog(id, `CP-14 主題詞組人工編修：${kws.join("、")}`);
        return sendJson(res, 200, { ok: true, themeFitRule: j.themeFitRule });
      }
    }
    /* 主題色把關 API（2026-08-27 擋色制）：單一尺＝lib/theme_draft——建立表單與編修面板同把尺
       （病例根治：表單原用 FrameTest assessSeedColor 舊尺只擋格式與極淺＝薄荷綠從建立路漏進來） */
    if (seg[0] === "api" && seg[1] === "theme-check" && !seg[2] && req.method === "GET") {
      const q = new URL(req.url, "http://localhost").searchParams;
      const seedRaw = String(q.get("seed") || "");
      if (!themeDraftSrv.isHex6(seedRaw)) return sendJson(res, 200, { ok: false, format: false, reason: "色碼格式不正確——請用調色盤重新選一次顏色" });
      const seed = themeDraftSrv.normHex(seedRaw);
      const assess = themeDraftSrv.assessSeedColor(seed);
      const td = themeDraftSrv.deriveThemeDraft(seed);
      const fails = themeDraftSrv.checkThemeDraft(td).filter((c) => !c.pass && c.blocking !== false);
      return sendJson(res, 200, { ok: fails.length === 0, warn: assess.warn || null,
        fails: fails.map((c) => ({ name: c.name, msg: c.msg, ratio: c.ratio, need: c.need })),
        seedSuggest: fails.length ? themeDraftSrv.suggestSeed(seed) : null });
    }
    /* 存稿主題色現算（2026-08-27 擋色制「存稿出路」）：面板渲染時對存稿現算檢查＋建議——顯示層不吃存的 qaStatus
       （存值是舊尺算的；換尺後「舊尺過、新尺不過」的稿否則永遠綠著） */
    if (seg[0] === "api" && seg[1] === "runs" && seg[3] === "theme-check" && req.method === "GET") {
      const id = seg[2]; const rdP = safeJoin(RUNS, id);
      if (!rdP || !fs.existsSync(path.join(rdP, "draft.json"))) return sendJson(res, 404, { error: "run 或 draft 不存在" });
      const djTc = JSON.parse(fs.readFileSync(path.join(rdP, "draft.json"), "utf8"));
      const colorsTc = djTc.page && djTc.page.colors;
      const tdTc = colorsTc && colorsTc.themeDraft;
      if (!tdTc || typeof tdTc !== "object") return sendJson(res, 200, { ok: true, applicable: false });
      const failsTc = themeDraftSrv.checkThemeDraft(tdTc).filter((c) => !c.pass && c.blocking !== false);
      return sendJson(res, 200, { ok: failsTc.length === 0, applicable: true, source: colorsTc.source || null,
        fails: failsTc.map((c) => ({ name: c.name, msg: c.msg, ratio: c.ratio, need: c.need, slot: c.slot, suggest: c.suggest })),
        seedSuggest: (failsTc.length && colorsTc.source === "custom" && themeDraftSrv.isHex6(colorsTc.seed)) ? themeDraftSrv.suggestSeed(colorsTc.seed) : null });
    }
    /* 本期活動：三層可用量＋候選（GET）／伺服器即時重組（POST；同端點供更替入口＝指定 actids/gdids） */
    if (seg[0] === "api" && seg[1] === "runs" && seg[3] === "promo-options" && req.method === "GET") {
      const id = seg[2]; const rdP = safeJoin(RUNS, id);
      if (!rdP || !fs.existsSync(path.join(rdP, "draft.json"))) return sendJson(res, 404, { error: "run 或 draft 不存在" });
      const { dj, layers } = promoLayerOptions(rdP);
      return sendJson(res, 200, { mode: dj.page.promoSourceMode || (dj.page.promoEntries ? "promo-activity" : "auto"), hasEntries: !!dj.page.promoEntries, layers });
    }
    if (seg[0] === "api" && seg[1] === "runs" && seg[3] === "promo-recompose" && req.method === "POST") {
      const id = seg[2]; const rdP = safeJoin(RUNS, id);
      if (!rdP || !fs.existsSync(path.join(rdP, "draft.json"))) return sendJson(res, 404, { error: "run 或 draft 不存在" });
      if (!fs.existsSync(path.join(rdP, "snapshot.json"))) return sendJson(res, 409, { error: "這個活動缺少來源商品資料，無法重新組出本期活動——請重新建立這個活動" }); // 2026-07-27 覆核修(同 AC-17 類漏網)：promoLayerOptions(423) 直接 readFileSync(snapshot) 無守衛＝缺檔拋例外落 500 raw
      const _bl = busyLock(id); if (_bl) return sendJson(res, 409, { error: _bl });
      const body = JSON.parse(await readBody(req) || "{}");
      const mode = String(body.mode || "");
      if (!["promo-activity", "brand-recommend", "product-fallback"].includes(mode)) return sendJson(res, 400, { error: "內容主題的選項無效——請重新選擇內容主題後再試一次" });
      const { dj, layers } = promoLayerOptions(rdP);
      let entries = [];
      let truncatedNote = null; // 2026-08-26 上限 4→12：自動來源＝來源有幾則帶幾則，超過上限截斷要出聲（不靜默）
      const capEntries = (pool) => {
        if (pool.length > PROMO_ENTRY_LIMITS.max) truncatedNote = `這個來源可組 ${pool.length} 則，已先帶前 ${PROMO_ENTRY_LIMITS.max} 則（本期活動放 ${PROMO_ENTRY_LIMITS.min}~${PROMO_ENTRY_LIMITS.max} 則）`;
        return pool.slice(0, PROMO_ENTRY_LIMITS.max);
      };
      if (mode === "promo-activity") {
        let pool = layers["promo-activity"].items.filter((a) => a.eligible);
        if (Array.isArray(body.actids) && body.actids.length) {
          const want = body.actids.map(String);
          pool = want.map((a) => layers["promo-activity"].items.find((x) => x.actid === a)).filter(Boolean); // 指定選檔＝更替入口（含不達標者由使用者自行負責時仍以 eligible 呈現於前台）
        } else pool = pool.slice().sort((a, b) => (b.fit ?? 0) - (a.fit ?? 0));
        entries = capEntries(pool).map((a) => ({ actid: a.actid, title: a.title, chip: a.chip, copy: a.title, dateValue: a.period, img: a.img, url: a.url, destinationType: "activity" }));
      } else {
        let pool = layers[mode].items;
        if (Array.isArray(body.gdids) && body.gdids.length) {
          const want = body.gdids.map(String);
          pool = want.map((g) => pool.find((x) => x.gdid === g)).filter(Boolean);
        }
        entries = capEntries(pool).map((p) => ({ gdid: p.gdid, chip: cutFull(p.name, 10), copy: cutFull(p.name, 18), dateValue: "", img: p.img, url: p.url, destinationType: mode === "brand-recommend" ? "brand-recommend" : "product" }));
      }
      if (entries.length < PROMO_ENTRY_LIMITS.min) {
        const zhL = { "promo-activity": "優惠活動", "brand-recommend": "品牌商品推薦", "product-fallback": "主題商品替補" };
        const alt = Object.entries(layers).filter(([k, v]) => k !== mode && v.count >= PROMO_ENTRY_LIMITS.min).map(([k, v]) => `「${zhL[k]}」（可組 ${v.count} 則）`);
        return sendJson(res, 409, { error: `本期活動放 ${PROMO_ENTRY_LIMITS.min}~${PROMO_ENTRY_LIMITS.max} 則——「${zhL[mode] || mode}」目前只湊得出 ${entries.length} 則，至少要 ${PROMO_ENTRY_LIMITS.min} 則版型才能成立——${alt.length ? `可改選 ${alt.join("、")}，` : ""}或改用「人工手動入稿」自行編排` });
      }
      dj.page.promoSourceMode = mode;
      dj.page.promoEntries = entries;
      /* 商品型入口＝商品收進 draft.products（2026-08-30 使用者報「主打選品舞台沒有價格、沒有活動語」根治）：
         舞台皮的大卡與右欄卡靠 byGdid 查 products[] 取真值價與正式品名；入口原本只存 {gdid,圖,連結,文案}、
         商品沒進清單＝查不到 → 退到「無價格」的簡化分支＝使用者看到的缺行缺價。
         收進 products[] 而非在入口另存價格＝價格照樣受 CP-02 逐字驗證（不另開一份沒人驗的價）；
         曝光面本來就含 promoEntries gdid（pageExposedGdids），不會多算。冪等：已在清單者只補不重複加。 */
      let ensureNote = null; // 2026-09-04：跳過的每一件都出聲（原本 continue 靜默＝修好的碼在等一個永遠不會來的欄位，2026-08-30～09-04 沒人知道它從沒補進任何一件）
      if (mode !== "promo-activity") {
        const r = promoProducts.ensurePromoProducts(dj, entries, layers[mode].items || []); // 純函式＝有單元測試餵真 run 資料
        if (r.added.length) appendLog(id, `本期活動入口商品補入商品清單 ${r.added.length} 件（舞台皮取真值價用）：${r.added.join(",")}`);
        if (r.skipped.length) { ensureNote = promoProducts.describeSkipped(r.skipped); appendLog(id, `⚠ ${ensureNote}`); }
      }
      if (dj.assets && dj.assets.moduleImages) for (const k of Object.keys(dj.assets.moduleImages)) if (/^promoEntry\d+$/.test(k)) delete dj.assets.moduleImages[k]; // 重組＝整批重生（e.img 承載新圖），清舊覆寫防蓋圖（stale-img 家族）
      if (mode === "promo-activity") { // Q4 機械重寫：活動層＝promo-truth
        dj.page.promoModuleTitle = "本期活動：" + entries.map((e) => e.chip).join("・");
        dj.page.dockPromoLabel = wFull(entries[0].chip) <= 4 ? entries[0].chip : "本期優惠";
      } else { // 商品層＝ai-curated（無優惠詞）
        const th = (dj.page.curationTheme || "").trim();
        dj.page.promoModuleTitle = th ? `${th}精選推薦` : "編輯精選推薦";
        dj.page.dockPromoLabel = "精選推薦";
      }
      let v = 1; while (fs.existsSync(path.join(rdP, `draft.v${v}.json`))) v++;
      fs.copyFileSync(path.join(rdP, "draft.json"), path.join(rdP, `draft.v${v}.json`));
      fs.writeFileSync(path.join(rdP, "draft.json"), JSON.stringify(dj, null, 1));
      reconcileProductCheckFile(rdP, dj); // 幽靈列對帳（2026-08-30 同類全掛）
      appendLog(id, `本期活動重組（E0=${mode}${body.actids ? "；指定 actids " + body.actids.join(",") : body.gdids ? "；指定 gdids " + body.gdids.join(",") : ""}）：入口 ×${entries.length}＋標題/dock 機械重寫（2026-07-23 四題裁決 Q1/Q4）${truncatedNote ? "；" + truncatedNote : ""}；備份 draft.v${v}.json`);
      const approvalInvalidatedP = invalidateApproval(seg[2]);
      return sendJson(res, 200, { ok: true, draft: dj, backup: `draft.v${v}.json`, entries: entries.length, truncated: truncatedNote, ensureNote, approvalInvalidated: approvalInvalidatedP });
    }
    /* ===== 版式選擇器＋提案包（51 號 W1-C，2026-08-24）＝四個端點 =====
       登記簿讀不到＝500 出聲（值域真源缺席不裝乾淨）；AI 代選業務失敗＝200 ok:false 帶白話原因（表單退回手選＝C3d）。 */
    if (seg[0] === "api" && seg[1] === "layout-catalog" && req.method === "GET") {
      try { return sendJson(res, 200, layoutLib.catalogForForm(layoutLib.loadLayoutDeps())); }
      catch (e) { return sendJson(res, 500, { error: "版式選單載入失敗（登記簿讀取問題）：" + errText(e) }); }
    }
    if (seg[0] === "api" && seg[1] === "layout-suggest" && req.method === "GET") {
      try {
        const deps = layoutLib.loadLayoutDeps();
        const s = layoutLib.suggestLayout(u.searchParams.get("scenario") || "", deps, u.searchParams.get("theme") || ""); // 主題字優先（2026-09-14）：建立頁即時預覽也帶主題欄
        const rec = deps.registries.layoutRecords.get(s.layout);
        return sendJson(res, 200, { ok: true, layout: s.layout, name: (rec && rec.name) || s.layout, reason: s.reason, reasonDisplay: s.reasonDisplay, substitutedFrom: s.substitutedFrom, byTheme: s.byTheme || null, engineNote: layoutLib.engineNoteFor(s.layout) });
      } catch (e) { return sendJson(res, 200, { ok: false, error: errText(e) }); }
    }
    /* 配色依據預告（2026-09-11 文案批第 3 題甲案）：建立頁「依主題自動配色」要向使用者講明會配到哪個色系。
       沿 layout-suggest 既有形狀（GET＋ok 旗標＋業務失敗回 200）；路由表真源＝curate_auto.js routeHue／HUE_LABEL，
       前端不複製關鍵字表。⚠ 此處只帶 theme＋scenario：品牌名要抓完來源頁才知道，策展時會一併列入判斷＝預告可能微調。 */
    if (seg[0] === "api" && seg[1] === "theme-suggest" && req.method === "GET") {
      try {
        const ca = require(path.join(__dirname, "curate_auto.js"));
        const theme = (u.searchParams.get("theme") || "").trim();
        const scenario = (u.searchParams.get("scenario") || "").replace(/^0\d\s+/, "").trim();
        const hue = ca.routeHue(theme + " " + scenario);
        return sendJson(res, 200, { ok: true, hue, hueLabel: ca.HUE_LABEL[hue] || hue, basedOn: theme || scenario || "" });
      } catch (e) { return sendJson(res, 200, { ok: false, error: "配色預告算不出來：" + errText(e) }); }
    }
    /* 策展劇本（71 號／2026-09-11 裁決牆）：只讀 pipeline/briefs 底下的兩個資料夾，不吃任意路徑。
       built-in＝我們預寫的（產物、勿改）；mine＝同事自己的。回傳時一併帶解析結果，
       畫面才講得出「這份現在能不能用、哪裡要修」，而不是等他選了才報錯。 */
    if (seg[0] === "api" && seg[1] === "briefs" && req.method === "GET" && !seg[2]) {
      const out = [];
      for (const kind of ["built-in", "mine"]) {
        const dir = kind === "mine" ? MY_BRIEFS_DIR : path.join(BRIEFS_DIR, kind);
        let names = [];
        try { names = fs.readdirSync(dir).filter((f) => f.endsWith(".md")); } catch (e) { continue; }
        for (const name of names.sort()) {
          const rel = `${kind}/${name}`;
          let parsed = null, readError = "";
          try { parsed = briefLib.parseBrief(fs.readFileSync(path.join(dir, name), "utf8")); }
          catch (e) { readError = errText(e); }
          /* 這份「會帶入什麼」由格式真源算（2026-09-14）：原本建立頁那句寫死「主標、分幾層」＝第二份「哪些段會生效」的清單，
             選品接上那天它就說謊了。brings＝有填且系統會用的段；aside＝有填但只給人與助理看的段。 */
          const filled = parsed ? Object.entries(parsed.provenance || {}).filter(([, v]) => v === "brief").map(([k]) => k) : [];
          const secs = briefFmt.sections();
          out.push({
            file: rel, kind, name: name.replace(/\.md$/, ""),
            ok: !!(parsed && parsed.ok), readError,
            errorCount: parsed ? parsed.errors.length : 0,
            noticeCount: parsed ? parsed.notices.length : 0,
            firstProblem: parsed && parsed.errors[0] ? parsed.errors[0].say : readError,
            brings: secs.filter((x) => x.consumed && filled.includes(x.key)).map((x) => x.heading),
            aside: secs.filter((x) => !x.consumed && filled.includes(x.key)).map((x) => x.heading),
            /* 第一行型態與主題（2026-09-15 C 批）：建立頁選檔＝型態自動帶入；沒寫＝null（介面講「沒寫型態、照你選的」） */
            updatedAt: (() => { try { return fs.statSync(path.join(dir, name)).mtime.toISOString(); } catch (e) { return null; } })(), // 列表「最後修改」欄（2026-09-15）
            scenario: (parsed && parsed.data && parsed.data.scenario) || null,
            scenarioTitle: parsed && parsed.data && parsed.data.scenario ? scenLib.titleOf(parsed.data.scenario) : "",
            scenarioLabel: (parsed && parsed.data && parsed.data.scenarioLabel) || "",
            theme: (parsed && parsed.data && parsed.data.theme) || "",
          });
        }
      }
      return sendJson(res, 200, { ok: true, briefs: out });
    }
    /* 貼上策略檔（2026-09-15 C 批，牆第 3 題甲③）：CMS 自己存進 mine、當場驗格式（八段齊不齊、有沒有偷寫價格連結）、算對帳（型態一不一致、每層對到幾件）。
       句子由前端組（介面文案過目制）；這裡只回帳。檔名：使用者給的名字或「主題-日期」，同名加序號不覆蓋。 */
    if (seg[0] === "api" && seg[1] === "briefs" && seg[2] === "mine" && !seg[3] && req.method === "POST") { // !seg[3]：別把 mine/rename 也吃掉
      const b = JSON.parse(await readBody(req) || "{}");
      const text = String(b.text || "").replace(/\r\n/g, "\n").trim();
      if (!text) return sendJson(res, 400, { error: "貼上框是空的——把 Gemini 最後給你的那份文件整段貼進來。" });
      if (text.length > 60000) return sendJson(res, 400, { error: "這份太長了（超過六萬字）——只貼 Gemini 最後給你的那份文件就好，不用連對話一起貼。" });
      const parsed = briefLib.parseBrief(text);
      if (!parsed.ok) return sendJson(res, 400, { error: "這份文件沒通過檢查，還沒存：" + parsed.errors.map((e) => e.say).join("；"), errors: parsed.errors, notices: parsed.notices });
      const baseName = String(b.name || parsed.data.theme || "策略檔").replace(/[\\/:*?"<>|\x00-\x1f]/g, "").replace(/\.md$/i, "").trim().slice(0, 60) || "策略檔";
      const day = localToday();
      let fname = `${baseName}-${day}.md`, n = 2;
      while (fs.existsSync(myBriefPath(fname))) fname = `${baseName}-${day}-${n++}.md`;
      fs.writeFileSync(myBriefPath(fname), text + "\n");
      let recon = null;
      if (b.runId) {
        const rd = safeJoin(RUNS, String(b.runId));
        const m0 = rd ? (readMeta(String(b.runId)) || {}) : {};
        let names = [], threshold;
        try { names = (JSON.parse(fs.readFileSync(path.join(rd, "snapshot.json"), "utf8")).products || []).map((x) => (x && x.name) || "").filter(Boolean); } catch (e) { /* 沒商品池＝對帳只比型態 */ }
        try { const t = JSON.parse(fs.readFileSync(path.join(rd, "feedback_patch.json"), "utf8")).themeFitRule.threshold; if (Number.isFinite(t)) threshold = t; } catch (e) { /* 沿 lib 預設 */ }
        recon = briefRecon.reconcile(parsed, { runScenario: (m0.input || {}).scenario || "", runTheme: (m0.input || {}).theme || "", productNames: names, threshold });
      }
      return sendJson(res, 200, { ok: true, file: `mine/${fname}`, name: fname.replace(/\.md$/, ""), scenario: parsed.data.scenario, scenarioTitle: parsed.data.scenario ? scenLib.titleOf(parsed.data.scenario) : "", theme: parsed.data.theme, notices: parsed.notices, recon });
    }
    /* 我的策略檔管理（2026-09-15 P-4 甲）：編輯（備份上一版到 mine/.versions）／改名／刪除（移到 mine/.trash，可由負責人找回）——只准動 mine/ 底下 */
    const mineOnly = (rel) => { const r = String(rel || ""); if (!/^mine\/[^/]+\.md$/.test(r)) return null; const f = briefResolve(r); return f && fs.existsSync(f) ? f : null; };
    const safeName = (n) => String(n || "").replace(/[\\/:*?"<>|\x00-\x1f]/g, "").replace(/\.md$/i, "").trim().slice(0, 60);
    if (seg[0] === "api" && seg[1] === "briefs" && seg[2] === "mine" && !seg[3] && req.method === "PUT") {
      const b = JSON.parse(await readBody(req) || "{}"); const f = mineOnly(b.file);
      if (!f) return sendJson(res, 400, { error: "只能編輯「我的策略檔」裡的檔案。（技術：file 不在 mine/ 底下或不存在）" });
      const text = String(b.text || "").replace(/\r\n/g, "\n").trim();
      const parsed = briefLib.parseBrief(text);
      if (!parsed.ok) return sendJson(res, 400, { error: "這份還沒通過檢查，沒有存：" + parsed.errors.map((e) => e.say).join("；"), errors: parsed.errors });
      const vdir = myBriefPath(".versions"); fs.mkdirSync(vdir, { recursive: true });
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      fs.copyFileSync(f, path.join(vdir, `${path.basename(f, ".md")}__${stamp}.md`));
      fs.writeFileSync(f, text + "\n");
      return sendJson(res, 200, { ok: true, file: b.file, notices: parsed.notices, scenario: parsed.data.scenario, theme: parsed.data.theme });
    }
    if (seg[0] === "api" && seg[1] === "briefs" && seg[2] === "mine" && seg[3] === "rename" && req.method === "POST") {
      const b = JSON.parse(await readBody(req) || "{}"); const f = mineOnly(b.file);
      if (!f) return sendJson(res, 400, { error: "只能改「我的策略檔」裡的檔名。（技術：file 不在 mine/ 底下或不存在）" });
      const name = safeName(b.name); if (!name) return sendJson(res, 400, { error: "新名字不能是空的。" });
      const dest = myBriefPath(`${name}.md`);
      if (fs.existsSync(dest) && dest !== f) return sendJson(res, 409, { error: `已經有一份叫「${name}」——換個名字。` });
      fs.renameSync(f, dest);
      return sendJson(res, 200, { ok: true, file: `mine/${name}.md`, name });
    }
    if (seg[0] === "api" && seg[1] === "briefs" && seg[2] === "mine" && !seg[3] && req.method === "DELETE") {
      const rel = u.searchParams.get("file") || ""; const f = mineOnly(rel);
      if (!f) return sendJson(res, 400, { error: "只能刪「我的策略檔」裡的檔案。（技術：file 不在 mine/ 底下或不存在）" });
      const tdir = myBriefPath(".trash"); fs.mkdirSync(tdir, { recursive: true });
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      fs.renameSync(f, path.join(tdir, `${path.basename(f, ".md")}__${stamp}.md`));
      return sendJson(res, 200, { ok: true, file: rel, name: path.basename(f, ".md") });
    }
    /* 通用版 Gemini 指令（沒有活動也想先寫；Gemini 不知道商品＝較不準，介面會講） */
    if (seg[0] === "api" && seg[1] === "briefs" && seg[2] === "gem-instructions" && req.method === "GET") {
      try { return sendJson(res, 200, { ok: true, text: fs.readFileSync(path.join(BRIEFS_DIR, "Gemini助理指令.md"), "utf8") }); }
      catch (e) { return sendJson(res, 404, { error: "通用指令檔讀不到——請重跑 node tools/gen-brief-templates.mjs。（技術：" + errText(e) + "）" }); }
    }
    /* 選檔對帳（不存、只算）：建立頁或編修頁選了既有檔案時用 */
    if (seg[0] === "api" && seg[1] === "briefs" && seg[2] === "recon" && req.method === "GET") {
      const rel = u.searchParams.get("file") || ""; const runId = u.searchParams.get("run") || "";
      const f = briefResolve(rel);
      if (!f || !/\.md$/.test(f) || !fs.existsSync(f)) return sendJson(res, 400, { error: "找不到這份策略檔。（技術：路徑不在 briefs 資料夾內或檔案不存在）" });
      const parsed = briefLib.parseBrief(fs.readFileSync(f, "utf8"));
      if (!parsed.ok) return sendJson(res, 200, { ok: false, error: "這份現在不能用：" + parsed.errors.map((e) => e.say).join("；"), errors: parsed.errors });
      let names = [], threshold, m0 = {};
      if (runId) { const rd = safeJoin(RUNS, runId); m0 = readMeta(runId) || {};
        try { names = (JSON.parse(fs.readFileSync(path.join(rd, "snapshot.json"), "utf8")).products || []).map((x) => (x && x.name) || "").filter(Boolean); } catch (e) { /* 無池 */ }
        try { const t = JSON.parse(fs.readFileSync(path.join(rd, "feedback_patch.json"), "utf8")).themeFitRule.threshold; if (Number.isFinite(t)) threshold = t; } catch (e) { /* 預設 */ } }
      const runScenario = u.searchParams.get("scenario") != null ? u.searchParams.get("scenario") : ((m0.input || {}).scenario || "");
      return sendJson(res, 200, { ok: true, file: rel, recon: briefRecon.reconcile(parsed, { runScenario, runTheme: (m0.input || {}).theme || "", productNames: names, threshold }) });
    }
    /* 建頁流程引導文案（2026-09-15 C 批）：單一真源 lib/flow_guide_copy.json——CMS 歡迎三格、策略檔頁步驟、內容策略區句子都讀這裡；分享站鏡像頁由同一份產出 */
    if (seg[0] === "api" && seg[1] === "flow-guide" && req.method === "GET") {
      try { return sendJson(res, 200, { ok: true, ...JSON.parse(fs.readFileSync(path.join(PIPE, "lib", "flow_guide_copy.json"), "utf8")) }); }
      catch (e) { return sendJson(res, 500, { error: "引導文案讀不到——工具可能剛更新過還沒重新啟動。（技術：" + errText(e) + "）" }); }
    }
    if (seg[0] === "api" && seg[1] === "briefs" && seg[2] === "read" && req.method === "GET") {
      const rel = u.searchParams.get("file") || "";
      const f = briefResolve(rel);
      if (!f || !/\.md$/.test(f)) return sendJson(res, 400, { error: "找不到這份策展檔。（技術：路徑不在 briefs 資料夾內或不是 .md）" });
      let raw;
      try { raw = fs.readFileSync(f, "utf8"); }
      catch (e) { return sendJson(res, 404, { error: `讀不到「${rel}」——檔案可能被移走或改名了。（技術：${e.code || errText(e)}）` }); }
      if (u.searchParams.get("download") === "1") { // P-4 分享＝下載 .md 給同事（他在自己的工具貼上）
        res.writeHead(200, { "Content-Type": "text/markdown; charset=utf-8", "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(path.basename(f))}` });
        return res.end(raw);
      }
      return sendJson(res, 200, { ok: true, file: rel, raw, parsed: briefLib.parseBrief(raw) });
    }
    if (seg[0] === "api" && seg[1] === "proposal-pack" && seg[2] === "parse" && req.method === "POST") {
      const b = JSON.parse(await readBody(req) || "{}");
      try { return sendJson(res, 200, layoutLib.parsePackForForm(String(b.pack == null ? "" : b.pack), layoutLib.loadLayoutDeps())); }
      catch (e) { return sendJson(res, 500, { error: "提案包驗證沒有跑成（登記簿讀取問題）：" + errText(e) }); }
    }
    if (seg[0] === "api" && seg[1] === "layout-thumbs" && seg[2] && req.method === "GET") {
      const f = safeJoin(LAYOUT_THUMBS_DIR, seg.slice(2).join("/"));
      return f ? serveFile(res, f) : sendJson(res, 400, { error: "bad path" }); // 缺檔＝serveFile 404，前端佔位圖＋警示不擋（51 §2.7）
    }

    /* 來源 URL 快速探針（建立前防呆＝2026-07-22 五 URL 實測後需求）：抓來源頁一次，
       以 促銷檔數/hotSales/hits 訊號預判可否策展——0 訊號＝純列表型分類頁等抓不到商品的來源，擋下並給替代建議 */
    if (seg[0] === "api" && seg[1] === "source-check" && req.method === "POST") {
      /* 文案遵循 workbench/ux-writing.md：發生什麼＋現在怎麼做；禁系統內部詞彙（2026-07-25） */
      const { url = "" } = JSON.parse(await readBody(req) || "{}");
      let u; try { u = new URL(url.trim()); } catch (e) { return sendJson(res, 200, { ok: false, verdict: "這不是完整的網址——請從瀏覽器網址列複製整段貼上（開頭是 https://）" }); }
      if (u.hostname !== "tw.buy.yahoo.com") return sendJson(res, 200, { ok: false, verdict: "目前只支援 Yahoo購物中心的頁面——請改貼 tw.buy.yahoo.com 開頭的網址" });
      if (u.pathname.includes("/gdsale")) return sendJson(res, 200, { ok: false, verdict: "這是單一商品的頁面，建活動需要一整批商品——請改貼品牌頁、活動賣場或搜尋結果頁的網址" });
      try {
        const r = await fetchPage(url.trim());
        const b = parseBrandPage(r.html || "");
        const promo = (b.promotions || []).length, hot = (b.hotSales || []).length, hits = (b.hits || []).length;
        /* 2026-07-30 旗艦店根治：hits（僅品名/連結、無價格真值）不再計入可策展訊號——原 ok=hits>0
           會放行 catitemid 主題館頁、進策展才 0 件中止（07-30 三 run 實證＝預檢與策展契約不一致）。
           改計旗艦店 Apollo 活動檔／頁內活動連結（與 fetch_parse 頁型分層 fallback 同一套訊號）。 */
        let flagship = 0, listing = 0;
        // 意圖路由與 fetch_parse 同步（方案A）：帶過濾/搜尋參數＝清單凌駕一切活動檔訊號
        //（過濾頁變體有時同時內嵌 ec_promotions banner＝會誤報「N 個活動檔」而實際建立走清單路）
        const filterIntent = u.searchParams.has("brandIds") || u.searchParams.has("flt") || u.pathname.includes("/search/");
        if (filterIntent) listing = parseListingHits(r.html || "").length;
        if (!listing && !promo && !hot) {
          const f = parseFlagshipPage(r.html || "");
          flagship = f.promotions.length;
          if (!flagship) listing = parseListingHits(r.html || "").length; // 商品清單型（建立時逐品實抓驗價）
          if (!flagship && !listing) flagship = parseActivityLinks(r.html || "").length;
        }
        const ok = (filterIntent && listing ? listing : promo + hot + flagship + listing) > 0;
        // 不可用時依頁面標題組好搜尋網址（讓下一步可以「一鍵做」而不是「自己想」）
        let suggestUrl = "", suggestKw = "";
        if (!ok) {
          const tm = (r.html || "").match(/<title>([^<]*)<\/title>/i);
          if (tm) suggestKw = (tm[1].split(/[,，|｜]/)[0] || "").split("/")[0].replace(/優惠推薦.*$/, "").trim();
          if (suggestKw && suggestKw.length >= 2 && !/yahoo/i.test(suggestKw)) suggestUrl = "https://tw.buy.yahoo.com/search/product?p=" + encodeURIComponent(suggestKw);
        }
        const found = [];
        if (listing) found.push(`${listing} 件商品（建立時會到商品頁逐件確認價格——清單抓取跟價格確認同一趟、不重抓，約 ${Math.max(1, Math.ceil(Math.min(listing, 60) * 0.3))} 秒）`); /* 估時照 2026-10-05 並行池實測（提速 C）：0.26 秒/件＋對真讀種子幾乎免費 */
        if (!(filterIntent && listing)) { // 過濾/搜尋意圖走清單路＝不顯示頁掛活動檔（與實際建立行為一致）
          if (promo) found.push(`${promo} 個活動檔`); if (hot) found.push(`${hot} 件熱銷商品`); if (flagship) found.push(`頁內 ${flagship} 個活動檔`);
        }
        const altSuffix = suggestUrl ? `；或改用「${suggestKw}」的商品搜尋結果（點下方連結帶入）` : "，或改用商品關鍵字的搜尋結果頁";
        return sendJson(res, 200, { ok, promotions: promo, hotSales: hot, hits, flagship, listing, suggestUrl, suggestKw,
          verdict: ok ? `這個網址可以用（找到 ${found.join("、")}）——開始策展` :
            hits ? "這個頁面看得到商品，但價格要等瀏覽器載入、系統抓不到，也沒有進行中的活動檔——請改貼品牌頁或活動賣場的網址" + altSuffix :
            "這個頁面只有商品列表、沒有進行中的活動檔，目前沒辦法從這種頁面選品——請改貼品牌頁或活動賣場的網址" + altSuffix });
      } catch (e) { /* 2026-09-24 第①件：連線層失敗（這台連不到）與頁面問題分開講——09-22 病例＝好網址被指去「換來源」，照做一小時不會好 */
        const v = sourceFailVerdict(e); console.warn(`[source-check] 讀取失敗（${v.kind}）：${v.tech}`);
        return sendJson(res, 200, { ok: false, kind: v.kind, verdict: v.verdict, tech: v.tech }); }
    }
    /* 替換後 AI 帶入文案：haiku 微呼叫寫標籤（≤7 全形、禁數字/優惠詞＝紅線內文案欄）；失敗/逾時退機械派生 */
    if (seg[0] === "api" && seg[1] === "copy-suggest" && req.method === "POST") {
      const { name = "", theme = "", scenario = "" } = JSON.parse(await readBody(req) || "{}");
      const mechanical = () => { // 機械派生：去品牌詞/尺寸容量詞後取前段 ≤7 全形
        const t = name.replace(/^[A-Za-z\s]+/g, "").replace(/\d+(?:\.\d+)?(?:cm|ml|l|入|件|組|g|kg)/gi, "").replace(/[()（）\/｜|]/g, " ").trim().split(/\s+/)[0] || "嚴選好物";
        let acc = 0, out = ""; for (const ch of t) { acc += ch.charCodeAt(0) > 255 ? 1 : 0.55; if (acc > 7) break; out += ch; }
        return out || "嚴選好物";
      };
      const prompt = `為電商活動頁商品卡寫一個標籤。商品名：「${name}」。活動主題：「${theme || "無"}」（情境：${scenario || "無"}）。規則：只回標籤文字本身；不超過 7 個全形字；禁止數字、價格、折扣詞；扣合商品實質與主題調性。`;
      const tag = await new Promise((resolve) => {
        // 模型釘選（2026-08-27 裁決 Q2，35 號 §2.1）：Haiku 4.5＝本站定案，行為不變。
        // 沿用 CLI alias "haiku"（已實跑驗證可用）而非完整 ID；alias 若日後浮動到新世代 haiku，
        // 影響面＝7 字標籤且有機械 fallback 兜底，屬可接受風險。
        const ch = spawn("claude", ["-p", prompt, "--model", "haiku", "--strict-mcp-config"], { stdio: ["ignore", "pipe", "pipe"] });
        const bufs = []; // 2026-07-23 修：同 readBody chunk 邊界問題（輸出＝中文標籤、切斷即 U+FFFD 入欄）
        const to = setTimeout(() => { ch.kill("SIGTERM"); resolve(null); }, 15000);
        ch.stdout.on("data", (d) => bufs.push(d));
        ch.on("close", () => { clearTimeout(to);
          const out = Buffer.concat(bufs).toString("utf8");
          const t = out.trim().split("\n").pop().replace(/[*_#>`~"「」『』.。：:]/g, "").trim();
          const w = [...t].reduce((a, c) => a + (c.charCodeAt(0) > 255 ? 1 : 0.55), 0);
          resolve(t && t.length <= 14 && w <= 102 / 14 && !/[0-9０-９]/.test(t) ? t : null); }); // 門檻對齊 gate 預算（原 7.3em 寬 0.2px＝會放行 gate 擋下的標籤）
        ch.on("error", () => { clearTimeout(to); resolve(null); });
      });
      return sendJson(res, 200, tag ? { tag, source: "ai" } : { tag: mechanical(), source: "fallback" });
    }

    /* 已刪除批次（歸檔區 runs/_deleted）：列表＋還原 */
    if (seg[0] === "api" && seg[1] === "runs-deleted" && !seg[2] && req.method === "GET") {
      purgeTrash("列垃圾桶時順帶"); // P-5 乙：滿 30 天自動清掉（不掛計時器）
      const trash = path.join(RUNS, "_deleted");
      const list = fs.existsSync(trash) ? fs.readdirSync(trash).filter((n) => fs.statSync(path.join(trash, n)).isDirectory()).map((n) => {
        let meta = {}; try { meta = JSON.parse(fs.readFileSync(path.join(trash, n, "wb_meta.json"), "utf8")); } catch (e) {}
        const daysLeft = meta.deletedAt ? Math.max(0, TRASH_KEEP_DAYS - Math.floor((Date.now() - Date.parse(meta.deletedAt)) / 86400000)) : TRASH_KEEP_DAYS;
        return { archivedName: n, id: n.split("__deleted-")[0], deletedAt: meta.deletedAt || "", pageName: meta.deletedPageName || "", daysLeft, keepDays: TRASH_KEEP_DAYS };
      }).sort((a, b) => String(b.deletedAt || b.archivedName).localeCompare(String(a.deletedAt || a.archivedName))) : []; // 2026-07-25 design QA 修：依刪除時間倒序（原依資料夾名＝建立時間，剛刪的不一定在最上面）
      return sendJson(res, 200, list);
    }
    /* P-5 甲（2026-09-15 使用者裁）：永久刪除一檔／清空垃圾桶——只准刪 runs/_deleted 底下；無法還原，前端確認句講清楚 */
    /* 背景的家清理規則（2026-09-29 甲案；story hero-bg-own-where-images-live.md 驗收 4「沒有清理規則就不要開始」）：
       永久刪除＝站上的自備背景資料夾一起刪；該檔發佈頁若用 own＝live-drafts json 一併刪（圖沒了頁必破，留著是死頁）。
       丟垃圾桶（可還原）不清＝已發佈頁照常活著、還原後一切照舊。清理失敗＝出聲不擋刪（下一次發佈或週檢撿）。 */
    const purgeOwnSiteAssets = (origId) => {
      try {
        const dir = path.join(DEPLOY_SITE, "活動自備背景", origId);
        if (fs.existsSync(dir)) { fs.rmSync(dir, { recursive: true, force: true }); console.log(`[trash] 站上的自備背景一起刪：活動自備背景/${origId}`); }
        const lj = path.join(DEPLOY_SITE, "live-drafts", `${origId}.json`);
        if (fs.existsSync(lj) && /"backgroundId":\s*"own"/.test(fs.readFileSync(lj, "utf8"))) { fs.unlinkSync(lj); console.log(`[trash] 該檔發佈頁用自備背景＝live-drafts/${origId}.json 一併刪（圖已刪、留著是死頁）`); }
      } catch (e) { console.warn(`[trash] own 站上資產清理失敗（不擋刪除、下一次發佈或週檢撿）：${e.message}`); }
    };
    if (seg[0] === "api" && seg[1] === "runs-deleted" && seg[2] === "purge" && req.method === "POST") {
      const trash = path.join(RUNS, "_deleted"); let n = 0;
      if (fs.existsSync(trash)) for (const name of fs.readdirSync(trash)) { const d = path.join(trash, name); if (fs.statSync(d).isDirectory()) { fs.rmSync(d, { recursive: true, force: true }); purgeOwnSiteAssets(name.split("__deleted-")[0]); n++; } }
      console.log(`[trash] 清空垃圾桶：永久刪除 ${n} 檔（使用者按「清空垃圾桶」）`);
      return sendJson(res, 200, { ok: true, purged: n });
    }
    if (seg[0] === "api" && seg[1] === "runs-deleted" && seg[2] && !seg[3] && req.method === "DELETE") {
      const d = safeJoin(path.join(RUNS, "_deleted"), seg[2]);
      if (!d || !fs.existsSync(d) || !fs.statSync(d).isDirectory()) return sendJson(res, 404, { error: "垃圾桶裡沒有這一檔——可能已經清掉了。" });
      fs.rmSync(d, { recursive: true, force: true });
      purgeOwnSiteAssets(seg[2].split("__deleted-")[0]);
      console.log(`[trash] 永久刪除 ${seg[2]}（使用者按「永久刪除」）`);
      return sendJson(res, 200, { ok: true, archivedName: seg[2] });
    }
    if (seg[0] === "api" && seg[1] === "runs-deleted" && seg[2] && seg[3] === "restore" && req.method === "POST") {
      const src = safeJoin(path.join(RUNS, "_deleted"), seg[2]);
      if (!src || !fs.existsSync(src)) return sendJson(res, 404, { error: "歸檔不存在" });
      const origId = seg[2].split("__deleted-")[0];
      const dest = path.join(RUNS, origId);
      if (fs.existsSync(dest)) return sendJson(res, 409, { error: `無法還原：活動列表已有同一個編號（${origId}）的活動——請先刪除列表中的那一筆，再回來還原這筆` });
      fs.renameSync(src, dest);
      const m = readMeta(origId) || {}; delete m.deletedAt; delete m.deletedPageName;
      fs.writeFileSync(metaPath(origId), JSON.stringify({ ...m, updatedAt: new Date().toISOString() }, null, 1));
      appendLog(origId, "自歸檔還原（" + seg[2] + "）");
      return sendJson(res, 200, { ok: true, id: origId });
    }

    /* 2026-09-14 舊管線退場（69 號附錄 C）：原 POST /api/patrol/run（08:30 run 巡檢手動觸發）與
       GET /api/patrol/summary（首頁「已發佈」卡巡檢一句話）兩端點一併移除——巡檢停排程、首頁那行拆掉（D3 甲），
       不留「今天還沒巡檢」這種永遠不會變的假狀態。 */

    if (seg[0] === "api" && seg[1] === "runs" && !seg[2]) {
      if (req.method === "GET") {
        /* 2026-09-21 C：登記簿現況指紋——整份列表算一次，逐筆跟報告裡的指紋比。算不出來（簿讀不到）＝出聲記錯、不標任何人過期（不假紅） */
        let regFpNow = null;
        try { regFpNow = registriesFingerprint(); } catch (e) { console.error(`[list] 登記簿指紋算不出來（${errText(e)}）——本輪不判「需重檢」`); }
        const list = fs.readdirSync(RUNS).filter((n) => !n.startsWith("_"))
          .filter((n) => fs.existsSync(path.join(RUNS, n, "snapshot.json")) || fs.existsSync(path.join(RUNS, n, "draft.json")))
          .sort().reverse().map((n) => {
            const meta = readMeta(n) || {};
            let pageName = "", themeHue = null, kvVariantD = null;
            try { const pgd = JSON.parse(fs.readFileSync(path.join(RUNS, n, "draft.json"), "utf8")).page;
              pageName = pgd.pageName || ""; themeHue = (pgd.theme && pgd.theme.hueFamily) || null;
              kvVariantD = pgd.kvVariant || null; } catch (e) {}
            let gate = null;
            try { const g = JSON.parse(fs.readFileSync(path.join(RUNS, n, "gate_report.json"), "utf8"));
              gate = { pass: g.result === "PASS", fail: (g.counts && g.counts.FAIL) || 0, warn: (g.counts && g.counts.WARN) || 0 };
              /* 2026-09-21 C：報告的登記簿指紋 ≠ 現況＝這份結果可能已經不對（背景退場、字風審過、版式下架…）。
                 舊報告沒有指紋＝一律當「需重檢」（寧可多跑一次快檢，不讓 9/3 的報告冒充 9/21 的現況）。 */
              if (regFpNow) {
                const changed = registriesChanged(g.registries, regFpNow);
                if (changed.length) { gate.registryStale = true; gate.registryChanged = changed; }
              } } catch (e) {}
            /* F9-3（2026-07-29 promo-manual-channel-fixes）：draft 落盤時刻＝前端「內容已於檢查後修改」過時比對基準 */
            let draftSavedAt = null;
            try { draftSavedAt = fs.statSync(path.join(RUNS, n, "draft.json")).mtime.toISOString(); }
            catch (e) { if (e.code !== "ENOENT") console.error(`[list] ${n} draft.json mtime 讀取失敗（${errText(e)}）——前端不顯報告過時標示`); } // 無 draft＝合法（snapshot-only run）
            return { id: n, stage: meta.stage || (fs.existsSync(path.join(RUNS, n, "draft.json")) ? "ready" : "snapshot-only"),
              engineUsed: meta.engineUsed || (meta.stage ? meta.engine : "（歷史批次）"), input: meta.input || null, pageName,
              hasDraft: fs.existsSync(path.join(RUNS, n, "draft.json")), hasGate: fs.existsSync(path.join(RUNS, n, "gate_report.json")), error: meta.error || null,
              approvedAt: meta.approvedAt || null, approvedWithFail: meta.approvedWithFail || null, liveUrl: meta.liveUrl || null, deploy: meta.deploy || null,
              heroBgLicenseConfirm: meta.heroBgLicenseConfirm || null, /* 版權確認紀錄（2026-09-29）：前端確認框三態與 AEM 對話框都靠它判——漏這欄＝確認完畫面永遠畫回未確認（2026-09-29 使用者走查第 3 步實抓） */
              gate, themeHue, createdAt: meta.createdAt || "", draftSavedAt,
              /* 商品狀態摘要（cms-status-badges story）：prodcheck＝最新商品狀態報告統計（製作 AEM 網頁檔／發佈預覽前那次檢查；
                 無檔＝null＝前端誠實顯示「未檢查」，不裝乾淨）。
                 營運檔期 lifecycle／lifecycleState 兩欄 2026-09-14 退場（69 號附錄 C Q3 甲＋D1 甲）：介面不再收、列表不再分「已結束」；
                 既有 meta.lifecycle 資料保留不刪、不回傳。 */
              prodcheck: (() => { try { const pc = JSON.parse(fs.readFileSync(path.join(RUNS, n, "product_check.json"), "utf8"));
                return { checkedAt: pc.checkedAt || null, ...runPatrolLib.summarizeCheck(pc) }; }
                catch (e) { if (e.code !== "ENOENT") console.error(`[list] ${n} product_check.json 讀取失敗（${errText(e)}）——前端顯示未檢查`); return null; } })(),
              publicUrl: meta.publicUrl || null, publicAt: meta.publicAt || null, publicDeploy: meta.publicDeploy || null, exportZip: meta.exportZip || null, exportAem: meta.exportAem || null,
              layoutChoiceError: layoutChoiceErrorOf(meta), // 版式沒寫進草稿＝編修頁進場黃條（2026-08-24 review 中3）
              /* 引擎告示＝現算不吃存值（2026-08-24 W1-B 006 解鎖）：舊 run 存的是建立當下的告示文字，
                 逐款解鎖後會過時（例＝006 已上線仍稱建置中）——列表回傳現值，前端優先用這欄。
                 版式值優先讀 draft 現值（W1-D 組合面板可換版式＝meta.input.kvVariant 是建立時舊值） */
              layoutEngineNote: (() => { const kvE = kvVariantD || (meta.input && meta.input.kvVariant); return kvE ? layoutLib.engineNoteFor(kvE) : null; })(),
              layoutLabel: (() => { const kvE = kvVariantD || (meta.input && meta.input.kvVariant); return kvE ? layoutLabelOf(kvE) : null; })(), // 介面顯示名稱（貨號不進介面）；同樣優先 draft 現值
              heroRestoreRecheck: meta.heroRestoreRecheck || null, // 換回還原強制重驗旗（W1-D：前端顯示「重驗中、未驗完不能核可」）
              /* 封存＝資訊架構分流（2026-07-22 使用者反饋：總覽只放現役活動）：手動封存旗標；前工作台時代批次（無 wb_meta）自動歸歷史 */
              archived: meta.archived === true || (!meta.stage && !meta.input) };
          });
        return sendJson(res, 200, list);
      }
      if (req.method === "POST") {
        const input = JSON.parse(await readBody(req) || "{}");
        if (!input.url || !input.url.includes("tw.buy.yahoo.com")) return sendJson(res, 400, { error: "請貼 tw.buy.yahoo.com 的品牌頁／分類頁／活動頁網址" });
        /* 創建人必填（2026-07-25 使用者需求）：Email＋部門——隨 input 入 wb_meta、列表顯示
           07-29 使用者裁決（editor-ux-declutter AC3）：限公司信箱——前端只收帳號自動補網域，此處後端雙層擋外部信箱
           2026-10-14 使用者裁：公司信箱改 userid@yahootwec.com、舊 @yahooinc.com 直接擋。會走到這裡帶舊網域的，幾乎只有「升級前就開著的分頁」
           （舊前端還在補舊網域）——它看不到新前端的行內提示，只會 toast 這一句，所以這句本身就要帶出路。 */
        if (/@yahooinc\.com$/i.test(String(input.ownerEmail || "").trim())) return sendJson(res, 400, { error: "建立失敗・頁面是舊版 → 重新整理頁面（⌘R）再送一次（技術訊息：@yahooinc.com 已不再接受，公司信箱改為 @yahootwec.com）" });
        if (!input.ownerEmail || !/^[A-Za-z0-9._%+-]+@yahootwec\.com$/i.test(String(input.ownerEmail).trim())) return sendJson(res, 400, { error: "信箱・需要公司帳號 → 填 Outlook 寄件人 @ 前面那段（系統會自動補 @yahootwec.com）" });
        if (!input.ownerDept || !String(input.ownerDept).trim()) return sendJson(res, 400, { error: "請填寫創建人部門" });
        input.ownerEmail = String(input.ownerEmail).trim(); input.ownerDept = String(input.ownerDept).replace(/[\r\n]+/g, " ").trim();
        /* F4 07-29 review 修（資料衛生）：自填部門會進列表欄與活動總覽 Sheet——剝換行＋上限 40 字（超長會撐爆表列） */
        if (input.ownerDept.length > 40) return sendJson(res, 400, { error: "部門名稱太長（最多 40 字）——請填部門簡稱（例：跨境電商TEAM）" });
        /* 營運檔期欄位 2026-09-14 退場（69 號附錄 C Q3 甲）：建立不再收 activeFrom／activeUntil（舊客戶端若仍送，原樣落 meta.input、不處理） */
        /* 版式選擇（51 號 W1-C，2026-08-24）：kvVariant＝"ai"（伺服器走 51 附錄 B 代選）｜裸值貨號（值域驗證）。
           舊客戶端／舊表單不帶 kvVariant＝完全走原行為（不寫版式欄，零改動相容）。
           提案包＝伺服器複驗（鐵律 3：不信任前端已驗過）——非法整包擋下出聲。
           契約（W1-A review F2 交辦，2026-08-24）：本表單保證不寫空字串 kvVariant——「未選」＝欄位缺席；
           空白值在此 normalize 刪除，wb_meta.input／draft 永不出現 kvVariant:""。 */
        if (input.kvVariant != null && String(input.kvVariant).trim() === "") delete input.kvVariant;
        if (input.kvVariant != null) {
          let resolved;
          try {
            const deps = layoutLib.loadLayoutDeps();
            if (input.proposalPack != null) {
              const pr = parsePackStrict(input.proposalPack, deps.registries);
              if (!pr.ok) return sendJson(res, 400, { error: "提案包沒有通過驗證：" + pr.errors.join("；") });
              input.proposalPack = pr.pack; input.packWarnings = pr.warnings;
            }
            resolved = layoutLib.resolveLayoutChoice(input, deps);
          } catch (e) { return sendJson(res, 400, { error: errText(e) } ); } // AI 代選失敗／未知貨號／已停收＝擋下出聲（C3d/C4）
          input.kvVariant = resolved.kvVariant;     // 裸值貨號＝寫入 draft 與 wb_meta.input（retryCreate 回填）
          input.layoutChoice = resolved.choice;     // 理由行＋出處＝draft.meta.layoutChoice（C3c）
        }
        /* 2026-09-15：型態沒選＝從策略檔第一行補（策略檔是型態真源）；2026-09-25 使用者裁：主題也一樣（頁面名稱要跟策略檔主題走）。
           兩欄共用 fillInputFromBrief——原本只補型態、主題留空 ⇒ 機器策展退回品牌名。 */
        fillInputFromBrief(input);
        /* AI 路先重測一次再判（2026-09-21 丙案，story caps-recheck）：開機那一刻的答案會過期——
           往壞的方向過期＝能用卻被擋（今天的病例），往好的方向過期＝開機時能用、跑一天後憑證失效，
           介面照樣開著 AI 卡、按下去才在 20 分鐘後降級（假綠比假紅更難發現）。這一行只是「問一次現在」，
           不改 AI 路徑本身的錯誤處理（使用者 2026-09-21 裁「只修能力表這一層」）。 */
        if (input.engine === "ai") await detectCaps("AI 策展前確認");
        if (input.engine === "ai" && !(CAPS && CAPS.caps.ai)) { // 介面藏了卡還被送進來＝伺服器再擋一次（白話先講、技術句尾）
          return sendJson(res, 400, { error: CAPS
            ? `這台電腦目前用不了 AI 智慧策展（${(CAPS.detail.ai && CAPS.detail.ai.note) || "沒有可用的 Claude"}）——請改選快速草稿，30 秒就有頁。`
            : "還在確認這台電腦有沒有 AI，請幾秒後再試；或先選快速草稿。" });
        }
        const id = await createRun(input);
        return sendJson(res, 200, { id, kvVariant: input.kvVariant || null, layoutChoice: input.layoutChoice || null });
      }
    }

    if (seg[0] === "api" && seg[1] === "runs" && seg[2]) {
      const id = seg[2];
      const runDir = safeJoin(RUNS, id);
      if (!runDir || !fs.existsSync(runDir)) return sendJson(res, 404, { error: "找不到這個活動（可能已經被刪除）" });

      /* 刪除＝軟刪除歸檔（治理慣例「歸檔→裁決→移除」）：移至 runs/_deleted、全入口（列表/draftUrl/status）即刻 404 連動 */
      if (!seg[3] && req.method === "DELETE") {
        const meta = readMeta(id) || {};
        if (["fetching", "curating", "curating_ai", "gating"].includes(meta.stage)) {
          return sendJson(res, 409, { error: "這個活動還在建立處理中，暫時不能刪除——等它完成或失敗後就可以刪（若卡住超過 45 分鐘，系統會自動解除）" });
        }
        let pageName = ""; try { pageName = JSON.parse(fs.readFileSync(path.join(runDir, "draft.json"), "utf8")).page.pageName || ""; } catch (e) {}
        writeMeta(id, { deletedAt: new Date().toISOString(), deletedPageName: pageName });
        const trash = path.join(RUNS, "_deleted");
        fs.mkdirSync(trash, { recursive: true });
        const archivedName = `${id}__deleted-${new Date().toISOString().replace(/[:.]/g, "-")}`;
        fs.renameSync(runDir, path.join(trash, archivedName));
        /* 已發佈頁一併撤下（2026-08-28 舊殼退場批發現的斷鏈）：原本軟刪除只搬本機 run，
           deploy-site/live-drafts/<id>.json 留在部署目錄＝那個活動頁的直達網址仍然打得開，
           下一次全站部署還會把它再帶上線一次。歸檔＝連同已發佈檔一起撤，才是真的下架。
           失敗要出聲：撤不掉就回報（歸檔已完成，不因此回滾），提示改用手動刪檔。 */
        let liveRemoved = false, liveError = null;
        try {
          const livePath = path.join(DEPLOY_SITE, "live-drafts", `${id}.json`);
          if (fs.existsSync(livePath)) { fs.unlinkSync(livePath); liveRemoved = true; }
        } catch (e) { liveError = String((e && errText(e)) || e); }
        try {
          const eb = spawnSync(process.execPath, [path.join(__dirname, "export_batches.js"), path.join(DEPLOY_SITE, "activity-creation", "batches.json")], { encoding: "utf8" });
          if (eb.status !== 0) liveError = (liveError ? liveError + "；" : "") + `批次快照重出失敗（exit ${eb.status}）`;
        } catch (e) { liveError = (liveError ? liveError + "；" : "") + String((e && errText(e)) || e); }
        return sendJson(res, 200, {
          ok: true, archivedName, liveRemoved,
          note: liveError
            ? `已歸檔，但線上頁沒能一起撤掉——請手動刪掉 deploy-site/live-drafts/${id}.json 後重新部署。技術訊息：${liveError}`
            : (liveRemoved
                ? "已歸檔，這個活動的線上頁也一起撤掉了——下次部署後網址就會失效。"
                : "已歸檔（這個活動沒有發佈過線上頁）。")
        });
      }
      /* 還原：POST /api/runs/<archivedName>/restore */
      if (seg[3] === "restore" && req.method === "POST") {
        return sendJson(res, 404, { error: "restore 需對歸檔名操作：POST /api/runs-deleted/<archivedName>/restore" });
      }

      if (seg[3] === "status") {
        let log = "";
        try { const t = fs.readFileSync(path.join(runDir, "wb.log"), "utf8").split("\n"); log = t.slice(-12).join("\n"); } catch (e) {}
        const m = readMeta(id) || { id };
        /* 版式寫入失敗＝白話出聲（2026-08-24 review 中3）：前端 pollCreate 完成時刻讀這欄顯黃字警告 */
        return sendJson(res, 200, { ...m, layoutChoiceError: layoutChoiceErrorOf(m), logTail: log });
      }
      /* POST /api/runs/<id>/lifecycle（營運檔期編修）2026-09-14 退場（69 號附錄 C Q3 甲）——介面已無入口；既有 meta.lifecycle 保留不刪 */
      // 唯讀來源快照（2026-07-27：編修欄圖片下拉解鎖——策展帶入的商品缺 imgOptions，改用池 imgs＝gate CP-02 合法圖集）
      if (seg[3] === "snapshot.json" && req.method === "GET") return serveFile(res, path.join(runDir, "snapshot.json"));
      if (seg[3] === "draft.json") {
        if (req.method === "GET") { try { res.setHeader("X-Draft-Mtime", String(Math.floor(fs.statSync(path.join(runDir, "draft.json")).mtimeMs))); } catch (e) { /* 拿不到 mtime＝不帶標頭，畫面 base=0＝伺服器走「沒帶就放行」的舊路，不誤擋 */ } return serveFile(res, path.join(runDir, "draft.json")); } // 畫面記下「我載入的是幾點的草稿」，存回時帶回（PRICE-TRUTH-STALE-PUT，2026-09-28）
        if (req.method === "PUT") {
          const _bl = busyLock(id); if (_bl) return sendJson(res, 409, { error: _bl });
          const body = await readBody(req);
          let parsed;
          try { parsed = JSON.parse(body); } catch (e) { return sendJson(res, 400, { error: "儲存的內容格式有誤，這次沒有存入——請重新整理頁面後再試一次" }); }
          if (!parsed.page || !parsed.products) return sendJson(res, 400, { error: "儲存的內容不完整，這次沒有存入——請重新整理頁面後再試一次" });
          /* 舊草稿不准蓋新草稿（PRICE-TRUTH-STALE-PUT，2026-09-28；病例 140838）：建檔期「對商品頁現價」改了 28 件寫進草稿，6 秒後編輯畫面把它
             手上那份（建檔還沒完就載入的）舊草稿存回來＝改好的被蓋掉、發佈前檢查 CP-02×28。畫面帶 X-Draft-Base（載入時伺服器給的檔案時刻），
             系統最後改稿時刻 sysDraftWriteAt（建檔／重做收尾寫）在它之後＝409 回最新版、不落盤。沒帶＝舊畫面或測試，照舊放行。洞 #11（DRAFT-PUT-CONFLICT-CP）先修這一刀。 */
          { const baseMs = Number(req.headers["x-draft-base"] || 0), sysMs = Number((readMeta(id) || {}).sysDraftWriteAt || 0);
            if (baseMs && sysMs && sysMs > baseMs) {
              let latest = null; try { latest = JSON.parse(fs.readFileSync(path.join(runDir, "draft.json"), "utf8")); } catch (e) { appendLog(id, "draft 回存被擋後讀最新草稿失敗：" + e.message); }
              appendLog(id, `draft 回存被擋：畫面載入的草稿（${new Date(baseMs).toISOString()}）早於系統最後改稿（${new Date(sysMs).toISOString()}）——不蓋、回最新版`);
              return sendJson(res, 409, { error: "草稿・系統剛更新過 → 已換成最新版，請再改一次", code: "stale-draft", draft: latest, sysDraftWriteAt: sysMs });
            } }
          /* F9-1 後防（2026-07-29，story=docs/stories/promo-manual-channel-fixes.md）：手動入口目的地格式守門。
             實證＝run 2026-07-29-wb-143305 draft.v4/v9 商品型入口裸存賣場編號→連結內容檢查必判「連結格式不對」。
             裸編號（商品型）＝比照 productFetch 正規化成完整商品頁網址＋賣場編號追溯欄；非法＝白話擋下、不落盤。 */
          if (parsed.page.promoSourceMode === "manual" && Array.isArray(parsed.page.promoEntries)) {
            for (let iE = 0; iE < parsed.page.promoEntries.length; iE++) {
              const en = parsed.page.promoEntries[iE]; if (!en || typeof en !== "object") continue;
              const kindE = en.manualKind || "product";
              let vU = String(en.url || "").trim();
              if (!vU) { en.url = ""; continue; } // 空值交數量下限提示與檢查流程
              const pBareE = vU.match(/^(?:賣場編號|編號|gdid)?[\s:：=＝]*(p\d{8,18})$/i); /* p 型編號 2026-08-28（使用者實測 gdid=p0216265344571：gdsale.asp 形有 SSR、p-*.html 形 404——p 型一律走 gdsale.asp、數字型照舊） */
              const digitsE = vU.replace(/[^0-9]/g, "");
              const isBareE = pBareE || (digitsE.length >= 6 && digitsE.length <= 10 && /^(賣場編號|編號|gdid)?[\s:：=＝]*[0-9\s]+$/i.test(vU));
              if (isBareE) {
                if (kindE !== "product") return sendJson(res, 400, { error: `還沒儲存——本期活動第 ${iE + 1} 則入口要貼完整網址（賣場編號只適用「商品」種類）：請貼 https://tw.buy.yahoo.com 開頭的網址，或把種類改成「商品」` });
                vU = "https://tw.buy.yahoo.com/gdsale/gdsale.asp?gdid=" + (pBareE ? pBareE[1].toLowerCase() : digitsE);
              }
              let uE; try { uE = new URL(vU); } catch (e) { uE = null; }
              if (!uE || uE.protocol !== "https:" || uE.hostname !== "tw.buy.yahoo.com") return sendJson(res, 400, { error: `還沒儲存——本期活動第 ${iE + 1} 則入口的目的地要是 Yahoo購物中心的網址（https://tw.buy.yahoo.com 開頭）${kindE === "product" ? "，或直接輸入 6~10 碼賣場編號" : ""}` });
              if (kindE === "product") {
                const gE = gdidOf(vU);
                if (!gE) return sendJson(res, 400, { error: `還沒儲存——本期活動第 ${iE + 1} 則入口的網址看不出賣場編號：「商品」種類請貼商品頁網址（網址含 /gdsale/），或直接輸入 6~10 碼賣場編號` });
                en.gdid = gE;
              }
              en.url = vU;
            }
          }
          /* W2 內文模組值域檢（content-modules-wave2 M5；2026-08-25）：三節點在場才驗——
             variant 白名單（runtime 讀 modules.json）＋列數×版式一致＋URL 網域＋gdid 防懸空；
             與 content-modules 端點同一套驗證器（結構走端點、內容欄走本儲存路＝兩路同閘無後門）。
             W2 第二批（2026-08-26）：composeOrder 在場也要驗——條件不補＝PUT 路留後門。S11 模組批（2026-08-27）：不變式改釘位制（kv 首＋explore 末、中段七鍵自由）＋面數上限＋讀入正規化，全在 validateContentModules 單閘。
             W2.5 換皮批（2026-08-26）：page.promoVariant 在場也要驗（promo variants 白名單）——同理不留後門。
             促銷卡多卡批（2026-08-26）：page.promoCards（新形陣列 1~4）在場也要驗——舊鍵 promoCard 條件保留＝舊形單物件照驗。 */
          { /* 大體檢 CT-2 修（2026-08-27）：原「六鍵在場才驗」＝最常見舊稿形（無內文模組鍵）整條跳過＝
               composeOrder／面數的 PUT 後門。validateContentModules 內部本就逐欄「在場才驗」——無條件跑、單閘語意才成立。 */
            let regCM;
            try { regCM = contentModules.loadContentRegistry(); }
            catch (e) { return sendJson(res, 500, { error: "還沒儲存——內文模組值域檢查暫時無法運作（模組登記簿讀取問題）：" + errText(e) }); }
            try { contentModules.validateContentModules(parsed.page, regCM, parsed.products); }
            catch (e) { return sendJson(res, 400, { error: "還沒儲存——" + errText(e) }); }
            /* 面數上限 ratchet（S11 值域牆/樓層 ≤3；大體檢 OF 鎖死洞配套）：只擋「這次儲存讓面數變多且超位」——
               超限舊稿照樣能存（減面修回的路不堵死；出貨仍由 gate CP-16 把關） */
            try {
              const prevDj = JSON.parse(fs.readFileSync(path.join(runDir, "draft.json"), "utf8"));
              for (const [node, name, unit] of [["walls", "品類牆", "面"], ["floors", "主打樓層", "層"]]) {
                const nn = Array.isArray(parsed.page[node]) ? parsed.page[node].length : 0;
                const pp = Array.isArray((prevDj.page || {})[node]) ? prevDj.page[node].length : 0;
                if (nn > 3 && nn > pp) return sendJson(res, 400, { error: `還沒儲存——${name}最多 3 ${unit}（這次存檔會變成 ${nn} ${unit}；版面位子就是 3 ${unit}）。` });
              }
            } catch (e) { /* 舊稿讀不到（新建首存）＝略過 ratchet */ }
          }
          let v = 1; while (fs.existsSync(path.join(runDir, `draft.v${v}.json`))) v++;
          if (fs.existsSync(path.join(runDir, "draft.json"))) fs.copyFileSync(path.join(runDir, "draft.json"), path.join(runDir, `draft.v${v}.json`));
          fs.writeFileSync(path.join(runDir, "draft.json"), JSON.stringify(parsed, null, 1));
          appendLog(id, `draft 回存（備份 draft.v${v}.json）`);
          const droppedPc = reconcileProductCheckFile(runDir, parsed); // 幽靈列對帳（2026-08-30）：商品已不在草稿＝體檢報告同批清列，杜絕「按鈕叫你修一件不存在的商品」
          if (droppedPc) appendLog(id, `商品體檢報告對帳：清掉 ${droppedPc} 列已不在草稿的商品`);
          /* 核可失效（2026-07-25 design QA 修）：UI 一直承諾「已核可版本經修改＝核可將失效」但原未實作
             ——核可後任何回存即清 approvedAt（保留失效紀錄），上線前必須重新核可 */
          let approvalInvalidated = false;
          const m0 = readMeta(id) || {};
          if (m0.approvedAt) {
            writeMeta(id, { approvedAt: null, approvalInvalidatedAt: new Date().toISOString(), approvedAtPrev: m0.approvedAt });
            appendLog(id, `核可失效：核可（${m0.approvedAt}）後內容經編修——需重新核可`);
            approvalInvalidated = true;
          }
          return sendJson(res, 200, { ok: true, backup: `draft.v${v}.json`, approvalInvalidated, savedAt: new Date().toISOString() }); // savedAt＝F9-3 報告過時比對基準
        }
      }
      if (seg[3] === "gate" && req.method === "POST") {
        const skipHttp = u.searchParams.get("full") !== "1";
        const g = await runGate(id, skipHttp);
        let report = null;
        try { report = JSON.parse(fs.readFileSync(path.join(runDir, "gate_report.json"), "utf8")); } catch (e) {}
        return sendJson(res, 200, { exit: g.exit, output: g.output, report, mode: skipHttp ? "快檢" : "全檢" });
      }
      if (seg[3] === "stage2" && req.method === "POST") { // 送建置前打包：gate 全檢＋write_xlsx（結果如實呈現）
        const g = await runGate(id, false);
        const cx = await runNode(id, path.join(PIPE, "write_xlsx.js"), [runDir]);
        const xlsx = fs.readdirSync(runDir).filter((f) => f.endsWith(".xlsx"));
        let report2 = null; try { report2 = JSON.parse(fs.readFileSync(path.join(runDir, "gate_report.json"), "utf8")); } catch (e) {}
        return sendJson(res, 200, { gateExit: g.exit, gateOutput: g.output, report: report2, xlsxExit: cx, xlsx, note: g.exit === 0 ? "機器閘全綠——試算表可直接開，也可以匯入 Google Sheets 走核可流程" : "機器閘有 FAIL——試算表已產出、異常列標紅，修正後重跑" });
      }
      if (seg[3] === "gate_report.json") return serveFile(res, path.join(runDir, "gate_report.json"));
      /* 封存／移回總覽（非破壞、可逆；與刪除分離） */
      if (seg[3] === "archive" && req.method === "POST") { writeMeta(id, { archived: true }); appendLog(id, "封存（移出活動總覽→歷史與封存區）"); return sendJson(res, 200, { ok: true }); }
      if (seg[3] === "unarchive" && req.method === "POST") { writeMeta(id, { archived: false, stage: (readMeta(id) || {}).stage || "ready", input: (readMeta(id) || {}).input || {} }); appendLog(id, "自歷史與封存區移回活動總覽"); return sendJson(res, 200, { ok: true }); }
      /* ZIP 匯出（2026-07-25 五題裁決）：POST 啟動背景管線；GET 下載成品 */
      if (seg[3] === "export-zip" && req.method === "POST") {
        const meta0 = readMeta(id) || {};
        if (!fs.existsSync(path.join(runDir, "draft.json"))) return sendJson(res, 404, { error: "run 或 draft 不存在" });
        if (!meta0.approvedAt) return sendJson(res, 409, { error: "要先核可這個版本才能匯出——請先按「核可」，匯出時會自動再跑一次合規檢查把關" });
        { let holdZ = null; try { holdZ = heroBgLic.exportHoldReason(JSON.parse(fs.readFileSync(path.join(runDir, "draft.json"), "utf8")).page, { confirm: meta0.heroBgLicenseConfirm || null }); } catch (e) { appendLog(id, "EXPORT 讀草稿判擋句失敗（照常往下、由組裝器再判）：" + e.message); } if (holdZ) return sendJson(res, 409, { error: holdZ }); } /* 你上傳的背景／藏標題（78 號）：ZIP 路是第七道門——照 bg-map 抓圖會靜默無圖，這一版直接擋 */
        if (deployBusyStage(id)) return sendJson(res, 409, { error: "發佈內網預覽進行中——等發佈完成再匯出（兩者共用同一份檢查報告）" });
        if (meta0.exportZip && meta0.exportZip.stage && !["done", "error"].includes(meta0.exportZip.stage)) return sendJson(res, 409, { error: "匯出進行中——請等這一輪完成" });
        exportZip(id, runDir).catch((e) => { appendLog(id, "EXPORT EXC " + errText(e)); setExport(id, { stage: "error", error: errText(e) }); });
        return sendJson(res, 200, { ok: true, note: "匯出已啟動（合規全檢→組裝→5 裝置自測→打包；完成即可下載）" });
      }
      if (seg[3] === "export.zip" && req.method === "GET") {
        const meta0 = readMeta(id) || {};
        const f = meta0.exportZip && meta0.exportZip.stage === "done" && meta0.exportZip.file ? path.join(runDir, "export", meta0.exportZip.file) : null;
        if (!f || !fs.existsSync(f)) return sendJson(res, 404, { error: "還沒有可下載的檔案——請先按「下載 ZIP」開始匯出" });
        res.writeHead(200, { "Content-Type": "application/zip", "Content-Disposition": `attachment; filename="${meta0.exportZip.file}"`, "Content-Length": fs.statSync(f).size });
        return fs.createReadStream(f).pipe(res);
      }
      /* AEM 網頁檔製作（69 號 Phase 2）：POST 啟動背景管線（同 ZIP 的守門＝已核可＋不與上線／ZIP 同時跑）；GET 下載單一 HTML */
      if (seg[3] === "export-aem" && req.method === "POST") {
        const meta0 = readMeta(id) || {};
        if (!fs.existsSync(path.join(runDir, "draft.json"))) return sendJson(res, 404, { error: "run 或 draft 不存在" });
        if (!meta0.approvedAt) return sendJson(res, 409, { error: "要先核可這個版本才能製作——請先按「核可這一版」，製作時會自動再跑一次合規檢查把關" });
        { let holdA = null; try { holdA = heroBgLic.exportHoldReason(JSON.parse(fs.readFileSync(path.join(runDir, "draft.json"), "utf8")).page, { confirm: (readMeta(id) || {}).heroBgLicenseConfirm || null }); } catch (e) { appendLog(id, "AEM EXPORT 讀草稿判擋句失敗（照常往下、由組裝器再判）：" + e.message); } if (holdA) return sendJson(res, 409, { error: holdA }); } /* 78 號 9/30 版：own／藏標題不出 AEM（組裝器內同一支判斷再擋一次＝雙保險） */
        if (deployBusyStage(id)) return sendJson(res, 409, { error: "發佈內網預覽進行中——等發佈完成再製作（兩者共用同一份檢查報告）" });
        if (exportBusyStage(id)) return sendJson(res, 409, { error: "AEM 網頁檔還在製作中——請等這一輪完成" });
        exportAem(id, runDir).catch((e) => { appendLog(id, "AEM EXPORT EXC " + errText(e)); setExportAem(id, { stage: "error", error: errText(e) }); });
        return sendJson(res, 200, { ok: true, note: "已開始製作（合規全檢→組裝單一 HTML→三裝置顯示檢查；做好即可下載）" });
      }
      /* 「複製給 Gemini 的話」（2026-09-15 C 批，牆第 3 題甲②）：帶這檔的型態、主題、真實商品名（只名稱）＋該型態範本；整段自足（C-2 甲） */
      /* 補選型態（2026-09-15 C 批 C-3 乙）：建立時選「先不指定」的活動，在編修頁內容策略區補選——只寫 meta.input.scenario，草稿不動（版面在重做時才照新型態配） */
      if (seg[3] === "scenario" && req.method === "POST") {
        const b = JSON.parse(await readBody(req) || "{}");
        const hit = scenLib.resolve(String(b.scenario || ""));
        if (!hit) return sendJson(res, 400, { error: "這不是可用的活動型態——請從五張卡裡選一張。（技術：scenario 不在名冊）" });
        const m0 = readMeta(id) || {};
        writeMeta(id, { input: { ...(m0.input || {}), scenario: hit.value, ...(b.theme != null ? { theme: String(b.theme).trim() } : {}) } });
        appendLog(id, `補選活動型態：「${hit.title}」${b.theme != null ? `；主題「${String(b.theme).trim()}」` : ""}（草稿未動，重做時才照它配版面）`);
        return sendJson(res, 200, { ok: true, scenario: hit.value, scenarioTitle: hit.title });
      }
      if (seg[3] === "gemini-prompt" && req.method === "GET") {
        const m0 = readMeta(id) || {}; const inp = m0.input || {};
        let names = []; try { names = (JSON.parse(fs.readFileSync(path.join(runDir, "snapshot.json"), "utf8")).products || []).map((x) => (x && x.name) || "").filter(Boolean); } catch (e) { /* 還沒抓到商品＝組出來的話會請 Gemini 先問 */ }
        const scenario = String(inp.scenario || "").replace(/^0\d\s+/, "");
        if (!scenario) return sendJson(res, 400, { error: "先選這檔是哪一種活動，內容策略要照它寫。（技術：meta.input.scenario 為空）" });
        const r = geminiPrompt.buildGeminiPrompt({ scenario, theme: inp.theme || "", productNames: names, builtinDir: path.join(BRIEFS_DIR, "built-in") });
        return sendJson(res, 200, { ok: true, text: r.text, ...r.parts });
      }
      /* 照策略檔重做草稿（2026-09-15 C 批，牆第 3 題甲④）：同一批商品不重抓（沿 snapshot.json）、重做前備份 draft.vN、建立時的收尾同一支 finishDraftAfterCurate；
         核可隨之失效（跟手改一樣）。有手改先問＝前端的事（dirty／draftSavedAt>createdAt）；伺服器只擋忙碌中。 */
      if (seg[3] === "redo-draft" && req.method === "POST") {
        const b = JSON.parse(await readBody(req) || "{}");
        const m0 = readMeta(id) || {};
        if (["fetching", "curating", "curating_ai", "gating"].includes(m0.stage)) return sendJson(res, 409, { error: "這檔還在建立或檢查中——等它做完再重做。" });
        if (deployBusyStage(id) || exportBusyStage(id)) return sendJson(res, 409, { error: "發佈或製作 AEM 網頁檔正在進行——等它完成再重做。" });
        if (!fs.existsSync(path.join(runDir, "snapshot.json"))) return sendJson(res, 400, { error: "這檔沒有商品資料可以重排——請重新建立一次。（技術：snapshot.json 不存在）" });
        const bf = briefResolve(String(b.briefFile || ""));
        if (!bf || !/\.md$/.test(bf) || !fs.existsSync(bf)) return sendJson(res, 400, { error: "找不到這份策略檔——先在上面貼上或選一份。（技術：briefFile 不在 briefs 資料夾內）" });
        const parsed = briefLib.parseBrief(fs.readFileSync(bf, "utf8"));
        if (!parsed.ok) return sendJson(res, 400, { error: "這份策略檔沒通過檢查，不能拿來重做：" + parsed.errors.map((e) => e.say).join("；"), errors: parsed.errors });
        let v = 1; while (fs.existsSync(path.join(runDir, `draft.v${v}.json`))) v++;
        let backup = null;
        if (fs.existsSync(path.join(runDir, "draft.json"))) { fs.copyFileSync(path.join(runDir, "draft.json"), path.join(runDir, `draft.v${v}.json`)); backup = `draft.v${v}.json`; }
        const input = { ...(m0.input || {}), briefFile: String(b.briefFile) };
        if (b.scenario != null && String(b.scenario).trim()) input.scenario = String(b.scenario).trim(); // 對帳卡「照策略檔」那顆鈕＝型態一起改
        const filledX = fillInputFromBrief(input); // 2026-09-25：建立時沒補到主題的舊檔，重做時也補齊（型態與主題同一支）
        invalidateApproval(id);
        writeMeta(id, { input, stage: "curating", redo: { startedAt: new Date().toISOString(), backup, briefFile: input.briefFile } });
        appendLog(id, `照策略檔重做草稿：「${input.briefFile}」${backup ? `（先備份 ${backup}）` : ""}${b.scenario ? `；型態改為「${input.scenario}」` : ""}${filledX.includes("theme") ? `；主題依策略檔補為「${input.theme}」` : ""}`);
        (async () => {
          const hcR = layoutLib.heroCountArgs(input.kvVariant); if (hcR.note) appendLog(id, hcR.note); // 乙（2026-09-27）：重做也預留同樣件數（建立與重做同一支）
          const c = await runNode(id, path.join(__dirname, "curate_auto.js"), [runDir, "--scenario", input.scenario || "", "--theme", input.theme || "", ...briefArgs(input), ...hcR.args, ...ensureThemeFitPatch(id, runDir, input)]);
          if (c !== 0) { writeMeta(id, { stage: "error", error: "照策略檔重排沒有成功——上一版已備份，可到版本歷史還原。" }); return; }
          writeMeta(id, { engineUsed: "auto（照策略檔重做）" });
          await finishDraftAfterCurate(id, runDir, input);
          writeMeta(id, { stage: "gating", sysDraftWriteAt: Date.now() }); // 重做也是系統改稿（PRICE-TRUTH-STALE-PUT）
          await runGate(id, true);
          writeMeta(id, { stage: "ready", redo: { ...((readMeta(id) || {}).redo || {}), doneAt: new Date().toISOString() } });
          appendLog(id, "照策略檔重做完成");
        })().catch((e) => { appendLog(id, "REDO EXC " + errText(e)); writeMeta(id, { stage: "error", error: "重做時出錯：" + errText(e) }); });
        return sendJson(res, 200, { ok: true, backup, note: "已開始照策略檔重做（約 30 秒）；上一版已備份，版本歷史可還原。" });
      }
      if (seg[3] === "export.aem.html" && req.method === "GET") {
        const meta0 = readMeta(id) || {};
        const f = meta0.exportAem && meta0.exportAem.stage === "done" && meta0.exportAem.file ? path.join(runDir, "export", "aem", meta0.exportAem.file) : null;
        if (!f || !fs.existsSync(f)) return sendJson(res, 404, { error: "還沒有可下載的檔案——請先到「設定」選單按「製作 AEM 網頁檔」" });
        setExportAem(id, { downloadedAt: new Date().toISOString() }); // 2026-09-15 第 5 題甲：「已交付」＝AEM 檔真的被下載過（不是做好而已）
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Content-Disposition": `attachment; filename="${meta0.exportAem.file}"`, "Content-Length": fs.statSync(f).size });
        return fs.createReadStream(f).pipe(res);
      }
      /* 對外發佈（過渡期試驗＝個人 Netlify 公開站；正式對外後續接 Yahoo 網域產品規劃流程）——守門：須先通過內部上線管線 */
      if (seg[3] === "publish-public" && req.method === "POST") {
        /* 2026-08-05（lan-direct-access 設計 6）：通道已於 08-03 退役（publishPublic 本體早退），但退役前的三處守門文案
           反而在引導使用者「等上線完成再回來按對外發佈」＝文案與現實脫節（與 sheet-status 把 403 吞成「尚未連結」同類根因）。
           改＝路由層即回 410 Gone 說清楚已停用，不再讓人走完流程才撞牆。 */
        return sendJson(res, 410, { error: "對外發佈通道已於 2026-08-03 停用（外部平台全面退場、對外試驗站已刪除）。正式對外發佈待 Yahoo 網域接通後恢復（13 號平台／N-21）。" });
        const meta0 = readMeta(id) || {}; // eslint-disable-line no-unreachable -- 以下為退役前流程，保留供 N-21 恢復時對照
        // 2026-07-23 收斂會驗證修：雙重守門＝liveUrl 存在＋最近一次部署 stage=done（防「部署中途失敗但 liveUrl 殘留」空穴放行）
        if (!meta0.liveUrl || !meta0.deploy || meta0.deploy.stage !== "done") return sendJson(res, 409, { error: "要先完成「上線」並確認線上頁面正常，才能對外發佈——請先按「上線」，等全部自動把關都通過後再回來按「對外發佈」" });
        if (meta0.publicDeploy && !["done", "error"].includes(meta0.publicDeploy.stage)) return sendJson(res, 409, { error: "對外發佈進行中" });
        publishPublic(id, runDir).catch((e) => { appendLog(id, "PUBLIC EXC " + errText(e)); writeMeta(id, { publicDeploy: { stage: "error", error: errText(e) } }); });
        return sendJson(res, 200, { ok: true, note: "對外發佈已啟動（同步→上傳個人公開站→晉升）" });
      }
      /* ===== 編修組合面板（51 號 W1-D，2026-08-25）：換版式／折扣開關（kinRef 貨號對換）／改背景主題／貼提案包
         四路徑單一寫入口＝lib writeComboIntoDraft（slotKey 搬家＋未上場暫存＋換回還原＋落版備份）；
         寫後必 invalidateApproval（R4；登錄 scripts/draft-writers.allow「combo-apply」行）。
         換回還原＝強制重驗該批商品（meta.heroRestoreRecheck 旗＋自動開跑；未驗完＝approve 端點擋）。 */
      /* ── 你上傳的背景（78 號 2026-09-27；規格＝規劃 78 號 §三 4）──
         POST hero-bg ＝ 驗（尺寸、方向、手機重量）＋存原檔到 runs/<id>/hero-bg/＋回 heroBgOwn 描述；**不寫草稿**——
         寫草稿由前端接著走 hero-combo（同一寫入口＝核可失效／備份／afterDraftMutation 全沿用，draft 寫入點數不變）。 */
      if (seg[3] === "hero-bg" && seg.length === 4 && req.method === "POST") {
        const _bl = busyLock(id); if (_bl) return sendJson(res, 409, { error: _bl });
        const raw = await readBodyLimited(req, 15 * 1024 * 1024);
        if (raw === null) return sendJson(res, 413, { error: "圖太大——上限 10MB，請壓一下再上傳" });
        let b; try { b = JSON.parse(raw || "{}"); } catch (e) { return sendJson(res, 400, { error: "上傳內容讀不出來，請再試一次。（技術：body 非 JSON）" }); }
        let dj0; try { dj0 = JSON.parse(fs.readFileSync(path.join(runDir, "draft.json"), "utf8")); } catch (e) { return sendJson(res, 404, { error: "run 或 draft 不存在" }); }
        const pg0 = dj0.page || {};
        const m0 = readMeta(id) || {};
        const rr = await heroBgOwn.uploadOwnSlot({
          runDir, runId: id, layoutId: pg0.kvVariant, slot: b.slot, mime: b.mime, buf: Buffer.from(String(b.dataBase64 || ""), "base64"), name: b.name,
          answers: b.answers || {}, uploadedBy: (m0.input && m0.input.ownerEmail) || null, existing: pg0.heroBgOwn || null,
          mobileMaxKB: heroBgOwn.mobileMaxKB(path.join(PIPE, "..", "..", "design-assets", "backgrounds", "manifest.json")),
        });
        if (!rr.ok) { appendLog(id, `上傳背景（${String(b.slot)}）被擋：${rr.error}`); return sendJson(res, rr.code || 400, { error: rr.error }); }
        appendLog(id, `上傳背景 ${rr.slot} ${rr.w}×${rr.h}${rr.complete ? "（三張齊）" : `（還缺 ${rr.missing.join("、")}）`}：來源 ${srcOf(req)}`);
        return sendJson(res, 200, { ok: true, heroBgOwn: rr.heroBgOwn, complete: rr.complete, missing: rr.missing, note: rr.note });
      }
      if (seg[3] === "hero-bg" && seg.length === 4 && req.method === "DELETE") {
        const _bl = busyLock(id); if (_bl) return sendJson(res, 409, { error: _bl });
        const nDel = heroBgOwn.removeOwnBg(runDir);
        appendLog(id, `移除上傳的背景圖檔 ${nDel} 個：來源 ${srcOf(req)}`);
        return sendJson(res, 200, { ok: true, removed: nDel });
      }
      if (seg[3] === "hero-bg" && seg.length === 5 && req.method === "GET") {
        if (!heroBgOwn.isOwnFileName(seg[4])) return sendJson(res, 404, { error: "not found" });
        const f = safeJoin(path.join(runDir, heroBgOwn.DIRNAME), seg[4]);
        return f ? serveFile(res, f) : sendJson(res, 400, { error: "bad path" });
      }
      /* 版權確認（78 號 §三 8＋2026-09-29 牆 4 乙）：POST＝寫確認紀錄到 wb_meta.heroBgLicenseConfirm（出口判定的真源）。
         重輸帳號段：與建立時 ownerEmail 不符＝拒、空＝409（78 號原文）；記帳號、時間、圖組指紋、來源 IP。
         不寫草稿（G3 寫入點不增）——draft 顯示欄 confirmed 由前端接著走既有 hero-combo PUT，該路以本紀錄投影（防手貼假確認）。 */
      if (seg[3] === "hero-bg-confirm" && req.method === "POST") {
        const _bl = busyLock(id); if (_bl) return sendJson(res, 409, { error: _bl });
        const raw = await readBodyLimited(req, 64 * 1024);
        let b; try { b = JSON.parse(raw || "{}"); } catch (e) { return sendJson(res, 400, { error: "內容讀不出來，請再試一次。（技術：body 非 JSON）" }); }
        let pgC; try { pgC = JSON.parse(fs.readFileSync(path.join(runDir, "draft.json"), "utf8")).page || {}; } catch (e) { return sendJson(res, 404, { error: "run 或 draft 不存在" }); }
        if (!heroBgLic.isOwnBg(pgC)) return sendJson(res, 400, { error: "這檔沒有選用你上傳的背景——不需要版權確認" });
        const ownC = pgC.heroBgOwn || {};
        const missC = heroBgLic.ownMissingSlots(ownC) || [];
        if (missC.length) return sendJson(res, 409, { error: `三張圖還沒齊（缺 ${missC.join("、")}）——補齊再確認` });
        if (!ownC.sha256) return sendJson(res, 409, { error: "這組圖沒有指紋紀錄，請重新上傳一次再確認。（技術：heroBgOwn.sha256 缺）" });
        if (b.checked !== true) return sendJson(res, 409, { error: "先勾上面的版權確認，就能開始製作" }); /* 78 §三 7 過目稿原句 */
        const acct = String(b.account || "").trim();
        if (!acct) return sendJson(res, 409, { error: "請再輸入一次公司帳號——系統會記錄帳號、時間與這張圖的檔案指紋" });
        const ownerC = String(((readMeta(id) || {}).input || {}).ownerEmail || "").trim();
        /* 比帳號（@ 前那段）不比網域（2026-10-14）：公司信箱 @yahooinc.com → @yahootwec.com，舊活動記的是舊網域，
           同一個人換新信箱確認不該被擋成「不是負責人」（同一條信箱規則的第二道門，建立檢查見 POST /api/runs） */
        const acctLocal = (e) => String(e).toLowerCase().replace(/@(yahooinc|yahootwec)\.com$/, "");
        if (ownerC && acctLocal(acct) !== acctLocal(ownerC)) return sendJson(res, 409, { error: `帳號跟建立這檔活動時填的不符（建立時＝${ownerC}）——版權確認要由活動負責人本人做` });
        const confirmRec = { by: acct, at: new Date().toISOString(), sha256: ownC.sha256, source: srcOf(req) };
        writeMeta(id, { heroBgLicenseConfirm: confirmRec });
        appendLog(id, `背景版權確認：${acct} 確認圖組 ${String(ownC.sha256).slice(0, 12)}…（來源 ${confirmRec.source}）`);
        return sendJson(res, 200, { ok: true, confirm: confirmRec, message: heroBgLic.CONFIRM_DONE_MSG });
      }
      /* 背景製作說明（78 號 §三 6）：依這檔版式代入三裝置尺寸與提示詞；沿 import-template 的下載形 */
      if (seg[3] === "hero-kit" && req.method === "GET") {
        let dj0; try { dj0 = JSON.parse(fs.readFileSync(path.join(runDir, "draft.json"), "utf8")); } catch (e) { return sendJson(res, 404, { error: "run 或 draft 不存在" }); }
        const pg0 = dj0.page || {};
        let rec0 = null; try { rec0 = layoutLib.loadLayoutDeps().registries.layoutRecords.get(pg0.kvVariant) || null; } catch (e) {}
        if (!rec0) return sendJson(res, 400, { error: "這檔活動還沒有選新版式——先在組合面板選一款版面，說明才知道要給哪組尺寸" });
        const kitMode = String(u.searchParams.get("mode") || ""); /* bg｜text（下載對話框選的）；沒帶＝看開關 */
        const kitMeta = readMeta(id) || {}; const kitTheme = ((kitMeta.input || {}).theme || (kitMeta.input || {}).scenario || "");
        let kit; try { kit = heroBgKit.buildHeroBgKit({ layoutId: pg0.kvVariant, layoutName: rec0.name, skeleton: rec0.skeleton, pageName: pg0.pageName || id, heroTitleHidden: pg0.heroTitleHidden === true, mode: /^(bg|text)$/.test(kitMode) ? kitMode : undefined, theme: kitTheme, themeId: pg0.themeId || "", hero: pg0.hero || {}, maxKB: heroBgOwn.mobileMaxKB(path.join(PIPE, "..", "..", "design-assets", "backgrounds", "manifest.json")) }); }
        catch (e) { return sendJson(res, 500, { error: e.message }); }
        res.writeHead(200, { "Content-Type": "text/markdown; charset=utf-8", "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(kit.fileName)}`, "Cache-Control": "no-store" });
        return res.end(kit.markdown);
      }
      if (seg[3] === "hero-combo" && req.method === "POST") {
        const _bl = busyLock(id); if (_bl) return sendJson(res, 409, { error: _bl });
        const bC = JSON.parse(await readBody(req) || "{}");
        let depsC;
        try { depsC = layoutLib.loadLayoutDeps(); }
        catch (e) { return sendJson(res, 500, { error: "組合面板暫時無法運作（版式登記簿讀取問題）：" + errText(e) }); }
        let changeC;
        if (bC.pack != null) { // 貼提案包＝整組帶入並覆蓋手選（51 §2.13；伺服器複驗＝鐵律 3）
          const pr = heroCombo.packToChange(String(bC.pack), depsC.registries);
          if (!pr.ok) return sendJson(res, 400, { error: "提案包沒有通過驗證：" + pr.errors.join("；") });
          changeC = pr.change;
        } else {
          /* theme 框架批 2026-08-25 擴欄：自訂顏色（調色盤）／活動頁底色手調／排版檔位——值域與推導在 lib 驗（單一寫入口） */
          changeC = { kvVariant: bC.kvVariant, backgroundId: bC.backgroundId, themeId: bC.themeId,
            customColor: bC.customColor, customSlot: bC.customSlot, customSlots: bC.customSlots, pageBg: bC.pageBg, /* customSlots＝擋卡「一鍵複合修正」多槽通道（2026-08-27 擋色制） */
            heroTitleScale: bC.heroTitleScale, heroSubtitleScale: bC.heroSubtitleScale, heroTitleWidth: bC.heroTitleWidth,
            /* 行距兩欄 09-04 進了 lib 卻沒進這裡＝面板的「恢復原始組合」送 heroTitleLeading:null 一直被靜靜丟掉（沒控件所以沒人踩到）；字距 09-05 一起補 */
            heroTitleLeading: bC.heroTitleLeading, heroSubtitleLeading: bC.heroSubtitleLeading, heroTitleTracking: bC.heroTitleTracking,
            titleFrame: bC.titleFrame, titleStyleThemed: bC.titleStyleThemed, titleGroupWarp: bC.titleGroupWarp, /* 裝飾線（09-04）原本也漏在這裡；換妝與同組變形開關（09-05）一起補 */
            heroBgOwn: bC.heroBgOwn, heroTitleHidden: bC.heroTitleHidden, heroMarqueeHidden: bC.heroMarqueeHidden, /* 你上傳的背景／主視覺文字不顯示／跑馬文字不顯示（78 號 2026-09-27） */
            by: "manual" };
          /* 你上傳的背景：前端送來的 heroBgOwn 只認「這檔活動自己資料夾裡真的有的三檔」——路徑形狀 lib 驗、檔在不在這裡驗（防指到別檔或不存在的圖） */
          if (changeC.heroBgOwn && typeof changeC.heroBgOwn === "object" && changeC.heroBgOwn.files) {
            for (const [slotK, rel] of Object.entries(changeC.heroBgOwn.files)) {
              const pp = heroBgOwn.parseOwnApiPath(rel); /* 路徑規則單一立法（2026-09-29）：形不對、指到別檔、檔不在＝同一句擋 */
              if (!pp || pp.runId !== id || !fs.existsSync(path.join(runDir, heroBgOwn.DIRNAME, pp.file))) return sendJson(res, 400, { error: `上傳的背景檔案（${({ desktop: "桌機版", "768": "平板版", "375": "手機版" })[slotK] || slotK}）找不到，請重新上傳。（技術：heroBgOwn.files 指向不存在或非本檔的檔）` });
            }
            /* 確認欄投影（2026-09-29 牆 4 乙）：draft 的 heroBgOwn.confirmed 只是「顯示用」（引擎撤浮水印看它），
               真源＝wb_meta.heroBgLicenseConfirm——這裡一律以真源投影，手貼假 confirmed 會被抹掉、換過圖（sha 不符）自動撤。 */
            { const confP = (readMeta(id) || {}).heroBgLicenseConfirm || null;
              if (heroBgLic.ownConfirmMatches({ heroBgOwn: changeC.heroBgOwn }, confP)) changeC.heroBgOwn.confirmed = { at: confP.at, by: confP.by };
              else delete changeC.heroBgOwn.confirmed; }
          }
        }
        let rC;
        try { rC = heroCombo.writeComboIntoDraft(path.join(runDir, "draft.json"), changeC, depsC); }
        catch (e) { appendLog(id, "COMBO FAIL " + errText(e)); return sendJson(res, 400, { error: errText(e) }); } // 失敗全出聲：前端黃條（layoutChoiceError 同款模式）
        if (!rC.changed) return sendJson(res, 200, { ok: true, changed: false, draft: rC.draft, info: rC.info, approvalInvalidated: false });
        appendLog(id, `組合面板變更：${rC.info.summary}（備份 ${rC.backup}）｜${((rC.draft.meta || {}).layoutChoice || {}).reason || ""}`);
        const approvalInvalidatedC = invalidateApproval(id);
        let recheckC = null;
        if (rC.info.restoredGdids.length) {
          recheckC = { at: new Date().toISOString(), gdids: [...new Set(rC.info.restoredGdids)] };
          writeMeta(id, { heroRestoreRecheck: recheckC });
          appendLog(id, `換回還原 ${recheckC.gdids.length} 件商品——強制重驗開跑（未驗完擋核可＝14 §2.13）`);
          productCheck(id, runDir).catch((e) => {
            /* 日誌本身也可能寫不進（run 目錄不可寫＝重驗失敗的同一根因）——catch 裡再 throw＝未捕捉 rejection
               會把整台 server 帶下去（2026-08-25 QA 注入實測：chmod 唯讀＝服務崩）。降級 console 出聲，旗未清＝核可仍被擋。 */
            try { appendLog(id, "COMBO RECHECK EXC " + errText(e) + "——旗未清、核可仍被擋（不靜默放行）"); }
            catch (e2) { console.error(`[hero-combo] ${id} 換回重驗失敗且日誌寫不進（${errText(e)}／${e2.message}）——旗未清、核可仍被擋`); }
          });
        }
        const kvNowC = (rC.draft.page || {}).kvVariant || null;
        return sendJson(res, 200, { ok: true, changed: true, draft: rC.draft, backup: rC.backup, info: rC.info,
          approvalInvalidated: approvalInvalidatedC, heroRestoreRecheck: recheckC,
          layoutEngineNote: kvNowC ? layoutLib.engineNoteFor(kvNowC) : null });
      }
      /* ===== 頁面組成面板（W2 內文模組第一批，2026-08-25；story＝docs/stories/content-modules-wave2.md）：
         加入/移除/換版式（活動資訊卡 mechanic／主打選品 spotlight／促銷卡 promoCard）＝單一寫入口
         lib writeContentModuleIntoDraft（值域 runtime 讀 modules.json＝CP-25 讀簿模式＋落版備份）；
         寫後必 invalidateApproval（R4；登錄 draft-writers.allow「content-modules-apply」行）。
         內容欄編修＝走既有 draft 儲存（PUT draft.json），值域檢同一套 validateContentModules。 */
      /* ── Excel／Google Sheets 匯出檔帶入三個內文模組（2026-09-26 立案、當晚使用者裁「今天做完、進單機版」；story docs/stories/sheet-import-content-modules.md）──
         規則：上傳只是「幫你把格子填好」——填完就是普通欄位；範本與解析的欄位表全讀 lib（不手抄）；商品欄的真值走 productFetch＋R3 入池（跟貼網址同一條路）；
         套用走 lib applyImport（applyContentModule 同一寫入口＋validateContentModules 單閘）；寫入前備份 draft.vN；原檔留 imports/ 只為追溯，CMS 不讀它。 */
      if (seg[3] === "import-template" && req.method === "GET") {
        let regT; try { regT = contentModules.loadContentRegistry(); } catch (e) { return sendJson(res, 500, { error: "範本暫時做不出來（模組登記簿讀取問題）：" + e.message }); }
        const bufT = await sheetImport.buildTemplate(regT);
        res.writeHead(200, { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Length": bufT.length,
          "Cache-Control": "no-store", "Pragma": "no-cache", /* 2026-09-27 tofu-89 走查：同一網址瀏覽器把早上的舊範本快取回放＝使用者拿到 09-26 首版、以為新版把對照圖拿掉；前端 window.open 另加 ?t= 保險 */
          "Content-Disposition": `attachment; filename="content-modules-template.xlsx"; filename*=UTF-8''${encodeURIComponent(`活動內容範本-${id}.xlsx`)}` });
        return res.end(bufT);
      }
      if ((seg[3] === "import-preview" || seg[3] === "import-apply") && req.method === "POST") {
        const _bl = busyLock(id); if (_bl) return sendJson(res, 409, { error: _bl });
        const bodyI = await readBodyLimited(req, 20 * 1024 * 1024); if (bodyI == null) return sendJson(res, 413, { error: "檔案太大（上限 20MB）——請確認選的是用範本存出的 .xlsx" });
        let bI; try { bI = JSON.parse(bodyI || "{}"); } catch (e) { return sendJson(res, 400, { error: "沒有收到檔案內容——請重新選一次 .xlsx" }); }
        if (!bI.fileBase64) return sendJson(res, 400, { error: "沒有收到檔案——請重新選一次 .xlsx" });
        if (/\.xlsm$/i.test(String(bI.name || ""))) return sendJson(res, 400, { error: "含巨集的 .xlsm 不收——請另存成 .xlsx 再上傳" });
        let regI; try { regI = contentModules.loadContentRegistry(); } catch (e) { return sendJson(res, 500, { error: "帶入暫時無法運作（模組登記簿讀取問題）：" + e.message }); }
        const bufI = Buffer.from(String(bI.fileBase64).replace(/^data:[^,]*,/, ""), "base64");
        let parsedI; try { parsedI = await sheetImport.parseWorkbook(bufI, regI); }
        catch (e) { return sendJson(res, 400, { error: "這個檔讀不出來——請確認是用範本存出的 .xlsx（Google Sheets 走「檔案 → 下載 → Microsoft Excel」）。（技術：" + e.message + "）" }); }
        if (seg[3] === "import-preview") return sendJson(res, 200, { ok: true, report: parsedI.report, willImport: Object.keys(parsedI.modules) });
        if (!parsedI.report.sheets.length) return sendJson(res, 400, { error: "檔裡沒有任何一個模組分頁（活動資訊卡／主打選品／促銷卡）——請用「下載 Excel 範本」的檔來填", report: parsedI.report });
        if (parsedI.report.legacy) return sendJson(res, 400, { error: parsedI.report.legacy.message, report: parsedI.report }); /* 舊版範本（v1/v2）＝只講 lib 那一句，不印「有 1 格要先改好」不對題（2026-09-27 範本 v3） */
        if (parsedI.report.problemsTotal) return sendJson(res, 400, { error: `檔裡有 ${parsedI.report.problemsTotal} 格要先改好才能帶入——對帳清單有寫是哪幾格`, report: parsedI.report });
        if (!Object.keys(parsedI.modules).length) return sendJson(res, 400, { error: "檔裡沒有可帶入的內容（三個分頁都只有範例）", report: parsedI.report });
        const draftPathI = path.join(runDir, "draft.json"); if (!fs.existsSync(draftPathI)) return sendJson(res, 404, { error: "run 或 draft 不存在" });
        const snapPathI = path.join(runDir, "snapshot.json");
        const refsI = sheetImport.collectRefs(parsedI); const fetchedI = new Map();
        if (refsI.length && !fs.existsSync(snapPathI)) return sendJson(res, 409, { error: "這個活動缺少來源商品資料，沒辦法帶入新商品——請重新建立這個活動，或先把商品欄留空只帶文字" });
        for (const refI of refsI) { // 真值只走伺服器實抓（鐵律 2）；引用式選品位＝不傳 pageGdids（允許引用已在活動裡的商品，沿 pick 慣例）
          const rI = await productFetch({ url: refI.input });
          if (rI.code !== 200) return sendJson(res, rI.code === 200 ? 400 : rI.code, { error: `「${refI.where}」的商品「${refI.input}」讀不到：${rI.error}——這次整份都沒有帶入`, report: parsedI.report });
          fetchedI.set(refI.input, rI.product);
        }
        if (fetchedI.size) { // R3 入池（同 pick 分支）：實抓真值進快照池＝CP-02 池存在性鏈不斷
          const snapI = JSON.parse(fs.readFileSync(snapPathI, "utf8")); let touched = 0;
          for (const pI of fetchedI.values()) { const upI = upsertPoolEntry(snapI, pI, "R3:sheet-import"); if (upI.mode === "add" || upI.changed.length) { touched++; snapI.warnings = (snapI.warnings || []).concat(`R3 入池（Excel 帶入）：gdid ${pI.gdid}「${pI.name}」（${new Date().toISOString()}）`); } }
          if (touched) { fs.writeFileSync(snapPathI, JSON.stringify(snapI, null, 2)); appendLog(id, `Excel 帶入入池：${touched} 件`); }
        }
        let djI; try { djI = JSON.parse(fs.readFileSync(draftPathI, "utf8")); } catch (e) { return sendJson(res, 500, { error: "讀取草稿失敗：" + e.message }); }
        for (const pI of fetchedI.values()) { const aI = contentModules.alignDraftRowTruth(djI.products, pI); if (aI.length) appendLog(id, `Excel 帶入：草稿名稱同批收斂（gdid ${pI.gdid}）`); } // 名稱兩式 2026-10-05
        let rA; try { rA = sheetImport.applyImport(djI, parsedI, regI, fetchedI); }
        catch (e) { appendLog(id, "SHEET-IMPORT FAIL " + e.message); return sendJson(res, 400, { error: e.message, report: parsedI.report }); }
        let backupI = null;
        try { let v = 1; while (fs.existsSync(path.join(runDir, `draft.v${v}.json`))) v++; fs.copyFileSync(draftPathI, path.join(runDir, `draft.v${v}.json`)); backupI = `draft.v${v}.json`; fs.writeFileSync(draftPathI, JSON.stringify(djI, null, 1)); }
        catch (e) { return sendJson(res, 500, { error: "寫入草稿失敗：" + e.message + "——這次變更沒有存入，請再試一次" }); }
        try { const impDir = path.join(runDir, "imports"); fs.mkdirSync(impDir, { recursive: true }); const safeName = String(bI.name || "upload.xlsx").replace(/[^\w.\-\u4e00-\u9fff]+/g, "_").slice(0, 80); fs.writeFileSync(path.join(impDir, `${new Date().toISOString().replace(/[:.]/g, "-")}-${safeName}`), bufI); } catch (e) { appendLog(id, "Excel 帶入：原檔留存失敗（不影響帶入）" + e.message); }
        appendLog(id, `Excel 帶入：${rA.summary}（備份 ${backupI}）`);
        const apInvI = invalidateApproval(id);
        return sendJson(res, 200, { ok: true, changed: rA.changed, draft: djI, backup: backupI, report: parsedI.report, summary: rA.summary, notes: rA.notes, approvalInvalidated: apInvI });
      }
      if (seg[3] === "content-modules" && req.method === "POST") {
        const _bl = busyLock(id); if (_bl) return sendJson(res, 409, { error: _bl });
        const bW = JSON.parse(await readBody(req) || "{}");
        let regW;
        try { regW = contentModules.loadContentRegistry(); }
        catch (e) { return sendJson(res, 500, { error: "頁面組成面板暫時無法運作（模組登記簿讀取問題）：" + errText(e) }); }
        /* 貼稿選品（2026-08-26 主打選品首發；同日下午擴促銷卡＋牆/樓層＝14 §2.14 配套規則 8/9/10 登錄待審）：
           貼商品網址/賣場編號＝伺服器實抓真值（productFetch＝fetch_parse fetchPage＋price_qa
           classifyProductLiveness 三態；下架/失效＝白話拒收不落盤）→ 快照池 upsert（CP-02 池存在性，
           沿 editorial-add R3 慣例；稽核標＝lib PICK_KINDS.source）→ 帶著實抓結果走下方同一寫入口
           （lib pick 動作＝dedupe by gdid＋寫 slot/清單）。帳密鎖後＋busyLock 既有守門。
           兩類模組兩種互斥：主打選品/促銷卡＝引用式選品位（不傳 pageGdids＝允許引用已在活動裡的商品，
           下拉本來就能選它）；牆/樓層＝全頁互斥曝光面（傳 pageGdids＝整頁只能放一次；auto＝補一件折數最好的，
           沿 editorial-add 池邏輯 autoPickFromPool）。 */
        let pickPoolInvalidates = false; // 池真值同步過＝即使 draft 零變更也要失效核可（沿 r3-add 治理裁決）
        if (bW.action === "pick") {
          const pk = contentModules.PICK_KINDS[bW.kind];
          if (!pk) return sendJson(res, 400, { error: "這個區塊不支援貼網址帶入商品——目前開放主打選品、促銷卡、品類牆、主打樓層。（技術：action=pick kind 值域）" });
          if (bW.kind === "spotlight" && !contentModules.SPOTLIGHT_PICK_SLOTS[bW.slot]) return sendJson(res, 400, { error: "未知的商品位置，請重新整理頁面後再試。（技術：slot 不在 hero|ref1|ref2）" });
          if (bW.kind === "promoCard" && !contentModules.PROMO_CARD_PICK_SLOT_RE.test(String(bW.slot || ""))) return sendJson(res, 400, { error: `未知的卡片位置，請重新整理頁面後再試。（技術：slot 不在 card-1~card-${contentModules.PROMO_CARDS_MAX}）` }); /* 槽位正則＝lib 單一來源（原本這裡另抄一份 1～4 的槽位正則＝同規則兩道門，2026-09-09 上限 4→20 時收掉；絆線 test/unit/promo_cards_max.test.js 不准再出現自抄） */
          if (pk.exclusive && !(Number.isInteger(Number(bW.index)) && Number(bW.index) >= 0)) return sendJson(res, 400, { error: "找不到要加商品的位置，請重新整理頁面後再試。（技術：pick 缺 index）" });
          if (!fs.existsSync(path.join(runDir, "draft.json"))) return sendJson(res, 404, { error: "run 或 draft 不存在" }); // AC-17 前例：前置存在性守衛（互斥集合/寫入都要讀 draft）
          const snapPathK = path.join(runDir, "snapshot.json");
          if (!fs.existsSync(snapPathK)) return sendJson(res, 409, { error: "這個活動缺少來源商品資料，沒辦法帶入新商品——請重新建立這個活動，或先從下拉選單挑既有商品。" });
          let fetchedK;
          if (bW.auto === true) { // 🤖 補一件折數最好的＝僅全頁互斥模組（牆/樓層）；選品位（主打選品/促銷卡）請貼網址指名
            if (!pk.exclusive) return sendJson(res, 400, { error: "這個區塊沒有「補一件折數最好的」——請貼商品網址或輸入賣場編號指名商品。（技術：auto 僅 wall|floor）" });
            const djK = JSON.parse(fs.readFileSync(path.join(runDir, "draft.json"), "utf8"));
            const apK = await autoPickFromPool(runDir, pageExposedGdids(djK));
            if (apK.error) return sendJson(res, 409, apK);
            fetchedK = apK.product;
          } else {
            if (!String(bW.input || "").trim()) return sendJson(res, 400, { error: "請先貼上商品網址或輸入賣場編號，再按「帶入商品」。" });
            let pageGdidsK; // 全頁互斥模組＝把整頁曝光集合交給 productFetch 前置擋（409 白話「整頁只能放一次」）
            if (pk.exclusive) { const djK = JSON.parse(fs.readFileSync(path.join(runDir, "draft.json"), "utf8")); const hK = heroGdidSet(djK); pageGdidsK = [...pageExposedGdids(djK)].filter((g) => !hK.has(g)); } // 2026-10-05 裁決：主視覺不擋（重複＝gate WARN 提醒）
            const rK = await productFetch(pageGdidsK ? { url: String(bW.input), pageGdids: pageGdidsK } : { url: String(bW.input) });
            if (rK.code !== 200) return sendJson(res, rK.code, { error: rK.error });
            fetchedK = rK.product;
          }
          bW.product = fetchedK; // 真值只走伺服器實抓結果——前端傳的 product 欄一律覆蓋（鐵律 2）
          bW.auto = undefined; // lib 不吃 auto 旗（真值已在 product 欄）
          const snapK = JSON.parse(fs.readFileSync(snapPathK, "utf8"));
          const upK = upsertPoolEntry(snapK, fetchedK, pk.source);
          if (upK.mode === "add" || upK.changed.length) {
            snapK.warnings = (snapK.warnings || []).concat(upK.mode === "add"
              ? `R3 入池（${pk.name}貼稿）：gdid ${fetchedK.gdid}「${fetchedK.name}」（${new Date().toISOString()}）`
              : `R3 真值同步（${pk.name}貼稿）：gdid ${fetchedK.gdid} 同步 ${upK.changed.join("、")}（${new Date().toISOString()}）`);
            fs.writeFileSync(snapPathK, JSON.stringify(snapK, null, 2));
            appendLog(id, `${pk.name}貼稿${upK.mode === "add" ? "入池" : "真值同步"}：gdid ${fetchedK.gdid}${upK.mode === "sync" ? `（${upK.changed.join("、")}）` : ""}`);
            pickPoolInvalidates = upK.mode === "sync" && upK.changed.length > 0;
          }
        }
        let rW;
        try { rW = contentModules.writeContentModuleIntoDraft(path.join(runDir, "draft.json"), bW, regW); }
        catch (e) { appendLog(id, "CONTENT-MODULES FAIL " + errText(e)); return sendJson(res, 400, { error: errText(e) }); } // 失敗全出聲：前端 toast＋面板紅字（D9 同款）
        if (!rW.changed) {
          const apInv0 = pickPoolInvalidates ? invalidateApproval(id) : false; // draft 沒變但池真值同步過＝原核可脫鉤（money-facing）
          return sendJson(res, 200, { ok: true, changed: false, draft: rW.draft, info: rW.info, approvalInvalidated: apInv0 });
        }
        appendLog(id, `頁面組成變更：${rW.info.summary}（備份 ${rW.backup}）`);
        const approvalInvalidatedW = invalidateApproval(id);
        return sendJson(res, 200, { ok: true, changed: true, draft: rW.draft, backup: rW.backup, info: rW.info, approvalInvalidated: approvalInvalidatedW });
      }
      if (seg[3] === "product-check" && req.method === "POST") {
        const _bl = busyLock(id); if (_bl) return sendJson(res, 409, { error: _bl }); // 2026-07-27 根治(AC-5)：部署/ZIP 匯出中拒跑逐品實抓，避免競用抓取資源（deploy 內部直呼 productCheck() 函式、不經此路由，不受影響）
        const report = await productCheck(id, runDir);
        return sendJson(res, 200, report);
      }
      /* 套用新價＝快照同步更新（2026-07-25 裁決 Q4-A 強化版）：價格真值取自伺服器自家 product_check.json
         實抓落盤（不信前端傳值＝真值鏈不經客戶端）；同步 patch snapshot price/marketPrice＋重算 disc＋稽核。
         原死巷：只改 draft 價格→gate CP-02 驗「draft＝快照」必 FAIL、快照無任何更新機制 */
      if (seg[3] === "apply-live-price" && req.method === "POST") {
        const _bl = busyLock(id); if (_bl) return sendJson(res, 409, { error: _bl });
        const bodyP = JSON.parse(await readBody(req) || "{}");
        const gdid = String(bodyP.gdid || "");
        let pc = null; try { pc = JSON.parse(fs.readFileSync(path.join(runDir, "product_check.json"), "utf8")); } catch (e) {}
        const row = pc && (pc.results || []).find((x) => String(x.gdid) === gdid);
        if (!row || row.livePrice == null) return sendJson(res, 409, { error: "還沒有這件商品的最新價格——請先到「發佈前檢查」按「重新檢查」再套用" });
        const snapPath = path.join(runDir, "snapshot.json");
        const snap = JSON.parse(fs.readFileSync(snapPath, "utf8"));
        const sp = (snap.products || []).find((x) => String(x.gdid) === gdid);
        if (!sp) return sendJson(res, 409, { error: "這件商品不在這個活動的商品清單裡——請改用「替換商品」換一件" });
        const outP = patchSnapshotPrice(snap, sp, row, pc.checkedAt);
        fs.writeFileSync(snapPath, JSON.stringify(snap, null, 1));
        patchProductCheckFile(runDir, gdid, (r0) => { r0.snapPrice = outP.price; r0.snapDrift = false; }); // 磁碟報告同步（QA #3：F5 後殭屍復活）
        appendLog(id, `套用新價（快照同步）：gdid ${gdid} →$${outP.price}${outP.marketPrice ? `／原價 ${outP.marketPrice}` : "／原價移除"}`);
        const approvalInvalidatedS = invalidateApproval(id); // 2026-07-27 治理裁決：套價即失效核可（與批次 apply-live-price-all 一致）——patch 快照真值使原核可 draft 脫鉤，money-facing 需重新核可
        return sendJson(res, 200, { ok: true, price: outP.price, marketPrice: outP.marketPrice, approvalInvalidated: approvalInvalidatedS });
      }
      /* 一鍵套用全部變價（方案A 2026-07-27）：批次把商品狀態報告裡所有 online&drift 的實抓價套進快照，單次寫入＋稽核＋核可失效 */
      if (seg[3] === "apply-live-price-all" && req.method === "POST") {
        const _bl = busyLock(id); if (_bl) return sendJson(res, 409, { error: _bl });
        let pcA = null; try { pcA = JSON.parse(fs.readFileSync(path.join(runDir, "product_check.json"), "utf8")); } catch (e) {}
        if (!pcA || !Array.isArray(pcA.results)) return sendJson(res, 409, { error: "找不到商品狀態報告——請先到「發佈前檢查」按「重新檢查」再套用" });
        const drifts = pcA.results.filter((r) => r.status === "online" && (r.drift || r.snapDrift) && r.livePrice != null); // snapDrift＝來源紀錄落後（draft==live 但快照池價未更新）也要套（2026-07-27）
        if (!drifts.length) return sendJson(res, 200, { ok: true, applied: [], count: 0, skipped: [] });
        const snapPathA = path.join(runDir, "snapshot.json");
        const snapA = JSON.parse(fs.readFileSync(snapPathA, "utf8"));
        const applied = [], skipped = [];
        for (const row of drifts) {
          const sp2 = (snapA.products || []).find((x) => String(x.gdid) === String(row.gdid));
          if (!sp2) { skipped.push(String(row.gdid)); continue; }
          applied.push(patchSnapshotPrice(snapA, sp2, row, pcA.checkedAt));
        }
        fs.writeFileSync(snapPathA, JSON.stringify(snapA, null, 1));
        for (const a of applied) patchProductCheckFile(runDir, a.gdid, (r0) => { r0.snapPrice = a.price; r0.snapDrift = false; }); // 磁碟報告同步（QA #3）
        appendLog(id, `一鍵套用全部變價：${applied.length} 件${skipped.length ? `（跳過 ${skipped.length} 件不在池）` : ""}`);
        const approvalInvalidatedA = invalidateApproval(id);
        return sendJson(res, 200, { ok: true, applied, count: applied.length, skipped, approvalInvalidated: approvalInvalidatedA });
      }
      /* 重建來源紀錄（2026-07-27）：draft 有這件商品但快照池缺（歷史 r3-add 失敗等）＝gate CP-02「不存在於快照」
         而介面原本沒有任何動作能解（同 DJI 死循環家族：紅字必須配可行動按鈕）。以 draft 列的 url 伺服器實抓入池。 */
      if (seg[3] === "pool-rebuild" && req.method === "POST") {
        const _bl = busyLock(id); if (_bl) return sendJson(res, 409, { error: _bl });
        const bodyR = JSON.parse(await readBody(req) || "{}");
        const gdidR = String(bodyR.gdid || "");
        const djR = JSON.parse(fs.readFileSync(path.join(runDir, "draft.json"), "utf8"));
        const drow = (djR.products || []).find((x) => String(x.gdid) === gdidR);
        if (!drow) { // 幽靈列兜底（2026-08-30）：報告有、草稿沒有＝順手把那列清掉再回報，使用者按「重新檢查」就會乾淨，不再卡死巷
          patchProductCheckFile(runDir, gdidR, (r0) => { r0._stale = true; });
          reconcileProductCheckFile(runDir, djR);
          return sendJson(res, 404, { error: "這件商品已經不在這一檔活動裡了（先前換掉或移除過）——這條檢查是舊資料，已經幫你清掉；按「重新檢查」即可更新清單", staleCleared: true });
        }
        if (!drow.url) return sendJson(res, 400, { error: "這件商品在頁面上缺商品連結，無法重抓——請改用「替換商品」換一件" }); // 勿拿 draft gdid 當賣場編號組網址（兩套編號會抓錯品）
        const rf = await productFetch({ url: drow.url });
        if (rf.code !== 200) return sendJson(res, rf.code, { error: rf.error });
        // 池鍵必須＝draft gdid：productFetch 回的 gdid 是 URL 尾碼「頁面實體 id」，鈦案實證與 draft gdid 是兩套編號——
        // 用實體 id 入池＝gate CP-02 與 snapMissing（都用 draft gdid 查池）永不歸零、按鈕假成功（QA #2）
        rf.product.gdid = gdidR;
        const snapPathR = path.join(runDir, "snapshot.json");
        const snapR = JSON.parse(fs.readFileSync(snapPathR, "utf8"));
        const upR = upsertPoolEntry(snapR, rf.product);
        snapR.warnings = (snapR.warnings || []).concat(`來源紀錄重建：gdid ${gdidR}（${upR.mode === "add" ? "補入池" : "同步 " + (upR.changed.join("、") || "無變更")}；${new Date().toISOString()}；伺服器實抓）`);
        fs.writeFileSync(snapPathR, JSON.stringify(snapR, null, 1));
        patchProductCheckFile(runDir, gdidR, (r0) => { delete r0.snapMissing; r0.snapPrice = rf.product.price; if (r0.livePrice != null) r0.snapDrift = rf.product.price !== r0.livePrice; }); // 磁碟報告同步（QA #3）
        /* 名稱兩式死鎖根治（2026-10-05）：按鈕承諾「兩邊就會對齊」，原本只寫池那半邊——草稿留著清單寫法
           ＝CP-02 名稱比對照樣紅、按幾次都一樣。這裡把草稿那半邊補上（名稱＝系統帶入欄，同步成頁面真值），
           走備份鏈落盤＝可還原。判定與理由＝lib/content_modules.alignDraftRowTruth（單一真源）。 */
        const alignedR = contentModules.alignDraftRowTruth(djR.products, rf.product);
        if (alignedR.length) {
          let vR = 1; while (fs.existsSync(path.join(runDir, `draft.v${vR}.json`))) vR++;
          fs.copyFileSync(path.join(runDir, "draft.json"), path.join(runDir, `draft.v${vR}.json`));
          fs.writeFileSync(path.join(runDir, "draft.json"), JSON.stringify(djR, null, 1)); // 字面路徑＝G3 絆線可計數（勿改用變數）
          appendLog(id, `來源紀錄重建：草稿同批收斂 ${alignedR.join("、")}（gdid ${gdidR}；備份 draft.v${vR}.json）`);
        }
        appendLog(id, `來源紀錄重建：gdid ${gdidR}（${upR.mode === "add" ? "補入池" : "真值同步"}）`);
        const approvalInvalidatedR = (upR.mode === "sync" && upR.changed.length) || alignedR.length ? invalidateApproval(id) : false;
        return sendJson(res, 200, { ok: true, mode: upR.mode, product: rf.product, draftAligned: alignedR, approvalInvalidated: approvalInvalidatedR });
      }
      if (seg[3] === "product_check.json") return serveFile(res, path.join(runDir, "product_check.json"));

      /* 版本歷史：draft.vN.json 備份鏈＋還原（還原前現版自動再備份＝不丟任何版本） */
      if (seg[3] === "versions" && !seg[4] && req.method === "GET") {
        const list = fs.readdirSync(runDir).filter((f) => f.startsWith("draft.v") && f.endsWith(".json"))
          .map((f) => ({ file: f, n: Number(f.slice(7, -5)), mtime: fs.statSync(path.join(runDir, f)).mtime.toISOString() }))
          .sort((a, b) => b.n - a.n);
        const cur = fs.existsSync(path.join(runDir, "draft.json")) ? fs.statSync(path.join(runDir, "draft.json")).mtime.toISOString() : null;
        const meta = readMeta(id) || {};
        return sendJson(res, 200, { current: cur, approvedAt: meta.approvedAt || null, deploy: meta.deploy || null, versions: list });
      }
      if (seg[3] === "versions" && seg[4] && seg[5] === "rollback" && req.method === "POST") {
        const _bl = busyLock(id); if (_bl) return sendJson(res, 409, { error: _bl });
        if (!/^draft\.v\d+\.json$/.test(seg[4])) return sendJson(res, 400, { error: "這個版本的檔案名稱不正確——請重新整理頁面後再試一次" });
        const vf = path.join(runDir, seg[4]);
        if (!fs.existsSync(vf)) return sendJson(res, 404, { error: "找不到這個版本——請重新整理頁面後再試一次" });
        let v = 1; while (fs.existsSync(path.join(runDir, `draft.v${v}.json`))) v++;
        fs.copyFileSync(path.join(runDir, "draft.json"), path.join(runDir, `draft.v${v}.json`));
        fs.copyFileSync(vf, path.join(runDir, "draft.json"));
        const m0r = readMeta(id) || {};
        const approvalInvalidated = (m0r.approvedVersionBackup !== seg[4]) ? invalidateApproval(id) : false; // QA #1：還原到非核可版＝核可失效（同旁路端點不變式，原漏掛＝核可鎖被繞過）
        appendLog(id, `版本還原：${seg[4]} → draft.json（原現版備份為 draft.v${v}.json）`);
        /* 大體檢 J-01 修（2026-08-27）：還原後同步重跑合規快檢——否則畫面四處的「檢查都過了」是還原前那一版的結果、
           假全綠可核可（勾選知悉也不會出現）。快檢秒級、同步等完再回＝前端重載即拿到新鮮報告。 */
        let rollbackRegate = null;
        try { const gR = await runGate(id, true); rollbackRegate = gR.exit === 0 ? "PASS" : "FAIL"; appendLog(id, `還原後合規快檢＝${rollbackRegate}`); }
        catch (e) { appendLog(id, "還原後合規快檢失敗（出聲不吞）：" + errText(e)); }
        return sendJson(res, 200, { ok: true, backup: `draft.v${v}.json`, approvalInvalidated, rollbackRegate });
      }
      /* 核可版本：page.status → 待建置（03 schema 狀態欄語意）＋核可時間戳；核可點自動落一版備份 */
      if (seg[3] === "approve" && req.method === "POST") {
        const _bl = busyLock(id); if (_bl) return sendJson(res, 409, { error: _bl });
        /* 換回還原＝強制重驗、未驗完擋核可（51 號 W1-D；14 §2.13）：旗立後必須有「時刻晚於旗」的商品狀態報告 */
        const mRR = readMeta(id) || {};
        if (mRR.heroRestoreRecheck && mRR.heroRestoreRecheck.at) {
          let pcRR = null; try { pcRR = JSON.parse(fs.readFileSync(path.join(runDir, "product_check.json"), "utf8")); } catch (e) { pcRR = null; /* 沒報告＝該批未驗＝下面照擋（fail-safe 方向） */ }
          if (!pcRR || !pcRR.checkedAt || pcRR.checkedAt < mRR.heroRestoreRecheck.at) {
            return sendJson(res, 409, { error: `還不能核可：剛才換版式把 ${(mRR.heroRestoreRecheck.gdids || []).length} 件商品從「未上場暫存」換回頁面，這批商品的狀態與價格必須重新驗過（系統已自動開跑重驗；請等「發佈前檢查」清單更新後再核可，或到「發佈前檢查」按一次「重新檢查」）` });
          }
          writeMeta(id, { heroRestoreRecheck: null }); // 報告已覆蓋＝清旗（防舊旗永久卡核可）
        }
        const bodyA = JSON.parse(await readBody(req) || "{}");
        const dPath = path.join(runDir, "draft.json");
        const dj = JSON.parse(fs.readFileSync(dPath, "utf8"));
        let v = 1; while (fs.existsSync(path.join(runDir, `draft.v${v}.json`))) v++;
        fs.copyFileSync(dPath, path.join(runDir, `draft.v${v}.json`));
        dj.page.status = "待建置";
        fs.writeFileSync(dPath, JSON.stringify(dj, null, 1));
        // 2026-07-25 裁決 Q3-C 軟擋留痕：帶 FAIL 核可＝記稽核印記（前端勾選確認後送 ackFail）；全綠核可＝清印記
        const m = writeMeta(id, { approvedAt: new Date().toISOString(), approvedVersionBackup: `draft.v${v}.json`,
          approvedWithFail: bodyA.ackFail ? (Number(bodyA.failCount) || 1) : null });
        // 2026-08-05（設計 5）：核可與上線補記來源 IP＝機器級最低稽核（共用帳密分不出人員；人員級歸屬待 N-26 個人帳號）
        appendLog(id, `版本核可：status→待建置（核可點備份 draft.v${v}.json）｜來源 ${srcOf(req)}${bodyA.ackFail ? `｜⚠ 帶 ${bodyA.failCount} 個 FAIL 核可（使用者勾選知悉＝先鎖版後修；2026-07-25 裁決 Q3-C）` : ""}`);
        return sendJson(res, 200, { ok: true, approvedAt: m.approvedAt });
      }
      /* 上線部署（背景）：gate 全檢綠 → 站級兩閘（selftest＋price_qa）→ 發佈 draft 至分享站 live-drafts/ → netlify draft → API 晉升
         → ⑥ GHES Pages 同步（2026-08-04 Task 3 過渡期雙軌：Netlify 主通道、GHE best-effort 出聲不擋；Task 5 轉主）
         （2026-07-29 F11：發佈移到兩閘之後＝未過閘內容不落地部署目錄） */
      if (seg[3] === "deploy" && req.method === "POST") {
        const meta0 = readMeta(id) || {};
        if (meta0.deploy && meta0.deploy.stage && !["done", "error"].includes(meta0.deploy.stage)) {
          return sendJson(res, 409, { error: "發佈內網預覽進行中——請等這一輪完成再操作" });
        }
        if (exportBusyStage(id)) return sendJson(res, 409, { error: "AEM 網頁檔製作中——等這一輪做完再發佈（兩者共用檢查報告）" }); // 2026-07-25 QA：雙向互鎖
        { /* own 發佈門（78 號→2026-09-29 牆 2 乙＋背景的家甲案）：版權確認相符＝放行（deployRun 會把三張圖複製進站）；
             未確認／換過圖＝擋、句子指路（過目定稿）。原「內網站放不到這張圖」的理由已由甲案解掉。 */
          let pgD = null; try { pgD = JSON.parse(fs.readFileSync(path.join(runDir, "draft.json"), "utf8")).page || null; } catch (e) { appendLog(id, "DEPLOY 讀草稿判自傳背景失敗（照常往下、由 gate 再判）：" + e.message); }
          if (pgD && heroBgLic.isOwnBg(pgD)) {
            const confD = (readMeta(id) || {}).heroBgLicenseConfirm || null;
            if (!heroBgLic.ownConfirmMatches(pgD, confD)) {
              const ownDd = pgD.heroBgOwn || {};
              return sendJson(res, 409, { error: (confD && confD.sha256 && ownDd.sha256 && confD.sha256 !== ownDd.sha256) ? heroBgLic.EXPORT_HOLD_CHANGED : heroBgLic.DEPLOY_HOLD_UNCONFIRMED });
            }
          }
        }
        appendLog(id, `上線請求：來源 ${srcOf(req)}`); // 設計 5：deployRun 是背景 async，來源須在路由層（還握有 req）就記
        deployRun(id, runDir).catch((e) => { appendLog(id, "DEPLOY EXC " + errText(e)); writeMeta(id, { deploy: { stage: "error", error: errText(e) } }); });
        return sendJson(res, 200, { ok: true, note: "部署已啟動（gate 全檢→站級兩閘→發佈→上傳→晉升；進度見批次狀態）" });
      }
    }

    sendJson(res, 404, { error: "not found" });
  } catch (e) {
    sendJson(res, 500, { error: "系統發生未預期的問題，這次操作沒有完成——請重新整理頁面後再試一次（技術訊息：" + errText(e) + "）" });
  }
});

/* 開放綁定的前提＝必須有登入密碼（lan-direct-access 設計 2）：WB_PASS 未設時 authOk 直接放行全站（authOk 首行），
   純本機無害、對內網開放等於裸奔＝必須擋。
   2026-08-05 紅隊修正（B2）：原設計為「拒絕啟動＋marker 讓看門狗停手」——但 08:30 run 巡檢與 09:30 自動修價
   都是 server 行程內建排程（money-facing），服務不起＝那天整天不巡檢不修價，等於用真值風險換一個便利功能，
   （2026-09-14 補註：兩條巡檢排程已退場、僅剩每日引擎自我測試——「降級回落＋大聲告警」的設計不變。）
   而唯一告警還是沒人看的桌面通知。改為**降級回落純本機＋大聲告警**：綁定要求不生效（安全側先守住），
   但服務與排程照跑（可用性側不犧牲），符合「失敗要出聲、不靜默降級」——回落本身就是明說出來的降級。 */
if (BIND.open && !WB_PASS) {
  BIND.open = false; BIND.host = "127.0.0.1";
  const msg = `⚠ 內網開放未生效：${BIND_FILE} 要求綁 0.0.0.0，但 WB_PASS 未設定＝會變成無登入防護的開放服務，已回落純本機。`
    + `　處置＝①確認 workbench/.wb-pass 存在且看門狗啟動行有注入 WB_PASS ②或刪除 .wb-bind 消除這個警告。`
    + `　（排程與本機操作不受影響，同事暫時連不進來）`;
  console.error(msg);
  try { fs.writeFileSync(BIND_REFUSE_MARKER, `${new Date().toISOString()} ${msg}\n`); } catch (e) { /* marker 純為可視性，寫不進不影響服務 */ }
  notifyMac("內網開放未生效（缺登入密碼）＝已回落純本機，同事連不進來"); // 函式宣告已提升，此處可用
} else {
  try { fs.unlinkSync(BIND_REFUSE_MARKER); } catch (e) { /* 沒有舊 marker＝正常 */ }
}

/* CMS 提示產物啟動保鮮（70 號 2026-09-09；沿 build_bg_map 前例）：真源（規劃 repo 欄位字典）在這台機器＝開機重算一次，
   欄位提示／預覽示範句／版面卡長相圖跟真源同步；真源不在（69 號同事編修版）＝生成器自己印一行說明、沿用 commit 產物，不擋啟動。失敗出聲不吞。 */
{
  const ch = spawnSync(process.execPath, [path.join(PIPE, "tools", "build_cms_hints.js")], { encoding: "utf8", timeout: 30000 });
  if (ch.status !== 0) console.error("[cms-hints] 啟動保鮮失敗（CMS 仍可用、提示可能是舊版）：", String(ch.stderr || ch.stdout || "").trim().slice(0, 300));
  else console.log(String(ch.stdout || "").trim());
}
server.on("error", (e) => {
  /* listen 失敗（最常見＝port 被占）原本走 onFatal 印機器話，接著因 setInterval 掛著、不聽也不死，終端機最後一行還像正常（2026-09-16 打包前總檢 A-高3） */
  const inUse = e && e.code === "EADDRINUSE";
  console.error(inUse
    ? `[fatal] ${PORT} 這個門已經被別的程式占住了。若是工具本來就開著，直接開瀏覽器 http://localhost:${PORT} 即可；不是的話換一個門：zsh workbench/start-editor.sh ${PORT + 1}`
    : `[fatal] 伺服器開不起來：${(e && (e.code || errText(e))) || e}`);
  process.exit(1);
});
server.listen(PORT, BIND.host, () => {
  serverListening = true;
  console.log(`策展工作台 v0：http://localhost:${PORT}`);
  console.log(MODE === "editor" ? `模式：編修（同事版）——純本機免登入、不發佈、不連 Google、無排程；活動檔落點 ${RUNS}；策略檔落點 ${MY_BRIEFS_DIR}` : `模式：負責人`);
  detectCaps("啟動"); // 不 await：探針最長 23 秒，期間 CAPS 為 null＝前端 fail-closed 先不渲染能力門後的東西
  try { purgeTrash("開機"); } catch (e) { console.error("[trash] 開機清掃失敗：" + errText(e)); }
  if (BIND.open) console.log(`⚠ 內網開放模式（綁 ${BIND.host}）：同一網路的人可用「http://<本機內網IP>:${PORT}」連入，需帳號 ${WB_USER} 與 .wb-pass 密碼——關閉方式＝刪除 ${BIND_FILE} 後重啟`);
  else console.log(`綁定：127.0.0.1（純本機；要對內網開放＝建立 ${BIND_FILE} 內容 0.0.0.0 後重啟）`);
  console.log(`FrameTest 掛載：${FRAMETEST_DIR}`);
});

/* 卡死 busy stage 回收（2026-07-25 design QA 修）：server 重啟/中斷會殺掉建立背景流程，meta 停在
   fetching/curating(_ai)/gating＝前台永久轉圈、封存刪除全被鎖（實證 220414 卡 curating_ai 兩日）。
   判準＝busy stage 且 updatedAt 停滯 >45 分（AI 逾時上限 20 分＋餘裕）→有 draft＝ready、無＝error。 */
const STALE_BUSY_MS = 45 * 60 * 1000;
/* 垃圾桶自動清掉（P-5 乙，2026-09-15 使用者裁 30 天）：進垃圾桶滿 TRASH_KEEP_DAYS 天＝永久刪除。開機掃一次、每次列垃圾桶時掃一次；不掛計時器（同事機零排程）。 */
const TRASH_KEEP_DAYS = Math.max(1, Number(process.env.CAMPAIGN_TRASH_DAYS) || 30);
function purgeTrash(why) {
  const trash = path.join(RUNS, "_deleted"); if (!fs.existsSync(trash)) return 0;
  let n = 0;
  for (const name of fs.readdirSync(trash)) {
    const d = path.join(trash, name); if (!fs.statSync(d).isDirectory()) continue;
    let deletedAt = null; try { deletedAt = JSON.parse(fs.readFileSync(path.join(d, "wb_meta.json"), "utf8")).deletedAt || null; } catch (e) { deletedAt = null; }
    const t = deletedAt ? Date.parse(deletedAt) : NaN; if (!Number.isFinite(t)) continue; // 沒記刪除時間＝不自動動它（只准使用者手動永久刪除）
    if ((Date.now() - t) / 86400000 >= TRASH_KEEP_DAYS) { fs.rmSync(d, { recursive: true, force: true }); n++; }
  }
  if (n) console.log(`[trash] 自動清掉 ${n} 檔（進垃圾桶滿 ${TRASH_KEEP_DAYS} 天；${why}）`);
  return n;
}
function reconcileStaleBusy() {
  try {
    for (const n of fs.readdirSync(RUNS)) {
      if (n.startsWith("_")) continue;
      const meta = readMeta(n);
      if (!meta) continue;
      // 卡死建立流程回收
      if (["fetching", "curating", "curating_ai", "gating"].includes(meta.stage)) {
        const ts = Date.parse(meta.updatedAt || meta.createdAt || 0);
        if (ts && Date.now() - ts >= STALE_BUSY_MS) {
          const hasDraft = fs.existsSync(path.join(RUNS, n, "draft.json"));
          writeMeta(n, hasDraft ? { stage: "ready" } : { stage: "error", error: "建立流程被中斷（伺服器重啟或機器休眠）沒有完成——請用「↻ 以相同條件重試」重新建立" });
          appendLog(n, `卡死狀態回收：${meta.stage}（停滯逾 45 分）→ ${hasDraft ? "ready（草稿已存在）" : "error（無草稿）"}`);
          console.log(`[reconcile] ${n}: ${meta.stage} → ${hasDraft ? "ready" : "error"}`);
        }
      }
      // 卡死背景管線忙碌旗標回收（2026-07-25 QA：崩潰後 busy 旗標會永久鎖住編修/部署——含對外發佈）
      const KEY_ZH = { deploy: "發佈內網預覽", exportZip: "ZIP 匯出", exportAem: "AEM 網頁檔製作", publicDeploy: "對外發佈" };
      for (const key of ["deploy", "exportZip", "exportAem", "publicDeploy"]) {
        const b = meta[key];
        if (b && b.stage && !["done", "error"].includes(b.stage)) {
          const bts = Date.parse(b.startedAt || meta.updatedAt || 0);
          if (bts && Date.now() - bts >= STALE_BUSY_MS) {
            writeMeta(n, { [key]: { ...b, stage: "error", error: `${KEY_ZH[key]}被中斷沒有完成（伺服器重啟或休眠）——請重試` } });
            appendLog(n, `${key} 卡死回收：${b.stage}（停滯逾 45 分）→ error`);
            console.log(`[reconcile] ${n}: ${key} ${b.stage} → error`);
          }
        }
      }
    }
  } catch (e) { console.error("[reconcile] " + errText(e)); }
}
reconcileStaleBusy();
setInterval(reconcileStaleBusy, 10 * 60 * 1000);

/* ===== run_patrol.js 純函式層（保留）：列表商品狀態燈仍用 summarizeCheck；lifecycle 判定自 2026-09-14 起無消費端（封存）。
   原 08:30「活動 run 每日巡檢」（runPatrolAll＋POST /api/patrol/run＋總覽表更新）2026-09-14 退場＝69 號附錄 C Q2 乙（使用者裁「立刻關掉」）：
   它守的是分享站上的總覽表，分散模型下真相在同事上傳的檔；通知信由 Google 側 Apps Script 觸發器寄出，須使用者親手停（19 號）。 */
const runPatrolLib = require(path.join(PIPE, "run_patrol.js"));
const localToday = () => { const n = new Date(); return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}-${String(n.getDate()).padStart(2, "0")}`; };
function notifyMac(msg) { try { spawn("osascript", ["-e", `display notification ${JSON.stringify(String(msg).slice(0, 180))} with title "Campaign Studio 排程"`], { stdio: "ignore" }).unref(); } catch (e) { /* 桌面通知 best-effort，失敗不阻斷 */ } }

/* ===== 每日引擎自我測試（2026-09-14 舊管線退場批＝69 號附錄 C Q4 甲配套） =====
   原 09:30 price_watch（實抓修價＋部署示範頁）停排程：它守的是示範頁與分享站鏡像，不是消費者看的那份（同事上傳到 AEM 的檔）；
   當日病例＝晨檢把兩天前的快照補推上線、71 分鐘顯示過期價（經驗卡 20260914-stale-fix-is-not-truth）。
   但 price_watch 順帶跑的引擎自我測試（FrameTest 五資料集 152×5）是每日健康檢查，單獨留下——只在負責人開發機跑：
   開關檔 workbench/.wb-dev-schedules 存在才掛排程（沿 .wb-bind／.wb-pass 慣例；.wb-* 已在同事包排除清單），
   沒有開關檔＝這支伺服器不會有任何排程醒來（同事機常態）。到點判定沿舊法：每分鐘查一次、marker 先寫後跑（防崩潰迴圈）。
   失敗要出聲（鐵律 3）：exit≠0＝console.error＋桌面通知；報告落 qa/selftest-daily/<日>/。 */
const DEV_SCHEDULES_FILE = path.join(__dirname, ".wb-dev-schedules");
const SELFTEST_AFTER = "09:30";
const SELFTEST_DIR = path.join(PIPE, "..", "..", "2026-AI自動化活動頁生成規劃", "qa", "selftest-daily");
const SELFTEST_MARKER = path.join(SELFTEST_DIR, "last-run.txt");
function runDailySelftest(today, hhmm) {
  const outDir = path.join(SELFTEST_DIR, today);
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(SELFTEST_MARKER, today);
  console.log(`[selftest-daily] 啟動（${today} ${hhmm}）`);
  const logFd = fs.openSync(path.join(outDir, "run.log"), "a");
  const child = spawn(process.execPath, [path.join(PIPE, "selftest_run.js"), path.join(FRAMETEST_DIR, "index.html"), path.join(outDir, "selftest.json")], { stdio: ["ignore", logFd, logFd] });
  child.on("exit", (code) => {
    try { fs.closeSync(logFd); } catch (e) { /* 已關 */ }
    if (code === 0) { console.log(`[selftest-daily] 全綠（${today}）`); return; }
    console.error(`[selftest-daily] 失敗 exit=${code}（${today}）——看 ${path.join(outDir, "run.log")}`);
    notifyMac(`每日自我測試失敗（exit ${code}）——引擎可能壞了，看 qa/selftest-daily/${today}/run.log`);
  });
  child.on("error", (e) => { console.error("[selftest-daily] 起不來：" + errText(e)); notifyMac("每日自我測試起不來：" + errText(e).slice(0, 100)); });
}
if (MODE !== "editor" && fs.existsSync(DEV_SCHEDULES_FILE)) {
  console.log(`每日自我測試排程：已掛載（${SELFTEST_AFTER} 後到點跑一次；開關檔 ${DEV_SCHEDULES_FILE}）`);
  setInterval(() => {
    try {
      const now = new Date();
      const hhmm = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
      if (hhmm < SELFTEST_AFTER) return;
      const today = localToday();
      let last = ""; try { last = fs.readFileSync(SELFTEST_MARKER, "utf8").trim(); } catch (e) { /* 首日無 marker＝正常 */ }
      if (last === today) return;
      runDailySelftest(today, hhmm);
    } catch (e) { console.error("[selftest-daily] " + errText(e)); }
  }, 60 * 1000);
} else {
  console.log("每日自我測試排程：未掛載（無 workbench/.wb-dev-schedules 開關檔＝同事機／非開發機常態，本伺服器不會有任何排程醒來）");
}
