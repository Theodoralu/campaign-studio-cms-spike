# D4 — 錄製回放（Yahoo＋uther）＋固定時鐘

日期：2026-11-06 ｜ Jira ECSEARCH-39047

## 做了什麼
| 件 | 位置 | 說明 |
|---|---|---|
| 唯一時鐘 | `pipeline/lib/clock.js` | `CS_NOW=<ISO 或 epoch ms>` 固定時間；不設＝真實時間。`fetch_parse.js`、`workbench/curate_auto.js`、`gate.js` 的 `Date.now()`／`new Date()` 全改讀它（11 處） |
| HTTP 錄製／回放 | `pipeline/lib/http_replay.js` | `CS_HTTP_MODE=live|record|replay`，卡帶放 `CS_HTTP_CASSETTE_DIR`（預設 `test/fixtures/http/`）。`get()` 與 `https.get` 同簽名、`fetch()` 與 `globalThis.fetch` 同簽名；replay 缺卡帶＝throw，不偷偷上網 |
| 接線 | `fetch_parse.js` `fetchOnce` | `opts.get || httpReplay.get`（原本 `|| https.get`）。live 模式行為零改動 |
| 卡帶轉換工具 | `pipeline/tools/cassette_from_raw.js` | 把任何 run 的 `raw/*.html` 轉成卡帶（網址對應取自 snapshot.sourceUrl／promotions[].url） |
| 真活動夾具 | `test/fixtures/runs/2026-10-27-wb-085823/` | draft／snapshot／wb_meta／gate_report／product_check＋`snapshot.replay.json`（純抓取輸出的黃金檔） |
| 卡帶 | `test/fixtures/http/`（3 份，約 1.2 MB） | 來源頁 `?sub=1035` ＋ 活動頁 789017、796420 |
| 測試 | `test/unit/snapshot_replay.test.js`、`test/unit/clock_http_replay.test.js` | 回放＝黃金檔逐字相同；TZ=UTC 與 Asia/Taipei 同；缺卡帶出聲；clock／replay 單元 |
| 價格測試復活 | `test/unit/server_price_truth_flow.test.js` | SEED 改指 `test/fixtures/runs/2026-10-27-wb-085823`（原本要工作包沒帶的 `runs/2026-09-14-wb-143442`）→ 2 個紅燈轉綠 |

## 發現並修掉的真問題：檔期換算吃機器時區
`fetch_parse.js` 的 `slashDateToTs()`／`fmtTs()` 用 `new Date(y, m, d, h, mi)`——在 Mac（Asia/Taipei）對，在 UTC 的容器／CI 上 `startTs`／`endTs` 全部差 8 小時（28800 秒）。
已改成寫死 `+08:00`（台灣無夏令時間），不再看 `TZ`。這是「改」類 commit，請單獨一個 commit，附本段當差異說明。

## 為什麼不是真的上網錄
這台開發機的 Claude 工作區與雲端容器都連不到 `tw.buy.yahoo.com`（DNS 被 allowlist 擋）。改用 run 內既有的 `raw/*.html`（單機版每次抓取本來就存原文）轉卡帶，效果一樣：回放出的 snapshot 遮掉事後套的價格真值欄後，與 10-27 當天那份逐字相同。
之後在你的終端機（能上網）要錄新活動：
```bash
CS_HTTP_MODE=record CS_HTTP_CASSETTE_DIR=test/fixtures/http node fetch_parse.js "<活動網址>" /tmp/rec
```

## 驗證
```
npm run test:replay      # 7 tests pass
node --test test/unit/server_price_truth_flow.test.js   # 2 pass（基線時紅）
```

## 還沒做（排到後面）
- **uther 的錄製**：`lib/http_replay.fetch()` 已可用，D7 寫 `UtherClient` 時直接用它；61 件 `productIds` 上限探測要能連 uther 的機器才做（這裡連不到），D7 時在你終端機跑一次
- `gate.js:1581` 圖片 fetch、`workbench/img_probe.js`、`server.js:1277` 連結檢查還走原生 https；D10 搬 gate 時換 `httpReplay`
- `workbench/server.js` 73 處 `Date.now()`／`new Date()` 留到 D11 拆檔時一起換
- `product_fetch.js` 的 `attempts[].ms` 是耗時量測，不改（product_check 本來就不要求可重現）

## 基線變化（Node 22，2026-11-06 使用者終端機實跑）
| | 基線 D1 | D4 |
|---|---|---|
| tests | 975 | 982（+7 新測試） |
| pass | 917 | 925 → 926（絆線補登記後） |
| fail | 40 | 39 → 38 |
| skipped | 18 | 18 |

轉綠：`server_price_truth_flow` ×2。曾新增一個紅燈：`net_tuning.test.js` 的絆線（掃到 `lib/http_replay.js` 會對外抓、沒登記）→ 已在該檔 `require("../lib/net_tuning")` 並加進 `KNOWN_DOORS`。其餘 38 紅與基線清單相同（29 個 Alice 環境測試 D5 移除、ga_tracking D10…）。
