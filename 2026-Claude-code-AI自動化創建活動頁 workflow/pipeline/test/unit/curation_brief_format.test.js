/* 策展劇本格式＝單一真源絆線（2026-09-11 使用者裁決牆五題）。
   ------------------------------------------------------------------
   這批天生會生三份「同一件事」的複本：①同事的檔期範本 ②Gemini 助理指令 ③CMS 解析規則。
   只要三邊各自手寫，它們一定會漂——本專案今天一整天修的就是這個病。
   所以真源只有 lib/curation_brief_format.js 一份，另外兩份是它產的；本檔守的就是「沒有人偷偷手寫第二份」。

   守什麼：
     ①範本與助理指令的標題，逐字逐序等於真源
     ②未消費的段落必須在兩份產物裡都出聲（不得假裝生效）
     ③禁收真值欄位＝71 號 §4.2 原文清單，不得自行增減
     ④真值樣態該擋的會擋、策略描述不會被誤擋（自我測試：該紅會紅、該綠會綠）
     ⑤真源自己不准寫字數上限（那是第四份複本）
   不守什麼：段落該有哪幾個、文案怎麼寫——那是使用者裁的，改了就改測試裡的期望值。 */
"use strict";
const test = require("node:test");
const assert = require("node:assert");
const F = require("../../lib/curation_brief_format.js");

test("範本的標題＝真源的標題，逐字且同序", () => {
  const md = F.templateMarkdown();
  const inMd = md.split("\n").filter((l) => l.startsWith("# ")).map((l) => l.slice(2).trim());
  assert.deepStrictEqual(inMd, F.headings(), "範本標題跟真源對不上＝有人手改了產物");
});

test("Gemini 助理指令列的標題＝真源的標題，逐字且同序", () => {
  const g = F.gemInstructions();
  const listed = [...g.matchAll(/^\d+\. `# (.+?)`/gm)].map((m) => m[1]);
  assert.deepStrictEqual(listed, F.headings(), "助理指令跟真源對不上＝助理會產出解析器吃不下的東西");
  /* 指令裡附的每一個 markdown 範例區塊都要同源——助理照抄的就是這些。
     2026-09-11：補了「每段長什麼樣」的示範區塊後變成兩塊，原本整篇抓 `# ` 會把兩塊串在一起＝
     測試自己會誤報。改成逐區塊驗，比原本嚴。 */
  const blocks = [...g.matchAll(/```markdown\n([\s\S]*?)```/g)].map((m) => m[1]);
  assert.ok(blocks.length >= 2, `助理指令應含「示範」與「空白範本」兩個區塊，實際 ${blocks.length}`);
  blocks.forEach((blk, i) => {
    const hs = blk.split("\n").filter((l) => l.startsWith("# ")).map((l) => l.slice(2).trim());
    assert.deepStrictEqual(hs, F.headings(), `助理指令第 ${i + 1} 個範例區塊跟真源對不上`);
  });
});

test("還沒接上的段落，在範本與助理指令裡都要出聲；接上的不准再說「還不會」", () => {
  const pending = F.sections().filter((s) => !s.consumed);
  assert.deepStrictEqual(pending.map((s) => s.key).sort(), ["overview", "tone"], "未消費段落清單變了——接上或退場都要連同本測試一起改");
  for (const s of pending) {
    assert.ok(s.notConsumedNote && s.notConsumedNote.length > 10, `${s.key} 未消費卻沒寫出聲的說法`);
    assert.ok(!s.consumedBy, `${s.key} 標未消費卻寫了消費端`);
  }
  /* 「選品方向」2026-09-14 接上（71 號階段二，使用者裁依建議）：消費端要指得出來，範本與助理指令不得再說「還不會影響選哪些商品」 */
  const sel = F.sectionByKey("selection");
  assert.strictEqual(sel.consumed, true);
  assert.match(sel.consumedBy || "", /brief_selection\.js/, "消費端要指到程式檔");
  assert.ok(!F.templateMarkdown().includes("目前還不會影響選哪些商品"), "範本還在說選品方向不會生效");
  assert.ok(!F.gemInstructions().includes("目前還不會影響選哪些商品"), "助理指令還在說選品方向不會生效");
  /* 「優先」退場（裁 2 乙）：範本、指令、示範句都不能再教人寫它 */
  assert.ok(!/優先：/.test(sel.example), "示範句還教人寫「優先：」");
  assert.ok(F.templateMarkdown().includes("不用寫「優先」"), "範本沒講不用寫優先");
  assert.ok(F.gemInstructions().includes("不要寫「優先：」"), "助理指令沒講不要寫優先");
  assert.ok(F.gemInstructions().includes("商品名會出現的字"), "助理指令沒教「寫商品名會出現的字」——形容詞挑不到商品");
});

test("禁收真值欄位＝71 號 §4.2 原文清單，不得自行增減", () => {
  assert.deepStrictEqual(
    F.bannedFields().slice().sort(),
    ["actid", "dateValue", "gdid", "marketPrice", "offer", "period", "price", "url"],
    "禁收清單被改動——這是真值鐵律的結構性防線，要改先改 71 號 §4.2"
  );
});

