#!/bin/zsh
# pack-unmerged-guard.sh —— 打包前「做完沒合併」健檢（PACK-UNMERGED-GUARD，2026-10-05 使用者裁「加」）
#
# 守的洞：包永遠從 main 的 HEAD 打，但「修好了」不等於「在 main 上」。
# 病例（2026-10-05，本關的存在理由）：「連不出去要說實話」那批 9/24 就在分支上做完、
# 介面文案當日使用者裁過，發佈綁 P6A 真人試跑——P6A 沒跑，於是「先不發」沒有到期日地
# 變成「永不發」；第六版（10/05）打包時沒有任何東西問一句「有沒有做完沒合併的」，
# 工程師與設計師繼續撞 9/22 就修掉的病。跟 67 號假閘同族：裁決是真的、到期面是空的。
#
# 這關不替人決定合不合併，只逼「帶不帶」這個決定在每次打包時重新做一次、說出口。
#
# 用法：zsh pack-unmerged-guard.sh <repo路徑:標籤> [<repo路徑:標籤> ...]
# 環境（選配）：PACK_UNMERGED_OK="理由"  名單我看過、明講這次不帶（理由進打包紀錄）
# 判準：git cherry（比補丁指紋、不比祖先）＝已經揀收進 main 的 commit 不會誤報；
#       解過衝突的揀收指紋會變＝仍會列出，由人回答——寧可多問一次，不可漏問。
# 退出：0＝放行（乾淨或已明講）｜1＝擋（有未併 commit 且沒人明講）｜2＝用法錯
#
# 抽成獨立一支的原因＝測得到（沿 deploy-dirty-tree-guard.sh 前例）：絆線＝test/unit/pack_unmerged_guard.test.js
set -eu
set -o pipefail

(( $# >= 1 )) || { echo "用法：zsh pack-unmerged-guard.sh <repo路徑:標籤> [...]"; exit 2; }

typeset -a REPORT
REPORT=()
for ARG in "$@"; do
  # 從「最後一個冒號」切：標籤不含冒號，但路徑可能含（本專案資料夾名就有「W:Yu-ting」——首跑就被自己擋，2026-10-05 病例）
  RP="${ARG%:*}"; LABEL="${ARG##*:}"
  [ -d "$RP" ] || { echo "✗ repo 不存在（$RP）"; exit 2; }
  git -C "$RP" rev-parse --git-dir >/dev/null 2>&1 || { echo "✗ 不是 git repo（$RP）"; exit 2; }
  CUR="$(git -C "$RP" branch --show-current 2>/dev/null || true)"
  for B in $(git -C "$RP" for-each-ref refs/heads --format='%(refname:short)'); do
    [[ -n "$CUR" && "$B" == "$CUR" ]] && continue
    # git cherry HEAD <b>：列出 <b> 有而 HEAD 沒有「等價補丁」的 commit（+ 開頭）；揀收過＝－ 不計
    N="$(git -C "$RP" cherry HEAD "$B" 2>/dev/null | grep -c '^+' || true)"
    if (( N > 0 )); then
      LAST="$(git -C "$RP" log -1 --format='%ad %s' --date=short "$B" 2>/dev/null | cut -c1-72)"
      REPORT+=("  ・${LABEL}｜${B}：${N} 顆不在這次要打的程式裡（最後一顆＝${LAST}）")
    fi
  done
done

if (( ${#REPORT[@]} == 0 )); then
  print -r -- "✓ 沒有做完沒合併的 commit（所有分支都已併入或揀收）"
  exit 0
fi

if [[ -n "${PACK_UNMERGED_OK:-}" ]]; then
  print -r -- "⚠ 有分支上的 commit 不會進這個包——PACK_UNMERGED_OK=「${PACK_UNMERGED_OK}」＝明講不帶，照打："
  for L in "${REPORT[@]}"; do print -r -- "$L"; done
  exit 0
fi

print -r -- "✗ 有分支上的 commit 不在這次要打的程式裡——「修好了」不等於「在包裡」，先回答帶不帶："
for L in "${REPORT[@]}"; do print -r -- "$L"; done
print -r -- "  要帶＝先合併（或揀收）再打；確定不帶＝PACK_UNMERGED_OK=\"理由\" 重跑（理由會印進打包紀錄）。"
print -r -- "  看內容：git -C <repo> log HEAD..<分支> --oneline"
exit 1
