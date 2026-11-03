"use strict";
/**
 * pack_unmerged_guard.test.js —— 打包前「做完沒合併」健檢的沙盒絆線（PACK-UNMERGED-GUARD，2026-10-05）
 *
 * 為什麼用沙盒 git repo（沿 deploy_dirty_tree_guard.test.js 前例）：這道關內嵌在打包機裡就只能靠
 * 真打一次 234MB 的包來驗——抽成獨立腳本＋沙盒，六種情境秒級可測。
 *
 * 病例＝2026-10-05：「連不出去要說實話」9/24 做完停在分支，第六版打包沒人問，工程師續撞已修的病。
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const GUARD = path.join(__dirname, "..", "..", "tools", "pack-unmerged-guard.sh");

function sh(cwd, cmd, args, env) {
  try {
    const out = execFileSync(cmd, args, { cwd, encoding: "utf8", env: { ...process.env, ...env } });
    return { code: 0, out };
  } catch (e) {
    return { code: e.status ?? 1, out: (e.stdout || "") + (e.stderr || "") };
  }
}
const git = (repo, ...args) => execFileSync("git", ["-C", repo, ...args], {
  encoding: "utf8",
  env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@x", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@x" },
});

/** 造一個沙盒 repo：main 一顆底 commit */
function makeRepo(name) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `pug-${name}-`));
  git(dir, "init", "-q", "-b", "main");
  fs.writeFileSync(path.join(dir, "a.txt"), "1\n");
  git(dir, "add", "-A"); git(dir, "commit", "-qm", "base");
  return dir;
}
const run = (args, env) => sh(process.cwd(), "zsh", [GUARD, ...args], env);

test("①沒有別的分支＝放行（exit 0）", () => {
  const r1 = makeRepo("clean");
  const { code, out } = run([`${r1}:pipeline`]);
  assert.equal(code, 0, out);
  assert.match(out, /沒有做完沒合併的 commit/);
});

test("②分支全併入＝放行", () => {
  const r = makeRepo("merged");
  git(r, "checkout", "-qb", "feat/x");
  fs.writeFileSync(path.join(r, "b.txt"), "2\n");
  git(r, "add", "-A"); git(r, "commit", "-qm", "feat work");
  git(r, "checkout", "-q", "main");
  git(r, "merge", "-q", "--no-ff", "-m", "merge", "feat/x");
  const { code, out } = run([`${r}:pipeline`]);
  assert.equal(code, 0, out);
});

test("③分支有未併 commit＝擋（exit 1）且點名分支與顆數", () => {
  const r = makeRepo("behind");
  git(r, "checkout", "-qb", "feat/done-not-shipped");
  fs.writeFileSync(path.join(r, "fix.txt"), "修好了\n");
  git(r, "add", "-A"); git(r, "commit", "-qm", "fix: 修好了但沒人合");
  git(r, "checkout", "-q", "main");
  const { code, out } = run([`${r}:pipeline`]);
  assert.equal(code, 1, out);
  assert.match(out, /feat\/done-not-shipped：1 顆/, "要點名是哪個分支、幾顆");
  assert.match(out, /修好了」不等於「在包裡/, "要講清楚這關在守什麼");
});

test("④PACK_UNMERGED_OK=理由＝明講不帶、放行（exit 0）且理由印出來", () => {
  const r = makeRepo("waived");
  git(r, "checkout", "-qb", "feat/hold");
  fs.writeFileSync(path.join(r, "c.txt"), "3\n");
  git(r, "add", "-A"); git(r, "commit", "-qm", "hold");
  git(r, "checkout", "-q", "main");
  const { code, out } = run([`${r}:pipeline`], { PACK_UNMERGED_OK: "綁 P6A，使用者裁先不帶" });
  assert.equal(code, 0, out);
  assert.match(out, /明講不帶，照打/);
  assert.match(out, /綁 P6A/, "理由要印出來＝進打包紀錄");
});

test("⑤揀收過（cherry-pick 同補丁）＝不誤報", () => {
  const r = makeRepo("picked");
  git(r, "checkout", "-qb", "feat/picked");
  fs.writeFileSync(path.join(r, "d.txt"), "4\n");
  git(r, "add", "-A"); git(r, "commit", "-qm", "the fix");
  const sha = git(r, "rev-parse", "feat/picked").trim();
  git(r, "checkout", "-q", "main");
  git(r, "cherry-pick", sha);
  const { code, out } = run([`${r}:pipeline`]);
  assert.equal(code, 0, `揀收過的等價補丁不該再報：${out}`);
});

test("⑥多 repo 一次查＋用法錯（無參數）exit 2", () => {
  const r1 = makeRepo("multi1"), r2 = makeRepo("multi2");
  git(r2, "checkout", "-qb", "feat/y");
  fs.writeFileSync(path.join(r2, "e.txt"), "5\n");
  git(r2, "add", "-A"); git(r2, "commit", "-qm", "y");
  git(r2, "checkout", "-q", "main");
  const both = run([`${r1}:pipeline`, `${r2}:root`]);
  assert.equal(both.code, 1);
  assert.match(both.out, /root｜feat\/y：1 顆/, "第二個 repo 的也要列、要帶標籤");
  const none = run([]);
  assert.equal(none.code, 2, "無參數＝用法錯 exit 2");
});

test("⑧路徑裡有冒號與括號也切得對（本專案資料夾名＝「…( W:Yu-ting )」；首跑被自己擋的病例）", () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "pug-colon-"));
  const dir = path.join(base, "專案( W:Yu-ting )");
  fs.mkdirSync(dir);
  git(dir, "init", "-q", "-b", "main");
  fs.writeFileSync(path.join(dir, "a.txt"), "1\n");
  git(dir, "add", "-A"); git(dir, "commit", "-qm", "base");
  const { code, out } = run([`${dir}:pipeline`]);
  assert.equal(code, 0, `帶冒號的路徑要能用：${out}`);
  assert.doesNotMatch(out, /repo 不存在/);
});

test("⑦打包機真的接了這道關（不是寫了沒接）", () => {
  const packer = fs.readFileSync(path.join(__dirname, "..", "..", "tools", "pack-editor.sh"), "utf8");
  assert.match(packer, /pack-unmerged-guard\.sh/, "pack-editor.sh 要呼叫本關");
  assert.match(packer, /PACK_UNMERGED_OK/, "打包機要把『明講不帶』的用法印給操作的人看");
});
