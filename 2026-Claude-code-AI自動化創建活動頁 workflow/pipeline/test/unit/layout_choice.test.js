"use strict";
/**
 * lib/layout_choice.js 單元測試（51 號 W1-C，2026-08-24；零新相依、hermetic）
 * 與 proposal_pack.test.js 刻意相反：本檔「不」讀 monorepo 活真源——每個測試用 mkdtemp 建最小登記簿
 * fixtures（形狀照抄真檔），值域漂移絆線交給 W1-A 測試守，本檔守的是「邏輯」：
 *   ①附錄 B 映射表　②灰度過濾（預設背景授權門票＋代換與理由行）　③kinRef 六卡折疊與折扣開關
 *   ④new/legacy 逐變體停收（2026-08-24 review 中2：家族「任一 closed＝全停」廢止）
 *   ⑤kvVariant 出貨可選驗證（未知/已停收＝throw；值域真源＝modules.json hero variants＋逐變體 rollout＝review 中1）
 *   ⑥提案包表單驗證（負 fixtures 四組）　⑦版式寫進草稿（失敗必 throw＝review 中3）
 */
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const L = require("../../lib/layout_choice");

/* ---------- hermetic fixtures：最小登記簿組（tweak 可覆寫任意檔內容） ---------- */
function layoutRec(id, over = {}) {
  return {
    id, thumbnail: `design-assets/layouts/thumbs/${id}.png`, name: `版式${id.slice(-3)}`,
    skeleton: "左右商品・中間標題", skin: "測試皮膚", useWhen: ["促銷"],
    defaultBackground: "bg-005", backgroundPool: [], kinRef: null,
    slots: [{ key: "discount-digit", label: "折扣數字槽＝關", state: "off" }],
    ...over,
  };
}
function buildFixtures(tweak = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "layout-choice-fixture-"));
  const files = {
    modules: {
      modules: [{ module_id: "hero", variants: [
        { variant_id: "new" }, { variant_id: "legacy" },
        ...["001", "002", "003", "004", "005", "006", "007", "008", "009", "010"].map((n) => ({ variant_id: `layout-${n}`, rollout: "trial" })),
      ] }],
    },
    layouts: { assets: [
      layoutRec("layout-001", { defaultBackground: "bg-001", useWhen: ["聯名"] }),                       // C 級預設背景（灰度未過票）
      layoutRec("layout-002", { defaultBackground: "bg-008", useWhen: ["聯名"], kinRef: { promo: "layout-003" } }),
      layoutRec("layout-003", { defaultBackground: "bg-008", useWhen: ["聯名", "促銷"], kinRef: { base: "layout-002" }, slots: [{ key: "discount-digit", label: "開", state: "on" }] }),
      layoutRec("layout-004", { defaultBackground: "bg-001", useWhen: ["攻略"] }),
      layoutRec("layout-005", { defaultBackground: "bg-009", useWhen: ["攻略"] }),
      layoutRec("layout-006", { defaultBackground: "bg-005", useWhen: ["新品"], kinRef: { promo: "layout-007" }, thumbnail: null, slots: [{ key: "title-center", label: "中央標題組" }, { key: "item-ring", label: "品項環列" }, { key: "time-band", label: "關", state: "off" }, { key: "discount-digit", label: "關", state: "off" }] }), // 縮圖缺＝thumbFile null（佔位不擋）；slots＝真簿形（骨架預填測試用）
      layoutRec("layout-007", { defaultBackground: "bg-005", useWhen: ["促銷"], kinRef: { base: "layout-006" }, slots: [{ key: "discount-digit", label: "開", state: "on" }] }),
      layoutRec("layout-008", { defaultBackground: "bg-017", skin: "引言色塊", useWhen: ["話題單品"], kinRef: { promo: "layout-009" } }),
      layoutRec("layout-009", { defaultBackground: "bg-018", skin: "灰棚促銷", useWhen: ["促銷"], kinRef: { base: "layout-008" }, slots: [{ key: "discount-digit", label: "開", state: "on" }] }),
      layoutRec("layout-010", { defaultBackground: "bg-009", skin: "斜紋白棚", useWhen: ["話題單品", "新品"] }), // 2026-09-14：新品熱銷的新預設（006 為條件式）
    ] },
    backgrounds: { assets: [
      { id: "bg-001", license: "C" },
      { id: "bg-005", license: "A" },
      { id: "bg-008", license: "B", reviewDate: "2026-08-24", qaStatus: "pass" },
      { id: "bg-009", license: "B", reviewDate: "2026-08-24", qaStatus: "pass" },
      { id: "bg-017", license: "B", reviewDate: "2026-08-24", qaStatus: "pass-with-note" },
      { id: "bg-018", license: "B", reviewDate: "2026-08-24", qaStatus: "pass" },
      { id: "bg-020", license: "B" }, // B 未複查＝未過票
      { id: "bg-021", license: "B", reviewDate: "2026-08-24", qaStatus: "conditional" }, // 複查但 conditional＝不得任預設
    ] },
    fonts: { assets: [{ id: "font-001" }] },
    motion: { assets: [{ id: "motion-001" }] },
    tokens: { themes: [{ slug: "green-light" }, { slug: "blue-dark", rejected: true }] },
    ...tweak,
  };
  const P = {};
  for (const [k, v] of Object.entries(files)) {
    P[k] = path.join(dir, k + ".json");
    fs.writeFileSync(P[k], JSON.stringify(v));
  }
  return P;
}
/* depsWith 預設把「完工名單」全開＝隔離變因（映射/門票/折疊等既有語意測試不受滾動上架制干擾）；
   滾動上架制專屬測試自行縮 deps.engineReady。 */
const ALL_READY = ["new", "legacy", ...["001","002","003","004","005","006","007","008","009","010"].map((n) => `layout-${n}`)];
const depsWith = (tweak, ready) => { const d = L.loadLayoutDeps(buildFixtures(tweak)); d.engineReady = new Set(ready || ALL_READY); return d; };

/* ---------- ①灰度門票判定 ---------- */
test("backgroundEligible：A 過票；B 要複查＋qaStatus pass 系；C／B 未複查／conditional 全擋", () => {
  assert.ok(L.backgroundEligible({ license: "A" }));
  assert.ok(L.backgroundEligible({ license: "B", reviewDate: "2026-08-24", qaStatus: "pass" }));
  assert.ok(L.backgroundEligible({ license: "B", reviewDate: "2026-08-24", qaStatus: "pass-with-note" }));
  assert.ok(!L.backgroundEligible({ license: "B" }), "B 未複查不得過票");
  assert.ok(!L.backgroundEligible({ license: "B", reviewDate: "2026-08-24", qaStatus: "conditional" }), "conditional＝池內保留不得任預設");
  assert.ok(!L.backgroundEligible({ license: "C" }));
  assert.ok(!L.backgroundEligible(null));
});

