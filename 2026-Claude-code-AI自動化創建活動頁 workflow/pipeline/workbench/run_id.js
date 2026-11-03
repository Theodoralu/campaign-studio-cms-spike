"use strict";
/**
 * workbench/run_id.js —— run id 配號（同秒讓位；2026-08-31 使用者裁決修）
 *
 * 病根（發表片線 2026-08-31 實測回報）：id＝「年月日-wb-時分秒」、mkdirSync recursive:true
 * 對既存資料夾不吭聲——同一秒進來的多筆建檔會拿到同一個 id、共用同一個資料夾互相覆寫
 * （實證＝2026-08-31 一次送四檔、三檔擠進 2026-08-31-wb-085542：meta 記寢具、draft 卻是運動鞋）。
 * 人手動一次建一檔不會遇到；批次建檔／腳本連發必中＝靜默失敗類（鐵律 3）。
 *
 * 修法：配號時資料夾已存在＝讓位（尾綴 -2、-3…流水），配到即以「不帶 recursive 的 mkdirSync」
 * 佔位——萬一仍撞（理論上單執行緒同步段不可能）＝EEXIST 直接 throw 出聲，不吞。
 * id 尾綴安全性：全庫掃無任何「-wb-\d{6}」格式假設（消費端一律拿資料夾名原文）。
 * hermetic：不觸網、注入 runsDir＝單元測試用暫存資料夾即可重現同秒三連發。
 */
const fs = require("fs");
const path = require("path");

/**
 * 配一個未被占用的 run id 並當場建資料夾（配號＝佔位一體，防查與建之間被插隊）。
 * @param {string} runsDir runs/ 根目錄
 * @param {Date} [now] 時刻（測試注入用）
 * @returns {{id: string, runDir: string, yielded: boolean}} yielded＝true 表示同秒讓位過（呼叫端記 log 出聲）
 */
function allocRunId(runsDir, now) {
  const d = now || new Date();
  const p = (n) => String(n).padStart(2, "0");
  const base = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-wb-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
  fs.mkdirSync(runsDir, { recursive: true }); // 根目錄保底（既存＝無事）
  let id = base;
  for (let n = 2; fs.existsSync(path.join(runsDir, id)); n++) id = `${base}-${n}`;
  const runDir = path.join(runsDir, id);
  fs.mkdirSync(runDir); // 不帶 recursive＝真撞就 throw（失敗要出聲）
  return { id, runDir, yielded: id !== base };
}

module.exports = { allocRunId };
