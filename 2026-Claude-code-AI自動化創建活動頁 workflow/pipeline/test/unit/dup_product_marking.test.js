"use strict";
/**
 * 重複商品要標在「真正重複的那幾件」上（2026-09-25 使用者實測）。
 *
 * 病例：頁面上同一件商品出現兩次，檢查報告叫你去改，但畫面只把「整塊模組」框起來——
 * 使用者還是得自己在模組裡一件一件找是哪一件重複。
 *
 * 根因不是「沒有標記能力」，而是標記時用 data-path 找列：同一件商品出現在兩個模組時，
 * 兩列 prod-row 的 data-path 都是 products.<同一個索引>.tag，querySelector 只回第一列
 * ⇒ 第二列一點標記都沒有。四處消費端全犯同一個錯（鐵律 4「同類幾處」）。
 *
 * 本檔驗兩件事：
 *  ① prodRowsOfGdid 真的跑起來會回「全部」的列（抽原始碼注入假 DOM 實跑，不是比對字串）；
 *  ② 四處消費端確實都改走這支（接線斷了＝畫面上什麼都不會亮）。
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "../..");
const ui = fs.readFileSync(path.join(ROOT, "workbench/public/index.html"), "utf8");

/* ---------- ① 行為：把 prodRowsOfGdid 抽出來真的跑 ---------- */

const SRC = (ui.match(/function prodRowsOfGdid\(g\)\{[\s\S]*?\n\}/) || [])[0];

/** 假 DOM：rows＝畫面上由上到下的商品列；每列給 gdid（null＝主視覺那種沒有 data-gdid 的列）
 *  與 pathIdx（這列的輸入框指向 products.<pathIdx>），模擬真實 markup 的兩種排法。 */
function run(gdidToFind, rows, pIdxTable) {
  const objs = rows.map((r) => ({ dataset: r.gdid ? { gdid: String(r.gdid) } : {}, _id: r.id }));
  const $$ = (q) => {
    if (q.includes(".prod-row[data-gdid]")) return objs.filter((o) => o.dataset.gdid);
    const m = q.match(/products\.(\d+)\./);
    if (m) {
      const want = Number(m[1]);
      return rows.map((r, i) => (r.pathIdx === want ? { closest: () => objs[i] } : null)).filter(Boolean);
    }
    return [];
  };
  const pIdx = (g) => (Object.prototype.hasOwnProperty.call(pIdxTable, String(g)) ? pIdxTable[String(g)] : -1);
  const ctx = { $$, pIdx };
  vm.createContext(ctx);
  vm.runInContext(SRC + "\n;globalThis.__f = prodRowsOfGdid;", ctx);
  /* 展開成本地陣列：沙箱裡 return 的空陣列帶的是沙箱自己的 Array 型別，
     deepStrictEqual 會判「結構一樣但不是同一種陣列」＝假紅。 */
  return [...ctx.__f(gdidToFind)].map((o) => o._id);
}

test("①重複商品：同一件出現在兩個模組＝兩列都要回，不能只回第一列", () => {
  assert.ok(SRC, "找不到 prodRowsOfGdid——接線改名了就要同步改測試");
  const rows = [
    { id: "樓層卡", gdid: "111", pathIdx: 0 },
    { id: "別件", gdid: "222", pathIdx: 1 },
    { id: "品類牆", gdid: "111", pathIdx: 0 }, // 同一件、同一個 data-path
  ];
  const got = run("111", rows, { 111: 0, 222: 1 });
  /* 舊做法（querySelector 取第一個）只會回 ["樓層卡"]＝使用者看到的病徵。 */
  assert.deepStrictEqual(got, ["樓層卡", "品類牆"], "重複的每一處都要標記，否則使用者得自己找另一處");
});

test("②情境卡與商品卡同商品：兩列都有 data-gdid＝兩列都回（CP-18 樓層那型）", () => {
  const rows = [
    { id: "情境卡", gdid: "777", pathIdx: null }, // 情境卡列也有 data-gdid（index.html 6079 行）
    { id: "商品卡1", gdid: "888", pathIdx: 1 },
    { id: "商品卡2", gdid: "777", pathIdx: 0 },
  ];
  assert.deepStrictEqual(run("777", rows, { 777: 0, 888: 1 }), ["情境卡", "商品卡2"]);
});