/* ---------- ②附錄 B 映射（C3c） ---------- */
test("suggestLayout：附錄 B 六列全數照表（fixture 五目標皆過票＝零代換）", () => {
  const deps = depsWith();
  const rows = [
    ["同品類×跨品牌-優惠銷售", "layout-003"], // 2026-09-14 使用者更正：007 多品環列促銷版＝流行品類／去背圖＝條件式，改配攝影棚促銷
    ["單一品牌-優惠/曝光", "layout-002"],
    ["同品類-情境×優惠", "layout-005"],
    ["同品類-新品/熱銷曝光", "layout-010"], // 2026-09-14：006 新品＝條件式，改配唯一另一款標「新品」的雜誌封面
    ["時事主題-情境×選品", "layout-005"], // 2026-09-14 使用者裁 Q1 乙：原 008（條件式：去背模特兒圖）→ 005 攻略・銀棚
    ["", "layout-005"], // 2026-09-14：先不指定＝最保守的攻略・銀棚
  ];
  for (const [scenario, expect] of rows) {
    const r = L.suggestLayout(scenario, deps);
    assert.strictEqual(r.layout, expect, `情境「${scenario}」映射錯`);
    assert.strictEqual(r.substitutedFrom, null);
    assert.match(r.reason, /51 號附錄 B/, "理由行必附出處");
  }
});

test("條件式版式不當自動配預設（2026-09-14）：autoPick=false 的映射目標→換同標籤無條件款；同標籤沒得換＝走既有代換鏈；理由句講得出要什麼圖", () => {
  const deps = depsWith();
  deps.registries.layoutRecords.get("layout-005").contentFit = { autoPick: false, short: "要放去背的模特兒展示圖", asset: "模特兒圖", say: "測試句" };
  /* 同標籤「攻略」只剩 004，但 004 預設背景 C 級未過票＝同標籤沒得換→走 006/007 鏈 */
  const r = L.suggestLayout("時事主題-情境×選品", deps);
  assert.strictEqual(r.substitutedFrom, "layout-005");
  assert.strictEqual(r.layout, "layout-006");
  assert.match(r.reason, /條件式版式/);
  assert.match(r.reasonDisplay, /要放去背的模特兒展示圖/); assert.match(r.reasonDisplay, /真的有模特兒圖，到編修頁換回來/);
  /* 004 背景改過票＝同標籤有得換→換 004、不掉到 006 */
  deps.registries.layoutRecords.get("layout-004").defaultBackground = "bg-009";
  const r2 = L.suggestLayout("時事主題-情境×選品", deps);
  assert.strictEqual(r2.layout, "layout-004"); assert.strictEqual(r2.substitutedFrom, "layout-005");
  assert.match(r2.reasonDisplay, /先配「版式004」版面/);
  /* 沒標條件的映射目標＝行為不變 */
  const r3 = L.suggestLayout("同品類-新品/熱銷曝光", deps);
  assert.strictEqual(r3.layout, "layout-010"); assert.strictEqual(r3.substitutedFrom, null);
  /* 真簿情境：偏好對 006/007 本身是條件式＝代換鏈不能再落到它們，改掃同促銷意圖的無條件款（001 C／004 C 皆未過票→005） */
  const deps2 = depsWith();
  deps2.registries.layoutRecords.get("layout-006").contentFit = { autoPick: false, short: "要放去背圖" };
  deps2.registries.layoutRecords.get("layout-007").contentFit = { autoPick: false, short: "要放去背圖" };
  deps2.registries.layoutRecords.get("layout-002").defaultBackground = "bg-001"; // 聯名目標未過票→走代換鏈
  const r4 = L.suggestLayout("單一品牌-優惠/曝光", deps2);
  assert.strictEqual(r4.layout, "layout-005", "代換鏈落到條件式的 006/007＝把流行品類版型塞給非流行活動");
  assert.strictEqual(r4.substitutedFrom, "layout-002");
  /* 促銷目標（003）是促銷版親戚：同標籤代換允許換到別款促銷版（009） */
  const deps3 = depsWith();
  deps3.registries.layoutRecords.get("layout-003").contentFit = { autoPick: false, short: "測試" };
  deps3.registries.layoutRecords.get("layout-007").contentFit = { autoPick: false, short: "測試" };
  const r5 = L.suggestLayout("同品類×跨品牌-優惠銷售", deps3);
  assert.strictEqual(r5.layout, "layout-009", "促銷目標條件式＝可換到別款促銷版親戚"); assert.strictEqual(r5.substitutedFrom, "layout-003");
  /* 卡目錄與索引都帶 contentFit（畫面兩處要講同一句） */
  const cat = L.catalogForForm(deps);
  assert.strictEqual(cat.layoutIndex["layout-005"].contentFit.autoPick, false);
  assert.strictEqual(cat.cards.find((c) => c.id === "layout-005").contentFit.say, "測試句");
  assert.strictEqual(cat.cards.find((c) => c.id === "layout-006").contentFit, null);
});

test("主題字優先（2026-09-14 乙）：主題含登記簿 themeKeywords＝配那款；命中款條件式／未過票＝不採、退回對照表並在履歷講；沒主題＝行為不變", () => {
  const deps = depsWith();
  deps.registries.layoutRecords.get("layout-005").themeKeywords = ["中秋", "月餅"];
  deps.registries.layoutRecords.get("layout-004").themeKeywords = ["夜市"]; // 004 預設背景 C 級未過票
  const r = L.suggestLayout("同品類-新品/熱銷曝光", deps, "中秋烤肉大會");
  assert.strictEqual(r.layout, "layout-005"); assert.strictEqual(r.byTheme, "中秋"); assert.strictEqual(r.substitutedFrom, null);
  assert.match(r.reasonDisplay, /你的主題有「中秋」，所以配上「版式005」版面/);
  assert.match(r.reason, /themeKeywords/);
  /* 命中但未過票＝不採、照對照表（新品→010），履歷講為什麼沒採 */
  const r2 = L.suggestLayout("同品類-新品/熱銷曝光", deps, "夜市美食大集合");
  assert.strictEqual(r2.layout, "layout-010"); assert.ok(!r2.byTheme);
  assert.match(r2.reason, /主題字「夜市」對到「版式004」.*預設背景未過門票＝未採/);
  /* 命中但條件式＝不採（內容條件不因主題字破例） */
  deps.registries.layoutRecords.get("layout-005").contentFit = { autoPick: false, short: "測試" };
  const r3 = L.suggestLayout("同品類-新品/熱銷曝光", deps, "中秋");
  assert.strictEqual(r3.layout, "layout-010"); assert.match(r3.reason, /條件式版式（不因主題字破例）＝未採/);
  /* 沒主題／主題沒命中＝照舊 */
  assert.strictEqual(L.suggestLayout("同品類-新品/熱銷曝光", deps).layout, "layout-010");
  assert.strictEqual(L.suggestLayout("同品類-新品/熱銷曝光", deps, "父親節").layout, "layout-010");
  /* resolveLayoutChoice 把主題交過去、履歷帶 byTheme */
  const deps4 = depsWith(); deps4.registries.layoutRecords.get("layout-005").themeKeywords = ["中秋"];
  const rc = L.resolveLayoutChoice({ kvVariant: "ai", scenario: "同品類-新品/熱銷曝光", theme: "中秋團圓" }, deps4);
  assert.strictEqual(rc.kvVariant, "layout-005"); assert.strictEqual(rc.choice.byTheme, "中秋");
});

