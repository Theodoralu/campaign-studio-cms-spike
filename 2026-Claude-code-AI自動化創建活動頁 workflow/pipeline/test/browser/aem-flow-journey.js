"use strict";
/* AEM 網頁檔交付旅程走查（2026-09-11 使用者裁第 5／6／7／2 題；2026-09-14 施工）——照同事的路真點擊：
     核可完的檔 → 任務條「製作 AEM 網頁檔」→ 看得到它在做（製作中不能按）→ 做好 → 任務條那顆直接下載 → 首頁那句跟著變。
   用法：node test/browser/aem-flow-journey.js <port> <runId> <outDir>
   前置：workbench server 活著、該檔已核可、能連 tw.buy.yahoo.com（製作第⓪關是逐品實抓）。node --test 下跳過（非 hermetic）。

   走查會真的做出一份檔（約 1～3 分鐘），所以請拿丟棄檔跑，別拿要交付的檔。
   兩個坑寫在這裡別再拿掉：
     ①page.evaluate 傳字串會原樣回傳，要傳函式。
     ②任務條主鈕是 .tb-act、右上是 #btn-main——量「同一時間幾顆主色」要兩顆一起量。 */
if (process.env.NODE_TEST_CONTEXT) { console.log("aem-flow-journey：手動旅程走查（需 Chrome＋活 server＋外網），node --test 下跳過"); return; }
const fs = require("fs"), path = require("path");
const PIPE = path.resolve(__dirname, "..", "..");
const pw = require(PIPE + "/node_modules/playwright-core");
const PASS = fs.readFileSync(path.join(PIPE, "workbench", ".wb-pass"), "utf8").trim();
const PORT = process.argv[2] || "8787", RUN = process.argv[3], OUT = process.argv[4] || "/tmp";
if (!RUN) { console.error("要給 runId：node test/browser/aem-flow-journey.js 8787 <runId> <outDir>"); process.exit(2); }
fs.mkdirSync(OUT, { recursive: true });
const R = [], ok = (n, p, note) => { R.push(p); console.log(`${p ? "PASS" : "FAIL"}  ${n}${note ? "  |  " + note : ""}`); };
const tb = () => ({ sent: "#task-bar .tb-sent", act: "#task-bar .tb-act", act2: "#task-bar .tb-act2", main: "#btn-main" });

