"use strict";
/**
 * lib/layout_choice.js —— 表單版式選擇的伺服器端邏輯（51 號 W1-C，2026-08-24）
 *
 * 職責（三件事，全部走登記簿真源、失敗一律 throw 出聲＝鐵律 3）：
 *  1. AI 代選：51 附錄 B「情境×useWhen 映射表」落程式＋灰度過濾（預設背景素材授權未過門票＝代換 layout-006/007、理由行明講）
 *  2. 表單卡目錄：九版式依 kinRef 折疊成六卡（002/006/008 帶折扣開關）＋「現行版型」卡開關（modules.json 旗標）
 *  3. 值域驗證：kvVariant 裸值恆為登記值域之一（new｜legacy｜layout-*），未知/已停收＝throw
 *
 * 值域真源＝lib/proposal_pack loadRegistries（modules.json hero variants＋design-assets 四本 manifest）；
 * 本檔唯一的「內容硬編」＝下方映射表，性質為 51 附錄 B 的人肉維護複本（附錄明文允許），改動走裁決批。
 */
const fs = require("fs");
const path = require("path");
const { loadRegistries, normalizeKvVariant, parseProposalPack, readJson, DEFAULT_PATHS, backgroundEligible } = require("./proposal_pack");
const themeDraftLib = require("./theme_draft"); // 排版檔位表單一來源（catalog 下發；theme 框架批 2026-08-25）
const heroStages = require("./hero_stages"); // 自備背景三格需求尺寸（2026-10-07 設計反饋）：上傳格標示＝驗證（hero_bg_own checkSize）＝Gemini 說明檔，三處同一把尺、不另抄數字
const RULES = require(path.join(__dirname, "..", "rules.json")); // 寬度模型＋主視覺顯示名預算＝gate.js 匯出的同一把尺（export_rules.js 產；不另寫數字）

/* ── 51 附錄 B　情境×useWhen 映射表 v0 ──────────────────────────────
   ⚠ 人肉維護複本（真源＝51 號規格附錄 B；該表改動走裁決批＋列帳 tracker，這裡同批同步）。
   鍵＝表單 scenario 機讀值（workbench/public/index.html RECIPE_CARDS value）；
   ""＝「先不指定，直接開始」（依資料盤點＝04 號 §4.2，v0 先落靜態預設 layout-006）。 */
const SCENARIO_LAYOUT_MAP = {
  "同品類×跨品牌-優惠銷售": { useWhen: "促銷", layout: "layout-003" }, // 2026-09-14 使用者更正：007（多品環列促銷版）＝流行品類／去背圖專用＝條件式，不當預設；改配「攝影棚促銷」（白棚舞台、左右商品中間標題、折扣槽開）——暫定，使用者可改
  "單一品牌-優惠/曝光": { useWhen: "聯名", layout: "layout-002" },
  "同品類-情境×優惠": { useWhen: "攻略", layout: "layout-005" },
  "同品類-新品/熱銷曝光": { useWhen: "新品", layout: "layout-010" }, // 2026-09-14 使用者更正：006「新品」＝流行品類／去背圖專用＝條件式；改配唯一另一款標「新品」的「雜誌封面・三件套」——暫定，使用者可改
  "時事主題-情境×選品": { useWhen: "攻略", layout: "layout-005" }, // 2026-09-14 使用者裁（牆 cms-layout-fit Q1 乙）：原「話題單品」→008 引言色塊型＝流行品類／去背模特兒圖專用，兩檔器具類活動實走預期不符；改配「攻略・銀棚」（左右商品・中間標題，一般商品照站得住）
  "": { useWhen: "依資料盤點（04 號 §4.2）", layout: "layout-005" }, // 2026-09-14：原 006 為條件式，先不指定＝配最保守的「攻略・銀棚」（與時事主題同款）——暫定
};

/* 主題色適用判準（K14 2026-08-28 使用者裁決；與色彩工具 sync-registry-to-colortool.mjs 同一套正規化）：
   一律讀登記簿逐款欄位、不得自建版型清單（第二真相）——themeBehavior 字串優先（含「不進主題」＝false）、
   缺欄退回 backgroundType 推定（②型圖片背景＝板內藝術指導色＝false；①③型＝true）。 */
function themeAwareOf(rec) {
  if (rec && typeof rec.themeBehavior === "string") return rec.themeBehavior.indexOf("不進主題") < 0;
  return !(rec && rec.backgroundType === 2);
}

/* 樣稿引擎支援表（C3d 誠實條款）：完工一款解鎖一款——layout-006 桌機真樣式 2026-08-24 W1-B 切片二上線
   （design QA＝docs/design-qa/hero-wave1-dual-shell-2026-08-24.md）；其餘 layout-* 預覽＝雙殼骨架告示。 */
const ENGINE_SUPPORTED = new Set(["new", "legacy", "layout-006", "layout-001", "layout-004", "layout-002", "layout-003", "layout-007", "layout-005", "layout-008", "layout-009", "layout-010", "layout-011", "layout-012"]); // 滾動上架名單＝十二款（2026-09-10 第十二棒：012 霓虹夜市・1440×560 三裝置真板・一大一小輪播 motion-011；收貨紀錄＝design QA layout-012-shots、spec 75 條全過、selftest 152×5 綠）；上一棒（2026-08-28 第十一棒：011 中秋團圓月夜拱窗・滿版 1440・三裝置真板）——收貨紀錄＝design QA layout-011-shots
/* 文案＝UX writing 一般用戶版（2026-08-25 使用者裁決：CMS 介面禁工程/內部治理詞彙） */
const ENGINE_NOTE_BUILDING =
  "版面樣式陸續完成中——你的選擇會保存；預覽先看到簡易示意，正式樣式完成後會自動換上，不影響活動內容。";
function engineNoteFor(kvVariant) {
  return ENGINE_SUPPORTED.has(kvVariant) ? null : ENGINE_NOTE_BUILDING;
}

/* ── hero 文字槽段落表（2026-08-25 使用者裁決：hero 全部文字可編修＝逐段具名欄位，廢「換行順序猜段落」）──
   契約不變：槽值仍是單字串、段落以換行序拼（14 §2.13）；本表＝各版式各段的「人話名稱＋順序」單一來源，
   編修器逐段出欄、存檔時照序組回。⚠ 渲染端（FrameTest 各 renderHeroV2L*）的 parts[i] 語意必須與本表同步——
   改任一邊＝兩邊同批改＋spec 規格檔跟上（W1-D 多段編碼凝條文的落地形）。 */
