# server.js 地圖（D2 核對版，2026-11-04）

對象：`2026-Claude-code-AI自動化創建活動頁 workflow/pipeline/workbench/server.js`，3,600 行。
核對方式：用 grep 與腳本從程式碼重新掃一次（區段標記、頂層函式、路由 `if` 條件、副作用計數），和 API 拆分計畫附錄 A 的初版對照。
結論：區段與主要函式和初版一致；路由條件實數 **96 條**（初版估約 80），差在 Google Sheets 子路由與 briefs 系列。

## A-1 區段

| 行 | 區段 | 行數 | 去向 |
|---|---|---|---|
| 1–160 | 啟動：fatal 處理、BUILD 版號、綁定位址、能力探測 `detectCaps`（spawn claude）、HTTP 小工具（send／readBody／serveFile／safeJoin） | 160 | server.js 骨架；`detectCaps` 第一版移除（AI 第二階段） |
| 161–273 | run 狀態：`wb_meta.json` 讀寫、`wb.log`、核可失效、商品狀態檔讀寫 | 113 | `core/store`（D11） |
| 274–668 | 策展批次建立：`finishDraftAfterCurate`（293–479）、`createRun`（480–652）、`runGate`（653–685） | 395 | `core/source`＋`core/curate`＋`core/finish`（D6–D9）；`runGate` → `core/gate`（D10） |
| 669–844 | 上線部署（Netlify 內網預覽）：`deployRun` | 176 | **不搬**（同事版本來就關） |
| 845–962 | ZIP 匯出：`exportZip`＋內嵌 `go()` | 118 | **不搬** |
| 963–1035 | AEM 網頁檔製作：`exportAem` | 73 | `core/export`（D10） |
| 1036–1088 | 本期活動重組：`promoLayerOptions` | 53 | `core/curate`（規則版的一部分） |
| 1089–1267 | 商品替換：策略檔（briefs）工具、版式對照、商品在售探針、曝光集合、自動補品 | 179 | briefs 相關第二階段；`productLiveness`／`autoPickFromPool` → `core/product-truth`（D7） |
| 1268–1451 | 商品狀態檢查：`productCheck`（1293–1458） | 184 | `core/product-truth`（D7，改走 uther） |
| 1452–1503 | 對外發佈（個人 Netlify 公開站）：`publishPublic` | 52 | **不搬** |
| 1504–3504 | HTTP 路由：登入防護（1518–1566）＋ 96 條路由 | 2,001 | D13 改成 Express router；邏輯抽到 core |
| 3505–3551 | 維護：垃圾桶清理、busy 狀態回復 | 47 | server.js 保留（改讀 store） |
| 3552–3600 | run_patrol 純函式、每日引擎自我測試（macOS 通知） | 49 | **不搬**（單機版排程） |

## A-2 函式副作用（出現次數：讀檔／寫檔／子行程／網路／meta 與 log）

