#!/usr/bin/env bash
# 重產端到端黃金檔（D5）。只在「刻意改變行為」時跑，並在 commit 說明差異。
set -euo pipefail
cd "$(dirname "$0")/.."
SEED=2026-10-27-wb-085823; FIX=test/fixtures/runs/$SEED
W=$(mktemp -d)/$SEED; mkdir -p "$W"
export CS_NOW=$(node -e "console.log(require('./${FIX}/snapshot.replay.json').fetchedAt)")
export CS_HTTP_MODE=replay CS_HTTP_CASSETTE_DIR=test/fixtures/http GATE_SKIP_HTTP=1 TZ=UTC
node fetch_parse.js "https://tw.buy.yahoo.com/?sub=1035" "$W" >/dev/null
node workbench/curate_auto.js "$W" --scenario "同品類×跨品牌-優惠銷售" --heroCount 4 >/dev/null
node gate.js "$W/snapshot.json" "$W/draft.json" >/dev/null || true
cp "$W/snapshot.json" "${FIX}/snapshot.replay.json"; cp "$W/draft.json" "${FIX}/draft.golden.json"; cp "$W/gate_report.json" "${FIX}/gate_report.golden.json"
git -C . diff --stat -- "$FIX" || true
echo "黃金檔已重產：${FIX}（請在 commit 說明為什麼變）"
