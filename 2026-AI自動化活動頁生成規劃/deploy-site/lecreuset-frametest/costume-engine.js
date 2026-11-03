/* design-assets/typestyles/costume-engine.js —— 字風「妝容跟主題走」換妝算法（真源、單一實作）
   誰吃：①活動頁引擎 FrameTest（deploy-site/sync.sh 複製為 lecreuset-frametest/costume-engine.js，draft page.titleStyleThemed 到場才掛）
        ②色彩策略工具（tools/sync-registry-to-colortool.mjs 注入 COSTUME_ENGINE 標記塊＝機器複本，勿在工具頁手改）
   為什麼抽出來（2026-09-05）：原本換妝只算在工具、塞進預覽 iframe，提案包只帶一張便條、CMS／線上沒程式套＝上線是原妝。
   現在引擎依「登記簿配方（typestyles.css 每款的 --ts-costume 變數）＋頁面主題變數」自算，預覽＝上線、只有這一份數學。
   配方（登記簿 meta.costumeModes）：generic 輪替／hue 只換色相／ink 墨色→主色／outline 描邊→主色深階／backdrop 襯字層→主色深階／
   glow 光暈→主色淡階／tint 暈染→淡階／keep 不動／pure（自動）＝一個顏色都沒換到＝字身直接吃主色墨色。 */
