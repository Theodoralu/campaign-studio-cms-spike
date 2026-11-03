#!/usr/bin/env node
"use strict";
/**
 * CMS 模組欄位清查（2026-09-25 使用者指示「CMS 所有模組版型欄位清查」）——
 * 對「欄位字典」裡每一欄，數它在四個地方各出現幾次：
 *   引擎（FrameTest，畫面怎麼畫）／gate.js（發佈前合規）／lib/content_modules.js（內文模組驗證）／
 *   workbench/content_checks.js＋server.js（連結與商品狀態檢查）／前端 gateFieldRef（報告能不能指到欄位）。
 * 然後只印「對不上」的欄：引擎不讀（幽靈檢查候選）／沒人檢（檢查盲區候選）／報告指不到。
 *
 * 這是底圖，不是判決：字面對不上有三種可能——真的盲區、檢查用登記簿泛型讀取（字面不會出現）、
 * 控制欄位（本來就不畫）。每一條旗標都要人看程式碼確認，結論寫在 docs/stories/cms-field-inventory.md。
 *
 * 用法：node tools/field_inventory.js [--all]     --all＝連沒旗標的欄也印
 * 依賴：欄位字典 CSV（deploy-site/tracking/ga4-field-dictionary.csv，由 deploy-site/sync.sh 從
 *       規劃/tools/lib/field-dictionary.mjs 重產）；引擎＝規劃/MVP_Phase1_LeCreuset_活動頁Prototype_FrameTest.html。
 */
const fs = require("fs");
const path = require("path");

const PIPE = path.resolve(__dirname, "..");
const PLAN = path.resolve(PIPE, "..", "..", "2026-AI自動化活動頁生成規劃");
const ALL = process.argv.includes("--all");

function read(p) { if (!fs.existsSync(p)) { console.error("找不到：" + p); process.exit(2); } return fs.readFileSync(p, "utf8"); }
const engine = read(path.join(PLAN, "MVP_Phase1_LeCreuset_活動頁Prototype_FrameTest.html"));
const checkers = {
  gate: read(path.join(PIPE, "gate.js")),
  lib: read(path.join(PIPE, "lib", "content_modules.js")),
  cc: read(path.join(PIPE, "workbench", "content_checks.js")),
  srv: read(path.join(PIPE, "workbench", "server.js")),
};
const ui = read(path.join(PIPE, "workbench", "public", "index.html"));
const refSrc = (ui.match(/function gateFieldRef\(msg\)\{[\s\S]*?\n\}/) || [""])[0];
if (!refSrc) { console.error("index.html 找不到 gateFieldRef——報告映射那一欄會全空"); }

/* 欄位字典 CSV（欄位可能含逗號＝要處理引號） */
function parseCsv(txt) {
  const rows = []; let q = false, row = [], f = "";
  for (const ch of txt) {
    if (ch === "\"") { q = !q; continue; }
    if (ch === "," && !q) { row.push(f); f = ""; continue; }
    if (ch === "\n" && !q) { row.push(f); rows.push(row); row = []; f = ""; continue; }
    f += ch;
  }
  if (f || row.length) { row.push(f); rows.push(row); }
  return rows;
}
const rows = parseCsv(read(path.join(PLAN, "deploy-site", "tracking", "ga4-field-dictionary.csv")));
const H = rows[0], col = (n) => H.indexOf(n);

/* 泛用鍵（url／img／title…）到處都有，字面計數沒有意義＝跳過、由人看 */
const GENERIC = new Set(["url", "urls", "img", "imgs", "title", "tag", "label", "copy", "sub", "date", "gdid", "variant", "items", "position", "chip", "name", "rows", "banner", "hero", "floors", "walls", "promoEntries", "heroCard", "products", "default"]);
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const count = (s, tok) => (s.match(new RegExp("(^|[^A-Za-z0-9_-])" + esc(tok) + "($|[^A-Za-z0-9_-])", "g")) || []).length;

let flagged = 0, total = 0, lastMod = "";
console.log("欄位清查 " + new Date().toISOString().slice(0, 10) + "｜欄位字典 " + (rows.length - 1) + " 欄");
console.log("欄位｜鍵｜引擎 gate lib cc srv｜報告｜旗標｜字典說機器驗什麼");
for (const r of rows.slice(1)) {
  if (r.length < 6) continue;
  const mod = r[col("module_id")], fld = r[col("欄位")], claim = (r[col("機器驗什麼")] || "").replace(/\*\*/g, "").slice(0, 36);
  if (!fld || /^（/.test(fld)) continue;
  const toks = [...new Set(fld.split(/／|\/|（|）|→|\(|\)|,|，| /).flatMap((s) => s.split(".")).map((s) => s.replace(/\[\]$/, "").trim()).filter((s) => s && !/^layout/.test(s) && !GENERIC.has(s)))];
  for (const t of toks) {
    total++;
    const e = count(engine, t), g = count(checkers.gate, t), l = count(checkers.lib, t), c = count(checkers.cc, t), s = count(checkers.srv, t), rr = count(refSrc, t);
    const flags = [];
    if (e === 0) flags.push("引擎不讀");
    if (g + l + c + s === 0) flags.push("沒人檢");
    if (e > 0 && g + l + c + s > 0 && rr === 0) flags.push("報告指不到");
    if (!flags.length && !ALL) continue;
    if (flags.length) flagged++;
    if (mod !== lastMod) { console.log("── " + mod); lastMod = mod; }
    console.log("  " + fld.slice(0, 30).padEnd(30) + "｜" + t.padEnd(18) + "｜" + String(e).padStart(3) + String(g).padStart(4) + String(l).padStart(4) + String(c).padStart(3) + String(s).padStart(4) + "｜" + (rr ? "✓" : "·") + "｜" + flags.join("，").padEnd(14) + "｜" + claim);
  }
}
console.log("\n" + total + " 個鍵、" + flagged + " 個有旗標。旗標＝要人看，不是判決（登記簿泛型讀取與控制欄位會被誤標）。結論＝docs/stories/cms-field-inventory.md");
