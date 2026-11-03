"use strict";
/**
 * tools/build_bg_map.js —— hero 背景地圖與素材入庫生成器（背景替換下滲專批・素材半邊，2026-08-25）
 *
 * 目的：讓「面板換背景」在預覽與出貨頁走同一套素材——從 backgrounds 登記簿（唯一真源）生成：
 *   1. 規劃/assets/hero-bg/<id>.png ＝過票背景圖檔複本（license A 純變數款無檔；B 級須複查 pass 系；
 *      conditional＝池內可選不得預設、照收並標旗）
 *   2. 規劃/assets/hero-bg/bg-map.js ＝window.__BG_MAP__（id → {file,bridgeColor,name,type,conditional}）
 *      ——FrameTest 讀它做背景替換（頁面離線也一致）；sync.sh 既有 cp -R assets/hero-bg/. 自動帶進 deploy。
 * 產物性質＝登記簿的建置產物（R1：勿手改，改登記簿再重跑本器）；未過票背景＝不入地圖（選了也換不上
 * ＝與出貨閘 CP-27 同一條線，介面端由 lib backgroundEligible 擋在前面）。
 * 用法：node tools/build_bg_map.js　（冪等；來源檔缺＝FAIL 出聲不出殘圖）
 */
const fs = require("fs");
const path = require("path");
const { BG_REVIEW_PASS } = require("../lib/proposal_pack.js");

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const MANIFEST = path.join(REPO_ROOT, "design-assets", "backgrounds", "manifest.json");
const LAYOUTS = path.join(REPO_ROOT, "design-assets", "layouts", "manifest.json");
const OUT_DIR = path.join(REPO_ROOT, "2026-AI自動化活動頁生成規劃", "assets", "hero-bg");

const m = JSON.parse(fs.readFileSync(MANIFEST, "utf8"));
fs.mkdirSync(OUT_DIR, { recursive: true });
const map = {};
let copied = 0, fails = 0;
for (const b of m.assets || []) {
  const lic = b.license;
  const pass = BG_REVIEW_PASS.includes(b.qaStatus) && !!b.reviewDate;
  const conditional = lic === "B" && b.qaStatus === "conditional" && !!b.reviewDate;
  const eligible = lic === "A" || (lic === "B" && (pass || conditional));
  /* C 級改收（63 號 Q1=A，2026-08-31）：「C 級＝內網展示帶警語」機器化——入地圖帶 pendingLicense 旗標，
     渲染端據旗標自動掛「背景版權待審核」浮水印；「bg-map 不收 C 級」舊憲法隨裁決退場。
     B 級未複查照舊不收（那是複查流程題、不是待審直通車題）。 */
  const clevel = lic === "C";
  if (!eligible && !clevel) continue; // B 級未複查＝不入地圖（出貨閘同線）
  let file = null;
  if (b.file) {
    const src = path.join(REPO_ROOT, b.file);
    const ext = path.extname(b.file) || ".png";
    const destName = b.id + ext;
    const dest = path.join(OUT_DIR, destName);
    if (!fs.existsSync(src)) { console.error(`✗ ${b.id} 來源檔缺：${b.file}（登記簿 file 欄與磁碟不符——修簿再跑）`); fails++; continue; }
    const s1 = fs.statSync(src);
    if (!fs.existsSync(dest) || fs.statSync(dest).size !== s1.size) { fs.copyFileSync(src, dest); copied++; }
    file = "assets/hero-bg/" + destName;
  }
  /* 三裝置別檔背景（deviceFiles 欄；首例 bg-027 自繪向量三裝置構圖，2026-08-28 W1-B11）：
     逐裝置複製為 <id>-<裝置>.png——1440 與主檔同源時仍照搬（命名一致＝渲染端規則單純）；缺檔＝FAIL 出聲同主檔慣例 */
  const devOut = {}; /* 實際出檔的裝置別（2026-08-30 補：原本只複製圖檔、沒寫進地圖＝渲染端換裝時查不到，平板手機一律吃桌機圖＝違反 G11 紋樣原寸且多載 1MB+） */
  if (b.deviceFiles && typeof b.deviceFiles === "object") {
    for (const [devKey, rel] of Object.entries(b.deviceFiles)) {
      if (devKey === "1440") continue; // 桌機＝主檔 file 已搬（<id>.png），不重複出檔
      const dsrc = path.join(REPO_ROOT, rel);
      const dext = path.extname(rel) || ".png";
      const ddest = path.join(OUT_DIR, `${b.id}-${devKey}${dext}`);
      if (!fs.existsSync(dsrc)) { console.error(`✗ ${b.id} 裝置檔缺（${devKey}）：${rel}（登記簿 deviceFiles 欄與磁碟不符——修簿再跑）`); fails++; continue; }
      const ds = fs.statSync(dsrc);
      if (!fs.existsSync(ddest) || fs.statSync(ddest).size !== ds.size) { fs.copyFileSync(dsrc, ddest); copied++; }
      devOut[devKey] = "assets/hero-bg/" + b.id + "-" + devKey + dext; // 路徑組法同主檔（第 42 行）
    }
  }
  map[b.id] = { file, ...(Object.keys(devOut).length ? { deviceFiles: devOut } : {}), name: b.name || b.id, type: b.type ?? null, bridgeColor: b.bridgeColor || null, conditional, bgClass: b.bgClass || "scene", fullBleed: b.fullBleed !== false, retired: !!b.retiredFromPool, ...(clevel ? { pendingLicense: true } : {}) }; // pendingLicense＝渲染端掛「背景版權待審核」浮水印的機器判準（63 號） // retired＝退場（舞台構圖，2026-08-25 裁決）：面板不供挑選、手選值回落預設；仍留地圖＝烘底版式（008/009 預設）的銜接色不失靈 // bgClass 三分類（51 §7.1 v2）＝渲染端延伸行為判準
}
/* 待審簿條目（63 號直通車）：訪客號段入地圖——圖檔原生就住 deploy-site/活動版型待審背景/（上傳端點落檔），
   不經 assets/hero-bg 複製，路徑用頁面相對 ../活動版型待審背景/<檔>（本機 /frametest/ 與 GHE 兩站通吃＝去背圖庫同招）。
   promoted（已轉正）不入＝正式號接手。 */
