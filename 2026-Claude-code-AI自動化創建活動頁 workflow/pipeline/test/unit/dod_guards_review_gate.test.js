"use strict";
/* G5 出貨守門改動要留 review — 負向測試（2026-09-21 使用者裁「寫成規則、建立流程」）
   白話：改到「交到同事手上的包」那條線，審查記錄要跟程式碼同一批進版控；沒附＝pre-commit 紅燈。
   兩層：①純判定 reviewGate 吃清單（快、不碰 git）②真 git repo 端到端（git init→staged→跑守門→看結束碼）。
   該紅會紅、該綠會綠，兩邊都要有——只測紅不測綠＝誤擋了也看不出來（這道門天天擋自己人，誤擋比漏擋更貴）。 */
const { test } = require("node:test");
const assert = require("node:assert");
const { execFileSync, spawnSync } = require("child_process");
const fs = require("fs"), os = require("os"), path = require("path");
const PIPE = path.resolve(__dirname, "..", "..");
const GUARD = path.join(PIPE, "tools", "dod-guards.js");
const BASELINE = path.join(PIPE, ".dod-baseline.json");
const { reviewGate } = require(GUARD);
const B = JSON.parse(fs.readFileSync(BASELINE, "utf8"));

test("名單真源就在 baseline，且涵蓋打包機與守門自己（漏了這幾條這道門就形同不存在）", () => {
  for (const must of ["tools/pack-editor.sh", "tools/pack_assert.js", "tools/dod-guards.js", ".dod-baseline.json", ".githooks/"]) {
    assert.ok((B.reviewRequiredPaths || []).includes(must), `reviewRequiredPaths 缺 ${must}`);
  }
  assert.ok((B.reviewRecordDirs || []).includes("docs/reviews/"));
});

/* 2026-09-21 使用者裁「分層納入」：低頻高風險的抓價兩支納入（加門幾乎無感），
   高頻的錢閘刻意不納入（每月 35 次落檔會逼人繞過，它缺的是測試不是審查記錄）。
   這條把「刻意不納入」也釘住——否則哪天有人順手加進去，摩擦會悄悄回來。 */
test("分層納入：抓價兩支在名單內；錢閘刻意不在（裁決＝2026-09-21，理由見 baseline 註解）", () => {
  const paths = B.reviewRequiredPaths || [];
  for (const must of ["price_qa.js", "fetch_parse.js"]) {
    assert.ok(paths.includes(must), `低頻高風險應納入：${must}`);
  }
  for (const out of ["workbench/gate.js", "workbench/rules.json", "gate.js", "rules.json"]) {
    assert.ok(!paths.includes(out), `錢閘刻意不納入，要改請先回頭看 baseline 的 _reviewScopeNote：${out}`);
  }
  assert.ok(/_reviewScopeNote/.test(JSON.stringify(Object.keys(B))), "範圍的理由要留在 baseline，不能只存在某次對話裡");
});

test("沒動出貨守門＝綠（不擋一般開發）", () => {
  const r = reviewGate(["workbench/server.js", "docs/stories/x.md"], B);
  assert.ok(r.ok && r.need.length === 0);
});

test("動了打包機但沒附審查記錄＝紅，並點名是哪個檔", () => {
  const r = reviewGate(["tools/pack-editor.sh", "workbench/server.js"], B);
  assert.strictEqual(r.ok, false);
  assert.deepStrictEqual(r.need, ["tools/pack-editor.sh"]);
});

test("動了打包機且同批有 docs/reviews/*.md＝綠", () => {
  const r = reviewGate(["tools/pack-editor.sh", "docs/reviews/pack-whatsnew-2026-09-21.md"], B);
  assert.ok(r.ok);
  assert.deepStrictEqual(r.record, ["docs/reviews/pack-whatsnew-2026-09-21.md"]);
});

