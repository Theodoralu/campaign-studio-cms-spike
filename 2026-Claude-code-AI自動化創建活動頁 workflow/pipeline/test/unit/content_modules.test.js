"use strict";
/**
 * lib/content_modules.js 單元測試（W2 內文模組第一批，2026-08-25；story＝docs/stories/content-modules-wave2.md）
 * hermetic＝mkdtemp 最小登記簿（沿 hero_combo.test.js 模式；不直讀活真源＝W1-A review 教訓）。
 * 守的邏輯：
 *   ①值域（M1/M5）：白名單＝modules.json buildSelectable:true 者——grid/banner（未實裝變體）天然排除；
 *     未知/未登錄版式＝throw；featured 未登錄 spotlight/promo-card＝加入 throw
 *   ②每型至多一實例：重複加入＝throw　③換版式＝列數隨版式定值（雙列 2／其餘 3）、同值＝零變更
 *   ④A→加→編→刪→A：page 深度 diff=0（M4 核心不變式）
 *   ⑤機器閘負向（M5）：列數×版式不一致／URL 非站內／gdid 懸空／productRefs>2／rewardImgs>2＝throw
 *   ⑥寫入紀律（M4）：writeContentModuleIntoDraft＝落版備份＋寫回；零變更＝不寫檔；寫入失敗＝throw 出聲
 * W2 第二批（2026-08-26）：
 *   ⑦模組順序（M11）：move 對調相鄰鍵；碰頂（kv 恆首）/碰底＝changed:false；下移→上移＝page 逐字復原
 *     （等於預設序＝刪鍵）；composeOrder 非法（缺鍵/重複/kv 非首/explore 非末）＝validateContentModules 擋
 *     （S11 2026-08-27 釘位制：固定序退役＝中段七鍵自由；舊 explore 後綴形＝讀入正規化）
 *   ⑧固定模組移除：promo/editorial remove＝delete 鍵（絕非空陣列——CP-15 對 []＝FAIL）；add/set＝throw
 * W2.5 換皮批（2026-08-26 使用者方案 A 四題裁決）：
 *   ⑨本期活動排版樣式 set-variant：白名單 runtime 讀 modules.json promo variants（buildSelectable 過濾）；
 *     offer-rows 寫入／換回 entry-circles＝刪鍵／同值 changed:false／非法值擋／promo 不在頁面上＝白話擋；
 *     同內容換皮＝promoEntries 零改動、A→換皮→換回 page 深度 diff=0
 * banner 輪播批（2026-08-26 使用者實測回報）：
 *   ⑩資訊卡 banner.imgs（1~3 張輪播）：預設形三空格＋img 舊欄保留；1 張/3 張/含空格＝合法；
 *     4 張擋／非陣列擋／格內非字串擋；舊 draft 只有 img（無 imgs 鍵）＝合法零波及（讀取端優先 imgs、退 img）
 */
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const CM = require("../../lib/content_modules");

/* ---------- hermetic 登記簿（形狀照抄真檔 modules.json 1.1.0-draft） ---------- */
function buildRegistry(tweak = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "content-modules-fixture-"));
  const mechanicVariants = tweak.mechanicVariants || [
    { variant_id: "grid", buildSelectable: false },
    { variant_id: "banner", buildSelectable: false },
    { variant_id: "info-offer-rows", meaning: "活動資訊卡・優惠卡列三列（純文字三列）", buildSelectable: true },
    { variant_id: "info-gift-rows", meaning: "活動資訊卡・滿額贈雙列（贈品大圖×2列）", buildSelectable: true },
    { variant_id: "info-gift-gallery", meaning: "活動資訊卡・好禮圖列", buildSelectable: true },
    { variant_id: "info-gift-rush", meaning: "活動資訊卡・好禮列搶購", buildSelectable: true },
  ];
  const featuredVariants = tweak.featuredVariants || [
    { variant_id: "grid", buildSelectable: false },
    { variant_id: "carousel", buildSelectable: false },
    { variant_id: "spotlight", meaning: "主打選品舞台", buildSelectable: true },
    { variant_id: "promo-card", meaning: "促銷卡", buildSelectable: true },
  ];
  const promoVariants = tweak.promoVariants || [ // W2.5 換皮批（2026-08-26）：本期活動排版樣式兩款（好禮款不登＝天然不在值域）
    { variant_id: "entry-circles", meaning: "本期活動・圓形入口卡（現行樣式：3~4 個圓形活動入口＋標籤堆疊；預設）", buildSelectable: true },
    { variant_id: "offer-rows", meaning: "本期活動・優惠說明卡皮（白底藍框一列一檔＋模組標題純色 banner 並排）", buildSelectable: true, rollout: "trial" },
  ];
  const p = path.join(dir, "modules.json");
  fs.writeFileSync(p, JSON.stringify({ modules: [
    { module_id: "mechanic", variants: mechanicVariants },
    { module_id: "featured", variants: featuredVariants },
    { module_id: "promo", variants: promoVariants },
  ] }));
  return { reg: CM.loadContentRegistry({ modules: p }), dir };
}
function basePage() {
  return {
    pageName: "測試活動",
    kv: { titleLine1: "測試" },
    floors: [{ title: "樓層一", productGdids: ["111"] }],
    walls: [],
  };
}
function baseDraft() {
  return { page: basePage(), products: [
    { gdid: "111", name: "測試商品一", price: 100, url: "https://tw.buy.yahoo.com/gdsale/x-111.html", img: "https://s.yimg.com/1.jpg" },
    { gdid: "222", name: "測試商品二", price: 200, url: "https://tw.buy.yahoo.com/gdsale/x-222.html", img: "https://s.yimg.com/2.jpg" },
    { gdid: "333", name: "測試商品三", price: 300, url: "https://tw.buy.yahoo.com/gdsale/x-333.html", img: "https://s.yimg.com/3.jpg" },
  ] };
}

test("值域（M1/M5）：白名單＝buildSelectable:true——資訊卡四版式在列、grid/banner 排除；featured 收 spotlight/promo-card", () => {
  const { reg } = buildRegistry();
  assert.deepStrictEqual([...reg.mechanicVariantIds].sort(), ["info-gift-gallery", "info-gift-rows", "info-gift-rush", "info-offer-rows"]);
  assert.ok(!reg.mechanicVariantIds.has("grid") && !reg.mechanicVariantIds.has("banner"), "未實裝變體不得入面板值域");
  assert.ok(reg.featuredSelectable.has("spotlight") && reg.featuredSelectable.has("promo-card"));
  assert.ok(!reg.featuredSelectable.has("carousel"));
});

test("登記簿缺 mechanic/featured/promo＝throw（值域真源缺席不裝乾淨）", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "content-modules-fixture-"));
  const p = path.join(dir, "modules.json");
  fs.writeFileSync(p, JSON.stringify({ modules: [{ module_id: "hero", variants: [] }] }));
  assert.throws(() => CM.loadContentRegistry({ modules: p }), /值域真源缺席/);
  const p2 = path.join(dir, "modules2.json");
  fs.writeFileSync(p2, JSON.stringify({ modules: [{ module_id: "mechanic", variants: [] }, { module_id: "featured", variants: [] }] }));
  assert.throws(() => CM.loadContentRegistry({ modules: p2 }), /值域真源缺席/, "缺 promo 同樣＝throw（W2.5 換皮批起 promo variants 入值域）");
});

test("加入資訊卡＝預設版式＋定值列數（3 列空欄）；重複加入＝throw（每型至多一實例）", () => {
  const { reg } = buildRegistry();
  const dj = baseDraft();
  const r = CM.applyContentModule(dj, { kind: "mechanic", action: "add" }, reg);
  assert.strictEqual(r.changed, true);
  assert.strictEqual(dj.page.mechanic.variant, "info-offer-rows");
  assert.strictEqual(dj.page.mechanic.rows.length, 3);
  assert.deepStrictEqual(Object.keys(dj.page.mechanic.rows[0]).sort(), ["brandName", "ctaText", "ctaUrl", "label", "offerText", "rewardImgs", "rewardText", "thresholdText"].sort());
  assert.strictEqual(dj.page.mechanic.banner.img, "");
  assert.throws(() => CM.applyContentModule(dj, { kind: "mechanic", action: "add" }, reg), /已經在頁面上/);
});

