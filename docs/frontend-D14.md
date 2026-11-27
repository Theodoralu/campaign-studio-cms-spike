# D14：把畫面接到新伺服器（第一段，2026-11-20）

## 白話
新伺服器到 D13 為止只有 API。D14 把單機版的畫面（一支 9 千多行的 `index.html`）搬過來用。做法是讓新伺服器「講舊畫面聽得懂的話」，畫面本身只改四行。

這是第一段：畫面開得起來、主流程的請求對得上。哪些按鈕按了會出錯，要實際在瀏覽器操作才知道，所以做了一個盤點機制（見下）。

## 怎麼開
```bash
CS_RUNS_DIR=/tmp/cs-runs CS_DEV_USER=approver@dev.local npm run cms
```
瀏覽器開 `http://localhost:8790/`。身分由 `CS_DEV_USER` 決定；要換成業務就改成 `sales@dev.local` 重啟。

## 做了什麼
| 項目 | 內容 |
|---|---|
| 靜態檔 | `/`（畫面）、`/public`、`/frametest`（預覽用的活動頁引擎）、`/design-assets`、`/design-proposal-kit`、去背商品與待審背景兩個素材資料夾。都要登入才給 |
| 版本握手 | `GET /api/version`；能力表回 `null`，畫面上標了「需要某能力」的功能（AI 策展、Google 試算表等）全部自動藏起來 |
| 列表 | `GET /api/runs` 改回陣列，欄位照單機版（狀態燈、檢查結果、商品狀態摘要、製作狀態） |
| 狀態 | 回整份狀態檔加 log 最後 12 行（建立進度條讀這個） |
| 存草稿 | 舊畫面不帶 Content-Type、版本用數字；伺服器兩種都收，並把數字對回真正的版本 |
| 檢查、舊版 | 回應補上舊畫面讀的欄位 |
| 沒搬的路由 | 一律回 501「這個功能第一版還沒接上」，並記錄下來 |

## 畫面改了哪四行（`workbench/public/index.html`）
1. 多一個變數 `draftFp` 記草稿的內容指紋。
2. 載入草稿時，從回應標頭記下指紋。
3. 存檔成功後，換成伺服器回的新版本與新指紋。
4. 核可時把指紋帶給伺服器；核可成功後跟上伺服器改過的草稿狀態。

這四行對單機版伺服器沒有影響（它不回這些欄位，畫面就照舊）。

## 盤點機制：畫面打到哪些還沒搬的路由
操作畫面之後開 `http://localhost:8790/api/_missing`，會列出被打到、但還沒搬的路由和次數。伺服器的終端機也會在第一次打到時印一行。D14 第二段就照這份清單決定要補哪些、要從畫面上藏掉哪些。

## 還沒做
- **沒有人在瀏覽器實際操作過。** 我這邊沒有瀏覽器可以開這個畫面，只驗了檔案給得出來、API 形狀對得上。
- 建立表單的「建立者」「部門」欄位還在，伺服器會忽略、改用登入身分。把欄位從畫面拿掉是第二段。
- 畫面上的用語仍是 AEM（「製作 AEM 網頁檔」）。
- 預覽 iframe 讀草稿的網址沿用 `/api/runs/<編號>/draft.json`，應該可用，未實測。

## 第二段（2026-11-26）：編修頁的進階操作也接上、藏掉第一版不做的入口

依據：11-23 實測的 `/api/_missing`（promo-options、feedback-patch、product-fetch、promo-recompose 被畫面叫到但還沒搬）。

### 新接上的網址

| 畫面上的操作 | 網址 | 說明 |
|---|---|---|
| 本期活動：看三種來源各有幾個可選 | `GET /api/runs/:id/promo-options` | 邏輯抽到 `core/promo`，單機版也改呼叫同一份 |
| 本期活動：換來源、重選入口 | `POST /api/runs/:id/promo-recompose` | 湊不到 3 則回 409，並建議別的來源 |
| 主題詞組：讀、人工改 | `GET` / `PUT /api/runs/:id/feedback-patch` | 不能清空；改完之後檢查與本期活動都用新詞 |
| 換品：貼商品網址讀資料 | `POST /api/product-fetch` | 開商品頁讀名稱、價格、圖 |
| 換品：把讀到的商品登記進來源 | `POST /api/runs/:id/r3-add` | 登記後才能放上頁面（真值欄照來源） |
| 單件套用商品頁現價 | `POST /api/runs/:id/apply-live-price` | 整批版本是 `apply-live-prices` |
| 頁面組成：樓層上移下移、增刪區塊 | `POST /api/runs/:id/content-modules` | 自動挑商品（auto）第一版不做，回 501 |
| 主視覺組合面板：換版式、背景、主題色、標題大小 | `POST /api/runs/:id/hero-combo` | 11-26 實測後補。貼提案包、自己上傳背景圖第一版不收（501）；換回版式把商品放回頁面時，要重驗商品狀態才能核可 |
| 主題色把關 | `GET /api/theme-check`、`GET /api/runs/:id/theme-check` | 11-26 實測後補 |

會改草稿的回應都帶新的 `baseMs` 與 `fingerprint`；畫面有一個全域攔截，收到就更新手上的版本代號，接著存檔不會被當成舊版擋下。

