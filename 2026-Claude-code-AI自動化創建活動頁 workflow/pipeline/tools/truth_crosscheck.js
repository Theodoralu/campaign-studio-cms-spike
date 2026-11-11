#!/usr/bin/env node
"use strict";
/**
 * tools/truth_crosscheck.js —— 兩層真值交叉驗證（D7 驗收：抽查 N 件，uther 價格 vs 商品頁價格一致）
 * 用法：node tools/truth_crosscheck.js <snapshot.json> [N=20] [--md 報告.md]
 * 要在連得到 uther 與 tw.buy.yahoo.com 的機器跑（兩層都是真打）。輸出一張表：每件 uther 價／頁價／劃線價／狀態是否一致。
 * 同時量兩層耗時，給 D11 決定建立期要不要只走 uther。
 */
const fs = require("fs");
const path = require("path");
const clock = require("../lib/clock");
const { createUtherClient } = require("../core/uther/client");
const layers = require("../core/product-truth/layers");
const { fetchPage } = require("../fetch_parse");
const { classifyProductLiveness } = require("../price_qa");
const { probeProductLiveness, gdidOf } = require("../workbench/product_fetch");

(async () => {
  const args = process.argv.slice(2); const mi = args.indexOf("--md"); const md = mi >= 0 ? args.splice(mi, 2)[1] : null;
  const [snapPath, nArg] = args; const N = Number(nArg) || 20;
  if (!snapPath) { console.error("用法：node tools/truth_crosscheck.js <snapshot.json> [N] [--md out.md]"); process.exit(1); }
  const snap = JSON.parse(fs.readFileSync(snapPath, "utf8"));
  const sample = snap.products.slice(0, N);
  const gdids = sample.map((p) => String(p.gdid));

  let t0 = Date.now();
  const u = await layers.utherLayer(gdids, { uther: createUtherClient({ log: console.log }), clock });
  const utherMs = Date.now() - t0;
  t0 = Date.now();
  const productLiveness = (a) => probeProductLiveness({ ...a, fetchPage, classifyProductLiveness });
  const pg = await layers.pageLayer(sample, { productLiveness, gdidOf });
  const pageMs = Date.now() - t0;

  const L = []; const push = (s = "") => L.push(s);
  push(`# 兩層真值交叉驗證（${clock.iso()}）`); push();
  push(`- 來源：\`${path.basename(snapPath)}\`（${snap.sourceUrl}），抽前 ${sample.length} 件`);
  push(`- uther 層 ${utherMs} ms（${Math.ceil(gdids.length / 60)} 次請求）；商品頁層 ${pageMs} ms（${sample.length} 件逐抓）`); push();
  push(`| gdid | 狀態 uther／頁 | 價 uther／頁 | 劃線 uther／頁 | 一致 |`); push(`|---|---|---|---|---|`);
  let same = 0, diff = 0, unv = 0;
  for (const g of gdids) {
    const a = u.get(g), b = pg.get(g);
    if (!b || b.error) { unv++; push(`| ${g} | ${a.status}／unverified | ${a.prod ? a.prod.price : "—"}／— | | ？ |`); continue; }
    const pa = a.prod ? a.prod.price : null, pb = b.prod ? b.prod.price : null;
    const la = a.prod ? a.prod.listPrice : null, lb = b.prod ? b.prod.listPrice : null;
    const unknownList = a.prod && a.prod.listPriceUnknown;
    const okRow = a.status === b.status && pa === pb && (unknownList || (la || null) === (lb || null));
    okRow ? same++ : diff++;
    push(`| ${g} | ${a.status}／${b.status}${a.evidence && a.evidence.stockStatus && a.evidence.stockStatus !== "NORMAL" ? `（${a.evidence.stockStatus}）` : ""} | ${pa ?? "—"}／${pb ?? "—"} | ${unknownList ? "uther 無" : la ?? "—"}／${lb ?? "—"} | ${okRow ? "✔" : "✖"} |`);
  }
  push(); push(`**一致 ${same}／不一致 ${diff}／頁面驗不到 ${unv}**（比實付價與狀態；劃線價只在 uther 有活動價時比——uther 沒有廠商市價欄，劃線價真值只有商品頁）`);
  const out = L.join("\n") + "\n";
  if (md) { fs.writeFileSync(md, out); console.log(`寫入 ${md}`); } else process.stdout.write(out);
})().catch((e) => { console.error("FATAL:", e.message); process.exit(1); });
