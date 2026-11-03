#!/bin/zsh
# start-editor.sh —— 同事版（編修模式）啟動：純本機、免登入、不發佈、不連 Google、無看門狗、無排程（69 號 Phase 1；2026-09-15 B 批）
# 用法：zsh workbench/start-editor.sh [PORT]      預設 8787
# 白話：這支只把工具在你自己的電腦上打開；做好的活動頁用「製作 AEM 網頁檔」下載交出去。
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
PIPE="$(cd "$HERE/.." && pwd)"
PORT="${1:-8787}"
export CAMPAIGN_MODE=editor
export CAMPAIGN_RUNS_DIR="${CAMPAIGN_RUNS_DIR:-$PIPE/runs}"
# 編修模式不讀 .wb-bind／.wb-pass（伺服器內建：一律綁 127.0.0.1、免登入）
# Node 用包裡自帶的那顆（P-10 甲，2026-09-16）：同事機沒裝／裝了舊版都不管；找不到才退系統 node。
# 三位受試同事的 Node 狀態＝沒裝／v24／v22——用絕對路徑、不靠 PATH 順序，免得被系統那顆舊的搶走。
case "$(uname -m)" in arm64) ARCH=arm64;; x86_64) ARCH=x64;; *) ARCH="";; esac
NODE_BIN="$PIPE/../../runtime/darwin-${ARCH}/node"
if [ -n "$ARCH" ] && [ -x "$NODE_BIN" ]; then NODE="$NODE_BIN";
elif command -v node >/dev/null 2>&1; then NODE="$(command -v node)"; echo "（包裡沒有自帶的 Node，改用這台電腦的 $(node --version)）";
else echo "找不到 Node——這個包好像不完整，請重新下載完整的包再試。"; exit 1; fi
# 埠號怎麼挑：規則只有一份，在 pick-port.sh（2026-10-10 使用者裁「丙方案」）。
# 有帶參數＝呼叫端（啟動 Campaign Studio.command）已經挑好了，這裡不重挑；
# 直接跑這支、沒帶參數＝自己挑。原本這裡只問「有沒有人應門」，有人就退場把瀏覽器讓給對方——
# 分不出應門的是自己人還是別的工具，使用者每次測試都被無聲導到開發版（2026-10-08 病例）。
if [ $# -eq 0 ]; then
  # 用 zsh 叫，不靠執行權限（包裡的檔不一定帶 +x）
  SEL="$(zsh "$HERE/pick-port.sh" "${CAMPAIGN_PORT:-8787}")" || exit 1
  PORT="${SEL%% *}"; STATUS="${SEL##* }"
  if [ "$STATUS" = "ours" ]; then
    echo "http://localhost:${PORT} 已經在跑了（同一個包），直接開瀏覽器即可。"
    exit 0
  fi
fi
echo "啟動同事版（編修模式）→ http://localhost:${PORT}   （關閉＝按 Ctrl+C）"
exec "$NODE" "$HERE/server.js" "$PORT"
