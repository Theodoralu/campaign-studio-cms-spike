"use strict";
/**
 * tools/onoff_scan.js —— 可選件缺席掃描（內容 on/off 間距全掃；2026-08-31 立）
 *
 * 為什麼有這支：版型上有一堆「有填才出現」的零件——商品特色標膠囊、劃線價、副標、眉標、
 * 折扣數字⋯。排版如果偷偷靠某個可選件撐著，那個零件剛好沒填的時候版面就塌。
 * 病例＝2026-08-31 使用者報修：商品卡的品名疊上商品圖。真因是「特色標膠囊」負責把品名頂開，
 * 沒填膠囊時沒人頂＝品名掉進卡片裡。同款病的反面是「空洞」——位置留著但沒東西，字離圖太遠
 * （同日第一次修就是修成空洞、被使用者退回）。兩種都要抓。
 *
 * 怎麼抓：同一款版型渲染兩次再比對——
 *   FULL＝可選件全填（膠囊、劃線價、副標、眉標、折扣數字都給值）
 *   BARE＝可選件全空（只留主標與商品本體）
 * 對每個「在 FULL 有、在 BARE 消失」的零件 E，取它在 FULL 的前一個可見兄弟 A、後一個可見兄弟 B，
 * 比較 A 底→B 頂的距離：
 *   BARE < 0                 → 重疊（收過頭，字疊上去）
 *   BARE ≥ FULL − 2          → 空洞（沒收，位置留著卻沒東西）
 *   0 ≤ BARE < FULL − 2      → 正常（有收）
 * E 若是絕對定位（本來就不佔版面空間）＝無法自動判斷該不該收，列「需人判斷」附數字，不擅自判紅。
 *
 * 裁決登記（2026-10-10 加）：有些「沒收」是設計刻意的（例：霓虹夜市裁定主標位置不得隨零件有無而漂，
 * 空槽一律保留空間只藏內容）。這種情形不該永遠亮紅——永遠紅的燈等於沒有燈（67 號假閘）。
 * 做法不是消音，是**把裁決當期望值釘住**：spec 檔寫 onoffRulings[{el, full, bare, tol, ruledOn, why}]，
 * 實測吻合＝「已裁決」（綠、不計紅燈）；實測跟登記值對不上＝「裁決漂移」紅燈（有人動到了而且沒人知道）。
 *
 * 用法：node tools/onoff_scan.js [--layout=layout-002] [--devices=desktop,tablet,mobile] [--json]
 * 退出碼：有重疊或空洞＝1（可當守門），全乾淨＝0
 */
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright-core");

/* 實測 vs 裁決登記：吻合＝已裁決（綠）；對不上＝裁決漂移（紅，附該去問誰）。
   釘住的是「全填」與「全空」兩個數字——只釘全空會漏掉「兩邊一起漂」那種改壞法。 */
function verdictVsRuling(rl, label, dFull, dBare, nums, A, B) {
  const tol = typeof rl.tol === "number" ? rl.tol : 2;
  const okF = typeof rl.full !== "number" || Math.abs(dFull - rl.full) <= tol;
  const okB = typeof rl.bare !== "number" || Math.abs(dBare - rl.bare) <= tol;
  const ab = { A: A.cls || A.txt, B: B.cls || B.txt };
  if (okF && okB) return { level: "已裁決", msg: `「${label}」${rl.verdict || "維持"}（${rl.ruledOn || "?"} 裁）——${nums}，與登記值相符。理由：${rl.why || "（登記未填）"}`, ...ab };
  return { level: "裁決漂移", msg: `「${label}」登記值是 全填 ${rl.full}px → 全空 ${rl.bare}px（${rl.ruledOn || "?"} 裁），實測 ${nums}＝有人動到了。要嘛改回來，要嘛重新裁一次並更新 spec 的 onoffRulings`, ...ab };
}

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const SPEC_DIR = path.join(REPO_ROOT, "design-assets", "layouts", "spec");
const DEFAULT_FRAMETEST = path.join(REPO_ROOT, "2026-AI自動化活動頁生成規劃", "MVP_Phase1_LeCreuset_活動頁Prototype_FrameTest.html");
const DEVICE_PARAM = { desktop: null, tablet: "tablet", mobile: "mobile" };

const args = process.argv.slice(2);
const onlyLayout = (args.find((a) => a.startsWith("--layout=")) || "").split("=")[1];
const devArg = (args.find((a) => a.startsWith("--devices=")) || "").split("=")[1];
const DEVICES = devArg ? devArg.split(",").map((s) => s.trim()) : ["desktop", "tablet", "mobile"];
const asJson = args.includes("--json");
const verbose = args.includes("--verbose");/* 逐項印出比對過的每一對＝審計時看得到「比了什麼」，不只看到結論 */
const ftArg = (args.find((a) => a.startsWith("--frametest=")) || "").split("=")[1];
const FRAMETEST = ftArg ? path.resolve(ftArg) : DEFAULT_FRAMETEST;/* 指定別份 FrameTest＝拿舊版回歸驗證掃描器抓得到（不會叫的警報器等於沒有） */

