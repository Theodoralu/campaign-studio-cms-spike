#!/usr/bin/env node
/* make_cutouts.js — U29（2026-07-20 使用者裁決㉙）：KV 鎖陣商品白底圖自動去背工具
 *
 * CLI：node make_cutouts.js <manifest.json> <outDir>
 *   manifest = [{ gdid, imgUrl, name }]（imgUrl＝商品頁圖庫第二張 imageSet[1][0]，U10 白底語意）
 *
 * 處理流程（每張）：
 *   1. 下載（GET 僅限 img.yec.tw / tw.buy.yahoo.com——host 白名單硬擋）
 *   2. 白底轉透明：僅「從影像邊緣 flood-fill 可達」的連通近白域視為背景去除；
 *      商品內部白區（白色商品、鏤空反光）不與邊緣連通 → 保留不穿透
 *   3. 門檻＋距離漸變羽化：背景邊界起 FEATHER_R px 內，依像素自身「白距離」線性 alpha ramp
 *      （越白越透、越深越實），距離越往商品內部 alpha 越快回滿 → 邊緣平滑、內部不受影響
 *   4. 去噪（despeckle）：孤島不透明小連通域（< max(64, 0.02% 面積) px）清為透明——
 *      清除背景紋理/陰影殘點；商品多件散置（套杯組）遠大於門檻不受影響
 *   5. 透明邊裁切（alpha>8 bbox）＋長邊 4% padding
 *   6. 輸出 <outDir>/<gdid>.png ＋品質指標（alpha 佔比／羽化帶佔比／邊緣鋸齒抽樣／殘白抽樣／
 *      srcBorderWhiteShare＝來源圖邊框近白比例（白底 gate：< 0.7 → whiteBgGate:"fail"，
 *      表示來源非白底商品圖、去背結果不可用 → 呼叫端應走替補圖或 mlUpgradeNeeded））
 *
 * 依賴：pipeline node_modules 之 sharp（2026-07-20 npm i sharp 安裝）。
 * 指標另寫 <outDir>/cutouts_report.json（含每張 metrics 與門檻參數，供 QA 追溯）。
 */
"use strict";
const fs = require("fs");
const path = require("path");
const sharp = require("sharp");
require("./lib/net_tuning"); // 對外連線預算（唯一一份＝lib/net_tuning.js）：預設 250ms 太短會讓「人點得開、工具抓不到」

/* ---- 參數（門檻經 16 張 KV 素材實測校定；可用環境變數覆寫做個案重跑） ---- */
const BG_TH     = +(process.env.CUTOUT_BG_TH || 36);   // 白距離 ≤ 此值 → flood-fill 候選（容忍 JPEG 噪點/淡影）
const CORE_HI   = +(process.env.CUTOUT_CORE_HI || 90); // 羽化帶內：白距離 ≥ 此值 → 視為商品實體（alpha 全滿基準）
const FEATHER_R = +(process.env.CUTOUT_FEATHER_R || 3);// 距離漸變羽化半徑（px；自背景邊界向商品內）
const PAD_RATIO = 0.04;                                // 裁切後長邊 4% padding
const ALLOWED_HOSTS = new Set(["img.yec.tw", "tw.buy.yahoo.com"]);

const clamp01 = v => v < 0 ? 0 : v > 1 ? 1 : v;
const whiteDist = (d, i) => { // 與純白之歐氏距離（0＝純白）
  const r = 255 - d[i], g = 255 - d[i + 1], b = 255 - d[i + 2];
  return Math.sqrt(r * r + g * g + b * b);
};

