#!/usr/bin/env node
/* typo_matrix.js —— 排版四控制 × 27 款字風「到底有沒有生效」矩陣
 *
 * 為什麼有這支：設計師回報「切某些字風時行距調不動」。這是典型的**名單型毛病**——
 * 27 款裡只有幾款壞，用手邊那一款試永遠試不出來（經驗卡 20260903-run-the-whole-list-not-one）。
 * 判準是**使用者看得見的那件事**：把檔位從「標準」推到另一檔，畫面上那個數字有沒有真的動。
 *
 * 走的路＝`loadProposalPack`，也就是色彩工具預覽真正走的那條（不是自己拼 draft——首跑實踩：
 * 自拼 draft 的 hero 槽名對不上，標題是 slot-empty，引擎對空標題不掛字風，27 款全部量不到）。
 *
 * 量法：每款字風跑 5 次渲染＝1 次基準（四控制全標準）＋4 次各推一支到極檔（隔離量，
 * 因為吸字會讓「改寬度」連帶改字級，混在一起就分不清是誰的功勞）。
 * 推了畫面數字沒動＝該款該控制 🔴 失效。
 *
 * 量測有效性（經驗卡 measurement-validity-precondition）：量不到＝FATAL，不因「沒量到就沒有失效格」報綠。
 *
 * 用法：node tools/typo_matrix.js [--layout layout-002] [--only css-n3,css-a2] [--json]
 */
const path = require("path");
const fs = require("fs");
const { chromium } = require("playwright-core");

const ROOT = path.resolve(__dirname, "..", "..", "..");
const FRAMETEST = path.join(ROOT, "2026-AI自動化活動頁生成規劃", "MVP_Phase1_LeCreuset_活動頁Prototype_FrameTest.html");
const TS_MANIFEST = path.join(ROOT, "design-assets", "typestyles", "manifest.json");

/* 四支控制：檔位欄位 → 推到哪一檔 → 畫面上要跟著動的那個數字 */
const CONTROLS = [
  { key: "titleScale",    push: "lg",     label: "字級",     metric: "fontSize" },
  { key: "titleTracking", push: "lg",     label: "字距",     metric: "letterSpacing" },
  { key: "titleLeading",  push: "lg",     label: "行距",     metric: "leadRatio" },
  { key: "titleWidth",    push: "narrow", label: "排版寬度", metric: "boxWidth" },
];
const BASE = { titleScale: "md", titleTracking: "md", titleLeading: "md", titleWidth: "standard" };

async function render(page, layout, titleStyle, typo, frame) {
  const r = await page.evaluate(({ layout, ts, typo, frame }) => {
    const res = loadProposalPack(
      { layout, titleStyle: ts, titleFrame: frame },
      { previewTitleStyle: ts, typography: typo,
        demo: { titleText: "限時優惠中", subtitleText: "全館五折起", dateValue: "09/01 - 10/10" } }
    );
    return res && res.ok === false ? { ok: false, reason: res.reason } : { ok: true };
  }, { layout, ts: titleStyle, typo, frame: frame || null });
  if (!r.ok) return { fatal: r.reason };
  await page.waitForTimeout(700);
  return page.evaluate(() => {
    const el = document.querySelector(".hero-font-preview");
    if (!el) return { fatal: "字風沒掛上標題節點" };
    const cs = getComputedStyle(el);
    const fs = parseFloat(cs.fontSize) || 0;
    const lh = cs.lineHeight === "normal" ? fs * 1.2 : parseFloat(cs.lineHeight);
    const box = el.getBoundingClientRect();
    return {
      fontSize: Math.round(fs * 100) / 100,
      letterSpacing: cs.letterSpacing === "normal" ? 0 : Math.round(parseFloat(cs.letterSpacing) * 1000) / 1000,
      leadRatio: fs ? Math.round((lh / fs) * 1000) / 1000 : null,
      /* 排版寬度量三層：字自己的盒 + 往上四層容器（006/007 是改「標題群容器」的 max-width，
         字本身沒換行時寬度不動＝只量字會漏判為失效——首跑實踩） */
      boxWidth: (() => {
        let n = el, acc = [];
        for (let i = 0; i < 5 && n; i++, n = n.parentElement) {
          const r = n.getBoundingClientRect(); const mw = parseFloat(getComputedStyle(n).maxWidth);
          acc.push(Math.round(r.width * 10) / 10, isNaN(mw) ? 0 : Math.round(mw * 10) / 10);
        }
        return acc.join("|");
      })(),
    };
  });
}

