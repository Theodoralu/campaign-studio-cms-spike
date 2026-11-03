"use strict";
/**
 * tools/spec_check.js —— 版式對板檢核器（2026-08-25 行動版對板事故整改核心）
 *
 * 目的：把「照 Figma design spec 開發」從人眼目視變成機器斷言——spec 忠實＝滾動上架測試回饋
 * 有意義的前提（使用者 2026-08-25 裁決）。每款版式×每裝置一份「對板規格檔」（值取自 Figma
 * get_design_context 的板原值），本器將 FrameTest 真渲染逐項量測比對，超差＝紅、exit 1。
 *
 * 對板規格檔（spec fixture）＝design-assets/layouts/spec/<layout>.<device>.json：
 * {
 *   "layout": "layout-002", "device": "desktop"|"tablet"|"mobile",
 *   "figmaNode": "528:xxxx",              // 板節點＝溯源
 *   "viewport": { "w": 1440, "h": 900 },  // 量測視窗
 *   "stageBaseW": 1440,                    // 舞台基準寬（選填；決策③ 2026-08-28）＝引擎 HV2_STAGES 該款 w 欄的人肉同步複本；缺欄回退 1264
 *   "stageSelector": ".hv2-s10w",         // 舞台根（座標原點）
 *   "demoHero": { "title-center": "對板示意標題\n副行", ... },  // 固定示意內容＝可重現量測（不入版型、只進檢核）
 *   "demoProducts": 4,                     // 需要幾件示意商品（器材自產固定假商品——名稱價格為顯性假值，僅檢核用）
 *   "tolerancePx": 3,                      // 幾何容差（字型代換造成的次像素差）
 *   "checks": [
 *     { "name": "商品卡左", "selector": ".card-l", "box": { "x": 94, "y": 122, "w": 292, "h": 372 } },
 *     { "name": "大標色", "selector": ".big", "style": { "color": "#297641" } },
 *     { "name": "格紋線距", "selector": ".stage", "style": { "backgroundSize": "34.3px 34.3px" } },
 *     { "name": "舞台霧光", "selector": ".fade", "gradient": { "direction": "to bottom", "stops": ["#D9FF3D22", "#D9FF3D00"] } }
 *   ],
 *   "fieldLimitsMachine": {                // 欄位長度上限・機讀欄（2026-09-11 立＝73 號裁決二③／§6-1 甲：本欄＝唯一真源，CMS HERO_LEN 對此比對）
 *     "discount-digit": { "label": "促購折數", "selector": ".l12-promo-num", "maxChars": 5, "probeChar": "測",
 *                         "failWhen": [{ "type": "overflowX" }], "source": "設計側給值（spec 條目），未實測" }
 *   }
 * }
 * box＝相對舞台左上角的 CSS px（板座標系）；style＝getComputedStyle 逐鍵比對（色值正規化 #RRGGBB）。
 * gradient（2026-09-11；走查發現 21）＝比 backgroundImage 的 linear-gradient 方向（角度容差 ±5°）與首尾兩端色（含 alpha，容差 0.06）
 *   ——盒子對了、漸層畫反了照樣全綠的病。**登記簿 spec 有寫才比**：沒有 gradient 鍵的 check 行為不變。
 *
 * 用法：node tools/spec_check.js [<fixture.json>|--all] [--frametest <path>] [--report-only] [--edge-probe[=all]] [--derive-limits] [--enforce-limits]
 *   --all            掃 design-assets/layouts/spec/*.json 全跑。輸出逐項 ✓/✗＋總表；任何 ✗＝exit 1（失敗要出聲）。
 *   --report-only    只報告不擋（73 號 §6-3 甲：新檢查先跑全款看紅燈數，再裁強制與否）——一律 exit 0，尾行印 SPEC_CHECK:REPORT fail=N。
 *   --edge-probe     頁底色兩態底邊取樣（2026-09-11；走查發現 22）：對 spec 有 `edgeProbe: true`（scene 類）或 `background` 的 fixture，把 page.pageBgOverride 各設成
 *                    深底 #2D386B（09-10 病例原色）與淺底 #F6F5F1 再渲染一次，抓舞台底邊最後一列像素跟 body 底色比——浮出一條淺色帶＝✗。
 *                    =all＝每個 fixture 都探（普查用，配 --report-only 看存量）。像素解碼自帶（PNG 8-bit RGB/RGBA，不加相依）。
 *   --derive-limits  對 fieldLimitsMachine 每欄二分搜尋安全字數（1〜probeMax，預設 40）並印實測值；宣告值≠實測值只計 mismatch、不算 fail。
 *   --enforce-limits 把「宣告值放不下」與「實測≠宣告」算進 fail（預設不算＝只報告）。
 *   不帶新旗標、spec 沒有新鍵＝行為與 2026-09-10 前完全相同（十二款既有 fixture 零位移）。
 * 限制誠實列：文字寬度隨真值內容變動＝不量文字盒寬、量錨點與字級色值；HN→Noto 過渡字型的字重
 * 對映差＝容差內處理；示意內容僅存在檢核流程、絕不寫入任何 draft/版型（CP-26 精神）。
 * 邊界取樣只看「視覺底邊那一列 vs body 底色」，不判斷帶子有多高——它抓的是「有沒有一條不該有的色帶」這個症狀本身。
 * 視覺底邊＝銜接帶 .hv2-bridge 的底（沒有銜接帶才退回舞台盒底）；每個取樣點先確認最上層元素屬於舞台，不是就跳過並出聲
 * （2026-09-11 診斷：001 桌機舞台盒子比可見 hero 多 45px，盒底那列落在下一區標題的文字筆畫上＝假紅；看圖對不上數字才抓到）。
 */
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const { chromium } = require("playwright-core");

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const SPEC_DIR = path.join(REPO_ROOT, "design-assets", "layouts", "spec");
const DEFAULT_FRAMETEST = path.join(REPO_ROOT, "2026-AI自動化活動頁生成規劃", "MVP_Phase1_LeCreuset_活動頁Prototype_FrameTest.html");