| 行 | 函式 | 行數 | 讀 | 寫 | 子行程 | 網路 | meta/log | 備註 |
|---|---|---|---|---|---|---|---|---|
| 176 | patchSnapshotPrice | 14 | 0 | 0 | 0 | 0 | 0 | 純函式，D7 直接搬 |
| 190 | pcSummaryOf | 15 | 0 | 0 | 0 | 0 | 0 | 純函式 |
| 211 | patchProductCheckFile | 14 | 1 | 1 | 0 | 0 | 0 | store |
| 225 | reconcileProductCheckFile | 16 | 1 | 1 | 0 | 0 | 0 | store |
| 243 | runNode | 11 | 0 | 0 | 2 | 0 | 2 | 跑 fetch_parse／gate 子行程；D6–D10 後改成直接呼叫模組 |
| 254 | deriveSourceKeywords | 27 | 1 | 0 | 0 | 0 | 0 | 讀快照推關鍵字；D6 |
| 281 | ensureThemeFitPatch | 12 | 1 | 1 | 0 | 0 | 2 | 主題契合校準；D8 |
| 293 | finishDraftAfterCurate | 187 | 10 | 4 | 0 | 1 | 34 | **最難拆**，D9 拆成有順序的步驟 |
| 480 | createRun | 173 | 12 | 3 | 4 | 0 | 31 | 建立主流程；4 個子行程＝stage1 抓取、策展、gate、快速草稿；D6＋D13 |
| 653 | runGate | 33 | 1 | 0 | 1 | 0 | 1 | 子行程跑 gate.js；D10 改直接呼叫 |
| 723 | deployRun | 125 | 1 | 5 | 5 | 0 | 17 | 不搬 |
| 849／882 | exportZip／go | 32／86 | 2／3 | 0／14 | 0／2 | 0 | 3／13 | 不搬 |
| 969 | exportAem | 71 | 4 | 6 | 1 | 0 | 11 | 子行程＝aem_verify（Playwright）；D10 移 CI |
| 1042 | promoLayerOptions | 62 | 4 | 0 | 0 | 1 | 0 | D8 |
| 1114／1142 | fillInputFromBrief／myBriefPath | 24／42 | 2／3 | 1／1 | 0 | 0 | 0 | briefs，第二階段 |
| 1194 | layoutChoiceErrorOf | 18 | 0 | 0 | 0 | 5 | 0 | 「網路」命中是 probeProductLiveness 字串，實為純判斷 |
| 1212 | productLiveness | 9 | 0 | 0 | 0 | 2 | 0 | D7 改 uther |
| 1227 | pageExposedGdids | 27 | 0 | 0 | 0 | 1 | 0 | 純函式（命中為註解） |
| 1254 | autoPickFromPool | 19 | 1 | 0 | 0 | 1 | 0 | D7 |
| 1273 | urlStatus | 20 | 0 | 0 | 0 | 3 | 0 | 連結探針；D7 |
| 1293 | productCheck | 166 | 2 | 1 | 0 | 4 | 6 | D7 改 uther（Patrol Tool 200 件先篩） |
| 1461 | publishPublic | 42 | 2 | 3 | 3 | 0 | 8 | 不搬 |
| 1504–3504 | **路由區整段** | 2,001 | **131** | **54** | 3 | 19 | 91 | 業務邏輯直接寫在處理器裡的量 |
| 3505 | purgeTrash | 12 | 4 | 1 | 0 | 0 | 0 | store |
| 3517 | reconcileStaleBusy | 39 | 2 | 0 | 0 | 0 | 4 | 開機時把卡在 busy 的 run 復原；D13 |
| 3570 | runDailySelftest | 31 | 2 | 2 | 1 | 0 | 0 | 不搬 |

### 邏輯直接寫在路由處理器裡、要先抽成函式的（≥40 行）

| 行 | 路由 | 行數 | 讀／寫／網路 | 去向 |
|---|---|---|---|---|
| 2031 | POST runs/:id/explore-fix | 218 | 8／6／5 | `core/curate`（延伸探索修補） |
| 2824 | GET／PUT runs/:id/draft.json | 153 | 15／2／1 | PUT 的真值照磁碟、指紋、核可失效 → `core/store`＋`draft_write`（D11）★ |
| 2399 | GET api/briefs 系列 | 128 | 15／7／0 | 第二階段 |
| 2666 | GET／POST api/runs（列表／建立） | 104 | 10／0／0 | D13 ★ |
| 2305 | POST runs/:id/promo-recompose | 94 | 3／2／0 | `core/curate` |
| 2586 | POST api/copy-suggest | 80 | 14／6／0 | AI 文案，第二階段 |
| 3425 | POST runs/:id/deploy | 80 | 1／2／0 | 不搬 |
| 3104 | POST runs/:id/hero-combo | 73 | 1／0／1 | 版式組合套用 → `core/curate`（MVP 版式選擇用）★ |
| 3218 | POST runs/:id/content-modules | 71 | 5／1／4 | 內文模組，第二階段 |
| 2977 | POST runs/:id/redo-draft | 60 | 7／1／0 | 照策略檔重做，第二階段 |
| 1972 | POST runs/:id/enrich-ee | 59 | 5／2／0 | 舊稿補生成；MVP 不需要 |
| 1916 | POST runs/:id/editorial-add | 56 | 5／3／1 | 編輯精選換品 ★ → `core/product-truth`＋`core/curate` |
| 2249 | runs/:id/feedback-patch | 56 | 6／1／0 | 第二階段 |
| 2770 | DELETE api/runs/:id（含 restore） | 54 | 4／3／0 | D13 ★ |
| 3330 | POST runs/:id/pool-rebuild | 48 | 7／3／2 | D7 ★ |
| 2539 | POST api/source-check | 47 | 0／0／1 | D6 ★（改成 uther 探針） |
| 3177 | POST runs/:id/import-preview／import-apply | 41 | 5／5／1 | Excel 匯入，第二階段 |

