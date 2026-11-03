"use strict";
/**
 * lib/brief_selection.js —— 策略檔指導選品（71 號方案 A 階段二；2026-09-14 使用者裁「依建議開工」）
 *
 * 它做什麼（一句話）
 * ----------------------------------------------------------------
 * 把商品池「重新排一次順序」，讓機械選品引擎照原本的切法（KV 拿前 3、每層依序切 4 件）
 * 切出來的東西，正好是策略檔說的：「避開」的整頁不在、「多放」的排最前、每一層底下是那一層「放什麼」寫的字。
 *
 * 為什麼是「重排順序」不是「另寫一條分配法」
 * ----------------------------------------------------------------
 * curate_auto.js 的切法帶著件數契約（KV3／層 4／牆 4 的倍數／編輯精選圓 2＋牆 4）與讓位序（KV＞層＞牆），
 * 那是 04 號一路裁下來的骨幹，動它＝動 money-facing 主路徑。這裡只交出一個排好的池，切法一行不改——
 * 沒帶策略檔時連這支檔都不會被呼叫，舊行為逐位元組不變。
 *
 * 兩種「字對不對得上」，刻意不同，各有理由（鐵律 4 同類幾處：同檔並列、講清楚為什麼不一樣）
 * ----------------------------------------------------------------
 * - 挑選（本檔）＝**整個詞**比對商品名：同事寫「瓦斯爐」就是要瓦斯爐。切成兩字詞會把「烤肉夾」變成「烤肉」「肉夾」，
 *   三層全對到「烤肉」就分不開了。
 * - 頁級「對不對得上」（curation_brief.js briefFit）＝兩字詞，沿 CP-14 主題契合閘同一把刀（寬鬆是它的本意）。
 * 兩者共用的只有「名字含不含這個字」這一句（nameHits），不共用切法。
 *
 * 使用者裁決（2026-09-14，牆 qa/cms-brief-selection-wall-2026-09-14.html）
 * ----------------------------------------------------------------
 * 1 乙：「放什麼」寫商品字、同時當副標——本檔只讀字，副標由 applyBriefToDraft 照落。
 * 2 乙：「優先」這一行拿掉；排序一律折數深的先（商品資料沒有銷量／評價／上架時間可照做）。寫了＝出聲不生效。
 * 4 甲：「避開」排掉再多都照排、大聲講；池不夠的守門在 curate_auto 既有那道，不在這裡放回去。
 * 零命中一律出聲：避開／多放／每層的字若一件都沒對到，講「這幾個字沒出現在商品名裡」並教他寫什麼字。
 */

/* 同事寫的字怎麼切成一個一個詞：頓號、逗號、斜線、空白都當分隔；去頭尾空白；去重；空的丟掉。
   大小寫在比對時才抹平（顯示還是他寫的字）。 */
function splitWords(text) {
  const out = [];
  const seen = new Set();
  for (const raw of String(text == null ? "" : text).split(/[、，,／/;；\s]+/)) {
    const w = raw.trim();
    if (!w) continue;
    const k = w.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(w);
  }
  return out;
}

/* 「名字含不含這幾個字之一」——挑選與頁級 fit 共用的唯一一句 */
function nameHits(name, words) {
  if (!words || !words.length) return false;
  const n = String(name == null ? "" : name).toLowerCase();
  return words.some((w) => w && n.includes(String(w).toLowerCase()));
}

const nameOf = (p) => (p && p.name) || "";

/**
 * 把池重排成「策略檔說的順序」。
 * @param {object[]} pool  已去重、已照折數排好的商品（curate_auto 交來；本函式不改排序依據、只做分群搬位）
 * @param {object} brief   parseBrief().data：{ floors:[{title,hint}], selection:{include,exclude,priority} }
 * @param {object} opts    { kvCount=3, floorSize=4, floorMax=3 }＝與 curate_auto 的切法同數（呼叫端傳，不在這裡寫死第二份）
 * @returns {{ pool: object[], report: object }}
 *   pool   ＝重排後的池（避開的已拿掉；其餘一件不少、一件不多、不重複）
 *   report ＝給畫面講人話用的帳：exclude／include／priority／floors[]
 */
