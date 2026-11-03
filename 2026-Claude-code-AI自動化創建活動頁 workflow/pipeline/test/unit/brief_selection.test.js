/* 策略檔指導選品（71 號方案 A 階段二；2026-09-14 使用者裁「依建議開工」）
   ------------------------------------------------------------------
   病例：策略檔寫「收尾清潔 —— 烤完要用的」，頁面那層底下一排計時器——標題聽人、商品聽機器。
   這支守四件：
     ①「避開」整頁不放、排掉再多都照排（裁 4 甲），零命中要出聲
     ②「多放」排最前、群內維持折數順序（穩定），零命中要出聲
     ③每層照「放什麼」的字挑、不夠機器補、帳要對（matched＋filled＝層件數）；對到的排第 1 件（情境卡代表品）
     ④沒帶策略檔＝池一件不動（curate_auto 舊行為逐位元組不變的前提）；帶了＝池一件不少一件不多不重複
   另守：伺服器兩個叫選品引擎的地方都要把策略檔帶過去（少一個＝AI 逾時降級那條路選品聽不到人話）。 */
"use strict";
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const BS = require("../../lib/brief_selection.js");

const P = (name, disc) => ({ gdid: String(Math.random()).slice(2, 10), name, disc });
/* 池照折數排好（curate_auto 交來時就是這樣）：瓦斯爐 3、計時器 6、時鐘 2、木炭 1＝12 件 */
const POOL = [
  P("岩谷 磁式瓦斯爐 4.1kW", 0.6), P("dretec 大螢幕時鐘計時器 T-792", 0.65), P("dretec 防水計時器 圓形 灰", 0.7),
  P("岩谷 卡式瓦斯爐 2.8kW", 0.72), P("dretec 雙計時 薄型計時器", 0.75), P("dretec 電子計時器 白 99 分", 0.78),
  P("木炭 5 公斤 環保炭", 0.8), P("dretec 學習計時器 靜音", 0.82), P("岩谷 防風瓦斯爐 綠", 0.85),
  P("無印 掛鐘 時鐘 白", 0.88), P("dretec 計時器 磁吸", 0.9), P("dretec 時鐘 鬧鐘 兩用", 0.95),
];
const names = (arr) => arr.map((p) => p.name);

test("splitWords：頓號／逗號／斜線／空白都能切，去重去空", () => {
  assert.deepStrictEqual(BS.splitWords("瓦斯爐、烤盤，烤肉夾／木炭 木炭  ,"), ["瓦斯爐", "烤盤", "烤肉夾", "木炭"]);
  assert.deepStrictEqual(BS.splitWords(""), []);
  assert.deepStrictEqual(BS.splitWords(null), []);
});

test("nameHits：整詞比對、不分大小寫；沒有字＝不命中", () => {
  assert.ok(BS.nameHits("岩谷 磁式瓦斯爐", ["瓦斯爐"]));
  assert.ok(BS.nameHits("Iwatani ZA-41", ["iwatani"]));
  assert.ok(!BS.nameHits("岩谷 磁式瓦斯爐", ["烤盤"]));
  assert.ok(!BS.nameHits("岩谷 磁式瓦斯爐", []));
});

test("④沒有策略檔內容＝池原樣不動（舊行為的前提）", () => {
  const r = BS.applySelection(POOL, { floors: [], selection: {} }, { kvCount: 3, floorSize: 4, floorMax: 3 });
  assert.deepStrictEqual(names(r.pool), names(POOL));
  assert.strictEqual(r.report.exclude, null); assert.strictEqual(r.report.include, null); assert.deepStrictEqual(r.report.floors, []);
});

