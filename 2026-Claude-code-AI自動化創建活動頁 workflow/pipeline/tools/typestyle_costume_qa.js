#!/usr/bin/env node
/* typestyle_costume_qa.js —— 字風「換妝＋排版控制」視覺 Design QA（看畫面，不看屬性）
 *
 * 為什麼有這支：2026-09-05 設計師在色彩工具連報五件（像素字風不變色／N3 排版控制沒反應／
 * N6 換妝後文字下方出色塊／A4 換妝後漸層色塊重疊／B3 換妝後底紋要比字深）。這些全是
 * 「工具端算出換妝 CSS → 塞進真引擎 iframe」這條路上的**視覺**問題，量 computed style 抓不到
 * （typo_matrix 對 N3 四格全綠、設計師卻看不到變化＝量的是程式屬性、看的是畫面，08-30 教訓）。
 *
 * 做法＝走設計師真正走的路：自起一個同源小伺服器複刻工作台的 /colortool/ 與 /frametest/ 路由
 * （工作台那條要登入，無頭進不去），用真瀏覽器打開色彩工具頁、真的去選版式／字風／填主色／
 * 勾「妝容跟主題走」／拉滑桿，等引擎畫完，截 iframe，像素比對，最後排成一頁對照牆給人圈。
 *
 * 用法：node tools/typestyle_costume_qa.js [--only css-n3,css-a4] [--layouts layout-003,layout-006]
 *       [--brand #2BA6A0] [--out <dir>] [--no-open]
 */
const path = require("path");
const fs = require("fs");
const http = require("http");
const { chromium } = require("playwright-core");
const sharp = require("sharp");

const ROOT = path.resolve(__dirname, "..", "..", "..");
const PLAN_DIR = path.join(ROOT, "2026-AI自動化活動頁生成規劃");
const DEPLOY_SITE = path.join(PLAN_DIR, "deploy-site");
const FRAMETEST_DIR = path.join(DEPLOY_SITE, "lecreuset-frametest");
const TS_MANIFEST = path.join(ROOT, "design-assets", "typestyles", "manifest.json");
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8",
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif", ".svg": "image/svg+xml", ".woff": "font/woff", ".woff2": "font/woff2", ".ttf": "font/ttf", ".otf": "font/otf", ".ico": "image/x-icon", ".txt": "text/plain; charset=utf-8" };

/* ── 同源小伺服器（唯讀；路由與 workbench/server.js 1265～1296 同形，改路由要兩邊一起改） ── */
function safeJoin(base, rel) { const p = path.normalize(path.join(base, rel)); return p.startsWith(base) ? p : null; }
function serveFile(res, f) {
  if (!f || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end("not found"); return; }
  res.writeHead(200, { "Content-Type": MIME[path.extname(f).toLowerCase()] || "application/octet-stream", "Cache-Control": "no-store" });
  fs.createReadStream(f).pipe(res);
}
function startServer() {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      const u = decodeURIComponent((req.url || "/").split("?")[0].split("#")[0]);
      const seg = u.split("/").filter(Boolean);
      const rest = (n) => seg.slice(n).join("/");
      if (seg[0] === "colortool") return serveFile(res, safeJoin(PLAN_DIR, rest(1) || "活動頁色彩策略工具.html"));
      if (seg[0] === "ds-site-nav.js") return serveFile(res, path.join(PLAN_DIR, "tools", "ds-site-nav.js"));
      if (seg[0] === "design-assets") return serveFile(res, safeJoin(path.join(ROOT, "design-assets"), rest(1)));
      if (seg[0] === "design-proposal-kit") return serveFile(res, safeJoin(path.join(ROOT, "design-proposal-kit"), rest(1)));
      if (seg[0] === "frametest") {
        if (seg[1] === "assets" && seg[2] === "hero-bg") { const fh = safeJoin(path.join(PLAN_DIR, "assets", "hero-bg"), rest(3)); if (fh && fs.existsSync(fh)) return serveFile(res, fh); }
        return serveFile(res, safeJoin(FRAMETEST_DIR, rest(1) || "index.html"));
      }
      if (seg[0] === "活動版型去背商品" || seg[0] === "活動版型待審背景") return serveFile(res, safeJoin(path.join(DEPLOY_SITE, seg[0]), rest(1)));
      res.writeHead(404); res.end("not found");
    });
    srv.listen(0, "127.0.0.1", () => resolve({ srv, port: srv.address().port }));
  });
}

