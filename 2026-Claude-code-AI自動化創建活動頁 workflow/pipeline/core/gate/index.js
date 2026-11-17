"use strict";
/**
 * core/gate/index.js —— 發佈前檢查的程式內入口（D10，2026-11-17）
 *
 *   check({ snapshot|snapRaw, draft|draftRaw, meta, themeFitRule, skipHttp, env, log }) → report
 *
 * 規則本體仍在 pipeline/gate.js（1900 多行，20 幾支測試與單機版用路徑或 spawn 引用它，D10 不搬位置）；
 * D10 做的是把它的 main() 拆成 checkDraft()（不讀草稿檔、不寫報告、不結束程序）＋指令列殼。這裡是 CMS 用的門面：
 *   - 收物件或原文都可以（收物件時用 JSON.stringify(…, null, 1) 序列化來算指紋——與單機版落檔格式相同）
 *   - skipHttp: true ＝ 快檢（建立後初判；不查圖片與搜尋目的地）；false ＝ 全檢（核可、製作 AEM 檔前）
 *   - themeFitRule：CP-14 的主題詞組（core/finish.themeFitPatch 算出來的 patch.themeFitRule），直接傳、不落檔
 * 報告形狀＝schemas/gate_report.schema.json。blocking(report) ＝ 有沒有擋發佈的項目。
 */
const path = require("path");
const gate = require(path.join(__dirname, "..", "..", "gate.js"));
const { CATALOG, NOT_IN_REPO, byCode } = require("./catalog");

const raw = (obj, text) => (text != null ? text : JSON.stringify(obj, null, 1));

async function check({ snapshot, snapRaw, draft, draftRaw, meta = null, themeFitRule = null, skipHttp = false, env = {}, log = () => {}, fontCodepointsFile = null } = {}) {
  if (snapshot == null && snapRaw == null) throw new Error("core/gate.check：缺 snapshot");
  if (draft == null && draftRaw == null) throw new Error("core/gate.check：缺 draft");
  const e = { ...env }; if (skipHttp) e.GATE_SKIP_HTTP = "1";
  return gate.checkDraft({ snapRaw: raw(snapshot, snapRaw), draftRaw: raw(draft, draftRaw), meta, env: e, log, themeFitRule, fontCodepointsFile });
}
const blocking = (report) => !report || report.result !== "PASS" || (report.counts && report.counts.FAIL > 0);
/** 報告依檢查點彙總：[{ code, title, FAIL, WARN, INFO }]（沒在清單上的代號 title 為空＝清單該補） */
function byCheckpoint(report) {
  const m = new Map();
  for (const f of (report && report.findings) || []) { const r = m.get(f.code) || { code: f.code, title: (byCode.get(f.code) || {}).title || "", FAIL: 0, WARN: 0, INFO: 0 }; r[f.level] = (r[f.level] || 0) + 1; m.set(f.code, r); }
  return [...m.values()].sort((a, b) => a.code.localeCompare(b.code));
}
module.exports = { check, blocking, byCheckpoint, CATALOG, NOT_IN_REPO, RULES: gate.RULES };
