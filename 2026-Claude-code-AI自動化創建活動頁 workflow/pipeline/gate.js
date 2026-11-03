/**
 * ④ 機器閘 v2：策展初稿 draft.json vs 來源快照 snapshot.json（封閉世界原則）
 * 用法：node gate.js <snapshot.json> <draft.json>
 * 輸出：gate_report.json（含 draft/snapshot 指紋，供 write_xlsx 綁定防過期報告）；有 FAIL 時 exit 1
 *
 * v2 修補（2026-07-17 對抗性審查 28 項確認缺陷）：
 *   CP-02 真值：所有 AI 可寫文案欄（眉標/標題兩行/CTA/樓層牆標題副標/入口 chip 文案/標籤）之
 *     折數與元價宣稱一律驗真值；標籤 offer=逐字出自該活動優惠、feature=原文在特色＋改寫字序子序列；
 *     KV 折數＋檔期綁同一 actid（禁跨活動拼裝）；入口標題/連結逐字比對；主打 gdid 存在性；
 *     全形數字正規化；邊界比對（97折 不再誤證 7折）；十位縮寫僅允許整十折數（50→5折）；重複 gdid 阻擋
 *   CP-01 字型缺字：KV 顯示字 vs Mochiy Pop One 碼點快照（缺字＝WARN 降級 Noto Sans TC，依登記表）
 *   CP-03 寬度：標籤 102px@14px、KV 縮寫名 188px@12px（近似模型：全形1em/半形0.55em）
 *   CP-04 網域＋圖片 HTTP 200（GATE_SKIP_HTTP=1 可跳過網路檢查，供離線測試）
 *
 * N-16（2026-07-19）：可前端化規則常數抽頂＋module.exports.RULES（export_rules.js 產 rules.json）；
 *   規則值零變化（負向測試 17/17 parity＝v2 基線 17 規則＋鈦案重跑 PASS FAIL0/WARN1 驗證）。
 *
 * v3 擴充（2026-07-20 使用者七點裁決 U1–U5；規則數 17 → 22）：
 *   CP-06 同模組入口重複——U1（2026-07-20）：「同一模組內不得出現同一活動 actid/同一 URL＝Blocking
 *     （0 容忍，Q3 定案：warning 級距取消）」；跨模組引用（editorial.circles refEntry）屬設計語意、允許保留
 *   CP-07 入口過期——U3（2026-07-20）：「活動過期＝內容失效，須更新為在線活動」；結束時刻（snapshot promo.endTs，
 *     無 endTs → dateValue 尾日 23:59 台北容差＋WARN 標註來源不精確）早於建置時刻（執行當下）＝FAIL，訊息載明到期時間
 *   CP-08 入口圖確定性——U2（2026-07-20）：「活動入口圖預設＝該活動 URL 商品池第一件商品的第一張商品圖
 *     （imageSet[0][0]）；活動 banner 降為人工覆寫級（assets.moduleImages.promoEntryN 通道）」；覆寫命中＝放行記 INFO
 *   CP-09 商品型入口——U5（2026-07-20）：「連商品頁（僅限單品詞，chip/文案禁優惠與檔期詞彙）、圖＝該商品第一張
 *     商品圖、無檔期列（dateValue 空＝隱藏）」；gdsale url 分流、不查 promoOf(actid)
 *   R2 混填排序——U5（2026-07-20）：「真活動保留排前（帶檔期列）」；活動型入口排在商品型之後＝WARN
 *
 * v4 擴充（2026-07-20 使用者裁決 U8⑧；規則數 22 → 23，R2 升級）：
 *   CP-10 E0 一致性——U8（2026-07-20）：「本期活動」來源三層優先序＝1.優惠活動（ec_promotions/onsale）→
 *     2.品牌商品推薦（品牌頁 hotSales/hits）→3.商品替補（商品池主題關鍵商品）；draft page.promoSourceMode
 *     （缺值視為 auto）：強制單一模式（promo-activity|brand-recommend|product-fallback）＝全部入口同型否則 FAIL；
 *     brand-recommend 型入口需可溯源品牌頁推薦清單（快照有 hotSales/hits 時比對 gdid＝不符 FAIL，無則 WARN 記不可溯源）
 *   R2 升級——auto 模式入口排序由「活動型在前」二層 WARN 升級為三層順序：activity→brand-recommend→product 型
 *     （U8 細化 U5 混填制：補位順序先取第 2 層品牌推薦商品、再取第 3 層商品替補）
 *
 * v5 擴充（2026-07-20 使用者裁決 U10–U15（⑩–⑮）；規則數 23 → 28）：
 *   CP-06 擴充——U11⑪：跨模組去重範圍擴及「編輯精選 × 本期活動」——editorial.circles（等價欄位）之 actid/url
 *     與 promoEntries 現用項重複＝FAIL；重複時依內容讀取順序（U8 三層優先序）取「本期活動未使用」的下一批項目，
 *     且須符合 AI 策展主題模組（本點推翻同日稍早 U1「跨模組 refEntry 引用屬設計語意、允許保留」的範圍限定）
 *   CP-11 KV 圖源——U10⑩：KV 主視覺三商品圖一律抓「購物中心商品頁的商品圖第二張」＝各主打商品
 *     （keyProductGdids）商品池 imgs[1]（imageSet[1][0]，與 02 §10 商品卡第二張白底語意對齊）；
 *     池僅 1 張圖＝容 imgs[0]＋WARN；人工主題素材覆寫級（如 LC Theme-img，assets.moduleImages.kvImageN）＝放行記 INFO
 *   CP-12 樓層 URL 唯一——U12⑫：策展要把握每一個主題流量——floors[].sceneCard.url 同模組重複＝FAIL
 *     （鈦案「鈦划算／鈦好喝」兩樓層同連一 URL＝違例）；與 promoEntries/editorial 跨模組重複＝WARN
 *   CP-13 文案工程字串——U13⑬：✍️ 文案欄命中 search p=／[?&]p=／actid=／http(s)://＝FAIL
 *     （延伸探索分流邏輯保留，但文案不得出現「search p=鈦鍋」等工程字串——改用使用者能理解的語言）
 *   CP-14 主題契合閘——U14⑭：出現在來源頁活動列表≠主題契合——活動型入口之 actid 商品池品名對 curationTheme
 *     主題關鍵詞命中率＜門檻＝FAIL（不契合一律不入選；鈦案 772695 nile 戶外＝選錯品類錯誤示範、立即撤換；
 *     契合活動不足額→依 U8 三層混填）；快照無該活動商品池＝WARN 不可溯源；主題詞＋門檻抽頂常數
 *     （預設鈦案關鍵詞組＋30% 門檻，待 curationTheme 詞庫欄位化後改資料驅動；策展 agent 校準值
 *     feedback_patch.json themeFitRule 讀得到就以它為準——GATE_THEME_FIT_PATCH env／session scratchpad 通道）
 *   U15⑮ 品牌維度編輯精選：brandIds 篩選 URL（/search/product?brandIds=<品牌ID>&p=<主題詞>）納入連結
 *     白名單合法形態（品牌導流；圓形圖＝該篩選 URL 商品列表首件代表品之商品圖第二張——選品側規則，
 *     閘門側以白名單形態＋CP-06 跨模組去重把關）
 *
 * v6 擴充（2026-07-20 使用者裁決⑰ U17；規則數 28 → 29）：
 *   CP-15 入口數量——U17⑰（2026-07-20）：「本期活動」內容數量＝至多 4 則、不得少於 3 則——promoEntries
 *     有效項（具 url/actid）<3 或 >4＝FAIL；<3 訊息載明遞補義務（依 U8 三層優先序：1.優惠活動→
 *     2.品牌商品推薦→3.商品替補 遞補後仍不足才成立）；恰 3 則＝INFO 記 3 則版型（保持內容間距不變、
 *     圓形圖與標題模組背景寬度等比放大、活動標題字級不變——渲染側 09 §2.10；mobile 2×2 流式 2+1
 *     尺寸不變＝預設、09 §4.2 G-C10 開放項）；promoEntries 欄位缺席＝第 3 層整模組隱藏語意（04 §7）、
 *     略過不誤殺（沿 editorial 模組缺席慣例）
 *
 * v7 擴充（2026-07-20 使用者裁決⑱ U18；規則數 29 → 30）：
 *   CP-16 品類牆數量——U18⑱（2026-07-20）：「編輯精選」下方以分類為切入點的模組（品類牆 CategoryGroup/
 *     categorySections）目前 2 組 → 更新為預設 3 組；Google Sheets 可選擇出現模組的數量；活動頁預設
 *     牆數值域 CATEGORY_WALL_COUNT（2026-08-27 升版 1~3；原 3~5）——draft walls[] 數量超界＝FAIL（訊息載明
 *     U18 預設 3）；categoryWallCount 宣告值與實有牆數不一致＝FAIL；欄位缺席＝略過不誤殺（INFO，
 *     沿 CP-15 慣例）；牆標題同名（與樓層/其他牆）＝WARN（dock 錨點撞名——dock 錨點隨牆數 6→7
 *     於預設 3 牆時，dock 已有橫滑 rail 機制）；連動（閘門外）：Schema P1 BE/BF（牆4/5 標題，
 *     樓層編號連續制）擴至牆6~8＋新增數量選擇欄、P2 模組位置枚舉 wall-1/wall-2 擴至 wall-5、
 *     14 號契約 walls[]「恰 2」改 3~5
 *
 * v8 擴充（2026-07-20 使用者裁決⑲ U19；規則數 30 → 32：R2 移除、CP-17 新設 2 項、CP-10 連動 1 項）：
 *   U19⑲＝選品邏輯不得混用（單一來源制）——使用者真實視角發現「本期活動：特價229元起・夜殺9折起」標題
 *     喊優惠、第 4 格卻是商品推薦（North Field 純鈦炊具餐盤）＝標題與模組商品相關性連結不起來；
 *     修訂今日 U5 混填制／U8 auto 混填語意／U17 補位語意：
 *   CP-17 型別同質——promoEntries 內活動型與商品型（含品牌推薦型）混用＝FAIL（取代原 R2 混填排序 WARN）；
 *     純活動或純商品＝PASS；降層義務：同一層可湊滿 ≥3 則（U17 下限）才採用該層——在線契合活動 <3 →
 *     整組降到第 2 層品牌商品推薦、仍 <3 → 整組第 3 層商品替補，不跨層補位
 *   CP-17 標題同型（輕量，U19+U16 連動）——entries 全商品型而 promoModuleTitle 含「本期活動」前綴或
 *     優惠數字詞＝FAIL（純活動＝promo-truth 優惠真值標題；純商品/品牌推薦＝ai-curated 策展命名、
 *     「本期活動」四字消失）；欄位缺席＝略過
 *   CP-10 連動——E0 promoSourceMode auto 語意改為「取可滿足 ≥3 則的最高優先層」：auto 下 entries 全商品型
 *     且快照顯示在線契合活動 ≥3（可判定時）＝WARN 應採更高優先層；不可判定＝略過；強制單一模式語意不變
 *   U17 連動——3 則等比版型＝單一來源制的自然配套（該層恰 3 則時用 3 則版型，不用湊第 4 格）
 *
 * v9 擴充（2026-07-21 落地 2026-07-20 使用者裁決㉒㉓㉗㉘；規則數 32 → 40：CP-18 ×1、CP-20 ×3、CP-21 ×2、CP-22 ×2）：
 *   CP-18 全頁互斥（U22㉒）——推薦模組內容全頁互斥（U1 同模組→U11 編輯精選×入口→U22 全頁 第三次擴圈）：
 *     同一識別子（gdid／actid／正規化 URL）曝光於兩個不同模組＝FAIL。曝光邊界＝KV 主打商品（keyProductGdids）
 *     ／本期活動入口／樓層 scene 卡＋前 3 商品卡（曝光位）／品類牆全卡；排除＝editorial-wall（編輯精選商品牆
 *     ＝設計語意、U20/U22 邊界明文排除、第四次擴圈候補）／moreLink（U28 另由 CP-22 管）；讓位序（修正指引）＝
 *     KV ＞ 入口 ＞ 樓層 ＞ 牆（牆＝補抓設計）
 *   CP-20 模組主從一致（U23㉓）——模組主題（主）與商品資料/連結/文案（從）須符合主題邏輯：
 *     (a) BaseHit【Blocking】模組內每一曝光商品名（正規化後）須命中 ≥1 資料集基底詞（curationTheme 分詞＋
 *         人工同義表 CP20_BASE_SYNONYMS；「划算」等優惠語境不豁免基底）；詞庫不可推導＝INFO 略過
 *     (b) SubHit【WARN】商品名未命中模組子類詞（tokenize(模組 title＋情境卡文案)－停用詞 ∩ 品類名詞詞典）＝
 *         弱契合列人工 QA（詞庫空＝略過）
 *     (c) CopyOK【Blocking】模組標題修飾語宣稱（CP20_MODIFIER_CONFLICTS：純X…）被 >50% 曝光商品名之
 *         衝突形（合金/塗層/鍍/複合…）反證＝FAIL（U23 V3「純鈦鍋具」型）；標題品類名詞 0/N 命中＝WARN（W8 型）
 *     (d) DestOK【Blocking】連結標籤型別＝目的地型別：標籤/副標稱「分類/分館」→ 目的地必須為 category URL
 *         （U23 V5 型）；activity 型沿 CP-14 雙訊號（既有規則）；search 型 query 詞 ∩ 模組詞庫＝∅ → WARN
 *   CP-21 品類牆件數（U27㉗；2026-10-05 使用者裁「照樓層模式」降級）——每牆有效商品數 ∉ {4,8,12}＝WARN 湊滿提醒
 *     （一行四品陣列；原 FAIL 使「補一件」永遠違規＝規範與功能衝突）；宣告欄 walls[].wallProductCount（等價 Sheets
 *     牆N商品數）≠實數＝FAIL 不變；欄位缺席＝略過不誤殺（沿 CP-15/16 慣例）
 *   CP-22 看更多目的地（U28㉘/U28b）——floors[]/walls[].moreLink={enabled,url}：
 *     唯一性【Blocking】enabled=on 之 url 以 normalizeUrl 比對——①＝自身 scene 卡 url（U28b①）②與同集其他
 *     moreLink 重複 ③與 scene 卡/promoEntries/編輯精選/探索/全域 moreUrl 任一重複＝FAIL；與 KV 三圓/商品卡
 *     URL 重複＝WARN；enabled=off＝合法（該位置不渲染、url 可留值備用）；欄位缺席＝INFO 退全域 moreUrl 舊行為
 *     主題切合【WARN/FAIL】目的地分型（search/brandIds/category/brand/activity/product）——search 型：query 詞
 *     ∩ 模組詞庫 ≠ ∅ 且 GET totalhitcount>0 非 backfill＝PASS、詞交集空＝WARN、GET 無結果/4xx＝FAIL、
 *     5xx 重試後仍失敗＝WARN 不可驗列人工複跑（U23 GET 履歷：search 端點間歇 500；驗證出壞目的地才 FAIL）
 *     （GATE_SKIP_HTTP=1 → INFO 未驗）；brand 型＝最後手段 INFO＋主題詞不可驗 WARN；策展優先序＝
 *     p=詞 ＞ brandIds ＞ 品類/分類頁 ＞ 品牌頁（04 §6）
 *
 * v10（2026-07-22 使用者裁決）：TAG_SOURCES 增 manual——工作台人工調修標籤身份（04/03 G6 ✍️ 權限介面化）：
 *   來源溯查豁免（feature 子序列/offer 逐字之外的合法人工身份）＋CP-02 INFO 記錄；真值紅線照檢
 *   （折數/元價 checkCopyTruth＋CP-03 寬度＋市價比禁折標）；標籤 v5→v6（03 §G6／14 §2.10）
 * v11（2026-07-23 收斂會裁決；規則數 40 → 41）：CP-18 擴充——同一樓層 scene 卡（代表品）與商品卡不得
 *   同商品＝FAIL：模組層聚合把「同樓層 scene vs 卡」視為同模組放行＝盲區（07-22 AI 稿三樓層卡 1 全與
 *   情境卡同品同圖實證；demo 資料邏輯＝情境卡代表品不入卡列，含備位）；維度沿 idOfUrl（gdid＞URL）
 * v12（2026-07-23 使用者指示＝14 §8 待審②③定案；規則數 41 → 45）：editorial／explore 入契約後的檢查補課——
 *   ①探索卡 items 文案 CP-13 工程字串＋CP-02 折數/元價真值＋CP-04 網域＋同模組 URL 唯一（CP-12 語意）＋缺 URL WARN
 *   ②editorial.title 三行＋explore.ctaText＝CP-13＋CP-02 照掃 ③編輯精選圓文案補 CP-02 真值（原僅 CP-13）
 *   ④編輯精選牆件數＝U27 4 的倍數等價（position=editorial-wall 列；真值/池存在性＝products[] 迴圈既有覆蓋）
 *   另修二處作用域：CP-18 排除清單宣告落地（walls claim 過濾 PAGE_DEDUP_EXCLUDED_POSITIONS）＋circles actid-only 逃逸
 * v13（2026-07-23 使用者裁決＝本期活動人工手動入稿通道）：promoEntries 增 entrySource="manual" 則級身份＋
 *   promoSourceMode 增 "manual" 模組級模式——manual 則＝資料正確性交使用者確認（沿 tagSource=manual 前例擴大）：
 *   豁免＝逐字真值（chip/copy/標題/檔期）/CP-08 圖源/CP-07 過期/CP-14 契合/CP-10 溯源；照檢＝CP-04 網域硬邊界
 *   （2026-07-23 裁決：手動仍限 tw.buy.yahoo.com）＋CP-13 工程字串＋寬度（UI 層）；降級＝CP-06 同模組重複、
 *   CP-18 全頁互斥 FAIL→WARN（提示不阻擋＝使用者評斷）；CP-17 混型＝manual 則不計入同質判定（允許混型＋INFO）、
 *   標題同型對 manual 模式降 WARN；CP-15 數量 3~4＝版型結構照檢
 * v14（2026-07-25 四題裁決 Q1/Q2＝CP-14 修訂，規則數不變）：①C 訊號實作＝活動標題含主題詞＝契合成立
 *   （B/C 併判、任一過即過——登記表既載正式版設計；07-24 相機案三入口標題均含「相機」＝C 可救型實證）
 *   ②全池零命中＝「比對不可施作」FAIL→WARN（抽象主題 2-gram 全滅家族；導向工作台主題詞組卡）
 *   ③池 <5 件＝小樣本降 WARN（1 件池實效門檻 100% 之倒置修正；模擬 12 run 僅翻轉 FAIL→WARN、零新放行）
 *   配套（工作台側）：詞組派生擴源＝curationTheme＋來源頁標題/搜尋詞（Q1-B1；U23 同源）＋空主題必寫校準檔
 * v15 擴充（2026-08-24 51 號 W1-E＝CP 登記表 v1.8 配號；規則數 46 → 51：CP-25 ×1、CP-26 ×1、CP-27 ×3）：
 *   CP-25 版式值域——page.kvVariant（經 normalizeKvVariant 收舊拼法）∉ modules.json hero variants 值域＝FAIL；
 *     值域一律 runtime 讀登記簿（lib/proposal_pack loadRegistries；GATE_REGISTRY_OVERRIDES env 可注入
 *     hermetic 測試複本——注入生效＝WARN 出聲＋report.registrySource 記注入來源，該報告不得作為出貨依據＝
 *     review F1）——登記簿讀不到而 draft 有版式欄＝FAIL 出聲不裝懂；欄位缺席＝舊 draft（51 §2.8
 *     legacy 態）略過不誤殺；rollout 旗標出聲：trial＝灰度試用 INFO（工作台徽章＝W1-C/D）、closed＝停接新案
 *     INFO（歷史頁照舊渲染出貨＝51 §3；「legacy 停新案開關」落點＝modules.json 該變體 rollout:"closed"，
 *     欄缺席＝開放）
 *   CP-26 佔位殘留——出貨 draft 任一字串欄命中「滿 $-- 折 $--」型佔位（正則涵蓋 $--／00.00–00.00 型）＝FAIL
 *     （51 §2.10 佔位永不出貨）；排除頂層 meta（14 §2.12 不進渲染）與 page.heroSlotStash（14 §2.13 不渲染
 *     不出貨）——僅契約正位路徑、深層同名鍵照掃（review F3）；
 *     編輯態不歸 gate 管＝gate 本來就只跑出貨鏈（部署/匯出前全檢）＝條文天然滿足
 *   CP-27 素材授權（kvVariant=layout-* 時）——出貨背景＝backgroundId（缺欄＝取版式 defaultBackground）：
 *     license C＝FAIL；B 級無複查紀錄（審核欄 qaStatus ∉ pass/pass-with-note）＝FAIL、conditional 不得任
 *     預設背景（明選＝黃燈 WARN）；B 級商用條款＝backgrounds manifest meta.termsVerification 欄缺席＝FAIL
 *     （2026-08-24 Higgsfield ToU §4.4 查證入簿 v0.5.1）；動畫（E7）＝motionFlag 容忍缺席、static 略過，
 *     sway/flip 綁定素材（page.motionId，W1-E 提案落點）license C＝FAIL、未綁素材＝WARN 出聲（第一波
 *     出貨動畫素材鏈未接＝當檔商品照現生另批）；灰度門票（51 §6）＝rollout:"trial" 版式出貨背景 license
 *     必為 A 或已複查 B（pass/pass-with-note），不符＝FAIL
 * v16（2026-08-26 使用者裁決＝本期活動內容入口上限放寬；規則數不變、規則值改）：
 *   CP-15 入口數量上限 4 → 12（PROMO_ENTRY_COUNT.max）——「本期活動模組可以開放給用戶最多可以增加到
 *     12 個內容入口」；下限 3 維持（U8 遞補／U19 降層義務不變）、恰 3 則＝等比放大版型 INFO 語意保留
 *     （渲染側 09 §2.10）；>3 則＝全裝置左右滑動列（渲染端互動另批，本批僅閘與面板）；
 *     CP 登記表 v1.10＋14 號 §2.4 升版註記＋rules.json v1.8.0 重匯＋一正一負 fixture（12 過／13 FAIL）
 * v17（2026-09-08 使用者裁決＝CP-27 素材授權閘納管字型／字風；CP-27 +2 項；CP 登記表 v1.17）：
 *   源起＝字型線同日盤點：CP-27 原只管背景與動畫，字風靠寫入端兩道門（lib/proposal_pack parseProposalPack／
 *   lib/hero_combo applyCombo 同吃 typestyleIds＝approved）守著，手改 draft.json 或事後退審的字風出貨前沒閘會發現。
 *   page.titleStyle（字風）＝字風登記簿 review.status=approved 才可出貨；查無／未審／已審但主字型缺戶口（fontId）
 *     或字體 license 非 A（B 級須 qaStatus ∈ BG_REVIEW_PASS＋reviewDate＝沿背景同套欄名；C＝FAIL）＝FAIL；
 *   page.subtitleFont.fontId（副標字體）＝字體簿在冊＋pickable:true＋license 判法同上；欄缺席＝版式原字略過；
 *   兩欄僅 kvVariant=layout-* 生效（14 §2.13 欄，legacy 頁不帶）；hermetic fixture＝test/fixtures/registries/typestyles.manifest.json
 * v18（2026-09-09 70 號 §6 QA 使用者裁＝新增 CP-31 內文模組完整性：三內文模組在場即必填——資訊卡每列門檻＋折抵/贈品、banner 至少圖或首行；
 *   主打選品主打商品＋大標題＋右欄 ≥1；促銷卡每張商品——缺＝FAIL 白話講哪一列；根因＝CP-26 只認樣板字、空節點佔位框可出貨；CP 登記表 v1.18；規則 +1）
 * v19（2026-09-25 使用者裁決＝曝光邊界牆三題 甲／甲／乙；規則數不變、CP-18／CP-20 曝光邊界改；CP 登記表 v1.31）：
 *   ①樓層每一張商品卡都算曝光（原 FLOOR_EXPOSED_COUNT=3 已刪；2026-08-26 樓層 3／7／11／15 件制後引擎、加商品、替換、
 *     編輯器四處早已全算，只有這道閘落單）；②CP-18 聚合把樓層每一層各自當一個模組（原「樓層 #N」一律剪成「樓層」＝
 *     跨樓層 scene×卡永遠不比；白蘭 174314 全綠病例）；③同一層兩張卡同商品＝刻意不加門（16 份草稿 0 條、加商品已擋；記待辦）。
 *   牆＝規劃/qa/gate-exposure-boundary-wall-2026-09-25.html；正反測試＝test/gate_exposure_boundary.test.js
 * v20（2026-09-26 使用者裁「乙」＝主視覺換品三道門一次修；規則數不變；CP 登記表 v1.32；病例＝run 2026-09-26-wb-150126）：
 *   ①CP-18 曝光邊界補登記新版主視覺槽（page.hero[*].gdids）——原本只認舊 KV 欄 keyProductGdids，layout-0NN 主視覺槽裡的商品零登記，
 *     同一件商品同時在主視覺右槽與樓層情境卡＝全綠（使用者肉眼抓到）；②CP-03 主視覺顯示名只驗「現在還在主視覺槽裡」的商品——
 *     離開主視覺後留在 products[] 的 heroName 殘值＝INFO 出聲不驗（原本繼續量寬度＝畫面上無處可改的永久紅燈，編輯器又把它指到
 *     情境卡那層＝鬼打牆）；③輸出防呆：草稿檔名不是 draft.json＝拒寫（原本 replace 沒命中就把報告覆寫回輸入檔——09-26 實踩，備份 draft.v33 被蓋）。
 *   正反測試＝test/gate_hero_slots.test.js；編輯器側三道門＝test/unit/hero_swap_three_doors.test.js
 */
const fs = require("fs");
const path = require("path");
const https = require("https");
require("./lib/net_tuning"); // 對外連線預算（唯一一份＝lib/net_tuning.js）：預設 250ms 太短會讓「人點得開、工具抓不到」
const crypto = require("crypto");
const ownBgLib = require("./lib/hero_bg_license"); /* 「你上傳的背景」（78 號 2026-09-27）：own 哨兵與三檔齊判定＝與寫入端同一支 */
const { sameProductUrl } = require("./workbench/content_checks.js"); /* 商品網址等價＝單一真源（2026-10-04 根治「連結與來源不符」死鎖：asp 式↔p- 式同一件商品；content_checks 零相依、可安全引入） */

/* ---------- 規則常數（單一來源）----------
 * 「可前端化」規則一律抽頂於此；export_rules.js 由此產 rules.json 供前端預檢載入。
 * regex 以來源字串（*_RE_SRC）保存，前端 new RegExp 還原；改規則只改這一段。
 */
