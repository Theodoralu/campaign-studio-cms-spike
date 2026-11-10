# snapshot 差異報告

- 舊：`test/fixtures/runs/2026-10-27-wb-085823/snapshot.replay.json`（36 件，source activity，fetchedAt 2026-10-27T00:58:24.018Z）
- 新：`/tmp/u1035/snapshot.json`（120 件，source uther:v3/products，fetchedAt 2026-11-09T07:00:00.000Z）

## 商品集合
| | 數 | gdid |
|---|---|---|
| 兩邊都有 | 4 | |
| 只在舊 | 32 | 5887371, 5980031, 5980032, 6628023, 6628028, 6628072, 6643639, 6643647, 6643648, 6679744, 8276905, 10331579, 11031571, 11702823, 11812810, 11812818, 11812924, 11812931, 11812932, 11812997… |
| 只在新 | 116 | 5942436, 6329559, 6329560, 6424377, 6424378, 6424380, 6424381, 6424382, 6424384, 6424385, 6424386, 6424387, 6424388, 6670115, 6718935, 6718940, 6718942, 6718944, 6740147, 6740148… |

## 兩邊都有的商品：逐欄不同
| 欄 | 不同件數／4 |
|---|---|
| name | 0 |
| price | 0 |
| marketPrice | 0 |
| disc | 0 |
| url | 4 |
| imgs[0] | 4 |

<details><summary>逐件（4 列）</summary>

| gdid | 欄 | 舊 | 新 |
|---|---|---|---|
| 6670109 | url | https://tw.buy.yahoo.com/gdsale/gdsale.asp?gdid=6670109 | https://tw.buy.yahoo.com/gdsale/麥香-紅茶-300mlx6入--6670109.html |
| 6679743 | url | https://tw.buy.yahoo.com/gdsale/gdsale.asp?gdid=6679743 | https://tw.buy.yahoo.com/gdsale/麥香-奶茶-300mlx6入--6679743.html |
| 12011320 | url | https://tw.buy.yahoo.com/gdsale/gdsale.asp?gdid=12011320 | https://tw.buy.yahoo.com/gdsale/麥香-綠茶-300mlx24入-12011320.htm |
| 12202304 | url | https://tw.buy.yahoo.com/gdsale/gdsale.asp?gdid=12202304 | https://tw.buy.yahoo.com/gdsale/統一-麥香奶茶-300mlx24入-箱-12202304 |

</details>

## 活動
| | 舊 | 新 |
|---|---|---|
| activities | 789017, 796420 | 784492, 795645, 803102 |
| promotions | 2 | 3 |

## 根欄位
| 欄 | 舊 | 新 |
|---|---|---|
| brand | — | 統一企業  品牌旗艦店 |
| minDisc | — | — |
| hits | 0 | 0 |
| warnings | 2 | 0 |
| 新增欄（新才有） | | discountWording, stockStatus, flags, actIds, sellerId, salesVolume, ratingCount, globalRating, bestseller7d |
