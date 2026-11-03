#!/usr/bin/env node
/* clip_scan.js —— 文字截斷／溢出全掃（2026-08-30 立）
 *
 * 為什麼有這支：使用者連兩輪報「商品卡文字被截斷」，我改了一個模組的一個欄位就回報「修好了」，
 * 實際上其他模組與其他裝置照樣截斷——因為我用眼睛判斷「應該只有那裡」。
 * 這支把「同病全掃」從人的自覺變成機器動作：跨模組 × 跨裝置一次掃完，列出每一處被裁或溢出的文字。
 *
 * 用法：node tools/clip_scan.js <runId> [--devices=desktop,tablet,mobile] [--json]
 * 退出碼：有真問題＝1（可當守門），全乾淨＝0
 */
const path = require("path");
const fs = require("fs");
const PIPE = path.join(__dirname, "..");
const { chromium } = require(path.join(PIPE, "node_modules", "playwright-core"));

const args = process.argv.slice(2);
const runId = args.find((a) => !a.startsWith("--"));
if (!runId) { console.error("用法：node tools/clip_scan.js <runId> [--devices=...] [--json]"); process.exit(2); }
const devArg = (args.find((a) => a.startsWith("--devices=")) || "").split("=")[1];
const DEVICES = (devArg ? devArg.split(",") : ["desktop", "tablet", "mobile"]).map((d) => d.trim());
const asJson = args.includes("--json");
const W = { desktop: 1440, tablet: 768, mobile: 375 };

/* 白名單＝設計上本來就該裁的，不算問題（改這裡要寫清楚為什麼） */
const IGNORE_CLASS = [
  "sr-only",        // 給讀螢幕軟體的隱藏字，1px 盒子本來就裁
  "anchor-item",    // 錨點導航＝橫向可滑動列，超出畫面是設計
];
const PASS_FILE = path.join(PIPE, "workbench", ".wb-pass");

