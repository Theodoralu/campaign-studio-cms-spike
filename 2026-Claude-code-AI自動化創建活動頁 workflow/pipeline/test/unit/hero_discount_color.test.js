"use strict";
/**
 * hero 的價格與折數顏色要能設定（2026-09-27 使用者拍板推翻「價格顏色恆定」）。
 * 裁決牆＝規劃/qa/hero-price-discount-color-wall-2026-09-27.html：Q1 甲（只動 hero）／Q2 改題（折數獨立角色 Discount、不掛 Price）／
 * Q3 乙（圓章底、字各一列）／Q4 甲（三款同源、板值後備＝沒設定零像素變化）／Q5 乙（可讀性掃描疊圖取樣、出聲不擋）。
 * story＝docs/stories/hero-price-discount-color-settable.md
 *
 * 守三份真源＋兩份機器複本的對帳：配色引擎 palette-engine（角色／映射／檢查／變數）、活動頁引擎 FrameTest（三閘＋板值後備）、
 * 色彩工具頁（角色列／打包）、工具頁的 PALETTE_ENGINE 注入塊、deploy-site 引擎鏡像。畫面實測在無頭瀏覽器（story 驗收紀錄）。
 * 同事包情境（root 真源不在）＝略過，不假紅。
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..", "..", "..", "..");
const PL = path.join(ROOT, "2026-AI自動化活動頁生成規劃");
const ENGINE = path.join(PL, "MVP_Phase1_LeCreuset_活動頁Prototype_FrameTest.html");
const MIRROR = path.join(PL, "deploy-site", "lecreuset-frametest", "index.html");
const TOOL = path.join(PL, "活動頁色彩策略工具.html");
const PE_PATH = path.join(ROOT, "design-tokens", "palette-engine.js");
const has = (p) => fs.existsSync(p);
const HEX = /^#[0-9A-Fa-f]{6}$/;
const BASE_COLORS = { brand: "#3E5BFD", hero: "#EEF1FF", headline: "#191919", cta: "#3E5BFD", price: "#EB0F29", accent: "#F26591", surface: "#FFFFFF", text: "#344054" };

test("配色引擎：discount 是獨立角色——三列映射有、預設對到自己、每個日系盤都帶、覆寫只動它不連動 price", (t) => {
  if (!has(PE_PATH)) { t.skip("palette-engine 不在（同事包情境）"); return; }
  const PE = require(PE_PATH);
  assert.ok(/^1\.3\./.test(PE.version), `版本要 1.3.x（現 ${PE.version}）`);
  const rows = Object.fromEntries(PE.moduleComponents);
  assert.strictEqual(rows.discount, "活動標題折扣數字");
  assert.strictEqual(rows.discountBadge, "折扣圓章底");
  assert.strictEqual(rows.discountBadgeText, "折扣圓章字");
  assert.strictEqual(PE.moduleMappingDefaults.discount, "discount", "Q2 改題：折數預設對到自己的角色、不掛 Price");
  assert.strictEqual(PE.moduleMappingDefaults.discountBadge, "accent");
  assert.strictEqual(PE.moduleMappingDefaults.discountBadgeText, "text");
  for (const p of PE.nipponList) assert.match(String(p.colors.discount), HEX, `${p.id} 缺 discount`);
  const r = PE.applyDesignerOverrides({ colors: { ...BASE_COLORS } }, { colorOverrides: { discount: "#123456" } });
  assert.strictEqual(r.colors.discount, "#123456");
  assert.strictEqual(r.colors.price, "#EB0F29", "改折數不能連動價格");
  const r2 = PE.applyDesignerOverrides({ colors: { ...BASE_COLORS } }, { colorOverrides: { price: "#654321" } });
  assert.strictEqual(r2.colors.price, "#654321");
  assert.strictEqual(r2.colors.discount, "#EB0F29", "改價格不能連動折數（起步同值、之後各走各的）");
  assert.strictEqual(PE.mappedColor(r.colors, null, "discount", "discount"), "#123456", "折數列走預設映射＝吃 discount 角色");
  assert.strictEqual(PE.mappedColor(r.colors, { discount: "headline" }, "discount", "discount"), "#191919", "映射改對到 Headline 就吃 Headline");
});

test("配色引擎：可讀性檔多兩列（折扣數字對 hero 底、圓章字對圓章底，門檻 3）；交付 CSS 變數多三支；deriveTheme 槽位帶三槽", (t) => {
  if (!has(PE_PATH)) { t.skip(); return; }
  const PE = require(PE_PATH);
  const rows = PE.readabilityChecks({ ...BASE_COLORS, discount: "#EB0F29" }, [], {});
  const names = rows.map((r) => r[0]);
  assert.ok(names.some((n) => n.startsWith("折扣數字")), names.join("｜"));
  assert.ok(names.some((n) => n.startsWith("折扣圓章")), names.join("｜"));
  assert.strictEqual(rows.find((r) => r[0].startsWith("折扣數字"))[2], 3, "折數是大字＝門檻 3");
  const src = fs.readFileSync(PE_PATH, "utf8");
  for (const v of ["--campaign-discount", "--campaign-discount-badge", "--campaign-discount-badge-text"]) assert.ok(src.includes(`'  ${v}: '`), `cssVars 缺 ${v}`);
  assert.match(src, /discount: mappedColor\(colors, mapping, "discount", "discount"\),\n\s+discountBadge: mappedColor\(colors, mapping, "discountBadge", "accent"\),\n\s+discountBadgeText: mappedColor/, "deriveTheme slots 要帶三槽");
});

test("活動頁引擎：三支變數進清理名單、三個 cc-* 進槽開關名單、themeDraft 三槽 set＋class、三款折數同源、板值後備原樣（Q4 甲）", (t) => {
  if (!has(ENGINE)) { t.skip("引擎源檔不在（同事包情境）"); return; }
  const src = fs.readFileSync(ENGINE, "utf8");
  const vars = src.slice(src.indexOf("const HV2_THEME_VARS"), src.indexOf("const CC_SLOT_CLASSES"));
  for (const v of ["--campaign-discount", "--campaign-discount-badge", "--campaign-discount-badge-text"]) assert.ok(vars.includes(`"${v}"`), `HV2_THEME_VARS 缺 ${v}（換草稿時清不掉＝殘色）`);
  assert.match(src, /CC_SLOT_CLASSES = \[[^\]]*"cc-discount","cc-discountbadge","cc-discountbadgetext"\]/);
  assert.match(src, /set\("--campaign-discount", hex\(cc\.discount\)\); if \(hex\(cc\.discount\)\) b\.classList\.add\("cc-discount"\);/);
  assert.match(src, /set\("--campaign-discount-badge", hex\(cc\.discountBadge\)\); if \(hex\(cc\.discountBadge\)\) b\.classList\.add\("cc-discountbadge"\);/);
  assert.match(src, /set\("--campaign-discount-badge-text", hex\(cc\.discountBadgeText\)\); if \(hex\(cc\.discountBadgeText\)\) b\.classList\.add\("cc-discountbadgetext"\);/);
  /* 三款同源＝都吃 --campaign-discount；後備＝各自板值（Q4 甲＋2026-09-27 裁丙：AEM 瘦身工具會丟不在它清單裡的變數，var() 沒後備＝繼承深灰） */
  const rules = src.match(/body\.cc-discount [^{]+\{color:var\(--campaign-discount,[^}]+\}/g) || [];
  assert.ok(rules.length >= 2, "缺 cc-discount 覆寫規則");
  const joined = rules.join("\n");
  for (const l of ["l003", "l009", "l007"]) for (const c of ["dc-num", "dc-unit"]) assert.ok(joined.includes(`body.cc-discount .hv2-${l} .${c}`), `${l} .${c} 沒接 --campaign-discount（三款要同源）`);
  assert.match(src, /body\.cc-discount \.hv2-l003 \.dc-num,body\.cc-discount \.hv2-l003 \.dc-unit,body\.cc-discount \.hv2-l009 \.dc-num,body\.cc-discount \.hv2-l009 \.dc-unit\{color:var\(--campaign-discount,#F4563E\)\}/, "003／009 後備＝板值促銷橘");
  assert.match(src, /body\.cc-discount \.hv2-l007 \.dc-num,body\.cc-discount \.hv2-l007 \.dc-unit\{color:var\(--campaign-discount,var\(--color-text,#191919\)\)\}/, "007 後備＝板值文字色");
  assert.match(src, /body\.cc-discountbadge \.hv2-l003 \.dc-badge,body\.cc-discountbadge \.hv2-l009 \.dc-badge\{background:var\(--campaign-discount-badge,#F6FFBA\)\}/);
  assert.match(src, /body\.cc-discountbadgetext \.hv2-l003 \.dc-badge,body\.cc-discountbadgetext \.hv2-l009 \.dc-badge\{color:var\(--campaign-discount-badge-text,#2F4C66\)\}/);
  /* 009 商品卡價格（2026-09-27 使用者走查報修）：第三種骨架 .hv2-s12 .s12-sale 也要聽 Price */
  assert.match(src, /body\.cc-price \.hv2-s10w \.pc-sale,body\.cc-price \.hv2-l001 \.pc-sale,body\.cc-price \.hv2-s12 \.s12-sale\{color:var\(--campaign-price-draft\)\}/, "008／009 的 hero 商品卡價格沒接 cc-price");
  /* 板值後備一個都不能動＝沒設定零像素變化，也是 spec fixture 的期望值（layout-003／009 三裝置寫 #F4563E） */
  assert.match(src, /\.hv2-l003 \.dc-num\{[^}]*color:#F4563E/); assert.match(src, /\.hv2-l003 \.dc-unit\{[^}]*color:#F4563E/);
  assert.match(src, /\.hv2-l009 \.dc-num\{[^}]*color:#F4563E/); assert.match(src, /\.hv2-l009 \.dc-unit\{[^}]*color:#F4563E/);
  assert.match(src, /\.hv2-l003 \.dc-badge\{[^}]*background:#F6FFBA;color:#2F4C66/); assert.match(src, /\.hv2-l009 \.dc-badge\{[^}]*background:#F6FFBA;color:#2F4C66/);
  assert.match(src, /\.hv2-l007 \.dc-num\{[^}]*color:var\(--color-text,#191919\)/);
});

test("引擎鏡像（deploy-site）跟上源頭：cc-discount 規則在", (t) => {
  if (!has(ENGINE) || !has(MIRROR)) { t.skip("鏡像或源頭不在"); return; }
  const m = fs.readFileSync(MIRROR, "utf8");
  assert.ok(m.includes("body.cc-discount .hv2-l003 .dc-num"), "鏡像沒跟上（跑 deploy-site/sync.sh）");
  assert.ok(m.includes('set("--campaign-discount", hex(cc.discount))'));
});

test("色彩工具：角色列有 Discount、對照表把價格與折數分開寫、打包帶三欄；PALETTE_ENGINE 注入塊已重產成 1.3.0（複本對帳）", (t) => {
  if (!has(TOOL)) { t.skip("工具頁不在"); return; }
  const src = fs.readFileSync(TOOL, "utf8");
  assert.match(src, /var colorRoleKeys = \["brand","hero","headline","cta","price","discount","accent","surface","text"\]/);
  assert.match(src, /\["discount","Discount \/ 折數色"/);
  assert.match(src, /\["price","Price \/ 價格色","campaign\/price\/sale","hero 商品卡價格、促銷價"\]/, "價格那列不能再寫「折扣」——兩個資訊層級要分開");
  assert.match(src, /discount:discountModuleColor,/); assert.match(src, /discountBadge:discountBadgeBg,/); assert.match(src, /discountBadgeText:discountBadgeTextColor/);
  const b = src.indexOf("===PALETTE_ENGINE:BEGIN==="), e = src.indexOf("===PALETTE_ENGINE:END===");
  assert.ok(b > 0 && e > b, "注入塊標記不在");
  const pe = src.slice(b, e);
  assert.ok(pe.includes('["discount","活動標題折扣數字"]'), "工具頁的引擎注入塊沒重產（跑 規劃/tools/sync-registry-to-colortool.mjs）");
  assert.ok(pe.includes('version: "1.3.0"'), "注入塊版本落後真源");
});

test("CMS 檢查層：提案包帶折數／圓章色＝兩條提醒級（不擋、不給一鍵換）；舊包沒帶＝零列", () => {
  const TD = require(path.join(__dirname, "..", "..", "lib", "theme_draft.js"));
  const td = { backgroundModules: [{ key: "hero", hex: "#F3EEE8" }], componentColors: { discount: "#F4F4F4", discountBadge: "#F6FFBA", discountBadgeText: "#FFFFFF" } };
  const rows = TD.checkThemeDraft(td, {});
  const d = rows.find((r) => r.name === "折扣數字"), bd = rows.find((r) => r.name === "折扣圓章文字");
  assert.ok(d && bd, rows.map((r) => r.name).join("｜"));
  assert.strictEqual(d.blocking, false); assert.strictEqual(bd.blocking, false);
  assert.strictEqual(d.pass, false, "近白折數壓米白 hero 必不過（用來確認真的在算）"); assert.strictEqual(d.suggest, null, "提醒級不給一鍵換");
  assert.strictEqual(bd.pass, false, "白字壓螢光黃圓章必不過");
  const ok = TD.checkThemeDraft({ backgroundModules: [{ key: "hero", hex: "#F3EEE8" }], componentColors: { discount: "#8E2F3C", discountBadge: "#2F4C66", discountBadgeText: "#FFFFFF" } }, {});
  assert.strictEqual(ok.find((r) => r.name === "折扣數字").pass, true); assert.strictEqual(ok.find((r) => r.name === "折扣圓章文字").pass, true);
  const none = TD.checkThemeDraft({ backgroundModules: [{ key: "hero", hex: "#F3EEE8" }], componentColors: { title: "#191919" } }, {});
  assert.ok(!none.some((r) => /折扣/.test(r.name)), "舊包沒帶兩欄＝天然 no-op");
});

test("可讀性掃描：疊圖改截圖取樣估算（隱藏整段再截）、只出聲、exit code 仍只看純色底", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "..", "tools", "contrast_scan.js"), "utf8");
  assert.match(src, /async function sampleOnImage\(p, hits\)/);
  assert.match(src, /el\.setAttribute\("data-cs-probe", String\(probe\)\)/);
  assert.match(src, /el\.style\.setProperty\("visibility", "hidden", "important"\)/, "隱藏整段（連襯字層），不是把字改透明");
  /* 「壓在圖上」三路判定（實測：hero 照片畫在 .hv2-bleed 兄弟層、預設底紋畫在 section::before，只看祖先 background-image＝折數永遠量不到） */
  assert.match(src, /const pseudoImg = \(n\) => \{ for \(const ps of \["::before", "::after"\]\)/, "②祖先偽元素底紋");
  assert.match(src, /const siblingImg = \(el, r, scope\) => \{/, "③同容器兄弟圖層");
  assert.match(src, /if \(acc\.a > 0\.995\) \{ if \(!img\) img = siblingImg\(el, r, n\); return \{ color: acc, from: n, img \}; \}/, "兄弟層只認住在文字實際坐著的不透明容器裡的");
  assert.match(src, /if \(cr >= need && !bk\.img\) return;/, "疊圖的一律送去取樣（單色估過了也要量）");
  assert.match(src, /await sampleOnImage\(p, hits\);\s*\/\*[^*]*\*\/\s*\n\s*hits\.forEach\(\(h\) => all\.push/, "取樣要在把命中收進 all 之前跑");
  assert.match(src, /process\.exit\(real\.length \? 1 : 0\);\n\}\)\(\);\s*$/, "exit code 仍只看純色底的 real");
  assert.ok(!/below\.length \? 1|onImg\.length \? 1/.test(src), "疊圖估算不得進 exit code");
});