test("換版式（2026-09-09 使用者裁、翻 08-30 暫存制）：多出的列刪掉、新版面不畫的欄位清掉、贈品圖截到張數；每項出聲；同值＝零變更；未知版式＝throw", () => {
  const { reg } = buildRegistry();
  const dj = baseDraft();
  CM.applyContentModule(dj, { kind: "mechanic", action: "add" }, reg);
  dj.page.mechanic.rows[0].brandName = "ASICS 亞瑟士官方旗艦"; dj.page.mechanic.rows[0].offerText = "秋冬新品 9 折起"; dj.page.mechanic.rows[0].thresholdText = "滿 $3,000";
  dj.page.mechanic.rows[2].rewardText = "送 測試贈品組"; // 第三列有內容＝換成兩列版面會被刪掉、要出聲
  const r1 = CM.applyContentModule(dj, { kind: "mechanic", action: "set", variant: "info-gift-rows" }, reg);
  assert.strictEqual(dj.page.mechanic.rows.length, 2);
  assert.strictEqual(dj.page.mechanic.rows[0].brandName, "", "店家名不在滿額贈雙列＝清掉");
  assert.strictEqual(dj.page.mechanic.rows[0].offerText, "", "活動文案不在滿額贈雙列＝清掉");
  assert.strictEqual(dj.page.mechanic.rows[0].thresholdText, "滿 $3,000", "重疊欄位保留");
  assert.strictEqual(dj.page.mechanic.rowStash, undefined, "暫存制退場＝不再存 rowStash");
  assert.ok(r1.info.notes.some((n) => /第 3 列整列/.test(n) && /店家名、活動文案/.test(n)), "出聲講清楚清掉什麼：" + r1.info.notes.join("｜"));
  assert.deepStrictEqual(r1.info.cleared, ["第 3 列整列", "第 1 列的店家名、活動文案"]);
  dj.page.mechanic.rows[0].rewardImgs = ["https://img/a.png", "https://img/b.png"];
  const r2 = CM.applyContentModule(dj, { kind: "mechanic", action: "set", variant: "info-gift-rush" }, reg);
  assert.deepStrictEqual(dj.page.mechanic.rows[0].rewardImgs, ["https://img/a.png"], "好禮列搶購只畫 1 張贈品圖＝第 2 張截掉");
  assert.ok(r2.info.cleared.some((c) => /第 2 張起的贈品圖/.test(c)));
  assert.strictEqual(dj.page.mechanic.rows.length, 3, "換回三列版面＝補空列，不還原（暫存制退場）");
  assert.strictEqual(dj.page.mechanic.rows[2].rewardText, "");
  const r3 = CM.applyContentModule(dj, { kind: "mechanic", action: "set", variant: "info-gift-rush" }, reg);
  assert.strictEqual(r3.changed, false, "同值＝零變更");
  assert.throws(() => CM.applyContentModule(dj, { kind: "mechanic", action: "set", variant: "info-nope" }, reg), /不認得/);
  assert.throws(() => CM.applyContentModule(dj, { kind: "mechanic", action: "set", variant: "grid" }, reg), /不認得/, "未開放變體＝不在白名單");
});

test("featured 未登錄 spotlight/promo-card＝加入 throw（讀簿把關、零硬編）", () => {
  const { reg } = buildRegistry({ featuredVariants: [{ variant_id: "grid", buildSelectable: false }] });
  const dj = baseDraft();
  assert.throws(() => CM.applyContentModule(dj, { kind: "spotlight", action: "add" }, reg), /還沒開放加入/);
  assert.throws(() => CM.applyContentModule(dj, { kind: "promoCard", action: "add" }, reg), /還沒開放加入/);
});

test("A→加→編→刪→A：page 深度 diff=0（三模組各驗；M4 核心不變式）", () => {
  const { reg } = buildRegistry();
  for (const kind of ["mechanic", "spotlight", "promoCard"]) {
    const dj = baseDraft();
    const before = JSON.stringify(dj.page);
    CM.applyContentModule(dj, { kind, action: "add" }, reg);
    if (kind === "mechanic") {
      CM.applyContentModule(dj, { kind, action: "set", variant: "info-gift-rows" }, reg);
      dj.page.mechanic.rows[0].thresholdText = "滿 $3,000"; // 模擬內容編修（PUT 路）
      dj.page.mechanic.rows[0].rewardText = "折 $300";
    } else if (kind === "spotlight") {
      dj.page.spotlight.title = "測試大標題";
      dj.page.spotlight.heroCard.gdid = "222";
      dj.page.spotlight.productRefs = ["111", "333"];
    } else {
      dj.page.promoCards[0].gdid = "333"; // 多卡制（2026-08-26）：節點形＝陣列
      dj.page.promoCards[0].priceNote = "｜挑戰低價";
    }
    CM.validateContentModules(dj.page, reg, dj.products); // 編修後仍過閘
    CM.applyContentModule(dj, { kind, action: "remove" }, reg);
    assert.strictEqual(JSON.stringify(dj.page), before, `${kind}：加→編→刪 後 page 應與原始逐字相同`);
  }
});

test("移除不存在的區塊＝changed:false（不寫檔、不炸）", () => {
  const { reg } = buildRegistry();
  const dj = baseDraft();
  const r = CM.applyContentModule(dj, { kind: "spotlight", action: "remove" }, reg);
  assert.strictEqual(r.changed, false);
});

test("機器閘負向（M5）：列數×版式不一致／URL 非站內／gdid 懸空／productRefs>2／rewardImgs>2＝throw", () => {
  const { reg } = buildRegistry();
  const dj = baseDraft();
  CM.applyContentModule(dj, { kind: "mechanic", action: "add" }, reg);
  dj.page.mechanic.rows.push(CM.defaultNodeFor("mechanic").rows[0]); // 竄改列數（PUT 路可能被亂傳）
  assert.throws(() => CM.validateContentModules(dj.page, reg, dj.products), /列數對不上|固定是/);
  dj.page.mechanic.rows.pop();
  dj.page.mechanic.rows[0].ctaUrl = "https://evil.example.com/x";
  assert.throws(() => CM.validateContentModules(dj.page, reg, dj.products), /Yahoo購物中心（https:\/\/tw\.buy\.yahoo\.com）或促銷活動站/);
  dj.page.mechanic.rows[0].ctaUrl = "https://tw.buy.yahoo.com/activity/x";
  dj.page.mechanic.banner.url = "http://tw.buy.yahoo.com/x"; // http 非 https＝也擋
  assert.throws(() => CM.validateContentModules(dj.page, reg, dj.products), /Yahoo購物中心（https:\/\/tw\.buy\.yahoo\.com）或促銷活動站/);
  dj.page.mechanic.banner.url = "";
  dj.page.mechanic.rows[0].rewardImgs = ["https://a/1.jpg", "https://a/2.jpg", "https://a/3.jpg"];
  assert.throws(() => CM.validateContentModules(dj.page, reg, dj.products), /最多 2 張/);
  dj.page.mechanic.rows[0].rewardImgs = [];
  CM.applyContentModule(dj, { kind: "spotlight", action: "add" }, reg);
  dj.page.spotlight.heroCard.gdid = "999";
  assert.throws(() => CM.validateContentModules(dj.page, reg, dj.products), /不在這檔活動的商品清單/);
  dj.page.spotlight.heroCard.gdid = "111";
  dj.page.spotlight.productRefs = ["111", "222", "333"];
  assert.throws(() => CM.validateContentModules(dj.page, reg, dj.products), /最多 2 件/);
  dj.page.spotlight.productRefs = ["222", "333"];
  CM.applyContentModule(dj, { kind: "promoCard", action: "add" }, reg);
  dj.page.promoCards[0].gdid = "000";
  assert.throws(() => CM.validateContentModules(dj.page, reg, dj.products), /不在這檔活動的商品清單/);
});

test("寫入紀律（M4）：writeContentModuleIntoDraft＝落版備份＋寫回；零變更＝不寫檔；寫入失敗＝throw 出聲", () => {
  const { reg } = buildRegistry();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "content-modules-run-"));
  const dp = path.join(dir, "draft.json");
  fs.writeFileSync(dp, JSON.stringify(baseDraft(), null, 1));
  const r = CM.writeContentModuleIntoDraft(dp, { kind: "promoCard", action: "add" }, reg);
  assert.strictEqual(r.changed, true);
  assert.strictEqual(r.backup, "draft.v1.json");
  assert.ok(fs.existsSync(path.join(dir, "draft.v1.json")), "變更前落版備份");
  const onDisk = JSON.parse(fs.readFileSync(dp, "utf8"));
  assert.ok(Array.isArray(onDisk.page.promoCards) && onDisk.page.promoCards.length === 1, "變更寫回磁碟（多卡制＝陣列一張）");
  const r2 = CM.writeContentModuleIntoDraft(dp, { kind: "mechanic", action: "remove" }, reg);
  assert.strictEqual(r2.changed, false);
  assert.ok(!fs.existsSync(path.join(dir, "draft.v2.json")), "零變更＝不寫檔不落備份");
  assert.throws(() => CM.writeContentModuleIntoDraft(path.join(dir, "nope", "draft.json"), { kind: "mechanic", action: "add" }, reg), /讀取草稿/);
});

test("驗證器對缺節點頁面＝零波及（舊 draft 不受影響）", () => {
  const { reg } = buildRegistry();
  const dj = baseDraft();
  assert.doesNotThrow(() => CM.validateContentModules(dj.page, reg, dj.products));
});

/* ---------- banner 輪播批（2026-08-26 使用者實測回報）：資訊卡 banner.imgs 1~3 張 ---------- */