test("真值樣態：該擋的會擋", () => {
  const pats = F.bannedPatterns();
  const hit = (txt) => pats.filter((p) => p.re.test(txt)).map((p) => p.name);
  assert.deepStrictEqual(hit("主打 $1,990 的禮盒"), ["價格"]);
  assert.deepStrictEqual(hit("特價 $99"), ["價格"]);
  assert.deepStrictEqual(hit("全館 85折"), ["折扣數字"]);
  assert.deepStrictEqual(hit("看這裡 https://tw.buy.yahoo.com/x"), ["連結"]);
  assert.deepStrictEqual(hit("指定 11534728 這件"), ["賣場編號"]);
  assert.deepStrictEqual(hit("檔期 08/30–09/30"), ["檔期日期"]);
  for (const p of pats) assert.ok(p.say && p.say.length > 10, `${p.name} 沒有講人話的理由`);
});

test("真值樣態：策略描述不會被誤擋（誤擋比漏抓更糟——會擋住正常人做事）", () => {
  const pats = F.bannedPatterns();
  const hit = (txt) => pats.filter((p) => p.re.test(txt)).map((p) => p.name);
  for (const ok of [
    "父親節，主打送給講究的爸爸。避開女性向商品。",
    "主打千元有找的入門禮物",
    "優先放折數最好的那幾件",
    "溫暖但不肉麻，不要用「孝順」這種字",
    "分三層：質感生活、戶外露營、家電",
    "給爸的\n不將就",
  ]) {
    assert.deepStrictEqual(hit(ok), [], `策略描述被誤擋了：「${ok}」`);
  }
});

test("真源自己不准寫字數上限（長度上限已有三份複本在打架，這裡再寫就是第四份）", () => {
  const raw = require("node:fs").readFileSync(require.resolve("../../lib/curation_brief_format.js"), "utf8");
  const body = raw.slice(raw.indexOf("const SECTIONS"));
  const nums = body.match(/(?:最多|上限|maxChars|限)\s*\d+\s*(?:個)?字/g) || [];
  assert.deepStrictEqual(nums, [], `真源出現字數上限：${nums.join("／")}——字數的唯一權威是 CMS 編修頁的提示`);
  assert.ok(F.templateMarkdown().includes("字數以 CMS 編修頁的提示為準"), "範本沒把字數的權威指回 CMS");
});

/* 產物保鮮：內建範本與助理指令都是從真源產出的，手改或忘了重產＝立刻紅。
   （這條是「三邊不漂」的最後一哩——前面守的是定義，這條守的是檔案真的有跟上。） */
test("內建範本與助理指令＝與真源同步（手改或忘了重產就紅）", () => {
  const { spawnSync } = require("node:child_process");
  const path = require("node:path");
  const PIPE = path.resolve(__dirname, "..", "..");
  const r = spawnSync(process.execPath, [path.join(PIPE, "tools", "gen-brief-templates.mjs"), "--check"],
    { cwd: PIPE, encoding: "utf8" });
  assert.strictEqual(r.status, 0, `產物過期或被手改：\n${r.stderr || r.stdout}\n修法＝node tools/gen-brief-templates.mjs`);
});

test("內建範本自己不准夾帶真值（同事會照抄，示範壞習慣比程式 bug 難發現）", () => {
  const fs = require("node:fs"), path = require("node:path");
  const dir = path.resolve(__dirname, "..", "..", "briefs", "built-in");
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".md"));
  assert.ok(files.length >= 5, `內建範本應有五份，實際 ${files.length}`);
  for (const f of files) {
    const md = fs.readFileSync(path.join(dir, f), "utf8");
    const bad = F.bannedPatterns().filter((p) => p.re.test(md)).map((p) => p.name);
    assert.deepStrictEqual(bad, [], `${f} 夾帶真值：${bad.join("、")}`);
  }
});

/* 「標會生效之前，先指出消費端在哪一行程式」——2026-09-11 立的判準，這條把它變成機器擋。
   本檔當天自己犯過：overview 與 tone 標了 consumed:true，實際沒有任何程式讀它們。 */
test("標 consumed:true 的段落，必須指得出消費端，而且那個檔案真的存在", () => {
  const fs = require("node:fs"), path = require("node:path");
  const PIPE = path.resolve(__dirname, "..", "..");
  for (const s of F.sections()) {
    if (!s.consumed) {
      assert.ok(!s.consumedBy, `${s.key} 標 consumed:false 卻寫了消費端，兩邊對不上`);
      assert.ok(s.notConsumedNote && s.notConsumedNote.length > 10, `${s.key} 還沒接上卻沒寫出聲的說法`);
      continue;
    }
    assert.ok(s.consumedBy && s.consumedBy.length > 10, `${s.key} 標了會生效，卻指不出消費端在哪——指不出來就該是 consumed:false`);
    const file = (s.consumedBy.match(/[\w/.-]+\.js/) || [])[0];
    assert.ok(file, `${s.key} 的消費端沒寫出檔名：${s.consumedBy}`);
    assert.ok(fs.existsSync(path.join(PIPE, file)), `${s.key} 指的消費端檔案不存在：${file}`);
  }
});

test("每個還沒接上的段落，範本與助理指令都要講明它還不會生效", () => {
  const md = F.templateMarkdown(), gem = F.gemInstructions();
  for (const s of F.sections().filter((x) => !x.consumed)) {
    const key = String(s.notConsumedNote).replace(/\*\*/g, "").slice(0, 12);
    assert.ok(md.includes(key), `範本沒講「${s.heading}」還不會生效`);
    assert.ok(gem.includes(key), `助理指令沒講「${s.heading}」還不會生效`);
  }
});
