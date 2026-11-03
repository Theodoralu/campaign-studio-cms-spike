/* 策略檔跟這批商品對不對得上——預檢（71 號方案 A 階段一，2026-09-11）。
   ------------------------------------------------------------------
   病例：策略檔寫中秋烤肉、來源是計時器品類，樓層標題照落、商品照機器挑，「收尾清潔」底下一排計時器，
   26 項把關一路無聲通過。這支測試守的是「會不會出聲」與「該安靜時安靜」，不守文案字句（那是使用者過目的）。

   另守一條做人的規矩：切詞只有一把刀（lib/theme_keywords）。server.js 建立時派生 CP-14 詞組、這裡算對不對得上，
   兩邊若各抄一份、切法一漂就會對同一批商品算出兩個答案（鐵律 4「同類幾處」）。 */
"use strict";
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const P = require("../../lib/curation_brief.js");
const { deriveThemeKeywords } = require("../../lib/theme_keywords.js");

const TIMERS = ["廚房計時器 60 分鐘 機械式", "數位計時器 磁吸 大螢幕", "學習計時器 靜音 番茄鐘", "倒數計時器 防水 白色",
  "計時器 兒童 可愛動物", "電子計時器 雙組", "料理計時器 旋轉", "沙漏計時器 30 分", "智慧計時器 App 連動", "計時器 磁鐵 掛勾"];
const BBQ = ["烤肉架 折疊 不鏽鋼", "烤肉串 竹籤 200 支", "烤肉夾 加長 防燙", "木炭 5 公斤 環保炭", "烤肉網 圓形 替換",
  "烤肉醬 韓式 三入", "牛排 美國 Choice 肋眼", "烤肉手套 隔熱", "洗碗精 檸檬 大瓶", "廚房紙巾 三層 6 捲"];
const BBQ_BRIEF = { title: ["中秋烤肉", "一次備齊"],
  floors: [{ title: "主菜先備", hint: "烤肉串、牛排、木炭" }, { title: "工具到位", hint: "烤肉架、烤肉夾、烤肉網" }, { title: "收尾清潔", hint: "洗碗精、廚房紙巾" }],
  selection: { include: "烤肉、木炭", exclude: "計時器", priority: "牛排" } };

test("中秋烤肉的策略檔對上計時器商品池＝出聲（low）", () => {
  const r = P.briefFit(BBQ_BRIEF, TIMERS);
  assert.ok(r.comparable);
  /* 第一版寫 hit===0，實跑是 1：「廚房紙巾」切出「廚房」、對上「廚房計時器」。這是 2-gram 的天性（提示裡的品類名帶出鄰近詞），
     30% 門檻本來就是為了容這種零星撞字——所以守的是「有沒有出聲」，不是「一件都不准撞」。 */
  assert.ok(r.ratio < 0.3, `計時器池對烤肉策略檔的命中率應遠低於門檻：${r.hit}/${r.total}`);
  assert.ok(r.low, "命中率低於門檻卻沒出聲");
});

test("同一份策略檔對上烤肉商品池＝安靜（不假警報）", () => {
  const r = P.briefFit(BBQ_BRIEF, BBQ);
  assert.ok(r.ratio >= 0.3, `烤肉池命中率應過門檻：${r.hit}/${r.total}`);
  assert.strictEqual(r.low, false);
});

test("「避開」的字不算命中——寫了避開計時器，不能反過來讓計時器池變成對得上", () => {
  const r = P.briefFit({ title: ["中秋烤肉"], floors: [], selection: { include: "", exclude: "計時器", priority: "" } }, TIMERS);
  assert.strictEqual(r.hit, 0, "避開的詞被拿去比對了");
  assert.ok(r.low);
});

test("「放什麼」提示會被拿來比對（同事照範本在標題後面寫的品類名，就是對得上的關鍵）", () => {
  const onlyTitles = P.briefFit({ title: [], floors: [{ title: "暖心時刻", hint: "" }] }, BBQ);
  const withHint = P.briefFit({ title: [], floors: [{ title: "暖心時刻", hint: "烤肉架、木炭" }] }, BBQ);
  assert.ok(withHint.hit > onlyTitles.hit, "提示裡的品類名沒有提高命中");
});

test("沒商品、或策略檔沒有可比的字＝不出聲（是「沒得比」，不是「對不上」）", () => {
  assert.strictEqual(P.briefFit(BBQ_BRIEF, []).low, false);
  assert.strictEqual(P.briefFit(BBQ_BRIEF, []).comparable, false);
  const empty = P.briefFit({ title: [], floors: [], selection: {} }, TIMERS);
  assert.strictEqual(empty.comparable, false);
  assert.strictEqual(empty.low, false);
});

