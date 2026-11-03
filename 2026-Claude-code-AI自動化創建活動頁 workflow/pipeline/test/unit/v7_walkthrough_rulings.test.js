"use strict";
/**
 * v7_walkthrough_rulings.test.js —— 2026-10-05 v7 人工走查三裁決的絆線
 *
 * ①檢查面板：上次全過＋正在重新檢查＝不出核可鈕（兩個 call to action 同屏＝使用者實測困惑病例）
 * ⑥主視覺可與下方重複曝光＝提醒不阻擋（四處消費端同批：gate／lib pick／server 門／前端換品門）
 * ⑦連結白名單擴 tw.promo.yahoo.com（兩道門同批：gate checkUrl／CMS 看更多）
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..", "..");
const ui = fs.readFileSync(path.join(ROOT, "workbench/public/index.html"), "utf8");
const gate = fs.readFileSync(path.join(ROOT, "gate.js"), "utf8");
const server = fs.readFileSync(path.join(ROOT, "workbench/server.js"), "utf8");

test("①面板檢查中＝不畫核可鈕（busy 分支在最後的「都齊了」之前，文案照裁決預覽稿）", () => {
  const i = ui.indexOf("function checkPanelHtml()");
  const fn = ui.slice(i, i + 6000);
  const busyAt = fn.indexOf('busy && !approvedAt');
  const okAt = fn.indexOf("都齊了，可以核可這一版</b>");
  assert.ok(busyAt > 0, "要有 busy 分支");
  assert.ok(okAt > busyAt, "busy 分支要排在「都齊了」前面（否則檢查中照畫核可鈕）");
  assert.match(fn, /上次檢查都過——正在重新檢查/, "標題照裁決文案");
  assert.match(fn, /跑完通過後，這裡會出現核可鈕。/, "內文照裁決文案");
  const busySeg = fn.slice(busyAt, okAt);
  assert.doesNotMatch(busySeg, /id="chk-approve"/, "busy 分支不得帶核可鈕");
});

test("⑥主視覺重複＝四處消費端口徑一致（擋的門扣主視覺、提醒由 gate WARN 出）", () => {
  assert.match(gate, /heroSoftIds/, "gate：主視覺不入互斥 claim、軟比對");
  assert.match(server, /function heroGdidSet\(dj\)/, "server：主視覺集合");
  assert.match(server, /&& !heroGdidSet\(dj\)\.has\(String\(np\.gdid\)\)/, "server：編輯精選加品門扣主視覺");
  assert.match(server, /pageGdidsK = \[\.\.\.pageExposedGdids\(djK\)\]\.filter\(\(g\) => !hK\.has\(g\)\)/, "server：牆/樓層貼網址加品門扣主視覺");
  assert.match(ui, /function heroGdidSetFE\(\)/, "前端：主視覺集合");
  assert.match(ui, /\(isCircle \? \[\.\.\.usedGdidSet\(\)\] : \[\.\.\.usedGdidSet\(\)\]\.filter\(g => g !== String\(swapCtx\.gdid\)\)\)\.filter\(g => !hX\.has\(g\)\)/, "前端：牆/樓層/圓換品門扣主視覺");
  /* AI 自動選品池刻意不扣（機器自動挑仍避重複）：autoPickFromPool 的過濾仍吃整頁曝光集合 */
  assert.match(server, /autoPickFromPool\(rd, exposed\)/, "AI 補件池仍用整頁集合（不替使用者製造重複）");
});

test("⑦促銷活動站網域＝兩道門同批收（行為以 rules.json 匯出的同一條正則驗）", () => {
  const rules = JSON.parse(fs.readFileSync(path.join(ROOT, "rules.json"), "utf8"));
  const LINK_RE = new RegExp(rules.enums && rules.enums.linkDomainPattern ? rules.enums.linkDomainPattern : rules.linkDomainPattern || (rules.urls && rules.urls.linkDomainPattern) || gateLinkPattern());
  function gateLinkPattern(){ return JSON.parse('"' + gate.match(/const LINK_DOMAIN_RE_SRC = "([^"]+)"/)[1] + '"'); } // 檔面雙反斜線＝JSON 反解一次
  assert.ok(LINK_RE.test("tw.promo.yahoo.com"), "白名單要收 tw.promo.yahoo.com");
  assert.ok(LINK_RE.test("tw.buy.yahoo.com"), "原網域不得被改壞");
  assert.ok(!LINK_RE.test("tw.news.yahoo.com"), "其他 yahoo 子網域照擋");
  assert.ok(!LINK_RE.test("evil.com"), "站外照擋");
  const lib = fs.readFileSync(path.join(ROOT, "lib/content_modules.js"), "utf8");
  assert.match(lib, /tw\\\.\(buy\|promo\)\\\.yahoo\\\.com/, "lib 欄位驗證（banner 共用連結等）同批擴");
  assert.match(lib, /或促銷活動站/, "lib 擋下訊息要講得出 promo 也可以");
  assert.match(ui, /tw\\\.\(buy\|promo\)\\\.yahoo\\\.com/, "CMS 看更多那道門同批擴");
});
