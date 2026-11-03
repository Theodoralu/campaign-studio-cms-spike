"use strict";
/**
 * lib/curation_brief_format.js —— 策展劇本（內容策略文件）格式的單一真源
 * 71 號 §4；2026-09-11 使用者裁決牆（qa/cms-brief-doc-wall-2026-09-11.html）五題。
 *
 * 這支檔在解什麼
 * ----------------------------------------------------------------
 * 同一份「文件長什麼樣」會被三個地方消費：①同事拿到的檔期範本 ②Gemini 助理的指令
 * ③CMS 的解析與驗證。三邊若各自手寫，三個月後一定漂——那正是本專案反覆出事的病
 * （鐵律 4「同類幾處」）。所以：**本檔是唯一手寫的那份，另外兩份是從它產出的產物。**
 *
 *   lib/curation_brief_format.js  ← 手寫，唯一真源
 *        ├─ templateMarkdown()    → tools/gen-brief-templates.mjs → 檔期範本 .md（產物，勿手改）
 *        ├─ gemInstructions()     → tools/gen-brief-gem.mjs       → Gemini 助理指令（產物，勿手改）
 *        └─ sections()/banned*()  → 解析器與驗證器（下一階段）
 *
 * 使用者裁決（2026-09-11）
 * ----------------------------------------------------------------
 * - 文件形狀＝**規定固定標題的 Markdown**，標題底下自由寫（非自由作文、非 JSON）。
 * - 範本與 Gemini 助理**同步交付**，不是先後——同事要能一開始就規劃流程。
 * - 「選品方向」這批**先寫進格式與撰寫原則，但還不會影響選品**；不得假裝它會生效。
 *
 * 兩條不變的紅線（沿用，不是本檔新立）
 * ----------------------------------------------------------------
 * 1. 真值欄一律禁收（71 號 §4.2）：價格／折扣／檔期／連結／貨號寫進文件＝擋下出聲，不是忽略。
 *    理由＝真值鐵律從「事後檢查」升級為「結構上不可能發生」。
 * 2. 沒填的段落回落機械預設，且畫面要明示哪些來自文件、哪些是機械填的（71 號 §4.4，不靜默降級）。
 *
 * 刻意不做的一件事：**本檔不寫任何字數上限。**
 * 長度上限已經有三份複本在打架（CMS 的 HERO_LEN／spec 的 fieldLimits／成績單），2026-09-11 正在收斂中；
 * 這裡再寫一份就是第四份。範本一律講「字數以 CMS 編修頁的提示為準」，把唯一權威留在畫面上。
 */

/* 樓層上限＝從真源讀，不在這裡寫死數字（lib/content_modules.js 是「一頁能放幾層」的唯一權威）。
   2026-09-11 Gemini 實測病例：助理產了五層，引擎其實只收三層——指令沒講，它不可能知道。
   讀不到就 throw（沿 proposal_pack 慣例：值域真源缺席不裝乾淨）。 */
function wallMax() {
  let CM;
  try { CM = require("./content_modules.js").CONTENT_MODULES; }
  catch (e) { throw new Error(`讀不到模組登記簿（lib/content_modules.js）：${e.message}——牆數上限的真源缺席，拒絕自己編一個數字`); }
  const n = CM && CM.wall && CM.wall.maxCount;
  if (!Number.isInteger(n) || n < 1) throw new Error("模組登記簿沒有 wall.maxCount——牆數上限的真源缺席");
  return n;
}
function floorMax() {
  let CM;
  try { CM = require("./content_modules.js").CONTENT_MODULES; }
  catch (e) { throw new Error(`讀不到模組登記簿（lib/content_modules.js）：${e.message}——樓層上限的真源缺席，拒絕自己編一個數字`); }
  const n = CM && CM.floor && CM.floor.maxCount;
  if (!Number.isInteger(n) || n < 1) throw new Error("模組登記簿沒有 floor.maxCount——樓層上限的真源缺席");
  return n;
}

const BRIEF_VERSION = 2; // v2（2026-09-14）：每層三段（標題／放什麼／短賣點＋可選第四段小標籤）＋牆標題／編輯精選／眉標三段——牆 qa/cms-layout-fit-wall-2026-09-14.html Q3 甲＋Q4 甲；舊 v1 檔照樣讀得懂（少的段回機器預設）
const BRIEF_KIND = "curation-brief";

