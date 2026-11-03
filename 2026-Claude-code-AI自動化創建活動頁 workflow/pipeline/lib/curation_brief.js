"use strict";
/**
 * lib/curation_brief.js —— 策展劇本（內容策略文件）解析器
 * 格式真源＝lib/curation_brief_format.js（段落、禁收規則、樓層上限）。本檔只負責「讀得懂人寫的東西」。
 *
 * 設計原則（2026-09-11 使用者裁決後定）
 * ----------------------------------------------------------------
 * 1. **容錯照「人」的變異做，不是照 AI 的。** Gemini 照指令很聽話，但真人會寫「第一層」、會忘記破折號、
 *    會把三行寫成一行、會多空一行、會用全形井號。這些都要吃得下。
 * 2. **吃不下的時候要講清楚是哪一段、怎麼修**，不能只說「格式錯誤」——那等於把問題丟回給使用者。
 * 3. **沒填的段落回落機械預設，而且要記得是誰填的**（71 號 §4.4）：`provenance` 逐段標 brief／missing，
 *    畫面才講得出「這句是你文件給的、那句是系統填的」。不靜默降級＝鐵律 3。
 * 4. **真值一律擋下出聲，不是忽略**（71 號 §4.2）：擋的時候要講出是哪一種真值、為什麼不能寫。
 * 5. **收得下但還不會生效的段落要明說**：解析得出來但沒人消費的就標 `consumed:false`，不假裝它會影響什麼。
 *    2026-09-14 起「選品方向」真的接上了（lib/brief_selection.js，快速草稿路）；AI 策展路不讀＝畫面講明（裁 3 乙）。
 *    「優先」那一行退場（裁 2 乙）——寫了照樣認得、只為了出聲說它不生效。
 *
 * 回傳形狀
 * ----------------------------------------------------------------
 *   { ok, data, provenance, errors[], notices[] }
 *     errors ＝擋下的理由（有 error 就 ok:false，不進頁面）
 *     notices＝照做了但使用者該知道的事（超過樓層上限、認不得的標題、選品還沒接上…）
 *   兩者都帶 { section, say, how }，say 是白話、how 是「怎麼修」。
 */
const FMT = require("./curation_brief_format.js");

/* 標題行：吃 #／##／＃、前後空白、結尾冒號或全形冒號 */
const HEADING_RE = /^\s*[#＃]{1,3}\s*(.+?)\s*[:：]?\s*$/;
/* 樓層行前綴：1. / 1、/ 1) / １． / 第一層： / 一、 / - / ・ */
const FLOOR_PREFIX_RE = /^\s*(?:[-*・]|第\s*[一二三四五六七八九十\d]+\s*[層樓]?\s*[：:、.]?|[一二三四五六七八九十]+\s*[、.：:]|[0-9０-９]+\s*[).、．：:]）?)\s*/;
/* 樓層標題與說明的分隔：——／—／–／-／：／: （前後可有空白） */
const FLOOR_SPLIT_RE = /\s*(?:——|—|–|--|-|：|:)\s*/;
/* 選品三標籤的別名（人會寫「多放」「多一點」「加強」…；只認明確的那幾種，認不得就保留原文） */
const SELECTION_LABELS = [
  { key: "include", re: /^(?:多放|多一點|加強|想放|要放)\s*[：:]\s*(.*)$/ },
  { key: "exclude", re: /^(?:避開|排除|不要|不放)\s*[：:]\s*(.*)$/ },
  { key: "priority", re: /^(?:優先|優先順序|排序)\s*[：:]\s*(.*)$/ },
];

const norm = (s) => String(s == null ? "" : s).replace(/[\s　]/g, "").replace(/[，,。．.、]/g, "");

/* 把整份文件切成「標題 → 內容行」。註解行（<!-- -->）與前後空白一律丟掉。 */
function splitSections(text) {
  const out = [];
  let cur = null;
  for (const raw of String(text == null ? "" : text).split(/\r?\n/)) {
    const line = raw.replace(/\t/g, "  ");
    if (/^\s*<!--/.test(line) || /-->\s*$/.test(line)) continue;
    /* 引號行（>）＝範本裡寫給人看的引導句，不是內容。2026-09-11 拿自己的範本跑才發現：
       不濾掉的話，「一層一行，寫『樓層標題 —— 這一層放什麼』。」會被當成第一層樓。
       靜默略過是對的——那些句子本來就是說明書，每次還提醒一次只會變噪音。 */
    if (/^\s*[>＞]/.test(line)) continue;
    const m = line.match(HEADING_RE);
    if (m && m[1]) { cur = { heading: m[1], lines: [] }; out.push(cur); continue; }
    if (cur) cur.lines.push(line);
  }
  return out;
}

