# D7 — core/product-truth 兩層價格真值＋四種來源網址型實錄

日期：2026-11-11 ｜ Jira ECSEARCH-39050

## 做了什麼
| 件 | 位置 | 說明 |
|---|---|---|
| 狀態列純邏輯 | `pipeline/core/product-truth/rows.js` | 自 `server.js productCheck`（1293–1458）原樣抽出：`pageLocator`（商品在頁上哪裡、未上場暫存品）、`compareRow`（活體價 vs 草稿價 vs 快照價 → drift／marketDrift／snapDrift／snapMissing）、`summary`／`blockingCount`／`blockMessage`（pcSummaryOf 口徑）、`patchSnapshotPrice`（套用新價那一刀） |
| 兩層真值 | `pipeline/core/product-truth/layers.js` | `utherLayer`（一次 v3 by ids；stockStatus → online／offline；查不到＝offline；連不上＝整批 throw）、`pageLayer`（逐件走既有 `probeProductLiveness`）、`buildCheck`（任一層 → `product_check` 形狀，通過 schema） |
| 交叉驗證 | `tools/truth_crosscheck.js` | 抽 N 件兩層真打比對，量耗時 |
| 四型實錄 | `test/fixtures/runs/{act-806613,search-iphone,brand-41168929}/snapshot.uther.json`＋卡帶 | 活動（adidas 806613）、搜尋（iphone）、品牌（41168929＝JESSICA）各 120 件 |
| 回放黃金 | `test/unit/uther_replay.test.js`（10） | 四型離線回放逐字相同；`npm run golden:regen:uther` 重產 |
| 測試 | `product_truth.test.js`（8） | |

## 交叉驗證 20 件（`docs/truth-crosscheck-D7.md`，同一批兩次：09:52 與 10:10）
- **第一次實付價 20／20 一致**；**第二次（18 分鐘後）11808851 uther 1111／商品頁 999**——同一件在兩次之間改價了，uther 還沒跟上（feeding 03:00／15:00＋快取 1h）。這就是 P30 兩層的實證：建立時信 uther 夠快，**核可前一定要再問商品頁**。uther 681 ms（1 請求）vs 商品頁 3.5～5.8 s（20 件）。
- **劃線價 uther 沒有**：v3 只有 `currentPrice`／`marketPrice`，`marketPrice`＝Yahoo 網路價（文件：Vespa list_price／price）；商品頁劃掉的是廠商市價／建議售價，兩代 uther 都沒這欄（v1 `ec_listprice` 也是網路價）。只有商品有活動價時 `marketPrice`＝頁面劃線（11949574：758／798）。**劃線價真值只有商品頁層**——舊爬頁版也是建立期對價才從商品頁填上（10-27 run：marketPrice null→259）。程式：uther 層沒活動價時標 `listPriceUnknown`，不比劃線價。
- **8993309 uther offline／頁面 online**：uther `stockStatus=OUT_OF_STOCK`（售完補貨中），商品頁仍開著有價。uther 的資訊更有用——補貨中的商品不該上活動頁。

## 四型實錄發現
- 品牌頁網址是數字 `/brands/41168929`＝brandId 本身，不用抓頁（非數字 slug 才抓，鍵名待遇到時驗）。品牌名由商品 `filterTags.品牌` 多數決（118／120 JESSICA）。
- `brand` 欄語意：店家／活動型＝店名；品牌型＝品牌名；搜尋型＝null（跨店）。
- `meta.totalhitcount` 四型都記（活動 2876、搜尋 42476、品牌 735、店家 369）。
- 正規化新增 `filterTags`（{名稱: [值]}），D8 分類牆用。

## 決策
- P40 價格真值兩層落地：建立／換品／批次對價＝uther 層（實付價）；核可與製作 AEM 檔前＝商品頁層（實付價＋劃線價＋在售）。uther 層不比劃線價。
- 待問 search team：uther 有沒有廠商市價（建議售價）欄？有的話劃線價也能走 uther。

## 待辦
- D8：`filterTags` → 品類牆分組；OUT_OF_STOCK 入池與否；`poolOrder`
- D11：建立流程改為「uther 層對價」，核可／匯出前「商品頁層」；`patchSnapshotPrice` 從 server.js 改 require 這裡
- 交叉驗證跑的時候別開 `CS_HTTP_MODE=record`（20 個商品頁 HTML 約 9 MB；已清掉誤錄的 21 份卡帶）
