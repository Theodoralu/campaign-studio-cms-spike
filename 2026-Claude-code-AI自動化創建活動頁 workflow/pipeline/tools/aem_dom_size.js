#!/usr/bin/env node
"use strict";
/**
 * tools/aem_dom_size.js —— 「畫好的畫面本身」有多大（2026-09-18 重寫）
 *
 * 用法：
 *   node tools/aem_dom_size.js <html 或資料夾>...            # 三裝置各量一次
 *   node tools/aem_dom_size.js <…> --devices desktop,mobile  # 只量指定裝置
 *   node tools/aem_dom_size.js <…> --json
 *
 * 白話：一份匯出檔裡有引擎程式、有樣式、有資料，這些在靜態化之後都會不見。真正會留下來的是
 * 「頁面畫好之後那一坨 HTML」。這支工具用真 Chrome 把頁打開，等它畫完，然後量那一坨有多大——
 * 也就是靜態化之後那份檔的下限。回答的是「就算把引擎整個拿掉，還過不過得了 AEM 的上限」。
 *
 * 可見 DOM 的定義（與對板閘同一段邏輯，lib/aem_probe.js）＝去掉 script、style、display:none 的子樹、
 * 後台鷹架之後，剩下的 body。結構指紋是那一坨的雜湊前八碼，用來回答「三種裝置畫出來的是同一份嗎」。
 *
 * 兩個數字都會印：
 *   現況　　＝畫面裡的圖片還是內嵌的（一長串 base64），也就是現在匯出檔的樣子
 *   圖片外連＝把每張內嵌圖換成一個 AEM 素材庫網址的長度，也就是靜態化之後的樣子（這才是要跟上限比的那個）
 */
const fs = require("fs");
const path = require("path");
const P = require("../lib/aem_probe");

const args = process.argv.slice(2);
const asJson = args.includes("--json");
const devArg = args.includes("--devices") ? args[args.indexOf("--devices") + 1] : null;
const views = devArg ? P.VIEWS.filter((v) => devArg.split(",").includes(v.key)) : P.VIEWS;
const targets = args.filter((a, i) => !a.startsWith("--") && args[i - 1] !== "--devices");
if (!targets.length || !views.length) { console.error("用法：node tools/aem_dom_size.js <html 或資料夾>… [--devices desktop,tablet,mobile] [--json]"); process.exit(2); }

const htmlFiles = (p) => {
  if (!fs.existsSync(p)) { console.error(`❌ 找不到：${p}`); process.exit(2); }
  if (fs.statSync(p).isDirectory()) return fs.readdirSync(p).filter((f) => /\.html?$/i.test(f)).sort().map((f) => path.join(p, f));
  return [p];
};

(async () => {
  const files = targets.flatMap(htmlFiles);
  const out = [];
  for (const f of files) {
    const rows = await P.withMeasuredPages(f, { views }, async (page) =>
      page.evaluate(([snapSrc, scaffold]) => {
        const snap = new Function("return (" + snapSrc + ")")()(scaffold);
        return { device: snap.device, layout: snap.layout, html: snap.html, sections: snap.sections.length };
      }, [P.visibleDomSnapshot.toString(), P.EDITOR_SCAFFOLD]));
    const per = rows.map((r) => ({
      device: r.view.key, reportedDevice: r.result.device, layout: r.result.layout,
      ...P.measure(r.result.html), external: P.measure(P.externalizeImages(r.result.html)),
      fingerprint: P.fp(r.result.html), sections: r.result.sections, jsErrors: r.jsErrors.length,
    }));
    const prints = [...new Set(per.map((p) => p.fingerprint))];
    /* 瘦身後估計取三裝置裡最大的那一個＝最壞情況（一份 HTML 要同時過三種畫面）。 */
    const worst = per.reduce((a, b) => (b.external.encoded > a.external.encoded ? b : a));
    out.push({ file: f, name: path.basename(f), devices: per, distinctDoms: prints.length, slim: { basis: worst.device, ...P.estimateSlimmed(worst.external.encoded) } });
  }
  if (asJson) { console.log(JSON.stringify({ cap: P.AEM_ENCODED_CAP, files: out }, null, 1)); return; }
  const n = (x) => String(x).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  console.log(`可見 DOM＝真 Chrome 畫完之後剩下的 body（去 script／style／隱藏子樹／後台鷹架）。上限 ${n(P.AEM_ENCODED_CAP)}\n`);
  for (const r of out) {
    console.log(`▍${r.name}　${r.devices[0] ? r.devices[0].layout : ""}`);
    for (const d of r.devices) {
      console.log(`   ${d.device.padEnd(8)} 現況 ${String(n(d.encoded)).padStart(8)}（${String(d.pctOfCap).padStart(5)}%）　圖片外連後 ${String(n(d.external.encoded)).padStart(7)}（${String(d.external.pctOfCap).padStart(5)}%）　指紋 ${d.fingerprint}　裝置屬性 ${d.reportedDevice}${d.jsErrors ? `　⚠ JS 錯誤 ${d.jsErrors}` : ""}`);
    }
    console.log(`   三裝置畫出來${r.distinctDoms === 1 ? "是同一份（一份 HTML 只要帶一套）" : `有 ${r.distinctDoms} 種（一份 HTML 得帶 ${r.distinctDoms} 套首屏）`}`);
    const s = r.slim;
    console.log(`   瘦身後估計 ${n(s.encoded)}（${s.pctOfCap}%）　算上安全邊際 ${n(s.safe)}（${s.safePctOfCap}%）＝${s.verdict}${s.fits ? "" : "　❌ 估計會超過上限"}\n`);
  }
})().catch((e) => { console.error("❌ " + e.message); process.exit(1); });
