# D10：發佈前檢查＋製作 AEM 檔（2026-11-17）

## 做了什麼
| 項目 | 內容 |
|---|---|
| 檢查可在程式內呼叫 | `gate.js` 的 `main()`（1,160 行）拆成 `checkDraft()`＋指令列殼。`checkDraft` 不讀草稿檔、不寫報告、不結束程序；指令列行為逐字不變（黃金對照與 84 支 gate 測試照綠） |
| `core/gate` | CMS 用的入口：`check({ snapshot, draft, meta, themeFitRule, skipHttp })` → 報告；`blocking(report)`；`byCheckpoint(report)` |
| 檢查點清單 | `core/gate/catalog.js`：repo 現有 27 條（gate.js 26 條＋AEM 顯示檢查 CP-32），每條有白話標題、最重級別、測試資料在哪 |
| 補測試資料 | 8 條原本沒有任何測試會觸發（CP-01、07、08、09、10、13、17、20），各補一個變異案例（`test/unit/cp_catalog.test.js`） |
| `core/export` | `buildAem()` 組瘦身版＋參照版（不寫檔）、`readme()`、`buildLogs()`、`friendlyBuildError()`；素材路徑改由 `assetRoots` 傳入 |
| 單機版改用 core | `server.js` 的 `exportAem` 組裝段與 README 改呼叫 `core/export`（3,549 → 3,524 行）；三關編排、進度、落檔、開 Chrome 仍在 server.js |
| build_id 測試 | 結構變（少一層樓、換版式、拿掉品類牆）換號；只改商品、文案、樓層內順序不換號 |
| CP-32 上 CI | 新 job `aem-verify`：`tools/ci_aem_verify.js` 拿黃金夾具走「收尾 → 檢查 → 組檔 → 真 Chrome 三裝置比對」。本機：`npm run aem:verify`（要有 Google Chrome） |

## 順手修掉的
- **gate.js 裡寫死一條個人暫存路徑**（2026-07-20 某次工作階段的資料夾，路徑含人名）。它是 CP-14 主題詞組的第二條讀檔通道，早就讀不到東西。已移除，`rules.json` 重新產出。
- **密鑰掃描漏抓這種路徑**：路徑把 `/Users/<人名>/` 壓成 `-Users-<人名>-`，原規則抓不到。`tools/secret_scan.js` 加一條。
- **主題詞組通道**：原本模組載入時就把校準檔路徑定死，同一個程序換不了。改成呼叫當下才讀，並可直接傳 `themeFitRule` 物件（CMS 不落檔）。

## 讀程式時發現、要人決定的
1. **AEM 檔超過頁面編輯器上限 4.79 倍。** 黃金夾具組出來 417 KB，編碼後 627,774 字，上限 131,072 字。單機版從 2026-09-17 起「只量不擋」，檔案照樣產出、README 會寫超標。現在同事實際怎麼上傳（整檔上傳而非貼進編輯器？）要問 Alice 團隊；若一定得貼進編輯器，目前的檔貼不進去。
2. **CP-20（模組主從一致）只對五個品類生效。** 它靠一張人工維護的同義表（鈦、法式餐廚、露營、鍵盤、女裝）；主題不在表裡就整條略過，只留一行 INFO。新品類的頁面等於沒有這條檢查。
3. **登記表說 CP-01～35，repo 的 gate.js 只發 26 個代號。** 不在程式裡的：CP-05、19、23、24、30、33、34、35（CP-19 是已停用的價格巡檢；CP-35 只在 Alice 環境的測試提到）。要等 Alice 的清單才知道是別處實作、已作廢、還是漏了。

## 沒做完
- gate.js 本體沒有搬位置（20 幾支測試與單機版用路徑或 spawn 引用），`core/gate` 是門面。
- 檢查仍會自己讀登記簿檔（`lib/proposal_pack`）與打 HTTP（圖片、搜尋目的地）；D11／D13 再收成注入。
- 單機版的 `runGate` 仍是 spawn 指令列，沒有改成程式內呼叫（D13 建立工作一起換）。
- 匯出三關的編排仍在 server.js。
- `test/legacy-env/ga_tracking.test.js`（P31 歸 D10）沒搬：GA4 整題不在第一版，只補了 build_id 這一條。

## 驗證
- 乾淨 clone `TZ=UTC npm run ci`：見 commit 訊息的數字。
- `aem-verify` job 需要真 Chrome，本機沙盒沒有，第一次實跑在試車場 CI。