## A-3 活動資料夾的檔案：誰寫、誰讀（與初版一致）

| 檔 | 寫 | 讀 | 備註 |
|---|---|---|---|
| snapshot.json | fetch_parse.js（stage1）；`patchSnapshotPrice`（套用新價）；r3-add／editorial-add（補抓入池） | curate_auto.js、gate.js、finishDraftAfterCurate、promoLayerOptions、productCheck | **不是唯讀**，建立期對價會改它 |
| draft.json | curate（初稿）、finishDraftAfterCurate、PUT draft.json、各編修端點、redo-draft、import-apply | gate.js、exportAem、幾乎所有端點 | 備份 draft.vN；指紋；核可失效 |
| wb_meta.json | writeMeta（31＋34＋… 處） | readMeta | stage、approved、deploy／export 狀態、priceTruth |
| gate_report.json | gate.js（runGate、stage2） | GET gate_report.json、approve 前檢查 | |
| product_check.json | productCheck、patchProductCheckFile、reconcile | GET product_check.json、列表狀態燈 | |
| wb.log | appendLog（91 處路由區＋34 finish＋31 create） | 無程式讀；人工稽核 | 搬到 S3 後改成結構化 log |
| export.aem.html／export.zip | exportAem／exportZip | GET 下載 | |

## A-4 路由（96 條；★＝MVP 第一版）

登入防護：1518–1566（authLockState／authNoteFail／crossSiteReason／authOk）→ D12 換 Okta，整段刪。
編修模式 403 名單：1567（google、runs 子路由 EDITOR_BLOCKED_SUBROUTES）→ 第一版用能力表取代。

