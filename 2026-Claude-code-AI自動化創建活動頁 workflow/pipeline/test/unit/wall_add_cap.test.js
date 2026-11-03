/* 品類牆「加入」件數擋門（2026-09-24 使用者裁甲）
 *
 * 病例：品類牆刻意不開放「移除」（受版型件數契約管、只走替換），但「加入」完全沒有上限檢查
 *       ⇒ 業務可以把 12 件的牆加成 13 件，然後手上沒有任何動作能減回去＝死路。
 *       2026-09-24 實測（真實 run 複本）：加第 13 件同時觸發 CP-21 件數違規與 CP-18 全頁互斥兩條紅燈。
 *
 * 本檔守三件事：
 *   ①件數規則只有一份真源（lib/content_modules.js），gate 與 rules.json 都讀它——不准任何一邊自己抄
 *   ②擋門真的接在「加入」那條路上（不是只寫了函式沒人呼叫）
 *   ③兩句話都會照使用者核可的文字出現，而且是 toast 出聲、不是靜默 return
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..", "..");
const ui = fs.readFileSync(path.join(ROOT, "workbench/public/index.html"), "utf8");

test("①件數規則單一真源：登記簿匯出，gate 與 rules.json 都讀它、沒有人自己抄", () => {
  const { WALL_PRODUCT_COUNT_ENUM } = require(path.join(ROOT, "lib/content_modules.js"));
  assert.deepStrictEqual(WALL_PRODUCT_COUNT_ENUM, [4, 8, 12], "U27㉗ 一行四品：合法件數只有 4／8／12");

  const gate = fs.readFileSync(path.join(ROOT, "gate.js"), "utf8");
  assert.match(gate, /WALL_PRODUCT_COUNT_ENUM\s*}\s*=\s*require\(["'].\/lib\/content_modules\.js["']\)/,
    "gate.js 要從登記簿讀，不可以自己宣告一份");
  assert.doesNotMatch(gate, /const\s+WALL_PRODUCT_COUNT_ENUM\s*=\s*\[/,
    "gate.js 不得再出現自己寫死的件數陣列（同一條規則兩處＝改一邊另一邊靜默過期）");

  const rules = JSON.parse(fs.readFileSync(path.join(ROOT, "rules.json"), "utf8"));
  assert.deepStrictEqual(rules.contentModules.wallProductCountEnum, WALL_PRODUCT_COUNT_ENUM,
    "rules.json 要把規則帶給前端，且與登記簿一致（不一致＝介面跟機器閘會各講各話）");
});

test("②擋門已拆（2026-10-05 使用者裁「照樓層模式」）：加入一次一件一律放行、前端不再有件數擋門", () => {
  assert.doesNotMatch(ui, /wallAddBlockedMsg/, "擋門函式與呼叫都要拆乾淨（留著沒人呼叫＝殭屍規則，哪天又被接回去）");
  assert.match(ui, /牆件數擋門已拆（2026-09-24 立）已於 2026-10-05 拆除|牆件數擋門已拆/, "拆門要留墓碑註解（說明為什麼拆、規則搬去哪）");
  assert.doesNotMatch(ui, /品類牆一行放四件，所以要嘛/, "舊的「一次加到 N 件」話術要跟著走");
});

test("③湊滿提醒仍在：lib 加品回報句＋面板件數提示（照樓層模式＝提醒不擋）", () => {
  const lib = fs.readFileSync(path.join(ROOT, "lib/content_modules.js"), "utf8");
  assert.match(lib, /一行 4 件：再加 \$\{4 - \(n % 4\)\} 件湊滿一行/, "加品回報句要講「再加 N 件湊滿一行」");
  assert.match(ui, /再加 \$\{short\} 件湊滿一行/, "面板件數提示要在（人工挑選商品加入那格）");
});

test("④機器閘降提醒：gate CP-21 牆件數 enum＝WARN 湊滿句、宣告≠實數仍 FAIL", () => {
  const gate = fs.readFileSync(path.join(ROOT, "gate.js"), "utf8");
  assert.match(gate, /add\("WARN", "CP-21", `品類牆 #\$\{i \+ 1\}/, "牆 enum 要是 WARN");
  assert.match(gate, /add\("WARN", "CP-21", `編輯精選牆目前/, "編輯精選牆 enum 要是 WARN");
  assert.match(gate, /add\("FAIL", "CP-21", `品類牆 #\$\{i \+ 1\}「\$\{w\.title \|\| ""\}」宣告 wallProductCount/, "宣告≠實數仍 FAIL（資料自相矛盾是真錯）");
  /* 上限訊息刻意不在前端——後端 MODULE_PICK_CAPS 已經擋且訊息更完整。 */
  assert.doesNotMatch(ui, /這面牆已經滿了/,
    "上限交給後端（MODULE_PICK_CAPS）；前端再寫一份＝常數不同源、後端改了前端靜默過期");
});

