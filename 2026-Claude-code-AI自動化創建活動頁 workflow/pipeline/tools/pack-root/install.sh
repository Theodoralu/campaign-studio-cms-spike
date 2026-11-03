#!/bin/zsh
# install.sh —— Campaign Studio 單機版・第一次安裝（P-7 甲主乙備，2026-09-16 牆裁；2026-09-21 落地）
#
# 白話：檢查這台電腦缺什麼、解除「從網路下載」的封印（之後雙擊啟動不會再被擋）、
#       建你的活動資料夾、然後啟動。每一步都講「✓ 好了」或「✗ 哪裡不行、怎麼辦」。
# 兩種跑法一樣：雙擊「安裝.command」（甲），或把本檔拖進終端機按 Enter（乙＝雙擊被擋時的備援）。
# 源頭＝pipeline/tools/pack-root/，打包時複製到包的根目錄；要改請改源頭。
set -u
setopt null_glob   # 2026-09-24 順手修：zsh 預設 glob 對不到檔會整支中止——包裡沒自帶 Node 時 runtime/*/node 對不到，第 6 步就死在這、同事看到一行英文錯誤。對不到＝跳過，不是錯。
PKG="$(cd "$(dirname "$0")" && pwd)"
ok()   { print -r -- "  ✓ $*"; }
bad()  { print -r -- "  ✗ $*"; }
warn() { print -r -- "  ⚠ $*"; }   # 只提醒、不擋（2026-09-24：連線檢查用；擋有授權的人是另一種病）
step() { print -r -- ""; print -r -- "$*"; }
FAIL=0

print -r -- "Campaign Studio 單機版・第一次安裝"
print -r -- "資料夾：$PKG"

step "1. 檢查 Chrome"
if [ -d "/Applications/Google Chrome.app" ] || [ -d "$HOME/Applications/Google Chrome.app" ]; then
  ok "Chrome 有"
else
  bad "找不到 Chrome——請先到 google.com/chrome 安裝，裝好再跑一次這個安裝"
  FAIL=1
fi

step "2. 檢查包裡自帶的 Node（不用你另外裝）"
case "$(uname -m)" in arm64) ARCH=arm64;; x86_64) ARCH=x64;; *) ARCH="";; esac
NODE="$PKG/runtime/darwin-${ARCH}/node"
if [ -n "$ARCH" ] && [ -x "$NODE" ]; then
  ok "Node $("$NODE" --version)（包裡自帶）"
elif command -v node >/dev/null 2>&1; then
  NODE="$(command -v node)"   # 2026-10-01：原本只印訊息、NODE 還指著不存在的包內路徑，第 5 步探測就探不到
  ok "包裡沒有自帶的 Node，改用這台電腦的 $(node --version)"
else
  bad "這個包不完整（沒有 Node）——請重新下載完整的包再試"
  FAIL=1
fi

step "3. 解除「從網路下載」的封印（macOS 會擋雙擊；解一次就好）"
if xattr -dr com.apple.quarantine "$PKG" 2>/dev/null; then
  ok "已解除，之後雙擊「啟動 Campaign Studio.command」不會再被擋"
else
  ok "沒有封印可解（這份不是從瀏覽器下載的，或已經解過）"
fi

step "4. 建你的活動資料夾"
if mkdir -p "$HOME/CampaignStudio/runs" "$HOME/CampaignStudio/briefs/mine"; then
  ok "$HOME/CampaignStudio（你做的活動與你寫的策略檔都存在這裡；換電腦整個資料夾複製走就帶得走）"
else
  bad "建不出 $HOME/CampaignStudio——請檢查家目錄能不能寫入"
  FAIL=1
fi

