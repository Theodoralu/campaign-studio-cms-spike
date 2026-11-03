#!/usr/bin/env node
/* contrast_scan.js —— 整頁文字可讀性全掃（2026-09-01 立）
 *
 * 為什麼有這支：使用者在色彩策略工具挑了螢光黃當主色，hero 看起來好好的，貼進 CMS 後
 * 下方模組的情境卡標籤與「編輯精選」章牌變成「黃底白字」，對比只有 1.18:1（幾乎看不見）。
 * 根因是渲染端兩個元件把字色寫死白色、沒接上 2026-08-27 立的「亮度感應擇字」規則——
 * 但更上游的問題是：**沒有任何機器在量「使用者最後看到的那個畫面」的對比**。
 * 設計師的工具只預覽 hero，CMS 的檢查層只檢設計師填的那幾個槽，兩邊都看不到「主色落到下方模組會怎樣」。
 *
 * 這支把它變成機器動作：把整頁每一段文字跟它「實際坐著的那個底色」逐一量出來，跨三裝置一次掃完。
 * 判準＝WCAG AA：正文 ≥4.5:1、大字（≥24px，或 ≥18.66px 且粗體）≥3.0:1。
 *
 * 用法：node tools/contrast_scan.js <runId> [--devices=desktop,tablet,mobile] [--base=http://...] [--json]
 * 退出碼：有不合格＝1（可當守門），全乾淨＝0
 *
 * 限制誠實列：
 *  - 純色底＝直接量。文字壓在背景圖或漸層上（hero 主視覺多屬此類）＝單一色值判不準，**2026-09-27 起改截圖取樣估算**（使用者裁決牆
 *    qa/hero-price-discount-color-wall-2026-09-27 Q5 乙）：把那段文字暫時 visibility:hidden → 截它所在那塊 → 讀像素亮度（平均＋10／90 百分位）
 *    → 字色對「平均底」與「最亮／最暗那一成底」各算一次對比，最差那個低於門檻＝⚠ 出聲。**只出聲不擋、不進 exit code**——對著照片算對比本來就是估。
 *    病例＝hero 的折數（85折）壓在背景圖上，換深底主題看不清，而這支原本把它歸「不判定」＝機器永遠不會叫、只有人眼。
 *    隱藏而不是把字改透明＝字風的襯字層（::before/::after）、描邊、色影用行內樣式關不掉，visibility:hidden 連它們一起收；取樣不含字型抗鋸齒。
 *  - 半透明文字會先跟底色混算再量（跟眼睛看到的一致）。
 *  - 半透明「底」也會沿祖先一層層疊上去合成（2026-09-03 補：原本碰到第一個 a>0.92 的底就停＝50% 白框、55% 模組底被跳過、
 *    拿更下層的深色頁底來量——黃色主色壓 50% 白框判 PASS 的病例就是這樣漏掉的）。
 *  - 錨點導航 active 膠囊只在捲動後出現＝掃頂端量不到，改為暫時全開 is-active 量完還原（互動態探針）。
 *  - **兄弟層畫的底**：純色底仍只沿祖先鏈找（底由同層另一節點畫＝中秋拱窗 SVG／舞台框／導航箭頭底下的舞台，量到更外層頁底＝
 *    會誤報「奶油字壓奶油底 1:1」，中秋頁固定 11 處誤報，已知）。**2026-09-27 起「圖」這一半已補**：祖先的 ::before/::after 底紋、
 *    住在同一個不透明容器裡且蓋住文字中心的兄弟圖層（桌機滿版 .hv2-bleed、溝槽帶）都算「壓在圖上」→ 走截圖取樣估算。純色兄弟層仍是盲區。
 *  - 量的是 CSS 算出來的顏色，不是螢幕截圖取樣——字型抗鋸齒造成的邊緣灰階不在範圍。
 */
const path = require("path");
const fs = require("fs");
const PIPE = path.join(__dirname, "..");
const { chromium } = require(path.join(PIPE, "node_modules", "playwright-core"));

