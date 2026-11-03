/* 介面「失敗要出聲」絆線（鐵律 3）——2026-09-11 同一個洞一天犯兩次之後立的。
   ------------------------------------------------------------------
   病例一（上午）：配色說明句向新端點要答案，舊版 server 還沒重啟＝端點不存在，
     回 {"error":"not found"}，原寫法把英文 `not found` 原樣印在建立頁上。
   病例二（下午，同一天）：活動策略檔清單讀不到時，落到「還沒有自己的策略檔」這句——
     使用者以為資料夾是空的，實際是連五份內建範本都沒讀到＝根本沒讀成。
     **修完病例一還在註解寫了教訓，三小時後在新程式又寫一次。** 所以留絆線，不靠記得。

   共同的病：**「讀不到」跟「讀到了但是空的」用同一句話講。**
   前者是故障（要講原因、要指路），後者是正常狀態（可以安靜）。混在一起＝使用者被誤導去找錯方向。

   守什麼：這兩種狀態在程式裡有各自的訊息，而且故障那句要講得出「為什麼」。
   不守什麼：訊息的確切字句（那是使用者裁的介面文案，改字不該讓測試紅）。 */
"use strict";
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const UI = fs.readFileSync(path.resolve(__dirname, "..", "..", "workbench", "public", "index.html"), "utf8");

test("活動策略檔：讀不到清單與資料夾是空的，是兩句不同的話", () => {
  assert.match(UI, /briefListError/, "沒有為『讀不到』留獨立狀態＝兩種狀況會共用同一句話");
  /* 故障句要講得出原因與下一步 */
  const errLine = (UI.match(/briefListError = "([^"]+)"/) || [])[1] || "";
  assert.ok(errLine.length > 10, "故障句太短或不存在");
  assert.match(errLine, /重新啟動|重啟/, "故障句沒講出可行的下一步");
  assert.doesNotMatch(errLine, /還沒有自己的策略檔/, "故障句跟『資料夾是空的』那句混用了");
  /* 顯示順序：故障要排在『資料夾是空的』之前判，否則永遠顯示錯的那句 */
  const sync = (UI.match(/function syncBriefNote\(\)\{[\s\S]*?\n\}/) || [])[0] || "";
  assert.ok(sync, "找不到 syncBriefNote——搬家或改名了，本測試要同步更新");
  const iErr = sync.indexOf("briefListError");
  const iEmpty = sync.indexOf("createOptions.noneHint"); // 2026-09-15 P-1 甲：「資料夾是空的」那句改成講下一步（文案單一真源 createOptions.noneHint）
  assert.ok(iErr >= 0 && iEmpty >= 0, "兩種狀態的判斷不全在同一個函式裡，順序無法保證");
  assert.ok(iErr < iEmpty, "『讀不到』要排在『資料夾是空的』之前判，否則故障時會顯示誤導的那句");
});

/* 「把後端原文直接印在畫面上」＝ratchet（沿專案既有 dod-guards G2／G3 只准降的做法）。
   為什麼不是零容忍：多數端點的錯誤訊息本來就是我們自己寫的白話，直接印沒問題。
   真正的洞是**沒有分開處理「HTTP 層失敗」**——端點不存在時 `.then(r => r.json())` 會拿到
   通用 404 的 `{"error":"not found"}`，那句是英文、而且對使用者毫無意義（2026-09-11 上午病例）。
   基線 2 ＝ 2026-09-11 實查的兩處既有寫法，兩者端點目前都存在＝洞是潛在的：
     ① 建立廠商 Google 試算表失敗（`/api/runs/:id/sheet-create`）
     ② 發佈前檢查失敗（`/api/runs/:id/gate`／`stage2`）
   要修的做法＝先判 `res.ok`，HTTP 層失敗給白話（例：「工具可能剛更新過還沒重新啟動」），
   業務層 error 才照印。修掉任何一處就把基線降下來。 */
test("後端原文直印在畫面上的處數＝只准降不准升（基線 2）", () => {
  const hits = [...UI.matchAll(/textContent\s*=\s*(?:r|res|json)\.error\b/g)].map((m) => m[0]);
  assert.ok(hits.length <= 2, `又多了直印後端原文的地方（${hits.length} 處，基線 2）——請改成先判 res.ok、HTTP 失敗給白話`);
});

test("配色說明句：端點不存在時給的是白話，不是後端原文", () => {
  const fn = (UI.match(/async function syncThemeAutoNote\(\)\{[\s\S]*?\n\}/) || [])[0] || "";
  assert.ok(fn, "找不到 syncThemeAutoNote");
  assert.match(fn, /算不出來/, "失敗路徑沒有白話句");
  assert.match(fn, /配色本身不受影響/, "沒講清楚哪些沒壞——使用者會以為配色也壞了");
});