test("門檻由呼叫端傳（跟 gate 的主題契合閘同一個數字）；沒傳＝0.3 預設", () => {
  assert.strictEqual(P.FIT_DEFAULT_THRESHOLD, 0.3);
  const names = [...BBQ.slice(0, 4), ...TIMERS.slice(1, 7)]; // 4/10 命中（避開「廚房計時器」——它會被「廚房紙巾」的「廚房」撞到）
  assert.strictEqual(P.briefFit(BBQ_BRIEF, names).low, false, "40% 對 0.3 不該出聲");
  assert.strictEqual(P.briefFit(BBQ_BRIEF, names, { threshold: 0.5 }).low, true, "40% 對 0.5 該出聲");
});

test("切詞只有一把刀：server.js 不得再自帶 deriveThemeKeywords，要 require lib", () => {
  const src = fs.readFileSync(path.resolve(__dirname, "..", "..", "workbench", "server.js"), "utf8");
  assert.doesNotMatch(src, /function deriveThemeKeywords\s*\(/, "server.js 又長出自己的一份切詞——會跟 lib 漂開");
  assert.match(src, /require\("\.\.\/lib\/theme_keywords"\)/, "server.js 沒有從 lib 拿切詞");
  /* 切法本身沒漂：全串小寫＋數字＋英文＋中文 2-gram */
  assert.deepStrictEqual(new Set(deriveThemeKeywords("中秋烤肉 BBQ 2026")), new Set(["中秋烤肉 bbq 2026", "2026", "bbq", "中秋", "秋烤", "烤肉"]));
});

/* 階段一接線＋階段二折句（2026-09-14）：applyBriefToDraft 拿到商品池名單就要算對不對得上、拿到選品帳就要折成人話；
   頁級那句排第一、層級句跟在後面；沒有帳但寫了多放／避開＝走的是 AI 路，要講沒生效（裁 3 乙）。 */
test("applyBriefToDraft：對不太上排第一句、選品帳折句跟後、有帳才算生效", () => {
  const parsed = { ok: true, data: BBQ_BRIEF, provenance: { title: "brief", floors: "brief", selection: "brief" }, notices: [] };
  const draft = { page: { floors: [{ title: "a", subtitle: "" }, { title: "b", subtitle: "" }, { title: "c", subtitle: "" }] },
    meta: { briefSelection: { exclude: { words: ["計時器"], before: 10, removed: 0, after: 10, zeroHit: true }, include: null, priority: null,
      floors: [{ title: "主菜先備", words: ["烤肉串", "牛排", "木炭"], machine: false, matched: 1, filled: 3, zeroHit: false }] } } };
  const r = P.applyBriefToDraft(draft, parsed, { file: "x.md", productNames: TIMERS });
  assert.ok(draft.meta.brief.fit && draft.meta.brief.fit.low, "拿到名單卻沒算對不對得上");
  const says = draft.meta.brief.notices.map((n) => n.say);
  assert.match(says[0], /^策略檔寫的東西跟這批商品對不太上——你寫的字在 10 件商品名裡只出現在 \d+ 件。$/, "頁級那句要排第一：" + says[0]);
  assert.ok(says.some((x) => /「主菜先備」這層照你寫的「烤肉串、牛排、木炭」只找到 1 件，另外 3 件是機器補的/.test(x)), "層級句沒折出來");
  assert.ok(says.some((x) => /「避開：計時器」沒有排掉任何商品/.test(x)), "避開零命中沒講");
  assert.ok(r.applied.includes("selection"), "有一層對到 1 件＝選品算生效");
});

test("applyBriefToDraft：沒有選品帳但寫了多放／避開＝AI 路，要講沒生效；沒給名單就不算 fit", () => {
  const parsed = { ok: true, data: { title: ["x"], floors: [], selection: { include: "3C", exclude: "", priority: "" } }, provenance: { title: "brief", selection: "brief" }, notices: [] };
  const draft = { page: {}, meta: {} };
  const r = P.applyBriefToDraft(draft, parsed, { file: "x.md" });
  assert.ok(!r.applied.includes("selection"));
  assert.ok(draft.meta.brief.notices.some((n) => /AI 策展這條路目前不讀選品方向/.test(n.say) && /快速草稿/.test(n.how)));
  assert.strictEqual(draft.meta.brief.fit, null, "沒給商品池名單＝不算、不假裝對得上");
});
