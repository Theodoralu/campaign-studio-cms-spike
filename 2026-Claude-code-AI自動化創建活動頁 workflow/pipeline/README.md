# A1 管線：URL → 策展初稿 → 機器閘 → 四分頁工作簿

> ⚠️ **這份 README 是 2026-07 的版本，只描述早期的兩段式指令列流程。**
> 它沒有涵蓋後來長出來的工作台介面、AEM 匯出、單機版打包，而且下方「CP-19 短期解：price_watch 每日巡檢」那節講的排程**已於 2026-09-14 退場**。
> **第一次接觸這套系統，請讀 `docs/handover/01_這是什麼_怎麼跑.md`**（在專案根的 `content-auto-ops-workspace` 庫裡），那份是現行的起步說明。本檔保留作為早期管線的歷史紀錄。

> **策展工作台 v0**（2026-07-22，`workbench/`）：本機前台把本管線串成「URL＋活動目的 → 引擎策展（機械 v0／claude -p）→ 所見即所得編修 → 回存 → 送建置」——`node workbench/server.js` → http://localhost:8787（詳 `workbench/README.md`；13 號平台 Stage A spike）。

依 03 號文件（GoogleSheets Schema v1.0，✅定稿）實作的自動化管線。
分工：**①抓取解析、③寫表、④機器閘＝程式**（本資料夾）；**②策展初稿＝Claude 於對話中產出**。

## 使用方式（兩段式）

```bash
# 第一段：抓取＋解析（只做搬運，真值逐字入 snapshot.json）
node run.js stage1 "https://tw.buy.yahoo.com/brands/41166677?cid=29588048" lecreuset
#   → runs/<日期>-lecreuset/{snapshot.json, raw/*.html}

# 第二段（Claude 產出 draft.json 放入 run 資料夾後）：機器閘＋寫表
node run.js stage2 "runs/<日期>-lecreuset"
#   → gate_report.json ＋ <頁名>_schema_v1.xlsx（Google Sheets 檔案>匯入 即可用）
```

策展建議以 `curate.js` 形式留在 run 資料夾（見 runs/2026-07-17-lecreuset/curate.js 範例）：
策展決策（選品/文案/標籤改寫）由 Claude 手寫，🔒 真值欄位由腳本自 snapshot 逐字複製——鐵律的程式化落實。

## 前端預檢規則匯出（N-16，Stage A 驗收）

```bash
node export_rules.js   # → rules.json（規則單一來源）
```

自 gate.js 抽頂常數（優惠詞 regex 詞型、標籤字數/寬度語意、必填欄清單、枚舉表）＋ 03 §8.1 mobile
字元上限表產出 `rules.json`（頂層：version / generatedAt / charLimits / promoWordPatterns /
requiredFields / enums；regex 以字串保存，前端 `new RegExp(pattern, flags)` 還原）。

**鐵律：前端預檢一律載 rules.json、禁止另寫規則**——改規則只改 gate.js 常數或 03 §8.1 表後重跑
export_rules.js，勿手改 rules.json（rules.json 是產物；gate.js 仍是唯一裁決閘，前端預檢僅是提前提示）。

## 模組

