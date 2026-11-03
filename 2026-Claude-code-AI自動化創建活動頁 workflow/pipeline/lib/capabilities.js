/* 能力表（capabilities）——「這台機器有什麼」的唯一判定點（2026-09-15 B 批；牆 cms-solo-create-flow-ia 第 6 題甲＋69 號附錄 D）。
   ------------------------------------------------------------------
   白話：同事版跟負責人版是同一份程式，差別只在「這台電腦有沒有那個能力」。介面元件各自宣告需要哪個能力
   （data-needs="ai|publish|vendorSheet"），沒有就不渲染；安全層（部署／發佈路由 403）另由 CAMPAIGN_MODE=editor 旗標擋。
   兩層不混：介面看能力、伺服器看旗標。

   三項能力：
     ai          ＝ claude 指令在且登得進（啟動時 `claude --version` ＋ 一次 haiku 探針，15 秒內）
     publish     ＝ 部署鏈在（deploy-ghe-pages.sh＋~/.ghe-pages 鏡像）且不是編修模式
     vendorSheet ＝ Google 已連結（.google-token.json 在）且不是編修模式

   測試／打包覆寫：環境變數 CAMPAIGN_CAPS="ai:0,publish:0,vendorSheet:0"（只列要覆寫的鍵）——hermetic 測試與同事包不必真的裝 claude 才能驗介面。
   探針全部可注入（probes），本檔不直接 spawn＝可在單元測試裡不碰真環境。 */
"use strict";
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const KEYS = ["ai", "publish", "vendorSheet"];

/** 解析 CAMPAIGN_CAPS 覆寫字串："ai:0,publish:1" → { ai:false, publish:true }；壞字面＝略過該項並回報 */
function parseOverride(str) {
  const out = {}, bad = [];
  String(str || "").split(",").map((s) => s.trim()).filter(Boolean).forEach((kv) => {
    const [k, v] = kv.split(":").map((s) => s.trim());
    if (!KEYS.includes(k) || !/^(0|1|true|false)$/i.test(v || "")) { bad.push(kv); return; }
    out[k] = /^(1|true)$/i.test(v);
  });
  return { out, bad };
}

/** 預設探針（真環境）。每支回 { ok, detail } */
function defaultProbes(opts = {}) {
  const home = opts.home || process.env.HOME || "";
  const pipe = opts.pipe || path.resolve(__dirname, "..");
  const timeoutMs = opts.timeoutMs || 15000;
  return {
    claudeInstalled() {
      const r = spawnSync("claude", ["--version"], { encoding: "utf8", timeout: 8000 });
      const ok = !r.error && r.status === 0;
      return { ok, detail: ok ? String(r.stdout || "").trim().slice(0, 60) : (r.error ? r.error.code || r.error.message : `exit ${r.status}`) };
    },
    claudeLogin() {
      /* 一次最便宜的真呼叫：登不進＝非 0 或沒回 OK。--strict-mcp-config 沿 server 既有用法，避免載入使用者 MCP 設定拖慢 */
      const r = spawnSync("claude", ["-p", "只回覆兩個字母：OK", "--model", "haiku", "--strict-mcp-config"], { encoding: "utf8", timeout: timeoutMs });
      const ok = !r.error && r.status === 0 && /OK/i.test(String(r.stdout || ""));
      return { ok, detail: ok ? "登入正常" : (r.error ? (r.error.code === "ETIMEDOUT" ? `探針逾時（${timeoutMs / 1000} 秒）` : r.error.message) : String(r.stderr || r.stdout || `exit ${r.status}`).trim().slice(0, 120)) };
    },
    deployChain() {
      /* 2026-09-21 分享站認養案：探針從美國鏈換到台灣鏈。
         舊的看的是 workbench/deploy-ghe-pages.sh ＋ ~/.ghe-pages/activity-share-site——那兩樣**現在都還在**
         （腳本刻意留著當退役指路碑、鏡像留著是美國站唯一一份歷史），所以再用它們當依據就是一盞永遠綠的假燈：
         舊鏈的目標站 9/19 已停權，探針卻會回報「發佈能力正常」。判定要看真正會被呼叫的那一支。 */
      const script = path.join(pipe, "..", "..", "2026-AI自動化活動頁生成規劃", "tools", "publish-docs-site.sh"); // pipe＝pipeline/，往上兩層才是專案根
      const mirror = path.join(home, ".ghe-pages", "activity-page-docs", ".git");
      const ok = fs.existsSync(script) && fs.existsSync(mirror);
      return { ok, detail: ok ? "發佈腳本與發佈庫都在" : (!fs.existsSync(script) ? "缺發佈腳本" : "缺 ~/.ghe-pages 發佈庫") };
    },
    googleToken() {
      const tok = path.join(pipe, ".google-token.json");
      const ok = fs.existsSync(tok);
      return { ok, detail: ok ? "Google 已連結" : "Google 未連結" };
    },
  };
}