const HERO_TEXT_PIECES = {
  "layout-012": { "slogan-left": ["主標", "限時貼紙", "促購小字（折數旁；折數欄空＝整塊不顯示）", "跑馬帶文案（用｜分段）"] },/* 促購小字條件標示 2026-10-08 design QA slots 紅：引擎 K4＝折數空整塊收起（佔位永不出貨），原標籤沒講＝設計師填了會無聲消失 *//* 第十二棒 2026-09-10 W1-B12：槽序＝引擎 renderHeroV2L012 的 parts[i]（\n 換槽、U+2028 折行）；主標格可 Enter 折行＝預留兩行制；無副標節點＝不列「副標」格（twin 表測試③） */
  "layout-001": { "title-center": ["主標", "副標（膠囊小字）", "品牌帶（「・」分兩色段）"] },
  "layout-002": { "title-center": ["主標", "副標（膠囊小字）", "品牌帶（「・」分兩色段）"] },
  "layout-003": { "title-center": ["主標", null, "品牌帶（「・」分兩色段）"] }, // 副標膠囊 2026-08-28 使用者裁決刪欄（板 645:1724 無此位置）：null＝編修器藏欄＋存檔清空該段、渲染端恆收；段位保留＝舊稿品牌帶不搬位
  "layout-004": { "slogan-left": ["主標", "副行", "嵌字膠囊（嵌在主標第一字後）", "年份帶", "眉標"] },
  "layout-006": { "title-center": ["主標", "副題", "底部膠囊", "眉標"] },
  "layout-007": { "title-center": ["主標", "底部膠囊"] },
  "layout-005": { "title-center": ["主標", "嵌字膠囊（嵌在主標第一字後）", "年份帶", null] }, // 槽鍵對帳修正 2026-08-25：登記簿與渲染端＝title-center（收貨時誤抄建置回報的 slogan-left）。第 4 段「圖上眉標」2026-09-07 使用者裁「兩件商品各自獨立標籤、不共用」→ null＝編修器藏欄＋存檔清空（同 003 副標慣例）；眉標改由各商品的特色標（products[].tag，留白退該件優惠文字）供應，引擎已不讀此段
  "layout-008": { "slogan-left": ["主標（引言大字）", "眉標（螢光黃帶）"] },
  "layout-009": { "slogan-left": ["主標", "品牌帶（「・」分兩色段）"] },
  "layout-010": { "slogan-left": ["主標上行", "主標下行", "副標帶（菱形夾字）"] }, // 雜誌封面式：兩行大標各帶底線、下行沒填＝整行收起；日期章＝kv.dateValue 真值非文字槽
  "layout-011": { "slogan-left": ["主標", "副標", "眉標（英文行）", "眉標（中文行）", "氛圍文案"] }, // 中秋團圓月夜拱窗（W1-B11 2026-08-28）：眉標兩行＝面板外膠囊（成長制無截斷＝CMS 建議限字 英 ≤30/中 ≤20）；氛圍文案＝手機板無此槽照板收起；檔期章＝kv.dateValue 真值、折扣章＝discount-digit 真值欄（皆非文字槽）
};

/* ── 主標落哪一格（2026-09-24；病例 run 174314：策略檔主標寫死送 slogan-left，而 005 等六款的主標格是 title-center＝人寫的主標從沒上過畫面）──
   策略檔套主標（curation_brief）、建立期預填（defaultHeroForLayout）、換版式補槽與再生判定（hero_combo）共用這一把尺；
   段位真源仍是上面的 HERO_TEXT_PIECES：標籤以「主標」開頭的那一段；010 兩行制＝「主標上行／主標下行」兩格。
   不是 layout-*（舊殼）＝null（舊殼的主標住 kv.titleLine1/2）；版式表裡沒有主標格＝null，呼叫端要出聲、不硬塞別格。 */
const FOLD = String.fromCharCode(0x2028); // 格內折行記號（14 §2.13 契約）；不在原始碼寫真字元（會被當換行）
function titleSlotFor(kvVariant) {
  const pieces = HERO_TEXT_PIECES[String(kvVariant || "")];
  if (!pieces) return null;
  for (const [slot, labels] of Object.entries(pieces)) {
    const idx = labels.findIndex((lb) => lb && /^主標/.test(lb));
    if (idx < 0) continue;
    const second = labels.findIndex((lb, i) => i !== idx && lb && /^主標/.test(lb));
    return { slot, index: idx, secondIndex: second >= 0 ? second : null };
  }
  return null;
}
/**
 * 把幾行主標寫進該版式的主標格，其餘段原樣保留；尾端空段修掉（與編修器組回慣例同）。
 * @param {string} kvVariant  layout-*
 * @param {string} slotValue  該槽現值（單字串、\n 分段）；沒有＝""
 * @param {string[]} lines    主標的行（人寫的每一行、或機器切好的兩行）；空行丟掉
 * @returns {{slot:string, value:string}|null}  null＝這款沒有主標格
 */
function writeTitleIntoSlot(kvVariant, slotValue, lines) {
  const ts = titleSlotFor(kvVariant);
  if (!ts) return null;
  const L = (Array.isArray(lines) ? lines : [lines]).map((s) => String(s == null ? "" : s).trim()).filter(Boolean);
  const segs = typeof slotValue === "string" ? slotValue.split("\n") : [];
  const need = Math.max(ts.index, ts.secondIndex == null ? 0 : ts.secondIndex);
  while (segs.length <= need) segs.push("");
  if (ts.secondIndex != null) { segs[ts.index] = L[0] || ""; segs[ts.secondIndex] = L.slice(1).join(FOLD); }
  else segs[ts.index] = L.join(FOLD);
  while (segs.length && !segs[segs.length - 1].trim()) segs.pop();
  return { slot: ts.slot, value: segs.join("\n") };
}

/* 灰度門票判定＝lib/proposal_pack backgroundEligible 單一來源（2026-08-24 合流：與 gate CP-27 同套；
   本檔原 /^pass/ 寬鬆比對廢止＝逐字白名單）。51 附錄 B 條款：license A、或 B 已複查；conditional 不發門票。 */

/* 完工名單 hermetic 注入縫（沿 gate.js GATE_REGISTRY_OVERRIDES.engineReady 同一條通道、不另開側門；
   2026-08-25 W1-D 瀏覽器 QA 需要在測試 server 解鎖未完工版式驗搬家/暫存動線）：
   env 生效＝非正式名單、console 出聲留痕（首次一次）；正式服務不設此 env＝恆走 ENGINE_SUPPORTED。
   設定值壞＝throw（鐵律 3：不靜默忽略注入設定——與 gate.js gateRegistryOverrides 同語意）。 */
let _engineReadyOverrideWarned = false;
function engineReadyOverride() {
  const v = (process.env.GATE_REGISTRY_OVERRIDES || "").trim();
  if (!v) return null;
  const ov = JSON.parse(v.startsWith("{") ? v : fs.readFileSync(v, "utf8"));
  if (!Array.isArray(ov.engineReady)) return null;
  if (!_engineReadyOverrideWarned) {
    _engineReadyOverrideWarned = true;
    console.warn(`[layout_choice] ⚠ 完工名單＝GATE_REGISTRY_OVERRIDES 注入（非正式名單、僅測試用，不得對消費者出貨）：${ov.engineReady.join("、")}`);
  }
  return new Set(ov.engineReady);
}

