#!/usr/bin/env node
"use strict";
/**
 * tools/build_aem_shared_css.js —— 產 AEM 共用樣式 main.css（lib/aem_shared_css.js 的 I/O 端）＋素材外帶＋機器證明＋AEM 上傳包
 *
 * 用法：
 *   node tools/build_aem_shared_css.js                       # 產 dist/aem-shared/{main.css, main.css.json, assets/…}（素材相對路徑；重畫證明用這份）
 *   node tools/build_aem_shared_css.js --check <html|dir>…   # 覆蓋證明：每份瘦身匯出檔的模板來源樣式逐條都在 main.css（缺一條＝exit 1）
 *   node tools/build_aem_shared_css.js --render <slim.html>… # 重畫證明：把頁上的模板樣式換成 <link main.css>，真 Chrome 三裝置重畫，
 *                                                            #   可見 DOM 一致＋截圖像素差 ≤0.1%（沿 aem_verify 的尺；任一紅＝exit 1）
 *   node tools/build_aem_shared_css.js --dam                 # AEM 上傳包：dist/aem-shared/dam/<版本>/（main.css 素材改寫成正式網址、15 個檔扁平放一個資料夾、附上傳步驟＋網址清單）
 *   node tools/build_aem_shared_css.js --verify-live [版本]  # 上線確認：上傳＋發佈後逐一敲正式網址，狀態＋型別＋大小三項都要對，
 *                                                            #   再把 main.css 真的抓回來核對檔頭版本（只看狀態碼會被「回 200 加一頁登入表單」騙過去）
 *   --out <dir>  改輸出目錄（預設 pipeline/dist/aem-shared）
 * 素材＝main.css 引用的背景圖，走跟匯出器內嵌同一條轉檔（PNG／JPG >24KB → 寬 ≤1600 WebP q82；其餘原檔）＝像素與內嵌版一致。
 * 版本＝CSS 內容雜湊（素材路徑改寫前）：相對版與 DAM 版同一個版本號；內容沒變就沿用原版本號（日期段只是「首次切出那天」的註記，
 * 不會因為隔天重產就改名——否則 AEM 上會出現兩份一樣的東西、各頁 HTML 掛到哪一份靠運氣）。
 * 真源路徑照 server.js exportAem：模板＝deploy-site/lecreuset-frametest/index.html（sync.sh 鏡像）、色彩變數＝專案根 design-tokens/tokens.css。
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const S = require("../lib/aem_shared_css");

const PIPE = path.join(__dirname, "..");
const ROOT = path.join(PIPE, "..", "..");
const FRAME_DIR = path.join(ROOT, "2026-AI自動化活動頁生成規劃", "deploy-site", "lecreuset-frametest");
const FRAME = path.join(FRAME_DIR, "index.html");
const TOKENS = path.join(ROOT, "design-tokens", "tokens.css");

const args = process.argv.slice(2);
const flag = (k) => args.indexOf(k);
const valueOf = (k) => (flag(k) >= 0 && args[flag(k) + 1] && !args[flag(k) + 1].startsWith("--") ? args[flag(k) + 1] : null);
const listAfter = (k) => { const i = flag(k); if (i < 0) return []; const out = []; for (let j = i + 1; j < args.length && !args[j].startsWith("--"); j++) out.push(args[j]); return out; };
const OUT = valueOf("--out") ? path.resolve(valueOf("--out")) : path.join(PIPE, "dist", "aem-shared");

function readOrDie(p, what) { if (!fs.existsSync(p)) { console.error(`❌ ${what}不存在：${p}`); process.exit(2); } return fs.readFileSync(p, "utf8"); }
function expandHtml(paths) {
  const out = [];
  for (const p of paths) {
    const abs = path.resolve(p);
    if (fs.existsSync(abs) && fs.statSync(abs).isDirectory()) fs.readdirSync(abs).filter((f) => /\.html$/i.test(f) && !/_reference-full/.test(f)).sort().forEach((f) => out.push(path.join(abs, f)));
    else out.push(abs);
  }
  return out;
}
const sha = (s) => crypto.createHash("sha1").update(s).digest("hex").slice(0, 12);

/** 素材轉檔＝與 lib/aem_export.js assetToDataUri 同參數（PNG／JPG >24KB → 寬 ≤1600 WebP q82 alphaQuality 90；其餘原檔）；回 buffer 與新檔名 */
async function convertAsset(ref) {
  const abs = path.join(FRAME_DIR, ref);
  if (!fs.existsSync(abs)) throw new Error(`main.css 引用的素材不存在：${ref}（模板 ${path.relative(ROOT, FRAME_DIR)}）`);
  const raw = fs.readFileSync(abs);
  const ext = path.extname(ref).toLowerCase();
  if ([".png", ".jpg", ".jpeg"].includes(ext) && raw.length > 24 * 1024) {
    const sharp = require("sharp");
    const md = await sharp(raw).metadata();
    const buf = await sharp(raw).resize({ width: Math.min(1600, md.width || 1600), withoutEnlargement: true }).webp({ quality: 82, alphaQuality: 90 }).toBuffer();
    return { ref, outRef: ref.replace(/\.(png|jpe?g)$/i, ".webp"), buf, from: raw.length, kind: "webp" };
  }
  return { ref, outRef: ref, buf: raw, from: raw.length, kind: "raw" };
}

