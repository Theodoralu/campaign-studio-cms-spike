# D12：CMS 伺服器——登入、審核者權限、健康檢查（2026-11-18）

## 白話
前面十一天做的是零件（取商品、策展、收尾、檢查、製作 HTML 檔、資料保管）。D12 是第一次把零件裝進一個新的伺服器，並加上「你是誰」和「你能不能做這件事」。

## 怎麼在本機跑
```bash
cd "2026-Claude-code-AI自動化創建活動頁 workflow/pipeline"
CS_RUNS_DIR=/tmp/cs-runs CS_DEV_USER=approver@dev.local npm run cms
```
開 `http://localhost:8790/healthz` 看到 `{"ok":true}` 就是起來了。換身分測權限：請求加標頭 `X-Dev-User: sales@dev.local`。

## 做了什麼
| 檔 | 內容 |
|---|---|
| `cms/app.js` | Express 伺服器與六條路由（見下） |
| `cms/server.js` | 啟動入口；啟動時把設定驗完，有一項不對就結束並講清楚缺什麼 |
| `cms/auth.js` | 「現在的使用者是誰」：本機假登入可用；Okta 只有介面（見「沒做完」） |
| `cms/approvers.js`＋`config/approvers.json` | 審核者名單；格式不對或空的，啟動時就出聲 |
| `cms/secrets.js` | 密鑰來源：本機讀環境變數；正式讀 AWS Secrets Manager |
| `test/unit/cms_app.test.js` | 8 個測試，開真的 HTTP 伺服器打 |

### 路由
| 路由 | 誰能用 | 做什麼 |
|---|---|---|
| `GET /healthz` | 不用登入 | 服務活著（平台探活用） |
| `GET /readyz` | 不用登入 | 資料後端連得上 |
| `GET /api/me` | 登入者 | 我是誰、是不是審核者 |
| `GET /api/runs` | 登入者 | 活動列表 |
| `GET /api/runs/:id` | 登入者 | 一檔活動的狀態與核可狀態 |
| `POST /api/runs/:id/approve` | 審核者 | 核可；要帶畫面上看到的那一版的指紋 |

### 回應規則
- 沒登入打 `/api/*`：401。
- 不在審核者名單按核可：403，核可狀態不變。
- 核可沒帶指紋：400；帶的指紋不是現在這版：409（附最新指紋）。
- 伺服器內部出錯：500 加一句白話，錯誤細節只進伺服器 log，不回給畫面。

## 完成條件
| 條件 | 狀態 |
|---|---|
| 本機登入後看到列表 | 已滿足（假登入） |
| 非審核者按核可收到 403 | 已滿足 |

## 沒做完（都卡在 repo 搬進 Yahoo）
- **Okta 登入沒有接。** 申請 Okta 應用程式需要公司資源。現在 `CS_AUTH=okta` 會在啟動時明講「還沒接上」。接的時候只補 `cms/auth.js` 的 `oktaAuth` 一個函式（另需 session），路由與權限檢查都不用動。
- **AWS Secrets Manager 沒有對真的服務跑過。** 介面與快取用假的 client 測過；`@aws-sdk/client-secrets-manager` 還沒加進相依。
- **向 IT／資安窗口提上線申請**：未做。
- **審核者名單是測試身分**（`approver@dev.local`）。接 Okta 後換成真的公司信箱。

## 刻意留到 D13 的
- 建立、編修、檢查、製作 HTML 檔的路由。
- 核可在單機版還會做的三件事：把草稿狀態改成「待建置」、帶 FAIL 核可時的勾選確認、換版式後強制重驗才能核可。D12 的核可只管「誰可以按」和「核可綁哪一版」。
- 靜態前端頁面的提供。

## 安全上的決定
- 假登入在 `NODE_ENV=production` 拒絕啟動。假登入等於任何人都能自稱是誰。
- 密鑰不進 repo、設定檔、映像檔、log。
- 新增相依：`express` 5。