/* 標題比對：先逐字，再去空白標點比，最後才用關鍵字近似（近似會出聲，讓人知道我們猜了） */
function matchSection(heading) {
  const defs = FMT.sections();
  const exact = defs.find((d) => d.heading === heading);
  if (exact) return { def: exact, how: "exact" };
  const n = norm(heading);
  const loose = defs.find((d) => norm(d.heading) === n);
  if (loose) return { def: loose, how: "loose" };
  const near = defs.find((d) => n && (n.includes(norm(d.heading)) || norm(d.heading).includes(n)));
  if (near) return { def: near, how: "near" };
  return { def: null, how: "none" };
}

function parseFloors(lines) {
  const rows = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    const body = line.replace(FLOOR_PREFIX_RE, "").trim();
    if (!body) continue;
    /* v2（2026-09-14）：標題 —— 放什麼（機器挑用）—— 短賣點（消費者看）—— 小標籤（可選）；v1 兩段照樣讀（少的段回機器預設） */
    const parts = body.split(FLOOR_SPLIT_RE).map((x) => x.trim()).filter(Boolean);
    rows.push({ title: parts[0] || "", hint: parts[1] || "", pitch: parts[2] || "", tag: parts[3] || "", extra: parts.length > 4 });
  }
  return rows;
}

function parseSelection(lines) {
  const picked = { include: "", exclude: "", priority: "" };
  const leftovers = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    const hit = SELECTION_LABELS.find((l) => l.re.test(line));
    if (hit) { picked[hit.key] = (line.match(hit.re)[1] || "").trim(); continue; }
    leftovers.push(line);
  }
  return { ...picked, raw: leftovers.join("\n") };
}

/* 第一行（# 之前）：「這檔是哪一種活動：○○｜活動主題：○○」（2026-09-15 C 批；Gemini 指令同日改成先問型態寫在第一行）。
   容錯照人的變異：全形／半形冒號、｜或 |、只寫其中一項、型態寫卡名／舊卡名／資料鍵都認；認不得＝scenarioLabel 原文留著、scenario 為 null（介面會講「沒寫型態」）。
   舊檔（沒有第一行）＝兩欄 null，照舊能用。這一段解析器原本就忽略，所以加了不會多出任何 notice。 */
function parsePreamble(text) {
  const out = { scenario: null, scenarioLabel: "", theme: "" };
  const lines = String(text == null ? "" : text).split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || /^\s*<!--/.test(line) || /-->\s*$/.test(line)) continue;
    if (/^#/.test(line)) break; // 第一個標題＝前言結束
    const mS = line.match(/這檔是哪一種活動\s*[:：]\s*([^｜|]+)/);
    const mT = line.match(/活動主題\s*[:：]\s*([^｜|]+)/);
    if (mS) { out.scenarioLabel = mS[1].trim(); const hit = SCEN.resolve(out.scenarioLabel); out.scenario = hit ? hit.value : null; }
    if (mT) out.theme = mT[1].trim();
    if (mS || mT) break; // 只認第一句
  }
  return out;
}