test("①避開：整頁不放、帳對、排掉再多都照排（不放回去）", () => {
  const r = BS.applySelection(POOL, { floors: [], selection: { exclude: "計時器、時鐘" } }, { kvCount: 3, floorSize: 4, floorMax: 3 });
  assert.strictEqual(r.pool.length, 4, "12 件排掉 8 件計時器／時鐘＝剩 4（瓦斯爐 3＋木炭 1）");
  assert.ok(r.pool.every((p) => !/計時器|時鐘/.test(p.name)));
  assert.deepStrictEqual(r.report.exclude, { words: ["計時器", "時鐘"], before: 12, removed: 8, after: 4, zeroHit: false });
  const n = BS.selectionNotices(r.report);
  assert.ok(n.some((x) => /排掉了 8\/12 件，剩 4 件不夠排一頁/.test(x.say)), "排太多要大聲講（裁 4 甲）：" + JSON.stringify(n));
});

test("①避開零命中＝出聲教他寫商品字", () => {
  const r = BS.applySelection(POOL, { floors: [], selection: { exclude: "女性向" } }, {});
  assert.strictEqual(r.pool.length, 12);
  assert.strictEqual(r.report.exclude.zeroHit, true);
  const n = BS.selectionNotices(r.report);
  assert.ok(n.some((x) => /「避開：女性向」沒有排掉任何商品/.test(x.say) && /洋裝、裙/.test(x.how)));
});

test("②多放：排最前、群內維持原順序、其餘不動；零命中出聲", () => {
  const r = BS.applySelection(POOL, { floors: [], selection: { include: "瓦斯爐" } }, {});
  assert.deepStrictEqual(names(r.pool).slice(0, 3), ["岩谷 磁式瓦斯爐 4.1kW", "岩谷 卡式瓦斯爐 2.8kW", "岩谷 防風瓦斯爐 綠"], "三台爐排最前、彼此仍照折數");
  assert.strictEqual(r.pool.length, 12);
  assert.deepStrictEqual(r.report.include, { words: ["瓦斯爐"], boosted: 3, zeroHit: false });
  const z = BS.applySelection(POOL, { floors: [], selection: { include: "節慶關聯的" } }, {});
  assert.ok(BS.selectionNotices(z.report).some((x) => /「多放：節慶關聯的」沒有讓任何商品排前面/.test(x.say)));
});

test("③每層照字挑：對到的排第 1 件、不夠機器補、帳＝層件數；沒寫字的層＝機器", () => {
  const brief = { floors: [{ title: "開火", hint: "瓦斯爐" }, { title: "計時", hint: "計時器" }, { title: "第三層", hint: "" }], selection: { include: "木炭" } };
  const r = BS.applySelection(POOL, brief, { kvCount: 3, floorSize: 4, floorMax: 3 });
  /* KV 規則 2026-09-24 改（使用者裁「文案跟商品要對得起來」）：瓦斯爐只有 3 台、第一層要 4 件＝沒餘量→主打一台都不拿；
     計時器 6 台、第二層要 4＝餘量 2→主打拿 2 台當代表（拿到剛好剩 4 為止）；第 3 件從池頂補＝木炭（多放已排最前）。
     舊規則是「池頂前 3＝木炭、瓦斯爐 4.1、計時器 792」——主打會偷走第一層要的爐。 */
  const kv = names(r.pool).slice(0, 3);
  assert.deepStrictEqual(kv, ["dretec 大螢幕時鐘計時器 T-792", "dretec 防水計時器 圓形 灰", "木炭 5 公斤 環保炭"], "主打＝有餘量的層出代表、再池頂補；不拿沒餘量的層要的");
  assert.deepStrictEqual(r.report.kv, { fromFloors: [1, 1, null], matched: 2, filled: 1, protectedCount: 3 });
  const f1 = names(r.pool).slice(3, 7), f2 = names(r.pool).slice(7, 11);
  assert.ok(/瓦斯爐/.test(f1[0]), "第一層第 1 件（情境卡代表品）必須是他寫的東西：" + f1[0]);
  assert.strictEqual(f1.filter((n) => /瓦斯爐/.test(n)).length, 3, "三台爐全進第一層（主打沒偷）");
  /* 補齊不偷下一層的：第一層缺 1 件，池裡還有 4 台計時器（第二層要）與 2 個時鐘（沒人要）——補的必須是時鐘 */
  assert.ok(f1.slice(3).every((n) => /時鐘|掛鐘|鬧鐘/.test(n) && !/計時器/.test(n)), "第一層補齊拿走了第二層要的計時器：" + f1.join("｜"));
  assert.deepStrictEqual(r.report.floors[0], { title: "開火", words: ["瓦斯爐"], machine: false, matched: 3, filled: 1, zeroHit: false });
  assert.ok(f2.every((n) => /計時器/.test(n)), "第二層四件全是計時器：" + f2.join("｜"));
  assert.deepStrictEqual(r.report.floors[1], { title: "計時", words: ["計時器"], machine: false, matched: 4, filled: 0, zeroHit: false });
  assert.strictEqual(r.report.floors.length, 2, "12 件只放得下 KV3＋兩層＝第三層不算帳（容量與 curate_auto 同條）");
  assert.strictEqual(r.pool.length, 12); assert.strictEqual(new Set(r.pool).size, 12, "一件不少一件不多不重複");
  const n = BS.selectionNotices(r.report);
  assert.ok(n.some((x) => /「開火」這層照你寫的「瓦斯爐」只找到 3 件，另外 1 件是機器補的/.test(x.say)), JSON.stringify(n));
  assert.ok(!n.some((x) => /「計時」/.test(x.say)), "全對到的層不囉嗦");
});

