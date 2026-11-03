#!/usr/bin/env node
"use strict";
/**
 * tools/aem_budget.js —— 一份匯出檔對 AEM 上限有多遠，而且大在哪裡（2026-09-18 重寫）
 *
 * 用法：
 *   node tools/aem_budget.js <html 或資料夾>...        # 逐檔拆桶
 *   node tools/aem_budget.js <…> --json                # 輸出 JSON（給別的工具吃）
 *
 * 白話：AEM 的頁面編輯器只吃得下「網址編碎後 131,072 個字」。這支工具告訴你一份檔現在多大、
 * 超標幾倍，以及大在哪一塊——引擎程式、樣式、還是內嵌的圖片。回答的是「要瘦身該先動哪裡」。
 *
 * 讀法：三桶（引擎程式／樣式／其餘標記）相加＝總數。內嵌圖片是「交叉項」，它住在前三桶裡面，
 * 單獨列出來是為了回答「只把圖片外連出去能省多少」——所以四個數字相加超過 100% 是對的、不是算錯。
 *
 * 尺與定義＝lib/aem_probe.js（跟產品端匯出器同一把尺，不另寫一份）。
 */
const fs = require("fs");
const path = require("path");
const P = require("../lib/aem_probe");

const args = process.argv.slice(2);
const asJson = args.includes("--json");
const targets = args.filter((a) => !a.startsWith("--"));
if (!targets.length) { console.error("用法：node tools/aem_budget.js <html 或資料夾>… [--json]"); process.exit(2); }

const htmlFiles = (p) => {
  if (!fs.existsSync(p)) { console.error(`❌ 找不到：${p}`); process.exit(2); }
  if (fs.statSync(p).isDirectory()) return fs.readdirSync(p).filter((f) => /\.html?$/i.test(f)).sort().map((f) => path.join(p, f));
  return [p];
};

const files = targets.flatMap(htmlFiles);
const rows = files.map((f) => ({ file: f, name: path.basename(f), ...P.bucketize(fs.readFileSync(f, "utf8")) }));

if (asJson) { console.log(JSON.stringify({ cap: P.AEM_ENCODED_CAP, files: rows }, null, 1)); process.exit(0); }

const n = (x) => String(x).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
console.log(`AEM 頁面編輯上限＝編碎後 ${n(P.AEM_ENCODED_CAP)} 字。以下逐檔拆桶（三桶相加＝總數；內嵌圖片是交叉項、已含在前三桶裡）\n`);
for (const r of rows) {
  const ratio = (r.total.encoded / P.AEM_ENCODED_CAP).toFixed(2);
  console.log(`▍${r.name}`);
  console.log(`   總計　　　 ${n(r.total.encoded)}（${ratio} 倍上限、${r.total.pctOfCap}%）　檔案 ${(r.total.bytes / 1024).toFixed(0)}KB　${r.fits ? "✓ 過得了" : "❌ 超標"}`);
  const b = r.buckets;
  const line = (label, o) => console.log(`   ${label} ${String(n(o.encoded)).padStart(9)}（${String(o.pctOfCap).padStart(5)}%）${o.count > 1 ? `　${o.count} 塊` : ""}`);
  line("引擎程式　 ", b.script);
  line("樣式　　　 ", b.style);
  line("其餘標記　 ", b.markup);
  line("└內嵌圖片※ ", r.inlineImages);
  console.log(`   只把圖片外連出去還剩 ${n(r.withoutImages.encoded)}（${(r.withoutImages.encoded / P.AEM_ENCODED_CAP).toFixed(2)} 倍）＝${r.withoutImages.encoded <= P.AEM_ENCODED_CAP ? "就過了" : "仍然超標，得把引擎剝掉才行"}`);
  console.log("");
}
console.log("※ 交叉項：內嵌圖片住在樣式或標記裡面，所以不要跟前三桶相加。");
