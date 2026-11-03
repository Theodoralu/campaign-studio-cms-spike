"use strict";
/**
 * hero_bg_kit.js —— 「背景製作說明」下載檔（markdown）的產生器
 *
 * 白話：給要自己準備主視覺背景圖的人一份可以直接用的說明：這款版式三種裝置各要多大、貼給 Gemini／ChatGPT 的提示詞、
 * 給設計師的一頁 brief、還有做背景時要留意的原則。**提示詞照版式、照裝置寫**（2026-09-27 使用者實測：Gemini 出的插畫壓到標題）：
 *   尺寸與檔案大小寫成硬規格；文字在哪（安靜區）、商品在哪（商品區）、插畫能放哪（帶）——數字來自 lib/hero_kit_tables.json
 *   （tools/build_hero_kit_tables.js 用無頭 Chrome 把引擎真的畫出來量的，12 款 × 3 裝置），不手抄。
 * 文字真源＝lib/hero_bg_kit_copy.json；尺寸真源＝lib/hero_stages（引擎舞台表 twin）＋背景登記簿 weightGate。
 *
 * 展示層規矩：不印貨號（layout-0NN）、不寫「AI」二字（layout_choice.test 禁詞）；版式用登記簿的展示名。78 號裁決批。
 */
const fs = require("fs");
const path = require("path");
const { HERO_STAGES, minSizeFor, ULTRAWIDE_CANVAS } = require("./hero_stages");
const { HERO_TEXT_PIECES } = require("./layout_choice");

/** 從草稿抓這檔的主標與副標原文（\n 換槽、U+2028 折行）：主標＝該款文字槽第 1 段；副標＝段名含「副」的那段（有才給） */
function heroTitleTexts(layoutId, hero) {
  const pieces = HERO_TEXT_PIECES[layoutId] || {}; const slot = Object.keys(pieces)[0]; if (!slot || !hero) return { title: "", sub: "", others: [] };
  const raw = String(hero[slot] || ""); const segs = raw.split(/\n/).map((x) => x.replace(/\u2028/g, " ").trim());
  const labels = pieces[slot] || []; const subIdx = labels.findIndex((l) => l && /^副/.test(l));
  /* 關掉開關時收掉的是整組文字（主標、副標、品牌帶、眉標、膠囊…）——含文字版要把每一段有填的都給生圖工具，不只主標 */
  const others = labels.map((l, i) => {
    if (i === 0 || i === subIdx || !l || !segs[i]) return null;
    return { label: String(l).replace(/（[\s\S]*$/, ""), text: segs[i] };
  }).filter(Boolean);
  return { title: segs[0] || "", sub: subIdx > 0 ? (segs[subIdx] || "") : "", others };
}

const COPY_PATH = path.join(__dirname, "hero_bg_kit_copy.json");
const TABLES_PATH = path.join(__dirname, "hero_kit_tables.json");
let COPY_CACHE = null, TABLES_CACHE = null;
function loadCopy() { if (!COPY_CACHE) COPY_CACHE = JSON.parse(fs.readFileSync(COPY_PATH, "utf8")); return COPY_CACHE; }
function loadTables() { if (!TABLES_CACHE) { try { TABLES_CACHE = JSON.parse(fs.readFileSync(TABLES_PATH, "utf8")); } catch (e) { TABLES_CACHE = { layouts: {} }; } } return TABLES_CACHE; }

function fill(tpl, vars) { return String(tpl).replace(/\{\{(\w+)\}\}/g, (m, k) => (vars[k] != null ? String(vars[k]) : m)); }
const r0 = (v) => Math.round(Number(v) || 0);
const pctRange = (a, b) => `${r0(a)}%～${r0(b)}%`;
function ratioOf(w, h) { return w >= h ? `${(w / h).toFixed(2)}:1` : `1:${(h / w).toFixed(2)}`; } /* 一律小數比，人看得懂（18:7 那種約分沒人用） */

