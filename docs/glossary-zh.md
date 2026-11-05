# 欄位中文對照表（五個 run 檔）

對應 `pipeline/schemas/*.schema.json`（D3，2026-11-05）。標記：「真值」＝伺服器決定、畫面改了也不採；「可編修」＝業務可改；「可調」＝可調設定；「推導」＝系統算出來的。
只列會讀到、會改到的欄位；`page.colors.themeDraft.*` 之類的設計細節請直接看 schema。

## 共通名詞
| 中文 | 參數 | 說明 |
|---|---|---|
| 活動頁、一檔活動 | run / `page` | 一個 `runs/<id>/` 資料夾＝一檔活動頁 |
| 商品編號 | `gdid` | Yahoo 購物商品 id＝uther `productId` |
| 活動編號 | `actid` | 購物中心活動賣場 id＝uther `productActData[].id` |
| 來源網址 | `sourceUrl` / `input.url` | 業務貼進來的活動賣場／店家／搜尋／品牌頁 |
| 版式貨號、版型 | `kvVariant` | `layout-001~012`；主視覺＋整頁版型，登記在 modules.json |
| 主視覺 | KV / `page.kv` | 頁首大圖區（key visual） |
| 樓層、精選層 | `page.floors[]` | KV 下面的精選商品區，1～3 層，位置 `featured-N` |
| 品類牆 | `page.walls[]` | 依分類分區的商品牆，1～3 面，位置 `category-N`（舊 `wall-N`） |
| 促銷格 | `promoEntries` / `promoSourceMode` | 促銷活動入口格，3～12 格 |
| 編輯推薦、圓卡 | `page.editorial.circles[]` | 最多 2 張圓形推薦卡 |
| 探索區 | `page.explore.items[]` | 「看更多」導流格，最多 2 個 |
| 實付價 | `price` | uther `currentPrice ?? marketPrice` |
| 劃線價、市價 | `marketPrice` | 有 currentPrice 時的 uther marketPrice（契約範例寫 listPrice） |
| 折數 | `disc` | 爬頁算的；uther 改用 `discountWording` |
| 內容指紋 | `fingerprint` | draft 鍵排序後 sha256；存檔時比對，不同＝409 請重新整理 |

## draft.json —— 設計稿（人改的部分）
### page：頁面層
| 中文 | 參數 | 權限 / 值域 |
|---|---|---|
| run 編號 | `page.id` | 建立時產生，不變 |
| 管理名、活動名稱 | `page.pageName` | （契約寫 name） |
| 狀態 | `page.status` | 草稿｜調修中｜待建置｜已建置 |
| 版型模板 | `page.template` | MVP-v1 |
| 輸入等級 | `page.inputTier` | 真值（推導）T1｜T2｜T3 |
| 策展目標 | `page.curationGoal` | 可編修 |
| 策展主題 | `page.curationTheme` | 可編修 |
| 主題色設定 | `page.theme` | 可調：hueFamily 色相、colorTheme 配色、surfaceMode light/dark、kvTitleStyle 標題字風、moduleBorderStyle 模組框線、labelStyle 標籤樣式 |
| 版式貨號 | `page.kvVariant` | 選填；`layout-NNN`／new／legacy |
| 背景貨號 | `page.backgroundId` | 版式＝layout-* 時生效；授權不過＝CP-27 |
| 標題字風／副標字體 | `page.titleStyle` / `page.subtitleFont` | 同上 |
| 主視覺人物／商品配置 | `page.hero` | product-left／title-center／product-right 各放 gdids |
| 行動按鈕文字 | `page.ctaText` | 可編修 |
| 精選區標籤 | `page.dockFeaturedLabel` | 可編修 |
| 促銷區標籤 | `page.dockPromoLabel` | 可編修 |
| 促銷模組標題 | `page.promoModuleTitle` | 可編修 |
| 促銷來源模式 | `page.promoSourceMode` | auto｜promo-activity｜brand-recommend｜product-fallback｜manual |
| 頁尾標題 | `page.footerTitle` | 可編修 |
| 注意事項文字 | `page.noticeText` | 可編修 |
| 更新策略 | `page.refreshPolicy` | products／theme 各自要不要重抓 |
| ~~品類牆數量~~ | ~~`page.categoryWallCount`~~ | 已廢，由 `walls.length` 推 |