const FULLWIDTH_DIGITS_RE_SRC = "[０-９]";            // 全形數字正規化（比對前先做）
const DISCOUNT_CLAIM_RE_SRC = "(\\d+)\\s*折";          // 文案折數宣稱（g，需驗真值）
const PRICE_CLAIM_RE_SRC = "([\\d,]+)\\s*元";          // 文案元價宣稱（g，需驗真值）
const DISCOUNT_BOUNDARY_TPL = "(^|\\D){n}\\s*折";      // 邊界比對模板（{n}=折數；97折 不得證 7折）
const PRICE_SEMANTIC_RE_SRC = "\\d\\s*折|優惠|特價";    // 起字鐵律：第二行需價格優惠語意
const DISCOUNT_CHAR_RE_SRC = "折";                     // 市價比異常時禁折數標籤
const KV_TITLE_DISCOUNT_RE_SRC = "\\d+\\s*折";         // KV 標題含折數 → 必須綁主軸 actid
const WIDTH_MODEL = { space: 0.3, halfwidth: 0.55, fullwidth: 1 }; // 近似寬度模型（em）
const TAG_BUDGET_PX = 102, TAG_FONT_PX = 14;           // CP-03 標籤寬度預算
const KVNAME_BUDGET_PX = 188, KVNAME_FONT_PX = 12;     // CP-03 KV 縮寫名寬度預算
const HERONAME_BUDGET_PX = 760, HERONAME_FONT_PX = 16; // CP-03 hero 商品顯示名預算（2026-08-30 使用者裁決：hero 商品標題開放編輯、呈現兩行）＝l011 白卡文字區 390px × 兩行，留 −20 安全邊
const IMG_DOMAINS = ["img.yec.tw", "s.yimg.com", "sp.yimg.com"]; // 2026-09-20 移除 git.ouryahoo.com：美國 GHE 9/19 停權，原「活動版型去背商品」圖床（2026-08-28 裁決）已無法取用；留著等於讓指向死站的圖過閘。新圖床待分享站新家（Q3 A 案）裁定後補回；存量稿的圖庫網址由 loadDraftJson／CMS fixLibUrlAll 轉相對路徑，不經此名單
const LINK_DOMAIN_RE_SRC = "(^|\\.)tw\\.(buy|promo)\\.yahoo\\.com$"; // 2026-10-05 使用者裁：促銷活動站 tw.promo.yahoo.com 納入連結白名單（例：聯名卡活動頁可當入口連結）；建置來源 URL 另有四門、不走這條
const TAG_SOURCES = ["offer", "feature", "manual"];    // G6 標籤來源枚舉；manual＝2026-07-22 使用者裁決（工作台人工調修標籤＝04 G6 ✍️ 權限的介面化）：來源溯查豁免、折數/元價驗真值與寬度照檢
const KV_KEY_PRODUCTS = 3;                             // KV 主打商品件數（D4-D6）
const ZONE_PRODUCT_RANGE = { floors: { label: "樓層", min: 3, max: 15 }, walls: { label: "品類牆", min: 4, max: 12 } }; // R1；floors max 9→15＝大體檢 CT-4 對齊 2026-08-26 使用者裁決（3/7/11/15 節奏、上限 15）——原 3~9 建議值與編修欄白話自打嘴巴
/* ---- 2026-07-20 U 裁決新增常數（U1①重複／U2②入口圖／U3③過期／U5⑤商品型入口）---- */
const GDSALE_PATH_RE_SRC = "^/gdsale/";               // U5 商品型入口判別（對 url pathname）
const GDSALE_ID_RE_SRC = "-(\\d+)\\.html?$";          // gdsale 商品頁 id 抽取（對 pathname 尾端；經池內 url 對映回 gdid）
const ENTRY_PROMO_BAN_RE_SRC =                        // U5 商品型入口 chip/copy 禁優惠詞（僅限單品詞）
  "\\d+\\s*折|[\\d,]+\\s*元|優惠|特價|滿\\s*\\d|買\\s*就\\s*送|加贈|贈品|贈點|折價|下殺|出清|回饋|免運";
const ENTRY_PERIOD_BAN_RE_SRC =                       // U5 商品型入口 chip/copy 禁檔期詞
  "檔期|限時|限定|快閃|夜殺|倒數|本檔|今日|最後\\s*一?\\s*天|\\d{1,2}\\s*[/.月]\\s*\\d{1,2}";
const PERIOD_TAIL_RE_SRC =                            // U3 dateValue 尾日抽取（短式尾日承用起始年份）
  "(\\d{4})\\.(\\d{1,2})\\.(\\d{1,2})\\s*~\\s*(?:(\\d{4})\\.)?(\\d{1,2})\\.(\\d{1,2})\\s*$";
const TAIPEI_UTC_OFFSET_MIN = 480;                    // U3 過期容差時區：台北 UTC+8（尾日 23:59 台北）
const ENTRY_IMG_OVERRIDE_PATH = "assets.moduleImages.promoEntryN"; // U2 人工覆寫通道（N＝入口序，1 起算）
/* ---- 2026-07-20 U8⑧ 新增常數（E0 本期活動來源模式 promoSourceMode）---- */
const PROMO_SOURCE_MODES = ["auto", "promo-activity", "brand-recommend", "product-fallback", "manual"]; // E0 枚舉（缺值視為 auto；manual＝2026-07-23 使用者裁決：人工手動入稿通道）
const ENTRY_TYPE_ORDER = ["promo-activity", "brand-recommend", "product-fallback"]; // U8 三層優先序：1.優惠活動→2.品牌商品推薦→3.商品替補
const BRAND_RECOMMEND_KEYS = ["hotSales", "hits"]; // 品牌頁推薦清單快照鍵（brand-recommend 溯源比對；掃 snap／snap.brand／snap.brandPage）
/* ---- 2026-07-20 U10–U15 裁決新增常數（⑩KV 圖源／⑪跨模組去重／⑫樓層 URL 唯一／⑬文案工程字串／⑭主題契合閘／⑮品牌維度）---- */
const KV_IMG_OVERRIDE_PATH = "assets.moduleImages.kvImageN"; // U10 KV 三圓圖人工主題素材覆寫通道（N＝1..3；如 LC Theme-img 覆寫級）
const EDITORIAL_CIRCLE_KEYS = ["circles", "items"];          // U11 編輯精選圓形項容器等價欄位（掃 page.editorial／draft.editorial）
const EDITORIAL_COPY_KEYS = ["label", "copy", "title", "sub", "name", "chip"]; // U13 編輯精選 ✍️ 文案欄掃描鍵
const ENGINEERING_COPY_RE_SRC = "search\\s*p=|[?&]p=|actid=|https?://"; // U13 文案工程字串（✍️ 文案欄命中＝FAIL；URL/query 參數不得直出）
const BRAND_FILTER_URL_RE_SRC = "^/search/product/?$";       // U15 品牌篩選 URL 合法形態（pathname；query 須含 brandIds）
const THEME_FIT_DEFAULT = {                                  // U14 主題契合閘預設＝鈦案回歸限定（2026-07-23 收斂會條文化：詞組已改資料驅動——工作台 stage2 依 curationTheme 機械派生、寫 run 級 feedback_patch.json、經 GATE_THEME_FIT_PATCH 帶入；非鈦活動必帶校準檔，見檢查點登記表 v1.6 CP-14）
  keywords: ["鈦", "純鈦", "鈦金屬", "鈦鍋", "鈦杯", "鈦碗", "鈦餐具", "鈦筷"], // 鈦案關鍵詞組（2026-07-20）
  threshold: 0.3,                                            // 商品池品名命中率門檻 30%
  source: "gate.js 抽頂預設（2026-07-20 鈦案關鍵詞組＋30% 門檻）",
};
const THEME_FIT_PATCH_PATHS = [                              // U14 校準通道：策展 agent feedback_patch.json themeFitRule 讀得到就以它為準
  process.env.GATE_THEME_FIT_PATCH,                          // 正式通道：環境變數指定校準檔
  "/private/tmp/claude-503/-Users-tofu-Documents-Codex-2026-06-15-------------W-Yu-ting--/3bb4a5bf-8481-45f8-abe5-f6993182a64f/scratchpad/curation-20260720/feedback_patch.json", // 2026-07-20 session 暫時通道
].filter(Boolean);
/* ---- 2026-07-20 U17⑰ 新增常數（CP-15 本期活動入口數量規則）---- */
const PROMO_ENTRY_COUNT = { min: 3, max: 12 }; // U17⑰ 原「至多 4 則、不得少於 3 則」；2026-08-26 使用者裁決＝上限 4→12（「本期活動模組可以開放給用戶最多可以增加到 12 個內容入口」）——下限 3 維持（<3 依 U8 三層優先序遞補後仍不足＝FAIL）；=3 版型等比放大語意保留（渲染側 09 §2.10）；>3 全裝置左右滑動列＝渲染端互動另批
/* ---- 2026-07-20 U18⑱ 新增常數（CP-16 品類牆數量規則）---- */
const CATEGORY_WALL_COUNT = { min: 1, max: 3, default: 3 }; // U18⑱ 原 3~5；2026-08-27 使用者裁決改 1~3（模組批「牆可刪」開放＝下限 1 至少留一面；上限對齊引擎 3 版位——原 4~5 面實際無版位渲染不出＝值域與現實對齊；CP 登記表 v1.11、14 §2.14 升版）
const WALL_CONTAINER_KEYS = ["walls", "categorySections"];  // 品類牆容器等價欄位（掃 page／draft 頂層；CategoryGroup 模組）
const WALL_COUNT_FIELDS = ["categoryWallCount", "wallCount"]; // 數量宣告欄等價欄位（Sheets 新增數量選擇欄；宣告≠實有＝FAIL）
/* ---- 2026-07-20 U19⑲ 新增常數（CP-17 選品單一來源制；R2 混填排序移除）---- */
const ENTRY_CATEGORY_OF = { "promo-activity": "activity", "brand-recommend": "product", "product-fallback": "product" }; // U19 型別二分：活動型 vs 商品型（含品牌推薦型）
const PROMO_TITLE_TRUTH_RE_SRC = "^\\s*本期活動|\\d+\\s*折|[\\d,]+\\s*元|特價|優惠"; // U19+U16 標題 promo-truth 訊號（「本期活動」前綴或優惠數字詞；對正規化文本）
const PROMO_LAYER_MIN = PROMO_ENTRY_COUNT.min; // U19 單一來源層採用門檻：該層可湊滿 ≥3 則（U17 下限）才採用
/* ---- 2026-07-21 v9 新增常數（U22㉒ CP-18 全頁互斥／U23㉓ CP-20 主從一致／U27㉗ CP-21 牆件數／U28㉘ CP-22 看更多）---- */
/* U27㉗ 品類牆件數鐵律——2026-09-24 起改讀模組登記簿（單一真源），本檔不再自己抄一份。
   搬家原因：原本只有這道閘認得它，CMS 介面不知道 ⇒「加入」不設限、業務加到第 13 件卻減不回去
   （品類牆刻意不開放移除＝受版型件數契約管）。現在閘與介面同讀一份，改一處兩邊一起變。 */
const { WALL_PRODUCT_COUNT_ENUM } = require("./lib/content_modules.js");
/* 樓層曝光位（2026-09-25 使用者裁決＝曝光邊界牆第 1 題甲）：每一張商品卡都算曝光。
   原本這裡是 FLOOR_EXPOSED_COUNT = 3（2026-07-21 寫的）；2026-08-26 樓層改成 3／7／11／15 張全畫給訪客看時沒跟上——
   引擎畫 11 張、加商品（lib gdidUsedOnPage）／替換與自動補品（server pageExposedGdids）／編輯器定位三處也全算，
   只有這道決定「擋不擋發佈」的閘還只看前 3 張。四處三種說法，這裡是落單的那個
   （白蘭 174314：同一件在樓層 1 第 5 張＋樓層 3 情境大圖，發佈前檢查全綠）。
   常數整個拿掉、不留「上限」語意，免得下次又有人拿它去切。牆＝規劃/qa/gate-exposure-boundary-wall-2026-09-25.html */
const PAGE_DEDUP_EXCLUDED_POSITIONS = ["editorial-wall"]; // U22 排除：編輯精選商品牆（設計語意、U20/U22 邊界明文排除；納管＝第四次擴圈候補）
const CP20_BASE_SYNONYMS = {                            // U23 詞庫①：基底詞人工同義表（每垂直 ~10 詞；鍵/值命中 curationTheme 即啟用該組；autoDerivation 全自動化前的唯一維護點）
  "鈦": ["鈦"],                                          // 純鈦/鈦合金/鈦晶/鈦盾等含鈦字樣均命中；「划算」等優惠語境不豁免（U23 詞庫註記）
  "法式餐廚": ["le creuset", "creuset", "鑄鐵", "琺瑯", "法式"],
  "露營": ["kazmi", "kzm", "露營", "戶外", "帳", "營"],
  "鍵盤": ["鍵盤", "keys", "keyboard", "鍵鼠"],
  "女裝": ["en-suey", "銀穗", "洋裝", "上衣", "褲", "裙", "衫", "背心"],
};
const CP20_CATEGORY_NOUNS = [                           // U23 詞庫②：品類名詞詞典（模組子類詞 ∩ 本表＝可驗子類詞；五集已可覆蓋、後續人工維護）
  "杯", "碗", "盤", "鍋", "筷", "匙", "勺", "吸管", "壺", "杯蓋", "砧板", "餐具", "餐盤", "湯鍋", "炒鍋", "燉鍋", "烤盅", "烤盤", "茶壺", "馬克杯",
  "帳篷", "帳", "天幕", "椅", "桌", "爐", "收納", "打包", "保冷", "床墊", "拖車", "手拉車", "廚房",
  "鍵盤", "滑鼠", "數字", "機械", "無線", "有線", "藍牙", "電競", "辦公", "復古",
  "洋裝", "長裙", "短裙", "裙", "上衣", "襯衫", "背心", "短褲", "長褲", "九分褲", "針織", "刺繡", "印花", "蕾絲",
];
const CP20_MODIFIER_CONFLICTS = [                       // U23 詞庫③：修飾語宣稱 × 衝突形（>50% 曝光商品名反證＝Blocking；U23 V3「純鈦鍋具」實例）
  { claim: "純鈦", conflictReSrc: "鈦合金|塗層|鍍鈦|複合|鈦晶|鈦金(?!屬)" },
  { claim: "無線", conflictReSrc: "有線" },
  { claim: "涼感", conflictReSrc: "(?!)" },              // 佔位：涼感無機器可驗衝突形（W8 型走 WARN 品類名詞檢查）
];
const CP20_STOP_RE_SRC = "\\d+\\s*折|滿\\s*\\d+|\\d+\\s*元起?|GUIDE\\s*\\d+|[「」『』（）()！!？?、，。・．\\s\"'：:；;－—-]"; // U23 子類詞停用形（優惠數字詞/語氣/標點）
const MORELINK_ENABLED_ENUM = ["on", "off"];            // U28b：off＝該位置不渲染看更多（合法；url 可留值備用）
/* ---- 2026-08-24 v15 新增常數（51 號 W1-E：CP-25 版式值域／CP-26 佔位殘留／CP-27 素材授權＋灰度門票）---- */
const LAYOUT_VARIANT_RE_SRC = "^layout-\\d{3}$";        // 新版式貨號形（51 §2.6：kvVariant 值域升級＝new|legacy＋layout-001~009 append-only）
const PLACEHOLDER_RESIDUE_RE_SRC =                      // CP-26：「滿 $-- 折 $--」型示意佔位（涵蓋 $--／00.00–00.00 兩型；佔位永不出貨＝51 §2.10）
  "[$＄]\\s*--|(?<!\\d)00\\.00\\s*[–—~〜-]\\s*00\\.00(?!\\d)";
const PLACEHOLDER_SCAN_EXCLUDED_PATHS = ["meta", "page.heroSlotStash", "page.mechanic.rowStash"];/* rowStash＝資訊卡換版式暫存列（2026-08-30；不渲染不出貨，同 heroSlotStash 待遇） */ // CP-26 掃描排除子樹（review F3：僅契約正位路徑，同名鍵掛深層＝照掃不再整棵跳過）：meta＝draft 頂層不進渲染（14 §2.12）；heroSlotStash＝page 下不渲染不出貨（14 §2.13，換回還原時強制重驗另有專責）
const MOTION_FLAG_ENUM = ["static", "sway", "flip"];    // 14 §2.13 motionFlag 枚舉（第一波＝開關殼＋契約欄；欄缺席＝容忍）
const MOTION_REF_FIELDS = ["motionId", "motion"];       // 動畫素材貨號欄名（W1-E 提案落點＝page.motionId；提案包 motion 貨號的契約落名由 W1-C/D 落欄時對齊，先雙收）
/* CP-25/27 值域真源＝runtime 讀登記簿（lib/proposal_pack loadRegistries）——不在本檔鏡像 id 清單（R5 枚舉鏡像防範）。
 * BG_REVIEW_PASS／backgroundEligible＝lib/proposal_pack 單一來源（2026-08-24 合流：與表單 lib 同套，廢止本檔複本）。
 * GATE_REGISTRY_OVERRIDES env＝hermetic 測試注入通道（沿 GATE_THEME_FIT_PATCH 檔案通道前例）：
 * 值為 JSON 物件字面量或 JSON 檔路徑，鍵＝{modules,layouts,backgrounds,fonts,motion,tokens} 之絕對路徑。 */
const { normalizeKvVariant, loadRegistries, BG_REVIEW_PASS, backgroundEligible, registriesFingerprint } = require("./lib/proposal_pack.js"); // registriesFingerprint＝2026-09-21 C：報告帶登記簿指紋，工作台據此判「需重檢」
const { ENGINE_SUPPORTED } = require("./lib/layout_choice.js"); // 引擎完工名單（2026-08-25 完工閘；單一來源＝完工一款解鎖一款）
const { PRODUCT_SLOT_CAP } = require("./lib/hero_combo.js"); // 商品槽容量表（單一來源；CP-29 用）
// 必填欄清單（宣告式；enforcement 於 main 內逐項落實，前端預檢用）
const REQUIRED_FIELDS = [
  { field: "products[].gdid", note: "須存在於 snapshot 且不得重複" },
  { field: "products[].name", note: "🔒 逐字＝來源" },
  { field: "products[].heroName", note: "✍️ 主視覺商品顯示名（人工可編、選填；空＝顯示 name 真值。只驗寬度與文案工程字串，不做真值比對——沿 kvShortName 前例，2026-08-30 使用者裁決）" },
  { field: "products[].price", note: "🔒 ＝來源現價" },
  { field: "products[].url", note: "🔒 逐字＝來源；網域白名單" },
  { field: "products[].tagSource", when: "tag 非空", note: "值限 enums.tagSource" },
  { field: "products[].tagOriginal", when: "tagSource=feature", note: "改寫必留原文；tag 須為原文有序子序列" },
  { field: "page.kv.actid", when: "KV 含折數或檔期", note: "折數＋檔期綁同一活動（禁跨活動拼裝）" },
  { field: "page.kv.keyProductGdids", when: "恆常", note: `應為 ${KV_KEY_PRODUCTS} 件且皆在 P2（不足＝WARN）` },
  { field: "page.kv.images", note: `U10（2026-07-20）：三張＝各主打商品池 imgs[1]（商品頁商品圖第二張＝白底語意）；池僅 1 張圖容 imgs[0]＋WARN；人工主題素材覆寫走 ${KV_IMG_OVERRIDE_PATH}` },
  { field: "page.promoEntries", note: `U17⑰（2026-07-20）：有效入口（具 url/actid）數量 ${PROMO_ENTRY_COUNT.min}~${PROMO_ENTRY_COUNT.max}——<${PROMO_ENTRY_COUNT.min} 依 U8 三層優先序遞補、遞補後仍不足＝FAIL CP-15；恰 ${PROMO_ENTRY_COUNT.min} 則＝版型等比放大（間距不變、圓圖與標題背景寬度等比、字級不變＝09 §2.10）；欄位缺席＝第 3 層整模組隱藏語意、略過；2026-08-26 使用者裁決＝上限 4→12（>3 全裝置滑動列＝渲染另批）` },
  { field: "page.promoEntries[].img", note: `U2（2026-07-20）：預設＝活動型該 actid 商品池首件 imgs[0]／商品型該 gdid imgs[0]；人工覆寫走 ${ENTRY_IMG_OVERRIDE_PATH}（banner 不再是合法預設）` },
  { field: "page.promoEntries[].dateValue", when: "商品型入口（gdsale url）", note: "必須為空（U5 2026-07-20：無檔期列，dateValue 空＝隱藏）" },
  { field: "page.promoSourceMode", when: "缺值視為 auto", note: `E0（U8 2026-07-20；U19⑲ 修訂 auto 語意）：值限 ${PROMO_SOURCE_MODES.join("|")}；auto＝取可滿足 ≥${PROMO_ENTRY_COUNT.min} 則的最高優先層（U19 單一來源制——不再混填）、其餘值＝強制單一來源（全部入口同型）` },
  { field: "page.promoModuleTitle", when: "非空", note: `U19⑲＋U16（2026-07-20）：標題與內容同型——純活動＝promo-truth 優惠真值標題；純商品/品牌推薦＝ai-curated 策展命名（「本期活動」四字消失、禁優惠數字詞）；entries 全商品型而標題命中 promoTitleTruth 詞型＝FAIL CP-17；欄位缺席＝略過` },
  { field: "page.walls", note: `U18⑱（2026-07-20 原 3~5）／2026-08-27 模組批升版：品類牆（等價 categorySections）數量 ${CATEGORY_WALL_COUNT.min}~${CATEGORY_WALL_COUNT.max}（預設 ${CATEGORY_WALL_COUNT.default} 組、可刪至 1 面）——超出＝FAIL CP-16；欄位缺席＝略過；牆標題不得與樓層/其他牆同名（dock 錨點撞名＝WARN）` },
  { field: "page.categoryWallCount", when: "非空", note: `U18⑱（2026-07-20）：Sheets 數量選擇欄——宣告值須＝實有牆數（不一致＝FAIL CP-16）；等價欄位 ${WALL_COUNT_FIELDS.join("/")}` },
  { field: "page.walls[].wallProductCount", when: "非空", note: `U27㉗（2026-07-20）：牆N商品數 Sheets 欄——值 ∈ {${WALL_PRODUCT_COUNT_ENUM.join("|")}} 且須＝該牆商品列實數（不一致＝FAIL CP-21）；欄位缺席＝略過；每牆實數本身 ∉ {${WALL_PRODUCT_COUNT_ENUM.join("|")}}＝FAIL CP-21（03 R1 牆 4~12 warning 語意廢止升 Blocking）` },
  { field: "page.floors[].moreLink / page.walls[].moreLink", when: "非空", note: `U28㉘/U28b（2026-07-20）：per 位置看更多 {enabled:on|off, url}——on 之 url 全頁唯一（＝自身 scene 卡/其他 moreLink/入口/編輯精選/探索/全域 moreUrl 任一＝FAIL CP-22）＋主題切合（search 型 query 詞 ∩ 模組詞庫＋GET hits>0）；off＝該位置不渲染（url 留值備用合法）；欄位缺席＝INFO 退全域 moreUrl 舊行為` },
  { field: "page.kvVariant", when: "非空", note: `W1-E（2026-08-24）：版式貨號欄——值域＝modules.json hero variants（runtime 讀登記簿，不在此鏡像清單＝R5 防範）；kv-new/kv-legacy 舊拼法讀入正規化（51 §2.6）；值域外＝FAIL CP-25；欄位缺席＝舊 draft legacy 態略過（51 §2.8）` },
  { field: "page.backgroundId", when: "kvVariant=layout-*", note: `W1-E（2026-08-24）：出貨背景貨號——缺欄＝取版式 defaultBackground；license C＝FAIL CP-27、B 級須複查 ${BG_REVIEW_PASS.join("/")}（conditional 不得任預設、明選黃燈）、B 級另需簿級 meta.termsVerification；trial 版式過灰度門票（license A 或已複查 B）` },
  { field: "page.motionFlag", when: "非空", note: `W1-E（2026-08-24）：值限 ${MOTION_FLAG_ENUM.join("|")}（14 §2.13）；缺席＝容忍；sway/flip 綁定素材（page.${MOTION_REF_FIELDS[0]}）license C＝FAIL CP-27、未綁素材＝WARN（第一波動畫素材鏈未接＝當檔商品照現生另批）` },
  { field: "page.titleStyle", when: "非空（kvVariant=layout-*）", note: `v17（2026-09-08 CP 登記表 v1.17）：字風貨號——值域＝字風登記簿 review.status=approved；查無／未審／主字型缺戶口或 license 非 A（B 須 ${BG_REVIEW_PASS.join("/")}＋reviewDate）＝FAIL CP-27；缺席＝版式原字` },
  { field: "page.subtitleFont", when: "非空（kvVariant=layout-*）", note: `v17（2026-09-08 CP 登記表 v1.17）：{ fontId, weight }——fontId 須在字體簿且 pickable:true、license A（B 須複查欄同上）；否則 FAIL CP-27；缺席＝版式原字` },
];

const FULLWIDTH_DIGITS_RE = new RegExp(FULLWIDTH_DIGITS_RE_SRC, "g");
const DISCOUNT_CLAIM_RE = new RegExp(DISCOUNT_CLAIM_RE_SRC, "g");
const PRICE_CLAIM_RE = new RegExp(PRICE_CLAIM_RE_SRC, "g");
const PRICE_SEMANTIC_RE = new RegExp(PRICE_SEMANTIC_RE_SRC);
const DISCOUNT_CHAR_RE = new RegExp(DISCOUNT_CHAR_RE_SRC);
const KV_TITLE_DISCOUNT_RE = new RegExp(KV_TITLE_DISCOUNT_RE_SRC);
const LINK_DOMAIN_RE = new RegExp(LINK_DOMAIN_RE_SRC);
const GDSALE_PATH_RE = new RegExp(GDSALE_PATH_RE_SRC);
const GDSALE_ID_RE = new RegExp(GDSALE_ID_RE_SRC);
const ENTRY_PROMO_BAN_RE = new RegExp(ENTRY_PROMO_BAN_RE_SRC);
const ENTRY_PERIOD_BAN_RE = new RegExp(ENTRY_PERIOD_BAN_RE_SRC);
const PERIOD_TAIL_RE = new RegExp(PERIOD_TAIL_RE_SRC);
const ENGINEERING_COPY_RE = new RegExp(ENGINEERING_COPY_RE_SRC, "i");
const PROMO_TITLE_TRUTH_RE = new RegExp(PROMO_TITLE_TRUTH_RE_SRC);
const BRAND_FILTER_URL_RE = new RegExp(BRAND_FILTER_URL_RE_SRC);
const LAYOUT_VARIANT_RE = new RegExp(LAYOUT_VARIANT_RE_SRC);
const PLACEHOLDER_RESIDUE_RE = new RegExp(PLACEHOLDER_RESIDUE_RE_SRC);

