<!-- 每次產品更新一份 PR。串起變更＋三份記錄＋對照 story/flow。日後推 GitHub remote 即為真 PR。 -->
## 變更摘要
<這次改了什麼、為何>

## 關聯記錄（三份，隨此變更 commit）
- 📖 User story／flow：`docs/stories/<功能>.md`
- 🔍 Code review 記錄：`docs/reviews/<功能>-<日期>.md`
- 🎨 Design QA 記錄：`docs/design-qa/<功能>-<日期>.md`（純後端可註明「不涉 UI」）

## Definition of Done（勾選；細節見 DEVELOPMENT.md §4）
- [ ] 分支 feat/xxx，未直接改 main
- [ ] **改源頭非產物**（dod-guards G1 綠）
- [ ] **無新增空吞 catch**（G2 綠）
- [ ] **報告已同步**＋同類全掃（R3）
- [ ] **核可不變式**：新寫 draft 端點已 invalidateApproval＋afterDraftMutation＋登記 allowlist（G3 綠）
- [ ] **真值漂移**：money 取快照/實抓、gdid 系統索引回錨（R5）
- [ ] 對應 node:test 已補（改 rules.json/gate.js 附一正一負 fixture）
- [ ] `bash dod-check.sh static` 綠（上線再跑 `full`）
- [ ] 動 UI：a11y/RWD/文案走查；動可見字串：`npm run lint:copy` 無新增 WARN
- [ ] **code review 與 design QA 都逐項對照 story 驗收清單**

## 修 bug 三問（若適用）
哪類根因 / 同類幾處（附 grep 證據） / 是否一次修整類