### 畫面在新伺服器上的差異（`/api/version` 回 `mode: "cms"` 時）

- 建立表單不再要求填建立者、部門（建立者＝登入的人）。
- 藏起來：提案包、封存、垃圾桶選單、內網 GitHub Pages 連結、輔助檢視分頁。單機版不受影響。

### 還沒搬（第一版不做，記在 ECSEARCH-39120）

Google 文件匯出（`google/status`）、提案包、封存／垃圾桶還原、內容模組自動挑商品、分享預覽。

### 測試

`test/unit/cms_flow.test.js` 新增三組：本期活動（含主題詞組連動）、主題詞組讀寫、換品＋單件套用＋樓層上移下移；最後確認整輪操作 `/api/_missing` 為空。乾淨 clone 全套：1016 測試、993 過、0 紅、23 跳過。

## 第三段（2026-11-27）：補單機版其餘功能

範圍重申（使用者 11-26）：第一版＝單機版同等功能，還沒接上的單機版功能都要補，不推到第二階段。

### 這一段接上的

| 畫面上的操作 | 網址 | 程式 |
|---|---|---|
| 刪除活動（進垃圾桶，30 天內可還原） | `DELETE /api/runs/:id` | `cms/lifecycle.js` |
| 垃圾桶：列表、還原、永久刪除、清空 | `/api/runs-deleted/*` | 同上 |
| 封存、移回活動總覽 | `POST archive`、`unarchive` | 同上 |
| 補選活動型態 | `POST scenario` | `cms/edit_more.js` |
| 來源紀錄重建（重讀商品頁，同步來源與草稿名稱） | `POST pool-rebuild` | 同上 |
| 編輯精選加一件（貼網址或自動補） | `POST editorial-add` | 同上 |
| 一鍵生成 編輯精選＋延伸探索 | `POST enrich-ee` | 同上 |
| 延伸探索卡：換在檔活動、手動改連結、新增、移除、「看更多」去向 | `POST explore-fix` | 同上 |
| 頁面組成的「補一件折數最好的」 | `content-modules`（auto） | `cms/runs.js` |

畫面：歷史與封存、垃圾桶選單放回來。

### 與單機版不同的地方

- 刪除不搬資料夾，只在狀態檔記刪除時間（S3 與本機資料夾同一套做法）；列表不列、垃圾桶才列。滿 30 天在列垃圾桶時清掉。
- 刪除不會撤掉已發布到 S3 的頁面（發布端規劃未定，見 ECSEARCH-39133）。
- 「整頁已用商品」的規則（`core/page/exposed.js`）是單機版 `server.js` 同名函式的逐字副本，有測試比對兩邊文字相同。

### 還沒接上的單機版功能

見下方第四段；第三段結束時剩上傳背景與 Excel 匯入，已在第四段補上。

## 第四段（2026-11-27）：上傳主視覺背景、Excel 帶入

程式在 `cms/uploads.js`，規則全用單機版同一批 lib。

| 畫面上的操作 | 網址 |
|---|---|
| 上傳背景（桌機、平板、手機三張；自動壓成 WebP） | `POST /api/runs/:id/hero-bg` |
| 移除上傳的背景 | `DELETE /api/runs/:id/hero-bg` |
| 預覽讀圖 | `GET /api/runs/:id/hero-bg/:file` |
| 版權確認 | `POST /api/runs/:id/hero-bg-confirm` |
| 下載背景製作說明 | `GET /api/runs/:id/hero-kit` |
| 套用到草稿 | `POST /api/runs/:id/hero-combo`（帶 `heroBgOwn`） |
| 下載 Excel 範本 | `GET /api/runs/:id/import-template` |
| Excel 對帳（不寫入）、帶入 | `POST import-preview`、`import-apply` |

### 與單機版不同的地方

- **圖檔怎麼存**：RunStore 目前只存文字，圖以 base64 文字存成 `hero-bg/<檔名>.b64`。每次操作把圖取到暫存資料夾讓 lib 照常處理，做完存回、刪掉暫存。本機資料夾與 S3 同一套。圖多或量大之後應該讓 RunStore 直接存二進位檔。
- **版權確認比的是登入身分**：單機版比「重輸的帳號」與建立時手填的信箱；新伺服器比「重輸的帳號」與登入的人，紀錄也記登入的人。
- **製作的把關**：用了自己上傳的背景但還沒確認版權，按製作會回 409，組檔那一步也會再擋一次。
- **請求大小**：一般 5MB；上傳背景與 Excel 這三條放寬到 30MB。

### D14 仍然沒有的

| 功能 | 原因 |
|---|---|
| 照策略檔重做草稿（`redo-draft`）、策略檔、提案包、Gemini 提示、AI 文案建議、AI 策展 | 需要 AI 或依賴策略檔，第二階段（ECSEARCH-39120 第 1～3 項） |
| Google 文件與 Sheets、ZIP 匯出、內網上線、對外發佈 | 不搬（2026-11-19 確認） |

### 測試

`test/unit/cms_flow.test.js` 共 24 組。乾淨 clone 全套數字見 commit 當下的 CI。第二、三、四段的操作都還沒有人在瀏覽器點過。
