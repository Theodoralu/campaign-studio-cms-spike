#!/bin/zsh
# pack-editor.sh —— 打「同事單機版」工作包（69 號 Phase 3；牆 2026-09-16 P-1～P-10 全裁；story docs/stories/pack-editor.md）
# ------------------------------------------------------------------
# 白話：把工具連引擎一起裝進一個 zip，同事解開就能用。打完自己先掃憑證、自己解開跑一趟，紅燈就把 zip 刪掉、不留半成品。
#
# 用法：zsh tools/pack-editor.sh            → 產 ~/Desktop/CampaignStudio-Editor-<日期>-<hash>.zip
#       PACK_OUT=/path zsh tools/pack-editor.sh   → 換輸出資料夾
# 前提：兩個 repo 工作樹都乾淨（從釘死的版本打；dirty 一律拒打，沒有覆寫開關——想打先 commit）
#       需要 zip／unzip／rsync／curl／tar；第一次要連網抓 Node 執行檔與 Intel 圖片套件（之後走快取 ~/.campaign-pack-cache）
#
# 包的長相（兩層 repo 相對結構逐字保留，程式靠相對位置找檔）：
#   CampaignStudio/
#   ├ runtime/darwin-arm64/node、runtime/darwin-x64/node        ← P-10 甲：自帶 Node，兩種晶片
#   ├ design-tokens/、design-assets/{layouts,backgrounds,fonts,motion,typestyles}/   ← 八本登記簿（layouts 不帶 spec/）
#   ├ 2026-AI自動化活動頁生成規劃/{modules.json, deploy-site/lecreuset-frametest/, deploy-site/活動版型去背商品/, deploy-site/活動版型待審背景/}
#   │     （背景圖只帶 frametest 那份鏡像＝P-2 已解；frametest 底下六個說明文件夾不帶）
#   └ 2026-Claude-code-AI自動化創建活動頁 workflow/{04_策展輸入與模組選用規則_v1.md, pipeline/}
#         pipeline 排除：runs/ docs/ test/ .git node_modules/.cache .google-* .wb-* .wb.log fatal.log briefs/mine/* briefs/.trash
#                      退場腳本（price_watch/price_sync/overview_sheet/overview-mail）、負責人腳本 8 支、舊版介面備份、開發工具 tools/*
#         pipeline 必帶：node_modules（含疊加的 sharp x64）、tools/build_cms_hints.js、tools/build_bg_map.js、workbench/VERSION、briefs/built-in/
#
# 四道自檢（任一紅＝刪 zip、exit 1）：① 工作樹乾淨 ② pack_assert 憑證掃描＋hash ③ 解包冒煙 pack-smoke ④ 體積上限 300MB
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
PIPE="$(cd "$HERE/.." && pwd)"
WF="$(cd "$PIPE/.." && pwd)"
ROOT="$(cd "$WF/.." && pwd)"
PLAN="$ROOT/2026-AI自動化活動頁生成規劃"
WF_NAME="$(basename "$WF")"
PLAN_NAME="$(basename "$PLAN")"
OUT_DIR="${PACK_OUT:-$HOME/Desktop}"
CACHE="$HOME/.campaign-pack-cache"
MAX_MB=300

say()  { print -r -- "[pack] $*"; }
die()  { print -r -- "[pack] ✗ $*" >&2; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || die "缺工具 $1——請先安裝"; }
for t in zip unzip rsync curl tar node git; do need "$t"; done

# ── ① 從釘死的版本打：兩 repo 工作樹都要乾淨（briefs/mine 的走查檔不算——它本來就不進包） ──
# core.quotepath=false：中文檔名不轉成 "\351\235…" 引號轉義，排除比對才對得上（第一次打包就被走查留的中文策略檔擋下）
dirty_pipe="$(git -C "$PIPE" -c core.quotepath=false status --porcelain | grep -v '^?? briefs/mine/' || true)"
dirty_root="$(git -C "$ROOT" -c core.quotepath=false status --porcelain || true)"
if [[ -n "$dirty_pipe" || -n "$dirty_root" ]]; then
  print -r -- "$dirty_pipe$dirty_root" | head -8 >&2
  die "工作樹不乾淨（上面列的）。同事拿到的包一定要對得回一個 commit——先 commit 或 stash 再打。"
