#!/bin/zsh
# 啟動 Campaign Studio.command —— 之後每天雙擊這個。瀏覧器會自己打開 http://localhost:8787。
# 用完關掉這個黑色視窗就好（工具會跟著關）。
# 你做的活動存在 ~/CampaignStudio/runs（P-1 甲，2026-09-16 牆裁；2026-09-21 落地）；策略檔範本留在包裡（伺服器從包裡讀內建範本）。
PKG="$(cd "$(dirname "$0")" && pwd)"
LAUNCH=""
for f in "$PKG"/*/pipeline/workbench/start-editor.sh; do [ -f "$f" ] && LAUNCH="$f" && break; done
if [ -z "$LAUNCH" ]; then
  print -r -- "找不到啟動程式——這個包不完整，請重新下載完整的包。"
  read -k1 "?按任意鍵關閉"; exit 1
fi
mkdir -p "$HOME/CampaignStudio/runs"
export CAMPAIGN_RUNS_DIR="$HOME/CampaignStudio/runs"
# 策略檔也要交代（2026-09-22 修）：原本只交代活動落點，策略檔就被存回包裡面，
# 換一顆包同事寫的策略檔全部消失——而第二版包的說明親口寫著「換電腦都帶得走」。
# 內建範本留在包裡（隨新版更新），自己寫的存這裡（跟著人走）；伺服器啟動時會把舊位置的搬過來。
export CAMPAIGN_MY_BRIEFS_DIR="$HOME/CampaignStudio/briefs/mine"
PORT="${CAMPAIGN_PORT:-8787}"   # 同事不用管；CAMPAIGN_PORT／CAMPAIGN_NO_OPEN 只給打包後的自動冒煙測試用（不開 8787、不彈瀏覽器）
# 先敲門再決定用哪個號碼（2026-10-10 使用者裁「丙方案」；規則單一來源＝workbench/pick-port.sh）。
# 原本不管 8787 被誰佔著都照開瀏覽器，等於把人導去「別的工具」——使用者端是開發版工作台，
# 同事端是任何佔住這個號碼的程式。現在分得出應門的是不是同一個包。
PICKER="$(dirname "$LAUNCH")/pick-port.sh"
if [ -x "$PICKER" ]; then
  if SEL="$(zsh "$PICKER" "$PORT")"; then
    PORT="${SEL%% *}"; PORT_STATUS="${SEL##* }"
    if [ "$PORT_STATUS" = "ours" ]; then
      print -r -- "Campaign Studio 已經在跑了（http://localhost:${PORT}），直接開瀏覽器。"
      [ -n "${CAMPAIGN_NO_OPEN:-}" ] || open "http://localhost:${PORT}"
      exit 0
    fi
  else
    print -r -- ""
    read -k1 "?看完上面的說明後，按任意鍵關閉這個視窗。"
    exit 1
  fi
fi
# 等工具起來（最多 20 秒）就開瀏覽器；已經在跑＝馬上開
(
  for i in {1..40}; do
    sleep 0.5
    if curl -s -o /dev/null -w '%{http_code}' --max-time 1 "http://127.0.0.1:${PORT}/ping" 2>/dev/null | grep -q '^204$'; then
      [ -n "${CAMPAIGN_NO_OPEN:-}" ] || open "http://localhost:${PORT}"; exit 0
    fi
  done
  print -r -- "20 秒內工具沒有起來——看看上面有沒有紅字；沒有的話手動開 http://localhost:${PORT} 試試。"
) &
print -r -- "Campaign Studio 啟動中……瀏覽器會自己打開。用完關掉這個視窗就好。"
exec zsh "$LAUNCH" "$PORT"