test("design-qa 的記錄也算（動版型／畫面的變更留在那裡，不強迫寫成 code review）", () => {
  assert.ok(reviewGate(["tools/pack-root/先看我.txt", "docs/design-qa/pack-root-2026-09-21.md"], B).ok);
});

test("目錄型名單：pack-root/ 與 .githooks/ 底下任何檔都算命中", () => {
  assert.strictEqual(reviewGate(["tools/pack-root/安裝.command"], B).ok, false);
  assert.strictEqual(reviewGate([".githooks/pre-commit"], B).ok, false);
});

test("改守門自己也要 review（否則可先放寬基線關掉這道門，再去改打包機）", () => {
  assert.strictEqual(reviewGate([".dod-baseline.json"], B).ok, false);
  assert.strictEqual(reviewGate(["tools/dod-guards.js"], B).ok, false);
});

test("記錄必須是 .md，也必須在記錄資料夾裡（隨手放個 txt 或改別處的 md 不算過關）", () => {
  assert.strictEqual(reviewGate(["tools/pack-editor.sh", "docs/reviews/note.txt"], B).ok, false);
  assert.strictEqual(reviewGate(["tools/pack-editor.sh", "docs/stories/pack-editor.md"], B).ok, false);
});

/* ── 端到端：真 git repo，證明 pre-commit 那條路真的會擋 ── */
/* 2026-09-27 病例：pre-commit 跑本測試時，git 會把 GIT_DIR／GIT_INDEX_FILE／GIT_WORK_TREE 塞進環境；在主資料夾 commit 時 GIT_DIR 是相對的 `.git`＝
   對暫存資料夾無效、不會漏，但在 **git worktree** 裡 GIT_DIR 是絕對路徑＝這裡的 `git init／add／commit` 全打進真 repo——
   實踩：功能分支多了一顆「base」commit、共用 .git/config 被寫成 core.bare=true、主資料夾 git status 直接死。
   子程序一律用剝掉 GIT_* 的乾淨環境（cwd 才是它該碰的 repo）。 */
const GIT_CLEAN_ENV = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^GIT_/.test(k)));
function mkrepo(files) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "g5-"));
  fs.mkdirSync(path.join(d, "tools"), { recursive: true });
  fs.copyFileSync(GUARD, path.join(d, "tools", "dod-guards.js"));
  fs.copyFileSync(BASELINE, path.join(d, ".dod-baseline.json"));
  for (const [rel, body] of Object.entries(files)) {
    const f = path.join(d, rel);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, body);
  }
  execFileSync("git", ["init", "-q"], { cwd: d, env: GIT_CLEAN_ENV });
  execFileSync("git", ["add", "-A"], { cwd: d, env: GIT_CLEAN_ENV });
  return d;
}
const runGuard = (d) => spawnSync(process.execPath, [path.join(d, "tools", "dod-guards.js"), "--staged"], { cwd: d, encoding: "utf8", env: GIT_CLEAN_ENV });

test("端到端：staged 有打包機、沒有審查記錄＝exit 1，訊息給得出下一步", () => {
  const r = runGuard(mkrepo({ "tools/pack-editor.sh": "#!/bin/zsh\necho hi\n" }));
  assert.strictEqual(r.status, 1, r.stdout + r.stderr);
  assert.ok(/G5/.test(r.stdout) && /pack-editor\.sh/.test(r.stdout), r.stdout);
  assert.ok(/docs\/reviews\//.test(r.stdout), "訊息要講怎麼補（action item）");
  assert.ok(/--no-verify/.test(r.stdout) && /豁免/.test(r.stdout), "訊息要講緊急繞過與豁免五欄");
});

test("端到端：同批附上審查記錄＝G5 綠（不是靠關掉守門過關）", () => {
  const r = runGuard(mkrepo({
    "tools/pack-editor.sh": "#!/bin/zsh\necho hi\n",
    "docs/reviews/pack-x-2026-09-21.md": "# 審查\n\n逐項過 R1~R5：…\n",
  }));
  assert.ok(/✅ G5/.test(r.stdout), r.stdout);
});