const args = process.argv.slice(2);
const runId = args.find((a) => !a.startsWith("--"));
if (!runId) { console.error("用法：node tools/contrast_scan.js <runId> [--devices=...] [--base=...] [--json]"); process.exit(2); }
const devArg = (args.find((a) => a.startsWith("--devices=")) || "").split("=")[1];
const DEVICES = (devArg ? devArg.split(",") : ["desktop", "tablet", "mobile"]).map((d) => d.trim());
const BASE = (args.find((a) => a.startsWith("--base=")) || "").split("=")[1] || "http://localhost:8787";
const asJson = args.includes("--json");
const W = { desktop: 1440, tablet: 768, mobile: 375 };
const PASS_FILE = path.join(PIPE, "workbench", ".wb-pass");

/* 白名單＝設計上已裁定可接受的組合（加一條要寫清楚「誰在哪天裁的、為什麼」，不寫理由的不准加）。
   目前空白：本批（2026-09-01）抓到的三族全部走根治，沒有一條靠豁免過關。 */
const ALLOW = [];

/* 疊圖取樣估算（2026-09-27 使用者裁決牆 Q5 乙＝出聲不擋）：見檔頭限制列第一條。
   做法：對每筆 onImage 命中——捲到看得見 → 量位置 → 把那段文字 visibility:hidden（!important；取完原樣還原）→ 截那塊（視窗座標）→
   在頁內用 canvas 解 PNG 取像素亮度（最多取 2 萬點）→ 平均／10 百分位／90 百分位 → 字色對三個底各算對比，最差那個 < 門檻＝below。
   任何一步失敗＝estimate.skipped 講原因，不吞、不影響其他筆。 */
async function sampleOnImage(p, hits) {
  const lumHex = (h) => { const n = parseInt(String(h).replace("#", ""), 16); const lin = (x) => { x /= 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); }; return 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255); };
  const cr = (l1, l2) => (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
  const r2 = (v) => Math.round(v * 100) / 100;
  for (const h of hits) {
    if (!h.onImage || h.probe == null) continue;
    const loc = p.locator(`[data-cs-probe="${h.probe}"]`).first();
    try {
      await loc.scrollIntoViewIfNeeded({ timeout: 2000 });
      const box = await loc.boundingBox();
      if (!box || box.width < 2 || box.height < 2) { h.estimate = { skipped: "量不到位置" }; continue; }
      const vp = p.viewportSize() || { width: 1440, height: 1400 };
      const x = Math.max(0, box.x), y = Math.max(0, box.y);
      const clip = { x, y, width: Math.max(1, Math.min(box.width, vp.width - x)), height: Math.max(1, Math.min(box.height, vp.height - y)) };
      const prev = await loc.evaluate((el) => { const v = el.style.getPropertyValue("visibility"); el.style.setProperty("visibility", "hidden", "important"); return v; });
      let png;
      try { png = await p.screenshot({ clip, type: "png" }); }
      finally { await loc.evaluate((el, v) => { if (v) el.style.setProperty("visibility", v); else el.style.removeProperty("visibility"); }, prev); }
      const st = await p.evaluate(async (b64) => {
        const img = new Image(); img.src = "data:image/png;base64," + b64; await img.decode();
        const c = document.createElement("canvas"); c.width = img.naturalWidth; c.height = img.naturalHeight;
        if (!c.width || !c.height) return null;
        const g = c.getContext("2d"); g.drawImage(img, 0, 0);
        const d = g.getImageData(0, 0, c.width, c.height).data;
        const lin = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
        const step = Math.max(1, Math.floor((c.width * c.height) / 20000)); const L = []; let r = 0, gg = 0, bb = 0;
        for (let i = 0; i < d.length; i += 4 * step) { L.push(0.2126 * lin(d[i]) + 0.7152 * lin(d[i + 1]) + 0.0722 * lin(d[i + 2])); r += d[i]; gg += d[i + 1]; bb += d[i + 2]; }
        L.sort((a, b) => a - b); const n = L.length; if (!n) return null;
        return { n, avg: L.reduce((a, b) => a + b, 0) / n, p10: L[Math.floor(n * 0.1)], p90: L[Math.min(n - 1, Math.floor(n * 0.9))], rgb: [r / n, gg / n, bb / n] };
      }, png.toString("base64"));
      if (!st) { h.estimate = { skipped: "截圖解不出像素" }; continue; }
      const lf = lumHex(h.fg);
      const avgCr = cr(lf, st.avg), worstCr = Math.min(cr(lf, st.p10), cr(lf, st.p90));
      h.estimate = { avgCr: r2(avgCr), worstCr: r2(worstCr), spread: r2(st.p90 - st.p10), samples: st.n,
        bgAvg: "#" + st.rgb.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("").toUpperCase(), below: worstCr < h.need };
    } catch (e) { h.estimate = { skipped: String((e && e.message) || e).split("\n")[0].replace(/^locator\.\w+: /, "").slice(0, 70) }; } /* 多半＝輪播裡沒露出的那張卡捲不到；只記第一行、不印 call log */
  }
  await p.evaluate(() => document.querySelectorAll("[data-cs-probe]").forEach((el) => el.removeAttribute("data-cs-probe"))).catch(() => {});
}