const DEVICE_PARAM = { desktop: null, tablet: "tablet", mobile: "mobile" };
/* 頁底色兩態（走查發現 22）：深＝09-10 營運手調的那個深藍原色；淺＝分享站底色。值寫死在這裡＝檢核常數，不是版型值。 */
const EDGE_PROBE_BGS = [{ label: "深底", hex: "#2D386B" }, { label: "淺底", hex: "#F6F5F1" }];
const EDGE_TOL = 16;         // 單通道最大容許差（抗鋸齒／半像素縫；09-03 縫線修正後實測邊列差 <8）
const EDGE_SAMPLES = 9;      // 沿舞台寬取 9 個 x 取樣點
const GRAD_ANGLE_TOL = 5;    // 漸層方向容差（度）
const GRAD_ALPHA_TOL = 0.06; // 漸層兩端色 alpha 容差

function normColor(v) {
  if (!v) return v;
  const m = String(v).match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
  if (!m) return String(v).toLowerCase();
  if (m[4] !== undefined && Number(m[4]) === 0) return "transparent";
  const hex = (n) => Number(n).toString(16).padStart(2, "0");
  return `#${hex(m[1])}${hex(m[2])}${hex(m[3])}`;
}

/* 色值→{r,g,b,a}（0-255／0-1）。收 #RGB／#RRGGBB／#RRGGBBAA／rgb()／rgba()／transparent；解不出回 null（出聲用）。 */
function parseColor(v) {
  if (v == null) return null;
  const s = String(v).trim().toLowerCase();
  if (s === "transparent") return { r: 0, g: 0, b: 0, a: 0 };
  let m = s.match(/^#([0-9a-f]{3,8})$/);
  if (m) {
    let h = m[1];
    if (h.length === 3 || h.length === 4) h = h.split("").map((c) => c + c).join("");
    if (h.length !== 6 && h.length !== 8) return null;
    const n = parseInt(h, 16);
    return h.length === 8
      ? { r: (n >>> 24) & 255, g: (n >>> 16) & 255, b: (n >>> 8) & 255, a: (n & 255) / 255 }
      : { r: (n >>> 16) & 255, g: (n >>> 8) & 255, b: n & 255, a: 1 };
  }
  m = s.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+))?\s*\)$/);
  if (m) return { r: Math.round(+m[1]), g: Math.round(+m[2]), b: Math.round(+m[3]), a: m[4] === undefined ? 1 : +m[4] };
  return null;
}
const colorStr = (c) => (c ? `rgba(${c.r},${c.g},${c.b},${+c.a.toFixed(3)})` : "?");

/* 解 computed backgroundImage 的第一個 linear-gradient：回 {angle, stops:[{color,pos}]}；不是線性漸層＝null。
   逗號在 rgba() 裡也會出現，所以用括號深度切段，不用 split(",")。 */
function parseLinearGradient(bgImage) {
  const s = String(bgImage || "");
  const i = s.indexOf("linear-gradient(");
  if (i < 0) return null;
  let depth = 0, start = i + "linear-gradient(".length, j = start;
  for (; j < s.length; j++) { const ch = s[j]; if (ch === "(") depth++; else if (ch === ")") { if (depth === 0) break; depth--; } }
  const body = s.slice(start, j);
  const parts = []; depth = 0; let cur = "";
  for (const ch of body) { if (ch === "(") depth++; if (ch === ")") depth--; if (ch === "," && depth === 0) { parts.push(cur.trim()); cur = ""; } else cur += ch; }
  if (cur.trim()) parts.push(cur.trim());
  let angle = 180; // CSS 預設＝to bottom
  const SIDE = { "to top": 0, "to right": 90, "to bottom": 180, "to left": 270, "to top right": 45, "to right top": 45, "to bottom right": 135, "to right bottom": 135, "to bottom left": 225, "to left bottom": 225, "to top left": 315, "to left top": 315 };
  if (parts.length && !parseColor(parts[0].split(/\s+/)[0])) {
    const head = parts.shift();
    const deg = head.match(/^(-?[\d.]+)deg$/); const turn = head.match(/^(-?[\d.]+)turn$/);
    if (deg) angle = ((+deg[1]) % 360 + 360) % 360;
    else if (turn) angle = ((+turn[1] * 360) % 360 + 360) % 360;
    else if (SIDE[head] !== undefined) angle = SIDE[head];
  }
  const stops = parts.map((p) => {
    // 色碼可能含空白（rgb(1, 2, 3)），位置在最後一個 token
    const m = p.match(/^(.*?)(?:\s+(-?[\d.]+(?:%|px)))?$/);
    return { color: parseColor(m ? m[1].trim() : p), pos: m && m[2] ? m[2] : null };
  }).filter((x) => x.color);
  return stops.length >= 2 ? { angle, stops } : null;
}
const normDirection = (d) => {
  if (d == null) return 180;
  if (typeof d === "number") return ((d % 360) + 360) % 360;
  const g = parseLinearGradient(`linear-gradient(${d}, #000, #fff)`);
  return g ? g.angle : 180;
};
const angleDiff = (a, b) => { const d = Math.abs(a - b) % 360; return Math.min(d, 360 - d); };
function colorClose(a, b) {
  if (!a || !b) return false;
  if (a.a < 0.02 && b.a < 0.02) return true; // 兩端都透明＝色相不重要
  return Math.abs(a.r - b.r) <= EDGE_TOL && Math.abs(a.g - b.g) <= EDGE_TOL && Math.abs(a.b - b.b) <= EDGE_TOL && Math.abs(a.a - b.a) <= GRAD_ALPHA_TOL;
}