test("suggestLayout：舊情境值「0N 」前綴相容剝除", () => {
  const r = L.suggestLayout("02 單一品牌-優惠/曝光", depsWith());
  assert.strictEqual(r.layout, "layout-002");
});

test("suggestLayout：映射不到＝throw（C3d 退回手選＋出聲）", () => {
  assert.throws(() => L.suggestLayout("亂寫的情境", depsWith()), /不在情境對應表/); // 白話先講、技術收括號（2026-08-25 文案裁決）
});

/* ---------- ③灰度過濾與代換 ---------- */
test("灰度代換：映射目標預設背景未過票＝代換 layout-006、理由行明講授權與代換", () => {
  // 002 的預設背景改成 C 級 → 聯名情境代換到 006（非促銷意圖優先 006）
  const deps = depsWith();
  deps.registries.layoutRecords.get("layout-002").defaultBackground = "bg-001";
  const r = L.suggestLayout("單一品牌-優惠/曝光", deps);
  assert.strictEqual(r.layout, "layout-006");
  assert.strictEqual(r.substitutedFrom, "layout-002");
  assert.match(r.reason, /授權/);
  assert.match(r.reason, /代換/);
  assert.match(r.reason, /license C/);
});

test("灰度代換：B 未複查同樣未過票（license B・未複查 要講明）", () => {
  const deps = depsWith();
  deps.registries.layoutRecords.get("layout-005").defaultBackground = "bg-020"; // 時事主題 2026-09-14 起映射 005（原 008）
  const r = L.suggestLayout("時事主題-情境×選品", deps);
  assert.strictEqual(r.layout, "layout-006");
  assert.match(r.reason, /license B・未複查/);
});

test("灰度代換：促銷意圖目標未過票＝自身除外後仍找得到可上線候選；全滅＝throw", () => {
  // 003 的預設背景改 C → 促銷情境：偏好對 [007, 006]，007 過票且促銷意圖優先＝代換 007（fixture 裡 006/007 無條件式標記）
  const deps = depsWith();
  deps.registries.layoutRecords.get("layout-003").defaultBackground = "bg-001";
  const r = L.suggestLayout("同品類×跨品牌-優惠銷售", deps);
  assert.strictEqual(r.layout, "layout-007"); assert.strictEqual(r.substitutedFrom, "layout-003");
  // 007、006 也弄死 → 偏好對全滅且非條件式＝不掃全簿＝throw 出聲（舊語意保留）
  deps.registries.layoutRecords.get("layout-007").defaultBackground = "bg-001";
  deps.registries.layoutRecords.get("layout-006").defaultBackground = "bg-001";
  assert.throws(() => L.suggestLayout("同品類×跨品牌-優惠銷售", deps), /沒有可以上線的版面組合/);
});

test("suggestLayout：背景貨號不在背景登記簿＝資料缺 throw（不裝乾淨）", () => {
  const deps = depsWith();
  deps.registries.layoutRecords.get("layout-005").defaultBackground = "bg-999";
  assert.throws(() => L.suggestLayout("同品類-情境×優惠", deps), /不在背景登記簿/);
});

/* ---------- ④resolveLayoutChoice（C1/C4 值域＋by 判定） ---------- */
test("resolveLayoutChoice：ai＝走映射；已解鎖版式（006）無引擎告示、未完工版式帶告示（C3d 誠實條款＝逐款解鎖）", () => {
  const r = L.resolveLayoutChoice({ kvVariant: "ai", scenario: "同品類-新品/熱銷曝光" }, depsWith());
  assert.strictEqual(r.kvVariant, "layout-010"); // 2026-09-14：新品熱銷→雜誌封面（006 為條件式）
  assert.strictEqual(r.choice.by, "ai");
  assert.strictEqual(r.choice.engineNote, null, "010 在完工名單＝告示消失");
  const r8 = L.resolveLayoutChoice({ kvVariant: "ai", scenario: "時事主題-情境×選品" }, depsWith());
  assert.strictEqual(r8.kvVariant, "layout-005"); // 2026-09-14 使用者裁 Q1 乙：時事主題→攻略・銀棚（008 為條件式版式）
  assert.strictEqual(r8.choice.engineNote, null, "九款全席（2026-08-25 收官）＝映射目標全無告示；未完工告示語意由 engineNoteFor 假貨號測試守");
});

test("resolveLayoutChoice：手選裸值＝by manual；new/legacy＝現行版型且無引擎提示", () => {
  const deps = depsWith();
  const m = L.resolveLayoutChoice({ kvVariant: "layout-004" }, deps);
  assert.strictEqual(m.choice.by, "manual");
  assert.match(m.choice.reason, /手選版式/);
  const n = L.resolveLayoutChoice({ kvVariant: "new" }, deps);
  assert.strictEqual(n.kvVariant, "new");
  assert.strictEqual(n.choice.engineNote, null, "現行版型＝引擎本來就支援，不得掛建置中提示");
});

test("resolveLayoutChoice：kv- 舊拼法正規化後照裸值走", () => {
  assert.strictEqual(L.resolveLayoutChoice({ kvVariant: "kv-new" }, depsWith()).kvVariant, "new");
});

test("resolveLayoutChoice：提案包同值未偏離＝by pack；偏離＝by manual", () => {
  const deps = depsWith();
  const pack = { version: 1, layout: "layout-002" };
  assert.strictEqual(L.resolveLayoutChoice({ kvVariant: "layout-002", proposalPack: pack }, deps).choice.by, "pack");
  assert.strictEqual(L.resolveLayoutChoice({ kvVariant: "layout-002", proposalPack: pack, packDeviated: true }, deps).choice.by, "manual");
  assert.strictEqual(L.resolveLayoutChoice({ kvVariant: "layout-005", proposalPack: pack }, deps).choice.by, "manual", "值與包不同＝手選");
});

test("resolveLayoutChoice：未知貨號＝throw 出聲（C4 前端回 AI 代選的觸發源）", () => {
  assert.throws(() => L.resolveLayoutChoice({ kvVariant: "layout-999" }, depsWith()), /系統不認得/);
});

/* 逐變體制＝與 CP-25 閘同套；家族「任一 closed＝全停」語意廢止 2026-08-24 review（中2） */
function modulesWithRollout(rolloutByVid = {}) {
  const vids = ["new", "legacy", ...["001", "002", "003", "004", "005", "006", "007", "008", "009"].map((n) => `layout-${n}`)];
  return { modules: [{ module_id: "hero", variants: vids.map((vid) => ({
    variant_id: vid,
    ...(vid in rolloutByVid ? (rolloutByVid[vid] == null ? {} : { rollout: rolloutByVid[vid] }) : (/^layout-/.test(vid) ? { rollout: "trial" } : {})),
  })) }] };
}