function applySelection(pool, brief, opts) {
  const o = opts || {};
  const kvCount = Number.isInteger(o.kvCount) ? o.kvCount : 3;
  const floorSize = Number.isInteger(o.floorSize) ? o.floorSize : 4;
  const floorMax = Number.isInteger(o.floorMax) ? o.floorMax : 3;
  const b = brief || {};
  const sel = b.selection || {};
  const src = Array.isArray(pool) ? pool.slice() : [];
  const report = { exclude: null, include: null, priority: null, kv: null, floors: [] };

  /* ① 避開：整頁不放。排掉再多都照排（裁 4 甲）——池不夠的聲音由 curate_auto 既有守門發。 */
  const exWords = splitWords(sel.exclude);
  let cur = src;
  if (exWords.length) {
    const kept = [], removed = [];
    for (const p of cur) (nameHits(nameOf(p), exWords) ? removed : kept).push(p);
    report.exclude = { words: exWords, before: cur.length, removed: removed.length, after: kept.length, zeroHit: removed.length === 0 };
    cur = kept;
  }

  /* ② 多放：名字含這些字的排最前（穩定分群，群內維持原本的折數順序）。 */
  const inWords = splitWords(sel.include);
  if (inWords.length) {
    const hit = [], rest = [];
    for (const p of cur) (nameHits(nameOf(p), inWords) ? hit : rest).push(p);
    report.include = { words: inWords, boosted: hit.length, zeroHit: hit.length === 0 };
    cur = hit.concat(rest);
  }

  /* ③ 優先：裁 2 乙＝拿掉。寫了不生效，但要讓他知道（不靜默）。 */
  const pr = String(sel.priority == null ? "" : sel.priority).trim();
  if (pr) report.priority = { text: pr, ignored: true };

  /* ④ KV 主打先拿（讓位序 KV＞層＞牆，數字由呼叫端給）；剩下的才輪到樓層挑。
     2026-09-24 使用者裁「文案跟商品要對得起來」（病例 run 174314：主打三件全是箱購紙尿褲，第一層寫的卻是紙類）——以前主打＝池頂前 N、跟每一層寫的字無關。現在兩條規矩：
       a. 不偷樓層要的：某一層寫的字對到的商品剛好夠或不夠那一層用（≤ 層件數），主打不拿它們；
       b. 有餘量的層各出一件代表（依層序輪流、拿到那層剩得剛好夠為止），主打先放這些；還不夠再從池頂補（多放已排最前＝補的也是多放的）；
          連池頂都被保護光了（池很小）才不得已拿保護的，層的帳會如實講補了幾件。
     一層字都沒寫＝照舊池頂前 N（舊行為逐位元組不變）。帳寫 report.kv＝{ fromFloors, matched, filled, protectedCount }。
     容量判定與 curate_auto 同一條：第 i 層存在＝KV＋前 i+1 層都放得下；放不下的層不算帳（applyBriefToDraft 會講「活動只有 M 層」）。 */
  const floors = Array.isArray(b.floors) ? b.floors.slice(0, floorMax) : [];
  const floorWords = floors.map((f) => splitWords(f && f.hint));
  let kv, afterKv;
  if (floorWords.some((w) => w.length)) {
    const matchedPer = floorWords.map((w) => (w.length ? cur.filter((p) => nameHits(nameOf(p), w)) : []));
    const surplus = floorWords.map((w, i) => w.length > 0 && matchedPer[i].length > floorSize);
    const protectedSet = new Set();
    matchedPer.forEach((m, i) => { if (floorWords[i].length && !surplus[i]) m.forEach((p) => protectedSet.add(p)); });
    const taken = new Set(); kv = []; const from = [];
    let progressed = true;
    while (kv.length < kvCount && progressed) {
      progressed = false;
      for (let i = 0; i < floorWords.length && kv.length < kvCount; i++) {
        if (!surplus[i]) continue;
        const left = matchedPer[i].filter((x) => !taken.has(x) && !protectedSet.has(x));
        if (left.length <= floorSize) continue; // 再拿就會讓這層不夠用＝停
        taken.add(left[0]); kv.push(left[0]); from.push(i); progressed = true;
      }
    }
    for (const p of cur) { if (kv.length >= kvCount) break; if (!taken.has(p) && !protectedSet.has(p)) { taken.add(p); kv.push(p); from.push(null); } }
    for (const p of cur) { if (kv.length >= kvCount) break; if (!taken.has(p)) { taken.add(p); kv.push(p); from.push(null); } }
    report.kv = { fromFloors: from, matched: from.filter((x) => x != null).length, filled: from.filter((x) => x == null).length, protectedCount: protectedSet.size };
    afterKv = cur.filter((p) => !taken.has(p));
  } else {
    kv = cur.slice(0, kvCount); afterKv = cur.slice(kvCount); report.kv = null;
  }
  let nFloors = 0;
  while (nFloors < floors.length && kvCount + floorSize * (nFloors + 1) <= cur.length) nFloors++;
  const picked = pickGroups(afterKv, floors.slice(0, nFloors), Array(nFloors).fill(floorSize));
  const floorsOut = picked.groups;
  const remaining = picked.rest;
  report.floors = picked.report;

  const ordered = kv.concat(...floorsOut, remaining);
  return { pool: ordered, report };
}

