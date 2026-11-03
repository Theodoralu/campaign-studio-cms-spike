"use strict";
/**
 * cms_doors_static.test.js —— 「同一能力多道門」靜態對帳（CMS-DOORS 第 1 層；每次 commit 秒級跑）
 *
 * 真瀏覽器全掃在 test/browser/doors-sweep.js（慢、手動）；這支是它的快版：不開瀏覽器，直接讀 index.html／server.js 原文，
 * 對帳三件事——
 *   ① 每一道「商品圖下拉」門牌（data-himgsel／imgsel／kvimgsel／ecimgsel／scimgsel／mimgpick）渲染出來就要有接線（onchange binder），反之亦然
 *      （09-07 病例「圓卡沒下拉」＝門沒開；「牆面下拉選不了」＝門開了沒補抓）
 *   ② 六道門的「補抓／取圖中／單圖」三條路是否對等——**沒對等的門必須剛好等於已知缺口名單**（doors-known-gaps.js；
 *      名單多一個或少一個都紅：多＝有人補了洞沒更新名單、少＝新門又抄了半套）
 *   ③ 提案包寫入的每一道門（server.js 呼叫 writeComboIntoDraft 的地方）都要處理「被擋色制擋下」（09-07 病例：建立那道門吞掉理由記成「免改」）
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { KNOWN_GAPS, DOORS, CHECKS } = require("../browser/doors-known-gaps.js");

const INDEX = fs.readFileSync(path.join(__dirname, "..", "..", "workbench", "public", "index.html"), "utf8");
const SERVER = fs.readFileSync(path.join(__dirname, "..", "..", "workbench", "server.js"), "utf8");
const LINES = INDEX.split("\n");

/* 門牌在渲染字串裡長什麼樣：data-<door>="${…}"（模板字串）；接線長什麼樣：$$("#editor-col [data-<door>]") */
const rendered = (door) => new RegExp(`data-${door}="\\$\\{`).test(INDEX);
const wired = (door) => new RegExp(`\\$\\$\\("#editor-col \\[data-${door}\\]"\\)`).test(INDEX);