test("主打不偷沒餘量的層要的（2026-09-24）：只有一層寫瓦斯爐（3 台、要 4）＝主打繞過三台爐；一層字都沒寫＝池頂前 3 不變", () => {
  const r = BS.applySelection(POOL, { floors: [{ title: "開火", hint: "瓦斯爐" }], selection: {} }, { kvCount: 3, floorSize: 4, floorMax: 3 });
  const kv = names(r.pool).slice(0, 3);
  assert.ok(kv.every((n) => !/瓦斯爐/.test(n)), "主打拿了第一層要的爐：" + kv.join("｜"));
  assert.deepStrictEqual(kv, ["dretec 大螢幕時鐘計時器 T-792", "dretec 防水計時器 圓形 灰", "dretec 雙計時 薄型計時器"], "跳過被保護的爐後照池頂順序補");
  assert.deepStrictEqual(r.report.kv, { fromFloors: [null, null, null], matched: 0, filled: 3, protectedCount: 3 });
  assert.strictEqual(names(r.pool).slice(3, 7).filter((n) => /瓦斯爐/.test(n)).length, 3, "三台爐全在第一層");
  assert.strictEqual(r.pool.length, 12); assert.strictEqual(new Set(r.pool).size, 12);
  /* 一層字都沒寫＝舊行為：主打＝池頂前 3、report.kv 沒帳 */
  const old = BS.applySelection(POOL, { floors: [{ title: "第一層" }, { title: "第二層" }], selection: {} }, { kvCount: 3, floorSize: 4, floorMax: 3 });
  assert.deepStrictEqual(names(old.pool).slice(0, 3), names(POOL).slice(0, 3));
  assert.strictEqual(old.report.kv, null);
});