test("現行版型逐變體判定：new closed＝第七張卡消失＋值 400；legacy 不受牽連（反之亦然）", () => {
  const newClosed = depsWith({ modules: modulesWithRollout({ new: "closed" }) });
  assert.throws(() => L.resolveLayoutChoice({ kvVariant: "new" }, newClosed), /暫停接新活動/);
  assert.strictEqual(L.catalogForForm(newClosed).legacy.open, false, "new closed＝第七張卡消失（卡值＝new）");
  assert.strictEqual(L.resolveLayoutChoice({ kvVariant: "legacy" }, newClosed).kvVariant, "legacy", "legacy 自己沒停＝照收，不受 new 牽連");
  const legacyClosed = depsWith({ modules: modulesWithRollout({ legacy: "closed" }) });
  assert.throws(() => L.resolveLayoutChoice({ kvVariant: "legacy" }, legacyClosed), /暫停接新活動/);
  assert.strictEqual(L.resolveLayoutChoice({ kvVariant: "new" }, legacyClosed).kvVariant, "new", "new 自己沒停＝照收，不受 legacy 牽連");
  assert.strictEqual(L.catalogForForm(legacyClosed).legacy.open, true, "第七張卡看 new 自己的 rollout——legacy closed 不收卡");
  const bothClosed = depsWith({ modules: modulesWithRollout({ new: "closed", legacy: "closed" }) });
  assert.throws(() => L.resolveLayoutChoice({ kvVariant: "new" }, bothClosed), /暫停接新活動/);
  assert.throws(() => L.resolveLayoutChoice({ kvVariant: "legacy" }, bothClosed), /暫停接新活動/);
  assert.strictEqual(L.catalogForForm(bothClosed).legacy.open, false);
  const open = depsWith(); // 旗標缺席＝視為開放
  assert.strictEqual(L.catalogForForm(open).legacy.open, true);
  assert.strictEqual(L.resolveLayoutChoice({ kvVariant: "legacy" }, open).kvVariant, "legacy");
});

/* ---------- 出貨可選判定（2026-08-24 review 中1：值域真源＝modules.json hero variants＋逐變體 rollout） ---------- */
test("layout-* 停收（rollout closed）：卡不出現、resolve 400 出聲、AI 代選永不回它（代換鏈照常）", () => {
  // layout-005＝映射目標（同品類-情境×優惠）標 closed
  const deps = depsWith({ modules: modulesWithRollout({ "layout-005": "closed" }) });
  assert.ok(!L.catalogForForm(deps).cards.some((c) => c.id === "layout-005"), "停收＝卡不出現");
  assert.throws(() => L.resolveLayoutChoice({ kvVariant: "layout-005" }, deps), /暫停使用/, "手選停收值＝throw（伺服器回 400）");
  const r = L.suggestLayout("同品類-情境×優惠", deps); // 代換鏈照常：目標停收＝換到可上線的 006
  assert.strictEqual(r.layout, "layout-006");
  assert.strictEqual(r.substitutedFrom, "layout-005");
  assert.match(r.reason, /已停收/, "理由行明講是停收（不是授權）");
});

test("layout-* 只在設計側目錄、不在 modules.json 出貨值域＝同樣停收（值域不吃 layouts manifest）", () => {
  // modules variants 拿掉 layout-004（設計側 layouts manifest 仍有它）
  const m = modulesWithRollout();
  m.modules[0].variants = m.modules[0].variants.filter((v) => v.variant_id !== "layout-004");
  const deps = depsWith({ modules: m });
  assert.ok(!L.catalogForForm(deps).cards.some((c) => c.id === "layout-004"), "不在出貨值域＝卡不出現");
  assert.throws(() => L.resolveLayoutChoice({ kvVariant: "layout-004" }, deps), /暫停使用/);
});

test("促銷親戚停收（rollout closed）＝本尊卡折扣開關 disabled＋理由；AI 代換候選也跳過停收者", () => {
  const deps = depsWith({ modules: modulesWithRollout({ "layout-003": "closed" }) });
  const c2 = L.catalogForForm(deps).cards.find((c) => c.id === "layout-002");
  assert.strictEqual(c2.promo.available, false);
  assert.match(c2.promo.unavailableReason, /促銷版暫時停用/);
  // 促銷情境的映射目標 007 標 closed → 候選鏈跳過停收的 007？（007 本身是目標）：改驗 006 停收時聯名代換直落 007
  const deps2 = depsWith({ modules: modulesWithRollout({ "layout-006": "closed" }) });
  deps2.registries.layoutRecords.get("layout-002").defaultBackground = "bg-001"; // 002 未過票→代換；006 停收＝跳過→007
  const r = L.suggestLayout("單一品牌-優惠/曝光", deps2);
  assert.strictEqual(r.layout, "layout-007", "代換候選自身停收＝丟下一個");
});

/* ---------- ⑤表單卡目錄（C1 折疊制） ---------- */
test("catalogForForm：十貨號折疊成七卡（fixture 2026-09-14 補 010）；促銷親戚掛開關；008 特例帶切換預告", () => {
  const cat = L.catalogForForm(depsWith());
  assert.deepStrictEqual(cat.cards.map((c) => c.id), ["layout-001", "layout-002", "layout-004", "layout-005", "layout-006", "layout-008", "layout-010"]);
  const c2 = cat.cards.find((c) => c.id === "layout-002");
  assert.strictEqual(c2.promo.id, "layout-003");
  assert.strictEqual(c2.promo.available, true);
  assert.strictEqual(c2.promo.switchNote, null, "同皮膚同預設背景＝不出特例預告");
  const c8 = cat.cards.find((c) => c.id === "layout-008");
  assert.match(c8.promo.switchNote, /背景與風格會一起換/, "008↔009 皮膚與預設背景不同＝要預告（51 §2.14）");
  assert.strictEqual(cat.cards.find((c) => c.id === "layout-001").promo, null);
  assert.strictEqual(c2.thumbFile, "layout-002.png");
  assert.strictEqual(cat.cards.find((c) => c.id === "layout-006").thumbFile, null, "無縮圖＝null（前端佔位不擋）");
  assert.strictEqual(c2.rollout, "trial");
  assert.strictEqual(cat.cards.find((c) => c.id === "layout-001").grayTicket, false, "C 級預設背景＝未過灰度門票");
  assert.strictEqual(cat.cards.find((c) => c.id === "layout-006").grayTicket, true);
  assert.match(cat.engineNote, /陸續完成中/);
});

test("catalogForForm：kinRef 對換目標不在出貨值域＝開關 disabled＋理由（51 §2.7）", () => {
  const noPromoModules = {
    modules: [{ module_id: "hero", variants: [
      { variant_id: "new" }, { variant_id: "legacy" },
      ...["001", "002", "004", "005", "006", "007", "008", "009"].map((n) => ({ variant_id: `layout-${n}` })), // 003 不在值域
    ] }],
  };
  const cat = L.catalogForForm(depsWith({ modules: noPromoModules }));
  const c2 = cat.cards.find((c) => c.id === "layout-002");
  assert.strictEqual(c2.promo.available, false);
  assert.match(c2.promo.unavailableReason, /不在出貨值域/);
});

/* ---------- ⑥提案包表單驗證（C2 負 fixtures 四組＋選卡對應） ---------- */
test("parsePackForForm：促銷貨號＝本尊卡＋折扣開關開；本尊貨號＝開關關", () => {
  const deps = depsWith();
  const promo = L.parsePackForForm(JSON.stringify({ version: 1, layout: "layout-007" }), deps);
  assert.strictEqual(promo.ok, true);
  assert.strictEqual(promo.cardBase, "layout-006");
  assert.strictEqual(promo.discountOn, true);
  const base = L.parsePackForForm(JSON.stringify({ version: 1, layout: "layout-005", theme: "green-light" }), deps);
  assert.strictEqual(base.cardBase, "layout-005");
  assert.strictEqual(base.discountOn, false);
});

