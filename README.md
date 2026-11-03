# Campaign Studio

Yahoo 購物中心活動頁 CMS。由同事電腦上的單機版（第九版，20261014-11f9dc7）逐步改成部署在 AWS（Omega／Kubernetes）上的服務：商品資料走 uther API，同事用 Okta 登入操作。

**現況（D1，2026-11-02）**：這個 repo 是單機版工作包的原樣複本＋借用的測試，還沒有開始拆分。資料夾名稱與相對路徑都維持原樣，是為了讓既有測試跑得起來；重構路線見 `docs/`。

## 需求

- Node **22**（`.nvmrc`；公司基底映像版本。用 26 會多一條預期中的紅燈，見 `docs/baseline-D1.md` F 類）
- macOS 或 Linux

## 從零跑起來

```bash
nvm install && nvm use
cd "2026-Claude-code-AI自動化創建活動頁 workflow/pipeline"
npm ci
npm test
```

預期結果（Node 22）：975 個測試，917 過、40 紅、18 跳過。40 個紅燈的分類與處置在 `docs/baseline-D1.md`——大多數是在驗單機版作者工作環境裡才有的檔案，不屬於這個產品。

`npm test` 最後印的「ⓘ 尚無 test/」是舊 script 的副作用，不代表沒有測試。

## 資料夾

| 路徑 | 內容 |
|---|---|
| `2026-Claude-code-AI自動化創建活動頁 workflow/pipeline/` | 程式碼（`workbench/server.js` 伺服器、`fetch_parse.js` 抓取、`gate.js` 合規檢查、`lib/`）與 `test/` |
| `design-tokens/`、`design-assets/` | 色票、版式、字型、背景登記簿 |
| `2026-AI自動化活動頁生成規劃/` | `modules.json`（模組登記）與 `deploy-site/lecreuset-frametest/`（渲染引擎的建置版） |
| `docs/` | 基線與計畫文件 |

不進版控的東西（密鑰、每檔活動的產出 `runs/`、日誌、使用者上傳素材）列在 `.gitignore`。

## 啟動單機版伺服器（參考，之後會被 Express 版取代）

```bash
cd "2026-Claude-code-AI自動化創建活動頁 workflow/pipeline"
CAMPAIGN_MODE=editor node workbench/server.js
```

開 http://127.0.0.1:8787 。