(async () => {
  const pass = fs.existsSync(PASS_FILE) ? fs.readFileSync(PASS_FILE, "utf8").trim() : "";
  const b = await chromium.launch({ channel: "chrome" });
  const all = [], fatal = [];
  for (const dev of DEVICES) {
    const q = dev === "desktop" ? "" : `device=${dev}&`;
    const ctx = await b.newContext({ viewport: { width: W[dev] || 1440, height: 1400 },
      httpCredentials: pass ? { username: "yahoo", password: pass } : undefined });
    const p = await ctx.newPage();
    const errs = []; p.on("pageerror", (e) => errs.push(String(e).slice(0, 120)));
    await p.goto(`${BASE}/frametest/?${q}draftUrl=/api/runs/${runId}/draft.json`, { waitUntil: "load" });
    await p.waitForTimeout(2800);
    const hits = await p.evaluate(() => {
      const parse = (c) => { const m = String(c).match(/rgba?\(([^)]+)\)/); if (!m) return null;
        const a = m[1].split(",").map((s) => parseFloat(s)); return { r: a[0], g: a[1], b: a[2], a: a.length > 3 ? a[3] : 1 }; };
      const lin = (x) => { x /= 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); };
      const lum = (c) => 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b);
      const ratio = (a, b2) => { const l1 = lum(a), l2 = lum(b2); return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05); };
      const over = (fg, bg) => ({ r: fg.r * fg.a + bg.r * (1 - fg.a), g: fg.g * fg.a + bg.g * (1 - fg.a), b: fg.b * fg.a + bg.b * (1 - fg.a), a: 1 });
      const hex = (c) => "#" + [c.r, c.g, c.b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("").toUpperCase();
      const secOf = (el) => { let n = el; while (n && n !== document.body) { if (n.id && /^sec-|^hv2|^kv/.test(n.id)) return n.id; n = n.parentElement; } return "(頁面)"; };
      /* 找「文字實際坐著的那個底」：往上爬到第一個不透明的底色；沿途遇到背景圖就記下來（無法用單色判定） */
      /* 2026-09-03 盲區回填（使用者病例：黃色主題編輯精選標題黃字壓「50% 白底」不可讀，掃描器判 PASS）：原本「爬到第一個 a>0.92 的底就停」
         ＝半透明面（50% 白框、55% 模組底）被跳過、拿更下層的深色頁底來量＝黃字對深紅反而高分。改＝半透明底一層層往下合成（overA），直到不透明。 */
      const overA = (top, below) => { const a = top.a + below.a * (1 - top.a); const f = (k) => (top[k] * top.a + below[k] * below.a * (1 - top.a)) / (a || 1); return { r: f("r"), g: f("g"), b: f("b"), a }; };
      /* 「壓在圖上」偵測三路（2026-09-27 補；原本只看祖先本身的 background-image＝hero 的圖幾乎都在別處畫、折數從沒被歸到壓圖）：
         ①祖先本身的 background-image（換裝後的舞台照片＝行內樣式，這路原本就看得到）
         ②祖先的 ::before／::after 有 background-image（版式預設底紋＝section::before 的 SVG）
         ③兄弟圖層：IMG／PICTURE／VIDEO／CANVAS 或有 background-image 的元素，方框蓋住文字中心、不是祖先也不是子孫、
           而且住在「文字實際坐著的那個不透明容器」裡面（桌機滿版 .hv2-bleed、溝槽帶 .hv2-bridge）——住在外面的圖被容器的實底蓋住、不算 */
      const imageLayers = [...document.querySelectorAll("body *")].filter((x) => { if (/^(IMG|PICTURE|VIDEO|CANVAS)$/.test(x.tagName)) return true; const s = getComputedStyle(x); return s.backgroundImage && s.backgroundImage !== "none"; })
        .map((x) => ({ x, q: x.getBoundingClientRect() })).filter((o) => o.q.width > 8 && o.q.height > 8);
      const pseudoImg = (n) => { for (const ps of ["::before", "::after"]) { const s = getComputedStyle(n, ps); if (s.content !== "none" && s.backgroundImage && s.backgroundImage !== "none") return n.tagName.toLowerCase() + ps + " " + s.backgroundImage.slice(0, 40); } return null; };
      const siblingImg = (el, r, scope) => { const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
        const hit = imageLayers.find((o) => scope.contains(o.x) && !o.x.contains(el) && !el.contains(o.x) && o.q.left <= cx && o.q.right >= cx && o.q.top <= cy && o.q.bottom >= cy);
        return hit ? ("兄弟層 " + hit.x.tagName.toLowerCase() + "." + String(hit.x.className).split(/\s+/)[0]) : null; };
      const bgOf = (el, r) => { let n = el, img = null, acc = null;
        while (n && n !== document.documentElement) { const s = getComputedStyle(n);
          if (!img && s.backgroundImage && s.backgroundImage !== "none") img = s.backgroundImage.slice(0, 50);
          if (!img) img = pseudoImg(n);
          const c = parse(s.backgroundColor); if (c && c.a > 0) { acc = acc ? overA(acc, c) : c; if (acc.a > 0.995) { if (!img) img = siblingImg(el, r, n); return { color: acc, from: n, img }; } }
          n = n.parentElement; }
        const W = { r: 255, g: 255, b: 255, a: 1 }; if (!img) img = siblingImg(el, r, document.body); return { color: acc ? overA(acc, W) : W, from: document.body, img }; };
      /* 錨點導航 active 態探針（同批病例：黃底白字 active 膠囊只在捲動後出現＝掃頂端量不到）：暫時全開 is-active 量完還原 */
      const probed = [...document.querySelectorAll(".anchor-item:not(.top):not(.is-active)")]; probed.forEach((a) => a.classList.add("is-active"));
      const out = [];
      document.querySelectorAll("body *").forEach((el) => {
        const txt = Array.from(el.childNodes).filter((n) => n.nodeType === 3).map((n) => n.textContent.trim()).join("").trim();
        if (!txt) return;
        const r = el.getBoundingClientRect(); if (r.width < 2 || r.height < 2) return;
        const s = getComputedStyle(el);
        if (s.visibility === "hidden" || s.display === "none" || parseFloat(s.opacity) < 0.1) return;
        if (parseFloat(s.fontSize) < 1) return; /* 字級 0＝用零字級藏起來的文字（例：手機版 dock 的 TOP 鈕改用圖示），眼睛看不到＝不量 */
        const fg0 = parse(s.color); if (!fg0) return;
        const bk = bgOf(el, r); const fg = fg0.a < 1 ? over(fg0, bk.color) : fg0;
        const size = parseFloat(s.fontSize), weight = Number(s.fontWeight) || 400;
        const large = size >= 24 || (size >= 18.66 && weight >= 700);
        const need = large ? 3.0 : 4.5, cr = ratio(fg, bk.color);
        /* 疊圖的一律送去取樣（2026-09-27）：原本「單色估過了就不記」＝橘色折數對淺色後備底 ≥3 直接放過，照片底再暗也從沒被量到（003 折數病例）；
           純色底維持「過了就不記」。onImage 的命中不進 real、不影響 exit code。 */
        if (cr >= need && !bk.img) return;
        let probe = null; if (bk.img) { probe = out.length; el.setAttribute("data-cs-probe", String(probe)); } /* 疊圖取樣用的臨時標記（sampleOnImage 取完會清） */
        out.push({ sec: secOf(el), sel: el.tagName.toLowerCase() + (el.className ? "." + String(el.className).trim().split(/\s+/).slice(0, 2).join(".") : ""),
          txt: txt.slice(0, 30), fg: hex(fg), bg: hex(bk.color), size, weight,
          cr: Math.round(cr * 100) / 100, need, onImage: !!bk.img, probe, y: Math.round(r.top + scrollY) });
      });
      probed.forEach((a) => a.classList.remove("is-active"));
      return out;
    });
    await sampleOnImage(p, hits); /* 疊圖取樣估算（2026-09-27 Q5 乙）：只補 onImage 那幾筆的 estimate，不動 real 判定 */
    hits.forEach((h) => all.push({ device: dev, ...h }));
    /* 量測有效性前提（2026-09-03，同 price_qa 第三例）：草稿沒載進殼／文字節點寥寥／pageerror＝這一輪無效，不能拿「0 不合格」當達標 */
    const loaded = await p.evaluate(() => ({ layout: document.body.getAttribute("data-layout") || "", leaves: [...document.querySelectorAll("body *")].filter((el) => el.children.length === 0 && (el.textContent || "").trim()).length }));
    if (!loaded.layout || loaded.leaves < 20 || errs.length) fatal.push(`${dev}：${!loaded.layout ? "草稿沒載入（body 無 data-layout）" : ""}${loaded.leaves < 20 ? ` 文字節點只有 ${loaded.leaves}` : ""}${errs.length ? ` pageerror ${errs.length}` : ""}`.trim());
    await ctx.close();
  }
  await b.close();

  const allowed = (h) => ALLOW.some((a) => a.sel === h.sel && a.device === h.device);
  const real = all.filter((h) => !allowed(h) && !h.onImage);
  const onImg = all.filter((h) => !allowed(h) && h.onImage);

  if (fatal.length) { console.error(`\n✗ FATAL 掃描無效（不是達標）：${fatal.join("；")}——請確認工作台在跑、run 存在、頁面能載入`); if (asJson) console.log(JSON.stringify({ runId, fatal, real, onImage: onImg }, null, 1)); process.exit(2); }
  if (asJson) { console.log(JSON.stringify({ runId, real, onImage: onImg }, null, 1)); process.exit(real.length ? 1 : 0); }
  console.log(`\n可讀性掃描｜${runId}｜裝置：${DEVICES.join("／")}`);
  if (!real.length) console.log("✓ 純色底文字全數達標（正文 4.5、大字 3.0）");
  real.sort((a, b2) => a.cr - b2.cr).forEach((h) =>
    console.log(`  ✗ ${h.cr}:1（需 ${h.need}）｜${h.device}｜${h.sec} ${h.sel}｜「${h.txt}」${h.size}px/${h.weight}｜字 ${h.fg} 底 ${h.bg}｜y=${h.y}`));
  const sampled = onImg.filter((h) => h.estimate && h.estimate.avgCr != null);
  const below = sampled.filter((h) => h.estimate.below);
  const skipped = onImg.filter((h) => !h.estimate || h.estimate.avgCr == null);
  if (onImg.length) {
    console.log(`\n⚠ 壓在背景圖／漸層上 ${onImg.length} 處＝單色量不準，改截圖取樣估算（只出聲不擋；2026-09-27 使用者裁 Q5 乙）：取樣 ${sampled.length}、低於門檻 ${below.length}${skipped.length ? `、取樣略過 ${skipped.length}` : ""}`);
    below.sort((a, b2) => a.estimate.worstCr - b2.estimate.worstCr).slice(0, 12).forEach((h) => { const e = h.estimate;
      console.log(`  ⚠ 最差 ${e.worstCr}:1・平均 ${e.avgCr}:1（需 ${h.need}）｜${h.device}｜${h.sec} ${h.sel}｜「${h.txt}」${h.size}px/${h.weight}｜字 ${h.fg} 底均 ${e.bgAvg}（亮度起伏 ${e.spread}）｜y=${h.y}`); });
    skipped.slice(0, 6).forEach((h) => console.log(`  · 略過｜${h.device}｜${h.sec} ${h.sel}｜「${h.txt}」：${(h.estimate && h.estimate.skipped) || "?"}`));
  }
  console.log(`\nCONTRAST_SCAN:${real.length ? "FAIL" : "PASS"}（不合格 ${real.length} 處${onImg.length ? `、疊圖估算 ${sampled.length} 處${below.length ? `（${below.length} 處低於門檻・出聲不擋）` : "（全在門檻上）"}` : ""}）`);
  process.exit(real.length ? 1 : 0);
})();
