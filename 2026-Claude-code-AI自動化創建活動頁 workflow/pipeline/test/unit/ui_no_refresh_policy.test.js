/* 「介面不得再長出更新頻次欄」絆線（2026-09-14 單機版建頁流程牆第 1 題甲：介面移除、資料保留）。
   ------------------------------------------------------------------
   拿掉的東西：建立頁「商品更新頻次／策展主題更新頻次」兩個下拉、編修頁「營運設定：更新頻次」整段、
   活動列表「更新頻次」欄、伺服器建立時把它寫進 page.refreshPolicy 與列表回應帶它出來。
   為什麼拿掉：從 2026-07-22 登錄到今天，沒有任何排程或匯出讀過這個欄位；旁邊那句「會帶進給廠商的檔期提案」
   從未接上（Excel／AEM 檔／發佈頁都不帶）——留著一個不起作用的欄位比拿掉更危險，人會以為它有用（同檔期兩格那題的理由）。
   資料保留＝既有 draft 的 page.refreshPolicy 不刪、不改：test/fixtures 裡多份 draft 仍帶這個鍵、gate 測試照常過，
   就是「舊資料原樣能開」的活證據，本檔另守「程式裡不得出現刪它的句子」。
   回來條件（寫在這裡免得日後被當成遺忘的欠債）＝有排程消費端（內網巡檻或工程師的商品檢查機制）且提案匯出真的帶它。 */
"use strict";
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const UI = fs.readFileSync(path.resolve(__dirname, "..", "..", "workbench", "public", "index.html"), "utf8");
const SV = fs.readFileSync(path.resolve(__dirname, "..", "..", "workbench", "server.js"), "utf8");

test("建立頁兩個下拉、編修頁那一段、列表欄、送出鍵都不在了", () => {
  for (const tok of [
    'id="in-refresh-p"', 'id="in-refresh-t"',   // 建立頁兩格
    "const REFRESH_P", "const REFRESH_T", "const RP_ZH", // 選項字表（列表欄與編修頁共用）
    "更新頻次</th>",                              // 列表欄
    'id="ops-set"', '"page.refreshPolicy.',       // 編修頁「營運設定」段與它的欄位路徑（帶尾點＝field() 的路徑寫法；註解裡提到鍵名不算）
    "productRefresh:", "themeRefresh:",           // 建立送出鍵
  ]) {
    assert.ok(!UI.includes(tok), `${tok} 回來了——這是 2026-09-14 拿掉的更新頻次介面（建頁流程牆第 1 題甲）`);
  }
});

test("剝掉註解之後，介面不再對使用者講「更新頻次」", () => {
  const stripped = UI.replace(/<!--[\s\S]*?-->/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
  const hits = stripped.split("\n").map((l, i) => [i + 1, l]).filter(([, l]) => l.includes("更新頻次"));
  assert.deepStrictEqual(hits.map(([n, l]) => `${n}: ${l.trim().slice(0, 90)}`), [],
    "介面有使用者看得到的「更新頻次」——沒有任何排程會照它更新，畫面不得再講一件不會發生的事");
});

test("伺服器：建立時不再寫 page.refreshPolicy、列表回應不再帶它；但也不得刪既有資料", () => {
  assert.ok(!SV.includes("dj.page.refreshPolicy ="), "建立流程又開始寫 refreshPolicy 了——這條 2026-09-14 停寫");
  assert.ok(!/refreshPolicy = pgd\.refreshPolicy/.test(SV) && !/gate, refreshPolicy/.test(SV), "列表回應又帶 refreshPolicy 了——沒有欄位要顯示它");
  assert.ok(!/delete\s+\w+\.page\.refreshPolicy/.test(SV) && !/delete\s+\w+\.page\.refreshPolicy/.test(UI),
    "有程式在刪 page.refreshPolicy——裁的是「介面移除、資料保留」，舊活動的值要原樣留著");
});

test("資料保留的活證據：fixtures 裡帶 refreshPolicy 的 draft 還在（舊資料形狀沒被順手清掉）", () => {
  const fx = path.resolve(__dirname, "..", "fixtures", "gate_pass_draft.json");
  const dj = JSON.parse(fs.readFileSync(fx, "utf8"));
  assert.ok(dj.page && "refreshPolicy" in dj.page, "gate_pass_draft.json 的 page.refreshPolicy 被拿掉了——它是「舊 draft 帶這個鍵照常過閘」的證據，請留著");
});