(async () => {
  const b = await pw.chromium.launch({ channel: "chrome", headless: true });
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, httpCredentials: { username: "yahoo", password: PASS }, acceptDownloads: true });
  const p = await ctx.newPage();
  const errs = []; p.on("pageerror", e => errs.push(String(e)));
  await p.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: "networkidle" });
  await p.evaluate((id) => openRun(id), RUN);
  await p.waitForFunction(() => document.querySelector("#view-work") && document.querySelector("#view-work").style.display === "flex", null, { timeout: 20000 });
  await p.waitForTimeout(1200);

  const read = async () => p.evaluate((s) => ({
    sent: (document.querySelector(s.sent) || {}).textContent || "",
    act: (document.querySelector(s.act) || {}).textContent || "",
    actCls: (document.querySelector(s.act) || {}).className || "",
    actDis: !!(document.querySelector(s.act) || {}).disabled,
    act2: (document.querySelector(s.act2) || {}).textContent || "",
    main: (document.querySelector(s.main) || {}).textContent || "",
    mainCls: (document.querySelector(s.main) || {}).className || "",
  }), tb());
  const primaries = async () => p.evaluate(() => [...document.querySelectorAll("button.primary")]
    .filter(el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.top < innerHeight && r.bottom > 0; })
    .map(el => el.textContent.trim()));

  /* ⓪ 狀態機四態純試算（餵假 meta 給 taskState，不動任何檔）：真旅程一次只走得到一態，
     「做好但過期」「製作失敗」在真檔上要人為製造，這裡用純函式一次量完。 */
  const st4 = await p.evaluate(() => {
    const A = "2026-09-01T00:00:00.000Z";
    const mk = (exportAem) => ({ deploy: null, exportAem, liveUrl: null });
    const pick = (m, appr, isDirty) => { const s = taskState(m, !!isDirty, 0, 0, appr, { firstAct: "", gateStale: false });
      return { key: s.key, btn: s.btnLabel, sent: s.sentence, dis: !!s.disabled, tier2: !!s.tier2, sec: s.secondary && s.secondary.label }; };
    return {
      none:  pick(mk(null), A),
      fresh: pick(mk({ stage: "done", finishedAt: "2026-09-01T01:00:00.000Z", bytes: 440000 }), A),
      stale: pick(mk({ stage: "done", finishedAt: "2026-08-31T00:00:00.000Z", bytes: 440000 }), A),
      busy:  pick(mk({ stage: "build" }), A),
      err:   pick(mk({ stage: "error", error: "測試用" }), A),
      busyOverDirty: pick(mk({ stage: "build" }), A, true),
    };
  });
  ok("⓪ 沒做過＝製作", st4.none.key === "deploy" && st4.none.btn === "製作 AEM 網頁檔", st4.none.btn);
  ok("⓪ 做好且最新＝下載", st4.fresh.key === "exported" && st4.fresh.btn === "下載 AEM 網頁檔", st4.fresh.sent);
  ok("⓪ 做好但過期＝重新做一份", st4.stale.key === "export-stale" && st4.stale.btn === "製作 AEM 網頁檔", st4.stale.sent);
  ok("⓪ 製作中＝不能按", st4.busy.key === "exporting" && st4.busy.dis === true, st4.busy.sent);
  ok("⓪ 製作失敗＝看原因並重試", st4.err.key === "export-error" && st4.err.btn === "看原因並重試", st4.err.sent);
  ok("⓪ 製作中壓過未儲存（伺服器擋寫入，人不該同時改稿）", st4.busyOverDirty.key === "exporting", st4.busyOverDirty.key);
  ok("⓪ 四態都留著次要出路（內網預覽）", [st4.none, st4.fresh, st4.stale, st4.err].every(x => /內網預覽/.test(x.sec || "")), [st4.none.sec, st4.fresh.sec, st4.stale.sec, st4.err.sec].join(" / "));

  /* ① 起點：已核可、還沒做過檔＝主鈕該說「製作」 */
  let s = await read();
  const alreadyFresh = s.act.trim() === "下載 AEM 網頁檔";
  if (alreadyFresh) console.log("ⓘ 這檔已經有一份最新的網頁檔＝跳過②③④製作段（要走完整段請拿沒做過檔的、或先重新核可）");
  ok("① 核可後主鈕＝製作 AEM 網頁檔", alreadyFresh || s.act.trim() === "製作 AEM 網頁檔", s.act.trim());
  ok("① 句子講的是製作不是下載", alreadyFresh || /製作 AEM 網頁檔交給同事上傳/.test(s.sent), s.sent.trim().slice(0, 60));
  ok("① 次要出路＝發佈／更新內網預覽", /內網預覽/.test(s.act2), s.act2.trim());
  ok("① 右上不是主色（丁案：任務條在眼前時它次要）", !/\bprimary\b/.test(s.mainCls), s.mainCls);
  let pr = await primaries();
  ok("① 眼前只有一顆主色", pr.length === 1, pr.join(" / "));
  await p.screenshot({ path: path.join(OUT, "aem-1-before.png") });

  /* ②③④ 製作段（已有最新檔就整段跳過＝不重複做一份檔） */
  let doneOrErr = "done";
  if (!alreadyFresh) {
  /* ② 按下去＝對話框說「製作」，主鈕「開始製作」 */
  await p.click(tb().act); await p.waitForTimeout(700);
  const dlgTxt = await p.evaluate(() => { const d = document.querySelector("#dlg.open"); return d ? d.innerText : ""; });
  ok("② 對話框標題＝製作 AEM 網頁檔", /製作 AEM 網頁檔/.test(dlgTxt), dlgTxt.split("\n")[0]);
  ok("② 對話框主鈕＝開始製作（不是「重新匯出」）", /開始製作/.test(dlgTxt) && !/重新匯出|開始匯出/.test(dlgTxt));
  ok("② 對話框有講做好之後去哪拿檔", /上方任務條按「下載 AEM 網頁檔」/.test(dlgTxt));
  await p.screenshot({ path: path.join(OUT, "aem-2-dialog.png") });

  /* ③ 確認開始＝任務條立刻轉「製作中…」、不能按 */
  await p.click("#dlg-yes");
  await p.waitForFunction(() => { const a = document.querySelector("#task-bar .tb-act"); return a && /製作中/.test(a.textContent); }, null, { timeout: 20000 }).catch(() => {});
  s = await read();
  ok("③ 製作中：主鈕變「製作中…」", /製作中/.test(s.act), s.act.trim());
  ok("③ 製作中：主鈕按不下去", s.actDis === true);
  ok("③ 製作中：句子講到第幾步", /正在製作 AEM 網頁檔：/.test(s.sent), s.sent.trim().slice(0, 70));
  pr = await primaries();
  ok("③ 製作中眼前仍只有一顆主色（且是不能按的那顆）", pr.length <= 1, pr.join(" / "));
  await p.screenshot({ path: path.join(OUT, "aem-3-making.png") });

  /* ④ 等做好（最多 6 分鐘）——輪詢由頁面自己做，這裡只等畫面轉態 */
  doneOrErr = await p.waitForFunction(() => {
    const a = document.querySelector("#task-bar .tb-act"); if (!a) return null;
    const t = a.textContent.trim();
    if (t === "下載 AEM 網頁檔") return "done";
    if (t === "看原因並重試") return "error";
    return null;
  }, null, { timeout: 360000, polling: 2000 }).then(h => h.jsonValue()).catch(() => "timeout");
  }
  s = await read();
  await p.screenshot({ path: path.join(OUT, "aem-4-after.png") });
  if (doneOrErr !== "done") {
    ok("④ 做好之後主鈕＝下載 AEM 網頁檔", false, `實際落在「${s.act.trim()}」（${doneOrErr}）：${s.sent.trim().slice(0, 90)}`);
    console.log("\n（製作沒跑完就停在這裡——失敗態也是這批要做對的一態，上面的截圖留著）");
  } else {
    ok("④ 做好之後主鈕＝下載 AEM 網頁檔", s.act.trim() === "下載 AEM 網頁檔", s.act.trim());
    ok("④ 句子講出做好的時間與大小", /AEM 網頁檔做好了（.+KB）——下載交給同事上傳。/.test(s.sent) || /AEM 網頁檔做好了（/.test(s.sent), s.sent.trim().slice(0, 70));
    pr = await primaries();
    ok("④ 做好時眼前只有一顆主色", pr.length === 1, pr.join(" / "));

    /* ⑤ 按下去＝真的拿到檔（不是又開一次對話框） */
    const [dl] = await Promise.all([
      p.waitForEvent("download", { timeout: 60000 }).catch(() => null),
      p.click(tb().act),
    ]);
    ok("⑤ 主鈕按下去直接下載", !!dl, dl ? dl.suggestedFilename() : "沒有下載事件");
    if (dl) { const f = path.join(OUT, dl.suggestedFilename()); await dl.saveAs(f); ok("⑤ 檔案真的存下來", fs.existsSync(f) && fs.statSync(f).size > 100000, fs.existsSync(f) ? Math.round(fs.statSync(f).size / 1024) + " KB" : "不存在"); }
    const reopened = await p.evaluate(() => !!document.querySelector("#dlg.open"));
    ok("⑤ 下載沒有再彈一次對話框", !reopened);
  }

  /* ⑥ 未儲存態：任務條那顆是指路牌（次要）、儲存列那顆才是主色 */
  await p.evaluate(() => { if (typeof setDirty === "function") setDirty(true); });
  await p.waitForTimeout(500);
  s = await read();
  ok("⑥ 未儲存態任務條鈕＝去儲存", /去儲存/.test(s.act), s.act.trim());
  ok("⑥ 未儲存態任務條鈕降次要（第 7 題甲）", /ghost/.test(s.actCls) && !/\bprimary\b/.test(s.actCls), s.actCls);
  pr = await primaries();
  ok("⑥ 未儲存態眼前只有一顆主色（儲存列那顆）", pr.length === 1 && /儲存/.test(pr[0] || ""), pr.join(" / "));
  await p.screenshot({ path: path.join(OUT, "aem-6-dirty.png") });
  await p.evaluate(() => { if (typeof setDirty === "function") setDirty(false); });

  /* ⑦ 首頁「接著做」那一句跟著走 */
  await p.evaluate(() => { if (typeof setView === "function") setView("home", { skipGuard: true }); });
  await p.waitForTimeout(1500);
  const home = await p.evaluate((id) => {
    const box = document.querySelector("#home-next");
    const rows = [...(box ? box.querySelectorAll(".trow") : [])].map(el => ({ id: el.dataset.row, txt: el.innerText.replace(/\n+/g, " ｜ ") }));
    const mine = rows.find(r => r.id === id);
    return { all: rows.map(r => r.txt).join("\n"), n: rows.length, mine: mine ? mine.txt : "" };
  }, RUN);
  ok("⑦ 首頁「接著做」整列沒有一句還在講舊講法", home.n > 0 && !/匯出/.test(home.all), `${home.n} 列`);
  const aemLines = home.all.split("\n").filter(t => /AEM 網頁檔/.test(t));
  ok("⑦ 已核可的檔在首頁講的是製作或下載（同一套字）", aemLines.length === 0 || aemLines.every(t => /製作 AEM 網頁檔|下載 AEM 網頁檔|AEM 網頁檔做好了/.test(t)), aemLines.slice(0, 2).join(" ‖ ") || "（列上沒有已核可的檔）");
  if (home.mine) ok("⑦ 走查這一檔在首頁那句", /AEM 網頁檔/.test(home.mine), home.mine);
  else console.log("ⓘ 走查檔不在「接著做」列（已封存或已上線）＝首頁那句改由上面兩條整列掃描把關");
  await p.screenshot({ path: path.join(OUT, "aem-7-home.png") });

  /* ⑧ 檢查面板：同一個動作只畫一次（第 2 題甲）——回編修頁、把清單做成「過時」那一態真的看一眼 */
  await p.evaluate((id) => openRun(id), RUN);
  await p.waitForFunction(() => document.querySelector("#view-work") && document.querySelector("#view-work").style.display === "flex", null, { timeout: 20000 });
  await p.waitForTimeout(1000);
  const panel = await p.evaluate(() => {
    gateStale = true; gateStaleMode = null;      // 造「內容改過了、清單是舊的」那一態
    openCheckFloat(); renderCheckPanel();
    const stale = document.querySelector("#chk-float-body .chk-stale");
    const head = document.querySelector("#chk-float-body .chk-head");
    return {
      staleTxt: stale ? stale.innerText.trim() : "（沒有黃條）",
      staleBtns: stale ? stale.querySelectorAll("button").length : -1,
      headBtns: head ? [...head.querySelectorAll("button")].map(b => b.textContent.trim()) : [],
    };
  });
  ok("⑧ 黃條不再自己帶按鈕", panel.staleBtns === 0, `黃條 ${panel.staleBtns} 顆｜${panel.staleTxt.slice(0, 46)}`);
  ok("⑧ 重新檢查只剩標題列那一顆", panel.headBtns.length === 1 && /重新檢查/.test(panel.headBtns[0] || ""), panel.headBtns.join(" / "));
  await p.screenshot({ path: path.join(OUT, "aem-8-checkpanel.png") });
  const banner = await p.evaluate(() => {
    const ec = document.querySelector("#editor-col"); if (!ec) return { ok: false, why: "沒有編修欄" };
    let bn = document.getElementById("sec-banner");
    if (!bn) { bn = document.createElement("div"); bn.id = "sec-banner"; ec.prepend(bn); bn.innerHTML = '<span>這一段還差 1 件事</span><button type="button" class="linkish">看清單</button>'; }
    const b = bn.querySelector("button"), cs = getComputedStyle(b);
    return { ok: true, deco: cs.textDecorationLine, border: cs.borderTopWidth, bg: cs.backgroundColor };
  });
  ok("⑧ 模組橫幅「看清單」＝文字連結（沒有框、有底線）", banner.ok && /underline/.test(banner.deco) && banner.border === "0px", `${banner.deco}｜border ${banner.border}`);

  ok("頁面沒有 JS 錯誤", errs.length === 0, errs.slice(0, 2).join(" | "));
  await b.close();
  const pass = R.filter(Boolean).length;
  console.log(`\n走查 ${pass}/${R.length}　截圖在 ${OUT}`);
  process.exit(pass === R.length ? 0 : 1);
})();