test("parsePackForForm：C2 負 fixtures 四組全出聲不靜默", () => {
  const deps = depsWith();
  const missVer = L.parsePackForForm(JSON.stringify({ layout: "layout-006" }), deps); // ①缺 version
  assert.strictEqual(missVer.ok, false);
  assert.ok(missVer.errors.some((e) => e.includes("缺 version")));
  const badId = L.parsePackForForm(JSON.stringify({ version: 1, layout: "layout-999", background: "bg-999" }), deps); // ②未知貨號
  assert.strictEqual(badId.ok, false);
  assert.ok(badId.errors.some((e) => e.includes("kvVariant=") || e.includes("系統不認得") || e.includes("未知")));
  assert.ok(badId.errors.some((e) => e.includes("未知背景貨號")));
  const yellow = L.parsePackForForm(JSON.stringify({ version: 1, layout: "layout-006", qaStatus: "draft" }), deps); // ③qaStatus 非綠＝黃燈帶入
  assert.strictEqual(yellow.ok, true);
  assert.strictEqual(yellow.warnings.length, 1);
  assert.match(yellow.warnings[0], /黃燈/);
  const badJson = L.parsePackForForm("{壞 JSON", deps); // ④壞 JSON
  assert.strictEqual(badJson.ok, false);
  assert.match(badJson.errors[0], /不是合法 JSON/);
});

/* ---------- 真源缺席＝throw（鐵律 3） ---------- */
test("loadLayoutDeps：登記簿路徑錯＝throw 出聲不靜默降級", () => {
  const P = buildFixtures();
  assert.throws(() => L.loadLayoutDeps({ ...P, backgrounds: "/tmp/不存在的背景簿.json" }), /登記簿讀取失敗/);
});

/* ---------- 版式寫進草稿（2026-08-24 review 中3：寫入失敗必 throw，呼叫端出聲＝不准畫面稱成功） ---------- */
test("writeLayoutChoiceIntoDraft：正常路徑寫入 page.kvVariant＋meta.layoutChoice＋meta.proposalPack", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "layout-write-"));
  const dPath = path.join(dir, "draft.json");
  fs.writeFileSync(dPath, JSON.stringify({ page: { pageName: "測試頁" }, products: [] }));
  const input = {
    kvVariant: "layout-006",
    layoutChoice: { by: "ai", reason: "測試理由", engineNote: "建置中", decidedAt: "2026-08-24T00:00:00.000Z" },
    proposalPack: { version: 1, layout: "layout-006" },
    packWarnings: ["黃燈"],
    packDeviated: false,
  };
  L.writeLayoutChoiceIntoDraft(dPath, input);
  const dj = JSON.parse(fs.readFileSync(dPath, "utf8"));
  assert.strictEqual(dj.page.kvVariant, "layout-006");
  assert.strictEqual(dj.page.pageName, "測試頁", "原有欄位不得被洗掉");
  assert.deepStrictEqual(dj.meta.layoutChoice, input.layoutChoice);
  assert.deepStrictEqual(dj.meta.proposalPack, { pack: input.proposalPack, warnings: ["黃燈"], deviated: false });
});

test("writeLayoutChoiceIntoDraft：壞路徑（草稿檔不存在）＝throw 出聲——server 據此記 meta.layoutChoiceWriteError", () => {
  const input = { kvVariant: "layout-006", layoutChoice: { by: "manual", reason: "r" } };
  assert.throws(() => L.writeLayoutChoiceIntoDraft("/tmp/不存在的資料夾/draft.json", input), /版式選擇寫進草稿失敗/);
  assert.throws(() => L.writeLayoutChoiceIntoDraft("/tmp/x.json", { kvVariant: "", layoutChoice: null }), /呼叫端契約錯誤/, "缺 kvVariant/layoutChoice＝一樣出聲");
});

/* ---------- 骨架預填（2026-08-24 W1-B 切片二：旅程③「系統照版式做出草稿」） ---------- */
test("writeLayoutChoiceIntoDraft：layout-* 且 hero 缺席＝照登記簿槽位預填（文字槽=活動名、商品槽=池前 N 件 gdid）；已有 hero＝不覆蓋", () => {
  const P = buildFixtures();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "layout-prefill-"));
  const dPath = path.join(dir, "draft.json");
  const prods = [{ gdid: 111, name: "甲" }, { gdid: 222, name: "乙" }, { gdid: 333, name: "丙" }, { gdid: 444, name: "丁" }, { gdid: 555, name: "戊" }];
  fs.writeFileSync(dPath, JSON.stringify({ page: { pageName: "新品活動" }, products: prods }));
  const input = { kvVariant: "layout-006", layoutChoice: { by: "ai", reason: "r" } };
  L.writeLayoutChoiceIntoDraft(dPath, input, P);
  const dj = JSON.parse(fs.readFileSync(dPath, "utf8"));
  assert.strictEqual(dj.page.hero["title-center"], "新品活動", "文字槽＝活動名");
  assert.deepStrictEqual(dj.page.hero["item-ring"], { gdids: ["111", "222", "333", "444"] }, "環列槽＝池前 4 件 gdid 引用");
  assert.ok(!("time-band" in dj.page.hero) && !("discount-digit" in dj.page.hero), "state:off 與真值槽不預填");
  assert.match(dj.meta.layoutChoice.heroPrefill, /骨架預填 \d+ 槽/);
  // 已有 hero＝不覆蓋（編修內容不得被建立重試洗掉）
  const keep = { "title-center": "使用者改過的標題" };
  fs.writeFileSync(dPath, JSON.stringify({ page: { pageName: "新品活動", hero: keep }, products: prods }));
  L.writeLayoutChoiceIntoDraft(dPath, { kvVariant: "layout-006", layoutChoice: { by: "manual", reason: "r2" } }, P);
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(dPath, "utf8")).page.hero, keep);
});

test("engineNoteFor：layout-006 已解鎖＝無告示；未完工版式＝告示措辭不得再稱「以現行版型呈現」", () => {
  assert.strictEqual(L.engineNoteFor("layout-006"), null, "006 真樣式已上線＝banner 消失");
  const note = L.engineNoteFor("layout-999"); // 永不完工樣本（滾動上架制：勿用真貨號＝完工日測試紅）
  assert.ok(note && !/現行版型呈現/.test(note), "告示與預覽實況一致（預覽＝新版式骨架，非現行版型）");
});

/* ---------- CMS 顯示文案絆線（2026-08-25 使用者裁決：UX writing 對一般用戶、禁工程/內部治理詞彙） ----------
   守的欄位＝reasonDisplay／engineNote／switchNote／unavailableReason／throw 訊息的「白話段」（括號技術尾註不管）。 */
