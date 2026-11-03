"use strict";
/* build_pack_whatsnew 測試——包最上層「這一版有什麼新的.txt」的產生器。
   白話：這份 txt 是同事解開壓縮檔第一眼看到的東西，所以三件事要擋死——
   ①不能殘留 md 記號（星號反引號給人看很醜）②沒有當天的更新說明就不准出包
   ③版本對不上要出聲講明，不准靜靜拿別版的說明冒充（鐵律 3：不靜默降級）。 */
const { test } = require("node:test");
const assert = require("node:assert");
const { spawnSync } = require("child_process");
const fs = require("fs"), os = require("os"), path = require("path");
const PIPE = path.resolve(__dirname, "..", "..");
const TOOL = path.join(PIPE, "tools", "build_pack_whatsnew.js");
const { mdToPlain, pickReleaseFile, dispWidth } = require(TOOL);

const SAMPLE = `# Campaign Studio 單機版・第二版包（2026-09-21）

值不值得換：值得——上一版有同事卡在「第一次雙擊打不開」。

## 新功能
- **雙擊就能安裝**：包最上層多了三個檔，跑 \`install.sh\` 也可以。
- 活動存在自己的家目錄。

## 沒變、要先講好的
- 做頁要有網路。
`;

const mkdir = () => fs.mkdtempSync(path.join(os.tmpdir(), "whatsnew-"));
const runCli = (args) => spawnSync(process.execPath, [TOOL, ...args], { encoding: "utf8" });