/** 讀齊本模組要的真源：值域登記簿＋背景逐筆紀錄（授權欄）＋現行版型停新案旗標。讀不到＝throw（不靜默降級）。 */
function loadLayoutDeps(overridePaths = {}) {
  const P = { ...DEFAULT_PATHS, ...overridePaths };
  const registries = loadRegistries(overridePaths);
  const backgrounds = new Map((readJson(P.backgrounds).assets || []).map((a) => [a.id, a]));
  const modules = readJson(P.modules);
  const hero = (modules.modules || []).find((m) => m.module_id === "hero" || m.id === "hero");
  const variantOf = (vid) => ((hero && hero.variants) || []).find((v) => v.variant_id === vid) || null;
  const rolloutOf = (vid) => (variantOf(vid) || {}).rollout || null;
  /* 出貨可選判定（2026-08-24 review 中1，三處共用＝resolveLayoutChoice／suggestLayout／catalogForForm）：
     貨號必須「存在於 modules.json hero variants（出貨值域真源）」且該變體 rollout !== "closed"。
     逐變體制＝與 CP-25 閘（W1-E gates-gray 分支）同套語意；new/legacy 家族「任一 closed＝全停」
     舊語意廢止（2026-08-24 review 中2）——第七張「現行版型」卡看 new 自己、legacy 值看 legacy 自己。
     旗標缺席＝視為開放；裁決日由裁決批直接改 modules.json，本處只讀。 */
  const shippable = (vid) => !!variantOf(vid) && rolloutOf(vid) !== "closed";
  /* 完工才上架（2026-08-25 使用者裁決：滾動上架制）：選單/AI 代選只給「真樣式完工」的版面——
     選得到的就是完整的，完工一款自動多一張卡。名單單一來源＝ENGINE_SUPPORTED（gate 引擎完工閘同吃）；
     deps.engineReady 可覆寫＝hermetic 測試隔離變因用。 */
  return { registries, backgrounds, rolloutOf, shippable, engineReady: engineReadyOverride() || ENGINE_SUPPORTED };
}

/** 目標版式是否「促銷意圖」（決定灰度代換落 007 或 006）：折扣數字槽開、或 kinRef 標記為促銷親戚。 */
function isPromoIntent(rec) {
  if (!rec) return false;
  if (rec.kinRef && rec.kinRef.base) return true; // 003/007/009＝促銷版親戚
  return (rec.slots || []).some((s) => s && s.key === "discount-digit" && s.state === "on");
}

/**
 * AI 代選（C3c）：scenario → 附錄 B 映射 → 灰度過濾。
 * 回傳 { layout, useWhen, reason, substitutedFrom|null }；映射不到／登記簿資料缺＝throw（C3d：退回手選＋出聲）。
 */