/* ── 在工具頁上「像設計師一樣操作」，然後等引擎真的畫完 ── */
async function drive(page, want) {
  // want = { layout, style, brand, mode, costume, tracking(%), leading(x100), width(%) }
  const r = await page.evaluate(async (w) => {
    const $ = (id) => document.getElementById(id);
    const fire = (el, type) => el.dispatchEvent(new Event(type, { bubbles: true }));
    const set = (id, v, types) => { const el = $(id); if (!el) return false; el.value = String(v); (types || ["input", "change"]).forEach((t) => fire(el, t)); return true; };
    if ($("comboLayout").value !== w.layout) set("comboLayout", w.layout, ["change"]);
    if ($("titleText") && $("titleText").value !== w.title) set("titleText", w.title, ["input", "change"]);
    if (w.capsule != null && $("titleCapsule")) set("titleCapsule", w.capsule, ["input", "change"]); /* 005 膠囊字（2026-09-05） */ // 兩行標題＝行距才看得到；跟設計師截圖同文案
    set("titleStyle", w.style, ["change"]);
    set("themeMode", w.mode, ["change"]);
    set("brandHex", w.brand, ["input", "change"]);
    const box = $("costumeFollowTheme"); if (box && box.checked !== !!w.costume) { box.checked = !!w.costume; fire(box, "change"); }
    const gw = $("groupWarpOn"); if (gw && gw.checked !== !!w.warp) { gw.checked = !!w.warp; fire(gw, "change"); } /* 同組文字一起變形（2026-09-05） */
    if (w.subFont && $("subtitleFont")) set("subtitleFont", w.subFont, ["change"]); /* 副標字體（除錯 2026-09-05） */
    set("heroLetterSpacing", w.tracking); set("heroLineHeight", w.leading); set("heroBlockWidth", w.width);
    if (typeof render === "function") render();
    const fr = $("engineFrame");
    const expectTy = {};
    if (w.tracking >= 2) expectTy.titleTracking = "lg"; else if (w.tracking <= -1) expectTy.titleTracking = "sm";
    if (w.width < 92.5) expectTy.titleWidth = "narrow"; else if (w.width > 107.5) expectTy.titleWidth = "wide";
    const t0 = Date.now(); let ok = false, why = "";
    while (Date.now() - t0 < 9000) {
      await new Promise((r) => setTimeout(r, 120));
      let d; try { d = fr && fr.contentWindow && fr.contentWindow.__hv2Draft; } catch (e) { why = "iframe 跨源？" + e.message; break; }
      const pg = d && d.page; if (!pg) continue;
      if (pg.kvVariant !== w.layout || pg.titleStyle !== w.style) continue;
      const ty = pg.typography || {};
      if ((expectTy.titleTracking || null) !== (ty.titleTracking || null)) continue;
      if ((expectTy.titleWidth || null) !== (ty.titleWidth || null)) continue;
      // 行距檔位要看引擎板原值量化，工具自己算；只要求 leading 滑桿被吃進去（有 titleLeading 欄或滑桿在標準附近）
      let cst = null; try { cst = fr.contentWindow.document.getElementById("hv2CostumeCss"); } catch (e) { why = why || ("讀不到引擎的換妝樣式節點：" + e.message); } /* 2026-09-05 接線上後＝引擎自算注入 #hv2CostumeCss */
      const costumeOn = !!(cst && cst.textContent.trim());
      let costumeExpected = false; try { const dp = fr.contentWindow.__hv2Draft; costumeExpected = !!(w.costume && dp && dp.page && dp.page.titleStyleThemed === true); } catch (e) { why = why || ("讀不到引擎草稿的換妝開關：" + e.message); }
      if (costumeOn !== costumeExpected) continue;
      ok = true; break;
    }
    if (!ok && !why) { let d = null; try { d = fr.contentWindow.__hv2Draft; } catch (e) { d = { readError: e.message }; } why = "等 9 秒引擎狀態沒對上：" + JSON.stringify(d && d.page ? { kv: d.page.kvVariant, ts: d.page.titleStyle, ty: d.page.typography } : null); }
    await new Promise((r) => setTimeout(r, 1700)); // fitEngineFrame 60/600/1500ms 三段調尺寸，等它落定
    let rect = null, sc = 1;
    try {
      const iw = fr.contentWindow, idoc = iw.document;
      try { await idoc.fonts.ready; } catch (e) { why = why || ("等引擎字型載完失敗（照拍）：" + e.message); }
      /* 關掉輪播計時器：003 攝影棚家族等版式的商品卡會自轉，兩張截圖之間的畫面差不是我們要量的 */
      ["__hv2L1Timer", "__hv2L4Timer", "__hv2SwTimer", "__hv2L5Timer", "__hv2S12Timer", "__hv2L10Timer", "__hv2L11Timer"].forEach((k) => { if (iw[k]) { clearInterval(iw[k]); iw[k] = null; } });
      /* 凍住 CSS 動畫（2026-09-05 牆 #1 教訓：001／006 的霓虹光框會脈動、落在標題裁切區內＝換妝 Δ 被灌到 60～80%，003 靜態棚才準）。
         只暫停不移除＝畫面停在當下那格、版面不跳。 */
      if (!idoc.getElementById("qaFreeze")) { const st = idoc.createElement("style"); st.id = "qaFreeze"; st.textContent = "*,*::before,*::after{animation-play-state:paused!important;transition:none!important}"; idoc.head.appendChild(st); }
      let sel = ".hero-font-preview"; try { sel = iw.eval("HV2_TITLE_NODES")[w.layout].sel; } catch (e) { why = why || ("拿不到引擎標題節點表、改量 .hero-font-preview：" + e.message); }
      const els = [...idoc.querySelectorAll(sel + ", .hero-font-preview")].filter((e) => e.getBoundingClientRect().width > 0);
      if (els.length) {
        const rs = els.map((e) => e.getBoundingClientRect());
        const x0 = Math.min(...rs.map((r) => r.left)), y0 = Math.min(...rs.map((r) => r.top)), x1 = Math.max(...rs.map((r) => r.right)), y1 = Math.max(...rs.map((r) => r.bottom));
        rect = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
      }
      const fb = fr.getBoundingClientRect(); sc = fb.width / (fr.clientWidth || 1440);
    } catch (e) { why = why || ("量標題區失敗：" + e.message); }
    const costumeCss = (document.getElementById("costumeThemeCss") || {}).textContent || "";
    const eligible = !!(document.getElementById("costumeFollowTheme")) && !document.getElementById("costumeFollowTheme").disabled && (document.getElementById("costumeFollowTheme").closest("label") || {}).style.display !== "none";
    const note = (document.getElementById("engineNote") || {}).textContent || "";
    return { ok, why, costumeCssLen: costumeCss.length, eligible, engineNote: note.trim(), rect, sc };
  }, want);
  return r;
}