test("banner 輪播（2026-08-26）：預設形＝imgs 三空格＋img 舊欄保留；1 張/3 張/含空格＝合法", () => {
  const { reg } = buildRegistry();
  const dj = baseDraft();
  CM.applyContentModule(dj, { kind: "mechanic", action: "add" }, reg);
  assert.deepStrictEqual(dj.page.mechanic.banner.imgs, ["", "", ""], "預設形＝三空格（面板三欄直寫）");
  assert.strictEqual(dj.page.mechanic.banner.img, "", "img 舊欄保留（讀取端優先 imgs、退 img＝相容）");
  dj.page.mechanic.banner.imgs = ["https://s.yimg.com/banner-1.jpg"];
  assert.doesNotThrow(() => CM.validateContentModules(dj.page, reg, dj.products), "1 張＝合法（不輪播）");
  dj.page.mechanic.banner.imgs = ["https://s.yimg.com/b1.jpg", "https://s.yimg.com/b2.jpg", "https://s.yimg.com/b3.jpg"];
  assert.doesNotThrow(() => CM.validateContentModules(dj.page, reg, dj.products), "3 張＝合法（自動輪播）");
  dj.page.mechanic.banner.imgs = ["https://s.yimg.com/b1.jpg", "", "https://s.yimg.com/b3.jpg"];
  assert.doesNotThrow(() => CM.validateContentModules(dj.page, reg, dj.products), "含空格＝合法（空格忽略）");
});

test("banner 輪播負向：4 張擋／非陣列擋／格內非字串擋——白話錯誤；PUT 路同一套閘", () => {
  const { reg } = buildRegistry();
  const dj = baseDraft();
  CM.applyContentModule(dj, { kind: "mechanic", action: "add" }, reg);
  dj.page.mechanic.banner.imgs = ["https://a/1.jpg", "https://a/2.jpg", "https://a/3.jpg", "https://a/4.jpg"];
  assert.throws(() => CM.validateContentModules(dj.page, reg, dj.products), /最多 3 張/, "4 張＝超過輪播上限");
  dj.page.mechanic.banner.imgs = "https://a/1.jpg"; // PUT 路可能被亂傳＝兩路同一套閘（M5）
  assert.throws(() => CM.validateContentModules(dj.page, reg, dj.products), /資料形不對/, "非陣列＝擋");
  dj.page.mechanic.banner.imgs = [123];
  assert.throws(() => CM.validateContentModules(dj.page, reg, dj.products), /網址文字/, "格內非字串＝擋");
});

test("banner 輪播相容：舊 draft 只有 banner.img（無 imgs 鍵）＝合法零波及", () => {
  const { reg } = buildRegistry();
  const dj = baseDraft();
  CM.applyContentModule(dj, { kind: "mechanic", action: "add" }, reg);
  delete dj.page.mechanic.banner.imgs; // 模擬 2026-08-26 前的舊稿形
  dj.page.mechanic.banner.img = "https://s.yimg.com/old-banner.jpg";
  assert.doesNotThrow(() => CM.validateContentModules(dj.page, reg, dj.products), "imgs 缺席＝在場才驗（舊 draft 不受影響）");
});

/* ---------- W2 第二批（2026-08-26）：模組順序 move ＋ 固定模組移除 ---------- */

test("模組順序（M11）：mechanic 下移一格＝與 promo 對調；下移→上移＝page 逐字復原（等於預設序＝刪鍵）；碰頂（kv 恆首）＝changed:false", () => {
  const { reg } = buildRegistry();
  const dj = baseDraft();
  CM.applyContentModule(dj, { kind: "mechanic", action: "add" }, reg);
  const before = JSON.stringify(dj.page);
  const r1 = CM.applyContentModule(dj, { kind: "mechanic", action: "move", dir: "down" }, reg);
  assert.strictEqual(r1.changed, true);
  assert.deepStrictEqual(dj.page.composeOrder, ["kv", "promo", "mechanic", "spotlight", "promoCard", "featured", "editorial", "walls", "explore"]);
  const r2 = CM.applyContentModule(dj, { kind: "mechanic", action: "move", dir: "up" }, reg);
  assert.strictEqual(r2.changed, true);
  assert.ok(!("composeOrder" in dj.page), "回到預設序＝刪鍵（缺席即預設、不留冗餘複本）");
  assert.strictEqual(JSON.stringify(dj.page), before, "下移→上移＝page 深度 diff=0");
  const r3 = CM.applyContentModule(dj, { kind: "mechanic", action: "move", dir: "up" }, reg);
  assert.strictEqual(r3.changed, false, "碰頂＝零變更（第 1 位固定是 kv 主視覺）");
  assert.ok(/最上面/.test(r3.info.summary));
});

test("模組順序（S11 釘位制）：碰底界＝explore 前；promo 開放移動；舊稿 explore 後綴形＝move 前自動歸位；未加入不能移；未知方向＝throw", () => {
  const { reg } = buildRegistry();
  const dj = baseDraft();
  CM.applyContentModule(dj, { kind: "promoCard", action: "add" }, reg);
  /* 舊制合法形（promoCard 在 explore 後）＝S11 起讀入正規化：move 動作先歸位（explore 恆末）再操作 */
  dj.page.composeOrder = ["kv", "mechanic", "promo", "spotlight", "featured", "editorial", "walls", "explore", "promoCard"];
  const r = CM.applyContentModule(dj, { kind: "promoCard", action: "move", dir: "down" }, reg);
  assert.strictEqual(r.changed, false, "歸位後 promoCard 在 explore 前＝已是最底可動位＝零變更");
  assert.deepStrictEqual(dj.page.composeOrder, ["kv", "mechanic", "promo", "spotlight", "featured", "editorial", "walls", "promoCard", "explore"], "explore 歸末位（遷移形轉正）");
  dj.page.promoEntries = [{ url: "https://tw.buy.yahoo.com/x", copy: "x" }]; // promo 在場＝可移（S11 七鍵開放）
  /* 大體檢 JS-03 後語意：move 跳過「樹上看不見」的鍵——promo 上面只有隱形的 mechanic＝視覺已在頂、up＝碰界零變更；
     down＝跳過隱形 spotlight 直接跨到可見的 featured 後面（一次到位、隱形鍵相對序保留） */
  const rpUp = CM.applyContentModule(dj, { kind: "promo", action: "move", dir: "up" }, reg);
  assert.strictEqual(rpUp.changed, false, "上方全隱形＝視覺已在頂＝碰界（JS-03 修後語意）");
  const rp = CM.applyContentModule(dj, { kind: "promo", action: "move", dir: "down" }, reg);
  assert.strictEqual(rp.changed, true, "本期活動已開放移動（原固定鍵制退役）");
  const co2 = dj.page.composeOrder;
  assert.ok(co2.indexOf("promo") > co2.indexOf("featured"), "跳過隱形 spotlight＝promo 一次跨到可見的樓層群後面");
  assert.throws(() => CM.applyContentModule(dj, { kind: "spotlight", action: "move", dir: "up" }, reg), /還沒加入|還沒有/, "未加入＝不用調位置");
  assert.throws(() => CM.applyContentModule(dj, { kind: "promoCard", action: "move", dir: "left" }, reg), /移動方向/);
});

test("S11 樓層/牆個體戶：組內對調（pos 與 position 重編）＋碰組邊界＝changed:false＋加一層/一面（上限 3）＋單層移除（牆下限 1、樓層可刪到 0＝刪鍵）", () => {
  const { reg } = buildRegistry();
  const dj = baseDraft();
  dj.page.floors = [
    { pos: "featured-1", title: "A 層", productGdids: ["111"] },
    { pos: "featured-2", title: "B 層", productGdids: ["222"] },
  ];
  dj.products[0].position = "featured-1";
  dj.products[1].position = "featured-2";
  dj.products[2].position = "featured-2-scene";
  /* 組內對調：floors[0]<->[1]、pos 重編、products.position 跟槽走（含 scene 列） */
  const rm = CM.applyContentModule(dj, { kind: "floor", action: "move", index: 0, dir: "down" }, reg);
  assert.strictEqual(rm.changed, true);
  assert.strictEqual(dj.page.floors[0].title, "B 層");
  assert.strictEqual(dj.page.floors[0].pos, "featured-1");
  assert.strictEqual(dj.products[0].position, "featured-2", "111 跟著 A 層搬到第 2 槽");
  assert.strictEqual(dj.products[2].position, "featured-1-scene", "scene 列跟樓層走");
  const rEdge = CM.applyContentModule(dj, { kind: "floor", action: "move", index: 0, dir: "up" }, reg);
  assert.strictEqual(rEdge.changed, false, "組內碰頂＝零變更（UI 邊界鈕 disabled＝第二道守門）");
  assert.throws(() => CM.applyContentModule(dj, { kind: "floor", action: "move", dir: "up" }, reg), /指定移動哪一層/, "indexed move 必帶 index");
  /* 加一面牆（空牆照形）→ 第二面 → 第三面滿位 → 第四面擋 */
  dj.page.walls = [{ pos: "category-1", title: "牆一", productGdids: [] }];
  CM.applyContentModule(dj, { kind: "wall", action: "add" }, reg);
  CM.applyContentModule(dj, { kind: "wall", action: "add" }, reg);
  assert.strictEqual(dj.page.walls.length, 3);
  assert.strictEqual(dj.page.walls[2].pos, "category-3");
  assert.throws(() => CM.applyContentModule(dj, { kind: "wall", action: "add" }, reg), /最多 3 面/);
  /* 牆單面移除＋宣告欄同步＋下限 1 擋 */
  dj.page.categoryWallCount = 3;
  const rw = CM.applyContentModule(dj, { kind: "wall", action: "remove", index: 2 }, reg);
  assert.strictEqual(rw.changed, true);
  assert.strictEqual(dj.page.categoryWallCount, 2, "CP-16 宣告欄跟實數（gate 宣告≠實有＝FAIL）");
  CM.applyContentModule(dj, { kind: "wall", action: "remove", index: 1 }, reg);
  assert.strictEqual(dj.page.walls.length, 1);
  assert.throws(() => CM.applyContentModule(dj, { kind: "wall", action: "remove", index: 0 }, reg), /至少要留 1 面/, "牆下限 1（2026-08-27 裁決 1~3）");
  /* 樓層可刪到 0＝刪鍵（缺席即預設）；被刪槽的商品 position 清空、後槽前移 */
  CM.applyContentModule(dj, { kind: "floor", action: "remove", index: 0 }, reg);
  assert.strictEqual(dj.products[2].position === undefined || dj.products[2].position === "", true, "被刪槽 scene 列＝position 清空（商品留池）");
  assert.strictEqual(dj.page.floors.length, 1);
  assert.strictEqual(dj.products[0].position, "featured-1", "後槽前移一格");
  CM.applyContentModule(dj, { kind: "floor", action: "remove", index: 0 }, reg);
  assert.ok(!("floors" in dj.page), "樓層刪到 0＝刪鍵（絕非空陣列）");
});