test("⑤移除通道不受影響（可加可刪＝拆門的前提）", () => {
  /* 守行為不守註解文字：2026-09-24 這段註解因為開放樓層／牆移除而改寫，
     測試當場紅了——正確反應是把斷言改成守「編輯精選那條路還在」，不是把註解改回去。 */
  assert.match(ui, /opts && opts\.removable \? `<button[^`]*data-edremove=/,
    "編輯精選牆仍走 data-edremove（它的商品只活在 draft.products，移除＝整筆拿掉）");
  assert.match(ui, /opts && opts\.unpick \? `<button[^`]*data-unpick=/,
    "樓層／品類牆走 data-unpick（商品在清單裡，移除＝從清單拿掉、留在來源池）");
  assert.doesNotMatch(ui, /prodRows\(f\.productGdids, \{ list: `floor:\$\{i\}` \}\)/,
    "樓層要傳 unpick: true（沒傳＝畫面上不會有移除鈕）");
});

/* ───────── 整頁重複檢查要看得到「情境卡代表品」（2026-09-24 根因修）─────────
 * 病例 run 2026-09-24-wb-174314：使用者回報「新增一件商品後，它竟然替換了模組的第一個主打商品」。
 * 比對 13 個版本快照後確認 floors[].sceneUrl 與卡列第 4 件一再對上、且「重做後穩定出現」。
 * 根因＝gdidUsedOnPage() 掃五個位置找「這件用過沒」，唯獨漏掉 floors[].sceneUrl；
 * 而契約白紙黑字是「代表品不入卡列」（vendor_sheet.js 檔頭）。漏檢 ⇒ 加下去即成立 CP-18。
 */
test("⑥加商品時，要認得「它已經是某層的情境卡代表品」", () => {
  const { gdidUsedOnPage } = require(path.join(ROOT, "lib/content_modules.js"));
  const page = {
    kv: { keyProductGdids: [] },
    floors: [
      { title: "第一層", sceneUrl: "https://tw.buy.yahoo.com/gdsale/gdsale.asp?gdid=12240934", productGdids: ["111", "222"] },
    ],
    walls: [],
  };
  assert.strictEqual(gdidUsedOnPage(page, [], "12240934"), "主打樓層 1 的情境卡",
    "已經是代表品的商品要被認出來（修好前這裡回 null＝放行，加下去就撞 CP-18）");
  assert.strictEqual(gdidUsedOnPage(page, [], "111"), "主打樓層 1",
    "卡列裡的照舊認得出來（不得被本次修改影響）");
  assert.strictEqual(gdidUsedOnPage(page, [], "999"), null,
    "沒用過的要放行（不得誤擋）");
});

test("⑦p 型貨號的代表品也要認得（不是只認純數字）", () => {
  const { gdidUsedOnPage } = require(path.join(ROOT, "lib/content_modules.js"));
  const page = {
    kv: { keyProductGdids: [] },
    floors: [{ title: "成人紙尿褲", sceneUrl: "https://tw.buy.yahoo.com/gdsale/gdsale.asp?gdid=p0216246088468", productGdids: [] }],
    walls: [],
  };
  assert.strictEqual(gdidUsedOnPage(page, [], "p0216246088468"), "主打樓層 1 的情境卡",
    "p 型編號（2026-08-28 起）同樣要認得——借用 product_fetch.gdidOf，不自己抄正則");
});

