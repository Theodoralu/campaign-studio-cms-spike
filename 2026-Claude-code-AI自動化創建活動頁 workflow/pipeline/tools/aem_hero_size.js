#!/usr/bin/env node
"use strict";
/**
 * tools/aem_hero_size.js —— 首屏佔多少、body 每一區塊各多大（2026-09-18 重寫）
 *
 * 用法：
 *   node tools/aem_hero_size.js <html>...        # 三裝置逐區塊
 *   node tools/aem_hero_size.js <…> --json
 *
 * 白話：AEM 已經定案「一個網址對一份 HTML，三種裝置用頁上的屬性切」。代價是那一份 HTML 得把
 * 三種裝置的首屏都帶著。這支工具回答兩件事：①三種裝置的首屏各多大、加起來要付多少 ②整頁的
 * 篇幅花在哪幾個區塊（樓層、商品牆、編輯精選⋯）。回答的是「超標的時候該叫同事減什麼」。
 *
 * 順帶量「我們自帶的站頭與頁尾」（header#sec-uh／footer#sec-footer）——那是牆上 Q9 的題目：
 * 進 AEM 之後外面已經有 Yahoo 的頁首頁尾，我們自帶的要不要剝掉。這裡給的是它值多少篇幅。
 */
const fs = require("fs");
const path = require("path");
const P = require("../lib/aem_probe");

const args = process.argv.slice(2);
const asJson = args.includes("--json");
const targets = args.filter((a) => !a.startsWith("--"));
if (!targets.length) { console.error("用法：node tools/aem_hero_size.js <html>… [--json]"); process.exit(2); }

const KIND_LABEL = { hero: "★首屏", module: "　模組", shell: "○殼層", nav: "○導覽" };
const SHELL_NAME = { "sec-uh": "自帶站頭", "sec-footer": "自帶頁尾", "sec-anchornav-floating": "浮動錨點導覽" };

(async () => {
  const out = [];
  for (const f of targets.flatMap((p) => (fs.statSync(p).isDirectory() ? fs.readdirSync(p).filter((x) => /\.html?$/i.test(x)).sort().map((x) => path.join(p, x)) : [p]))) {
    const rows = await P.withMeasuredPages(f, {}, async (page) =>
      page.evaluate(([snapSrc, scaffold]) => {
        const snap = new Function("return (" + snapSrc + ")")()(scaffold);
        return { device: snap.device, layout: snap.layout, units: snap.units, stages: snap.stages, whole: snap.html };
      }, [P.visibleDomSnapshot.toString(), P.EDITOR_SCAFFOLD]));
    const per = rows.map((r) => {
      const units = r.result.units.map((u) => ({
        ...u, label: (u.id && SHELL_NAME[u.id]) || u.module || u.id || u.tag,
        ...P.measure(u.html), fingerprint: P.fp(u.html),
      }));
      const sumOf = (kind) => units.filter((u) => u.kind === kind).reduce((a, u) => a + u.encoded, 0);
      const whole = P.measure(r.result.whole).encoded;
      const partition = sumOf("hero") + sumOf("module") + sumOf("shell") + sumOf("nav");
      return {
        device: r.view.key, layout: r.result.layout, units,
        hero: sumOf("hero"), modules: sumOf("module"), shell: sumOf("shell"), nav: sumOf("nav"),
        stage: r.result.stages.reduce((a, x) => a + P.measure(x.html).encoded, 0),
        stagePrint: P.fp(r.result.stages.map((x) => x.html).join("")),
        whole, rest: whole - partition,
      };
    });
    const variants = [...new Set(per.map((d) => d.stagePrint))];
    out.push({ file: f, name: path.basename(f), devices: per, heroVariants: variants.length, heroAllDevices: per.reduce((a, d) => a + d.hero, 0) });
  }
  if (asJson) { console.log(JSON.stringify({ cap: P.AEM_ENCODED_CAP, files: out }, null, 1)); return; }
  const n = (x) => String(x).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const p1 = (x) => (x / P.AEM_ENCODED_CAP * 100).toFixed(1) + "%";
  for (const r of out) {
    console.log(`▍${r.name}　${r.devices[0].layout}`);
    for (const d of r.devices) {
      console.log(`  ${d.device}　可見 DOM ${n(d.whole)}（${p1(d.whole)}）　首屏 ${n(d.hero)}　模組 ${n(d.modules)}　站頭頁尾 ${n(d.shell)}　導覽 ${n(d.nav)}`);
      for (const u of d.units) {
        console.log(`     ${String(n(u.encoded)).padStart(7)}　${KIND_LABEL[u.kind]}　${u.label}`);
        if (u.kind === "hero") console.log(`     ${String(n(d.stage)).padStart(7)}　└舞台　每個裝置長不一樣的就是這塊（巢狀在首屏裡，不重複計）`);
      }
      console.log(`     ${String(n(d.rest)).padStart(7)}　　其餘　版心容器等沒掛模組名的標記（分區＋其餘＝可見 DOM）`);
    }
    const stageAll = r.devices.reduce((a, d) => a + d.stage, 0);
    console.log(`  舞台：三裝置${r.heroVariants === 1 ? "同一份 → 一份 HTML 只帶一套" : `有 ${r.heroVariants} 種 → 一份 HTML 全帶要付 ${n(stageAll)}（${p1(stageAll)}）`}`);
    const sh = r.devices[0].shell;
    console.log(`  自帶站頭＋頁尾 ${n(sh)}（${p1(sh)}）＝牆上 Q9 剝掉能省回來的量；浮動導覽 ${n(r.devices[0].nav)} 保留\n`);
  }
})().catch((e) => { console.error("❌ " + e.message); process.exit(1); });