test("composeOrder 非法＝validateContentModules 擋（缺鍵/重複/固定序破壞/kv 非首）——PUT 路同一套閘", () => {
  const { reg } = buildRegistry();
  const dj = baseDraft();
  const D = CM.COMPOSE_ORDER_DEFAULT;
  dj.page.composeOrder = D.slice(0, 8); // 缺鍵
  assert.throws(() => CM.validateContentModules(dj.page, reg, dj.products), /不完整或有重複/);
  dj.page.composeOrder = [...D.slice(0, 8), "walls"]; // 重複（walls ×2、缺 explore）
  assert.throws(() => CM.validateContentModules(dj.page, reg, dj.products), /不完整或有重複/);
  dj.page.composeOrder = ["kv", "mechanic", "featured", "spotlight", "promoCard", "promo", "editorial", "walls", "explore"]; // 原「固定序破壞」形＝S11 起合法（中段七鍵自由）
  assert.doesNotThrow(() => CM.validateContentModules(dj.page, reg, dj.products), "釘位制：kv 首＋explore 末即合法");
  dj.page.composeOrder = ["kv", "mechanic", "promo", "spotlight", "explore", "promoCard", "featured", "editorial", "walls"]; // 舊制合法「explore 後綴」形＝讀入正規化（不擋）
  assert.doesNotThrow(() => CM.validateContentModules(dj.page, reg, dj.products));
  assert.ok(!("composeOrder" in dj.page), "explore 歸末、其餘原序前移——本例恰等於預設序＝刪鍵（缺席即預設慣例）");
  dj.page.composeOrder = ["mechanic", "kv", "promo", "spotlight", "promoCard", "featured", "editorial", "walls", "explore"]; // kv 非首（正規化不救＝出聲）
  assert.throws(() => CM.validateContentModules(dj.page, reg, dj.products), /主視覺固定在頁面最上方/);
  dj.page.composeOrder = D.slice(); // 合法排列＝放行
  assert.doesNotThrow(() => CM.validateContentModules(dj.page, reg, dj.products));
  delete dj.page.composeOrder; // 缺席＝預設序＝合法（舊 draft 零波及）
  assert.doesNotThrow(() => CM.validateContentModules(dj.page, reg, dj.products));
});

test("固定模組移除：promo remove＝promoEntries 鍵消失（絕非空陣列＝CP-15）；promoModuleTitle 留著；editorial remove；add/set 被拒", () => {
  const { reg } = buildRegistry();
  const dj = baseDraft();
  dj.page.promoEntries = [{ chip: "測試", copy: "測試文案", url: "https://tw.buy.yahoo.com/activity/x" }];
  dj.page.promoModuleTitle = "本期活動";
  dj.page.dockPromoLabel = "本期";
  dj.page.editorial = { title: ["A", "B", "C"], circles: [] };
  const r1 = CM.applyContentModule(dj, { kind: "promo", action: "remove" }, reg);
  assert.strictEqual(r1.changed, true);
  assert.ok(!("promoEntries" in dj.page), "delete 鍵——鍵缺席＝gate 略過；[]＝FAIL，絕不可寫");
  assert.strictEqual(dj.page.promoModuleTitle, "本期活動", "promoModuleTitle 不隨移除清");
  assert.strictEqual(dj.page.dockPromoLabel, "本期", "dockPromoLabel 不隨移除清");
  const r2 = CM.applyContentModule(dj, { kind: "editorial", action: "remove" }, reg);
  assert.strictEqual(r2.changed, true);
  assert.ok(!("editorial" in dj.page), "editorial 同為 delete 鍵制");
  const r3 = CM.applyContentModule(dj, { kind: "promo", action: "remove" }, reg);
  assert.strictEqual(r3.changed, false, "已不在頁面上＝零變更（不寫檔、不炸）");
  assert.throws(() => CM.applyContentModule(dj, { kind: "promo", action: "add" }, reg), /原本的.*面板/, "promo 只開放 remove");
  assert.throws(() => CM.applyContentModule(dj, { kind: "editorial", action: "add" }, reg), /原本的.*面板/);
  assert.throws(() => CM.applyContentModule(dj, { kind: "editorial", action: "set", variant: "x" }, reg), /原本的.*面板/);
});

/* ---------- W2.5 換皮批（2026-08-26 使用者方案 A 四題裁決）：本期活動排版樣式 set-variant ---------- */

function promoEntriesFixture() {
  return [
    { chip: "本檔主打", copy: "滿199享95折", dateValue: "2026.08.20 ~ 2026.08.31", url: "https://tw.buy.yahoo.com/activity/a" },
    { chip: "加碼", copy: "滿千折百", dateValue: "", url: "https://tw.buy.yahoo.com/activity/b" },
    { chip: "新品", copy: "新品搶先看", dateValue: "", url: "https://tw.buy.yahoo.com/activity/c" },
  ];
}

test("排版樣式值域：白名單 runtime 讀 modules.json promo variants（buildSelectable 過濾＝好禮款登了也不進值域）", () => {
  const { reg } = buildRegistry();
  assert.deepStrictEqual([...reg.promoVariantIds].sort(), ["entry-circles", "offer-rows"]);
  const { reg: reg2 } = buildRegistry({ promoVariants: [
    { variant_id: "entry-circles", buildSelectable: true },
    { variant_id: "offer-rows", buildSelectable: false }, // 讀簿把關：關掉 buildSelectable＝面板值域即時消失（零硬編）
  ] });
  assert.ok(!reg2.promoVariantIds.has("offer-rows"));
  const dj = baseDraft();
  dj.page.promoEntries = promoEntriesFixture();
  assert.throws(() => CM.applyContentModule(dj, { kind: "promo", action: "set-variant", variant: "offer-rows" }, reg2), /排版樣式系統不認得/);
});

test("換皮（方案 A）：offer-rows 寫入→同值 changed:false→換回 entry-circles＝鍵消失；A→換皮→換回 page 深度 diff=0；promoEntries 零改動", () => {
  const { reg } = buildRegistry();
  const dj = baseDraft();
  dj.page.promoEntries = promoEntriesFixture();
  const before = JSON.stringify(dj.page);
  const r1 = CM.applyContentModule(dj, { kind: "promo", action: "set-variant", variant: "offer-rows" }, reg);
  assert.strictEqual(r1.changed, true);
  assert.strictEqual(dj.page.promoVariant, "offer-rows");
  assert.ok(/內容都沒動/.test(r1.info.summary) && !/皮/.test(r1.info.summary), "白話回報＝同內容換皮；顯示名不帶治理字「皮」");
  assert.strictEqual(JSON.stringify(dj.page.promoEntries), JSON.stringify(promoEntriesFixture()), "同內容換皮＝promoEntries 一字未動");
  const r2 = CM.applyContentModule(dj, { kind: "promo", action: "set-variant", variant: "offer-rows" }, reg);
  assert.strictEqual(r2.changed, false, "同值重設＝零變更（不寫檔）");
  assert.ok(/排版樣式沒有變/.test(r2.info.summary));
  const r3 = CM.applyContentModule(dj, { kind: "promo", action: "set-variant", variant: "entry-circles" }, reg);
  assert.strictEqual(r3.changed, true);
  assert.ok(!("promoVariant" in dj.page), "換回預設＝刪鍵（缺席即預設＝舊 draft 零波及，沿 composeOrder 慣例）");
  assert.strictEqual(JSON.stringify(dj.page), before, "A→換皮→換回＝page 深度 diff=0");
  const r4 = CM.applyContentModule(dj, { kind: "promo", action: "set-variant", variant: "entry-circles" }, reg);
  assert.strictEqual(r4.changed, false, "已是預設（鍵缺席）再選預設＝零變更");
});