test("categoryWords：從真實商品名擷取品類詞——品牌不當品類、規格括號不算、尾端的品類詞優先、子片段不重複收；空的回 []", () => {
  /* run 174314 第三層真的分到的三件（包大人＝每件開頭＝品牌，不能當標題） */
  const diapers = ["包大人 替換式尿片 乾爽吸收/整夜熟睡50x24cm(6包/箱購  搭配成人紙尿褲)", "包大人 替換式尿片 乾爽吸收/整夜熟睡 量販包(6包/箱購  搭配成人紙尿褲", "包大人 替換式尿片 極緻好眠透氣特長63.5*24cm(14片x6包/箱購 搭配成人紙尿褲/晚安/夜用)"];
  const c1 = BS.categoryWords(diapers);
  assert.strictEqual(c1[0], "替換式尿片", JSON.stringify(c1));
  assert.ok(!c1.some((w) => /包大人|包大|大人/.test(w)), "品牌片段進了候選：" + JSON.stringify(c1));
  assert.ok(!c1.some((w) => w !== "替換式尿片" && "替換式尿片".includes(w)), "子片段重複收：" + JSON.stringify(c1));
  /* 第一層真的分到的三件：中文名沒有空白切詞、品類壓在尾端 */
  const paper = ["Vinda Snoopy限定版全能萬用捲筒式廚房紙巾(6捲x8串/箱)", "Vinda Snoopy限定版全能萬用抽取式廚房紙巾(80抽x3包x12串)", "Vinda Snoopy限定版掛牆式全能萬用廚房紙巾(168抽x12包)"];
  const c2 = BS.categoryWords(paper);
  assert.strictEqual(c2[0], "廚房紙巾", JSON.stringify(c2));
  /* 洗衣那層：三件都有「補充包」、兩件有「洗衣精」——都進候選讓人一鍵換；毛寶（2/3 件開頭）＝品牌 */
  const wash = ["OMO 極淨速溶高效洗衣精 補充包_箱購2.0kgx6(瞬淨去漬/瞬淨除臭)", "毛寶 貼身衣物手洗精-補充包(800g)", "毛寶 葳香抗菌洗衣精-防蟎極淨-補充包(2000g)"];
  const c3 = BS.categoryWords(wash);
  assert.ok(c3.includes("補充包") && c3.includes("洗衣精"), JSON.stringify(c3));
  assert.ok(!c3.includes("毛寶"));
  /* run 174314 替身重放實證（第三層真的分到的四件）：只看件數會選到形容詞「親膚」（3/4 件都有）；品類名「成人紙尿褲」只在 2 件、但都壓在一段的尾端＝要贏 */
  const adult = ["包大人 高效防漏晚安褲M-L/L-XL(6包/箱購 褲型 成人紙尿褲 尿布/晚安褲/夜用安睡)", "包大人 親膚舒適成人紙尿褲M/L-XL(6包/箱購,黏貼型)", "包大人 親膚防漏量販包成人紙尿褲M/L-XL(6包/箱購,黏貼型)", "包大人 替換式尿片柔軟親膚50x20cm(30片x6包/箱購  搭配成人紙尿褲)"];
  const c4 = BS.categoryWords(adult);
  assert.strictEqual(c4[0], "成人紙尿褲", "形容詞贏了品類名：" + JSON.stringify(c4));
  assert.ok(c4.includes("親膚"), "形容詞仍留在候選讓人挑：" + JSON.stringify(c4));
  assert.deepStrictEqual(BS.categoryWords([]), []);
  assert.deepStrictEqual(BS.categoryWords(["ABC 123"]), [], "沒有中文＝擷不出");
  /* 整池找例子（對帳卡「回 Gemini 這樣說」）：minShare 0＝只照件數排 */
  const pool = BS.categoryWords(diapers.concat(paper, wash), { minShare: 0, max: 5 });
  assert.ok(pool.length === 5 && pool.includes("替換式尿片") && pool.includes("廚房紙巾"), JSON.stringify(pool));
});

test("selectionNotices：零命中的層／牆掛了 autoTitle＝講「照底下實際商品改成「X」」；沒掛＝照舊講「先用系統預設」", () => {
  const rep = { exclude: null, include: null, priority: null, kv: null,
    floors: [{ title: "口腔保健", words: ["牙膏", "牙刷"], machine: false, matched: 0, filled: 4, zeroHit: true, autoTitle: "替換式尿片" }],
    walls: [{ title: "刷牙小物", words: ["牙線"], machine: false, matched: 0, filled: 4, zeroHit: true, autoTitle: "濕紙巾" }, { title: "沒補到", words: ["牙間刷"], machine: false, matched: 0, filled: 4, zeroHit: true }] };
  const n = BS.selectionNotices(rep).map((x) => x.say + "｜" + x.how);
  assert.ok(n.some((s) => /「口腔保健」這層照你寫的「牙膏、牙刷」一件都沒找到——這批商品裡沒有這類；標題先照底下實際商品改成「替換式尿片」（系統照商品補的，樓層那格旁邊可以一鍵換），底下 4 件是機器補的。｜想放你原本寫的那類商品，換一個有它的來源再建一次。/.test(s)), n.join("\n"));
  assert.ok(n.some((s) => /「刷牙小物」這面牆.*改成「濕紙巾」（系統照商品補的，牆標題那格旁邊可以一鍵換）/.test(s)), n.join("\n"));
  assert.ok(n.some((s) => /「沒補到」這面牆照你寫的「牙間刷」一件都沒找到——標題先用系統預設/.test(s)), n.join("\n"));
});