fi
# ── ①b 做完沒合併健檢（PACK-UNMERGED-GUARD，2026-10-05 使用者裁「加」）──
# 病例＝同日：對症修法 9/24 就在分支上做完、文案都裁過，發佈綁 P6A、P6A 沒跑＝「先不發」悄悄變成「永不發」，
# 第六版打包沒人問一句「有沒有做完沒合併的」。這關不替人決定合不合，只逼那個決定每次打包都重新做一次、說出口。
GUARD_UM="$HERE/pack-unmerged-guard.sh"
if [[ -f "$GUARD_UM" ]]; then
  UM_RC=0
  # ${PIPE} 要帶大括號：zsh 會把 "$ROOT:root" 的 :r 當「去副檔名」修飾子（路徑含 2026.06.15 的點＝被剪成 2026.06oot；首跑第二病例）
  UM_OUT="$(zsh "$GUARD_UM" "${PIPE}:pipeline" "${ROOT}:root" 2>&1)" || UM_RC=$?
  [[ -n "$UM_OUT" ]] && print -r -- "$UM_OUT"
  (( UM_RC == 0 )) || die "有做完沒合併的 commit（上面列的）——「修好了」不等於「在包裡」。要帶＝先合併再打；確定不帶＝PACK_UNMERGED_OK=\"理由\" 重跑（理由進打包紀錄）"
else
  say "⚠ 找不到做完沒合併健檢腳本（$GUARD_UM）＝本次沒查「有沒有修好但沒進包的」"
fi

HASH="$(git -C "$PIPE" rev-parse --short HEAD)"
ROOT_HASH="$(git -C "$ROOT" rev-parse --short HEAD)"
DATE="$(date +%Y%m%d)"
NODE_V="$(node --version)"          # 包內 Node＝負責人機這版（sharp 為 N-API、跨版穩定）
SHARP_V="$(node -p "require('$PIPE/node_modules/sharp/package.json').version")"
VERSION_LINE="$DATE-$HASH"
say "版本 $VERSION_LINE（root $ROOT_HASH）・Node $NODE_V・sharp $SHARP_V"

# ── 1. Node 執行檔兩晶片（官方 tar.gz 只取 bin/node；有 Apple 公證、Gatekeeper 放行） ──
mkdir -p "$CACHE"
for arch in arm64 x64; do
  dst="$CACHE/node-$NODE_V-darwin-$arch/node"
  if [[ ! -x "$dst" ]]; then
    url="https://nodejs.org/dist/$NODE_V/node-$NODE_V-darwin-$arch.tar.gz"
    say "下載 Node $arch：$url"
    tmp="$(mktemp -d)"
    curl -fsSL --retry 2 "$url" -o "$tmp/n.tgz" || die "Node $arch 下載失敗（$url）"
    tar -xzf "$tmp/n.tgz" -C "$tmp" --include='*/bin/node' || die "Node $arch 解壓失敗"
    mkdir -p "$(dirname "$dst")"; cp "$tmp"/node-*/bin/node "$dst"; chmod +x "$dst"; rm -rf "$tmp"
  fi
done
# 本機能跑的那顆先驗一次（另一顆晶片驗不到＝第三層 Intel 同事那台）
case "$(uname -m)" in arm64) MY_ARCH=arm64;; x86_64) MY_ARCH=x64;; *) die "不認得的晶片 $(uname -m)";; esac
"$CACHE/node-$NODE_V-darwin-$MY_ARCH/node" -e 'process.exit(0)' || die "快取的 Node（$MY_ARCH）跑不起來"
say "Node 執行檔就位（arm64／x64）"