test("換皮負向：非法值擋／promo 已移除（無 promoEntries 鍵）＝白話擋／set-variant 打錯對象＝擋／PUT 路 validateContentModules 同閘", () => {
  const { reg } = buildRegistry();
  const dj = baseDraft();
  dj.page.promoEntries = promoEntriesFixture();
  assert.throws(() => CM.applyContentModule(dj, { kind: "promo", action: "set-variant", variant: "info-gift-rows" }, reg), /排版樣式系統不認得/, "好禮款未登錄 promo variants＝白名單外（缺承諾性真值欄＝不開放）");
  assert.throws(() => CM.applyContentModule(dj, { kind: "promo", action: "set-variant", variant: "" }, reg), /排版樣式系統不認得/);
  assert.throws(() => CM.applyContentModule(dj, { kind: "mechanic", action: "set-variant", variant: "offer-rows" }, reg), /沒有排版樣式可換/, "資訊卡換版式走 set、不走 set-variant");
  delete dj.page.promoEntries;
  assert.throws(() => CM.applyContentModule(dj, { kind: "promo", action: "set-variant", variant: "offer-rows" }, reg), /還沒有「本期活動」/, "模組不在頁面上＝先建立再挑樣式（建議擋＝2026-08-26 實作裁定）");
  dj.page.promoVariant = "not-a-skin"; // PUT 路可能被亂傳＝兩路同一套閘（M5）
  assert.throws(() => CM.validateContentModules(dj.page, reg, dj.products), /排版樣式系統不認得/);
  dj.page.promoVariant = "offer-rows"; // 懸掛值（模組已移除、樣式欄殘留）＝合法——沿 promoModuleTitle 不隨移除清的慣例，重建時沿用
  assert.doesNotThrow(() => CM.validateContentModules(dj.page, reg, dj.products));
  delete dj.page.promoVariant; // 缺席＝entry-circles 預設＝合法（舊 draft 零波及）
  assert.doesNotThrow(() => CM.validateContentModules(dj.page, reg, dj.products));
});

test("換皮寫入紀律：writeContentModuleIntoDraft set-variant＝落版備份＋寫回；同值＝不寫檔", () => {
  const { reg } = buildRegistry();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "content-modules-run-"));
  const dp = path.join(dir, "draft.json");
  const dj = baseDraft();
  dj.page.promoEntries = promoEntriesFixture();
  fs.writeFileSync(dp, JSON.stringify(dj, null, 1));
  const r = CM.writeContentModuleIntoDraft(dp, { kind: "promo", action: "set-variant", variant: "offer-rows" }, reg);
  assert.strictEqual(r.changed, true);
  assert.strictEqual(r.backup, "draft.v1.json");
  assert.strictEqual(JSON.parse(fs.readFileSync(dp, "utf8")).page.promoVariant, "offer-rows", "變更寫回磁碟");
  const r2 = CM.writeContentModuleIntoDraft(dp, { kind: "promo", action: "set-variant", variant: "offer-rows" }, reg);
  assert.strictEqual(r2.changed, false);
  assert.ok(!fs.existsSync(path.join(dir, "draft.v2.json")), "同值＝零變更＝不寫檔不落備份");
});

/* ---------- 主打選品貼稿選品（2026-08-26 使用者需求；14 §2.14 配套規則 8 登錄待審） ----------
 * pick 動作＝lib 只收伺服器實抓真值（change.product）；守的邏輯：
 *   ⑪帶入新品＝products[] 追加一列（position=spotlight-pick、tagSource=manual、offer 留空）＋slot gdid 寫入
 *   ⑫dedupe by gdid：已在活動裡＝直接引用不重複加　⑬同 slot 同品＝changed:false／另一 slot 已有同品＝白話擋
 *   ⑭防手填繞道：product 缺真值欄（名稱/價格/連結/圖）＝throw　⑮寫入紀律＝落版備份＋寫回（同一寫入口）
 *   ⑯絆線：draft-writers.allow content-modules-apply 行必須登錄 pick（G3 同款登錄制）
 * 促銷卡多卡＋牆/樓層加商品批（2026-08-26 下午；14 §2.14 促銷卡多卡段＋規則 8/9 登錄待審）：
 *   ⑰促銷卡 promoCards[] 1~4：add＝加卡（滿 4 擋）／remove index＝單卡移除（0 張＝刪鍵）／
 *     舊形單物件＝讀取相容視為一張、寫入動作就地升級陣列刪舊鍵（雙鍵並存＝驗證器擋）；
 *     驗證器＝非陣列/空陣列/>4/卡 gdid 懸空/卡間 gdid 重複＝throw
 *   ⑱pick 擴 kind=promoCard（slot=card-1~20、position promo-card-pick；2026-09-09 上限 4→20）＝同 spotlight 引用式（dedupe＋卡間互斥）
 *   ⑲pick 擴 kind=wall|floor（index）＝全頁互斥（已用在任一曝光位＝擋）＋件數上限（樓層 5／牆 12）＋
 *     件數提醒照各模組真規則（牆＝4 倍數、樓層＝3~5）；walls/floors 僅開 pick（add/remove/set/move＝擋） */
function pickedProduct(over = {}) {
  return Object.assign({
    gdid: "444", name: "貼稿帶入的新商品", price: 500,
    url: "https://tw.buy.yahoo.com/gdsale/gdsale.asp?gdid=444",
    imgs: ["https://s.yimg.com/zp/MerchandiseImages/a-Gd-444.jpg", "https://s.yimg.com/zp/MerchandiseImages/b-Gd-444.jpg"],
    marketPrice: 700,
  }, over);
}
function spotlightDraft(reg) {
  const dj = baseDraft();
  CM.applyContentModule(dj, { kind: "spotlight", action: "add" }, reg);
  return dj;
}

test("貼稿帶入新品（hero）：products[] 追加一列真值（position=spotlight-pick、tagSource=manual、offer 留空）＋heroCard.gdid 寫入", () => {
  const { reg } = buildRegistry();
  const dj = spotlightDraft(reg);
  const r = CM.applyContentModule(dj, { kind: "spotlight", action: "pick", slot: "hero", product: pickedProduct() }, reg);
  assert.strictEqual(r.changed, true);
  assert.strictEqual(dj.page.spotlight.heroCard.gdid, "444");
  assert.strictEqual(dj.products.length, 4, "新品＝追加一列");
  const row = dj.products.find((p) => p.gdid === "444");
  assert.strictEqual(row.position, CM.SPOTLIGHT_PICK_POSITION);
  assert.strictEqual(row.tagSource, "manual");
  assert.strictEqual(row.offer, "", "offer 不可得＝留空不捏造");
  assert.strictEqual(row.name, "貼稿帶入的新商品");
  assert.strictEqual(row.price, 500);
  assert.strictEqual(row.marketPrice, 700, "原價＝實抓 listPrice 語意（僅高於現價才收）");
  assert.strictEqual(row.img, pickedProduct().imgs[0]);
  assert.strictEqual(row.sceneImg, pickedProduct().imgs[1]);
  assert.ok(/貼稿帶入的新商品/.test(r.info.summary) && /大卡主打/.test(r.info.summary), "白話確認＝名稱＋位置");
  assert.doesNotThrow(() => CM.validateContentModules(dj.page, reg, dj.products), "寫後 gdid 必在 products[]＝驗證器綠");
});

test("dedupe by gdid：已在活動裡＝直接引用不重複加（products[] 長度不變、無第二列）", () => {
  const { reg } = buildRegistry();
  const dj = spotlightDraft(reg);
  const p222 = pickedProduct({ gdid: "222", name: "測試商品二" });
  const r = CM.applyContentModule(dj, { kind: "spotlight", action: "pick", slot: "hero", product: p222 }, reg);
  assert.strictEqual(r.changed, true);
  assert.strictEqual(dj.page.spotlight.heroCard.gdid, "222");
  assert.strictEqual(dj.products.length, 3, "既有品＝不追加");
  assert.strictEqual(dj.products.filter((p) => String(p.gdid) === "222").length, 1, "絕不重複列");
  assert.ok(r.info.notes.some((n) => /直接引用/.test(n)), "白話交代＝引用不重複加");
});

test("右欄槽位：pick ref2＝productRefs[1] 寫入、[0] 洞補空字串（勿留 null＝驗證語意跑掉）；ref1 再帶入照位寫", () => {
  const { reg } = buildRegistry();
  const dj = spotlightDraft(reg);
  CM.applyContentModule(dj, { kind: "spotlight", action: "pick", slot: "ref2", product: pickedProduct() }, reg);
  assert.deepStrictEqual(dj.page.spotlight.productRefs, ["", "444"]);
  CM.applyContentModule(dj, { kind: "spotlight", action: "pick", slot: "ref1", product: pickedProduct({ gdid: "222", name: "測試商品二" }) }, reg);
  assert.deepStrictEqual(dj.page.spotlight.productRefs, ["222", "444"]);
  assert.doesNotThrow(() => CM.validateContentModules(dj.page, reg, dj.products));
});

