#!/usr/bin/env node
"use strict";
/**
 * tools/uther_probe.js —— uther 連線與上限探測（D6／D7）。要在連得到 tw.search.ec.yahoo.com 的機器跑。
 * 用法：node tools/uther_probe.js <snapshot.json>   以該快照的 gdid 清單打 v3 products：
 *   ① 1 件（連得到嗎、回應長什麼樣）
 *   ② 61 件一批（文件正文說 60、錯誤表說 10——看伺服器實際回什麼）
 *   ③ 10 件一批（確認降級路一定可用）
 * 搭 CS_HTTP_MODE=record 一起把回應錄進卡帶。
 */
const fs = require("fs");
const { createUtherClient, UtherError } = require("../core/uther/client");

(async () => {
  const [snapPath] = process.argv.slice(2);
  if (!snapPath) { console.error("用法：node tools/uther_probe.js <snapshot.json>"); process.exit(1); }
  const ids = [...new Set(JSON.parse(fs.readFileSync(snapPath, "utf8")).products.map((p) => String(p.gdid)))];
  while (ids.length < 61) ids.push(String(10000000 + ids.length)); // 不夠 61 件就補假 id（查不到不算錯）
  const c = createUtherClient({ log: console.log });
  const tryBatch = async (label, list, batchSize) => {
    try { const r = await c.productsByIds(list, { batchSize }); console.log(`✔ ${label}：回 ${r.items.length} 件、查不到 ${r.missing.length} 件、請求 ${c.calls.length} 次`); return r; }
    catch (e) { console.log(`✖ ${label}：${e.message}${e instanceof UtherError ? `（HTTP ${e.status} code ${e.code}）` : ""}`); return null; }
  };
  const one = await tryBatch("① 1 件", ids.slice(0, 1), 60);
  if (one && one.items[0]) console.log(JSON.stringify(one.items[0], null, 1).slice(0, 1500));
  c.calls.length = 0; await tryBatch("② 61 件一批", ids.slice(0, 61), 61);
  c.calls.length = 0; await tryBatch("③ 10 件一批", ids.slice(0, 20), 10);
  console.log("\n最後一次請求：", c.calls.map((x) => `${x.status} ${x.code || ""} ${x.ms}ms`).join(" | "));
})();
