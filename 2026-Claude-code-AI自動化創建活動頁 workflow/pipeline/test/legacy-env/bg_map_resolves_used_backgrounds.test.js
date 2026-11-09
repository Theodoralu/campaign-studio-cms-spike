/* 「已完成的活動，背景還解析得開嗎」絆線（2026-09-14 甲-1 裁決）。
   ------------------------------------------------------------------
   源起：待審背景登記簿累積 30 筆、其中 23 筆是同一張圖重複上傳，準備做合併清場時發現一件事——
   `tools/build_bg_map.js` 原本寫 `if (e.review.status !== "pending") continue`，
   意思是「只要審核給了任何結論（退回／合併／退場），那張圖就從背景地圖整個消失」。
   但實掃 runs/ 發現 7 檔已完成活動的 draft 直接指著訪客號：
     2026-08-31-wb-144226→pending-0003  ・150100→0004 ・151038→0005 ・151401→0006
     ・155137→0009 ・2026-09-04-wb-164258→0021 ・2026-09-08-wb-150043→0027
   照原計畫「留一筆、其餘標 merged」會讓其中兩檔的背景解析不出來，而且**沒有任何機器會叫**
   （行事曆那條 09-11 的筆記只看了阿虎那一群，沒發現 hero-c 群有三檔各用一個號）。

   這支是鐵律 4 要求的「從最外層入口打到底」那條：不去單測某個 if，
   而是問一句真正該成立的話——**每一檔活動用到的背景，在產出的地圖裡都要找得到**。
   哪天有人再把過濾條件收緊、或把某筆登記直接刪掉，這裡就會紅。

   分工（別跟平行線搞混）：
     ・本檔＝「舊的還認不認得」（解析面，build_bg_map）
     ・proposal_pack 的 pendingEntries＝「新的選不選得到」（值域面，只有 pending 能進新提案包）
   兩件事被同一個 review.status 欄綁在一起，正是「同一條規則好幾道門」那張經驗卡的形狀。 */
"use strict";
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const PIPE = path.resolve(__dirname, "..", "..");
const REPO = path.resolve(PIPE, "..", "..");
const RUNS = path.join(PIPE, "runs");
const BG_MAP = path.join(REPO, "2026-AI自動化活動頁生成規劃", "assets", "hero-bg", "bg-map.js");

/** 讀產出的 bg-map.js，取出它認得的背景貨號。 */
function mapIds() {
  const src = fs.readFileSync(BG_MAP, "utf8");
  return new Set([...src.matchAll(/^\s*"([a-z0-9-]+)":\s*\{/gim)].map((m) => m[1]));
}

/** 在任意巢狀結構裡找出所有 backgroundId 值（draft 的形狀歷來改過幾次，別寫死路徑）。 */
function backgroundIdsIn(node, out = new Set()) {
  if (Array.isArray(node)) { for (const v of node) backgroundIdsIn(v, out); return out; }
  if (node && typeof node === "object") {
    for (const [k, v] of Object.entries(node)) {
      if (k === "backgroundId" && typeof v === "string" && v && v !== "own") out.add(v); /* "own"＝你上傳的背景（78 號 2026-09-27）：圖住活動自己的資料夾、不進地圖，本絆線不管它；三檔在不在由 gate CP-27 與 hero_bg_own_doors 測試守 */
      else backgroundIdsIn(v, out);
    }
  }
  return out;
}

/** 逐 run 掃 draft.json（含核可備份 draft.v*.json）——磁碟真相為準，不讀登記簿的 usedIn 欄
    （meta 自己寫明 usedIn 靠轉正時回填、不保證同步；2026-09-14 實測 30 筆全是空陣列，但實際有 7 檔在用）。 */
function usedBackgrounds() {
  const used = new Map(); // backgroundId → [run id]
  let dirs = [];
  try { dirs = fs.readdirSync(RUNS, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name); } catch (e) { return used; }
  for (const d of dirs) {
    if (d === "_deleted") continue; // 已刪除的活動不列入（使用者主動丟棄）
    /* 備份數量不封頂（2026-09-21 修）：原本寫死 ["draft.json","draft.v1.json","draft.v2.json"]，
       而備份是「負責人每做一次商品檢查／套用變價就多一個」——當天 10:53 那筆真實變價就讓某檔長到 v2，
       再操作一次就會有 v3，寫死的清單會**無聲漏掃**（漏掃＝該紅的不紅，比誤報更難發現）。改成列目錄取全部。 */
    const drafts = ["draft.json", ...fs.readdirSync(path.join(RUNS, d)).filter((f) => /^draft\.v\d+\.json$/.test(f)).sort()];
    for (const f of drafts) {
      const p = path.join(RUNS, d, f);
      if (!fs.existsSync(p)) continue;
      let j;
      try { j = JSON.parse(fs.readFileSync(p, "utf8")); } catch (e) { continue; } // 壞檔另有守門，不在本絆線範圍
      for (const id of backgroundIdsIn(j)) {
        if (!used.has(id)) used.set(id, []);
        if (!used.get(id).includes(d)) used.get(id).push(d);
      }
    }
  }
  return used;
}

test("每一檔已完成活動用到的背景，背景地圖都還解析得開", () => {
  const ids = mapIds();
  assert.ok(ids.size > 0, `背景地圖讀不到任何貨號（${BG_MAP}）——先跑 tools/build_bg_map.js`);
  const used = usedBackgrounds();
  const missing = [...used.entries()].filter(([id]) => !ids.has(id));
  assert.deepStrictEqual(
    missing.map(([id, runs]) => `${id}（${runs.join("、")}）`),
    [],
    "有活動指著的背景不在地圖裡＝那幾頁會缺圖。" +
      "常見原因：待審簿某筆被審核標成非 pending 而被過濾掉，或登記被直接刪除。" +
      "正解＝留在地圖（解析得開）＋retired:true（不供挑選），不是把它拿掉。"
  );
});

test("審核過的待審背景仍留在地圖，但標成不供挑選", () => {
  const src = fs.readFileSync(BG_MAP, "utf8");
  const entries = [...src.matchAll(/"(pending-\d{4})":\s*\{([^}]*)\}/g)];
  if (entries.length === 0) return; // 簿子空＝無可測（hermetic 環境）
  for (const [, id, body] of entries) {
    const st = (body.match(/"reviewStatus":\s*"([^"]*)"/) || [])[1];
    if (!st || st === "pending") continue;
    assert.match(
      body,
      /"retired":\s*true/,
      `${id} 的審核結論是「${st}」，地圖裡卻沒標 retired:true——會被當成現役背景供人挑選`
    );
  }
});
