#!/usr/bin/env node
/* dod-guards.js — 固化根因的離線秒級守門（零依賴）。
 * 用法：
 *   node tools/dod-guards.js            # full：G2 空 catch／G3 draft 寫入點 ratchet／G4 tokenizer
 *   node tools/dod-guards.js --staged   # pre-commit：另加 G1 改產物/密鑰、G5 出貨守門留 review、G6 基線調動必附登記
 * 任一檢查 FAIL → exit 1。基線見 .dod-baseline.json（ratchet 只准降不准升）。
 * 六道門對應（見記憶 process-feature-qa-and-rootcause；條文＝DEVELOPMENT.md §3～§5）：
 *   G1 改產物非源頭／密鑰入版控   G2 靜默失敗（空 catch）   G3 核可不變式（寫入點數量 ratchet）
 *   G4 tokenizer FATAL            G5 出貨線改動必留 review   G6 G3 基線調動必附登記（堵「改數字了事」）
 * ⚠ 本檔自己在 .dod-baseline.json reviewRequiredPaths 名單裡＝改它要同批留 docs/reviews/ 記錄（G5 會擋）。
 *   改門的同時記得改這段註解——2026-09-21 病例：pack_assert.js 檔頭寫「三道門」是後來整串誤判的起點。
 * 註：staged 模式為求簡潔讀「工作區」檔內容（非 staged blob）＝實務上等同；嚴格版可改讀 `git show :path`。 */