/** 一個裝置的版面變數：安靜區／商品區／插畫帶／版面白話 */
function deviceZones(layoutId, device) {
  const t = ((loadTables().layouts || {})[layoutId] || {})[device] || null;
  if (!t) return { layoutNote: "（這款版式的版面位置尚未量測——請以特徵置中、文字區留白為原則）", quietZone: "畫面中央約 40% 寬、上下中段", productZone: "（未量測）", illustZone: "畫面四角，避開中央", fadePct: null, hasBands: false };
  const text = t.text; const prods = t.products || [];
  const quietZone = text ? `水平 ${pctRange(text.x - 3, text.x + text.w + 3)}、垂直 ${pctRange(text.y - 3, text.y + text.h + 3)}` : "（這個裝置沒有文字壓在圖上）";
  const productZone = prods.length ? prods.map((b) => `水平 ${pctRange(b.x, b.x + b.w)}／垂直 ${pctRange(b.y, b.y + b.h)}`).join("；") : "（這個裝置沒有商品卡蓋在圖上）";
  const bands = (t.bands || []).map((b) => `${b.name}（水平 ${pctRange(b.x1, b.x2)}、垂直 ${pctRange(b.y1, b.y2)}）`);
  const hasBands = bands.length > 0;
  const illustZone = hasBands ? bands.join("；") : null;
  const prodPos = (() => { if (!prods.length) return ""; const cs = prods.map((b) => b.x + b.w / 2); const L = cs.some((c) => c < 38), R = cs.some((c) => c > 62), C = cs.some((c) => c >= 38 && c <= 62); if (L && R && !C) return "左右兩側"; if (L && R && C) return "整排橫列"; return t.productPos || "兩側"; })();
  const layoutNote = `這是${{ desktop: "桌機", tablet: "平板", mobile: "手機" }[device] || device}版：活動文字在畫面${t.textPos || "中段居中"}${prods.length ? `，商品卡在${prodPos}` : ""}${t.marquee ? "，最底部另有一條跑馬文字帶" : ""}；${hasBands ? `插畫該放的位置＝${(t.bands || []).map((b) => b.name).join("、")}` : "文字與商品幾乎佔滿畫面，以材質與漸層為主"}。`;
  return { layoutNote, quietZone, productZone, illustZone, fadePct: t.fadePct, hasBands };
}

/**
 * @param {object} a { layoutId, layoutName, skeleton, pageName, maxKB, scene }
 * @returns {{ markdown, fileName, vars }}
 */
