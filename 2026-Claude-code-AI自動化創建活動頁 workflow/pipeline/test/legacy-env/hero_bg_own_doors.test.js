"use strict";
/**
 * hero_bg_own_doors.test.js —— 「你上傳的背景」＋「主視覺活動文字不顯示」的每一道門（78 號 2026-09-27）
 *
 * 鐵律 4（一條規則多道門）：own 這個新哨兵值會流過的每個消費端都要在這裡點名——
 *   提案包驗證／寫入（applyCombo）／真底色（effectiveHeroSurface）／出貨檢查（gate CP-27）／AEM 匯出／ZIP 匯出／部署／
 *   引擎（合成條目＋掛牌字＋藏標題表）／CP-35 絆線／前端面板。少一道＝這裡紅。
 * 上傳體檢（lib/hero_bg_own）用 sharp 現做的圖走一遍：尺寸、方向、手機重量、來源答案。
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const PIPE = path.join(__dirname, "..", "..");
const ENGINE = path.join(PIPE, "..", "..", "2026-AI自動化活動頁生成規劃", "MVP_Phase1_LeCreuset_活動頁Prototype_FrameTest.html");
const SRC = fs.readFileSync(ENGINE, "utf8");
const SERVER = fs.readFileSync(path.join(PIPE, "workbench", "server.js"), "utf8");
const INDEX = fs.readFileSync(path.join(PIPE, "workbench", "public", "index.html"), "utf8");
const GATE = fs.readFileSync(path.join(PIPE, "gate.js"), "utf8");
const AEM = fs.readFileSync(path.join(PIPE, "lib", "aem_export.js"), "utf8");
const { HERO_TEXT_PIECES, loadLayoutDeps } = require("../../lib/layout_choice.js");
const { parseProposalPack } = require("../../lib/proposal_pack.js");
const heroCombo = require("../../lib/hero_combo.js");
const own = require("../../lib/hero_bg_own.js");
const L = require("../../lib/hero_bg_license.js");

const deps = loadLayoutDeps();
const files3 = { desktop: "/api/runs/r1/hero-bg/desktop.png", "768": "/api/runs/r1/hero-bg/768.png", "375": "/api/runs/r1/hero-bg/375.png" };
const ownObj = (files = files3) => ({ files, sha256: "s", bridgeColor: "#F2F2F2", attest: { source: "設計部提供", commercial: true, responsibility: true } });
const dj = (page = {}) => ({ page: { kvVariant: "layout-002", hero: { "title-center": "主標\n副標" }, ...page }, products: [], meta: {} });

function objectLiteral(anchor) { const i = SRC.indexOf(anchor); assert.ok(i >= 0, "引擎找不到 " + anchor); const st = SRC.indexOf("{", i); return SRC.slice(st, SRC.indexOf("};", st) + 1); }
const evalObj = (lit) => new Function(`return (${lit});`)();

test("門①｜提案包不能帶 own：parse 出聲擋下、句子講去哪上傳", () => {
  const r = parseProposalPack({ version: 1, layout: "layout-002", background: "own" }, deps.registries);
  assert.strictEqual(r.ok, false);
  assert.ok(r.errors.some((e) => /只能在工作台的編修頁上傳/.test(e)), r.errors.join("；"));
});

test("門②｜applyCombo：own 桌機在就先套預覽並點名缺哪格；三檔齊＝黃條講掛牌字；沒桌機＝拒；bgName 不印裸字", () => {
  const d1 = dj({ heroBgOwn: ownObj({ desktop: files3.desktop }) });
  const r1 = heroCombo.applyCombo(d1, { backgroundId: "own" }, deps); /* 桌機在＝先套預覽（2026-09-27 使用者實測） */
  assert.strictEqual(d1.page.backgroundId, "own"); assert.ok(r1.info.notes.some((n) => /缺平板版、手機版/.test(n) && /暫用桌機圖/.test(n)), r1.info.notes.join("；"));
  assert.throws(() => heroCombo.applyCombo(dj({ heroBgOwn: ownObj({ "768": files3["768"] }) }), { backgroundId: "own" }, deps), /先上傳桌機版/);
  const d2 = dj({ heroBgOwn: ownObj() });
  const r = heroCombo.applyCombo(d2, { backgroundId: "own" }, deps);
  assert.strictEqual(r.changed, true); assert.strictEqual(d2.page.backgroundId, "own");
  /* 2026-09-29 使用者走查裁撤：三張齊的狀態句不再進套用黃框（離現場太遠＋確認後過期說謊）——狀態只住上傳區塊 */
  assert.ok(!r.info.notes.some((n) => /確認中|三張齊/.test(n)), "三張齊套用不塞面板底部黃框：" + r.info.notes.join("；"));
  assert.ok(!r.info.notes.some((n) => /「own」/.test(n)), "介面句不得印裸字 own");
  assert.ok(!/「own」/.test(String((d2.meta.layoutChoice || {}).reasonDisplay || "")), "reasonDisplay 不得印裸字 own");
  const d3 = dj();
  assert.throws(() => heroCombo.applyCombo(d3, { backgroundId: "own" }, deps), /還沒有上傳背景圖/);
});

