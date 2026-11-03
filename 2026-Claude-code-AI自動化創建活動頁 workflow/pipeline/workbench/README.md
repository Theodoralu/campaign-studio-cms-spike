# 策展工作台 v0.5（本機）—— URL＋活動目的 → AI 策展 → 畫布所見即所得編修 → 版本核可 → 上線部署

版本：v0.5（2026-07-22 介面重設計＝側欄批次導航＋狀態步進器＋畫布點擊編修＋裝置預覽＋部署管線）｜定位：**13 號平台 Stage A 前台的本機 spike**。
線上多人版＝13/15 號平台（Directus spike N-21）裁決範圍；未上線資料只在本機與分享站受保護路徑（U26）。

## v0.5 介面（2026-07-22 使用者需求批）

- **App 骨架**：左側批次導航欄（＋建立新活動／搜尋／狀態 chips 分組：處理中・已上線・批次／已刪除歸檔可還原）＋主工作區。
- **狀態步進器**：①策展 → ②編修 → ③核可 → ④上線（隨 dirty／approvedAt／deploy.stage 即時推進；修改後核可自動失效需重核）。
- **畫布 WYSIWYG**：預覽 iframe 同源＝直接點頁面文字（KV 大標/眉標/樓層與牆標題/情境卡/促銷模組標題/頁尾/注意事項）→ inline 浮窗編修 → `loadDraftJson()` 免重載即時重繪；與左欄表單雙向同步（表單輸入 600ms debounce 亦即時上畫布）。
- **裝置即時預覽**：desktop／tablet 768／mobile 375（FrameTest `?device=` 通道；未儲存編輯切裝置不丟——load 後由 parent draft 重注入）。
- **版本核可流**：每次儲存自動備份 draft.vN.json；版本抽屜可還原（還原前現行版再備份）；「✓ 核可此版本」＝page.status→待建置＋核可點落版。
- **上線部署**：閘序＝①本批 gate 全檢（FAIL 中止）②發佈 draft → 分享站 `live-drafts/<id>.json`（受保護路徑）＋重出 batches 快照 ③站級兩閘 selftest＋price_qa ④netlify draft ⑤API 晉升；入口＝`/lecreuset-frametest/?draftUrl=/live-drafts/<id>.json`。
- **更新頻次**（14 號契約提案欄 `page.refreshPolicy`）：商品 none|daily|weekly|biweekly|per-campaign／主題 none|weekly|monthly|per-campaign|seasonal；建立表單與編修文件皆可改；排程執行待 price_watch 泛化，先隨稿記錄營運意圖。
- **回饋**：toast 通知、AI 策展進度時間軸、部署五階段進度、寬度預檢即時警示（rules.json 單一來源）。

## 啟動

```bash
cd pipeline && node workbench/server.js   # → http://localhost:8787（預設 8787）
```

## 工作流（對應 04 號文件 §1 策展輸入三級）

```text
① 建立策展：URL ＋ 活動情境（下拉五式）＋ 活動主題（自由文字）＝ T2 級輸入
   情境枚舉（2026-07-22 使用者定義，入 curationGoal ✍️）：
   01 同品類×跨品牌-優惠銷售｜02 單一品牌-優惠/曝光｜03 同品類-情境×優惠
   04 同品類-新品/熱銷曝光｜05 時事主題-情境×選品；不選＝T1（AI 自判）
② 引擎：⚡ 機械 v0（curate_auto.js，秒級）／🤖 Claude AI（claude -p headless，1~3 分；
   失敗自動降級機械）→ 產 draft.json → 機器閘快檢初判
③ 編修＋預覽：左＝表單（✍️ 文案/🎚 開關可改；🔒 真值唯讀）、右＝FrameTest 同源 iframe
   （?draftUrl= 相對路徑白名單直通；panel:0 隱藏示範面板）；儲存＝版本化備份 draft.vN.json ＋預覽重載
④ 送建置：gate 全檢（含圖片 HTTP）＋ write_xlsx → 工作簿匯入 Google Sheets 走核可流程
```

## 鐵律落實（工作台不另寫任何規則＝單一來源）

