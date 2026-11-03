/* 策展劇本解析器（2026-09-11）。
   ------------------------------------------------------------------
   這支測試的重點不是「Gemini 產的東西讀不讀得懂」——那個已經實測過兩輪、很聽話。
   重點是**真人會怎麼亂寫**：全形井號、標題後面多個冒號、樓層寫成「第一層：」或「一、」、
   忘記破折號、段落重複、多空幾行。解析器吃不下這些，同事第一次用就會卡住。

   同時守三條做人的規矩：
     - 擋下來要講清楚是哪一段、怎麼修（不能只說「格式錯誤」）
     - 沒填的段落要記帳（provenance），畫面才講得出哪些是系統填的
     - 收得下但還不會生效的（選品方向）必須明說，不假裝生效 */
"use strict";
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const P = require("../../lib/curation_brief.js");
const FMT = require("../../lib/curation_brief_format.js");
const TIMERS = ["廚房計時器 60 分鐘 機械式", "數位計時器 磁吸 大螢幕", "學習計時器 靜音 番茄鐘", "倒數計時器 防水 白色", "電子計時器 雙組", "料理計時器 旋轉", "沙漏計時器", "智慧計時器", "計時器 磁鐵", "計時器 兒童"];
const BBQ = ["烤肉架 折疊 不鏽鋼", "烤肉串 竹籤", "烤肉夾 加長", "木炭 5 公斤", "烤肉網 圓形", "烤肉醬 韓式", "瓦斯爐 卡式", "洗碗精 檸檬", "啤酒 六入", "廚房紙巾 三層"];

const BUILTIN = path.resolve(__dirname, "..", "..", "briefs", "built-in");
const H = FMT.headings();
const doc = (body) => body.trim() + "\n";

test("五份內建範本全部解析乾淨（自家產物先過自家解析器）", () => {
  const files = fs.readdirSync(BUILTIN).filter((f) => f.endsWith(".md"));
  assert.ok(files.length >= 5);
  for (const f of files) {
    const r = P.parseBrief(fs.readFileSync(path.join(BUILTIN, f), "utf8"));
    assert.strictEqual(r.ok, true, `${f} 解析失敗：${r.errors.map((e) => e.say).join("；")}`);
    assert.strictEqual((r.data.floors || []).length, 3, `${f} 樓層數不對`);
    assert.ok((r.data.title || []).length >= 2, `${f} 主標沒讀成多行`);
    /* 範本裡的引導句（> 開頭）是說明書，不可以被當成內容 */
    const flat = JSON.stringify(r.data);
    assert.ok(!flat.includes("留白就好"), `${f} 把引導句吃進內容了`);
    assert.ok(!flat.includes("一層一行"), `${f} 把引導句吃進內容了`);
  }
});

test("真人亂寫也吃得下：全形井號／標題帶冒號／中文序號／忘記破折號", () => {
  const r = P.parseBrief(doc(`
＃ ${H[0]}：
中秋烤肉，主打一家人一起吃飯。

## ${H[1]}
中秋團圓
就是要圍爐

#${H[2]}
一、烤肉必備 - 炭火、夾子
二、加分道具：桌邊小物
三、收尾清潔

# ${H[3]}
熱鬧但不吵
`));
  assert.strictEqual(r.ok, true, r.errors.map((e) => e.say).join("；"));
  assert.deepStrictEqual(r.data.floors.map((f) => f.title), ["烤肉必備", "加分道具", "收尾清潔"]);
  assert.strictEqual(r.data.floors[0].hint, "炭火、夾子");
  assert.strictEqual(r.data.floors[2].hint, "", "只寫標題沒寫內容＝允許，但下面要出聲");
  assert.ok(r.notices.some((n) => /沒寫「這一層放什麼」/.test(n.say)), "沒提醒少了說明");
  assert.deepStrictEqual(r.data.title, ["中秋團圓", "就是要圍爐"]);
});

test("Gemini 第一輪那種寫法（第一層：／五層／選品寫成散文）＝吃得下，而且逐件出聲", () => {
  const r = P.parseBrief(doc(`
# ${H[0]}
父親節 3C。

# ${H[2]}
第一層：旗艦首選 —— 手機平板
第二層：健康守護 —— 智慧手錶
第三層：影音娛樂 —— 降噪耳機
第四層：高效工作 —— 筆電
第五層：智慧生活 —— 刮鬍刀

# ${H[4]}
多放知名品牌熱銷，避開白牌，優先挑熱銷排行。
`));
  assert.strictEqual(r.ok, true, "這些是格式偏離、不是錯誤，不該擋人");
  assert.deepStrictEqual(r.data.floors.map((f) => f.title), ["旗艦首選", "健康守護", "影音娛樂"], "「第一層：」前綴要剝掉");
  assert.ok(r.notices.some((n) => /你寫了 5 層.*最多放 3 層/.test(n.say)), "超過樓層上限沒出聲");
  assert.ok(r.notices.some((n) => /沒認出「多放／避開」/.test(n.say)), "選品散文沒出聲");
  assert.ok(r.data.selection.raw.includes("知名品牌"), "認不出格式時要原樣收著，不可丟掉");
});

