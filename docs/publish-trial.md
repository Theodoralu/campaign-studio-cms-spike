# 發布試作：製作完成後上傳到 S3（2026-11-19）

## 白話
現在製作出來的 HTML 只存在 CMS 的活動資料裡，要登入才下載得到，沒有對外。ECSEARCH-39133 規劃之後活動頁改由 S3（存放）加 CloudFront（對外）上線。這裡先試作前半段：**製作完成後，CMS 自動把 HTML 上傳到 S3**。本機用 MinIO 當 S3。

目的是讓「製作 → 發布」有一個真的能跑的版本，拿來跟 publisher 那邊對著討論。它不是定案。

## 先假設的三件事（39133 定案後要改）
| 項目 | 現在的做法 | 票上的規劃 |
|---|---|---|
| 路徑 | `pages/<活動編號>/index.html` | `pages/<page>/index.html`，頁面名稱誰決定未定 |
| 內容 | CMS 做出來的單一 HTML 原樣上傳 | campaign-minifier 可能再處理一次、拆出共用程式 |
| 快取 | `Cache-Control: public, max-age=600` | HTML 10 分鐘 |

## 沒做
CloudFront、清快取、Athenz 換臨時憑證、共用的 `main.js`／`main.css`、下架（刪除已發布的頁）。

## 行為
- 預設不發布。設了 `CS_PUBLISH=s3` 才上傳。
- 製作的三關全過、檔案落好之後才上傳。
- 上傳成功：狀態的 `exportAem.published` 有 `bucket`、`key`、`url`、`versionId`、`publishedAt`。
- 上傳失敗：**不算製作失敗**。檔案照樣可以下載，`exportAem.publishError` 是一句白話，技術細節只進 log。
- 重新製作會覆蓋同一個路徑；bucket 開了版本控管就留得住舊版。

## 在本機跑
前提：MinIO 開著（只綁本機）。下面的帳密是 MinIO 的預設值，只在本機有效。

1. 準備 bucket（只要做一次）：
```bash
AWS_ACCESS_KEY_ID=minioadmin AWS_SECRET_ACCESS_KEY=minioadmin AWS_REGION=us-east-1 CS_PUBLISH_ENDPOINT=http://localhost:9000 CS_PUBLISH_BUCKET=cs-pages npm run publish:local-setup
```
2. 啟動 CMS 並開啟發布：
```bash
AWS_ACCESS_KEY_ID=minioadmin AWS_SECRET_ACCESS_KEY=minioadmin AWS_REGION=us-east-1 CS_PUBLISH=s3 CS_PUBLISH_BUCKET=cs-pages CS_PUBLISH_ENDPOINT=http://localhost:9000 CS_PUBLISH_BASE_URL=http://localhost:9000/cs-pages CS_RUNS_DIR=/tmp/cs-runs CS_DEV_USER=approver@dev.local npm run cms
```
3. 對一檔已核可的活動按製作，做完後開 `http://localhost:9000/cs-pages/pages/<活動編號>/index.html`。

## 本機與正式環境的差別（不要照抄）
本機的 `cs-pages` 設成**任何人可讀**，因為 MinIO 沒有 CloudFront，瀏覽器要直接開就得公開。正式環境的 bucket 是私有的，只有 CloudFront 能讀。`tools/publish_local_setup.js` 只接受 localhost 的端點，其他一律拒絕，就是為了不讓這個設定被用到正式的 bucket 上。

## 檔
`cms/publisher.js`（發布模組）、`cms/pipeline.js`（製作流程最後呼叫它）、`tools/publish_local_setup.js`（本機 bucket）、`test/unit/cms_flow.test.js` 最後兩個測試。
