"use strict";
/**
 * lib/aem_export.js —— 「下載 AEM HTML」的瘦身組裝器（69 號 Phase 2，2026-09-10 團隊反饋批）
 *
 * 白話：把活動頁引擎模板（FrameTest 真源）＋這一檔的活動資料，組成「只裝這頁需要的東西」的單一 HTML，
 * 交同事上傳 Adobe Experience Manager。09-08 測試檔 1050KB 裡有 27% 是給工程師看的註解、12 款版型全帶、
 * 49 款字風全帶、40 張背景登記簿全帶——本檔的工作就是把這些減掉，且每一步都能被 aem_verify.js 對板證明沒剝壞。
 *
 * 設計原則（52 號批判前置 Q2／Q3）：
 *  - 不養第二份模板：真源仍是 FrameTest 一份，本檔只做「減法」；界線用模板裡既有的分段標題與元素 id 當錨點，
 *    錨點找不到＝紅燈停止（失敗要出聲），不靜默交付肥檔。
 *  - 鷹架元素「留殼去肉」不刪：INIT 段對 #ep-body／#ep-url 等直接掛事件，刪 DOM 會報錯（09-10 實測）；
 *    改成留一個帶必要 id 的空殼，內容全拿掉。
 *  - 裝置預覽 CSS（data-device）不能剝：它就是真手機／平板的版面（觸控＋寬<1200 → ?device= → 套這套）。
 *    09-10 差點剝掉——比對器沒模擬觸控就看不出來。轉址改「頁內 replaceState」＝不依賴 AEM 保留網址參數。
 *  - 素材全部內嵌成 data URI（背景 PNG 經 sharp 縮 1600 寬轉 WebP：4.3MB→28KB 實測），不留任何相對路徑。
 *
 * 純函式：不碰 run 目錄、不碰網路；I/O 只讀模板與素材檔。server.js 的 exportAem 負責守門與落檔。
 */
const fs = require("fs");
const path = require("path");

/* ───────────────────────── 1. 註解與縮排剝除（不刪換行＝零 ASI 風險） ───────────────────────── */
function stripJs(src) {
  let out = "", i = 0, prev = "";
  const n = src.length;
  const regexAllowed = () => !prev || !/[)\]\w$'"`]$/.test(prev);
  while (i < n) {
    const c = src[i], d = src[i + 1];
    if (c === "/" && d === "/") { const j = src.indexOf("\n", i); i = j < 0 ? n : j; continue; }
    if (c === "/" && d === "*") {
      const j = src.indexOf("*/", i + 2); const seg = src.slice(i, j < 0 ? n : j + 2);
      out += "\n".repeat((seg.match(/\n/g) || []).length); i = j < 0 ? n : j + 2; continue;
    }
    if (c === '"' || c === "'") {
      let j = i + 1; while (j < n) { if (src[j] === "\\") { j += 2; continue; } if (src[j] === c) { j++; break; } if (src[j] === "\n") break; j++; }
      out += src.slice(i, j); prev = c; i = j; continue;
    }
    if (c === "`") {
      let j = i + 1, depth = 0;
      while (j < n) {
        if (src[j] === "\\") { j += 2; continue; }
        if (src[j] === "`" && depth === 0) { j++; break; }
        if (src[j] === "$" && src[j + 1] === "{") { depth++; j += 2; continue; }
        if (src[j] === "}" && depth > 0) { depth--; j++; continue; }
        j++;
      }
      out += src.slice(i, j); prev = "`"; i = j; continue;
    }
    if (c === "/" && regexAllowed()) { // 正規表示式字面值：同一行內要能收尾，否則當普通字元（保守）
      let j = i + 1, cls = false, ok = false;
      while (j < n) {
        const e = src[j];
        if (e === "\\") { j += 2; continue; }
        if (e === "\n") break;
        if (e === "[") cls = true; else if (e === "]") cls = false;
        else if (e === "/" && !cls) { j++; while (j < n && /[gimsuyd]/.test(src[j])) j++; ok = true; break; }
        j++;
      }
      if (ok) { out += src.slice(i, j); prev = "/"; i = j; continue; }
    }
    out += c; if (!/\s/.test(c)) prev = c; i++;
  }
  return out.split("\n").map((l) => l.replace(/^[ \t]+/, "").replace(/[ \t]+$/, "")).filter((l, k, a) => l !== "" || (k > 0 && a[k - 1] !== "")).join("\n");
}
function stripCss(src) {
  let out = "", i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    if (c === "/" && src[i + 1] === "*") { const j = src.indexOf("*/", i + 2); i = j < 0 ? n : j + 2; continue; }
    if (c === '"' || c === "'") { let j = i + 1; while (j < n) { if (src[j] === "\\") { j += 2; continue; } if (src[j] === c) { j++; break; } j++; } out += src.slice(i, j); i = j; continue; }
    out += c; i++;
  }
  return out.split("\n").map((l) => l.trim()).filter((l) => l !== "").join("\n");
}

/* ───────────────────────── 2. CSS 規則樹（逐字保留、只做取捨） ───────────────────────── */
/** 把 CSS 切成規則節點：{ prelude, body, children? , text }。巢狀 @media／@supports／@container／@layer 會遞迴；
 *  @keyframes／@font-face／@page 當葉子整塊保留。不解析屬性＝不會丟掉瀏覽器不認得的寫法（CSSOM 會）。 */
