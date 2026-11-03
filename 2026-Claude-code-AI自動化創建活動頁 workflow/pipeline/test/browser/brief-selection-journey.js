"use strict";
/* 策略檔指導選品——真旅程走查（71 號方案 A 階段二；2026-09-14 使用者裁「依建議開工」）
   照同事的路真點擊：建立頁貼來源網址 → 選「快速草稿」→ 選策略檔 → 建立 → 編修頁「活動策略檔」揭示區讀句子、讀每層底下的商品。
   用法：node test/browser/brief-selection-journey.js <port> <mode> <outDir> [runId]
     runId 有給＝重用既有 run（跳過建立那段、不再抓來源），建立頁那句仍會去選一次檔看句子
     mode＝mismatch ｜ match ｜ builtin
       mismatch＝mine/走查範例-中秋烤肉配計時器來源（會出聲）.md → 要出聲：兩層「一件都沒找到、4 件是機器補的」＋「多放」零命中
       match   ＝mine/走查範例-計時器與爐具（對得上）.md          → 要安靜：三層底下全是標題說的東西、沒有補齊句；v2＝短賣點／小標籤／牆標題／編輯精選／眉標都照策略檔
       builtin ＝built-in/05-時事主題-情境選品.md（有寫避開計時器） → 要出聲：「避開的字排掉了 14/20 件，剩 6 件不夠排一頁」（裁 4 甲）
   前置：workbench server 活著、能連 tw.buy.yahoo.com。node --test 下跳過（非 hermetic）。
   坑（沿 brief-journey.js）：送出前被擋要把提示抓出來、樓層區塊預設收合、innerText 不含 input 值→讀 window.draft。 */
if (process.env.NODE_TEST_CONTEXT) { console.log("brief-selection-journey：手動旅程走查（需 Chrome＋活 server＋外網），node --test 下跳過"); return; }
const fs = require("fs"), path = require("path");
const PIPE = path.resolve(__dirname, "..", "..");
const pw = require(PIPE + "/node_modules/playwright-core");
const PASS = fs.readFileSync(path.join(PIPE, "workbench", ".wb-pass"), "utf8").trim();
const [PORT = "8787", MODE = "mismatch", OUT = "/tmp", REUSE = ""] = process.argv.slice(2);
const SRC = "https://tw.buy.yahoo.com/category/4481524";
const CASES = {
  mismatch: { brief: "mine/走查範例-中秋烤肉配計時器來源（會出聲）.md", theme: "中秋烤肉" },
  match: { brief: "mine/走查範例-計時器與爐具（對得上）.md", theme: "廚房好幫手" },
  builtin: { brief: "built-in/05-時事主題-情境選品.md", theme: "中秋烤肉" },
};
const C = CASES[MODE]; if (!C) { console.error("mode 要是 mismatch｜match｜builtin"); process.exit(2); }
fs.mkdirSync(OUT, { recursive: true });
const R = [], ok = (n, p, note) => { R.push(p); console.log(`${p ? "PASS" : "FAIL"}  ${n}${note ? "  |  " + note : ""}`); };

