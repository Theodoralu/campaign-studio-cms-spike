"use strict";
/**
 * cms/edit_more.js —— 編修頁其餘的伺服器端操作（D14 第三段，2026-11-27）
 *
 *   POST /runs/:id/scenario        補選活動型態（只記在建立輸入，草稿不動）
 *   POST /runs/:id/pool-rebuild    某件商品的來源紀錄重建（重讀商品頁 → 同步來源快照與草稿名稱）
 *   POST /runs/:id/editorial-add   編輯精選加一件（貼網址，或自動補一件折數最好的）
 *   POST /runs/:id/enrich-ee       一鍵生成 編輯精選＋延伸探索
 *   POST /runs/:id/explore-fix     延伸探索卡：換成在檔活動、手動改連結、新增、移除、「看更多」去向
 *
 * 來源：workbench/server.js 同名路由，邏輯與訊息逐段沿用；差別只有「資料經 RunStore」「商品頁與活動頁由 deps 讀」。
 * 單機版本體仍在 server.js（退役時一起拿掉）。
 */
const path = require("path");
const PIPE = path.join(__dirname, "..");
const scenLib = require(path.join(PIPE, "lib", "scenario_names.js"));
const contentModules = require(path.join(PIPE, "lib", "content_modules.js"));
const { classifyLinkTarget, classifySearchLiveness, upsertPoolEntry, normalizeLinkUrl, pickLivePromo, isShellPage } = require(path.join(PIPE, "workbench", "content_checks.js"));
const { parseBrandPage, parseListingHits, parseActivityPage, classifyLiveness } = require(path.join(PIPE, "fetch_parse.js"));
const { summary: pcSummaryOf } = require(path.join(PIPE, "core", "product-truth", "rows"));
const { heroGdidSet, pageExposedGdids } = require(path.join(PIPE, "core", "page", "exposed"));
const { baseNum } = require("./frontend");

const EXPLORE_ITEMS_CAP = 4; // 探索入口上限（沿單機版：桌機一排放得下 4 張）
const errText = (e) => String((e && e.message) || e);
const cutW = (s, n) => { let w = 0, out = ""; for (const ch of String(s || "")) { w += ch.charCodeAt(0) > 255 ? 1 : 0.55; if (w > n) break; out += ch; } return out; };
const poolOf = (snap, exposed) => (snap.products || []).filter((p) => p && p.gdid && p.name && typeof p.price === "number" && p.imgs && p.imgs[0] && !exposed.has(String(p.gdid)));
const byDisc = (a, b) => (a.disc == null ? 999 : a.disc) - (b.disc == null ? 999 : b.disc);

/** 補一件折數最好的：來源商品裡還沒上頁的，依折數排，逐一（最多 10 件）開商品頁確認在售才用。 */
async function autoPickFromPool({ snapshot, exposed, productFetch }) {
  const pool = poolOf(snapshot, exposed);
  if (!pool.length) return { error: "這批商品已經沒有多的可以自動補了——請改用賣場編號自己挑一件加入，或讓這個區塊留空", needManual: true };
  pool.sort(byDisc);
  for (const cand of pool.slice(0, 10)) {
    const rf = await productFetch({ url: String(cand.gdid) });
    if (rf.code === 200 && rf.product && rf.product.gdid && !exposed.has(String(rf.product.gdid))) return { product: rf.product };
  }
  return { error: "自動挑到的商品目前都失效或缺資料，補不進來——請改用賣場編號自己挑一件在售商品", needManual: true };
}