"use strict";
const fs = require("fs");
const path = require("path");
const { execSync, execFileSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const STAGED = process.argv.includes("--staged");
const B = JSON.parse(fs.readFileSync(path.join(ROOT, ".dod-baseline.json"), "utf8"));

const sh = (cmd) => { try { return execSync(cmd, { cwd: ROOT, encoding: "utf8" }); } catch (e) { return (e.stdout || "") + (e.stderr || ""); } };
const trackedJs = () => sh('git ls-files "*.js"').split("\n").map((s) => s.trim()).filter(Boolean).filter((f) => !f.startsWith("node_modules/"));
const read = (f) => { try { return fs.readFileSync(path.join(ROOT, f), "utf8"); } catch (e) { return ""; } };
const countAll = (files, re) => { let n = 0; const per = {}; for (const f of files) { const m = read(f).match(re) || []; if (m.length) { per[f] = m.length; n += m.length; } } return { n, per }; };

const results = [];
const add = (name, ok, detail) => results.push({ name, ok, detail });

/* ── G5 的純判定（export 給測試直接呼叫，不碰 git）──
   白話：改到「交到同事手上的包」那條線，審查記錄要跟程式碼同一批進版控。
   為什麼守門自己（dod-guards／baseline／.githooks）也算：不然可以先放寬基線把這道門關掉，再去改打包機。 */
function reviewGate(staged, B) {
  const paths = B.reviewRequiredPaths || [];
  const dirs = B.reviewRecordDirs || ["docs/reviews/"];
  const need = staged.filter((f) => paths.some((p) => (p.endsWith("/") ? f.startsWith(p) : f === p)));
  const record = staged.filter((f) => f.endsWith(".md") && dirs.some((d) => f.startsWith(d)));
  return { need, record, ok: need.length === 0 || record.length > 0 };
}

/* ── G6 的純判定（export 給測試直接呼叫，不碰 git）──
   白話：「這頁可以上架」那個章，規矩是有人動過內容就要自動作廢、重看一次再蓋。
   G3 用「數量」守這件事：程式裡有幾個地方會寫入頁面資料，超過基線就紅。
   但 G3 有一條捷徑——**把基線數字改大就過了**，而它的紅燈訊息還親口教你「把基線調為 N」。
   於是「請確認它有讓舊章失效」這句請人確認的話，可以一個字都不看就繞過去。
   G6 把那條捷徑堵死：**動 draftWriters 基線，就必須同批動 scripts/draft-writers.allow**；
   而且調高時，登記筆數必須真的增加——逼你當場寫下那一行「它是誰、它怎麼讓章失效」。
   這仍是人工確認，但變成擋得住的人工確認（2026-09-22 使用者裁 Q3 丙；真正的網＝Q3 甲排 10 月初）。 */
const ALLOW_PATH = "scripts/draft-writers.allow";
const BASELINE_PATH = ".dod-baseline.json";
const countAllowEntries = (txt) => (String(txt || "").match(/^[A-Za-z0-9][^\n]*/gm) || []).length;

function draftBaselineGate({ staged, headBaseline, stagedBaseline, headAllow, stagedAllow }) {
  if (!staged.includes(BASELINE_PATH)) return { ok: true, moved: false, detail: "基線未在本批＝不適用" };
  const pick = (raw) => { try { const v = JSON.parse(raw).draftWriters; return Number.isInteger(v) ? v : null; } catch (e) { return null; } };
  const b = pick(headBaseline), a = pick(stagedBaseline);
  // 讀不到就不在這裡擋：數量本身還有 G3 守著，這道門只管「基線被動過」這件事。
  if (b === null || a === null) return { ok: true, moved: false, detail: "讀不到 draftWriters＝本閘不判（數量由 G3 守）" };
  if (b === a) return { ok: true, moved: false, detail: `基線有改但 draftWriters 未動（${a}）` };

  const how = `${b} → ${a}`;
  const teach =
    `\n     做法：新增的寫入點要 ①呼叫 invalidateApproval(id) ②前端走 afterDraftMutation(r) ` +
    `③到 ${ALLOW_PATH} 登記一行（誰、在哪支、怎麼讓章失效），三件做完再調基線，跟這批一起 git add` +
    `\n     真的來不及：git commit --no-verify，但要補一筆豁免五欄（誰批／為什麼／何時批／何時到期／到期後動作，見 DEVELOPMENT.md §5）`;

  if (!staged.includes(ALLOW_PATH)) {
    return { ok: false, moved: true, before: b, after: a,
      detail: `draftWriters 基線被改（${how}）但 ${ALLOW_PATH} 不在同一批＝只改數字不算數。${teach}` };
  }
  if (a > b) {
    const nb = countAllowEntries(headAllow), na = countAllowEntries(stagedAllow);
    if (na <= nb) {
      return { ok: false, moved: true, before: b, after: a,
        detail: `基線調高（${how}）但登記檔沒多出任何一筆（${nb} → ${na} 筆）＝沒有留下「新入口是誰、它怎麼讓章失效」。${teach}` };
    }
    return { ok: true, moved: true, before: b, after: a,
      detail: `基線調高（${how}），登記 ${nb} → ${na} 筆同批到齊` };
  }
  return { ok: true, moved: true, before: b, after: a,
    detail: `基線調降（${how}＝ratchet 收緊），登記檔同批更新` };
}

module.exports = { reviewGate, draftBaselineGate, countAllowEntries };

// ── G1 改產物非源頭／密鑰（僅 staged 模式：掃已 staged 檔路徑）──
if (STAGED) {
  const staged = sh("git diff --cached --name-only --diff-filter=ACM").split("\n").map((s) => s.trim()).filter(Boolean);
  const prodHits = staged.filter((f) => (B.productPaths || []).some((p) => f.startsWith(p)));
  const secretHits = staged.filter((f) => (B.secretPaths || []).includes(f));
  const ok = prodHits.length === 0 && secretHits.length === 0;
  let detail = ok ? "無產物/密鑰被 staged" : "";
  if (prodHits.length) detail += `改到建置產物（應改源頭）：${prodHits.join(", ")}；`;
  if (secretHits.length) detail += `密鑰被 staged（絕不可入版控）：${secretHits.join(", ")}；`;
  add("G1 改產物/密鑰", ok, detail);
}

/* ── G5 出貨守門與打包機的改動要留 review 記錄（2026-09-21 使用者裁「寫成規則、建立流程」）──
   病例：打包機 tools/pack-editor.sh 被改過 7 次，docs/reviews/ 只有 1 次落檔（2026-09-16），
   之後 5 次改動全沒留紀錄——包含當日兩場。靠人記得不管用，改由機器擋。
   條文＝DEVELOPMENT.md §3 階段 3／§4 DoD 12；名單真源＝.dod-baseline.json reviewRequiredPaths。 */
if (STAGED) {
  const staged = sh("git diff --cached --name-only --diff-filter=ACM").split("\n").map((s) => s.trim()).filter(Boolean);
  const g = reviewGate(staged, B);
  const detail = g.ok
    ? (g.need.length ? `動了出貨守門 ${g.need.length} 檔，審查記錄同批：${g.record.join(", ")}` : "未動出貨守門／打包機")
    : `動了出貨守門／打包機但沒附審查記錄：${g.need.join(", ")}\n` +
      `     做法：寫 docs/reviews/<主題>-${new Date().toISOString().slice(0, 10)}.md（逐項過 R1~R5、每條綁可核對證據），跟這批一起 git add\n` +
      `     真的來不及：git commit --no-verify，但要補一筆豁免五欄（誰批／為什麼／何時批／何時到期／到期後動作，見 DEVELOPMENT.md §5）`;
  add("G5 出貨守門改動留 review", g.ok, detail);
}

/* ── G6 draft 寫入點基線調動必附登記（2026-09-22 使用者裁 Q3 丙）──
   為什麼要有：G3 是數量閘，而數量閘的逃生口就是改數量。見上方 draftBaselineGate 註解。 */
if (STAGED) {
  const staged = sh("git diff --cached --name-only --diff-filter=ACM").split("\n").map((s) => s.trim()).filter(Boolean);
  // git show 失敗（新檔、無 HEAD）＝回空字串，交給 draftBaselineGate 的 null 分支處理，不在這裡炸。
  const gitShow = (ref) => { try { return execFileSync("git", ["show", ref], { cwd: ROOT, encoding: "utf8" }); } catch (e) { return ""; } };
  const g = draftBaselineGate({
    staged,
    headBaseline: gitShow(`HEAD:${BASELINE_PATH}`),
    stagedBaseline: gitShow(`:${BASELINE_PATH}`),
    headAllow: gitShow(`HEAD:${ALLOW_PATH}`),
    stagedAllow: gitShow(`:${ALLOW_PATH}`),
  });
  add("G6 draft 寫入點基線調動必附登記", g.ok, g.detail);
}

// ── G2 空 catch ratchet（靜默失敗）──
{
  const { n, per } = countAll(trackedJs(), /catch\s*(\([^)]*\))?\s*\{\s*\}/g);
  const ok = n <= B.emptyCatchMax;
  const top = Object.entries(per).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([f, c]) => `${f}×${c}`).join(", ");
  add("G2 空 catch ratchet", ok, ok
    ? `${n} 個（基線上限 ${B.emptyCatchMax}；只准降）`
    : `${n} 個 > 基線 ${B.emptyCatchMax}＝新增了靜默失敗。新 catch 請 log/rethrow/setError，勿留空吞。分布：${top}`);
}