/* 段落定義＝文件的骨架。heading 是同事在文件裡真的會打的那行字，key 是程式用的名字。

   consumed 的判準（2026-09-11 立，跨線共用）：**標 true 之前要指得出消費端在哪一行程式；指不出來就是 false。**
   本檔 2026-09-11 自己犯過這個錯——overview 與 tone 原本標 true，實際沒有任何程式讀它們
   （機械策展引擎自載定位「只挑選、不生成」）。那是「把格式收得下當成系統會用它」，
   跟本專案當天修了一整天的「說是 AI 其實是查表」同一族。
   標 false 不代表沒價值：overview 仍然必填，因為它是寫給人與助理看的共同方向。
   consumedBy＝消費端在哪，空字串就必須 consumed:false。 */
const SECTIONS = [
  {
    key: "overview",
    heading: "這檔在賣什麼",
    required: true,
    consumed: false,
    notConsumedNote: "這一段**系統目前不會直接拿去用**——它是寫給你自己和 AI 助理看的，讓後面幾段有共同方向。仍然要填。",
    plain: "一兩句話講清楚：這檔要賣給誰、主打什麼、避開什麼。",
    example: "父親節，主打送給講究的爸爸。避開女性向商品。",
    why: "必填但未消費＝刻意的：沒有它，寫後面幾段的人（或助理）會各寫各的。等文案生成端接上才會變成 consumed。",
  },
  {
    key: "title",
    heading: "主標",
    required: false,
    consumed: true,
    consumedBy: "lib/curation_brief.js applyBriefToDraft → page.hero[\"slogan-left\"] 第 1 段",
    multiline: true,
    plain: "主視覺上最大的那行字。想在哪裡換行，就自己斷一行。",
    example: "給爸的\n不將就",
    why: "留白＝用機械預設的標題，畫面上會標示這句是系統填的。",
  },
  {
    key: "floors",
    heading: "分幾層、各層講什麼",
    required: false,
    consumed: true,
    consumedBy: "lib/curation_brief.js applyBriefToDraft → page.floors[].title／sceneCopy.title；短賣點→ subtitle／sceneCopy.sub；第四段→ sceneCopy.tag；放什麼→ lib/brief_selection.js 挑商品（不上畫面）；一件都沒對到的層→標題照底下實際商品補（categoryWords）、記 meta.brief.autoTitles",
    list: true,
    plain: "一層一行，寫「樓層標題 —— 放什麼 —— 一句短賣點」。放什麼＝商品名會出現的字（例：瓦斯爐、烤盤），用「、」分開，只給機器挑商品、不會出現在頁面上；短賣點＝8 字內給消費者看的一句（例：沒有它就不能開烤），會出現在這一層情境卡的小標籤上。想換那顆兩個字的小標籤（預設「嚴選／人氣／質感」），再加第四段（例：—— 必備）。",
    plainExtra: () => `最多 ${floorMax()} 層——寫超過的部分不會進頁面，工具會告訴你多了幾層。寫的字這批商品裡一件都沒有（例：寫牙膏牙刷、來源卻沒有口腔用品）＝那一層的標題會照底下實際分到的商品補一個品類詞（例：濕紙巾），畫面會標示是系統補的、旁邊可以一鍵換字。`,
    example: "1. 送給講究的爸 —— 皮夾、皮帶、手錶 —— 他不說但看得懂\n2. 爸的第二人生 —— 帳篷、登山鞋、露營燈 —— 週末就出發",
    why: "決定頁面的敘事順序、每一層挑哪些商品、情境卡上那句賣點。2026-09-14 實走更正：前台樓層沒有副標位，「放什麼」不上畫面；給人看的字另立第三段（牆 cms-layout-fit Q3 甲）。沒填就照機械預設。",
  },
  {
    key: "tone",
    heading: "語氣",
    required: false,
    consumed: false,
    notConsumedNote: "這一段**系統目前不會直接拿去用**——機械策展只挑選、不生成文案，所以沒有東西會照這個語氣寫字。填了是給你自己和 AI 助理參考。",
    plain: "希望文案讀起來是什麼感覺，以及不要用哪些字。",
    example: "溫暖但不肉麻，不要用「孝順」這種字",
    why: "這段管的是風格，不是內容；它不會改變選了哪些商品。",
  },
  {
    key: "selection",
    heading: "選品方向",
    required: false,
    consumed: true,
    consumedBy: "lib/brief_selection.js applySelection（workbench/curate_auto.js --brief 讀）→ 避開＝整頁不放、多放＝排最前；AI 策展路不讀（2026-09-14 裁 3 乙，畫面會講）",
    plain: "想多放哪幾類、想避開哪幾類——都寫商品名會出現的字，用「、」分開。",
    plainExtra: () => "不用寫「優先」——排序一律折數深的先（商品資料裡沒有銷量或評價可以照做）。",
    example: "多放：3C、家電、保健\n避開：洋裝、裙",
    why: "避開的整頁不放；多放的排最前面（最容易進主視覺與第一層）。2026-09-14 使用者裁：「優先」這一行退場（裁 2 乙）——資料只撐得起折數一種排序，留一顆只有一個合法值的旋鈕＝說會生效其實不會。",
  },
  /* v2 進階三段（2026-09-14 下午）排在最後：前五段是同事已經熟的順序、v1 舊檔照樣讀；這三段留白＝機器預設，畫面標示 */
  {
    key: "walls",
    heading: "三面牆的標題",
    required: false,
    consumed: true,
    consumedBy: "lib/curation_brief.js applyBriefToDraft → page.walls[].title（一件都沒對到＝標題照底下實際商品補、出聲、記 meta.brief.autoTitles）；放什麼→ lib/brief_selection.js pickGroups 挑進該面牆（curate_auto 牆段）",
    list: true,
    plain: "頁面下方三面商品牆，一面一行，寫「牆標題 —— 放什麼」。放什麼＝商品名會出現的字（例：烤肉醬、醬油），機器照它把商品挑進這面牆；沒寫放什麼＝機器照順序排。你寫的標題跟這面牆實際分到的商品對不上（寫的字一件都沒找到、或整批商品跟策略檔對不上）＝標題會照底下實際商品補一個品類詞，畫面標示是系統補的、可一鍵換（免得標題跟商品各說各話）。",
    plainExtra: () => `最多 ${wallMax()} 面——多寫的不會進頁面。`,
    example: "配件一起搭 —— 帽子、襪子、包\n下身怎麼配 —— 牛仔褲、長裙\n室內薄外套 —— 針織、襯衫",
    why: "沒填＝系統用「更多選品一次看／追加補貨清單／順手加購小物」這種通用標題（2026-09-14 使用者實走：整頁除了三層標題全是套話＝空泛的來源；同日再修：「醬料與調味」底下是計時器＝牆也要照字挑）。",
  },
  {
    key: "editorial",
    heading: "編輯精選那一句",
    required: false,
    consumed: true,
    consumedBy: "lib/curation_brief.js applyBriefToDraft → page.editorial.title[]（一到三行；這檔商品不夠、沒有編輯精選區＝出聲不套）",
    multiline: true,
    plain: "編輯精選區左邊那塊大字，一到三行、每行很短（例：給爸的／不將就）。太長的話發佈前檢查會告訴你。",
    example: "給爸的\n不將就\n編輯室私心推",
    why: "沒填＝系統拿主標拆兩行、第三行「編輯室嚴選提案」。",
  },
  {
    key: "eyebrow",
    heading: "主標上面那行小字",
    required: false,
    consumed: true,
    consumedBy: "lib/curation_brief.js applyBriefToDraft → 主視覺文字段落表（lib/layout_choice HERO_TEXT_PIECES）標「眉標」或「品牌帶」的那一段＋kv.eyebrowZh；沒有該段的版型＝出聲不套",
    plain: "主視覺大標上方那行小字，一句就好（例：中秋連假烤肉季）。有些版型沒有這個位置，工具會告訴你。",
    example: "父親節限定企劃",
    why: "眉標是頁面第一眼的定調；沒填＝系統用「主題＋選品」那種預設。",
  },
];