test("③主視覺那種沒有 data-gdid 的列，靠 data-path 也要找得到（別修好一處、弄壞另一處）", () => {
  const rows = [{ id: "KV槽", gdid: null, pathIdx: 0 }];
  assert.deepStrictEqual(run("111", rows, { 111: 0 }), ["KV槽"],
    "主視覺是另一套排法——只認 data-gdid 會讓 KV 的合規標記整個消失");
});

test("④同一列不可以被算兩次（data-gdid 與 data-path 都命中同一列）", () => {
  const rows = [{ id: "同時命中", gdid: "111", pathIdx: 0 }];
  assert.deepStrictEqual(run("111", rows, { 111: 0 }), ["同時命中"]);
});

test("⑤找不到的商品＝空陣列，不丟例外（報告可能比畫面舊）", () => {
  assert.deepStrictEqual(run("999", [{ id: "a", gdid: "111", pathIdx: 0 }], { 111: 0 }), []);
  assert.deepStrictEqual(run("", [{ id: "a", gdid: "111", pathIdx: 0 }], { 111: 0 }), []);
  assert.deepStrictEqual(run(null, [{ id: "a", gdid: "111", pathIdx: 0 }], { 111: 0 }), []);
});

/* ---------- ② 接線：四處消費端都要走這支 ---------- */

test("⑥合規檢查的紅框走 prodRowsOfGdid（原本 el.closest＝只框第一列）", () => {
  assert.match(ui, /f\.ref\.gdid && isFail\) prodRowsOfGdid\(f\.ref\.gdid\)[\s\S]{0,80}?row-gate-err/,
    "合規檢查要逐列上紅框");
  assert.doesNotMatch(ui, /if \(el && f\.ref\.gdid\) \{ const row = el\.closest\("\.prod-row"\)/,
    "舊的單列寫法不該還在（留著＝下次有人照抄）");
});

test("⑦報告「前往」會把重複的每一處一起閃", () => {
  assert.match(ui, /function jumpToFinding[\s\S]{0,900}?prodRowsOfGdid\(f\.ref\.gdid\)/,
    "跳轉要閃全部，不是只閃一列");
});

test("⑧換完品回跳也要閃全部（flashRow 同族）", () => {
  assert.match(ui, /function flashRow[\s\S]{0,700}?prodRowsOfGdid\(gdid\)/);
});

test("⑨商品狀態的說明文字要掛在「自己那一列」底下（原本全域找＝只掛第一列）", () => {
  assert.match(ui, /_sib\.classList\.contains\("prod-hint"\)/,
    "提示欄要取這一列自己的下一行；全域 querySelector 會讓第二列只有框、沒有字");
});