function parseCssRules(css) {
  const nodes = []; let i = 0, last = 0;
  const n = css.length;
  const skipStr = (j) => { const q = css[j]; j++; while (j < n) { if (css[j] === "\\") { j += 2; continue; } if (css[j] === q) return j + 1; j++; } return n; };
  while (i < n) {
    const c = css[i];
    if (c === '"' || c === "'") { i = skipStr(i); continue; }
    if (c === "/" && css[i + 1] === "*") { const j = css.indexOf("*/", i + 2); i = j < 0 ? n : j + 2; continue; }
    if (c === ";" ) { // @import／@charset 這類無區塊的 at-rule
      const pre = stripCss(css.slice(last, i + 1)).trim(); // 前面黏著的註解要剝掉，否則 @font-face 會被當成一般共用規則（2026-09-10 對板閘抓到 4.2MB 字型漏網）
      if (pre.startsWith("@")) nodes.push({ prelude: pre.slice(0, -1).trim(), flat: true, text: pre });
      last = i + 1; i++; continue;
    }
    if (c === "{") {
      const prelude = stripCss(css.slice(last, i)).replace(/\s+/g, " ").trim();
      let depth = 1, j = i + 1;
      while (j < n && depth > 0) {
        const e = css[j];
        if (e === '"' || e === "'") { j = skipStr(j); continue; }
        if (e === "/" && css[j + 1] === "*") { const k = css.indexOf("*/", j + 2); j = k < 0 ? n : k + 2; continue; }
        if (e === "{") depth++; else if (e === "}") depth--;
        j++;
      }
      const body = css.slice(i + 1, j - 1);
      const node = { prelude, text: prelude + "{" + body + "}" };
      if (/^@(media|supports|container|layer)\b/.test(prelude)) node.children = parseCssRules(body); else node.body = body;
      nodes.push(node); last = j; i = j; continue;
    }
    i++;
  }
  return nodes;
}
function serializeCssRules(nodes) {
  return nodes.map((nd) => {
    if (nd.flat) return nd.text;
    if (nd.children) { const inner = serializeCssRules(nd.children); return inner ? `${nd.prelude}{${inner}}` : ""; }
    return `${nd.prelude}{${nd.body}}`;
  }).filter(Boolean).join("\n");
}
/** keep(prelude) 回 false＝丟葉子；回字串＝改寫 prelude（選擇器清單只留一部分）；巢狀容器空了就整塊丟。 */
function filterCss(css, keep) {
  const walk = (nodes) => nodes.map((nd) => {
    if (nd.children) { const ch = walk(nd.children); return ch.length ? { ...nd, children: ch } : null; }
    const k = keep(nd.prelude, nd);
    if (k === false) return null;
    return typeof k === "string" && k !== nd.prelude ? { ...nd, prelude: k, text: nd.flat ? nd.text : k + "{" + nd.body + "}" } : nd;
  }).filter(Boolean);
  return serializeCssRules(walk(parseCssRules(css)));
}
/** 選擇器清單依「頂層逗號」切開（括號內、屬性選擇器內、字串內的逗號不算）。 */
function splitSelectorList(sel) {
  const parts = []; let depth = 0, inStr = null, start = 0;
  for (let i = 0; i < sel.length; i++) {
    const c = sel[i];
    if (inStr) { if (c === "\\") i++; else if (c === inStr) inStr = null; continue; }
    if (c === '"' || c === "'") { inStr = c; continue; }
    if (c === "(" || c === "[") depth++; else if (c === ")" || c === "]") depth--;
    else if (c === "," && depth === 0) { parts.push(sel.slice(start, i).trim()); start = i + 1; }
  }
  parts.push(sel.slice(start).trim());
  return parts.filter(Boolean);
}
/** 把「逐個選擇器」的判斷升成「選擇器清單」的判斷：全丟＝false、部分留＝回改寫後的清單、全留＝true。 */
function selectorListKeeper(partOk) {
  return (prelude) => {
    if (prelude.startsWith("@")) return true;
    const parts = splitSelectorList(prelude), kept = parts.filter(partOk);
    if (!kept.length) return false;
    return kept.length === parts.length ? true : kept.join(",");
  };
}

/* ───────────────────────── 3. 模板結構：舞台／骨架／鷹架 ───────────────────────── */
/** 從模板 DOM 讀出「每款版型的舞台元素用哪個骨架 class」（例：hv2-l009 → hv2-s12）。 */
function stageSkeletons(html) {
  const map = {};
  for (const m of html.matchAll(/<div class="([^"]*?)hv2-l(\d{3})\b([^"]*)"[^>]*id="hv2-l\2"/g)) {
    const classes = (m[1] + " " + m[3]).split(/\s+/).filter(Boolean);
    map["layout-" + m[2]] = classes.filter((c) => /^hv2-s\w+$/.test(c));
  }
  return map;
}
/** 親戚版型（kinRef 家族）：共用同一套骨架 class 的版型（008／009＝S12、006／007＝S11、002／003＝S10W）——渲染器與零件函式互相借名，
 *  剝函式時把親戚的號碼一起當「自己人」。CSS 不在此列（CSS 有明確的 hv2-lNNN 記號、親戚各寫各的）。 */
function kinLayouts(usedLayout, skeletons) {
  const mine = new Set(skeletons[usedLayout] || []);
  return Object.keys(skeletons).filter((l) => l === usedLayout || (skeletons[l] || []).some((c) => mine.has(c)));
}
/** 版型／骨架取捨：選擇器明講別款版型或別套骨架的「那一段」丟掉；共用段一律保留（逗號清單只剪不整條丟）。 */
function layoutRuleKeeper(usedLayout, skeletons) {
  const usedNum = usedLayout.slice(-3);
  const mySk = new Set(skeletons[usedLayout] || []);
  const allSk = new Set(Object.values(skeletons).flat());
  return selectorListKeeper((part) => {
    for (const m of part.matchAll(/hv2-l(\d{3})|data-layout="layout-(\d{3})"|layout-(\d{3})/g)) { const num = m[1] || m[2] || m[3]; if (num !== usedNum) return false; }
    for (const m of part.matchAll(/\.(hv2-s\w+)\b/g)) { if (allSk.has(m[1]) && !mySk.has(m[1])) return false; }
    return true;
  });
}
/** 平衡配對移除一個 <div … id="X">…</div>（只數 div 開闔；舞台元素本身是 div）。找不到＝throw（錨點漂移要出聲）。 */
function removeDivById(html, id) {
  const open = html.search(new RegExp(`<div\\b[^>]*\\bid="${id}"[^>]*>`));
  if (open < 0) throw new Error(`模板找不到元素 #${id}（錨點漂移）`);
  const tagEnd = html.indexOf(">", open) + 1;
  const re = /<div\b|<\/div>/g; re.lastIndex = tagEnd;
  let depth = 1, m;
  while ((m = re.exec(html))) { depth += m[0] === "<div" ? 1 : -1; if (depth === 0) return html.slice(0, open) + html.slice(m.index + 6); }
  throw new Error(`元素 #${id} 的 </div> 配對不完整`);
}
function removeUnusedStages(html, usedLayout, skeletons) {
  let out = html, removed = [];
  for (const id of Object.keys(skeletons)) if (id !== usedLayout) { out = removeDivById(out, "hv2-" + id.replace("layout-", "l")); removed.push(id); }
  return { html: out, removed };
}
/** 鷹架「留殼去肉」：面板整塊換成只帶必要 id 的空殼（引擎 INIT 對這些 id 掛事件；不在＝報錯）。 */
function shrinkScaffold(html, jsText) {
  const asideRe = /<aside id="exp-panel">[\s\S]*?<\/aside>/;
  const m = html.match(asideRe);
  if (!m) throw new Error("模板找不到 <aside id=\"exp-panel\">（錨點漂移）");
  const ids = [...m[0].matchAll(/\bid="([^"]+)"/g)].map((x) => x[1]).filter((x) => x !== "exp-panel");
  const referenced = ids.filter((id) => new RegExp(`getElementById\\("${id}"\\)|querySelector\\("#${id}\\b|"#${id}"`).test(jsText));
  const stub = `<aside id="exp-panel" hidden aria-hidden="true">` +
    referenced.map((id) => (/file/.test(id) ? `<input type="file" id="${id}" hidden>` : /ep-url$/.test(id) ? `<input id="${id}" hidden>` : `<div id="${id}" hidden></div>`)).join("") + `</aside>`;
  return { html: html.replace(asideRe, stub), stubIds: referenced };
}