# ── 2. Intel 圖片套件疊加（sharp 的 darwin-x64 預編二進位；在暫存裝、不動開發樹） ──
SHARP_X64="$CACHE/sharp-$SHARP_V-darwin-x64"
if [[ ! -d "$SHARP_X64/sharp-darwin-x64" || ! -d "$SHARP_X64/sharp-libvips-darwin-x64" ]]; then
  say "抓 sharp $SHARP_V 的 Intel 二進位"
  tmp="$(mktemp -d)"; ( cd "$tmp" && npm init -y >/dev/null 2>&1 && npm install --os=darwin --cpu=x64 --no-save --silent "sharp@$SHARP_V" ) || die "sharp x64 安裝失敗"
  mkdir -p "$SHARP_X64"
  cp -R "$tmp/node_modules/@img/sharp-darwin-x64" "$tmp/node_modules/@img/sharp-libvips-darwin-x64" "$SHARP_X64/" || die "sharp x64 複製失敗"
  rm -rf "$tmp"
fi
say "sharp Intel 二進位就位"

# ── 3. 組裝 ──
STAGE_PARENT="$(mktemp -d)"; STAGE="$STAGE_PARENT/CampaignStudio"; mkdir -p "$STAGE"
trap 'rm -rf "$STAGE_PARENT"' EXIT

# root repo：登記簿與色彩引擎
rsync -a "$ROOT/design-tokens" "$STAGE/"
mkdir -p "$STAGE/design-assets"
for d in backgrounds fonts motion typestyles; do rsync -a "$ROOT/design-assets/$d" "$STAGE/design-assets/"; done
rsync -a --exclude 'spec/' "$ROOT/design-assets/layouts" "$STAGE/design-assets/"      # spec/ 只有開發工具讀

# 規劃資料夾：模組登記簿、預覽引擎（鏡像，含背景圖）、去背圖庫、待審背景
mkdir -p "$STAGE/$PLAN_NAME/deploy-site"
cp "$PLAN/modules.json" "$STAGE/$PLAN_NAME/"
rsync -a --exclude 'gallery-0719/' --exclude 'platform-plan-doc13/' --exclude 'platform-plan-doc15/' --exclude 'platform-decisions/' --exclude 'workflow-guide/' --exclude 'activities/' \
  "$PLAN/deploy-site/lecreuset-frametest" "$STAGE/$PLAN_NAME/deploy-site/"
rsync -a "$PLAN/deploy-site/活動版型去背商品" "$STAGE/$PLAN_NAME/deploy-site/"
[[ -d "$PLAN/deploy-site/活動版型待審背景" ]] && rsync -a "$PLAN/deploy-site/活動版型待審背景" "$STAGE/$PLAN_NAME/deploy-site/"

# workflow repo：策展規則 md＋pipeline 本體
mkdir -p "$STAGE/$WF_NAME"
cp "$WF/04_策展輸入與模組選用規則_v1.md" "$STAGE/$WF_NAME/"
rsync -a \
  --exclude 'runs/' --exclude 'docs/' --exclude 'test/' --exclude '.git' --exclude '.githooks/' \
  --exclude 'node_modules/' \
  --exclude '.google-*' --exclude '.wb-*' --exclude '.wb.log' --exclude 'fatal.log' --exclude '.DS_Store' \
  --exclude 'briefs/mine/*' --exclude 'briefs/.trash/' \
  --exclude 'price_watch.sh' --exclude 'price_sync.js' --exclude 'overview_sheet.js' \
  --exclude 'workbench/start-online.sh' --exclude 'workbench/stop-online.sh' --exclude 'workbench/netlify-auth.sh' \
  --exclude 'workbench/wb-watchdog.sh' --exclude 'workbench/update-entry.sh' --exclude 'workbench/deploy-dirty-tree-guard.sh' \
  --exclude 'workbench/deploy-ghe-pages.sh' --exclude 'workbench/wb-autostart.command' \
  --exclude 'workbench/public/index-legacy-*.html' \
  --exclude 'tools/' \
  "$PIPE/" "$STAGE/$WF_NAME/pipeline/"
