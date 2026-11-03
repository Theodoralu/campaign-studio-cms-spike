"use strict";
/**
 * deploy-dirty-tree-guard.sh 契約測試（DEPLOY-DIRTY-TREE-GUARD，2026-09-16；零新相依、不觸網、不碰真 repo）
 *
 * 守的病：部署是 rsync 全站鏡像，deploy-site 現在是什麼位元組就原樣上線——包含還沒進版控的檔。
 * 2026-09-14 兩次「不知道帶上去」（早上全量同步帶走數據線那批、下午行事曆部署帶走剛加的一筆）＝本關的起因。
 * 契約＝**不阻止搭車，但搭車必須看得見、有人明講**：
 *   ①deploy-site 有範圍外在途改動且沒人明講 → 擋（exit 1）且把檔名印出來
 *   ②DEPLOY_MINE 涵蓋到 → 放行（本線自己的東西不算「別人的」）
 *   ③DEPLOY_CARRY 有給 → 放行（明講帶上）
 *   ④deploy-site 乾淨 → 放行
 *   ⑤repo 其他位置的在途改動 → 不擋，但要報數字（那些不會隨本次上線）
 *   ⑥掃不到 git → 出聲且放行（鐵律 3：不靜默，但也不拿掃不到當理由擋住部署）
 *
 * 每個情境開一個拋棄式 git repo，跑完就刪——不依賴也不改動真的工作樹。
 */
const { test, describe } = require("node:test");
const assert = require("node:assert");
const { spawnSync } = require("node:child_process");
/* pre-commit 在 git worktree 裡塞進環境的 GIT_DIR／GIT_INDEX_FILE 是絕對路徑＝子程序的 -C／cwd 會被蓋掉、打進真 repo——2026-09-27 實踩：
   本檔沙盒的 `git commit -m base` 打進功能分支、review_gate 的 `git init` 把共用 config 寫成 core.bare=true。
   本檔所有 git／守門腳本子程序一律用剝除 GIT_* 的乾淨環境（cwd／-C 才是它們該碰的 repo）。 */
const GIT_CLEAN_ENV = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^GIT_/.test(k)));
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const GUARD = path.join(__dirname, "..", "..", "workbench", "deploy-dirty-tree-guard.sh");

/** 造一個沙盒 repo：<root>/plan/deploy-site 已提交一個乾淨檔，回傳各路徑 */
function sandbox() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "dirty-guard-"));
  const ds = path.join(root, "plan", "deploy-site");
  fs.mkdirSync(ds, { recursive: true });
  fs.writeFileSync(path.join(ds, "index.html"), "<!doctype html>已提交\n");
  const git = (...a) => spawnSync("git", ["-C", root, ...a], { encoding: "utf8", env: GIT_CLEAN_ENV });
  git("init", "-q", "-b", "main");
  git("config", "user.email", "t@example.com");
  git("config", "user.name", "T");
  git("add", "-A");
  git("commit", "-q", "-m", "base");
  return { root, ds, git, cleanup: () => fs.rmSync(root, { recursive: true, force: true }) };
}

/** 跑守門，回 { code, out } */
function run(ds, env = {}) {
  const r = spawnSync("/bin/zsh", [GUARD, ds], { encoding: "utf8", env: { ...GIT_CLEAN_ENV, ...env } }); /* 守門腳本也不能吃 hook 的 GIT_DIR（2026-09-27） */
  return { code: r.status, out: (r.stdout || "") + (r.stderr || "") };
}