/**
 * 偵測能力表。
 * @param {object} o  { mode: "owner"|"editor", probes, override: string, now }
 * @returns {{ caps: {ai,publish,vendorSheet}, detail: object, mode, checkedAt, overrides: string[] }}
 */
function detectCapabilities(o = {}) {
  const mode = o.mode === "editor" ? "editor" : "owner";
  const p = o.probes || defaultProbes(o);
  const detail = {};
  const caps = {};
  const { out: ov, bad } = parseOverride(o.override);
  const skip = (k) => Object.prototype.hasOwnProperty.call(ov, k); // 被覆寫的項不跑真探針（測試與同事包不必真的去叫 Claude）

  const inst = skip("ai") ? { ok: false, detail: "" } : p.claudeInstalled();
  detail.ai = skip("ai")
    ? { installed: null, version: null, loginOk: null, note: "由 CAMPAIGN_CAPS 指定，未探測" }
    : { installed: inst.ok, version: inst.ok ? inst.detail : null, loginOk: false, note: inst.ok ? "" : "這台電腦沒有 Claude 指令" };
  if (!skip("ai") && inst.ok) {
    const lg = p.claudeLogin();
    detail.ai.loginOk = lg.ok;
    detail.ai.note = lg.ok ? "" : `Claude 還沒登入（${lg.detail}）`;
  }
  caps.ai = !!(detail.ai.installed && detail.ai.loginOk);

  const dc = skip("publish") ? { ok: false, detail: "由 CAMPAIGN_CAPS 指定，未探測" } : p.deployChain();
  detail.publish = { chain: dc.ok, note: mode === "editor" ? "編修模式不發佈" : dc.detail };
  caps.publish = mode !== "editor" && dc.ok;

  const gt = skip("vendorSheet") ? { ok: false, detail: "由 CAMPAIGN_CAPS 指定，未探測" } : p.googleToken();
  detail.vendorSheet = { connected: gt.ok, note: mode === "editor" ? "編修模式不連 Google" : gt.detail };
  caps.vendorSheet = mode !== "editor" && gt.ok;

  const overrides = [];
  for (const k of Object.keys(ov)) { if (caps[k] !== ov[k]) overrides.push(`${k}:${caps[k]}→${ov[k]}`); caps[k] = ov[k]; }
  if (bad.length) overrides.push(`（略過無法解析：${bad.join("、")}）`);

  return { caps, detail, mode, checkedAt: new Date(o.now || Date.now()).toISOString(), overrides };
}

module.exports = { KEYS, detectCapabilities, defaultProbes, parseOverride };

/* 命令列模式：`node lib/capabilities.js` 印一份 JSON——伺服器用子行程跑它，探針（最長 23 秒）不卡住主事件迴圈。
   環境變數：CAMPAIGN_MODE（editor＝編修模式）、CAMPAIGN_CAPS（覆寫）、HOME、CAMPAIGN_PIPE（預設本檔上一層）。 */
if (require.main === module) {
  const r = detectCapabilities({
    mode: process.env.CAMPAIGN_MODE === "editor" ? "editor" : "owner",
    override: process.env.CAMPAIGN_CAPS,
    pipe: process.env.CAMPAIGN_PIPE || path.resolve(__dirname, ".."),
  });
  process.stdout.write(JSON.stringify(r));
}