/* ---------- 工具 ---------- */
const norm = (s) => String(s ?? "").replace(FULLWIDTH_DIGITS_RE, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));
const themeFitLib = require("./lib/theme_fit.js"); // CP-14 契合判定一把尺：curate_auto 挑入口也用同一支（ENTRY-THEMEFIT-SELF-CHECK 2026-09-28）
function textWidth(str, fontPx) {
  let w = 0;
  for (const ch of str) w += /[ ]/.test(ch) ? WIDTH_MODEL.space : /[ -ÿ]/.test(ch) ? WIDTH_MODEL.halfwidth : WIDTH_MODEL.fullwidth;
  return w * fontPx;
}

function checkUrl(url, kind) {
  try {
    const h = new URL(url).hostname;
    if (kind === "link") return LINK_DOMAIN_RE.test(h);
    return IMG_DOMAINS.some((d) => h === d || h.endsWith("." + d)) || LINK_DOMAIN_RE.test(h);
  } catch { return false; }
}
// 檔期顯示容差：短式「2026.07.03 ~ 08.01」視同全式（確定性顯示轉換）
function periodMatch(display, sourcePeriod) {
  if (display === sourcePeriod) return true;
  const m = display.match(/^(\d{4})\.(\d{2}\.\d{2}) ~ (\d{2}\.\d{2})$/);
  return !!m && `${m[1]}.${m[2]} ~ ${m[1]}.${m[3]}` === sourcePeriod;
}
// U1 CP-06：URL 正規化比對——host 小寫＋pathname＋query 依 key/value 排序（忽略 query 順序）、hash 忽略
function normalizeUrl(u) {
  if (!u) return null;
  try {
    const x = new URL(u);
    const q = [...x.searchParams.entries()].sort((a, b) => a[0].localeCompare(b[0]) || a[1].localeCompare(b[1]));
    return x.hostname.toLowerCase() + x.pathname + (q.length ? "?" + q.map(([k, v]) => `${k}=${v}`).join("&") : "");
  } catch { return String(u).trim(); }
}
// U5：url 為 gdsale 商品頁 → 商品型入口分流（回傳 pathname；非商品頁回 null）
function gdsalePath(u) {
  try { const p = new URL(u).pathname; return GDSALE_PATH_RE.test(p) ? p : null; } catch { return null; }
}
// U15：brandIds 品牌篩選 URL（/search/product?brandIds=<品牌ID>&p=<主題詞>）＝連結白名單合法形態（品牌維度編輯精選導流）
function isBrandFilterUrl(u) {
  try { const x = new URL(u); return LINK_DOMAIN_RE.test(x.hostname) && BRAND_FILTER_URL_RE.test(x.pathname) && x.searchParams.has("brandIds"); } catch { return false; }
}
// U11：編輯精選圓形項取得（page.editorial／draft.editorial；容器等價欄位 circles/items；模組缺席＝回空陣列＝略過不誤殺）
function editorialCircles(draft) {
  const mod = draft.page?.editorial || draft.editorial;
  if (!mod) return [];
  if (Array.isArray(mod)) return mod;
  for (const k of EDITORIAL_CIRCLE_KEYS) if (Array.isArray(mod[k])) return mod[k];
  return [];
}
// U18 CP-16：品類牆容器取得（page.walls／categorySections 等價欄位；缺席＝null＝略過不誤殺，沿 CP-15 慣例）
function categoryWalls(draft) {
  for (const scope of [draft.page, draft]) {
    if (!scope || typeof scope !== "object") continue;
    for (const k of WALL_CONTAINER_KEYS) if (Array.isArray(scope[k])) return { key: k, walls: scope[k] };
  }
  return null;
}
// U14：主題契合閘校準值載入——策展 agent feedback_patch.json themeFitRule 讀得到就以它為準；否則抽頂預設
// 相容校準檔實際形制（2026-07-20 curation-20260720 實檔）：threshold 可為數值或 {B_poolHitRate}（閘門實作
// 訊號 B＝商品池品名命中率，故取 B 門檻）；keywords 斜線別名展開（"titanium/TITANIUM"→兩詞）＋一律小寫
// （keywordNote：「英文別名 titanium 不分大小寫」——命中比對端同步 toLowerCase，中文不受影響）
function loadThemeFit() {
  for (const p of THEME_FIT_PATCH_PATHS) {
    try {
      const r = JSON.parse(fs.readFileSync(p, "utf8")).themeFitRule;
      if (r && Array.isArray(r.keywords) && r.keywords.length) {
        const keywords = [...new Set(r.keywords.flatMap((k) => String(k).split("/")).map((s) => s.trim().toLowerCase()).filter(Boolean))];
        const threshold = typeof r.threshold === "number" ? r.threshold
          : typeof r.threshold?.B_poolHitRate === "number" ? r.threshold.B_poolHitRate
          : THEME_FIT_DEFAULT.threshold;
        return { keywords, threshold, source: `feedback_patch themeFitRule（${p}）` };
      }
    } catch { /* 讀不到＝走預設（缺檔不誤殺） */ }
  }
  return THEME_FIT_DEFAULT;
}
// U8 CP-10：入口型別判定——destinationType 宣告優先，缺宣告時以 url 分流（gdsale＝商品替補、其餘＝活動型）
function entryType(e) {
  const d = String(e.destinationType || "").toLowerCase();
  if (d === "activity" || d === "promo-activity") return "promo-activity";
  if (d === "brand-recommend" || d === "brand") return "brand-recommend";
  if (d === "product" || d === "product-fallback") return "product-fallback";
  return gdsalePath(e.url) ? "product-fallback" : "promo-activity";
}
// U8 CP-10：自快照蒐集品牌頁推薦清單 gdid（hotSales/hits；found=false＝快照無清單→不可溯源 WARN）
function brandRecommendGdids(snap) {
  const gdids = new Set();
  let found = false;
  const scan = (obj) => {
    if (!obj || typeof obj !== "object") return;
    for (const k of BRAND_RECOMMEND_KEYS) {
      const list = obj[k];
      if (!Array.isArray(list)) continue;
      found = true;
      for (const it of list) { const g = typeof it === "string" ? it : it?.gdid; if (g) gdids.add(String(g)); }
    }
  };
  scan(snap); scan(snap.brand); scan(snap.brandPage);
  return { found, gdids };
}
// U3：到期時間以台北時間呈現（訊息載明到期時間）
function taipeiStr(ms) {
  const d = new Date(ms + TAIPEI_UTC_OFFSET_MIN * 60000);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}（台北）`;
}
// 改寫合法性代理：改寫字必須是原文的「有序字元子序列」（只能刪減，不能新增＝不加油添醋）
function isSubsequence(needle, hay) {
  let i = 0;
  for (const ch of hay) if (ch === needle[i]) i++;
  return i >= needle.length;
}
// W1-E：GATE_REGISTRY_OVERRIDES 解析（inline JSON 或 JSON 檔路徑）——設定值壞＝throw 出聲（鐵律 3：不靜默忽略注入設定）
function gateRegistryOverrides() {
  const v = process.env.GATE_REGISTRY_OVERRIDES;
  if (!v) return {};
  const raw = v.trim().startsWith("{") ? v : fs.readFileSync(v, "utf8");
  return JSON.parse(raw);
}
// W1-E CP-26：draft 全字串欄遞迴掃佔位殘留；排除子樹＝僅契約正位路徑（review F3：原鍵名任意深度排除＝
// 深層模組掛名 meta 的佔位可矇混出貨——改路徑比對，meta 只認頂層、heroSlotStash 只認 page 下）
function scanPlaceholderResidue(node, atPath, hits) {
  if (typeof node === "string") {
    if (PLACEHOLDER_RESIDUE_RE.test(node)) hits.push({ path: atPath || "(root)", value: node });
    return;
  }
  if (Array.isArray(node)) { node.forEach((v, i) => scanPlaceholderResidue(v, `${atPath}[${i}]`, hits)); return; }
  if (node && typeof node === "object") {
    for (const [k, v] of Object.entries(node)) {
      const p = atPath ? `${atPath}.${k}` : k;
      if (PLACEHOLDER_SCAN_EXCLUDED_PATHS.includes(p)) continue;
      scanPlaceholderResidue(v, p, hits);
    }
  }
}

function httpStatus(url) {
  return new Promise((resolve) => {
    const req = https.request(url, { method: "HEAD", timeout: 10000 }, (res) => {
      if (res.statusCode === 405 || res.statusCode === 403) {
        const g = https.get(url, { timeout: 10000 }, (r2) => { r2.destroy(); resolve(r2.statusCode); });
        g.on("error", () => resolve(-1)); g.on("timeout", () => { g.destroy(); resolve(-1); });
      } else resolve(res.statusCode);
      res.resume();
    });
    req.on("error", () => resolve(-1));
    req.on("timeout", () => { req.destroy(); resolve(-1); });
    req.end();
  });
}

async function main() {
  const [snapPath, draftPath] = process.argv.slice(2);
  /* v20 輸出防呆：報告路徑＝把檔名 draft.json 換成 gate_report.json；檔名不是 draft.json 時 replace 不命中＝會把報告寫回輸入檔（覆寫草稿或版本備份）。
     要檢查版本備份＝先複製成 <暫存夾>/draft.json 再跑。exit 2＝跟「有 FAIL」的 exit 1 分開，呼叫端不會誤判成檢查沒過。 */
  if (!draftPath || path.resolve(draftPath.replace(/draft\.json$/, "gate_report.json")) === path.resolve(draftPath)) {
    console.error(`機器閘：拒絕執行——草稿檔名必須是 draft.json（收到 ${draftPath || "（空）"}），否則報告會覆寫輸入檔。要檢查版本備份請先複製成 <資料夾>/draft.json 再跑。`);
    process.exit(2);
  }
  const snapRaw = fs.readFileSync(snapPath);
  const draftRaw = fs.readFileSync(draftPath);
  const snap = JSON.parse(snapRaw.toString("utf8"));
  const draft = JSON.parse(draftRaw.toString("utf8"));
  const byGdid = new Map(snap.products.map((p) => [p.gdid, p]));
  const promoOf = (actid) => snap.promotions.find((p) => p.actid === actid);
  const promoText = (p) => norm((p.title || "") + "\n" + (p.short || ""));
  /* 查商品名（2026-10-07 使用者反饋三連發：檢查訊息要指名道姓）：收 gd:<id> 或裸 gdid → 「名稱…」。
     名字先查草稿商品列、退快照（name 逐字＝來源真值，只做顯示截斷）；查不到＝回空字串照舊只講位置。
     CP-06／CP-10／CP-18 三族共用這一份——不要在個別檢查裡再抄一份（鐵律 4）。 */
  const nameOfGd = (idOrGdid) => {
    const g = String(idOrGdid || "").replace(/^gd:/, "");
    if (!/^\d+$/.test(g)) return "";
    const row = (draft.products || []).find((r) => String(r.gdid) === g) || byGdid.get(g) || byGdid.get(Number(g));
    const nm = row && row.name ? String(row.name) : "";
    return nm ? `「${nm.slice(0, 20)}${nm.length > 20 ? "…" : ""}」` : "";
  };
  const findings = [];
  const add = (level, code, msg) => findings.push({ level, code, msg });
  // W1-E review F1：值域來源留痕——預設＝正式登記簿；GATE_REGISTRY_OVERRIDES 生效時改記注入來源（report.registrySource）
  let registrySource = "registries";
  // CP-13（U13⑬，2026-07-20）：✍️ 文案欄禁工程字串（search p=／[?&]p=／actid=／http(s)://）——命中＝FAIL
  const checkEngCopy = (text, label) => {
    if (text && ENGINEERING_COPY_RE.test(norm(text))) {
      add("FAIL", "CP-13", `${label}「${text}」含工程字串（U13：URL/query 參數不得直出文案——分流邏輯保留，文案改用使用者能理解的語言）`);
    }
  };

  /* ---------- 折數／元價宣稱驗真值 ----------
   * 折數 n 合法條件（皆對正規化文本、邊界比對——97折 不得證明 7折）：
   *   (a) 指定 promo 池的 title+short 含「(非數字)n折」
   *   (b) n 等於池內某商品實算折數（兩位）
   *   (c) n<10 且池內存在實算折數恰為 n*10（十位縮寫僅允許整十：50→5折；55 不得稱 5折＝禁誇大）
   * 元價 m 合法條件：等於池內某商品現價，或逐字出現在 promo 文本
   */
  function checkCopyTruth(text, label, promos, discs, prices) {
    if (!text) return;
    const t = norm(text);
    for (const m of t.matchAll(DISCOUNT_CLAIM_RE)) {
      const n = +m[1];
      const promoHit = promos.some((p) => new RegExp(DISCOUNT_BOUNDARY_TPL.replace("{n}", n)).test(promoText(p)));
      const discHit = discs.has(n) || (n < 10 && discs.has(n * 10));
      if (!promoHit && !discHit) add("FAIL", "CP-02", `${label}「${text}」的折數 ${n}折 無來源依據`);
    }
    for (const m of t.matchAll(PRICE_CLAIM_RE)) {
      const amt = +m[1].replace(/,/g, "");
      const priceHit = prices.has(amt) || promos.some((p) => promoText(p).includes(`${amt}元`));
      if (!priceHit) add("FAIL", "CP-02", `${label}「${text}」的金額 ${amt}元 無來源依據`);
    }
  }
  const allPromos = snap.promotions;
  const allDiscs = new Set(snap.products.map((p) => p.disc).filter(Boolean));
  const allPrices = new Set(snap.products.map((p) => p.price).filter((v) => v != null));
  const discsOf = (actid) => new Set(snap.products.filter((p) => p.actid === actid).map((p) => p.disc).filter(Boolean));

  /* ---------- CP-25／CP-26／CP-27 hero 版式三閘（v15＝51 號 W1-E，2026-08-24 CP 登記表 v1.8 配號） ---------- */
  {
    /* CP-26 佔位殘留：出貨 draft 全字串欄掃「滿 $-- 折 $--」型（含 00.00–00.00 型）＝FAIL。
     * 編輯態不歸 gate 管——gate 只在出貨鏈（部署/匯出全檢）執行＝條文「編輯態不擋」天然滿足。
     * 排除＝頂層 meta（不進渲染）＋page.heroSlotStash（不渲染不出貨）——僅契約正位路徑（review F3），
     * 深層同名鍵照掃；佔位收暫存＝合法、換回還原時再驗。 */
    const phHits = [];
    scanPlaceholderResidue(draft, "", phHits);
    for (const h of phHits) {
      add("FAIL", "CP-26", `${h.path}「${String(h.value).slice(0, 60)}」含示意佔位（滿 $-- 折 $-- 型）——佔位永不出貨（51 §2.10）；抓不到折扣真值＝關折扣開關出 base 版，不出佔位`);
    }

    /* CP-31 內文模組完整性（gate v18＝70 號 §6 QA 2026-09-09 使用者裁「新開檢查號」；CP 登記表 v1.18；CP-28 已為主視覺真值連動所用故取 31）：
     * 三內文模組「節點在場、必填全空」＝引擎畫虛線佔位框（誠實態給編輯看），而 CP-26 只認 $-- 型樣板字＝空字串漏網
     * ＝佔位框可能端到消費者面前（70 號 §4 發現②）。規則：模組加了就要填完——資訊卡每列滿額門檻＋折抵/贈品、banner 至少一張圖或第一行標題；
     * 主打選品主打商品編號＋大標題、右欄 ≥1（1 張 WARN）；促銷卡每張商品編號（舊形 promoCard 單物件同掃）。鍵缺席＝模組不在頁上＝略過（舊稿零誤殺）。
     * 白話訊息講第幾列／哪張卡沒填並指路；編輯態不擋＝gate 只跑出貨鏈。CMS 示範態灰字純顯示不進 draft（70 號）＝畫面看得到空格、本閘讓空格出不了門。 */
    {
      const pgc = draft.page || {};
      const filled = (v) => String(v == null ? "" : v).trim().length > 0;
      const mech = pgc.mechanic;
      if (mech && typeof mech === "object") {
        const b = mech.banner || {};
        const bImgs = (Array.isArray(b.imgs) ? b.imgs : []).filter(filled);
        if (!bImgs.length && !filled(b.img) && !filled(b.titleLine1)) add("FAIL", "CP-31", "活動資訊卡的 banner 還是空的——至少放一張圖，或填第一行標題；不想放這塊就把「活動資訊卡」整個移除（技術：page.mechanic.banner imgs/img/titleLine1 全空＝引擎渲染虛線佔位）");
        (Array.isArray(mech.rows) ? mech.rows : []).forEach((r, i) => {
          const miss = [];
          if (!filled(r && r.thresholdText)) miss.push("滿額門檻");
          if (!filled(r && r.rewardText)) miss.push("折抵或贈品");
          if (miss.length) add("FAIL", "CP-31", `活動資訊卡第 ${i + 1} 列還沒填${miss.join("、")}——每一列都要填完才能上線；用不到的列請換成列數較少的排版，或把模組移除（技術：page.mechanic.rows[${i}] ${miss.length === 2 ? "thresholdText+rewardText" : (miss[0] === "滿額門檻" ? "thresholdText" : "rewardText")} 空＝引擎不生成該列／CMS 預覽畫虛線佔位）`);
        });
      }
      const sp = pgc.spotlight;
      if (sp && typeof sp === "object") {
        if (!filled(sp.heroCard && sp.heroCard.gdid)) add("FAIL", "CP-31", "主打選品還沒挑主打商品——到編修頁「主打選品」挑一件或貼商品網址；不想放這塊就把模組移除（技術：page.spotlight.heroCard.gdid 空＝引擎渲染虛線佔位卡）");
        if (!filled(sp.title)) add("FAIL", "CP-31", "主打選品的大標題還沒填——右欄那行大字不能空著上線（技術：page.spotlight.title 空＝引擎渲染「大標題待填」）");
        const refs = (Array.isArray(sp.productRefs) ? sp.productRefs : []).filter(filled);
        if (!refs.length) add("FAIL", "CP-31", "主打選品右欄還沒放商品——至少放 1 件（版面設計是 2 件）（技術：page.spotlight.productRefs 空＝引擎渲染兩張虛線佔位卡）");
        else if (refs.length < 2) add("WARN", "CP-31", "主打選品右欄只放了 1 件——版面設計是 2 件，放滿最整齊（技術：page.spotlight.productRefs 長度 1）");
      }
      const cards = Array.isArray(pgc.promoCards) ? pgc.promoCards : (pgc.promoCard && typeof pgc.promoCard === "object" ? [pgc.promoCard] : []);
      cards.forEach((c, i) => {
        if (!filled(c && c.gdid)) add("FAIL", "CP-31", `促銷卡第 ${i + 1} 張還沒挑商品——到編修頁「促銷卡」這張卡挑一件或貼商品網址；不要這張就按「移除這張卡」（技術：page.promoCards[${i}].gdid 空＝引擎渲染虛線佔位卡）`);
      });
    }

    /* CP-25 版式值域：kvVariant 欄位缺席＝舊 draft（51 §2.8 legacy 態）＝略過不誤殺；
     * 有值＝經 normalizeKvVariant（kv-new/kv-legacy 舊拼法讀入正規化＝51 §2.6）後必須在
     * modules.json hero variants 值域內。值域 runtime 讀登記簿；draft 有版式欄而登記簿讀不到＝FAIL 出聲。 */
    const kvVariantRaw = draft.page.kvVariant;
    const kvVariant = normalizeKvVariant(kvVariantRaw);
    const isLayoutVariant = typeof kvVariant === "string" && LAYOUT_VARIANT_RE.test(kvVariant);
    let REG = null;
    if (kvVariant != null) {
      let regError = null;
      // W1-E review F1：override 生效即出聲（措辭沿 GATE_SKIP_HTTP WARN 前例＝跳過/替代必留痕）——env 注入＝
      // 非正式登記簿，stdout WARN＋report.registrySource 記注入來源（路徑形＝記路徑；inline JSON＝記形式標記）。
      const envOverride = (process.env.GATE_REGISTRY_OVERRIDES || "").trim();
      if (envOverride) {
        registrySource = envOverride.startsWith("{") ? "GATE_REGISTRY_OVERRIDES（inline JSON）" : envOverride;
        add("WARN", "CP-25", `值域來源＝GATE_REGISTRY_OVERRIDES 注入（非正式登記簿），本報告不得作為出貨依據：${registrySource}`);
      }
      try { REG = loadRegistries(gateRegistryOverrides()); } catch (e) { regError = e.message; }
      if (regError) {
        add("FAIL", "CP-25", `page.kvVariant「${kvVariantRaw}」無法驗值域——登記簿讀取失敗：${regError}（值域真源缺席＝擋下不裝懂）`);
      } else if (!REG.heroVariantIds.includes(kvVariant)) {
        add("FAIL", "CP-25", `page.kvVariant「${kvVariantRaw}」不是合法版式貨號——值域＝modules.json hero variants（${REG.heroVariantIds.join("、")}）`);
        REG = null; // 未知貨號＝後續 CP-27 無版式可解析，不再疊報
      } else {
        if (kvVariantRaw !== kvVariant) add("INFO", "CP-25", `page.kvVariant「${kvVariantRaw}」＝舊拼法，讀入正規化為「${kvVariant}」（51 §2.6 全鏈裸值；寫出端不得再輸出 kv- 前綴）`);
        const vrec = REG.heroVariantRecords.get(kvVariant) || {};
        if (vrec.rollout === "trial") add("INFO", "CP-25", `page.kvVariant「${kvVariant}」＝灰度試用版式（rollout=trial）——出貨背景過灰度門票（見 CP-27）`);
        else if (vrec.rollout === "closed") add("INFO", "CP-25", `page.kvVariant「${kvVariant}」已停接新案（rollout=closed）——歷史頁照舊渲染出貨（51 §3 值域保留）、工作台不再供新選`);
        /* 引擎完工閘（2026-08-25 使用者實測揪出的誤放洞）：版式真樣式未完工＝渲染端只有骨架告示——
           絕不可上消費者頁。完工名單單一來源＝lib/layout_choice ENGINE_SUPPORTED（完工一款解鎖一款）。
           hermetic 測試可經 GATE_REGISTRY_OVERRIDES.engineReady 注入名單（同一條會 WARN 留痕的注入通道，不另開側門）。 */
        const ovER = gateRegistryOverrides().engineReady;
        const engineReady = Array.isArray(ovER) ? new Set(ovER) : ENGINE_SUPPORTED;
        if (isLayoutVariant && !engineReady.has(kvVariant)) {
          add("FAIL", "CP-25", `版面「${kvVariant}」樣式製作中（引擎未完工）＝暫時不能上線——完工後自動解鎖，活動內容不受影響（技術：kvVariant 不在 ENGINE_SUPPORTED 完工名單）`);
        }
      }
    }

    /* CP-27 素材授權（僅 kvVariant=layout-* 生效；new/legacy 頁＝§2.13 欄休眠、沿舊制零波及）。 */
    if (isLayoutVariant && !REG) {
      add("FAIL", "CP-27", `版式「${kvVariant}」的素材授權無法驗證（登記簿缺席或版式貨號非法，見 CP-25）——授權未驗＝不得出貨`);
    } else if (isLayoutVariant) {
      const lrec = REG.layoutRecords.get(kvVariant);
      const vrec = REG.heroVariantRecords.get(kvVariant) || {};
      if (!lrec) {
        add("FAIL", "CP-27", `版式「${kvVariant}」在 layouts 登記簿查無紀錄——defaultBackground 無從解析（modules.json 與 layouts 登記簿漂移，先修簿再出貨）`);
      } else {
        const explicitBg = draft.page.backgroundId ?? null;
        const bgId = explicitBg ?? lrec.defaultBackground ?? null;
        const bgOrigin = explicitBg != null ? "page.backgroundId" : `版式預設（${kvVariant}.defaultBackground）`;
        if (bgId == null) {
          add("FAIL", "CP-27", `版式「${kvVariant}」缺 page.backgroundId 且登記簿無 defaultBackground——出貨背景無值可解析`);
        } else {
          const brec = REG.backgroundRecords.get(bgId);
          const prec = !brec && REG.pendingBackgroundRecords ? REG.pendingBackgroundRecords.get(bgId) : null;
          if (draft.page.heroTitleHidden === true) {
            /* 主視覺活動文字關閉（78 號 2026-09-27，範疇＝確認牆 12 款）：文案在背景圖上＝CP-02 逐字核對看不到那些字——出聲留紀錄，不擋（負責人確認制）。2026-09-29 牆 1 甲：不再擋 AEM／匯出 */
            add("INFO", "CP-27", "主視覺的活動文字已關閉（文案做在背景圖上）——圖上若有價格、折數、檔期，機器核對不到，以活動負責人上傳時的確認為據");
          }
          if (bgId === ownBgLib.OWN_BG_ID) {
            /* 你上傳的背景（78 號→2026-09-29 牆確認制）：圖住活動自己的資料夾、不進登記簿；缺檔＝FAIL；
               三檔齊＝INFO 放行——已確認（wb_meta.heroBgLicenseConfirm sha 相符）＝不掛浮水印、可製作可發佈；
               未確認＝掛「背景版權：活動負責人確認中」、出口擋句指路去確認。 */
            const own = draft.page.heroBgOwn && typeof draft.page.heroBgOwn === "object" ? draft.page.heroBgOwn : null;
            const miss = own ? ownBgLib.ownMissingSlots(own) : ["desktop", "768", "375"];
            let ownConfirm = null;
            try { ownConfirm = JSON.parse(fs.readFileSync(path.join(path.dirname(draftPath), "wb_meta.json"), "utf8")).heroBgLicenseConfirm || null; }
            catch (e) { /* wb_meta 讀不到（gate 對舊 run／裸 draft 跑）＝當未確認處理，不炸 gate */ }
            const licLib = require("./lib/hero_bg_license");
            if (miss.length) add("FAIL", "CP-27", `這檔選了「你上傳的背景」但圖沒齊（缺 ${miss.join("、")}）——回編修頁補齊三張，或改回登記簿的背景（技術：backgroundId=own 而 heroBgOwn.files 不齊）`);
            else if (licLib.ownConfirmMatches(draft.page, ownConfirm)) add("INFO", "CP-27", `背景＝你上傳的背景，版權已由 ${String(ownConfirm.by).slice(0, 40)} 於 ${String(ownConfirm.at || "?").slice(0, 19)} 確認（指紋相符）——可製作 AEM、可發佈，不掛浮水印（來源自答：${String((own.attest || {}).source || "?").slice(0, 30)}）`);
            else add("INFO", "CP-27", `背景＝你上傳的背景（來源自答：${String((own.attest || {}).source || "?").slice(0, 30)}；圖上文字未經機器核對，以上傳時的確認為據）——頁面會掛「背景版權：活動負責人確認中」；${ownConfirm && ownConfirm.sha256 ? "背景圖換過了，版權確認要重做一次" : "完成主視覺背景區的版權確認後即可製作與發佈"}（2026-09-29 牆）`);
          } else if (!brec && prec) {
            /* 待審背景（63 號直通車 2026-08-31 使用者五題圈定）：訪客號段＝放行＋掛牌，不再擋死——
               頁面由渲染端自動掛「背景版權待審核」浮水印（頁尾法務字區、無人工開關）、內網展示限定
               （對外絆線＝sync-public 拒收）；正式出貨標準原封不動＝轉正入正式簿才過。
               待審圖結構上不可能是版式預設（defaultBackground 只吃正式簿貨號）＝天然只能當檔明選。 */
            add("INFO", "CP-27", `背景「${bgId}」（${bgOrigin}）＝待審臨時貨號（上傳人自答：${String((prec.licenseAnswers || {}).source || "?").slice(0, 30)}／商用：${String((prec.licenseAnswers || {}).commercial || "?").slice(0, 20)}）——頁面會掛「背景版權待審核」浮水印、內網展示限定；正式出貨需審核轉正（63 號）`);
          } else if (!brec) {
            add("FAIL", "CP-27", `背景貨號「${bgId}」（${bgOrigin}）不在 backgrounds 登記簿、也不在待審簿——值域外素材禁出貨`);
          } else {
            const lic = brec.license;
            const review = brec.qaStatus ?? null;
            let baseFail = false;
            if (lic === "C") {
              /* C 級改「放行＋掛牌」（63 號 Q1=A，2026-08-31）：「C 級＝內網展示帶警語」的 2026-08-24 條文
                 就地機器化——警語＝渲染端自動掛的浮水印；原「一律 FAIL」退場。正式出貨標準不變（A／已複查 B），
                 對外絆線在 sync-public。trial 灰度門票對 C/pending 不疊擋＝2026-08-31 使用者裁決「試用×待審可以並存」。 */
              add("INFO", "CP-27", `背景「${bgId}」（${bgOrigin}）license C＝授權未過正式查核——頁面會掛「背景版權待審核」浮水印、內網展示限定；要撤牌＝授權轉正（補來源→查條款→升級，2026-08-27 六張先例）`);
            } else if (lic === "B") {
              if (!REG.backgroundsMeta.termsVerification) {
                baseFail = true;
                add("FAIL", "CP-27", `B 級背景「${bgId}」出貨需生成平台商用條款查證紀錄——backgrounds manifest meta.termsVerification 欄缺席（2026-08-24 Higgsfield ToU §4.4 查證入簿前例）`);
              }
              if (review == null) {
                baseFail = true;
                add("FAIL", "CP-27", `B 級背景「${bgId}」（${bgOrigin}）無複查紀錄（審核欄 qaStatus 缺席）——複查通過（${BG_REVIEW_PASS.join("/")}）才可出貨`);
              } else if (review === "conditional") {
                if (explicitBg == null) {
                  baseFail = true;
                  add("FAIL", "CP-27", `B 級背景「${bgId}」複查判定 conditional＝不得任版式預設背景（CP 登記表 v1.8）——版式「${kvVariant}」需改綁 ${BG_REVIEW_PASS.join("/")} 級預設`);
                } else {
                  add("WARN", "CP-27", `B 級背景「${bgId}」（明選）複查判定 conditional＝黃燈出貨——選用前照複查註記處理 AI 痕跡（${String(brec.reviewNote || "見登記簿 reviewNote").slice(0, 50)}）`);
                }
              } else if (!BG_REVIEW_PASS.includes(review)) {
                baseFail = true;
                add("FAIL", "CP-27", `B 級背景「${bgId}」（${bgOrigin}）審核欄值「${review}」不在 ${BG_REVIEW_PASS.join("/")}——不可出貨`);
              } else if (!brec.reviewDate) {
                baseFail = true;
                add("FAIL", "CP-27", `B 級背景「${bgId}」（${bgOrigin}）複查紀錄缺日期（reviewDate 欄）——複查紀錄不完整不可出貨（2026-08-24 合流：門票嚴格版與表單同套）`);
              }
            } else if (lic !== "A") {
              baseFail = true;
              add("FAIL", "CP-27", `背景「${bgId}」（${bgOrigin}）license 欄值「${lic ?? "缺"}」非 A/B/C——登記簿紀錄不完整、授權不明禁出貨`);
            }
            /* 灰度門票（51 §6）：trial 版式出貨背景 license 必為 A 或已複查 B——基礎授權已 FAIL 者不疊報 */
            if (vrec.rollout === "trial" && !baseFail && lic !== "C") {
              /* lic===C 不進門票判：C 級已走浮水印路（上方 INFO）＝「試用×待審可以並存」裁決（2026-08-31）；
                 A/B 級照舊過門票——門票管的是「無牌出貨」，掛牌者不歸它管。 */
              const ticketOk = backgroundEligible(brec); // 單一來源判定（lib/proposal_pack；表單 grayTicket 同函式）
              if (!ticketOk) add("FAIL", "CP-27", `灰度門票：試用版式「${kvVariant}」出貨背景 license 必為 A 或已複查 B（${BG_REVIEW_PASS.join("/")}＋reviewDate）——「${bgId}」＝${lic}/${review ?? "無複查"} 不符（51 §6）`);
            }
          }
        }
      }
      /* 折扣數字人工真值欄（2026-08-25 使用者裁決＝策展未必有優惠內容、開放人填；AI 仍禁代填）：
         第一波機器不抓折扣真值＝hero 折扣槽有值即屬人工填寫——出貨揭示（INFO 留審計軌）＋格式檢查
         （數字 1~3 位、可帶「折」；CP-26 佔位掃描照舊擋 $-- 型假值）。 */
      const dd = draft.page.hero && draft.page.hero["discount-digit"];
      if (dd != null && String(dd).trim() !== "") {
        const ddv = String(dd).trim();
        /* 2026-09-03 使用者裁決：不強制只能填折數——優惠溝通文字開放自填（例：85 折、買一送一、滿千折百），上限 6 字
           （版式膠囊承載上限：l011 68px 章在 403 寬面板內約 5～6 個中文字；折行符 U+2028 與空白不計）；純數字由渲染端補「折」。 */
        const ddLen = [...ddv.replace(/[\s\u2028]/g, "")].length;
        if (ddLen > 6) {
          add("FAIL", "CP-25", `優惠文案「${ddv}」太長（${ddLen} 字，上限 6 字）——請縮短；不確定優惠＝留白（整件不顯示）`);
        } else {
          add("INFO", "CP-25", `優惠文案「${ddv}」＝人工填寫（機器不代抓優惠；真值鐵律＝AI 不代填）——上線前請自行核對優惠內容`);
        }
      }
      /* CP-29 商品槽件數（2026-08-30 使用者裁決＝中秋 design review：主商品槽至多 6、入稿至少 1）：
         版式啟用中的商品槽（slots 列出且 state!=="off"、鍵在 PRODUCT_SLOT_CAP）——空槽（0 件）＝頁面開天窗不得出貨 FAIL；
         超過容量表上限＝契約破壞 FAIL。容量單一來源＝lib/hero_combo PRODUCT_SLOT_CAP（CMS 面板同表）。 */
      if (lrec && Array.isArray(lrec.slots)) {
        for (const slot of lrec.slots) {
          const sk = slot && slot.key;
          if (!sk || slot.state === "off" || !PRODUCT_SLOT_CAP[sk]) continue;
          const sv = draft.page.hero && draft.page.hero[sk];
          const nItems = (sv && Array.isArray(sv.gdids)) ? sv.gdids.filter(Boolean).length : 0;
          if (nItems < 1) add("FAIL", "CP-29", `商品槽「${sk}」是空的——版面會開天窗；至少放 1 件商品才能出貨（編修頁該槽貼商品網址或賣場編號即可）`);
          else if (nItems > PRODUCT_SLOT_CAP[sk]) add("FAIL", "CP-29", `商品槽「${sk}」放了 ${nItems} 件，超過上限 ${PRODUCT_SLOT_CAP[sk]} 件——移除多的再出貨`);
        }
      }
      /* E7 動畫欄（併 CP-27）：motionFlag 容忍缺席；static＝不動不驗；sway/flip＝驗綁定素材授權 */
      const mf = draft.page.motionFlag;
      if (mf != null && mf !== "static") {
        if (!MOTION_FLAG_ENUM.includes(mf)) {
          add("FAIL", "CP-27", `page.motionFlag 值「${mf}」不在 ${MOTION_FLAG_ENUM.join("|")}（14 §2.13）——非法值不得出貨`);
        } else {
          const refField = MOTION_REF_FIELDS.find((f) => draft.page[f] != null);
          const motionRef = refField ? draft.page[refField] : null;
          if (motionRef == null) {
            add("WARN", "CP-27", `page.motionFlag=${mf} 但未綁動畫素材貨號（page.${MOTION_REF_FIELDS[0]} 缺）——第一波出貨動畫素材鏈未接（當檔商品照現生＝另批），渲染端將無素材可動；素材庫現貨＝僅內部預覽・未過授權`);
          } else {
            const mrec = REG.motionRecords.get(motionRef);
            if (!mrec) add("FAIL", "CP-27", `動畫貨號「${motionRef}」（page.${refField}）不在 motion 登記簿——值域外素材禁出貨`);
            else if (mrec.license === "C") add("FAIL", "CP-27", `page.motionFlag=${mf} 綁定素材「${motionRef}」license C＝僅內部預覽・未過授權——出貨動畫定調＝當檔商品照現生（另批），試作素材不出貨`);
          }
        }
      }
      /* 字風／副標字體授權（v17＝2026-09-08 使用者裁決 CP-27 納管字型；CP 登記表 v1.17）：
         寫入端兩道門（lib/proposal_pack parseProposalPack／lib/hero_combo applyCombo）已只放 approved 字風與 pickable 字體——
         gate 是出貨前最後一道：手改 draft.json、舊 draft 帶到後來被退審的字風，都在這裡擋。欄缺席＝版式原字、略過。
         字體 B 級複查欄沿背景同套（qaStatus ∈ BG_REVIEW_PASS＋reviewDate）；字體簿現無 B 級在用＝欄缺席即 FAIL 出聲，不自立後門。 */
      const fontLicenseFail = (frec, what) => { // 回傳 FAIL 訊息；A 級＝null 放行
        const lic = frec.license;
        if (lic === "A") return null;
        if (lic === "B") {
          const rv = frec.qaStatus ?? null;
          if (rv == null) return `${what} license B 無複查紀錄（字體簿 qaStatus 缺席）——複查通過（${BG_REVIEW_PASS.join("/")}）＋reviewDate 才可出貨`;
          if (!BG_REVIEW_PASS.includes(rv)) return `${what} license B 複查值「${rv}」不在 ${BG_REVIEW_PASS.join("/")}——不可出貨`;
          if (!frec.reviewDate) return `${what} license B 複查紀錄缺日期（reviewDate）——不可出貨`;
          return null;
        }
        if (lic === "C") return `${what} license C＝條件受限／未過正式授權（僅內部）——不得上消費者頁`;
        return `${what} license 欄值「${lic ?? "缺"}」非 A/B/C——字體簿紀錄不完整、授權不明禁出貨`;
      };
      const tsId = draft.page.titleStyle;
      if (tsId != null && String(tsId).trim() !== "") {
        const trec = REG.typestyleRecords ? REG.typestyleRecords.get(String(tsId)) : null;
        if (!trec) add("FAIL", "CP-27", `字風「${tsId}」（page.titleStyle）不在字風登記簿——值域外配方禁出貨`);
        else if (!(REG.typestyleIds || []).includes(String(tsId))) add("FAIL", "CP-27", `字風「${trec.displayName || tsId}」尚未審查通過（登記簿 review.status=${(trec.review || {}).status || "（缺）"}）——未審不出貨；改選已審字風，或請負責人審查後重驗`);
        else if (!trec.fontId) add("FAIL", "CP-27", `字風「${trec.displayName || tsId}」已審但沒有主字型戶口（fontId 缺）——字體授權無從驗證，先補字體簿再出貨`);
        else {
          const frec = REG.fontRecords ? REG.fontRecords.get(String(trec.fontId)) : null;
          if (!frec) add("FAIL", "CP-27", `字風「${trec.displayName || tsId}」主字型 ${trec.fontId} 在字體簿查無此戶——授權無從驗證禁出貨`);
          else { const m = fontLicenseFail(frec, `字風「${trec.displayName || tsId}」主字型「${frec.displayName || frec.family}」`); if (m) add("FAIL", "CP-27", m); }
        }
      }
      const sfv = draft.page.subtitleFont;
      if (sfv != null) {
        const sfId = sfv && typeof sfv === "object" ? sfv.fontId : null;
        if (!sfId) add("FAIL", "CP-27", "page.subtitleFont 形狀不對（要 { fontId, weight }）——副標字體授權無從驗證");
        else {
          const frec = REG.fontRecords ? REG.fontRecords.get(String(sfId)) : null;
          if (!frec) add("FAIL", "CP-27", `副標字體「${sfId}」不在字體簿——值域外字體禁出貨`);
          else if (frec.pickable !== true) add("FAIL", "CP-27", `副標字體「${frec.displayName || sfId}」登記為不供挑選（字風配方專用／引擎內建／授權未達 A 級）——不得當副標字體出貨`);
          else { const m = fontLicenseFail(frec, `副標字體「${frec.displayName || frec.family}」`); if (m) add("FAIL", "CP-27", m); }
        }
      }
    }
  }

  /* CP-28 主視覺真值連動（CO-20260825-01＝D7-2 裁決，2026-08-25）：legacy 舞台角落商品必綁賣場編號——
     名稱/網址由商品主檔帶出、杜絕與主檔各講各的（漂移）；存量 drafts 零筆＝即日全量生效零誤殺。
     kvCutouts.price 廢欄（D7-1）＝契約層紅線（零消費者、無需機器檢）。 */
  {
    const cps = draft.page.kv && Array.isArray(draft.page.kv.cornerProducts) ? draft.page.kv.cornerProducts : [];
    cps.forEach((c, i) => {
      if (!c || !String((c && c.gdid) || "").trim()) {
        add("FAIL", "CP-28", `角落商品第 ${i + 1} 件缺賣場編號——名稱與網址由商品資料自動帶出，不用手填也不能只填文字（技術：kv.cornerProducts[${i}].gdid 必填＝CO-20260825-01）`);
      }
    });
  }

  /* ---------- P2 商品列（rowResults 依列序，防重複 gdid 覆寫） ---------- */
  const rowResults = [];
  const seenGdid = new Set();
  const draftGdids = new Set((draft.products || []).map((r) => r.gdid));
  /* v20：主視覺顯示名（heroName）只驗現在還在主視覺槽裡的商品（新版 page.hero 槽＋舊 KV 欄）；離開主視覺的殘值＝INFO、不驗（見檔頭 v20 ②）。 */
  const heroSlotGdids = new Set([
    ...Object.values(draft.page.hero || {}).flatMap((v) => (v && Array.isArray(v.gdids)) ? v.gdids.map(String) : []),
    ...(((draft.page.kv || {}).keyProductGdids) || []).map(String),
  ]);
  for (const row of draft.products || []) {
    const src = byGdid.get(row.gdid);
    const issues = [];
    const fail = (code, msg) => { issues.push(msg); add("FAIL", code, `[${row.gdid}] ${msg}`); };
    const warn = (code, msg) => { issues.push(msg); add("WARN", code, `[${row.gdid}] ${msg}`); };

    if (seenGdid.has(row.gdid)) fail("CP-02", `gdid 重複出現（策展異常）`);
    seenGdid.add(row.gdid);

    if (!src) { fail("CP-02", `gdid 不存在於快照`); rowResults.push("⚠ " + issues.join("；")); continue; }

    // 真值逐字
    if (row.name !== src.name) fail("CP-02", `商品名與來源不符`);
    if (row.price !== src.price) fail("CP-02", `現價 ${row.price} ≠ 來源 ${src.price}`);
    if (row.marketPrice != null && row.marketPrice !== src.marketPrice) fail("CP-02", `原價 ${row.marketPrice} ≠ 來源 ${src.marketPrice}`);
    if (!sameProductUrl(row.url, src.url)) fail("CP-02", `連結與來源不符`); /* 等價兩式（asp↔p-）＝同一件商品不誤殺（2026-10-04 病例 7460184：貼稿真值同步把池 url 換式、字串比對永久紅且畫面無鈕可解） */
    /* 商品圖真值（2026-09-04 補）：快照每件常只存 1 張，CMS 現在會向商品頁補抓前五張讓設計師挑主圖——
       這些圖不在快照 imgs 裡，但同一件商品的圖檔名帶同一組尾碼（-Gd-<gdid>／-SP-<id>，與 product_fetch 收圖規則同一把尺）；
       尾碼對得上＝同一件商品的圖＝放行；對不上（別件商品或來路不明）＝照擋。 */
    const sameProductImg = (im) => {
      if (!im || src.imgs.includes(im)) return !!im;
      if (!/^https:\/\/(?:img\.yec\.tw|s\.yimg\.com|sp\.yimg\.com)\/zp\/MerchandiseImages\/[A-Za-z0-9-]+\.(?:jpg|png)$/.test(im)) return false;
      if (im.includes(`-Gd-${row.gdid}`)) return true;
      const sfx = ((src.imgs[0] || "").match(/-((?:SP|Gd)-\w+)\.(?:jpg|png)$/) || [])[1];
      return !!(sfx && im.includes(`-${sfx}.`));
    };
    if (row.img && !sameProductImg(row.img)) fail("CP-02", `商品圖不在來源圖庫，也不是這件商品的圖`);
    if (row.sceneImg && !sameProductImg(row.sceneImg)) fail("CP-02", `情境圖不在來源圖庫，也不是這件商品的圖`);

    // G5 優惠/活動標籤 🔒 來源逐字（＝該活動 short/title 或商品自帶 offer）
    const ownPromo = promoOf(src.actid);
    if (row.offer) {
      const ok = (ownPromo && promoText(ownPromo).includes(norm(row.offer))) || (src.offer && norm(src.offer).includes(norm(row.offer)));
      if (!ok) fail("CP-02", `優惠標籤「${row.offer}」非來源逐字`);
    }

    // 市價比 <0.4 → 一律異常標記（契約 G4）；標籤含折數再升 FAIL
    if (src.marketPrice > 0 && src.price / src.marketPrice < 0.4) {
      warn("CP-02", `市價比 ${(src.price / src.marketPrice).toFixed(2)} <0.4 異常`);
      if (DISCOUNT_CHAR_RE.test(norm(row.tag || ""))) fail("CP-02", `市價比異常，禁用折數標籤`);
    }

    // G6 商品標籤：封閉世界——tag 非空必有合法 tagSource＋對應驗證
    if (row.tag) {
      if (row.tagSource === "offer") {
        const ok = (ownPromo && promoText(ownPromo).includes(norm(row.tag))) || (src.offer && norm(src.offer).includes(norm(row.tag)));
        if (!ok) fail("CP-02", `offer 標籤「${row.tag}」非該活動優惠逐字`);
      } else if (row.tagSource === "feature") {
        if (!row.tagOriginal) fail("CP-02", `feature 標籤缺 tagOriginal（改寫必留原文）`);
        else {
          if (!src.desc.some((d) => d.includes(row.tagOriginal))) fail("CP-02", `標籤原文不在商品特色`);
          if (!isSubsequence(norm(row.tag), norm(row.tagOriginal))) fail("CP-02", `標籤「${row.tag}」非原文有序子序列（改寫只能刪減不能新增）`);
        }
      } else if (row.tagSource === "manual") {
        add("INFO", "CP-02", `[${row.gdid}] 標籤「${row.tag}」＝人工調修（manual）——來源溯查豁免；折數/元價驗真值＋寬度＋市價比禁折標照檢（2026-07-22 裁決）`);
      } else {
        fail("CP-02", `標籤來源「${row.tagSource ?? "缺"}」非法（僅 ${TAG_SOURCES.join("/")}）`);
      }
      // 標籤內折數/元價宣稱驗自身活動池
      checkCopyTruth(row.tag, `標籤`, ownPromo ? [ownPromo] : allPromos, new Set([src.disc].filter(Boolean)), new Set([src.price]));
    }

    // CP-03 寬度
    if (row.tag && textWidth(row.tag, TAG_FONT_PX) > TAG_BUDGET_PX) fail("CP-03", `標籤「${row.tag}」超寬（${Math.round(textWidth(row.tag, TAG_FONT_PX))}px > ${TAG_BUDGET_PX}px）`);
    if (row.kvShortName && textWidth(row.kvShortName, KVNAME_FONT_PX) > KVNAME_BUDGET_PX) fail("CP-03", `KV 縮寫名「${row.kvShortName}」超寬`);
    const inHeroSlot = heroSlotGdids.has(String(row.gdid));
    if (row.heroName && !inHeroSlot) add("INFO", "CP-03", `[${row.gdid}] 主視覺標題殘值「${row.heroName}」——這件商品已不在主視覺槽，畫面不會用到、未驗（v20；換品／移除時編輯器會清，這是舊稿殘留）`);
    if (row.heroName && inHeroSlot && textWidth(row.heroName, HERONAME_FONT_PX) > HERONAME_BUDGET_PX) fail("CP-03", `主視覺商品標題「${row.heroName}」太長（兩行放不下）——請縮短`);/* 顯示名＝人工可編（沿 kvShortName 前例只驗寬度與文案，不做真值逐字比對；products[].name 仍逐字＝來源） */

    // CP-13 文案工程字串（U13，2026-07-20）：✍️ 欄＝標籤／KV 縮寫名
    checkEngCopy(row.tag, `[${row.gdid}] 標籤`);
    checkEngCopy(row.kvShortName, `[${row.gdid}] KV 縮寫名`);
    if (inHeroSlot) checkEngCopy(row.heroName, `[${row.gdid}] 主視覺商品標題`);

    // CP-04 網域
    if (row.url && !checkUrl(row.url, "link")) fail("CP-04", `連結網域非法`);
    for (const [k, kind] of [["img", "img"], ["sceneImg", "img"]]) {
      if (row[k] && !checkUrl(row[k], kind)) fail("CP-04", `${k} 圖片網域非法`);
    }
    rowResults.push(issues.length ? "⚠ " + issues.join("；") : "OK");
  }

  /* ---------- P1 頁面級 ---------- */
  const kv = draft.page.kv || {};
  const kvPromo = kv.actid ? promoOf(kv.actid) : null;
  const imgOverrides = draft.assets?.moduleImages || {}; // 人工覆寫通道：promoEntryN（U2 CP-08）／kvImageN（U10 CP-11）

  // KV 主軸 actid＋檔期＋折數：綁同一活動（契約 C6＝KV 主軸 actid 之檔期；禁跨活動拼裝）
  if (kv.dateValue || (norm(kv.titleLine1 + " " + kv.titleLine2).match(KV_TITLE_DISCOUNT_RE))) {
    /* 真值槽人工填寫制（2026-08-25 使用者裁決）：新版式（layout-*）抓不到主軸檔期＝開放人填——
       無主軸可核對＝INFO 揭示人工填寫（非 FAIL）；有主軸＝下方逐字核對照舊（真值保護不鬆）。
       legacy 頁＝原條文原樣（KV 文案綁主軸活動）。 */
    if (!kv.actid) {
      const _v2kv = /^layout-\d{3}$/.test(normalizeKvVariant(draft.page.kvVariant) || ""); // P1 區域自算（CP-25 區的同名 const 不在此作用域）
      if (_v2kv && kv.dateValue) add("INFO", "CP-02", `活動時間「${kv.dateValue}」＝人工填寫（這檔沒有可核對的主軸活動檔期；真值鐵律＝AI 不代填）——上線前請自行核對`);
      else add("FAIL", "CP-02", "KV 含折數/檔期但未指定主軸 actid（無法綁定驗證）");
    }
    else if (!kvPromo) add("FAIL", "CP-02", `KV 主軸 actid ${kv.actid} 不存在於快照`);
  }
  if (kv.dateValue && kvPromo && !periodMatch(kv.dateValue, kvPromo.period)) {
    add("FAIL", "CP-02", `KV 檔期「${kv.dateValue}」≠ 主軸活動 ${kv.actid} 檔期「${kvPromo.period}」`);
  }
  // KV 文案折數/元價：僅能以主軸活動＋其商品池為據
  const kvPromoPool = kvPromo ? [kvPromo] : allPromos;
  const kvDiscs = kvPromo ? discsOf(kv.actid) : allDiscs;
  const kvPrices = kvPromo ? new Set(snap.products.filter((p) => p.actid === kv.actid).map((p) => p.price)) : allPrices;
  checkCopyTruth(kv.eyebrow, "KV 眉標(拉丁)", kvPromoPool, kvDiscs, kvPrices);
  checkCopyTruth(kv.eyebrowZh, "KV 眉標(中文)", kvPromoPool, kvDiscs, kvPrices);
  checkCopyTruth(kv.titleLine1, "KV 標題第一行", kvPromoPool, kvDiscs, kvPrices);
  checkCopyTruth(kv.titleLine2, "KV 標題第二行", kvPromoPool, kvDiscs, kvPrices);
  checkCopyTruth(draft.page.ctaText, "CTA", allPromos, allDiscs, allPrices);

  // 起字鐵律（正規化後判斷）
  if (kv.showSuffix && !PRICE_SEMANTIC_RE.test(norm(kv.titleLine2 || ""))) {
    add("FAIL", "CP-02", "起字顯示=是，但標題第二行無價格優惠語意（鐵律）");
  }

  // CP-13 文案工程字串（U13，2026-07-20）：KV／CTA／頁尾 ✍️ 文案欄掃描
  for (const [t, l] of [
    [kv.eyebrow, "KV 眉標(拉丁)"], [kv.eyebrowZh, "KV 眉標(中文)"], [kv.eyebrowCnMobile, "KV 眉標(mobile)"],
    [kv.titleLine1, "KV 標題第一行"], [kv.titleLine2, "KV 標題第二行"],
    [draft.page.ctaText, "CTA"], [draft.page.footerTitle, "頁尾標題"],
  ]) checkEngCopy(t, l);
  // v12（2026-07-23 ②③定案）：editorial.title 三行＋explore ctaText＝✍️ 文案欄——工程字串（CP-13）＋折數/元價真值（CP-02）照掃
  (Array.isArray((draft.page.editorial || draft.editorial)?.title) ? (draft.page.editorial || draft.editorial).title : []).forEach((t, i) => {
    checkEngCopy(t, `編輯精選標題 行${i + 1}`); checkCopyTruth(t, `編輯精選標題 行${i + 1}`, allPromos, allDiscs, allPrices);
  });
  if (draft.page.explore?.ctaText) { checkEngCopy(draft.page.explore.ctaText, "探索 CTA"); checkCopyTruth(draft.page.explore.ctaText, "探索 CTA", allPromos, allDiscs, allPrices); }

  /* v2 頁（layout-*）＝舊 KV 商品槽（keyProductGdids）與三圓圖（kv.images）休眠、畫面不渲染——
     14 §2.13 早有口徑「v2 頁 kv 節點休眠＝不算在場」，productCheck 與 CP-18 曝光都已照辦，
     這一段沒跟上＝驗一個畫面上不存在的節點。病例＝2026-09-30 使用者親測同事包（wb-174316，layout-002）：
     hero 四槽全過，休眠 kv.images[1] 留著一張不在快照圖庫的舊圖 ⇒ CP-11 FAIL；
     而「去修」指的主視覺用圖下拉改的是 page.hero、動不到休眠 kv ⇒ 使用者永遠修不掉。
     修＝v2 頁整段跳過；跳過要出聲（INFO），不靜默（鐵律 3）。文字類 kv 欄（標題/檔期）不在此列——
     它們在 v2 仍有人工填寫制條文（見上方 2026-08-25 段），照舊。 */
  const _kvDormantSlots = /^layout-\d{3}$/.test(normalizeKvVariant(draft.page.kvVariant) || "");
  if (_kvDormantSlots) {
    if ((kv.keyProductGdids || []).length || (kv.images || []).some(Boolean))
      add("INFO", "CP-11", "新版式頁：舊 KV 商品槽與圓圖（休眠、不渲染）不列入檢查——主視覺商品與圖的真值由 hero 槽照常把關");
  } else {
  // KV 主打商品 ×3：存在於快照＋存在於 P2（契約 D4-D6「自 P2 選 3 件」）
  const keyGdids = kv.keyProductGdids || [];
  if (keyGdids.length !== KV_KEY_PRODUCTS) add("WARN", "CP-02", `KV 主打商品應為 ${KV_KEY_PRODUCTS} 件，現為 ${keyGdids.length} 件`);
  keyGdids.forEach((g, i) => {
    if (!byGdid.has(g)) add("FAIL", "CP-02", `KV 主打 #${i + 1} gdid ${g} 不存在於快照`);
    else if (!draftGdids.has(g)) add("FAIL", "CP-02", `KV 主打 #${i + 1} gdid ${g} 不在 P2 商品列`);
  });
  // CP-11 KV 圖源（U10⑩，2026-07-20）：KV 三圓圖（D1-D3）一律＝各主打商品池 imgs[1]（購物中心商品頁
  // 商品圖第二張＝白底語意，與 02 §10 商品卡第二張對齊）；池僅 1 張圖＝容 imgs[0]＋WARN；
  // 人工主題素材覆寫（assets.moduleImages.kvImageN，如 LC Theme-img 覆寫級）＝放行記 INFO；網域仍必須合法
  (kv.images || []).forEach((u, i) => {
    if (!u) return;
    const n = i + 1;
    if (!checkUrl(u, "img")) add("FAIL", "CP-04", `KV 圖 #${n} 網域非法`);
    const ov = imgOverrides[`kvImage${n}`];
    if (ov && u === ov) { add("INFO", "CP-11", `KV 圖 #${n} 採人工主題素材覆寫（${KV_IMG_OVERRIDE_PATH.replace(/N$/, String(n))}）——放行`); return; }
    const gallery = byGdid.get(keyGdids[i])?.imgs || [];
    if (!gallery.length) { add("WARN", "CP-11", `KV 圖 #${n} 對應主打商品無圖庫可驗（gdid 缺席或池外）——不可溯源`); return; }
    /* 2026-07-25 使用者裁決（二次放寬）＝KV 圖「不作為檢查項目」：AI 策展預設第二張白底，但使用者可自由選商品圖庫
       任一張（介面開放前 5 張），選圖本身不判 WARN/FAIL。僅保留真值保護＝KV 圖必須是該主打商品圖庫內的圖（防捏造）。 */
    if (gallery.includes(u)) {
      /* 圖庫內任一張＝使用者自由選擇，通過（不作為檢查項目） */
    } else {
      add("FAIL", "CP-11", `KV 圖 #${n} 不是主打商品的商品圖（真值：KV 圖須取自該商品的商品頁圖庫）——用「🔄 更替」重取，或於用圖下拉改選`);
    }
  });
  } /* ← v2 休眠守衛閉合（_kvDormantSlots） */

  /* ---------- 本期活動入口（promoEntries）：2026-07-20 U1/U2/U3/U5 裁決 ---------- */
  const entries = draft.page.promoEntries || [];
  const buildTime = Date.now(); // U3（2026-07-20）：「建置時刻取執行當下」

  /* --- CP-15 入口數量（U17⑰，2026-07-20；2026-08-26 使用者裁決＝上限 4→12）：「本期活動」內容數量＝3~12 則 ---
   * 有效項（具 url/actid）<3 或 >12＝FAIL；<3 訊息載明遞補義務（U8 三層優先序遞補後仍不足才成立）；
   * 恰 3 則＝INFO 記 3 則版型（間距不變、圓形圖與標題模組背景寬度等比放大、字級不變——渲染側 09 §2.10；
   * mobile 2×2 流式 2+1 尺寸不變＝預設、09 §4.2 G-C10 開放項）——規則預備態：資料驅動觸發、自測可模擬驗證；
   * promoEntries 欄位缺席＝04 §7 第 3 層整模組隱藏語意（商品池不足編組）＝略過不誤殺（沿 editorial 缺席慣例） --- */
  if (!draft.page.promoEntries) {
    add("INFO", "CP-15", "promoEntries 欄位缺席——視同 04 §7 第 3 層整模組隱藏（商品池不足編組），U17 數量規則略過（模組缺席＝不誤殺）");
  } else {
    const validEntryCount = entries.filter((e) => e && typeof e === "object" && (e.url || e.actid)).length;
    if (validEntryCount < PROMO_ENTRY_COUNT.min) {
      add("FAIL", "CP-15", `本期活動放 ${PROMO_ENTRY_COUNT.min}~${PROMO_ENTRY_COUNT.max} 則——目前 ${validEntryCount} 則，少於下限 ${PROMO_ENTRY_COUNT.min}（U17：不得少於 3 則——遞補義務：依 U8 三層優先序 1.優惠活動→2.品牌商品推薦→3.商品替補 遞補補滿；遞補後仍不足＝FAIL）`);
    } else if (validEntryCount > PROMO_ENTRY_COUNT.max) {
      add("FAIL", "CP-15", `本期活動放 ${PROMO_ENTRY_COUNT.min}~${PROMO_ENTRY_COUNT.max} 則——目前 ${validEntryCount} 則，超過上限 ${PROMO_ENTRY_COUNT.max}（U17 原上限 4；2026-08-26 使用者裁決放寬至 ${PROMO_ENTRY_COUNT.max}，不得再超編）`);
    } else if (validEntryCount === PROMO_ENTRY_COUNT.min) {
      add("INFO", "CP-15", `本期活動恰 ${PROMO_ENTRY_COUNT.min} 則——觸發 3 則版型：保持內容間距不變、圓形圖與標題模組背景寬度等比放大、活動標題字級不變（U17；渲染側 09 §2.10；mobile 2×2 流式 2+1 尺寸不變＝預設）`);
    }
  }
  const themeFit = loadThemeFit(); // U14（2026-07-20）：主題契合閘詞組＋門檻（校準檔優先，否則抽頂預設）
  /* 2026-07-25 工程 QA 修：全池命中數改區域變數（原掛 themeFit._globalHits＝loadThemeFit 無校準檔時回傳共用常數
     THEME_FIT_DEFAULT 的參照，快取會跨 run 別名污染；雖現況單 run/process 不觸發，改區域變數杜絕潛在 bug） */
  const themeGlobalHits = (snap.products || []).filter((p) => { const t = norm(p.name || "").toLowerCase(); return themeFit.keywords.some((k) => t.includes(String(k).toLowerCase())); }).length;
  const firstProdOfAct = (actid) => snap.products.find((p) => p.actid === actid);
  const prodByGdsaleId = new Map(); // gdsale 商品頁 id → 商品池商品（gdid 對映；v13 修＝兩式並收：slug 尾碼＋?gdid= query，對齊 CP-18 idOfUrl 慣例——商品型入口首次實戰打到）
  const gdsaleIdOf = (u) => { const m = (gdsalePath(u) || "").match(GDSALE_ID_RE); if (m) return m[1]; const q = String(u || "").match(/[?&]gdid=(p\d{8,18}|\d{6,})/i); return q ? q[1] : null; }; /* p 型編號 2026-08-28（使用者實測 gdid=p0216265344571：gdsale.asp 形有 SSR、p-*.html 形 404——p 型一律走 gdsale.asp、數字型照舊） */
  for (const p of snap.products) {
    const key = gdsaleIdOf(p.url);
    if (key && !prodByGdsaleId.has(key)) prodByGdsaleId.set(key, p);
  }

  // CP-06 首件（U1①，2026-07-20）：「同一模組內不得出現同一活動 actid/同一 URL＝Blocking（0 容忍，
  // Q3 定案：warning 級距取消）」——本段掃模組內部；跨模組（編輯精選 × 本期活動）由下方 U11 擴充段把關
  //（U1 原「跨模組 refEntry 引用屬設計語意、允許保留」的範圍限定已被同日 U11⑪ 推翻）
  const seenActid = new Map(), seenNormUrl = new Map();
  const entryIsManual = (e) => e && e.entrySource === "manual"; // v13（2026-07-23 裁決）：人工入稿則級身份
  entries.forEach((e, i) => {
    const n = i + 1;
    const dupLv = (j) => (entryIsManual(e) || entryIsManual(entries[j - 1])) ? "WARN" : "FAIL"; // manual 涉入＝降提示（使用者評斷）
    if (e.actid) {
      if (seenActid.has(e.actid)) add(dupLv(seenActid.get(e.actid)), "CP-06", `入口 #${n} actid ${e.actid} 與入口 #${seenActid.get(e.actid)} 重複（同模組 0 容忍${entryIsManual(e) || entryIsManual(entries[seenActid.get(e.actid) - 1]) ? "；人工入稿涉入＝降提示、由使用者確認" : ""}）`);
      else seenActid.set(e.actid, n);
    }
    const nu = normalizeUrl(e.url);
    if (nu) {
      if (seenNormUrl.has(nu)) add(dupLv(seenNormUrl.get(nu)), "CP-06", `入口 #${n} URL 與入口 #${seenNormUrl.get(nu)} 重複（正規化比對，忽略 query 順序；同模組 0 容忍${entryIsManual(e) || entryIsManual(entries[seenNormUrl.get(nu) - 1]) ? "；人工入稿涉入＝降提示、由使用者確認" : ""}）`);
      else seenNormUrl.set(nu, n);
    }
    // CP-13（U13，2026-07-20）：入口 ✍️ 文案欄（chip/copy）工程字串掃描——各型入口一體適用（含 manual）
    checkEngCopy(e.chip, `入口 #${n} chip`);
    checkEngCopy(e.copy, `入口 #${n} 文案`);
  });

  /* --- CP-06 擴充（U11⑪，2026-07-20）：跨模組去重「編輯精選 × 本期活動」——editorial.circles（等價欄位）
   * 之 actid/url 與 promoEntries 現用項重複＝FAIL；重複時依內容讀取順序（U8 三層優先序）取「本期活動未使用」
   * 的下一批項目，且須符合 AI 策展主題模組（推翻 U1 跨模組允許保留）；模組缺席＝略過不誤殺 --- */
  const circles = editorialCircles(draft);
  const circleNormUrls = new Map(); // 供 CP-12 跨模組比對
  circles.forEach((c, i) => {
    if (!c || typeof c !== "object") return;
    const n = i + 1;
    const ca = c.actid != null && c.actid !== "" ? String(c.actid) : null;
    if (ca && seenActid.has(ca)) {
      add("FAIL", "CP-06", `編輯精選圓 #${n} actid ${ca} 與本期活動入口 #${seenActid.get(ca)} 重複（U11 跨模組去重：依內容讀取順序改取「本期活動未使用」的下一批項目，並符合策展主題）`);
    }
    const nu = normalizeUrl(c.url);
    if (nu) {
      if (seenNormUrl.has(nu)) { /* 指名道姓（2026-10-07）：從 URL 解出賣場編號→商品名＋gd 錨（去修靠它閃兩處） */
        const cg = String(c.url || "").match(/[?&]gdid=(\d+)|-(\d{6,9})\.html/);
        const cgd = cg ? (cg[1] || cg[2]) : null;
        add("FAIL", "CP-06", `編輯精選圓 #${n} 與本期活動入口 #${seenNormUrl.get(nu)} 連到同一個地方${cgd ? `：商品${nameOfGd(cgd)}（gd:${cgd}）` : "（URL 相同）"}（U11 跨模組去重）`);
      }
      if (!circleNormUrls.has(nu)) circleNormUrls.set(nu, n);
    }
    if (c.url) {
      if (!checkUrl(c.url, "link")) add("FAIL", "CP-04", `編輯精選圓 #${n} 連結網域非法`);
      else if (isBrandFilterUrl(c.url)) add("INFO", "CP-06", `編輯精選圓 #${n} 採品牌篩選導流（U15：brandIds 白名單合法形態——品牌維度、天然滿足 U11 不重複）`);
    }
    for (const k of EDITORIAL_COPY_KEYS) { checkEngCopy(c[k], `編輯精選圓 #${n} ${k}`); checkCopyTruth(c[k], `編輯精選圓 #${n} ${k}`, allPromos, allDiscs, allPrices); } // CP-13＋CP-02（真值＝v12 補，2026-07-23）
  });

  /* --- v12（2026-07-23 ②③定案）：延伸探索 items——文案（CP-13 工程字串＋CP-02 真值）＋網域（CP-04）
   * ＋同模組 URL 唯一（CP-12 語意）；CP-18 維持排除（分流入口設計語意；單品頁連結與曝光位撞 gdid＝頁側自測把關） --- */
  {
    const seenExUrl = new Map();
    ((draft.page.explore || {}).items || []).forEach((e, i) => {
      const n = i + 1;
      for (const k of ["label", "lbl", "sub"]) if (e?.[k] != null && e[k] !== "") {
        checkEngCopy(e[k], `探索卡 #${n} ${k}`); checkCopyTruth(e[k], `探索卡 #${n} ${k}`, allPromos, allDiscs, allPrices);
      }
      if (e?.url) {
        if (!checkUrl(e.url, "link")) add("FAIL", "CP-04", `探索卡 #${n} 連結網域非法`);
        const nu = normalizeUrl(e.url);
        if (nu) { if (seenExUrl.has(nu)) add("FAIL", "CP-12", `探索卡 #${n} URL 與探索卡 #${seenExUrl.get(nu)} 重複（同模組入口 URL 必唯一）`); else seenExUrl.set(nu, n); }
      } else add("WARN", "CP-02", `探索卡 #${n} 缺目的地 URL`);
    });
    const exMu = (draft.page.explore || {}).moreUrl;
    if (exMu && !checkUrl(exMu, "link")) add("FAIL", "CP-04", "探索 moreUrl 網域非法");
  }

  /* --- CP-12 樓層 URL 唯一（U12⑫，2026-07-20）：策展要把握每一個主題流量——floors[].sceneCard.url
   * 同模組重複＝FAIL（鈦案「鈦划算／鈦好喝」兩樓層同連一 URL＝違例）；與 promoEntries/editorial
   * 跨模組重複＝WARN；欄位缺席（現行 draft 樓層無 sceneCard）＝略過不誤殺 --- */
  const seenFloorUrl = new Map();
  (draft.page.floors || []).forEach((f, i) => {
    const u = f?.sceneCard?.url ?? f?.sceneUrl ?? null;
    const nu = normalizeUrl(u);
    if (!nu) return;
    const n = i + 1;
    if (!checkUrl(u, "link")) add("FAIL", "CP-04", `樓層 #${n}「${f.title}」情境卡連結網域非法`);
    if (seenFloorUrl.has(nu)) add("FAIL", "CP-12", `樓層 #${n}「${f.title}」URL 與樓層 #${seenFloorUrl.get(nu)} 重複（U12：同模組入口 URL 必唯一——策展要把握每一個主題流量）`);
    else seenFloorUrl.set(nu, n);
    if (seenNormUrl.has(nu)) add("WARN", "CP-12", `樓層 #${n}「${f.title}」URL 與本期活動入口 #${seenNormUrl.get(nu)} 跨模組重複（U12）`);
    if (circleNormUrls.has(nu)) add("WARN", "CP-12", `樓層 #${n}「${f.title}」URL 與編輯精選圓 #${circleNormUrls.get(nu)} 跨模組重複（U12）`);
  });

  /* --- CP-10 E0 一致性（U8⑧，2026-07-20）：本期活動來源三層優先序＝1.優惠活動→2.品牌商品推薦→3.商品替補 ---
   * draft page.promoSourceMode 缺值視為 auto；auto＝三層排序檢查（R2 升級）；
   * 強制單一模式＝全部入口同型否則 FAIL；brand-recommend 型須可溯源品牌頁推薦清單（hotSales/hits） */
  const promoSourceMode = draft.page.promoSourceMode || "auto";
  if (!PROMO_SOURCE_MODES.includes(promoSourceMode)) {
    add("FAIL", "CP-10", `E0 promoSourceMode「${promoSourceMode}」非法（僅 ${PROMO_SOURCE_MODES.join("|")}）——以下暫依 auto 檢查`);
  }
  const entryTypes = entries.map(entryType);
  const entryCatsAll = entryTypes.map((t) => ENTRY_CATEGORY_OF[t] || "product");
  // v13：manual 則不計入同質判定（2026-07-23 裁決＝手動允許混型、提示不阻擋）；保留原始索引供訊息編號
  const autoCatPairs = entryCatsAll.map((c, i) => ({ c, i })).filter((p) => !entryIsManual(entries[p.i]));
  const entryCats = autoCatPairs.map((p) => p.c);
  const manualCount = entries.filter(entryIsManual).length;
  if (manualCount) {
    add("INFO", "CP-17", `模組含人工入稿 ×${manualCount}——型別同質判定僅計自動來源則；混型由使用者確認（2026-07-23 裁決：標題與內容說得通即可）`);
  }

  /* --- CP-17 型別同質（U19⑲，2026-07-20）：選品邏輯不得混用（單一來源制）——promoEntries 內活動型與
   * 商品型（含品牌推薦型）混用＝FAIL（取代原 R2 混填排序 WARN——U5 混填制／U8 auto 混填語意／U17 補位語意
   * 於 U19 修訂）；純活動或純商品＝PASS；v13＝manual 則已排除於判定 --- */
  if (entryCats.includes("activity") && entryCats.includes("product")) {
    const actIdx = autoCatPairs.flatMap((p) => (p.c === "activity" ? [`#${p.i + 1}`] : []));
    const prodIdx = autoCatPairs.flatMap((p) => (p.c === "product" ? [`#${p.i + 1}（${entryTypes[p.i]}）`] : []));
    add("FAIL", "CP-17", `本期活動模組內型別混用：活動型入口 ${actIdx.join("、")} × 商品型入口 ${prodIdx.join("、")}（U19 單一來源制：模組內容必須單一型別——同一層可湊滿 ≥${PROMO_LAYER_MIN} 則（U17 下限）才採用該層；在線契合活動 <${PROMO_LAYER_MIN} → 整組降到第 2 層品牌商品推薦、仍 <${PROMO_LAYER_MIN} → 整組第 3 層商品替補，不跨層補位）`);
  }

  // CP-17 標題同型（輕量，U19+U16 連動）：entries 全商品型而 promoModuleTitle 含「本期活動」前綴或
  // 優惠數字詞＝FAIL（純商品/品牌推薦內容＝ai-curated 策展命名，「本期活動」四字消失）；欄位缺席＝略過
  const promoModuleTitle = draft.page.promoModuleTitle;
  if (promoModuleTitle && entryCats.length && entryCats.every((c) => c === "product") && PROMO_TITLE_TRUTH_RE.test(norm(promoModuleTitle))) {
    // v13：全 manual＝entryCats 空不觸發（標題交使用者確認）；含 manual 混入＝維持檢自動側組成
    add(manualCount ? "WARN" : "FAIL", "CP-17", `promoModuleTitle「${promoModuleTitle}」為 promo-truth 型（含「本期活動」前綴或優惠數字詞）但自動來源入口全為商品/品牌推薦型——標題須與內容同型（U19+U16：純商品內容＝ai-curated 策展命名、「本期活動」四字消失；純活動內容才用優惠真值標題${manualCount ? "；含人工入稿＝降提示、由使用者確認" : ""}）`);
  }

  if (promoSourceMode === "manual") {
    add("INFO", "CP-10", "E0=manual（人工手動入稿模式，2026-07-23 使用者裁決）——層一致性/溯源檢查豁免；資料正確性由使用者確認、網域與寬度照檢");
  } else if (!PROMO_SOURCE_MODES.includes(promoSourceMode) || promoSourceMode === "auto") {
    /* --- CP-10 連動（U19⑲，2026-07-20）：auto 語意改為「取可滿足 ≥3 則的最高優先層」——entries 全商品型
     * 且快照可判定在線契合活動 ≥3＝WARN 應採更高優先層；不可判定（無商品池/無到期依據之活動不計）＝略過
     *（原 R2 三層混填排序 WARN 已由 CP-17 單一來源制取代） --- */
    if (entries.length && entryCats.every((c) => c === "product")) {
      const fitOnline = (snap.promotions || []).filter((p) => {
        const pool = snap.products.filter((x) => x.actid === p.actid);
        if (!pool.length) return false; // 無商品池＝契合不可判定，不計（保守略過）
        const hits = pool.filter((x) => { const t = norm(x.name).toLowerCase(); return themeFit.keywords.some((k) => t.includes(k.toLowerCase())); }).length;
        if (hits / pool.length < themeFit.threshold) return false; // 不契合＝不計（U14）
        let endMs = null;
        if (p.endTs) endMs = p.endTs * 1000;
        else {
          const m = String(p.period || "").match(PERIOD_TAIL_RE);
          if (m) endMs = Date.UTC(+(m[4] || m[1]), +m[5] - 1, +m[6], 23, 59, 59) - TAIPEI_UTC_OFFSET_MIN * 60000;
        }
        if (endMs == null) return false; // 到期不可判定＝不計（保守略過）
        return endMs >= buildTime; // 在線＝未過期（U3 語意）
      });
      if (fitOnline.length >= PROMO_LAYER_MIN) {
        add("WARN", "CP-10", `E0=auto 且入口全為商品/品牌推薦型，但快照在線契合活動 ${fitOnline.length} 個 ≥ ${PROMO_LAYER_MIN}——應採更高優先層（U19 auto 語意＝取可滿足 ≥${PROMO_LAYER_MIN} 則的最高優先層：第 1 層優惠活動可成組；actid：${fitOnline.slice(0, 6).map((p) => p.actid).join("、")}）`);
      }
    }
  } else {
    entryTypes.forEach((t, i) => {
      if (entryIsManual(entries[i])) return; // v13：manual 則不受強制單一來源約束
      if (t !== promoSourceMode) add("FAIL", "CP-10", `E0=${promoSourceMode}（強制單一來源）但入口 #${i + 1} 為 ${t} 型——全部入口須同型`);
    });
  }
  // brand-recommend 溯源：快照有 hotSales/hits → 比對 gdid；無 → WARN 記不可溯源（v13：manual 則豁免）
  const brandRec = brandRecommendGdids(snap);
  entries.forEach((e, i) => {
    if (entryIsManual(e)) return;
    if (entryTypes[i] !== "brand-recommend") return;
    const bId = gdsaleIdOf(e.url); // v13 修：兩式並收
    const gdid = e.gdid || (bId ? prodByGdsaleId.get(bId)?.gdid : null);
    if (!brandRec.found) add("WARN", "CP-10", `入口 #${i + 1}（brand-recommend 型）快照無品牌頁推薦清單（${BRAND_RECOMMEND_KEYS.join("/")}）——不可溯源，記錄放行`);
    else if (!gdid || !brandRec.gdids.has(String(gdid))) add("FAIL", "CP-10", `入口 #${i + 1}（brand-recommend 型）的商品${gdid ? nameOfGd(gdid) : ""}（gdid ${gdid ?? "無法取得"}）不在品牌頁推薦清單（${BRAND_RECOMMEND_KEYS.join("/")}）`);
  });

  // CP-08 入口圖確定性（U2②，2026-07-20）：「活動入口圖預設＝該活動 URL 商品池第一件商品的第一張商品圖
  // （imageSet[0][0]）；活動 banner 降為人工覆寫級（assets.moduleImages.promoEntryN 通道）」
  const checkEntryImg = (e, n, expected, who) => {
    if (!e.img) return;
    if (!checkUrl(e.img, "img")) add("FAIL", "CP-04", `入口 #${n} 圖網域非法`);
    const ov = imgOverrides[`promoEntry${n}`];
    if (ov && e.img === ov) { add("INFO", "CP-08", `入口 #${n} 圖採人工覆寫（${ENTRY_IMG_OVERRIDE_PATH.replace(/N$/, String(n))}）——放行`); return; }
    if (!expected) add("FAIL", "CP-08", `入口 #${n} ${who}無首圖可為確定性預設，且無人工覆寫（${ENTRY_IMG_OVERRIDE_PATH}）`);
    else if (e.img !== expected) add("FAIL", "CP-08", `入口 #${n} 圖 ≠ ${who}首圖 imgs[0]（U2 確定性預設；banner 不再是合法預設，覆寫須走 ${ENTRY_IMG_OVERRIDE_PATH}）`);
  };

  entries.forEach((e, i) => {
    const n = i + 1;
    /* v13（2026-07-23 使用者裁決）：人工手動入稿＝資料正確性交使用者確認——豁免逐字真值/圖源/過期/契合；
     * 照檢＝網域硬邊界（CP-04）＋工程字串（前段已掃）；寬度＝UI 層把關 */
    if (entryIsManual(e)) {
      add("INFO", "CP-02", `入口 #${n}＝人工手動入稿（entrySource=manual）——資料正確性由使用者確認（2026-07-23 裁決）；網域/工程字串/寬度照檢`);
      if (e.url && !checkUrl(e.url, "link")) add("FAIL", "CP-04", `入口 #${n} 連結網域非法（人工入稿限購物中心站內 tw.buy.yahoo.com／tw.promo.yahoo.com＝2026-07-23 硬邊界、2026-10-05 擴 promo）`);
      if (e.img && !checkUrl(e.img, "img")) add("FAIL", "CP-04", `入口 #${n} 圖網域非法`);
      return;
    }
    const gdPath = gdsalePath(e.url);
    if (gdPath) {
      /* --- CP-09 商品型入口（U5⑤，2026-07-20）：「連商品頁（僅限單品詞，chip/文案禁優惠與檔期詞彙）、
       * 圖＝該商品第一張商品圖、無檔期列（dateValue 空＝隱藏）」——不查 promoOf(actid)；
       * brand-recommend 型同為商品頁目的地，本節單品詞/無檔期/首圖規則一體適用（溯源另由 CP-10 把關） --- */
      const gid = gdsaleIdOf(e.url); // v13 修：兩式並收（slug 尾碼＋?gdid= query）
      const src = gid ? prodByGdsaleId.get(gid) : null;
      if (!src) add("FAIL", "CP-09", `入口 #${n} 商品型 url 無法抽出 gdsale id 或不在商品池 products[]`);
      if (e.dateValue) add("FAIL", "CP-09", `入口 #${n} 商品型入口 dateValue 必須為空（U5：無檔期列，空＝隱藏），現為「${e.dateValue}」`);
      for (const [k, label] of [["chip", "chip"], ["copy", "文案"]]) {
        const t = norm(e[k] || "");
        if (!t) continue;
        if (ENTRY_PROMO_BAN_RE.test(t)) add("FAIL", "CP-09", `入口 #${n} ${label}「${e[k]}」含優惠詞（U5：僅限單品詞，禁優惠與檔期詞彙）`);
        if (ENTRY_PERIOD_BAN_RE.test(t)) add("FAIL", "CP-09", `入口 #${n} ${label}「${e[k]}」含檔期詞（U5：僅限單品詞，禁優惠與檔期詞彙）`);
      }
      checkEntryImg(e, n, src?.imgs?.[0], src ? `商品 ${src.gdid} ` : "商品 ");
      return;
    }

    /* --- 活動型入口：actid 存在＋標題/連結逐字＋檔期＋chip/文案數字驗真值（綁各自活動）
     * （R2 混填排序已移除——U19⑲ 單一來源制：型別同質由 CP-17 把關） --- */
    if (entryTypes[i] !== "promo-activity") {
      // 宣告為 brand-recommend/product 型但 url 非商品頁（gdsale）——無法按型驗證；溯源/同質已由 CP-10/CP-17 把關
      add("WARN", "CP-10", `入口 #${n} 宣告 ${entryTypes[i]} 型但 url 非商品頁（gdsale）——跳過活動型逐字驗證，僅溯源/同質檢查`);
      return;
    }
    const promo = promoOf(e.actid);
    if (!promo) { add("FAIL", "CP-02", `入口 actid ${e.actid} 不存在於快照`); return; }
    if (e.title && e.title !== promo.title) add("FAIL", "CP-02", `入口 ${e.actid} 標題與來源不符`);
    if (e.url && !sameProductUrl(e.url, promo.url)) add("FAIL", "CP-02", `入口 ${e.actid} 連結非來源逐字`); /* 同病同修（2026-10-04）：商品網址兩式等價；活動頁網址解不出賣場編號＝自動回退字串逐字，行為不變 */
    if (e.dateValue && !periodMatch(e.dateValue, promo.period)) add("FAIL", "CP-02", `入口 ${e.actid} 檔期與來源不符`);
    checkCopyTruth(e.chip, `入口 ${e.actid} chip`, [promo], discsOf(e.actid), allPrices);
    checkCopyTruth(e.copy, `入口 ${e.actid} 文案`, [promo], discsOf(e.actid), allPrices);

    // CP-07 過期（U3③，2026-07-20）：「活動過期＝內容失效，須更新為在線活動」——結束時刻早於建置時刻＝FAIL
    let endMs = null, endLabel = null;
    if (promo.endTs) { endMs = promo.endTs * 1000; endLabel = taipeiStr(endMs); }
    else {
      const m = String(e.dateValue || "").match(PERIOD_TAIL_RE);
      if (m) {
        const y = +(m[4] || m[1]), mo = +m[5], d = +m[6];
        endMs = Date.UTC(y, mo - 1, d, 23, 59, 59) - TAIPEI_UTC_OFFSET_MIN * 60000;
        endLabel = `${taipeiStr(endMs)}＝dateValue 尾日 23:59 推定`;
        add("WARN", "CP-07", `入口 #${n}（actid ${e.actid}）快照無 endTs，以 dateValue 尾日 23:59（台北）容差判定——來源不精確`);
      }
    }
    if (endMs != null && endMs < buildTime) {
      add("FAIL", "CP-07", `入口 #${n}（actid ${e.actid}）活動已過期：到期 ${endLabel}，早於建置時刻 ${taipeiStr(buildTime)}（U3：過期＝內容失效，須更新為在線活動）`);
    }

    // CP-14 主題契合閘（U14⑭，2026-07-20；v14 修訂＝2026-07-25 四題裁決 Q1-A/Q2-A/Q2-C）：
    // ①C 訊號（登記表既載「正式版＝標題映射＋B/C 併判」）：活動標題含主題詞＝契合成立、不再驗池命中率；
    // ②全池零命中＝詞組與商品名語域零交集（抽象主題 2-gram 家族）＝「比對不可施作」降 WARN 導向工作台詞組卡；
    // ③池 <5 件＝截斷抽樣無統計意義（1 件池實效門檻 100%）＝降 WARN 交人工；④池 ≥5 維持 B 訊號硬判。
    /* 判定邏輯搬到 lib/theme_fit.js entryFitVerdict（一把尺；curate_auto 挑入口時用同一支預先過濾＝系統自己挑的不再被自己判不合格，
       ENTRY-THEMEFIT-SELF-CHECK 2026-09-28；病例 140838 入口 #3 5%＜30%）。訊息與等級一字不改；strictActid 保留本檔原本的嚴格比對。 */
    const fitV = themeFitLib.entryFitVerdict({ actid: e.actid, title: e.title, snap, themeFit, themeGlobalHits, norm, strictActid: true });
    if (fitV.kind === "title") {
      add("INFO", "CP-14", `入口 #${n}（actid ${e.actid}）C 訊號成立：活動標題含主題詞＝契合通過（v14 B/C 併判；2026-07-25 裁決）`);
    } else if (fitV.kind === "no-pool") {
      add("WARN", "CP-14", `入口 #${n}（actid ${e.actid}）快照無該活動商品池——主題契合不可溯源（U14）`);
    } else if (fitV.kind === "no-global-hit") {
      add("WARN", "CP-14", `入口 #${n}（actid ${e.actid}）主題詞組與全池商品名零命中＝契合比對不可施作（v14 降級；2026-07-25 裁決 Q1-A）——請在工作台「主題詞組」卡改為商品名會出現的字（品類/品牌/規格詞）後重跑檢查`);
    } else if (fitV.kind === "small-pool") {
      add("WARN", "CP-14", `入口 #${n}（actid ${e.actid}）商品池僅 ${fitV.total} 件（<5＝樣本不足，命中 ${fitV.hits}/${fitV.total}）＝不做硬判、請人工確認該檔與主題是否相關（v14；2026-07-25 裁決 Q2-A）`);
    } else if (fitV.kind === "fail") {
      add("FAIL", "CP-14", `入口 #${n}（actid ${e.actid}）主題契合率 ${Math.round(fitV.rate * 100)}%（${fitV.hits}/${fitV.total}）＜門檻 ${Math.round(themeFit.threshold * 100)}%（U14：出現在來源頁活動列表≠主題契合——不契合一律不入選；契合不足額依 U8 三層混填）｜詞組來源：${themeFit.source}`);
    }

    checkEntryImg(e, n, firstProdOfAct(e.actid)?.imgs?.[0], `actid ${e.actid} 商品池首件商品`);
  });

  // 樓層/牆：標題副標數字驗真值＋gdid 存在性＋R1 件數建議範圍＋情境卡
  const zone = (arr, kind, lo, hi) => {
    for (const z of arr || []) {
      checkCopyTruth(z.title, `${kind}「${z.title}」標題`, allPromos, allDiscs, allPrices);
      checkCopyTruth(z.subtitle, `${kind}「${z.title}」副標`, allPromos, allDiscs, allPrices);
      for (const k of ["tag", "title", "sub"]) checkCopyTruth(z.sceneCopy?.[k], `${kind}「${z.title}」情境卡文案`, allPromos, allDiscs, allPrices);
      // CP-13（U13⑬，2026-07-20）：樓層/牆 ✍️ 文案欄工程字串掃描（標題/副標/情境卡）
      checkEngCopy(z.title, `${kind}「${z.title}」標題`);
      checkEngCopy(z.subtitle, `${kind}「${z.title}」副標`);
      for (const k of ["tag", "title", "sub"]) checkEngCopy(z.sceneCopy?.[k], `${kind}「${z.title}」情境卡文案(${k})`);
      const gds = z.productGdids || [];
      if (gds.length < lo || gds.length > hi) add("WARN", "R1", `${kind}「${z.title}」商品 ${gds.length} 件（建議 ${lo}~${hi}）`);
      for (const g of gds) {
        if (!byGdid.has(g)) add("FAIL", "CP-02", `${kind}「${z.title}」引用不存在的 gdid ${g}`);
        else if (!draftGdids.has(g)) add("FAIL", "CP-02", `${kind}「${z.title}」引用的 gdid ${g} 不在 P2`);
      }
      if (z.sceneImg) {
        if (!checkUrl(z.sceneImg, "img")) add("FAIL", "CP-04", `${kind}「${z.title}」情境卡圖網域非法`);
        // v12 修（2026-07-23）：情境卡代表品不入卡列（07-22 結構）＝比對須含代表品圖庫，否則合規樓層必誤報 WARN（電吉他案 ×3 實證）
        const su = z?.sceneCard?.url ?? z?.sceneUrl;
        const repM = su ? String(su).match(/gdid=(p\d{8,18}|\d{6,})/i) || String(su).match(/[-p](\d{6,})\.html/) : null; /* p 型編號 2026-08-28（使用者實測 gdid=p0216265344571：gdsale.asp 形有 SSR、p-*.html 形 404——p 型一律走 gdsale.asp、數字型照舊） */
        const repImgs = repM ? (byGdid.get(repM[1])?.imgs || []) : [];
        const inFloor = gds.some((g) => (byGdid.get(g)?.imgs || []).includes(z.sceneImg)) || repImgs.includes(z.sceneImg);
        if (!inFloor) add("WARN", "CP-02", `${kind}「${z.title}」情境卡圖不在本樓層（含代表品）商品圖庫（人工覆寫？）`);
      }
    }
  };
  zone(draft.page.floors, ZONE_PRODUCT_RANGE.floors.label, ZONE_PRODUCT_RANGE.floors.min, ZONE_PRODUCT_RANGE.floors.max);
  zone(draft.page.walls, ZONE_PRODUCT_RANGE.walls.label, ZONE_PRODUCT_RANGE.walls.min, ZONE_PRODUCT_RANGE.walls.max);

  /* --- CP-16 品類牆數量（U18⑱，2026-07-20）：「編輯精選」下方以分類為切入點的模組（品類牆
   * CategoryGroup/categorySections）2 組 → 預設 3 組；Sheets 可選擇出現模組的數量；活動頁預設
   * 牆數值域＝CATEGORY_WALL_COUNT（2026-08-27 升版 1~3、可刪至 1 面；原 3~5）——超界＝FAIL；categoryWallCount 宣告≠實有＝FAIL；
   * 欄位缺席＝INFO 略過不誤殺（沿 CP-15 慣例）；牆標題同名（與樓層/其他牆）＝WARN
   * （dock 錨點撞名——dock 錨點隨牆數 6→7、已有橫滑 rail 機制） --- */
  const wallBox = categoryWalls(draft);
  if (!wallBox) {
    add("INFO", "CP-16", `品類牆欄位缺席（${WALL_CONTAINER_KEYS.join("/")}）——U18 數量規則略過（模組缺席＝不誤殺，沿 CP-15 慣例）`);
  } else {
    const wallCount = wallBox.walls.length;
    if (wallCount < CATEGORY_WALL_COUNT.min || wallCount > CATEGORY_WALL_COUNT.max) {
      add("FAIL", "CP-16", `品類牆 ${wallCount} 組超出 ${CATEGORY_WALL_COUNT.min}~${CATEGORY_WALL_COUNT.max} 範圍（U18：品類牆由 2 組更新為預設 ${CATEGORY_WALL_COUNT.default} 組——Sheets 可選擇出現模組的數量、活動頁預設至少曝光 ${CATEGORY_WALL_COUNT.min} 組至多 ${CATEGORY_WALL_COUNT.max} 組）`);
    }
    // 數量宣告欄一致性（Sheets 數量選擇欄）：宣告值與實有牆數不一致＝FAIL；欄位缺席＝略過不誤殺
    let declared = null, declaredKey = null;
    outer: for (const scope of [draft.page, draft]) {
      if (!scope || typeof scope !== "object") continue;
      for (const k of WALL_COUNT_FIELDS) if (scope[k] != null) { declared = scope[k]; declaredKey = k; break outer; }
    }
    if (declared != null && Number(declared) !== wallCount) {
      add("FAIL", "CP-16", `數量宣告 ${declaredKey}=${declared} 與實有品類牆 ${wallCount} 組不一致（U18：Sheets 數量選擇欄須與 ${wallBox.key}[] 實有牆數同步）`);
    }
    // 牆標題同名（與樓層/其他牆）＝WARN：dock 錨點撞名（dock 錨點隨牆數 6→7）
    const anchorTitles = new Map();
    (draft.page.floors || []).forEach((f, i) => {
      const t = norm(f?.title || "").trim();
      if (t && !anchorTitles.has(t)) anchorTitles.set(t, `樓層 #${i + 1}`);
    });
    wallBox.walls.forEach((w, i) => {
      const t = norm(w?.title || "").trim();
      if (!t) return;
      if (anchorTitles.has(t)) add("WARN", "CP-16", `品類牆 #${i + 1} 標題「${w.title}」與${anchorTitles.get(t)}同名（U18：dock 錨點撞名——錨點隨牆數 6→7、標題須可辨識）`);
      else anchorTitles.set(t, `品類牆 #${i + 1}`);
    });
  }

  /* --- CP-21 品類牆件數鐵律（U27㉗，2026-07-20 裁決／2026-07-21 落地）：每牆有效商品數 ∈ {4,8,12}
   * ＝一行四品陣列（8＝上下兩行、12＝三行）——違反＝FAIL（03 R1 牆件數 4~12 warning 語意升 Blocking 取代）；
   * 宣告欄 walls[].wallProductCount（等價 Sheets 牆N商品數）≠實數＝FAIL；欄位缺席＝略過不誤殺（沿 CP-15/16 慣例） --- */
  if (wallBox) {
    wallBox.walls.forEach((w, i) => {
      const n = (w?.productGdids || w?.wallProductRefs || w?.products || []).length;
      if (!n) return; // 空牆＝未啟用語意，數量由 CP-16 牆數層把關
      if (!WALL_PRODUCT_COUNT_ENUM.includes(n)) {
        /* 2026-10-05 使用者裁「照樓層模式」（v7 走查 #2）：原 FAIL 使「補一件」永遠違規——4→5 必經非法值，
           檢查規範跟功能自相矛盾、使用者被擋死。降提醒＝跟樓層同款（樓層件數從來只是 R1 建議 WARN）；
           湊滿話術沿 lib pick 回報句（4／8／12 最整齊、缺口在最後一排）。宣告≠實數那條仍 FAIL（資料自相矛盾是真錯）。 */
        const shortW = (4 - (n % 4)) % 4;
        add("WARN", "CP-21", `品類牆 #${i + 1}「${w.title || ""}」目前 ${n} 件——一行 4 件${shortW ? `，再加 ${shortW} 件湊滿一行` : ""}（${WALL_PRODUCT_COUNT_ENUM.join("／")} 件最整齊；不湊也能出貨，最後一行會留空位）`);
      }
      if (w?.wallProductCount != null && String(w.wallProductCount) !== "" && Number(w.wallProductCount) !== n) {
        add("FAIL", "CP-21", `品類牆 #${i + 1}「${w.title || ""}」宣告 wallProductCount=${w.wallProductCount} ≠ 實數 ${n}（U27：Sheets 牆N商品數欄須與該牆商品列實數一致）`);
      }
    });
  }
  /* v12（2026-07-23 ②③定案）：編輯精選牆件數＝U27 4 的倍數等價適用（products[].position=editorial-wall 列；
   * 商品真值/池存在性＝products[] 逐列迴圈既有覆蓋；0 件＝未啟用合法（loader 隱藏降級） */
  {
    const edN = (draft.products || []).filter((p) => p && p.position === "editorial-wall").length;
    if (edN && !WALL_PRODUCT_COUNT_ENUM.includes(edN)) {
      const shortE = (4 - (edN % 4)) % 4;
      add("WARN", "CP-21", `編輯精選牆目前 ${edN} 件——一行 4 件${shortE ? `，再加 ${shortE} 件湊滿一行` : ""}（${WALL_PRODUCT_COUNT_ENUM.join("／")} 件最整齊；不湊也能出貨。2026-10-05 裁「照樓層模式」降提醒）`);
    }
  }

  /* --- CP-18 全頁互斥（U22㉒，2026-07-20 裁決／2026-07-21 落地）：推薦模組內容全頁互斥（第三次擴圈
   * U1 同模組→U11 編輯精選×入口→U22 全頁）——同一識別子（gdid／actid／正規化 URL）曝光於兩個不同模組＝FAIL。
   * 曝光邊界＝KV 主打商品（kv.keyProductGdids）＋新版主視覺槽（page.hero[*].gdids，2026-09-26 起）／本期活動入口／樓層 scene 卡＋全部商品卡（2026-09-25 起；原前 3）
   * ／品類牆全卡／編輯精選圓（draft 有建模時）；排除＝position=editorial-wall 列（設計語意）、moreLink（CP-22 管）、
   * 探索分流入口（draft 未建模）；讓位序（修正指引）＝KV ＞ 入口 ＞ 樓層 ＞ 牆 --- */
  {
    const idOwners = new Map(); // identity → [module labels]
    const claim = (id, label) => { if (!id) return; const arr = idOwners.get(id) || []; arr.push(label); idOwners.set(id, arr); };
    const idOfUrl = (u) => { // 識別子正規化：actid ＞ gdid（gdsale 兩式：?gdid=／slug 尾碼）＞ 正規化 URL（U22 三維度）
      if (!u) return null;
      try {
        const x = new URL(u);
        const act = x.searchParams.get("actid"); if (act) return "act:" + act;
        const gq = x.searchParams.get("gdid"); if (gq) return "gd:" + gq;
        const gp = gdsalePath(u); if (gp) { const m = gp.match(GDSALE_ID_RE); if (m) return "gd:" + m[1]; }
      } catch { /* 不可解析 → 落 URL 維度 */ }
      return "url:" + normalizeUrl(u);
    };
    /* 商品名進訊息＝共用 nameOfGd（定義在檔頭 byGdid 旁，CP-06/CP-10/CP-18 同一份）。
       ⚠ 編修頁「去修」解析器認兩個錨：句頭「全頁互斥違反：gd:\d+」與句中任一處「gd:\d+」——名字只能附加、不能動這兩個錨。 */
    /* v21（2026-10-05 使用者裁）：主視覺（舊 KV 欄＋新版主視覺槽）改「提醒不阻擋」——主打商品本就常在下方再曝光一次，
       沿 2026-07-23 人工入稿入口同款：不入互斥 claim、事後軟比對 WARN 由使用者確認。v20「主視覺 #n 歸一個模組」的
       聚合隨之退役（不 claim 就沒有聚合問題）；主視覺槽內重複仍由編輯器換品門擋（只對照其他主視覺槽）。 */
    const heroSoftIds = new Map();
    (kv.keyProductGdids || []).forEach((g) => { if (g) heroSoftIds.set("gd:" + String(g), "KV 主打"); });
    for (const [slotKey, sv] of Object.entries(draft.page.hero || {})) { if (!sv || !Array.isArray(sv.gdids)) continue; for (const g of sv.gdids) { if (g) heroSoftIds.set("gd:" + String(g), `主視覺（${slotKey}）`); } }
    const manualPromoIds = []; // v13：人工入稿則＝不入互斥 claim、事後軟比對（提示不阻擋）
    (draft.page.promoEntries || []).forEach((e, i) => {
      const id = e?.actid ? "act:" + e.actid : (e?.url ? idOfUrl(e.url) : null);
      if (!id) return;
      if (e?.entrySource === "manual") { manualPromoIds.push([id, i + 1]); return; }
      claim(id, `入口 #${i + 1}`);
    });
    (draft.page.floors || []).forEach((f, i) => {
      const su = f?.sceneCard?.url ?? f?.sceneUrl; // 2026-07-23：補 sceneCard.url 等價形（CP-12 同款取值；14 號契約合法建模形）
      if (su) claim(idOfUrl(su), `樓層 #${i + 1} scene 卡`);
      (f?.productGdids || []).forEach((g, j) => claim("gd:" + g, `樓層 #${i + 1} 商品卡 ${j + 1}`)); // 2026-09-25：每張卡都算（原 slice 前 3）
    });
    (wallBox?.walls || []).forEach((w, i) => {
      if (PAGE_DEDUP_EXCLUDED_POSITIONS.includes(w?.position || w?.pos)) return; // v12：排除清單宣告落地（原僅登記表宣告；防 editorial-wall 建進 walls 誤計）
      (w?.productGdids || w?.wallProductRefs || []).forEach((g, j) => claim("gd:" + g, `品類牆 #${i + 1} 卡 ${j + 1}`));
    });
    editorialCircles(draft).forEach((c, i) => {
      if (c?.url) claim(idOfUrl(c.url), `編輯精選圓 #${i + 1}`);
      else if (c?.actid) claim("act:" + c.actid, `編輯精選圓 #${i + 1}`); // v12：actid-only 圓逃逸修（對齊入口 claim 行為）
    });
    for (const [id, owners] of idOwners) {
      /* 模組層級聚合（同模組內重複由 CP-06/CP-12 管）。
         2026-09-25 使用者裁（曝光邊界牆第 2 題甲）：樓層每一層各自是一個模組。原本把「樓層 #1」「樓層 #3」
         一律剪成「樓層」，同一件商品在樓層 1 當卡、樓層 3 當情境大圖就永遠不比（白蘭 174314 全綠病例）；
         而加商品那道門早就把它當重複在擋＝門口擋、屋裡放。其他模組（KV／入口／品類牆／編輯精選圓）口徑不動；
         同一層內部的 scene×卡仍由下方 v11 那條管；同一層兩張卡同商品＝第 3 題乙、刻意不加門（記待辦）。 */
      /* v20：舊 KV 欄（kv.keyProductGdids）與新版主視覺槽（page.hero）在 layout-0NN 草稿裡並存＝同一個主視覺的鏡像，不是兩處曝光——
         兩種標籤都歸「主視覺」一個模組（實測 run 150126：不歸併會對三件主視覺商品各報一條假 CP-18）。 */
      const moduleOf = (o) => (/^(KV 主打|主視覺)/.test(o) ? "主視覺" : /^樓層 #\d+/.test(o) ? o.replace(/\s*(scene 卡|商品卡 \d+)$/, "") : o.replace(/\s*(#\d+.*|卡 \d+)$/, ""));
      const modules = new Set(owners.map(moduleOf));
      if (owners.length > 1 && modules.size > 1) {
        add("FAIL", "CP-18", `全頁互斥違反：${id}${nameOfGd(id)} 同時曝光於 ${owners.join("、")}（U22：同一推薦對象全頁單點曝光；讓位序 KV＞入口＞樓層＞牆——低順位模組依自身選品規則取次一未曝光候選）`);
      }
    }
    // v13：人工入稿則的重複曝光＝軟比對提示（2026-07-23 裁決：由使用者確認、不阻擋）
    manualPromoIds.forEach(([id, n]) => {
      const ownM = (idOwners.get(id) || []).concat(heroSoftIds.has(id) ? [heroSoftIds.get(id)] : []);
      if (ownM.length) add("WARN", "CP-18", `入口 #${n}（人工入稿）${nameOfGd(id)}${String(id).startsWith("gd:") ? `（${id}）` : ""}與 ${ownM.join("、")} 重複曝光——提示不阻擋（由使用者確認）`);
    });
    // v21（2026-10-05 使用者裁）：主視覺重複曝光＝軟比對提示——可重複、由使用者確認，要避免就換一件
    for (const [idH, labelH] of heroSoftIds) {
      if (idOwners.has(idH)) add("WARN", "CP-18", `${labelH}的商品${nameOfGd(idH)}（${idH}）與 ${idOwners.get(idH).join("、")} 重複曝光——提醒不阻擋（2026-10-05 裁決：主視覺可與下方重複曝光）`);
    }
    /* v11 擴充（2026-07-23 收斂會裁決）：同一樓層 scene 卡（代表品）與商品卡不得同商品——
     * 模組層聚合對「同樓層 scene vs 卡」視為同模組放行＝盲區補檢（07-22 AI 稿三樓層卡 1 全與情境卡
     * 同品同圖實證）；代表品不入卡列含備位（不限張數）；維度沿 idOfUrl（gdid＞URL） */
    (draft.page.floors || []).forEach((f, i) => {
      const su = f?.sceneCard?.url ?? f?.sceneUrl; // sceneCard.url 等價形（CP-12 同款取值）
      const sid = su ? idOfUrl(su) : null;
      if (!sid || !sid.startsWith("gd:")) return; // 比對維度＝gdid（卡列僅 gdid；scene URL 解不出 gdid＝不可比、略過不誤殺）
      (f?.productGdids || []).forEach((g, j) => {
        if ("gd:" + g === sid) add("FAIL", "CP-18", `樓層 #${i + 1}：scene 卡代表品與商品卡 ${j + 1} 同商品（${sid}）——同樓層 scene 與卡不得同商品（2026-07-23 收斂會擴充；代表品不入卡列、含備位）`);
      });
    });
  }

  /* --- CP-20 模組主從一致（U23㉓，2026-07-20 裁決／2026-07-21 落地）：MODULE_COHERENT(m) :=
   * BaseHit(m) ∧ DestOK(m) ∧ CopyOK(m)——詳檔頭 v9 註記；詞庫不可推導＝INFO 略過（不誤殺） --- */
  {
    const theme = norm(draft.page.curationTheme || draft.page.curationGoal || "");
    let baseWords = [];
    for (const [key, syns] of Object.entries(CP20_BASE_SYNONYMS)) {
      if (theme.includes(norm(key)) || syns.some((s) => theme.includes(norm(s)))) baseWords = baseWords.concat(syns);
    }
    baseWords = [...new Set(baseWords.map((w) => norm(w).toLowerCase()))];
    if (!baseWords.length) {
      add("INFO", "CP-20", `curationTheme「${draft.page.curationTheme || "（缺）"}」未命中基底詞同義表（CP20_BASE_SYNONYMS）——主從一致檢查略過（詞庫不可推導＝不誤殺；新垂直請補同義表）`);
    } else {
      const stopRe = new RegExp(CP20_STOP_RE_SRC, "g");
      const baseHit = (name) => { const n = norm(name || "").toLowerCase(); return baseWords.some((w) => n.includes(w)); };
      const subWordsOf = (texts) => {
        const blob = norm(texts.filter(Boolean).join(" ")).replace(stopRe, " ");
        return CP20_CATEGORY_NOUNS.filter((w) => blob.includes(w));
      };
      const nameOf = (g) => byGdid.get(g)?.name || "";
      const checkModule = (label, memberGdids, copyTexts) => {
        const subWords = subWordsOf(copyTexts);
        memberGdids.forEach((g, j) => {
          const nm = nameOf(g);
          if (!nm) return; // gdid 存在性由 CP-02 管
          if (!baseHit(nm)) add("FAIL", "CP-20", `${label} 卡 ${j + 1}「${nm.slice(0, 30)}」未命中基底詞 {${baseWords.join("、")}}（U23 BaseHit：主（模組主題）從（商品）斷裂——V1 康寧輕瓷型；優惠語境不豁免基底）`);
          else if (subWords.length && !subWords.some((w) => norm(nm).includes(w))) add("WARN", "CP-20", `${label} 卡 ${j + 1}「${nm.slice(0, 26)}」未命中模組子類詞 {${subWords.join("、")}}（U23 SubHit：弱契合列人工 QA——W4/W6/W9 型）`);
        });
        // CopyOK：修飾語宣稱 >50% 衝突形反證＝FAIL（U23 V3 型）
        const title = norm(copyTexts[0] || "");
        for (const mc of CP20_MODIFIER_CONFLICTS) {
          if (!title.includes(mc.claim)) continue;
          const conflictRe = new RegExp(mc.conflictReSrc);
          const names = memberGdids.map(nameOf).filter(Boolean);
          const conflicts = names.filter((nm) => !norm(nm).includes(mc.claim) && conflictRe.test(norm(nm)));
          if (names.length && conflicts.length / names.length > 0.5) {
            add("FAIL", "CP-20", `${label} 標題修飾語「${mc.claim}」被 ${conflicts.length}/${names.length} 商品名衝突形反證（U23 CopyOK：修飾語超載＝主從不一致＋標示疑慮——V3「純鈦鍋具」型；改題就商品實質或換入合規品）`);
          }
        }
      };
      (draft.page.floors || []).forEach((f, i) => {
        checkModule(`樓層 #${i + 1}「${f?.title || ""}」`, (f?.productGdids || []), /* 2026-09-25：主從一致也看每張卡（原只看前 3） */
          [f?.title, f?.subtitle, f?.sceneCopy?.tag, f?.sceneCopy?.title, f?.sceneCopy?.sub]);
        // DestOK（V5 型）：標籤/副標稱「分類/分館」→ 目的地必須為 category URL
        const claimsCategory = /分類|分館/.test(norm([f?.sceneCopy?.tag, f?.sceneCopy?.title, f?.sceneCopy?.sub].filter(Boolean).join(" ")));
        if (claimsCategory && f?.sceneUrl && !/\/category\//.test(f.sceneUrl)) {
          add("FAIL", "CP-20", `樓層 #${i + 1} 情境卡文案稱「分類/分館」但目的地非 category URL（U23 DestOK：標籤型別＝目的地型別——V5 型）`);
        }
      });
      (wallBox?.walls || []).forEach((w, i) => {
        checkModule(`品類牆 #${i + 1}「${w?.title || ""}」`, (w?.productGdids || w?.wallProductRefs || []), [w?.title]);
      });
    }
  }

  /* --- CP-22 看更多目的地（U28㉘/U28b，2026-07-20 裁決／2026-07-21 落地）：唯一性 Blocking＋主題切合
   * WARN/FAIL——詳檔頭 v9 註記；欄位缺席＝INFO 退全域 moreUrl 舊行為（向下相容不誤殺） --- */
  {
    const positions = [];
    (draft.page.floors || []).forEach((f, i) => positions.push({ label: `樓層 #${i + 1}「${f?.title || ""}」`, ml: f?.moreLink, sceneUrl: f?.sceneUrl, copyTexts: [f?.title, f?.subtitle, f?.sceneCopy?.tag, f?.sceneCopy?.title, f?.sceneCopy?.sub] }));
    (wallBox?.walls || []).forEach((w, i) => positions.push({ label: `品類牆 #${i + 1}「${w?.title || ""}」`, ml: w?.moreLink, sceneUrl: null, copyTexts: [w?.title] }));
    const withField = positions.filter((p) => p.ml != null);
    if (!positions.length) {
      add("INFO", "CP-22", "floors/walls 欄位缺席——U28 看更多規則略過（模組缺席＝不誤殺）");
    } else if (!withField.length) {
      add("INFO", "CP-22", `全部 ${positions.length} 個位置無 moreLink 欄——退全域 moreUrl 舊行為（U28 落地前草稿相容；新草稿建議逐位置補欄）`);
    } else {
      const othersUrl = new Set(); // 全頁其他目的地（正規化）：scene 卡／入口／編輯精選／探索／全域 moreUrl
      positions.forEach((p) => p.sceneUrl && othersUrl.add(normalizeUrl(p.sceneUrl)));
      (draft.page.promoEntries || []).forEach((e) => e?.url && othersUrl.add(normalizeUrl(e.url)));
      editorialCircles(draft).forEach((c) => c?.url && othersUrl.add(normalizeUrl(c.url)));
      (draft.page.explore?.items || []).forEach((e) => e?.url && othersUrl.add(normalizeUrl(e.url)));
      if (draft.page.moreUrl) othersUrl.add(normalizeUrl(draft.page.moreUrl));
      const kvProductUrls = new Set((draft.products || []).map((r) => r.url && normalizeUrl(r.url)).filter(Boolean));
      const seenMl = new Map();
      const searchToProbe = [];
      for (const p of withField) {
        const ml = p.ml || {};
        if (ml.enabled != null && !MORELINK_ENABLED_ENUM.includes(ml.enabled)) { add("FAIL", "CP-22", `${p.label} moreLink.enabled「${ml.enabled}」非法（僅 ${MORELINK_ENABLED_ENUM.join("|")}）`); continue; }
        if (ml.enabled === "off") { add("INFO", "CP-22", `${p.label} 看更多 off（U28b：該位置不渲染；url 留值備用合法）`); continue; }
        if (!ml.url) { add("FAIL", "CP-22", `${p.label} moreLink enabled=on 但 url 空`); continue; }
        if (!checkUrl(ml.url, "link")) { add("FAIL", "CP-22", `${p.label} 看更多 url 網域非法（白名單外）：${ml.url.slice(0, 80)}`); continue; }
        const nu = normalizeUrl(ml.url);
        if (p.sceneUrl && nu === normalizeUrl(p.sceneUrl)) add("FAIL", "CP-22", `${p.label} 看更多＝自身 scene 卡 URL（U28b①：同模組雙入口同目的地＝U12 Blocking 延伸）`);
        if (seenMl.has(nu)) add("FAIL", "CP-22", `${p.label} 看更多與 ${seenMl.get(nu)} 重複（U28：全頁唯一）`);
        else seenMl.set(nu, p.label);
        if (othersUrl.has(nu)) add("FAIL", "CP-22", `${p.label} 看更多與 scene 卡/入口/編輯精選/探索/全域 moreUrl 之一重複（U28：全頁唯一）：${ml.url.slice(0, 80)}`);
        else if (kvProductUrls.has(nu)) add("WARN", "CP-22", `${p.label} 看更多與商品卡/KV 商品 URL 重複（非 U28 明列五類＝WARN）：${ml.url.slice(0, 80)}`);
        // 主題切合：目的地分型
        let u; try { u = new URL(ml.url); } catch { add("FAIL", "CP-22", `${p.label} 看更多 url 不可解析`); continue; }
        const q = u.searchParams.get("p") || "";
        if (u.pathname.startsWith("/search/product")) {
          const terms = q.split(/[+\s]+/).filter(Boolean);
          const moduleBlob = norm(p.copyTexts.filter(Boolean).join(" "));
          const fit = terms.some((t) => moduleBlob.includes(norm(t)) || [...norm(t)].some((ch) => /[一-鿿]/.test(ch) && moduleBlob.includes(ch)));
          if (!fit) add("WARN", "CP-22", `${p.label} 看更多 query「${q}」與模組詞庫交集空（U28 主題切合＝弱契合列人工 QA）`);
          searchToProbe.push({ label: p.label, url: ml.url, q });
        } else if (u.pathname.startsWith("/category/")) {
          add("INFO", "CP-22", `${p.label} 看更多＝分類頁（優先序第三位；標籤型別一致性由 CP-20 DestOK 管）`);
        } else if (u.pathname.startsWith("/brands/")) {
          add("WARN", "CP-22", `${p.label} 看更多＝品牌頁（U28 優先序最後手段；主題詞不可驗＝列人工 QA）`);
        } else if (/[?&]actid=/.test(ml.url)) {
          add("INFO", "CP-22", `${p.label} 看更多＝活動頁（主題契合沿 CP-14 雙訊號；在線性沿 CP-07）`);
        }
      }
      // search 型 GET 驗證（totalhitcount>0 非 backfill）；GATE_SKIP_HTTP=1 → INFO 未驗
      // 編碼怪癖（U23 GET 履歷既載）：search/product 對某些編碼形式間歇回 500、重試/改百分比編碼即成功——
      // 一律以 URL/searchParams 重組（CJK 百分比編碼、空白＝+），仍失敗補一次 700ms 退避重試後才判 FAIL
      if (searchToProbe.length && process.env.GATE_SKIP_HTTP !== "1") {
        console.log(`CP-22：GET 驗證 ${searchToProbe.length} 個看更多搜尋目的地（節流 350ms、失敗退避重試 1 次）…`);
        const probeOnce = async (url) => {
          const x = new URL(url);
          const q = x.searchParams.get("p"); if (q != null) x.searchParams.set("p", q); // 重組＝強制標準編碼形
          const res = await fetch(x.toString(), { redirect: "follow", headers: { "user-agent": "Mozilla/5.0" } });
          const body = res.ok ? await res.text() : "";
          return { status: res.status, ok: res.ok, body };
        };
        for (const s of searchToProbe) {
          try {
            let r = await probeOnce(s.url);
            if (!r.ok) { await new Promise((t) => setTimeout(t, 700)); r = await probeOnce(s.url); }
            const hits = r.body.match(/"totalhitcount"\s*:\s*"?(\d+)/);
            const fuzzy = /"ecisallfuzzy"\s*:\s*"?true/i.test(r.body);
            if (!r.ok && r.status >= 500) add("WARN", "CP-22", `${s.label} 看更多 GET HTTP ${r.status}（重試後仍 5xx＝站台暫時性錯誤、不可驗——列人工複跑；U23 GET 履歷既載 search 端點間歇 500；驗證出壞目的地才 FAIL）`);
            else if (!r.ok) add("FAIL", "CP-22", `${s.label} 看更多 GET HTTP ${r.status}（目的地不可達；U28：無結果/不可達＝FAIL——改目的地或 off）`);
            else if (!hits || +hits[1] <= 0 || fuzzy) add("FAIL", "CP-22", `${s.label} 看更多「${s.q}」hits=${hits ? hits[1] : "?"}${fuzzy ? "（全模糊回填）" : ""}（U28：有結果才 PASS）`);
            else if (+hits[1] < 5) add("WARN", "CP-22", `${s.label} 看更多「${s.q}」hits=${hits[1]} 偏少（lowHits 列人工 QA——U28 先例：題詞逐字＋純度達標可維持 on）`);
          } catch (e) { add("WARN", "CP-22", `${s.label} 看更多 GET 失敗（${String(e).slice(0, 60)}）——網路錯誤列 WARN 不誤殺`); }
          await new Promise((r) => setTimeout(r, 350));
        }
      } else if (searchToProbe.length) {
        add("INFO", "CP-22", `已跳過 ${searchToProbe.length} 個看更多搜尋目的地 GET 驗證（GATE_SKIP_HTTP=1）——hits>0 未驗`);
      }
    }
  }

  /* ---------- CP-01 KV 字型缺字（Mochiy Pop One 碼點快照；缺字＝降級 Noto Sans TC＝WARN） ---------- */
  const cpFile = path.join(__dirname, "fonts", "mochiy-pop-one.codepoints.json");
  if (fs.existsSync(cpFile)) {
    const cps = new Set(JSON.parse(fs.readFileSync(cpFile, "utf8")));
    const kvText = [kv.eyebrowZh, kv.titleLine1, kv.titleLine2].filter(Boolean).join("");
    const missing = [...new Set([...kvText].filter((ch) => !/\s/.test(ch) && !cps.has(ch.codePointAt(0))))];
    if (missing.length) add("WARN", "CP-01", `KV 顯示字缺字 ×${missing.length}（${missing.join(" ")}）→ 整段降級 Noto Sans TC（登記表規則）`);
  } else {
    add("WARN", "CP-01", "字型碼點快照不存在（fonts/mochiy-pop-one.codepoints.json）——CP-01 未執行");
  }

  /* ---------- CP-04 圖片 HTTP 200（GATE_SKIP_HTTP=1 跳過） ---------- */
  if (process.env.GATE_SKIP_HTTP !== "1") {
    const urls = new Set();
    for (const r of draft.products || []) { if (r.img) urls.add(r.img); if (r.sceneImg) urls.add(r.sceneImg); }
    (kv.images || []).forEach((u) => u && urls.add(u));
    (draft.page.promoEntries || []).forEach((e) => e.img && urls.add(e.img));
    (draft.page.floors || []).forEach((f) => f.sceneImg && urls.add(f.sceneImg));
    const list = [...urls];
    console.log(`CP-04：檢查 ${list.length} 個圖片 URL HTTP 狀態…`);
    const CONC = 8;
    for (let i = 0; i < list.length; i += CONC) {
      const statuses = await Promise.all(list.slice(i, i + CONC).map((u) => httpStatus(u).then((s) => [u, s])));
      for (const [u, s] of statuses) {
        if (s === -1) add("WARN", "CP-04", `圖片無法連線（逾時/網路錯誤）：${u.slice(0, 90)}`);
        else if (s < 200 || s >= 300) add("FAIL", "CP-04", `圖片 HTTP ${s}：${u.slice(0, 90)}`);
      }
    }
  } else {
    add("WARN", "CP-04", "已跳過圖片 HTTP 檢查（GATE_SKIP_HTTP=1）");
  }

  /* ---------- 報告（含指紋，write_xlsx 據此拒收過期報告） ---------- */
  const fails = findings.filter((f) => f.level === "FAIL");
  const report = {
    checkedAt: new Date().toISOString(),
    draftSha256: crypto.createHash("sha256").update(draftRaw).digest("hex"),
    snapshotSha256: crypto.createHash("sha256").update(snapRaw).digest("hex"),
    result: fails.length ? "FAIL" : "PASS",
    registrySource, // W1-E review F1：值域來源留痕（預設 "registries"＝正式登記簿；GATE_REGISTRY_OVERRIDES 生效＝記注入來源，該報告不得作為出貨依據）
    registries: registriesFingerprint(), // 2026-09-21 C：檢查當下八本登記簿的內容指紋——之後任何一本變了（背景退場、字風審過…），工作台會標「需重檢」並重跑，不讓這份報告冒充現況

    counts: { FAIL: fails.length, WARN: findings.filter((f) => f.level === "WARN").length, INFO: findings.filter((f) => f.level === "INFO").length },
    findings, rowResults,
  };
  const outPath = draftPath.replace(/draft\.json$/, "gate_report.json");
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
  console.log(`機器閘：${report.result}（FAIL ${report.counts.FAIL}／WARN ${report.counts.WARN}）→ ${outPath}`);
  for (const f of findings) console.log(`  [${f.level}] ${f.code} ${f.msg}`);
  process.exit(fails.length ? 1 : 0);
}

/* ---------- 規則匯出（export_rules.js 用；require 本檔不觸發 main） ---------- */
module.exports.RULES = {
  widthModel: { ...WIDTH_MODEL, unit: "em", note: "近似模型：全形1em／半形0.55em／空格0.3em；極端字符（emoji 等）不在模型內" },
  pxBudgets: {
    productTag: { budgetPx: TAG_BUDGET_PX, fontPx: TAG_FONT_PX, code: "CP-03", level: "FAIL", note: "P2 商品標籤（G6）" },
    kvShortName: { budgetPx: KVNAME_BUDGET_PX, fontPx: KVNAME_FONT_PX, code: "CP-03", level: "FAIL", note: "KV 主打縮寫名" },
    heroName: { budgetPx: HERONAME_BUDGET_PX, fontPx: HERONAME_FONT_PX, code: "CP-03", level: "FAIL", note: "主視覺商品顯示名（人工可編；兩行）" },
  },
  promoWordPatterns: [
    { id: "discountClaim", pattern: DISCOUNT_CLAIM_RE_SRC, flags: "g", usage: "找出折數宣稱（capture=折數 n；需驗真值：促銷文本邊界比對或實算折數，n<10 僅允許整十縮寫）" },
    { id: "priceClaim", pattern: PRICE_CLAIM_RE_SRC, flags: "g", usage: "找出元價宣稱（capture=金額；需驗真值：等於池內現價或促銷文本逐字）" },
    { id: "discountBoundary", template: DISCOUNT_BOUNDARY_TPL, flags: "", usage: "折數 {n} 於促銷文本的邊界比對（97折 不得證 7折）；以 String.replace('{n}', n) 還原後 new RegExp" },
    { id: "priceSemantic", pattern: PRICE_SEMANTIC_RE_SRC, flags: "", usage: "起字鐵律：showSuffix=是 時標題第二行需命中本式" },
    { id: "discountChar", pattern: DISCOUNT_CHAR_RE_SRC, flags: "", usage: "市價比 <0.4 異常時，標籤命中本式＝禁用（FAIL）" },
    { id: "kvTitleDiscount", pattern: KV_TITLE_DISCOUNT_RE_SRC, flags: "", usage: "KV 標題兩行命中本式（或有檔期）→ 必填主軸 actid" },
    { id: "fullwidthDigits", pattern: FULLWIDTH_DIGITS_RE_SRC, flags: "g", usage: "全形數字正規化：所有比對前先 replace 為半形（-0xfee0）" },
    { id: "productEntryPromoBan", pattern: ENTRY_PROMO_BAN_RE_SRC, flags: "", usage: "U5（2026-07-20）商品型入口 chip/文案優惠詞掃描：命中＝FAIL CP-09（僅限單品詞，禁優惠與檔期詞彙）" },
    { id: "productEntryPeriodBan", pattern: ENTRY_PERIOD_BAN_RE_SRC, flags: "", usage: "U5（2026-07-20）商品型入口 chip/文案檔期詞掃描：命中＝FAIL CP-09（僅限單品詞，禁優惠與檔期詞彙）" },
    { id: "engineeringCopy", pattern: ENGINEERING_COPY_RE_SRC, flags: "i", usage: "U13⑬（2026-07-20）全 ✍️ 文案欄工程字串掃描：命中＝FAIL CP-13（URL/query 參數不得直出文案——分流邏輯保留，文案改用使用者能理解的語言）" },
    { id: "promoTitleTruth", pattern: PROMO_TITLE_TRUTH_RE_SRC, flags: "", usage: "U19⑲＋U16（2026-07-20）promoModuleTitle promo-truth 訊號（「本期活動」前綴或優惠數字詞）：entries 全商品型而標題命中＝FAIL CP-17（純商品內容＝ai-curated 策展命名、「本期活動」四字消失）；對正規化文本" },
  ],
  entryChecks: { // 2026-07-20 使用者裁決 U1/U2/U3/U5（五項新規則，17 → 22）＋U8⑧ entrySourceMode（22 → 23，R2 升級三層）＋U17⑰ entryCount（CP-15 入口數量 3~4，28 → 29）＋U19⑲ typeHomogeneity（CP-17 單一來源制取代 R2，30 → 32）
    dupEntry: {
      code: "CP-06", level: "FAIL", scope: "page.promoEntries",
      keys: ["actid", "url（正規化：host 小寫＋pathname＋query 依 key/value 排序，忽略 query 順序）"],
      note: "U1（2026-07-20）：「同一模組內不得出現同一活動 actid/同一 URL＝Blocking（0 容忍，Q3 定案：warning 級距取消）」；⚠ U1 原「跨模組引用（editorial.circles refEntry）屬設計語意、允許保留」已被同日 U11⑪ 推翻——跨模組去重見 moduleChecks.crossModuleDup",
    },
    expiry: {
      code: "CP-07", level: "FAIL",
      basis: "snapshot promo.endTs；無 endTs → dateValue 尾日 23:59 台北時間容差判定（並 WARN 標註來源不精確）",
      tailPattern: PERIOD_TAIL_RE_SRC, tzOffsetMin: TAIPEI_UTC_OFFSET_MIN,
      note: "U3（2026-07-20）：「活動過期＝內容失效，須更新為在線活動」；結束時刻早於建置時刻（執行當下）＝FAIL，訊息載明到期時間",
    },
    entryImage: {
      code: "CP-08", level: "FAIL",
      default: "活動型＝該 actid 商品池首件商品 imgs[0]（imageSet[0][0]）；商品型＝該 gdid 商品 imgs[0]",
      overridePath: ENTRY_IMG_OVERRIDE_PATH, overrideLevel: "INFO",
      note: "U2（2026-07-20）：「活動入口圖預設＝該活動 URL 商品池第一件商品的第一張商品圖；活動 banner 降為人工覆寫級」——banner 不再是合法預設（不符＝FAIL）；覆寫命中＝放行記 INFO",
    },
    productEntry: {
      code: "CP-09", level: "FAIL",
      urlPathPattern: GDSALE_PATH_RE_SRC, idPattern: GDSALE_ID_RE_SRC,
      rules: [
        "gdid 可自 url 抽出（gdsale id 對映商品池 url）且存在於 products[]（否則 FAIL）",
        "dateValue 必須為空（U5：無檔期列，空＝隱藏；非空＝FAIL）",
        "chip/copy 過 productEntryPromoBan＋productEntryPeriodBan 掃描（命中＝FAIL，單品詞義務）",
        "img＝該 gdid 商品 imgs[0]（或 assets.moduleImages.promoEntryN 覆寫）",
      ],
      note: "U5（2026-07-20）：「商品型入口：連商品頁（Q4 定案＝允許、僅限單品詞）」——分流後不查 promoOf(actid)",
    },
    typeHomogeneity: {
      code: "CP-17", level: "FAIL",
      scope: "page.promoEntries（＋page.promoModuleTitle 標題同型連動）",
      categories: { activity: ["promo-activity"], product: ["brand-recommend", "product-fallback"] },
      layerMin: PROMO_LAYER_MIN, titleTruthPattern: PROMO_TITLE_TRUTH_RE_SRC,
      rules: [
        "模組內容必須單一型別：活動型與商品型（含品牌推薦型）入口混用＝FAIL（純活動或純商品＝PASS）",
        `降層義務：同一層資料可湊滿 ≥${PROMO_LAYER_MIN} 則（U17 下限）才採用該層——在線契合活動 <${PROMO_LAYER_MIN} → 整組降到第 2 層品牌商品推薦、仍 <${PROMO_LAYER_MIN} → 整組第 3 層商品替補；不跨層補位`,
        "標題同型（U19+U16 連動，輕量）：entries 全商品型而 promoModuleTitle 命中 promoTitleTruth 詞型（「本期活動」前綴或優惠數字詞）＝FAIL——純活動＝promo-truth 優惠真值標題、純商品/品牌推薦＝ai-curated 策展命名（「本期活動」四字消失）；欄位缺席＝略過",
      ],
      note: "U19⑲（2026-07-20，接續同日 U1~U18）：選品邏輯不得混用（單一來源制）——「本期活動」標題喊優惠、格內卻商品推薦＝標題與模組商品相關性連結不起來；取代原 R2 混填排序 WARN（修訂 U5 混填制／U8 auto 混填語意／U17 補位語意）；U17 的 3 則等比版型＝單一來源制自然配套（該層恰 3 則時用 3 則版型，不用湊第 4 格）",
    },
    entrySourceMode: {
      code: "CP-10", level: "FAIL（強制單一模式不符/枚舉非法/溯源不符）；WARN（快照無推薦清單＝不可溯源／auto 下入口全商品型但在線契合活動 ≥3＝應採更高優先層）",
      field: "page.promoSourceMode", default: "auto", enum: PROMO_SOURCE_MODES,
      typeOrder: ENTRY_TYPE_ORDER, brandRecommendKeys: BRAND_RECOMMEND_KEYS,
      rules: [
        `缺值視為 auto；auto 語意（U19⑲ 修訂）＝「取可滿足 ≥${PROMO_LAYER_MIN} 則的最高優先層」——不再混填；auto 下 entries 全商品型且快照可判定在線契合活動 ≥${PROMO_LAYER_MIN}＝WARN 應採更高優先層（無商品池/無到期依據之活動＝不可判定不計、略過不誤殺）`,
        "promo-activity|brand-recommend|product-fallback＝強制單一來源：全部入口同型否則 FAIL（U19 語意不變——原本就單一來源）",
        "入口型別判定：destinationType 宣告優先；缺宣告時 url 分流（gdsale＝product-fallback、其餘＝promo-activity）",
        `brand-recommend 型須可溯源品牌頁推薦清單：快照有 ${BRAND_RECOMMEND_KEYS.join("/")} 時比對 gdid（不符＝FAIL）、無清單＝WARN 記不可溯源`,
      ],
      note: "U8（2026-07-20 裁決⑧）：「本期活動」來源三層優先序＝1.優惠活動（ec_promotions/onsale）→2.品牌商品推薦（品牌頁 hotSales/hits）→3.商品替補（商品池主題關鍵商品）；E0 欄（Sheets P1 表尾）供選擇；U19⑲（同日）修訂 auto＝單一來源制（型別混用改由 CP-17 FAIL 把關）",
    },
    entryCount: {
      code: "CP-15", level: `FAIL（<${PROMO_ENTRY_COUNT.min} 或 >${PROMO_ENTRY_COUNT.max}）；INFO（恰 3 則＝3 則版型記錄／欄位缺席＝略過）`,
      scope: "page.promoEntries", min: PROMO_ENTRY_COUNT.min, max: PROMO_ENTRY_COUNT.max,
      validity: "有效項＝具 url 或 actid 之入口物件；promoEntries 欄位缺席＝04 §7 第 3 層整模組隱藏語意（商品池不足編組）＝略過不誤殺",
      rules: [
        `有效入口 <${PROMO_ENTRY_COUNT.min}＝FAIL——訊息載明遞補義務：依 U8 三層優先序（1.優惠活動→2.品牌商品推薦→3.商品替補）遞補補滿、遞補後仍不足才 FAIL`,
        `有效入口 >${PROMO_ENTRY_COUNT.max}＝FAIL（至多 ${PROMO_ENTRY_COUNT.max} 則，不得超編；2026-08-26 使用者裁決＝上限 4→12）`,
        `恰 ${PROMO_ENTRY_COUNT.min} 則＝INFO 記 3 則版型：保持內容間距不變、「圓形圖模組的圖片」與「標題模組的背景寬度」等比放大、活動標題字級不變——只有 module 內容寬度等比放寬（渲染側 09 §2.10）；mobile 2×2 流式 2+1 尺寸不變＝預設（09 §4.2 G-C10 開放項）`,
      ],
      note: "U17⑰（2026-07-20，接續同日 U1~U16）：「本期活動」內容數量原＝至多 4 則、不得少於 3 則；2026-08-26 使用者裁決＝上限放寬 4→12（「本期活動模組可以開放給用戶最多可以增加到 12 個內容入口」；下限 3 不變、恰 3 等比放大語意保留；>3 則＝全裝置左右滑動列＝渲染端互動另批）；3 則版型＝規則預備態——需可被資料驅動觸發＋自測可模擬驗證；U19⑲（2026-07-20）修訂補位語意：不跨層補位——3 則等比版型＝單一來源制自然配套（該層恰 3 則時用 3 則版型，不用湊第 4 格）",
    },
  },
  moduleChecks: { // 2026-07-20 使用者裁決 U10–U15（⑩–⑮），規則數 23 → 28（CP-06 跨模組擴充＋CP-11~14 新設；U15＝連結白名單形態，見 enums.linkWhitelistForms）；＋U18⑱ categoryWallCount（CP-16 品類牆數量 3~5，29 → 30）
    crossModuleDup: {
      code: "CP-06", level: "FAIL", scope: "editorial.circles|items × page.promoEntries（跨模組）",
      keys: ["actid", "url（正規化比對同 entryChecks.dupEntry）"],
      editorialCircleKeys: EDITORIAL_CIRCLE_KEYS,
      note: "U11⑪（2026-07-20）：跨模組去重擴及「編輯精選 × 本期活動」——editorial 圓形項 actid/url 與 promoEntries 現用項重複＝FAIL；重複時依內容讀取順序（U8 三層優先序）取「本期活動未使用」的下一批項目、且須符合 AI 策展主題模組（推翻同日 U1「跨模組 refEntry 引用屬設計語意、允許保留」）；模組缺席＝略過不誤殺",
    },
    kvImageSource: {
      code: "CP-11", level: "圖庫內任一張＝放行（不作為檢查項目）；FAIL（KV 圖不在該主打商品圖庫＝真值違反）；INFO（人工覆寫放行）",
      default: "page.kv.images[i]＝該主打商品圖庫任一張（AI 策展預設 imgs[1] 第二張白底；使用者可自選前 5 張）",
      overridePath: KV_IMG_OVERRIDE_PATH, overrideLevel: "INFO",
      note: "2026-07-25 使用者裁決（二次放寬）：KV 圖不作為檢查項目——AI 預設第二張白底、使用者可自由選商品圖庫任一張（介面開放前 5 張）；僅保留真值保護＝KV 圖須取自該商品圖庫（不在圖庫＝FAIL）。原 U10⑩「一律第二張」語意撤除。",
    },
    floorUrlUnique: {
      code: "CP-12", level: "FAIL（同模組重複）；WARN（與 promoEntries/editorial 跨模組重複）",
      field: "page.floors[].sceneCard.url（等價 sceneUrl；欄位缺席＝略過不誤殺）",
      note: "U12⑫（2026-07-20）：策展要把握每一個主題流量——策展入口 URL 不得重複；同模組（樓層間）URL 必唯一（鈦案「鈦划算／鈦好喝」兩樓層同連一 URL＝違例）",
    },
    engineeringCopy: {
      code: "CP-13", level: "FAIL", pattern: ENGINEERING_COPY_RE_SRC, flags: "i",
      fields: "全 ✍️ 文案欄：商品標籤/KV 縮寫名/KV 眉標＋標題兩行/CTA/頁尾標題/入口 chip＋copy/編輯精選圓形項/樓層牆標題副標＋情境卡",
      editorialCopyKeys: EDITORIAL_COPY_KEYS,
      note: "U13⑬（2026-07-20）：延伸探索分流邏輯保留，但文案不得出現「search p=鈦鍋」等工程字串（URL/query 參數直出）——改用使用者能理解的語言",
    },
    themeFitGate: {
      code: "CP-14", level: "FAIL（命中率＜門檻）；WARN（快照無該活動商品池＝不可溯源）",
      scope: "活動型入口（promo-activity）",
      basis: "該 actid 商品池品名對 curationTheme 主題關鍵詞命中率 ≥ 門檻才可入選；只在契合池內以折數深度排序（排序屬策展側，閘門驗契合）",
      default: THEME_FIT_DEFAULT,
      patchChannel: {
        env: "GATE_THEME_FIT_PATCH", field: "themeFitRule{keywords[], threshold: number｜{B_poolHitRate}}",
        sessionPath: THEME_FIT_PATCH_PATHS[THEME_FIT_PATCH_PATHS.length - 1] || null,
        rule: "策展 agent 校準值（feedback_patch.json themeFitRule）讀得到就以它為準；讀不到＝走抽頂預設（缺檔不誤殺）；keywords 斜線別名展開＋英文不分大小寫（keywordNote）；threshold 物件形取 B_poolHitRate（閘門實作訊號 B＝商品池品名命中率）",
      },
      note: "U14⑭（2026-07-20）：出現在來源頁活動列表≠主題契合——不契合一律不入選（鈦案 772695 nile 戶外＝選錯品類錯誤示範、立即撤換）；契合活動不足額依 U8 三層混填；⚠ 主題詞＋門檻待 curationTheme 詞庫欄位化後改資料驅動",
    },
    categoryWallCount: {
      code: "CP-16", level: "FAIL（牆數 <3 或 >5／數量宣告與實有不一致）；WARN（牆標題與樓層/其他牆同名＝dock 錨點撞名）；INFO（欄位缺席＝略過）",
      scope: "page.walls|categorySections（等價欄位；掃 page／draft 頂層）", min: CATEGORY_WALL_COUNT.min, max: CATEGORY_WALL_COUNT.max, default: CATEGORY_WALL_COUNT.default,
      wallContainerKeys: WALL_CONTAINER_KEYS, countFields: WALL_COUNT_FIELDS,
      rules: [
        `實有品類牆 <${CATEGORY_WALL_COUNT.min} 或 >${CATEGORY_WALL_COUNT.max}＝FAIL（U18：由 2 組更新為預設 ${CATEGORY_WALL_COUNT.default} 組；活動頁預設至少曝光 ${CATEGORY_WALL_COUNT.min} 組、至多 ${CATEGORY_WALL_COUNT.max} 組）`,
        `數量宣告欄（${WALL_COUNT_FIELDS.join("/")}，Sheets 數量選擇欄）非空且 ≠ 實有牆數＝FAIL；宣告欄缺席＝略過不誤殺`,
        "牆標題與樓層/其他牆同名（正規化＋trim 後比對）＝WARN——dock 錨點撞名（dock 錨點隨牆數 6→7、已有橫滑 rail 機制，錨點標題須可辨識）",
        "品類牆容器欄位缺席＝INFO 略過不誤殺（沿 CP-15 promoEntries 缺席慣例）",
      ],
      note: "U18⑱（2026-07-20，接續同日 U1~U17）：「編輯精選」下方以分類為切入點的模組（品類牆 CategoryGroup/categorySections）目前 2 組 → 預設 3 組；Google Sheets 可選擇出現模組的數量；連動（閘門外）：Schema P1 BE/BF（牆4/5 標題，樓層編號連續制：樓層1-3＝主打、牆4/5＝品類牆1/2）擴至牆6~8＋新增數量選擇欄、P2 模組位置枚舉 wall-1/wall-2 擴至 wall-5、14 號契約 walls[]「恰 2」改 3~5",
    },
    /* ---- 2026-07-21 v9 新增（2026-07-20 使用者裁決㉒㉓㉗㉘ 條文落地；規則數 32 → 40）---- */
    wallProductCount: {
      code: "CP-21", level: "WARN（件數 ∉ {4,8,12}＝湊滿提醒；2026-10-05 使用者裁「照樓層模式」）／FAIL（宣告 ≠ 實數）；略過（欄位缺席＝不誤殺，沿 CP-15/16 慣例）",
      scope: "page.walls[]（等價 categorySections[]）每牆商品列", enum: WALL_PRODUCT_COUNT_ENUM,
      rules: [
        `每牆有效商品數 ∉ {${WALL_PRODUCT_COUNT_ENUM.join("|")}}＝WARN 湊滿提醒（2026-10-05 使用者裁「照樓層模式」：原 FAIL 使逐件加品必經非法值＝規範與功能衝突；最後一排留空位不擋出貨）`,
        "宣告欄 walls[].wallProductCount（等價 Sheets 牆N商品數 per-wall 欄）非空且 ≠ 該牆實數＝FAIL；缺席＝略過",
      ],
      note: "U27㉗（2026-07-20 裁決／2026-07-21 落地）：品類牆商品數＝4 的倍數；落地現況五集第三牆 4/4/4/4/8（鈦牆3 補漏勺 11555799＋湯漏勺組 8325549）；CSS desktop flex→grid repeat(4,1fr)＝渲染側配套（09 §2.11）",
    },
    pageDedup: {
      code: "CP-18", level: "FAIL（同識別子曝光於兩個不同模組／同一樓層 scene 卡與商品卡同商品）；WARN（主視覺×下方＝2026-10-05 裁決提醒不阻擋；人工入稿入口＝2026-07-23 同款）",
      dimensions: ["gdid（gdsale 兩式正規化）", "actid", "正規化 URL（normalizeUrl＝CP-06 同款）"],
      boundary: `KV 主打（kv.keyProductGdids）＋新版主視覺槽（page.hero[*].gdids，2026-09-26 起）／本期活動入口／樓層 scene 卡＋全部商品卡（2026-09-25 起每張都算曝光位；樓層各自成模組）／品類牆全卡／編輯精選圓（有建模時）`,
      excluded: [`position ∈ {${PAGE_DEDUP_EXCLUDED_POSITIONS.join("|")}}（編輯精選商品牆＝設計語意、U20/U22 邊界明文排除；納管＝第四次擴圈候補）`, "moreLink（U28 由 CP-22 管）", "探索分流入口（搜尋/品牌/分類/活動頁；單品頁連結才計入）"],
      rules: [
        "同識別子曝光於兩個不同模組＝FAIL（模組層聚合；同模組內重複由 CP-06/CP-12 管）",
        "同一樓層 scene 卡（代表品）與商品卡同商品＝FAIL（2026-07-23 收斂會擴充 v11：代表品不入卡列、含備位不限曝光位——模組層聚合盲區補檢；07-22 AI 稿三樓層卡 1 全與情境卡同品同圖實證）",
        "排除清單＝實作過濾（v12：walls claim 過濾 position ∈ 排除清單；編輯精選圓 actid-only 亦計入互斥＝逃逸修）",
      ],
      note: "U22㉒（2026-07-20 裁決／2026-07-21 落地）：推薦模組內容全頁互斥（U1 同模組→U11 編輯精選×入口→U22 全頁 第三次擴圈）；讓位序 KV＞入口＞樓層＞牆——低順位模組依自身選品規則取次一未曝光候選（U15 品牌圓＝列表次一件、樓層卡＝分組次一未曝光、入口＝tier 讀取順序次一、牆＝回源補抓）；同樓層 scene×卡擴充＝2026-07-23 收斂會裁決（引擎端 curate_auto 結構＋prompt 硬化為第一防線、本檢為 gate 防呆第二防線）",
    },
    exploreChecks: {
      code: "CP-02／CP-04／CP-12／CP-13（explore 作用域＝v12，2026-07-23 ②③定案）",
      scope: "page.explore＝{moreUrl, ctaText, items[]{label,sub,img,url}}（14 §8 待審③定案後入契約）",
      rules: [
        "items[].label/sub＋ctaText＝✍️ 文案欄：工程字串（CP-13）＋折數/元價真值（CP-02）照掃",
        "items[].url＋moreUrl＝CP-04 網域白名單；items 同模組 URL 唯一（CP-12 語意）；缺 URL＝WARN",
        "CP-18 維持排除（分流入口設計語意）；目的地＝真值 URL 限定（來源頁/在線活動；引擎不機造搜尋 query）",
      ],
      note: "2026-07-23 使用者指示開放 explore 編修＝待審③定案；loader 缺鍵＝整區隱藏降級（原「維持現值」廢止）",
    },
    editorialChecks: {
      code: "CP-02／CP-13／CP-21（editorial 作用域＝v12，2026-07-23 ②③定案）",
      scope: "page.editorial＝{title[3], circles[]{tag,copy,date,img,url}}＋products[].position=editorial-wall 牆列",
      rules: [
        "title 三行＝✍️：CP-13＋CP-02 照掃；圓文案（tag/copy 等六鍵）補 CP-02 真值（原僅 CP-13）",
        "編輯精選牆件數＝U27 等價、2026-10-05 起同降 WARN 湊滿提醒（4|8|12 最整齊；0 件＝未啟用合法＝loader 隱藏降級）；牆列真值/池存在性＝products[] 迴圈既有覆蓋",
        "圓＝CP-18 計入（url 或 actid 維度）；牆列＝CP-18 排除（設計語意，位次第四次擴圈候補）",
      ],
      note: "2026-07-23 使用者指示開放 editorial 編修＝待審②定案；圓選品/牆選品＝未曝光池（引擎/enrich 端點同規則）",
    },
    moduleCoherence: {
      code: "CP-20", level: "FAIL（BaseHit 未命中／修飾語 >50% 反證／標籤型別≠目的地型別）；WARN（SubHit 弱契合）；INFO（詞庫不可推導＝略過）",
      judgment: "MODULE_COHERENT(m) := BaseHit(m) ∧ DestOK(m) ∧ CopyOK(m)（U23 cp20Proposal 判定式）",
      lexicons: { baseSynonyms: CP20_BASE_SYNONYMS, categoryNouns: CP20_CATEGORY_NOUNS, modifierConflicts: CP20_MODIFIER_CONFLICTS.map((m) => ({ claim: m.claim, conflictPattern: m.conflictReSrc })), stopPattern: CP20_STOP_RE_SRC },
      rules: [
        "BaseHit【Blocking】：模組內每一曝光商品名（正規化後）須命中 ≥1 資料集基底詞（curationTheme × 同義表）；「划算」等優惠語境不豁免基底",
        "SubHit【WARN】：商品名未命中模組子類詞（tokenize(模組 title＋情境卡文案) − 停用形 ∩ 品類名詞詞典）＝弱契合列人工 QA",
        "CopyOK【Blocking】：模組標題修飾語宣稱被 >50% 曝光商品名之衝突形反證＝FAIL（V3「純鈦鍋具」型）",
        "DestOK【Blocking】：標籤/副標稱「分類/分館」→ 目的地必須為 category URL（V5 型）；activity 型主題契合沿 CP-14 雙訊號；search 型詞交集空＝WARN",
        "人工 QA 清單（機器不可驗）：推薦脈絡可讀性／landing 首屏第三訊號／弱契合 triage／圖與主題視覺契合／修飾語詞典外創意文案／同款異色視覺重複（U23 manualQaItems）",
      ],
      note: "U23㉓（2026-07-20 裁決／2026-07-21 落地）：模組主題（主）與商品/連結/文案（從）符合主題邏輯；詞庫自動推導路徑見 04 §2.2 後新節（基底詞＝curationTheme 分詞＋來源 URL 型別詞＋人工同義表；子類詞＝模組文案分詞 − 停用詞 ∩ 品類名詞詞典）；772695 一體兩面（titanium FAIL／camping PASS）＝「主題契合是 curationTheme 的函數」例證",
    },
    moreLink: {
      code: "CP-22", level: "FAIL（唯一性違反／enabled 枚舉非法／on 無 url／GET 無結果或 404）；WARN（詞交集空＝弱契合／品牌頁型／lowHits／與商品卡 URL 重複）；INFO（缺欄＝退全域 moreUrl／off＝合法／分類・活動型記錄／GATE_SKIP_HTTP 未驗）",
      scope: "page.floors[].moreLink／page.walls[].moreLink＝{enabled:on|off, url}", enum: MORELINK_ENABLED_ENUM,
      rules: [
        "唯一性【Blocking】：on 之 url 以 normalizeUrl 比對——＝自身 scene 卡 url（U28b①）／與同集其他 moreLink 重複／與 scene 卡・promoEntries・編輯精選・探索・全域 moreUrl 任一重複＝FAIL；與 KV 三圓/商品卡 URL 重複＝WARN（非 U28 明列五類）",
        "主題切合：search 型 query 詞 ∩ 模組詞庫 ≠ ∅ 且 GET totalhitcount>0 非全模糊回填＝PASS；詞交集空＝WARN；GET 無結果/4xx＝FAIL；5xx 重試後仍失敗＝WARN 不可驗（站台 search 端點間歇 500＝U23 GET 履歷既載；驗證出壞目的地才 FAIL）；hits<5＝lowHits WARN（題詞逐字＋純度達標可維持 on＝U28 先例）",
        "策展優先序（04 §6）：p=詞 ＞ brandIds ＞ 品類/分類頁 ＞ 品牌頁（最後手段＝WARN）；activity 型沿 CP-14；off＝該位置不渲染（url 留值備用合法＝U28b②）",
        "缺欄＝INFO 退全域 moreUrl 舊行為（向下相容不誤殺）",
      ],
      note: "U28㉘/U28b（2026-07-20 裁決／2026-07-21 落地）：看更多 per 模組主題化＋全頁唯一；落地現況 30 位置全 on（鍵盤樓層1 因 W7 探索分流落檔撞 URL 改 p=電競機械鍵盤＝CP-22 讓位首例）；Sheets F7.n/F8.n per 位置雙欄（03 §2.6）",
    },
  },
  heroLayoutChecks: { // 2026-08-24 v15 新增（51 號 W1-E＝CP 登記表 v1.8 配號 CP-25/26/27；規則數 46 → 51）
    layoutValueDomain: {
      code: "CP-25", level: "FAIL（值域外貨號／有版式欄但登記簿讀不到）；INFO（舊拼法正規化／rollout=trial 試用徽章／rollout=closed 停接新案）；略過（欄位缺席＝舊 draft legacy 態，51 §2.8）",
      field: "page.kvVariant", normalize: "kv-new→new、kv-legacy→legacy（51 §2.6 讀入正規化；寫出端一律裸值）",
      valueSource: "modules.json hero variants[]（runtime 讀＝lib/proposal_pack loadRegistries；本表不鏡像 id 清單＝R5 枚舉鏡像防範；測試注入＝GATE_REGISTRY_OVERRIDES env）",
      layoutVariantPattern: LAYOUT_VARIANT_RE_SRC,
      note: "51 號七題裁決（2026-08-24）＋批判前置致命三「閘面全盲」——gate 原況零識別版式欄；正 fixture＝layout-006、負 fixture＝未知貨號（掛 gate 三閘測試）",
    },
    placeholderResidue: {
      code: "CP-26", level: "FAIL（出貨 draft 任一字串欄命中佔位型）",
      pattern: PLACEHOLDER_RESIDUE_RE_SRC, flags: "",
      excludedPaths: PLACEHOLDER_SCAN_EXCLUDED_PATHS,
      rules: [
        "「滿 $-- 折 $--」型示意佔位永不出貨（51 §2.10）——抓不到折扣真值＝折扣開關灰化出 base 版，不出佔位",
        `排除子樹＝${PLACEHOLDER_SCAN_EXCLUDED_PATHS.join("／")}——僅契約正位路徑、深層同名鍵照掃（review F3）（meta 不進渲染＝14 §2.12；heroSlotStash 不渲染不出貨＝14 §2.13，換回還原時強制重驗另有專責）`,
        "編輯態不擋＝gate 只跑出貨鏈（部署/匯出全檢）——條文天然滿足，工作台編輯中可暫存佔位",
      ],
      note: "51 號 §5 對接摘要＋§2.10 折扣資料源條款；39 號 §6-3 原「實作時提案」就此配號（CP 登記表 v1.8）",
    },
    contentModuleCompleteness: {
      code: "CP-31", level: "FAIL（模組在場但必填空）／WARN（主打選品右欄只 1 件）",
      scope: "page.mechanic（每列 thresholdText＋rewardText；banner imgs/img/titleLine1 至少一）／page.spotlight（heroCard.gdid＋title；productRefs ≥1）／page.promoCards[]（每張 gdid；舊形 promoCard 單物件同掃）",
      rules: [
        "模組加了就要填完——節點在場、必填全空＝引擎渲染虛線佔位框；CP-26 只認 $-- 型樣板字、空字串漏網（70 號 §4 發現②）",
        "鍵缺席＝模組不在頁上＝略過（舊稿零誤殺）；編輯態不擋＝gate 只跑出貨鏈",
        "訊息白話講第幾列／哪張卡沒填並指路（移除模組／換列數較少的排版／挑商品）",
      ],
      note: "70 號 §6 QA 使用者裁「新開檢查號」（CP-28 已用於主視覺真值連動，取 31）；CP 登記表 v1.18；CMS 示範態灰字純顯示不進 draft＝畫面上看得到空格，本閘＝出貨時擋得住空格",
    },
    assetLicense: {
      code: "CP-27", level: "FAIL（license C／B 級無複查或審核值非法／conditional 任預設／簿級 termsVerification 缺席／值域外貨號／灰度門票不符／字風未審・查無・主字型無戶口或非 A／副標字體不可選或非 A）；WARN（conditional 明選黃燈／motionFlag 非 static 未綁素材）；略過（kvVariant 非 layout-*＝§2.13 欄休眠）",
      scope: "page.backgroundId（缺欄＝版式 defaultBackground）＋page.motionFlag 綁定素材（page.motionId）＋page.titleStyle（字風簿 approved＋主字型戶口）＋page.subtitleFont.fontId（字體簿 pickable＋A）——後兩欄 v17（2026-09-08）納管",
      recordSource: "design-assets backgrounds/motion/typestyles/fonts manifest（runtime 讀＝loadRegistries backgroundRecords/motionRecords/backgroundsMeta/typestyleRecords+typestyleIds/fontRecords）",
      bgReviewField: "qaStatus", bgReviewPass: BG_REVIEW_PASS, fontReviewField: "qaStatus（字體 B 級複查欄沿背景同名，v17）",
      rules: [
        "背景 license C＝FAIL（未過正式授權；51 附錄 §5 修復路線圖＝B 級複查批＋背景重製批處理）",
        `背景 license B＝須複查紀錄 qaStatus ∈ {${BG_REVIEW_PASS.join("|")}}＋reviewDate 在場；缺欄、值外或缺日期＝FAIL；conditional＝不得任版式預設（FAIL）、明選＝黃燈 WARN 照複查註記處置`,
        "背景 license B＝另需 backgrounds manifest meta.termsVerification（生成平台商用條款書面查證；2026-08-24 Higgsfield ToU §4.4 入簿 v0.5.1）——欄缺席＝FAIL",
        `灰度門票（51 §6）：rollout=trial 版式出貨背景 license 必為 A 或已複查 B（${BG_REVIEW_PASS.join("/")}＋reviewDate；判定＝lib/proposal_pack backgroundEligible 單一來源、與表單 grayTicket 同函式）——不符＝FAIL；停新案開關＝modules.json 逐變體 rollout:"closed"（欄缺席＝開放；closed＝值域保留、歷史頁照舊渲染、工作台停供新選）`,
        `動畫（E7）：motionFlag 缺席＝容忍；static＝略過；值限 ${MOTION_FLAG_ENUM.join("|")}；sway/flip 綁定素材 license C＝FAIL（試作素材＝僅內部預覽・未過授權；出貨動畫定調＝當檔商品照現生另批）、未綁素材＝WARN 出聲`,
        `字風（v17，2026-09-08）：page.titleStyle 缺席＝版式原字略過；查無＝FAIL；字風簿 review.status≠approved＝FAIL（未審不出貨）；已審但 fontId 缺／字體簿查無＝FAIL；主字型 license A＝過、B 須 qaStatus ∈ {${BG_REVIEW_PASS.join("|")}}＋reviewDate、C／非 A-B-C＝FAIL——寫入端兩道門（proposal_pack／hero_combo）原本已擋，gate 為出貨前最後一道（手改 draft／事後退審）`,
        "副標字體（v17，2026-09-08）：page.subtitleFont 缺席＝略過；形狀非 { fontId, weight }＝FAIL；fontId 查無＝FAIL；pickable≠true（字風配方專用／引擎內建／未達 A）＝FAIL；license 判法同字風",
      ],
      note: "51 附錄批判前置致命一＋§5 修復路線圖；48 號 §1.2 素材授權硬閘機器化（原僅紙上條文）；B 級動畫複查制＝現簿無 B 級素材、未配號（素材入簿時隨批補）",
    },
  },
  requiredFields: REQUIRED_FIELDS,
  enums: {
    tagSource: TAG_SOURCES,
    imgDomains: IMG_DOMAINS,
    linkDomainPattern: LINK_DOMAIN_RE_SRC,
    kvKeyProductCount: KV_KEY_PRODUCTS,
    zoneProductRange: ZONE_PRODUCT_RANGE, // 註：品類牆件數之 warning 語意已由 CP-21（4 的倍數 Blocking）取代，此表 walls 範圍僅餘 floors 建議值語意（U27，2026-07-21）
    promoSourceMode: PROMO_SOURCE_MODES, // U8（2026-07-20 裁決⑧）E0 本期活動來源模式
    wallProductCount: WALL_PRODUCT_COUNT_ENUM, // U27㉗（2026-07-21 落地）品類牆件數鐵律＝P4 枚舉鏡像（Sheets 牆N商品數 🎚）
    moreLinkToggle: MORELINK_ENABLED_ENUM, // U28b（2026-07-21 落地）看更多開關＝P4 枚舉鏡像（Sheets F7.n 🎚）
    motionFlag: MOTION_FLAG_ENUM, // W1-E（2026-08-24）14 §2.13 動畫開關殼枚舉（版式/背景/主題貨號值域＝登記簿 runtime 讀、不入本表＝R5 防範）
    bgReviewPass: BG_REVIEW_PASS, // W1-E（2026-08-24）CP-27 B 級背景複查合格值（審核欄 qaStatus）
    linkWhitelistForms: [ // U15⑮（2026-07-20）連結白名單合法形態（linkDomainPattern 之上的特定形態註記）
      {
        id: "brandFilter", pathPattern: BRAND_FILTER_URL_RE_SRC, requiredQuery: ["brandIds"],
        example: "https://tw.buy.yahoo.com/search/product?brandIds=41166510&p=鈦杯 鈦餐具",
        note: "U15 品牌維度編輯精選導流：brandIds 品牌篩選 URL＝合法形態（品牌 ID 自搜尋頁品牌篩選資料取得）；圓形圖＝該篩選 URL 商品列表首件代表品之商品圖第二張＋品牌語彙文案（選品側規則）；閘門命中記 INFO（CP-06 段）、天然滿足 U11 不重複",
      },
    ],
  },
};

if (require.main === module) main().catch((e) => { console.error("FATAL:", e.message); process.exit(2); });
