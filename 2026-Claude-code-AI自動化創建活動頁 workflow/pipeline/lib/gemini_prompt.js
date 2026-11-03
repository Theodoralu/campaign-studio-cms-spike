/* 「複製給 Gemini 的話」（2026-09-15 C 批，牆第 3 題甲②；C-2 甲＝整段自足）：助理指令全文＋這一檔的型態、主題、真實商品名清單（71 號裁：只名稱，不價格不連結）＋該型態的範本（第一行已填好）。
   貼進任何一個 Gemini 對話都能直接開始寫，不必先建自訂助理。 */
"use strict";
const fs = require("fs");
const path = require("path");
const FMT = require("./curation_brief_format");
const SCEN = require("./scenario_names");
const { parseBrief } = require("./curation_brief");

/** 讀內建範本資料夾，找該型態那一份的正文（去掉抬頭註解與第一行；第一行由呼叫端重填） */
function builtinBodyFor(scenarioValue, builtinDir) {
  let files = []; try { files = fs.readdirSync(builtinDir).filter((f) => f.endsWith(".md")); } catch (e) { return ""; }
  for (const f of files) {
    const raw = fs.readFileSync(path.join(builtinDir, f), "utf8");
    const p = parseBrief(raw);
    if (p.data && p.data.scenario === scenarioValue) {
      return raw.split(/\r?\n/).filter((l) => !/^\s*<!--/.test(l) && !/這檔是哪一種活動\s*[:：]/.test(l)).join("\n").replace(/^\n+/, "");
    }
  }
  return "";
}

/**
 * @param {object} o { scenario: value, theme, productNames: string[], builtinDir }
 * @returns {{ text: string, parts: object }}
 */
function buildGeminiPrompt(o = {}) {
  const sc = SCEN.byValue(o.scenario);
  const title = sc ? sc.title : "";
  const names = (Array.isArray(o.productNames) ? o.productNames : []).filter(Boolean);
  const L = [];
  L.push(FMT.gemInstructions({ scenarioNames: SCEN.SCENARIOS.map((s) => s.title) }).trimEnd());
  L.push(""); L.push("## 這一檔的資料（工具帶出來的，照這些寫）");
  L.push(`- 這檔是哪一種活動：${title || "（使用者還沒選，請先問他）"}${sc ? `——${sc.goal}` : ""}`);
  L.push(`- 活動主題：${o.theme || "（使用者還沒填，請先問他）"}`);
  L.push(`- 這一批商品的名稱（共 ${names.length} 件；「放什麼」「多放」「避開」請用這些名字裡會出現的字）：`);
  names.forEach((n, i) => L.push(`  ${i + 1}. ${n}`));
  if (!names.length) L.push("  （工具還沒抓到商品——請使用者先回工具貼網址產生一次）");
  L.push(""); L.push("## 從這份範本開始（第一行已照上面填好；八個標題原樣保留，內容換成這一檔的）");
  L.push("```markdown");
  L.push(`這檔是哪一種活動：${title || "（五選一）"}｜活動主題：${o.theme || "（主題）"}`);
  L.push("");
  const body = sc ? builtinBodyFor(sc.value, o.builtinDir) : "";
  L.push(body || FMT.templateMarkdown({ withGuidance: false }).trimEnd());
  L.push("```");
  return { text: L.join("\n") + "\n", parts: { scenario: sc ? sc.value : null, scenarioTitle: title, theme: o.theme || "", productCount: names.length, usedBuiltin: !!body } };
}
module.exports = { buildGeminiPrompt, builtinBodyFor };
