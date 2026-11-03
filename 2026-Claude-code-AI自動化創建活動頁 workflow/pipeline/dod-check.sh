#!/usr/bin/env bash
# dod-check.sh — 每次改動的一鍵驗證閘。
#   static（預設，秒級離線）：語法＋dod-guards(G1–G4)＋node --test
#   full（部署級）：static ＋ selftest_run.js 渲染迴歸（部署級 price_qa 實抓／export_verify 仍由部署路徑把關，Phase 3 收斂進 deploy.sh）
set -uo pipefail
cd "$(dirname "$0")"
MODE="${1:-static}"
FAIL=0
step(){ echo ""; echo "▶ $1"; }

echo "=== dod-check：${MODE} ==="

step "① 語法檢查（node --check）"
SYN=1
for f in workbench/server.js workbench/public/index.html fetch_parse.js price_qa.js gate.js vendor_sheet.js google_sheets.js; do
  if [ "$f" = "workbench/public/index.html" ]; then
    node -e 'const fs=require("fs"),cp=require("child_process"),os=require("os"),p=require("path");const h=fs.readFileSync("workbench/public/index.html","utf8");const m=[...h.matchAll(/<script>([\s\S]*?)<\/script>/g)];const t=p.join(os.tmpdir(),"_dodchk_inline.js");fs.writeFileSync(t,m.map(x=>x[1]).join("\n;\n"));cp.execFileSync("node",["--check",t]);' 2>/dev/null \
      || { echo "  ❌ index.html inline JS 語法錯誤"; SYN=0; FAIL=1; }
  else
    node --check "$f" 2>/dev/null || { echo "  ❌ 語法錯誤：$f"; SYN=0; FAIL=1; }
  fi
done
[ "$SYN" = 1 ] && echo "  ✅ 語法 OK"

step "② 根因守門 dod-guards（G1–G4）"
node tools/dod-guards.js || FAIL=1

step "③ 單元測試 node --test"
if [ -d test ] && find test -name '*.test.js' 2>/dev/null | grep -q .; then
  node --test || FAIL=1   # 無參數＝自動探索 test/（Node 24 起，目錄位置參數會被當模組載入而失敗）
else
  echo "  ⏭ 尚無 test/（Phase 2 補：gate golden／四支 unit）"
fi

if [ "${MODE}" = "full" ]; then
  # ④ 渲染迴歸自測。
  #   2026-09-22 修：這行自 2026-07-26 建檔起（6fbf3e7）就是 `node selftest_run.js` 不帶參數，
  #   而那支要一個 FrameTest.html 路徑，沒帶＝印用法、exit 2。也就是說 **full 這道「部署級」閘
  #   有 58 天從來沒真的跑過渲染迴歸，而且 full 永遠是紅的**——DoD 9「部署級 full 綠」不可能成立。
  #   沒人發現的原因：full 很少跑，跑了看到紅也以為是別的項目。
  #   來源用 .dod-baseline.json frameTestCandidates（與 G4 同一份名單，不另立第二處）。
  step "④ 渲染迴歸自測 selftest_run.js"
  FT="$(node -e '
    const fs=require("fs"),p=require("path");
    const B=JSON.parse(fs.readFileSync(".dod-baseline.json","utf8"));
    const hit=(B.frameTestCandidates||[]).map(c=>p.resolve(c)).find(f=>fs.existsSync(f));
    process.stdout.write(hit||"");')"
  if [ -z "$FT" ]; then
    echo "  ❌ 找不到 FrameTest 源（.dod-baseline.json frameTestCandidates 都不存在）——渲染迴歸沒跑，不是通過"
    FAIL=1
  else
    echo "  來源：$FT"
    node selftest_run.js "$FT" || FAIL=1
  fi

  # ⑤ 設計檢查：目前只接「背景圖重量」這一項（2026-09-22 裁 Q4 甲）。
  #   為什麼只接一項＝誠實的理由：設計掃描器一族共六支，2026-09-22 逐支實跑，只有這支是綠的
  #   （slots 2 紅／onoff 8 紅／contrast 實測某活動頁手機版 4 紅／clip 未測）。
  #   把紅的接進來會讓 full 第一天就擋住所有部署，那種門兩週內就會被 --no-verify 繞過＝比沒有更危險。
  #   規矩：**哪一支清乾淨了就把它接進這裡**，不要讓它繼續當孤兒；進度＝DEVELOPMENT.md §6 項 2 的接線表。
  step "⑤ 設計檢查（已接線部分：背景圖重量）"
  node tools/design_qa.js --only=weight || FAIL=1

  echo "  （部署級 price_qa 實抓／export_verify 由部署路徑把關——見 DEVELOPMENT.md §3 階段 5 的現行發佈鏈）"
  echo "  ℹ 設計檢查其餘五項尚未接線，要對某個活動頁跑全套：npm run design:qa <活動頁編號>"
fi

echo ""
if [ "$FAIL" = 0 ]; then echo "✅ dod-check（${MODE}）全過"; else echo "❌ dod-check（${MODE}）有未過項——見上"; fi
exit $FAIL