test("顯示層文案：reasonDisplay/engineNote/switchNote 白話段禁貨號・文件編號・治理行話", () => {
  /* 2026-09-11 文案牆第 4 題甲案加入 AI：版式自動配的實體是 SCENARIO_LAYOUT_MAP 五筆固定對照（零 AI 呼叫），
     顯示欄不得自稱 AI——同事沒有 AI 的電腦上照樣跑得動，講成 AI 會讓人誤以為自己有。
     機器履歷欄 reason 不在此列（存 meta 供追溯、不上畫面，內部仍叫「AI 代選」＝資料值 by:"ai" 的名字）。 */
  const BAN = /(layout-\d{3}|\d+\s*號|§|modules\.json|rollout|映射表|灰度|值域|manifest|AI)/;
  const stripTech = (t) => String(t || "").replace(/（技術：[^）]*）/g, "");
  const deps = depsWith();
  const displays = [];
  for (const [scenario] of Object.entries(L.SCENARIO_LAYOUT_MAP)) {
    const s = L.suggestLayout(scenario, deps);
    displays.push(s.reasonDisplay);
  }
  const depsSub = depsWith();
  depsSub.registries.layoutRecords.get("layout-002").defaultBackground = "bg-001";
  displays.push(L.suggestLayout("單一品牌-優惠/曝光", depsSub).reasonDisplay); // 代換路徑
  displays.push(L.resolveLayoutChoice({ kvVariant: "layout-005" }, deps).choice.reasonDisplay); // 手選
  displays.push(L.resolveLayoutChoice({ kvVariant: "new" }, deps).choice.reasonDisplay); // 現行版型
  displays.push(L.ENGINE_NOTE_BUILDING);
  const cat = L.catalogForForm(deps);
  const c8 = cat.cards.find((c) => c.id === "layout-008");
  if (c8 && c8.promo && c8.promo.switchNote) displays.push(c8.promo.switchNote);
  for (const d of displays) {
    assert.ok(d && d.length > 5, "顯示欄不得為空");
    assert.doesNotMatch(stripTech(d), BAN, `顯示文案含工程詞彙：「${d}」`);
  }
  /* throw 訊息＝白話段（技術括號前）也要乾淨 */
  for (const fn of [
    () => L.suggestLayout("亂寫的情境", deps),
    () => L.resolveLayoutChoice({ kvVariant: "layout-999" }, deps),
  ]) {
    try { fn(); assert.fail("應該要 throw"); }
    catch (e) { assert.doesNotMatch(stripTech(e.message), BAN, `錯誤白話段含工程詞彙：「${e.message}」`); }
  }
});


/* ---------- 完工才上架（2026-08-25 使用者裁決＝滾動上架制） ---------- */
test("滾動上架：未完工版式＝卡不出現、手選被擋、AI 代選代換到完工款——完工一款自動解鎖", () => {
  const ready = ["new", "legacy", "layout-006"]; // 現實名單形
  const deps = depsWith(undefined, ready);
  const cat = L.catalogForForm(deps);
  assert.deepStrictEqual(cat.cards.map((c) => c.id), ["layout-006"], "只出完工卡");
  assert.strictEqual(cat.cards[0].promo, null, "促銷親戚（007）未完工＝折扣開關整個不出現（不印不可用）");
  assert.throws(() => L.resolveLayoutChoice({ kvVariant: "layout-002" }, deps), /還在製作中/, "直傳未完工值＝白話擋");
  const r = L.resolveLayoutChoice({ kvVariant: "ai", scenario: "單一品牌-優惠/曝光" }, deps); // 聯名→002 未完工
  assert.strictEqual(r.kvVariant, "layout-006", "AI 代換到完工款");
  assert.match(r.choice.reason, /未完工/, "機器履歷講明代換原因");
  assert.match(r.choice.reasonDisplay, /暫時還不能上線/, "顯示版人話");
  // 完工一款＝解鎖一款
  deps.engineReady.add("layout-002");
  assert.ok(L.catalogForForm(deps).cards.some((c) => c.id === "layout-002"), "002 完工＝卡自動出現");
  assert.strictEqual(L.resolveLayoutChoice({ kvVariant: "layout-002" }, deps).kvVariant, "layout-002");
});

/* ---------- parsePackForForm 顯示名（2026-09-04 使用者過目：帶入結果不印貨號） ---------- */
test("parsePackForForm：回 names（背景／主題／字風＝登記簿名稱；查不到＝null 不印）", () => {
  const L = require("../../lib/layout_choice");
  const deps = L.loadLayoutDeps();
  const r = L.parsePackForForm(JSON.stringify({ version: 1, layout: "layout-009", background: "bg-018", theme: "green-light", titleStyle: "css-n3", font: "font-001", motion: "static" }), deps);
  assert.equal(r.ok, true, (r.errors || []).join("|"));
  assert.equal(r.names.background, "右置舞台・直線V形光");
  assert.equal(r.names.theme, "悠然綠 淺");
  assert.ok(r.names.titleStyle && r.names.titleStyle.includes("透視霓虹"));
  assert.equal(r.names.motion, null, "static＝沒選＝不印");
  const r2 = L.parsePackForForm(JSON.stringify({ version: 1, layout: "layout-009" }), deps);
  assert.deepEqual(r2.names, { background: null, theme: null, font: null, motion: null, titleStyle: null });
});

/* ---------- catalog 下發四張排版檔位表（2026-09-05 CMS 面板補字距／行距下拉） ----------
   面板的選項只能從 catalog 畫、不得前端硬編（單一來源＝lib/theme_draft.js）。這條守：
   四張表都在、每張剛好一檔 default（面板 selOf 靠它預選「標準」——字距表是加減制沒有 mul 欄，
   原本只認 mul===1 會讓那一排沒有預選、瀏覽器自己挑第一格「緊」＝使用者以為預設就是緊）。 */
test("catalog.typography 下發 scale／leading／tracking／width 四張表，各剛好一檔 default，字距標籤＝緊／標準／鬆", () => {
  const ty = L.catalogForForm(depsWith()).typography;
  for (const k of ["scaleSteps", "leadingSteps", "trackingSteps", "widthSteps"]) {
    assert.ok(Array.isArray(ty[k]) && ty[k].length === 3, `${k} 要是三檔陣列`);
    assert.strictEqual(ty[k].filter((s) => s.default).length, 1, `${k} 要剛好一檔 default`);
  }
  assert.deepStrictEqual(ty.trackingSteps.map((s) => s.id), ["sm", "md", "lg"]);
  assert.deepStrictEqual(ty.trackingSteps.map((s) => s.label), ["緊", "標準", "鬆"], "字距下拉文案＝使用者 2026-09-05 過目版");
  assert.deepStrictEqual(ty.leadingSteps.map((s) => s.label), ["緊", "標準", "鬆"]);
});

/* ---------- 第十二棒上架（2026-09-10 W1-B12）：完工名單一正一負 ---------- */
test("滾動上架第十二棒：ENGINE_SUPPORTED 含 layout-012；真登記簿的表單卡單出現這款、直傳可解析；未登錠貨號仍擋", () => {
  assert.ok(L.ENGINE_SUPPORTED.has("layout-012"), "012 未解鎖＝CMS 選單看不到、CP-25 會擋");
  const deps = L.loadLayoutDeps();
  const cat = L.catalogForForm(deps);
  assert.ok(cat.cards.some((c) => c.id === "layout-012"), "表單卡單沒有 012（完工一款＝自動多一張卡）");
  assert.strictEqual(L.resolveLayoutChoice({ kvVariant: "layout-012" }, deps).kvVariant, "layout-012");
  assert.throws(() => L.resolveLayoutChoice({ kvVariant: "layout-013" }, deps), Error, "未登錄貨號要擋，不得靜默落回");
});