test("pick 邊界：同 slot 同品＝changed:false；另一 slot 已有同品＝白話擋；沒加 spotlight／slot 非法／kind 非 spotlight＝throw", () => {
  const { reg } = buildRegistry();
  const dj = spotlightDraft(reg);
  CM.applyContentModule(dj, { kind: "spotlight", action: "pick", slot: "hero", product: pickedProduct() }, reg);
  const r2 = CM.applyContentModule(dj, { kind: "spotlight", action: "pick", slot: "hero", product: pickedProduct() }, reg);
  assert.strictEqual(r2.changed, false, "同 slot 同品＝零變更（不寫檔）");
  assert.throws(() => CM.applyContentModule(dj, { kind: "spotlight", action: "pick", slot: "ref1", product: pickedProduct() }, reg), /已經放在主打選品/, "同區塊每件商品只放一次");
  assert.throws(() => CM.applyContentModule(dj, { kind: "spotlight", action: "pick", slot: "wat", product: pickedProduct() }, reg), /不在 hero\|ref1\|ref2/);
  assert.throws(() => CM.applyContentModule(dj, { kind: "mechanic", action: "pick", slot: "hero", product: pickedProduct() }, reg), /不支援貼網址帶入商品/, "資訊卡無選品位＝pick 值域外");
  const dj2 = baseDraft(); // 未加入 spotlight
  assert.throws(() => CM.applyContentModule(dj2, { kind: "spotlight", action: "pick", slot: "hero", product: pickedProduct() }, reg), /還沒有「主打選品」/);
});

test("防手填繞道：product 缺真值欄（gdid/name/price/url/imgs 任一）＝throw、draft 零改動", () => {
  const { reg } = buildRegistry();
  const dj = spotlightDraft(reg);
  const before = JSON.stringify(dj);
  for (const bad of [
    pickedProduct({ gdid: "" }), pickedProduct({ name: "" }), pickedProduct({ price: null }),
    pickedProduct({ url: "" }), pickedProduct({ imgs: [] }), pickedProduct({ imgs: null }), undefined,
  ]) {
    assert.throws(() => CM.applyContentModule(dj, { kind: "spotlight", action: "pick", slot: "hero", product: bad }, reg), /讀不到完整資料/);
  }
  assert.strictEqual(JSON.stringify(dj), before, "擋下＝draft 零改動");
});

test("pick 寫入紀律：writeContentModuleIntoDraft＝落版備份＋寫回；同品重帶＝零變更不寫檔", () => {
  const { reg } = buildRegistry();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "content-modules-run-"));
  const dp = path.join(dir, "draft.json");
  fs.writeFileSync(dp, JSON.stringify(spotlightDraft(reg), null, 1));
  const r = CM.writeContentModuleIntoDraft(dp, { kind: "spotlight", action: "pick", slot: "hero", product: pickedProduct() }, reg);
  assert.strictEqual(r.changed, true);
  assert.strictEqual(r.backup, "draft.v1.json");
  const onDisk = JSON.parse(fs.readFileSync(dp, "utf8"));
  assert.strictEqual(onDisk.page.spotlight.heroCard.gdid, "444", "slot 寫回磁碟");
  assert.ok(onDisk.products.some((p) => p.gdid === "444" && p.position === "spotlight-pick"), "新品列寫回磁碟");
  const r2 = CM.writeContentModuleIntoDraft(dp, { kind: "spotlight", action: "pick", slot: "hero", product: pickedProduct() }, reg);
  assert.strictEqual(r2.changed, false);
  assert.ok(!fs.existsSync(path.join(dir, "draft.v2.json")), "零變更＝不寫檔不落備份");
});

test("登錄絆線：draft-writers.allow content-modules-apply 行必須登錄 pick 動作（同 hero_combo 絆線制）", () => {
  const allow = fs.readFileSync(path.join(__dirname, "..", "..", "scripts", "draft-writers.allow"), "utf8");
  assert.match(allow, /pick 動作（kind=spotlight/, "pick 寫入路徑必須登錄 draft-writers.allow（G3 登錄制）");
  assert.match(allow, /spotlight-pick/, "position 標記必須入登錄（追溯）");
});

/* ---------- 促銷卡多卡（2026-08-26 下午批；14 §2.14 促銷卡多卡段登錄待審） ----------
 * 掛點升級 page.promoCards[]（1~4）：add＝加卡、remove index＝單卡移除（0 張＝刪鍵）、
 * 舊形 page.promoCard 單物件＝讀取相容視為一張、寫入動作就地升級陣列刪舊鍵。 */

test("促銷卡多卡：首次 add＝陣列一張空卡；連加到上限（20）張；第 21 張＝白話擋（放偶數張最整齊）", () => {
  const { reg } = buildRegistry();
  const dj = baseDraft();
  const r1 = CM.applyContentModule(dj, { kind: "promoCard", action: "add" }, reg);
  assert.strictEqual(r1.changed, true);
  assert.ok(Array.isArray(dj.page.promoCards) && dj.page.promoCards.length === 1, "節點形＝陣列");
  assert.deepStrictEqual(Object.keys(dj.page.promoCards[0]).sort(), ["capsuleText", "diagonalText", "gdid", "offerLine", "priceNote"].sort());
  const r2 = CM.applyContentModule(dj, { kind: "promoCard", action: "add" }, reg);
  assert.ok(/第 2 張/.test(r2.info.summary) && !/皮/.test(r2.info.summary));
  for (let i = 3; i <= CM.PROMO_CARDS_MAX; i++) CM.applyContentModule(dj, { kind: "promoCard", action: "add" }, reg);
  assert.strictEqual(CM.PROMO_CARDS_MAX, 20, "2026-09-09 使用者裁上限 20");
  assert.strictEqual(dj.page.promoCards.length, CM.PROMO_CARDS_MAX);
  assert.throws(() => CM.applyContentModule(dj, { kind: "promoCard", action: "add" }, reg), /放滿 20 張/, "滿 20＝白話擋");
});

test("促銷卡舊形相容：page.promoCard 單物件＝驗證合法（視為一張）；寫入動作就地升級陣列＋刪舊鍵；雙鍵並存＝擋", () => {
  const { reg } = buildRegistry();
  const dj = baseDraft();
  dj.page.promoCard = { capsuleText: "主打", diagonalText: "", offerLine: "", priceNote: "", gdid: "222" }; // 2026-08-25 第一批舊形
  assert.doesNotThrow(() => CM.validateContentModules(dj.page, reg, dj.products), "舊形讀取相容＝零波及");
  const r = CM.applyContentModule(dj, { kind: "promoCard", action: "add" }, reg); // 任何促銷卡寫入動作＝先升級
  assert.strictEqual(r.changed, true);
  assert.ok(!("promoCard" in dj.page), "升級必刪舊鍵（防雙真相）");
  assert.strictEqual(dj.page.promoCards.length, 2, "舊形那張保留為第 1 張、新加第 2 張");
  assert.strictEqual(dj.page.promoCards[0].gdid, "222", "舊卡內容原封不動");
  const dj2 = baseDraft();
  dj2.page.promoCard = { gdid: "" };
  dj2.page.promoCards = [{ gdid: "" }];
  assert.throws(() => CM.validateContentModules(dj2.page, reg, dj2.products), /新舊兩份/, "雙鍵並存＝雙真相、驗證器擋");
});

test("促銷卡單卡移除：remove index＝只移那張；移到 0 張＝整節點刪鍵；index 越界＝throw；加→刪＝page 逐字復原", () => {
  const { reg } = buildRegistry();
  const dj = baseDraft();
  const before = JSON.stringify(dj.page);
  CM.applyContentModule(dj, { kind: "promoCard", action: "add" }, reg);
  CM.applyContentModule(dj, { kind: "promoCard", action: "add" }, reg);
  dj.page.promoCards[0].capsuleText = "留下的卡";
  dj.page.promoCards[1].capsuleText = "要移的卡";
  const r1 = CM.applyContentModule(dj, { kind: "promoCard", action: "remove", index: 1 }, reg);
  assert.strictEqual(r1.changed, true);
  assert.strictEqual(dj.page.promoCards.length, 1);
  assert.strictEqual(dj.page.promoCards[0].capsuleText, "留下的卡");
  assert.throws(() => CM.applyContentModule(dj, { kind: "promoCard", action: "remove", index: 5 }, reg), /找不到要移除/, "index 越界＝throw");
  const r2 = CM.applyContentModule(dj, { kind: "promoCard", action: "remove", index: 0 }, reg);
  assert.strictEqual(r2.changed, true);
  assert.ok(!("promoCards" in dj.page), "最後一張移除＝刪鍵（delete 鍵制）");
  assert.ok(/整個「促銷卡」區塊/.test(r2.info.summary), "白話交代整塊下場");
  CM.applyContentModule(dj, { kind: "promoCard", action: "add" }, reg);
  CM.applyContentModule(dj, { kind: "promoCard", action: "remove" }, reg); // 不帶 index＝整塊移除（既有語意）
  assert.strictEqual(JSON.stringify(dj.page), before, "加→刪 後 page 逐字復原");
});