(function (root) {
  "use strict";
  const hexToRgb = (h) => { const m = String(h || "").trim().replace("#", ""); if (!/^[0-9a-fA-F]{6}$/.test(m)) return null; const v = parseInt(m, 16); return { r: (v >> 16) & 255, g: (v >> 8) & 255, b: v & 255 }; };
  const rgbToHex = (c) => "#" + [c.r, c.g, c.b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("").toUpperCase();
  const mixHex = (a, b, pct) => { const A = hexToRgb(a), B = hexToRgb(b); if (!A || !B) return a; const t = pct / 100; return rgbToHex({ r: A.r + (B.r - A.r) * t, g: A.g + (B.g - A.g) * t, b: A.b + (B.b - A.b) * t }); };
  const rgbToHsl = (c) => { const r = c.r / 255, g = c.g / 255, b = c.b / 255, mx = Math.max(r, g, b), mn = Math.min(r, g, b); let h = 0, s = 0; const l = (mx + mn) / 2; const d = mx - mn;
    if (d) { s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn); h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; h *= 60; } return { h, s: s * 100, l: l * 100 }; };
  const hslToHex = (h, s, l) => { s /= 100; l /= 100; const k = (n) => (n + h / 30) % 12; const a = s * Math.min(l, 1 - l); const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1))); return rgbToHex({ r: f(0) * 255, g: f(8) * 255, b: f(4) * 255 }); };
  const lum01 = (c) => (0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b) / 255;
  const parseRgb = (tok) => { const m = tok.match(/^rgba?\(([^)]+)\)$/); if (!m) return null; const p = m[1].split(",").map((s) => parseFloat(s)); return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }; };
  const out = (hex, a) => { if (a >= 1) return hex; const c = hexToRgb(hex); return c ? "rgba(" + c.r + "," + c.g + "," + c.b + "," + a + ")" : hex; };
  /* 主色當字身時的可讀墨色（亮底壓深、深底提亮，保色相） */
  function ink(brand, mode) { const c = hexToRgb(brand); if (!c) return brand; const l = rgbToHsl(c).l; if (mode === "dark") return l < 35 ? mixHex(brand, "#FFFFFF", 38) : brand; return l > 55 ? mixHex(brand, "#000000", 38) : brand; }
  /* 主題色包：brand／accent 必填；mode light|dark；heroInk（引擎的 hero 真底色感應墨色）可選、缺＝用 ink() */
  function buildTheme(colors, mode) {
    const brand = colors.brand, accent = colors.accent || colors.brand;
    const hsl = rgbToHsl(hexToRgb(brand) || { r: 62, g: 91, b: 253 });
    return { brand, accent, hue: hsl.h, mode: mode || "light",
      brandLight: mixHex(brand, "#FFFFFF", 55),
      /* 底紋／陰影層＝同色相、只降明度（2026-09-05 使用者：混黑會把飽和主色變成黑）：HSL 明度降 28 點、飽和略提，夾在 12～45 */
      shade: hslToHex(hsl.h, Math.min(100, hsl.s + 6), Math.max(18, Math.min(52, hsl.l - 20))), /* L-28→-20（2026-09-05 使用者：降幅再小一點）＝底紋更接近字色、色相更明顯 */
      backdrop: hslToHex(hsl.h, Math.max(20, hsl.s - 6), Math.min(78, hsl.l + 22)), /* 底紋襯層＝同色相、比主色亮 22 點（2026-09-05 使用者：淺但要看得見） */
      tintBrand: mixHex(brand, "#FFFFFF", 80), tintAccent: mixHex(accent, "#FFFFFF", 78), tintBrand2: mixHex(brand, "#FFFFFF", 88),
      ink: colors.heroInk || ink(brand, mode), hero: colors.hero || null };
  }
  /* 把一條規則的 cssText 依配方換色；ctx.pseudo＝這條是 ::before/::after（襯字層）；ctx.touched 累計換了幾個顏色 */
  function transformBody(mode, body, theme, ctx) {
    const pseudo = !!(ctx && ctx.pseudo); const assign = {}; let idx = 0, touched = 0;
    const palette = [theme.brand, theme.accent, theme.brandLight];
    const tints = [theme.tintBrand, theme.tintAccent, theme.tintBrand2];
    const res = body.replace(/rgba?\([^)]+\)/g, (tok) => {
      const c = parseRgb(tok); if (!c || c.a === 0) return tok;
      const L = lum01(c);
      if (mode === "hue") { const h = rgbToHsl(c); touched++; return out(hslToHex(theme.hue, h.s, h.l), c.a); }
      if (mode === "backdrop") { if (L > 0.86) return tok; touched++; return out(pseudo ? theme.backdrop : theme.shade, c.a); } /* 字身→深（shade）、底紋襯層→中間調可見的主色淡一階（backdrop；2026-09-05 對調後 tintBrand 太淺幾乎看不見，改用「主色亮 22 點」＝清楚可見又比字淺） */
      if (mode === "glow") { touched++; return out(pseudo ? theme.tintBrand : theme.brand, c.a); }
      if (mode === "tint") { if (L > 0.86) return tok; touched++; if (!pseudo) return out(theme.ink, c.a); const k = Math.round(c.r) + "," + Math.round(c.g) + "," + Math.round(c.b); if (!(k in assign)) { assign[k] = tints[idx % tints.length]; idx++; } return out(assign[k], c.a); }
      if (mode === "outline") { if (L < 0.14) { touched++; return out(theme.shade, c.a); } if (L > 0.86) return tok; const k = Math.round(c.r) + "," + Math.round(c.g) + "," + Math.round(c.b); if (!(k in assign)) { assign[k] = palette[Math.min(idx, palette.length - 1)]; idx++; } touched++; return out(assign[k], c.a); }
      if (L < 0.14) { if (mode === "ink") { touched++; return out(theme.brand, c.a); } return tok; }
      if (L > 0.86) return tok;
      const key = Math.round(c.r) + "," + Math.round(c.g) + "," + Math.round(c.b);
      if (!(key in assign)) { assign[key] = palette[Math.min(idx, palette.length - 1)]; idx++; }
      touched++; return out(assign[key], c.a);
    });
    if (ctx) ctx.touched = (ctx.touched || 0) + touched;
    return res;
  }
  /* 「只畫在字裡」偵測：Chrome 把 background-clip:text 併進 background 簡寫序列化，只留給第一層、位置可能在尺寸之後（A3／A4／N6 病例） */
  const hasClipText = (cssText) => /background-clip:\s*text/i.test(cssText) || /background:[^;]*\btext\b/.test(cssText);
  /* 從一組 CSSRule 產生某款字風的換妝 CSS 字串；rules＝陣列（呼叫端負責從 styleSheets 收集）；catalogToo＝連 .font-preview（工具型錄格）一起 */
  function buildCss(styleId, mode, theme, rules, opts) {
    if (mode === "keep") return "";
    const wantCatalog = !!(opts && opts.catalogToo);
    const matcher = new RegExp("\\." + (wantCatalog ? "(?:hero-)?" : "hero-") + "font-preview\\." + styleId + "(?![a-z0-9])");
    const outRules = []; const ctx = { touched: 0 };
    for (const rule of rules) {
      if (!rule || !rule.selectorText || rule.selectorText.indexOf("font-preview") < 0) continue;
      if (!matcher.test(rule.selectorText)) continue;
      ctx.pseudo = /::?(before|after)\b/.test(rule.selectorText);
      let body = transformBody(mode, rule.style.cssText, theme, ctx);
      if (hasClipText(rule.style.cssText)) body += ";-webkit-background-clip:text;background-clip:text";
      outRules.push(rule.selectorText + "{" + body + "}");
    }
    const sel = (wantCatalog ? ".font-preview." + styleId + "," : "") + ".hero-font-preview." + styleId;
    if (!ctx.touched) outRules.push(sel + "{color:" + theme.ink + ";-webkit-text-fill-color:" + theme.ink + "}"); /* pure：純字形款＝字身直接吃主色墨色 */
    if (mode === "hue") { const tube = theme.mode === "dark" ? hslToHex(theme.hue, 92, 68) : hslToHex(theme.hue, 55, 16); outRules.push(sel + "{color:" + tube + ";-webkit-text-fill-color:" + tube + ";-webkit-text-stroke-color:" + tube + "}"); }
    return outRules.join("\n");
  }
  /* 字面是哪一種（2026-09-26 使用者裁「乙」：字面跟 Headline、妝跟配方）：gradient＝字面是漸層（background-clip:text，設計本體、不套主標色）；
     hollow＝字面透明（鏤空）；solid＝實色字面（可套主標色）。看主選擇器與 .line 行段（字身本體）；襯字層（::before/::after）是妝、不算字面。
     引擎（hv2ApplyTitleInk）與色彩工具（字風說明／打包提醒）都呼叫這一支＝判定只有一份。 */
  function fillKind(styleId, rules, opts) {
    const wantCatalog = !!(opts && opts.catalogToo);
    const matcher = new RegExp("\\." + (wantCatalog ? "(?:hero-)?" : "hero-") + "font-preview\\." + styleId + "(?![a-z0-9])");
    let kind = "solid", seen = false;
    for (const rule of rules || []) {
      if (!rule || !rule.selectorText || !matcher.test(rule.selectorText)) continue;
      if (/::?(before|after)\b/.test(rule.selectorText)) continue; /* 襯字層＝妝；.line 行段是字身本體（B2 等堆疊款把漸層寫在 .line 上，2026-09-26 無頭實測抓到）＝算字面 */
      seen = true; const t = (rule.style && rule.style.cssText) || "";
      if (hasClipText(t)) return "gradient";
      if (/(?:^|;)\s*(?:-webkit-text-fill-color|color)\s*:\s*transparent\b/i.test(t)) kind = "hollow";
    }
    return seen ? kind : "solid";
  }
  /* 從已載入的 stylesheets 收集規則（同源才讀得到；跨源的 catch 掉） */
  function collectRules(styleSheets) { const rules = []; for (const ss of styleSheets) { let rs; try { rs = ss.cssRules; } catch (e) { continue; } if (!rs) continue; for (const r of rs) rules.push(r); } return rules; }
  const api = { buildTheme, transformBody, buildCss, collectRules, hasClipText, fillKind, ink, mixHex, hexToRgb, rgbToHsl, hslToHex, VERSION: "2026-09-26" };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.TypestyleCostume = api;
})(typeof window !== "undefined" ? window : globalThis);