function suggestLayout(scenarioRaw, deps, themeRaw) {
  const scenario = String(scenarioRaw || "").replace(/^0\d\s+/, "").trim(); // 舊 run 情境值帶「0N 」前綴＝相容剝除（沿 retryCreate 慣例）
  /* 主題字優先（2026-09-14 使用者裁「自動配看主題字」乙＝登記簿驅動；04 號 §4.2「依資料盤點」第一塊落地）：
     登記簿每款 themeKeywords[]，主題字含其一＝優先配這款（照登記簿順序取第一款）；命中的款若是條件式／停收／未完工／
     背景未過票＝不採、退回下面的活動型態對照表（內容條件不因主題字破例），機器履歷記一句。 */
  const theme = String(themeRaw || "").trim();
  let themeSkipped = "";
  if (theme) {
    const tl = theme.toLowerCase();
    for (const r2 of deps.registries.layoutRecords.values()) {
      const kws = Array.isArray(r2.themeKeywords) ? r2.themeKeywords : [];
      const hit = kws.find((k) => k && tl.includes(String(k).toLowerCase()));
      if (!hit) continue;
      const okShip = deps.shippable(r2.id) && deps.engineReady.has(r2.id);
      const okFit = !(r2.contentFit && r2.contentFit.autoPick === false);
      const okBg = backgroundEligible(deps.backgrounds.get(r2.defaultBackground));
      if (okShip && okFit && okBg) {
        return {
          layout: r2.id, useWhen: (r2.useWhen || [])[0] || "", substitutedFrom: null, byTheme: hit,
          reason: `AI 代選：主題「${theme}」含登記簿主題字「${hit}」→ 版式「${r2.name}」（${r2.id}）。依據＝layouts 登記簿 themeKeywords（2026-09-14 主題字優先條款）；活動型態對照表未動用。`,
          reasonDisplay: `你的主題有「${hit}」，所以配上「${r2.name}」版面——這款就是為這種檔期畫的。之後在編修頁隨時可以換。`,
        };
      }
      if (!themeSkipped) themeSkipped = `主題字「${hit}」對到「${r2.name}」（${r2.id}）但${!okShip ? "它停收或未完工" : !okFit ? "它是條件式版式（不因主題字破例）" : "它的預設背景未過門票"}＝未採，照活動型態對照表；`;
    }
  }
  const row = SCENARIO_LAYOUT_MAP[scenario];
  if (!row) {
    throw new Error(`這個活動型態還沒有對應的版面，請直接手選一張。（技術：情境「${scenario}」不在情境對應表）`);
  }
  const rec = deps.registries.layoutRecords.get(row.layout);
  if (!rec) {
    throw new Error(`自動配版面時發現資料缺漏，請先手選一張，並回報管理者。（技術：映射目標 ${row.layout} 不在版式登記簿）`);
  }
  const scenarioLabel = scenario || "先不指定";
  /* 條件式版式不當自動配預設（2026-09-14 使用者裁，牆 qa/cms-layout-fit-wall-2026-09-14.html）：
     登記簿 contentFit.autoPick===false 的款（首例 008：要放去背模特兒圖、給流行品類）自動配對到時，
     先找「同用途標籤、無條件、可出貨、背景過票」的款換上，理由行講明原因與怎麼換回；同標籤沒得換＝走下面既有代換鏈。
     手選不受影響——條件是講給自動配聽的，人要用就用。 */
  const cf = rec.contentFit && rec.contentFit.autoPick === false ? rec.contentFit : null;
  if (cf) {
    const sameTag = [...deps.registries.layoutRecords.values()].filter((r2) => r2.id !== row.layout && (!(r2.kinRef && r2.kinRef.base) || isPromoIntent(rec)) // 目標是促銷版＝允許換到別款的促銷版（003／009 這類折進本尊卡的親戚）
      && (r2.useWhen || []).includes(row.useWhen) && !(r2.contentFit && r2.contentFit.autoPick === false)
      && deps.shippable(r2.id) && deps.engineReady.has(r2.id) && backgroundEligible(deps.backgrounds.get(r2.defaultBackground)));
    if (sameTag.length) {
      const sub = sameTag[0];
      return {
        layout: sub.id, useWhen: row.useWhen, substitutedFrom: row.layout,
        reason: `AI 代選：${themeSkipped}活動情境「${scenarioLabel}」→ 用途標籤「${row.useWhen}」原建議「${rec.name}」（${row.layout}），但登記簿標它為條件式版式（contentFit.autoPick=false：${cf.short || cf.requires || "有特定素材條件"}）＝不當自動配預設，代換為同標籤的「${sub.name}」（${sub.id}）。`,
        reasonDisplay: fitReasonDisplay(rec, cf, sub),
      };
    }
  }
  /* 出貨可選判定先行（2026-08-24 review 中1）：目標已停收（不在 modules.json 出貨值域或 rollout 已關）
     ＝永不回它，走代換鏈（與灰度未過票同一條代換鏈，理由行講明是哪一種）。 */
  const targetShippable = deps.shippable(row.layout) && deps.engineReady.has(row.layout) && !cf; // 完工才上架：未完工＝走代換鏈（滾動上架制 2026-08-25）；條件式（cf）同標籤沒得換＝也走代換鏈
  let bg = null;
  if (targetShippable) {
    bg = deps.backgrounds.get(rec.defaultBackground);
    if (!bg) {
      throw new Error(`自動配版面時發現資料缺漏，請先手選一張，並回報管理者。（技術：版式 ${row.layout} 預設背景 ${rec.defaultBackground} 不在背景登記簿）`);
    }
    if (backgroundEligible(bg)) {
      return {
        layout: row.layout,
        useWhen: row.useWhen,
        substitutedFrom: null,
        /* reason＝機器履歷（存 meta 供追溯，可帶編號代號）；reasonDisplay＝介面顯示（2026-08-25 使用者裁決：
           CMS 文案一律 UX writing 對一般用戶，禁文件編號/貨號/映射表行話——顯示層只用這欄） */
        reason: `AI 代選：${themeSkipped}活動情境「${scenarioLabel}」→ 用途標籤「${row.useWhen}」→ 版式「${rec.name}」（${row.layout}）。依據＝51 號附錄 B 映射表 v0。`,
        reasonDisplay: scenario
          ? `你選的是「${scenarioLabel}」，所以配上「${rec.name}」版面——這款就是為這類活動設計的。之後在編修頁隨時可以換。`
          : `你沒有指定活動型態，先用「${rec.name}」版面開始——之後在編修頁隨時可以換。`,
      };
    }
  }
  /* 代換鏈：映射目標已停收、或預設背景授權未過灰度門票＝代換為可上線組合（layout-006/007，51 附錄 B 灰度條款），
     理由行明講（不靜默換）。促銷意圖優先 007、否則 006；候選自身停收或未過門票＝丟下一個；全滅＝throw 退回手選。 */
  /* 2026-09-14 使用者更正後：偏好對 006/007（多品環列＝流行品類／去背圖）本身是條件式版式＝不能再當代換落點。
     偏好對裡沒有可用的（條件式、停收、未過票）＝掃整本登記簿找「同促銷意圖、無條件、可出貨、背景過票」的款，照登記簿順序取第一款。 */
  const conditional = (r2) => !!(r2 && r2.contentFit && r2.contentFit.autoPick === false);
  const pref = (isPromoIntent(rec) ? ["layout-007", "layout-006"] : ["layout-006", "layout-007"]).filter((c) => c !== row.layout);
  const ok2 = (c) => { const r2 = deps.registries.layoutRecords.get(c); return r2 && !conditional(r2) && deps.shippable(c) && deps.engineReady.has(c) && backgroundEligible(deps.backgrounds.get(r2.defaultBackground)) ? r2 : null; };
  let subId = null, subRec = null;
  for (const c of pref) { const r2 = ok2(c); if (r2) { subId = c; subRec = r2; break; } }
  if (!subId && pref.some((c) => conditional(deps.registries.layoutRecords.get(c)))) {
    for (const r2 of deps.registries.layoutRecords.values()) {
      if (r2.id === row.layout || isPromoIntent(r2) !== isPromoIntent(rec)) continue;
      if (ok2(r2.id)) { subId = r2.id; subRec = r2; break; }
    }
  }
  if (!subId) {
    throw new Error(
      `目前沒有可以上線的版面組合，請先手選一張，並回報管理者。（技術：建議 ${row.layout} 與代換候選皆不可出貨＝停收、授權未過或條件式版式）`
    );
  }
  const why = cf
    ? `但登記簿標它為條件式版式（contentFit.autoPick=false：${cf.short || cf.requires || "有特定素材條件"}）且同標籤沒有可換的款`
    : !deps.shippable(row.layout)
    ? `但它已停收（不在 modules.json 出貨值域，或該變體 rollout 已關）`
    : !deps.engineReady.has(row.layout)
      ? `但它真樣式未完工（不在 ENGINE_SUPPORTED 完工名單＝滾動上架制）`
      : `但它的預設背景 ${rec.defaultBackground} 素材授權還沒過灰度門票（license ${bg.license}${bg.license === "B" ? "・未複查" : ""}）`;
  return {
    layout: subId,
    useWhen: row.useWhen,
    substitutedFrom: row.layout,
    reason:
      `AI 代選：${themeSkipped}活動情境「${scenarioLabel}」→ 用途標籤「${row.useWhen}」原建議「${rec.name}」（${row.layout}），` +
      why +
      `＝依 51 附錄 B 灰度條款代換為可上線的「${subRec.name}」（${subId}）。`,
    reasonDisplay: cf ? fitReasonDisplay(rec, cf, subRec) : `原本最適合的是「${rec.name}」版面，但它暫時還不能上線，先換成「${subRec.name}」。之後在編修頁隨時可以換。`,
  };
}
/* 條件式版式代換的顯示句（2026-09-14 使用者過目版＝牆 Q2③）：先講原本對到哪款、再講它要什麼、最後講怎麼換回。 */
function fitReasonDisplay(rec, cf, sub) {
  return `這類活動原本對到「${rec.name}」，但它${cf.short || "有特定的素材條件"}，自動配沒辦法確定你有——先配「${sub.name}」版面。真的有${cf.asset || "那樣的素材"}，到編修頁換回來就好。`;
}

/**
 * 建立時的版式值解析（C1/C3/C4 的伺服器端裁決點）。
 * @param {object} input 建立表單 payload（kvVariant＝"ai"｜裸值貨號；scenario／proposalPack／packDeviated 併看）
 * @returns { kvVariant, choice:{by,reason,useWhen?,substitutedFrom?,engineNote,decidedAt} }
 * 未知貨號／已停收＝throw（前端照 AC13 精神回 AI 代選＋出聲）。
 */