/* 判定門檻：2px＝字型代換的次像素差（沿 spec_check 容差精神，比它嚴＝這裡量的是「有沒有收」不是「對不對板」） */
const TOL = 2;

/* 示意商品：FULL 帶特色標與劃線價，BARE 兩者都拿掉。名稱價格為顯性假值、僅檢核用不落檔（沿 spec_check 慣例）。 */
function demoProducts(n, full) {
  return Array.from({ length: n }, (_, i) => {
    const p = {
      gdid: String(900001 + i),
      name: `可選件檢核示意商品${i + 1}（非賣品）`,
      price: 100 * (i + 1),
      img: "assets/lecreuset-hero-source.jpg",
    };
    if (full) { p.tag = `示意標${i + 1}`; p.marketPrice = 100 * (i + 1) + 50; }
    return p;
  });
}

/* BARE 的 hero：文字槽只留第一行（主標），折扣數字整欄拿掉，商品槽照留（沒商品就整張卡不畫、比不出東西）。 */
function bareHero(heroFull) {
  const out = {};
  for (const [k, v] of Object.entries(heroFull || {})) {
    if (k === "discount-digit") continue;
    out[k] = typeof v === "string" ? String(v).split("\n")[0] : v;
  }
  return out;
}

/* 頁面內的快照器：把舞台底下每個元素記成「穩定鍵＋座標＋是否可見＋定位方式」。
   穩定鍵＝從舞台往下的結構路徑（標籤+class+同層序號），兩態之間可對得起來。 */
const SNAPSHOT_FN = function (stageSelector) {
  const stage = document.querySelector(stageSelector);
  if (!stage) return { fatal: "舞台不存在：" + stageSelector };
  const keyOf = (el) => {
    const parts = [];
    let n = el;
    while (n && n !== stage) {
      const par = n.parentElement;
      const idx = par ? Array.prototype.indexOf.call(par.children, n) : 0;
      const cls = String(n.className || "").trim().split(/\s+/).filter(Boolean).slice(0, 2).join(".");
      parts.unshift(n.tagName.toLowerCase() + (cls ? "." + cls : "") + "#" + idx);
      n = par;
    }
    return parts.join(" > ");
  };
  const rows = [];
  stage.querySelectorAll("*").forEach((el) => {
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    const vis = cs.display !== "none" && cs.visibility !== "hidden" && r.width > 0 && r.height > 0;
    rows.push({
      key: keyOf(el),
      cls: String(el.className || "").slice(0, 40),
      txt: (el.textContent || "").trim().slice(0, 22),
      top: r.top, bottom: r.bottom, left: r.left, right: r.right, h: r.height,
      pos: cs.position,
      vis,
      leaf: el.children.length === 0,
    });
  });
  /* 舞台縮放：桌機 fitHeroV2 會等比放大，量到的 px 要還原成板座標才有意義。
     視覺寬（rect）÷ 版面寬（offsetWidth）＝縮放倍率。 */
  const sr = stage.getBoundingClientRect();
  const scale = stage.offsetWidth > 0 ? sr.width / stage.offsetWidth : 1;
  return { rows, scale: scale || 1 };
};

async function snapshot(page, draft, stageSelector) {
  await page.evaluate((d) => { loadDraftJson(d, "可選件檢核"); }, draft);
  await page.waitForTimeout(1100);
  return page.evaluate(SNAPSHOT_FN, stageSelector);
}

