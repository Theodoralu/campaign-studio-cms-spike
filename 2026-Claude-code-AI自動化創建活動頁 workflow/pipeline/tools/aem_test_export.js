#!/usr/bin/env node
"use strict";
/**
 * tools/aem_test_export.js —— 組一份「只給測試用」的 AEM 匯出檔（2026-09-18 重寫）
 *
 * ⚠ 這支工具刻意繞過 CMS 的發佈前把關，**產出物一律不可交付、不可上線**。
 *   它存在的唯一理由：要拿各種版型與商品數的檔去測工程師的瘦身工具、量檔案大小，
 *   而正常那條路會（正確地）在把關沒過時停下來。
 *
 * 用法：
 *   node tools/aem_test_export.js <run id>...           # 產到 dist/aem-test/<run id>/
 *   node tools/aem_test_export.js <run id> --out <dir>  # 換輸出位置
 *   node tools/aem_test_export.js <run id> --full       # 同時產未瘦身的參照版
 *
 * 它一定會做的事（2026-09-18 加的，因為舊版沒做而害人誤判）：
 *   **把來源草稿的把關結果印出來。** 舊版什麼都不說，於是一份「把關判 FAIL」的草稿組出來的測試檔，
 *   看起來跟正常檔一模一樣——09-18 就是這樣，有人（我）花了半天才查出那份檔上 27 張商品卡
 *   沒有貨號不是程式漏埋，而是商品不夠、該隱藏的區塊沒隱藏、露出了範本內建的示範商品。
 *   紅色的來源不該被一個看起來正常的產出物藏起來。
 */
const fs = require("fs");
const path = require("path");

const PIPE = __dirname + "/..";
const DEPLOY_SITE = path.join(PIPE, "..", "..", "2026-AI自動化活動頁生成規劃", "deploy-site");
const FRAME = path.join(DEPLOY_SITE, "lecreuset-frametest");
const aem = require(path.join(PIPE, "lib", "aem_export.js"));

const args = process.argv.slice(2);
const outArg = args.includes("--out") ? args[args.indexOf("--out") + 1] : null;
const wantFull = args.includes("--full");
const ids = args.filter((a, i) => !a.startsWith("--") && args[i - 1] !== "--out");
if (!ids.length) { console.error("用法：node tools/aem_test_export.js <run id>… [--out dir] [--full]"); process.exit(2); }

/** 把來源草稿的把關結果講清楚——沒有報告也要說「沒有報告」，不能沉默。 */
function gateVerdict(runDir) {
  const p = path.join(runDir, "gate_report.json");
  if (!fs.existsSync(p)) return { known: false, say: "這份草稿沒有把關報告（沒跑過發佈前檢查）——測試檔可以用，但別把它當成能出貨的證據" };
  try {
    const g = JSON.parse(fs.readFileSync(p, "utf8"));
    const fails = (g.findings || []).filter((f) => /FAIL/i.test(String(f.level || "")));
    return {
      known: true, result: g.result, fails,
      say: g.result === "PASS"
        ? "來源草稿把關 PASS"
        : `來源草稿把關 ${g.result}——${fails.length} 項必修：${fails.map((f) => `[${f.code}] ${f.msg}`).join("；") || "(報告未列明細)"}`,
    };
  } catch (e) { return { known: false, say: `把關報告讀不起來（${e.message}）` }; }
}

(async () => {
  let bad = 0;
  for (const id of ids) {
    const runDir = path.join(PIPE, "runs", id);
    if (!fs.existsSync(path.join(runDir, "draft.json"))) { console.error(`❌ ${id}：找不到 runs/${id}/draft.json`); bad++; continue; }
    const draft = JSON.parse(fs.readFileSync(path.join(runDir, "draft.json"), "utf8"));
    const layout = String((draft.page || {}).kvVariant || "").trim();
    const verdict = gateVerdict(runDir);

    console.log(`\n▍${id}　${layout}　${(draft.page || {}).pageName || ""}`);
    console.log(`   ${verdict.known && verdict.result === "PASS" ? "✓" : "⚠"} ${verdict.say}`);
    if (verdict.known && verdict.result !== "PASS") {
      console.log("   ⚠ 這份測試檔是從一份把關沒過的草稿組出來的。畫面上可能有範本內建的示範商品（商品不夠時該隱藏的區塊沒隱藏），");
      console.log("     那不是程式的錯，是這份草稿的商品不足。**不要拿它當交付物，也不要照它的畫面下結論。**");
    }

    let defaultBackground = null;
    try {
      const layoutLib = require(path.join(PIPE, "lib", "layout_choice.js"));
      const rec = layoutLib.loadLayoutDeps().registries.layoutRecords.get(layout);
      defaultBackground = rec && rec.defaultBackground;
    } catch (e) { console.log(`   ⓘ 版型預設背景解析失敗（照背景地圖預設表）：${e.message}`); }

    const tpl = fs.readFileSync(path.join(FRAME, "index.html"), "utf8");
    const deps = aem.loadDeps({ frameDir: FRAME, projectRoot: path.join(DEPLOY_SITE, "..", ".."), defaultBackground });
    const outDir = outArg || path.join(PIPE, "dist", "aem-test", id);
    fs.mkdirSync(outDir, { recursive: true });

    const slim = await aem.assembleAemHtml({ template: tpl, draft, deps, mode: "slim" });
    const slimPath = path.join(outDir, `測試檔-${id}.html`);
    fs.writeFileSync(slimPath, slim.html);
    const b = slim.report.aemBudget;
    console.log(`   ✓ ${path.relative(process.cwd(), slimPath)}　編碎後 ${b.encoded}／${b.cap}＝${b.ratio} 倍${b.fits ? "（過）" : "（超標）"}`);
    if (slim.report.warnings.length) slim.report.warnings.forEach((w) => console.log(`     ⚠ ${w}`));

    if (wantFull) {
      const full = await aem.assembleAemHtml({ template: tpl, draft, deps, mode: "full" });
      const fp = path.join(outDir, `參照未瘦身-${id}.html`);
      fs.writeFileSync(fp, full.html);
      console.log(`   ✓ ${path.relative(process.cwd(), fp)}（參照版）`);
    }
    fs.writeFileSync(path.join(outDir, "這批是什麼.txt"),
`這個資料夾裡的檔案是「只給測試用」的 AEM 匯出檔（tools/aem_test_export.js 產出）。

不可交付、不可上線。理由兩個：
1. 它刻意繞過了發佈前的把關（正常那條路在把關沒過時會停下來，這支不會）。
2. 裡面的價格是草稿當時抓到的快照，不是今天的真值。

來源 run：${id}
版型：${layout}
來源草稿把關：${verdict.say}
產出時間：${new Date().toISOString()}
`);
  }
  console.log(`\n輸出在 ${outArg || "dist/aem-test/<run id>/"}（已附「這批是什麼.txt」）。再說一次：這些檔不可交付、不可上線。`);
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error("❌ " + e.message); process.exit(1); });