function resolveLayoutChoice(input, deps) {
  const decidedAt = new Date().toISOString();
  const raw = normalizeKvVariant(String(input.kvVariant == null ? "" : input.kvVariant).trim());
  const byOfManual = (v) =>
    input.proposalPack && input.proposalPack.layout === v && !input.packDeviated ? "pack" : "manual";
  if (raw === "ai") {
    const s = suggestLayout(input.scenario, deps, input.theme); // 主題字優先（2026-09-14）：建立表單的主題欄一起交給代選
    return {
      kvVariant: s.layout,
      choice: { by: "ai", reason: s.reason, reasonDisplay: s.reasonDisplay, useWhen: s.useWhen, substitutedFrom: s.substitutedFrom, byTheme: s.byTheme || null, engineNote: engineNoteFor(s.layout), decidedAt },
    };
  }
  if (raw === "new" || raw === "legacy") {
    /* 逐變體判定（2026-08-24 review 中2，與 CP-25 閘同套；new/legacy 家族「任一 closed＝全停」語意廢止）：
       值＝new 看 new 自己的 rollout、值＝legacy 看 legacy 自己——一邊停收不牽連另一邊。 */
    if (!deps.shippable(raw)) {
      throw new Error(`「現行版型」暫停接新活動，請改選其他版面，或改回自動配。（技術：${raw} 變體 rollout=closed）`);
    }
    return {
      kvVariant: raw,
      choice: { by: byOfManual(raw), reason: `手選「現行版型」（${raw}＝目前出貨中的版型）`, reasonDisplay: "你選了「現行版型」——目前每天出貨中的版面。", engineNote: engineNoteFor(raw), decidedAt },
    };
  }
  if (deps.registries.layoutRecords.has(raw)) {
    /* 出貨可選判定（2026-08-24 review 中1）：設計側 layouts manifest 有紀錄還不夠——必須同時在
       modules.json hero variants 出貨值域內且該變體 rollout !== "closed"（deps.shippable，三處共用）。 */
    if (!deps.shippable(raw)) {
      throw new Error(`這個版面暫停使用，請改選其他版面，或改回自動配。（技術：${raw} 停收＝不在出貨值域或 rollout=closed）`);
    }
    if (!deps.engineReady.has(raw)) { // 完工才上架（2026-08-25）：選單不出、直傳值也擋＝同一套
      throw new Error(`這個版面正式樣式還在製作中，完成後就會開放選用，請先改選其他版面。（技術：${raw} 不在 ENGINE_SUPPORTED 完工名單）`);
    }
    const rec = deps.registries.layoutRecords.get(raw);
    return {
      kvVariant: raw,
      choice: {
        by: byOfManual(raw),
        reason: `手選版式「${(rec && rec.name) || raw}」（${raw}）`,
        reasonDisplay: byOfManual(raw) === "pack"
          ? `照設計師提案包，這檔用「${(rec && rec.name) || raw}」版面。之後在編修頁隨時可以換。`
          : `你選了「${(rec && rec.name) || raw}」版面。之後在編修頁隨時可以換。`,
        engineNote: engineNoteFor(raw), decidedAt,
      },
    };
  }
  throw new Error(`這個版面代號系統不認得，請重新選一張。（技術：kvVariant=${input.kvVariant} 不在值域＝new｜legacy＋登記簿貨號）`);
}

/**
 * 表單卡目錄（C1）：九版式依 kinRef 折疊成六卡＋現行版型卡開關。
 * 促銷親戚（kinRef.base 指回本尊者）不出卡、掛在本尊卡的折扣開關上；
 * kinRef 對換目標不在出貨值域＝開關 disabled＋理由（51 §2.7 失敗落點）。
 */
function catalogForForm(deps) {
  const { registries, backgrounds, rolloutOf, shippable } = deps;
  const cards = [];
  for (const rec of registries.layoutRecords.values()) {
    if (rec.kinRef && rec.kinRef.base) continue; // 促銷版＝折進本尊卡
    if (!shippable(rec.id)) continue; // 已停收（不在出貨值域或 rollout 已關）＝卡不出現（2026-08-24 review 中1，與 resolve/suggest 同一套判定）
    if (!deps.engineReady.has(rec.id)) continue; // 完工才上架（2026-08-25 使用者裁決）：未完工＝卡不出現，完工一款自動多一張
    const promoId = rec.kinRef && rec.kinRef.promo;
    const promoRec = promoId ? registries.layoutRecords.get(promoId) : null;
    let promo = null;
    if (promoId && promoRec && deps.engineReady.has(promoId)) { // 促銷親戚未完工＝開關整個不出現（不印「不可用」＝2026-08-25 條款）
      const available = shippable(promoId); // 逐變體出貨可選（含 rollout closed）＝2026-08-24 review 中1
      promo = {
        id: promoId,
        name: (promoRec && promoRec.name) || promoId,
        available,
        unavailableReason: available ? null : `這款的促銷版暫時停用。（技術：${promoId} 不在出貨值域或已停收）`,
        /* 008↔009 特例（51 §2.14）：親戚對皮膚／預設背景不同＝切換連動，UI 需預告 */
        switchNote:
          promoRec && (promoRec.skin !== rec.skin || promoRec.defaultBackground !== rec.defaultBackground)
            ? "打開折扣數字，背景與風格會一起換成促銷版的樣子。"
            : null,
      };
    }
    const bg = backgrounds.get(rec.defaultBackground) || null;
    cards.push({
      id: rec.id,
      name: rec.name,
      skeleton: rec.skeleton || "",
      skin: rec.skin || "",
      useWhen: rec.useWhen || [],
      thumbFile: rec.thumbnail ? path.basename(rec.thumbnail) : null, // 缺檔＝前端佔位圖＋警示不擋（51 §2.7）
      rollout: rolloutOf(rec.id), // "trial"＝試用徽章（51 §3）
      defaultBackground: rec.defaultBackground,
      backgroundPool: rec.backgroundPool || [], // 編修組合面板（W1-D）：池內排前帶「推薦」、池外黃燈不阻擋（51 §2.9）
      backgroundType: rec.backgroundType || null, // ①整組隨主題變色｜②圖片背景（主色不適用）｜③紋理疊主題色（51 §7）
      themeAware: themeAwareOf(rec), // K14（2026-08-28）：false＝畫面色固定（欄位保留可用；介面照實說明、禁「不可用」句）；2026-08-30 設計師配色優先制＝帶 themeDraft 時文字排版槽照配色（引擎 cc-* 開關），本旗標語意不變＝仍指「板底/藝術指導件不隨 token 主題」
      grayTicket: backgroundEligible(bg), // false＝預設背景授權未過灰度門票（資訊揭示；手選不擋、AI 代選會代換）
      titleFrame: !!rec.titleFrame, // 主標兩側裝飾線（2026-09-04）：true＝面板顯示開關（五款：001/002/003/009 括線、007 短線）
      contentFit: rec.contentFit || null, // 內容條件（2026-09-14）：有＝卡上印 say 那一句（條件式版式：要什麼圖、給誰用）；autoPick:false＝代選避開它
      promo,
    });
  }
  /* 編修組合面板資料（W1-D，2026-08-25；同一端點附加＝表單零波及）：
     背景值域＝backgrounds 登記簿全景（51 §2.9）＋逐筆門票；主題值域＝tokens.json themes slug（rejected 不出）。 */
  const backgroundsAll = [...deps.backgrounds.values()].map((b) => ({
    id: b.id, name: b.name || b.id, license: b.license || null, type: b.type || null,
    bridgeColor: b.bridgeColor || null, grayTicket: backgroundEligible(b),
    bgClass: b.bgClass || null, // 三分類（scene/seamless/pattern）＝面板行為說明的驅動欄（51 §7.1 v2；theme 框架批 2026-08-25）
    retiredFromPool: !!b.retiredFromPool, // v0.6.3（2026-08-25 裁決）：true＝選單不出現；既有 draft 值容忍出聲
    fullBleed: b.fullBleed !== undefined ? !!b.fullBleed : null, // scene 逐張標：false＝圖只鋪舞台範圍（面板行為句要講對）
  }));
  const layoutIndex = {}; // 九貨號全收（含促銷親戚——編修中的 draft 可能正是 003/007/009，槽位編修要查得到）
  for (const rec of registries.layoutRecords.values()) {
    layoutIndex[rec.id] = {
      id: rec.id, name: rec.name, skeleton: rec.skeleton || "", skin: rec.skin || "",
      slots: rec.slots || [], defaultBackground: rec.defaultBackground,
      backgroundPool: rec.backgroundPool || [], backgroundType: rec.backgroundType || null,
      themeAware: themeAwareOf(rec), // K14：編修頁主題欄照實揭示的判準（同 cards）
      titleFrame: !!rec.titleFrame, // 主標兩側裝飾線（2026-09-04）：編修頁面板據此顯示開關（促銷親戚 003/009 各自有旗標＝查得到）
      kinRef: rec.kinRef || null, thumbFile: rec.thumbnail ? path.basename(rec.thumbnail) : null,
      contentFit: rec.contentFit || null, // 編修頁組合面板卡也要講同一句（牆 Q2②）
      /* 自備背景三格需求尺寸（2026-10-07 設計反饋：上傳格旁標「需 W×H」）——跟驗證同一個 minSizeFor；沒登記舞台的版式＝null，前端就不標 */
      bgNeed: { desktop: heroStages.minSizeFor(rec.id, "desktop"), "768": heroStages.minSizeFor(rec.id, "768"), "375": heroStages.minSizeFor(rec.id, "375") },
    };
  }
  return {
    cards,
    backgrounds: backgroundsAll,
    themes: registries.themeIds,
    layoutIndex,
    /* 現行版型卡：值寫 "new"（＝今日建立流程實際出貨的版型；legacy 舊文字鎖陣值域保留、編修/xlsx 仍可選）。
       open＝逐變體看 new 自己的 rollout（2026-08-24 review 中2；legacy 停收不牽連本卡，反之亦然）。 */
    legacy: { open: shippable("new"), value: "new" },
    engineNote: "新版面陸續完成中——完成一款就會自動出現在這裡，選得到的都是完整的。", // 滾動上架制提示（2026-08-25；ENGINE_NOTE_BUILDING 留給已建活動的編修頁橫幅）
    heroTextPieces: HERO_TEXT_PIECES, // 逐段編修的段落名表（編修器消費；單一來源）
    /* 排版檔位表＋15 槽定義下發（theme 框架批 2026-08-25）：面板選項與逐槽微調格＝這兩張表、不得前端硬編（單一來源＝lib/theme_draft.js） */
    typography: { scaleSteps: themeDraftLib.TYPO_SCALE_STEPS, leadingSteps: themeDraftLib.TYPO_LEADING_STEPS, trackingSteps: themeDraftLib.TYPO_TRACKING_STEPS, widthSteps: themeDraftLib.TITLE_WIDTH_STEPS }, /* trackingSteps＝字距（2026-09-05）；四張表都從 theme_draft 單一來源下發、面板只負責畫 */
    themeSlots: themeDraftLib.THEME_SLOTS,
  };
}