function buildHeroBgKit(a) {
  const layoutId = String(a.layoutId || "");
  if (!HERO_STAGES[layoutId]) throw new Error("這款版式還沒有登記舞台尺寸，做不出說明。（技術：HERO_STAGES 缺鍵 " + layoutId + "）");
  const copy = loadCopy();
  const d = minSizeFor(layoutId, "desktop"), t = minSizeFor(layoutId, "768"), m = minSizeFor(layoutId, "375");
  const vars = {
    layoutName: a.layoutName || "這款版式", skeleton: a.skeleton || "", pageName: a.pageName || "活動頁",
    desktopW: d.w, desktopH: d.h, tabletW: t.w, tabletH: t.h, mobileW: m.w, mobileH: m.h,
    ultraW: ULTRAWIDE_CANVAS.w, ultraH: ULTRAWIDE_CANVAS.h, safeW: ULTRAWIDE_CANVAS.safeW,
    maxKB: Number(a.maxKB) > 0 ? Number(a.maxKB) : 400,
    scene: a.scene || "（把這個括號換成你的場景鎖定句，例：秋日木質餐桌上的自然光靜物場景，暖米色與苔綠色調，柔和漸層，無文字）",
  };
  const f = (s, extra) => fill(s, extra ? { ...vars, ...extra } : vars);
  const DEV = [["desktop", "桌機版", d, "橫幅"], ["tablet", "平板版", t, "橫幅"], ["mobile", "手機版", m, "直幅"]];
  /* 文字做進圖裡的模式（2026-09-27 使用者要測：關掉工作台文字、讓生圖工具寫標題）：跟著草稿的 heroTitleHidden 走；
     帶入這檔的主標／副標原文，放在原本文字會出現的安靜區；真值（時間／折數／價格／網址）仍不得進圖 */
  /* 模式（2026-09-27 使用者回饋）：下載時由對話框選「單純背景圖」或「背景圖＋活動文案」＝mode 明講；沒帶 mode 才退回看開關 */
  const withText = a.mode === "text" ? true : a.mode === "bg" ? false : a.heroTitleHidden === true;
  const tt = heroTitleTexts(layoutId, a.hero);
  let titleBlock = tt.title ? (tt.sub ? f(copy.prompts.titleBlockWithSub, { titleText: tt.title, subText: tt.sub }) : f(copy.prompts.titleBlockTitleOnly, { titleText: tt.title })) : "主標：「（這檔還沒填主標——先到工作台主視覺填好再下載）」";
  if (tt.others && tt.others.length) titleBlock += "；" + tt.others.map((o) => `${o.label}（小字、放主標上方或下方）：「${o.text}」`).join("；");
  const themeIdEarly = String(a.themeId || "").trim();
  const toneWordEarly = /dark|night|黑|暗/i.test(themeIdEarly) ? "暗" : "亮";
  const devPrompt = (device, deviceLabel, size, orient) => {
    const z = deviceZones(layoutId, device);
    const sizeVars = { W: size.w, H: size.h, ratio: ratioOf(size.w, size.h), orient, deviceLabel };
    const sizeLine = f(copy.prompts.sizeLine, sizeVars);
    const fileLine = device === "mobile" ? " " + f(copy.prompts.fileLineMobile, sizeVars) : f(copy.prompts.fileLineOther, sizeVars);
    const fadeLine = z.fadePct != null ? f(copy.prompts.fadeLine, { fadePct: r0(z.fadePct) }) : copy.prompts.fadeLineNone;
    const common = { ...sizeVars, sizeLine, fileLine, fadeLine, layoutNote: z.layoutNote, quietZone: z.quietZone, productZone: z.productZone, illustZone: z.illustZone || copy.prompts.noBand, toneWord: toneWordEarly };
    const text = withText ? f(copy.prompts.deviceWithText, { ...common, titleBlock, extraLines: "", fontHint: a.fontHint || copy.prompts.fontHintDefault }) : f(copy.prompts.device, common);
    return { text, zones: z, deviceLabel };
  };
  const L = [];
  L.push(`# ${f(copy.title)}`, "");
  L.push(`- **給誰看**：${f(copy.threeAnswers.who)}`);
  L.push(`- **看完要做什麼**：${f(copy.threeAnswers.do)}`);
  L.push(`- **別做什麼**：${f(copy.threeAnswers.dont)}`, "");
  L.push("## 一、尺寸（三張各一）", "", f(copy.sizes.intro), "");
  L.push("| 裝置 | 剛好這麼大（像素） | 備註 |", "|---|---|---|");
  for (const r of copy.sizes.rows) L.push(`| ${r.device} | ${f(r.min)} | ${f(r.note)} |`);
  L.push("", f(copy.sizes.formats), "");
  L.push("## 二、這款版式三種裝置的版面", "", f(copy.layoutOverview.intro), "");
  const built = DEV.map(([device, label, size, orient]) => ({ ...devPrompt(device, label, size, orient), size, orient }));
  for (const b of built) L.push(f(copy.layoutOverview.row, { deviceLabel: b.deviceLabel, layoutNote: b.zones.layoutNote }));
  /* 三、對話主控提示詞（2026-09-27 使用者回饋：Gemini 沒有記憶，規格、版面、文案裝進一段；由 Gemini 逐題帶用戶＝主題感→參考圖→字型排版→確認→三裝置連出） */
  const devLabel = { desktop: "桌機版", tablet: "平板版", mobile: "手機版" };
  const deviceSpecs = built.map((b) => f(copy.conversation.deviceSpecLine, { deviceLabel: b.deviceLabel, W: b.size.w, H: b.size.h, orient: b.orient, ratio: ratioOf(b.size.w, b.size.h) })).join("\n");
  const deviceZonesTxt = built.map((b) => f(copy.conversation.deviceZoneBlock, { deviceLabel: b.deviceLabel, layoutNote: b.zones.layoutNote, quietLabel: withText ? copy.conversation.quietLabelText : copy.conversation.quietLabelBg, quietZone: b.zones.quietZone, productZone: b.zones.productZone, illustZone: b.zones.illustZone || copy.prompts.noBand, fadePct: b.zones.fadePct != null ? r0(b.zones.fadePct) : 20 })).join("\n");
  /* 含文字版：原則裡「價格折數不做在圖上」那條改成責任提醒（使用者 2026-09-27 裁：平台不檢查、用戶自負） */
  const principlesTxt = copy.principles.map((p) => (withText && /價格、折數/.test(p.t)) ? `- 價格、折數、活動日期若要寫進圖，自己核對：${f(copy.prompts.textTruthRule)}` : `- ${f(p.t)}：${f(p.d)}`).join("\n");
  const themeLine = a.theme ? `，活動主題／型態＝「${String(a.theme).slice(0, 60)}」` : "";
  /* 亮底／暗底（2026-09-27 使用者回饋）：業務在單機版無法調商品卡與活動文字色，背景明暗要跟配色主題一致——從 page.themeId 判（含 dark＝暗、其餘＝亮） */
  const themeId = String(a.themeId || "").trim();
  const toneWord = /dark|night|黑|暗/i.test(themeId) ? "暗" : "亮";
  const toneLine = themeId && themeId !== "default" ? f(copy.conversation.toneLineKnown, { themeId, toneWord }) : f(copy.conversation.toneLineUnknown, {});
  const master = f(withText ? copy.conversation.master_text : copy.conversation.master_bg, { deviceSpecs, deviceZones: deviceZonesTxt, principles: principlesTxt, titleBlock, pageName: vars.pageName, themeLine, toneLine });
  L.push("", `## 三、${copy.conversation.title}`, "", f(copy.prompts.modeHeader[withText ? "text" : "bg"]), "", f(copy.conversation.intro), "", "```", master, "```", "", `> ${f(copy.conversation.resume)}`, `> ${f(copy.conversation.wrongModel)}` /* 2026-09-30 使用者過目：Flash＝文字模型不生圖，換回預設模型即可，不必去別的工具（病例＝當日親測，模型選單掉在 Flash 被請去 Midjourney） */);
  L.push("", `## 三之二、${copy.conversation.fallbackTitle}`, "", f(copy.prompts.intro), "", `> ${f(copy.prompts.sceneLockHint)}`);
  if (withText) {
    /* 使用者 2026-09-27 裁（主線轉達）：用 Gemini 寫文案＝提示詞包要引導用戶把文案完成；內容平台不檢查、責任歸用戶——提醒不是禁令 */
    L.push("", `### ${copy.textFlow.title}`, "", f(copy.textFlow.intro), "");
    for (const st of copy.textFlow.steps) L.push(f(st, { titleBlock, truthReminder: f(copy.prompts.textTruthRule), sceneLockHint: f(copy.prompts.sceneLockHint), textCaveat: f(copy.prompts.textCaveat) }));
  }
  L.push("");
  for (const b of built) L.push(`### ${b.deviceLabel}`, "", "```", b.text, "```", "");
  L.push("### 已經有一張、想補齊另兩張", "", f(copy.prompts.fixup), "");
  L.push(`## 四、${copy.prompts.designerBrief.title}`, "");
  for (const line of copy.prompts.designerBrief.lines) L.push(`- ${f(line)}`);
  L.push("", "## 五、做背景時要留意的原則", "");
  for (const p of copy.principles) L.push(`- **${f(p.t)}**：${f(p.d)}`);
  L.push("", "## 六、上傳之後系統會做什麼", "");
  for (const s of copy.afterUpload) L.push(`- ${f(s)}`);
  L.push("");
  const markdown = L.join("\n");
  const fileName = `背景製作說明-${String(vars.pageName).replace(/[\\/:*?"<>|]+/g, "-").slice(0, 40)}.md`;
  return { markdown, fileName, vars, withText, titleTexts: tt, zones: Object.fromEntries(built.map((b) => [b.deviceLabel, b.zones])) };
}

module.exports = { buildHeroBgKit, loadCopy, loadTables, deviceZones, ratioOf, heroTitleTexts };