- 前端寬度預檢＝載 `/api/rules.json`（gate.js 匯出）；gate 仍是唯一裁決閘。
- 機械策展 `curate_auto.js`：真值逐字、ai-curated 標題無數字、CP-20 基底詞過濾（詞庫 require 自 gate.js RULES）、U22 全頁互斥（KV＞樓層＞牆讓位切池）、U17/U19 入口 <3 則整組省略、CP-08 入口圖＝snapshot 原序首件、市價比 <0.4 禁折數標籤、標籤 v5 優先序＋tagOriginal。已驗證：鈦案 snapshot → **gate PASS（FAIL 0）**。
- AI 策展 prompt＝`curate_prompt.md`（T2：使用者輸入最高優先；產出自查清單＋2026-07-22 A/B 失誤硬化四條）。
- **引擎模型：釘選 `claude-opus-5`（2026-08-27 使用者裁決 Q1；35 號 §2.1 分站配置表）**——覆寫序＝`input.model` > `CAMPAIGN_CURATE_MODEL` 環境變數 > 釘選預設；spawn 前 `appendLog` 印出本次模型（`wb.log` 留痕＝過閘率可歸因）。原「不帶 `--model` 走各機預設大模型」已廢止：換機或改預設就默默換腦、過閘率不可比（28 號 C4）。**Fable 5 不採**：官方標示 latency Slower，本站 20 分硬砍線只剩兩倍餘裕（中位 9 分）＋成本翻倍換不到已量測收益＋知識截止較舊；重審觸發＝策展改多階段長流程或逾時線放寬。
  - A/B 依據不變（2026-07-22，LC 真 URL 同題對照）：Opus 5 級（~11 分、gate 全綠、單一品牌情境主動剔他牌 20 件＋防截斷留空標籤）；sonnet ~11 分但 6 FAIL（超寬折數標籤/CP-18 讓位序/自創 warm-light 主題值）。
  - `--strict-mcp-config` 必帶（headless 連全帳 MCP 連接器＝原逾時根因，基準 8.8 秒）；逾時 20 分、逾時/失敗自動降級機械 v0。
  - ⚠ **釘選字串未實跑驗證**：`--model claude-opus-5` 是否被本機 CLI 接受，待下次真實 AI 策展 run 確認（35 號 §8 驗證縫②／§9）。
- 編修介面：價格/檔期/URL/offer/入口全欄 🔒 不開放；促銷標題保留 promo-truth 格式提示。

## 檔案

| 檔 | 職責 |
|---|---|
| `server.js` | 零依賴 http server：前台＋FrameTest 同源掛載＋runs API＋stage1/2 與引擎橋接 |
| `curate_auto.js` | 機械策展 v0（可獨立 CLI：`node curate_auto.js <runDir> --scenario .. --theme ..`） |
| `curate_prompt.md` | Claude AI 策展引擎 prompt 模板（headless `claude -p`，Read/Write/Glob/Grep、12 分逾時） |
| `public/index.html` | 工作台前台（建立/批次列表/編修/預覽/機器閘/送建置） |

## 已知邊界（v0）

- 選品調整（換商品/換樓層分組）不在表單開放——直改 draft.json 後回工作台重閘（變更單流程）；v1 候選＝拖拉選品池。
- moreLink 一律 off（U28 目的地驗證需人工/網路查核）；編輯精選牆、explore＝契約待審（14 §8②③）loader 維持現值。
- fetch_parse 支援品牌頁/分類頁/活動賣場；搜尋頁（p=）需手建 snapshot（鈦案前例 build_snapshot.js）。
- E2E 憑證：`qa/2026-07-22-workbench/`（9/9 PASS＋截圖）。

## v0.8（2026-07-22 晚批：商品狀態檢查＋更替彈窗＋AI 帶文案＋商品圖下拉）

- **🩺 商品狀態檢查**：逐品實抓商品頁（節流 300ms）→ 在售／已下架（補貨・售罄空殼）／連結失效／💲價格變動（CP-19 真值時效）；報告抽屜內就地處理（🔄 替換商品＝跳彈窗／套用新價＝機械改價）；**上線部署第 ⓪ 關強制先過**，未過＝中止並自動攤開報告。實體 id 依 URL 尾碼（price_qa 慣例；draft gdid 與頁面實體 id 雙軌）。
- **🔄 更替商品＝獨立彈窗**（與欄位編修分離）：顯示將被換下商品 → URL 驗證鏈 → **第一張/第二張商品圖片**縮圖點選 → 套用 → **AI 自動撰寫標籤帶入可編欄位**（copy-suggest：haiku 微呼叫 15s、退機械派生；tagSource=manual）。
- **商品圖下拉**：每件商品列「第一張/第二張」select（imgOptions 記錄商品頁圖庫序；KV 主品連動 kv.images）——隨時改圖不必重替換。
- 契約提案欄新增：products[].imgOptions（14 號待審）；gate v10 tagSource manual（04 G6 待回寫）。
