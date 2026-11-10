# D6 — core/uther＋core/source：網址 → uther → snapshot

日期：2026-11-09～10 ｜ Jira ECSEARCH-39049

## 做了什麼
| 件 | 位置 | 說明 |
|---|---|---|
| UtherClient | `pipeline/core/uther/client.js` | v3 `products`（60 切批、400002 降 10）、`getProductsByStoreId`、`hitCountByKeyword`；v1 SAS（mipIds／brandIds／storeIds／關鍵字，固定關 backfill 與 refine，offset/hits 分頁）；429 讀 Retry-After 重試一次；5xx throw 帶 traceId；fetch 走 `lib/http_replay`（可錄可放） |
| 正規化 | `pipeline/core/uther/normalize.js` | item cell → snapshot 商品：`price = currentPrice ?? marketPrice`、劃線價只在有活動價時、`disc` 由 `discountWording` 換算、`imgs` 取 large、活動由 `productActData` 彙整；新欄 discountWording／stockStatus／flags／actIds／sellerId／salesVolume／ratingCount／globalRating |
| 網址判型 | `pipeline/core/source/resolve.js` | activity／store／search／brand；商品頁與外域擋下 |
| 組快照 | `pipeline/core/source/build_snapshot.js` | 查詢鏈見下；輸出通過 `schemas/snapshot.schema.json`，下游（curate、gate）零改動 |
| CLI | `pipeline/fetch_uther.js` | 與 `fetch_parse.js` 同進同出 |
| 工具 | `tools/snapshot_diff.js`（新舊差異報告）、`tools/uther_probe.js`（連線＋上限探測） |
| 測試 | `uther_client`（8）、`source_build_snapshot`（4）、`uther_replay`（2，黃金：`snapshot.uther.json`＋5 份卡帶） |

## 查詢鏈（第一版）
| 來源 | 池子 | 活動資訊 |
|---|---|---|
| 活動賣場 `/activity/onsale?actid=` | v1 `mipIds=` → v3 by ids（≤120） | productActData；endTs 已過＝警告「活動已結束」不擋 |
| 店家／旗艦館 `/?sub=`、`/act/flagship/N.html` | v1 `storeIds=&isStoreSearch=1&sort=-sales`（近期熱銷）前 120 件；`getProductsByStoreId` 7 日熱銷 10 件只打 `bestseller7d` 標記 | productActData |
| 搜尋 `/search/product?p=` | v1 `p=`（可帶 brandIds／cid／flt／sort）→ v3 | productActData |
| 品牌 `/brands/<slug>` | 抓一次品牌頁取 brandId → v1 `brandIds=` → v3 | productActData（brandId 鍵名待 D7 用真頁確認） |

## 實打結果（2026-11-10，Dora 的 Mac）
- 連得到 `tw.search.ec.yahoo.com`，v3 約 225ms／請求
- **`productIds` 上限＝60**：伺服器訊息「The max productIds size is 60」；文件錯誤表寫 10 是舊資料（計畫 P38）
- `?sub=1035`（統一企業品牌旗艦店）：店內搜尋 totalhitcount 369，取 120 件，5 次請求；3 檔進行中活動；1 件 OUT_OF_STOCK（進池帶狀態，策展略過與否 D8 決定）；9 件有活動價
- 回應形狀與文件一致；沒活動的商品不帶 `productActData`，`getProductsByStoreId` 回應沒有 `sellers` 與根 `productActData`（店名改從 v3 products 的 `sellers[]` 取）

## 新舊差異（`docs/uther-diff-sub1035.md`）
- 池子只重疊 4 件：**刻意改變**。舊爬頁版對 `?sub=` 頁只抓頁上掛的活動賣場商品；新版拿全店商品依熱銷排（2026-11-09 裁，P38）。相隔 13 天活動也換了
- 重疊的 4 件 **name／price／marketPrice／disc 全部相同**＝價格真值兩條路一致
- `url` 不同：舊 `gdsale.asp?gdid=`、新 slug 式 `gdsale/<品名>-<gdid>.html`，同一頁兩種寫法（gate CP-02 URL forms 已涵蓋）
- `imgs` 不同：同一商品圖庫的雜湊變了（13 天內圖片重上），不是對照錯誤
- 新快照 `hits`／`subcatDist` 空：舊版靠爬頁分類；uther 的 `filterTags` 要對到策展分類是 D8 的事

## 決策
- P38 店家型池＝全店商品；不用 MIP 活動當主軸；「全站重選＋AI 判分類」第二階段
- P39 取池 `sort=-sales`；策展排序不動（依折數），D8 加 `poolOrder: disc|sales` 選項、預設 disc

## 待辦
- D7：價格真值兩層（uther for build／compare，商品頁 for approve／export）；brand 頁 brandId 鍵名；搜尋型、活動型各錄一檔卡帶
- D8：`filterTags` → 分類；`poolOrder`；OUT_OF_STOCK 是否入池
- D11：`CS_SOURCE=uther` 接進 workbench 建立流程（目前兩條路並存，預設仍 fetch_parse）