function mountEditMore(api, { store, jobs, deps, wrap }) {
  const exploreLocks = new Set(); // 同一檔的探索卡修復一次只跑一個（驗連結要 5～10 秒）
  const alive = async (req, res) => { const m = await store.readMeta(req.params.id); if (!m || m.deletedAt) { res.status(404).json({ error: "找不到這檔活動", code: "not-found" }); return null; } return m; };
  const busy = (req, res) => { if (jobs.busy(req.params.id)) { res.status(409).json({ error: "這個活動正在處理中——請稍後再試", code: "busy" }); return true; } return false; };
  const ver = async (id) => { const t = await store.getText(id, "draft.json"), d = await store.getDraft(id); return { version: t.etag, baseMs: baseNum(t.etag), fingerprint: d.fingerprint }; };
  const save = (id, cur, req, note) => store.saveDraft(id, cur.draft, { ifMatch: cur.etag, source: "system", actor: req.user.email, note });
  const backupName = (saved) => (saved.versionId ? `draft.v${saved.versionId}.json` : "上一版");
  const needFetch = (res, what) => { if (deps[what]) return true; res.status(501).json({ error: "這台伺服器沒有接商品頁讀取，這個功能不能用", code: "not-migrated" }); return false; };
  /* 商品狀態報告跟著草稿走：草稿裡已經沒有的商品，報告裡的那幾列一起拿掉 */
  const reconcileCheck = async (id, draft) => { const pc = await store.getJson(id, "product_check.json"); if (!pc || !(pc.data.results || []).length) return;
    const keep = new Set((draft.products || []).map((x) => String(x && x.gdid))), kept = pc.data.results.filter((r) => keep.has(String(r.gdid)));
    if (kept.length !== pc.data.results.length) { pc.data.results = kept; pc.data.summary = pcSummaryOf(kept); await store.putJson(id, "product_check.json", pc.data); } };
  const patchCheck = async (id, gdid, fn) => { const pc = await store.getJson(id, "product_check.json"); if (!pc) return; const row = (pc.data.results || []).find((x) => String(x.gdid) === String(gdid)); if (!row) return;
    fn(row); pc.data.results = pc.data.results.filter((r) => !r._stale); pc.data.summary = pcSummaryOf(pc.data.results); await store.putJson(id, "product_check.json", pc.data); };
  const fetchRetry = async (u) => { try { return await deps.fetchPage(u); } catch (e) { await new Promise((r) => setTimeout(r, deps.offline ? 0 : 800)); return deps.fetchPage(u); } };
  const nowSec = () => Math.floor(Date.parse(deps.clock.iso()) / 1000);

  api.post("/runs/:id/scenario", wrap(async (req, res) => {
    const m = await alive(req, res); if (!m) return; const b = req.body || {}, hit = scenLib.resolve(String(b.scenario || ""));
    if (!hit) return res.status(400).json({ error: "這不是可用的活動型態——請從五張卡裡選一張。" });
    await store.patchMeta(req.params.id, { input: { ...(m.input || {}), scenario: hit.value, ...(b.theme != null ? { theme: String(b.theme).trim() } : {}) } });
    await store.appendLog(req.params.id, `補選活動型態：「${hit.title}」${b.theme != null ? `；主題「${String(b.theme).trim()}」` : ""}（草稿未動）`);
    res.json({ ok: true, scenario: hit.value, scenarioTitle: hit.title });
  }));

  api.post("/runs/:id/pool-rebuild", wrap(async (req, res) => {
    if (!(await alive(req, res)) || busy(req, res) || !needFetch(res, "productFetch")) return;
    const id = req.params.id, gdid = String((req.body || {}).gdid || "");
    const cur = await store.getDraft(id), snap = await store.getJson(id, "snapshot.json"); if (!cur || !snap) return res.status(404).json({ error: "這個活動缺草稿或來源快照", code: "no-doc" });
    const drow = (cur.draft.products || []).find((x) => String(x.gdid) === gdid);
    if (!drow) { await patchCheck(id, gdid, (r) => { r._stale = true; }); await reconcileCheck(id, cur.draft);
      return res.status(404).json({ error: "這件商品已經不在這一檔活動裡了（先前換掉或移除過）——這條檢查是舊資料，已經幫你清掉；按「重新檢查」即可更新清單", staleCleared: true }); }
    if (!drow.url) return res.status(400).json({ error: "這件商品在頁面上缺商品連結，無法重抓——請改用「替換商品」換一件" });
    const rf = await deps.productFetch({ url: drow.url }); if (rf.code !== 200) return res.status(rf.code).json({ error: rf.error });
    rf.product.gdid = gdid; // 來源快照的鍵＝草稿的編號（商品頁網址尾碼可能是另一套編號）
    const up = upsertPoolEntry(snap.data, rf.product);
    snap.data.warnings = (snap.data.warnings || []).concat(`來源紀錄重建：gdid ${gdid}（${up.mode === "add" ? "補入池" : "同步 " + (up.changed.join("、") || "無變更")}；${deps.clock.iso()}；伺服器實抓）`);
    await store.putJson(id, "snapshot.json", snap.data, { ifMatch: snap.etag });
    await patchCheck(id, gdid, (r) => { delete r.snapMissing; r.snapPrice = rf.product.price; if (r.livePrice != null) r.snapDrift = rf.product.price !== r.livePrice; });
    const aligned = contentModules.alignDraftRowTruth(cur.draft.products, rf.product);
    let approvalInvalidated = false;
    if (aligned.length) { const saved = await save(id, cur, req, `來源紀錄重建：草稿同步 ${aligned.join("、")}（gdid ${gdid}）`); approvalInvalidated = saved.approvalInvalidated; }
    else if (up.mode === "sync" && up.changed.length) { const m = await store.readMeta(id); if (m.approvedAt) { approvalInvalidated = true; await store.patchMeta(id, { approvedAt: null, approvalInvalidatedAt: deps.clock.iso(), approvedAtPrev: m.approvedAt }); } }
    await store.appendLog(id, `來源紀錄重建：gdid ${gdid}（${up.mode === "add" ? "補入池" : "真值同步"}）`);
    res.json({ ok: true, mode: up.mode, product: rf.product, draftAligned: aligned, approvalInvalidated, ...(await ver(id)) });
  }));

  api.post("/runs/:id/editorial-add", wrap(async (req, res) => {
    if (!(await alive(req, res)) || busy(req, res) || !needFetch(res, "productFetch")) return;
    const id = req.params.id, body = req.body || {};
    const cur = await store.getDraft(id); if (!cur) return res.status(404).json({ error: "草稿還沒有產生", code: "no-doc" });
    const snap = await store.getJson(id, "snapshot.json"); if (!snap) return res.status(409).json({ error: "這個活動缺少來源商品資料，無法自動補入商品——請重新建立這個活動，或改到其他區塊編修", needManual: true });
    const dj = cur.draft, exposed = pageExposedGdids(dj);
    let np, autoPicked = false;
    if (body.auto) { const ap = await autoPickFromPool({ snapshot: snap.data, exposed, productFetch: deps.productFetch }); if (ap.error) return res.status(409).json(ap); np = ap.product; autoPicked = true; }
    else { const r = await deps.productFetch({ url: body.url }); if (r.code !== 200) return res.status(r.code).json({ error: r.error }); np = r.product;
      if (exposed.has(String(np.gdid)) && !heroGdidSet(dj).has(String(np.gdid))) return res.status(409).json({ error: "這件商品已經用在頁面其他地方了（每件商品只能出現一次；主視覺除外）——請換一件" }); }
    const up = upsertPoolEntry(snap.data, np, "R3:editorial-manual");
    contentModules.alignDraftRowTruth(dj.products, np);
    if (up.mode === "add" || up.changed.length) {
      snap.data.warnings = (snap.data.warnings || []).concat(up.mode === "add" ? `R3 入池（編輯精選人工挑選）：gdid ${np.gdid}「${np.name}」（${deps.clock.iso()}）` : `R3 真值同步（編輯精選）：gdid ${np.gdid} 同步 ${up.changed.join("、")}（${deps.clock.iso()}）`);
      await store.putJson(id, "snapshot.json", snap.data, { ifMatch: snap.etag });
    }
    if (!dj.page.editorial) dj.page.editorial = { title: [cutW(dj.page.curationTheme || dj.page.pageName || "編輯精選", 6), "嚴選推薦", "編輯室嚴選提案"], circles: [] };
    const order = (dj.products || []).filter((p) => p && p.position === "editorial-wall").length + 1;
    dj.products.push(Object.assign({ gdid: String(np.gdid), position: "editorial-wall", order, name: np.name, price: np.price, url: np.url, img: (np.imgs || [])[0], sceneImg: (np.imgs || [])[1] || (np.imgs || [])[0],
      imgOptions: (np.imgs || []).slice(0, 5), offer: "", tag: "", tagSource: "manual" }, (typeof np.marketPrice === "number" && np.marketPrice > np.price) ? { marketPrice: np.marketPrice } : {}, np.store ? { store: np.store } : {}));
    if ((dj.page.editorial.circles || []).length < 2) { // 前 2 件同步當精選圓（缺圓才補）
      const pickC = await deps.pickCircleImg(np.imgs); for (const n of pickC.notes || []) await store.appendLog(id, `編輯精選圓（gdid ${np.gdid}）：${n}`);
      dj.page.editorial.circles = (dj.page.editorial.circles || []).concat([{ tag: cutW(np.name, 7), copy: cutW(np.name, 18), date: "", img: pickC.img, url: np.url }]);
    }
    const saved = await save(id, cur, req, `編輯精選${autoPicked ? "自動補一件" : "人工加入"}：gdid ${np.gdid}`);
    await reconcileCheck(id, dj);
    await store.appendLog(id, `編輯精選${autoPicked ? "自動補一件" : "人工加入"}：gdid ${np.gdid}「${cutW(np.name, 16)}」＝牆第 ${order} 件`);
    res.json({ ok: true, draft: dj, wallCount: order, gdid: String(np.gdid), name: np.name, autoPicked, approvalInvalidated: saved.approvalInvalidated, ...(await ver(id)) });
  }));

  api.post("/runs/:id/enrich-ee", wrap(async (req, res) => {
    if (!(await alive(req, res)) || busy(req, res)) return;
    const id = req.params.id, cur = await store.getDraft(id), snap = await store.getJson(id, "snapshot.json");
    if (!cur || !snap) return res.status(404).json({ error: "這個活動缺草稿或來源快照", code: "no-doc" });
    const dj = cur.draft, snapE = snap.data, pool = poolOf(snapE, pageExposedGdids(dj));
    if (pool.length < 6) return res.status(409).json({ needManual: true, available: pool.length,
      error: `這個活動的商品不夠自動生成編輯精選——目前只剩 ${pool.length} 件沒被其他區塊用到（需要至少 6 件：2 個精選圓＋4 件商品牆）。你可以改用「人工挑選商品加入」用賣場編號自己加，或讓這個區塊留空。` });
    pool.sort(byDisc);
    const circles = pool.slice(0, 2); let c = 2, take = 0; for (const s of [12, 8, 4]) if (pool.length - c >= s) { take = s; break; }
    const wallItems = pool.slice(c, c + take); c += take;
    const themeLabel = dj.page.curationTheme || dj.page.pageName || "本檔";
    const l1 = cutW(themeLabel, 6), l2 = String(themeLabel).slice(l1.length) ? cutW(String(themeLabel).slice(l1.length), 6) : "嚴選推薦";
    const circleRows = [];
    for (const p of circles) { const pickC = await deps.pickCircleImg(p.imgs); for (const n of pickC.notes || []) await store.appendLog(id, `編輯精選圓（gdid ${p.gdid}）：${n}`);
      circleRows.push({ tag: cutW(p.offer || p.name, 7), copy: cutW(p.name, 18), date: "", img: pickC.img, url: p.url }); }
    dj.page.editorial = { title: [l1, l2, "編輯室嚴選提案"], circles: circleRows };
    dj.products = (dj.products || []).filter((p) => !(p && p.position === "editorial-wall"));
    wallItems.forEach((p, i) => dj.products.push(Object.assign({ gdid: String(p.gdid), position: "editorial-wall", order: i + 1, name: p.name, price: p.price, url: p.url, img: p.imgs[0], sceneImg: p.imgs[1] || p.imgs[0],
      offer: p.offer || "", tag: p.offer || "", tagSource: p.offer ? "offer" : null }, (typeof p.marketPrice === "number" && p.marketPrice > p.price) ? { marketPrice: p.marketPrice } : {}, p.store ? { store: p.store } : {})));
    const items = [], srcUrl = snapE.sourceUrl || (dj.meta || {}).sourceUrl || "";
    if (srcUrl) items.push({ label: cutW(`前往${themeLabel}來源頁`, 12), sub: "完整選品一次看", img: (pool[c] || pool[0]).imgs[0], url: srcUrl });
    const pr = (snapE.promotions || []).find((x) => x && x.url && x.title && !(typeof x.endTs === "number" && x.endTs < nowSec()));
    if (pr) { const fi = (snapE.products || []).find((p) => p && String(p.actid || "") === String(pr.actid) && p.imgs && p.imgs[0]); if (fi && String(pr.url) !== String(srcUrl)) items.push({ label: "看更多優惠活動", sub: "檔期優惠一覽", img: fi.imgs[0], url: pr.url }); }
    if (items.length) dj.page.explore = { moreUrl: srcUrl || items[0].url, ctaText: dj.page.ctaText || `看更多${themeLabel}選品`, items };
    const saved = await save(id, cur, req, `一鍵生成編輯精選＋延伸探索：圓×2＋牆 ${take} 件＋探索 ${items.length} 卡`);
    await reconcileCheck(id, dj);
    await store.appendLog(id, `編輯精選＋延伸探索一鍵生成：圓×2＋牆 ${take} 件＋探索 ${items.length} 卡（取自還沒上頁的來源商品）`);
    res.json({ ok: true, draft: dj, wallCount: take, exploreCount: items.length, backup: backupName(saved), approvalInvalidated: saved.approvalInvalidated, ...(await ver(id)) });
  }));

  /* 從來源頁（讀不到就用快照的活動清單）挑一檔還在檔期、頁面上沒用過的活動，並實際開活動頁確認在線 */
  const pickLiveActivity = async ({ id, snap, tried, tag, keepImg = "" }) => {
    let cand = [];
    if (snap && snap.sourceUrl) { try { cand = parseBrandPage((await fetchRetry(snap.sourceUrl)).html).promotions || []; } catch (e) { await store.appendLog(id, `${tag}：來源頁重抓失敗（${errText(e)}）——改用快照促銷清單（仍逐一驗頁活）`); } }
    if (!cand.length && snap) cand = snap.promotions || [];
    let shell = 0;
    for (let k = 0; k < 6; k++) {
      const picked = pickLivePromo(cand, tried, nowSec()); if (!picked) break;
      tried.add(normalizeLinkUrl(picked.url));
      try {
        const r = await fetchRetry(picked.url), cl = classifyLiveness(r.html, r.statusCode);
        if (cl.status !== "online" && isShellPage(cl.evidence)) { shell++; await store.appendLog(id, `${tag}：候選 actid ${picked.actid} 遭 Yahoo 殼頁（暫時擋自動驗證）——跳過`); continue; }
        if (cl.status !== "online") { await store.appendLog(id, `${tag}：候選 actid ${picked.actid}「${cutW(picked.title, 12)}」頁面非在線（${cl.status}）——試下一檔`); continue; }
        let img = keepImg; try { const fp = (parseActivityPage(r.html).products || []).find((p) => p && p.imgs && p.imgs[0]); if (fp) img = fp.imgs[0]; } catch (e) { /* 取不到圖不擋 */ }
        return { picked, img, shell };
      } catch (e) { await store.appendLog(id, `${tag}：候選活動頁讀取失敗（${errText(e)}）——試下一檔`); }
    }
    return { picked: null, shell };
  };

  api.post("/runs/:id/explore-fix", wrap(async (req, res) => {
    if (!(await alive(req, res)) || busy(req, res)) return;
    const id = req.params.id, body = req.body || {};
    if (exploreLocks.has(id)) return res.status(409).json({ error: "另一張探索卡正在修復中——等它完成（約 10 秒）再操作" });
    exploreLocks.add(id);
    try {
      const cur = await store.getDraft(id); if (!cur) return res.status(404).json({ error: "草稿還沒有產生", code: "no-doc" });
      const dj = cur.draft, snapR = await store.getJson(id, "snapshot.json"), snap = snapR && snapR.data;
      const items = (((dj.page || {}).explore || {}).items) || [];
      /* 「看更多」按鈕的去向：換成來源頁上還在檔期、頁面上沒用過的活動 */
      if (String(body.target || "") === "more") {
        if (!needFetch(res, "fetchPage")) return;
        const ex = (dj.page || {}).explore || {};
        const tried = new Set((ex.items || []).map((it) => it && it.url).filter(Boolean).map(normalizeLinkUrl)); if (ex.moreUrl) tried.add(normalizeLinkUrl(ex.moreUrl));
        const r = await pickLiveActivity({ id, snap, tried, tag: "看更多修復" });
        if (!r.picked) return res.status(400).json({ needManual: true, error: r.shell ? `目前讀不到來源頁的活動清單（Yahoo 暫時擋住自動驗證，跳過 ${r.shell} 檔）——請稍後再試，或用「手動改連結」自己貼一個。` : "來源頁上目前找不到還在檔期、而且頁面上還沒用過的活動——請用「手動改連結」自己貼一個站內連結。" });
        const before = String(ex.moreUrl || ""), how = `改指向在檔活動「${r.picked.title}」（來源頁實抓、頁面驗證在檔；檔期 ${r.picked.period || "—"}）`;
        const fresh = await store.getDraft(id); fresh.draft.page.explore = { ...(fresh.draft.page.explore || {}), moreUrl: String(r.picked.url) };
        const saved = await save(id, fresh, req, "探索「看更多」去向");
        await store.appendLog(id, `探索「看更多」去向：${before} → ${r.picked.url}（${how}）`);
        return res.json({ ok: true, target: "more", moreUrl: String(r.picked.url), how, draft: fresh.draft, approvalInvalidated: saved.approvalInvalidated, ...(await ver(id)) });
      }
      const append = body.append === true;
      if (append && items.length >= EXPLORE_ITEMS_CAP) return res.status(400).json({ error: `探索入口最多 ${EXPLORE_ITEMS_CAP} 個（桌機一排放得下的上限）——要放更多內容，用品類牆或樓層` });
      if (append && String(body.mode || "") === "manual" && !String(body.label || "").trim()) return res.status(400).json({ error: "新增探索入口要先給「主文案」——卡片上那行粗體字（之後在面板還能改）" });
      const idx = append ? items.length : Number(body.index);
      if (!Number.isInteger(idx) || idx < 0 || (!append && idx >= items.length)) return res.status(400).json({ error: "找不到這張探索卡——請重新整理頁面再試" });
      if (String(body.action || "") === "remove") {
        if (items.length <= 1) return res.status(400).json({ error: "只剩一張探索卡，至少要留一張——要連「延伸探索」整區收掉屬版面調整，請跟負責人說一聲" });
        const removed = items.splice(idx, 1)[0] || {}; dj.page.explore.items = items;
        const saved = await save(id, cur, req, `探索卡 #${idx + 1} 移除`);
        await store.appendLog(id, `探索卡 #${idx + 1} 移除：「${String(removed.label || "")}」→ ${String(removed.url || "")}（剩 ${items.length} 張）`);
        return res.json({ ok: true, removed: true, index: idx, itemsLeft: items.length, backup: backupName(saved), draft: dj, approvalInvalidated: saved.approvalInvalidated, ...(await ver(id)) });
      }
      const item = items[idx] || {};
      /* 整頁已用的目的地（不含這張卡）：同一個目的地整頁只放一次 */
      const used = new Set();
      items.forEach((e, i) => { if (i !== idx && e && e.url) used.add(normalizeLinkUrl(e.url)); });
      if (dj.page.explore && dj.page.explore.moreUrl) used.add(normalizeLinkUrl(dj.page.explore.moreUrl));
      (dj.page.promoEntries || []).forEach((e) => e && e.url && used.add(normalizeLinkUrl(e.url)));
      (((dj.page.editorial || {}).circles) || []).forEach((c) => c && c.url && used.add(normalizeLinkUrl(c.url)));
      (dj.page.floors || []).forEach((f) => f && f.sceneUrl && used.add(normalizeLinkUrl(f.sceneUrl)));

      let next = null, how = "", unsure = "";
      if (body.mode === "manual") {
        const mu = String(body.url || "").trim(), t = classifyLinkTarget(mu);
        if (t.kind === "invalid" || t.kind === "external") return res.status(400).json({ error: "只接受 Yahoo購物中心站內連結（https://tw.buy.yahoo.com/…）——活動頁、搜尋頁或商品頁都可以" });
        if (used.has(normalizeLinkUrl(mu))) return res.status(409).json({ error: "這個連結已用在頁面上其他入口——同一個目的地整頁只放一次，請換一個" });
        if (!needFetch(res, t.kind === "product" ? "productLiveness" : "fetchPage")) return;
        let r0 = null;
        try { // 伺服器實際開過、確認有效才收
          r0 = t.kind === "product" ? null : await deps.fetchPage(mu);
          if (t.kind === "activity") { const c0 = classifyLiveness(r0.html, r0.statusCode);
            if (c0.status !== "online" && isShellPage(c0.evidence)) return res.status(503).json({ error: "Yahoo 暫時擋住了自動驗證（頁面讀不到內容）——請過幾分鐘再試一次" });
            if (c0.status !== "online") return res.status(400).json({ error: c0.status === "dead" ? "這個活動頁打不開——請確認網址" : "這檔活動已結束——請換一檔還在檔期的活動" });
          } else if (t.kind === "search") { const sv = classifySearchLiveness(r0.html, r0.statusCode); // 只有「打不開」才擋；認不出有沒有商品＝收下並請人確認
            if (sv === "dead") return res.status(400).json({ error: "這個頁面打不開——請確認網址能在瀏覽器開啟後再貼一次" });
            if (sv === "unverified") unsure = "（我認不出這頁有沒有商品，已照你貼的收下——請自己點開確認一次）";
          } else if (t.kind === "product") { const c0 = await deps.productLiveness({ gdid: t.gdid, url: mu });
            if (c0.status !== "online") return res.status(400).json({ error: "這件商品目前不能用（已下架或連結失效）——請換一件在售商品", evidence: c0.evidence });
          } else if (r0.statusCode !== 200) return res.status(400).json({ error: `這個連結打不開（HTTP ${r0.statusCode}）——請確認網址能在瀏覽器開啟後再貼` });
        } catch (e) { return res.status(502).json({ error: "讀取這個連結失敗——請確認網址能在瀏覽器打開後再試一次（技術訊息：" + errText(e) + "）" }); }
        next = { label: cutW(body.label || item.label, 12) || item.label || "", sub: cutW(body.sub || item.sub, 14) || (append ? "完整選品一次看" : ""), img: item.img || "", url: mu };
        if (!next.img && r0 && r0.html) { // 卡沒有圖：盡力從剛驗過的頁面拿第一件商品圖；拿不到就留空
          try { const fp = (parseActivityPage(r0.html).products || []).find((p) => p && p.imgs && p.imgs[0]); if (fp) next.img = fp.imgs[0]; } catch (e) { /* 試下一招 */ }
          if (!next.img) { try { const h = (parseListingHits(r0.html) || []).find((x) => x && (x.img || (x.imgs && x.imgs[0]))); if (h) next.img = h.img || h.imgs[0]; } catch (e) { /* 留空 */ } }
        }
        how = unsure ? ("人工填入" + unsure) : "人工填入（伺服器已驗連結有效）";
      } else {
        if (!needFetch(res, "fetchPage")) return;
        const r = await pickLiveActivity({ id, snap, tried: new Set(used), tag: "探索修復", keepImg: item.img || "" });
        if (r.picked) {
          next = { label: cutW(r.picked.title, 12) || item.label || "", sub: "檔期優惠一覽", img: r.img, url: r.picked.url };
          how = `AI 換成在檔活動「${r.picked.title}」（來源頁實抓、頁面驗證在檔；檔期 ${r.picked.period || "—"}）`;
          if (snap && !(snap.promotions || []).some((x) => String(x.actid) === String(r.picked.actid))) { // 新活動記進來源快照，之後檢查對得到
            snap.promotions = (snap.promotions || []).concat([r.picked]);
            snap.warnings = (snap.warnings || []).concat(`探索修復：actid ${r.picked.actid}「${r.picked.title}」＝來源頁重抓在檔活動（${deps.clock.iso()}）`);
            await store.putJson(id, "snapshot.json", snap, { ifMatch: snapR.etag });
          }
        }
        if (!next) { // 退路：用主題詞搜尋，確認有結果才用（自動替人決定時，認不出就不塞）
          const kw = String(dj.page.curationTheme || dj.page.pageName || "").split(/[_｜|]/)[0].trim(), su = "https://tw.buy.yahoo.com/search/product?p=" + encodeURIComponent(kw);
          if (kw && !used.has(normalizeLinkUrl(su))) {
            try { const rS = await fetchRetry(su);
              if (classifySearchLiveness(rS.html, rS.statusCode) === "online") { let img = item.img || "";
                if (!img) { try { const h = (parseListingHits(rS.html) || []).find((x) => x && (x.img || (x.imgs && x.imgs[0]))); if (h) img = h.img || h.imgs[0]; } catch (e) { /* 拿不到圖不擋 */ } }
                next = { label: cutW(`更多${kw}選品`, 12), sub: "搜尋結果一次看", img, url: su }; how = `AI 換成搜尋目的地「${kw}」（來源頁暫無在檔活動；已驗有結果）`; }
            } catch (e) { await store.appendLog(id, `探索修復：搜尋退路驗證失敗（${errText(e)}）`); }
          }
        }
        if (!next) return res.status(409).json({ needManual: true, error: r.shell ? "Yahoo 暫時擋住了自動驗證（候選活動頁讀不到內容）——請過幾分鐘再按一次「AI 換在檔內容」，或改用「手動改連結」"
          : "來源頁目前沒有還在檔期的活動、主題搜尋也沒有結果——請用「手動改連結」貼一個站內連結（活動頁／搜尋頁／商品頁都可以）" });
      }
      /* 驗連結要幾秒，這段時間草稿可能被存過：重讀最新的草稿，只把這張卡放上去 */
      const fresh = await store.getDraft(id), itemsW = (((fresh.draft.page || {}).explore || {}).items) || [];
      if (append) {
        if (!fresh.draft.page || !fresh.draft.page.explore) return res.status(409).json({ error: "這檔目前沒有「延伸探索」區塊——先到「編輯精選」按「一鍵生成」把整區補上，再來新增入口" });
        if (itemsW.length >= EXPLORE_ITEMS_CAP) return res.status(409).json({ error: `探索入口已滿 ${EXPLORE_ITEMS_CAP} 個（操作期間有別的變更）——請重新整理頁面確認` });
        itemsW.push(next); fresh.draft.page.explore.items = itemsW;
      } else { if (idx >= itemsW.length) return res.status(409).json({ error: "探索卡數量已變動（可能剛重新生成過）——請到「發佈前檢查」按「重新檢查」更新報告後再操作" }); itemsW[idx] = next; }
      const saved = await save(id, fresh, req, append ? `探索卡 #${idx + 1} 新增` : `探索卡 #${idx + 1} 連結修復`);
      await reconcileCheck(id, fresh.draft);
      await store.appendLog(id, append ? `探索卡 #${idx + 1} 新增：${how}→${next.url}（共 ${itemsW.length} 張）` : `探索卡 #${idx + 1} 連結修復：${how}→${next.url}`);
      res.json({ ok: true, index: idx, item: next, how, appended: append, itemsCount: itemsW.length, draft: fresh.draft, backup: backupName(saved), approvalInvalidated: saved.approvalInvalidated, ...(await ver(id)) });
    } finally { exploreLocks.delete(id); }
  }));
}
module.exports = { mountEditMore, autoPickFromPool, EXPLORE_ITEMS_CAP };
