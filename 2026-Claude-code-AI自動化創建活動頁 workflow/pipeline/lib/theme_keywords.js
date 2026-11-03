/* 主題詞組切詞——CP-14 主題契合閘的詞組派生（原住 workbench/server.js deriveThemeKeywords，2026-09-11 搬進 lib）。
   為什麼搬：策略檔「來源對不對得上」預檢（71 號方案 A 階段一）要用同一把刀切詞，
   不能在 lib 再抄一份——切法一漂，兩邊對同一份商品算出不同答案（鐵律 4「同類幾處」）。
   切法不變：全串小寫＋2~4 位數字＋3 字以上英文詞＋中文 2-gram。 */
"use strict";

function deriveThemeKeywords(theme) {
  const t = String(theme || "").trim();
  if (!t) return [];
  const kws = new Set([t.toLowerCase()]);
  (t.match(/[0-9]{2,4}/g) || []).forEach((d) => kws.add(d));
  (t.match(/[A-Za-z]{3,}/g) || []).forEach((w) => kws.add(w.toLowerCase()));
  const cjk = t.replace(/[^一-鿿]/g, "");
  for (let i = 0; i + 2 <= cjk.length; i++) kws.add(cjk.slice(i, i + 2));
  return [...kws];
}

module.exports = { deriveThemeKeywords };