async function shot(page, file, r, DPR) {
  const fr = page.locator("#engineFrame");
  await fr.screenshot({ path: file });
  /* 標題區裁切：iframe 內 CSS px → ×縮放 ×DPR＝截圖像素；四周留 0.5 倍字高吃陰影／疊層外溢 */
  const crop = file.replace(/\.png$/, ".title.png");
  if (r && r.rect && r.rect.w > 0) {
    const meta = await sharp(file).metadata();
    const m = Math.max(24, r.rect.h * 0.5);
    const L = Math.max(0, Math.floor((r.rect.x - m) * r.sc * DPR)), T = Math.max(0, Math.floor((r.rect.y - m) * r.sc * DPR));
    const W = Math.min(meta.width - L, Math.ceil((r.rect.w + 2 * m) * r.sc * DPR)), H = Math.min(meta.height - T, Math.ceil((r.rect.h + 2 * m) * r.sc * DPR));
    if (W > 8 && H > 8) { await sharp(file).extract({ left: L, top: T, width: W, height: H }).toFile(crop); return { full: file, crop }; }
  }
  fs.copyFileSync(file, crop); return { full: file, crop, noRect: true };
}

/* 像素比對：兩張圖尺寸取最小交集，任一通道差 > 24 算不同；回傳不同像素百分比 */
async function diffPct(a, b) {
  const [A, B] = await Promise.all([a, b].map((f) => sharp(f).ensureAlpha().raw().toBuffer({ resolveWithObject: true })));
  const w = Math.min(A.info.width, B.info.width), h = Math.min(A.info.height, B.info.height);
  let diff = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const ia = (y * A.info.width + x) * 4, ib = (y * B.info.width + x) * 4;
    if (Math.abs(A.data[ia] - B.data[ib]) > 24 || Math.abs(A.data[ia + 1] - B.data[ib + 1]) > 24 || Math.abs(A.data[ia + 2] - B.data[ib + 2]) > 24) diff++;
  }
  return { pct: Math.round((diff / (w * h)) * 10000) / 100, sizeDiff: A.info.width !== B.info.width || A.info.height !== B.info.height };
}