(async () => {
  const pass = fs.existsSync(PASS_FILE) ? fs.readFileSync(PASS_FILE, "utf8").trim() : "";
  const b = await chromium.launch({ channel: "chrome" });
  const all = [], fatal = [];
  for (const dev of DEVICES) {
    const q = dev === "desktop" ? "" : `device=${dev}&`;
    const ctx = await b.newContext({ viewport: { width: W[dev] || 1440, height: 1400 },
      httpCredentials: pass ? { username: "yahoo", password: pass } : undefined });
    const p = await ctx.newPage();
    const errs = [];
    p.on("pageerror", (e) => errs.push(String(e).slice(0, 120)));
    await p.goto(`http://localhost:8787/frametest/?${q}draftUrl=/api/runs/${runId}/draft.json`, { waitUntil: "load" });
    await p.waitForTimeout(2600);
    const hits = await p.evaluate((IGNORE) => {
      const out = [];
      const secOf = (el) => { const s = el.closest("section"); return s ? (s.id || String(s.className).slice(0, 20)) : "(頁面層)"; };
      document.querySelectorAll("body *").forEach((el) => {
        const txt = (el.textContent || "").trim();
        if (!txt || el.children.length > 0) return;               // 只看葉節點文字
        if (IGNORE.some((c) => el.classList.contains(c) || el.closest("." + c))) return; /* 白名單往祖先爬（2026-10-08）：白名單一個容器＝它裡面的字一起算——原本只看自己，anchor-item 按鈕裡沒 class 的「↑」span 漏接假紅 */
        const cs = getComputedStyle(el);
        if (cs.display === "none" || cs.visibility === "hidden") return;
        const r = el.getBoundingClientRect();
        if (!r.width || !r.height) return;
        let why = null, kind = null;
        /* 判準（2026-08-30 首跑後收斂＝別喊狼來了，會被當雜訊忽略）：
           ・單行省略號（white-space:nowrap + text-overflow:ellipsis）＝設計上的截斷、有「…」可見 → 不算缺陷
           ・多行夾擠（-webkit-line-clamp）＝縱向截斷正常；但「橫向」還被裁＝該行放不下又斷不了行 → 算缺陷
           ・完全沒有截斷設定卻被裁 → 算缺陷（硬生生切掉、使用者看不出被截）
           ・祖先是橫向可滑動列（overflow-x auto/scroll）→ 內容超出可以滑到，不算缺陷 */
        const hasEllipsis = cs.textOverflow === "ellipsis" && /nowrap/.test(cs.whiteSpace);
        const hasClamp = cs.webkitLineClamp && cs.webkitLineClamp !== "none";
        let inScroller = false;
        for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
          const acs = getComputedStyle(a);
          if (/auto|scroll/.test(acs.overflowX)) { inScroller = true; break; }
        }
        /* 門檻 12px（2026-08-30 實拍校準）：-webkit-box + line-clamp 的 scrollWidth 會固定多報 2~7px
           ＝量測誤差不是視覺缺陷（實拍證據：mobile 品類牆品名兩行完整、無切字，卻回報硬裁 5px）。
           喊狼來了的掃描器等於沒有掃描器，寧可放過個位數也不要淹沒真缺陷。 */
        const HARD_CLIP_MIN = 12;
        // ① 自身橫向硬裁（無省略號可見）
        if (!hasEllipsis && el.scrollWidth - el.clientWidth > HARD_CLIP_MIN && /hidden|clip/.test(cs.overflowX)) {
          why = `自身橫向硬裁 ${el.scrollWidth - el.clientWidth}px${hasClamp ? "（多行夾擠但該行斷不了）" : "（沒有省略號＝直接切掉）"}`; kind = "clipX";
        }
        if (!why) {
          // ② 被祖先容器裁掉（可滑動列不算）
          let a = el.parentElement;
          while (a && a !== document.body) {
            const acs = getComputedStyle(a), ar = a.getBoundingClientRect();
            if (/hidden|clip/.test(acs.overflow + acs.overflowX + acs.overflowY) && ar.width) {
              if (r.right - ar.right > 1) { why = `被「${String(a.className).slice(0, 18) || a.tagName}」右緣切掉 ${Math.round(r.right - ar.right)}px`; kind = "clipByAncestor"; break; }
              if (ar.left - r.left > 1) { why = `被「${String(a.className).slice(0, 18) || a.tagName}」左緣切掉 ${Math.round(ar.left - r.left)}px`; kind = "clipByAncestor"; break; }
            }
            a = a.parentElement;
          }
        }
        /* ③ 溢出畫面。可滑動列「不是自動無罪」（2026-08-30 修正：這個豁免害我漏抓使用者連三輪報的同一個 bug）——
           照樣報，只是標明它在可滑動列裡，由人判斷「該滑動還是該攤平」。
           實例：本期活動 3 則的規格是攤平、不是滑動；攤平規則漏寫平板手機，第三張被切，
           掃描器卻因為它在 overflow-x:auto 容器裡而放過。 */
        if (!why && r.right > window.innerWidth + 1) {
          why = `超出畫面右緣 ${Math.round(r.right - window.innerWidth)}px` + (inScroller ? "（在可滑動列裡——確認這裡該滑動還是該攤平）" : "");
          kind = inScroller ? "overflowInScroller" : "overflowViewport";
        }
        if (why) out.push({ sec: secOf(el), cls: String(el.className).slice(0, 26) || el.tagName, txt: txt.slice(0, 24), why, kind });
      });
      return out;
    }, IGNORE_CLASS);
    // 同型去重（同區塊＋同 class＋同型別＝一筆代表）
    const seen = new Set(), uniq = [];
    for (const h of hits) { const k = h.sec + "|" + h.cls + "|" + h.kind; if (seen.has(k)) continue; seen.add(k); uniq.push({ ...h, dev }); }
    all.push(...uniq);
    if (errs.length) console.error(`⚠ ${dev} pageerror ${errs.length}：${errs.join(" | ")}`);
    /* 量測有效性前提（2026-09-03，同 price_qa 第三例）：草稿沒載進殼／文字節點寥寥／pageerror＝這一輪掃描無效，不能拿「0 型」當乾淨 */
    const loaded = await p.evaluate(() => ({ layout: document.body.getAttribute("data-layout") || "", leaves: [...document.querySelectorAll("body *")].filter((el) => el.children.length === 0 && (el.textContent || "").trim()).length }));
    if (!loaded.layout || loaded.leaves < 20 || errs.length) fatal.push(`${dev}：${!loaded.layout ? "草稿沒載入（body 無 data-layout）" : ""}${loaded.leaves < 20 ? ` 文字節點只有 ${loaded.leaves}` : ""}${errs.length ? ` pageerror ${errs.length}` : ""}`.trim());
    await ctx.close();
  }
  await b.close();

  if (fatal.length) { console.error(`\n✗ FATAL 掃描無效（不是乾淨）：${fatal.join("；")}——請確認工作台在跑、run 存在、頁面能載入`); if (asJson) console.log(JSON.stringify({ runId, fatal, findings: all }, null, 1)); process.exit(2); }
  if (asJson) { console.log(JSON.stringify({ runId, findings: all }, null, 1)); process.exit(all.length ? 1 : 0); }
  console.log(`\n══ 文字截斷全掃：${runId}（${DEVICES.join("／")}）══`);
  if (!all.length) { console.log("  ✅ 沒有被裁或溢出的文字"); process.exit(0); }
  const byDev = {};
  all.forEach((h) => { (byDev[h.dev] = byDev[h.dev] || []).push(h); });
  for (const dev of DEVICES) {
    const list = byDev[dev] || [];
    console.log(`\n【${dev}】${list.length} 型`);
    list.forEach((h) => console.log(`  ✗ [${h.sec}] .${h.cls} 「${h.txt}」——${h.why}`));
  }
  console.log(`\n共 ${all.length} 型。白名單（設計上本來就裁）＝${IGNORE_CLASS.join("／")}；要加白名單請在本檔寫明理由。`);
  process.exit(1);
})().catch((e) => { console.error("clip_scan 失敗：", e.message); process.exit(2); });