/* ───────────────────────── 4. JS 區段剝除＋符號稽核 ───────────────────────── */
/** 用區段標題當錨點切掉整段；回傳 { js, dropped:[{name,bytes}] }。錨點缺＝throw。 */
function dropJsRegions(js, regions) {
  let out = js; const dropped = [];
  for (const r of regions) {
    const a = out.indexOf(r.start); if (a < 0) throw new Error(`引擎找不到區段起點「${r.name}」（錨點漂移）`);
    const b = out.indexOf(r.end, a + r.start.length); if (b < 0) throw new Error(`引擎找不到區段終點「${r.name}」（錨點漂移）`);
    dropped.push({ name: r.name, bytes: Buffer.byteLength(out.slice(a, b)), text: out.slice(a, b) });
    out = out.slice(0, a) + out.slice(b);
  }
  return { js: out, dropped };
}
/** 被剝掉的頂層函式若仍被剩下的程式提到 → 補一個空殼函式；const/let/var 被提到＝無法安全補殼 → throw。 */
/** 這些是畫面的命脈，任何區段界線若把它們掃進去＝界線切錯，直接紅燈（不准補空殼混過去）。 */
const NEVER_STUB = ["loadDraftJson", "renderHeroV2", "renderHeroV2Core", "applyHeroShell", "applyState", "renderDock", "fitHeroV2", "hv2ApplyTitleStyle", "hv2ApplyCostume"];
function auditDroppedSymbols(remainingJs, dropped) {
  const stubs = [], unsafe = [], vital = [];
  const plain = stripJs(remainingJs);
  for (const d of dropped) {
    const fns = [...d.text.matchAll(/^(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/gm)].map((m) => m[1]);
    const vars = [...d.text.matchAll(/^(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/gm)].map((m) => m[1]);
    for (const f of fns) { if (NEVER_STUB.includes(f)) vital.push(`${f}（在「${d.name}」）`); else if (new RegExp(`\\b${f}\\b`).test(plain)) stubs.push(f); }
    for (const v of vars) if (new RegExp(`\\b${v}\\b`).test(plain)) unsafe.push(v);
  }
  if (vital.length) throw new Error(`剝除區段切到畫面命脈函式（界線切錯）：${vital.join("、")}`);
  if (unsafe.length) throw new Error(`剝除區段的變數仍被引用、無法安全補殼：${unsafe.join(", ")}`);
  return { stubs: [...new Set(stubs)] };
}

/* ───────────────────────── 4b. 函式級剝除（換空殼）與資料常數置空 ───────────────────────── */
/** 從 js[openIdx]==='{' 起找配對的 '}'（字串／樣板字串／正規表示式安全；假設註解已剝）。回傳 '}' 之後的索引。 */
function jsBlockEnd(js, openIdx) {
  let depth = 0, prev = "";
  const n = js.length;
  for (let i = openIdx; i < n; i++) {
    const c = js[i];
    if (c === '"' || c === "'") { i++; while (i < n && js[i] !== c) { if (js[i] === "\\") i++; i++; } prev = c; continue; }
    if (c === "`") { i++; let d = 0; while (i < n) { if (js[i] === "\\") { i += 2; continue; } if (js[i] === "`" && d === 0) break; if (js[i] === "$" && js[i + 1] === "{") { d++; i += 2; continue; } if (js[i] === "}" && d > 0) d--; i++; } prev = "`"; continue; }
    if (c === "/" && (!prev || !/[)\]\w$'"`]$/.test(prev))) { // 可能是 regex：同一行收尾才算
      let j = i + 1, cls = false, ok = false;
      while (j < n) { const e = js[j]; if (e === "\\") { j += 2; continue; } if (e === "\n") break; if (e === "[") cls = true; else if (e === "]") cls = false; else if (e === "/" && !cls) { ok = true; break; } j++; }
      if (ok) { i = j; prev = "/"; continue; }
    }
    if (c === "{") depth++; else if (c === "}") { depth--; if (depth === 0) return i + 1; }
    if (!/\s/.test(c)) prev = c;
  }
  throw new Error("函式主體括號不平衡");
}
/** 頂層 `function NAME(...) {...}` 命中 predicate(NAME) 者，主體換成 `{}`（簽名保留＝所有引用仍合法、呼叫變 no-op）。 */
function stubFunctionsByName(js, predicate) {
  const stubbed = [];
  const re = /^(async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/gm;
  let out = "", last = 0, m;
  while ((m = re.exec(js))) {
    if (!predicate(m[2])) continue;
    const paren = js.indexOf("(", m.index + m[0].length - 1);
    let p = paren, depth = 0; // 參數列可能含預設值物件；括號配對
    for (; p < js.length; p++) { if (js[p] === "(") depth++; else if (js[p] === ")") { depth--; if (depth === 0) break; } }
    const brace = js.indexOf("{", p);
    const end = jsBlockEnd(js, brace);
    out += js.slice(last, brace) + "{}"; last = end; stubbed.push(m[2]);
    re.lastIndex = end;
  }
  return { js: out + js.slice(last), stubbed };
}
/** 頂層 `const NAME = <陣列|物件|字串>;` 命中 predicate(NAME) 者換成 `const NAME=null;`（引用仍合法；只用於「切換示範資料集」這種正式頁永不執行的路徑）。 */
function nullDataConsts(js, predicate) {
  const nulled = [];
  const re = /^const\s+([A-Za-z_$][\w$]*)\s*=\s*/gm;
  let out = "", last = 0, m;
  while ((m = re.exec(js))) {
    if (!predicate(m[1])) continue;
    const vi = m.index + m[0].length; const c = js[vi]; let end = -1;
    if (c === "[" || c === "{") {
      let depth = 0; // 資料字面值：字串安全的括號配對
      for (let i = vi; i < js.length; i++) { const e = js[i]; if (e === '"' || e === "'" || e === "`") { i++; while (i < js.length && js[i] !== e) { if (js[i] === "\\") i++; i++; } continue; } if (e === "[" || e === "{") depth++; else if (e === "]" || e === "}") { depth--; if (depth === 0) { end = i + 1; break; } } }
    } else if (c === '"' || c === "'") { let i = vi + 1; while (i < js.length && js[i] !== c) { if (js[i] === "\\") i++; i++; } end = i + 1; }
    if (end < 0) continue; // 其他表達式不動
    const semi = js.indexOf(";", end); if (semi < 0 || js.slice(end, semi).trim() !== "") continue;
    out += js.slice(last, m.index) + `const ${m[1]}=null;`; last = semi + 1; nulled.push(m[1]);
    re.lastIndex = semi + 1;
  }
  return { js: out + js.slice(last), nulled };
}
/** 依「版型號／骨架記號」判斷函式名是不是別款版型專屬（renderHeroV2L011／fitHeroV2S10WTitle／hv2L005AbsorbMobile…）。
 *  親戚版型的號碼算自己人（S12 渲染器會叫 hv2L008Deco 畫 009——2026-09-10 對板閘抓到 009 退回「製作中」告示）。 */
function otherLayoutFnPredicate(usedLayout, skeletons) {
  const kin = new Set(kinLayouts(usedLayout, skeletons).map((l) => l.slice(-3)));
  const sk = new Set((skeletons[usedLayout] || []).map((c) => c.replace(/^hv2-/, "").toUpperCase())); // hv2-s12 → S12
  return (name) => {
    const ln = name.match(/L0(\d{2})(?![\d])/); if (ln && !kin.has("0" + ln[1])) return true;
    const sn = name.match(/S1[012]W?/); if (sn && !sk.has(sn[0])) return true;
    return false;
  };
}
/** 舊殼 KV（kv-new／kv-legacy）專屬渲染與量測：layout-* 頁一律掛 shell-v2、這些節點永不顯示。
 *  renderKvContent 不在名單：它同時寫無障礙用的 #page-h1（對板閘 2026-09-10 抓到）。 */
const LEGACY_KV_FN = /^(renderLegacyCutouts|renderKvMarquee|sizeKvMarquee|playKvFlip|navigateKv|fitKvTitles|fitKvEyebrow|fitLegacyLock)$/;

/* ───────────────────────── 5. 字風表／背景地圖收斂 ───────────────────────── */
/** 字風表收斂：只留這頁字風（css-XX）的規則＋共用底規則；@import／@font-face 只留「留下的規則真的用到的字族」
 *  （不然會為沒用到的待審字風外連 jsdelivr 上一支 4.2MB 的 TTF）。 */
function filterTypestyles(css, usedStyle) {
  const fam = (s) => s.trim().replace(/^['"]|['"]$/g, "").toLowerCase();
  const partOk = (part) => { const styles = [...part.matchAll(/\.css-([a-z0-9]+)\b/g)].map((m) => "css-" + m[1]); return !styles.length || (!!usedStyle && styles.includes(usedStyle)); };
  const listKeeper = selectorListKeeper(partOk);
  const kept = filterCss(css, (prelude) => {
    if (prelude.startsWith("@import") || prelude.startsWith("@font-face")) return false; // 先全拿掉，下面依實際用到的字族補回
    return listKeeper(prelude); // 逗號清單只剪掉別款字風那幾段（.css-f1 .line::after,.css-f2 …）
  });
  const keepFamilies = new Set();
  for (const m of kept.matchAll(/font-family\s*:\s*([^;}]+)/g)) for (const f of m[1].split(",")) keepFamilies.add(fam(f));
  const imports = [...css.matchAll(/^@import\s+url\(['"]?([^'")]+)['"]?\)\s*;/gm)].filter((m) => {
    const fams = [...m[1].matchAll(/family=([^&:]+)/g)].map((x) => decodeURIComponent(x[1]).replace(/\+/g, " ").toLowerCase());
    return fams.some((f) => keepFamilies.has(f));
  }).map((m) => m[0]);
  const faces = parseCssRules(css).filter((nd) => !nd.flat && /^@font-face/.test(nd.prelude) && [...(nd.body.match(/font-family\s*:\s*([^;}]+)/g) || [])].some((x) => keepFamilies.has(fam(x.replace(/^font-family\s*:/, ""))))).map((nd) => nd.text);
  return { css: [...imports, ...faces, kept].filter(Boolean).join("\n"), families: [...keepFamilies], imports: imports.length, fontFaces: faces.length };
}
/** 從 bg-map.js 抓出 `window.<name> = {…};` 的那個物件（括號平衡、字串安全）；缺＝null。 */
function extractAssigned(js, name) {
  const at = js.indexOf(`window.${name} = `); if (at < 0) return null;
  let i = js.indexOf("{", at), depth = 0, inStr = false;
  for (let j = i; j < js.length; j++) {
    const c = js[j];
    if (inStr) { if (c === "\\") { j++; continue; } if (c === '"') inStr = false; continue; }
    if (c === '"') { inStr = true; continue; }
    if (c === "{") depth++; else if (c === "}") { depth--; if (depth === 0) return JSON.parse(js.slice(i, j + 1)); }
  }
  throw new Error(`bg-map.js 的 ${name} 物件括號不平衡`);
}
/** 背景地圖收斂：__BG_MAP__ 只留 keepIds；__BG_DEFAULTS__（版型→預設背景）只留 keepLayouts。 */
/** 字風貨號（css-XX）在 draft 裡的落點不只一處（引擎 loadDraftJson 會正規化）：page.titleStyle ＞ page.colors.themeDraft.titleStyle ＞ …typography.title.style */
function resolveTitleStyle(pg) {
  const td = (pg.colors && pg.colors.themeDraft) || {};
  const cands = [pg.titleStyle, td.titleStyle, td.typography && td.typography.title && td.typography.title.style];
  return cands.find((v) => typeof v === "string" && /^css-[a-z0-9]+$/.test(v)) || null;
}
function shrinkBgMap(bgMapJs, keepIds, keepLayouts) {
  const map = extractAssigned(bgMapJs, "__BG_MAP__"); if (!map) throw new Error("bg-map.js 找不到 window.__BG_MAP__");
  const defaults = extractAssigned(bgMapJs, "__BG_DEFAULTS__") || {};
  const out = {}; for (const id of keepIds) if (id && map[id]) out[id] = map[id];
  const def = {}; for (const l of keepLayouts || Object.keys(defaults)) if (defaults[l]) def[l] = defaults[l];
  return { map: out, defaults: def, all: Object.keys(map).length, allDefaults: defaults };
}

/* ───────────────────────── 6. 素材內嵌（sharp 縮圖轉 WebP；小檔直接 base64） ───────────────────────── */
const MIME = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".svg": "image/svg+xml", ".gif": "image/gif" };
async function assetToDataUri(absPath, opts = {}) {
  const ext = path.extname(absPath).toLowerCase();
  const raw = fs.readFileSync(absPath);
  const maxW = opts.maxWidth || 1600, threshold = opts.optimizeAbove || 24 * 1024;
  if ([".png", ".jpg", ".jpeg"].includes(ext) && raw.length > threshold) {
    const sharp = require("sharp");
    const md = await sharp(raw).metadata();
    const buf = await sharp(raw).resize({ width: Math.min(maxW, md.width || maxW), withoutEnlargement: true }).webp({ quality: opts.quality || 82, alphaQuality: 90 }).toBuffer();
    return { uri: `data:image/webp;base64,${buf.toString("base64")}`, from: raw.length, to: buf.length, kind: "webp" };
  }
  return { uri: `data:${MIME[ext] || "application/octet-stream"};base64,${raw.toString("base64")}`, from: raw.length, to: raw.length, kind: "raw" };
}

/* ───────────────────────── 7. 啟動器與裝置切換 ───────────────────────── */
/** 裝置模式頁內切換：觸控＋寬<1200 → 直接把 ?device= 寫進網址（replaceState、不重載）→ 模板原有的轉址腳本看到參數就早退、
 *  device-preview-boot 照常讀到參數。不依賴 AEM 保留／轉發網址參數（69 號 A-1 第 5 題的風險）。 */
const TRACKING = require("./tracking_plan"); // 75 號：頁級參數＋GTM 開關＋trackingPlan（第 1 層落點＝§8.8）
const DEVICE_INLINE_SCRIPT = `<script>(function(){try{if(/[?&]device=/.test(location.search))return;var t=("ontouchstart" in window)||(navigator.maxTouchPoints>0);var w=Math.min(window.screen?screen.width:1e9,window.innerWidth||1e9);if(!t||w>=1200)return;var d=w<768?"mobile":"tablet";var q=location.search?location.search+"&device="+d:"?device="+d;history.replaceState(null,"",location.pathname+q+location.hash);}catch(e){/* 舊瀏覽器沒有 replaceState＝照舊走模板的轉址 */}})();</script>`;
/** 資料啟動器（沿 09-08 v2 測試檔）：引擎未就緒回 false 也重試、上限後紅色橫幅出聲、套上就停；只在乾淨網址（無示範集／自測旗標）啟動。 */
function launcherScript(draftJson) {
  return `<script>window.__WB_DRAFT__=${draftJson};</script>
<script>(function(){var q=new URLSearchParams(location.search);var h=location.hash||"";
if(q.has("dataset")||q.has("draftUrl")||h.indexOf("test:1")>=0||h.indexOf("dataset:")>=0)return;
var tries=0,lastErr="";
function clean(){["exp-panel","preview-watermark","draft-badge","draft-drop-overlay","device-preview-overlay","selftest-results"].forEach(function(id){var e=document.getElementById(id);if(e&&e.remove)e.remove();});}
function applied(){return document.body&&document.body.classList.contains("shell-v2")&&!!document.body.getAttribute("data-layout");}
function unmask(){document.documentElement.classList.remove("aem-boot");}
function fail(msg){unmask();if(applied())return;var b=document.createElement("div");b.style.cssText="position:fixed;top:0;left:0;right:0;z-index:99999;background:#B3261E;color:#fff;font:700 16px/1.5 sans-serif;padding:14px 18px;text-align:center";b.textContent="活動資料沒有載入，目前顯示的不是這檔活動的內容。請回 CMS 重新下載一份（技術訊息："+msg+"）";document.body.appendChild(b);}
function go(){tries++;var r;try{r=loadDraftJson(window.__WB_DRAFT__,"");}catch(e){lastErr=String(e&&e.message||e);r=false;}
if(r!==false){clean();unmask();if(window.__gaScanner){try{window.__gaScanner.start(window.__WB_DRAFT__);}catch(e){console.error("[ga] 掃描機啟動失敗（不影響畫面）",e);}}setTimeout(clean,400);return;}
if(tries<80){setTimeout(go,150);}else{fail(lastErr||"引擎連續回「還不能畫」");}}
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",go);else go();})();</script>`;
}

/* ───────────────────────── 8. 主流程 ───────────────────────── */
/**
 * assembleAemHtml({ template, draft, deps, mode }) → { html, report }
 *  template：FrameTest 真源全文；draft：draft.json 物件；
 *  deps：{ templateDir, tokensCss, typestylesCss, costumeJs, bgMapJs, defaultBackground }
 *  mode："slim"（正式）｜"full"（對板參照：同樣內嵌與啟動器，但不做任何瘦身）
 */
async function assembleAemHtml({ template, draft, deps, mode = "slim", opts = {} }) {
  const slim = mode === "slim";
  const report = { mode, steps: [], assets: [], warnings: [], dropped: [], stubs: [] };
  const pg = draft.page || {};
  const layout = String(pg.kvVariant || "").trim();
  if (!/^layout-\d{3}$/.test(layout)) throw new Error(`這檔活動沒有宣告新版型（kvVariant=${layout || "空"}），AEM 匯出只支援 layout-* 版型`);
  const size = (s) => Buffer.byteLength(s);
  let html = template;
  const step = (name) => report.steps.push({ name, bytes: size(html) });
  step("模板原始");

  /* 8.1 引擎 JS：定位主 script（含 DATA/RENDERERS/INIT）→ 剝區段 → 稽核 → 剝註解 */
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
  const main = scripts.reduce((a, b) => (b[1].length > (a ? a[1].length : 0) ? b : a), null);
  if (!main || !/RENDERERS/.test(main[1]) || !/INIT/.test(main[1])) throw new Error("模板主引擎 script 定位失敗（找不到 RENDERERS／INIT 分段）");
  let js = main[1];
  const skeletons0 = stageSkeletons(html);
  if (!skeletons0[layout]) throw new Error(`模板沒有 ${layout} 的舞台元素（引擎尚未支援這款版型）`);
  const prune = { regions: true, otherLayouts: true, legacyKv: true, altDatasets: true, ...(opts.prune || {}) };
  if (slim) {
    /* 切換用示範資料集（CAMP／KB／FA／TITANIUM…）：正式頁永不切換＝資料常數置 null；表（DEMO_DATASETS／URL_DATASETS）與函式保留＝INIT 引用合法 */
    let altConsts = [];
    if (prune.altDatasets) {
      const a0 = js.indexOf("商品資料來源 URL（Sheets"), a1 = js.indexOf("N-13 DRAFT JSON LOADER", a0);
      if (a0 < 0 || a1 < 0) throw new Error("引擎找不到「商品資料來源 URL」示範資料集區段（錨點漂移）");
      altConsts = [...js.slice(a0, a1).matchAll(/^const\s+([A-Z][A-Z0-9_]+)\s*=/gm)].map((m) => m[1]).filter((n) => !["DEMO_DATASETS", "URL_DATASETS"].includes(n));
    }
    if (prune.regions) {
      const regions = [
        { name: "自測模式（#exp=test:1）", start: "/* ============================================================ 自測模式（#exp=test:1）", end: "/* ============================================================ INIT" },
        { name: "loadProposalPack（色彩工具預覽用）", start: "/* ===== loadProposalPack（68 號", end: "function loadDraftJson(" },
      ];
      const r = dropJsRegions(js, regions); js = r.js;
      const a = auditDroppedSymbols(js, r.dropped);
      report.dropped = r.dropped.map((d) => ({ name: d.name, bytes: d.bytes }));
      report.stubs = a.stubs;
      if (a.stubs.length) js += "\n" + a.stubs.map((f) => `function ${f}(){}`).join("\n") + "\n";
    }
    js = stripJs(js);
    /* 示範資料集的圖片相對路徑（去背／情境／生成圖／模組主圖包／舊示範主圖）：引擎開機會先用示範資料畫一輪再換成活動資料，
       這一輪會去抓這些不存在的相對路徑（ZIP 匯出至今也一直如此，只是 404 沒人看見）。字面值一律換成空字串＝不發請求；
       hero-bg 與 editor-grid-tile 不動（前者走背景地圖 data URI、後者由 CSS url() 內嵌）。 */
    { let n = 0; js = js.replace(/(["'])(?!https?:|data:|\/|\$\{|assets\/hero-bg\/|assets\/editor-grid-tile\.png)[A-Za-z0-9_\-./一-鿿 ()]*\.(?:png|jpe?g|webp|gif|svg)\1|(["'])assets\/(?:cutouts|scene-cutouts|generated|Theme-img-1)\/[^"']*\2/g, (m) => { n++; return '""'; }); report.neutralizedDemoAssetLiterals = n; }
    if (altConsts.length) { const r = nullDataConsts(js, (n) => altConsts.includes(n)); js = r.js; report.nulledConsts = r.nulled; }
    if (prune.otherLayouts) { const r = stubFunctionsByName(js, otherLayoutFnPredicate(layout, skeletons0)); js = r.js; report.stubbedOtherLayoutFns = r.stubbed; report.kinLayouts = kinLayouts(layout, skeletons0); }
    if (prune.legacyKv) { const r = stubFunctionsByName(js, (n) => LEGACY_KV_FN.test(n)); js = r.js; report.stubbedLegacyFns = r.stubbed; }
  }
  html = html.replace(main[0], "<script>" + js + "</script>");
  step(slim ? "引擎剝自測／提案包／示範集／他款版型／舊殼＋註解" : "引擎原樣");

  /* 8.2 head 的色彩工具嵌入態 script＋style（只服務 ?r=colortool）；其餘 head 小 script 剝註解 */
  if (slim) {
    html = html.replace(/<script>\/\* 色彩工具嵌入態[\s\S]*?<\/script>\s*<style>html\.colortool-boot[^<]*<\/style>\s*/, "");
    html = html.replace(/<script(?![^>]*\bsrc=)([^>]*)>([\s\S]*?)<\/script>/g, (all, at, body) => (body === js ? all : `<script${at}>${stripJs(body)}</script>`));
    step("head 小腳本剝註解");
  }

  /* 8.3 版型收斂：舞台 DOM 只留這款；所有 <style> 依版型／骨架取捨＋剝註解 */
  const skeletons = skeletons0;
  if (slim) {
    const rs = removeUnusedStages(html, layout, skeletons); html = rs.html; report.removedStages = rs.removed;
    const keep = layoutRuleKeeper(layout, skeletons);
    html = html.replace(/<style([^>]*)>([\s\S]*?)<\/style>/g, (all, at, body) => `<style${at}>${stripCss(filterCss(body, keep))}</style>`);
    step("版型收斂（舞台 DOM＋CSS 只留這款）");
  }

  /* 8.4 鷹架留殼去肉 */
  if (slim) { const s = shrinkScaffold(html, js); html = s.html; report.stubIds = s.stubIds; step("鷹架留殼去肉"); }

  /* 8.5 外部三件內嵌：tokens.css → <style id="tokensV2">；typestyles → <style id="typestylesV2">；costume-engine → <script id="costumeEngineJs">
        （引擎自己用這三個 id 判斷「已在頁上就不外載」——不用改真源、不用 stub setUrlStatus） */
  const tokensCss = slim ? stripCss(deps.tokensCss) : deps.tokensCss;
  if (!/<link id="tokensV2"[^>]*>/.test(html)) throw new Error("模板找不到 <link id=\"tokensV2\">（錨點漂移）");
  html = html.replace(/<link id="tokensV2"[^>]*>/, `<style id="tokensV2">${tokensCss}</style>`);
  const usedStyle = resolveTitleStyle(pg);
  let tsCss = deps.typestylesCss, tsInfo = null;
  if (slim) { const t = filterTypestyles(deps.typestylesCss, usedStyle); tsCss = stripCss(t.css); tsInfo = { usedStyle, families: t.families, imports: t.imports }; }
  report.typestyles = tsInfo || { usedStyle, full: true };
  let inlineHead = `<style id="typestylesV2">${tsCss}</style>`;
  const needCostume = pg.titleStyleThemed === true && !!usedStyle;
  if (needCostume || !slim) inlineHead += `<script id="costumeEngineJs">${slim ? stripJs(deps.costumeJs) : deps.costumeJs}</script>`;
  report.costumeInlined = needCostume || !slim;

  /* 8.5b 設計師配色變數的頁面專屬樣式（2026-09-27 使用者裁「甲」）：AEM 工程師的瘦身工具（bake.py）會刪光 <script>、再用一份寫死的清單重組
        <body style>——不在清單裡的 --campaign-* 變數（例：折數三支）就消失，而 body 的 cc-* class 與覆寫規則留著＝var() 沒值→繼承色／透明
        （2026-09-27 實烤證實）。所以草稿真的有給的槽，另以 <style id="campaignVarsV2">body.shell-v2{…}</style> 送上：他的工具只刪 tokensV2 那塊、其餘
        走修剪，body.shell-v2 不會被修剪名單命中；他清單裡有的變數他的行內優先（不動他的語意），缺的由這裡補。頁面專屬 css inline＝他 2-4 指引允許。 */
  const ccMap = ccVarMapFromTemplate(template);
  const cv = campaignVarsStyle(draft, ccMap);
  if (cv.css) inlineHead += cv.css;
  report.campaignVars = { slots: cv.keys, vars: cv.keys.map((k) => ccMap[k]) };
  if (cv.keys.some((k) => /^discount/.test(k))) report.warnings.push("這檔用了折數色（活動標題折扣數字／圓章）——AEM 瘦身工具目前不帶這三支變數，匯出檔已用頁面專屬樣式補上；若上線後折數仍是板值橘色＝工具改了流程，請工程師把 --campaign-discount／--campaign-discount-badge／--campaign-discount-badge-text 加進 body_style 名單");

  /* 8.6 背景地圖：只留這頁會用到的條目（檔明選＋版型預設），檔案路徑改 data URI；__BG_DEFAULTS__ 只留這款版型。
        對外絆線：待審背景（pendingLicense／pending- 訪客號）＝63 號「內網展示限定」，AEM 是消費者終點＝紅燈停止。 */
  const allMap = extractAssigned(deps.bgMapJs, "__BG_MAP__") || {};
  const allDefaults = extractAssigned(deps.bgMapJs, "__BG_DEFAULTS__") || {};
  const effectiveBg = pg.backgroundId || allDefaults[layout] || deps.defaultBackground || null;
  const effEnt = effectiveBg ? allMap[effectiveBg] : null;
  { const hold = require("./hero_bg_license").exportHoldReason(pg, opts.holdOpts || {}); if (hold) throw new Error(hold); } /* 你上傳的背景（78 號→2026-09-29 牆）：有相符版權確認才出 AEM；藏標題已放行。句子與 ZIP 路同一句；路由層先擋、這裡雙保險 */
  if (effectiveBg && (/^pending-/.test(effectiveBg) || (effEnt && effEnt.pendingLicense))) throw new Error(`這檔活動的背景「${effectiveBg}」版權還在審核中（只能內網展示），不能匯出到對外的 AEM——請先換成已過票的背景，或等審核通過`);
  if (effectiveBg && !effEnt && !(effectiveBg === "own" && pg.heroBgOwn)) report.warnings.push(`背景「${effectiveBg}」不在背景地圖裡（引擎會照版式預設畫）`); /* own 不進地圖＝引擎執行時自己合成條目（78 號），不是漏登記 */

  /* 8.6b 你上傳的背景：圖住 runs/<id>/hero-bg/、不進背景地圖——嵌檔時逐格轉 data URI（路徑規則單一立法＝hero_bg_own.resolveOwnFileMap；
        引擎對 data: 網址不接 ?v= 指紋，2026-09-29 同批修）。放行到這裡＝版權確認已相符（上面那道）；
        opts.runDir 沒給而圖還是路徑型＝紅燈停止——2026-09-29 病例：靜默交付沒背景的檔比擋住更糟。 */
  let pgOut = pg;
  if (pg.backgroundId === "own" && pg.heroBgOwn && pg.heroBgOwn.files) {
    const ownLib = require("./hero_bg_own");
    const stillPath = Object.values(pg.heroBgOwn.files).some((v) => !/^data:/.test(String(v)));
    if (stillPath) {
      if (!opts.runDir) throw new Error("這檔用了你上傳的背景，但組裝時沒拿到活動資料夾位置——不做沒有背景的檔，請再試一次；連續失敗請聯絡系統管理員（技術：assembleAemHtml 缺 opts.runDir）");
      const fmap = ownLib.resolveOwnFileMap(pg, opts.runDir);
      const files = { ...pg.heroBgOwn.files };
      let ownBytes = 0;
      for (const [slot, ent] of Object.entries(fmap)) { const uri = ownLib.ownFileDataUri(ent); ownBytes += Buffer.byteLength(uri); files[slot] = uri; }
      pgOut = { ...pg, heroBgOwn: { ...pg.heroBgOwn, files } };
      report.ownBgInlined = { slots: Object.keys(fmap), bytes: ownBytes };
    }
  }
  const bgIds = [...new Set([pg.backgroundId, allDefaults[layout], deps.defaultBackground].filter(Boolean))];
  const bm = shrinkBgMap(deps.bgMapJs, bgIds, [layout]); // full 參照版也只帶這頁的背景：對板要證明的是「程式瘦身無損」，不是搬 63 張圖
  for (const [id, ent] of Object.entries(bm.map)) {
    if (ent.file) { const r = await inlineFile(deps.templateDir, ent.file, report, `背景 ${id}`); if (r) ent.file = r; }
    if (ent.deviceFiles) for (const k of Object.keys(ent.deviceFiles)) { const r = await inlineFile(deps.templateDir, ent.deviceFiles[k], report, `背景 ${id}@${k}`); if (r) ent.deviceFiles[k] = r; }
  }
  report.bgMap = { effective: effectiveBg, kept: Object.keys(bm.map), all: bm.all };
  if (!/<script src="assets\/hero-bg\/bg-map\.js"><\/script>/.test(html)) throw new Error("模板找不到 bg-map.js 外載（錨點漂移）");
  html = html.replace(/<script src="assets\/hero-bg\/bg-map\.js"><\/script>/, `<script>window.__BG_MAP__=${JSON.stringify(bm.map)};window.__BG_DEFAULTS__=${JSON.stringify(bm.defaults)};</script>` + inlineHead);
  step("tokens／字風／換妝／背景地圖內嵌");

  /* 8.7 其餘相對路徑素材：img src → data URI；CSS url("assets/…") → data URI；舊示範 hero 大圖只拿掉 src（元素留給引擎引用） */
  html = html.replace(/<img\b([^>]*?)\bsrc="assets\/lecreuset-hero-source\.jpg"/g, "<img$1"); // 舊殼示範主圖：layout-* 頁永不顯示、不下載
  for (const m of [...html.matchAll(/\b(src|href)="((?!https?:|data:|#|\/\/|mailto:|javascript:|\$\{)[^"]+)"/g)]) {
    const rel = m[2];
    if (/^\.\.\//.test(rel) || !fs.existsSync(path.join(deps.templateDir, rel))) { report.warnings.push(`相對路徑找不到檔案：${rel}`); continue; }
    if (!MIME[path.extname(rel).toLowerCase()]) continue; // 非圖片（如 .js/.css）由上面各步處理；殘留＝aem_verify 會抓
    const uri = await inlineFile(deps.templateDir, rel, report, rel);
    if (uri) html = html.split(`${m[1]}="${rel}"`).join(`${m[1]}="${uri}"`);
  }
  for (const m of [...new Set([...html.matchAll(/url\(["']?((?!https?:|data:|\$\{|#|%23)[^"')]+)["']?\)/g)].map((x) => x[1]))]) {
    if (!fs.existsSync(path.join(deps.templateDir, m))) { report.warnings.push(`CSS url() 找不到檔案：${m}`); continue; }
    const uri = await inlineFile(deps.templateDir, m, report, m);
    if (uri) html = html.replace(new RegExp(`url\\(["']?${m.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["']?\\)`, "g"), `url("${uri}")`);
  }
  step("素材內嵌");

  /* 8.8 標題、HTML 註解、裝置切換、啟動器 */
  const safeTitle = String(pg.pageName || draft.id || "活動頁").replace(/[<>&]/g, "");
  html = html.replace(/<title>[\s\S]*?<\/title>/, `<title>${safeTitle}</title>`);
  if (slim) html = html.replace(/<!--(?!\[if)[\s\S]*?-->/g, "");
  /* 開機遮罩（2026-09-10 使用者開檔看到「舊版設計預覽」）：引擎開機會先用內建 Le Creuset 示範資料畫一輪、0.7～0.9 秒後才換成活動資料；
     沒跑 JavaScript 的環境（Finder 空白鍵預覽、被擋 script 的平台）會永遠停在那一輪。做法＝head 一開始就掛 aem-boot 把 body 藏住、
     啟動器套上資料才掀；套不上＝紅色橫幅同時掀（不留黑箱）；完全沒 JS＝<noscript> 白話說明取代示範畫面。 */
  /* 遮罩 class 必須「寫死在 <html> 上、由 JS 拿掉」——反過來用 JS 加上去的話，沒 JS 的環境加不上、示範畫面照樣露出（CP-32 無 JS 檢查 2026-09-10 抓到） */
  if (!/<html\b/.test(html)) throw new Error("模板缺 <html> 標籤");
  html = html.replace(/<html\b([^>]*)>/, (m, at) => (/\bclass="/.test(at) ? `<html${at.replace(/\bclass="/, 'class="aem-boot ')}>` : `<html${at} class="aem-boot">`));
  html = html.replace(/<head>/, "<head>" + DEVICE_INLINE_SCRIPT + `<style>html.aem-boot body>*{visibility:hidden}html.aem-boot body::after{content:"活動頁載入中…";position:fixed;inset:0;display:flex;align-items:center;justify-content:center;background:#fff;color:#5B636A;font:600 15px/1.6 "PingFang TC","Noto Sans TC",sans-serif;z-index:9999;visibility:visible}</style><noscript><style>html.aem-boot body>*{visibility:hidden}html.aem-boot body::after{content:"這個活動頁需要開啟 JavaScript 才能顯示（預覽視窗看不到內容，請用瀏覽器開啟）"}</style></noscript>`);
  /* 第 1 層（75 號 R-5／R-6／R-7）：頁級參數寫死在 <head>（值匯出當下已定、不靠 JS 跑成功）＋GTM 容器（開關＝tracking_plan.gaConfig；AEM 第②題回覆後切）。
     只有 AEM 匯出版有這段——內網預覽版同模板但不注入（掃描機會自己推同一份頁級參數到 dataLayer 供對帳，沒有 GTM＝不外送）。 */
  const gaCfg = (opts && opts.ga) || TRACKING.gaConfig();
  html = html.replace(/<head>/, "<head>" + TRACKING.gaHeadScript(draft, gaCfg));
  report.tracking = TRACKING.trackingPlan(draft, gaCfg);
  const bodyEnd = html.lastIndexOf("</body>"); if (bodyEnd < 0) throw new Error("模板缺 </body>");
  /* 出貨資料只帶引擎會讀的：page／products／assets；meta 只留引擎讀的兩格（proposalPack.deviated＋pack.colors）——
     其餘＝設計師內部筆記、提案包紀錄、來源 URL，不該出現在消費者頁的原始碼裡；另補一格 aemExport（建置時間＋活動編號＝真值時效可追） */
  const pp = (draft.meta && draft.meta.proposalPack) || null;
  const meta = { generatedAt: draft.meta && draft.meta.generatedAt, aemExport: { at: new Date().toISOString(), runId: draft.id || (draft.page && draft.page.id) || null, mode },
    ...(pp ? { proposalPack: { deviated: pp.deviated === true, pack: pp.pack ? { colors: pp.pack.colors } : undefined } } : {}) };
  const draftJson = JSON.stringify({ page: pgOut, products: draft.products, assets: draft.assets, meta }); /* pgOut＝own 圖已轉 data URI 的 page（8.6b）；非 own 頁＝原 page 同一參考、零差異 */
  html = html.slice(0, bodyEnd) + `<style>#exp-panel,#preview-watermark,#draft-badge,#draft-drop-overlay,#device-preview-overlay,#selftest-results,.ep-head,.ep-body{display:none!important}</style>\n` + launcherScript(draftJson) + "\n" + html.slice(bodyEnd);
  if (slim) html = html.replace(/\n{2,}/g, "\n").replace(/^[ \t]+</gm, "<");
  step("標題／註解／啟動器");

  report.bytes = size(html); report.draftBytes = size(draftJson);
  /* AEM 頁面編輯器的尺（2026-09-17 工程師瘦身工具截圖首次露面：「URL encode 90528／上限 131072」）——量的是網址編碎後的字數、不是 bytes。
     現行單檔版一定超標（引擎本體就 66%），本步只量、寫進報告與警告，不擋：擋法＝靜態化匯出器上線後的硬閘（story aem-static-export.md Q8）。 */
  report.aemBudget = measureAemBudget(html);
  if (!report.aemBudget.fits) report.warnings.push(`編碎後長度 ${report.aemBudget.encoded}＝AEM 頁面編輯上限 ${AEM_ENCODED_CAP} 的 ${report.aemBudget.ratio} 倍（現行單檔版需經瘦身才能貼進 AEM 頁面）`);
  return { html, report };
}

/* ───────────────────────── 10. AEM 頁面編輯上限的尺 ───────────────────────── */
/** AEM 頁面編輯器能吃的上限：encodeURIComponent 後的字元數（2026-09-17 實測來源＝AEM 工程窗口的瘦身工具）。 */
const AEM_ENCODED_CAP = 131072;
/** 量一份 HTML 對 AEM 上限的距離。中文一字算 9、`<>"=/ ` 等一字算 3、安全英數一字算 1；整體約 1.46×。 */
function measureAemBudget(html, cap = AEM_ENCODED_CAP) {
  const encoded = encodeURIComponent(String(html)).length;
  return { encoded, cap, remaining: cap - encoded, ratio: Math.round((encoded / cap) * 100) / 100, fits: encoded <= cap, bytes: Buffer.byteLength(String(html)) };
}
async function inlineFile(baseDir, rel, report, label) {
  const abs = path.join(baseDir, rel);
  if (!fs.existsSync(abs)) { report.warnings.push(`素材找不到：${rel}`); return null; }
  const r = await assetToDataUri(abs);
  report.assets.push({ label, rel, from: r.from, to: r.to, kind: r.kind });
  return r.uri;
}

/* ── 設計師配色變數（8.5b）──
   「哪個槽對哪支變數」不另抄一份：從模板 applyThemeDraftColors 的 set("--campaign-x", hex(cc.y)) 讀出來＝引擎改一處、這裡自動跟（鐵律 4）。 */
function ccVarMapFromTemplate(template) {
  const map = {}; const re = /set\("(--campaign-[a-z0-9-]+)", hex\(cc\.([A-Za-z0-9_]+)\)\)/g; let m;
  while ((m = re.exec(String(template || "")))) map[m[2]] = m[1];
  if (!Object.keys(map).length) throw new Error("模板找不到 applyThemeDraftColors 的 set(\"--campaign-*\", hex(cc.*)) 對應（錨點漂移）——設計師配色變數樣式組不出來");
  return map;
}
/** 來源優先序同引擎 applyThemeDraftColors：page.colors.themeDraft ＞（未偏離時）meta.proposalPack.pack.colors；沒有＝空字串（零波及）。 */
function campaignVarsStyle(draft, map) {
  const pg = (draft && draft.page) || {}; const meta = (draft && draft.meta) || {};
  let td = pg.colors && typeof pg.colors === "object" ? pg.colors.themeDraft : null;
  if (!td && meta.proposalPack && meta.proposalPack.deviated !== true && meta.proposalPack.pack) td = meta.proposalPack.pack.colors;
  const cc = td && typeof td === "object" && td.componentColors && typeof td.componentColors === "object" ? td.componentColors : null;
  if (!cc) return { css: "", keys: [] };
  const hex = (v) => /^#?[0-9a-fA-F]{6}$/.test(String(v || "").replace("#", "")) ? (String(v).startsWith("#") ? v : "#" + v) : null;
  const decls = [], keys = [];
  for (const [slot, variable] of Object.entries(map)) { const v = hex(cc[slot]); if (v) { decls.push(`${variable}:${v}`); keys.push(slot); } }
  return { css: decls.length ? `<style id="campaignVarsV2">body.shell-v2{${decls.join(";")}}</style>` : "", keys };
}

/** 讀齊 deps（真源路徑照 sync.sh：tokens／typestyles／costume-engine 在專案根；bg-map 在規劃/assets/hero-bg）。 */
function loadDeps({ frameDir, projectRoot, defaultBackground }) {
  const read = (p) => { if (!fs.existsSync(p)) throw new Error(`匯出相依檔缺席：${p}`); return fs.readFileSync(p, "utf8"); };
  return {
    templateDir: frameDir,
    tokensCss: read(path.join(projectRoot, "design-tokens", "tokens.css")),
    typestylesCss: read(path.join(projectRoot, "design-assets", "typestyles", "typestyles.css")),
    costumeJs: read(path.join(projectRoot, "design-assets", "typestyles", "costume-engine.js")),
    bgMapJs: read(path.join(frameDir, "assets", "hero-bg", "bg-map.js")),
    defaultBackground: defaultBackground || null,
  };
}

module.exports = { stripJs, stripCss, parseCssRules, serializeCssRules, filterCss, splitSelectorList, selectorListKeeper, kinLayouts, stageSkeletons, layoutRuleKeeper, removeDivById, removeUnusedStages, shrinkScaffold, dropJsRegions, auditDroppedSymbols, jsBlockEnd, stubFunctionsByName, nullDataConsts, otherLayoutFnPredicate, LEGACY_KV_FN, NEVER_STUB, resolveTitleStyle, filterTypestyles, shrinkBgMap, extractAssigned, assetToDataUri, assembleAemHtml, loadDeps, launcherScript, DEVICE_INLINE_SCRIPT, AEM_ENCODED_CAP, measureAemBudget, ccVarMapFromTemplate, campaignVarsStyle };
