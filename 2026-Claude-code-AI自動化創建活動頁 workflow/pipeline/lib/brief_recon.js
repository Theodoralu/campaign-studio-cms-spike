/* 策略檔對帳（2026-09-15 C 批，牆第 3 題甲）：貼上或選檔後，拿這份策略檔跟「這一檔」比——型態一不一致、主標有沒有、每層／每面牆寫的字對到幾件、避開排掉幾件、整批對不對得上。
   只回結構化的帳，不寫句子（句子＝介面文案，過目後由前端組）。比對沿既有那一把尺：splitWords／nameHits（挑選用）＋briefFit（頁級），不另造。 */
"use strict";
const SEL = require("./brief_selection");
const { briefFit } = require("./curation_brief");
const SCEN = require("./scenario_names");

/**
 * @param {object} parsed  parseBrief() 結果（需 ok）
 * @param {object} ctx     { runScenario, runTheme, productNames: string[], threshold }
 */
function reconcile(parsed, ctx = {}) {
  const d = (parsed && parsed.data) || {};
  const names = Array.isArray(ctx.productNames) ? ctx.productNames.filter(Boolean) : [];
  const runS = String(ctx.runScenario || "").replace(/^0\d\s+/, "").trim();
  const briefS = d.scenario || null;
  const scenario = {
    brief: briefS, briefLabel: d.scenarioLabel || "", briefTitle: briefS ? SCEN.titleOf(briefS) : "",
    run: runS || null, runTitle: runS ? SCEN.titleOf(runS) : "",
    match: !briefS ? "missing" : (runS && briefS === runS ? "same" : (runS ? "different" : "run-unset")),
  };
  const countHits = (hint) => { const words = SEL.splitWords(hint || ""); if (!words.length) return { words, hits: null }; return { words, hits: names.filter((n) => SEL.nameHits(n, words)).length }; };
  const floors = (Array.isArray(d.floors) ? d.floors : []).map((f) => ({ title: f.title || "", ...countHits(f.hint) }));
  const walls = (Array.isArray(d.walls) ? d.walls : []).map((w) => ({ title: w.title || "", ...countHits(w.hint) }));
  const sel = d.selection || {};
  const exWords = SEL.splitWords(sel.exclude || ""); const inWords = SEL.splitWords(sel.include || "");
  const exclude = { words: exWords, removed: exWords.length ? names.filter((n) => SEL.nameHits(n, exWords)).length : 0 };
  const include = { words: inWords, hits: inWords.length ? names.filter((n) => SEL.nameHits(n, inWords)).length : null };
  const fit = names.length ? briefFit(d, names, { threshold: ctx.threshold }) : null;
  const zeroFloors = floors.filter((f) => f.hits === 0);
  /* 給「回 Gemini 這樣說」舉例用：商品池裡最多件商品名都有的品類詞（最多 5 個）——例子要是這批商品真的有的字。
     2026-09-24 起與「對不到的層照商品補標題」共用同一把尺 brief_selection.categoryWords（原本這裡自己切一份） */
  const sampleWords = SEL.categoryWords(names, { minShare: 0, max: 5 });
  return {
    scenario, theme: { brief: d.theme || "", run: String(ctx.runTheme || "") }, sampleWords,
    title: !!(Array.isArray(d.title) && d.title.length),
    floors, walls, exclude, include, fit,
    poolSize: names.length,
    summary: { floorsTotal: floors.length, floorsHit: floors.filter((f) => f.hits > 0).length, floorsZero: zeroFloors.length, wallsTotal: walls.length, wallsHit: walls.filter((w) => w.hits > 0).length, fitLow: !!(fit && fit.low), scenarioOk: scenario.match === "same" },
  };
}
module.exports = { reconcile };
