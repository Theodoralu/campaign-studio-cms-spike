# 兩層真值交叉驗證（2026-11-11T02:07:17.358Z）

- 來源：`snapshot.uther.json`（https://tw.buy.yahoo.com/?sub=1035），抽前 20 件
- uther 層 681 ms（1 次請求）；商品頁層 5836 ms（20 件逐抓）

| gdid | 狀態 uther／頁 | 價 uther／頁 | 劃線 uther／頁 | 一致 |
|---|---|---|---|---|
| 6424386 | online／online | 91／91 | uther 無／105 | ✔ |
| 11907576 | online／online | 399／399 | uther 無／540 | ✔ |
| 8993309 | offline／online（OUT_OF_STOCK） | —／139 | —／159 | ✖ |
| 8273203 | online／online | 79／79 | uther 無／89 | ✔ |
| 11930381 | online／online | 155／155 | uther 無／199 | ✔ |
| 6718940 | online／online | 139／139 | uther 無／159 | ✔ |
| 11951127 | online／online | 388／388 | uther 無／477 | ✔ |
| 11767278 | online／online | 65／65 | uther 無／75 | ✔ |
| 12063093 | online／online | 559／559 | uther 無／720 | ✔ |
| 11907579 | online／online | 199／199 | uther 無／432 | ✔ |
| 11949574 | online／online | 758／758 | 798／798 | ✔ |
| 11951344 | online／online | 229／229 | uther 無／285 | ✔ |
| 11815935 | online／online | 139／139 | uther 無／159 | ✔ |
| 11806877 | online／online | 699／699 | uther 無／1200 | ✔ |
| 6424388 | online／online | 78／78 | uther 無／90 | ✔ |
| 11897781 | online／online | 559／559 | uther 無／720 | ✔ |
| 11808788 | online／online | 299／299 | uther 無／338 | ✔ |
| 11656389 | online／online | 53／53 | uther 無／64 | ✔ |
| 11808851 | online／online | 1111／999 | uther 無／1680 | ✖ |
| 11907577 | online／online | 199／199 | uther 無／280 | ✔ |

**一致 18／不一致 2／頁面驗不到 0**（比實付價與狀態；劃線價只在 uther 有活動價時比——uther 沒有廠商市價欄，劃線價真值只有商品頁）
