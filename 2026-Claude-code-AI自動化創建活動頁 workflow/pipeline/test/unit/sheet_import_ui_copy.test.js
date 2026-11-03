"use strict";
/**
 * Excel 帶入的介面文案（2026-09-27 使用者裁「乙」＋反饋「饒口、用戶沒耐心逐字理解」＝拆分訊息、狀態導向、不前置解釋）。
 * 病例＝tofu-89 走查③：使用者只加了活動資訊卡、Excel 三個分頁，帶入後另兩塊自動加到頁面、加區塊選單裡又消失＝以為入口不見；
 * 對帳視窗沒講「會加上去」、成功只有一顆會消失的 toast、程式裡還留著沒寫完的 `k === kind ? "" : ""` 佔位。
 * 這裡守的是文案本身（三種狀態字樣、結果卡、一句提示）與接線（看／知道了）；畫面實測由使用者走查。
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const src = fs.readFileSync(path.join(__dirname, "..", "..", "workbench", "public", "index.html"), "utf8");

test("帶入前確認：每模組一行「主詞・數量 → 狀態」，三種狀態字樣齊、尾句只剩一句", () => {
  assert.match(src, /function cmImportStatus\(rep, k\)\{/);
  assert.ok(src.includes('state: "不動（沒填）", kind: "skip"'));
  assert.ok(src.includes('state: exists ? "換掉現有內容" : "新加到頁面"'), "頁面上有＝換掉；沒有＝新加（用 cmNodeOf 對現稿算）");
  assert.match(src, /const exists = !!cmNodeOf\(draft\.page, k\);/);
  assert.match(src, /dlg\("帶入前確認", cmImportReportHtml\(pv\.report, kind\)/);
  assert.ok(src.includes('`<p class="hint">會先自動備份。</p>`'), "沒問題時的尾句只有一句");
  assert.ok(!src.includes('k === kind ? "" : ""'), "沒寫完的空佔位要清掉");
  assert.ok(!/按「帶入」＝把上面有內容的區塊整塊換成檔裡的/.test(src), "舊的一段式解釋不該再出現在第一眼");
});

test("帶入完成：結果卡取代 toast——標題、三行已發生、每行「看」、一行引導、「知道了」才收；解釋收進滑鼠提示", () => {
  assert.match(src, /let cmImportLast = null;/);
  assert.match(src, /function cmImportResultHtml\(kind\)\{/);
  for (const s of ["<b>帶入完成</b>", 'data-import-dismiss="1">知道了</button>', 'title="預覽捲到這一塊">看</button>', "接下來想改哪格，直接改。"]) assert.ok(src.includes(s), `缺：${s}`);
  assert.ok(src.includes('text: st.kind === "skip" ? "不動" : st.kind === "add" ? "已加到頁面" : `換掉了 ${st.count}`'), "三行已發生的字樣");
  assert.match(src, /cmImportLast = \{ rid, kind, lines \};/);
  assert.ok(!/toast\(r\.summary \|\| "已從 Excel 帶入"\)/.test(src), "成功不再只靠會消失的 toast");
  assert.match(src, /\[data-import-look\]"\)\.forEach\(b => b\.onclick = \(\) => syncPreviewTo\(CM_ANCHORS\[b\.dataset\.importLook\], true\)\)/, "「看」接到預覽捲動");
  assert.match(src, /\[data-import-dismiss\]"\)\.forEach\(b => b\.onclick = \(\) => \{ cmImportLast = null; renderEditor\(\); \}\)/, "「知道了」收卡");
  assert.match(src, /return cmImportResultHtml\(kind\) \+ `<div class="cm-import-bar"/, "結果卡長在該區塊的帶入列上方");
});

test("區塊內提示只剩一句；解釋（覆寫／備份／實抓）在按鈕滑鼠提示裡、不在第一眼；範本 v3＝七分頁、提示不再寫「三個分頁」", () => {
  assert.ok(src.includes(">一個 Excel，一次帶入三個區塊。</span>"));
  assert.ok(!/一個 Excel，三個分頁/.test(src), "範本 v3 是七個分頁（開始＋資訊卡四款版面＋主打選品＋促銷卡），舊句會誤導");
  assert.ok(!/先在 Excel 或 Google Sheets 填好，一次把格子填滿/.test(src), "舊的長提示要拿掉");
  assert.ok(src.includes('title="下載後先看「開始」分頁：活動資訊卡四款版面各一頁、選一頁填；主打選品、促銷卡各一頁。'), "下載鈕提示要指向「開始」分頁");
  assert.ok(src.includes('title="選填好的 .xlsx。檔裡有填的分頁會換掉或加上對應的區塊，沒填的不動；會先自動備份一版；再上傳同一個檔會整塊覆寫。商品欄的名稱與價格從商品頁實抓。"'));
});

test("舊版範本只印 lib 那一句；★ 預警黃色不擋；範本下載不吃瀏覧器快取", () => {
  assert.match(src, /if \(rep\.legacy && rep\.legacy\.message\) return `<p style="color:var\(--bad,#b00\)"><b>\$\{esc\(rep\.legacy\.message\)\}<\/b><\/p>`;/);
  assert.ok(src.includes("<b>帶入可以，但發佈前會被擋的格：</b>"));
  assert.match(src, /window\.open\(`\/api\/runs\/\$\{currentId\}\/import-template\?t=\$\{Date\.now\(\)\}`, "_blank"\)/, "同一網址會被瀏覽器回放舊檔（2026-09-27 實踩）");
  const server = fs.readFileSync(path.join(__dirname, "..", "..", "workbench", "server.js"), "utf8");
  assert.match(server, /"Cache-Control": "no-store", "Pragma": "no-cache"/, "範本下載端點要 no-store");
  assert.match(server, /if \(parsedI\.report\.legacy\) return sendJson\(res, 400, \{ error: parsedI\.report\.legacy\.message, report: parsedI\.report \}\);/, "舊版範本的錯誤訊息要用 lib 那一句、不是「有 1 格要先改好」");
});