/** 提案包表單驗證（C2）：parseProposalPack 原樣＋帶入選卡所需的對應（promo 貨號＝本尊卡＋折扣開關開）。 */
function parsePackForForm(raw, deps) {
  const r = parseProposalPack(raw, deps.registries);
  if (!r.ok) return r;
  const rec = deps.registries.layoutRecords.get(r.pack.layout) || null;
  const cardBase = rec && rec.kinRef && rec.kinRef.base ? rec.kinRef.base : r.pack.layout;
  /* 顯示名（2026-09-04 使用者過目：帶入結果不印貨號、改登記簿名稱）——查不到名的欄位回 null，前端就不印那一行 */
  const reg = deps.registries;
  const bgRec = r.pack.background ? ((deps.backgrounds && deps.backgrounds.get(r.pack.background)) || (reg.pendingBackgroundRecords && reg.pendingBackgroundRecords.get(r.pack.background))) : null;
  const themeRec = r.pack.theme ? ((readJson(DEFAULT_PATHS.tokens).themes || []).find((t) => t.slug === r.pack.theme) || null) : null;
  const fontRec = r.pack.font ? ((readJson(DEFAULT_PATHS.fonts).assets || []).find((a) => a.id === r.pack.font) || null) : null;
  const motionRec = r.pack.motion && r.pack.motion !== "static" ? (reg.motionRecords && reg.motionRecords.get(r.pack.motion)) : null;
  const tsRec = r.pack.titleStyle ? (reg.typestyleRecords && reg.typestyleRecords.get(r.pack.titleStyle)) : null;
  return {
    ...r,
    layoutName: (rec && rec.name) || r.pack.layout,
    cardBase,
    discountOn: !!(rec && rec.kinRef && rec.kinRef.base),
    names: {
      background: bgRec ? (bgRec.name || null) : null,
      theme: themeRec ? (themeRec.label || null) : (r.pack.theme === "default" ? "預設・品牌藍" : null),
      font: fontRec ? (fontRec.displayName || fontRec.family || null) : null,
      motion: motionRec ? (motionRec.name || null) : null,
      titleStyle: tsRec ? (tsRec.displayName || null) : null,
    },
  };
}

/* ---------- 主視覺商品槽預填：一張表、三個入口共用（建立期預填／照策略檔重做／換版式補槽；2026-09-27）----------
   HERO_PREFILL_TAKE＝每種商品槽預填幾件：環列 4／拼貼 4／左右各 2／主品 3（＝2026-08-30 裁決輪播預設 3、上限 6 由人加）。
   原本這三個數字散寫在 take(4)/take(2)/take(3) 三行裡；server 端要算「這款版式主視覺要幾件」（乙：機械策展預留件數）時
   得再抄一份——抽成表，heroProductCapacity 與預填讀同一張。 */