### page.kv：主視覺
| 中文 | 參數 | 權限 |
|---|---|---|
| 眉標（英）／眉標（中） | `eyebrow` / `eyebrowZh` | 可編修 |
| 手機版中文眉標 | `eyebrowCnMobile` | |
| 標題第一行／第二行 | `titleLine1` / `titleLine2` | 可編修 |
| 標題來源 | `titleSource` | promo-truth（活動真值）｜ai-curated（AI 擬） |
| 顯示後綴／標題翻轉／跑馬燈 | `showSuffix` / `titleFlip` / `showMarquee` | 開關 |
| 活動編號 | `actid` | 真值 空＝無活動 |
| 檔期 | `dateValue` | 真值 空＝整行隱藏，不得捏造（CP-02） |
| KV 圖片 | `images[]` | |
| KV 主打商品 | `keyProductGdids[]` | |

### page.floors[]：樓層
| 中文 | 參數 |
|---|---|
| 位置 | `pos`（`featured-1~3`） |
| 樓層標題／副標 | `title` / `subtitle`；`titleSource` 同 KV |
| 情境文案 | `sceneCopy.{tag,title,sub}` |
| 商品清單 | `productGdids[]`（3～15 件；契約寫 productRefs） |
| 情境圖 | `sceneImg` |
| 代表品商品頁 | `sceneUrl` 真值 全頁唯一 |
| 看更多 | `moreLink.{enabled on/off, url}` |

### page.walls[]：品類牆
| 中文 | 參數 |
|---|---|
| 位置 | `pos`（`category-1~3`，舊 `wall-N`） |
| 牆標題 | `title`、`titleSource` |
| 商品清單 | `productGdids[]`（4～12 件；4/8/12 最整齊） |
| 看更多 | `moreLink` |
| 每牆件數宣告 | `wallProductCount` |

### page.editorial／page.explore
| 中文 | 參數 |
|---|---|
| 編輯推薦標題三行 | `editorial.title[]`（契約寫 {line1,line2,tagline}） |
| 圓卡：標籤／文案／日期／圖／連結 | `circles[].{tag, copy, date, img, url真值}` |
| 探索區看更多網址／按鈕字 | `explore.moreUrl` / `explore.ctaText` |
| 探索格：標籤／副文／圖／連結 | `explore.items[].{label, sub, img, url真值}` |

### products[]：商品主檔（一品一列，模組用 gdid 引用）
| 中文 | 參數 | 權限 |
|---|---|---|
| 商品編號 | `gdid` | 真值 |
| 擺放位置／順序 | `position` / `order` | 位置如 `featured-1`、`category-2`、`kv` |
| 品名 | `name` | 真值 |
| 實付價 | `price` | 真值 |
| 劃線價 | `marketPrice` | 真值 |
| 商品頁網址 | `url` | 真值 |
| 商品圖／情境圖／可選圖 | `img` / `sceneImg` / `imgOptions[]` | |
| 優惠字串 | `offer` | |
| 標籤／標籤來源／原始標籤 | `tag` / `tagSource` / `tagOriginal` | tagSource offer｜feature｜manual；可編修（僅 manual 時） |
| KV 短品名 | `kvShortName` | 可編修（僅 manual 時） |

### meta：系統註記（不進渲染）
| 中文 | 參數 |
|---|---|
| 產生者／引擎／情境／主題 | `generatedBy` / `engine` / `scenario` / `theme` |
| 來源網址／產生時間 | `sourceUrl` / `generatedAt` |
| 版式決定紀錄 | `layoutChoice.{by, reason, useWhen, substitutedFrom, decidedAt}` |
| brief 檔與套用紀錄 | `brief.{file, version, appliedAt, applied[], provenance, fit}`；`briefSelection` 關鍵字納排統計 |
| 人工素材節點 | `assets`（整區可缺＝走 fallback） |