/* 禁收的真值欄位名（71 號 §4.2 原文照抄，不在這裡自行增減） */
const BANNED_FIELDS = ["price", "marketPrice", "offer", "url", "gdid", "actid", "dateValue", "period"];

/* 自由文字裡的真值樣態＝解析時要擋的東西。寫成有名字的規則，錯誤訊息才講得出「為什麼擋你」。
   注意：這裡只認「明顯是真值」的樣態，寧可漏抓也不要誤擋策略描述（例如「主打千元有找的禮物」不該被擋）。 */
const BANNED_PATTERNS = [
  { name: "價格", re: /(?:NT\$|\$|＄)\s?\d[\d,]*/, say: "文件裡不要寫價格——價格一律從商品頁實抓，寫進來反而會跟真實售價打架。" },
  { name: "折扣數字", re: /\d+\s*(?:折|%\s*off)/i, say: "文件裡不要寫折數——折扣以商品頁當下的實際優惠為準。" },
  { name: "連結", re: /https?:\/\//i, say: "文件裡不要放連結——商品連結由系統帶入，貼進來可能指到過期的頁面。" },
  { name: "賣場編號", re: /\b\d{6,10}\b/, say: "文件裡不要寫賣場編號——要指定商品請在編修頁貼網址或編號，那條路才有真值檢查。" },
  { name: "檔期日期", re: /\d{1,2}\s*\/\s*\d{1,2}\s*[–\-~至]\s*\d{1,2}\s*\/\s*\d{1,2}/, say: "文件裡不要寫檔期——活動時間以來源頁抓到的為準，抓不到時在編修頁人工填並標記。" },
];

const sections = () => SECTIONS.map((s) => ({ ...s }));
const sectionByKey = (k) => SECTIONS.find((s) => s.key === k) || null;
const headings = () => SECTIONS.map((s) => s.heading);
const bannedFields = () => BANNED_FIELDS.slice();
const bannedPatterns = () => BANNED_PATTERNS.map((p) => ({ ...p }));

/* 產物一：檔期範本 Markdown。
   opts.theme／opts.scenario＝這份範本是給哪個檔期／情境用的（寫進抬頭，方便同事認）。
   filled＝各段的預填內容（給我們預寫的五份範本用）；沒給就放 example 當示範。 */
function templateMarkdown(opts = {}) {
  const { theme = "", scenario = "", filled = {}, withGuidance = true } = opts;
  const L = [];
  L.push(`<!-- 活動頁策展劇本 v${BRIEF_VERSION}｜這份檔案是給「活動頁工具」讀的 -->`);
  L.push(`<!-- 標題（# 那幾行）請原樣保留，內容自己改；字數以 CMS 編修頁的提示為準 -->`);
  if (theme || scenario) L.push(`<!-- 適用：${[theme, scenario].filter(Boolean).join("｜")} -->`);
  L.push("");
  /* 第一行可見句（2026-09-15 C 批）：型態與主題寫在這裡、機器讀這裡（lib/curation_brief parsePreamble）；上面的註解只給人看、
     Gemini 介面複製時常掉，所以不能只靠註解。沒給 scenario＝不印（空白範本由使用者或 Gemini 自己填第一行）。 */
  if (scenario) { L.push(`這檔是哪一種活動：${scenario}${theme ? `｜活動主題：${theme}` : ""}`); L.push(""); }
  for (const s of SECTIONS) {
    L.push(`# ${s.heading}`);
    if (withGuidance) {
      L.push(`> ${s.plain}`);
      if (typeof s.plainExtra === "function") L.push(`> ${s.plainExtra()}`);
      if (!s.consumed) L.push(`> ${String(s.notConsumedNote).replace(/\*\*/g, "")}`);
      if (!s.required && s.consumed) L.push("> 留白就好——沒填的部分系統會用預設，畫面上會標示哪些是系統填的。");
    }
    const body = Object.prototype.hasOwnProperty.call(filled, s.key) ? filled[s.key] : s.example;
    L.push("");
    L.push(String(body == null ? "" : body));
    L.push("");
  }
  return L.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
}

/* 產物二：Gemini 助理指令。刻意寫成「給助理看的說明」，不是給人看的文件。
   它必須跟範本同源，否則助理產出的東西解析器吃不下——那是這整批最容易發生的漂移。 */
function gemInstructions(opts = {}) {
  /* 2026-09-15（牆 cms-solo-create-flow-ia 第〇・五段 09-15 節）：型態是策略檔的前提，助理要「先問型態與主題、寫在文件第一行」。
     卡名由呼叫端（gen-brief-templates PRESETS.cardTitle）傳入，本檔不抄一份；沒傳＝仍印步驟但不列名。
     第一行是「# 之前的文字」＝解析器忽略（09-15 實測 0 notice），CMS 讀它＝C 批。 */
  const scenarioNames = Array.isArray(opts.scenarioNames) ? opts.scenarioNames.filter(Boolean) : [];
  const L = [];
  L.push("你是「活動頁策展助理」。你的工作是陪使用者把一檔活動的內容策略，整理成一份固定格式的文件。");
  L.push("");
  L.push("## 你要產出什麼");
  L.push("文件的**第一行**固定寫這一句（不是標題、不加 #）：");
  L.push("`這檔是哪一種活動：（五選一）｜活動主題：（使用者說的主題）`");
  L.push(`接著是一份 Markdown，**只能包含下面這 ${SECTIONS.length} 個標題，順序不可調換、字面不可更動**：`);
  L.push("");
  SECTIONS.forEach((s, i) => {
    L.push(`${i + 1}. \`# ${s.heading}\`${s.required ? "（必填）" : "（可留白）"}——${s.plain}`);
    if (typeof s.plainExtra === "function") L.push(`   ${s.plainExtra()}`);
    if (!s.consumed) L.push(`   註：${String(s.notConsumedNote).replace(/\*\*/g, "")}`);
  });
  /* 每段附真實範例＝2026-09-11 Gemini 實測後補。原本只給空白骨架與一行描述，
     助理沒有東西可以照抄格式，就自己發明了「第一層：」這種寫法——不是它亂來，是我沒給。 */
  L.push("");
  L.push("## 每一段長什麼樣（請照這個形狀寫，這很重要）");
  L.push("```markdown");
  L.push(`這檔是哪一種活動：${scenarioNames[4] || "抓一個時事話題選品"}｜活動主題：中秋烤肉`);
  L.push("");
  SECTIONS.forEach((s) => { L.push(`# ${s.heading}`); L.push(String(s.example)); L.push(""); });
  L.push("```");
  L.push("特別注意：");
  L.push(`- 「分幾層」用「1. 標題 —— 放什麼 —— 短賣點」三段（想換小標籤再加第四段），開頭是阿拉伯數字加點，**不要寫成「第一層：」**；最多 ${floorMax()} 層；短賣點 8 字內。`);
  L.push(`- 「三面牆的標題」一面一行、寫「標題 —— 放什麼」、最多 ${wallMax()} 行；「編輯精選那一句」一到三行、每行很短；「主標上面那行小字」只有一行。`);
  L.push("- 「選品方向」用「多放：／避開：」兩行，不要寫成一段文章；**不要寫「優先：」**（系統照折數排，沒有銷量或評價資料可以照做）。");
  L.push("- 「放什麼」「多放」「避開」都要寫**商品名會出現的字**（品類名、品牌、規格詞，例：瓦斯爐、烤盤、羽絨外套），不要寫形容（「有節慶感的」「講究的」）——機器是拿這些字去比對商品名的，對不到就挑不進去。");
  L.push("- 「主標」一行一句，想換行就自己斷行，不要加標點把兩句黏成一行。");
  L.push("");
  L.push("## 絕對不可以寫進文件的東西");
  L.push("價格、折扣數字、活動檔期日期、商品連結、賣場編號——**一個都不行**。");
  L.push("這些一律由系統從商品頁實際抓取；你寫進去不會被採用，還會讓文件被擋下來。");
  L.push("使用者若提供這些資訊，請在對話裡回應他「這部分系統會自動帶入，不用寫進文件」，然後略過。");
  L.push("");
  L.push("## 怎麼跟使用者互動");
  L.push("1. **第一個問題固定是**：「這檔是哪一種活動？主題是什麼？」——使用者通常已經在活動頁工具上選好了，請他照工具上選的那張卡回答；" + (scenarioNames.length ? `五張卡是：${scenarioNames.map((n) => `「${n}」`).join("、")}。` : "五張卡以工具上顯示的為準。") + "答案寫進文件第一行。");
  L.push("2. 這個答案決定後面每一段的調性：「不喊優惠」那張＝整份不出現折扣、下殺、限時這類字；「主打省錢」那張＝主標與短賣點可以講優惠（但一樣不寫數字）。");
  L.push("3. 再問這檔活動要賣給誰、主打什麼、避開什麼——這是其餘每一段的基礎。");
  L.push("4. 一段一段陪他確認，不要一次丟一整份要他挑錯。");
  L.push("5. 他講不出來的段落就留白，並告訴他「留白的部分系統會用預設，不影響能不能建頁」。");
  L.push("6. 最後把完整文件（含第一行）輸出成一個可以直接複製的 Markdown 區塊。");
  L.push("");
  L.push("## 字數");
  L.push("不要自己訂字數上限。文件貼進工具後，編修頁會針對過長的欄位給提示，以那裡為準。");
  L.push("");
  L.push("## 空白範本");
  L.push("```markdown");
  L.push(templateMarkdown({ withGuidance: false, filled: Object.fromEntries(SECTIONS.map((s) => [s.key, ""])) }).trimEnd());
  L.push("```");
  return L.join("\n") + "\n";
}

module.exports = {
  BRIEF_VERSION,
  BRIEF_KIND,
  floorMax,
  wallMax,
  sections,
  sectionByKey,
  headings,
  bannedFields,
  bannedPatterns,
  templateMarkdown,
  gemInstructions,
};
