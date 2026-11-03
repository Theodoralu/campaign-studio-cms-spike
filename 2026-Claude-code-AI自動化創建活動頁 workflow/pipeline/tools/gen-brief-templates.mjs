/* 產出「內建策略檔範本」與「Gemini 助理指令」——兩者皆為產物，機器重產、勿手改。
   真源＝lib/curation_brief_format.js（段落、禁收規則）＋本檔的五份情境預填內容。
   情境名與說法沿用 CMS 既有的五張配方卡（workbench/public/index.html RECIPE_CARDS），不另造一套。
   2026-09-14 起（71 號階段二，使用者裁 1 乙／2 乙）：五份的「放什麼」「多放」「避開」一律寫商品名會出現的字——
   同事是照抄範本的，範本示範形容詞、機器就挑不到東西；「優先」行退場（資料只有折數）。

   用法：node tools/gen-brief-templates.mjs [--check]
        --check＝只驗不寫（給絆線用：產物與真源不同步就紅）

   自我防線：產出後逐份跑一次真值禁收檢查——我們自己寫的範本若夾帶價格或折數，
   同事會照抄，那比程式有 bug 更難發現。 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const PIPE = path.resolve(HERE, "..");
const F = require(path.join(PIPE, "lib", "curation_brief_format.js"));

const OUT_BUILTIN = path.join(PIPE, "briefs", "built-in");
const OUT_MINE = path.join(PIPE, "briefs", "mine");
const CHECK = process.argv.includes("--check");

/* 五份情境預填。scenario 值＝CMS 配方卡的 value（原樣，這是資料值不是顯示字）。 */
const PRESETS = [
  {
    slug: "01-同品類跨品牌-優惠銷售",
    theme: "不鏽鋼鍋具",
    scenario: "同品類×跨品牌-優惠銷售",
    cardTitle: "多品牌一起賣，主打省錢", // 2026-09-15 卡名改口（舊：同品類×跨品牌．優惠銷售）
    filled: {
      overview:
        "同一個品類集合多個品牌一起賣，主打這一檔的優惠。\n買的人已經知道自己要什麼，是在比較「哪一家划算」——所以頁面要讓人好比較，不用花力氣說服他需要。",
      title: "好鍋一次\n比個夠",
      floors:
        "1. 人氣品牌先看 —— 炒鍋、湯鍋、平底鍋 —— 熟牌子，閉著眼買\n2. 小資也能入手 —— 單柄鍋、奶鍋、蒸鍋 —— 第一口鍋從這裡\n3. 一次到位的選擇 —— 鍋具組、雙耳鍋、壓力鍋 —— 買一次用十年",
      tone: "直接、好比較，不用形容詞堆疊。講規格與差別，不要講「質感生活」這種空話。",
      selection: "多放：不鏽鋼\n避開：陶瓷、琺瑯",
      walls: "廚房裡最常用的那幾把 —— 炒鍋、湯鍋\n加一件更順手 —— 鍋鏟、鍋蓋\n送禮也體面 —— 鍋具組",
      editorial: "好鍋一次\n比個夠",
      eyebrow: "不鏽鋼鍋具聯合特賣",
    },
  },
  {
    slug: "02-單一品牌-優惠曝光",
    theme: "Le Creuset 鍋具",
    scenario: "單一品牌-優惠/曝光",
    cardTitle: "只講一個品牌", // 2026-09-15 卡名改口（舊：單一品牌．優惠／曝光）
    filled: {
      overview:
        "只主推一個品牌，優惠跟品牌形象要一起說。\n這種頁的讀者常常是「喜歡這個牌子但還沒下手」，所以品牌的調性不能被優惠蓋過去。",
      title: "經典就是\n值得等",
      floors:
        "1. 品牌經典款 —— 鑄鐵鍋、圓鍋 —— 一鍋傳三代\n2. 這一檔的重點 —— 淺鍋、燉鍋、湯鍋 —— 這次最值得下手\n3. 搭著一起買 —— 餐盤、馬克杯、鍋墊 —— 湊成整套的小東西",
      tone: "跟著品牌自己的調性走。這個牌子講究就講究、俏皮就俏皮，不要用通用的促銷語氣把它拉平。",
      selection: "多放：鑄鐵鍋\n避開：福利品、展示品",
      walls: "經典色一次看 —— 鑄鐵鍋\n餐桌上的配角 —— 餐盤、馬克杯\n新手入門款 —— 淺鍋、奶鍋",
      editorial: "經典就是\n值得等",
      eyebrow: "Le Creuset 品牌週",
    },
  },
  {
    slug: "03-同品類-情境優惠",
    theme: "不鏽鋼安心廚房",
    scenario: "同品類-情境×優惠",
    cardTitle: "用一個生活場景帶出優惠", // 2026-09-15 卡名改口（舊：同品類．情境×優惠）
    filled: {
      overview:
        "用一個生活情境把品類包起來，再帶出優惠。\n讀者不一定原本就想買——是看到情境才發現「我也需要」。所以情境要先立起來，優惠才有著力點。",
      title: "安心廚房\n從一只鍋開始",
      floors:
        "1. 每天都會用到的 —— 炒鍋、湯鍋、鍋鏟 —— 天天開火的配備\n2. 讓料理更省事 —— 蒸架、濾網、量杯 —— 少一個步驟\n3. 收納與清潔 —— 保鮮盒、瀝水架、菜瓜布 —— 煮完也要好收",
      tone: "像朋友在分享，不像在推銷。可以講使用的畫面，但不要誇大功效。",
      selection: "多放：不鏽鋼\n避開：塑膠",
      walls: "備料好幫手 —— 砧板、量杯、濾網\n餐桌小物 —— 碗、盤、筷\n廚房收納 —— 保鮮盒、收納盒",
      editorial: "安心廚房\n從一只鍋開始",
      eyebrow: "不鏽鋼安心廚房提案",
    },
  },
  {
    slug: "04-同品類-新品熱銷曝光",
    theme: "秋冬新款外套",
    scenario: "同品類-新品/熱銷曝光",
    cardTitle: "秀新品或熱銷，不喊優惠", // 2026-09-15 卡名改口（舊：同品類．新品／熱銷曝光）
    filled: {
      overview:
        "以新品或熱銷曝光為主，這一檔不喊優惠。\n目的是讓人知道「有這些新東西」，不是催他現在買。頁面上不要出現搶購感。",
      title: "秋冬新款\n到齊了",
      floors:
        "1. 本季新到 —— 羽絨外套、大衣 —— 剛上架，先看先挑\n2. 賣得最好的 —— 風衣、鋪棉外套 —— 大家都在買這幾件\n3. 風格提案 —— 針織外套、飛行外套 —— 週末約會怎麼穿",
      tone: "平穩、有新鮮感，不要用「最後機會」「錯過不再」這類催促的話。",
      selection: "多放：外套、大衣\n避開：短袖、背心",
      walls: "配件一起搭 —— 帽子、襪子、包\n下身怎麼配 —— 牛仔褲、長裙\n室內薄外套 —— 針織、襯衫",
      editorial: "秋冬新款\n到齊了",
      eyebrow: "秋冬新款上市",
    },
  },
  {
    slug: "05-時事主題-情境選品",
    theme: "中秋烤肉",
    scenario: "時事主題-情境×選品",
    cardTitle: "抓一個時事話題選品", // 2026-09-15 卡名改口（舊：時事主題．情境選品）
    filled: {
      overview:
        "抓一個當下的時事話題來選品，講究時效。\n這種頁的壽命短，讀者是「因為這個節日才來」——所以主題要一眼認得出來，不要繞。",
      title: "中秋烤肉\n一次備齊",
      floors:
        "1. 烤肉必備 —— 烤肉架、瓦斯爐、木炭 —— 沒有它就不能開烤\n2. 加分道具 —— 烤肉夾、烤肉網、隔熱手套 —— 有了更順手\n3. 收尾清潔 —— 洗碗精、廚房紙巾、垃圾袋 —— 烤完也要收得快",
      tone: "熱鬧、有節慶感，但不要用網路流行語——它退流行得比檔期還快。",
      selection: "多放：烤肉、木炭\n避開：計時器、時鐘",
      walls: "醬料與調味 —— 烤肉醬、醬油、胡椒\n飲料與冰品 —— 啤酒、汽水、冰塊\n露營野餐小物 —— 保冷袋、野餐墊、紙盤",
      editorial: "中秋烤肉\n一次備齊",
      eyebrow: "中秋連假烤肉季",
    },
  },
];