describe("部署前在途改動健檢", () => {
  test("① 待發佈區有在途改動、沒人宣告＝擋下來，而且把檔名印出來", () => {
    const s = sandbox();
    try {
      fs.writeFileSync(path.join(s.ds, "別線的頁.html"), "還沒 commit\n");
      const r = run(s.ds);
      assert.strictEqual(r.code, 1, "沒人認領的在途改動要擋（exit 1）");
      assert.match(r.out, /別線的頁\.html/, "要印出是哪一個檔——看不見等於沒擋");
      assert.match(r.out, /DEPLOY_CARRY/, "要告訴操作者怎麼放行（明講帶上）");
      assert.match(r.out, /DEPLOY_MINE/, "也要告訴操作者「這是我自己的」怎麼宣告");
    } finally { s.cleanup(); }
  });

  test("② 改動落在 DEPLOY_MINE 宣告範圍內＝放行（本線自己的東西不算別人的）", () => {
    const s = sandbox();
    try {
      fs.mkdirSync(path.join(s.ds, "live-drafts"), { recursive: true });
      fs.writeFileSync(path.join(s.ds, "live-drafts", "wb-1.json"), "{}\n");
      const r = run(s.ds, { DEPLOY_MINE: "live-drafts" });
      assert.strictEqual(r.code, 0, "宣告範圍內應放行");
      assert.match(r.out, /全在本線宣告範圍內/, "放行也要說清楚放行的理由");
    } finally { s.cleanup(); }
  });

  test("② -b DEPLOY_MINE 寫成相對 repo 根的完整路徑也算數（兩種寫法都要吃）", () => {
    const s = sandbox();
    try {
      fs.mkdirSync(path.join(s.ds, "live-drafts"), { recursive: true });
      fs.writeFileSync(path.join(s.ds, "live-drafts", "wb-1.json"), "{}\n");
      const r = run(s.ds, { DEPLOY_MINE: "plan/deploy-site/live-drafts" });
      assert.strictEqual(r.code, 0, "相對 repo 根的寫法也要認得");
    } finally { s.cleanup(); }
  });

  test("③ DEPLOY_CARRY 明講帶上＝放行，但清單照印（明講不等於隱形）", () => {
    const s = sandbox();
    try {
      fs.writeFileSync(path.join(s.ds, "別線的頁.html"), "還沒 commit\n");
      const r = run(s.ds, { DEPLOY_CARRY: "我知道，這批一起上" });
      assert.strictEqual(r.code, 0, "明講帶上應放行");
      assert.match(r.out, /別線的頁\.html/, "放行了還是要把帶上去的東西印出來");
      assert.match(r.out, /已明講帶上/, "要留下「是誰說可以」的紀錄");
    } finally { s.cleanup(); }
  });

  test("④ 待發佈區乾淨＝放行且說「乾淨」（不是沉默）", () => {
    const s = sandbox();
    try {
      const r = run(s.ds);
      assert.strictEqual(r.code, 0);
      assert.match(r.out, /待發佈區乾淨/, "乾淨也要出聲，才知道這關真的跑過");
    } finally { s.cleanup(); }
  });

  test("⑤ 宣告只蓋到一部分＝只擋沒蓋到的那幾筆，且不誤報已宣告的", () => {
    const s = sandbox();
    try {
      fs.mkdirSync(path.join(s.ds, "live-drafts"), { recursive: true });
      fs.writeFileSync(path.join(s.ds, "live-drafts", "wb-1.json"), "{}\n");
      fs.writeFileSync(path.join(s.ds, "別線的頁.html"), "還沒 commit\n");
      const r = run(s.ds, { DEPLOY_MINE: "live-drafts" });
      assert.strictEqual(r.code, 1, "還有沒蓋到的就要擋");
      assert.match(r.out, /別線的頁\.html/, "沒蓋到的要印出來");
      assert.doesNotMatch(r.out, /wb-1\.json/, "已宣告的不該混進「別人的」清單＝誤報會讓人不再看這份清單");
      assert.match(r.out, /有 1 筆/, "筆數要算對（只算沒蓋到的）");
    } finally { s.cleanup(); }
  });

  test("⑥ repo 其他位置的在途改動＝不擋，但要報數字（那些不會隨本次上線）", () => {
    const s = sandbox();
    try {
      fs.writeFileSync(path.join(s.root, "筆記.md"), "deploy-site 以外的改動\n");
      const r = run(s.ds);
      assert.strictEqual(r.code, 0, "deploy-site 以外的東西不會上線＝不該擋部署");
      assert.match(r.out, /其他位置另有 1 筆/, "但要讓人知道今天還有別的東西沒收");
    } finally { s.cleanup(); }
  });

  test("⑦ 掃不到 git＝出聲並放行（不靜默，也不拿掃不到當理由擋住部署）", () => {
    const bare = fs.mkdtempSync(path.join(os.tmpdir(), "dirty-guard-nogit-"));
    try {
      const r = run(bare, { GIT_CEILING_DIRECTORIES: os.tmpdir() });
      assert.strictEqual(r.code, 0, "掃不到不該擋部署");
      assert.match(r.out, /不在 git 版控下|保證不了/, "掃不到要明說掃不到（鐵律 3）");
    } finally { fs.rmSync(bare, { recursive: true, force: true }); }
  });

  test("⑧ 用法錯（沒給路徑／路徑不存在）＝exit 2，與「擋下」分得開", () => {
    const r1 = spawnSync("/bin/zsh", [GUARD], { encoding: "utf8", env: GIT_CLEAN_ENV });
    assert.strictEqual(r1.status, 2, "沒給參數＝用法錯，不可與 exit 1（擋下）混為一談");
    const r2 = spawnSync("/bin/zsh", [GUARD, "/no/such/dir/anywhere"], { encoding: "utf8", env: GIT_CLEAN_ENV });
    assert.strictEqual(r2.status, 2, "路徑不存在＝用法錯");
  });
});
