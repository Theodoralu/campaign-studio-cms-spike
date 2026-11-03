#!/bin/zsh
# 安裝.command —— 雙擊這個做第一次安裝（實際跑的是同資料夾的 install.sh）
# 第一次雙擊若被 macOS 擋：右鍵 → 打開；或 系統設定 → 隱私權與安全性 → 「仍要打開」。之後就不會再擋。
cd "$(dirname "$0")" || { print -r -- "找不到資料夾"; exit 1; }
zsh ./install.sh
rc=$?
if [ "$rc" -ne 0 ]; then
  print -r -- ""
  read -k1 "?看完上面的說明後，按任意鍵關閉這個視窗。"
  print -r -- ""
fi
exit "$rc"