/* 產物自我檢查：我們自己寫的範本不准夾帶真值（同事會照抄，比程式 bug 難發現） */
function assertNoTruthValues(name, md) {
  const bad = F.bannedPatterns().filter((p) => p.re.test(md));
  if (bad.length) {
    throw new Error(`內建範本「${name}」夾帶真值（${bad.map((b) => b.name).join("、")}）——範本是同事會照抄的東西，不得示範壞習慣`);
  }
}

const files = new Map();
for (const p of PRESETS) {
  const md = F.templateMarkdown({ theme: p.theme, scenario: p.cardTitle, filled: p.filled });
  assertNoTruthValues(p.slug, md);
  files.set(path.join(OUT_BUILTIN, `${p.slug}.md`), md);
}
files.set(path.join(PIPE, "briefs", "Gemini助理指令.md"), F.gemInstructions({ scenarioNames: PRESETS.map((p) => p.cardTitle) })); // 2026-09-15：指令先問型態，卡名沿 PRESETS 不另抄
files.set(
  path.join(PIPE, "briefs", "README.md"),
  [
    "# 活動策略檔",
    "",
    "這個資料夾放「內容策略文件」——你先把一檔活動想怎麼做寫下來，建活動頁時選這份檔，",
    "工具就會照你寫的來下標題、分樓層、挑商品、定語氣。",
    "",
    "## 先做這一步，再去寫（2026-09-15 起）",
    "",
    "**先在 CMS 建立頁選好「這檔是哪一種活動」和「活動主題」，再去寫策略檔。**",
    "",
    "為什麼：策略檔的每一段（主標、分層、語氣、選什麼）都是在「這檔要講優惠、講情境、還是講新品」這個前提下寫的。",
    "先寫、再回來選，兩邊常常對不上——例如你寫了一排「限時下殺」，卻選到「不喊優惠」那張卡，版面和文字會打架。",
    "",
    "五張卡（CMS 上的名字）：",
    "- 多品牌一起賣，主打省錢",
    "- 只講一個品牌",
    "- 用一個生活場景帶出優惠",
    "- 秀新品或熱銷，不喊優惠",
    "- 抓一個時事話題選品",
    "",
    "## 兩個資料夾的差別",
    "",
    "| 資料夾 | 是什麼 | 可以改嗎 |",
    "|---|---|---|",
    "| `built-in/` | 我們預先寫好的五份，五張卡各一份 | **不要改**——工具更新時會整份換掉，你的修改會不見 |",
    "| `mine/` | 你自己的 | 隨便改。想從範本開始，就把 `built-in/` 裡的複製一份過來再改 |",
    "",
    "## 怎麼寫",
    "",
    "檔案裡 `#` 開頭那幾行是標題，**請原樣保留、不要改字**——工具靠它們認出每一段是什麼。",
    "標題底下的內容自己寫，寫不出來就留白，留白的部分工具會用預設，畫面上會標示哪些是系統填的。",
    "",
    "「放什麼」「多放」「避開」要寫**商品名會出現的字**（例：瓦斯爐、烤盤、羽絨外套），不要寫形容詞——機器是拿這些字去比對商品名的。",
    "",
    "## 有三件不要寫進來",
    "",
    "價格、折扣數字、商品連結、賣場編號、活動檔期日期——**寫了會被擋下來**。",
    "這些一律由系統從商品頁當場抓取，寫進文件反而會跟真實的數字打架。",
    "",
    "## 想找 AI 幫你寫（Gemini）",
    "",
    "1. 先在 CMS 選好那張卡和主題（上面那一步）。",
    "2. 把 `Gemini助理指令.md` 的內容貼進 Gemini，建一個自訂助理。",
    "3. 它第一個會問你「這檔是哪一種活動、主題是什麼」——**照你在 CMS 上選的回答**，它會把答案寫在文件最上面第一行。",
    "4. 一段一段陪你寫完，最後給你一份可以整段複製的文件。",
    "5. 存成 `.md` 放進 `mine/`，回 CMS 建立頁選它。",
    "",
    "> 之後的版本會在 CMS 裡直接幫你組好給 Gemini 的話（帶這一檔真實的商品名）、貼回來就存、當場對帳。現在還沒有，所以先照上面五步。",
    "",
    "---",
    "`built-in/` 與 `Gemini助理指令.md` 都是機器產出的，改了會被下次重產蓋掉。",
    "要改內容請改 `pipeline/lib/curation_brief_format.js`（格式）或 `pipeline/tools/gen-brief-templates.mjs`（範本內容），再重跑 `node tools/gen-brief-templates.mjs`。",
  ].join("\n") + "\n"
);

let drift = 0;
for (const [f, body] of files) {
  const cur = fs.existsSync(f) ? fs.readFileSync(f, "utf8") : null;
  if (cur === body) continue;
  drift++;
  if (CHECK) { console.error(`✗ 產物與真源不同步：${path.relative(PIPE, f)}`); continue; }
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, body);
  console.log(`✓ ${path.relative(PIPE, f)}`);
}
if (!CHECK) {
  fs.mkdirSync(OUT_MINE, { recursive: true });
  const keep = path.join(OUT_MINE, ".gitkeep");
  if (!fs.existsSync(keep)) fs.writeFileSync(keep, "");
}
if (CHECK && drift) { console.error(`\n${drift} 份產物過期——請跑 node tools/gen-brief-templates.mjs`); process.exit(1); }
console.log(CHECK ? "✓ 產物與真源同步" : `\n完成：${files.size} 份（內建範本 ${PRESETS.length}＋助理指令＋說明）`);