P="$STAGE/$WF_NAME/pipeline"
mkdir -p "$P/briefs/mine" "$P/tools"; touch "$P/briefs/mine/.gitkeep"
cp "$PIPE/tools/build_cms_hints.js" "$PIPE/tools/build_bg_map.js" "$P/tools/"     # 執行期依賴（開機保鮮／待審背景地圖）
rsync -a --exclude '.cache/' "$PIPE/node_modules" "$P/"                              # P-3 甲：程式庫進包（離線）
cp -R "$SHARP_X64/sharp-darwin-x64" "$SHARP_X64/sharp-libvips-darwin-x64" "$P/node_modules/@img/"   # 疊加 Intel
mkdir -p "$STAGE/runtime/darwin-arm64" "$STAGE/runtime/darwin-x64"
cp "$CACHE/node-$NODE_V-darwin-arm64/node" "$STAGE/runtime/darwin-arm64/node"
cp "$CACHE/node-$NODE_V-darwin-x64/node"   "$STAGE/runtime/darwin-x64/node"
chmod +x "$STAGE/runtime"/*/node "$P/workbench/start-editor.sh" "$P/workbench/pick-port.sh"
# 包根四件（P-7 甲主乙備，2026-09-21 落地）：先看我.txt／安裝.command／啟動 Campaign Studio.command／install.sh
# 源頭＝tools/pack-root/（要改請改源頭，包裡的是複本）
cp -R "$HERE/pack-root/." "$STAGE/" || die "複製 pack-root（先看我／安裝／啟動）失敗"
chmod +x "$STAGE"/*.command "$STAGE/install.sh"

# 包根第五件：這一版有什麼新的.txt（2026-09-21 使用者裁 Q3(b)＝只做這個落點，先不動分享站與工具介面）
# 白話：同事解開就看到「這一版有什麼、值不值得換」，不必先問人。
# 真源只有一份＝$PLAN/releases/<tag>.md（規矩＝規劃/77 號），這裡機器轉、不手抄第二份；
# 沒有當天的說明＝紅燈不出包；同一天有好幾份又沒一份對得上這包＝也紅（不猜），要嘛改名要嘛 PACK_NOTES=<檔> 明示。
notes_arg=()
[[ -n "${PACK_NOTES:-}" ]] && notes_arg=(--notes "$PACK_NOTES")
if ! WHATSNEW_LOG="$(node "$HERE/build_pack_whatsnew.js" --version "$VERSION_LINE" --releases-dir "$PLAN/releases" \
     "${notes_arg[@]}" --out "$STAGE/這一版有什麼新的.txt")"; then
  die "產「這一版有什麼新的.txt」失敗（原因見上面那幾行）"
fi
print -r -- "$WHATSNEW_LOG" | grep -v '^NOTES_TAG=' || true
NOTES_TAG="$(print -r -- "$WHATSNEW_LOG" | sed -n 's/^NOTES_TAG=//p')"

# 版本記號檔：第五行記「說明取自哪一版」——事後任何人拿到 zip 都查得到，不必當時盯著終端機。
# （pack-smoke 與 pack_assert 都只讀第一行，加這行不會踩到既有斷言）
printf '%s\nnode %s\nsharp %s\nroot %s\nnotes %s\n' "$VERSION_LINE" "$NODE_V" "$SHARP_V" "$ROOT_HASH" "${NOTES_TAG:-（無）}" > "$P/workbench/VERSION"

find "$STAGE" -name '.DS_Store' -delete   # Finder 中繼檔會從 root 那幾條 rsync／cp -R 混進來（第一版包被斷言抓到兩個）——組裝完統一清，不逐條加排除

# 組裝後小體檢：該有的在、不該有的不在（清單漂了這裡先紅，不等 zip）
for must in "$P/workbench/server.js" "$P/workbench/VERSION" "$P/briefs/built-in" "$P/node_modules/@img/sharp-darwin-arm64" "$P/node_modules/@img/sharp-darwin-x64" \
            "$STAGE/design-tokens/palette-engine.js" "$STAGE/$PLAN_NAME/deploy-site/lecreuset-frametest/assets/hero-bg/bg-map.js" "$STAGE/$WF_NAME/04_策展輸入與模組選用規則_v1.md" \
            "$STAGE/先看我.txt" "$STAGE/這一版有什麼新的.txt" "$STAGE/install.sh" "$STAGE/安裝.command" "$STAGE/啟動 Campaign Studio.command"; do
  # 檔案要「存在且非空」——原本只驗存在，磁碟滿或寫一半產出 0 位元組的檔會綠燈出貨、同事打開是空白
  # （2026-09-21 第二審 F7）。目錄仍只驗存在（macOS 目錄的大小不是內容量）。
  if [[ -d "$must" ]]; then
    [[ -e "$must" ]] || die "組裝後缺：$must"
  else
    [[ -s "$must" ]] || die "組裝後缺、或是 0 位元組的空檔：$must"
  fi
done
[[ -z "$(ls -A "$P/briefs/mine" | grep -v '^\.gitkeep$' || true)" ]] || die "briefs/mine 不該有東西"
say "組裝完成：$(du -sh "$STAGE" | cut -f1)（解開後）"

# ── 4. zip ──
mkdir -p "$OUT_DIR"
ZIP="$OUT_DIR/CampaignStudio-Editor-$VERSION_LINE.zip"
rm -f "$ZIP"
( cd "$STAGE_PARENT" && zip -qr -X "$ZIP" CampaignStudio )
SIZE_MB=$(( $(stat -f%z "$ZIP") / 1024 / 1024 ))
say "zip 完成：$ZIP（${SIZE_MB}MB）"
(( SIZE_MB <= MAX_MB )) || { rm -f "$ZIP"; die "包 ${SIZE_MB}MB 超過上限 ${MAX_MB}MB——已刪"; }

# ── ② 憑證掃描＋hash（掃 zip 清單，不解開） ──
if ! node "$HERE/pack_assert.js" "$ZIP" --expect-hash "$HASH"; then rm -f "$ZIP"; die "憑證／版本斷言紅——zip 已刪，修排除清單再打"; fi

# ── ③ 解開包自己跑一趟（用包內 Node 起同事模式、打斷言集） ──
if ! node "$PIPE/test/browser/pack-smoke.js" "$ZIP"; then rm -f "$ZIP"; die "解包冒煙紅——zip 已刪，看上面哪條沒過"; fi

say "✓ 可出貨：$ZIP"
say "  版本 $VERSION_LINE・Node $NODE_V・sharp $SHARP_V・${SIZE_MB}MB"
# 收尾再講一次：中段那行 ⚠ 後面還有三十幾行輸出會把它滾掉，而這一區是打包的人一定會看的
# （他要從下面複製 gh release create）。2026-09-21 第二審 F4。
if [[ -n "$NOTES_TAG" && "$NOTES_TAG" != "v$VERSION_LINE" ]]; then
  say "  ⚠ 更新說明用的是 $NOTES_TAG，不是本包版本（v$VERSION_LINE）——包裡那份 txt 與 VERSION 第五行都已寫明"
fi
say "  下一步：第二層親走（用解開的包走完整旅程）→ GHE Release（--target 要完整 SHA，短 hash 會 422）："
say "    gh release create v$VERSION_LINE \"$ZIP\" -R ytwec-labs/activity-page-pipeline --target $(git -C "$PIPE" rev-parse HEAD) --prerelease --title \"…\" --notes \"…\"   # 台灣（github.com，公司帳號 tofu_ytwec 生效時）；美國 GHE 2026-09-19 停權"
