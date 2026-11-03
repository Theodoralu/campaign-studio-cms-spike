# 本期活動「主打選品舞台」沒價格沒特色標——復發成績單｜2026-09-04

範疇：使用者在 run `2026-09-04-wb-164258`（AOC 機械策展）把本期活動切成「主打選品舞台」，對照 Figma 主打選品模組規格：大卡該有商品名＋活動語＋價格（含原價），右欄兩張小卡該有特色標＋品名＋價格。實際：大卡只剩圖＋一行字、小卡只有圖＋品名。使用者指出 8/30 報過同一件、現在復發，要求修正並存檔分析、不再重複。

## 病因（三層）

1. **表層**：四則入口是「品牌商品推薦」來源組出來的，商品編號（12060783／11463406／11257801／11204189）**一件都不在這檔的 `draft.products`（55 件）**；引擎的舞台皮靠 gdid 回查 products 取真值價與特色標（`cardTuple`），查不到就退到「圖＋文案、不顯價」的簡化分支（設計上正確：系統不敢自己編價格）。
2. **中層（8/30 的修為什麼沒生效）**：8/30 在 `promo-recompose` 加了「商品型入口收進 products[]」，守門條件是 `src.price == null ⇒ continue`；但它拿到的候選名單來自 `promoLayerOptions` 的 `prodItem`，**只留 gdid／name／img／url 四欄、價格被剝掉**——條件永遠不成立、每件都被靜靜 `continue`。**修好的碼在等一個永遠不會來的欄位**，且跳過不 log、不提醒，四天沒人知道它從沒補進任何一件。
3. **底層（為什麼會這樣寫）**：上游剪欄（給選單用的輕量項）與下游要欄（補清單要真值）住在同一支檔案的兩處，各自演化；8/30 的驗證只驗了「程式邏輯」，沒拿真 run 的快照跑一次補入件數。09-01 經驗卡裁決已把「靜默退版改出聲、排期機器化」列為待辦，尚未動工＝復發窗口。

## 修法（同批）

| 位置 | 改動 |
|---|---|
| `pipeline/lib/promo_products.js`（新） | 純函式三支：`promoPoolItem`（候選項帶 price／marketPrice／imgs／offer／tag 全真值欄）、`ensurePromoProducts`（補入清單；缺真值＝跳過並回報 `reason`）、`describeSkipped`（白話一句） |
| `workbench/server.js` | `promoLayerOptions.prodItem` 改用 `promoPoolItem`；`promo-recompose` 補入段改用 `ensurePromoProducts`；跳過＝`appendLog ⚠`＋回應 `ensureNote` |
| `workbench/public/index.html` | 重組後若有 `ensureNote`＝toast 出聲 |
| 引擎 `FrameTest.html` | 舞台皮下，入口有 gdid 卻無 `cardTuple`＝預覽技術面板 `warns` 出聲（講哪一則、怎麼補） |
| `test/unit/promo_products.test.js`（新） | ①舊 prodItem 四欄形＝必被跳過且理由＝`missing:price`（釘死復發真因）②補入含真值欄／缺欄出聲／冪等 ③**餵真 run 快照＋草稿（read-only）＝四件全補得進** |

## 閘

| 閘 | 查了什麼 | 過沒過 | 證據 |
|---|---|---|---|
| 同類幾處（鐵律 4） | `dj.products.push(` 全掃 server.js：editorial-wall 兩處（1451／1506）走商品實抓真值鏈、不經 prodItem；只有 promo-recompose 這處吃剪過的候選項 | ✅ 只此一處 | grep |
| 真值 | price／marketPrice／name／url／img 全來自 snapshot（來源實抓）；只搬運不生成；收進 products[]＝照樣受 CP-02 逐字驗 | ✅ | lib 檔頭 |
| 失敗要出聲（鐵律 3） | 跳過＝log＋toast＋引擎 warns 三處 | ✅ | 程式 |
| 單元測試 | promo_products 3 支（含真 run 資料） | ✅ 3/3 | node --test |
| 全套單元 | pipeline test/unit | ⬜ 本批收尾跑 | — |
| 旅程 | 使用者在編修頁「內容主題」重選「品牌商品推薦」（先切別的再切回）→ 四件補進清單 → 預覽大卡有價格與原價、小卡有價格；特色標＝來源有 offer 才顯示（本檔來源無 offer＝小卡無標，屬真值缺席非 bug） | ⬜ 待使用者親走 | — |

## 不再重複的三件

1. 上游候選項與下游補入寫成同一支純函式（`promoPoolItem` ↔ `ensurePromoProducts`），單元測試把「舊四欄形＝一定跳過」釘成負例。
2. 跳過不再靜默：log／toast／預覽面板三處同聲。
3. 經驗卡 `20260904-fix-waiting-for-a-field-that-never-comes`：修「資料沒帶出」類 bug 後，回報前必拿真 run 資料跑一次、看補入件數不是 0。

## 追加（同日 18:2x）：特色標「欄位有填卻不顯示」＝換皮欄位沒帶出家族第三例

- 病因 A：CMS 舞台文字「卡頂膠囊文字」綁 `promoEntries.0.tag`，引擎讀的是 `chip`（`row.tag = e.chip`）——設計師在這格填的字永遠不上畫面，畫面顯示的是下方入口清單的「標籤」欄；文案說「同一份」其實是兩個鍵。修＝改綁 `.chip`（一個鍵一個真相）。既有草稿裡 `.tag` 的字成孤兒（本 run＝「ViewSonic 銀幕精選」），請設計師重填一次膠囊。
- 病因 B：第 2～3 則入口的「標籤」欄在舞台皮沒有落點（只有第 1 則的膠囊用到）——板 377:250 小卡品名上方就是那顆標。修＝小卡特色標＝入口標籤（有填才用）、沒填退商品自帶 tag／offer。副作用要講：來源重組時標籤欄預設帶「商品名前 10 字」，補進清單後小卡會先顯示這串（例「ASUS 華碩TUF GAMIN」），設計師要改成真正的特色標。
- 驗證：真引擎 headless 讀現況草稿＝大卡膠囊「ViewSonic 優派 VX2」、大卡 NT$8,999、小卡 NT$3,999／NT$2,490、小卡標籤＝入口標籤欄；零 console error。部署 activity-share-site `6fad74a6`。