/* 極簡 PNG 解碼（8-bit、色型 2 RGB／6 RGBA、無交錯）——Playwright 截圖固定這種格式；不加相依（pipeline 相依維持 3 個）。
   回 {w,h,ch,data}；data＝去濾波後的像素列。 */
function decodePng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error("不是 PNG");
  let p = 8, w = 0, h = 0, depth = 0, ctype = 0, interlace = 0; const idat = [];
  while (p < buf.length) {
    const len = buf.readUInt32BE(p); const type = buf.toString("ascii", p + 4, p + 8); const data = buf.subarray(p + 8, p + 8 + len);
    if (type === "IHDR") { w = data.readUInt32BE(0); h = data.readUInt32BE(4); depth = data[8]; ctype = data[9]; interlace = data[12]; }
    else if (type === "IDAT") idat.push(data);
    else if (type === "IEND") break;
    p += 12 + len;
  }
  if (depth !== 8 || (ctype !== 2 && ctype !== 6) || interlace !== 0) throw new Error(`PNG 格式不支援（depth=${depth} ctype=${ctype} interlace=${interlace}）`);
  const ch = ctype === 6 ? 4 : 3, stride = w * ch;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const out = Buffer.alloc(h * stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], src = y * (stride + 1) + 1, dst = y * stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= ch ? out[dst + x - ch] : 0, b = y > 0 ? out[dst - stride + x] : 0, c = x >= ch && y > 0 ? out[dst - stride + x - ch] : 0;
      let v = raw[src + x];
      if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      out[dst + x] = v & 255;
    }
  }
  return { w, h, ch, data: out };
}
const pngPixel = (img, x, y) => { const i = (y * img.w + x) * img.ch; return { r: img.data[i], g: img.data[i + 1], b: img.data[i + 2], a: img.ch === 4 ? img.data[i + 3] / 255 : 1 }; };

function demoProductsOf(n) {
  // 顯性假商品（僅檢核用、不落任何檔）：名稱直白標示為對板示意，價格＝固定假值（非真值欄語意）
  return Array.from({ length: n }, (_, i) => ({
    gdid: String(900001 + i),
    name: `對板示意商品${i + 1}（檢核專用非賣品）`,
    price: 100 * (i + 1),
    img: "assets/lecreuset-hero-source.jpg", // 本地資產＝離線可重現
    tag: `示意標${i + 1}`,
  }));
}

function buildDraft(fx, heroOverride, pageBgOverride) {
  const draft = {
    page: { kvVariant: fx.layout, pageName: "對板檢核", kv: fx.demoKv || {}, hero: heroOverride || fx.demoHero || {} },
    /* kv:{}＝loadDraftJson 必要欄位（無 page.kv＝整份拒收、hero 槽全空＝首批 fixture 實跑抓到的 runner 落地 bug，2026-08-25 回爐批修）
       demoKv（選填，2026-09-03）＝fixture 可給示意 kv 欄（如 dateValue）：時間列沒值會走「虛線佔位」樣式、比板上有值時高 12px，
       間距跟內容走的版式（l005 hv2L005AbsorbMobile）會因此把圓照多推下 4px＋大字被吸小＝對板假紅；示意值只進檢核、不入任何 draft */
    products: demoProductsOf(fx.demoProducts || 4),
  };
  if (pageBgOverride) draft.page.pageBgOverride = pageBgOverride; // 引擎欄位（theme 框架批 2026-08-25）：手調頁底色優先於自動銜接
  return draft;
}