test("真值一律擋下，而且講得出是哪一段、哪一種、為什麼", () => {
  const r = P.parseBrief(doc(`
# ${H[0]}
父親節。

# ${H[2]}
1. 超值首選 —— 主打 $1,990 的入門款
2. 下殺區 —— 全館 85折
`));
  assert.strictEqual(r.ok, false);
  const all = r.errors.map((e) => e.say).join(" / ");
  assert.match(all, new RegExp(H[2]), "沒指出是哪一段");
  assert.match(all, /價格/);
  assert.match(all, /折扣數字/);
  for (const e of r.errors) {
    assert.ok(e.say.length > 10 && e.how.length > 5, `錯誤訊息沒講清楚怎麼修：${JSON.stringify(e)}`);
    assert.ok(!/\bundefined\b|\[object/.test(e.say + e.how), "錯誤訊息漏了程式內部字串");
  }
});

test("缺必填段＝擋下並指路；缺選填段＝放行但記帳", () => {
  const r = P.parseBrief(doc(`
# ${H[1]}
只寫了主標
`));
  assert.strictEqual(r.ok, false);
  assert.ok(r.errors.some((e) => e.section === H[0] && /必填/.test(e.say)), "缺必填段沒擋");
  assert.ok(r.errors.some((e) => e.how.includes(`# ${H[0]}`)), "沒告訴他要加哪一行");
  assert.strictEqual(r.provenance.title, "brief");
  assert.strictEqual(r.provenance.tone, "missing", "沒填的段落要記成 missing，畫面才講得出是系統填的");
  assert.strictEqual(r.provenance.floors, "missing");
});

test("認不得的標題＝提醒不擋人；重複段落＝用第一份並出聲", () => {
  const r = P.parseBrief(doc(`
# ${H[0]}
父親節。

# 我自己加的備註
這段工具看不懂

# ${H[3]}
溫暖

# ${H[3]}
第二次寫的語氣
`));
  assert.strictEqual(r.ok, true, "看不懂的段落不該擋人做事");
  assert.ok(r.notices.some((n) => /不是工具認得的段落/.test(n.say)));
  assert.ok(r.notices.some((n) => /出現了兩次/.test(n.say)));
  assert.strictEqual(r.data.tone, "溫暖", "重複時採第一份");
});

test("空檔案／沒有任何標題＝擋下，而且指路可操作", () => {
  for (const bad of ["", "   \n\n", "我想做一個父親節活動，主打 3C。"]) {
    const r = P.parseBrief(bad);
    assert.strictEqual(r.ok, false, `這份應該被擋：${JSON.stringify(bad)}`);
    assert.ok(r.errors[0].how.includes("#"), "沒告訴他標題長什麼樣");
  }
});

test("選品方向：讀得出來、真的會生效（2026-09-14 起）；「優先」寫了要講它不生效", () => {
  const r = P.parseBrief(doc(`
# ${H[0]}
父親節。

# ${H[4]}
多放：3C、家電
避開：女性向
優先：熱銷
`));
  assert.strictEqual(r.ok, true);
  assert.deepStrictEqual(
    { i: r.data.selection.include, e: r.data.selection.exclude, p: r.data.selection.priority },
    { i: "3C、家電", e: "女性向", p: "熱銷" });
  /* 71 號階段二接上之後，這一段不再說「還不會生效」——說了就是反過來的謊（明明會生效卻說不會） */
  assert.ok(!r.notices.some((n) => /還不會影響選哪些商品|不會生效|先收著/.test(n.say) && !/優先/.test(n.say)), "選品方向已經生效，不能再說它不會：" + JSON.stringify(r.notices));
  /* 「優先」退場（裁 2 乙）：認得、收著、但要講它不生效——資料沒有銷量或評價可照做 */
  assert.ok(r.notices.some((n) => /「優先：熱銷」這行目前不會生效/.test(n.say) && /折數/.test(n.say)), "寫了優先沒講它不生效");
  const r2 = P.parseBrief(doc(`
# ${H[0]}
父親節。

# ${H[4]}
多放：3C、家電
避開：女性向
`));
  assert.ok(!r2.notices.some((n) => /優先/.test(n.say)), "沒寫優先就不該提優先");
});

test("每一句 error／notice 都是白話，且不得混入程式內部字串", () => {
  const r = P.parseBrief(doc(`
＃ ${H[0]}：
父親節，主打 $999 的禮物。

# 不認得的段
x

# ${H[2]}
第一層：A
第二層：B
第三層：C
第四層：D
`));
  for (const m of [...r.errors, ...r.notices]) {
    assert.ok(m.say && m.say.length > 8, `訊息太短：${JSON.stringify(m)}`);
    assert.ok(!/undefined|null|\[object|NaN/.test(m.say), `訊息漏出內部字串：${m.say}`);
    assert.ok(!/^[A-Za-z_.]+$/.test(m.say), `訊息不是人話：${m.say}`);
  }
});

/* ---------- 落地：寫進草稿 ---------- */
const FOLD = String.fromCharCode(0x2028);
const baseDraft = () => ({
  page: {
    hero: { "slogan-left": ["舊主標", "限時貼紙", "85", "跑馬帶"].join("\n") },
    floors: [
      { pos: "featured-1", title: "舊一", subtitle: "舊說明一", titleSource: "ai-curated", sceneCopy: { tag: "嚴選", title: "舊一", sub: "舊說明一" }, productGdids: ["111", "222"] },
      { pos: "featured-2", title: "舊二", subtitle: "舊說明二", titleSource: "ai-curated", sceneCopy: { tag: "人氣", title: "舊二", sub: "舊說明二" }, productGdids: ["333"] },
    ],
    kv: { dateValue: "08/30–09/30", actid: "9999" },
  },
  products: [{ gdid: "111", name: "A", price: 1990, url: "https://tw.buy.yahoo.com/x", listPrice: 2500 }],
  meta: {},
});
const briefDoc = (floors) => `# ${H[0]}\n父親節。\n\n# ${H[1]}\n給爸的\n不將就\n\n# ${H[2]}\n${floors}\n`;

test("落地：主標寫進第 1 段、格內折行用 U+2028、其餘段原樣不動", () => {
  const d = baseDraft();
  P.applyBriefToDraft(d, P.parseBrief(briefDoc("1. 新一 —— 新說明一")), {});
  const segs = d.page.hero["slogan-left"].split("\n");
  assert.strictEqual(segs[0], "給爸的" + FOLD + "不將就", "主標沒用折行記號接");
  assert.deepStrictEqual(segs.slice(1), ["限時貼紙", "85", "跑馬帶"], "其他段被動到了");
});

test("落地：樓層標題兩份複本一起改；v2 第二段「放什麼」只給機器、不再灌進小標籤（2026-09-14 實走更正）", () => {
  const d = baseDraft();
  const subBefore = d.page.floors.map((f) => f.subtitle), scBefore = d.page.floors.map((f) => f.sceneCopy.sub);
  P.applyBriefToDraft(d, P.parseBrief(briefDoc("1. 新一 —— 瓦斯爐、烤盤\n2. 新二 —— 計時器")), {});
  assert.deepStrictEqual(d.page.floors.map((f) => f.title), ["新一", "新二"]);
  assert.deepStrictEqual(d.page.floors.map((f) => f.sceneCopy.title), ["新一", "新二"], "sceneCopy 沒跟上");
  /* 前台樓層沒有副標位，「放什麼」是給機器挑商品的字——寫進 subtitle／sceneCopy.sub 只會讓情境卡小標籤變成品類清單（09-14 使用者實走病例） */
  assert.deepStrictEqual(d.page.floors.map((f) => f.subtitle), subBefore, "兩段寫法不得動 subtitle");
  assert.deepStrictEqual(d.page.floors.map((f) => f.sceneCopy.sub), scBefore, "兩段寫法不得動 sceneCopy.sub");
});

test("落地 v2：第三段短賣點進 subtitle／sceneCopy.sub 兩份複本；第四段進小標籤 tag（牆 cms-layout-fit Q3 甲）", () => {
  const d = baseDraft();
  const r = P.parseBrief(briefDoc("1. 新一 —— 瓦斯爐 —— 開火就靠它 —— 開火\n2. 新二 —— 計時器 —— 煮麵不過頭"));
  assert.deepStrictEqual(r.data.floors.map((f) => [f.hint, f.pitch, f.tag]), [["瓦斯爐", "開火就靠它", "開火"], ["計時器", "煮麵不過頭", ""]]);
  const tagBefore = d.page.floors[1].sceneCopy.tag;
  P.applyBriefToDraft(d, r, {});
  assert.deepStrictEqual(d.page.floors.map((f) => f.subtitle), ["開火就靠它", "煮麵不過頭"]);
  assert.deepStrictEqual(d.page.floors.map((f) => f.sceneCopy.sub), ["開火就靠它", "煮麵不過頭"], "sceneCopy.sub 沒跟上（兩份複本）");
  assert.strictEqual(d.page.floors[0].sceneCopy.tag, "開火", "第四段要換掉小標籤");
  assert.strictEqual(d.page.floors[1].sceneCopy.tag, tagBefore, "沒寫第四段＝小標籤維持機器預設，不自己剪標題");
  /* 提醒：短賣點超 8 字、小標籤超 2 字、沒寫短賣點都要出聲（軟提醒不擋） */
  const r2 = P.parseBrief(briefDoc("1. 一 —— a —— 這句話明明就超過八個字了 —— 三個字\n2. 二 —— b"));
  assert.ok(r2.notices.some((n) => /短賣點超過 8 個字/.test(n.say)));
  assert.ok(r2.notices.some((n) => /小標籤）超過 2 個字/.test(n.say)));
  assert.ok(r2.notices.some((n) => /沒寫短賣點/.test(n.say)));
});

test("落地 v2：牆標題／編輯精選／眉標＝人寫機器搬（牆 cms-layout-fit Q4 甲）；沒有位置的要出聲不硬塞", () => {
  const H2 = Object.fromEntries(FMT.sections().map((s) => [s.key, s.heading]));
  const doc2 = `# ${H2.overview}\n測試\n# ${H2.walls}\n1. 牆一\n牆二\n牆三\n牆四\n# ${H2.editorial}\n第一行\n第二行\n# ${H2.eyebrow}\n只有這行\n第二行不要`;
  const r = P.parseBrief(doc2);
  assert.strictEqual(r.ok, true);
  assert.deepStrictEqual(r.data.walls.map((w) => w.title), ["牆一", "牆二", "牆三"], "牆最多三面、前綴要剝");
  assert.deepStrictEqual(r.data.walls.map((w) => w.hint), ["", "", ""]);
  assert.ok(r.notices.some((n) => /4 面牆的標題.*最多 3 面/.test(n.say)), "多寫的牆沒出聲");
  assert.deepStrictEqual(r.data.editorial, ["第一行", "第二行"]);
  assert.strictEqual(r.data.eyebrow, "只有這行");
  assert.ok(r.notices.some((n) => /只有一行的位置/.test(n.say)), "眉標多行沒出聲");
  /* 套用：牆只改對得上的幾面；編輯精選只換人寫的行、第三行留機器；眉標寫進 kv.eyebrowZh＋這款版型「眉標」那一段 */
  const d = baseDraft();
  d.page.walls = [{ title: "更多選品一次看" }, { title: "追加補貨清單" }];
  d.page.editorial = { title: ["主標", "拆行", "編輯室嚴選提案"] };
  d.page.kvVariant = "layout-008"; d.page.hero = { "slogan-left": "大標" };
  const ap = P.applyBriefToDraft(d, r, {});
  assert.deepStrictEqual(d.page.walls.map((w) => w.title), ["牆一", "牆二"]);
  assert.ok(ap.notes.some((n) => /3 面牆的標題，這個活動只有 2 面/.test(n.say)));
  assert.deepStrictEqual(d.page.editorial.title, ["第一行", "第二行", "編輯室嚴選提案"]);
  assert.strictEqual(d.page.kv.eyebrowZh, "只有這行");
  assert.strictEqual(d.page.hero["slogan-left"].split("\n")[1], "只有這行", "008 的眉標＝slogan-left 第 2 段（主視覺文字段落表）");
  assert.ok(["walls", "editorial", "eyebrow"].every((k) => ap.applied.includes(k)), JSON.stringify(ap.applied));
  /* 沒有眉標位的版型（012）＝出聲不套、hero 不動 */
  const d2 = baseDraft(); d2.page.kvVariant = "layout-012"; d2.page.hero = { "slogan-left": "大標" };
  const ap2 = P.applyBriefToDraft(d2, P.parseBrief(`# ${H2.overview}\n測試\n# ${H2.eyebrow}\n小字`), {});
  assert.strictEqual(d2.page.hero["slogan-left"], "大標");
  assert.ok(!ap2.applied.includes("eyebrow"));
  assert.ok(ap2.notes.some((n) => /沒有小字的位置/.test(n.say)));
  /* 沒有編輯精選區＝出聲不套 */
  const d3 = baseDraft(); delete d3.page.editorial;
  const ap3 = P.applyBriefToDraft(d3, P.parseBrief(`# ${H2.overview}\n測試\n# ${H2.editorial}\n一句`), {});
  assert.ok(!ap3.applied.includes("editorial") && ap3.notes.some((n) => /沒有編輯精選區/.test(n.say)));
});

test("落地：一根寒毛都不碰真值（價格／連結／劃線價／檔期／商品綁定）", () => {
  const d = baseDraft();
  const before = JSON.stringify({ p: d.products, kv: d.page.kv, binds: d.page.floors.map((f) => f.productGdids) });
  P.applyBriefToDraft(d, P.parseBrief(briefDoc("1. 新一 —— 新說明一\n2. 新二 —— 新說明二")), {});
  const after = JSON.stringify({ p: d.products, kv: d.page.kv, binds: d.page.floors.map((f) => f.productGdids) });
  assert.strictEqual(after, before, "真值或商品綁定被動到了——這是 money-facing，不容一點偏差");
});

test("落地：不新增也不刪除樓層；多了少了都出聲", () => {
  const more = baseDraft();
  const r1 = P.applyBriefToDraft(more, P.parseBrief(briefDoc("1. A —— a\n2. B —— b\n3. C —— c")), {});
  assert.strictEqual(more.page.floors.length, 2, "樓層數被改了——樓層帶商品綁定，不該由劇本增刪");
  assert.ok(r1.notes.some((n) => /劇本寫了 3 層.*只有 2 層/.test(n.say)), "多出來的樓層沒出聲");

  const less = baseDraft();
  const r2 = P.applyBriefToDraft(less, P.parseBrief(briefDoc("1. 只有一層 —— x")), {});
  assert.strictEqual(less.page.floors.length, 2);
  assert.strictEqual(less.page.floors[1].title, "舊二", "沒對到的那層應維持原標題");
  assert.ok(r2.notes.some((n) => /沒對到的那幾層維持原本的標題/.test(n.say)), "少的那幾層沒出聲");
});

test("落地：titleSource 不動（04 號定稿兩種值，U19 規則綁著它）", () => {
  const d = baseDraft();
  P.applyBriefToDraft(d, P.parseBrief(briefDoc("1. 新一 —— 新說明一")), {});
  assert.deepStrictEqual(d.page.floors.map((f) => f.titleSource), ["ai-curated", "ai-curated"], "劇本不該擴充別人的定稿契約");
});

test("落地：來源記帳寫進 meta.brief，畫面才講得出哪些是系統填的", () => {
  const d = baseDraft();
  P.applyBriefToDraft(d, P.parseBrief(briefDoc("1. 新一 —— 新說明一")), { file: "mine/父親節.md" });
  const m = d.meta.brief;
  assert.strictEqual(m.file, "mine/父親節.md");
  assert.deepStrictEqual(m.applied.slice().sort(), ["floors", "title"]);
  assert.strictEqual(m.provenance.title, "brief");
  assert.strictEqual(m.provenance.tone, "missing", "沒填的段落要記成 missing");
  assert.ok(Array.isArray(m.notices));
  assert.ok(m.appliedAt && !Number.isNaN(Date.parse(m.appliedAt)));
});

test("落地：沒過檢查的劇本一律不套用（擋在門口，不是套一半）", () => {
  const d = baseDraft();
  const snapshot = JSON.stringify(d);
  const bad = P.parseBrief(`# ${H[1]}\n只有主標沒有必填段\n`);
  assert.strictEqual(bad.ok, false);
  assert.throws(() => P.applyBriefToDraft(d, bad, {}), /還沒通過檢查/);
  assert.strictEqual(JSON.stringify(d), snapshot, "擋下時不該留下任何半套修改");
});

test("人寫的標題只掛在對得上的模組上（2026-09-14 使用者實走：收尾清潔底下一排計時器、醬料與調味底下是計時器）", () => {
  const H2 = Object.fromEntries(FMT.sections().map((s) => [s.key, s.heading]));
  const doc2 = `# ${H2.overview}\n測試\n# ${H2.floors}\n1. 烤肉必備 —— 瓦斯爐 —— 開火\n2. 收尾清潔 —— 洗碗精 —— 收乾淨\n3. 只有標題\n# ${H2.walls}\n醬料與調味 —— 烤肉醬\n飲料與冰品 —— 啤酒\n沒寫放什麼\n# ${H2.editorial}\n中秋烤肉\n一次備齊`;
  const r = P.parseBrief(doc2);
  assert.deepStrictEqual(r.data.walls[0], { title: "醬料與調味", hint: "烤肉醬" });
  assert.ok(r.notices.some((n) => /1 面牆只寫了標題、沒寫放什麼/.test(n.say)));
  const d = baseDraft();
  d.page.floors.push({ title: "質感首選", subtitle: "s3", sceneCopy: { tag: "質感", title: "質感首選", sub: "s3" }, productGdids: [] });
  d.page.walls = [{ title: "更多選品一次看" }, { title: "追加補貨清單" }, { title: "順手加購小物" }];
  d.page.editorial = { title: ["主標", "拆行", "編輯室嚴選提案"] };
  /* 帳：第一層對到 3、第二層零命中、第三層沒字（機器）；第一面牆零命中、第二面對到 2、第三面沒字 */
  d.meta.briefSelection = { exclude: null, include: null, priority: null,
    floors: [{ title: "烤肉必備", words: ["瓦斯爐"], machine: false, matched: 3, filled: 1, zeroHit: false }, { title: "收尾清潔", words: ["洗碗精"], machine: false, matched: 0, filled: 4, zeroHit: true }, { title: "只有標題", words: [], machine: true, matched: 0, filled: 4 }],
    walls: [{ title: "醬料與調味", words: ["烤肉醬"], machine: false, matched: 0, filled: 4, zeroHit: true }, { title: "飲料與冰品", words: ["啤酒"], machine: false, matched: 2, filled: 2, zeroHit: false }, { title: "沒寫放什麼", words: [], machine: true, matched: 0, filled: 4 }] };
  /* 整批對不太上（fit low）：沒寫字的層與牆、編輯精選都不掛人的字 */
  const ap = P.applyBriefToDraft(d, r, { productNames: TIMERS });
  assert.ok(d.meta.brief.fit.low);
  assert.deepStrictEqual(d.page.floors.map((f) => f.title), ["烤肉必備", "舊二", "質感首選"], "對到的掛、零命中的不掛、沒字且整批對不上的不掛");
  assert.strictEqual(d.page.floors[1].sceneCopy.sub, "舊說明二", "零命中的層小標籤也不掛");
  assert.deepStrictEqual(d.page.walls.map((w) => w.title), ["更多選品一次看", "飲料與冰品", "順手加購小物"]);
  assert.deepStrictEqual(d.page.editorial.title, ["主標", "拆行", "編輯室嚴選提案"], "整批對不上＝編輯精選那一句不掛");
  const says = d.meta.brief.notices.map((n) => n.say);
  assert.ok(says.some((x) => /「收尾清潔」這層照你寫的「洗碗精」一件都沒找到——標題與小標籤先用系統預設/.test(x)), says.join("\n"));
  assert.ok(says.some((x) => /「只有標題」這層沒寫放什麼，而這批商品跟策略檔對不太上——標題先用系統預設/.test(x)));
  assert.ok(says.some((x) => /「醬料與調味」這面牆照你寫的「烤肉醬」一件都沒找到——標題先用系統預設/.test(x)));
  assert.ok(says.some((x) => /「沒寫放什麼」這面牆沒寫放什麼，而這批商品跟策略檔對不太上/.test(x)));
  assert.ok(says.some((x) => /「編輯精選那一句」先用系統預設/.test(x)));
  assert.ok(ap.applied.includes("floors") && ap.applied.includes("walls") && !ap.applied.includes("editorial"));
  /* 整批對得上（fit 不低）：沒字的層與牆照掛、編輯精選照掛；零命中的仍不掛 */
  const d2 = baseDraft();
  d2.page.floors.push({ title: "質感首選", subtitle: "s3", sceneCopy: { tag: "質感", title: "質感首選", sub: "s3" }, productGdids: [] });
  d2.page.walls = [{ title: "更多選品一次看" }, { title: "追加補貨清單" }, { title: "順手加購小物" }];
  d2.page.editorial = { title: ["主標", "拆行", "編輯室嚴選提案"] };
  d2.meta.briefSelection = d.meta.briefSelection;
  P.applyBriefToDraft(d2, r, { productNames: BBQ });
  assert.ok(!d2.meta.brief.fit.low);
  assert.deepStrictEqual(d2.page.floors.map((f) => f.title), ["烤肉必備", "舊二", "只有標題"]);
  assert.deepStrictEqual(d2.page.walls.map((w) => w.title), ["更多選品一次看", "飲料與冰品", "沒寫放什麼"]);
  assert.deepStrictEqual(d2.page.editorial.title, ["中秋烤肉", "一次備齊", "編輯室嚴選提案"]);
});

/* ---------- 主標照版面找格子（2026-09-24；病例 run 174314：策略檔主標寫死 slogan-left，六款版面的主標格是 title-center＝人寫的主標從沒上過畫面） ---------- */
const LAYOUT = require("../../lib/layout_choice.js");
test("主標落在這款版面「主標」那一格：12 款逐款；其餘段不動；不多出一格沒人讀的槽；kv 兩行同步", () => {
  const r = P.parseBrief(briefDoc("1. 新一 —— 新說明一").replace("給爸的\n不將就", "日用品\n一次囤齊"));
  assert.deepStrictEqual(r.data.title, ["日用品", "一次囤齊"]);
  for (const [layout, pieces] of Object.entries(LAYOUT.HERO_TEXT_PIECES)) {
    const [slot, labels] = Object.entries(pieces)[0];
    const seed = labels.map((lb, i) => `舊第${i}段`); // 每段都有值＝驗「只換主標段」
    const d = baseDraft(); d.page.kvVariant = layout; d.page.hero = { [slot]: seed.join("\n") };
    d.page.kv.titleLine1 = "白蘭"; d.page.kv.titleLine2 = "精選好物";
    const ap = P.applyBriefToDraft(d, r, {});
    assert.ok(ap.applied.includes("title"), layout + " 主標沒套");
    const ts = LAYOUT.titleSlotFor(layout);
    assert.strictEqual(ts.slot, slot, layout);
    const segs = d.page.hero[slot].split("\n");
    if (ts.secondIndex != null) { assert.strictEqual(segs[ts.index], "日用品", layout + " 上行"); assert.strictEqual(segs[ts.secondIndex], "一次囤齊", layout + " 下行"); }
    else assert.strictEqual(segs[ts.index], "日用品" + FOLD + "一次囤齊", layout + " 主標段");
    labels.forEach((lb, i) => { if (i !== ts.index && i !== ts.secondIndex) assert.strictEqual(segs[i], `舊第${i}段`, `${layout} 第 ${i} 段被動到`); });
    const other = slot === "title-center" ? "slogan-left" : "title-center";
    assert.ok(!(other in d.page.hero), `${layout} 多出一格沒人讀的 ${other}（病例的形狀）`);
    assert.strictEqual(d.page.kv.titleLine1, "日用品", layout + " kv 第一行沒同步"); assert.strictEqual(d.page.kv.titleLine2, "一次囤齊", layout + " kv 第二行沒同步");
  }
});

test("舊殼（沒標版式）主標照舊寫 slogan-left、只有 title-center 就寫那格；kv 原本沒有標題兩行＝不硬加", () => {
  const d = baseDraft(); // 無 kvVariant、hero 只有 slogan-left、kv 沒有 titleLine
  P.applyBriefToDraft(d, P.parseBrief(briefDoc("1. 新一 —— a")), {});
  assert.strictEqual(d.page.hero["slogan-left"].split("\n")[0], "給爸的" + FOLD + "不將就");
  assert.ok(!("titleLine1" in d.page.kv), "kv 原本沒有那兩行＝不加（別改別人的形狀）");
  const d2 = baseDraft(); d2.page.hero = { "title-center": "舊" };
  P.applyBriefToDraft(d2, P.parseBrief(briefDoc("1. 新一 —— a")), {});
  assert.strictEqual(d2.page.hero["title-center"], "給爸的" + FOLD + "不將就");
  assert.ok(!("slogan-left" in d2.page.hero));
});

/* ---------- 對不到的層／牆＝標題照底下實際商品補（2026-09-24 使用者裁「機器照商品自動補標題＋可一鍵換」） ---------- */
test("零命中的層＝標題照底下商品補（兩份複本一起）、小標籤與短賣點不拿人那段的字、記 meta.brief.autoTitles、提醒句講得出補了什麼；牆同理", () => {
  const H2 = Object.fromEntries(FMT.sections().map((s) => [s.key, s.heading]));
  const doc2 = `# ${H2.overview}\n日用品\n# ${H2.floors}\n1. 紙類囤起來 —— 廚房紙巾 —— 家裡永遠不嫌多\n2. 口腔保健 —— 牙膏、牙刷 —— 每天都用得到\n# ${H2.walls}\n刷牙小物 —— 牙線`;
  const r = P.parseBrief(doc2); assert.strictEqual(r.ok, true);
  const d = baseDraft();
  d.page.floors = [
    { title: "主打嚴選", subtitle: "s1", titleSource: "ai-curated", sceneCopy: { tag: "嚴選", title: "主打嚴選", sub: "s1" }, productGdids: ["p1", "p2"] },
    { title: "質感首選", subtitle: "s3", titleSource: "ai-curated", sceneCopy: { tag: "質感", title: "質感首選", sub: "s3" }, productGdids: ["d1", "d2"] },
  ];
  d.page.walls = [{ title: "順手加購小物", productGdids: ["w1", "w2", "w3"] }];
  /* run 174314 真的分到的商品名（品牌開頭、規格在括號裡、品類壓尾端） */
  d.products = [
    { gdid: "p0", position: "featured-1-scene", name: "Vinda Snoopy限定版掛牆式全能萬用廚房紙巾(168抽x12包)", price: 1, url: "https://tw.buy.yahoo.com/a" },
    { gdid: "p1", position: "featured-1", name: "Vinda Snoopy限定版全能萬用捲筒式廚房紙巾(6捲x8串/箱)", price: 1, url: "https://tw.buy.yahoo.com/b" },
    { gdid: "p2", position: "featured-1", name: "Vinda Snoopy限定版全能萬用抽取式廚房紙巾(80抽x3包x12串)", price: 1, url: "https://tw.buy.yahoo.com/c" },
    { gdid: "d0", position: "featured-2-scene", name: "包大人 替換式尿片 乾爽吸收/整夜熟睡50x24cm(6包/箱購)", price: 1, url: "https://tw.buy.yahoo.com/d" },
    { gdid: "d1", position: "featured-2", name: "包大人 替換式尿片 乾爽吸收/整夜熟睡 量販包(6包/箱購)", price: 1, url: "https://tw.buy.yahoo.com/e" },
    { gdid: "d2", position: "featured-2", name: "包大人 替換式尿片 極緻好眠透氣特長63.5*24cm(14片x6包/箱購)", price: 1, url: "https://tw.buy.yahoo.com/f" },
    { gdid: "w1", position: "category-1", name: "包大人 加厚型 濕紙巾 (80抽x24包/箱購)", price: 1, url: "https://tw.buy.yahoo.com/g" },
    { gdid: "w2", position: "category-1", name: "添寧 加大加厚型 純水潔膚濕紙巾 (40抽x12包/箱購)", price: 1, url: "https://tw.buy.yahoo.com/h" },
    { gdid: "w3", position: "category-1", name: "康乃馨 純水濕紙巾 80抽x12包", price: 1, url: "https://tw.buy.yahoo.com/i" },
  ];
  d.meta.briefSelection = { exclude: null, include: null, priority: null, kv: null,
    floors: [{ title: "紙類囤起來", words: ["廚房紙巾"], machine: false, matched: 4, filled: 0, zeroHit: false }, { title: "口腔保健", words: ["牙膏", "牙刷"], machine: false, matched: 0, filled: 4, zeroHit: true }],
    walls: [{ title: "刷牙小物", words: ["牙線"], machine: false, matched: 0, filled: 4, zeroHit: true }] };
  const ap = P.applyBriefToDraft(d, r, { file: "mine/x.md" });
  assert.strictEqual(d.page.floors[0].title, "紙類囤起來", "對得上的層照掛人的字");
  assert.strictEqual(d.page.floors[1].title, "替換式尿片", "零命中的層＝標題照底下商品補");
  assert.strictEqual(d.page.floors[1].sceneCopy.title, "替換式尿片", "情境卡標題那份複本一起補");
  assert.strictEqual(d.page.floors[1].sceneCopy.tag, "質感", "小標籤維持機器預設（不拿口腔那段的字）");
  assert.strictEqual(d.page.floors[1].subtitle, "s3", "短賣點不拿口腔那段的字");
  assert.strictEqual(d.page.walls[0].title, "濕紙巾", "牆標題照商品補");
  assert.ok(ap.applied.includes("autoTitles"), JSON.stringify(ap.applied));
  const at = d.meta.brief.autoTitles;
  assert.strictEqual(at.length, 2);
  assert.deepStrictEqual({ kind: at[0].kind, index: at[0].index, title: at[0].title, wanted: at[0].wanted, words: at[0].words }, { kind: "floor", index: 1, title: "替換式尿片", wanted: "口腔保健", words: ["牙膏", "牙刷"] });
  assert.strictEqual(at[0].candidates[0], "替換式尿片");
  assert.deepStrictEqual([at[1].kind, at[1].index, at[1].title], ["wall", 0, "濕紙巾"]);
  const says = d.meta.brief.notices.map((n) => n.say);
  assert.ok(says.some((s) => /「口腔保健」這層照你寫的「牙膏、牙刷」一件都沒找到——這批商品裡沒有這類；標題先照底下實際商品改成「替換式尿片」（系統照商品補的，樓層那格旁邊可以一鍵換），底下 4 件是機器補的。/.test(s)), says.join("\n"));
  assert.ok(says.some((s) => /「刷牙小物」這面牆.*改成「濕紙巾」（系統照商品補的/.test(s)), says.join("\n"));
  /* 底下商品名各講各的（沒有一半以上共同的字）＝擷不出品類詞＝維持機器預設、照舊出聲 */
  const d2 = baseDraft();
  d2.page.floors = [{ title: "質感首選", subtitle: "s", titleSource: "ai-curated", sceneCopy: { tag: "質感", title: "質感首選", sub: "s" }, productGdids: ["x1", "x2", "x3", "x4"] }];
  d2.products = [["x1", "岩谷 卡式瓦斯爐"], ["x2", "dretec 計時器"], ["x3", "無印 掛鐘"], ["x4", "木炭 5 公斤"]].map(([g, n]) => ({ gdid: g, position: "featured-1", name: n, price: 1, url: "https://tw.buy.yahoo.com/" + g }));
  d2.meta.briefSelection = { exclude: null, include: null, priority: null, kv: null, floors: [{ title: "口腔保健", words: ["牙膏"], machine: false, matched: 0, filled: 4, zeroHit: true }] };
  const ap2 = P.applyBriefToDraft(d2, P.parseBrief(`# ${H2.overview}\n測\n# ${H2.floors}\n1. 口腔保健 —— 牙膏`), {});
  assert.strictEqual(d2.page.floors[0].title, "質感首選");
  assert.ok(!ap2.applied.includes("autoTitles")); assert.deepStrictEqual(d2.meta.brief.autoTitles, []);
  assert.ok(d2.meta.brief.notices.some((n) => /「口腔保健」這層照你寫的「牙膏」一件都沒找到——標題與小標籤先用系統預設/.test(n.say)));
});