test("促銷卡驗證器：非陣列/空陣列/>4/卡非物件/卡間 gdid 重複＝throw；空 gdid 多卡＝合法", () => {
  const { reg } = buildRegistry();
  const dj = baseDraft();
  dj.page.promoCards = {};
  assert.throws(() => CM.validateContentModules(dj.page, reg, dj.products), /資料形不對/, "非陣列＝擋");
  dj.page.promoCards = [];
  assert.throws(() => CM.validateContentModules(dj.page, reg, dj.products), /1~20 張/, "空陣列＝擋（不放就整塊移除＝刪鍵）");
  dj.page.promoCards = Array.from({ length: CM.PROMO_CARDS_MAX + 1 }, () => ({}));
  assert.throws(() => CM.validateContentModules(dj.page, reg, dj.products), /1~20 張/, "21 張＝擋");
  dj.page.promoCards = [{}, "x"];
  assert.throws(() => CM.validateContentModules(dj.page, reg, dj.products), /第 2 張促銷卡的資料形不對/);
  dj.page.promoCards = [{ gdid: "222" }, { gdid: "222" }];
  assert.throws(() => CM.validateContentModules(dj.page, reg, dj.products), /同一件商品/, "卡間 gdid 重複＝擋（PUT 下拉路同閘）");
  dj.page.promoCards = [{ gdid: "" }, { gdid: "" }, { gdid: "333" }];
  assert.doesNotThrow(() => CM.validateContentModules(dj.page, reg, dj.products), "空 gdid 多卡＝還沒選品、合法");
});

test("促銷卡 pick：card-2 帶入新品＝products 追加 position promo-card-pick＋該卡 gdid 寫入；同卡同品＝零變更；他卡同品＝擋", () => {
  const { reg } = buildRegistry();
  const dj = baseDraft();
  CM.applyContentModule(dj, { kind: "promoCard", action: "add" }, reg);
  CM.applyContentModule(dj, { kind: "promoCard", action: "add" }, reg);
  const r = CM.applyContentModule(dj, { kind: "promoCard", action: "pick", slot: "card-2", product: pickedProduct() }, reg);
  assert.strictEqual(r.changed, true);
  assert.strictEqual(dj.page.promoCards[1].gdid, "444");
  const row = dj.products.find((p) => p.gdid === "444");
  assert.strictEqual(row.position, "promo-card-pick", "position 沿 spotlight-pick 慣例命名");
  assert.strictEqual(row.tagSource, "manual");
  assert.ok(/第 2 張促銷卡/.test(r.info.summary));
  const r2 = CM.applyContentModule(dj, { kind: "promoCard", action: "pick", slot: "card-2", product: pickedProduct() }, reg);
  assert.strictEqual(r2.changed, false, "同卡同品＝零變更");
  assert.throws(() => CM.applyContentModule(dj, { kind: "promoCard", action: "pick", slot: "card-1", product: pickedProduct() }, reg), /已經放在第 2 張促銷卡/, "同區塊每件商品只放一次");
  assert.throws(() => CM.applyContentModule(dj, { kind: "promoCard", action: "pick", slot: "card-4", product: pickedProduct({ gdid: "555" }) }, reg), /還沒有第 4 張/, "卡還沒加＝先按新增");
  assert.throws(() => CM.applyContentModule(dj, { kind: "promoCard", action: "pick", slot: "hero", product: pickedProduct({ gdid: "555" }) }, reg), /card-1~card-20/, "槽位值域＝card-1~20（2026-09-09 上限 4→20）");
  const dj2 = baseDraft();
  assert.throws(() => CM.applyContentModule(dj2, { kind: "promoCard", action: "pick", slot: "card-1", product: pickedProduct() }, reg), /還沒有「促銷卡」/, "模組未加入＝白話擋");
});

/* ---------- 牆/樓層加商品（2026-08-26 下午批；14 §2.14 規則 9 登錄待審） ----------
 * pick 擴 kind=wall|floor：全頁互斥（每件商品整頁只放一次）＋件數上限（樓層 5／牆 12）＋提醒照各模組真規則 */

function wallsDraft() {
  const dj = baseDraft();
  dj.page.walls = [{ title: "牆一", productGdids: ["222"] }];
  return dj;
}

test("樓層加商品：新品入 products（position featured-1、order 接尾）＋gdid 推入樓層清單；提醒＝3/7/11/15 排制；同層重加＝零變更", () => {
  const { reg } = buildRegistry();
  const dj = baseDraft();
  const r = CM.applyContentModule(dj, { kind: "floor", action: "pick", index: 0, product: pickedProduct() }, reg);
  assert.strictEqual(r.changed, true);
  assert.deepStrictEqual(dj.page.floors[0].productGdids, ["111", "444"]);
  const row = dj.products.find((p) => p.gdid === "444");
  assert.strictEqual(row.position, "featured-1");
  assert.strictEqual(row.order, 2);
  assert.strictEqual(row.tagSource, "manual");
  assert.ok(/目前 2 件/.test(r.info.summary) && /情境卡＋3 件/.test(r.info.summary) && /還差 1 件/.test(r.info.summary), "件數提醒＝樓層真規則（第一排情境卡＋3、之後每排 4）");
  const r2 = CM.applyContentModule(dj, { kind: "floor", action: "pick", index: 0, product: pickedProduct() }, reg);
  assert.strictEqual(r2.changed, false, "同層重加＝零變更");
  const r3 = CM.applyContentModule(dj, { kind: "floor", action: "pick", index: 0, product: pickedProduct({ gdid: "555", name: "第三件" }) }, reg);
  assert.ok(/3 件剛好排滿——每排 4 件的節奏/.test(r3.info.summary), "湊滿第一排（情境卡＋3）＝剛好排滿提示（純文字、無符號）");
});

test("牆加商品：新品 position wall-1＋4 倍數提醒；已在 products 但未曝光＝直接引用不重複加", () => {
  const { reg } = buildRegistry();
  const dj = wallsDraft();
  const r = CM.applyContentModule(dj, { kind: "wall", action: "pick", index: 0, product: pickedProduct() }, reg);
  assert.strictEqual(r.changed, true);
  assert.deepStrictEqual(dj.page.walls[0].productGdids, ["222", "444"]);
  assert.strictEqual(dj.products.find((p) => p.gdid === "444").position, "category-1");
  assert.ok(/目前 2 件/.test(r.info.summary) && /再加 2 件/.test(r.info.summary), "件數提醒＝牆真規則（4 的倍數）");
  const n0 = dj.products.length;
  const r2 = CM.applyContentModule(dj, { kind: "wall", action: "pick", index: 0, product: pickedProduct({ gdid: "333", name: "測試商品三" }) }, reg); // 333＝已在 products、未在任何曝光位
  assert.strictEqual(r2.changed, true);
  assert.strictEqual(dj.products.length, n0, "既有品＝直接引用不重複加列");
  assert.ok(r2.info.notes.some((x) => /直接引用/.test(x)));
  const r3 = CM.applyContentModule(dj, { kind: "wall", action: "pick", index: 0, product: pickedProduct({ gdid: "666", name: "第四件" }) }, reg);
  assert.ok(/4 的倍數，排起來最整齊/.test(r3.info.summary), "湊滿 4 件＝倍數提示（純文字、無符號）");
});

test("全頁互斥：商品已用在樓層/牆/編輯精選/本期活動＝白話擋；主視覺＝放行＋提醒（2026-10-05 裁決可重複）", () => {
  const { reg } = buildRegistry();
  const dj = wallsDraft();
  assert.throws(() => CM.applyContentModule(dj, { kind: "floor", action: "pick", index: 0, product: pickedProduct({ gdid: "222" }) }, reg), /已經用在「品類牆 1」/, "牆上的品不能再進樓層");
  assert.throws(() => CM.applyContentModule(dj, { kind: "wall", action: "pick", index: 0, product: pickedProduct({ gdid: "111" }) }, reg), /已經用在「主打樓層 1」/, "樓層的品不能再進牆");
  dj.page.kv.keyProductGdids = ["333"];
  { /* 2026-10-05 使用者裁：主視覺可與下方重複＝pick 放行、notes 帶提醒（gate CP-18 另出 WARN） */
    const rH = CM.applyContentModule(dj, { kind: "wall", action: "pick", index: 0, product: pickedProduct({ gdid: "333" }) }, reg);
    assert.strictEqual(rH.changed, true, "主視覺的品可以進牆（提醒不擋）");
    assert.ok(rH.info.notes.some((t) => /主視覺可與下方重複曝光/.test(t)), "要有提醒句：" + JSON.stringify(rH.info.notes));
  }
  dj.products.push({ gdid: "777", position: "editorial-wall", name: "精選品", price: 10, url: "https://tw.buy.yahoo.com/gdsale/x-777.html" });
  assert.throws(() => CM.applyContentModule(dj, { kind: "wall", action: "pick", index: 0, product: pickedProduct({ gdid: "777" }) }, reg), /已經用在「編輯精選」/);
  dj.page.promoEntries = [{ chip: "x", copy: "y", url: "https://tw.buy.yahoo.com/gdsale/p-888.html", gdid: "888" }];
  assert.throws(() => CM.applyContentModule(dj, { kind: "wall", action: "pick", index: 0, product: pickedProduct({ gdid: "888" }) }, reg), /已經用在「本期活動」/);
});

