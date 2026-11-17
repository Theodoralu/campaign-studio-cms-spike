"use strict";
/**
 * D10：core/export——主流程後半段在程式內走通（收尾 → 檢查 → 組 AEM 檔），不開瀏覽器、不觸網、不寫 run 目錄。
 * 顯示檢查（CP-32，真 Chrome 三裝置）在 CI 的 aem-verify job 跑同一份產物（tools/ci_aem_verify.js）。
 */
const test = require("node:test");
const assert = require("node:assert");
const path = require("node:path");
const E = require("../../core/export");
const T = require("../../lib/tracking_plan");
const { prepare } = require("../../tools/ci_aem_verify.js");

let P;
test("收尾 → 檢查 PASS → 組出瘦身版與參照版；瘦身版單檔自足", async () => {
  P = await prepare();
  assert.strictEqual(P.report.counts.FAIL, 0);
  const b = P.built;
  assert.match(b.layout, /^layout-\d{3}$/); assert.strictEqual(b.fileName, "activity-ci-fixture.html");
  assert.ok(b.slimHtml.length < b.fullHtml.length * 0.6, `瘦身版應明顯小於參照版（${b.slimHtml.length}／${b.fullHtml.length}）`);
  // 單檔自足：不留相對路徑的 src／href／url()（CP-32 第 ④ 條在瀏覽器裡驗「真的沒去抓」，這裡先驗字面）
  const rel = [...b.slimHtml.matchAll(/(?:src|href)="(?!https?:|data:|#|\/\/|javascript:|mailto:|")([^"]{1,80})"/g)].map((m) => m[1]).filter((u) => !/^\$\{|^['+]|^\s*$/.test(u));
  assert.deepStrictEqual(rel.filter((u) => /\.(png|jpe?g|webp|css|js|svg|woff2?)(\?|$)/i.test(u)), [], "不該有相對路徑素材");
  // 草稿烤進檔案：每件草稿商品的賣場編號都在
  const missing = P.fin.draft.products.map((p) => String(p.gdid)).filter((g) => !b.slimHtml.includes(g));
  assert.deepStrictEqual(missing, [], "草稿商品沒進 AEM 檔");
  assert.ok(b.report.aemBudget && b.report.aemBudget.cap === E.AEM_CAP, "報告帶 AEM 上限量尺");
});

test("buildLogs／readme／friendlyBuildError：文字沿單機版原碼", () => {
  const logs = E.buildLogs(P.built.fileName, P.built.report);
  assert.match(logs[0], /^組裝完成：activity-ci-fixture\.html \d+ KB（模板 \d+ KB；舞台移除 \d+ 款、他款版型函式 \d+ 支空殼、示範資料 \d+ 組置空）/);
  assert.match(logs[1], /^AEM 頁面編輯上限的尺（2026-09-17 起只量不擋）：編碎後 \d+／上限 131072＝[\d.]+ 倍/);
  const r = E.readme({ id: "x1", pageName: "測試頁", bytes: 417 * 1024, budget: { encoded: 627774, cap: 131072, ratio: 4.79, fits: false }, hosts: ["img.yec.tw", "fonts.googleapis.com"], now: "2026-11-17T00:00:00.000Z" });
  for (const line of ["活動名稱：測試頁", "檔案：activity-x1.html（417 KB，單一檔案、圖片與樣式都在裡面）", "本檔網址編碼後 627774 字／上限 131072 字（超過 4.79 倍；貼進 AEM 頁面編輯器前需經瘦身）", "製作時間：2026-11-17T00:00:00.000Z", "頁面需要能連到這些網域才會完整顯示：img.yec.tw、fonts.googleapis.com。"]) assert.ok(r.includes(line), `README 缺：${line}`);
  assert.ok(E.readme({ id: "x1", bytes: 1, hosts: [], now: "T" }).includes("img.yec.tw（商品圖）、fonts.googleapis.com（字型）"), "沒外連清單＝給預設句");
  assert.strictEqual(E.friendlyBuildError(new Error("這檔活動沒有宣告新版型（kvVariant=空），AEM 匯出只支援 layout-* 版型")), "這檔活動沒有宣告新版型（kvVariant=空），AEM 匯出只支援 layout-* 版型");
  assert.match(E.friendlyBuildError(new Error("ENOENT: x")), /^網頁檔組裝時發生問題，已停止製作——請再試一次；連續失敗請聯絡系統管理員（技術訊息：ENOENT: x）$/);
});

test("沒有新版式的草稿＝組裝出聲拒絕（不交付半成品）", async () => {
  const d = JSON.parse(JSON.stringify(P.fin.draft)); delete d.page.kvVariant;
  await assert.rejects(() => E.buildAem({ id: "x", draft: d, assetRoots: E.defaultAssetRoots(path.resolve(__dirname, "..", "..")) }), /沒有宣告新版型/);
});

test("build_id（24 號 D-3）：結構變＝換號；只改商品、文案＝不換號", () => {
  const base = JSON.parse(JSON.stringify(P.fin.draft)), id0 = T.buildId(base);
  assert.match(id0, /^bld_.+_[0-9a-f]{8}$/);
  const onlyProducts = JSON.parse(JSON.stringify(base));
  onlyProducts.products[0].price += 1; onlyProducts.products[0].name += "（改）"; onlyProducts.page.floors[0].title = "換個標題"; onlyProducts.page.floors[0].productGdids.reverse();
  assert.strictEqual(T.buildId(onlyProducts), id0, "改商品、文案、樓層內順序不換號");
  const lessFloor = JSON.parse(JSON.stringify(base)); lessFloor.page.floors.pop();
  assert.notStrictEqual(T.buildId(lessFloor), id0, "少一層樓＝換號");
  const otherLayout = JSON.parse(JSON.stringify(base)); otherLayout.page.kvVariant = "layout-001";
  assert.notStrictEqual(T.buildId(otherLayout), id0, "換版式＝換號");
  const noWall = JSON.parse(JSON.stringify(base)); noWall.page.walls = [];
  assert.notStrictEqual(T.buildId(noWall), id0, "拿掉品類牆＝換號");
});
