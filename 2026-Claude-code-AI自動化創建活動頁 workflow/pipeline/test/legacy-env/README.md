# test/legacy-env —— 不在 CI 跑的測試（D5，2026-11-09）

這裡的測試驗的是**單機版作者的設計工作環境**才有的東西：引擎源檔 `MVP_Phase1_LeCreuset_活動頁Prototype_FrameTest.html`、`活動頁色彩策略工具.html`、`規劃/assets/hero-bg/bg-map.js` 等「雙胞胎複本同步」檢查。那些源檔不在這個 repo（屬 Alice 的設計流程），所以整檔 crash。

| 檔 | 原本驗什麼 | 去向 |
|---|---|---|
| colortool_env | 色彩工具頁的環境格 | 不搬 |
| typo_steps_three_copies、engine_twin_tables、explore_cap_sync、hero_stages_twin | 檔位表／上限／階段常數在源檔與引擎之間同值 | D10 改驗 `design-assets/`、`assets/` 裡的建置產物 |
| hero_bg_own_doors | 自備背景三格尺寸 | D10 同上 |
| bg_map_resolves_used_backgrounds | 背景地圖解析 | D10 同上 |
| ga_tracking | GA4 三層注入 | D10 用 fixture 重寫（GA4 第一版預設關閉） |

要看它們在有源檔的機器上跑：`npm run test:legacy-env`。

## 2026-11-09 追加（CI 首跑抓到）
| 檔 | 原本驗什麼 | 為什麼不跑 |
|---|---|---|
| install_sh_netcheck | 單機版安裝腳本 `install.sh` 的 Yahoo 連線探測 | 用 `zsh` 跑 Mac 安裝腳本；Ubuntu runner 沒有 zsh，spawn ENOENT 變 uncaughtException，假伺服器留著不關 → **整個 node --test 掛 4 小時不結束**。單機版發行流程，不搬 |
| pack_unmerged_guard | 打包前「做完沒合併」健檢 | 同上，單機版打包機 |
| pick_port | start-editor.sh 挑埠 | 同上，單機版啟動腳本 |
