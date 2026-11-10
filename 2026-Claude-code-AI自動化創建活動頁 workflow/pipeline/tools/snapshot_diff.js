#!/usr/bin/env node
"use strict";
/**
 * tools/snapshot_diff.js —— 兩份 snapshot 的差異報告（D6；規則 2「換前提的 commit 要附新舊輸出差異」）
 * 用法：node tools/snapshot_diff.js <舊 snapshot.json> <新 snapshot.json> [--md 輸出.md]
 *
 * 比什麼：商品集合（只在舊／只在新／兩邊都有）、兩邊都有的商品逐欄（name、price、marketPrice、disc、url、imgs[0]）、
 *         活動集合與檔期、根欄位（brand、promotions 數、warnings）。
 * 輸出 Markdown，直接貼進 commit／PR。
 */
const fs = require("fs");
const args = process.argv.slice(2);
const mdIdx = args.indexOf("--md");
const mdOut = mdIdx >= 0 ? args.splice(mdIdx, 2)[1] : null;
const [aPath, bPath] = args;
if (!aPath || !bPath) { console.error("用法：node tools/snapshot_diff.js <舊> <新> [--md out.md]"); process.exit(1); }
const A = JSON.parse(fs.readFileSync(aPath, "utf8")), B = JSON.parse(fs.readFileSync(bPath, "utf8"));
const byId = (s) => Object.fromEntries((s.products || []).map((p) => [String(p.gdid), p]));
const pa = byId(A), pb = byId(B);
const onlyA = Object.keys(pa).filter((k) => !pb[k]), onlyB = Object.keys(pb).filter((k) => !pa[k]), both = Object.keys(pa).filter((k) => pb[k]);
const FIELDS = ["name", "price", "marketPrice", "disc", "url"];
const cell = (v) => (v == null ? "—" : String(v).replace(/\|/g, "\\|").slice(0, 60));
const lines = [];
const L = (s = "") => lines.push(s);
L(`# snapshot 差異報告`); L(); L(`- 舊：\`${aPath}\`（${A.products.length} 件，source ${A.products[0] && A.products[0].source || "scrape"}，fetchedAt ${A.fetchedAt}）`);
L(`- 新：\`${bPath}\`（${B.products.length} 件，source ${B.products[0] && B.products[0].source || "?"}，fetchedAt ${B.fetchedAt}）`); L();
L(`## 商品集合`); L(`| | 數 | gdid |`); L(`|---|---|---|`);
L(`| 兩邊都有 | ${both.length} | |`); L(`| 只在舊 | ${onlyA.length} | ${onlyA.slice(0, 20).join(", ")}${onlyA.length > 20 ? "…" : ""} |`); L(`| 只在新 | ${onlyB.length} | ${onlyB.slice(0, 20).join(", ")}${onlyB.length > 20 ? "…" : ""} |`); L();
const fieldDiff = {}; const rows = [];
for (const k of both) for (const f of FIELDS) { const x = pa[k][f], y = pb[k][f]; if (JSON.stringify(x) !== JSON.stringify(y)) { fieldDiff[f] = (fieldDiff[f] || 0) + 1; rows.push(`| ${k} | ${f} | ${cell(x)} | ${cell(y)} |`); } }
const imgDiff = both.filter((k) => (pa[k].imgs || [])[0] !== (pb[k].imgs || [])[0]);
L(`## 兩邊都有的商品：逐欄不同`); L(`| 欄 | 不同件數／${both.length} |`); L(`|---|---|`);
for (const f of FIELDS) L(`| ${f} | ${fieldDiff[f] || 0} |`); L(`| imgs[0] | ${imgDiff.length} |`); L();
if (rows.length) { L(`<details><summary>逐件（${rows.length} 列）</summary>`); L(); L(`| gdid | 欄 | 舊 | 新 |`); L(`|---|---|---|---|`); rows.slice(0, 200).forEach((r) => L(r)); if (rows.length > 200) L(`| … | | | |`); L(); L(`</details>`); L(); }
const actA = Object.keys(A.activities || {}), actB = Object.keys(B.activities || {});
L(`## 活動`); L(`| | 舊 | 新 |`); L(`|---|---|---|`); L(`| activities | ${actA.join(", ") || "—"} | ${actB.join(", ") || "—"} |`); L(`| promotions | ${(A.promotions || []).length} | ${(B.promotions || []).length} |`);
for (const id of actA.filter((x) => actB.includes(x))) { const x = A.activities[id], y = B.activities[id]; if (x.startTs !== y.startTs || x.endTs !== y.endTs) L(`| 檔期 ${id} | ${x.startTs}–${x.endTs} | ${y.startTs}–${y.endTs} |`); }
L(); L(`## 根欄位`); L(`| 欄 | 舊 | 新 |`); L(`|---|---|---|`);
for (const f of ["brand", "minDisc"]) L(`| ${f} | ${cell(A[f])} | ${cell(B[f])} |`);
L(`| hits | ${(A.hits || []).length} | ${(B.hits || []).length} |`); L(`| warnings | ${(A.warnings || []).length} | ${(B.warnings || []).length} |`);
L(`| 新增欄（新才有） | | ${[...new Set(Object.values(pb).flatMap((p) => Object.keys(p)))].filter((f) => !Object.values(pa).some((p) => f in p)).join(", ") || "—"} |`);
const out = lines.join("\n") + "\n";
if (mdOut) { fs.writeFileSync(mdOut, out); console.log(`寫入 ${mdOut}`); } else process.stdout.write(out);