test("① 六道門：渲染出來的門牌都有接線、接線的都有門牌（門牌名單＝doors-known-gaps.js DOORS）", () => {
  const renderedDoors = [...new Set([...INDEX.matchAll(/data-([a-z]*imgsel|mimgpick)="\$\{/g)].map((m) => m[1]))].sort();
  const wiredDoors = [...new Set([...INDEX.matchAll(/\$\$\("#editor-col \[data-([a-z]*imgsel|mimgpick)\]"\)/g)].map((m) => m[1]))].sort();
  assert.deepEqual(renderedDoors, [...DOORS].sort(), "index.html 渲染出的門牌 ≠ 名單（新增一道門＝名單同批加、種子同批加一件單圖商品）");
  assert.deepEqual(wiredDoors, renderedDoors, "有門牌沒接線（或有接線沒門牌）＝下拉出現了卻選不了、或死碼");
  for (const d of DOORS) { assert.ok(rendered(d), `${d} 沒渲染`); assert.ok(wired(d), `${d} 沒接線`); }
});

/** 找一道門的「渲染窗」＝門牌那一行往上 18 行、往下 2 行（六道門的渲染分支都短，補抓／字樣都在這個窗裡；kv 的「單張圖」在門牌下一行） */
function renderWindow(door) {
  const i = LINES.findIndex((ln) => new RegExp(`data-${door}="\\$\\{`).test(ln));
  assert.ok(i >= 0, `找不到 ${door} 的渲染行`);
  return LINES.slice(Math.max(0, i - 18), i + 3).join("\n");
}
const lacking = (check, pred) => DOORS.filter((d) => !pred(renderWindow(d))).map((d) => `${d}:${check}`).sort();
const gapsOf = (check) => Object.keys(KNOWN_GAPS).filter((k) => k.endsWith(":" + check)).sort();

test("② 補抓那條路（ensure*Imgs）：沒有的門 ＝ 已知缺口名單（逐鍵對帳）", () => {
  assert.deepEqual(lacking("fetch", (w) => /ensure[A-Za-z]*Imgs\(/.test(w)), gapsOf("fetch"));
});
/* 2026-10-05 第 2 層：「取圖中…／單圖」原本六道門各抄一份、而且抄得不一樣（那就是缺口本身）。
   收成共用的 imgSelNoOpts(key) 之後，原本「窗內有沒有那幾個字」的查法會對六道門同時誤報——
   改查「有沒有接到共用那一格」，並另立一條查「共用那一格自己講不講那兩句話」。
   這比原本強：它守的是**有沒有共用**，不是**有沒有抄到字**（抄得到字＝複本又長回來了）。 */
test("② 沒圖可選那一格：沒有接到共用 imgSelNoOpts 的門 ＝ 已知缺口名單", () => {
  assert.deepEqual(lacking("nocell", (w) => /imgSelNoOpts\(/.test(w)), gapsOf("nocell"));
});
test("② 共用那一格自己要講得出兩種狀態（抓圖中＝取圖中…／抓不到＝單圖），且只有這一份", () => {
  const m = INDEX.match(/function imgSelNoOpts\(key\)\{[\s\S]{0,600}?\n\}/);
  assert.ok(m, "找不到 imgSelNoOpts——六道門共用那一格不見了");
  assert.ok(/取圖中/.test(m[0]), "共用那一格沒講「取圖中…」");
  assert.ok(/單圖/.test(m[0]), "共用那一格沒講「單圖」");
  /* 數的是「渲染那一格」的地方，不是裸字串——註解與別處的「取圖」按鈕不該算進來 */
  assert.equal((INDEX.match(/<option>\$\{pending \? "取圖中…"/g) || []).length, 1,
    "渲染「沒圖可選那一格」的地方不只一處＝有門又自己抄了一套（複本長回來）");
  /* 只看渲染出來的字（<option> 內容或 JS 字串），註解裡記歷史的「單張圖」不算 */
  assert.equal((INDEX.match(/單張圖<\/option>|"單張圖"/g) || []).length, 0,
    "還有門把「單張圖」渲染到畫面上＝用詞沒統一（2026-10-05 使用者裁「統一成單圖」）");
});
test("② 補抓只有一個核心（三個薄接口共用），不是各寫一份", () => {
  assert.equal((INDEX.match(/function ensureImgsCore\(/g) || []).length, 1, "補抓核心不是剛好一份");
  const adapters = [...INDEX.matchAll(/function (ensure[A-Za-z]*Imgs)\(/g)].map((x) => x[1]).sort();
  assert.deepEqual(adapters, ["ensureCircleImgs", "ensureEntryImgs", "ensureKvImgs", "ensureProductImgs"],
    "補抓接口名單變了＝新開一道門自己寫了一支，或接口被刪");
  for (const fn of ["ensureProductImgs", "ensureCircleImgs", "ensureEntryImgs"]) {
    const m = INDEX.match(new RegExp("function " + fn + "\\([\\s\\S]{0,700}?\\n\\}"));
    assert.ok(m, "找不到 " + fn);
    assert.ok(/ensureImgsCore\(|ensureProductImgs\(/.test(m[0]), fn + " 沒走共用核心＝又抄了一份 fetch 鏈");
    assert.ok(!/fetch\("\/api\/product-fetch"/.test(m[0]), fn + " 自己還在打 /api/product-fetch＝複本長回來了");
  }
});
test("② 換圖後重繪列（onchange 裡有 renderEditor）：沒有的門 ＝ 已知缺口名單", () => {
  const lackingThumb = DOORS.filter((d) => {
    const i = LINES.findIndex((ln) => new RegExp(`\\$\\$\\("#editor-col \\[data-${d}\\]"\\)`).test(ln));
    assert.ok(i >= 0, `找不到 ${d} 的接線行`);
    /* 接線處理式＝接線行到下一個 $$("#editor-col 接線行（或 12 行）之間 */
    let j = i + 1; while (j < LINES.length && j < i + 12 && !/^\s*\$\$\("#editor-col/.test(LINES[j])) j++;
    return !/renderEditor\(\)/.test(LINES.slice(i, j).join("\n"));
  }).map((d) => `${d}:thumb`).sort();
  assert.deepEqual(lackingThumb, gapsOf("thumb"));
});
test("② 已知缺口名單只准列六道門×四種檢查（鍵格式守門）", () => {
  for (const k of Object.keys(KNOWN_GAPS)) {
    const [door, check] = k.split(":");
    assert.ok(DOORS.includes(door), `名單鍵 ${k} 的門牌不在六道門`);
    assert.ok(CHECKS.includes(check), `名單鍵 ${k} 的檢查名不認得（認得的＝${CHECKS.join("／")}）`);
  }
});

test("③ 提案包寫入的每一道門都處理「被擋」：server.js 的 writeComboIntoDraft 呼叫點剛好 2 個（建立／編修），各自 12 行內看得到 blocked 或把 info 回給前端", () => {
  const lines = SERVER.split("\n");
  const sites = lines.map((ln, i) => (/heroCombo\.writeComboIntoDraft\(/.test(ln) && !/^\s*(\/\/|\*|\/\*)/.test(ln) ? i : -1)).filter((i) => i >= 0);
  assert.equal(sites.length, 2, `提案包寫入呼叫點數變了（${sites.length}）——新開一道門＝這裡登記＋同批處理 blocked`);
  for (const i of sites) {
    const win = lines.slice(i, i + 12).join("\n");
    assert.ok(/\.blocked\b/.test(win) || /info:\s*r[A-Za-z]*\.info/.test(win), `server.js:${i + 1} 這道門沒處理被擋（要嘛看 info.blocked 出聲、要嘛把 info 回給前端渲染擋卡）`);
  }
  /* 建立那道門：被擋＝走 layoutChoiceWriteError 黃條（09-07 修）；編修那道門：前端讀 info.blocked 渲染擋卡 */
  assert.ok(/rP\.info\.blocked[\s\S]{0,600}layoutChoiceWriteError/.test(SERVER), "建立門被擋沒接到 layoutChoiceWriteError 黃條");
  assert.ok(/comboBlocked = \(r\.info && r\.info\.blocked\)/.test(INDEX), "前端編修門沒讀 info.blocked");
  assert.ok((INDEX.match(/layoutChoiceError/g) || []).length >= 2, "前端讀 layoutChoiceError 的地方少於 2（建立完成畫面＋編修頁黃條）");
});
