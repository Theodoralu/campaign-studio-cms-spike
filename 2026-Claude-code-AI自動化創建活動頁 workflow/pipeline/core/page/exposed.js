"use strict";
/**
 * core/page/exposed.js —— 「這件商品現在在頁面上哪裡」：整頁已用商品集合（D14 第三段，2026-11-27）
 *
 * 下面兩支函式是 workbench/server.js 同名函式的逐字副本（單機版的測試以字串比對 server.js 原始碼，本體不能搬走）。
 * test/unit/cms_edit_more.test.js 會比對兩邊文字相同——改規則時兩邊一起改；單機版退役時留這一份。
 */
const path = require("path");
const { gdidOf } = require(path.join(__dirname, "..", "..", "workbench", "product_fetch.js"));

function heroGdidSet(dj) {
  const s = new Set(); const pg = (dj || {}).page || {};
  (((pg.kv) || {}).keyProductGdids || []).forEach((g) => g && s.add(String(g)));
  Object.values(pg.hero || {}).forEach((sv) => { if (sv && Array.isArray(sv.gdids)) sv.gdids.forEach((g) => g && s.add(String(g))); });
  return s;
}
function pageExposedGdids(dj) {
  const exposed = new Set();
  const pg = dj.page || {};
  ((pg.kv || {}).keyProductGdids || []).forEach((g) => g && exposed.add(String(g)));
  /* 新版主視覺槽（page.hero[*].gdids）也是曝光面（2026-09-26 修）：原本只收舊 KV 欄 ⇒ 模組換品／自動補件可以挑到主視覺槽裡的商品。
     同一條「它在頁上哪裡」規則四處消費端（本函式／lib gdidUsedOnPage／編輯器 usedGdidSet／gate CP-18 claim）同批一起改。 */
  Object.values(pg.hero || {}).forEach((sv) => { if (sv && Array.isArray(sv.gdids)) sv.gdids.forEach((g) => g && exposed.add(String(g))); });
  (pg.floors || []).forEach((f) => ((f && f.productGdids) || []).forEach((g) => g && exposed.add(String(g))));
  /* 情境卡代表品也是曝光面（2026-09-24 修）：契約＝「代表品不入卡列」（vendor_sheet.js 檔頭）。
     本集合原本只收 productGdids ⇒「替換商品」與「補一件折數最好的」都可能挑到那層的代表品，
     換下去即成立 CP-18。病例＝使用者實測「商品替換後主打品會同步更新成一樣的商品」。
     ⚠️ 這條規則有兩處消費端：本函式與 lib/content_modules.js 的 gdidUsedOnPage（註解本來就寫「同語意」）。
     2026-09-24 先只修了後者，結果「加入擋住了、替換還是穿過去」——兩處必須一起改。 */
  (pg.floors || []).forEach((f) => { const g = f && f.sceneUrl && gdidOf(String(f.sceneUrl)); if (g) exposed.add(String(g)); });
  (pg.walls || []).forEach((w) => ((w && w.productGdids) || []).forEach((g) => g && exposed.add(String(g))));
  (dj.products || []).forEach((p) => { if (p && p.gdid && p.position === "editorial-wall") exposed.add(String(p.gdid)); }); // 編輯精選牆列＝position 標記制
  const sp = pg.spotlight || {};
  if (sp.heroCard && sp.heroCard.gdid) exposed.add(String(sp.heroCard.gdid));
  (sp.productRefs || []).forEach((g) => g && exposed.add(String(g)));
  (Array.isArray(pg.promoCards) ? pg.promoCards : (pg.promoCard && !Array.isArray(pg.promoCard) ? [pg.promoCard] : [])).forEach((c) => c && c.gdid && exposed.add(String(c.gdid)));
  (pg.promoEntries || []).forEach((e) => { if (!e) return; if (e.gdid) exposed.add(String(e.gdid)); const g = gdidOf(e.url || ""); if (g) exposed.add(String(g)); });
  ((pg.editorial || {}).circles || []).forEach((c) => { const g = c && gdidOf(c.url || ""); if (g) exposed.add(String(g)); }); // QA #3：編輯精選圓只存 url、無 gdid，漏算會讓自動補選到重複商品
  ((pg.explore || {}).items || []).forEach((e) => { const g = e && gdidOf(e.url || ""); if (g) exposed.add(String(g)); }); // 探索入口卡同理
  return exposed;
}

module.exports = { heroGdidSet, pageExposedGdids };