/* 在頁內量一輪：checks 的盒／樣式／漸層 ＋ 舞台幾何 ＋ body 底色 */
async function measure(page, fx) {
  return page.evaluate(({ stageSelector, checks }) => {
    const stage = document.querySelector(stageSelector);
    if (!stage) return { fatal: `舞台不存在：${stageSelector}` };
    const s = stage.getBoundingClientRect();
    /* 色值 canvas 正規化（2026-08-31）：color-mix() 的 computed 值瀏覽器回 oklab(...) 字串，
       normColor 只認 rgb()＝比對必紅（淺底深字批實踩）。畫進 1px canvas 讀回像素＝一律轉 rgb。 */
    const _cv = document.createElement("canvas"); _cv.width = _cv.height = 1;
    const _g = _cv.getContext("2d");
    const asRgb = (v) => { if (!/oklab|oklch|color\(/.test(String(v))) return v;
      _g.fillStyle = "#fff"; _g.fillRect(0, 0, 1, 1); _g.fillStyle = v; _g.fillRect(0, 0, 1, 1);
      const d = _g.getImageData(0, 0, 1, 1).data; return `rgb(${d[0]}, ${d[1]}, ${d[2]})`; };
    const bodyBg = asRgb(getComputedStyle(document.body).backgroundColor);
    /* 底邊探針要量的「視覺底邊」＝銜接帶 .hv2-bridge 的底（設計上該溶進頁底色的那一列），不是舞台盒子的底——
       2026-09-11 診斷：001 桌機舞台盒子比可見 hero 多 45px（首屏緊縮批裁掉板底死區、元素仍在），盒底那一列落在下一區
       「注意事項」標題的文字筆畫上，量到字色 rgb(232,234,236) 被判成「色帶」＝假紅。沒有銜接帶的款才退回舞台盒底。 */
    const br = stage.querySelector(".hv2-bridge");
    const edgeBottomViewport = br ? br.getBoundingClientRect().bottom : s.bottom;
    return {
      overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      stage: { x: s.left + window.scrollX, y: s.top + window.scrollY, w: s.width, h: s.height, bottomViewport: s.bottom, leftViewport: s.left, edgeBottomViewport, edgeSource: br ? ".hv2-bridge" : "stage" },
      bodyBg,
      dpr: window.devicePixelRatio || 1,
      rows: checks.map((c) => {
        const el = document.querySelector(c.selector);
        if (!el) return { name: c.name, missing: true };
        const r = el.getBoundingClientRect();
        const cs = getComputedStyle(el);
        const styles = {};
        for (const k of Object.keys(c.style || {})) styles[k] = /color/i.test(k) ? asRgb(cs[k]) : cs[k];
        return { name: c.name, box: { x: r.left - s.left, y: r.top - s.top, w: r.width, h: r.height }, styles,
          visible: cs.display !== "none" && r.width > 0, bgImage: c.gradient ? cs.backgroundImage : undefined };
      }),
    };
  }, { stageSelector: fx.stageSelector, checks: fx.checks });
}

/* 欄位長度探針：把某槽灌 n 個 probeChar 後量「有沒有壞掉」。回 {fail:boolean, why:string}；元素不在＝{skip} */
async function probeLimit(page, fx, slotKey, spec, n) {
  const ch = spec.probeChar || "測";
  const text = ch.repeat(n);
  const hero = Object.assign({}, fx.demoHero || {});
  if (/^piece:(\d+)$/.test(slotKey)) {
    // slogan-left 的第 N 段：\n 換槽（引擎 parts[i]）；沿用 demoHero 其他段，只換這一段
    const idx = Number(slotKey.split(":")[1]);
    const parts = String(hero["slogan-left"] || "").split("\n");
    while (parts.length <= idx) parts.push("");
    parts[idx] = text; hero["slogan-left"] = parts.join("\n");
  } else if (slotKey === "heroName" || slotKey === "tag") {
    // 商品欄位：改第一件示意商品
    return probeProductField(page, fx, slotKey, spec, text);
  } else {
    hero[slotKey] = text;
  }
  await page.evaluate((d) => { loadDraftJson(d, "對板檢核・欄位探針"); }, buildDraft(fx, hero));
  await page.waitForTimeout(450);
  return page.evaluate(({ sel, stageSelector, failWhen }) => {
    const el = document.querySelector(sel); if (!el) return { skip: `元素不存在（${sel}）` };
    const stage = document.querySelector(stageSelector); const sr = stage.getBoundingClientRect(); const r = el.getBoundingClientRect(); const cs = getComputedStyle(el);
    if (cs.display === "none" || r.width === 0) return { skip: `此裝置把這格收起來了（display:none／零寬）＝不量` }; // 011 手機版眉標即此態；不判會誤報「宣告值過嚴」
    const why = [];
    for (const f of failWhen || [{ type: "overflowX" }]) {
      if (f.type === "overflowX" && el.scrollWidth > el.clientWidth + 1) why.push(`橫向溢出 ${el.scrollWidth - el.clientWidth}px`);
      if (f.type === "clampOverflow" && el.scrollHeight > el.clientHeight + 1) why.push(`超過可見行數（scroll ${el.scrollHeight} > client ${el.clientHeight}）`);
      if (f.type === "maxLines") { const lh = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.2; const lines = Math.round(r.height / lh); if (lines > (f.maxLines || 1)) why.push(`${lines} 行 > ${f.maxLines || 1}`); }
      if (f.type === "exceedStage" && r.right > sr.right + 1) why.push(`超出舞台右緣 ${(r.right - sr.right).toFixed(1)}px`);
      if (f.type === "collide" && f.selector) { const o = document.querySelector(f.selector); if (o) { const q = o.getBoundingClientRect(); const hit = r.left < q.right && r.right > q.left && r.top < q.bottom && r.bottom > q.top; if (hit) why.push(`撞到 ${f.selector}`); } }
      // 凸出所屬容器（膠囊比商品卡寬、標題比面板寬這類）：nowrap 元素自己會長寬、scrollWidth 抓不到，要拿最近的祖先容器比
      if (f.type === "exceedOf" && f.selector) { const anc = el.closest(f.selector); if (anc) { const q = anc.getBoundingClientRect(); if (r.right > q.right + 1 || r.left < q.left - 1) why.push(`凸出 ${f.selector}（${Math.max(r.right - q.right, q.left - r.left).toFixed(1)}px）`); } }
    }
    return { fail: why.length > 0, why: why.join("；") };
  }, { sel: spec.selector, stageSelector: fx.stageSelector, failWhen: spec.failWhen });
}
async function probeProductField(page, fx, slotKey, spec, text) {
  const products = demoProductsOf(fx.demoProducts || 4);
  /* 全部示意商品一起灌（2026-09-11 煙霧測試教訓）：只改 products[0] 時，量到的第一張卡放的可能不是它（輪播／中央主位排序），
     結果「40 字都沒壞」是假象——量的元素跟改的資料不是同一件。全灌＝量哪張卡都是探針字串。 */
  products.forEach((p) => { if (slotKey === "heroName") p.name = text; else p.tag = text; });
  const d = buildDraft(fx); d.products = products;
  await page.evaluate((dd) => { loadDraftJson(dd, "對板檢核・欄位探針"); }, d);
  await page.waitForTimeout(450);
  return page.evaluate(({ sel, stageSelector, failWhen }) => {
    const el = document.querySelector(sel); if (!el) return { skip: `元素不存在（${sel}）` };
    const stage = document.querySelector(stageSelector); const sr = stage.getBoundingClientRect(); const r = el.getBoundingClientRect(); const cs = getComputedStyle(el);
    if (cs.display === "none" || r.width === 0) return { skip: `此裝置把這格收起來了（display:none／零寬）＝不量` }; // 011 手機版眉標即此態；不判會誤報「宣告值過嚴」
    const why = [];
    for (const f of failWhen || [{ type: "overflowX" }]) {
      if (f.type === "overflowX" && el.scrollWidth > el.clientWidth + 1) why.push(`橫向溢出 ${el.scrollWidth - el.clientWidth}px`);
      if (f.type === "clampOverflow" && el.scrollHeight > el.clientHeight + 1) why.push(`超過可見行數（scroll ${el.scrollHeight} > client ${el.clientHeight}）`);
      if (f.type === "maxLines") { const lh = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.2; const lines = Math.round(r.height / lh); if (lines > (f.maxLines || 1)) why.push(`${lines} 行 > ${f.maxLines || 1}`); }
      if (f.type === "exceedStage" && r.right > sr.right + 1) why.push(`超出舞台右緣 ${(r.right - sr.right).toFixed(1)}px`);
      if (f.type === "collide" && f.selector) { const o = document.querySelector(f.selector); if (o) { const q = o.getBoundingClientRect(); const hit = r.left < q.right && r.right > q.left && r.top < q.bottom && r.bottom > q.top; if (hit) why.push(`撞到 ${f.selector}`); } }
      // 凸出所屬容器（膠囊比商品卡寬、標題比面板寬這類）：nowrap 元素自己會長寬、scrollWidth 抓不到，要拿最近的祖先容器比
      if (f.type === "exceedOf" && f.selector) { const anc = el.closest(f.selector); if (anc) { const q = anc.getBoundingClientRect(); if (r.right > q.right + 1 || r.left < q.left - 1) why.push(`凸出 ${f.selector}（${Math.max(r.right - q.right, q.left - r.left).toFixed(1)}px）`); } }
    }
    return { fail: why.length > 0, why: why.join("；") };
  }, { sel: spec.selector, stageSelector: fx.stageSelector, failWhen: spec.failWhen });
}

/* 頁底色兩態底邊取樣：舞台底邊最後一列像素 vs body 底色。回 [{label, hex, worst, ok, samples}] */
async function edgeProbe(page, fx) {
  const results = [];
  for (const bg of EDGE_PROBE_BGS) {
    await page.evaluate((d) => { loadDraftJson(d, "對板檢核・底邊探針"); }, buildDraft(fx, null, bg.hex));
    await page.waitForTimeout(700);
    const m = await measure(page, fx);
    if (m.fatal) { results.push({ label: bg.label, hex: bg.hex, fatal: m.fatal }); continue; }
    const bodyC = parseColor(m.bodyBg);
    // 截「視覺底邊」（銜接帶底，退回舞台盒底）上方 2px 的一條（viewport 座標）；clip 用 CSS px（dpr 假設 1＝Playwright 預設 context）
    const edgeY = Math.floor(m.stage.edgeBottomViewport);
    const yTop = Math.max(0, edgeY - 2);
    const clipX = Math.max(0, Math.floor(m.stage.leftViewport));
    const clip = { x: clipX, y: yTop, width: Math.max(2, Math.floor(m.stage.w)), height: 2 };
    let img;
    try { img = decodePng(await page.screenshot({ clip, type: "png" })); }
    catch (e) { results.push({ label: bg.label, hex: bg.hex, fatal: `截圖解碼失敗：${e.message}` }); continue; }
    const rowY = img.h - 1; // 最後一列＝視覺底邊那一列
    const xs = Array.from({ length: EDGE_SAMPLES }, (_, i) => Math.min(img.w - 1, Math.floor((i + 0.5) * img.w / EDGE_SAMPLES)));
    /* 每個取樣點先問「這個點上最上層的元素是不是舞台自己的」——不是（後續區塊的文字、頁尾）＝這點不是 hero 的底邊，跳過並記下
       誰佔住了它；全部被佔＝出聲 ✗（舞台盒子跟可見 hero 對不上），不靜靜報綠。 */
    const owner = await page.evaluate(({ xs, y, clipX, stageSelector }) => {
      const stage = document.querySelector(stageSelector);
      /* 銜接帶 .hv2-bridge 是 pointer-events:none，elementsFromPoint 會跳過它、回傳底下的透明容器（main／section／div）——
         透明容器不畫顏色，不算「佔住」。只有「會畫東西」的元素（有底色、有背景圖、或是文字類標籤）才算佔住＝這點看到的不是 hero 底邊。 */
      const painted = (el) => {
        const cs = getComputedStyle(el);
        const bgA = (cs.backgroundColor.match(/rgba?\([^)]*?,\s*([\d.]+)\)$/) || [])[1];
        const hasBg = cs.backgroundColor !== "rgba(0, 0, 0, 0)" && !(bgA !== undefined && Number(bgA) === 0);
        // 直接放文字的透明容器也算會畫東西（011 桌機診斷：下一區「緊貼上緣」的字貼到銜接帶最後一列，字在 div 裡不是 h2）
        const ownText = Array.from(el.childNodes).some((n) => n.nodeType === 3 && n.textContent.trim().length > 0);
        return hasBg || ownText || cs.backgroundImage !== "none" || /^(h[1-6]|p|span|a|li|small|strong|em|b|i|label|td|th|svg|img|canvas|video)$/.test(el.tagName.toLowerCase());
      };
      return xs.map((px) => {
        const el = document.elementsFromPoint(clipX + px, y)[0];
        if (!el) return { mine: true, who: "none" };
        if (el === stage || stage.contains(el)) return { mine: true, who: "stage" };
        return { mine: !painted(el), who: `${el.tagName.toLowerCase()}${el.className ? "." + String(el.className).split(/\s+/)[0] : ""}` };
      });
    }, { xs, y: edgeY - 1, clipX, stageSelector: fx.stageSelector });
    const samples = [], skipped = [];
    xs.forEach((x, i) => {
      if (!owner[i].mine) { skipped.push({ x, who: owner[i].who }); return; }
      const px = pngPixel(img, x, rowY);
      const d = bodyC ? Math.max(Math.abs(px.r - bodyC.r), Math.abs(px.g - bodyC.g), Math.abs(px.b - bodyC.b)) : 255;
      samples.push({ x, px, d });
    });
    // 全被會畫東西的元素蓋住＝hero 底邊那一列本來就看不見（下一區疊上來了）＝沒有「銜接」可言，記 ℹ 不記 ✗
    if (!samples.length) { results.push({ label: bg.label, hex: bg.hex, info: `底邊列被下一區覆蓋（${[...new Set(skipped.map((s) => s.who))].join("、")}）＝hero 底邊不可見、無銜接可量` }); continue; }
    const worst = samples.reduce((a, s) => (s.d > a.d ? s : a), samples[0]);
    results.push({ label: bg.label, hex: bg.hex, bodyBg: m.bodyBg, worst, ok: worst.d <= EDGE_TOL, samples, skipped, edgeSource: m.stage.edgeSource });
  }
  return results;
}