test("門②-b｜applyCombo：heroBgOwn 物件同批帶入可直接設 own；null＝移除並清指針；壞路徑＝拒", () => {
  const d = dj();
  const r = heroCombo.applyCombo(d, { heroBgOwn: ownObj(), backgroundId: "own" }, deps);
  assert.strictEqual(r.changed, true); assert.strictEqual(d.page.backgroundId, "own"); assert.ok(d.page.heroBgOwn);
  const r2 = heroCombo.applyCombo(d, { heroBgOwn: null }, deps);
  assert.strictEqual(r2.changed, true); assert.strictEqual(d.page.heroBgOwn, undefined); assert.strictEqual(d.page.backgroundId, undefined);
  assert.throws(() => heroCombo.applyCombo(dj(), { heroBgOwn: ownObj({ ...files3, desktop: "/etc/passwd" }) }, deps), /檔案位置不對/);
  assert.throws(() => heroCombo.applyCombo(dj(), { heroBgOwn: ownObj({ ...files3, hero: "/api/runs/r1/hero-bg/desktop.png" }) }, deps), /格位不對/);
});

test("門③｜換版式門：用著 own 直接換版式＝拒並教怎麼做；先改回預設就能換", () => {
  const d = dj({ backgroundId: "own", heroBgOwn: ownObj() });
  assert.throws(() => heroCombo.applyCombo(d, { kvVariant: "layout-003" }, deps), /每款版面需要的圖尺寸不同/);
  const d2 = dj({ backgroundId: "own", heroBgOwn: ownObj() });
  const r = heroCombo.applyCombo(d2, { backgroundId: "" }, deps);
  assert.strictEqual(r.changed, true); assert.strictEqual(d2.page.backgroundId, undefined); assert.ok(d2.page.heroBgOwn, "圖留著＝已上傳未使用態");
});

