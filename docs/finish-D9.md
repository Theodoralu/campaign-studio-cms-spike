# D9 — core/finish：策展後的收尾拆成有順序的步驟

日期：2026-11-16 ｜ Jira ECSEARCH-39052

## 做了什麼
來源是 `workbench/server.js finishDraftAfterCurate`（187 行；每一步都是「讀 draft.json → 改 → 寫回 → 寫 log／meta」）。把每一步的「改」抽成純步驟，放 `pipeline/core/finish/index.js`：

    step(draft, ctx) → { changed, logs: [字串], meta: {要併進 wb_meta 的欄位} }

就地改 draft，不讀寫草稿檔、不觸網、不寫 log。log 文字與 meta 欄位名逐字沿用原碼（前端黃條、列表警告讀這些欄位）。

| # | 步驟 | core/finish | 單機版殼（server.js）現況 |
|---|---|---|---|
| 1 | CP-14 主題詞組校準內容 | `themeFitPatch()`、`deriveSourceKeywords(url, pageTitle)` | 殼讀來源頁 title、寫 feedback_patch.json；詞組計算呼叫 core |
| 2 | 自訂品牌色 | `customThemeColor()` | **已改呼叫 core** |
| 3 | 版式選定＋主視覺商品槽預填 | `layoutChoice()`（底層 `lib/layout_choice.applyLayoutChoiceToDraft` 記憶體版，D9 自寫檔版抽出） | 殼仍用寫檔版 `writeLayoutChoiceIntoDraft`（現在是記憶體版的包裝，同一份邏輯） |
| 4 | 提案包整組落地 | 不進 core（第二階段） | 原碼保留 |
| 5 | v2 主題橋接 | `themeBridge()`（底層 `bridgeThemeForV2`） | 殼仍用寫檔包裝 `bridgeThemeForV2IntoDraft`（同一份邏輯） |
| 6 | 活動策略檔套用 | 不進 core（第二階段） | 原碼保留 |
| 7 | 建立期價格對真：套用與訊息 | `priceTruth(draft, {snapshot, rows, …})` | **已改呼叫 core**；殼保留「取價格列」的編排（種子、6 秒連線探針、逐件抓商品頁）與落檔 |
| — | 第一版整段 | `finishDraft()`：2 → 3 → 5 →（有 rows 才）7，全在記憶體 | 還沒人呼叫；D11／D13 的建立工作用它 |

連帶：
- `patchSnapshotPrice`、`pcSummaryOf`、`pcBlockingCount`、`pcBlockMessage` 四支的本體從 server.js 拿掉，改 require `core/product-truth/rows`（D7 原樣抽出的那份）。server.js 3601 → 3550 行。
- D8 殘留收掉：`core/curate` 不再讀主題契合校準檔，改吃 `themeFitRule` 物件（`lib/theme_fit.normalizeThemeFitRule` 純函式版）；讀檔留在 `curate_auto.js` 殼。

## 驗證
- `npm run ci`：958 測試、935 過、0 紅、23 跳過；黃金對照與回放照綠；秘密掃描 0。
- 新增 `test/unit/finish_steps.test.js` 6 個：各步驟的輸入輸出與逐字訊息；記憶體版版式寫入與寫檔版結果相同；`finishDraft` 整段（策展稿＋建立輸入＋D7 uther 層價格列）產出的草稿通過 schema、gate FAIL 0。
- 走過 server 收尾的既有測試（`server_price_truth_flow` 等）照綠＝殼改呼叫 core 後行為未變。

## 跟著「搬家」改的三支既有測試（要講明）
這三支是用字串比對 server.js 原始碼來守「只定義一次」。本體搬到 core 後改成：本體在 `core/product-truth/rows.js` 恰一處、server.js 不得再自己定義、且必須從 core 取用。守的事情沒變，只是位置跟著搬。
- `test/unit/pc_blocking_count.test.js`（2 條）
- `test/unit/price_truth.test.js`（原本用 vm 從 server.js 原始碼切出 `patchSnapshotPrice` 來跑，改成直接 require core）

## 沒做完的（列入後續，不硬趕）
- `finishDraftAfterCurate` 本身還在 server.js，仍是讀寫檔的編排；第 3、5 步在殼裡還是走寫檔包裝。整支換成 `finishDraft()` 要等 D11 的 RunStore（存取草稿的介面）與 D13 的建立工作。
- 第 7 步「取價格列」的編排（種子快取、連線探針、逐件抓商品頁、進度回報）仍在 server.js。D11／D13 接 D7 的兩層時重寫：建立期用 uther 層一次查完，不需要種子與探針。
- uther 版沒有來源頁原文：步驟 1 的 pageTitle 改餵 `snapshot.brand`（D11 接線時處理）。
- 第 4、6 步（提案包、策略檔）第二階段再抽，介面相同。
