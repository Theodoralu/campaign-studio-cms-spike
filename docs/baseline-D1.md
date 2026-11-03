# D1 測試基線（2026-10-30）

**環境**：macOS。兩個 Node 版本各跑一次：**v22.23.4**（公司映像版本，`npm ci` 107 套件，36.6 秒）與 v26.12.0（本機原裝，104 套件，8.4 秒）。
**指令**：在 `2026-Claude-code-AI自動化創建活動頁 workflow/pipeline/` 跑 `npm test`（= `tools/dod-guards.js` → `node --test`）。
**原始輸出**：`docs-baseline-D1.txt`（repo 根）。

| 項目 | Node 22.23.4 | Node 26.12.0 |
|---|---|---|
| tests | 975 | 975 |
| pass | **917** | 916 |
| fail | **40** | 41 |
| skipped | 18 | 18 |
| 時間 | 36.6 秒 | 8.4 秒 |

兩版唯一的差別是 F 類那一條（`net_tuning`）：Node 22 的預設值仍是 250 → 通過；Node 26 改成 500 → 失敗。其餘 40 個失敗兩版相同。`sharp` 在兩版都能安裝（22 多抓 3 個平台二進位套件）。
**原始輸出**：`docs-baseline-D1-node22.txt`（22）、`docs-baseline-D1.txt`（26）。

`tools/dod-guards.js` 本身通過（它是 Alice 工作流的守門，D5 會從 `npm test` 拿掉，不搬）。

## 41 個失敗分六類

| 類 | 原因 | 測試檔 | 數 | 處置 |
|---|---|---|---|---|
| A | **設計側源檔不在工作包**：`活動頁色彩策略工具.html`、`MVP_Phase1_LeCreuset_活動頁Prototype_FrameTest.html`（引擎源檔；`lecreuset-frametest/index.html` 是建置後的複本）、`規劃/assets/hero-bg/bg-map.js` | colortool_env ×4、typo_steps_three_copies ×1（整檔 crash）、fonts_registry ×2、hero_combo ×1、engine_twin_tables、explore_cap_sync、hero_bg_own_doors、hero_stages_twin、ga_tracking（各整檔 crash）、bg_map_resolves_used_backgrounds ×2 | 15 | **不搬**。這些測試驗的是設計工具與引擎源檔之間的「雙胞胎複本同步」，源檔屬 Alice 的設計工作流。D10 把需要的規則改成直接驗 `assets/` 裡的建置產物。`ga_tracking` 例外：D10 要用 fixture 重寫 |
| B | **測試夾具是一檔真活動** `runs/2026-09-14-wb-143442`，工作包沒帶 | server_brief_flow ×9、ui_brief_flow ×1、server_price_truth_flow ×2 | 12 | 策略檔（brief）相關 10 個＝第二階段功能，先標 skip。`server_price_truth_flow` 2 個是 **D7 要用的**，D4 做錄製回放時把一檔真活動收進 `test/fixtures/` 當夾具（或向 Alice 要這一檔） |
| C | **Alice 的部署守門**（檢查 git 在途改動、deploy-site 宣告） | deploy_dirty_tree_guard ×9 | 9 | **不搬**（P27）。D5 刪 |
| D | **分享站鏡像頁同步檢查**（`tools/gen-flow-guide.mjs --check`，deploy-site 鏡像不在包內） | ui_brief_flow 之一 | 1 | **不搬**。D5 刪 |
| E | **退役檔案的檔頭檢查**：`price_watch.sh`、`overview_sheet.js` 不在工作包；Netlify 登入退役訊息 | legacy_pipelines_archived ×2、netlify_auth ×1 | 3 | **不搬**（都是已退役功能的墓碑測試）。D5 刪 |
| F | **Node 版本相關**：`net_tuning` 斷言 Node 預設 autoSelectFamilyAttemptTimeout＝250；Node 22 是 250（過）、Node 26 是 500（紅） | net_tuning ×1 | 0（22）／1（26） | 已確認。P21 的第一筆證據：**以 22 為準**，`.nvmrc` 釘 22，CI 跑 22；本機裝 26 的人會看到這條紅，是預期的 |
| G | spec 機讀欄 vs HERO_LEN 不一致 | spec_field_limits_vs_hero_len ×1 | 1 | 待查：可能同 A（spec 檔在設計側）。D2 看一眼 |

**結論**（以 Node 22 的 40 個為準）：失敗裡 **29 個是「驗 Alice 工作環境裡才有的東西」，不搬**（A 的 14＋C 9＋D 1＋E 3，再加 B 的 10 個第二階段功能）；真正要我們處理的是 **B 的 2 個價格夾具（D4）、A 的 ga_tracking（D10）、F／G 各 1（Node 22 重跑）**。

## 待補
- [x] Node 22 重跑（2026-11-02）：917 過／40 紅，見上表。
- [ ] G 類查原因（D2）。
- [ ] 22 比 26 慢 4 倍（36.6 vs 8.4 秒），原因待查，不擋 D1。

## 環境備忘
- `npm test` 的 script 是 `node --test || echo 'ⓘ 尚無 test/…'`，任何一個測試紅都會印那句，不代表沒有測試。D5 改掉。
- Node 22 的測試報表是 TAP（總結行 `# tests N`），Node 26 是 spec 格式（`ℹ tests N`），抓數字時 grep 要分開寫。
- nvm 安裝後要把啟動行加進 `~/.zshrc`；zsh 預設不吃互動模式的 `#` 註解（`setopt interactivecomments`）。

## 複製時刻意排除的東西
`node_modules`、`runs/`、`*.log`（含 `workbench/server-8787.log`，內有 28 處 `/Users/tofu`）、`price_qa_report.json`、`.wb-pass`、`online-url.txt`、`workbench/VERSION`、`.DS_Store`、`deploy-site/活動版型待審背景/*`（使用者上傳素材，只留 `pending.json`）。
`tools/` 從同版本的 `activity-page-pipeline-20261014-11f9dc7` 補齊（工作包砍到剩 2 支）；`docs/`（247 MB QA 截圖）未複製。

## 已知的個人路徑殘留（D6–D10 清）
`lecreuset-frametest/assets/cutouts/*/cutouts_report.json`（去背工具產出，記了來源路徑）×5；`test/unit/overview_mail.test.js`、`test/browser/brief-journey.js`、`test/browser/w1b-l006-shots.js` 的註解或預設路徑 ×3。沒有密鑰命中。
