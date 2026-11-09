# test/phase2 —— 第二階段功能的測試（D5，2026-11-09）

`server_brief_flow`：策略檔（brief）流程——組「給 Gemini 的話」、貼上對帳、照策略檔重做。第一版 MVP 只有規則版策展，策略檔屬第二階段（AI 策展），先不進 CI。它用的種子 run 是 `test/fixtures/runs/2026-10-27-wb-085823`（D4 收的），接回來時把 SEED 改過去即可。

跑：`npm run test:phase2`。