function parseBrief(text) {
  const errors = [];
  const notices = [];
  const data = {};
  const provenance = {};
  const defs = FMT.sections();
  Object.assign(data, parsePreamble(text)); // scenario／scenarioLabel／theme 三欄：null／空＝沒寫

  const blocks = splitSections(text);
  if (!blocks.length) {
    errors.push({
      section: null,
      say: "這份檔案裡找不到任何段落標題，工具讀不出要把內容放到哪裡。",
      how: `請確認檔案裡有「# ${defs[0].heading}」這種以 # 開頭的標題行——可以從內建範本複製一份來改。`,
    });
    return { ok: false, data, provenance, errors, notices };
  }

  /* 真值禁收：整份掃，並指出落在哪一段（指得出位置，人才改得動） */
  for (const b of blocks) {
    const body = b.lines.join("\n");
    for (const p of FMT.bannedPatterns()) {
      const m = body.match(p.re);
      if (!m) continue;
      errors.push({ section: b.heading, say: `「${b.heading}」裡有${p.name}（${m[0].trim()}）。${p.say}`, how: `把那段文字拿掉再存一次。` });
    }
  }

  const seen = new Set();
  for (const b of blocks) {
    const { def, how } = matchSection(b.heading);
    if (!def) {
      notices.push({ section: b.heading, say: `「${b.heading}」不是工具認得的段落，這一段的內容不會被用到。`, how: `認得的段落有：${FMT.headings().join("、")}。` });
      continue;
    }
    if (seen.has(def.key)) {
      notices.push({ section: b.heading, say: `「${def.heading}」出現了兩次，工具只採用第一次那份。`, how: "把重複的段落刪掉，或合併成一段。" });
      continue;
    }
    seen.add(def.key);
    if (how !== "exact") {
      notices.push({ section: b.heading, say: `「${b.heading}」我當成「${def.heading}」來讀。`, how: `標題建議照原樣寫「# ${def.heading}」，比較不會被認錯。` });
    }
    const body = b.lines.join("\n").trim();
    if (!body) { provenance[def.key] = "missing"; continue; }

    if (def.key === "floors") {
      const rows = parseFloors(b.lines);
      const max = FMT.floorMax();
      if (rows.length > max) {
        notices.push({
          section: def.heading,
          say: `你寫了 ${rows.length} 層，這個版面最多放 ${max} 層——我先用前 ${max} 層。`,
          how: "想換哪幾層上場，改一下順序再存，或到編修頁調整。",
        });
      }
      data.floors = rows.slice(0, max);
      const noHint = data.floors.filter((r) => !r.hint).length;
      if (noHint) notices.push({ section: def.heading, say: `有 ${noHint} 層只寫了標題、沒寫「這一層放什麼」。`, how: "在標題後面加「 —— 放什麼」，選品時會更貼近你的想法。" });
      const noPitch = data.floors.filter((r) => r.hint && !r.pitch).length;
      if (noPitch) notices.push({ section: def.heading, say: `有 ${noPitch} 層沒寫短賣點——情境卡的小標籤會用系統預設。`, how: "在「放什麼」後面再加「 —— 一句短賣點」（8 字內），例：—— 沒有它就不能開烤。" });
      const longPitch = data.floors.filter((r) => r.pitch && [...r.pitch].length > 8).length;
      if (longPitch) notices.push({ section: def.heading, say: `有 ${longPitch} 層的短賣點超過 8 個字——情境卡的小標籤很短，超過的部分可能顯示不完整。`, how: "把它改短，8 字內最穩。" });
      const longTag = data.floors.filter((r) => r.tag && [...r.tag].length > 2).length;
      if (longTag) notices.push({ section: def.heading, say: `有 ${longTag} 層的第四段（小標籤）超過 2 個字——那顆標籤只放得下兩個字。`, how: "改成兩個字，例：必備、加分、收尾。" });
      if (rows.some((r) => r.extra)) notices.push({ section: def.heading, say: "有樓層分了超過四段，我只認前四段（標題／放什麼／短賣點／小標籤）。", how: "多出來的破折號或冒號拿掉。" });
    } else if (def.key === "selection") {
      data.selection = parseSelection(b.lines);
      if (!data.selection.include && !data.selection.exclude && !data.selection.priority) {
        notices.push({ section: def.heading, say: "這一段我讀得到字，但沒認出「多放／避開」兩行，所以只能原樣收著。", how: "分成兩行寫，例如「多放：3C、家電」「避開：洋裝、裙」。" });
      }
      /* 「優先」退場（2026-09-14 使用者裁 2 乙）：商品資料沒有銷量／評價／上架時間，排序只有折數一種——
         留這一行等於一顆只有一個合法值的旋鈕。認得它是為了出聲，不是為了照做；AI 策展路沒有選品帳也聽得到這句。 */
      if (data.selection.priority) {
        notices.push({ section: def.heading, say: `「優先：${data.selection.priority}」這行目前不會生效——排序一律折數深的先（商品資料沒有銷量或評價可以照做）。`, how: "把這行拿掉就好。" });
      }
    } else if (def.key === "title") {
      data.title = body.split(/\n/).map((x) => x.trim()).filter(Boolean);
    } else if (def.key === "walls") {
      /* 牆標題：一面一行、可帶「1.」「-」這類前綴（人會這樣寫）；超過牆數上限＝先用前幾面、出聲 */
      const rows = b.lines.map((l) => l.trim().replace(FLOOR_PREFIX_RE, "").trim()).filter(Boolean)
        .map((line) => { const parts = line.split(FLOOR_SPLIT_RE).map((x) => x.trim()).filter(Boolean); return { title: parts[0] || "", hint: parts[1] || "" }; }); // v2.1（2026-09-14 下午）：牆也寫「標題 —— 放什麼」，跟樓層同一套
      const max = FMT.wallMax();
      if (rows.length > max) notices.push({ section: def.heading, say: `你寫了 ${rows.length} 面牆的標題，這個版面最多 ${max} 面——我先用前 ${max} 個。`, how: "想換哪幾個上場，改一下順序再存。" });
      data.walls = rows.slice(0, max);
      const noHint = data.walls.filter((w) => !w.hint).length;
      if (noHint) notices.push({ section: def.heading, say: `有 ${noHint} 面牆只寫了標題、沒寫放什麼——那面牆的商品會照順序排，標題只在整批商品跟策略檔對得上時才掛上去。`, how: "在標題後面加「 —— 放什麼」（例：—— 烤肉醬、醬油），牆裡就會是那些東西。" });
    } else if (def.key === "editorial") {
      const rows = body.split(/\n/).map((x) => x.trim()).filter(Boolean);
      if (rows.length > 3) notices.push({ section: def.heading, say: `編輯精選那一塊最多三行，你寫了 ${rows.length} 行——我先用前三行。`, how: "把它收成三行內。" });
      data.editorial = rows.slice(0, 3);
    } else if (def.key === "eyebrow") {
      const rows = body.split(/\n/).map((x) => x.trim()).filter(Boolean);
      if (rows.length > 1) notices.push({ section: def.heading, say: "主標上面那行小字只有一行的位置，我只用第一行。", how: "把它收成一行。" });
      data.eyebrow = rows[0] || "";
    } else {
      data[def.key] = body;
    }
    provenance[def.key] = "brief";
  }

  /* 沒出現過的段落＝回落機械預設，逐段記帳（畫面要講得出哪些是系統填的） */
  for (const d of defs) {
    if (provenance[d.key]) continue;
    provenance[d.key] = "missing";
    if (d.required) {
      errors.push({
        section: d.heading,
        say: `少了「${d.heading}」這一段，而它是必填的——沒有它，後面每一段的文案會各寫各的。`,
        how: `在檔案裡加一行「# ${d.heading}」，底下寫一兩句這檔要賣給誰、主打什麼。`,
      });
    }
  }

  return { ok: errors.length === 0, data, provenance, errors, notices };
}