(async () => {
  /* ── --verify-live：不重產，只對正式網址 HEAD ── */
  if (flag("--verify-live") >= 0) {
    const ver = valueOf("--verify-live") || (fs.existsSync(path.join(OUT, "main.css.json")) ? JSON.parse(fs.readFileSync(path.join(OUT, "main.css.json"), "utf8")).version : null);
    if (!ver) { console.error("❌ 沒有版本可驗：先跑 --dam，或給 --verify-live <版本>"); process.exit(2); }
    const listPath = path.join(OUT, "dam", ver, "urls.json");
    if (!fs.existsSync(listPath)) { console.error(`❌ 找不到網址清單：${listPath}（先跑 --dam）`); process.exit(2); }
    const urls = JSON.parse(fs.readFileSync(listPath, "utf8"));
    const damDir = path.join(OUT, "dam", ver);
    /* 本機那份的大小＝比對基準（線上大小不同＝被重新壓過或傳到一半斷了，畫面就不是我們證明過的那份） */
    const localBytes = (u) => { const f = path.join(damDir, path.basename(new URL(u).pathname)); return fs.existsSync(f) ? fs.statSync(f).size : null; };
    /* 🔒 一律 redirect:"manual"——**不要跟隨轉址，第一跳就是答案**。
       活實例（2026-09-18，另一線在台灣站測到）：同一個網址 curl 不跟隨＝302 到登入頁；
       curl -L 跟隨到底＝**HTTP 200，而內容是企業 SSO 登入表單**。
       也就是說「跟不跟隨轉址」這一個開關，就決定你看到紅燈還是假綠燈。
       絆線＝test/unit/aem_shared_css.test.js「上線確認一律不跟隨轉址」案。 */
    /* 兩類分開報（2026-09-18 實況）：圖片是素材庫吃的、css 不是。
       工程窗口原話「這邊只支援圖片，css 跟 js 只能透過工程師上傳、需要一兩個工作天」，
       所以 main.css 紅是**結構性**的、不是「忘了發佈」。混成同一種紅燈會讓人去催錯的事
       （09-18 就發生了：14 張圖其實躺在正確路徑上、只是從來沒發佈，而 main.css 根本不在）。 */
    const isCss = (u) => u.endsWith(".css");
    console.log(`上線確認 ${ver}：逐一敲 ${urls.length} 個正式網址——狀態、型別、大小三項都要對（不跟隨轉址）`);
    console.log(`  圖片 ${urls.filter((u) => !isCss(u)).length} 張＝素材庫吃這個，紅＝沒傳或沒按發佈（AEM 上藍色 New 標記＝未發佈）`);
    console.log(`  main.css ${urls.filter(isCss).length} 份＝素材庫不吃 css，只能請工程師傳、要一兩個工作天；紅在這裡是預期的`);
    let bad = 0, badImg = 0, badCss = 0;
    for (const u of urls) {
      const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 15000);
      try {
        const r = await fetch(u, { method: "HEAD", redirect: "manual", signal: ctrl.signal });
        const v = S.judgeLive({ url: u, status: r.status, contentType: r.headers.get("content-type"), contentLength: r.headers.get("content-length"), expectedBytes: localBytes(u) });
        if (!v.ok) { bad++; isCss(u) ? badCss++ : badImg++; }
        console.log(`  ${v.ok ? "✓" : "❌"} ${u}${v.ok ? `  (${r.status} ${r.headers.get("content-type") || "?"})` : `\n      ${v.why}——${v.hint}`}`);
      } catch (e) { bad++; isCss(u) ? badCss++ : badImg++; console.log(`  ❌ 連不上 ${u}：${e.message}`); }
      finally { clearTimeout(t); }
    }

    /* main.css 再多一道：真的抓回來看檔頭的版本對不對。
       這是唯一能證明「那個位址給的是我們這份東西」而不是一頁登入畫面或別版的檢查。 */
    const mainUrl = urls.find((u) => u.endsWith("main.css")) || urls[0];
    const ctrl2 = new AbortController(); const t2 = setTimeout(() => ctrl2.abort(), 20000);
    try {
      const r = await fetch(mainUrl, { redirect: "manual", signal: ctrl2.signal });
      const head = (await r.text()).slice(0, 200);
      if (!head.includes(`main.css ${ver}`)) {
        bad++; badCss++;
        console.log(`  ❌ main.css 抓回來的內容不是 ${ver}——開頭是：${JSON.stringify(head.slice(0, 80))}`);
        console.log("      （若開頭像 <!DOCTYPE html 就是登入畫面；若是別的版本號＝那個資料夾放的是舊版）");
      } else {
        console.log(`  ✓ main.css 內容檔頭確認＝${ver}`);
      }
    } catch (e) { bad++; console.log(`  ❌ main.css 抓不回來：${e.message}`); }
    finally { clearTimeout(t2); }

    if (bad) {
      console.error(`\n❌ ${bad} 項沒過，分兩類看：`);
      if (badImg) console.error(`   圖片 ${badImg} 項——這類是我們這邊的事：確認有上傳、而且按過發佈（AEM 畫面上藍色 New 標記就是還沒發佈）。發佈後傳播約三到五分鐘。`);
      else console.error("   圖片：全過 ✓");
      if (badCss) console.error(`   main.css ${badCss} 項——**這一類我們自己解不了**：素材庫只支援圖片，css 要請工程師代傳、要一兩個工作天。不要把它當成忘了發佈。`);
      else console.error("   main.css：過了 ✓");
      console.error("   沒全綠就先不要叫工程師掛這個網址。");
      process.exit(1);
    }
    console.log("\n✅ 全部上線、型別大小與內容都對；工程師的頁可以掛：" + mainUrl);
    return;
  }

  /* 版本＝內容。內容沒變就沿用原來那個版本號——日期只是「首次切出那天」的註記。
     認得舊版本的依據有兩個：main.css.json（進版控）與 versions/ 的檔名（本機歷史）。判斷交給 lib 的 reuseVersion。 */
  function pickVersion(computed) {
    const found = new Set();
    const metaPath = path.join(OUT, "main.css.json");
    if (fs.existsSync(metaPath)) {
      try {
        const v = JSON.parse(fs.readFileSync(metaPath, "utf8")).version;
        if (v) found.add(v);
      } catch (e) {
        console.log(`   ⚠ main.css.json 讀不起來（${e.message}）——版本改用今天算的，請確認這檔沒壞`);
      }
    }
    const verDir = path.join(OUT, "versions");
    if (fs.existsSync(verDir)) {
      for (const f of fs.readdirSync(verDir)) {
        const m = /^main\.(v\d{4}-\d{2}-\d{2}-[0-9a-f]{8})\.css$/.exec(f);
        if (m) found.add(m[1]);
      }
    }
    const keep = S.reuseVersion(computed, [...found]);
    if (keep !== computed) console.log(`ⓘ 內容與 ${keep} 完全相同 → 沿用原版本號（不因為換了一天就改名；已上 AEM 的網址不用動）`);
    return keep;
  }

  /* 1. 切本體 → 版本 → 素材 → 定版寫檔 */
  const templateHtml = readOrDie(FRAME, "引擎模板");
  const tokensCss = readOrDie(TOKENS, "tokens.css");
  const ex = S.extractBody({ templateHtml, tokensCss });
  const version = pickVersion(S.versionOf(ex.body));
  const converted = [];
  for (const r of S.assetRefs(ex.body)) converted.push(await convertAsset(r));

  /* 1a. 相對版（重畫證明用；素材照原資料夾結構） */
  fs.mkdirSync(OUT, { recursive: true });
  for (const a of converted) { const dest = path.join(OUT, a.outRef); fs.mkdirSync(path.dirname(dest), { recursive: true }); fs.writeFileSync(dest, a.buf); }
  const relMap = Object.fromEntries(converted.map((a) => [a.ref, a.outRef]));
  const rel = S.finalizeCss({ ...ex, version, assetUrl: (r) => relMap[r] || r });
  const mainPath = path.join(OUT, "main.css");
  fs.writeFileSync(mainPath, rel.css);
  fs.mkdirSync(path.join(OUT, "versions"), { recursive: true });
  fs.writeFileSync(path.join(OUT, "versions", `main.${version}.css`), rel.css);
  const meta = { version, generatedAt: new Date().toISOString(), bytes: rel.report.bytes, encoded: rel.report.encoded, rules: rel.report.rules, editorRulesDropped: rel.report.editorRulesDropped, layouts: rel.report.layouts, blocks: rel.report.blocks, warnings: rel.report.warnings,
    assets: converted.map((a) => ({ file: a.outRef, from: a.from, to: a.buf.length, kind: a.kind })),
    sources: { template: path.relative(ROOT, FRAME), templateSha: sha(templateHtml), tokens: path.relative(ROOT, TOKENS), tokensSha: sha(tokensCss) },
    dam: { uploadUrl: S.AEM_DAM_UPLOAD_URL, publicBase: S.AEM_ASSET_PUBLIC_BASE + S.sharedFolder(version), mainCssUrl: S.AEM_ASSET_PUBLIC_BASE + S.sharedFolder(version) + "main.css" },
    pageRule: `每頁 HTML：刪掉所有 <style>，只留 <style id="typestylesV2">（這頁字風）；<head> 加 <link rel="stylesheet" href="${S.AEM_ASSET_PUBLIC_BASE + S.sharedFolder(version)}main.css">；保留 Google Fonts <link>。` };
  fs.writeFileSync(path.join(OUT, "main.css.json"), JSON.stringify(meta, null, 1));
  const assetBytes = converted.reduce((a, x) => a + x.buf.length, 0);
  console.log(`✓ main.css ${version}：${(rel.report.bytes / 1024).toFixed(0)}KB（編碼後 ${rel.report.encoded}）、規則 ${rel.report.rules} 條、剝後台 ${rel.report.editorRulesDropped} 條、版型 ${Object.keys(rel.report.layouts).length} 款、素材 ${converted.length} 件 ${(assetBytes / 1024).toFixed(0)}KB（原 ${(converted.reduce((a, x) => a + x.from, 0) / 1024 / 1024).toFixed(1)}MB）→ ${path.relative(process.cwd(), OUT)}/`);
  for (const b of rel.report.blocks) console.log(`   <style${b.id ? ` id="${b.id}"` : ""}> ${b.skipped ? "跳過（" + b.skipped + "）" : b.source ? `← ${b.source}（照模板載入位置）` : `${b.rulesBefore}→${b.rulesAfter} 條`}`);
  if (rel.report.warnings.length) console.log("   ⚠ " + rel.report.warnings.join("；"));

  /* 1b. --dam：AEM 上傳包＝一個資料夾扁平放 main.css＋素材、素材改寫成正式網址 */
  if (flag("--dam") >= 0) {
    const base = S.AEM_ASSET_PUBLIC_BASE + S.sharedFolder(version);
    const flatName = (ref) => path.basename(ref);
    const names = converted.map((a) => flatName(a.outRef));
    if (new Set(names).size !== names.length) throw new Error("素材扁平化後檔名撞名：" + names.join(", "));
    const damMap = Object.fromEntries(converted.map((a) => [a.ref, base + flatName(a.outRef)]));
    const dam = S.finalizeCss({ ...ex, version, assetUrl: (r) => damMap[r] || r, assetBase: base });
    if (dam.version !== version) throw new Error("DAM 版與相對版版本不同（版本應與素材位置無關）");
    const damDir = path.join(OUT, "dam", version);
    fs.rmSync(damDir, { recursive: true, force: true }); fs.mkdirSync(damDir, { recursive: true });
    fs.writeFileSync(path.join(damDir, "main.css"), dam.css);
    for (const a of converted) fs.writeFileSync(path.join(damDir, flatName(a.outRef)), a.buf);
    const urls = [base + "main.css", ...converted.map((a) => damMap[a.ref])];
    fs.writeFileSync(path.join(damDir, "urls.json"), JSON.stringify(urls, null, 1));
    fs.writeFileSync(path.join(damDir, "上傳步驟.txt"),
`AEM 共用樣式上傳包 ${version}
====================================
這個資料夾裡的 ${1 + converted.length} 個檔（main.css＋${converted.length} 張背景圖）要一起放到 AEM 素材庫的同一個資料夾。

🔴 2026-09-18 更正：這一包目前【不能自己上傳】。
工程窗口 09-17 明講：素材庫「只支援圖片」，css 與 js 只能由工程師上傳、需要一兩個工作天。
所以下面第 1～4 步（自己建資料夾、自己上傳、自己發佈）在拿到新流程之前不要照做。
另外：負責人在 AEM 看不到上傳入口，圖也是工程師代傳的。
現在該做的是把這一包交給工程窗口、並問他「更新時能不能固定網址只換內容」（信在牆頂）。
第 5 步（跑 --verify-live 確認上線）仍然有效，而且今天正是它抓出「說傳好了但 15 個網址全 404」。

以下步驟保留，等新流程確認後再用：

1. 開 ${S.AEM_DAM_UPLOAD_URL}
2. 在底下建資料夾：shared → 再建 ${version}（兩層；路徑＝campaign-studio-ai/${S.sharedFolder(version)}）
3. 進到 ${version} 資料夾，把本資料夾裡除了 urls.json、上傳步驟.txt 以外的 ${1 + converted.length} 個檔一次全選上傳（不要再分子資料夾）
4. 上傳完成後「發佈」（不發佈＝正式網址打不開、頁面會缺圖）
5. 回到終端機跑：node tools/build_aem_shared_css.js --verify-live ${version}
   全部 ✓ 200 才算完成；有 ❌ 通常是沒發佈或資料夾名打錯

給工程師的網址：
  main.css＝${base}main.css
  （main.css 裡的背景圖已寫成同資料夾的正式網址，他那邊不用再處理）

每頁 HTML 的處理規則：
  刪掉所有 <style>，只留 <style id="typestylesV2">（這頁字風）；<head> 加 <link rel="stylesheet" href="${base}main.css">；保留 Google Fonts <link>。
`);
    console.log(`✓ AEM 上傳包 → ${path.relative(process.cwd(), damDir)}/（${1 + converted.length} 個檔扁平放；main.css 網址＝${base}main.css）`);
  }

  let failed = false;

  /* 2. 覆蓋證明 */
  const checkFiles = expandHtml(listAfter("--check"));
  if (checkFiles.length) {
    console.log(`\n覆蓋證明（${checkFiles.length} 份）：頁上模板來源的每一條樣式規則都要在 main.css`);
    for (const f of checkFiles) {
      const r = S.coverageCheck(rel.css, fs.readFileSync(f, "utf8"));
      console.log(`  ${r.ok ? "✓" : "❌"} ${path.basename(f)}：${r.ok ? `${r.total} 條全在` : `${r.total} 條裡缺 ${r.missing.length} 條`}${r.skippedEditor ? `（另 ${r.skippedEditor} 段後台專用略過）` : ""}`);
      if (!r.ok) { failed = true; r.missing.slice(0, 5).forEach((m) => console.log(`       缺：${m.chain}${m.prelude}{${m.body}…}`)); }
    }
  }

  /* 3. 重畫證明（用相對版：素材走 file://，零網路） */
  const renderFiles = expandHtml(listAfter("--render"));
  if (renderFiles.length) {
    const { chromium } = require("playwright-core");
    const sharp = require("sharp");
    const VIEWS = [{ key: "desktop", width: 1440, height: 1000, touch: false }, { key: "tablet", width: 768, height: 1024, touch: true }, { key: "mobile", width: 375, height: 812, touch: true }];
    const fileUrl = (p) => "file://" + encodeURI(path.resolve(p));
    const tmpDir = fs.mkdtempSync(path.join(require("os").tmpdir(), "aem-shared-render-"));
    const variantOf = (html) => {
      // 模板來源的樣式塊＝tokensV2／device-preview-css／沒 id 的大塊（>20KB）；其餘（字風、匯出器注入的遮罩與藏面板）保留
      let swapped = 0;
      const out = html.replace(/<style([^>]*)>([\s\S]*?)<\/style>/g, (all, at, body) => {
        const id = (at.match(/\bid="([^"]+)"/) || [])[1] || null;
        if (id === "tokensV2" || id === "device-preview-css" || (!id && body.length > 20000)) { swapped++; return ""; }
        return all;
      });
      if (swapped < 2) throw new Error(`變體頁只換掉 ${swapped} 塊模板樣式（預期 ≥2：大塊＋tokens）——錨點漂移`);
      return out.replace(/<head>/, `<head><link rel="stylesheet" href="${fileUrl(mainPath)}">`);
    };
    const render = async (browser, htmlPath, v) => {
      const ctx = await browser.newContext({ viewport: { width: v.width, height: v.height }, isMobile: v.touch, hasTouch: v.touch, deviceScaleFactor: 1 });
      const page = await ctx.newPage(); const errs = [];
      page.on("pageerror", (e) => errs.push(String(e).slice(0, 200)));
      /* 外網一律不碰（跟 aem_verify 同）；但外連「圖片」回一張 1×1 透明圖而不是拒絕——拒絕會讓 Chrome 畫破圖圖示＋替代文字，
         而那個圖示「什麼時候出現」會隨多一個 <link> 的載入時序漂移（2026-09-17 實測：012 手機版 1742px 差＝質感首選模組的破圖圖示），
         兩邊同樣處理＝零網路、零時序差；CSS 造成的差異照樣量得到。 */
      const PIXEL = Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64");
      await page.route("**/*", (route) => {
        const u = route.request().url();
        if (u.startsWith("file://")) return route.continue();
        if (route.request().resourceType() === "image") return route.fulfill({ status: 200, contentType: "image/gif", body: PIXEL });
        return route.abort();
      });
      await page.addInitScript(() => { window.setInterval = function () { return 0; }; });
      await page.goto(fileUrl(htmlPath), { waitUntil: "load", timeout: 60000 });
      await page.waitForFunction(() => document.body.classList.contains("shell-v2") && !!document.body.getAttribute("data-layout"), null, { timeout: 30000 }).catch(() => {});
      await page.waitForTimeout(1500);
      await page.addStyleTag({ content: "*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}" });
      await page.evaluate(async () => { for (let y = 0; y < document.body.scrollHeight; y += 600) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 30)); } window.scrollTo(0, 0); });
      await page.waitForFunction(() => Array.from(document.images).every((i) => i.complete), null, { timeout: 8000 }).catch(() => {}); // 圖片都落定（含 1×1 佔位）再截，不吃時序
      await page.waitForTimeout(600);
      const dom = await page.evaluate(() => {
        document.body.querySelectorAll("*").forEach((e) => { if (getComputedStyle(e).display === "none") e.setAttribute("data-aemv-hidden", "1"); });
        const c = document.body.cloneNode(true);
        document.body.querySelectorAll("[data-aemv-hidden]").forEach((e) => e.removeAttribute("data-aemv-hidden"));
        c.querySelectorAll("[data-aemv-hidden]").forEach((n) => n.remove());
        c.querySelectorAll("script,style,link").forEach((n) => n.remove());
        return c.innerHTML.replace(/\s+/g, " ").replace(/(\d+\.\d{2})\d+px/g, "$1px").trim();
      });
      const shot = await page.screenshot({ fullPage: true });
      await ctx.close();
      return { dom, shot, errs };
    };
    const pixelDiff = async (a, b) => {
      const [ma, mb] = await Promise.all([sharp(a).metadata(), sharp(b).metadata()]);
      if (ma.width !== mb.width || ma.height !== mb.height) return { sizeMismatch: `${ma.width}x${ma.height} vs ${mb.width}x${mb.height}` };
      const [ra, rb] = await Promise.all([sharp(a).raw().toBuffer(), sharp(b).raw().toBuffer()]);
      let d = 0; const ch = ma.channels || 3;
      for (let i = 0; i < ra.length; i += ch) if (Math.abs(ra[i] - rb[i]) > 8 || Math.abs(ra[i + 1] - rb[i + 1]) > 8 || Math.abs(ra[i + 2] - rb[i + 2]) > 8) d++;
      return { diffPixels: d, ratio: d / (ma.width * ma.height), size: `${ma.width}x${ma.height}` };
    };
    console.log(`\n重畫證明（${renderFiles.length} 份 × 三裝置）：頁上模板樣式換成 <link main.css> 後，畫面要跟原本一模一樣`);
    const browser = await chromium.launch({ channel: "chrome", headless: true });
    for (const f of renderFiles) {
      const html = fs.readFileSync(f, "utf8");
      const vPath = path.join(tmpDir, path.basename(f).replace(/\.html$/, ".main-css.html"));
      fs.writeFileSync(vPath, variantOf(html));
      for (const v of VIEWS) {
        const o = await render(browser, f, v), m = await render(browser, vPath, v);
        const checks = [["零 JS 錯誤（變體）", m.errs.length === 0, m.errs[0] || ""], ["可見 DOM 一致", o.dom === m.dom, ""]];
        try { const pd = await pixelDiff(o.shot, m.shot); checks.push(pd.sizeMismatch ? ["截圖尺寸一致", false, pd.sizeMismatch] : [`像素差 ${(pd.ratio * 100).toFixed(3)}%（${pd.diffPixels}px／${pd.size}）`, pd.ratio <= 0.001, ""]); }
        catch (e) { checks.push(["像素比對", false, String(e).slice(0, 120)]); }
        const fail = checks.filter((c) => !c[1]); if (fail.length) failed = true;
        console.log(`  ${fail.length ? "❌" : "✓"} ${path.basename(f)} [${v.key}] ${checks.map((c) => c[0]).join("｜")}${fail.length ? "\n       ← " + fail.map((c) => c[0] + (c[2] ? "：" + c[2] : "")).join("\n       ← ") : ""}`);
        if (fail.some((c) => /像素/.test(c[0]))) { fs.writeFileSync(path.join(tmpDir, `${path.basename(f, ".html")}.${v.key}.orig.png`), o.shot); fs.writeFileSync(path.join(tmpDir, `${path.basename(f, ".html")}.${v.key}.main.png`), m.shot); console.log(`       截圖留在 ${tmpDir}`); }
      }
    }
    await browser.close();
  }

  if (failed) { console.error("\n❌ 有紅燈：main.css 不能交付"); process.exit(1); }
  if (checkFiles.length || renderFiles.length) console.log("\n✅ 證明全過");
})().catch((e) => { console.error("❌ build_aem_shared_css 失敗：" + e.message); process.exit(1); });