## snapshot.json —— 進貨單（抓回來的原料，不可改）
| 中文 | 參數 |
|---|---|
| 來源網址／抓取時間 | `sourceUrl` / `fetchedAt` |
| 品牌 | `brand` |
| 促銷活動清單 | `promotions[].{actid, title, short, startTs, endTs, period, url, banner}` |
| 活動明細（以 actid 為鍵） | `activities[actid].{title, period, startTs, endTs, pageStartTs, pageEndTs, liveness 在檔狀態, archived 已歸檔, count, meta.resultsTotal}` |
| 商品清單 | `products[]`：`gdid`真值 `name`真值 `price`真值 `currentPrice` `promotionPrice` `marketPrice`真值 `vendorMarketPrice` 廠商市價 `disc` 折數 `url`真值 `imgs[]`真值 `desc[]` 描述 `offer` `source` 來源標記 `actid`真值 |
| 分類命中 | `hits[].{cat 大類, subcat 子類, name, url}` |
| 子分類分布／最低折數 | `subcatDist` / `minDisc` |
| 警告 | `warnings[]` |

## wb_meta.json —— 工單封面
| 中文 | 參數 |
|---|---|
| run 編號 | `id` |
| 流程狀態 | `stage`：fetching 抓取中｜curating 策展中｜gating 檢查中｜ready 可編修｜running｜build 建置中｜done｜error |
| 表單輸入 | `input.{url, scenario 情境, theme, ownerEmail 負責人, ownerDept 部門, engine, themeColor, themeMode, kvVariant, briefFile, proposalPack, packDeviated 偏離提案包, layoutChoice}` |
| 引擎／實際用的引擎 | `engine` / `engineUsed` |
| 建立／更新時間 | `createdAt` / `updatedAt` |
| 價格真值複核 | `priceTruth.{stage, startedAt, finishedAt, total, applied 已套用, unverified 未驗, offline, mode}` |
| 系統寫 draft 時間 | `sysDraftWriteAt` |
| 重做紀錄 | `redo.{startedAt, backup, briefFile, doneAt}` |
| 核可紀錄 | `approved.{at, by, approvedFingerprint}`；null＝未核可或核可失效 |
| 內容指紋 | `fingerprint` |

## gate_report.json —— 驗收報告
| 中文 | 參數 |
|---|---|
| 檢查時間 | `checkedAt` |
| 檢查對象雜湊 | `draftSha256` / `snapshotSha256` |
| 總結果 | `result`：PASS｜WARN｜FAIL |
| 登記簿來源／版本 | `registrySource` / `registries.{sha, files.{modules, layouts, backgrounds, pendingBackgrounds, fonts, motion, tokens, typestyles}}` |
| 各級數量 | `counts.{FAIL, WARN, INFO}` |
| 檢查項 | `findings[].{level, code CP-xx, msg}` |
| 逐列結果 | `rowResults[]` |

## product_check.json —— 出貨前點貨
| 中文 | 參數 |
|---|---|
| 檢查時間 | `checkedAt` |
| 商品狀態統計 | `summary.{online 在售, drift 價格變動, offline 下架, dead 連結死, unverified 未驗, snapMissing 快照缺, stashed 暫存}` |
| 逐品結果 | `results[].{gdid, name, where 在哪個模組, draftPrice 草稿價, livePrice 線上價, liveMarketPrice 線上劃線價, drift／marketDrift 價差, snapPrice 快照價, snapDrift, status}` |
| 證據 | `results[].evidence.{fetchUrl, httpStatus, pageTitle, hasProductEntity 頁面有商品實體, attempts[] 重試紀錄, fetchedAt}` |
| 連結檢查 | `links[].{module, where, label, url, img, kind, status online｜expired 活動過期｜empty｜dead｜unverified, imgStatus}` |
| 連結統計 | `linksSummary.{online, expired, empty, dead, unverified, imgDead}` |