/* ---------- 落地：把讀懂的劇本寫進草稿 ----------
   只動兩種東西：主視覺主標、既有樓層的標題與說明。刻意不做的事，每一條都有理由：

   - **不新增也不刪除樓層**：樓層帶商品綁定與件數契約，增刪要走 content_modules 的既有通道，
     不是這裡塞一塊資料就算數。劇本寫得比草稿多或少，都只對得上的部分生效，其餘出聲。
   - **一根寒毛都不碰真值**：products[]、價格、連結、檔期、賣場編號全程不讀不寫。
     劇本本來就禁收這些（格式層擋），這裡是第二道——結構上不可能，不是靠檢查。
   - **不動 titleSource**：04 號 §3 把它定稿成 promo-truth／ai-curated 兩種值，而且 U19
     「標題與內容同型」的規則綁著它。劇本來源記在 meta.brief，不去擴充別人的定稿契約。

   來源記帳寫進 `draft.meta.brief`（沿 meta.layoutChoice 前例）：畫面才講得出
   「這句是你文件給的、那句是系統填的」（71 號 §4.4 誠實原則）。 */
const FOLD = String.fromCharCode(0x2028); // 格內折行記號；不在原始碼寫成真字元（會被當換行）

function applyBriefToDraft(draft, parsed, opts = {}) {
  const notes = [];
  if (!draft || typeof draft !== "object") throw new Error("草稿讀不到，劇本沒有套用——請重新整理頁面再試。（技術：applyBriefToDraft 收到非物件）");
  if (!parsed || !parsed.ok) throw new Error("這份劇本還沒通過檢查，不會套用——請先照畫面上的提醒修好。（技術：parsed.ok 非真）");
  const page = draft.page || (draft.page = {});
  const data = parsed.data || {};
  const applied = [];
  const selRep = (draft.meta && draft.meta.briefSelection) || null; // 選品帳（curate_auto 寫）：每層／每面牆對到幾件——人寫的標題只掛在對得上的模組上
  /* 頁級對不對得上先算（71 號方案 A 階段一）：下面的樓層／牆／編輯精選都要看它——對不上的來源，人寫的標題不能掛在機器排的商品上。
     呼叫端給商品池名單（snapshot，不是已選品）與門檻（feedback_patch）；沒給名單＝不算（不是「對得上」，是「沒得比」）。 */
  let fit = null;
  if (Array.isArray(opts.productNames) && opts.productNames.length) fit = briefFit(data, opts.productNames, { threshold: opts.fitThreshold });
  const fitLow = !!(fit && fit.low);
  /* 人寫的標題掛不掛（2026-09-14 使用者實走：收尾清潔底下一排計時器、醬料與調味底下是計時器）：
     有寫「放什麼」＝看這一組有沒有對到（帳裡 zeroHit＝不掛）；沒寫＝看整批對不對得上（fitLow＝不掛）；沒有帳（AI 策展路）＝照套、無從判斷。 */
  const mayApply = (rep, hasWords) => {
    if (rep && !rep.machine && rep.zeroHit) return false;
    if (!hasWords && fitLow) return false;
    return true;
  };

  /* 主標＝這款版式「主標」那一格（段位由主視覺文字段落表決定，每款不同；010 上下行兩格）。段與段用換行分隔、段內折行用 U+2028（既有契約，勿改）。
     只換主標那一段，其餘段（膠囊、年份帶、限時貼紙、跑馬帶…）原樣保留——那些劇本管不到。
     2026-09-24 病例 run 174314：原本寫死 hero["slogan-left"]，而 001／002／003／005／006／007 的主標格是 title-center＝六款版式人寫的主標從沒上過畫面，
     畫面留著建立期預填的活動內部名稱。眉標那段一直是照段落表找格子的，主標卻寫死＝一條規則兩道門。現在主標、眉標同一把尺（layout_choice.titleSlotFor）。
     舊殼（非 layout-*）＝主標住 kv.titleLine1/2，這裡照舊也寫 slogan-left（既有契約）。
     kv.titleLine1/2 兩行有的話一起同步（分頁標題／換版式對映／舊殼主視覺都讀它）——兩份複本一起改，沿樓層標題 title／sceneCopy.title 的慣例。 */
  if (Array.isArray(data.title) && data.title.length) {
    const hero = page.hero || (page.hero = {});
    const layout = String(page.kvVariant || "");
    let placedTitle = false;
    if (/^layout-/.test(layout)) {
      const w = LAYOUT.writeTitleIntoSlot(layout, hero[LAYOUT.titleSlotFor(layout) ? LAYOUT.titleSlotFor(layout).slot : ""], data.title);
      if (w) { hero[w.slot] = w.value; placedTitle = true; }
      else notes.push({ section: "主標", say: "這款版型的主視覺找不到主標的位置，主標沒有套用。", how: "換一款版型，或在編修頁直接改主視覺文字。" });
    } else {
      const slot = typeof hero["title-center"] === "string" && typeof hero["slogan-left"] !== "string" ? "title-center" : "slogan-left";
      const segs = typeof hero[slot] === "string" ? hero[slot].split("\n") : [];
      segs[0] = data.title.join(FOLD);
      hero[slot] = segs.join("\n");
      placedTitle = true;
    }
    if (placedTitle) {
      const kv = page.kv;
      if (kv && typeof kv === "object" && (typeof kv.titleLine1 === "string" || typeof kv.titleLine2 === "string")) {
        kv.titleLine1 = String(data.title[0] || "");
        kv.titleLine2 = data.title.slice(1).join("");
      }
      applied.push("title");
    }
  }

  /* 對不到的層／牆＝標題照底下實際商品補（2026-09-24 使用者裁「機器照商品自動補標題＋可一鍵換」）：
     以前零命中的層留著機器預設「質感首選」配一排尿片＝不是人的字、也跟商品無關。現在取這一組真的分到的商品名
     （樓層＝商品卡＋情境卡代表品；牆＝商品卡），擷取品類詞當標題（只擷取商品名裡的字、不生成句子），
     帳記 meta.brief.autoTitles（編修頁那格旁邊掛徽章＋候選字一鍵換）並掛回選品帳（selectionNotices 講得出補了什麼）。
     一個字都擷不出（沒商品名可讀）＝維持機器預設、照舊出聲。 */
  const prodByGdid = new Map((Array.isArray(draft.products) ? draft.products : []).filter((p) => p && p.gdid != null).map((p) => [String(p.gdid), p]));
  const namesOf = (gdids, positions) => {
    const out = [], seen = new Set();
    for (const g of gdids || []) { const p = prodByGdid.get(String(g)); if (p && p.name && !seen.has(String(p.gdid))) { seen.add(String(p.gdid)); out.push(p.name); } }
    for (const p of prodByGdid.values()) if (positions.includes(p.position) && p.name && !seen.has(String(p.gdid))) { seen.add(String(p.gdid)); out.push(p.name); }
    return out;
  };
  const autoTitles = [];
  const autoTitleFor = (kind, i, node, wanted, words, rep) => {
    if (!node || typeof node !== "object") return null;
    const names = kind === "floor" ? namesOf(node.productGdids, [`featured-${i + 1}`, `featured-${i + 1}-scene`]) : namesOf(node.productGdids, [`category-${i + 1}`]);
    const cands = SEL.categoryWords(names, { max: 3 });
    if (!cands.length) return null;
    node.title = cands[0];
    if (kind === "floor" && node.sceneCopy && typeof node.sceneCopy === "object") node.sceneCopy.title = cands[0];
    autoTitles.push({ kind, index: i, title: cands[0], candidates: cands, wanted: wanted || "", words: words || [] });
    if (rep) rep.autoTitle = cands[0];
    return cands[0];
  };

  /* 樓層：只改對得上的那幾層的標題與說明。畫面上樓層標題有兩份複本（floor.title 與
     floor.sceneCopy.title），只改一份＝預覽跟實際不一致，兩份一起改。 */
  if (Array.isArray(data.floors) && data.floors.length) {
    const floors = Array.isArray(page.floors) ? page.floors : [];
    if (!floors.length) {
      notes.push({ section: "分幾層、各層講什麼", say: "這個活動目前還沒有樓層，劇本裡的分層先收著沒有套用。", how: "等策展跑完有樓層之後，重新套用一次劇本。" });
    } else {
      const n = Math.min(floors.length, data.floors.length);
      let anyFloor = false;
      for (let i = 0; i < n; i++) {
        const f = floors[i], b = data.floors[i];
        const rep = selRep && Array.isArray(selRep.floors) ? selRep.floors[i] : null;
        if (!mayApply(rep, !!SEL.splitWords(b.hint).length)) {
          const auto = autoTitleFor("floor", i, f, b.title, SEL.splitWords(b.hint), rep && !rep.machine ? rep : null);
          /* 零命中的那一句由 selectionNotices 講（有帳、會講補成了什麼）；沒寫放什麼又整批對不上＝這裡講 */
          if (!(rep && !rep.machine && rep.zeroHit)) notes.push({ section: "分幾層、各層講什麼", say: auto
            ? `「${b.title || `第 ${i + 1} 層`}」這層沒寫放什麼，而這批商品跟策略檔對不太上——標題先照底下實際商品改成「${auto}」（系統照商品補的，樓層那格旁邊可以一鍵換）。`
            : `「${b.title || `第 ${i + 1} 層`}」這層沒寫放什麼，而這批商品跟策略檔對不太上——標題先用系統預設，免得標題跟商品各說各話。`, how: "加上「 —— 放什麼」讓機器照字挑，或換一個對得上的來源。" });
          continue;
        }
        anyFloor = true;
        if (b.title) { f.title = b.title; if (f.sceneCopy && typeof f.sceneCopy === "object") f.sceneCopy.title = b.title; }
        /* v2（2026-09-14 實走更正）：「放什麼」是給機器挑商品的字、不上畫面；情境卡小標籤放的是短賣點（第三段）。
           v1 舊檔沒有第三段＝小標籤維持機器預設，不再把品類詞灌進去。 */
        if (b.pitch) { f.subtitle = b.pitch; if (f.sceneCopy && typeof f.sceneCopy === "object") f.sceneCopy.sub = b.pitch; }
        if (b.tag && f.sceneCopy && typeof f.sceneCopy === "object") f.sceneCopy.tag = b.tag;
      }
      if (anyFloor) applied.push("floors");
      if (data.floors.length > floors.length) {
        notes.push({ section: "分幾層、各層講什麼", say: `劇本寫了 ${data.floors.length} 層，這個活動只有 ${floors.length} 層，多的沒有套用。`, how: "要增減樓層請在編修頁的頁面組成區操作——那裡會一起處理商品。" });
      } else if (data.floors.length < floors.length) {
        notes.push({ section: "分幾層、各層講什麼", say: `劇本寫了 ${data.floors.length} 層，這個活動有 ${floors.length} 層，沒對到的那幾層維持原本的標題。`, how: "想一起換掉，在劇本裡補齊那幾層再套用一次。" });
      }
    }
  }

  /* 牆標題（v2，牆 Q4 甲）：只改對得上的那幾面；牆裡的商品照機器排，不動 */
  if (Array.isArray(data.walls) && data.walls.length) {
    const walls = Array.isArray(page.walls) ? page.walls : [];
    if (!walls.length) notes.push({ section: "三面牆的標題", say: "這個活動目前沒有商品牆（商品不夠排），牆標題先收著沒有套用。", how: "換一個商品多一點的來源，或之後再套用一次。" });
    else {
      const n = Math.min(walls.length, data.walls.length);
      let anyWall = false;
      for (let i = 0; i < n; i++) {
        const b = data.walls[i] || {};
        const rep = selRep && Array.isArray(selRep.walls) ? selRep.walls[i] : null;
        if (!b.title) continue;
        if (!mayApply(rep, !!SEL.splitWords(b.hint).length)) {
          const auto = autoTitleFor("wall", i, walls[i], b.title, SEL.splitWords(b.hint), rep && !rep.machine ? rep : null);
          if (!(rep && !rep.machine && rep.zeroHit)) notes.push({ section: "三面牆的標題", say: auto
            ? `「${b.title}」這面牆沒寫放什麼，而這批商品跟策略檔對不太上——標題先照底下實際商品改成「${auto}」（系統照商品補的，牆標題那格旁邊可以一鍵換）。`
            : `「${b.title}」這面牆沒寫放什麼，而這批商品跟策略檔對不太上——標題先用系統預設。`, how: "加上「 —— 放什麼」讓機器照字挑，或換一個對得上的來源。" });
          continue;
        }
        walls[i].title = b.title; anyWall = true;
      }
      if (anyWall) applied.push("walls");
      if (data.walls.length > walls.length) notes.push({ section: "三面牆的標題", say: `你寫了 ${data.walls.length} 面牆的標題，這個活動只有 ${walls.length} 面，多的沒有套用。`, how: "" });
      else if (data.walls.length < walls.length) notes.push({ section: "三面牆的標題", say: `你寫了 ${data.walls.length} 面牆的標題，這個活動有 ${walls.length} 面，沒對到的那幾面維持系統標題。`, how: "想一起換掉，補齊那幾行再套用一次。" });
    }
  }

  /* 編輯精選那一句（v2）：只換人寫的那幾行，其餘行維持機器預設；這檔沒有編輯精選區（商品不夠）＝出聲不套 */
  if (Array.isArray(data.editorial) && data.editorial.length) {
    const ed = page.editorial;
    if (!ed || !Array.isArray(ed.title)) notes.push({ section: "編輯精選那一句", say: "這個活動商品不夠、沒有編輯精選區，那一句先收著沒有套用。", how: "換一個商品多一點的來源就會有。" });
    else if (fitLow) notes.push({ section: "編輯精選那一句", say: "策略檔跟這批商品對不太上，「編輯精選那一句」先用系統預設——它放的是剩下的商品，沒得比。", how: "換一個對得上的來源，這一句就會掛上去。" }); // 2026-09-14 使用者實走：「中秋烤肉一次備齊」底下是鈦水壺與甜點叉
    else {
      const t = ed.title.slice();
      data.editorial.forEach((line, i) => { t[i] = line; });
      ed.title = t.slice(0, 3);
      applied.push("editorial");
    }
  }

  /* 主標上面那行小字（v2）：寫進這款版型「眉標」或「品牌帶」那一段（段位由主視覺文字段落表決定，每款不同）＋舊殼的 kv.eyebrowZh。
     沒有那一段的版型＝出聲不套，不硬塞進別的段。 */
  if (data.eyebrow) {
    const kv = page.kv || (page.kv = {});
    kv.eyebrowZh = data.eyebrow;
    const layout = String(page.kvVariant || "");
    const pieces = /^layout-/.test(layout) ? (LAYOUT.HERO_TEXT_PIECES[layout] || null) : null;
    let placed = !/^layout-/.test(layout); // 舊殼＝kv.eyebrowZh 就是眉標
    if (pieces) {
      let best = null;
      for (const [slot, labels] of Object.entries(pieces)) {
        labels.forEach((lb, i) => {
          if (!lb) return;
          const score = /眉標（中文行）/.test(lb) ? 3 : (/^眉標/.test(lb) && !/英文行/.test(lb)) ? 2 : /品牌帶/.test(lb) ? 1 : 0;
          if (score && (!best || score > best.score)) best = { slot, i, score };
        });
      }
      if (best) {
        const hero = page.hero || (page.hero = {});
        const segs = typeof hero[best.slot] === "string" ? hero[best.slot].split("\n") : [];
        while (segs.length <= best.i) segs.push("");
        segs[best.i] = data.eyebrow;
        hero[best.slot] = segs.join("\n");
        placed = true;
      }
    }
    if (placed) applied.push("eyebrow");
    else notes.push({ section: "主標上面那行小字", say: "這款版型的主視覺沒有小字的位置，那一行沒有套用。", how: "換一款有眉標的版型，或就讓主標自己撐。" });
  }

  /* 選品（71 號階段二，2026-09-14）：帳由 curate_auto 寫在 meta.briefSelection，這裡只折成人話、不重算。
     有帳＝快速草稿路（或 AI 逾時降級路）真的照策略檔挑過；沒帳但策略檔寫了多放／避開＝走的是 AI 策展路（裁 3 乙不接），要講明沒生效。 */
  const meta = draft.meta || (draft.meta = {});
  const sel = data.selection || {};
  const selWritten = !!(String(sel.include || "").trim() || String(sel.exclude || "").trim());
  if (selRep) {
    const effective = (selRep.exclude && selRep.exclude.removed > 0) || (selRep.include && selRep.include.boosted > 0) || (selRep.floors || []).some((f) => f && f.matched > 0);
    if (effective) applied.push("selection");
    notes.push(...SEL.selectionNotices(selRep));
  } else if (selWritten) {
    notes.push({ section: "選品方向", say: "AI 策展這條路目前不讀選品方向——「多放／避開」這次沒有生效。", how: "要照選品方向挑商品，建立時選「快速草稿」。" });
  }

  /* 頁級對不對得上（71 號方案 A 階段一接線，2026-09-14）：呼叫端給商品池名單（snapshot，不是已選品）與門檻（feedback_patch），
     低於門檻才出聲（文案＝牆第 5 題①，使用者過目版）。沒給名單＝不算（不是「對得上」，是「沒得比」，不假裝）。 */
  if (fitLow) {
    /* 頁級的話排最前面（先講整批對不對得上，再講哪一層補了幾件）——走查截圖抓到它排在最後、讀起來像附註 */
    notes.unshift({ section: null, say: `策略檔寫的東西跟這批商品對不太上——你寫的字在 ${fit.total} 件商品名裡只出現在 ${fit.hit} 件。`, how: "先看一眼每層標題跟底下的商品合不合；不合，換來源或把標題改成這批商品的品類。" });
  }

  if (autoTitles.length) applied.push("autoTitles");
  meta.brief = {
    file: opts.file || "",
    version: FMT.BRIEF_VERSION,
    appliedAt: new Date().toISOString(),
    applied,                       // 真的寫進畫面的段落（title／floors／selection／autoTitles）
    autoTitles,                    // 對不到的層／牆照商品補的標題（2026-09-24）：{kind, index, title, candidates, wanted, words}＝編修頁徽章與一鍵換的真源
    provenance: parsed.provenance, // 逐段 brief／missing＝畫面標示的依據
    fit: fit ? { hit: fit.hit, total: fit.total, ratio: fit.ratio, threshold: fit.threshold, low: fit.low } : null,
    notices: [...(parsed.notices || []), ...notes].map((x) => ({ section: x.section, say: x.say, how: x.how || "" })),
  };
  return { changed: applied.length > 0, applied, notes };
}