test("md 記號清光：不留星號、反引號、井號（給同事看的是純文字）", () => {
  const txt = mdToPlain(SAMPLE);
  assert.ok(!/\*\*|`|^#/m.test(txt), txt);
  assert.ok(txt.includes("雙擊就能安裝：包最上層多了三個檔，跑 install.sh 也可以。"));
});

test("排版：大標底線用＝、小標底線用－、列點用・，小標與內容之間不留空行", () => {
  const txt = mdToPlain(SAMPLE);
  const lines = txt.split("\n");
  assert.ok(/^=+$/.test(lines[1]), "大標下面要有＝底線");
  const i = lines.indexOf("新功能");
  assert.ok(i > 0 && /^-+$/.test(lines[i + 1]), "小標下面要有－底線");
  assert.ok(lines[i + 2].startsWith("・"), "小標底線後直接接內容，不空行（文風對齊先看我.txt）");
});

test("版本註記插在大標底下——同事回報問題時要能講出手上是哪一版", () => {
  const txt = mdToPlain(SAMPLE, { versionNote: "（這一版有什麼新的・版本 20260921-3ee04ec）" });
  assert.strictEqual(txt.split("\n")[2], "（這一版有什麼新的・版本 20260921-3ee04ec）");
});

test("長行會斷行，且標點不落在行首", () => {
  const long = "- " + "這是一句很長的說明".repeat(12) + "，後面還有話。";
  for (const line of mdToPlain(long).split("\n")) {
    assert.ok(dispWidth(line) <= 78, `太寬：${dispWidth(line)}｜${line}`);
    assert.ok(!/^[，。、：；！？）」』】〕》…]/.test(line), `標點排到行首：${line}`);
  }
});

/* 2026-09-21 人眼驗收抓到：開引號被留在行尾，「引號」跟它包住的字被拆到兩行去，
   讀起來像上一行沒講完。機器量寬度量不出這種醜，所以補成斷言。 */
test("開引號不留在行尾（引號跟它包住的字不被拆開）", () => {
  const cases = [
    "- 現在解開就有「這一版有什麼新的.txt」，第一行就寫值不值得換，不必先問人也不用讀工程紀錄喔。",
    "- " + "填滿一些字".repeat(7) + "「被包住的內容」後面還有話。",
    "- " + "填滿一些字".repeat(7) + "（括號裡的內容）後面還有話。",
  ];
  for (const c of cases) {
    for (const line of mdToPlain(c).split("\n")) {
      assert.ok(!/[「『（【《〔]$/.test(line), `開引號留在行尾：${line}`);
      assert.ok(dispWidth(line) <= 78, `太寬：${dispWidth(line)}｜${line}`);
    }
  }
});

test("表格轉成「・欄一：欄二」，分隔列不留下來", () => {
  const txt = mdToPlain("| 什麼時候 | 放在哪 |\n|---|---|\n| 剛解壓縮 | 包最上層 |\n");
  assert.ok(txt.includes("・剛解壓縮：包最上層"), txt);
  assert.ok(!/\|/.test(txt) && !/---/.test(txt), txt);
});

test("版本配對：精準命中 v<日期-hash>.md", () => {
  const d = mkdir();
  fs.writeFileSync(path.join(d, "v20260921-3ee04ec.md"), SAMPLE);
  const r = pickReleaseFile(d, "20260921-3ee04ec");
  assert.ok(r.exact && r.file.endsWith("v20260921-3ee04ec.md"), JSON.stringify(r));
});

test("版本配對：hash 對不上但同一天有＝用同日最新，並標記非精準（說明常常是 commit 前就寫好的）", () => {
  const d = mkdir();
  fs.writeFileSync(path.join(d, "v20260921-3ee04ec.md"), SAMPLE);
  const r = pickReleaseFile(d, "20260921-9999999");
  assert.strictEqual(r.exact, false);
  assert.strictEqual(r.tag, "v20260921-3ee04ec");
});

test("版本配對：同一天一份都沒有＝紅燈，訊息要指出該去寫哪個檔（發版必附說明）", () => {
  const d = mkdir();
  fs.writeFileSync(path.join(d, "v20260916-c3e673b.md"), SAMPLE); // 別天的不算
  const r = pickReleaseFile(d, "20260921-3ee04ec");
  assert.ok(r.error && /v20260921-3ee04ec\.md/.test(r.error), r.error);
});

test("端到端：有說明＝exit 0、檔案產出來、印出來源檔名", () => {
  const d = mkdir();
  fs.writeFileSync(path.join(d, "v20260921-3ee04ec.md"), SAMPLE);
  const out = path.join(d, "out", "這一版有什麼新的.txt");
  const r = runCli(["--version", "20260921-3ee04ec", "--releases-dir", d, "--out", out]);
  assert.strictEqual(r.status, 0, r.stderr);
  assert.ok(/v20260921-3ee04ec\.md/.test(r.stdout), r.stdout);
  assert.ok(fs.readFileSync(out, "utf8").includes("值不值得換：值得"));
});

test("端到端：沒有當天的說明＝exit 1、不產半成品（寧可不出包，也不出一份沒說明的包）", () => {
  const d = mkdir();
  const out = path.join(d, "這一版有什麼新的.txt");
  const r = runCli(["--version", "20260921-3ee04ec", "--releases-dir", d, "--out", out]);
  assert.strictEqual(r.status, 1);
  assert.ok(/更新說明/.test(r.stderr), r.stderr);
  assert.ok(!fs.existsSync(out), "紅燈時不該留下半成品檔");
});

/* 只有一行標題的說明＝紅。它會先撞「缺開頭句」那道門（順序：開頭句 → 內文份量）。
   註：這條原本的斷言是「整份輸出寬度 < 80」，而 fixture 的標題只有 4 格才會紅——
   換成真實長度的標題（46 格）那道門就形同不存在。2026-09-21 第二審實算抓到，
   判定改為「必須有 77 號 §3 的開頭句 ＋ 扣掉標題後的內文 ≥ 100 格」，
   真實長標題的版本另立一條測（見下方「只有標題、沒有內文」）。 */
test("端到端：只有一行標題的說明＝exit 1（有檔不等於有內容）", () => {
  const d = mkdir();
  fs.writeFileSync(path.join(d, "v20260921-3ee04ec.md"), "# 標題\n");
  const r = runCli(["--version", "20260921-3ee04ec", "--releases-dir", d, "--out", path.join(d, "o.txt")]);
  assert.strictEqual(r.status, 1);
  assert.ok(/值不值得換/.test(r.stderr), r.stderr);
});

test("端到端：hash 對不上時走同日退路，但要在畫面上講明兩邊版本（不准靜靜冒充）", () => {
  const d = mkdir();
  fs.writeFileSync(path.join(d, "v20260921-3ee04ec.md"), SAMPLE);
  const r = runCli(["--version", "20260921-9999999", "--releases-dir", d, "--out", path.join(d, "o.txt")]);
  assert.strictEqual(r.status, 0, r.stderr);
  assert.ok(/⚠/.test(r.stdout) && /3ee04ec/.test(r.stdout) && /9999999/.test(r.stdout), r.stdout);
});

/* 終端機那兩行 ⚠ 會被後面的 rsync／zip 輸出滾過去，沒人看到＝等於靜默降級。
   所以退路啟動時，包裡那份 txt 自己要寫明說明取自哪一版——那是同事真的會讀的地方。 */
test("退路啟動時，包裡那份 txt 自己要寫明「說明內容取自哪一版」", () => {
  const d = mkdir();
  fs.writeFileSync(path.join(d, "v20260921-3ee04ec.md"), SAMPLE);
  const out = path.join(d, "o.txt");
  runCli(["--version", "20260921-9999999", "--releases-dir", d, "--out", out]);
  const txt = fs.readFileSync(out, "utf8");
  assert.ok(/版本 20260921-9999999；說明內容取自 v20260921-3ee04ec/.test(txt), txt.split("\n").slice(0, 4).join("\n"));
});

test("精準命中時不加那句贅字（正常情況畫面要乾淨）", () => {
  const d = mkdir();
  fs.writeFileSync(path.join(d, "v20260921-3ee04ec.md"), SAMPLE);
  const out = path.join(d, "o.txt");
  runCli(["--version", "20260921-3ee04ec", "--releases-dir", d, "--out", out]);
  const txt = fs.readFileSync(out, "utf8");
  assert.ok(/版本 20260921-3ee04ec）/.test(txt) && !/取自/.test(txt), txt.split("\n").slice(0, 4).join("\n"));
});

test("端到端：少給參數＝exit 2（用法錯不假裝紅燈也不假裝綠燈）", () => {
  assert.strictEqual(runCli(["--version", "20260921-3ee04ec"]).status, 2);
});

/* ── 以下為 2026-09-21 第二審（獨立唯讀覆核）抓出的未覆蓋路徑 ── */

/* F1：原本同日多份用「檔案修改時間最新」決勝。實測會挑中已作廢那份——它第一句寫著
   「此版未發佈給任何人，已由 … 取代」，那句會印在同事解開壓縮檔看到的第一頁，而三道門全綠。
   mtime 也不是內容屬性：重新 clone／從外接碟還原／rsync 回來之後順序全變。 */
test("同一天有多份說明、又沒一份對得上這包＝紅燈，不猜（列出候選與兩種修法）", () => {
  const d = mkdir();
  fs.writeFileSync(path.join(d, "v20260921-aaaaaaa.md"), SAMPLE);
  fs.writeFileSync(path.join(d, "v20260921-bbbbbbb.md"), SAMPLE);
  const r = pickReleaseFile(d, "20260921-ccccccc");
  assert.ok(r.error, "同日多份不准自動挑一份");
  assert.deepStrictEqual(r.ambiguous, ["v20260921-aaaaaaa.md", "v20260921-bbbbbbb.md"]);
  assert.ok(/v20260921-ccccccc\.md/.test(r.error) && /PACK_NOTES/.test(r.error), r.error);
});

test("端到端：同日多份＝exit 1 且不留半成品", () => {
  const d = mkdir();
  fs.writeFileSync(path.join(d, "v20260921-aaaaaaa.md"), SAMPLE);
  fs.writeFileSync(path.join(d, "v20260921-bbbbbbb.md"), SAMPLE);
  const out = path.join(d, "o.txt");
  const r = runCli(["--version", "20260921-ccccccc", "--releases-dir", d, "--out", out]);
  assert.strictEqual(r.status, 1);
  assert.ok(!fs.existsSync(out));
});

test("--notes 明示指定＝放行（打的人講出自己知道在用哪一份），並在 txt 上寫明取自哪一版", () => {
  const d = mkdir();
  fs.writeFileSync(path.join(d, "v20260921-aaaaaaa.md"), SAMPLE);
  fs.writeFileSync(path.join(d, "v20260921-bbbbbbb.md"), SAMPLE);
  const out = path.join(d, "o.txt");
  const r = runCli(["--version", "20260921-ccccccc", "--releases-dir", d, "--out", out, "--notes", "v20260921-aaaaaaa.md"]);
  assert.strictEqual(r.status, 0, r.stderr);
  assert.ok(/NOTES_TAG=v20260921-aaaaaaa/.test(r.stdout), r.stdout);
  assert.ok(fs.readFileSync(out, "utf8").includes("說明內容取自 v20260921-aaaaaaa"));
});

test("--notes 指到不存在的檔＝紅（明示也不放過錯字）", () => {
  const d = mkdir();
  fs.writeFileSync(path.join(d, "v20260921-aaaaaaa.md"), SAMPLE);
  const r = runCli(["--version", "20260921-aaaaaaa", "--releases-dir", d, "--out", path.join(d, "o.txt"), "--notes", "typo.md"]);
  assert.strictEqual(r.status, 1);
  assert.ok(/不存在/.test(r.stderr), r.stderr);
});

/* F3：原本量「整份輸出的寬度 >= 80」，但大標＋底線＋版本註記本身就 138 格，
   所以一份只有標題、內文一字都沒有的說明照樣過關。舊測試會綠是因為 fixture 標題只有 4 格
   （＝只測了對自己有利的那個邊界），不是因為那道門有效。 */
test("只有標題、沒有內文＝紅（用真實長度的標題，不用短 fixture 讓門看起來有效）", () => {
  const d = mkdir();
  fs.writeFileSync(path.join(d, "v20260921-aaaaaaa.md"), "# Campaign Studio 單機版・第二版包（2026-09-21）\n\n值不值得換：值得——理由。\n");
  const r = runCli(["--version", "20260921-aaaaaaa", "--releases-dir", d, "--out", path.join(d, "o.txt")]);
  assert.strictEqual(r.status, 1, r.stdout + r.stderr);
  assert.ok(/幾乎沒有內文/.test(r.stderr), r.stderr);
});

test("缺開頭那句「值不值得換：」＝紅，並把格式教給寫的人", () => {
  const d = mkdir();
  fs.writeFileSync(path.join(d, "v20260921-aaaaaaa.md"), SAMPLE.replace(/值不值得換：[^\n]*\n/, ""));
  const r = runCli(["--version", "20260921-aaaaaaa", "--releases-dir", d, "--out", path.join(d, "o.txt")]);
  assert.strictEqual(r.status, 1);
  assert.ok(/值不值得換/.test(r.stderr) && /77/.test(r.stderr), r.stderr);
});

test("沒有大標的說明，版本註記也要在（77 號只要求第一行回答值不值得換，沒要求大標）", () => {
  const d = mkdir();
  fs.writeFileSync(path.join(d, "v20260921-aaaaaaa.md"),
    "值不值得換：值得——上一版有同事卡在第一次雙擊打不開，這一版裝得起來。\n\n## 新功能\n- 雙擊就能安裝、雙擊就能開，不用再開終端機打指令。\n- 你做的活動存在自己的家目錄，換版換電腦都帶得走。\n- 檢查結果過期會自己重算，不會拿舊結果騙你。\n");
  const out = path.join(d, "o.txt");
  const r = runCli(["--version", "20260921-aaaaaaa", "--releases-dir", d, "--out", out]);
  assert.strictEqual(r.status, 0, r.stderr);
  assert.ok(/版本 20260921-aaaaaaa/.test(fs.readFileSync(out, "utf8")), "無大標時版本註記不可消失");
});