/* ---------- 主標落哪一格（2026-09-24；病例 run 174314：策略檔主標寫死 slogan-left，六款版式的主標格是 title-center） ---------- */
test("titleSlotFor／writeTitleIntoSlot：12 款版式都找得到主標格；010 上下行兩格；舊殼與未登錄＝null；其餘段不動、尾端空段修掉", () => {
  for (const [layout, pieces] of Object.entries(L.HERO_TEXT_PIECES)) {
    const ts = L.titleSlotFor(layout);
    assert.ok(ts, layout + " 找不到主標格");
    const [slot, labels] = Object.entries(pieces)[0];
    assert.strictEqual(ts.slot, slot, layout); assert.match(labels[ts.index], /^主標/, layout);
    if (layout === "layout-010") assert.strictEqual(ts.secondIndex, 1, "010 兩行制"); else assert.strictEqual(ts.secondIndex, null, layout);
  }
  assert.strictEqual(L.titleSlotFor("new"), null); assert.strictEqual(L.titleSlotFor(""), null); assert.strictEqual(L.titleSlotFor("layout-999"), null);
  const FOLD = String.fromCharCode(0x2028);
  assert.deepStrictEqual(L.writeTitleIntoSlot("layout-005", "舊標\n膠囊\n2026", ["日用品", "一次囤齊"]), { slot: "title-center", value: `日用品${FOLD}一次囤齊\n膠囊\n2026` }, "005 只換第 0 段、膠囊與年份帶不動");
  assert.deepStrictEqual(L.writeTitleIntoSlot("layout-010", "", ["日用品", "一次囤齊"]), { slot: "slogan-left", value: "日用品\n一次囤齊" });
  assert.deepStrictEqual(L.writeTitleIntoSlot("layout-010", "上\n下\n副標帶", ["只有一行"]), { slot: "slogan-left", value: "只有一行\n\n副標帶" }, "下行清空、副標帶保留");
  assert.deepStrictEqual(L.writeTitleIntoSlot("layout-012", "", ["新標"]), { slot: "slogan-left", value: "新標" });
  assert.deepStrictEqual(L.writeTitleIntoSlot("layout-007", "舊\n", ["新標"]), { slot: "title-center", value: "新標" }, "尾端空段修掉");
  assert.strictEqual(L.writeTitleIntoSlot("new", "", ["x"]), null);
});

test("defaultHeroForLayout：有 kv 兩行標題＝文字槽用它（不再把活動內部名稱印到主標）；沒有＝退回活動名（舊行為）；010 上下行", () => {
  const FOLD = String.fromCharCode(0x2028);
  const rec = { id: "layout-006", slots: [{ key: "title-center", state: "on" }, { key: "item-ring", state: "on" }] };
  const prods = [{ gdid: 1 }, { gdid: 2 }];
  const withKv = L.defaultHeroForLayout(rec, "白蘭_同品類×跨品牌-優惠銷售_2026-09", prods, { titleLine1: "白蘭", titleLine2: "精選好物" });
  assert.strictEqual(withKv["title-center"], "白蘭" + FOLD + "精選好物");
  assert.deepStrictEqual(withKv["item-ring"], { gdids: ["1", "2"] }, "商品槽不受影響");
  assert.strictEqual(L.defaultHeroForLayout(rec, "白蘭_同品類×跨品牌-優惠銷售_2026-09", prods)["title-center"], "白蘭_同品類×跨品牌-優惠銷售_2026-09", "沒有 kv＝舊行為");
  assert.strictEqual(L.defaultHeroForLayout(rec, "活動名", prods, { titleLine1: "", titleLine2: "" })["title-center"], "活動名", "kv 兩行都空＝退回活動名");
  const rec10 = { id: "layout-010", slots: [{ key: "slogan-left", state: "on" }] };
  assert.strictEqual(L.defaultHeroForLayout(rec10, "x", [], { titleLine1: "日用品", titleLine2: "一次囤齊" })["slogan-left"], "日用品\n一次囤齊", "010 兩行制＝上下行兩格");
});

/* ---------- 2026-09-27 主視覺預填三題（病例 run 142315／123617：右槽第 2 格永遠撞第 1 層情境卡代表品、長名進主視覺） ---------- */
test("defaultHeroForLayoutEx exclude：已曝光的跳過取下一件；沒放滿＝short 帳＋白話句；填滿就停、後面不算跳過；不帶 opts＝舊行為逐位元組不變", () => {
  const rec = { id: "layout-002", slots: [{ key: "product-left" }, { key: "title-center" }, { key: "product-right" }] };
  const kv = { titleLine1: "主", titleLine2: "標" };
  const prods = ["1", "2", "3", "4", "5", "6"].map((g) => ({ gdid: g, name: "商品" + g }));
  const old = L.defaultHeroForLayout(rec, "頁", prods, kv);
  assert.deepStrictEqual(old["product-left"], { gdids: ["1", "2"] }); assert.deepStrictEqual(old["product-right"], { gdids: ["3", "4"] }, "舊行為：照順序切 [2,3]");
  const r = L.defaultHeroForLayoutEx(rec, "頁", prods, kv, { exclude: new Set(["4"]) });
  assert.deepStrictEqual(r.hero["product-right"], { gdids: ["3", "5"] }, "第 4 件已曝光＝跳過、取第 5 件");
  assert.deepStrictEqual(r.hero["title-center"], old["title-center"], "文字槽不受影響");
  assert.deepStrictEqual(r.skipped.exposed, ["4"]); assert.deepStrictEqual(r.short, []); assert.deepStrictEqual(L.heroPrefillNotes(r), [], "放滿＝不出聲");
  const r2 = L.defaultHeroForLayoutEx(rec, "頁", prods.slice(0, 4), kv, { exclude: new Set(["4"]) });
  assert.deepStrictEqual(r2.hero["product-right"], { gdids: ["3"] }, "候選不夠＝少放，不拿違規商品湊數");
  assert.deepStrictEqual(r2.short, [{ slot: "product-right", want: 2, got: 1 }]);
  const notes = L.heroPrefillNotes(r2);
  assert.strictEqual(notes.length, 1); assert.match(notes[0], /^右商品槽放了 1 件，這款要 2 件。/, "狀態導向、不前置解釋"); assert.match(notes[0], /其餘候選已在樓層或牆上/);
  const r3 = L.defaultHeroForLayoutEx(rec, "頁", prods, kv, { exclude: new Set(["6"]) });
  assert.deepStrictEqual(r3.skipped.exposed, [], "填滿就停：第 6 件沒走到＝不算跳過");
  assert.deepStrictEqual(L.defaultHeroForLayoutEx(rec, "頁", prods, kv).hero, old, "不帶 opts＝逐位元組同舊");
});

