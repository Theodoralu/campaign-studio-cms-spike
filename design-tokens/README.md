# design-tokens／設計系統中央廚房（真源）

2026-08-20 開張。這裡是設計系統「機器可讀真源」的家：色彩變數的正本放這裡，CMS、Hub、/design 探索都來這裡取用。改配方改這裡，不改各家廚房。

## 內容物

- `tokens.json`——真源。色彩 21 變數 × 10 主題（首抓自 Figma「活動頁色彩」變數集合，2026-08-20）。
- `build-css.mjs`——生成器。跑 `node design-tokens/build-css.mjs` 產出 tokens.css。
- `tokens.css`——產物，可直接給 CMS／網頁引用。**不要手改**，改 json 再重跑生成器。

## 更新流程（「同步 token」＝34 號工作流）

1. 設計師在 Figma 01 色牌改變數（照現行裁決規矩）。
2. 裁決批對 Claude 說「同步 token」：讀 Figma 變數 → 跟本目錄 diff → 列出差異給負責人裁決 → 裁可後改 tokens.json → 跑生成器 → commit。
3. 消費端下次取用即新值；主題草案（draft: true）拍板前不得上線。

## 誰在吃這份配方

| 消費端 | 吃什麼 | 時點 |
|---|---|---|
| CMS／pipeline | tokens.css（或 json） | 9 月動工批接上 |
| /design 帶約束探索 | tokens.css 直接餵進對話 | 現在就能用（站 01 沙盒） |
| Figma Library 回推 | tokens.json | 拆檔階段二 |
| Hub／雲端牆 | 展示引用 | 隨批 |

## 邊界與待辦

- CSS 命名（--cs-*）＝v0 提案，42 號升 v1 經工程確認後定案；屆時只改生成器的字首規則。
- 字級階、間距階、版心斷點：暫以 42 號文件為準，待下一輪轉正進 tokens.json。
- 舊 07 號時代變數集合群的整併＝既有拍板題（建議併 34 號案裁），整併前本目錄以「活動頁色彩」集為唯一上游。
- token 巡檢（Figma vs 本目錄自動比對、漂了出聲）＝階段二。