| 檔案 | 段位 | 職責 |
|---|---|---|
| `fetch_parse.js` | ① | 品牌頁（ec_promotions／hotSales 逐塊解析（欄位序可變、缺件記 warning）／hits）＋逐檔活動賣場（ProductBundle 反轉義解析）→ snapshot.json；raw/ 存原始 HTML 供稽核 |
| （對話）＋ `runs/*/curate.js` | ② | Claude 策展：KV 主軸綁定（折數最深檔優先）、B1-B6 主題路由、樓層/牆分組、標籤（v5 優先序：①優惠 ②特色第一行，超寬 AI 改寫存 tagOriginal） |
| `gate.js` | ④ | **v2 封閉世界原則**——CP-01 KV 字型缺字（fonts/ 碼點快照，缺字＝WARN 降級 Noto Sans TC）；CP-02 真值：真值欄逐字＋所有 AI 可寫文案欄（眉標/標題兩行/CTA/樓層牆標題副標/入口 chip 文案/標籤）折數與元價宣稱驗真值（全形正規化、邊界比對防 97折→7折 誤證、十位縮寫僅允許整十、KV 折數＋檔期綁同一 actid、offer 標籤逐字出自該活動、feature 改寫＝原文有序子序列、入口標題/連結逐字、主打與樓層 gdid 存在性、重複 gdid 阻擋、市價比 <0.4 一律標記）；CP-03 寬度模型（標籤 102px@14px、KV 縮寫名 188px@12px）；CP-04 網域白名單＋圖片 HTTP 200（`GATE_SKIP_HTTP=1` 跳過網路檢查）。**v3（2026-07-20 使用者七點裁決 U1–U5；規則數 17 → 22）**——CP-06 同模組入口重複（promoEntries 內同 actid／同 URL 正規化比對＝Blocking 0 容忍，Q3 定案 warning 級距取消）；CP-07 入口過期（snapshot endTs 優先，無 endTs → dateValue 尾日 23:59 台北容差＋WARN 來源不精確；結束早於建置時刻＝FAIL 並載明到期時間）；CP-08 入口圖確定性（預設＝該 actid 商品池首件 imgs[0]；banner 降人工覆寫級 `assets.moduleImages.promoEntryN`，覆寫命中＝INFO 放行、不符＝FAIL）；CP-09 商品型入口（gdsale url 分流不查 promoOf：gdid 自 url 抽出且在池、dateValue 必空、chip/copy 禁優惠與檔期詞＝單品詞義務、img＝該 gdid imgs[0]）；R2 混填排序（活動型入口排商品型之前，違反＝WARN）。報告含 draft/snapshot sha256 指紋 |
| `write_xlsx.js` | ③ | **v2 契約對齊**——P1「一列＝一個活動頁」橫式（欄位碼 A1~F3 對映 03 §2，60 欄）／P2 契約欄序 G1/G0/G2~G9＋輔助欄／P3「一列＝一次抓取」（03 §4 項目）／P4 全枚舉鏡像＋來源版本註記（R5）；權限表頭色（🔒灰 ✍️黃 🎚藍）、🎚 下拉 ×13、檢查結果異常標紅（R4）；**指紋不符＝拒產出**（防閘後竄改洗 PASS） |
| `run.js` | — | 入口；stage2 閘 FAIL 時 write_xlsx 因指紋一致仍可產表（異常如實呈現於檢查結果欄） |
| `export_rules.js` | — | 自 gate.js 抽頂常數＋03 §8.1 字元上限表產 `rules.json`（前端預檢規則單一來源；N-16 抽頂重構＝v2 基線 17 規則經負向測試 17/17 parity 驗證零行為變化；2026-07-20 U 裁決新增 entryChecks 五規則，合計 22，rules.json 升 v1.1.0） |
| `fonts/` | — | CP-01 字型碼點快照（mochiy-pop-one.codepoints.json，fonttools cmap 產出，14,293 字） |
| `selftest_run.js` | — | **FrameTest 頁內自測 headless 執行器**（2026-07-21 設立；先前 runner 存 session scratchpad 隨清理滅失）——playwright-core＋系統 Chrome（channel:"chrome" 免下載），逐五資料集載 `#exp=test:1[,dataset:key]`、等 `SELFTEST:PASS/FAIL` 標題、收斷言逐行＋console/pageerror/requestfailed；CLI＝`node selftest_run.js <FrameTest.html> [輸出.json]`；全集 fail=0 且 error=0 → exit 0（與 price_qa 同作部署閘） |

## 已知邊界

- **R3 商品池**：活動賣場僅內嵌首批 ~20 件（總數見 activities[].meta.resultsTotal），不足由人工指定補抓；缺口已寫入 snapshot.warnings 與 P3。
- **檔期顯示短式**（`2026.07.03 ~ 08.01`）視同全式，屬確定性顯示轉換，gate 內建容差。
- **寬度模型**為近似（全形 1em／半形 0.55em／空格 0.3em），與 FrameTest 實測校準；極端字符（emoji 等）不在模型內。
- **Google Sheets 直寫**（service account / MCP）為後續升級位；現階段 xlsx 匯入零設定即用。
- **price_qa 掃描器＝天真 tokenizer（不識 regex 字面量）**：balancedEnd 只認字串/註解，JS regex 內的引號、大括號、以及尾部 `\//`（會被誤判為 `//` 行註解）都可能使括號走平衡失敗（FATAL: balancedEnd）。2026-07-21 實例：FrameTest runSelfTest 內 `/\/gdsale\//` 令全掃 FATAL，已改寫為 `includes("/gdsale/")`。**慣例：price_qa 掃描範圍（五集池常數/marketMeta/牆/kv 字面值＋runSelfTest 原始碼）內避免 regex 字面量含引號/大括號/`\//`，優先用 `includes()`／`indexOf()` 等字串方法。**

## 部署前必跑：price_qa（CP-19，2026-07-20 U21）

**每次部署前必跑** `node price_qa.js <FrameTest.html> all`——五集帶價展示元件逐品實抓商品頁比價，DRIFT/DEAD＝exit 1＝Blocking 不得部署（詳 `../00_Workflow_檢查點登記表.md` CP-19）。

自測閘同場必跑：`node selftest_run.js <FrameTest.html>`——五資料集頁內自測（2026-07-21 ㉗~㉛ 落地後 124 條/集），任一 fail/error＝exit 1；兩閘全綠才部署。