async function runFixture(browser, fixturePath, frametest, opts) {
  const fx = JSON.parse(fs.readFileSync(fixturePath, "utf8"));
  const dev = DEVICE_PARAM[fx.device];
  const url = "file://" + frametest + (dev ? `?device=${dev}` : "") + `#exp=kv:${fx.layout}`;
  /* 桌機量測視窗收到「舞台基準寬」（2026-08-26 甲案伴生；2026-08-28 決策③ 一般化＝W1-B11）：引擎桌機視窗＞基準寬起
   * 「寬螢幕等比放大」（fitHeroV2 甲案、消費者行為），對板檢核量的是「設計基準態」（Figma 板原寬）——viewport 收窄不影響
   * 斷言語意（板座標系相對舞台原點）、放大分支自然不觸發；不在引擎加量測模式＝不為測試開後門的正解。
   * fixture 可宣告 stageBaseW（＝引擎 HV2_STAGES 該款 w 欄的人肉同步複本；011 首例 1440），缺欄回退 1264＝十款既有行為零位移。
   * fixture 檔的 viewport.w 照舊留檔值（tablet/mobile 不動）。 */
  const vw = fx.device === "desktop" ? Math.min(fx.viewport.w, fx.stageBaseW ?? 1264) : fx.viewport.w;
  const page = await browser.newPage({ viewport: { width: vw, height: fx.viewport.h } });
  const errs = [];
  page.on("pageerror", (e) => errs.push(e.message));
  await page.goto(url, { waitUntil: "load" });
  await page.waitForTimeout(2200);
  await page.evaluate((d) => { loadDraftJson(d, "對板檢核"); }, buildDraft(fx));
  await page.waitForTimeout(1200);
  const results = await measure(page, fx);

  const out = { fixture: path.basename(fixturePath), layout: fx.layout, device: fx.device, pass: 0, fail: 0, info: 0, limitMismatch: 0, lines: [], derived: {} };
  if (results.fatal) { out.fail++; out.lines.push(`✗ FATAL ${results.fatal}`); await page.close(); return out; }
  if (errs.length) { out.fail++; out.lines.push(`✗ pageerror：${errs.join(" | ").slice(0, 160)}`); }
  if (results.overflowX > 0) { out.fail++; out.lines.push(`✗ 水平溢出 ${results.overflowX}px`); }
  const tol = fx.tolerancePx ?? 3;
  fx.checks.forEach((c, i) => {
    const r = results.rows[i];
    if (!r || r.missing) { out.fail++; out.lines.push(`✗ ${c.name}：元素不存在（${c.selector}）`); return; }
    let ok = true; const why = [];
    if (c.box) for (const k of ["x", "y", "w", "h"]) {
      if (c.box[k] == null) continue;
      const d = Math.abs(r.box[k] - c.box[k]);
      if (d > tol) { ok = false; why.push(`${k}=${r.box[k].toFixed(1)} 板=${c.box[k]}（差 ${d.toFixed(1)}>±${tol}）`); }
    }
    if (c.style) for (const [k, want] of Object.entries(c.style)) {
      const got = /color/i.test(k) ? normColor(r.styles[k]) : String(r.styles[k]);
      const wantN = /color/i.test(k) ? normColor(want) : String(want);
      if (got !== wantN) { ok = false; why.push(`${k}=${got} 板=${wantN}`); }
    }
    if (c.visible === false && r.visible) { ok = false; why.push("板定義此態應收起、實作卻顯示"); }
    if (c.gradient) {
      const g = parseLinearGradient(r.bgImage);
      if (!g) { ok = false; why.push(`漸層：實作沒有 linear-gradient（backgroundImage=${String(r.bgImage).slice(0, 60)}）`); }
      else {
        const wantAngle = normDirection(c.gradient.direction);
        if (angleDiff(g.angle, wantAngle) > GRAD_ANGLE_TOL) { ok = false; why.push(`漸層方向 ${g.angle}° 板=${wantAngle}°（畫反了／方向不對）`); }
        const ws = (c.gradient.stops || []).map(parseColor);
        if (ws.length >= 2) {
          const first = g.stops[0].color, last = g.stops[g.stops.length - 1].color;
          if (!colorClose(first, ws[0])) { ok = false; why.push(`漸層起點 ${colorStr(first)} 板=${colorStr(ws[0])}`); }
          if (!colorClose(last, ws[ws.length - 1])) { ok = false; why.push(`漸層終點 ${colorStr(last)} 板=${colorStr(ws[ws.length - 1])}`); }
        }
      }
    }
    if (ok) { out.pass++; out.lines.push(`✓ ${c.name}${c.gradient ? "（含漸層方向與兩端色）" : ""}`); }
    else { out.fail++; out.lines.push(`✗ ${c.name}：${why.join("；")}`); }
  });

  /* 頁底色兩態底邊取樣（走查發現 22）：spec 有 background（場景型）才探；--edge-probe=all 普查 */
  /* 適用範圍（2026-09-11 普查校正）：只有 scene 類（三段式銜接帶讓舞台溶進頁底色）的舞台底邊才該等於頁底色；
     seamless（磚紋鋪滿）與 pattern（自成一塊的格紋／斜紋）的底邊本來就不等於頁底色＝探針定義不適用、量出來是假紅。
     所以預設模式只對 spec 有 edgeProbe:true（scene 款）或 background（登了場景背景）的檔跑；=all 是普查用。 */
  if (opts.edgeProbe === "all" || (opts.edgeProbe && (fx.edgeProbe || fx.background))) {
    const ep = await edgeProbe(page, fx);
    for (const r of ep) {
      if (r.fatal) { out.fail++; out.lines.push(`✗ 頁底色兩態底邊（${r.label} ${r.hex}）：${r.fatal}`); continue; }
      if (r.info) { out.info++; out.lines.push(`ℹ 頁底色兩態底邊（${r.label} ${r.hex}）：${r.info}`); continue; }
      const line = `頁底色兩態底邊（${r.label} ${r.hex}）：${r.edgeSource === ".hv2-bridge" ? "銜接帶底" : "舞台盒底"} vs body ${normColor(r.bodyBg)} 最大單通道差 ${r.worst.d}（x=${r.worst.x}，有效取樣 ${r.samples.length}/${EDGE_SAMPLES}${r.skipped && r.skipped.length ? `，跳過 ${r.skipped.length} 點被 ${[...new Set(r.skipped.map((s) => s.who))].join("、")} 佔住` : ""}）`;
      if (r.ok) { out.pass++; out.lines.push(`✓ ${line}`); }
      else { out.fail++; out.lines.push(`✗ ${line} > ±${EDGE_TOL}＝底邊浮出一條不該有的色帶（09-10 病例同型）`); }
    }
  }

  /* 欄位長度上限（走查發現 15；73 號 §6-1 甲＝本欄為真源）：宣告值驗證（放得下＋多一字就壞）＋可選二分搜尋實測 */
  const FLM = fx.fieldLimitsMachine || {};
  for (const [slot, spec] of Object.entries(FLM)) {
    if (!spec || !spec.selector || !spec.maxChars) { out.info++; out.lines.push(`ℹ 欄位上限 ${slot}：機讀欄不完整（要 selector＋maxChars），略過`); continue; }
    const atMax = await probeLimit(page, fx, slot, spec, spec.maxChars);
    if (atMax.skip) { out.info++; out.lines.push(`ℹ 欄位上限 ${slot}：${atMax.skip}（此裝置無此槽？）`); continue; }
    const overMax = await probeLimit(page, fx, slot, spec, spec.maxChars + 1);
    let verdict;
    if (atMax.fail) verdict = `宣告 ${spec.maxChars} 字放不下（${atMax.why}）＝宣告值過寬`;
    else if (!overMax.fail) verdict = `宣告 ${spec.maxChars} 字放得下，但 ${spec.maxChars + 1} 字也沒壞＝宣告值可能過嚴（或 failWhen 判準抓不到這種壞法）`;
    else verdict = `宣告 ${spec.maxChars} 字屬實（${spec.maxChars} 放得下、${spec.maxChars + 1} 壞：${overMax.why}）`;
    let derivedNote = "";
    if (opts.deriveLimits) {
      let lo = 0, hi = spec.probeMax || 40; // 不變量：lo 放得下、hi 壞（或到上限）
      const hiRes = await probeLimit(page, fx, slot, spec, hi);
      const pc = spec.probeChar || "測"; // 量的是哪種字元要講清楚：全形「測」與英數「W」寬度差很多，數字不同不等於矛盾（b3 2026-09-11 提醒）
      if (!hiRes.fail) { derivedNote = `｜實測：到 ${hi} 個「${pc}」都沒壞＝這欄的「太長會變醜」沒有機械性壞法（failWhen 抓不到），上限只能是設計決定`; out.derived[slot] = { max: null, note: `≥${hi}`, probeChar: pc }; }
      else {
        while (hi - lo > 1) { const mid = (lo + hi) >> 1; const r = await probeLimit(page, fx, slot, spec, mid); if (r.fail) hi = mid; else lo = mid; }
        out.derived[slot] = { max: lo, probeChar: pc, source: spec.source || null };
        derivedNote = `｜實測安全字數＝${lo} 個「${pc}」${lo !== spec.maxChars ? `（≠宣告 ${spec.maxChars}）` : "（＝宣告）"}`;
        if (lo !== spec.maxChars) out.limitMismatch++;
      }
    }
    const bad = atMax.fail || (opts.deriveLimits && out.derived[slot] && out.derived[slot].max != null && out.derived[slot].max !== spec.maxChars);
    if (bad && opts.enforceLimits) { out.fail++; out.lines.push(`✗ 欄位上限 ${slot}（${spec.label || ""}）：${verdict}${derivedNote}`); }
    else { out.info++; out.lines.push(`${bad ? "⚠" : "ℹ"} 欄位上限 ${slot}（${spec.label || ""}）：${verdict}${derivedNote}${spec.source ? `｜來歷：${spec.source}` : ""}`); }
  }
  // 探針會改頁面狀態；還原成標準示意，避免後續（若有）誤讀
  if (Object.keys(FLM).length || opts.edgeProbe) { await page.evaluate((d) => { loadDraftJson(d, "對板檢核"); }, buildDraft(fx)); }
  await page.close();
  return out;
}