/* 通用「照字挑進幾組」（2026-09-14 下午使用者反饋：牆也要照字挑——「醬料與調味」底下不能是計時器）：
   groups＝[{title, hint}]（hint＝放什麼）、sizes＝每一組要幾件（由呼叫端算好交來：樓層固定 4、牆 4/8/12 看餘量）。
   對到的排前面（第 1 件＝情境卡代表品或牆首件）；不夠從剩下補，補的先拿後面幾組都沒點名的（不偷下一組要的）；
   沒寫字的組＝照順序拿。回 { groups, rest, report }——report 每組 {title, words, machine, matched, filled, zeroHit}。 */
function pickGroups(remaining, groups, sizes) {
  let rest = Array.isArray(remaining) ? remaining.slice() : [];
  const out = [], report = [];
  const gs = Array.isArray(groups) ? groups : [];
  for (let i = 0; i < sizes.length; i++) {
    const size = sizes[i];
    const g = gs[i] || {};
    const words = splitWords(g.hint);
    if (!words.length) {
      const items = rest.slice(0, size); rest = rest.slice(size);
      out.push(items); report.push({ title: g.title || "", words: [], machine: true, matched: 0, filled: items.length });
      continue;
    }
    const matched = [], others = [];
    for (const p of rest) (nameHits(nameOf(p), words) ? matched : others).push(p);
    const take = matched.slice(0, size);
    const laterWords = gs.slice(i + 1).flatMap((h) => splitWords(h && h.hint));
    const neutral = [], wantedLater = [];
    for (const p of others) (laterWords.length && nameHits(nameOf(p), laterWords) ? wantedLater : neutral).push(p);
    const fill = neutral.concat(wantedLater).slice(0, size - take.length);
    const items = take.concat(fill);
    const used = new Set(items);
    rest = rest.filter((p) => !used.has(p));
    out.push(items);
    report.push({ title: g.title || "", words, machine: false, matched: take.length, filled: fill.length, zeroHit: take.length === 0 });
  }
  return { groups: out, rest, report };
}