## 資料保存規則（2026-07-20 訂）

三層制——每個檔案落地前先問屬於哪一層，層決定去留：

| 層 | 涵蓋 | 規則 |
|---|---|---|
| ① **真相層** | 文件（00~14 號）與程式（gate.js/write_xlsx.js/…） | **只升版不留舊檔**——版本演進記在文件版本註記與 05 §8 變更紀錄，不留 `_v2/_old` 副本檔 |
| ② **稽核層** | `runs/`（每 run＝snapshot＋draft＋gate_report＋xlsx＋raw/＋raw-augment/）；`qa/` 日期夾（規劃資料夾側） | **成組永久保留**——snapshot+draft+gate_report+xlsx 四件**指紋綁定不可拆**（動任一件必重跑 stage2 重綁指紋，不得單改）；raw/、raw-augment/ 為真值佐證隨組保留；qa/ 日期夾＝QA 憑證與策展證據，永久 |
| ③ **暫存層** | `~/Downloads` 匯入檔（xlsx 給 Sheets 匯入用的工作副本） | **僅保留最新版**——任何時候可由 write_xlsx 自 run 重生，舊版即刪，不當歸檔 |

今日案例（2026-07-20）：鈦案匯入檔 v2~v4（手工合併過渡版）汰除、**v5 現役**（write_xlsx v6 整檔重生版，Downloads 僅此一檔）；U18 六件補錄商品佐證自 scratchpad 歸位 `runs/2026-07-20-titanium-refresh/raw-augment/`（snapshot meta.augmentations 改指 run 內相對路徑後依②重跑 stage2 重綁指紋）；U1~U18 批次 QA 憑證歸檔 `2026-AI自動化活動頁生成規劃/qa/2026-07-20-u1-u18-batch/`。

## 驗證紀錄（2026-07-17）

- **v1 初版**：LC 端到端 PASS＋負向測試 9/9。
- **對抗性審查（32 代理 workflow）**：確認 28 項缺陷（真值閘繞過 9、解析穩健性 2、工作簿 2、契約偏差 15）——全數修補為 v2。代表性繞過：offer 標籤無真值檢查、97折 子字串誤證 7折、feature 改寫欄自由文字、跨活動折數×檔期拼裝、閘後竄改 draft 洗過期 PASS、hotSales 相鄰性 regex 漏件 16/20。
- **v2 驗證**：LC 端到端 PASS（45 件商品、64 圖 HTTP 200、CP-01 零缺字）；**負向測試 30/30**（含 3 個合法案例防過度阻擋：基準、全形６８折、十位縮寫 5折@實算50）＋過期報告拒收測試；工作簿契約結構回讀（P1 一列 60 欄、P2 契約欄序、P4 11 枚舉＋版本註記、下拉 ×13、權限色）全數正確。
- 改寫合法性的機械代理＝「有序字元子序列」：改寫只能刪減不能新增（不加油添醋的可驗證形式）；合法重排序需人工在 P2 ✍️ 欄操作（閘會擋，屬保守設計）。

## 變更紀錄（2026-07-20，使用者七點裁決 U1/U2/U3/U5 落地）

- **v3 規則擴充（規則數 17 → 22）**：CP-06 同模組入口重複（U1「同一模組內不得出現同一活動 actid/同一 URL＝Blocking（0 容忍，Q3 定案：warning 級距取消）」；跨模組引用允許）、CP-07 入口過期（U3「活動過期＝內容失效，須更新為在線活動」）、CP-08 入口圖確定性（U2「活動入口圖預設＝該活動 URL 商品池第一件商品的第一張商品圖；活動 banner 降為人工覆寫級」）、CP-09 商品型入口（U5 gdsale 分流、單品詞義務）、R2 混填排序（U5「真活動保留排前」）。rules.json 重匯出 v1.1.0（新增頂層 `entryChecks`、promoWordPatterns 7 → 9 式、requiredFields 8 → 10 欄）；報告 counts 新增 INFO 級（覆寫放行記錄，不影響 exit code）。
- **驗證**：鈦案舊 draft（runs/2026-07-19-titanium）重跑＝FAIL 5——CP-07 ×2（776312/776556 已到期）＋CP-08 ×3（三入口皆 banner）＝U3 換檔裁決的機器閘落實（預期行為）；合成負向測試 CP-06（actid＋query 反序 URL）/CP-09（dateValue 非空、優惠詞、檔期詞、img≠imgs[0]）/R2（活動型排後）/覆寫 INFO 放行/無 endTs 尾日容差 WARN 全數命中。

## 變更紀錄（2026-07-21，U19~U31 文件收尾批）

