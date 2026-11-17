#!/usr/bin/env node
"use strict";
/**
 * tools/ci_aem_verify.js —— CP-32 在 CI 跑一次（D10，2026-11-17）
 *
 * 白話：拿黃金夾具走完整條主流程的後半段——收尾（D9）→ 發佈前檢查（D10）→ 組 AEM 檔（D10）→ 用真 Chrome 在桌機／平板／手機打開比對（CP-32）。
 * 全程不連外：檢查跳過圖片 HTTP，顯示檢查本來就把外部網路擋掉。需要機器上有 Google Chrome（GitHub 的 ubuntu-latest 內建；Mac 有裝也能跑）。
 *
 * 用法：node tools/ci_aem_verify.js [--out <dir>] [--no-verify]
 *   --no-verify  只組檔、不開瀏覽器（沒有 Chrome 的環境用來看前半段通不通）
 * exit 0＝全過；1＝檢查或顯示檢查沒過；2＝環境問題（組不出檔）。
 */
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const PIPE = path.join(__dirname, "..");
const FIX = path.join(PIPE, "test", "fixtures", "runs", "2026-10-27-wb-085823");
const read = (f) => JSON.parse(fs.readFileSync(path.join(FIX, f), "utf8"));
const args = process.argv.slice(2);
const outDir = args.includes("--out") ? path.resolve(args[args.indexOf("--out") + 1]) : fs.mkdtempSync(path.join(os.tmpdir(), "cs-aem-ci-"));
const noVerify = args.includes("--no-verify");
process.env.CS_NOW = process.env.CS_NOW || "2026-10-27T00:58:24.018Z";

async function prepare() {
  const finish = require(path.join(PIPE, "core", "finish"));
  const gate = require(path.join(PIPE, "core", "gate"));
  const exp = require(path.join(PIPE, "core", "export"));
  const draft = read("draft.golden.json"), snapshot = read("snapshot.replay.json"), meta = read("wb_meta.json");
  delete draft.page.hero; delete draft.page.kvVariant;
  const fin = finish.finishDraft({ draft, snapshot, input: meta.input });
  const report = await gate.check({ snapshot: fin.snapshot, draft: fin.draft, meta, skipHttp: true });
  const built = report.counts.FAIL ? null : await exp.buildAem({ id: "ci-fixture", draft: fin.draft, meta, assetRoots: exp.defaultAssetRoots(PIPE) });
  return { fin, report, built, exp };
}

async function main() {
  let p;
  try { p = await prepare(); } catch (e) { console.error("✖ 組檔失敗：" + ((e && e.stack) || e)); process.exit(2); }
  console.log(`收尾：${p.fin.logs.length} 行 log；版式 ${p.fin.draft.page.kvVariant}`);
  console.log(`發佈前檢查：${p.report.result}（FAIL ${p.report.counts.FAIL}／WARN ${p.report.counts.WARN}）`);
  if (!p.built) { for (const f of p.report.findings.filter((x) => x.level === "FAIL")) console.error(`  [FAIL] ${f.code} ${f.msg}`); process.exit(1); }
  fs.mkdirSync(outDir, { recursive: true });
  const slim = path.join(outDir, p.built.fileName), full = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "cs-aem-ref-")), "_reference-full.html"), verifyJson = path.join(outDir, "aem-verify.json");
  fs.writeFileSync(slim, p.built.slimHtml); fs.writeFileSync(full, p.built.fullHtml);
  fs.writeFileSync(path.join(outDir, "aem-build-report.json"), JSON.stringify(p.built.report, null, 1));
  for (const l of p.exp.buildLogs(p.built.fileName, p.built.report)) console.log(l);
  if (noVerify) { console.log(`（--no-verify）已組檔、未做顯示檢查：${outDir}`); return; }
  const v = spawnSync(process.execPath, [path.join(PIPE, "aem_verify.js"), slim, p.built.layout, "--ref", full, "--out", verifyJson], { cwd: PIPE, encoding: "utf8", timeout: 240000 });
  fs.rmSync(path.dirname(full), { recursive: true, force: true }); // 參照版只給比對用，不留在產物資料夾
  process.stdout.write(v.stdout || ""); process.stderr.write(v.stderr || "");
  let hosts = []; try { hosts = JSON.parse(fs.readFileSync(verifyJson, "utf8")).externalHosts || []; } catch (e) { /* 沒產報告＝下面照 exit code 判 */ }
  fs.writeFileSync(path.join(outDir, "README.txt"), p.exp.readme({ id: "ci-fixture", pageName: p.fin.draft.page.pageName, bytes: fs.statSync(slim).size, budget: p.built.report.aemBudget || null, hosts, now: new Date().toISOString() }));
  console.log(v.status === 0 ? `✔ CP-32 三裝置顯示檢查通過；外連網域：${hosts.join("、") || "（無）"}；產物：${outDir}` : `✖ CP-32 沒過（exit ${v.status}${v.error ? "；" + v.error.message : ""}）`);
  process.exit(v.status === 0 ? 0 : 1);
}
if (require.main === module) main();
module.exports = { prepare };
