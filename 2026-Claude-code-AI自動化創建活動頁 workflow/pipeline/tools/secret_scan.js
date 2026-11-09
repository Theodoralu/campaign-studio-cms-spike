#!/usr/bin/env node
"use strict";
/**
 * tools/secret_scan.js —— 密鑰與個人路徑掃描（D5，2026-11-09）
 *
 * 目標（spike 驗收條件）：repo 不含個人路徑與密鑰。掃 git 追蹤的文字檔，命中＝exit 1 並列出檔名、行號、規則。
 * 不用外部 Action（spike repo 在個人帳號，先不依賴 marketplace；搬進組織後可換 gitleaks，規則並存）。
 *
 * 用法：node tools/secret_scan.js [repoRoot]      （預設＝上一層 repo 根）
 * 排除：node_modules、.git、二進位、卡帶（test/fixtures/http 內是公開網頁原文）。
 * 允許清單：同一行尾端加註 `secret-scan: allow` 即略過（要寫理由）。
 */
const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const root = path.resolve(process.argv[2] || execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim());
const files = execFileSync("git", ["ls-files", "-z"], { cwd: root, encoding: "utf8" }).split("\0").filter(Boolean);

const RULES = [
  { id: "aws-access-key", re: /\b(AKIA|ASIA)[0-9A-Z]{16}\b/ },
  { id: "aws-secret-key", re: /aws_secret_access_key\s*[=:]\s*["']?[A-Za-z0-9/+=]{40}/i },
  { id: "private-key", re: /-----BEGIN (RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/ },
  { id: "github-token", re: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/ },
  { id: "slack-token", re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/ },
  { id: "google-api-key", re: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { id: "jwt", re: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/ },
  { id: "okta-token", re: /\b00[A-Za-z0-9_-]{40}\b.*okta/i },
  { id: "generic-secret-assignment", re: /\b(password|passwd|secret|api[_-]?key|client[_-]?secret|token)\b\s*[=:]\s*["'](?![a-z]+\/[a-z0-9-]+["'])[^"'\s]{12,}["']/i }, // 排除 design token 路徑 token:"campaign/page-bg"
  { id: "personal-path", re: /\/Users\/[a-z][a-z0-9._-]{1,30}\//i },
  { id: "home-path", re: /\/home\/[a-z][a-z0-9._-]{1,30}\//i },
  { id: "yahoo-corp-email", re: /\b[a-z0-9._-]+@(yahooinc|yahoo-inc|verizonmedia)\.com\b/i },
];
const SKIP_DIR = /(^|\/)(node_modules|\.git|dist|test\/fixtures\/http)(\/|$)/;
const SKIP_EXT = /\.(png|jpe?g|gif|webp|svg|ico|woff2?|ttf|otf|eot|pdf|zip|gz|mp4|mov|xlsx|docx|pptx|lock)$/i;
const ALLOW = /secret-scan:\s*allow/;
const SELF = "tools/secret_scan.js";

let hits = 0;
for (const rel of files) {
  if (SKIP_DIR.test(rel) || SKIP_EXT.test(rel) || rel.endsWith(SELF)) continue;
  let buf;
  try { buf = fs.readFileSync(path.join(root, rel)); } catch (_) { continue; }
  if (buf.includes(0)) continue; // 二進位
  const lines = buf.toString("utf8").split("\n");
  lines.forEach((ln, i) => {
    if (ALLOW.test(ln)) return;
    for (const r of RULES) {
      if (r.re.test(ln)) { hits++; console.log(`${rel}:${i + 1}  [${r.id}]  ${ln.trim().slice(0, 120)}`); break; }
    }
  });
}
if (hits) { console.error(`\n✖ secret_scan：${hits} 處命中。真的要留請在該行尾加「secret-scan: allow ＋理由」。`); process.exit(1); }
console.log(`✔ secret_scan：${files.length} 個追蹤檔，無密鑰、無個人路徑`);