- **gate.js v8 → v9（規則 32 → 40）**：CP-18 全頁互斥（U22㉒——gdid/actid/正規化 URL 三維度、曝光邊界含樓層前 3 商品卡、editorial-wall/moreLink/探索分流排除、讓位序 KV＞入口＞樓層＞牆）／CP-20 模組主從一致（U23㉓——BaseHit Blocking＋SubHit WARN＋CopyOK 修飾語 >50% 反證 Blocking＋DestOK 標籤型別＝目的地型別；詞庫＝CP20_BASE_SYNONYMS 同義表＋品類名詞詞典、不可推導＝INFO 不誤殺）／CP-21 品類牆件數 4 倍數（U27㉗——∉{4,8,12}＝FAIL、宣告欄 wallProductCount≠實數＝FAIL；03 R1 牆 warning 語意升 Blocking）／CP-22 看更多目的地（U28㉘/U28b——唯一性 Blocking＋search 型 GET totalhitcount 驗證：URL 編碼重組＋700ms 退避重試、4xx/無結果＝FAIL、5xx 重試後仍失敗＝WARN 不可驗列人工複跑（search 端點間歇 500＝U23 GET 履歷實證）、GATE_SKIP_HTTP=1＝INFO 未驗）。**負向測試 14/14**（合成違例含「備位不計曝光」「off 合法」等不誤殺案例）；rules.json 重匯出 **v1.3.0**（moduleChecks 6→10、enums 增 wallProductCount/moreLinkToggle）；00 檢查點登記表升 v1.4 落列。
- **write_xlsx v6 → v8**（v7 版位保留給 A7/A8 previewUrl＝13 號 §13.6 N-20）：P1 表尾附加 牆N商品數wallProductCount ×5（🎚 4|8|12）＋F7.n/F8.n 看更多雙欄 ×8（🎚 on|off＋✍️ URL）；P4 枚舉 +2、模組位置補 `editorial-wall` 過渡建模值（編輯精選商品牆曝光列——14 契約 editorial 建模前落位、CP-18 依 U22 排除、第四次擴圈候補）。
- **鈦 run 資料層同步（runs/2026-07-20-titanium-refresh，依②稽核層規則動件必重跑 stage2 重綁指紋）**：draft 同步至部署現況（F1 主軸位 V1/U22/U20 疊加、F3 U20 換序、牆①②重建為頁面現況 4 卡 CategoryGroup、牆3 U27 擴 8、moreLink×6、wallProductCount 4/4/8；原「輕量堅固/導熱快」兩牆×6＝editorWall 12 件→position editorial-wall 保留）；snapshot 補錄 2 件（11555799/8325549，raw-augment＋meta.augmentations 沿 U18 慣例）；stage2 重跑＝**PASS（FAIL 0／WARN 1＝既知康寧市價比）**、匯入檔 v8 產出入 Downloads（暫存層規則：v6 汰除）。

## CP-19 短期解：price_watch 每日巡檢（2026-07-22 使用者裁決建置；**排程 2026-07-23 遷平台伺服器**）

> ⚠ 2026-07-23 排程遷移：launchd LaunchAgent 讀 ~/Documents 受 macOS TCC 拒＝09:30 首跑失敗（實證）——排程改由 `workbench/server.js` 內建（每日 09:30 後、當日未跑即跑一次；marker＝`qa/price-watch/last-run.txt`）；平台開著＝巡檢必跑、平台關閉日不巡檢（部署前 price_qa 兜底）。launchd plist 已除役（`~/.twec/*.disabled-tcc`）。

價格「快照時效漂移」的排程化承接（部署後防線；部署前必跑閘不變）：

```bash
zsh price_watch.sh          # 手動跑一輪；排程＝launchd com.twec.price-watch 每日 09:30
# 掛載：launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.twec.price-watch.plist
# 停用：launchctl bootout   gui/$(id -u)/com.twec.price-watch
```

流程＝`price_qa 實抓 → 乾淨即收工｜漂移 → price_sync 機械修 → 兩閘複驗 → 全綠自動部署（僅同步 FrameTest）→ macOS 通知`。
**自動修僅限「真值逐字複製」等級**（`price_sync.js`：kind=price 現價＋折數型標籤；特色型標籤不動）；
**DEAD／原價變動／檔內定位曖昧＝停手通知人工**（涉替補策展與結構判讀，鐵律不自動）。
逐輪憑證＝`../../2026-AI自動化活動頁生成規劃/qa/price-watch/<時戳>/`（price_qa 報告＋price_sync 摘要＋兩閘＋deploy）；主日誌 `watch.log`。
price_sync 驗證＝回退重放測試（07-22 鈦 7 件：還原舊值→依報告自動修→與人工修版本逐位元一致）。
