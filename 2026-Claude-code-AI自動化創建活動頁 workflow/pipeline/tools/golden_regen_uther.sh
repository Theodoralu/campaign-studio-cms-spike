#!/usr/bin/env bash
# 重產 uther 版黃金快照（四種網址型），全部離線回放卡帶；只在刻意改變 uther 正規化／組快照行為時跑，並在 commit 說明。
set -euo pipefail
cd "$(dirname "$0")/.."
export CS_HTTP_MODE=replay CS_HTTP_CASSETTE_DIR=test/fixtures/http TZ=UTC
for d in test/fixtures/runs/*/; do
  g="$d/snapshot.uther.json"; [ -f "$g" ] || continue
  url=$(node -e "console.log(require('./$g').sourceUrl)"); at=$(node -e "console.log(require('./$g').fetchedAt)")
  W=$(mktemp -d); CS_NOW="$at" node fetch_uther.js "$url" "$W" >/dev/null
  cp "$W/snapshot.json" "$g"; echo "重產 $g"
done
git diff --stat -- test/fixtures/runs || true
