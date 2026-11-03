/* 主視覺欄位長度提示＝一套機制絆線（2026-09-11 使用者裁）。
   ------------------------------------------------------------------
   裁決＝「只提醒、不硬擋」＋文案「保留事前提醒、『最多』改『建議』」。
   這是一條**原則**，不是某一款版型的個案：字太長是會變醜、不是會出錯，而且右邊預覽照實呈現。

   為什麼要有這條絆線：2026-09-11 病例——012 改成軟提示之後，011 身上還留著舊做法
   （maxlength 硬擋＋畫面寫「最多 N 個字」），營運在 011 上照樣被擋住又不知道為什麼。
   同一條規矩兩道門，改了門口那道、屋裡還有一道舊的（鐵律 4／卡 20260831-one-rule-many-doors）。
   由平行 session 對帳抓到，不是自己發現的。

   守什麼：
     ①上限數字只有 HERO_LEN 一份，不准某款版型在別處自己寫一組
     ②主視覺文字槽不准有 maxlength 硬擋
     ③常駐標籤用「建議 N 個字以內」，不用「最多 N 個字」這種像規定的口氣
   不守什麼：哪些版型該有上限、數字多少——那要實測，屬各版型自己的事。 */
"use strict";
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const UI = path.join(__dirname, "..", "..", "workbench", "public", "index.html");
const src = () => fs.readFileSync(UI, "utf8");

test("上限數字只有 HERO_LEN 一份（不准某款版型在別處自己寫一組）", () => {
  const s = src();
  assert.match(s, /const HERO_LEN = \{/, "HERO_LEN 是這件事的單一來源");
  /* 舊形狀＝在樣板裡按版型寫三元式（kvRaw === "layout-0NN" ? (i === N ? 數字 : …)）。
     再出現就是有人又在 HERO_LEN 之外開了第二份。 */
  const adhoc = s.match(/kvRaw === "layout-\d{3}"\s*\?\s*\(\s*i ===/g) || [];
  assert.deepStrictEqual(adhoc, [], `上限數字寫在 HERO_LEN 之外：${adhoc.join(" / ")}`);
});

test("主視覺文字槽不得有 maxlength 硬擋（裁決＝只提醒不硬擋）", () => {
  const s = src();
  const lines = s.split("\n");
  const hits = [];
  lines.forEach((l, i) => {
    if (/data-hero-piece=/.test(l) && /maxlength/.test(l)) hits.push(`${i + 1}: ${l.trim().slice(0, 110)}`);
    if (/data-path="page\.hero\.discount-digit"/.test(l) && /maxlength/.test(l)) hits.push(`${i + 1}: ${l.trim().slice(0, 110)}`);
  });
  assert.deepStrictEqual(hits, [], `這些欄位還在硬擋：\n${hits.join("\n")}`);
});

test("常駐標籤用「建議 N 個字以內」，不用「最多 N 個字」的口氣", () => {
  const s = src();
  assert.ok(s.includes("建議 ${capMax} 個字以內"), "常駐標籤沒改成建議式");
  const bossy = (s.match(/最多 \$\{[A-Za-z0-9_.]+\} 個字/g) || []);
  assert.deepStrictEqual(bossy, [], `還有「最多 N 個字」的講法：${bossy.join(" / ")}`);
});

test("011 與 012 走同一套（兩款都在 HERO_LEN 裡，沒有一款留在舊做法）", () => {
  const s = src();
  const block = s.slice(s.indexOf("const HERO_LEN = {"), s.indexOf("const lenHintTouched"));
  for (const kv of ['"layout-011"', '"layout-012"']) {
    assert.ok(block.includes(kv), `${kv} 沒進 HERO_LEN＝它還活在別的做法上`);
  }
  /* 數字有出處才准改。英文行 2026-09-11 由 30 改 27（73 號 D1 使用者裁）：實測最寬字母 W 全滿時
     30 會凸出、安全下界 27（三裝置同值）；中文行 20 維持（實測 31 才壞＝保守，沒有改的理由）。
     這條擋的是「順手改」，不是擋裁決——改之前要有實測與裁決，並同批改 spec 與欄位說明。 */
  assert.match(block, /"piece:2":\s*\{\s*max:\s*27/, "011 英文行上限應為 27（2026-09-11 實測後裁決值）");
  assert.match(block, /"piece:3":\s*\{\s*max:\s*20/, "011 中文行上限 20 不該被順手改掉");
});