async function runFixture(browser, fixturePath) {
  const fx = JSON.parse(fs.readFileSync(fixturePath, "utf8"));
  const dev = DEVICE_PARAM[fx.device];
  const vw = fx.device === "desktop" ? Math.min(fx.viewport.w, fx.stageBaseW ?? 1264) : fx.viewport.w;
  const url = "file://" + FRAMETEST + (dev ? `?device=${dev}` : "") + `#exp=kv:${fx.layout}`;
  const page = await browser.newPage({ viewport: { width: vw, height: fx.viewport.h } });
  const errs = [];
  page.on("pageerror", (e) => errs.push(e.message));
  await page.goto(url, { waitUntil: "load" });
  await page.waitForTimeout(2000);

  const base = { pageName: "可選件檢核", kv: {}, kvVariant: fx.layout };
  const full = await snapshot(page, { page: { ...base, hero: fx.demoHero || {} }, products: demoProducts(fx.demoProducts || 4, true) }, fx.stageSelector);
  const bare = await snapshot(page, { page: { ...base, hero: bareHero(fx.demoHero) }, products: demoProducts(fx.demoProducts || 4, false) }, fx.stageSelector);
  await page.close();

  /* 裁決登記查詢：回傳該零件的登記，沒登記＝null */
  const ruleFor = (el) => (fx.onoffRulings || []).find((r) => r.el === el) || null;
  const out = { layout: fx.layout, device: fx.device, findings: [], checked: 0, errs };
  if (full.fatal || bare.fatal) { out.findings.push({ level: "FATAL", msg: full.fatal || bare.fatal }); return out; }

  const sc = full.scale || 1;
  const bareByKey = new Map(bare.rows.map((r) => [r.key, r]));
  const fullVisible = full.rows.filter((r) => r.vis);

  /* 消失的可選件＝FULL 看得到、BARE 看不到（或整個不存在） */
  const gone = fullVisible.filter((r) => { const b = bareByKey.get(r.key); return !b || !b.vis; });

  /* 鄰居用「幾何上下相鄰」找，不用 DOM 兄弟——真實病例（特色標膠囊在 .pc-item 內、品名在外層）
     跨了層級，用兄弟關係會整個漏掉；而左右並排的裝飾件（括線 .brk）用兄弟關係又會誤判成上下重疊。
     判準：水平投影要有實質重疊（≥ 較窄者的 40%），且不是彼此的祖先／後代（用結構路徑前綴判）。 */
  const overlapsX = (p, q) => {
    const w = Math.min(p.right - p.left, q.right - q.left);
    const ov = Math.min(p.right, q.right) - Math.max(p.left, q.left);
    return w > 0 && ov >= w * 0.4;
  };
  const related = (p, q) => p.key === q.key || p.key.startsWith(q.key + " > ") || q.key.startsWith(p.key + " > ");
  const flowLeaf = (r) => r.pos !== "absolute" && r.pos !== "fixed";

  for (const E of gone) {
    /* A／B 用「起點在 E 之上／之下」判，允許與 E 部分重疊——騎跨式零件（膠囊壓在卡緣上）
       跟正上方的鄰居本來就重疊，用「完全在上方」會整個找不到鄰居（首版實測即此症）。 */
    const cands = fullVisible.filter((r) => !related(r, E) && flowLeaf(r) && overlapsX(r, E));
    const A = cands.filter((r) => r.top < E.top).sort((a, b) => b.bottom - a.bottom)[0];
    const B = cands.filter((r) => r.top > E.top).sort((a, b) => a.top - b.top)[0];
    if (!A || !B) continue;
    const aB = bareByKey.get(A.key), bB = bareByKey.get(B.key);
    if (!aB || !bB || !aB.vis || !bB.vis) continue;
    const stable = Math.abs((A.bottom - A.top) - (aB.bottom - aB.top)) <= 6
                && Math.abs((B.bottom - B.top) - (bB.bottom - bB.top)) <= 6;
    out.checked++;
    const dFull = (B.top - A.bottom) / sc;
    const dBare = (bB.top - aB.bottom) / sc;
    const label = `${E.cls || E.txt || "(無 class)"}`;
    const nums = `全填 ${dFull.toFixed(1)}px → 全空 ${dBare.toFixed(1)}px`;
    out.pairs = out.pairs || [];
    out.pairs.push(`${A.cls || A.txt} ┊${label}┊ ${B.cls || B.txt}  ${nums}  (${E.pos})`);
    if (dBare < -TOL) {
      /* 重疊照抓，不看鄰居穩定度——兩個看得見的元素疊了就是疊了。
         基準（全填態）本來就是負的＝這對鄰居設計上就重疊（堆疊構圖，如 011 拱窗）——量測配對撞上設計，
         不是可選件造成的塌陷；降級需人判斷。誤報實證＝2026-08-31 l011-dchip 三裝置，目視排除。 */
      if (dFull < -TOL) {
        out.findings.push({ level: "需人判斷", msg: `「${label}」所在區是堆疊構圖（全填態鄰居即重疊），沒填時重疊量有變（${nums}）——開畫面確認`, A: A.cls || A.txt, B: B.cls || B.txt });
      } else {
        out.findings.push({ level: "重疊", msg: `「${label}」沒填時，前後兩件疊在一起（${nums}）`, A: A.cls || A.txt, B: B.cls || B.txt });
      }
    } else if (!stable) {
      /* 鄰居自身在兩態變身（如檔期帶：真章 vs 佔位提示）＝位移遮住「空間有沒有收回」的訊號——
         「空洞」判不準就不判（l5-cap 誤報實證 2026-08-31），重疊已在上面照抓。 */
      out.skipped = (out.skipped || 0) + 1;
    } else if (E.pos === "absolute" || E.pos === "fixed") {
      if (dBare > dFull - TOL && dFull > 8) {
        const rl = ruleFor(label);
        if (rl) out.findings.push(verdictVsRuling(rl, label, dFull, dBare, nums, A, B));
        else out.findings.push({ level: "需人判斷", msg: `「${label}」是浮在上面的零件（絕對定位），沒填時前後距離沒變（${nums}）——要不要收由設計判斷`, A: A.cls || A.txt, B: B.cls || B.txt });
      }
    } else if (dBare > dFull - TOL) {
      const rl = ruleFor(label);
      if (rl) out.findings.push(verdictVsRuling(rl, label, dFull, dBare, nums, A, B));
      else out.findings.push({ level: "空洞", msg: `「${label}」沒填時位置還留著、距離沒收（${nums}）`, A: A.cls || A.txt, B: B.cls || B.txt });
    }
  }

  /* 全空態的文字重疊複掃：只看「有字的葉節點」彼此壓字（抓不是由消失件引起、而是本來就疊的情形）。
     只比葉節點＝避免把「容器包住自己的字」算成重疊；要求水平投影重疊＝避免左右並排件誤判。 */
  const bareLeaves = bare.rows.filter((r) => r.vis && flowLeaf(r) && r.leaf && r.txt);
  for (let i = 0; i < bareLeaves.length; i++) {
    for (let j = i + 1; j < bareLeaves.length; j++) {
      const p = bareLeaves[i], q = bareLeaves[j];
      if (related(p, q) || !overlapsX(p, q)) continue;
      const lo = p.top <= q.top ? p : q, hi = p.top <= q.top ? q : p;
      const gap = (hi.top - lo.bottom) / sc;
      if (gap < -TOL) {
        out.findings.push({ level: "重疊", msg: `全空態下「${lo.txt}」與「${hi.txt}」壓字 ${(-gap).toFixed(1)}px`, A: lo.cls, B: hi.cls });
      }
    }
  }
  return out;
}

