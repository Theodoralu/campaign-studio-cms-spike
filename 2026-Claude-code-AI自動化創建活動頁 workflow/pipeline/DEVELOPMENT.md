# 開發工作流程規劃 DEVELOPMENT.md

> 目的：把「靠人記憶＋本機手動把關」的開發流程，升級成**右尺寸、有工具強制、每次更新都留下可追溯記錄**的流程。
> 核心原則：能自動化就自動化、清單短而致命、不建沒人會遵守的儀式。
> 產品性質：money-facing、每日部署的內容自動運營 CMS——出錯直接上到對外消費者頁。

---

## 1. 現況與成熟度評估

**誠實評級：Level 1（Ad-hoc／靠人與自律），局部有 Level 3 的硬閘但地基缺席。**

已有的資產（並非一無所有）：
- 四條實跑的部署閘串在 `workbench/server.js` 部署路徑：`gate.js`（46 規則合規/真值）＋`selftest_run.js`（137 斷言×5 資料集模板迴歸）＋`price_qa.js`（價格時效 DRIFT/DEAD blocking）＋`export_verify.js`（ZIP 成品跨裝置渲染）
- 寫入鎖 busyLock、卡死回收、核可稽核印記、gate 報告 sha256 指紋防竄改

關鍵缺口（依嚴重度）：
| # | 缺口 | 嚴重度 |
|---|---|---|
| 1 | **非 git repo**：無 diff/blame/rollback/code review 載體；每日部署又已多次線上回歸卻無版本快照 | 🔴 high |
| 2 | **兩條繞閘部署旁路**：裸 `netlify deploy` ＋ 看門狗 `workbench/update-entry.sh`，會把未過任何閘的髒/半同步內容晉升到 canonical 站 | 🔴 high |
| 3 | **gate.js（46 規則 money 閘）零可重跑測試**；README parity 只存於文件、無 fixture、改規則迴歸靜默通過 | 🔴 high |
| 4 | **核可不變式靠人記憶**：`invalidateApproval` 反覆漏掛 5+ 端點、內部 deploy 不檢查 `approvedAt`（~~`gateStale` 從未實作~~＝2026-08 舊況，前端旗標其後已實作，2026-09-22 更正；仍缺的是 rules.json version 快照，見 §8 P2） | 🔴 high |
| 5 | **33 處空吞 catch**（silent failure），正對應已固化根因類型 | 🟠 med |
| 6 | 無靜態安全網：無 eslint/tsconfig/prettier，`npm test` 是 `exit 1` 假失敗樁，selftest 未接線 | 🟠 med |
| 7 | 密鑰衛生：`workbench/.wb-pass`（明碼密碼）**0644 世界可讀且未 gitignore**，git init 前必先處理 | 🟠 med |
| 8 | 三個 monolith（`workbench/server.js` 1338 行／`gate.js` 1418 行／`workbench/public/index.html` 2629 行）＋建置產物與源碼同倉 | 🟡 low |

---

## 2. 目標：GitHub 中心，每次更新帶記錄，對照 story/flow

每一次產品變更 = 一條完整、有據可查的更新，包含四個掛鉤：

```
GitHub commit/PR ── 程式碼變更的單一真相（可 diff / 回滾 / 追溯）
   ├─ docs/stories/<功能>.md      ← user story + user flow + 驗收清單（審查基準）
   ├─ docs/reviews/<功能>-<日期>.md ← Code Review 記錄（5 根因逐項勾＋同類掃描證據）
   └─ docs/design-qa/<功能>-<日期>.md ← Design QA 記錄（AA/a11y/RWD/文案…＋證據）
```

- **Code review 與 design QA 都逐項對照 `docs/stories/` 的驗收清單**——確保「程式會動」與「使用者旅程走得通」兩件事都被簽核。
- PR 用 `.github/pull_request_template.md` 把三份記錄＋變更摘要串起來；日後推 remote 直接變真 PR。

---

## 3. 每次功能更新的標準流程（6 階段閘）