test("門④｜effectiveHeroSurface：own＝照片類，真底色吃上傳時量的銜接色；沒銜接色＝不判（null）", () => {
  const s = heroCombo.effectiveHeroSurface({ kvVariant: "layout-002", backgroundId: "own", heroBgOwn: ownObj() }, {}, deps);
  assert.ok(s && s.hex && /^#f2f2f2$/i.test(s.hex), JSON.stringify(s));
  assert.strictEqual(s.bgName, "你上傳的背景");
  const o = ownObj(); o.bridgeColor = null;
  assert.strictEqual(heroCombo.effectiveHeroSurface({ kvVariant: "layout-002", backgroundId: "own", heroBgOwn: o }, {}, deps), null);
});

test("門⑤｜藏標題／跑馬帶開關：只存 true、清欄即回、非法值拒；what 表有中文名", () => {
  const d = dj();
  let r = heroCombo.applyCombo(d, { heroTitleHidden: true }, deps);
  assert.strictEqual(d.page.heroTitleHidden, true); assert.ok(r.info.notes.some((n) => /主視覺文字・不顯示/.test(n)));
  r = heroCombo.applyCombo(d, { heroTitleHidden: null }, deps); assert.strictEqual(d.page.heroTitleHidden, undefined);
  heroCombo.applyCombo(d, { heroMarqueeHidden: true }, deps); assert.strictEqual(d.page.heroMarqueeHidden, true);
  heroCombo.applyCombo(d, { heroMarqueeHidden: false }, deps); assert.strictEqual(d.page.heroMarqueeHidden, undefined);
  assert.throws(() => heroCombo.applyCombo(d, { heroTitleHidden: "yes" }, deps), /顯示／不顯示/);
  assert.ok(!/「heroTitleHidden」/.test(String((d.meta.layoutChoice || {}).reasonDisplay || "")), "what 表要有中文名");
});

test("門⑥｜gate CP-27：有 own 分支（三檔不齊 FAIL、齊＝INFO 掛牌字）＋藏標題 INFO；沿同一支 lib 判三檔", () => {
  assert.match(GATE, /require\("\.\/lib\/hero_bg_license"\)/);
  assert.match(GATE, /bgId === ownBgLib\.OWN_BG_ID/);
  assert.match(GATE, /ownBgLib\.ownMissingSlots\(own\)/);
  assert.match(GATE, /add\("FAIL", "CP-27", `這檔選了「你上傳的背景」但圖沒齊/);
  assert.match(GATE, /活動負責人確認中/);
  assert.match(GATE, /heroTitleHidden === true[\s\S]{0,400}add\("INFO", "CP-27"/);
});

test("門⑦⑧｜AEM 匯出與 ZIP／部署（2026-09-29 牆改制）：組裝器在待審檢查前先問 exportHoldReason（帶確認紀錄）；兩條匯出路由帶 confirm 判、部署仍擋 own；錯誤白名單認得擋句", () => {
  const hold = AEM.indexOf("exportHoldReason(pg, opts.holdOpts || {})"), pend = AEM.indexOf("版權還在審核中（只能內網展示），不能匯出到對外的 AEM");
  assert.ok(hold > 0 && pend > 0 && hold < pend, "組裝器要先問 own 的擋句（帶 opts.holdOpts＝確認紀錄），再走待審檢查");
  const zip = SERVER.slice(SERVER.indexOf('seg[3] === "export-zip"'), SERVER.indexOf('seg[3] === "export.zip"'));
  assert.match(zip, /heroBgLic\.exportHoldReason\([\s\S]{0,200}heroBgLicenseConfirm/, "ZIP 路（第七道門）：own 要問確認紀錄（未確認＝擋、相符＝放）");
  const aem = SERVER.slice(SERVER.indexOf('seg[3] === "export-aem"'), SERVER.indexOf('seg[3] === "scenario"'));
  assert.match(aem, /heroBgLic\.exportHoldReason\([\s\S]{0,200}heroBgLicenseConfirm/, "AEM 路由層：own 要問確認紀錄");
  const depStart = SERVER.indexOf('seg[3] === "deploy" && req.method === "POST"');
  const dep = SERVER.slice(depStart, SERVER.indexOf("deployRun(id, runDir).catch", depStart));
  assert.match(dep, /heroBgLic\.isOwnBg/, "部署要擋 own（背景的家甲案落地前，內網站抓不到 runs/ 裡的圖）");
  assert.match(SERVER, /還沒確認版權\|版權確認要重做一次\|找不到，請重新上傳\/\.test\(errText\(e\)\)/, "AEM 錯誤白名單要認得確認制三句（未確認／換圖／缺檔），否則使用者只看到通用句（2026-10-05 合併後讀錯誤改走 errText＝空 message 的錯誤也讀得出原因）");
});

test("門⑩｜版權確認制（2026-09-29 牆 4 乙）：確認端點驗帳號寫 wb_meta；PUT 以真源投影 confirmed；發佈路確認相符才放行＋背景的家複製；永久刪除連站上資產一起清", () => {
  const cf = SERVER.slice(SERVER.indexOf('seg[3] === "hero-bg-confirm"'), SERVER.indexOf('seg[3] === "hero-kit"'));
  assert.match(cf, /帳號跟建立這檔活動時填的不符/, "重輸帳號段：與 ownerEmail 不符＝拒（78 §三 8）");
  assert.match(cf, /acctLocal\(acct\) !== acctLocal\(ownerC\)/, "比帳號不比網域（2026-10-14 公司信箱 @yahooinc.com → @yahootwec.com）：舊活動記舊網域，同一人用新信箱確認不能被擋");
  assert.match(cf, /@\(yahooinc\|yahootwec\)\\\.com\$/, "新舊兩個公司網域都剝掉才比");
  assert.match(cf, /writeMeta\(id, \{ heroBgLicenseConfirm: confirmRec \}\)/, "確認紀錄寫 wb_meta＝出口判定的真源");
  assert.match(cf, /sha256: ownC\.sha256/, "紀錄綁這組圖的指紋——換圖＝自動失效");
  assert.match(cf, /source: srcOf\(req\)/, "記來源（78 §三 8）");
  assert.match(SERVER, /confirmed 由前端接著走既有 hero-combo PUT/, "不新增草稿寫入點（G3 基線不動）");
  assert.match(SERVER, /heroBgLic\.ownConfirmMatches\(\{ heroBgOwn: changeC\.heroBgOwn \}, confP\)/, "PUT 投影：confirmed 只能來自 wb_meta 真源，手貼假確認會被抹掉");
  const depStart2 = SERVER.indexOf('own 發佈門');
  const dep2 = SERVER.slice(depStart2, depStart2 + 1400);
  assert.match(dep2, /ownConfirmMatches/, "發佈路：確認相符才放行");
  assert.match(dep2, /DEPLOY_HOLD_UNCONFIRMED/, "發佈路擋句＝「就能發佈」那句（過目定稿）");
  const run2 = SERVER.slice(SERVER.indexOf("背景的家甲案"), SERVER.indexOf("const stamp = stampDraftJson"));
  assert.match(run2, /resolveOwnFileMap\(djD\.page, runDir\)/, "發佈複製：同一套路徑立法");
  assert.match(run2, /活動自備背景/, "圖的家＝deploy-site/活動自備背景/<id>/（抄待審背景先例）");
  assert.match(SERVER, /DEPLOY_MINE: "live-drafts:activity-creation\/batches\.json:活動自備背景"/, "發佈健檢認得這是本線在途");
  assert.match(SERVER, /purgeOwnSiteAssets/, "永久刪除連站上的圖一起清（story 驗收 4：沒有清理規則就不要開始）");
  assert.match(SERVER, /heroBgLicenseConfirm: meta\.heroBgLicenseConfirm \|\| null/, "活動清單每筆要帶確認紀錄——漏這欄＝確認完畫面永遠畫回未確認、欄位歸零（2026-09-29 使用者走查第 3 步實抓）");
  assert.match(INDEX, /btn\.textContent = "確認中…"/, "按下確認當下要有反饋（同一步走查）");
  assert.doesNotMatch(require("fs").readFileSync(require("path").join(__dirname, "..", "..", "lib", "hero_combo.js"), "utf8"), /三張齊 → 已套用；頁尾標/, "面板底部那句過期狀態已裁撤（2026-09-29 使用者走查）——狀態只住上傳區塊一處");
});

test("門⑦-2｜own 圖出門三條路共用同一套路徑立法：AEM 內嵌走 resolveOwnFileMap＋data URI、ZIP 隨包走 resolveOwnFileMap＋改寫 files、exportAem 把 runDir 交給組裝器", () => {
  assert.match(AEM, /resolveOwnFileMap\(pg, opts\.runDir\)/, "AEM 內嵌：路徑解析只用 hero_bg_own 的單一立法");
  assert.match(AEM, /沒拿到活動資料夾位置/, "AEM：缺 runDir＝紅燈出聲，不靜默交付沒背景的檔（2026-09-29 病例）");
  const zip2 = SERVER.slice(SERVER.indexOf("async function exportZip"), SERVER.indexOf("async function exportAem"));
  assert.match(zip2, /heroBgOwn\.resolveOwnFileMap\(dj\.page, runDir\)/, "ZIP 隨包：同一套路徑立法");
  assert.match(zip2, /hero-bg\/\$\{ent\.file\}/, "ZIP：data.js 的 files 改寫成包內相對路徑");
  assert.match(SERVER, /assembleAemHtml\(\{ template: tpl, draft: dj, deps, mode: "slim", opts: \{ runDir, holdOpts \} \}\)/, "exportAem 要把 runDir 交給組裝器，否則 own 圖嵌不進去");
});

test("門⑨｜server 路由：hero-bg POST／DELETE／GET 檔、hero-kit GET 都在；上傳不寫草稿（writeComboIntoDraft 呼叫點仍 2）；hero-combo 收三欄並驗檔在", () => {
  assert.match(SERVER, /seg\[3\] === "hero-bg" && seg\.length === 4 && req\.method === "POST"/);
  assert.match(SERVER, /seg\[3\] === "hero-bg" && seg\.length === 4 && req\.method === "DELETE"/);
  assert.match(SERVER, /seg\[3\] === "hero-bg" && seg\.length === 5 && req\.method === "GET"/);
  assert.match(SERVER, /seg\[3\] === "hero-kit" && req\.method === "GET"/);
  assert.strictEqual((SERVER.match(/heroCombo\.writeComboIntoDraft\(/g) || []).length, 2);
  assert.match(SERVER, /heroBgOwn: bC\.heroBgOwn, heroTitleHidden: bC\.heroTitleHidden, heroMarqueeHidden: bC\.heroMarqueeHidden/);
  assert.match(SERVER, /heroBgOwn\.parseOwnApiPath\(rel\)/, "PUT 驗檔走單一路徑立法（2026-09-29）"); assert.match(SERVER, /fs\.existsSync\(path\.join\(runDir, heroBgOwn\.DIRNAME, pp\.file\)\)/);
  assert.match(SERVER, /heroBgOwn\.isOwnFileName\(seg\[4\]\)/);
});

test("門⑩｜引擎：藏標題表鍵集合＝lib 文字槽表；每款有選擇器；日期／折數不另留；跑馬帶只在獨立表；own 合成條目＋掛牌字＋每次重寫；吸收函式藏態不動", () => {
  const hide = evalObj(objectLiteral("const HV2_TITLE_HIDE = {"));
  const mq = evalObj(objectLiteral("const HV2_MARQUEE_HIDE = {"));
  assert.deepEqual(Object.keys(hide).sort(), Object.keys(HERO_TEXT_PIECES).sort(), "藏標題表與 lib HERO_TEXT_PIECES 版式鍵不同步");
  for (const [k, sels] of Object.entries(hide)) { assert.ok(Array.isArray(sels) && sels.length && sels.every((x) => typeof x === "string" && x.startsWith(".")), `${k} 選擇器空或不是 class`); }
  assert.ok(!hide["layout-012"].includes(".l12-marquee") && mq["layout-012"].includes(".l12-marquee"), "跑馬帶＝獨立開關，不在標題表");
  assert.match(SRC, /function hv2ApplyTitleHidden\(pg\)/);
  assert.match(SRC, /document\.body\.setAttribute\("data-hero-title", hidden \? "hidden" : "shown"\)/);
  assert.match(SRC, /stage\.setAttribute\("role", "img"\); stage\.setAttribute\("aria-label", t\)/, "報讀補償：舞台當有替代文字的圖");
  assert.match(SRC, /h1\.textContent = t/, "報讀補償：h1 改吃主視覺主標段");
  assert.match(SRC, /map\.own = \{ file: ownF\("desktop"\), deviceFiles: \{ "768": ownF\("768"\)/, "applyHeroBg 要有 own 合成條目（帶版本參數：同檔名換圖必重抓）");
  assert.match(SRC, /"\?v=" \+ encodeURIComponent/, "own 圖 URL 要帶指紋版本參數");
  assert.match(SRC, /licenseText: "背景版權：活動負責人確認中"/);
  assert.match(SRC, /if \(wmOn && wm\) wm\.textContent = wmText;/, "浮水印字每次重寫");
  assert.ok((SRC.match(/data-hero-title"\) === "hidden"\) return;/g) || []).length >= 5, "五支手機吸收函式藏態要早退（板位不動）");
  assert.match(SRC, /cfg\.contentSel && document\.body\.getAttribute\("data-hero-title"\) !== "hidden"/, "桌機可視窗藏態不縮");
  assert.match(SRC, /try \{ hv2ApplyTitleHidden\(pg\); \}/, "loadDraftJson 要套");
  assert.ok(!/function hv2ApplyTitleHiddenL0\d\d|hv2ApplyTitleHiddenS1/.test(SRC), "新函式名不得帶版式代號（AEM 瘦身會剪空）");
});

test("門⑪｜前端：下拉有「你上傳的背景」、上傳三格與兩勾選、藏標題／跑馬帶開關接 comboApply、AEM 對話框先擋", () => {
  assert.match(INDEX, /<option value="own" \$\{cur === "own" \? "selected" : ""\}>你上傳的背景<\/option>/);
  for (const fn of ["heroBgOwnBlock", "heroBgUpload", "heroBgRemove", "heroBgOwnComplete"]) assert.ok(INDEX.includes("function " + fn), fn + " 要存在");
  assert.match(INDEX, /data-own-slot="\$\{k\}"/);
  assert.match(INDEX, /\?v=\$\{ver\(k\)\}/, "縮圖 URL 帶指紋版本參數（同檔名換圖必重抓）");
  assert.match(INDEX, /URL\.createObjectURL\(file\)/, "選檔當下即時顯示本機圖（不只靠 toast）");
  assert.match(INDEX, /上傳中…<\/div>/, "上傳中狀態要看得見");
  assert.match(INDEX, /id="combo-own-commercial"/); assert.match(INDEX, /id="combo-own-resp"/); assert.match(INDEX, /id="combo-own-source"/);
  assert.match(INDEX, /圖上若有文字（含價格、折數、日期）・我自己寫的，平台不核對 → 出錯由我負責/, "責任確認文案照 78 號 §三 7 過目稿");
  assert.match(INDEX, /圖上文字・你負責 → 平台不核對/, "藏標題開關下方一行");
  assert.match(INDEX, /toast\("先勾責任確認 → 才能上傳", true\)/);
  assert.doesNotMatch(INDEX, /combo-own-noprice/);
  assert.match(INDEX, /comboApply\(\{ heroTitleHidden: thd\.checked \? true : null \}\)/);
  assert.match(INDEX, /comboApply\(\{ heroMarqueeHidden: mqh\.checked \? true : null \}\)/);
  assert.match(INDEX, /comboKv\(\) === "layout-012" \?/, "跑馬帶開關只在霓虹夜市款出現");
  assert.ok(INDEX.includes("async function heroKitDownload("), "下載前先問模式的對話框");
  assert.match(INDEX, /hero-kit\?mode=\$\{mode\}/); assert.match(INDEX, /單純活動背景圖/); assert.match(INDEX, /背景圖＋活動文案/);
  assert.match(SERVER, /u\.searchParams\.get\("mode"\)/, "server 讀 mode");
  const ui = INDEX.slice(INDEX.indexOf("async function exportAemUi("), INDEX.indexOf("async function downloadAemFile("));
  /* 2026-09-29 確認制：對話框只擋「own 未確認／換圖」並指路；藏標題不再擋 */
  assert.match(ui, /backgroundId === "own"/, "own 才進確認判定");
  assert.doesNotMatch(ui, /heroTitleHidden === true/, "藏標題不再擋製作（牆 1 甲）");
  assert.match(ui, /confX\.sha256 === ownX\.sha256/, "對話框先擋＝以指紋相符判、與伺服器同一把尺");
  assert.match(ui, /版權確認要重做一次/, "換圖態講換圖句");
  assert.ok(INDEX.includes("async function heroBgConfirm("), "確認函式要存在");
  assert.match(INDEX, /hero-bg-confirm/, "打確認端點");
  assert.match(INDEX, /id="combo-own-confirm-chk"/); assert.match(INDEX, /id="combo-own-confirm-acct"/); assert.match(INDEX, /id="combo-own-confirm-btn"/);
  assert.match(INDEX, /我確認這張背景圖可以用在 Yahoo 購物活動頁，且圖上沒有價格、折數、檔期。/, "確認框文案照 78 §三 7 過目稿");
  assert.match(INDEX, /系統會記錄帳號、時間與這張圖的檔案指紋。/);
  assert.match(INDEX, /背景版權・已確認 → 可以製作與發佈/, "已確認態＝過目定稿那句");
  /* 上傳後走同一條寫入路 */
  const up = INDEX.slice(INDEX.indexOf("async function heroBgUpload("), INDEX.indexOf("async function heroBgRemove("));
  assert.match(up, /comboApply\(change\)/); assert.match(up, /files\.desktop\) change\.backgroundId = "own"/, "桌機在就先套預覽");
});

test("門⑫｜CP-35 絆線豁免 own（圖不進地圖）", () => {
  const t = fs.readFileSync(path.join(PIPE, "test", "unit", "bg_map_resolves_used_backgrounds.test.js"), "utf8");
  assert.match(t, /v !== "own"/);
});

test("上傳體檢｜sharp 現做圖：尺寸夠＝收、太小／方向錯／手機過重／來源答案缺＝白話擋；三格齊才 complete；桌機量銜接色", async () => {
  const sharp = require("sharp");
  const mk = (w, h, bg = { r: 240, g: 236, b: 228 }) => sharp({ create: { width: w, height: h, channels: 3, background: bg } }).png().toBuffer();
  const runDir = fs.mkdtempSync(path.join(os.tmpdir(), "own-bg-"));
  const answers = { source: "設計部提供", commercial: true, responsibility: true };
  const base = { runDir, runId: "r1", layoutId: "layout-002", mime: "image/png", name: "x.png", answers, uploadedBy: "a@yahootwec.com", mobileMaxKB: 400 };
  let r = await own.uploadOwnSlot({ ...base, slot: "desktop", buf: await mk(1200, 600) });
  assert.strictEqual(r.ok, false); assert.match(r.error, /至少 2880×1120/);
  r = await own.uploadOwnSlot({ ...base, slot: "desktop", buf: await mk(1200, 2880) });
  assert.strictEqual(r.ok, false); assert.match(r.error, /要橫的/);
  r = await own.uploadOwnSlot({ ...base, slot: "desktop", buf: await mk(2880, 1120), answers: { ...answers, responsibility: false } });
  assert.strictEqual(r.ok, false); assert.match(r.error, /先勾責任確認 → 才能上傳/, "責任確認未勾＝400（使用者 2026-09-27 裁）");
  r = await own.uploadOwnSlot({ ...base, slot: "desktop", buf: await mk(2880, 1120), answers: { ...answers, source: "網路找的" } });
  assert.strictEqual(r.ok, false); assert.match(r.error, /這張圖哪來的/);
  r = await own.uploadOwnSlot({ ...base, slot: "desktop", buf: await mk(2880, 1120) });
  assert.strictEqual(r.ok, true, r.error); assert.strictEqual(r.complete, false); assert.deepEqual(r.missing, ["768", "375"]);
  assert.match(r.heroBgOwn.files.desktop, /^\/api\/runs\/r1\/hero-bg\/desktop\.webp$/, "頁面用的是處理後的 WebP");
  assert.match(String(r.heroBgOwn.bridgeColor), /^#[0-9A-F]{6}$/, "桌機要量出銜接色");
  assert.ok(fs.existsSync(path.join(runDir, "hero-bg", "desktop.webp")) && fs.existsSync(path.join(runDir, "hero-bg", "original-desktop.png")), "處理後檔＋原檔都在");
  assert.strictEqual(r.heroBgOwn.sizeCheck.desktop.original.w, 2880); assert.ok(r.heroBgOwn.sizeCheck.desktop.bytes <= 800 * 1024, "桌機壓到 800KB 內");
  r = await own.uploadOwnSlot({ ...base, slot: "768", buf: await mk(1536, 1120), existing: r.heroBgOwn });
  assert.strictEqual(r.ok, true, r.error); assert.deepEqual(r.missing, ["375"]);
  const mobileOk = await mk(750, 900);
  r = await own.uploadOwnSlot({ ...base, slot: "375", buf: mobileOk, existing: r.heroBgOwn });
  assert.strictEqual(r.ok, true, r.error); assert.strictEqual(r.complete, true); assert.deepEqual(r.missing, []);
  assert.strictEqual(r.heroBgOwn.sha256.length, 64);
  /* 換一張手機版＝Gemini 常給 2～3 倍大的圖：等比縮到剛好尺寸、不裁（使用者 2026-09-27 裁四題照建議） */
  const big = await own.uploadOwnSlot({ ...base, slot: "375", buf: await mk(1952, 2208), existing: r.heroBgOwn });
  assert.strictEqual(big.ok, true, big.error); assert.strictEqual(big.w, 750); assert.strictEqual(big.h, 848, "1952×2208 對 750×848 需求＝等比縮到剛好、不裁");
  assert.strictEqual(big.heroBgOwn.sizeCheck["375"].scaled, true); assert.ok(big.bytes <= 400 * 1024); assert.strictEqual(big.complete, true);
  r = big;
  const heavy = await own.uploadOwnSlot({ ...base, slot: "375", buf: mobileOk, existing: r.heroBgOwn, mobileMaxKB: 1 });
  assert.strictEqual(heavy.ok, false); assert.match(heavy.error, /壓到最小還有/, "壓到品質 70 仍超標＝退件講明");
  assert.strictEqual(await own.uploadOwnSlot({ ...base, slot: "375", buf: await mk(900, 750), existing: r.heroBgOwn }).then((x) => x.ok), false, "手機橫的不行");
  assert.strictEqual(own.removeOwnBg(runDir), 6, "三張處理後檔＋三張原檔都要刪");
  assert.ok(!fs.existsSync(path.join(runDir, "hero-bg")));
  /* 2026-09-27 走查抓到：連傳三格、草稿還沒回寫（existing 全空）時，第二三格要從磁碟重建、不得漏格；銜接色也不得被洗掉 */
  const runDir2 = fs.mkdtempSync(path.join(os.tmpdir(), "own-bg2-"));
  const b2 = { ...base, runDir: runDir2 };
  await own.uploadOwnSlot({ ...b2, slot: "desktop", buf: await mk(2880, 1120, { r: 214, g: 196, b: 170 }) });
  await own.uploadOwnSlot({ ...b2, slot: "768", buf: await mk(1536, 1120) });
  const r3 = await own.uploadOwnSlot({ ...b2, slot: "375", buf: await mk(750, 900) });
  assert.strictEqual(r3.complete, true, "不帶 existing 連傳三格也要齊（磁碟為真相）");
  assert.strictEqual(String(r3.heroBgOwn.bridgeColor).toUpperCase(), "#D6C4AA", "銜接色＝桌機圖底緣均色，不被後兩格洗掉");
  own.removeOwnBg(runDir2);
});

test("說明包｜依版式代入數字、禁詞不出現、檔名帶活動名", () => {
  const { buildHeroBgKit } = require("../../lib/hero_bg_kit.js");
  const k = buildHeroBgKit({ layoutId: "layout-011", layoutName: "中秋團圓・茶點零嘴", skeleton: "左標語・右商品", pageName: "中秋", maxKB: 400 });
  assert.match(k.markdown, /2880×1560/); assert.match(k.markdown, /1536×1120/); assert.match(k.markdown, /750×1480/);
  /* 提示詞照版式、照裝置（2026-09-27 使用者實測：Gemini 插畫壓到標題）：硬規格＋安靜區／商品區／插畫帶＋淡化與間距 */
  assert.match(k.markdown, /輸出尺寸必須剛好 2880×1560 像素/); assert.match(k.markdown, /檔案大小不用擔心/, "系統會壓，不再叫人自己壓");
  /* 文字做進圖裡（2026-09-27 使用者要測）：跟著 heroTitleHidden 切模式，帶入主標與被收掉的其他文字段，真值仍禁入 */
  const kt = buildHeroBgKit({ layoutId: "layout-009", layoutName: "聯名促銷型", skeleton: "左標語・右商品", pageName: "x", maxKB: 400, heroTitleHidden: true, hero: { "slogan-left": "星巴克情人節\u2028送禮選物\n星巴克｜週邊禮物" } });
  assert.ok(kt.withText); assert.match(kt.markdown, /主標：「星巴克情人節 送禮選物」/); assert.match(kt.markdown, /品牌帶（小字、放主標上方或下方）：「星巴克｜週邊禮物」/);
  assert.match(kt.markdown, /除了上面指定的文字，不要出現任何其他文字/); assert.match(kt.markdown, /平台不會替你檢查，圖上的文字由你負責/, "提醒、不是禁令（使用者 2026-09-27 裁）"); assert.doesNotMatch(kt.markdown, /不可以做進圖裡/);
  assert.match(kt.markdown, /先把文案寫好，再貼提示詞/); assert.match(kt.markdown, /第 6 步・上傳並確認/);
  assert.doesNotMatch(kt.markdown, /【不要出現】文字、字母、數字/);
  const k0 = buildHeroBgKit({ layoutId: "layout-009", layoutName: "聯名促銷型", skeleton: "左標語・右商品", pageName: "x", maxKB: 400, heroTitleHidden: false, hero: {} });
  assert.ok(!k0.withText); assert.match(k0.markdown, /【不要出現】文字、字母、數字/); assert.match(k0.markdown, /這份是「單純活動背景圖」版/);
  /* 模式由下載對話框明講（2026-09-27 使用者回饋）：mode 蓋過開關；對話主控提示詞裝齊規格、版面、文案、逐題流程與三裝置連出 */
  const km = buildHeroBgKit({ layoutId: "layout-009", layoutName: "聯名促銷型", skeleton: "左標語・右商品", pageName: "星巴克", maxKB: 400, heroTitleHidden: false, mode: "text", theme: "秀新品或熱銷，不喊優惠", themeId: "blue-dark", hero: { "slogan-left": "星巴克情人節\n星巴克｜週邊" } });
  assert.ok(km.withText, "mode=text 蓋過開關關"); assert.match(km.markdown, /這份是「背景圖＋活動文案」版/);
  assert.match(km.markdown, /## 三、用一段對話讓 Gemini 帶你做完/); assert.match(km.markdown, /第 2 題・亮底或暗底/); assert.match(km.markdown, /第 4 題・文字排版與字型/); assert.match(km.markdown, /第 5 題・文字最後確認/); assert.match(km.markdown, /建議暗底/, "themeId 含 dark＝建議暗底");
  assert.match(km.markdown, /- 桌機版：剛好 2880×1120 像素/); assert.match(km.markdown, /- 手機版：剛好 750×1164 像素/); /* 582×2（2026-10-05 品名兩行批：l009 手機舞台 564→582） */
  assert.match(km.markdown, /活動主題／型態＝「秀新品或熱銷，不喊優惠」/); assert.match(km.markdown, /依序做桌機版、平板版、手機版三張/);
  assert.match(km.markdown, /對話中斷或 Gemini 忘了規則/); assert.match(km.markdown, /## 三之二、備用：三段裝置提示詞/);
  const kb = buildHeroBgKit({ layoutId: "layout-009", layoutName: "聯名促銷型", skeleton: "左標語・右商品", pageName: "x", maxKB: 400, heroTitleHidden: true, mode: "bg", hero: {} });
  assert.ok(!kb.withText, "mode=bg 蓋過開關開"); assert.match(kb.markdown, /第 3 題・參考圖/); assert.doesNotMatch(kb.markdown, /文字排版與字型/); assert.match(kb.markdown, /預設為亮底/, "沒有 themeId＝預設亮底"); assert.match(kb.markdown, /【明暗】整張亮底/);
  assert.match(k.markdown, /安靜區（活動文字會直接壓在這裡）：水平 \d+%～\d+%、垂直 \d+%～\d+%/);
  assert.match(k.markdown, /商品區（商品卡會蓋住這裡/); assert.match(k.markdown, /靠近安靜區的那一側要淡出/);
  const k2 = buildHeroBgKit({ layoutId: "layout-002", layoutName: "攝影棚", skeleton: "左右商品・中間標題", pageName: "x", maxKB: 400 });
  const mobileSeg = k2.markdown.slice(k2.markdown.indexOf("### 手機版"), k2.markdown.indexOf("### 已經有一張"));
  assert.match(mobileSeg, /標題左側（水平 0%～\d+%/, "攝影棚手機版：插畫該放標題兩側（使用者 2026-09-27 觀察）"); assert.match(mobileSeg, /標題右側/);
  const deskSeg = k2.markdown.slice(k2.markdown.indexOf("### 桌機版"), k2.markdown.indexOf("### 平板版"));
  assert.match(deskSeg, /上方橫帶/); assert.match(deskSeg, /下方橫帶/); assert.match(deskSeg, /商品卡在左右兩側/);
  assert.match(deskSeg, /比例約 2\.57:1/);
  for (const re of [/layout-\d{3}/, /\bAI\b/, /manifest/, /rollout/, /映射表/, /灰度/, /值域/, /§/]) assert.doesNotMatch(k.markdown, re);
  assert.strictEqual(k.fileName, "背景製作說明-中秋.md");
  assert.match(k.markdown, /價格、折數、檔期、網址/);
});
