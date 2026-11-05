# D3 — 14 號契約欄位表 → JSON Schema 草稿

日期：2026-11-04 ｜ 位置：`pipeline/schemas/*.schema.json`（JSON Schema 2020-12）｜ 驗證器：`pipeline/tools/schema/validate.js`

## 怎麼做的
1. 以單機版真實 run（`runs/2026-10-27-wb-085823/`）五個檔和 `test/fixtures/*` 推斷結構。
2. 對照契約 14 號 §2 欄位表加上必填、enum、範圍、`readOnly`／`x-permission`（🔒 伺服器真值、✍️ 可編修、🎚 可調）。
3. 再以 `gate.js` 常數校正——**gate.js 是現行真值，契約 14 號快照有幾處已過時**（見下表）。

執行：`npm run schema:check`（驗 fixtures）或 `node tools/schema/validate.js schemas <run>/*.json`。

## 驗證結果（2026-11-04）
| 檔 | 結果 |
|---|---|
| 真實 run 五檔（draft/snapshot/wb_meta/gate_report/product_check） | ✔ 全部通過 |
| `fixtures/gate_pass_layout006_draft.json` | ✔ |
| `fixtures/gate_pass_draft.json`、`gate_fail_draft.json` | ✔（11-05 起 kvVariant 改選填：缺席＝legacy 態，依 gate 51 §2.8） |

## 契約 14 號 vs 實際落地 —— 差異清單
| # | 契約寫法 | 實際（run / gate.js） | 處理 |
|---|---|---|---|
| 1 | `page.name` | `page.pageName` | schema 用 `pageName` |
| 2 | `floors[].productRefs` | `productGdids` | schema 用 `productGdids`，description 註明契約名 |
| 3 | `editorial.circles[].date` | `dateValue` | 用 `dateValue` |
| 4 | `editorial.title` 寫成陣列 | 物件（title 字串 + 子欄） | 依實際 |
| 5 | `sourceUrl` 在 page | 在 `snapshot.sourceUrl` / `wb_meta.input` / `meta` | page 不放 sourceUrl |
| 6 | 範例價格欄 `listPrice` | `marketPrice`（uther 同名） | 用 `marketPrice` |
| 7 | 牆位置 `wall-N` | run 用 `category-N`（舊 fixture `wall-N`） | pattern 兩者皆收，D11 統一 |
| 8 | 品類牆 3～5 面 | `CATEGORY_WALL_COUNT {min:1,max:3}`（2026-08-27 裁） | walls minItems 1 / maxItems 3 |
| 8a | `kvVariant` 必填、layout-001~012 | gate：值域＝modules.json hero variants（`^layout-\d{3}$`＋舊拼法 new/legacy），缺席＝legacy 略過 | 選填、pattern `^(new\|legacy\|layout-\d{3})$`；D8 改讀 modules.json 當 enum |
| 9 | `categoryWallCount` 整數 | 舊檔存字串 `"3"` | **2026-11-05 裁：拿掉，由 `walls.length` 推**；schema 標 deprecated、舊檔讀入忽略 |
| 10 | 牆每面 4/8/12 | `ZONE_PRODUCT_RANGE.walls 4–12`，非倍數只 WARN（2026-10-05） | minItems 4 / maxItems 12 |
| 11 | 樓層件數未寫範圍 | `floors 3–15` | minItems 3 / maxItems 15 |
| 12 | promoEntries 上限 12 | `PROMO_ENTRY_COUNT {min:3,max:12}` | min 3 / max 12 |
| 13 | promoSourceMode 未列 `manual` | `PROMO_SOURCE_MODES` 含 manual | enum 加 manual |
| 14 | 圖片網域 img.yec.tw / s.yimg.com | gate 另收 `sp.yimg.com` | 三者皆收 |
| 15 | 牆容器鍵只有 `walls` | gate 另收 `categorySections`；圈圈另收 `items` | schema 主鍵 `walls`/`circles`，legacy 鍵不擋（strict:false） |

## 已裁（2026-11-05，Dora）
- #7 位置命名 `category-N`／`wall-N` 兩者暫收，D11 統一。
- #9 `categoryWallCount` 拿掉，由 `walls.length` 推。
- 舊格式 fixture 不改：kvVariant 缺席本來就是合法的 legacy 態（gate 51 §2.8），schema 改選填後全綠。

## 後續
- D4：fixtures 補價格案例時一併加 `kvVariant`，讓 `schema:check` 全綠。
- D11：`PUT draft.json` 以 schema 驗入；違規回 422 並帶 ajv errors。
- 存放：schema 之後搬 `core/store/schemas/`，validate.js 變成 store 的前置 middleware。