const HERO_PREFILL_TAKE = Object.freeze({ "item-ring": 4, "collage-right": 4, "product-left": 2, "product-right": 2, "product-main": 3 });
const HERO_SLOT_LABEL = Object.freeze({ "item-ring": "環列商品槽", "collage-right": "右側拼貼槽", "product-left": "左商品槽", "product-right": "右商品槽", "product-main": "主商品槽" });
/* 主視覺商品顯示名的寬度尺＝gate CP-03 那把（rules.json charLimits：heroName 760px@16px；widthModel 全形 1／半形 0.55／空格 0.3）。
   編輯器把商品放進主視覺槽時「主視覺標題」欄預設值＝商品全名，第一次存檔就寫進 heroName；預填若挑了放不進兩行的名字，
   使用者什麼都沒改就會吃一條 CP-03（2026-09-27 病例 run 123617 gdid 11643457）。預填先用同一把尺量，太長的跳過取下一件。 */
const HERO_NAME_BUDGET_EM = RULES.charLimits.pxBudgets.heroName.budgetPx / RULES.charLimits.pxBudgets.heroName.fontPx;
const WIDTH_MODEL = RULES.charLimits.widthModel;
const textWidthEm = (s) => [...String(s == null ? "" : s)].reduce((a, ch) => a + (ch === " " ? WIDTH_MODEL.space : ch.charCodeAt(0) > 255 ? WIDTH_MODEL.fullwidth : WIDTH_MODEL.halfwidth), 0);

/** 這款版式主視覺一共要預填幾件商品（state!=="off" 的商品槽加總；沒有商品槽＝0） */
function heroProductCapacity(layoutRec) {
  let n = 0;
  for (const s of (layoutRec && layoutRec.slots) || []) if (s && s.key && s.state !== "off" && HERO_PREFILL_TAKE[s.key]) n += HERO_PREFILL_TAKE[s.key];
  return n;
}

/**
 * 預填要避開的商品＝已經在頁面別處曝光的那些（U22 全頁互斥；讓位序 KV＞入口＞樓層＞牆）。
 * 「主視覺優先、下面讓位」維持（2026-09-27 使用者裁、不做主視覺例外）——但機器預填時下面已經排好了，主視覺自己跳過就好；
 * 真正的讓位在 curate_auto 端（乙：主打預留件數＝主視覺容量），這裡是三個入口共用的安全網。
 * 名單不另寫：沿 lib/content_modules.js gdidUsedOnPage——加商品／換商品那道門用的同一條規則（9/24 認情境卡、9/26 認主視覺槽）。
 * 兩個調整都是「看的角度」、不是第二份名單：
 *   ①hero 換成 heroSoFar（換版式補槽時＝已搬家／已還原的槽；建立期＝空）——主視覺槽內部也不重複；
 *   ②kv.keyProductGdids 抹空——layout-0NN 頁的舊 KV 欄是主視覺的鏡像（gate v20 同一判定），拿它排除等於把主視覺自己要放的商品排掉。
 */
function heroPrefillExclusions(page, products, heroSoFar) {
  const { gdidUsedOnPage } = require("./content_modules"); // 惰性 require：content_modules 不載本檔，保守避免日後成環
  const pg = page || {};
  const view = { ...pg, hero: heroSoFar && typeof heroSoFar === "object" ? heroSoFar : {}, kv: { ...(pg.kv || {}), keyProductGdids: [] } };
  const ex = new Set();
  for (const p of products || []) {
    if (!p || p.gdid == null) continue;
    const g = String(p.gdid);
    if (ex.has(g)) continue;
    if (gdidUsedOnPage(view, products, g)) ex.add(g);
  }
  return ex;
}
/** 三個入口共用的預填選項（排除集合＋名字寬度預算）；呼叫端不各自組、才不會漂成三把尺 */
function heroPrefillOptions(page, products, heroSoFar) {
  return { exclude: heroPrefillExclusions(page, products, heroSoFar), nameBudgetEm: HERO_NAME_BUDGET_EM };
}

/**
 * 建立期骨架預填（旅程③「系統照版式做出草稿」；2026-08-24 W1-B 切片二補缺角）：
 * 只填機器可安全決定的槽——文字槽＝機器策展算好的兩行標題（kv.titleLine1/2；可編修）、商品槽＝商品池前 N 件 gdid 引用
 * （價格/檔期/URL 真值不經此路＝渲染端照 gdid 讀 products 真值欄）。已有 hero＝不覆蓋。
 * 槽容量＝HERO_PREFILL_TAKE；time-band／discount-digit（真值/第二波欄）與 sub-capsule 建立期不預填。
 *
 * 文字槽為什麼不再放活動名（2026-09-24 病例 run 174314）：活動名是 `白蘭_同品類×跨品牌-優惠銷售_2026-09` 這種底線串，
 * 原本原封不動印在消費者頁的主標上；換版式的 legacy 對映早就用 kv.titleLine1/2 當標題，這裡改吃同一個來源。
 * 沒有 kv 標題（舊稿／測試）＝退回活動名，行為不變。第 4 參數可省。
 *
 * 第 5 參數 opts（2026-09-27；病例 run 142315／123617＝主視覺右槽第 2 格永遠撞到第 1 層情境卡代表品）：
 *   { exclude: Set<gdid>, nameBudgetEm: number }——商品槽沿 products[] 順序往下走，跳過已曝光的與名字放不進兩行的，
 *   槽沒放滿就少放（short 帳）、不拿違規商品湊數。不帶 opts＝逐位元組舊行為（既有測試與可再生判定都靠這點）。
 *   帳只記「走到的」那些（填滿就停，後面的不算跳過）。
 */
function defaultHeroForLayoutEx(layoutRec, pageName, products, kv, opts) {
  const o = opts || {};
  const exclude = o.exclude instanceof Set ? o.exclude : null;
  const nameBudgetEm = Number.isFinite(o.nameBudgetEm) ? o.nameBudgetEm : null;
  const list = (products || []).filter((p) => p && p.gdid != null);
  const skipped = { exposed: [], tooLong: [] };
  const short = [];
  let idx = 0;
  const take = (n) => {
    const out = [];
    while (out.length < n && idx < list.length) {
      const p = list[idx++];
      const g = String(p.gdid);
      if (exclude && exclude.has(g)) { skipped.exposed.push(g); continue; }
      if (nameBudgetEm != null && textWidthEm(p.name) > nameBudgetEm) { skipped.tooLong.push(g); continue; }
      out.push(g);
    }
    return out;
  };
  const hero = {};
  const kvT = kv || {};
  const titleLines = [kvT.titleLine1, kvT.titleLine2].map((s) => String(s == null ? "" : s).trim()).filter(Boolean);
  const lines = titleLines.length ? titleLines : (pageName ? [String(pageName)] : []);
  for (const s of (layoutRec && layoutRec.slots) || []) {
    if (s.state === "off") continue;
    const k = s.key;
    if (k === "title-center" || k === "slogan-left") {
      if (!lines.length) continue;
      const w = writeTitleIntoSlot(layoutRec && layoutRec.id, "", lines); // 段位照段落表（010 上下行兩格）；表裡沒有這款＝整串進第 0 段
      hero[k] = w && w.slot === k ? w.value : lines.join(FOLD);
    }
    else if (HERO_PREFILL_TAKE[k]) {
      const want = HERO_PREFILL_TAKE[k];
      const g = take(want);
      if (g.length) hero[k] = { gdids: g }; /* product-main 帶 3 件＝2026-08-30 使用者裁決（輪播預設 3、上限 6 由人加）；<2 件渲染端自動退靜態 */
      if (g.length < want) short.push({ slot: k, want, got: g.length });
    }
  }
  return { hero, skipped, short };
}
function defaultHeroForLayout(layoutRec, pageName, products, kv, opts) {
  return defaultHeroForLayoutEx(layoutRec, pageName, products, kv, opts).hero;
}