test("defaultHeroForLayoutEx nameBudgetEm：名字放不進兩行的跳過（尺＝rules.json heroName 760px@16px＝47.5em，與 gate CP-03 同一把）", () => {
  const LONG = "興達港歐董魚丸 回購組合(花枝蝦排X1+月亮花枝蝦餅X1+包蛋旗魚黑輪x1+蝦滋圈x1+牛蒡天婦羅x1+鮮蝦滑x1)"; // 病例原字（run 123617 gdid 11643457）
  assert.strictEqual(L.HERO_NAME_BUDGET_EM, 47.5);
  const rec = { id: "layout-006", slots: [{ key: "item-ring" }] };
  const prods = [{ gdid: "1", name: "短名" }, { gdid: "2", name: LONG }, { gdid: "3", name: "短名" }, { gdid: "4", name: "短名" }, { gdid: "5", name: "短名" }];
  const r = L.defaultHeroForLayoutEx(rec, "頁", prods, null, { nameBudgetEm: L.HERO_NAME_BUDGET_EM });
  assert.deepStrictEqual(r.hero["item-ring"], { gdids: ["1", "3", "4", "5"] }); assert.deepStrictEqual(r.skipped.tooLong, ["2"]);
  assert.deepStrictEqual(L.defaultHeroForLayout(rec, "頁", prods)["item-ring"], { gdids: ["1", "2", "3", "4"] }, "不帶 opts＝舊行為（長名照放）");
  const r2 = L.defaultHeroForLayoutEx(rec, "頁", prods.slice(0, 3), null, { nameBudgetEm: L.HERO_NAME_BUDGET_EM });
  assert.match(L.heroPrefillNotes(r2)[0], /環列商品槽放了 2 件，這款要 4 件。.*1 件名字放不進兩行、其餘候選不夠分/);
});

test("heroPrefillExclusions 沿 gdidUsedOnPage（樓層卡／情境卡／牆／編輯精選牆算曝光；kv 鏡像不算；heroSoFar 內的算）；heroProductCapacity／heroCountArgs 讀登記簿；writeLayoutChoiceIntoDraft 預填避開＋出聲", () => {
  /* 賣場編號用 6 碼起（真實形狀；情境卡只存 URL、gdidOf 認 6 碼以上——短碼會像「沒有情境卡」一樣被略過） */
  const page = {
    kvVariant: "layout-002", kv: { keyProductGdids: ["700001", "700002", "700003"] },
    floors: [{ pos: "featured-1", sceneUrl: "https://tw.buy.yahoo.com/gdsale/gdsale.asp?gdid=700004", productGdids: ["700005"] }],
    walls: [{ pos: "category-1", productGdids: ["700006"] }],
    hero: { "product-left": { gdids: ["700009"] } }, // 舊 hero＝不看（預填只在 hero 缺席時跑；換版式時看的是 heroSoFar）
  };
  const products = ["700001", "700002", "700003", "700004", "700005", "700006", "700008", "700009"].map((g) => ({ gdid: g, name: "商品" + g })).concat([{ gdid: "700007", name: "編輯精選牆", position: "editorial-wall" }]);
  assert.deepStrictEqual([...L.heroPrefillExclusions(page, products, null)].sort(), ["700004", "700005", "700006", "700007"], "kv 鏡像 1/2/3 與舊 hero 9 不算；情境卡 4、卡 5、牆 6、編輯精選牆 7 算");
  assert.ok(L.heroPrefillExclusions(page, products, { "product-left": { gdids: ["700008"] } }).has("700008"), "已搬進主視覺的算（主視覺內部不重複）");
  const o = L.heroPrefillOptions(page, products, null);
  assert.ok(o.exclude instanceof Set && o.nameBudgetEm === L.HERO_NAME_BUDGET_EM, "三個入口共用同一組選項");

  const { paths } = buildFixtures({ layouts: { assets: [
    layoutRec("layout-002", { defaultBackground: "bg-008", slots: [{ key: "product-left" }, { key: "title-center" }, { key: "time-band", state: "off" }, { key: "product-right" }] }),
    layoutRec("layout-006", { slots: [{ key: "title-center" }, { key: "item-ring" }, { key: "discount-digit", state: "off" }] }),
    layoutRec("layout-008", { defaultBackground: "bg-017", slots: [{ key: "slogan-left" }, { key: "product-main" }] }),
  ] } });
  const deps = L.loadLayoutDeps(paths);
  assert.strictEqual(L.heroProductCapacity(deps.registries.layoutRecords.get("layout-002")), 4);
  assert.strictEqual(L.heroProductCapacity(deps.registries.layoutRecords.get("layout-006")), 4);
  assert.strictEqual(L.heroProductCapacity(deps.registries.layoutRecords.get("layout-008")), 3);
  assert.strictEqual(L.heroProductCapacity({ slots: [{ key: "product-left", state: "off" }] }), 0, "off 的槽不算");
  assert.deepStrictEqual(L.heroCountArgs("layout-002", paths), { args: ["--heroCount", "4"], count: 4, note: null });
  assert.deepStrictEqual(L.heroCountArgs("layout-008", paths), { args: ["--heroCount", "3"], count: 3, note: null }, "新版式一律帶（帶了＝curate_auto 走新版式路：主打只挑放得進兩行的）");
  assert.deepStrictEqual(L.heroCountArgs("new", paths).args, [], "舊殼不帶＝curate_auto 舊行為逐位元組不變");
  const miss = L.heroCountArgs("layout-999", paths); assert.deepStrictEqual(miss.args, []); assert.match(miss.note, /登記簿沒有 layout-999/, "沒這款＝不帶＋出聲");

  /* 寫進草稿：products[] 照病例形狀（kv-main×3 → 情境卡代表品 → 三張卡）＝舊演算法右槽第 2 格會拿到代表品；新演算法跳過、少放並出聲 */
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "prefill-"));
  const dp = path.join(dir, "draft.json");
  const G = ["700001", "700002", "700003", "700004", "700005", "700006", "700007"];
  const dj = { page: { pageName: "頁", kv: { titleLine1: "主", titleLine2: "標", keyProductGdids: G.slice(0, 3) },
    floors: [{ pos: "featured-1", sceneUrl: "https://tw.buy.yahoo.com/gdsale/gdsale.asp?gdid=700004", productGdids: G.slice(4) }], walls: [] },
    products: G.map((g, i) => ({ gdid: g, name: "商品" + g, position: i < 3 ? "kv-main" : i === 3 ? "featured-1-scene" : "featured-1" })) };
  fs.writeFileSync(dp, JSON.stringify(dj));
  L.writeLayoutChoiceIntoDraft(dp, { kvVariant: "layout-002", layoutChoice: { by: "manual", reason: "測" } }, paths);
  const out = JSON.parse(fs.readFileSync(dp, "utf8"));
  assert.deepStrictEqual(out.page.hero["product-left"], { gdids: ["700001", "700002"] });
  assert.deepStrictEqual(out.page.hero["product-right"], { gdids: ["700003"] }, "第 4 件是情境卡代表品＝不拿；其餘都是樓層卡＝也不拿");
  assert.match(out.meta.layoutChoice.heroPrefill, /骨架預填 3 槽/); assert.match(out.meta.layoutChoice.heroPrefill, /右商品槽放了 1 件，這款要 2 件/);
  assert.deepStrictEqual(out.meta.layoutChoice.heroPrefillSkipped, { exposed: 4, tooLong: 0 });
  assert.strictEqual(out.meta.layoutChoice.heroPrefillNotes.length, 1);
});