(async () => {
  const b = await pw.chromium.launch({ channel: "chrome", headless: true });
  const p = await (await b.newContext({ viewport: { width: 1440, height: 950 }, httpCredentials: { username: "yahoo", password: PASS } })).newPage();
  const errs = []; p.on("pageerror", (e) => errs.push(String(e)));
  await p.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: "domcontentloaded" });
  await p.waitForSelector("#home-create-card", { timeout: 15000 });
  await p.click("#home-btn-create"); await p.waitForTimeout(1500);

  await p.fill("#in-url", SRC);
  await p.click('#recipe-cards .recipe-card[data-scenario="時事主題-情境×選品"]'); // 2026-09-15 卡名改口＝改用 value 鍵找卡，不跟顯示字綁死
  await p.waitForTimeout(800);
  await p.fill("#in-theme", C.theme);
  const opts = await p.$$eval("#in-brief option", (o) => o.map((x) => x.value));
  ok("① 策略檔下拉有這份檔（mine 資料夾即放即選）", opts.includes(C.brief), C.brief);
  await p.selectOption("#in-brief", C.brief); await p.waitForTimeout(500);
  const briefNote = await p.$eval("#in-brief-note", (e) => e.textContent).catch(() => "");
  ok("① 建立頁確認句出現", /會帶入/.test(briefNote), briefNote.slice(0, 60));
  const lbl = await p.$eval('label[for="in-brief"]', (e) => e.textContent).catch(() => "");
  ok("① 建立頁說明講到「選品」也照策略檔走", /選品就照你寫的走/.test(lbl), lbl.trim().slice(0, 50));
  let runId = REUSE;
  if (!REUSE) {
    await p.fill("#in-owner-email", "tofu");
    const depts = await p.$$eval("#in-owner-dept option", (o) => o.map((x) => x.value).filter((v) => v && v !== "__custom__"));
    if (depts.length) await p.selectOption("#in-owner-dept", depts[0]);
    await p.waitForTimeout(400);
    await p.click('.engine-card[data-engine="auto"]');
    await p.screenshot({ path: path.join(OUT, `bs-${MODE}-1-create.png`) });

    await p.click("#btn-create");
    await p.waitForTimeout(2500);
    const blocked = await p.evaluate(() => { const t = document.querySelector("#toast,.toast"); return t && getComputedStyle(t).display !== "none" ? t.textContent.trim() : ""; });
    if (blocked && !/已開始|建立中|開始/.test(blocked)) { ok("② 送出沒有被擋下", false, "被擋：" + blocked); await p.screenshot({ path: path.join(OUT, `bs-${MODE}-blocked.png`) }); await b.close(); process.exit(1); }
    await p.waitForFunction(() => { const v = document.querySelector("#view-work"); return v && v.style.display === "flex"; }, null, { timeout: 240000 });
    await p.waitForTimeout(3000);
    runId = await p.evaluate(() => (typeof currentId !== "undefined" && currentId) || "");
    ok("② 建置完成、自動進編修頁", !!runId, runId);
  } else {
    await p.evaluate((id) => openRun(id, { skipGuard: true }), REUSE);
    await p.waitForFunction(() => { const v = document.querySelector("#view-work"); return v && v.style.display === "flex"; }, null, { timeout: 20000 });
    await p.waitForTimeout(2500);
    ok("②（重用既有 run，跳過建立）", true, REUSE);
  }

  /* 揭示區＝這批的主舞台 */
  const banner = await p.evaluate(() => { const n = document.querySelector("#brief-note"); return n && n.style.display !== "none" ? n.innerText.trim() : ""; });
  await p.screenshot({ path: path.join(OUT, `bs-${MODE}-2-editor.png`) });
  ok("③ 揭示區有出現、講明策略檔帶入了什麼", /照策略檔帶入了/.test(banner), banner.split("\n")[0]);
  ok("③ 不再說「還不會影響選哪些商品」", !/還不會影響選哪些商品/.test(banner));

  /* 每層底下真的是什麼：讀 draft（innerText 不含 input 值），對照該層「放什麼」的字 */
  const floors = await p.evaluate(() => {
    const d = (typeof draft !== "undefined") ? draft : null; if (!d || !d.page) return null;
    const byG = new Map((d.products || []).map((x) => [String(x.gdid), x.name]));
    const byU = new Map((d.products || []).map((x) => [String(x.url), x.name]));
    /* 每層＝情境卡代表品（sceneUrl，不在卡列）＋3 張卡（productGdids）＝4 件；帳裡的 matched＋filled 數的是這 4 件 */
    return (d.page.floors || []).map((f) => ({ title: f.title, sub: f.subtitle || "", items: [byU.get(String(f.sceneUrl)) || "?(rep)"].concat((f.productGdids || []).map((g) => byG.get(String(g)) || "?")) }));
  });
  const sel = await p.evaluate(() => (typeof draft !== "undefined" && draft && draft.meta && draft.meta.briefSelection) || null);
  const line = (floors || []).map((f) => `${f.title}｜${f.sub}：${f.items.map((n) => n.slice(0, 14)).join(" / ")}`).join("\n      ");
  console.log("      樓層實況：\n      " + line);

  if (MODE === "match") {
    ok("④ 三層標題＝策略檔寫的", floors && floors.length === 3 && /開火就靠它/.test(floors[0].title) && /計時不失手/.test(floors[2].title), (floors || []).map((f) => f.title).join("／"));
    /* v2：小標籤放的是短賣點、「放什麼」的字只在帳裡（meta.briefSelection.floors[i].words）——拿帳裡的字對每一件商品名 */
    const allHit = floors && sel && floors.every((f, i) => { const w = (sel.floors[i] && sel.floors[i].words) || []; return w.length && f.items.length && f.items.every((n) => w.some((x) => n.includes(x))); });
    ok("④ 每一層底下每一件都含該層「放什麼」的字（標題沒對商品說謊）", !!allHit, JSON.stringify(sel && sel.floors.map((f) => f.words)));
    ok("④ 帳：三層 matched 4／filled 0", !!sel && sel.floors.length === 3 && sel.floors.every((f) => f.matched === 4 && f.filled === 0), JSON.stringify(sel && sel.floors.map((f) => [f.matched, f.filled])));
    /* 允許的聲音：005 沒有眉標位那句、牆的部分補齊句（牆件數 4/8/12 大於對到的件數是常態）；不准的：樓層補齊句、對不太上、方向零命中 */
    ok("④ 揭示區安靜：樓層沒有補齊句、沒有對不上句、沒有零命中句（不假警報）", !/這層照你寫的|對不太上|沒有排掉|沒有讓任何|一件都沒找到/.test(banner), banner.split("\n").slice(1, 4).join(" ‖ "));
    ok("④ 揭示區講到「選品」也是策略檔帶入的", /選品/.test(banner.split("\n")[0]));
    /* v2（2026-09-14 下午，牆 cms-layout-fit Q3 甲＋Q4 甲）：短賣點進情境卡小標籤、牆標題／編輯精選／眉標都是人寫機器搬 */
    const v2 = await p.evaluate(() => {
      const d = (typeof draft !== "undefined") ? draft : null; if (!d || !d.page) return null;
      return { subs: (d.page.floors || []).map((f) => (f.sceneCopy || {}).sub || f.subtitle || ""), tags: (d.page.floors || []).map((f) => (f.sceneCopy || {}).tag || ""),
        walls: (d.page.walls || []).map((w) => w.title), ed: d.page.editorial && d.page.editorial.title, eyebrowZh: d.page.kv && d.page.kv.eyebrowZh,
        hero: d.page.hero && d.page.hero["slogan-left"] };
    });
    ok("⑤ 短賣點進情境卡小標籤（不是品類詞）", !!v2 && v2.subs[0] === "卡式爐界的老牌子" && v2.subs[2] === "煮麵泡茶不過頭", JSON.stringify(v2 && v2.subs));
    ok("⑤ 第四段換掉小標籤（開火／好讀／計時）", !!v2 && v2.tags.join("/") === "開火/好讀/計時", JSON.stringify(v2 && v2.tags));
    ok("⑤ 三面牆標題＝策略檔寫的（有寫字的對到才掛；沒寫字的看整批對不對得上）", !!v2 && v2.walls.length >= 1 && v2.walls[0] === "更多計時器" && (v2.walls.length < 3 || v2.walls[2] === "順手補一件"), JSON.stringify(v2 && v2.walls));
    const wsel = await p.evaluate(() => (typeof draft !== "undefined" && draft && draft.meta && draft.meta.briefSelection && draft.meta.briefSelection.walls) || null);
    ok("⑤ 牆照字挑：有寫字的牆每面 matched ≥1、沒寫字的是機器（帳）", !!wsel && wsel.length >= 1 && wsel.every((w) => w.machine || w.matched >= 1), JSON.stringify(wsel && wsel.map((w) => [w.words.join("、"), w.matched, w.filled])));
    const wallItems = await p.evaluate(() => { const d = draft; const byG = new Map((d.products || []).map((x) => [String(x.gdid), x.name])); return (d.page.walls || []).map((w) => (w.productGdids || []).map((g) => byG.get(String(g)) || "?")); });
    ok("⑤ 第一面牆「計時器」底下真的有計時器、第二面有瓦斯爐", !!wallItems && wallItems[0] && wallItems[0].some((n) => /計時器/.test(n)) && wallItems[1] && wallItems[1].some((n) => /瓦斯爐/.test(n)), (wallItems || []).map((w) => w.slice(0, 2).map((n) => n.slice(0, 10)).join("/")).join(" ‖ "));
    ok("⑤ 編輯精選三行＝策略檔寫的", !!v2 && Array.isArray(v2.ed) && v2.ed[2] === "編輯室私心推", JSON.stringify(v2 && v2.ed));
    ok("⑤ 眉標進主視覺（kv.eyebrowZh＋hero 眉標段或出聲）", !!v2 && v2.eyebrowZh === "日本廚房小家電精選" && (/日本廚房小家電精選/.test(v2.hero || "") || /沒有小字的位置/.test(banner)), (v2 && v2.hero || "").replace(/\n/g, "⏎").slice(0, 60));
    ok("⑤ 揭示區首句講到牆標題／編輯精選／眉標", /牆標題/.test(banner.split("\n")[0]) && /編輯精選/.test(banner.split("\n")[0]), banner.split("\n")[0]);
  } else if (MODE === "mismatch") {
    /* R1（2026-09-14 下午使用者裁）：對到的層掛人寫的標題；一件都沒對到的層維持系統標題（收尾清潔底下不能是計時器還掛「收尾清潔」） */
    ok("④ 對到的層掛你的標題、零命中的層掛回系統標題", floors && /烤肉必備/.test(floors[0].title) && !/加分道具/.test(floors[1].title) && !/收尾清潔/.test(floors[2].title), (floors || []).map((f) => f.title).join("／"));
    ok("④ 零命中的層小標籤也是系統的（不是你的短賣點）", floors && !/有了更順手|烤完也要收得快/.test(floors[1].sub + floors[2].sub), floors ? floors[1].sub + "／" + floors[2].sub : "");
    ok("④ 第一層照「瓦斯爐」有對到、也有補（帳 matched＋filled＝4）", !!sel && sel.floors[0] && sel.floors[0].matched > 0 && sel.floors[0].filled > 0 && sel.floors[0].matched + sel.floors[0].filled === 4, JSON.stringify(sel && sel.floors[0]));
    ok("④ 第一層底下對到的件數＝名字含「瓦斯爐」的件數（帳與畫面同一份）", !!sel && floors && floors[0] && floors[0].items.filter((n) => /瓦斯爐/.test(n)).length === sel.floors[0].matched, floors && floors[0] ? floors[0].items.map((n) => n.slice(0, 12)).join(" / ") : "");
    ok("④ 第一層的補齊句數字＝帳", !!sel && new RegExp(`「烤肉必備」這層照你寫的「烤肉架、瓦斯爐、木炭」只找到 ${sel.floors[0].matched} 件，另外 ${sel.floors[0].filled} 件是機器補的`).test(banner));
    ok("④ 「加分道具」一件都沒找到＝揭示區講「標題與小標籤先用系統預設」", /「加分道具」這層照你寫的「烤肉夾、烤肉網、隔熱手套」一件都沒找到——標題與小標籤先用系統預設，底下 4 件是機器補的/.test(banner));
    ok("④ 「收尾清潔」一件都沒找到＝揭示區講出來", /「收尾清潔」這層[^\n]*一件都沒找到——標題與小標籤先用系統預設/.test(banner));
    /* R2：牆照字挑、零命中的牆掛回系統標題；編輯精選在整批對不上時用系統句 */
    const v2m = await p.evaluate(() => { const d = (typeof draft !== "undefined") ? draft : null; return d && d.page ? { walls: (d.page.walls || []).map((w) => w.title), ed: d.page.editorial && d.page.editorial.title, sel: d.meta && d.meta.briefSelection && d.meta.briefSelection.walls } : null; });
    ok("④ 三面牆零命中＝掛回系統標題（醬料與調味底下不再是計時器還叫醬料）", !!v2m && v2m.walls.length >= 1 && !v2m.walls.some((t) => /醬料與調味|飲料與冰品|露營野餐小物/.test(t)), JSON.stringify(v2m && v2m.walls));
    ok("④ 牆的帳有寫（每面 matched／filled）", !!v2m && Array.isArray(v2m.sel) && v2m.sel.length === (v2m.walls || []).length, JSON.stringify(v2m && v2m.sel && v2m.sel.map((w) => [w.matched, w.filled])));
    ok("④ 揭示區講牆零命中「標題先用系統預設」", /「醬料與調味」這面牆照你寫的「烤肉醬、醬油、胡椒」一件都沒找到——標題先用系統預設/.test(banner));
    ok("④ 整批對不上＝編輯精選那一句不掛（系統句）", !!v2m && Array.isArray(v2m.ed) && !(v2m.ed[0] === "中秋烤肉" && v2m.ed[1] === "一次備齊" && v2m.ed.length === 2) && /「編輯精選那一句」先用系統預設/.test(banner), JSON.stringify(v2m && v2m.ed));
    ok("④ 「多放：烤肉、木炭」零命中＝講出來並教寫商品字", /「多放：烤肉、木炭」沒有讓任何商品排前面/.test(banner) && /商品名會出現的字/.test(banner));
    ok("④ 補齊句有教怎麼改（品類名）", /改成這批商品的品類名/.test(banner));
    /* 頁級「對不太上」那句：真病例剛好 6/20＝30%＝卡在門檻上（<0.3 才出聲）——照實記錄，不改門檻（那是 CP-14 的尺，改要另裁） */
    const fit = await p.evaluate(() => (typeof draft !== "undefined" && draft && draft.meta && draft.meta.brief && draft.meta.brief.fit) || null);
    console.log("      頁級對不對得上（階段一）：", JSON.stringify(fit), /對不太上/.test(banner) ? "→ 有出聲" : "→ 沒出聲（卡門檻）");
    ok("④ 階段一有算（fit 有帳）", !!fit && fit.total > 0, JSON.stringify(fit));
  } else {
    /* 來源是活的：排掉之後剩多少會變。剩不夠排一頁（<24）＝要大聲講、數字＝帳；剩夠＝不講、頁面照建（裁 4 甲兩種結果都要對） */
    const ex = sel && sel.exclude;
    ok("④ 「避開：計時器、時鐘」真的排了（帳 removed>0）", !!ex && ex.removed > 0, JSON.stringify(ex));
    if (ex && ex.after < 24) ok("④ 剩不夠排一頁＝揭示區大聲講，數字＝帳", new RegExp(`排掉了 ${ex.removed}/${ex.before} 件，剩 ${ex.after} 件不夠排一頁`).test(banner), banner.split("\n").find((l) => /排掉/.test(l)) || "");
    else ok("④ 剩得夠排一頁＝不喊「不夠」、頁面照建有樓層", !!ex && !/不夠排一頁/.test(banner) && floors && floors.length >= 1, `after=${ex && ex.after}，${(floors || []).length} 層`);
    const allNames = await p.evaluate(() => (typeof draft !== "undefined" && draft && draft.products || []).map((x) => x.name));
    ok("④ 整頁沒有一件計時器或時鐘（真的排掉了、沒放回去）", allNames.length > 0 && !allNames.some((n) => /計時器|時鐘/.test(n)), `整頁 ${allNames.length} 件`);
    ok("④ 「多放」零命中也講了", /「多放：烤肉、木炭」沒有讓任何商品排前面/.test(banner));
  }

  ok("零 JS 錯誤", errs.length === 0, errs.slice(0, 2).join(" / "));
  console.log(`\n${MODE}：${R.filter(Boolean).length}/${R.length}｜run=${runId}｜截圖 ${OUT}`);
  await b.close(); process.exit(R.every(Boolean) ? 0 : 1);
})().catch((e) => { console.error("中止：" + e.message); process.exit(2); });