test("⑩情境卡重複的訊息要把貨號帶出來（原本只回樓層＝整層亮）", () => {
  assert.match(ui, /scene 卡代表品"\)\) \{ const mg = msg\.match\(\/gd:\(\\d\+\)\/\)[\s\S]{0,120}?gdid: mg \? mg\[1\] : null/,
    "gateFieldRef 要從訊息抽出貨號");
  /* 真訊息逐字取自 gate.js：`樓層 #1：scene 卡代表品與商品卡 2 同商品（gd:12345678）——…` */
  const realMsg = "樓層 #1：scene 卡代表品與商品卡 2 同商品（gd:12345678）——同樓層 scene 與卡不得同商品";
  assert.equal((realMsg.match(/gd:(\d+)/) || [])[1], "12345678", "抽取式要對得上 gate 的真實訊息");
  assert.equal((realMsg.match(/樓層 #(\d+)/) || [])[1], "1");
});

test("⑪全頁互斥那型本來就帶貨號——確認它沒被這次改動弄丟", () => {
  assert.match(ui, /全頁互斥違反：gd:\(\\d\+\)[\s\S]{0,140}?gdid: m\[1\], truth: true/);
  const realMsg = "全頁互斥違反：gd:11697562 同時曝光於 樓層 #1 卡 2、品類牆 #1 卡 3（U22：同一推薦對象全頁單點曝光）";
  assert.equal((realMsg.match(/全頁互斥違反：gd:(\d+)/) || [])[1], "11697562");
});

/* ---------- 2026-10-07 使用者反饋：「不知道是哪兩個商品重複」——訊息帶商品名＋貨號、提醒級也要能跳 ---------- */

test("⑫訊息帶了商品名之後，句頭錨「全頁互斥違反：gd:」仍然抽得到貨號（名字是附加、不是改錨）", () => {
  /* 真訊息逐字取自 gate.js 新格式：id 後面直接接「名稱」 */
  const named = "全頁互斥違反：gd:11697562「Vinda Snoopy限定版全能萬用捲筒…」 同時曝光於 樓層 #1 卡 2、品類牆 #1 卡 3（U22：同一推薦對象全頁單點曝光）";
  assert.equal((named.match(/全頁互斥違反：gd:(\d+)/) || [])[1], "11697562");
});

test("⑬提醒級（重複曝光 WARN）帶 gd: 之後要有自己的分支，而且排在樓層分支前面——原本被「樓層 #N」接走＝去修跳到樓層標題欄", () => {
  assert.match(ui, /重複曝光\|連到同一個地方\/\.test\(msg\)/, "gateFieldRef 要有重複曝光／同目的地＋gd: 的分支（2026-10-07 擴 CP-06 同用）");
  const warnBranch = ui.indexOf("重複曝光|連到同一個地方/.test(msg)");
  const floorBranch = ui.indexOf("msg.match(/樓層 #(\\d+)/)");
  assert.ok(warnBranch > 0 && floorBranch > 0 && warnBranch < floorBranch, "重複曝光分支必須在樓層分支之前（順序對調＝舊病復發）");
  /* 真訊息逐字取自 gate.js 主視覺 WARN 新格式（2026-10-07 在 run 202609 實跑取得） */
  const realWarn = "主視覺（product-right）的商品「Tempo 濕式衛生紙家庭號 35抽x1…」（gd:11807861）與 樓層 #1 scene 卡 重複曝光——提醒不阻擋（2026-10-05 裁決：主視覺可與下方重複曝光）";
  assert.equal((realWarn.match(/gd:(\d+)/) || [])[1], "11807861", "新分支的抽取式要對得上真實訊息");
});

test("⑭商品不在清單列（入口×精選圓）＝去修退而指到模組區塊，不再丟「找不到商品」死巷（2026-10-07 使用者實測）", () => {
  assert.match(ui, /dupModRef/, "gateFieldRef 要有 dupModRef 退路");
  assert.match(ui, /: dupModRef\(m\[1\]\)/, "全頁互斥分支查不到商品列＝走退路、不回 null");
  /* 真訊息逐字取自 gate.js 新格式（2026-10-07 run 211607 實跑） */
  const cp06 = "編輯精選圓 #1 與本期活動入口 #4 連到同一個地方：商品「科學麵 原味科學麵(40入/箱)」（gd:6054110）（U11 跨模組去重）";
  assert.equal((cp06.match(/gd:(\d+)/) || [])[1], "6054110");
  const sp = cp06.match(/編輯精選圓 #(\d+).*?本期活動入口 #(\d+)/);
  assert.deepEqual([sp[1], sp[2]], ["1", "4"], "白話層要抽得到兩處");
});

/* ---------- ③ 撞號出聲：替換會一起換掉每一處，動手前要講 ---------- */

/* 「它在哪」的規則只有一份（gdidPlaces）；白話名（gdidPlaceNames）是從它推出來的——兩支一起抽，照畫面上的順序。 */
const PLACES_SRC = ["function gdidPlaces\\(g\\)\\{[\\s\\S]*?\\n\\}", "function gdidPlaceNames\\(g\\)\\{[\\s\\S]*?\\n\\}"]
  .map((re) => (ui.match(new RegExp(re)) || [])[0]).filter(Boolean).join("\n");

function places(g, page, products) {
  const draft = { page, products: products || [] };
  const pIdx = (x) => (draft.products || []).findIndex((p) => String(p.gdid) === String(x));
  const treeSections = () => [
    { id: "sec-kv", name: "主視覺" },
    { id: "sec-floor-0", name: "主打樓層 1" },
    { id: "sec-floor-1", name: "主打樓層 2" },
    { id: "sec-wall-0", name: "品類牆 1" },
    { id: "sec-editorial", name: "編輯精選" },
    { id: "sec-promo", name: "本期活動" },
  ];
  const manualUrlGdid = (v) => { const m = String(v || "").match(/[-p](\d{6,})\.html/); return m ? m[1] : null; };
  const ctx = { draft, pIdx, treeSections, manualUrlGdid };
  vm.createContext(ctx);
  vm.runInContext(PLACES_SRC + "\n;globalThis.__p = gdidPlaceNames;", ctx);
  return [...ctx.__p(g)];
}

test("⑬撞號：同一件同時在樓層卡與品類牆＝兩處都要列出來（替換會一起換掉）", () => {
  assert.ok(PLACES_SRC, "找不到 gdidPlaceNames");
  const got = places("111", {
    kv: { keyProductGdids: [] },
    floors: [{ productGdids: ["111", "222"] }],
    walls: [{ productGdids: ["333", "111"] }],
  }, [{ gdid: "111" }, { gdid: "222" }, { gdid: "333" }]);
  assert.deepStrictEqual(got, ["主打樓層 1 的商品卡", "品類牆 1"]);
});

test("⑭情境大圖與同層商品卡撞號＝分得出是哪一種（使用者最容易困惑的那型）", () => {
  /* 貨號用真實長度（≥6 碼）——網址反解貨號的規則跟正式程式一樣要 6 碼以上，短碼會被當不是貨號。 */
  const got = places("11957540", {
    kv: { keyProductGdids: [] },
    floors: [{ productGdids: ["11957540"], sceneUrl: "https://tw.buy.yahoo.com/gdsale/某商品-11957540.html" }],
    walls: [],
  }, [{ gdid: "11957540" }]);
  assert.deepStrictEqual(got, ["主打樓層 1 的商品卡", "主打樓層 1 的情境大圖"],
    "同一層的兩個位置要分得開，否則使用者不知道要動哪一個");
});

test("⑮只出現一處＝不要出聲（沒有重複就不該嚇人）", () => {
  const got = places("111", { kv: { keyProductGdids: [] }, floors: [{ productGdids: ["111"] }], walls: [] }, [{ gdid: "111" }]);
  assert.equal(got.length, 1, "一處就是一處——彈窗的警語只在 2 處以上才出現");
});

test("⑯樹上拿不到名字也不能爆（退回預設名）", () => {
  const draft = { page: { kv: { keyProductGdids: ["111"] }, floors: [], walls: [] }, products: [{ gdid: "111" }] };
  const ctx = {
    draft,
    pIdx: (x) => 0,
    treeSections: () => { throw new Error("樹還沒建"); },
    manualUrlGdid: () => null,
  };
  vm.createContext(ctx);
  vm.runInContext(PLACES_SRC + "\n;globalThis.__p = gdidPlaceNames;", ctx);
  assert.deepStrictEqual([...ctx.__p("111")], ["主視覺"], "拿不到樹就用預設名，不要整個彈窗開不起來");
});

test("⑰替換彈窗要在撞號時先講清楚，並指到真正有用的那條路", () => {
  const open = ui.match(/function openSwap\(gdid\)\{[\s\S]*?\$\("#swap-url"\)\.focus\(\);/);
  assert.ok(open, "找不到 openSwap");
  assert.match(open[0], /places\.length >= 2/, "要先數出現在幾處");
  assert.match(open[0], /一起換掉/, "要講明替換會把每一處一起換掉");
  assert.match(open[0], /「移除」/, "要指到真正解得開重複的那顆鈕（只出聲不給路＝還是鬼打牆）");
});

test("⑫告訴使用者「已經幫你框起來」，不要再叫他自己找是哪一列", () => {
  const dup = ui.match(/if \(\/gdid 重複\/\.test\(msg\)\) return \{[\s\S]{0,400}?\};/);
  assert.ok(dup, "找不到重複商品的說明文案");
  assert.match(dup[0], /每一處都框起來/, "要講清楚畫面已經標好了");
  assert.doesNotMatch(dup[0], /看是哪一列/, "舊文案是叫使用者自己找＝本次要改掉的行為");
});
