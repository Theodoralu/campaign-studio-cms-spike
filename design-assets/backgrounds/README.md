# 背景素材資料庫（backgrounds）

先講白話：這裡是活動頁「背景」的正式倉庫。kit 的 hero-backgrounds 是靈感牆，挑中要真的用的，走收編流程搬進來、補齊身分欄位，CMS 之後從這裡讀。規格權威＝45 號文件 §3。

## 每筆素材的身分欄（manifest.json）

| 欄位 | 白話 | 必填 |
|---|---|---|
| id | 編號 bg-NNN | ✅ |
| type | 1＝底紋×主題色（規格在 Figma 不一定有圖檔）；2＝氛圍底圖；3＝四方連續磚 | ✅ |
| name | 人話名稱 | ✅ |
| file | 圖檔名（同資料夾）；規格型素材可為 null | ✅ |
| bridgeColor | ②型必填：頁面銜接底色 hex（圖的邊緣主色） | ②型 |
| tileable | ③型必填 true（要實測拼四張無縫） | ③型 |
| license | A＝企業授權可上線／B＝商用條款過、記來源／C＝僅靈感或示意，正式上線前換掉或查授權 | ✅ |
| source | 來源 | ✅ |
| themeFit | 適配主題 slug 清單（①③型適用；②型藝術指導不隨主題） | — |
| tags | 檢索用 | — |

## 收編流程

kit 靈感層挑選 → 去背/裁切/壓縮 → 補齊身分欄（license C 不得標 A/B）→ 入庫 → Figma「背景板」②型掛實例對照。

## 現況（2026-08-20 建庫）

首批 5 筆＝現役 hero 板背景的目錄登記，**圖檔待匯出批**（Figma 內 imageHash 可經 getBytesAsync 匯出，或設計師手動匯出後補檔）。

## 技術備忘（給 Claude）

- 圖檔匯出通道：`figma.getImageByHash(fill.imageHash).getBytesAsync()`；大檔經 base64 回傳要分段，或請使用者 Figma 端手動匯出。
- bridgeColor 擷取：sharp dominant color 取圖底緣，或人工指定；CMS 端下滲 `page background`。
- ③型入庫前實測：2×2 拼貼渲染看接縫。