/* 從一組商品名裡找「品類詞」（2026-09-24 使用者裁「對不到的層機器照商品自動補標題」）：
   給對不到的層／牆照底下實際商品補標題、給對帳卡「回 Gemini 這樣說」舉例（原本 brief_recon 自己算一份，搬來這裡＝一把尺）。
   做法＝去掉括號裡的規格 → 抓中文連續字 → 列出 2～6 字的所有片段 → 數「出現在幾件商品名」（不是出現幾次）。
   排序＝分數高的先：件數為主（每多一件 +1），「壓在一段連續中文尾端」為輔（每多一件尾端 +0.5），字長再輔（每字 +0.25）——
   中文商品名的品類名多半壓在一段的最後（「捲筒式廚房紙巾」→「廚房紙巾」），形容詞多半在前（「親膚舒適成人紙尿褲」的「親膚」）；
   只看件數會選到「親膚」（run 174314 替身重放實證），尾端加權後選到「成人紙尿褲」。同分＝字長的先。
   排進候選的字不再收它的子片段（「替換式尿片」進了，「換式尿片」就不進）。
   品牌不當品類：每件名字開頭那個詞若一半以上相同（包大人、毛寶）＝當品牌，它與它的片段都不進候選。
   opts.minShare＝至少要出現在幾成商品名（預設一半；整池找例子用 0）；opts.max＝回幾個（預設 3）。一個字都擷不出＝回 []（呼叫端維持機器預設）。 */
function categoryWords(names, opts) {
  const o = opts || {};
  const list = (Array.isArray(names) ? names : []).map((n) => String(n == null ? "" : n)).filter((n) => n.trim());
  if (!list.length) return [];
  const minShare = Number.isFinite(o.minShare) ? o.minShare : 0.5;
  const max = Number.isInteger(o.max) ? o.max : 3;
  const strip = (s) => s.replace(/【[^】]*】|\[[^\]]*\]|\([^)]*\)|（[^）]*）/g, " ");
  const CJK_RUN = /[㐀-䶿一-鿿]+/g;
  const heads = list.map((n) => (strip(n).trim().split(/[\s\-_/,，、|｜:：+×*·．.]+/)[0] || ""));
  const headCount = new Map(); heads.forEach((h) => { if (h) headCount.set(h, (headCount.get(h) || 0) + 1); });
  const brands = [...headCount.entries()].filter(([, c]) => c * 2 >= list.length).map(([h]) => h);
  const isBrandPiece = (w) => brands.some((b) => b.includes(w));
  const df = new Map(), tail = new Map();
  for (const n of list) {
    const seen = new Set();
    for (const run of strip(n).match(CJK_RUN) || []) {
      const chars = [...run];
      for (let len = 2; len <= 6 && len <= chars.length; len++) {
        for (let i = 0; i + len <= chars.length; i++) {
          const w = chars.slice(i, i + len).join("");
          if (seen.has(w)) continue;
          seen.add(w);
          df.set(w, (df.get(w) || 0) + 1);
          if (i + len === chars.length) tail.set(w, (tail.get(w) || 0) + 1);
        }
      }
    }
  }
  const need = Math.max(1, Math.ceil(list.length * minShare));
  const score = (w, c) => c + 0.5 * (tail.get(w) || 0) + 0.25 * [...w].length;
  const ranked = [...df.entries()]
    .filter(([w, c]) => c >= need && !isBrandPiece(w))
    .sort((a, b) => score(b[0], b[1]) - score(a[0], a[1]) || [...b[0]].length - [...a[0]].length || a[0].localeCompare(b[0]))
    .map(([w]) => w);
  const out = [];
  for (const w of ranked) {
    if (out.length >= max) break;
    if (out.some((k) => k.includes(w) || w.includes(k))) continue; // 子片段／父片段不重複收
    out.push(w);
  }
  return out;
}

/* 把帳折成畫面上的人話（文案＝2026-09-14 使用者過目版，牆第 5 題②③④；零命中改句＝2026-09-24 使用者裁「機器照商品補標題」）。
   只在該出聲的時候出：沒補齊的層不囉嗦、有對到字的方向不囉嗦。回傳形狀沿 meta.brief.notices＝{section, say, how}。
   f.autoTitle／w.autoTitle＝applyBriefToDraft 補完標題後掛回帳上的字；沒有（擷不出品類詞）＝照舊講「先用系統預設」。 */