test("⑧URL 解不出貨號時不誤擋", () => {
  const { gdidUsedOnPage } = require(path.join(ROOT, "lib/content_modules.js"));
  const page = { kv: { keyProductGdids: [] }, floors: [{ sceneUrl: "https://tw.buy.yahoo.com/", productGdids: [] }], walls: [] };
  assert.strictEqual(gdidUsedOnPage(page, [], "12240934"), null, "解不出貨號＝不可比，放行不誤殺");
});

/* ───────── 移除單一商品（2026-09-24 使用者實測後補）─────────
 * 病例：樓層／品類牆「能加不能刪」。理由寫「受件數契約管、只走替換」，但替換不改變件數
 *       ⇒ 件數一旦落在不合法值就沒有動作能回頭。使用者原話：「只能加一件，不能刪除商品，
 *       在商品數不夠的時候，一樣沒解決問題」——湊不滿又刪不掉＝兩頭都堵死。
 */
test("⑨後端有「移除單一商品」通道，且商品留在來源池", () => {
  const cm = require(path.join(ROOT, "lib/content_modules.js"));
  const reg = cm.loadContentRegistry();
  const dj = {
    page: { floors: [{ pos: "featured-1", title: "測試層", productGdids: ["111", "222", "333"] }] },
    products: [{ gdid: "111", name: "甲" }, { gdid: "222", name: "乙" }, { gdid: "333", name: "丙" }],
  };
  const r = cm.applyContentModule(dj, { kind: "floor", action: "unpick", index: 0, gdid: "222" }, reg);
  assert.strictEqual(r.changed, true, "要真的有變更");
  assert.deepStrictEqual(dj.page.floors[0].productGdids, ["111", "333"], "只從這個區塊的清單拿掉");
  assert.ok(dj.products.some((p) => p.gdid === "222"), "商品必須留在來源池——之後要選得回來（沿刪層／刪牆慣例）");
  assert.match(r.info.summary, /仍留在這檔的來源商品清單/, "要跟使用者講清楚商品沒有消失");
});

test("⑩移除不存在的商品＝不是錯誤，是「沒有變更」", () => {
  const cm = require(path.join(ROOT, "lib/content_modules.js"));
  const reg = cm.loadContentRegistry();
  const dj = { page: { floors: [{ pos: "featured-1", productGdids: ["111"] }] }, products: [{ gdid: "111", name: "甲" }] };
  const r = cm.applyContentModule(dj, { kind: "floor", action: "unpick", index: 0, gdid: "999" }, reg);
  assert.strictEqual(r.changed, false, "重複按不該拋錯（使用者連點兩下很常見）");
});

test("⑪移除鈕真的接上了（畫面有鈕、有人在聽、走後端同一條路）", () => {
  assert.match(ui, /function moduleUnpick\(/, "處理函式要在");
  assert.match(ui, /data-unpick\][\s\S]{0,120}?moduleUnpick/, "按鈕要有人在聽（沒接＝畫面上按了沒反應）");
  assert.match(ui, /cmApply\(\{ kind, action: "unpick"/,
    "要走 cmApply 後端通道——加走後端、刪走前端會變成兩套寫入路徑，日後只有一套被維護到");
  assert.match(ui, /confirm\(`把「\$\{nm\}」從這個區塊拿掉？/, "破壞性動作要先確認");
});

test("⑫替換／自動補品也要看得到情境卡代表品（第二處消費端）", () => {
  const srv = fs.readFileSync(path.join(ROOT, "workbench/server.js"), "utf8");
  assert.match(srv, /function pageExposedGdids[\s\S]{0,1200}?sceneUrl/,
    "pageExposedGdids 要把 floors[].sceneUrl 算進曝光面——漏了就是「加入擋住了、替換還是穿過去」");
  /* 這條規則有兩處消費端（lib gdidUsedOnPage／server pageExposedGdids）。2026-09-24 先只修了前者，
     使用者實測立刻抓到「商品替換後主打品會同步更新」＝屋裡還有一道舊的門。本斷言守住兩處都在。 */
  const lib = fs.readFileSync(path.join(ROOT, "lib/content_modules.js"), "utf8");
  assert.match(lib, /function gdidUsedOnPage[\s\S]{0,900}?sceneUrl/, "lib 這一處也要在");
});
