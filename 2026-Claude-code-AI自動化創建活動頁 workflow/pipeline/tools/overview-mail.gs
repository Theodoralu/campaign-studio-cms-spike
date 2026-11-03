/**
 * overview-mail.gs —— 活動總覽表寄信（Apps Script，綁在「活動總覽」試算表內）
 * 2026-07-28 立案＋同日對抗式 review 修訂（docs/stories/notify-email.md＋patrol-heartbeat.md）
 * 2026-07-29 修訂：信體「零外部連結」——Yahoo 企業閘道對外部 Gmail＋多連結信「靜默隔離」
 *   （實證：心跳信〔僅 docs.google.com 連結〕可達；異常信〔商品＋netlify 連結滿版〕消失、
 *   不進垃圾桶、無退信，轉寄同內容亦消失）。信體唯一連結＝總覽表；商品明細與 CMS 入口
 *   一律以「表上分頁／欄位」指路，勿再往信體加任何非 docs.google.com 連結
 *   （send() 出口已機械消毒：非 docs.google.com 連結與本機路徑一律遮蔽）。
 * 2026-07-29 修訂二（使用者裁決）：異常通知改「單封日報」——同日 A/B/C/D 對照實證：閘道有狀態，
 *   同模板近似信重複寄會累積量產信負評分而被靜默吞（09:26 同模板 4 封過 3 吞 1、重複第 5/6 次全吞）。
 *   未登記負責人的異常活動不再一檔一封，彙整為單封「異常日報」寄操作者；已登記負責人者照舊單發。
 *   常態＝每日 2 封（心跳＋日報），根本上降低量產樣態。心跳信保持極簡不動（三發三中＝死人開關可靠）。
 *   同日驗證輪補強：①進場 LockService 防重複觸發整批重寄②心跳寄失敗＝不寫 sent-（手動補跑可整日重寄）
 *   ③消毒補裸網域/IP 樣態（ENOTFOUND tw.buy.yahoo.com 類）④安裝步驟補時區＝台北。
 *
 * 為何用 Apps Script：gmail.send 是 restricted scope（正式發布要付費年審、測試模式 7 天斷），
 * MailApp 走使用者自身授權＝免驗證、免費額度。寄件人＝綁定帳號（Alice；2026-07-28 裁決可接受）。
 *
 * 安裝（一次性，約 5 分鐘）：
 *  1. 開「活動總覽」試算表 → 擴充功能 → Apps Script → 貼上本檔全文 → 改下方 OPERATOR_EMAIL。
 *  2. ⚙ 專案設定 → 時區＝台北。API 建的容器試算表預設時區 Etc/GMT、觸發器跟專案時區走——
 *     不改的話「上午 9-10 點」會在台北傍晚 17-18 點才寄。
 *  3. 觸發條件 → 新增：函式 dailyMail、時間驅動、日計時器、上午 9 點～10 點。
 *  4. 首次授權：手動執行 dailyMail 一次 → 進階 → 前往（不安全）→ 允許。
 *  5. 補寄：巡檢晚跑完（例：平台晚開機）當日再手動執行 dailyMail 即可——
 *     「巡檢未更新」警告不消耗當日寄信資格（07-28 review #2/#14 修），表更新後補跑會正常寄出全部信件。
 *  ⚠ 總覽表若被刪除重建，本腳本會跟舊表一起變孤兒——伺服器端會跳通知提醒重裝。
 *
 * 讀表契約（run_patrol.js buildOverviewRows/buildDetailRows；改欄位兩邊要一起動＋單元測試鎖）：
 *  「總覽」列1＝心跳摘要 [巡檢日期,<date>,巡檢中,N,已結束,M,異常檔數,K,完成時間,ts,FrameTest巡檢,<date>]
 *  「總覽」列2＝表頭；列3起欄序＝[0日期,1活動ID,2活動名,3負責人,4部門,5營運迄日,6商品數,7狀態,8變價,9待同步,10下架/失效,11連結異常,12無法驗證,13最後巡檢,14今日事件,15CMS入口,16內部確認頁]
 *  「明細」分頁＝本腳本 07-29 起不再讀取（信體改指路），但仍是信中指引的人工查看目標——欄位契約見 run_patrol.js。
 *  ⚠ 寫入端（google_sheets.js writeTab）必須 RAW＋全字串、禁改 USER_ENTERED：日期格會變 Date 物件，
 *    patrolDate!==today 永真＝死人開關反轉（天天誤報「巡檢未更新」）、活動ID 丟前導零＝closed- 鍵漂移。
 *
 * 冪等設計（07-28 review 修訂）：
 *  - sent-<date>＝當日完整寄送完成才寫；「巡檢未更新」警告只寫 warn-<date>（不擋補跑）。
 *  - 收檔信＝看「狀態＝🏁 已結束」＋ closed-<活動ID> 逐 run 去重（不依賴易被同日重跑抹掉的「今日事件」欄；
 *    伺服器端 closedNoticeAt 只管 log，寄信責任在此）。
 *  - 每封信各自 try/catch：單封失敗不中止其餘，失敗清單併入操作者信（無假成功）。
 */
