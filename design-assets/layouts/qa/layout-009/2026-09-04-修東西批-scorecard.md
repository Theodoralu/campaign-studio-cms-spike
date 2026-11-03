# layout-009 成績單｜2026-09-04 修東西批（路④簡便通道）

範疇：使用者在 CMS 編修 run `2026-09-04-wb-164258`（AOC 機械策展・聯名促銷型）問「活動時間欄位為什麼沒有出現」——預覽上時間帶只剩虛線佔位「活動時間——填上檔期後即入畫」，右欄主視覺槽位裡沒有可填的欄。
動作類別＝動登記簿真源（layouts manifest 槽位）；引擎、CMS 程式零改動。

## 病因（一句話）

**引擎畫了活動時間帶，登記簿沒登這個槽，而 CMS 的欄位是照登記簿長的**——`heroSlotEditorHtml` 只在版式 `slots` 含 `time-band`（且 state≠off）時端出「活動時間」欄；layout-008／009 的登記簿把時間帶寫在 `slogan-left` 的說明文字裡（「左標語組＝品牌帶＋主標＋活動時間帶」），從沒登成獨立槽。來源實抓的 `page.kv.dateValue` 又是空的（機械策展來源頁沒有檔期），於是佔位永遠掛著、也永遠沒得填。

## 修法

- `design-assets/layouts/manifest.json` v0.7.9 → **v0.7.10**：layout-008／009 各補一槽 `{ key: "time-band", state: "on" }`（插在標語與商品槽之間＝板上由上而下順序）；`slogan-left` 說明去掉「＋活動時間帶」（一件事只登一處）。
- 欄位本體零新寫：CMS 既有 `time-band` 分支（2026-08-25 人工填寫制）寫 `page.kv.dateValue`；引擎 S12 渲染器既有讀 `kv.dateValue`。

| 閘 | 查了什麼 | 過沒過 | 證據 |
|---|---|---|---|
| 同類幾處（鐵律 4） | 全引擎掃「填上檔期後即入畫」佔位：L001／S10W／L005／S12×2／L010 六處；逐一對登記簿——001/003/005/010 slots 已有 time-band(on)；S10W 的時間帶以 `layoutId === "layout-003"` 開關、002 登記簿 off＝一致；**只有 008/009 兩款登記簿漏槽** | ✅ 兩款同批補 | grep＋manifest 對照 |
| CMS 目錄下發 | `catalogForForm(loadLayoutDeps())` layout-008／009 slots | ✅ | `slogan-left time-band(on) product-main discount-digit(on/off)` |
| /api/layout-catalog 快取 | 每次請求重讀登記簿、無啟動快取 | ✅ 不必重啟 server | server.js 1788 |
| 單元測試 | proposal_pack／layout_choice（活真源） | ✅ | 45/45 |
| 點名 | layout-009 `--books=manifest,registry,hubpage,variants`、layout-008 `--books=manifest,variants` | ✅ 全過 | 生成器冪等重跑（REGISTRY／版型庫頁） |
| 價格真值 | 檔期＝真值欄：欄位說明照舊「系統抓到會自動帶入並逐字核對；沒抓到可自己填」，AI 不代填 | ✅ 未動真值鏈 | 14 號 §2.13 人工填寫制 |
| 旅程 | 使用者重新整理編修頁 → 主視覺槽位多「活動時間」欄 → 填 `例：09/04–09/30` → 預覽時間帶入畫 | ⬜ 待使用者親走 | — |

## 根因紀錄（給後人）

1. **槽位寫在說明文字裡不算登記**：`slogan-left` 的 label 講了「＋活動時間帶」，機器讀的是 `slots[].key`，不讀說明。登記簿要當真源，每一件會被程式判定的事都要是一個獨立的欄，不能藏在人讀的字串裡。
2. **引擎有、登記簿沒有＝使用者看得到卻摸不到**：這是「兩邊各說一套」家族病的另一型（同日字風病例＝工具有、引擎沒有）。引擎新增任何有佔位態的可填件，登記簿同批登槽，否則佔位會永遠掛在頁上。