(async () => {
  let files = fs.existsSync(SPEC_DIR) ? fs.readdirSync(SPEC_DIR).filter((f) => f.endsWith(".json")) : [];
  if (onlyLayout) files = files.filter((f) => f.startsWith(onlyLayout + "."));
  files = files.filter((f) => DEVICES.some((d) => f.endsWith("." + d + ".json")));
  if (!files.length) { console.error("沒有可跑的對板規格檔（--layout / --devices 過濾後為空）"); process.exit(2); }

  const browser = await chromium.launch({ channel: "chrome" });
  const all = [];
  for (const f of files.sort()) all.push(await runFixture(browser, path.join(SPEC_DIR, f)));
  await browser.close();

  if (asJson) { console.log(JSON.stringify(all, null, 1)); }
  else {
    console.log(`══ 可選件缺席掃描（${files.length} 個版型×裝置組合）══\n`);
    let bad = 0, ask = 0, checked = 0, ruledN = 0;
    for (const r of all) {
      checked += r.checked;
      const real = r.findings.filter((f) => f.level === "重疊" || f.level === "空洞" || f.level === "FATAL" || f.level === "裁決漂移");
      const judge = r.findings.filter((f) => f.level === "需人判斷");
      const ruled = r.findings.filter((f) => f.level === "已裁決");
      ruledN += ruled.length;
      bad += real.length; ask += judge.length;
      if (!r.findings.length && !r.errs.length && !verbose) continue;
      console.log(`【${r.layout}・${r.device}】`);
      if (verbose) (r.pairs || []).forEach((l) => console.log("  · " + l));
      r.errs.forEach((e) => console.log(`  ✗ pageerror：${String(e).slice(0, 90)}`));
      real.forEach((f) => console.log(`  ✗ [${f.level}] ${f.msg}`));
      judge.forEach((f) => console.log(`  ? [${f.level}] ${f.msg}`));
      if (verbose) ruled.forEach((f) => console.log(`  ✓ [${f.level}] ${f.msg}`));
      console.log("");
    }
    const skipped = all.reduce((n, r) => n + (r.skipped || 0), 0);
    console.log(`比對過的可選件＝${checked} 處；紅燈（重疊／空洞／裁決漂移）＝${bad}；待人判斷＝${ask}；已裁決（刻意保留、數字已釘住）＝${ruledN}；空洞判定跳過（鄰居不穩）＝${skipped}`);
    const anyErr = all.some((r) => r.errs && r.errs.length);/* 2026-09-03 量測有效性前提：pageerror 的那一輪不算量過 */
    console.log(bad === 0 && !anyErr ? "ONOFF_SCAN:PASS（沒有塌陷也沒有空洞）" : anyErr ? "ONOFF_SCAN:FAIL（有 pageerror＝該輪無效）" : "ONOFF_SCAN:FAIL");
  }
  process.exit(all.some((r) => (r.errs && r.errs.length) || r.findings.some((f) => f.level === "重疊" || f.level === "空洞" || f.level === "FATAL" || f.level === "裁決漂移")) ? 1 : 0);
})();