step "5. 檢查連得到 Yahoo 購物（用工具自己的方式連，只提醒、不擋安裝）"
# 2026-09-24 CMS-OFFLINE-HONESTY 第④件：原本五項全綠、卻在建第一頁才撞「連不到」，而那時同事已經以為裝好了、會以為是工具壞的。
# 2026-10-01 改用 Node 探測（原本用 curl）——病例＝使用者家用網路 curl 通、Node 不通（TCP 握手 291ms > Node 每位址預算 250ms）：
#   curl 版在那條網路上會印「✓ 連得到」，而產品其實一件都抓不到。**量的工具要跟真正要連的工具是同一個。**
#   所以這裡用包裡那顆 Node，並且先載入產品自己的連線設定（lib/net_tuning.js），讓這一步跟伺服器用同一把尺。
#   卡＝20261001-browser-opens-it-tool-cannot。只提醒不擋：擋有授權的人是另一種病。
# CS_YAHOO_PROBE_URL＝故障注入用（測試指到沒人聽的埠／本機假 Yahoo）。
PROBE_URL="${CS_YAHOO_PROBE_URL:-https://tw.buy.yahoo.com/}"
TUNING=""
for f in "$PKG"/*/pipeline/lib/net_tuning.js; do [ -f "$f" ] && TUNING="$f" && break; done
PROBE_OUT=""
if [ -n "${NODE:-}" ] && [ -x "$NODE" ]; then
  PROBE_OUT="$("$NODE" -e '
    const [u, tuning] = process.argv.slice(1);
    if (tuning) { try { require(tuning); } catch (e) { /* 設定載不進來就照預設探，結果照實回報 */ } }
    const mod = u.startsWith("https:") ? require("https") : require("http");
    const req = mod.get(u, { headers: { "User-Agent": "CampaignStudio-install" } }, (r) => { r.resume(); console.log("OK " + r.statusCode); process.exit(0); });
    req.setTimeout(10000, () => req.destroy(new Error("timeout")));
    req.on("error", (e) => {
      /* AggregateError 的 message 是空字串，線索在 .code 與 .errors（逐位址）——空訊息等於沒給線索 */
      const inner = (e.errors || []).map((x) => x && x.code).filter(Boolean).join("/");
      console.log("ERR " + (e.code || e.message || "unknown") + (inner ? " [" + inner + "]" : ""));
      process.exit(0);
    });
  ' "$PROBE_URL" "$TUNING" 2>/dev/null)"
fi
case "$PROBE_OUT" in
  "OK 2"*|"OK 3"*) ok "連得到 Yahoo 購物（用工具自己的方式測的）" ;;
  OK*) warn "連得到 Yahoo 購物，但它回了 ${PROBE_OUT#OK }——安裝照樣完成。建活動頁時如果抓不到商品，先用瀏覽器打開 tw.buy.yahoo.com 看看。" ;;
  ERR*) warn "現在連不到 Yahoo 購物——安裝照樣完成，但等一下建活動頁會失敗。多半是網路還沒好、或公司網路要先登入：先用瀏覽器打開 tw.buy.yahoo.com 試試，好了再雙擊「啟動 Campaign Studio.command」。（技術訊息：${PROBE_OUT#ERR }）" ;;
  *) warn "這一項沒測到（找不到可用的 Node，或探測沒有回應）——這不是綠燈也不是紅燈，是這一半沒量到。安裝照樣完成；建活動頁時如果抓不到商品，先用瀏覽器打開 tw.buy.yahoo.com 試試。" ;;
esac

step "6. 設定可以執行"
chmod +x "$PKG"/*.command "$PKG/install.sh" 2>/dev/null || true
chmod +x "$PKG"/runtime/*/node 2>/dev/null || true
for f in "$PKG"/*/pipeline/workbench/start-editor.sh; do [ -f "$f" ] && chmod +x "$f"; done
ok "好了"

if [ "$FAIL" -ne 0 ]; then
  print -r -- ""
  print -r -- "上面有 ✗ 的項目——照它說的處理完，再跑一次安裝。"
  exit 1
fi

if [ "${CS_INSTALL_NO_LAUNCH:-0}" = "1" ]; then ok "（測試模式：到這裡為止，不啟動）"; exit 0; fi   # 故障注入測試用，不影響同事
step "7. 啟動（瀏覽器會自己打開）"
exec zsh "$PKG/啟動 Campaign Studio.command"