// ── G3 draft.json 寫入點 ratchet（核可不變式）──
{
  const { n } = countAll(trackedJs(), /(?:writeFileSync|copyFileSync)\s*\([^)]*draft\.json/g);
  const ok = n <= B.draftWriters;
  add("G3 draft 寫入點 ratchet", ok, ok
    ? `${n} 個（基線 ${B.draftWriters}）`
    : `${n} 個 > 基線 ${B.draftWriters}＝新增了 draft.json 寫入點。三件做完才准調基線：` +
      `①呼叫 invalidateApproval(id) ②前端走 afterDraftMutation(r) ③到 ${ALLOW_PATH} 登記一行（誰、在哪支、怎麼讓章失效）。` +
      `\n     ⚠ 只把基線改成 ${n} 是不夠的——G6 會擋（調基線必須同批附上登記，調高還要真的多出一筆）。`);
}

// ── G4 tokenizer（price_qa balancedEnd 遇 regex 字面量 FATAL）──
{
  const ft = (B.frameTestCandidates || []).map((c) => path.resolve(ROOT, c)).find((p) => fs.existsSync(p));
  if (!ft) {
    add("G4 tokenizer", true, "SKIP：找不到 FrameTest 源（不在本 repo，屬跨目錄）——部署級 dod-check.sh full 會實跑");
  } else {
    let out = "", ok = true;
    try { out = execFileSync("node", ["price_qa.js", ft, "all", "--skip-http"], { cwd: ROOT, encoding: "utf8" }); }
    catch (e) { ok = false; out = (e.stdout || "") + (e.stderr || ""); }
    if (/FATAL/i.test(out)) ok = false;
    add("G4 tokenizer", ok, ok ? "price_qa --skip-http 抽取無 FATAL" : "price_qa balancedEnd FATAL——FrameTest 源碼可能含 regex 字面量，避免之（見 README 07-21 事故）");
  }
}

// ── 輸出 ──
const failed = results.filter((r) => !r.ok);
console.log(`\ndod-guards（${STAGED ? "staged/pre-commit" : "full"}）：`);
for (const r of results) console.log(`  ${r.ok ? "✅" : "❌"} ${r.name} — ${r.detail}`);
if (failed.length) { console.log(`\n✗ ${failed.length} 項守門未過——修正後再試（或有正當理由時調整 .dod-baseline.json 並於 commit 說明）。\n`); process.exit(1); }
console.log("\n✓ dod-guards 全過。\n");