function selectionNotices(report) {
  const out = [];
  if (!report || typeof report !== "object") return out;
  const q = (s) => `「${s}」`;
  const ex = report.exclude;
  if (ex && ex.words && ex.words.length) {
    if (ex.zeroHit) {
      out.push({ section: "選品方向", say: `${q("避開：" + ex.words.join("、"))}沒有排掉任何商品——這幾個字沒出現在商品名裡。`, how: "想排掉哪一類，寫商品名會出現的字（例：洋裝、裙）。" });
    } else if (ex.after < 24) {
      /* 24＝一頁最低契約件數（KV3＋層 3×4＋牆 3×4），與 curate_auto 池量守門同一個數字的白話版；排掉再多都照排（裁 4 甲） */
      out.push({ section: "選品方向", say: `你避開的字排掉了 ${ex.removed}/${ex.before} 件，剩 ${ex.after} 件不夠排一頁。`, how: "換一個來源，或把避開的字改小。" });
    }
  }
  const inc = report.include;
  if (inc && inc.words && inc.words.length && inc.zeroHit) {
    out.push({ section: "選品方向", say: `${q("多放：" + inc.words.join("、"))}沒有讓任何商品排前面——這幾個字沒出現在商品名裡。`, how: "寫商品名會出現的字（例：瓦斯爐、烤盤）。" });
  }
  /* 「優先」不生效那句住 parseBrief（格式層知道這行退場了），不在這裡再講一次——AI 策展路沒有這份帳也要聽得到 */
  for (const f of report.floors || []) {
    if (!f || f.machine || !f.filled) continue;
    const t = f.title ? q(f.title) : "這一層";
    /* 一件都沒對到＝人寫的標題與小標籤不掛（applyBriefToDraft 跳過），這裡要把「為什麼你的標題沒出現」講清楚（2026-09-14 使用者實走：收尾清潔底下一排計時器） */
    out.push(f.zeroHit
      ? (f.autoTitle
        ? { section: "分幾層、各層講什麼", say: `${t}這層照你寫的${q(f.words.join("、"))}一件都沒找到——這批商品裡沒有這類；標題先照底下實際商品改成${q(f.autoTitle)}（系統照商品補的，樓層那格旁邊可以一鍵換），底下 ${f.filled} 件是機器補的。`, how: "想放你原本寫的那類商品，換一個有它的來源再建一次。" }
        : { section: "分幾層、各層講什麼", say: `${t}這層照你寫的${q(f.words.join("、"))}一件都沒找到——標題與小標籤先用系統預設，底下 ${f.filled} 件是機器補的。`, how: "這幾個字沒出現在商品名裡，改成這批商品的品類名（例：瓦斯爐、計時器）再建一次，標題就會掛上去。" })
      : { section: "分幾層、各層講什麼", say: `${t}這層照你寫的${q(f.words.join("、"))}只找到 ${f.matched} 件，另外 ${f.filled} 件是機器補的——標題底下可能有對不上的商品，交付前看一眼。`, how: "" });
  }
  for (const w of report.walls || []) {
    if (!w || w.machine || !w.filled) continue;
    const t = w.title ? q(w.title) : "這一面牆";
    out.push(w.zeroHit
      ? (w.autoTitle
        ? { section: "三面牆的標題", say: `${t}這面牆照你寫的${q(w.words.join("、"))}一件都沒找到——這批商品裡沒有這類；標題先照底下實際商品改成${q(w.autoTitle)}（系統照商品補的，牆標題那格旁邊可以一鍵換）。`, how: "想放你原本寫的那類商品，換一個有它的來源再建一次。" }
        : { section: "三面牆的標題", say: `${t}這面牆照你寫的${q(w.words.join("、"))}一件都沒找到——標題先用系統預設，底下是機器照順序排的。`, how: "改成這批商品的品類名再建一次，標題就會掛上去。" })
      : { section: "三面牆的標題", say: `${t}這面牆照你寫的${q(w.words.join("、"))}只找到 ${w.matched} 件，另外 ${w.filled} 件是機器補的——交付前看一眼。`, how: "" });
  }
  return out;
}

module.exports = { splitWords, nameHits, applySelection, pickGroups, selectionNotices, categoryWords };