| 群 | 路由（行） | 去向 |
|---|---|---|
| 健康與版本 ★ | GET /ping (1572) · GET /api/version (1697) · POST /api/caps/recheck (1730) | /ping 改 /status.html、/readiness；version 保留；caps 第一版固定表 |
| 靜態檔 ★ | / public (1736–1737) · colortool (1741) · ds-site-nav.js (1755) · design-assets (1756) · design-proposal-kit (1757) · frametest (1759) · assets/hero-bg (1763) · api/layout-thumbs (2532) | Express static，路徑由 assetRoots 注入；colortool、proposal-kit 不搬 |
| 商品與規則 ★ | GET /api/product-images (1579) · GET api/rules.json (1776) · POST api/product-fetch (1777) · POST api/source-check (2539) | product-fetch／source-check 改 uther（D6／D7） |
| 待審背景 | /api/pending-bg (1640) · POST/DELETE/GET hero-bg (3037–3060) · hero-bg-confirm (3068) | 自備背景第二階段 |
| Google Sheets | api/google/* status/config/token/auth/callback/disconnect/folder (1784–1821) · runs/:id/sheet-status/sheet-unlink/sheet-create/sheet-read (1842–1860) | **不搬**（P23） |
| 建立與列表 ★ | GET/POST api/runs (2666) · DELETE api/runs/:id (2770) · POST restore (2810) · GET status (2814) · GET snapshot.json (2823) · GET/PUT draft.json (2824) · GET versions (3370) · POST versions/rollback (3378) · POST archive/unarchive (2925–2926) | D13；draft PUT 的保護三條 D11 |
| 垃圾桶 ★ | GET api/runs-deleted (2613) · POST purge (2635) · DELETE (2641) · POST restore (2649) | D13 |
| 檢查 ★ | POST gate (2909) · POST stage2 (2916) · GET gate_report.json (2923) · POST product-check (3281) · GET product_check.json (3367) · POST apply-live-price (3289) · apply-live-price-all (3308) · POST pool-rebuild (3330) | D10／D7 |
| 核可與匯出 ★ | POST approve (3397) · POST export-aem (2946) · GET export.aem.html (3009) | approve 加審核者檢查（D12）；AEM 匯出 D10 |
| 編修（MVP 內）★ | POST r3-add (1890) · POST editorial-add (1916) · POST explore-fix (2031) · GET promo-options (2299) · POST promo-recompose (2305) · POST hero-combo (3104) · GET hero-kit (3092) · GET api/layout-catalog (2372) · GET api/layout-suggest (2376) · GET api/theme-suggest (2387) · GET api/theme-check (2272) · GET runs/:id/theme-check (2286) | 換商品走 uther；其餘邏輯搬 core/curate |
| 策略檔與 AI | GET api/briefs (2399) · POST/PUT/DELETE api/briefs/mine (2435–2482) · rename (2473) · gem-instructions (2491) · recon (2496) · read (2514) · GET api/flow-guide (2510) · POST redo-draft (2977) · GET gemini-prompt (2967) · POST scenario (2958) · POST api/copy-suggest (2586) · feedback-patch (2249) · enrich-ee (1972) | 第二階段 |
| 內文模組與匯入 | POST content-modules (3218) · GET import-template (3169) · POST import-preview/import-apply (3177) · POST api/proposal-pack/parse (2527) | 第二階段 |
| 部署與對外 | POST deploy (3425) · POST export-zip (2928) · GET export.zip (2938) · POST publish-public (3018) | **不搬** |

## 與初版的差異

1. 路由 96 條，初版寫「約 80」；多出來的是 Google 子路由 11 條與 briefs 系列。
2. 初版把 `promoLayerOptions` 歸 D8 沒錯，但 `promo-recompose`（94 行）與 `explore-fix`（218 行）的邏輯都在處理器裡，D8 前要先抽函式。
3. `draft.json` 的 PUT 處理器 153 行，包含 14 號 §2.15 的指紋、真值照磁碟、核可失效，是 D11 的主體，不是 D13。
4. `publishPublic` 只有 42 行（初版副作用表把路由區算進去了，已修正）。

## G 類基線紅燈（spec_field_limits_vs_hero_len）——已查，歸 A 類

測試把 CMS 的 `HERO_LEN`（index.html 裡的欄位字數上限）釘在 `design-assets/layouts/spec/<layout>.<device>.json` 的 `fieldLimitsMachine` 上。工作包裡 **沒有 `design-assets/layouts/spec/` 這個資料夾**（只有 manifest.json、qa、thumbs），測試對不存在的檔是 `continue` 跳過，所以 `HERO_LEN` 裡有的每一欄都被判「spec 沒有」。只列出 layout-011／012 的 6 欄，是因為 HERO_LEN 目前只有這兩款有條目。
處置：和 A 類相同，spec 是設計側的真源檔，不在產品 repo；D5 從 npm test 移除。若之後要保留「CMS 字數上限有真源」這條規則，D10 改成把 `fieldLimitsMachine` 的數字抄進 `assets/layouts/manifest.json`，測試改讀那裡。