var OPERATOR_EMAIL = "tofu@yahootwec.com"; // ← 操作者信箱（心跳信＋所有異常信副本）
var MAIL_PREFIX = "[活動巡檢]";

function dailyMail() {
  // 併行防護：時間觸發器偶發重複觸發／手動執行與 9-10 點觸發窗重疊＝整批信重寄兩份（量產樣態毒閘道信譽）
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) return;
  try { dailyMail_(); } finally { lock.releaseLock(); }
}

function dailyMail_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var ov = ss.getSheetByName("總覽").getDataRange().getValues();
  var today = Utilities.formatDate(new Date(), "Asia/Taipei", "yyyy-MM-dd");
  var props = PropertiesService.getScriptProperties();
  if (props.getProperty("sent-" + today)) return; // 當日已完整寄過＝不重寄（warn 不算）

  var meta = ov[0] || [];
  var patrolDate = String(meta[1] || "");
  if (patrolDate !== today) { // 死人開關：巡檢沒更新表＝寄警告；不消耗寄信資格（補跑後可正常寄）
    if (!props.getProperty("warn-" + today)) {
      MailApp.sendEmail(OPERATOR_EMAIL, MAIL_PREFIX + " ⚠ 今日巡檢未更新總覽表",
        "總覽表最後巡檢日期＝" + (patrolDate || "（無資料）") + "，非今日（" + today + "）。\n\n" +
        "可能原因：平台未開機／伺服器行程死亡／Google 連結失效。\n" +
        "排查步驟：①開機並確認工作台伺服器活著（開工三查）②工作台 ⚙ 設定確認 Google 連結\n" +
        "③巡檢補跑後，回本試算表 擴充功能 → Apps Script 手動執行 dailyMail 補寄當日通知。");
      props.setProperty("warn-" + today, "1");
    }
    return;
  }

  var runs = ov.slice(2).filter(function (r) { return String(r[1] || "") !== ""; });
  var failures = [];
  // 零外部連結「機械強制」（07-29 review major）：⛔ 信會原文轉貼伺服器錯誤訊息（欄14），上游存在帶
  // 商品 URL／本機絕對路徑的錯誤格式——夾帶 URL 的告警信自己會被閘道吞掉且無偵測。出口統一消毒。
  var mask = function (u) { return u.indexOf("https://docs.google.com/") === 0 || u.indexOf("docs.google.com/") === 0 ? u : "（連結略，見伺服器紀錄）"; };
  var sanitize = function (s) {
    return String(s == null ? "" : s)
      .replace(/https?:\/\/\S+/g, mask)
      .replace(/\b(?:[a-z0-9-]+\.)+[a-z]{2,6}(?:[\/:]\S*)?/gi, mask) // 裸網域（ENOTFOUND tw.buy.yahoo.com 類）
      .replace(/\b\d{1,3}(?:\.\d{1,3}){3}(?::\d+)?\b/g, "（連結略，見伺服器紀錄）") // 裸 IP（ETIMEDOUT 1.2.3.4:443 類）
      .replace(/\/Users\/\S+/g, "（路徑略）");
  };
  var send = function (opts) { try { opts.subject = sanitize(opts.subject); opts.body = sanitize(opts.body); MailApp.sendEmail(opts); return true; } catch (e) { failures.push(opts.subject + "｜" + e.message); return false; } };

  var alertRuns = 0;
  var digestCount = 0, digestLines = []; // 未登記負責人的異常活動＝彙整單封日報（07-29 使用者裁決）
  runs.forEach(function (r) {
    var id = String(r[1]), name = String(r[2]);
    var owner = String(r[3] || "").trim();
    var ownerOk = /^\S+@\S+\.\S+$/.test(owner);
    var status = String(r[7] || "");

    // 異常（⚠ 需處理／⛔ 巡檢異常）：有負責人＝單發給該負責人；未登記＝併入操作者異常日報
    if (status.indexOf("⚠") === 0 || status.indexOf("⛔") === 0) {
      alertRuns++;
      if (!ownerOk) {
        digestCount++;
        digestLines.push("■ " + name + "（檔期迄：" + (r[5] || "長青") + "；活動ID " + id + "）",
          "　" + (status.indexOf("⛔") === 0
            ? "⛔ 巡檢執行異常：" + String(r[14] || "原因見伺服器紀錄")
            : status + "（變價 " + r[8] + "・待同步 " + r[9] + "・下架 " + r[10] + "・連結 " + r[11] + "・無法驗證 " + r[12] + "）"), "");
      } else {
        var lines = [];
        lines.push("活動：" + name + "（檔期迄：" + (r[5] || "長青") + "；最後巡檢：" + (r[13] || "—") + "）");
        if (status.indexOf("⛔") === 0) {
          lines.push("", "本檔今日巡檢執行異常，未能完成檢查：", "　" + String(r[14] || "原因見伺服器紀錄"),
            "", "下一步：通知系統操作者排查；排查後可在工作台手動補跑巡檢。");
        } else {
          lines.push("今日狀態：" + status + "（變價 " + r[8] + "・待同步 " + r[9] + "・下架 " + r[10] + "・連結 " + r[11] + "・無法驗證 " + r[12] + "）", "",
            "逐項明細：總覽表「明細」分頁（活動ID " + id + "）。",
            "處理入口：總覽表「總覽」分頁 P 欄（CMS）→ 🩺 一鍵套用修復；內部確認頁在 Q 欄。",
            "", "處理完成後重新核可上線，明日巡檢會自動確認回綠。");
        }
        lines.push("活動總覽表：" + ss.getUrl());
        send({ to: owner, cc: OPERATOR_EMAIL,
          subject: MAIL_PREFIX + " " + name + "：" + status.replace("⚠ ", ""), body: lines.join("\n") });
      }
    }

    // 收檔信：狀態＝已結束＋逐 run 去重（同日重跑/表重寫都不影響；一 run 一生只寄一次）
    if (status.indexOf("🏁") === 0 && !props.getProperty("closed-" + id)) {
      var ok = send({ to: ownerOk ? owner : OPERATOR_EMAIL, cc: ownerOk ? OPERATOR_EMAIL : "",
        subject: MAIL_PREFIX + " 🏁 活動「" + name + "」已到期收檔",
        body: "活動「" + name + "」的營運失效日（" + r[5] + "）已到：每日巡檢與通知自本日起停止。\n\n" +
          "⚠ 注意：活動頁面目前仍在線上。CMS 沒有自助下架功能——需要下架請回覆本信由系統操作者處理；\n" +
          "要延長檔期則到 CMS 該活動「活動資訊」把失效日改成未來日期，巡檢與通知會自動恢復。\n\n" +
          "CMS 入口與內部確認頁：見總覽表「總覽」分頁 P／Q 欄。\n總覽表：" + ss.getUrl() });
      if (ok) props.setProperty("closed-" + id, today);
    }
  });

  // 異常日報（單封；07-29 裁決）：未登記負責人的異常活動彙整寄操作者——比一檔一封更不像量產信
  if (digestCount > 0) {
    send({ to: OPERATOR_EMAIL,
      subject: MAIL_PREFIX + " ⚠ 異常日報｜" + patrolDate + "：" + digestCount + " 檔需處理",
      body: "（以下活動未登記負責人 Email＝異常彙整寄系統操作者）\n\n" + digestLines.join("\n") + "\n" +
        "逐項明細：總覽表「明細」分頁（依活動ID 篩）。\n" +
        "處理入口：總覽表「總覽」分頁 P 欄（CMS）→ 🩺 一鍵套用修復；內部確認頁在 Q 欄。\n" +
        "處理完成後重新核可上線，明日巡檢會自動確認回綠。\n" +
        "活動總覽表：" + ss.getUrl() });
  }

  // 心跳（每天必寄；乾淨＝一行極簡）——「沒收到這封」本身＝故障訊號
  var ftNote = String(meta[11] || "");
  // FrameTest 巡檢在 09:30、本表在 08:30 寫入＝表上健康值是「昨日」；早於昨日才是真異常
  var yesterday = Utilities.formatDate(new Date(Date.now() - 86400000), "Asia/Taipei", "yyyy-MM-dd");
  var ftHealthy = ftNote === today || ftNote === yesterday;
  var hb = patrolDate + "：巡檢中 " + meta[3] + " 檔、已結束 " + meta[5] + " 檔、異常 " + meta[7] + " 檔（完成 " + meta[9] + "）";
  var hbBody = hb + "\n" + (ftHealthy ? "FrameTest demo 巡檢鏈：正常（最後執行 " + ftNote + "）。" : "⚠ FrameTest demo 巡檢最後執行日＝" + ftNote + "（早於昨日）——09:30 那條巡檢鏈可能死了，請排查。") +
    "\n\n" + (alertRuns > 0
      ? "異常通知：" + (alertRuns - digestCount) + " 檔已單發負責人（本信箱副本）、" + digestCount + " 檔未登記負責人＝彙整於異常日報。"
      : "全部正常，無需動作。") +
    (failures.length ? "\n\n⚠ 本輪 " + failures.length + " 封信寄送失敗：\n" + failures.join("\n") : "") +
    "\n總覽表：" + ss.getUrl();
  var hbOk = send({ to: OPERATOR_EMAIL, subject: MAIL_PREFIX + (Number(meta[7]) > 0 || failures.length ? " ⚠ " : " ✅ ") + "每日心跳｜" + hb, body: hbBody });
  // 心跳寄失敗（配額耗盡等）＝不寫 sent-：手動補跑可整日重寄（closed- 終身去重不重複；異常信重寄＝可接受的復原代價）。
  // 若寫了，檔頭步驟 5 的「手動補跑」會被 sent- 守門靜默跳過＝當日鎖死且失敗清單無人收到。
  if (hbOk) props.setProperty("sent-" + today, "ok:" + alertRuns + (failures.length ? ":fail" + failures.length : ""));
}