test("③零命中的層：4 件全是機器補的＝出聲並教改字", () => {
  const r = BS.applySelection(POOL, { floors: [{ title: "收尾清潔", hint: "洗碗精、廚房紙巾" }], selection: {} }, { kvCount: 3, floorSize: 4, floorMax: 3 });
  assert.deepStrictEqual(r.report.floors[0], { title: "收尾清潔", words: ["洗碗精", "廚房紙巾"], machine: false, matched: 0, filled: 4, zeroHit: true });
  const n = BS.selectionNotices(r.report);
  assert.ok(n.some((x) => /「收尾清潔」這層照你寫的「洗碗精、廚房紙巾」一件都沒找到——標題與小標籤先用系統預設，底下 4 件是機器補的/.test(x.say) && /品類名/.test(x.how)), JSON.stringify(n));
});

test("「優先」寫了照樣進帳（不生效）但這裡不出聲——那句住 parseBrief，AI 路也聽得到", () => {
  const r = BS.applySelection(POOL, { floors: [], selection: { priority: "熱銷" } }, {});
  assert.deepStrictEqual(r.report.priority, { text: "熱銷", ignored: true });
  assert.deepStrictEqual(BS.selectionNotices(r.report), []);
  assert.deepStrictEqual(names(r.pool), names(POOL));
});

test("伺服器三個叫選品引擎的地方都帶策略檔（快速草稿路＋AI 逾時降級路＋照策略檔重做；2026-09-15 C 批加第三處）", () => {
  const s = fs.readFileSync(path.join(__dirname, "..", "..", "workbench", "server.js"), "utf8");
  const calls = s.split("\n").filter((l) => /runNode\(id, path\.join\(__dirname, "curate_auto\.js"\)/.test(l));
  assert.strictEqual(calls.length, 3, "叫選品引擎的地方變了（多了或少了）——請同步本測試與 brief-selection／brief-first-create-flow story");
  for (const l of calls) assert.match(l, /briefArgs|--brief/, "這個呼叫點沒帶策略檔：" + l.trim().slice(0, 120));
});

test("pickGroups：牆跟樓層同一把——件數由呼叫端給（4/8）、對到的排前、補的不偷下一面要的、零命中出聲", () => {
  const rest = POOL.slice(3); // 假裝 KV 拿走前 3
  const r = BS.pickGroups(rest, [{ title: "計時", hint: "計時器" }, { title: "看時間", hint: "時鐘" }, { title: "沒寫" }], [4, 4, 1]);
  assert.strictEqual(r.groups.length, 3);
  assert.ok(r.groups[0].every((p) => /計時器/.test(p.name)), "第一面全是計時器");
  assert.deepStrictEqual(r.report[0], { title: "計時", words: ["計時器"], machine: false, matched: 4, filled: 0, zeroHit: false });
  assert.ok(r.groups[1].filter((p) => /時鐘/.test(p.name) && !/計時器/.test(p.name)).length >= 1, "第二面要有時鐘");
  assert.strictEqual(r.report[2].machine, true, "沒寫字的那面＝機器照順序");
  assert.strictEqual(r.groups.flat().length + r.rest.length, rest.length, "一件不少一件不多");
  assert.strictEqual(new Set(r.groups.flat().concat(r.rest)).size, rest.length, "不重複");
  const z = BS.pickGroups(rest, [{ title: "醬料與調味", hint: "烤肉醬、醬油" }], [4]);
  assert.strictEqual(z.report[0].zeroHit, true);
  const n = BS.selectionNotices({ exclude: null, include: null, floors: [], walls: z.report });
  assert.ok(n.some((x) => /「醬料與調味」這面牆照你寫的「烤肉醬、醬油」一件都沒找到——標題先用系統預設/.test(x.say)), JSON.stringify(n));
});