/** 預填帳折成人話（一則一件事、狀態導向、不前置解釋；2026-09-27）：只有槽沒放滿才出聲。回 [] ＝沒事。 */
function heroPrefillNotes(r) {
  const out = [];
  if (!r || !Array.isArray(r.short) || !r.short.length) return out;
  const sk = r.skipped || {};
  const tooLong = (sk.tooLong || []).length, exposed = (sk.exposed || []).length;
  const why = tooLong || exposed
    ? `${tooLong ? `${tooLong} 件名字放不進兩行、` : ""}${exposed ? "其餘候選已在樓層或牆上" : "其餘候選不夠分"}`
    : "這批商品不夠分";
  for (const s of r.short) {
    const label = HERO_SLOT_LABEL[s.slot] || s.slot;
    out.push(`${label}放了 ${s.got} 件，這款要 ${s.want} 件。到編修頁貼商品網址補齊；${why}。`);
  }
  return out;
}

/** 乙（2026-09-27 使用者裁）：機械策展要預留的主打件數＝版式主視覺商品槽容量（至少 3）。
 *  layout-* 一律帶 --heroCount（帶了＝curate_auto 走「新版式」路：預留 N 件、主打只挑名字放得進兩行的）；
 *  非 layout-*（舊殼）不帶＝curate_auto 舊行為逐位元組不變；登記簿讀不到／沒這款＝不帶、note 出聲（呼叫端寫 wb.log；鐵律 3 不吞）。 */
function heroCountArgs(kvVariant, overridePaths = {}) {
  const kv = String(kvVariant || "");
  if (!/^layout-\d{3}$/.test(kv)) return { args: [], count: 3, note: null };
  try {
    const rec = loadLayoutDeps(overridePaths).registries.layoutRecords.get(kv);
    if (!rec) return { args: [], count: 3, note: `主打預留件數：登記簿沒有 ${kv}，照預設 3 件` };
    const n = Math.max(3, heroProductCapacity(rec));
    return { args: ["--heroCount", String(n)], count: n, note: null };
  } catch (e) {
    return { args: [], count: 3, note: `主打預留件數：登記簿讀取失敗，照預設 3 件（技術：${e.message}）` };
  }
}

/**
 * 把建立表單選定的版式寫進 draft.json（server createRun 背景流程用；2026-08-24 review 中3）。
 * 寫 page.kvVariant＋meta.layoutChoice＋meta.proposalPack；layout-* 且 hero 缺席＝照登記簿槽位預填骨架。
 * 讀不到／寫不進＝throw（呼叫端記 meta.layoutChoiceWriteError 出聲，status／列表回應轉成
 * layoutChoiceError 白話警告——不准畫面稱成功）；預填讀簿失敗＝不擋版式寫入、記 heroPrefill 欄出聲。
 */
function writeLayoutChoiceIntoDraft(draftPath, input, overridePaths = {}) {
  if (!input || !input.kvVariant || !input.layoutChoice) {
    throw new Error("版式選擇寫進草稿失敗：缺 kvVariant 或 layoutChoice（呼叫端契約錯誤）");
  }
  let dj;
  try {
    dj = JSON.parse(fs.readFileSync(draftPath, "utf8"));
  } catch (e) {
    throw new Error(`版式選擇寫進草稿失敗（讀取 ${draftPath}）：${e.message}`);
  }
  dj.page = dj.page || {};
  dj.page.kvVariant = input.kvVariant;
  dj.meta = dj.meta || {};
  dj.meta.layoutChoice = input.layoutChoice;
  if (/^layout-\d{3}$/.test(input.kvVariant) && (dj.page.hero == null || typeof dj.page.hero !== "object")) {
    try {
      const deps = loadLayoutDeps(overridePaths);
      const rec = deps.registries.layoutRecords.get(input.kvVariant);
      /* 2026-09-27：跳過已在樓層／牆曝光的、跳過名字放不進兩行的（三個入口同一把尺＝heroPrefillOptions）；沒放滿＝白話出聲不湊數 */
      const r = defaultHeroForLayoutEx(rec, dj.page.pageName, dj.products, dj.page.kv, heroPrefillOptions(dj.page, dj.products, null));
      dj.page.hero = r.hero;
      const notes = heroPrefillNotes(r);
      dj.meta.layoutChoice.heroPrefill = `骨架預填 ${Object.keys(dj.page.hero).length} 槽（建立期機器預設、可編修）${notes.length ? "；" + notes.join("；") : ""}`;
      if (notes.length) dj.meta.layoutChoice.heroPrefillNotes = notes;
      if (r.skipped.exposed.length || r.skipped.tooLong.length) dj.meta.layoutChoice.heroPrefillSkipped = { exposed: r.skipped.exposed.length, tooLong: r.skipped.tooLong.length };
    } catch (e) {
      dj.meta.layoutChoice.heroPrefill = `骨架預填失敗（登記簿讀取）：${e.message}——版式已保存、槽內容待編修頁補`;
    }
  }
  if (input.proposalPack) {
    dj.meta.proposalPack = { pack: input.proposalPack, warnings: input.packWarnings || [], deviated: !!input.packDeviated };
  }
  try {
    fs.writeFileSync(draftPath, JSON.stringify(dj, null, 1));
  } catch (e) {
    throw new Error(`版式選擇寫進草稿失敗（寫入 ${draftPath}）：${e.message}`);
  }
}

module.exports = {
  SCENARIO_LAYOUT_MAP,
  ENGINE_SUPPORTED, // 完工名單單一來源（gate 引擎完工閘＋面板同吃）
  HERO_TEXT_PIECES,
  titleSlotFor,        // 主標落哪一格（2026-09-24）：策略檔套主標／建立期預填／換版式補槽共用
  writeTitleIntoSlot,
  backgroundEligible,
  loadLayoutDeps,
  suggestLayout,
  resolveLayoutChoice,
  catalogForForm,
  parsePackForForm,
  writeLayoutChoiceIntoDraft,
  defaultHeroForLayout,
  defaultHeroForLayoutEx,   // 2026-09-27：預填＋帳（skipped／short）；三個入口同一把尺
  heroPrefillOptions,
  heroPrefillExclusions,
  heroPrefillNotes,
  heroProductCapacity,
  heroCountArgs,            // 乙：server 三個 curate 呼叫點帶 --heroCount
  HERO_PREFILL_TAKE,
  HERO_NAME_BUDGET_EM,
  engineNoteFor,
  ENGINE_NOTE_BUILDING,
};