(async () => {
  const args = process.argv.slice(2);
  const ftIdx = args.indexOf("--frametest");
  const frametest = ftIdx >= 0 ? path.resolve(args[ftIdx + 1]) : DEFAULT_FRAMETEST;
  const reportOnly = args.includes("--report-only");
  const edgeArg = args.find((a) => a === "--edge-probe" || a.startsWith("--edge-probe="));
  const opts = {
    edgeProbe: edgeArg ? (edgeArg.includes("=all") ? "all" : true) : false,
    deriveLimits: args.includes("--derive-limits"),
    enforceLimits: args.includes("--enforce-limits"),
  };
  const targets = args.includes("--all")
    ? (fs.existsSync(SPEC_DIR) ? fs.readdirSync(SPEC_DIR).filter((f) => f.endsWith(".json")).map((f) => path.join(SPEC_DIR, f)) : [])
    : args.filter((a) => a.endsWith(".json"));
  if (!targets.length) { console.error("沒有對板規格檔可跑（--all 掃 design-assets/layouts/spec/，或直接給 fixture 路徑）——規格檔缺席＝該版式尚未達「機器可對板」門檻"); process.exit(1); }
  if (reportOnly) console.log("SPEC_CHECK:REPORT-ONLY（只報告不擋；73 號 §6-3 甲＝新檢查先看紅燈存量再裁強制）");
  const browser = await chromium.launch({ channel: "chrome" });
  let fail = 0, mismatch = 0; const derivedAll = {};
  for (const t of targets) {
    const r = await runFixture(browser, t, frametest, opts);
    console.log(`\n【${r.layout}・${r.device}】${r.fixture}`);
    r.lines.forEach((l) => console.log("  " + l));
    console.log(`  → pass=${r.pass} fail=${r.fail}${r.info ? ` info=${r.info}` : ""}${r.limitMismatch ? ` limitMismatch=${r.limitMismatch}` : ""}`);
    fail += r.fail; mismatch += r.limitMismatch;
    if (Object.keys(r.derived).length) derivedAll[`${r.layout}.${r.device}`] = r.derived;
  }
  await browser.close();
  if (opts.deriveLimits) console.log(`\nDERIVED_LIMITS ${JSON.stringify(derivedAll)}`);
  if (reportOnly) { console.log(`\nSPEC_CHECK:REPORT fail=${fail}${mismatch ? ` limitMismatch=${mismatch}` : ""}（只報告不擋）`); process.exit(0); }
  console.log(fail === 0 ? "\nSPEC_CHECK:PASS（全部對板）" : `\nSPEC_CHECK:FAIL（共 ${fail} 項不合板）`);
  process.exit(fail === 0 ? 0 : 1);
})();
