"use strict";
/**
 * 探索入口上限「4」三道門同值絆線（2026-10-08 審查中-2）
 * 白話：同一個上限住在三個地方——伺服器寫入門（EXPLORE_ITEMS_CAP）、前端按鈕條件、引擎畫面背板 slice。
 * 改值那天最容易「改了門口、屋裡還有舊門」（卡 20260831-one-rule-many-doors）——這條把三處綁死，改一漏二必紅。
 */
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const SRV = fs.readFileSync(path.join(__dirname, "../../workbench/server.js"), "utf8");
const UI = fs.readFileSync(path.join(__dirname, "../../workbench/public/index.html"), "utf8");
const ENGINE = fs.readFileSync(path.join(__dirname, "../../../../2026-AI自動化活動頁生成規劃/MVP_Phase1_LeCreuset_活動頁Prototype_FrameTest.html"), "utf8");

test("伺服器 EXPLORE_ITEMS_CAP、引擎 slice 背板、前端按鈕條件＝同一個數", () => {
  const m = SRV.match(/const EXPLORE_ITEMS_CAP = (\d+);/);
  assert.ok(m, "server 要有 EXPLORE_ITEMS_CAP 常數");
  const cap = Number(m[1]);
  assert.ok(ENGINE.includes(`pg.explore.items.slice(0, ${cap})`), `引擎背板 slice(0, ${cap}) 要同值（實際檔內容與 cap 不符＝改一漏一）`);
  assert.ok(UI.includes(`>= ${cap}`) && UI.includes(`< ${cap}`) && UI.includes(`／${cap}`), `前端三處（滿擋、鈕渲染、N／${cap} 提示）要同值`);
});