async function download(url) {
  const u = new URL(url);
  if (!ALLOWED_HOSTS.has(u.hostname)) throw new Error(`host 不在白名單: ${u.hostname}`);
  const res = await fetch(url, { headers: { "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36" }, redirect: "follow" });
  if (!res.ok) throw new Error(`GET ${url} → ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

function removeBg(data, w, h) {
  const n = w * h;
  /* 1) 邊緣 flood-fill 連通白域（4-鄰接 BFS）→ bg mask */
  const bg = new Uint8Array(n);          // 1＝背景
  const queue = new Int32Array(n); let qh = 0, qt = 0;
  const tryPush = p => { if (!bg[p] && whiteDist(data, p * 4) <= BG_TH) { bg[p] = 1; queue[qt++] = p; } };
  for (let x = 0; x < w; x++) { tryPush(x); tryPush((h - 1) * w + x); }
  for (let y = 0; y < h; y++) { tryPush(y * w); tryPush(y * w + w - 1); }
  while (qh < qt) {
    const p = queue[qh++], x = p % w, y = (p / w) | 0;
    if (x > 0) tryPush(p - 1);
    if (x < w - 1) tryPush(p + 1);
    if (y > 0) tryPush(p - w);
    if (y < h - 1) tryPush(p + w);
  }
  /* 2) 多源 BFS：前景像素到背景的距離（只算到 FEATHER_R；8-鄰接） */
  const dist = new Uint8Array(n);        // 0＝未標（背景或深內部）；1..FEATHER_R
  qh = 0; qt = 0;
  for (let p = 0; p < n; p++) if (bg[p]) queue[qt++] = p;
  while (qh < qt) {
    const p = queue[qh++], x = p % w, y = (p / w) | 0;
    const d0 = bg[p] ? 0 : dist[p];
    if (d0 >= FEATHER_R) continue;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
      const q = ny * w + nx;
      if (bg[q] || dist[q]) continue;
      dist[q] = d0 + 1; queue[qt++] = q;
    }
  }
  /* 3) alpha 指派：背景→0；羽化帶→門檻×距離雙 ramp；其餘→原 alpha（通常 255） */
  for (let p = 0; p < n; p++) {
    const i = p * 4;
    if (bg[p]) { data[i + 3] = 0; continue; }
    const d = dist[p];
    if (!d) continue;                                   // 深內部：不動（白色商品內部保留）
    const base = clamp01((whiteDist(data, i) - BG_TH) / (CORE_HI - BG_TH)); // 門檻 ramp：越白越透
    const factor = base + (1 - base) * ((d - 1) / FEATHER_R);               // 距離 ramp：越深入越實
    data[i + 3] = Math.round(data[i + 3] * clamp01(factor));
  }
  return { bg };
}

function despeckle(data, w, h) { // 孤島小連通域（8-鄰接）清透明；回傳清除像素數
  const n = w * h, minKeep = Math.max(64, Math.round(n * 0.0002));
  const seen = new Uint8Array(n), queue = new Int32Array(n);
  let removed = 0;
  for (let s = 0; s < n; s++) {
    if (seen[s] || data[s * 4 + 3] <= 8) continue;
    let qh = 0, qt = 0; seen[s] = 1; queue[qt++] = s;
    const comp = [];
    while (qh < qt) {
      const p = queue[qh++]; comp.push(p);
      const x = p % w, y = (p / w) | 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
        const q = ny * w + nx;
        if (!seen[q] && data[q * 4 + 3] > 8) { seen[q] = 1; queue[qt++] = q; }
      }
    }
    if (comp.length < minKeep) { for (const p of comp) data[p * 4 + 3] = 0; removed += comp.length; }
  }
  return removed;
}

function trimWithPad(data, w, h) {
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (data[(y * w + x) * 4 + 3] > 8) {
      if (x < x0) x0 = x; if (x > x1) x1 = x;
      if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
  }
  if (x1 < 0) throw new Error("去背後無不透明像素（整張被判為背景）");
  const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
  const pad = Math.max(2, Math.round(Math.max(bw, bh) * PAD_RATIO));
  const ow = bw + pad * 2, oh = bh + pad * 2;
  const out = Buffer.alloc(ow * oh * 4);
  for (let y = 0; y < bh; y++)
    data.copy(out, ((y + pad) * ow + pad) * 4, ((y + y0) * w + x0) * 4, ((y + y0) * w + x1 + 1) * 4);
  return { out, ow, oh, bbox: { x0, y0, bw, bh }, pad };
}

function metrics(data, w, h) {
  const n = w * h;
  let opaque = 0, semi = 0, edge = 0, hardEdge = 0, whiteHalo = 0;
  for (let p = 0; p < n; p++) {
    const i = p * 4, a = data[i + 3];
    if (a >= 128) opaque++;
    if (a > 8 && a < 248) semi++;
    if (a <= 8) continue;
    const x = p % w, y = (p / w) | 0;   // 邊界抽樣：不透明像素有 4-鄰透明者
    const nb = [x > 0 ? data[i - 4 + 3] : 0, x < w - 1 ? data[i + 4 + 3] : 0,
                y > 0 ? data[(p - w) * 4 + 3] : 0, y < h - 1 ? data[(p + w) * 4 + 3] : 0];
    if (Math.min(...nb) <= 8) {
      edge++;
      if (a >= 250) { hardEdge++; if (whiteDist(data, i) < 48) whiteHalo++; }  // 無羽化硬邊（鋸齒）／硬邊且近白（殘白）
    }
  }
  return {
    alphaRatio: +(opaque / n).toFixed(4),          // 不透明佔比（畫布利用率）
    featherRatio: +(semi / n).toFixed(4),          // 羽化帶佔比
    edgeSamples: edge,
    hardEdgeRatio: edge ? +(hardEdge / edge).toFixed(4) : 0, // 邊緣鋸齒抽樣：邊界硬邊比例（越低越平滑）
    whiteHaloRatio: edge ? +(whiteHalo / edge).toFixed(4) : 0 // 殘白抽樣：邊界「硬邊且近白」比例（殘白 halo 風險）
  };
}

async function processOne(item, outDir) {
  const buf = await download(item.imgUrl);
  const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: w, height: h } = info;
  /* 白底 gate：來源圖邊框近白比例（非白底來源＝去背無意義，標 fail 供呼叫端替補） */
  let bw = 0, bn = 0;
  const borderProbe = (x, y) => { if (whiteDist(data, (y * w + x) * 4) <= BG_TH) bw++; bn++; };
  for (let x = 0; x < w; x += 3) { borderProbe(x, 0); borderProbe(x, h - 1); }
  for (let y = 0; y < h; y += 3) { borderProbe(0, y); borderProbe(w - 1, y); }
  const srcBorderWhiteShare = +(bw / bn).toFixed(4);
  const { bg } = removeBg(data, w, h);
  let bgN = 0; for (let p = 0; p < bg.length; p++) bgN += bg[p];
  const despeckledPx = despeckle(data, w, h);
  const { out, ow, oh, bbox, pad } = trimWithPad(data, w, h);
  const m = metrics(out, ow, oh);
  const file = path.join(outDir, `${item.gdid}.png`);
  await sharp(out, { raw: { width: ow, height: oh, channels: 4 } }).png({ compressionLevel: 9 }).toFile(file);
  return { gdid: String(item.gdid), name: item.name, src: item.imgUrl, file,
           srcSize: `${w}x${h}`, outSize: `${ow}x${oh}`, pad, bbox,
           srcBorderWhiteShare, whiteBgGate: srcBorderWhiteShare >= 0.7 ? "pass" : "fail",
           bgRemovedRatio: +(bgN / (w * h)).toFixed(4), despeckledPx, ...m };
}

(async () => {
  const [manifestPath, outDir] = process.argv.slice(2);
  if (!manifestPath || !outDir) { console.error("用法：node make_cutouts.js <manifest.json> <outDir>"); process.exit(1); }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  fs.mkdirSync(outDir, { recursive: true });
  const report = { params: { BG_TH, CORE_HI, FEATHER_R, PAD_RATIO }, generatedAt: new Date().toISOString(), items: [] };
  let fail = 0;
  for (const item of manifest) {
    try {
      const r = await processOne(item, outDir);
      report.items.push(r);
      console.log(`${r.whiteBgGate === "pass" ? "✓" : "⚠gate-fail"} ${r.gdid} ${r.srcSize}→${r.outSize} borderWhite=${r.srcBorderWhiteShare} alpha=${r.alphaRatio} feather=${r.featherRatio} hardEdge=${r.hardEdgeRatio} whiteHalo=${r.whiteHaloRatio} despeckled=${r.despeckledPx}px`);
    } catch (e) {
      fail++; report.items.push({ gdid: String(item.gdid), error: e.message });
      console.error(`✗ ${item.gdid} ${e.message}`);
    }
  }
  fs.writeFileSync(path.join(outDir, "cutouts_report.json"), JSON.stringify(report, null, 2));
  process.exit(fail ? 2 : 0);
})();