| 階段 | 目的 | 關鍵檢查 | 閘門 |
|---|---|---|---|
| **0. 地基**（一次性） | 先鎖密鑰再建可 diff 載體 | chmod 600 `.wb-pass`；gitignore 密鑰/產物；git init＋`check-ignore` 目視；`core.hooksPath .githooks` | 阻擋：確認無密鑰/產物被 tracked 才 commit baseline |
| **1. 開發** | 變更集可 diff/審/退 | **動到出貨守門／打包機那條線＝走 `feat/xxx` 分支**（名單真源＝`.dod-baseline.json` `reviewRequiredPaths`）；**其餘直接改 main**（2026-09-22 使用者裁 Q1 甲，理由見 §4 DoD 1）；改**源頭非產物**；新 catch 不空吞；改 draft/state 同步所有 render；新寫 draft 端點掛 `invalidateApproval` | 建議：本地 `npm run guard` 自審五清單 |
| **2. 提交前秒級守門**（每次改動一鍵） | 毫秒級離線攔機器可判斷的根因 | `dod-check.sh static`＝`node --test`＋`tools/dod-guards.js`（G1 改產物/G2 空 catch/G3 核可覆蓋/G4 tokenizer/**G5 出貨守門改動留 review**）＋`price_qa --skip-http` | 阻擋：pre-commit 跑 `dod-guards.js --staged`＋`node --test`（`review-guard.js` 未單獨落地，其職責由 dod-guards G1／G5 承擔）。**pre-push 沒有**——`.githooks/pre-push` 從未建置（§8 P2 未建項），推送前無自動檢查，靠 pre-commit 已擋過那一關 |
| **3. Code Review**（合併前） | 人只審機器審不了的語意 | 逐項過 5 根因清單（R1~R5）；風險分級；修 bug 答三問附 grep 證據 | 建議：重級變更轉一次 Claude 第二審＋補 test 才 `merge --no-ff` |
| **4. 上線前 QA 閘**（部署級） | 把本次真實內容納入硬閘 | `dod-check.sh full`＝static 三段＋④`selftest_run.js` 渲染迴歸＋⑤設計檢查已接線部分（背景圖重量）。**2026-09-22 逐行實讀更正兩件**：①原文另列的 price_qa 實抓／export_verify **不在 full 裡**，由 `workbench/server.js` 的部署路徑四閘把關（見 §1「已有的資產」）②**④ 這段有 58 天根本沒在跑**（呼叫時漏給 FrameTest 路徑，同日已修，見 §4 DoD 9） | 阻擋：任一非零中止；`approvedAt` 為內部上線硬閘、`gateStale` 觸發需重核可 |
| **5. 發佈與回退** | 一條路發佈，守門長在路上 | **2026-09-22 照現況重寫**（原文寫的 `./deploy.sh` 從未建置，且 **Netlify 2026-08-04 整包退役**，照舊文走會走到拆掉的橋）。現行兩段＝①`deploy-site/sync.sh`（源頭→待發佈區，**守門四道長在腳本裡**：破圖／站內死連結 `check-assets.mjs`、內部黑話 `../tools/check-jargon-surface.mjs`、已刪舊站連結 grep、產物勿改橫幅注入＋回退偵測；任一未過 `exit 1`）②`規劃/tools/publish-docs-site.sh`（待發佈區→分享站 gh-pages；**對外區塊名單 `BLOCKS` 是唯一真源**，發佈前跑在途改動健檢 `DEPLOY-DIRTY-TREE-GUARD`＝`workbench/deploy-dirty-tree-guard.sh`，有沒人認領的在途改動就停在動任何東西之前、發佈庫未動可重跑） | 阻擋：sync 四道任一未過即不進待發佈區；在途改動健檢未過即不發佈。**回退＝git**（pipeline repo 無遠端備份，破壞性 git 指令已被 hook 擋，確有必要由使用者本人執行） |

---

## 4. 每功能 Definition of Done（12 項；〔自動｜人工〕）

1. 〔人工〕分支（**範圍限出貨守門類**；2026-09-22 使用者裁 Q1 甲）：動到 `.dod-baseline.json` `reviewRequiredPaths` 名單內的檔＝走 `feat/xxx` 再合併；其餘單人改動直接改 main＝合規。
   **為什麼縮範圍**：原文寫「一律走 `feat/xxx`，未直接改 main」，2026-09-22 實查——**從寫下來到當天，一次都沒有被遵守過**（打包機七次改動全在主線，當天兩個治理 commit `b5330f6`／`eb64096` 也是）。假規則比沒規則更傷：它讓每次 review 都固定記一筆「未過」，久了對紅字麻木，真正該紅的那次就被一起忽略。縮成做得到的範圍後，出貨那條線的可追溯性由 G5（同批必留 review 記錄，機器擋）承擔，不靠這一條。
   **分支的第二個用途＝表達「做完了但還不出貨」（2026-09-22 使用者裁，原則）**

   上面那條管的是**可追溯性**（改了東西有沒有人審）。這裡講的是**出貨閘**（做好了要不要出去）——同一個工具、兩個用途，讀的時候不要混在一起。

   **缺口**：`tools/pack-editor.sh:49` 是 `rev-parse --short HEAD`，也就是**打包拿倉庫現在的樣子裝箱**。所以「commit 進 main」＝「下一次出貨就帶上」，中間**沒有第三種狀態**。以前不成問題（做好就發），但 2026-09-22 訂了每週固定窗＋交付前凍結線（77 號 §9）之後，「完成品暫存架」第一次變成必需品。**而且不是假設**——9/27 保險格若條件成立就會打包，所以「交付前不會打包」這句話本身沒有保證。

   **原則**：

   > **凡是「已完成但還不該出貨」的工作，必須用下面三種之一把它表達出來——不能只靠「我們記得不要打包」。**

   | | 做法 | 適用 | 風險 |
   |---|---|---|---|
   | **甲** | 開 `feat/xxx` 分支，**打包前切回 main** | 一兩件事、時間短 | **打包機不檢查分支**——站在分支上打包就會出貨 |
   | **乙** | 打包改吃指定版本（`--ref`），不再無條件吃 HEAD | 長期正解 | 動打包機＝在 `reviewRequiredPaths` 名單內＝要走分支＋G5 留 review 記錄，且會改 pipeline hash 連帶改 tag 與說明檔檔名 |
   | **丙** | 功能旗標：程式進 main 但預設關閉 | 需要在 main 上共存、隨時可開 | 旗標會累積；**沒開過的旗標就是死碼**（67 號假閘同型） |

   **為什麼這條不會變成本項第一段說的那種「假規則」**：它不是每次 commit 都要打勾的例行項，而是**只在「這件事現在不該出貨」成立時才觸發**的設計決定。判準一句——**你能不能指出「它不會被打包」是靠什麼機制成立的？指不出來就是靠記得。**

   **首例（2026-09-22）＝`CMS-BRIEF-AI-PATH`（AI 策展路讀策略檔），走甲。** 它要動的 `workbench/curate_prompt.md` 與 `workbench/server.js` **都不在 `reviewRequiredPaths` 名單內**，照本項第一段＝直接改 main 本來就合規；但使用者裁「**不趕在 9/30 發**」，所以**這一次刻意走分支 `feat/ai-brief-path`，並明確不立通則**——立通則就會重犯上面剛廢掉的那個病。

   **乙＝已入代辦、待完整評估，不排開工日（2026-09-22 使用者指示）**：「開工前再做完整評估、規劃後才進行開工」。**不要因為它是「長期正解」就順手做掉**——它動的是出貨機，影響面比看起來大（改 pipeline hash → 連帶改 tag 與說明檔檔名 → 牽動 77 號 §5 的三處落點與 `releases/index.json`）。落點＝行事曆 `PACK-REF-EVAL`（planned，交付後）。

   **同批的一句紀律**（因為甲有那個風險）：**打包前先確認自己站在 main。** 已寫進行事曆 `CMS-EDITOR-P7-PACK` 備註——寫在要打包的人一定會看到的地方，不另立條文讓它沉下去。

2. 〔自動 G1〕**改源頭非產物**：沒改 `runs/**`、`live-drafts/**`、`deploy-site*/**/index.html`；改 FrameTest 引擎已確認二階下滲重跑（根因1）
3. 〔自動 G2〕**無新增空吞 catch**：新增 `catch(e){}` 數為 0，每個新 catch 都 log/rethrow/setError（根因2）
4. 〔人工 R3〕**報告已同步**：改 draft/snapshot/state 已同步更新所有依賴 render（`lastProdcheck→renderProdCheck`、價格報告、核可 chip、preview iframe），且**同類全掃**（根因3）
5. 〔自動 G3〕**核可不變式**：新增寫 `draft.json` 路徑已呼叫 `invalidateApproval(id)` 並登錄 `scripts/draft-writers.allow`（根因4）
6. 〔人工 R5〕**真值漂移**：money 欄位取快照/實抓非 AI/draft；gdid 用系統索引回錨非列序（根因5）
7. 〔自動〕測試：本功能對應 node:test 已補；改 `rules.json`/`gate.js` 必附一正一負 fixture
8. 〔自動〕一鍵驗證：`dod-check.sh static` 綠
9. 〔自動〕部署級（若上線）：`dod-check.sh full` 綠。
   **⚠ 這一項在 2026-07-26～2026-09-22 之間不可能成立，要記得為什麼**：`dod-check.sh` 的第 ④ 步自建檔起就寫成 `node selftest_run.js` **不帶參數**，而那支需要一個 FrameTest.html 路徑——沒帶就印用法、exit 2。也就是說 **58 天裡「部署級全檢」的渲染迴歸一次都沒真的跑過，而且 full 永遠是紅的**。沒被發現的原因很平常：full 很少跑，偶爾跑看到紅，以為是別的項目。2026-09-22 修（來源改讀 `.dod-baseline.json` `frameTestCandidates`，與 G4 共用同一份名單，不另立第二處）。
   **這件事的教訓跟 Q1～Q6 是同一個**：條文寫了、東西掛了，但**沒有任何人或機器在確認那道門真的在看**。它不是靠讀文件發現的，是接線時被迫實跑才掉出來的。
10. 〔人工〕a11y／設計（若動互動/版型）：補 aria 斷言＋Safari/Firefox/mobile 375 走查
11. 〔**人工**〕文案（若動可見字串）——**本項沒有通用工具，判準靠人**（2026-09-22 使用者裁 Q2 甲）：
    ① **文案三問**＝給誰看／看完要他做什麼／他的詞彙裡有這個詞嗎
    ② **禁機械 AI 句式**＝不用「＝」「①②③」箭頭串接、嵌套括號那種規格書體（條文＝root `CLAUDE.md` 溝通節；內部規格 md 不受此限，溝通版一律適用）
    ③ **介面禁詞**＝貨號（`layout-*`）、文件編號、內部治理詞彙（試用／灰度／門票／值域／映射表／rollout）不上 CMS 介面
    ④ **錯誤訊息公式**＝白話先講、技術訊息收句尾括號、每條含 action item；不出現「不可用」「不可選」（能上架的才進選單）
    **既有的機器絆線只有兩條，範圍都很窄，不要當成本項已自動化**：`test/unit/layout_choice.test.js`（CMS 版式顯示欄禁詞）與 `規劃/tools/check-jargon-surface.mjs`（CP-A3，掛 `deploy-site/sync.sh` 守門段，只守進度兩頁顯示層不得直印任務技術全名）。
    **原文寫的 `npm run lint:copy` 從未建置**（屬 §8 P1 未建項，同批已在該節標明），引用已刪除——留著它會讓人以為有機器在看文案，其實沒有。
12. 〔自動 G5＋人工〕記錄：commit 訊息尾帶根因類型＋同類掃描證據；`docs/reviews/`、`docs/design-qa/` 留檔。**動到出貨守門／打包機那條線＝機器擋**（名單＝`.dod-baseline.json` `reviewRequiredPaths`，漏留紀錄即紅、擋 commit；2026-09-21 使用者裁「寫成規則、建立流程」，病例＝打包機改 7 次只有 1 次 review 落檔、之後 5 次全漏）

---

## 5. Code Review 清單（5 根因＋風險分級）

> **開新欄位、新名牌之前，先問「現有的欄位是不是已經在做這件事」（2026-09-11 卡牆裁決入 SOP；卡＝`20260903-ask-if-a-field-already-exists`）**：用概念詞與同義詞搜三處——資料契約（有沒有這格）／登記簿（有沒有這本）／引擎（有沒有已經在吃）。同一個概念兩套機制，以後改一邊、另一邊就漂（同日病例＝欄位長度上限三份複本）。反面同一條：標「會生效」之前先指出消費端在哪一行程式，指不出來就是沒生效。


- **R1 改產物非源頭**：`git diff --name-only | grep -E 'runs/|live-drafts/|(deploy-site).*/index.html'` 命中即該改源頭；改 FrameTest 引擎必問二階下滲
- **R2 靜默失敗**：新增空 catch 應為 0；fetch 都有 `.catch`/try 出聲
- **R3 報告沒同步**：改 draft/state 有無同步依賴 render，且同類全掃（apply↔swap↔promo-recompose）
- **R4 核可 invariant**：新增寫 draft 路徑必 `invalidateApproval` 並登錄 allowlist；未登錄新寫入點 guard FAIL
- **R5 真值漂移**：money 取快照/實抓；gdid 系統索引回錨
- **密鑰**：staged 不含 `.wb-pass`/`.google-*.json`
- **風險分級**：`gate.js`/`rules.json`/`price_qa.js`/`fetch_parse.js`/寫 draft/動 money/新端點＝【重】必轉 Claude 第二審＋補 test；其他端點/UI 狀態同步＝【中】自審＋同類掃描；文案/README＝【輕】guard
- **修 bug 三問**（附 grep 證據）：哪類根因／同類幾處／是否一次修整類
- **G5 出貨守門改動必留 review（機器擋，2026-09-21 使用者裁「寫成規則、建立流程」）**：動到 `.dod-baseline.json` → `reviewRequiredPaths` 名單內的檔（打包機 `tools/pack-editor.sh`、憑證斷言 `tools/pack_assert.js`、進包內容產生器 `tools/build_pack_whatsnew.js`、包根源頭 `tools/pack-root/`、解包冒煙 `test/browser/pack-smoke.js`，以及**守門自己**＝`tools/dod-guards.js`／`.dod-baseline.json`／`.githooks/`；另含抓價兩支 `price_qa.js`／`fetch_parse.js`），同一批 commit 裡必須有 `docs/reviews/` 或 `docs/design-qa/` 的 `.md`，否則 pre-commit 紅燈擋下。
  - **為什麼守門自己也列入**：不然可以先放寬基線把這道門關掉，再去改打包機——關門的那一刀也會被這道門擋住。
  - **緊急繞過**＝`git commit --no-verify`，但要補一筆**豁免五欄**（見下條豁免紀律）；到期未處理＝下次 review 視為未過。
  - **名單真源＝`.dod-baseline.json`，不是程式碼**；新增出貨相關腳本＝同批把路徑補進名單（測試 `test/unit/dod_guards_review_gate.test.js` 會斷言名單涵蓋打包機與守門自己，漏補即紅）。
  - **立法病例**：`tools/pack-editor.sh` 自 2026-09-16 第一版起被改 7 次，`docs/reviews/` 只有 1 次落檔（09-16 打包前總檢 24 條），之後 5 次改動全沒留紀錄——包含 09-21 當日兩場。靠人記得不管用。
- **豁免紀律（到期日制，2026-08-11 併入）**：任何「跳過檢查／繞過門檻／手動豁免」（SKIP_REASON、tagSource=manual、gate WARN 收編、一次性紅燈裁決……）記錄時**五欄齊**：誰批的／為什麼／何時批的／**何時到期**／到期後動作（複查或轉正式規則）。到期未處理＝下次 review 視為未過。動機：豁免一旦寫下就永久有效＝隱形技債；到期日讓每筆豁免自帶「回來看我」的鬧鐘。
- **證據綁定（2026-08-11 併入）**：阻斷級結論（「通過可 merge」「FAIL 已修」「豁免成立」）必須綁一個**可重跑或可核對的產物**——fixture、截圖、grep 輸出、report 指紋、commit hash；不接受「我看過了」。本專案既有慣例（review 附 grep、design-qa 附截圖）之明文化。
- **審查唯讀（2026-08-11 併入）**：review／覆核用途的 agent 一律唯讀不寫入、不提交。結構性載體＝**專案根**（不是本 repo）`.claude/agents/code-reviewer.md`（工具清單只有 Read/Grep/Glob＝想犯都犯不了）；即席 prompt 審查仍須明寫唯讀。紀律起源＝2026-07-27 覆核 agent 代提交事故（afd51e5/58369c7，詳 docs/reviews/explore-fix-and-price-truth-2026-07-27.md）。

## 6. Design QA 清單（8 項；AUTO/MANUAL）

1. AA 對比：六主題 `checkTheme`（小字≥4.5、大字≥3）＝AUTO；自訂色走 `assessSeedColor→_ensureAA`＝AUTO
2. 行動版對比：mobile 375／tablet 768 實際字級對比斷言——**入口＝`npm run design:qa <活動頁編號>`**（`tools/design_qa.js`，2026-09-22 裁 Q4 甲落地）

   **這一項原本是假的，要記得為什麼**：原文寫「＝AUTO，由新 design_qa.js 負責」（**此處刻意不加反引號**——那是被更正掉的舊敘述，加了會讓未來的條文掃描器把它當成一次真的點名），2026-09-22 實查那支程式**從來不存在**。而同批全庫搜出更難看的一件——我們其實已經寫了**六支**設計掃描器，**每一支都零自動呼叫端**，要人記得手動打指令才會跑（鐵律 4「同類幾處」：本題原本只問了可讀性那一支）。`tools/design_qa.js` 因此**不含任何檢查邏輯**，它只是把六支串成一個入口。
   **SKIP 黑洞怎麼補的**：退出碼 `0`＝該跑的都跑了且全綠、`1`＝有不合格、**`3`＝跑到的都綠但有項目根本沒跑**（沒給活動頁編號／工作台沒開）。3 不是通過，是沒驗；逐項逾時亦計為未過並講明是逾時，不靜默跳過。

   **接線進度表（2026-09-22 逐支實跑的底牌；哪一支清乾淨了就把它接進 `dod-check.sh full`，別讓它繼續當孤兒）**

   | 項 | 在看什麼 | 現況（2026-09-22 收工時） | 接線 |
   |---|---|---|---|
   | `weight` | 背景圖重量（手機一進頁要下載多大） | ✅ 綠（現役 29 張、無新增過線；存量欠帳 20 張照列不擋） | **已接** `dod-check.sh full` ⑤ |
   | `contrast` | 每段字對它實際坐的底色夠不夠清楚 | 🟡 **大幅改善**：劃線原價 26 處→**0**（Q7 甲′ 落地）；三款只剩 3 紅，全在「注意事項」區＝**另一個根因**（主題有色底 vs 對白底挑的字色），排 10 月 | 需活動頁＋工作台，不入 commit 閘 |
   | `slots` | 編修器說有的格子，畫面真的畫得出來 | 🟡 **2 紅→1 紅**：跑馬帶那筆是**掃描器誤報**（已修，見下）；剩 1 筆是真的（layout-012 促購小字） | 待清乾淨 |
   | `clip` | 文字被裁切／溢出 | ❌ **比原報的廣**：錨點列在平板溢出＝**8 顆錨點以上就會發生**（005 列寬 901／003 列寬 976 vs 視窗 768、`overflow-x:visible` 不能捲），最後幾顆含「回到頂端」點不到 | **不接**——見下方警語 |
   | `onoff` | 某個零件沒填時版面會不會塌 | ❌ 8 紅（全是「空洞」：選填欄位沒填、位置還占著）＋12 待人判斷（絕對定位件）；落在 011／012 | 待清乾淨 |

   **⚠ 兩條當天學到的、寫下來免得重犯：**
   1. **「clip 幾乎是綠的」是錯的判斷，錯在我挑的素材。** 當時 layout-003 只測手機、005 只測手機＋平板，於是看起來「三款測兩款全綠」。補測平板後才發現是**錨點數量驅動**的普遍問題。這正是卡 `20260921-fixtures-that-flatter-the-gate`（測試綠可能只因為素材是我挑的最短那個）——**接閘前要先確認綠燈不是素材挑出來的**。
   2. **掃描器自己也會誤報，要先複現再修版型。** layout-012 跑馬帶那筆的根因在 `tools/slot_coverage_audit.js` 的 `squash()`：它剝掉了品牌帶的 `・` 分隔符，卻沒剝跑馬帶的 `｜`——而欄位名就叫「跑馬帶文案（**用｜分段**）」，引擎 `split(/[｜|]/)` 後分隔符不落 DOM，於是比對永遠失敗。**同一條規則兩道門只改了一道**（鐵律 4）。已修並全款迴歸（✖2→✖1）。若當時直接「照報告修版型」，就會去改一個完全正常的跑馬帶。

   **為什麼不是六支全接進閘**：接紅的進去＝`full` 第一天就擋住所有部署，那種門兩週內會被 `--no-verify` 繞過，那時守門看起來在、其實不在，比沒有更危險（同 `.dod-baseline.json` `_reviewScopeNote` 的分層理由）。
3. a11y 語意：`aria-live`＋landmark 各 1＋icon-only 有 `aria-label`＋img 有 alt/aria-hidden＝AUTO（runSelfTest 新增 a11y 區塊）
4. 鍵盤／焦點：裝置預覽 Esc 關閉焦點回錨；輪播/錨點可鍵盤操作＝MANUAL＋部分 AUTO
5. RWD 版型：375 走查溢字/KV fit＝MANUAL（不追像素回歸）
6. 跨瀏覽器：Safari `color-mix`/`color(srgb)`、Firefox 算色＝MANUAL 走查一次
7. ux-writing 文案＝**MANUAL**（2026-09-22 使用者裁 Q2 甲；原標「AUTO WARN」所依據的 `lint:copy` 從未建置）：判準四條見 §4 DoD 11；✗/⚠ 訊息都有 action item。窄範圍機器絆線兩條＝`test/unit/layout_choice.test.js`（CMS 顯示欄禁詞）、`規劃/tools/check-jargon-surface.mjs`（進度兩頁不得直印技術全名）
8. WYSIWYG 同步：對照依賴登記表，改 draft/report 的動作已呼叫所有依賴 render；export_verify 變更後同步斷言＝AUTO＋MANUAL
9. **欄位/排版破版檢查（2026-07-29 使用者裁決＝每次新增功能後必跑）**：headless 三 viewport（375/768/1440＝09 §1.1 基準點：mobile 基準/tablet 基準/desktop 設計基準；2026-08-11 使用者裁決與 kit 統一——舊值 390 非規格基準點，歷史紀錄檔維持原文不回改）對受影響頁面全高截圖＋機械掃描（水平溢出 `scrollWidth>innerWidth`、表單控件 bounding box 重疊/裁切、fixed/sticky 元素遮擋內容）＝AUTO；**截圖必須人工逐張過目**（機械掃描只抓幾何違規，抓不到「幾何合法但不可讀」的破版——2026-07-29 #report-tip 一字一行直排已拍進截圖卻被收為通過證據＝實證）＝MANUAL；截圖留 `docs/design-qa/<功能>-shots/`＝證據；發現破版＝當批修完才算 done，不留待下批

---
10. **分析師字典保鮮（2026-09-08 使用者裁＝寫進工作流）**：凡動到 `lib/content_modules.js` 的欄位形（`defaultNodeFor`／`emptyInfoRow`／`emptyPromoCard` 加欄、改名、刪欄）、`規劃/modules.json`（**登記簿在另一個 repo**，本 repo 內同名檔只有測試素材 `test/fixtures/registries/modules.json`，別改錯）的模組或版型登錄，給資料分析師的字典（分享站的 `/tracking/` 三張 CSV＋`/ia-map/`＝**另一個 repo 的產物**＝`規劃/deploy-site/tracking/`、`規劃/deploy-site/ia-map/`）由 `規劃/deploy-site/sync.sh` 自動重產、**不手改**；但欄位鍵是機器讀的、白話說明是人寫的——**新增欄位＝同批補 `2026-AI自動化活動頁生成規劃/tools/lib/field-dictionary.mjs` 的 CODE_FIELD_DESC 一行**（畫面上是什麼／誰填／機器驗什麼／連結指向／GA4 對應）**＋同批補 `CMS_COPY` 一行「給營運看的說法」**（CMS 欄位淺灰提示 ph／預覽灰字示範句 ghost；70 號 2026-09-09 起 CMS 的欄位提示從這裡長），任一缺＝匯出器 throw、擋 sync（鐵律 3 大聲失敗）；CMS 產物 `workbench/public/cms-hints.json`＋`module-specs/*.png` 由 `tools/build_cms_hints.js` 重產（sync.sh `--strict`／server 啟動自動跑；產物受 R1 hook 守門、保鮮絆線＝`test/unit/cms_hints.test.js`）。改欄位的 PR 收尾跑一次 `node tools/export-module-dictionary.mjs` 看綠＝AUTO。

## 7. 測試策略（零新相依，用 Node 內建 `node:test`）

- **unit**（毫秒級離線）：`test/unit/` — `vendor_sheet`（真值安全狀態機、刪列/亂序回錨）、`price_qa`（promo<current 三案、balancedEnd 餵 regex 字面量不 throw＝07-21 迴歸）、`fetch_parse`（解析/liveness，手寫最小 HTML fixture）、`google_sheets`（OAuth 狀態機純函式）
- **integration**：🔴 **未建**（2026-09-22 實查更正）。原文把 `test/integration/governance.test.js` 寫成現行制度——「每個寫 draft 旁路端點逐一斷言 `approvedAt===null`；新增端點沒進表即測試紅＝結構性強制」。**那支測試與整個 `test/integration/` 目錄都不存在**，這句承諾的「結構性強制」目前沒有實體。
  **現場真正在守核可不變式的是三點一面**：①**面**＝`tools/dod-guards.js` G3 數量 ratchet（數 `draft.json` 寫入點，超過基線即紅）＋G6 基線調動閘（**改基線必須同批登記 `scripts/draft-writers.allow`，不准只改數字**；2026-09-22 裁 Q3 丙補立）②**點**＝`test/unit/publish_stamp.test.js`（蓋章邏輯本身）、`test/unit/ui_aem_flow.test.js`（沒核可不准製作 AEM）、`test/browser/unapproved-banner-journey.js`（未核可橫幅走查）。
  **差別要講清楚**：三個點各守一條路，**不是一張網**——新增寫入點時，G3 會叫你注意、G6 會逼你登記並寫下它怎麼讓章失效，但**沒有任何機器去驗那一行登記是不是真的**。補網（table-driven 逐一驗章）＝2026-09-22 裁 Q3 甲，排 10 月初（行事曆 `APPROVAL-NET-TEST`）。
- **e2e**：🔴 **未建**。`test/smoke/journey.smoke.js` 與 `test/smoke/` 目錄不存在；主旅程走查目前靠 `test/browser/*-journey.js` 那一族（各自針對一條旅程，非單一可重跑入口）。
- **regression**：既有三閘掛可發現 npm script＋`test/gate_golden.test.js`（execFileSync 跑 gate CLI 斷言 exit code＋CP 規則碼，把 parity 17/17、30/30、14/14 落成實 fixture；改規則必附一正一負 fixture）
- **測試反模式掃描（review 時逐條；防「全綠但其實什麼都沒測」的假安全感）**：
  1. **僅樂觀路徑**——套件只走 happy path，缺邊界值與錯誤路徑（本專案 money 規則的 FAIL 路徑必須有負 fixture，見上）
  2. **互動無結果**——斷言了「有呼叫某函式」卻沒斷言任何可觀察結果（回傳值、狀態、輸出檔）
  3. **替身喧賓奪主**——測試主要內容是 mock/stub 的架設與呼叫次數斷言，真正的行為沒被測到；替身要有邊界理由（外部服務、慢 I/O），不是預設手段
  4. **mock 掉被測物自身**——替換了應用程式自己的模組＝測的是替身不是程式
  5. **快照／截圖／覆蓋率當唯一證明**——行為變更只拿快照 diff 或覆蓋率數字背書＝沒有行為斷言（本專案實證＝2026-07-29 #report-tip 直排破版拍進截圖仍被收為通過證據——截圖是證據載體，不是免看的通行證）
  6. **通道測試**——對 trivial 取值/設值寫測試充數
  （摘譯改寫自 [robert-hoffmann/uncle-bob](https://github.com/robert-hoffmann/uncle-bob)（MIT）ub-governance testing posture；2026-08-11 評估後選擇性採用——整套框架不採，僅摘此清單＋豁免紀律＋證據綁定三項，評估紀錄見 tracker §8 當日行）

---

## 8. 要建的產物（21 項）— 逐項現況

> **這一節是 2026-08 的待辦清單，不是現行制度。**（2026-09-22 補標）前面幾節曾把這裡還沒建的東西用現在式寫成「會跑」「＝自動」，兩邊從沒對帳過——同一份文件第 4 節說「跑這個指令」、本節說「這個指令要建」，而讀的人只會讀第 4 節。這是「條文寫了、東西沒做」的製造機（2026-09-22 一次掃出 18 筆，14 筆源於本檔）。
> **規矩：本節任一項的狀態改變，必須同批回頭改前面引用它的句子。** 機器絆線＝Q6 甲掃描器（排 10 月初，行事曆 `DOCTRINE-SCANNER`）。
> 統計（2026-09-22 逐項實查）：**已建 9｜部分 2｜未建 10｜撤案 3**。

**P0（地基＋機械守門）**
- ✅ **已建** `dod-check.sh`（實際兩模式：static／full；原文寫的 feature 模式未建，無人引用）
- 🚫 **撤案** ~~`scripts/review-guard.js`~~ → 由 `tools/dod-guards.js` 承擔。不另建一支，避免兩套守門各講一套（2026-09-21 釐清：原文件把它寫成 pre-commit 實際跑的東西，實體一直是 dod-guards）
- ✅ **已建** `tools/dod-guards.js` — 現為 **G1~G6**（G1 產物/密鑰、G2 空 catch、G3 draft 寫入點 ratchet、G4 tokenizer、G5 出貨守門改動留 review、**G6 draft 寫入點基線調動必附登記**）
- ✅ **已建** `scripts/draft-writers.allow`（draft.json 寫入點 allowlist 絆線）
- ✅ **已建** `.dod-baseline.json`（ratchet：空 catch 上限、寫 draft 點上限、review 名單）
- 🟡 **部分** `package.json` — exit-1 樁已移除，`check`／`check:full`／`guard`／`test`／`test:unit`／`selftest`／`gates`／**`design:qa`** 已接；**`smoke`／`lint:copy` 未接**（兩者本體分別屬未建與撤案）
- ✅ **已建** `.githooks/pre-commit`
- ✅ **已建** `test/gate_golden.test.js`＋`test/unit/`（原訂四支純模組，現為 **70 支**）

**P1（測試網＋旁路收斂＋記錄）**
- ❌ **未建** `test/integration/governance.test.js`（目錄 `test/integration/` 亦不存在）——**這是 2026-09-22 Q3 的核心**：§7 曾把它寫成現行的「結構性強制」。補網排 10 月初（行事曆 `APPROVAL-NET-TEST`）
- ❌ **未建** `test/helpers/server_harness.js`（目錄 `test/helpers/` 亦不存在）
- ❌ **未建** `test/smoke/journey.smoke.js`（目錄 `test/smoke/` 亦不存在）；主旅程走查現況＝`test/browser/*-journey.js` 一族
- ✅ **已建** `test/fixtures/`
- ✅ **已建** `tools/design_qa.js`（2026-09-22 裁 Q4 甲落地）——**不是新造一支**，而是把六支已存在但零自動呼叫端的掃描器串成一個入口（見 §6 項 2）
- 🚫 **撤案** `lint_copy.js`（2026-09-22 裁 Q2 甲）——「什麼叫機械 AI 文案」難自動判，容易誤報一堆、反而養成「紅燈照過」的習慣。改列人工判準，見 §4 DoD 11
- 🚫 **撤案** `deploy-site/deploy.sh`（2026-09-22 裁 Q5 甲）——它假設的 Netlify 部署 **2026-08-04 已整包退役**。現行發佈鏈與其守門見 §3 階段 5
- ❌ **未建** `docs/CODE_REVIEW.md`、`docs/FEATURE_CHECKLIST.md`、`workbench/design-qa.md`——三份的**內容其實已經住在本檔 §5／§4／§6**。要嘛不建（本檔即權威），要嘛建成指路頁；**別再寫成「已有三份文件」**
- ✅ **已建** `docs/stories/`、`docs/reviews/`、`docs/design-qa/`（目錄類）

**P2（精緻層）**
- ✅ **已建** `.github/pull_request_template.md`
- ❌ **未建** `eslint.config.js`（最小 flat：no-empty allowEmptyCatch:false 等四規則）
- ❌ **未建** `.githooks/pre-push`——§3 階段 2 原寫「pre-push 跑 static」，已同批更正
- 🟡 **部分** `gateStale` — **前端旗標已實作**（`workbench/public/index.html` 30 處，中樞＝`afterDraftMutation`：gateStale＋清 approvedAt＋loadRuns＋autoRegate）；**本項原本要的「approve 端點快照 rules.json version、規則收緊標舊核可需複檢」未建**（全庫無 `rulesVersion` 快照）。§1 缺口表寫的「`gateStale` 從未實作」是 2026-08 的舊況，已同批更正

---

## 9. 導入順序（先地基後精緻）

- **Phase 0 — 安全與版控地基**：chmod 密鑰→gitignore→git init→check-ignore 目視→baseline commit→接 GitHub；deploy-site 兩站各做一次
- **Phase 1 — 接線真閘與機械守門**：修 `npm test`→建 review-guard/dod-guards/allowlist/baseline→回填 33 空 catch 歸零→pre-commit→dod-check.sh
- **Phase 2 — 最高槓桿測試網**：gate golden fixture（3~5 正負案）→四支 unit→治理 integration→helpers/fixtures 入庫
- **Phase 3 — 收斂旁路與 e2e**：deploy.sh 包 full 守門、禁裸跑→journey.smoke.js→browser fallback→gateStale
- **Phase 4 — 設計/a11y/文案精緻層**：runSelfTest a11y 斷言→design_qa.js→lint_copy→docs/CODE_REVIEW/FEATURE_CHECKLIST/PR 模板/eslint/pre-push

---

## 10. 首批 backlog：13 功能驗收找到的 18 個旅程缺口 — ✅ 已修 17（+對抗覆核再補 4）

反向重建 user story/flow 對照後，171/189 驗收通過、18 項需處理。**已於 2026-07-27 全數處理**（headless/unit 驗證＋對抗式覆核 confirmed）：

- ✅ **同類根因批（6 處，一次修整類）**：抽 `afterDraftMutation` helper（gateStale＋approvedAt=null＋loadRuns 三合一），收斂 apply-all/promo×2/enrich-ee/editorial×2；rollback 先 loadRuns；banner 去重＋PASS+WARN 自動展開＋核可後重繪
- ✅ **抓價 promotionPrice**：`parseActivityPage` 套實付真值偏好（容忍加引號字串形式）
- ✅ **讀回**：換品帶 `pageGdids`（CP-18 互斥）＋`missing/unknown` 兩分支都提醒
- ✅ **AI 自動補品**：snapshot 缺檔守衛回 needManual（連同 promoLayerOptions 同類補守衛）；auto 逐一 productFetch 即時驗證（掃 10 消假陰性）
- ✅ **TTL 背景重抓**：`isBusy` 納入 exportZip＋product-check 路由加 busyLock
- ✅ **其他**：主題亮/深底存 localStorage；editorial-add setDirty(false)（伺服器已存檔）

**評估後不動碼（5）**：抓價 AC-11（純文件）、Picker folderId 全域（設計取捨）、TTL dirty 競態＋部署閘時序（unknown 非碼 bug）、OAuth token 有效性（需網路驗證，列後續）。
**待治理裁決（未動）**：單品 vs 批次 apply-live-price 核可失效不對稱；`r3-add` busyLock（需 swap 流程層）。

---

_本文件為活文件；每次流程調整、baseline 變更（如空 catch 上限）都應在此更新並記於 commit。_
