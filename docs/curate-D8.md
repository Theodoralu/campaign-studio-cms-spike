# D8 — core/curate：規則版策展抽出＋CurateEngine 介面＋真值鐵律斷言

日期：2026-11-13 ｜ Jira ECSEARCH-39051

## 做了什麼
| 件 | 位置 | 說明 |
|---|---|---|
| 規則版引擎 | `pipeline/core/curate/rules.js` | 自 `workbench/curate_auto.js main()` 原樣抽出（522 行）。只改 I/O 邊界：snapshot 由參數進、draft 由回傳出、策略檔內容與圓卡圖探測由 deps 注入、`process.exit(2)` 改 `CurateError(code 2)`。選品、切層、標題、配色邏輯逐位元組不動 |
| CurateEngine 介面 | `pipeline/core/curate/index.js` | `plan(snapshot, input) → outline`、`build(outline) → draft`、`curate()` ＝兩步。rules 引擎的 plan 一次做完、outline 當內部資料；第二階段 AI 引擎接同一介面，plan 是真大綱（給人核准）、build 才生成 |
| 薄殼 | `workbench/curate_auto.js`（64 行） | CLI 讀寫檔＋注入 `img_probe`；`bridgeThemeForV2IntoDraft`（讀寫 draft 檔）留在殼給 server.js。D16 隨 workbench 退場 |
| 真值鐵律斷言 | `test/unit/curate_engine.test.js` | 五份真快照（爬頁 1、uther 4）各跑一次：草稿每個品名／價格／劃線價／網址／主圖／offer 標籤／檔期／入口網址都要能在 snapshot 逐字找到；樓層牆主視覺引用的商品都在表裡且不重複曝光；ai-curated 標題無數字 |
| 留洞（預設不變） | `preparePool()` | `poolOrder: disc\|sales`（P39）、`excludeOutOfStock`、`wallGroupBy`（只收參數，第二階段實作） |

## 驗證
- 黃金對照 `test:golden` 2/2 綠：抽出前後 draft 逐位元組相同
- `test:curate`（真值鐵律 9＋黃金 2＋first_draft_no_red 6＋hero_count 4＋theme_bridge）全綠；`net_tuning` 絆線綠（core/curate 不對外抓）
- 真值鐵律對 **uther 版四份快照也全過**＝ D6 說的「下游零改動」實證：uther 快照直接餵規則引擎，產出合法草稿

## 對 Alice #24（ai-curate-read-scope）的對照
單機版 AI 策展＝`spawn("claude -p")` 在 run 資料夾讀寫檔，#24 把它關進 run 資料夾（`Read(./**)`、停 Bash、參考檔複製進去）。CMS 的 CurateEngine 資料走參數、不碰檔案系統，第二階段 AI 引擎走 LLM API 不 spawn CLI，所以此題在 CMS 側不存在。取其結論：AI 引擎必讀兩檔（契約形範例＋04 號規則）列為明確輸入 `deps.contractExample`／`deps.curationRules`。

## 待辦
- D9：core/finish（`finishDraftAfterCurate` 收尾步驟拆開）
- D10：CP 清單向 Alice 要最新版（她提議匯出）；`filterTags` 分類牆（wallGroupBy）第二階段
- D11：`poolOrder` 預設要不要翻成 sales，業務確認後翻並 `golden:regen`

## 2026-11-13 複核補記
- 抽出前後逐行 diff：84 行差異全是 I/O 邊界（require 路徑、讀寫檔、exit→throw、圖片探測注入），選品／切層／標題邏輯零差異。
- 漏改一條 require 路徑（策略檔第二段 `brief_selection.js`）：黃金對照只走「建立」路沒抓到，`server_price_truth_flow` 抓到，已修。教訓：D16 退場 workbench 前，每條活路都要有對照。
- 真值鐵律原有三條斷言空過（主視覺檔期／活動編號、offer 標籤在五份快照都沒出現）→ 改成：主視覺檔期規則引擎一律留空（斷言它是空）、入口格的活動編號／標題／檔期／網址逐字對快照、另加 offer 逐字測試（快照塞 offer，驗標籤原字或原字前綴＋tagOriginal）。共 11 測試。
- core 殘留一處讀檔：`themeFit` 仍傳檔案路徑給 `lib/theme_fit.loadThemeFitRule`，D9 改傳內容。

## 範圍決定（2026-11-13，Dora）：維持「第一版＝單機版同等功能」
以下三項不進第一版，列第二階段：
- 手動貼上商品清單當來源（第五種來源型；uther by ids 一次查詢即可）
- Google Sheets 連結當商品清單來源（另牽涉 P23）
- uther `subtitle` 接成商品卡優惠短句（offer）——單機版只有品牌頁熱銷區抓得到 offer，uther 每件都有 subtitle