(async () => {
  const args = process.argv.slice(2);
  const arg = (k, d) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
  const only = arg("--only", null) ? arg("--only").split(",") : null;
  const layouts = arg("--layouts", "layout-003,layout-006").split(",");
  const brand = arg("--brand", "#2BA6A0");
  const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "").replace(/(\d{8})(\d{4})/, "$1-$2");
  const out = arg("--out", path.join(process.env.TMPDIR || "/tmp", "typestyle-costume-qa-" + stamp));
  fs.mkdirSync(path.join(out, "shots"), { recursive: true });

  const man = JSON.parse(fs.readFileSync(TS_MANIFEST, "utf8"));
  let styles = man.assets.map((a) => ({ code: "css-" + a.code.toLowerCase(), name: a.displayName, review: (a.review || {}).status || "" }));
  if (only) styles = styles.filter((s) => only.includes(s.code));

  /* 產物保鮮閘（2026-09-07 經驗卡「改完引擎先 sync 再測」機器化）：本工具讀的是 deploy-site 產物、不是源頭——改完引擎沒 sync＝看到舊版，
     一度以為「修好了」或「沒生效」都不準（09-06 踩、09-07 又踩）。開跑先比三對「源頭 vs 產物」的修改時間，產物比源頭舊＝出聲拒跑；
     明知故犯要硬跑＝加 --allow-stale。typo_matrix.js 直讀源頭（file://），不需此閘。 */
  if (!args.includes("--allow-stale")) {
    const PAIRS = [
      [path.join(PLAN_DIR, "MVP_Phase1_LeCreuset_活動頁Prototype_FrameTest.html"), path.join(FRAMETEST_DIR, "index.html")],
      [path.join(ROOT, "design-assets", "typestyles", "typestyles.css"), path.join(FRAMETEST_DIR, "typestyles.css")],
      [path.join(ROOT, "design-assets", "typestyles", "costume-engine.js"), path.join(FRAMETEST_DIR, "costume-engine.js")],
    ];
    const stale = PAIRS.filter(([src, prod]) => fs.existsSync(src) && (!fs.existsSync(prod) || fs.statSync(prod).mtimeMs < fs.statSync(src).mtimeMs));
    if (stale.length) {
      console.error("✗ 引擎產物落後源頭——QA 會看到舊版（改完沒 sync 的老病）：\n" +
        stale.map(([s, p]) => `   ${path.relative(ROOT, p)} 比 ${path.relative(ROOT, s)} 舊`).join("\n") +
        "\n   先跑：cd \"2026-AI自動化活動頁生成規劃/deploy-site\" && ./sync.sh，再重跑本工具（明知故犯要硬跑＝加 --allow-stale）");
      process.exit(2);
    }
  }
  const { srv, port } = await startServer();
  const browser = await chromium.launch({ channel: "chrome" });
  const DPR = 2; /* 引擎 iframe 被 CSS 縮到約 0.55 倍，DPR 2 把像素補回來＝標題區比對才有解析度 */
  const page = await browser.newPage({ viewport: { width: 1600, height: 1300 }, deviceScaleFactor: DPR });
  const errs = [];
  page.on("pageerror", (e) => errs.push("[tool] " + e.message));
  page.on("console", (m) => { if (m.type() === "error") errs.push("[console] " + m.text().slice(0, 160)); });
  page.on("response", (r) => { if (r.status() === 404) errs.push("[404] " + r.url().replace(/^https?:\/\/[^/]+/, "")); });
  await page.goto(`http://127.0.0.1:${port}/colortool/`, { waitUntil: "load" });
  await page.waitForFunction(() => document.getElementById("comboLayout") && document.getElementById("comboLayout").options.length > 1, null, { timeout: 20000 });
  await page.waitForTimeout(800);

  if (arg("--probe", null)) { /* 除錯：印出工具頁裡符合選擇器片段的規則，看瀏覽器序列化後的宣告順序（換妝就是拿這份 cssText 去改） */
    const needle = arg("--probe");
    const rules = await page.evaluate((nd) => { const out = []; for (const ss of document.styleSheets) { let rs; try { rs = ss.cssRules; } catch (e) { continue; } for (const r of rs) if (r.selectorText && r.selectorText.includes(nd)) out.push(r.selectorText + " {\n  " + r.style.cssText.split("; ").join(";\n  ") + "\n}"); } return out; }, needle);
    console.log(rules.join("\n\n") || "（沒有符合的規則）"); await browser.close(); srv.close(); return; }
  if (arg("--inspect", null)) { /* 除錯：畫完某款版式×字風後，把標題節點與其 .line 子層、::before/::after 的關鍵 computed style 印出來 */
    const [L, ST] = arg("--inspect").split(":");
    await drive(page, { brand, mode: "light", tracking: 0, leading: 100, width: 100, title: "PUMA x ROSÉ\n聯名鞋款開賣", layout: L, style: ST, costume: false, warp: args.includes("--warp"), subFont: arg("--subfont", null), capsule: arg("--capsule", null) });
    const info = await page.evaluate((L) => {
      const iw = document.getElementById("engineFrame").contentWindow, d = iw.document;
      let sel = ".hero-font-preview", selNote = ""; try { sel = iw.eval("HV2_TITLE_NODES")[L].sel; } catch (e) { selNote = "拿不到 HV2_TITLE_NODES、改量 .hero-font-preview：" + e.message; } const el = d.querySelector(sel) || d.querySelector(".hero-font-preview");
      if (!el) {
        const dn = d.querySelector(".dc-num");
        let subFam = "(無副標節點)"; try { const ss = iw.eval("HV2_SUB_NODES")[L]; const se = ss ? d.querySelector(ss) : null; if (se) subFam = iw.getComputedStyle(se).fontFamily; } catch (e) { subFam = "err:" + e.message; }
        return { note: "無 .hero-font-preview（web-sans 或標題節點缺）", discountFont: dn ? iw.getComputedStyle(dn).fontFamily : "(無折數)", subFont: subFam, draftSubFont: (iw.__hv2Draft && iw.__hv2Draft.page) ? JSON.stringify(iw.__hv2Draft.page.subtitleFont) : "(無)" };
      }
      const keys = ["display", "visibility", "opacity", "color", "-webkit-text-fill-color", "-webkit-text-stroke", "background-image", "-webkit-background-clip", "font-family", "font-size", "font-weight", "line-height", "letter-spacing", "width", "height", "overflow", "transform", "clip-path", "mix-blend-mode", "filter", "text-shadow"];
      const pick = (e, pseudo) => { const cs = iw.getComputedStyle(e, pseudo || null); const o = {}; keys.forEach((k) => { const v = cs.getPropertyValue(k); if (v && v !== "none" && v !== "normal" && v !== "auto") o[k] = v.length > 90 ? v.slice(0, 90) + "…" : v; }); if (pseudo) o.content = cs.content; return o; };
      const r = el.getBoundingClientRect();
      const bcs = iw.getComputedStyle(d.body);
      const l8Probe = (() => { try {
        const iw2=iw, d2=d; const big=d2.querySelector("#hv2-l008 .q-big"); if(!big) return "(無 q-big)";
        const cs=iw2.getComputedStyle(big);
        const lines=big.querySelectorAll(":scope > .line"); const kids=[...big.children].filter(c=>!c.classList.contains("line"));
        const beforeC=lines.length?iw2.getComputedStyle(lines[0],"::before").content:iw2.getComputedStyle(big,"::before").content;
        const block=d2.querySelector("#hv2-l008 .q-block"); const blockBg=block?iw2.getComputedStyle(block).background.slice(0,60):"(無 q-block)";
        return { cls:big.className, txt:(big.textContent||"").slice(0,16), color:cs.color, fill:cs.getPropertyValue("-webkit-text-fill-color"), stroke:cs.getPropertyValue("-webkit-text-stroke"), lineCount:lines.length, elemKids:kids.length, beforeContent:beforeC, tsCostume:cs.getPropertyValue("--ts-costume"), blockBg };
      } catch(e){ return "err:"+e.message; } })();
      const l4Probe = (() => { try { const q=(sel)=>{const e=d.querySelector(sel);return e?{vis:iw.getComputedStyle(e).display!=="none",txt:(e.textContent||"").slice(0,18)}:"(無)";}; return { title:q("#hv2L4Title"), sub:q("#hv2L4Sub"), year:q("#hv2L4Year"), chip:q("#hv2L4Chip"), cap:q("#hv2-l004 .l4-cap"), union:q("#hv2L4Union"), note:q("#hv2L4Note") }; } catch(e){ return "err:"+e.message; } })();
      const discountFont = (() => { try { const e = d.querySelector("#hv2-l"+L.slice(-3)+" .dc-num") || d.querySelector(".dc-num"); return e ? iw.getComputedStyle(e).fontFamily : "(無折數)"; } catch(e){ return "err"; } })();
      const titleCenterVal = (() => { try { const h = iw.__hv2Draft && iw.__hv2Draft.page && iw.__hv2Draft.page.hero; return h ? JSON.stringify(h["title-center"]) : "(無 hero)"; } catch(e){ return "err:"+e.message; } })();
      const capFieldVal = (() => { try { const el = document.getElementById("titleCapsule"); return el ? el.value + " / row=" + (document.getElementById("titleCapsuleRow")||{}).style.display : "(無欄)"; } catch(e){ return "err:"+e.message; } })();
      const subFontProbe = (() => { try { const sel = iw.eval("HV2_SUB_NODES")[L]; const e = sel ? d.querySelector(sel) : null; const fam = e ? iw.getComputedStyle(e).fontFamily.split(",")[0].replace(/['"]/g,"").trim() : null; const wt = e ? iw.getComputedStyle(e).fontWeight : null;
        return { sel, font: e ? iw.getComputedStyle(e).fontFamily : "(無節點)", weight: wt, fontLoaded: fam ? iw.document.fonts.check((wt||"400")+" 16px '"+fam+"'") : null, linkHref: (iw.document.getElementById("subFontV2")||{}).href || "(無 link)" }; } catch (e) { return { err: e.message }; } })();
      const warpState = (() => { const g = d.querySelector("[data-hv2-warp=grp]"); const t = d.querySelector("[data-hv2-warp=title]"); return { draftWarp: iw.__hv2Draft && iw.__hv2Draft.page && iw.__hv2Draft.page.titleGroupWarp, grp: g ? (g.className + " → " + g.style.transform) : "(無)", title: t ? t.style.transform : "(無)" }; })();
      const themeVars = Object.fromEntries(["--campaign-title","--campaign-brand-ink","--campaign-brand","--campaign-accent","--campaign-page-ink"].map((k) => [k, bcs.getPropertyValue(k).trim() || "(未設)"]));
      const bodyFlags = { classes: d.body.className, dataTheme: d.body.getAttribute("data-campaign-theme"), htmlTheme: d.documentElement.getAttribute("data-campaign-theme") };
      return { l8Probe, l4Probe, discountFont, titleCenterVal, capFieldVal, sel, selNote, subFontProbe, warpState, themeVars, bodyFlags, className: el.className, text: el.textContent.trim().slice(0, 30), rect: { w: Math.round(r.width), h: Math.round(r.height) }, self: pick(el),
        lines: [...el.querySelectorAll(".line")].slice(0, 2).map((ln) => ({ cls: ln.className, rect: { w: Math.round(ln.getBoundingClientRect().width), h: Math.round(ln.getBoundingClientRect().height) }, self: pick(ln), before: pick(ln, "::before"), after: pick(ln, "::after"), inner: ln.querySelector(".line-inner") ? pick(ln.querySelector(".line-inner")) : null })),
        parentChain: (() => { const out = []; let n = el.parentElement; for (let i = 0; i < 3 && n; i++, n = n.parentElement) { const cs = iw.getComputedStyle(n); out.push(n.tagName + "." + (n.className || "").toString().slice(0, 30) + " overflow=" + cs.overflow + " h=" + Math.round(n.getBoundingClientRect().height) + " opacity=" + cs.opacity + " vis=" + cs.visibility); } return out; })() };
    }, L);
    console.log(JSON.stringify(info, null, 1)); await browser.close(); srv.close(); return; }
  const forceMode = arg("--mode", null);
  const warpAll = args.includes("--warp"); /* --warp＝每張都開「同組文字一起變形」 */ /* --mode light|dark＝強制主題亮暗（重現設計師在深底版式上的情境） */
  const DARK_LAYOUTS = new Set(["layout-001"]); /* 深底版式清單：001 聯名・深藍夜；新增深底版式時補這裡（或改讀登記簿 themeBehavior） */
  const capsuleArg = arg("--capsule", null);
  const BASE = { warp: warpAll, capsule: capsuleArg, brand, mode: "light", tracking: 0, leading: 100, width: 100, title: "PUMA x ROSÉ\n聯名鞋款開賣" };
  const rows = [];
  let n = 0; const total = styles.length * (layouts.length * 2 + 3);
  const tick = (msg) => { n++; process.stdout.write(`\r[${n}/${total}] ${msg}`.padEnd(90)); };
  for (const st of styles) {
    const row = { ...st, shots: {}, costume: {}, typo: {}, errors: [] };
    for (const L of layouts) {
      for (const costume of [false, true]) {
        const key = `${L}-${costume ? "costume" : "plain"}`;
        const errBefore = errs.length;
        const r = await drive(page, { ...BASE, mode: forceMode || (DARK_LAYOUTS.has(L) ? "dark" : "light"), layout: L, style: st.code, costume }); /* 深底版式配深底主題（牆 #1 教訓） */
        const f = path.join(out, "shots", `${st.code}-${key}.png`);
        const sh = await shot(page, f, r, DPR);
        row.shots[key] = path.relative(out, sh.crop); row.shots[key + "-full"] = path.relative(out, sh.full);
        row.costume[key] = r;
        if (errs.length > errBefore) row.errors.push(...errs.slice(errBefore));
        tick(`${st.name} ${key}`);
      }
      // 換妝有沒有真的動：與同版式原妝比
      const d = await diffPct(path.join(out, row.shots[`${L}-plain`]), path.join(out, row.shots[`${L}-costume`]));
      row.costume[`${L}-diffPct`] = d.pct;
    }
    // 排版三控制（在第一個版式、原妝）：標準 vs 各推一檔
    const L0 = layouts[0];
    const plain = path.join(out, row.shots[`${L0}-plain`]);
    for (const [k, w, label] of [["tracking", { tracking: 11 }, "字距鬆"], ["leading", { leading: 135 }, "行距鬆"], ["width", { width: 80 }, "寬度窄"]]) {
      const r = await drive(page, { ...BASE, ...w, layout: L0, style: st.code, costume: false });
      const f = path.join(out, "shots", `${st.code}-${L0}-typo-${k}.png`);
      const sh = await shot(page, f, r, DPR);
      const d = await diffPct(plain, sh.crop);
      row.typo[k] = { shot: path.relative(out, sh.crop), full: path.relative(out, sh.full), pct: d.pct, ok: r.ok, why: r.why, label };
      tick(`${st.name} ${label}`);
    }
    rows.push(row);
  }
  process.stdout.write("\n");
  await browser.close(); srv.close();

  /* ── 摘要與對照牆 ── */
  const summary = { generatedAt: new Date().toISOString(), brand, layouts, rows: rows.map((r) => ({
    code: r.code, name: r.name, review: r.review, eligible: r.costume[`${layouts[0]}-plain`] && r.costume[`${layouts[0]}-plain`].eligible,
    costumeDiff: Object.fromEntries(layouts.map((L) => [L, r.costume[`${L}-diffPct`]])),
    typoDiff: Object.fromEntries(Object.entries(r.typo).map(([k, v]) => [k, v.pct])),
    errors: r.errors.slice(0, 3) })) };
  fs.writeFileSync(path.join(out, "summary.json"), JSON.stringify(summary, null, 2));

  const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;");
  const flag = (pct, lo) => pct < lo ? `<b style="color:#c0392b">${pct}%＝沒反應</b>` : `${pct}%`;
  const html = `<!doctype html><html lang="zh-Hant"><meta charset="utf-8"><title>字風換妝＋排版控制 Design QA 對照牆 ${stamp}</title>
<style>body{font:14px/1.6 -apple-system,"Noto Sans TC",sans-serif;margin:0;background:#f4f4f2;color:#1a1a1a}header{position:sticky;top:0;background:#fff;border-bottom:1px solid #ddd;padding:12px 20px;z-index:2}
h1{font-size:18px;margin:0 0 4px}.sub{color:#555;font-size:12.5px}section{background:#fff;margin:14px 20px;padding:14px 16px;border-radius:10px;box-shadow:0 1px 2px rgba(0,0,0,.06)}
h2{font-size:15px;margin:0 0 8px;display:flex;gap:10px;align-items:center}h2 .code{font:12px ui-monospace,monospace;color:#666}.tag{font-size:11px;padding:1px 7px;border-radius:999px;background:#eef}.tag.no{background:#fde8e8;color:#a12}
.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:10px}.cell{border:1px solid #e5e5e5;border-radius:8px;overflow:hidden;background:#fafafa}.cell img{display:block;width:100%;height:auto;background:#fff}.cell .cap{font-size:12px;padding:6px 8px;border-top:1px solid #eee;color:#333}
.vote{display:flex;gap:14px;align-items:center;margin-top:10px;flex-wrap:wrap}.vote label{cursor:pointer}.vote textarea{flex:1;min-width:260px;height:30px;font:inherit;font-size:12.5px;padding:4px 6px}
.legend{font-size:12.5px;color:#444;margin-top:6px}.err{font-size:11.5px;color:#a12;margin-top:6px;white-space:pre-wrap}
button{font:inherit;padding:6px 12px;border:1px solid #333;border-radius:6px;background:#fff;cursor:pointer}</style>
<header><h1>字風換妝＋排版控制 Design QA 對照牆</h1><div class="sub">主色 ${esc(brand)}・亮底｜版式 ${layouts.map(esc).join("、")}｜每款四張：原妝／換妝 × 兩版式；下排三張＝排版控制各推一檔（數字＝與標準檔的畫面差異 %，低於 0.3% 標紅「沒反應」）。
<br>圈法：每款選一個結論、要改的寫一句；圈完按「匯出圈選結果」，把文字貼給 Claude。</div>
<div style="margin-top:8px"><button onclick="exportVotes()">匯出圈選結果</button> <span id="exportMsg" class="sub"></span></div></header>
${rows.map((r) => {
  const L = layouts;
  const c = r.costume;
  const cells = L.flatMap((l) => [[`${l} 原妝`, r.shots[`${l}-plain`]], [`${l} 換妝${c[`${l}-diffPct`] !== undefined ? "（畫面變化 " + flag(c[`${l}-diffPct`], 0.3) + "）" : ""}`, r.shots[`${l}-costume`]]]);
  const typo = Object.entries(r.typo).map(([k, v]) => [`${v.label}（變化 ${flag(v.pct, 0.3)}${v.ok ? "" : "・⚠ 引擎狀態沒對上"}）`, v.shot]);
  const elig = c[`${L[0]}-plain`] && c[`${L[0]}-plain`].eligible;
  return `<section data-code="${esc(r.code)}"><h2>${esc(r.name)} <span class="code">${esc(r.code)}</span> <span class="tag ${elig ? "" : "no"}">${elig ? "有妝可換" : "純字形／不換妝"}</span>${r.review ? `<span class="tag">${esc(r.review)}</span>` : ""}</h2>
  <div class="grid">${cells.map(([cap, src], i) => { const full = r.shots[Object.keys(r.shots).filter((k) => !k.endsWith("-full"))[i] + "-full"]; return `<div class="cell"><a href="${esc(full || src)}" target="_blank"><img src="${esc(src)}" loading="lazy"></a><div class="cap">${cap}</div></div>`; }).join("")}
  <div class="cell"><img src="${esc(r.shots[`${L[0]}-plain`])}" loading="lazy"><div class="cap">${esc(L[0])} 標準檔（排版比對基準）</div></div>${typo.map(([cap, src]) => `<div class="cell"><img src="${esc(src)}" loading="lazy"><div class="cap">${cap}</div></div>`).join("")}</div>
  ${r.errors.length ? `<div class="err">頁面錯誤：${esc(r.errors.slice(0, 2).join("\n"))}</div>` : ""}
  <div class="vote"><label><input type="radio" name="v-${esc(r.code)}" value="ok"> ✅ 可以</label><label><input type="radio" name="v-${esc(r.code)}" value="fix"> ⚠ 要改</label><label><input type="radio" name="v-${esc(r.code)}" value="nocostume"> ❌ 這款不該換妝</label><textarea placeholder="要改什麼／看到什麼（一句）" data-note="${esc(r.code)}"></textarea></div></section>`;
}).join("\n")}
<script>
function exportVotes(){const out=[];document.querySelectorAll('section[data-code]').forEach(s=>{const code=s.dataset.code;const v=(s.querySelector('input[type=radio]:checked')||{}).value||'';const note=(s.querySelector('textarea')||{}).value||'';if(v||note)out.push(code+'｜'+(v==='ok'?'✅ 可以':v==='fix'?'⚠ 要改':v==='nocostume'?'❌ 不換妝':'（未圈）')+(note?'｜'+note:''));});
const txt=out.length?out.join('\\n'):'（還沒有圈任何一款）';navigator.clipboard&&navigator.clipboard.writeText(txt);document.getElementById('exportMsg').textContent='已複製 '+out.length+' 款到剪貼簿——貼給 Claude 即可';const pre=document.getElementById('exportPre')||document.body.appendChild(Object.assign(document.createElement('pre'),{id:'exportPre',style:'margin:20px;white-space:pre-wrap;background:#fff;padding:12px;border-radius:8px'}));pre.textContent=txt;}
</script></html>`;
  fs.writeFileSync(path.join(out, "index.html"), html);

  // 終端摘要
  console.log(`\n輸出：${out}`);
  console.log("字風".padEnd(24) + "有妝".padEnd(6) + layouts.map((l) => (l + " 換妝Δ").padEnd(16)).join("") + "字距Δ".padEnd(9) + "行距Δ".padEnd(9) + "寬度Δ");
  for (const r of summary.rows) {
    console.log((r.name.length > 22 ? r.name.slice(0, 22) : r.name).padEnd(24) + (r.eligible ? "✓" : "—").padEnd(6) + layouts.map((l) => String(r.costumeDiff[l] + "%").padEnd(16)).join("") + String(r.typoDiff.tracking + "%").padEnd(9) + String(r.typoDiff.leading + "%").padEnd(9) + r.typoDiff.width + "%");
  }
  if (errs.length) console.log(`\n⚠ 過程頁面錯誤 ${errs.length} 則（首 3）：\n  ` + errs.slice(0, 3).join("\n  "));
  if (!args.includes("--no-open")) require("child_process").spawn("open", [path.join(out, "index.html")], { detached: true, stdio: "ignore" }).unref();
})().catch((e) => { console.error("✗ " + (e && e.stack || e)); process.exit(1); });
