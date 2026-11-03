/* 分享站「建頁流程」鏡像頁產生器（2026-09-15 C 批，牆第 7 題甲）——給還沒裝活動頁工具的人先看流程。
   文案單一真源＝lib/flow_guide_copy.json（CMS 歡迎三格、策略檔頁、內容策略區同一份）；本檔只排版。
   用法：node tools/gen-flow-guide.mjs [--check]   產物＝規劃/76_活動頁工具_建頁流程說明頁.html（機器產出、勿手改；sync.sh cp 到 portable-cms/flow/）。 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const HERE = path.dirname(fileURLToPath(import.meta.url));
const PIPE = path.resolve(HERE, "..");
const OUT = path.resolve(PIPE, "..", "..", "2026-AI自動化活動頁生成規劃", "76_活動頁工具_建頁流程說明頁.html");
const CHECK = process.argv.includes("--check");
const C = JSON.parse(fs.readFileSync(path.join(PIPE, "lib", "flow_guide_copy.json"), "utf8"));
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const steps = (list) => list.map((s, i) => `<li><span class="no">${i + 1}</span><div><b>${esc(s.h)}</b><p>${esc(s.p)}</p></div></li>`).join("\n");
const html = `<!doctype html>
<html lang="zh-Hant">
<head>
  <meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  <title>活動頁工具：建一頁活動，六步｜給還沒裝工具的同事</title>
  <!-- 機器產出（pipeline/tools/gen-flow-guide.mjs）勿手改；文案改 pipeline/lib/flow_guide_copy.json 再重跑 -->
  <style>
    :root{--ink:#191919;--sub:#5b636a;--line:#e0e4e9;--acc:#3e5bfd;--bg:#fafbfc}
    body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.75 -apple-system,"PingFang TC","Noto Sans TC",sans-serif}
    main{max-width:920px;margin:0 auto;padding:32px 20px 80px}
    h1{font-size:26px;margin:0 0 6px}.lead{color:var(--sub);margin:0 0 22px}
    h2{font-size:19px;margin:32px 0 10px}
    .cards{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}@media (max-width:700px){.cards{grid-template-columns:1fr}}
    .cards div{background:#fff;border:1px solid var(--line);border-radius:12px;padding:14px 16px}.cards b{display:block;margin-bottom:4px}
    ol.steps{list-style:none;padding:0;margin:0;display:grid;gap:10px}
    ol.steps li{display:flex;gap:12px;background:#fff;border:1px solid var(--line);border-radius:12px;padding:14px 16px}
    ol.steps .no{flex:none;width:26px;height:26px;border-radius:50%;background:var(--acc);color:#fff;font-weight:700;font-size:13px;display:flex;align-items:center;justify-content:center;margin-top:2px}
    ol.steps p{margin:2px 0 0;color:var(--sub)}
    .note{background:#f6f9ff;border:1px solid #d8e4f8;border-radius:10px;padding:12px 14px;font-size:14px;margin-top:22px}
  </style>
</head>
<body><main>
  <h1>${esc(C.createSteps.title)}</h1>
  <p class="lead">這一頁給還沒裝活動頁工具的同事先看流程。裝好之後，這些引導會直接長在工具的每一步裡，不用回來翻這一頁。</p>
  <h2>${esc(C.welcome.title)}</h2>
  <div class="cards">${C.welcome.cards.map((c) => `<div><b>${esc(c.h)}</b>${esc(c.p)}</div>`).join("")}</div>
  <h2>六步</h2>
  <ol class="steps">
${steps(C.createSteps.steps)}
  </ol>
  <h2>${esc(C.fromActivity.title)}</h2>
  <ol class="steps">
${steps(C.fromActivity.steps)}
  </ol>
  <p class="note" style="margin-top:12px">${esc(C.fromActivity.genericSummary)}——通用指令在工具的「策略檔」頁可以複製。</p>
  <div class="note">工具怎麼裝、裝好長什麼樣，看同一區的「活動頁工具帶著走版」說明頁。</div>
</main>
<script defer src="../../site-nav.js"></script><!-- 全域導航掛載（sync.sh 守門）：本頁落在 portable-cms/flow/＝二層深，用 ../../ -->
</body></html>
`;
const cur = fs.existsSync(OUT) ? fs.readFileSync(OUT, "utf8") : null;
if (CHECK) { if (cur !== html) { console.error("✗ 鏡像頁與文案真源不同步：請跑 node tools/gen-flow-guide.mjs"); process.exit(1); } console.log("✓ 鏡像頁與文案真源同步"); process.exit(0); }
if (cur === html) console.log("✓ 鏡像頁無變更"); else { fs.writeFileSync(OUT, html); console.log("✓ 已產出：" + OUT); }