const PENDING = path.join(REPO_ROOT, "design-assets", "backgrounds", "pending.json");
if (fs.existsSync(PENDING)) {
  const pb = JSON.parse(fs.readFileSync(PENDING, "utf8"));
  for (const e of pb.entries || []) {
    if (!e || !e.id || !e.review) continue;
    const st = e.review.status;
    if (st === "promoted") continue; // 已轉正＝正式號接手，訪客號退出地圖
    /* 2026-09-14：原本這行是 `st !== "pending" continue`＝「審過就從地圖消失」。
       實測發現 7 檔已完成活動的 draft 直接指著訪客號（0003/0004/0005/0006/0009/0021/0027），
       一旦審核把某筆標成退回或合併，那幾頁的背景就解析不出來——而且沒有任何機器會叫。
       解法沿用正式簿既有的「退場」語意（2026-08-25 裁決）：**仍留地圖＝解析得開，retired=true＝不供挑選**，
       不另立新欄位。值域把關在 proposal_pack（只有 pending 能進新的提案包），與本檔分工：
       這裡管「舊的還認不認得」，那裡管「新的選不選得到」。 */
    /* 圖檔已經不在了就別入地圖（2026-09-14 自查補洞）：舊條文「非 pending 就 continue」順帶擋掉了
       0001／0002 這種「退回時連圖一起清掉」的條目；放寬解析之後它們會帶著死路徑回到地圖裡。
       解析得開的前提是檔案真的在——磁碟真相為準，與正式簿分支同一把尺。 */
    if (!fs.existsSync(path.join(REPO_ROOT, "2026-AI自動化活動頁生成規劃", "deploy-site", e.file))) continue;
    const pickable = st === "pending";
    map[e.id] = { file: "../" + e.file, name: e.name || e.id, type: "pending", bridgeColor: (/^#[0-9a-fA-F]{6}$/.test(String(e.bridgeColor || "")) ? e.bridgeColor : null), conditional: false, bgClass: "scene", fullBleed: true, retired: !pickable, pendingLicense: true, reviewStatus: st, ...(e.mergedInto ? { mergedInto: e.mergedInto } : {}) }; /* bridgeColor＝上傳時量的底邊色（2026-09-04）；舊條目 null＝引擎載圖現量。reviewStatus／mergedInto＝審核後仍解析得開時，讓渲染端與 QA 講得出「這張為什麼不給挑」 */
  }
}
/* 各版式預設背景對照（layouts manifest）＝渲染端「選回預設＝還原版式 CSS 原生底」的判準 */
const lay = JSON.parse(fs.readFileSync(LAYOUTS, "utf8"));
const defaults = {};
for (const l of (lay.layouts || lay.assets || [])) if (l && l.id) defaults[l.id] = l.defaultBackground || null;

const banner = "/* 機器生成勿手改（tools/build_bg_map.js ← design-assets/backgrounds/manifest.json）——背景替換下滲的素材地圖：過票背景＋掛牌背景（pendingLicense 旗標＝渲染端自動掛「背景版權待審核」；63 號） */";
fs.writeFileSync(path.join(OUT_DIR, "bg-map.js"), `${banner}\nwindow.__BG_MAP__ = ${JSON.stringify(map, null, 1)};\nwindow.__BG_DEFAULTS__ = ${JSON.stringify(defaults)};\n`);
const total = Object.keys(map).length;
console.log(`bg-map.js 產出：${total} 筆（複製圖檔 ${copied} 張、來源缺 ${fails}）→ ${OUT_DIR}`);
if (fails) { console.error("✗ 有來源缺檔＝地圖不完整，修登記簿後重跑"); process.exit(1); }
