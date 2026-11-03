#!/bin/zsh
# pick-port.sh —— 決定這個包要用哪個埠開（2026-10-10 使用者裁「丙方案」）
#
# 白話：開工具之前先敲敲門。沒人應門就用這個號碼；應門的是自己人（同一個包）就直接開瀏覽器；
#       應門的是別的程式，就換下一個號碼，而且會講清楚換到哪裡去了。
#
# 守的洞：原本只問「有沒有人應門」，有人就自己退場、把瀏覽器丟給對方——
#   **它分不出應門的是自己人還是別的工具**。使用者機上同時有開發版工作台（也佔 8787）時，
#   每次測試單機版都被無聲地導到開發版：模式不同（負責人 vs 編修）、活動存的地方也不同，
#   等於整趟走查都走在錯的版本上（2026-10-08 病例：當天的走查全跑在開發版，
#   物證＝那一檔活動住在專案 runs/，而單機版自己的家最後一次有東西是 10/02）。
#   同事端一樣受害：任何程式佔住 8787，他就被默默丟過去，然後覺得「這工具怪怪的」。
#
# 怎麼分辨自己人：伺服器 /api/version 會回 mode 與 build。
#   這個包＝mode:editor＋build:<版本號>（workbench/VERSION 第一行；開發樹沒有那個檔＝dev）。
#   開發版工作台＝mode:owner。兩者對不上就是別人。
#
# 輸出：stdout 只有一行 `<埠號> <狀態>`，狀態＝free｜ours｜switched；說明一律走 stderr。
#   找不到可用的埠＝exit 1（呼叫端照自己的方式報錯，這裡不代為決定怎麼講）。
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
START_PORT="${1:-8787}"
TRIES="${2:-5}"

MY_BUILD="$(head -n1 "$HERE/VERSION" 2>/dev/null | tr -d '\r\n ' || true)"
[ -n "$MY_BUILD" ] || MY_BUILD="dev"

port=$START_PORT
i=0
while [ $i -lt $TRIES ]; do
  body="$(curl -s --max-time 2 "http://127.0.0.1:${port}/api/version" 2>/dev/null || true)"
  if [ -z "$body" ]; then
    # 沒人應門。也可能是有程式佔著但不是我們的工具（不回 /api/version）——那樣 curl 一樣拿不到東西，
    # 真正綁不上去的話伺服器自己會報錯，不在這裡猜。
    print -r -- "$port free"; exit 0
  fi
  mode="$(print -r -- "$body" | sed -n 's/.*"mode":"\([^"]*\)".*/\1/p')"
  build="$(print -r -- "$body" | sed -n 's/.*"build":"\([^"]*\)".*/\1/p')"
  if [ "$mode" = "editor" ] && [ "$build" = "$MY_BUILD" ]; then
    print -r -- "$port ours"; exit 0
  fi
  who="別的程式"
  [ "$mode" = "owner" ] && who="另一個「負責人模式」的工具"
  [ "$mode" = "editor" ] && who="另一個版本的 Campaign Studio（$build）"
  print -u2 -r -- "  ⚠ ${port} 被${who}佔著，換下一個號碼試試。"
  port=$((port + 1))
  i=$((i + 1))
done
print -u2 -r -- "  ✗ ${START_PORT} 開始往後 ${TRIES} 個號碼都被佔著了。關掉其中一個再試，或自己指定：CAMPAIGN_PORT=9001"
exit 1