(async () => {
  const args = process.argv.slice(2);
  const layout = args.includes("--layout") ? args[args.indexOf("--layout") + 1] : "layout-002";
  const only = args.includes("--only") ? args[args.indexOf("--only") + 1].split(",") : null;
  const man = JSON.parse(fs.readFileSync(TS_MANIFEST, "utf8"));
  let styles = man.assets.map((a) => ({ code: "css-" + a.code.toLowerCase(), name: a.displayName }));
  if (only) styles = styles.filter((s) => only.includes(s.code));

  const browser = await chromium.launch({ channel: "chrome" });
  const page = await browser.newPage({ viewport: { width: 1264, height: 1000 } });
  const errs = [];
  page.on("pageerror", (e) => errs.push(e.message));
  await page.goto("file://" + FRAMETEST + "?device=desktop", { waitUntil: "load" });
  await page.waitForTimeout(2000);

  const frame = args.includes("--frame") ? args[args.indexOf("--frame") + 1] : null;
  const sweep = args.includes("--sweep-layouts");
  const LAYOUTS = ["layout-001","layout-002","layout-003","layout-004","layout-005","layout-006","layout-007","layout-008","layout-009","layout-010","layout-011"];
  /* 掃版式模式：固定一款字風、跑 11 款版式——因為首跑發現失效格跟字風無關、跟版式有關 */
  const units = sweep
    ? LAYOUTS.map(l => ({ code: styles[0].code, name: l, layout: l }))
    : styles.map(s2 => ({ ...s2, layout }));

  if (args.includes("--chain")) {
    for (const l of ["layout-001","layout-002","layout-003","layout-009","layout-010"]) {
      const r = await render(page, l, styles[0].code, { ...BASE }, frame);
      if (r.fatal) { console.log(l + " 🔴 " + r.fatal); continue; }
      const chain = await page.evaluate(() => {
        let n = document.querySelector(".hero-font-preview"), out = [];
        for (let i = 0; i < 5 && n; i++, n = n.parentElement) {
          const cs = getComputedStyle(n);
          out.push(`${n.tagName}${n.id ? "#" + n.id : ""}.${(n.className || "").toString().replace(/\s+/g, ".").slice(0, 40)} w=${Math.round(n.getBoundingClientRect().width)} maxW=${cs.maxWidth} display=${cs.display}`);
        }
        return out;
      });
      console.log("\n【" + l + "】"); chain.forEach(c => console.log("  " + c));
    }
    await browser.close(); return;
  }
  const rows = [];
  for (const st of units) {
    const base = await render(page, st.layout, st.code, { ...BASE }, frame);
    if (base.fatal || !base.fontSize) { rows.push({ ...st, fatal: base.fatal || "標題字級量到 0" }); continue; }
    const res = {};
    for (const c of CONTROLS) {
      const m = await render(page, st.layout, st.code, { ...BASE, [c.key]: c.push }, frame);
      const b = base[c.metric], a = m && !m.fatal ? m[c.metric] : null;
      const live = a === null || b === null ? false
        : (typeof b === "string" ? a !== b : Math.abs(a - b) > 0.01);
      res[c.key] = { before: b, after: a, live };
    }
    rows.push({ ...st, base, res });
  }
  await browser.close();

  if (args.includes("--json")) { console.log(JSON.stringify({ layout, rows, pageErrors: errs }, null, 2)); return; }

  console.log(`\n排版四控制 × ${rows.length} ${sweep ? "款版式（字風 " + units[0].code + "）" : "款字風（版式 " + layout + "）"}${frame ? "｜裝飾線 " + frame : ""}——判準＝推一檔畫面數字有沒有真的動\n`);
  console.log((sweep ? "版式" : "字風").padEnd(26) + CONTROLS.map((c) => c.label.padEnd(10)).join(""));
  console.log("─".repeat(72));
  const dead = {}; let fatals = 0;
  for (const r of rows) {
    if (r.fatal) { console.log(r.name.padEnd(26) + "🔴 " + r.fatal); fatals++; continue; }
    const cells = CONTROLS.map((c) => {
      if (!r.res[c.key].live) { (dead[c.key] = dead[c.key] || []).push(r.name); return "🔴 沒反應".padEnd(10); }
      return "✅".padEnd(11);
    });
    console.log((r.name.length > 24 ? r.name.slice(0, 24) : r.name).padEnd(26) + cells.join(""));
  }
  console.log("─".repeat(72));
  let bad = 0;
  for (const c of CONTROLS) {
    const d = dead[c.key] || []; bad += d.length;
    console.log(`${c.label}：${rows.length - fatals - d.length}/${rows.length} 款有效` + (d.length ? `　🔴 失效 ${d.length} 款＝${d.join("、")}` : "　全數有效"));
  }
  if (errs.length) console.log(`\n⚠ 頁面錯誤 ${errs.length} 則：` + errs.slice(0, 3).join(" / "));
  if (fatals) console.log(`\n🔴 有 ${fatals} 款根本沒量到——本輪那幾款不算數`);
  if (!rows.length || fatals === rows.length) { console.log("\nTYPO_MATRIX:FATAL（一款都沒量到＝量測層失效，不判通過）"); process.exit(2); }
  const ok = bad === 0 && fatals === 0;
  console.log(ok ? "\nTYPO_MATRIX:PASS（四支控制在每一款字風上都調得動）" : `\nTYPO_MATRIX:FAIL（失效 ${bad} 格／沒量到 ${fatals} 款）`);
  process.exit(ok ? 0 : 1);
})();