test("件數上限與邊界：樓層滿 15 擋（2026-08-26 裁決 3/7/11/15）／牆滿 12 擋／index 越界＝throw／wall、floor 未開放動作擋（S11 起 add/remove/move 開放）", () => {
  const { reg } = buildRegistry();
  const dj = wallsDraft();
  dj.page.floors[0].productGdids = ["111"].concat(Array.from({ length: 14 }, (x, i) => "a" + i)); // 15 件滿
  assert.throws(() => CM.applyContentModule(dj, { kind: "floor", action: "pick", index: 0, product: pickedProduct() }, reg), /放滿 15 件/, "樓層上限 15（2026-08-26 裁決：第一排情境卡＋3、之後每排 4）");
  dj.page.walls[0].productGdids = Array.from({ length: 12 }, (x, i) => "w" + i);
  assert.throws(() => CM.applyContentModule(dj, { kind: "wall", action: "pick", index: 0, product: pickedProduct() }, reg), /放滿 12 件/, "牆上限 12（CP-21 值域）");
  assert.throws(() => CM.applyContentModule(dj, { kind: "wall", action: "pick", index: 3, product: pickedProduct() }, reg), /找不到要加商品的位置/, "index 越界");
  /* S11（2026-08-27）翻案：wall/floor 開放 add/remove/move（帶 index）——舊「僅開 pick」斷言退役；
     未開放動作（set）仍擋、indexed remove 不帶 index＝擋整組誤刪 */
  /* 2026-09-24：unpick（移除單一商品）開放後這句訊息改寫，本斷言隨之更新——
     守的是「未登錄的動作仍然被擋」這個行為，不是那句話的字面。set 照舊擋住。 */
  assert.throws(() => CM.applyContentModule(dj, { kind: "wall", action: "set" }, reg), /動作 set 未開放/, "未開放動作仍擋");
  assert.throws(() => CM.applyContentModule(dj, { kind: "wall", action: "nope" }, reg), /動作 nope 未開放/, "亂填的動作也要擋");
  assert.throws(() => CM.applyContentModule(dj, { kind: "floor", action: "remove" }, reg), /要指定移除哪一層/, "indexed remove 必帶 index（不提供整組移除）");
  assert.throws(() => CM.applyContentModule(dj, { kind: "floor", action: "pick", index: 0, product: pickedProduct({ name: "" }) }, reg), /讀不到完整資料/, "缺真值欄先擋（防手填繞道；上限檢在其後）");
});

test("牆/樓層 pick 寫入紀律：writeContentModuleIntoDraft＝落版備份＋寫回；同品重加＝零變更不寫檔", () => {
  const { reg } = buildRegistry();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "content-modules-run-"));
  const dp = path.join(dir, "draft.json");
  fs.writeFileSync(dp, JSON.stringify(wallsDraft(), null, 1));
  const r = CM.writeContentModuleIntoDraft(dp, { kind: "wall", action: "pick", index: 0, product: pickedProduct() }, reg);
  assert.strictEqual(r.changed, true);
  assert.strictEqual(r.backup, "draft.v1.json");
  const onDisk = JSON.parse(fs.readFileSync(dp, "utf8"));
  assert.deepStrictEqual(onDisk.page.walls[0].productGdids, ["222", "444"], "寫回磁碟");
  assert.ok(onDisk.products.some((p) => p.gdid === "444" && p.position === "category-1"));
  const r2 = CM.writeContentModuleIntoDraft(dp, { kind: "wall", action: "pick", index: 0, product: pickedProduct() }, reg);
  assert.strictEqual(r2.changed, false);
  assert.ok(!fs.existsSync(path.join(dir, "draft.v2.json")), "零變更＝不寫檔不落備份");
});

test("登錄絆線補：allow 檔必須登錄 promo-card-pick／wall-pick／floor-pick 與 promoCards 多卡（G3 登錄制）", () => {
  const allow = fs.readFileSync(path.join(__dirname, "..", "..", "scripts", "draft-writers.allow"), "utf8");
  assert.match(allow, /promo-card-pick/, "促銷卡貼稿 position/稽核標必須入登錄");
  assert.match(allow, /wall-pick/, "牆貼稿稽核標必須入登錄");
  assert.match(allow, /floor-pick/, "樓層貼稿稽核標必須入登錄");
  assert.match(allow, /promoCards\[\]/, "促銷卡多卡掛點升級必須入登錄");
});

/* ---------- 2026-09-09 使用者需求：banner 一圖一連結（banner.urls[]）＋搶購鈕文字（rows[].ctaText） ---------- */
test("banner 一圖一連結：預設形 urls 三空格；非 Yahoo 網域擋；>3 個擋；舊稿沒有 urls＝合法零波及", () => {
  const { reg } = buildRegistry();
  const dj = baseDraft();
  CM.applyContentModule(dj, { kind: "mechanic", action: "add" }, reg);
  assert.deepStrictEqual(dj.page.mechanic.banner.urls, ["", "", ""], "預設三空格＝與 imgs 一對一");
  dj.page.mechanic.banner.urls = ["https://tw.buy.yahoo.com/a", "", "https://evil.example.com/x"];
  assert.throws(() => CM.validateContentModules(dj.page, reg, dj.products), /第 3 張圖的點擊連結/, "站外網域＝擋、講第幾張");
  dj.page.mechanic.banner.urls = ["", "", "", "https://tw.buy.yahoo.com/d"];
  assert.throws(() => CM.validateContentModules(dj.page, reg, dj.products), /最多 3 個/, ">3＝擋");
  dj.page.mechanic.banner.urls = ["https://tw.buy.yahoo.com/a", "https://tw.buy.yahoo.com/b", ""];
  assert.doesNotThrow(() => CM.validateContentModules(dj.page, reg, dj.products));
  delete dj.page.mechanic.banner.urls;
  assert.doesNotThrow(() => CM.validateContentModules(dj.page, reg, dj.products), "舊稿無 urls＝合法");
});

test("搶購鈕文字：空列預設 ctaText 空字串（引擎退「搶購去」）；非字串擋；文字內容不驗（CMS 只提醒字數）", () => {
  const { reg } = buildRegistry();
  const dj = baseDraft();
  CM.applyContentModule(dj, { kind: "mechanic", action: "add" }, reg);
  assert.strictEqual(dj.page.mechanic.rows[0].ctaText, "");
  dj.page.mechanic.rows[0].ctaText = "立即搶購去逛逛超長的字也不擋";
  assert.doesNotThrow(() => CM.validateContentModules(dj.page, reg, dj.products), "字數＝CMS 提醒、不硬擋（使用者裁）");
  dj.page.mechanic.rows[0].ctaText = 123;
  assert.throws(() => CM.validateContentModules(dj.page, reg, dj.products), /搶購鈕文字要是文字/);
});

/* ---------- 2026-09-09 使用者裁：本期活動「欄位跟著排版走」——換排版清不重疊（翻 08-30 同內容換皮制） ---------- */
test("本期活動換排版：圓形→舞台＝清檔期、只留前 3 則；舞台→圓形＝清副標／斜帶字；每項出聲；沒有不重疊內容＝訊息說內容都沒動", () => {
  const { reg } = buildRegistry({ promoVariants: [{ variant_id: "entry-circles", buildSelectable: true }, { variant_id: "spotlight-stage", buildSelectable: true }] });
  const dj = baseDraft();
  const es = promoEntriesFixture();
  while (es.length < 4) { const c = JSON.parse(JSON.stringify(es[0])); c.url = (c.url || "https://tw.buy.yahoo.com/activity/x") + "?dup=" + es.length; c.chip = "第" + (es.length + 1) + "則"; es.push(c); }
  es.forEach((e) => { e.dateValue = "08/01–08/31"; });
  dj.page.promoEntries = es;
  const r1 = CM.applyContentModule(dj, { kind: "promo", action: "set-variant", variant: "spotlight-stage" }, reg);
  assert.strictEqual(dj.page.promoVariant, "spotlight-stage");
  assert.strictEqual(dj.page.promoEntries.length, 3, "舞台只放前 3 則＝第 4 則起清掉");
  assert.ok(dj.page.promoEntries.every((e) => e.dateValue === ""), "舞台不畫檔期＝清掉");
  assert.ok(r1.info.cleared.some((c) => /檔期/.test(c)) && r1.info.cleared.some((c) => /第 4 則入口整則/.test(c)), r1.info.cleared.join("｜"));
  assert.ok(!/內容都沒動/.test(r1.info.summary));
  dj.page.promoSpotSubtitle = "中性潔膚系列"; dj.page.promoSpotDiagonal = "NEW IN";
  const r2 = CM.applyContentModule(dj, { kind: "promo", action: "set-variant", variant: "entry-circles" }, reg);
  assert.ok(!("promoSpotSubtitle" in dj.page) && !("promoSpotDiagonal" in dj.page), "圓形不畫舞台文字＝清掉（刪鍵）");
  assert.deepStrictEqual(r2.info.cleared, ["右欄副標", "大卡斜帶字"]);
  assert.ok(!("promoVariant" in dj.page), "換回預設＝刪鍵");
  const r3 = CM.applyContentModule(dj, { kind: "promo", action: "set-variant", variant: "spotlight-stage" }, reg);
  assert.deepStrictEqual(r3.info.cleared, [], "已無不重疊內容＝零清除");
  assert.ok(/內容都沒動/.test(r3.info.summary));
});
