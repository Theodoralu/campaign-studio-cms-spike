"use strict";
/**
 * fetch_uther.js —— ① 抓取（uther 版）：Yahoo 購物中心 URL → snapshot.json（D6）
 * 用法：node fetch_uther.js <URL> <輸出資料夾>
 *
 * 與 fetch_parse.js 同進同出（同樣的網址、同樣的 snapshot.json），差別是商品資料來自 EC Search uther API，不爬網頁。
 * 只有「品牌頁」還要抓一次 HTML 拿 brandId（uther 沒有 slug→id 的路）。
 *
 * 環境：UTHER_BASE_URL、UTHER_SPACE_ID（見 core/uther/client.js）；CS_HTTP_MODE=record|replay 錄製回放；CS_NOW 固定時鐘。
 * 第一版兩條路並存：workbench 預設仍走 fetch_parse；CS_SOURCE=uther 切到這支（D11 接線）。
 */
const fs = require("fs");
const path = require("path");
const clock = require("./lib/clock");
const httpReplay = require("./lib/http_replay");
const { resolveSource } = require("./core/source/resolve");
const { buildSnapshot } = require("./core/source/build_snapshot");
const { createUtherClient } = require("./core/uther/client");
const { fetchPage } = require("./fetch_parse");

/** 品牌頁 → brandId（沿用 fetchPage，可錄製回放）。頁面 SSR JSON 裡的鍵名待 D7 用真頁確認，先多認幾種寫法。 */
async function fetchBrandId(plan) {
  const { html } = await fetchPage(plan.url);
  const ids = new Set();
  for (const re of [/"brandId"\s*:\s*"?(\d+)"?/g, /"brand_id"\s*:\s*"?(\d+)"?/g, /[?&]brandIds=(\d+)/g]) for (const m of html.matchAll(re)) ids.add(m[1]);
  const nm = html.match(/"brandName"\s*:\s*"([^"]+)"/) || html.match(/"freqQuery"\s*:\s*"([^"]+)"/);
  return { brandIds: [...ids], brandName: nm ? nm[1] : null };
}

async function main() {
  const [url, outDir] = process.argv.slice(2);
  if (!url || !outDir) { console.error("用法：node fetch_uther.js <URL> <輸出資料夾>"); process.exit(1); }
  const plan = resolveSource(url);
  if (plan.kind === "invalid" || plan.kind === "unsupported" || plan.kind === "product") { console.error(`FATAL: ${plan.reason}`); process.exit(1); }
  console.log(`[1/2] 來源判型：${plan.kind} ${JSON.stringify({ actid: plan.actid, storeId: plan.storeId, keyword: plan.keyword, slug: plan.slug })}（uther ${httpReplay.mode()} 模式）`);
  const uther = createUtherClient({ log: (s) => console.log(s) });
  const snapshot = await buildSnapshot(plan, { uther, clock, fetchBrandId, log: (s) => console.log("  " + s) });
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, "snapshot.json"), JSON.stringify(snapshot, null, 2));
  console.log(`[2/2] 快照落檔：${snapshot.products.length} 件商品／${snapshot.promotions.length} 檔活動／最低折數 ${snapshot.minDisc ?? "無"}／uther 請求 ${uther.calls.length} 次`);
  if (snapshot.warnings.length) console.log("warnings:\n  - " + snapshot.warnings.join("\n  - "));
}

if (require.main === module) main().catch((e) => { console.error("FATAL:", e.message); if (e.traceId) console.error("traceId:", e.traceId); process.exit(1); });
module.exports = { fetchBrandId };