/* ---------- 策略檔跟這批商品對不對得上（71 號方案 A 階段一，2026-09-11 使用者裁「走方案A，分兩階段」） ----------
   病例：策略檔寫中秋烤肉、來源網址是計時器品類，樓層標題照落、商品照機器挑，消費者看到「收尾清潔」底下一排計時器——
   26 項把關一路無聲通過（CP-14 的詞組含來源頁詞，所以來源自己跟自己一定對得上）。
   這裡只做「提早出聲」：算策略檔的詞在商品名裡出現的比例，低於門檻就記一則提醒；**不擋、不改選品**（改選品＝階段二）。
   量法沿 gate.js 主題契合閘同一把尺：商品名含任一關鍵詞＝命中；命中件數／總件數 vs 門檻（門檻由呼叫端傳 feedback_patch 的 themeFitRule.threshold，
   沒有就 0.3＝CP-14 預設）。切詞＝lib/theme_keywords（與 CP-14 同一把刀）。
   取哪些字：主標、樓層標題與「放什麼」提示、選品「多放／優先」——不取「避開」（那是不要的東西）、不取「這檔活動在講什麼」（對象與場合的字通常不會出現在商品名）。 */
const { deriveThemeKeywords } = require("./theme_keywords");
const SEL = require("./brief_selection"); // 「名字含不含這個字」那一句與選品帳折句——挑選（整詞）與 fit（兩字詞）切法不同、比對同一句
const LAYOUT = require("./layout_choice");
const SCEN = require("./scenario_names"); // 五型態名冊（第一行型態認法唯一真源，2026-09-15） // 主視覚文字段落表 HERO_TEXT_PIECES＝眉標落哪一段的唯一真源（每款不同；layout_choice 不反向 require 本檔）
const FIT_DEFAULT_THRESHOLD = 0.3;
function briefFit(data, productNames, opts) {
  const o = opts || {};
  const threshold = Number.isFinite(o.threshold) ? o.threshold : FIT_DEFAULT_THRESHOLD;
  const d = data || {};
  const texts = [];
  for (const t of [].concat(d.title || [])) texts.push(t);
  for (const f of [].concat(d.floors || [])) { if (f && f.title) texts.push(f.title); if (f && f.hint) texts.push(f.hint); }
  const sel = d.selection || {};
  for (const t of [].concat(sel.include || [], sel.priority || [])) texts.push(t);
  const keywords = [...new Set(texts.flatMap((t) => deriveThemeKeywords(t)))].filter((k) => k && k.length >= 2);
  const names = [].concat(productNames || []).map((n) => String(n || ""));
  const total = names.length;
  const hitNames = names.filter((n) => SEL.nameHits(n, keywords));
  const hit = hitNames.length;
  const ratio = total ? hit / total : 0;
  /* 沒商品或沒有可比的字＝不出聲（不是「對不上」，是「沒得比」）——失敗要出聲，但不是這一種聲 */
  const comparable = total > 0 && keywords.length > 0;
  return { comparable, keywords, total, hit, ratio, threshold, low: comparable && ratio < threshold };
}

module.exports = { parseBrief, parsePreamble, applyBriefToDraft, splitSections, parseFloors, parseSelection, matchSection, briefFit, FIT_DEFAULT_THRESHOLD };
