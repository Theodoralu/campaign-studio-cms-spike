"use strict";
/**
 * cms/pipeline.js —— 主流程的四件工作（D13）：把 D6–D11 的零件串起來，資料一律經 RunStore。
 *
 *   createRun    建立：認網址 → uther 取商品 → 規則版策展 → 收尾（版式、自訂色、價格對真）→ 快檢 → ready
 *   runGate      發佈前檢查（快檢／全檢）
 *   runProductCheck 商品狀態檢查（uther 層；有給 productLiveness 就走商品頁層）
 *   exportHtml   製作 HTML 檔：商品狀態 → 全檢 → 組檔 → 顯示檢查 → 落檔
 *
 * 每件工作只靠傳進來的 deps 碰外面：uther（取商品）、pickCircleImg（挑圖要探圖片）、verifyHtml（開 Chrome）、publisher（發布；預設不做）。
 * 進度寫在狀態檔：建立＝meta.stage（fetching → curating → gating → ready｜error）；製作＝meta.exportAem.stage。
 * 訊息文字盡量沿單機版（前端認這些字）。
 */
const path = require("path");
const PIPE = path.join(__dirname, "..");
const { resolveSource } = require(path.join(PIPE, "core", "source", "resolve"));
const { buildSnapshot } = require(path.join(PIPE, "core", "source", "build_snapshot"));
const { createRulesEngine, CurateError } = require(path.join(PIPE, "core", "curate"));
const finish = require(path.join(PIPE, "core", "finish"));
const gate = require(path.join(PIPE, "core", "gate"));
const exp = require(path.join(PIPE, "core", "export"));
const { utherLayer, pageLayer, buildCheck } = require(path.join(PIPE, "core", "product-truth", "layers"));
const { blockingCount, blockMessage } = require(path.join(PIPE, "core", "product-truth", "rows"));

const errText = (e) => String((e && e.message) || e);

/** 存進 RunStore 的原文＝檢查報告指紋的依據（報告記的是「檢查的是哪一份檔」） */
async function gateOnStored({ store, id, skipHttp }) {
  const [snap, draft, meta, patch] = [await store.getText(id, "snapshot.json"), await store.getText(id, "draft.json"), await store.readMeta(id), await store.getJson(id, "feedback_patch.json")];
  if (!snap || !draft) throw new Error("這檔活動缺少快照或草稿，無法檢查");
  const report = await gate.check({ snapRaw: snap.text, draftRaw: draft.text, meta, themeFitRule: patch && patch.data.themeFitRule, skipHttp });
  await store.putJson(id, "gate_report.json", report);
  await store.appendLog(id, `發佈前檢查（${skipHttp ? "快檢：跳過圖片連線" : "全檢"}）：${report.result}（FAIL ${report.counts.FAIL}／WARN ${report.counts.WARN}）`);
  return report;
}

async function createRun({ store, id, input, deps }) {
  const { uther, clock, fetchBrandId, pickCircleImg, layoutOverridePaths } = deps;
  const stage = (s, extra = {}) => store.patchMeta(id, { stage: s, ...extra });
  try {
    const plan = resolveSource(input.url);
    if (["invalid", "unsupported", "product"].includes(plan.kind)) throw Object.assign(new Error(plan.reason), { friendly: true });
    await store.appendLog(id, `建立開始：來源判型 ${plan.kind}（商品資料走 uther）`);
    const snapshot = await buildSnapshot(plan, { uther, clock, fetchBrandId, log: () => {} });
    await store.putJson(id, "snapshot.json", snapshot);
    await store.appendLog(id, `商品池：${snapshot.products.length} 件（uther 請求 ${uther.calls ? uther.calls.length : "?"} 次）${(snapshot.warnings || []).length ? "；提醒 " + snapshot.warnings.length + " 則" : ""}`);

    await stage("curating");
    const tf = finish.themeFitPatch({ theme: input.theme, sourceUrl: input.url, pageTitle: snapshot.brand || "" });
    if (tf.patch) await store.putJson(id, "feedback_patch.json", tf.patch);
    const engine = createRulesEngine({ pickCircleImg });
    /* excludeOutOfStock：uther 快照帶庫存狀態，售完／停售的不進池（D8 留的洞，CMS 打開）。不擋的話它會被排上頁面，到製作時才被商品狀態檢查擋下來。 */
    /* 主打預留件數＝這款版式主視覺放幾件（單機版三個策展呼叫點都帶；不帶的話四件槽版式的第 4 格會吃到第 1 層的代表品） */
    const layoutLib = require(path.join(PIPE, "lib", "layout_choice.js"));
    const hc = input.kvVariant ? layoutLib.heroCountArgs(input.kvVariant, layoutOverridePaths || {}) : { args: [], note: null };
    if (hc.note) await store.appendLog(id, hc.note);
    const cur = await engine.curate(snapshot, { runId: id, scenario: input.scenario, theme: input.theme, pageName: input.pageName, heroCount: hc.args && hc.args.length ? hc.count : undefined, themeFitRule: tf.patch ? tf.patch.themeFitRule : undefined, excludeOutOfStock: true });
    for (const n of cur.notes || []) await store.appendLog(id, "策展提醒：" + n);

    // 收尾：版式、自訂色、主題橋接＋建立期價格對真（uther 層：只比實付價與在售；劃線價 uther 沒有）
    const startedAt = clock.iso();
    const live = await utherLayer(cur.draft.products.map((p) => String(p.gdid)), { uther, clock });
    const chk = buildCheck(cur.draft, snapshot, live, { layer: "uther", clock });
    const fin = finish.finishDraft({ draft: cur.draft, snapshot, input, rows: chk.results, checkedAt: chk.checkedAt, ctx: { priceTruthMode: "uther", startedAt, finishedAt: clock.iso(), layoutOverridePaths } });
    /* 收尾的訊息文字沿單機版寫「商品頁」；這條路比的是 uther，照實改字，免得看 log 的人以為開過商品頁 */
    const utherWording = (l) => l.replace(/商品頁現價/g, "uther 現價").replace(/與商品頁一致/g, "與 uther 一致").replace(/連上商品頁/g, "從 uther 查到");
    for (const l of fin.logs) await store.appendLog(id, /價格/.test(l) ? utherWording(l) : l);
    await store.putJson(id, "snapshot.json", fin.snapshot);
    await store.putJson(id, "product_check.json", chk);
    await store.saveDraft(id, fin.draft, { source: "system", note: "建立" });
    await store.patchMeta(id, { engineUsed: "rules", ...fin.meta });

    await stage("gating");
    await gateOnStored({ store, id, skipHttp: true });
    await stage("ready", { error: null });
  } catch (e) {
    const msg = e && (e.friendly || e instanceof CurateError) ? errText(e) : `建立時發生問題，請再試一次；連續失敗請聯絡系統管理員（技術訊息：${errText(e).slice(0, 160)}）`;
    await store.appendLog(id, "建立失敗：" + errText(e) + (e && e.traceId ? `（uther traceId ${e.traceId}）` : ""));
    await stage("error", { error: msg });
  }
}

/* deps.offline＝不連外（測試用）：全檢也跳過圖片連線檢查，報告裡會留一行「已跳過」 */
const runGate = ({ store, id, full, deps = {} }) => gateOnStored({ store, id, skipHttp: !full || !!deps.offline });

/**
 * 商品狀態檢查。兩層（P40）：
 *   uther 層——只比實付價與在售，快（一次查完）。建立期用這層。
 *   商品頁層——逐件打開商品頁，比實付價、劃線價、在售；慢（幾十秒）但才是最終真值。核可前與製作時用這層。
 * 預設：有接商品頁探測（deps.productLiveness）就走商品頁層；layer:"uther" 可指定只查 uther。
 * 進度寫在 meta.productCheck（running → done｜error），畫面輪詢狀態。
 */
async function runProductCheck({ store, id, deps, layer = null }) {
  const { uther, clock, productLiveness, mapPool, gdidOf } = deps;
  const use = layer || (productLiveness ? "page" : "uther");
  if (use === "page" && !productLiveness) throw new Error("這台伺服器沒有接商品頁探測，不能做商品頁層的檢查");
  await store.patchMeta(id, { productCheck: { stage: "running", layer: use, startedAt: clock.iso(), finishedAt: null, error: null } });
  try {
    const [d, s] = [await store.getDraft(id), await store.getJson(id, "snapshot.json")];
    if (!d) throw new Error("這檔活動還沒有草稿");
    const live = use === "page" ? await pageLayer(d.draft.products, { productLiveness, mapPool, gdidOf }) : await utherLayer(d.draft.products.map((p) => String(p.gdid)), { uther, clock });
    const chk = buildCheck(d.draft, s && s.data, live, { layer: use, clock });
    chk.draftFingerprint = d.fingerprint; // 這份報告查的是哪一版草稿
    await store.putJson(id, "product_check.json", chk);
    const sm = chk.summary || {};
    await store.appendLog(id, `商品狀態檢查（${use === "page" ? "商品頁" : "uther"}）：${chk.results.length} 件；要處理 ${blockingCount(sm, 0)} 件`);
    await store.patchMeta(id, { productCheck: { stage: "done", layer: use, finishedAt: clock.iso(), total: chk.results.length, blocking: blockingCount(sm, 0), error: null } });
    return chk;
  } catch (e) {
    await store.appendLog(id, "商品狀態檢查失敗：" + errText(e));
    await store.patchMeta(id, { productCheck: { stage: "error", layer: use, finishedAt: clock.iso(), error: "商品狀態檢查沒有跑完，請再試一次" } });
    throw e;
  }
}

/**
 * 套用商品頁現價：把最近一份商品狀態報告裡「在售但價格不同」的商品，價格與劃線價改成商品頁的值（快照與草稿同時改）。
 * 改了內容＝核可失效（RunStore 自動處理）。uther 沒有劃線價，所以第一次做商品頁層檢查後，劃線價要靠這一步補進草稿。
 */
async function applyLivePrices({ store, id, actor }) {
  const { applyPriceTruth } = require(path.join(PIPE, "lib", "price_truth.js"));
  const { patchSnapshotPrice, summary } = require(path.join(PIPE, "core", "product-truth", "rows"));
  const [pc, cur, snap] = [await store.getJson(id, "product_check.json"), await store.getDraft(id), await store.getJson(id, "snapshot.json")];
  if (!pc || !Array.isArray(pc.data.results)) throw Object.assign(new Error("找不到商品狀態報告——請先按「重新檢查」再套用"), { status: 409, code: "no-check" });
  if (pc.data.draftFingerprint && pc.data.draftFingerprint !== cur.fingerprint) throw Object.assign(new Error("草稿在檢查之後有變更——請先重新檢查再套用"), { status: 409, code: "check-stale" });
  const rows = pc.data.results.filter((r) => r.status === "online" && (r.drift || r.snapDrift) && r.livePrice != null);
  if (!rows.length) return { count: 0, applied: [], approvalInvalidated: false };
  const r = applyPriceTruth({ snap: snap.data, draft: cur.draft, rows, checkedAt: pc.data.checkedAt, patchSnapshotPrice });
  await store.putJson(id, "snapshot.json", snap.data);
  const saved = await store.saveDraft(id, cur.draft, { ifMatch: cur.etag, source: "system", actor, note: `套用商品頁現價 ${r.applied.length} 件` });
  const done = new Set(r.applied.map((a) => String(a.gdid)));
  for (const row of pc.data.results) if (done.has(String(row.gdid))) { row.draftPrice = row.livePrice; row.snapPrice = row.livePrice; row.drift = false; row.marketDrift = false; row.snapDrift = false; delete row.draftMarketPrice; }
  pc.data.summary = summary(pc.data.results); pc.data.draftFingerprint = saved.fingerprint;
  await store.putJson(id, "product_check.json", pc.data);
  for (const a of r.applied.slice(0, 50)) await store.appendLog(id, `價格改用商品頁現價：gdid ${a.gdid} $${a.from.price}→$${a.to.price}${a.to.marketPrice ? `、原價 ${a.to.marketPrice}` : a.from.marketPrice ? "、原價移除" : ""}`);
  await store.patchMeta(id, (m) => ({ productCheck: { ...(m.productCheck || {}), blocking: blockingCount(pc.data.summary, 0) } }));
  return { count: r.applied.length, applied: r.applied, approvalInvalidated: saved.approvalInvalidated, fingerprint: saved.fingerprint };
}

/** 製作 HTML 檔。三關沿單機版：⓪商品狀態 ①全檢 ②組檔 ③顯示檢查。沒過任何一關＝不交付。 */
async function exportHtml({ store, id, deps }) {
  const { clock, verifyHtml, assetRoots, publisher = null } = deps;
  const set = (patch) => store.patchMeta(id, (m) => ({ exportAem: { ...(m.exportAem || {}), ...patch } }));
  /* 開新一輪＝把上一輪的結果欄清掉；不清的話製作途中看狀態，會看到上一輪的完成時間、大小、發布網址混在這一輪的進度裡 */
  await set({ stage: "product_check", startedAt: clock.iso(), error: null, file: null, bytes: null, budget: null, finishedAt: null, fingerprint: null, published: null, publishError: null });
  try {
    await store.appendLog(id, "網頁檔製作啟動：⓪ 商品狀態檢查");
    const pc = await runProductCheck({ store, id, deps });
    const bad = blockingCount(pc.summary, 0);
    if (bad > 0) return void (await set({ stage: "error", error: blockMessage(pc.summary, bad, "製作") }));
    await set({ stage: "gate_full" });
    const g = await gateOnStored({ store, id, skipHttp: !!deps.offline });
    if (g.counts.FAIL > 0) return void (await set({ stage: "error", error: "合規檢查發現必修問題，已停止製作（把關交付品質）——請開「發佈前檢查」清單修正必修項目後再製作" }));
    await set({ stage: "build" });
    const cur = await store.getDraft(id), meta = await store.readMeta(id);
    let built;
    try { built = await exp.buildAem({ id, draft: cur.draft, meta, assetRoots, onWarn: (m) => store.appendLog(id, m) }); }
    catch (e) { await store.appendLog(id, "網頁檔組裝失敗：" + errText(e)); return void (await set({ stage: "error", error: exp.friendlyBuildError(e) })); }
    for (const l of exp.buildLogs(built.fileName, built.report)) await store.appendLog(id, l);
    await set({ stage: "verify" });
    const v = await verifyHtml({ slimHtml: built.slimHtml, fullHtml: built.fullHtml, layout: built.layout, fileName: built.fileName });
    if (!v.ok) { await store.appendLog(id, "顯示檢查沒過：" + String(v.detail || "").slice(-800)); return void (await set({ stage: "error", error: "做好的網頁檔顯示檢查沒有通過（瘦身後的頁面與原版不一致、或有程式錯誤），已停止製作——沒過檢查的檔不交付；請再試一次，連續失敗請聯絡系統管理員（技術訊息已保存）" })); }
    const bytes = Buffer.byteLength(built.slimHtml), now = clock.iso();
    await store.putText(id, `export/aem/${built.fileName}`, built.slimHtml);
    await store.putJson(id, "export/aem/aem-build-report.json", built.report);
    await store.putJson(id, "export/aem/aem-verify.json", v.report || {});
    await store.putText(id, "export/aem/README.txt", exp.readme({ id, pageName: (cur.draft.page || {}).pageName, bytes, budget: built.report.aemBudget || null, hosts: (v.report && v.report.externalHosts) || [], now }));
    /* 發布（cms/publisher.js；ECSEARCH-39133 的前半段試作）：沒有 publisher＝只產檔。
       發布失敗不算製作失敗——檔案已經做好、可以下載；狀態記下 publishError，畫面要另外提示「做好了但還沒發布」。 */
    let published = null, publishError = null;
    if (publisher) {
      try { published = await publisher.publish({ id, fileName: built.fileName, html: built.slimHtml }); await store.appendLog(id, `已發布：${published.bucket}/${published.key}${published.url ? " → " + published.url : ""}`); }
      catch (e) { publishError = "網頁檔做好了，但發布沒有成功——可以先下載，或稍後重新製作再試一次"; await store.appendLog(id, "發布失敗：" + errText(e)); }
    }
    await set({ stage: "done", file: built.fileName, bytes, budget: built.report.aemBudget || null, finishedAt: now, fingerprint: cur.fingerprint, published, publishError });
    await store.appendLog(id, `網頁檔製作完成：export/aem/${built.fileName}（${Math.round(bytes / 1024)} KB）`);
  } catch (e) {
    await store.appendLog(id, "網頁檔製作失敗：" + errText(e));
    await set({ stage: "error", error: `製作時發生問題，請再試一次；連續失敗請聯絡系統管理員（技術訊息：${errText(e).slice(0, 160)}）` });
  }
}

/** 用真 Chrome 跑 aem_verify.js（正式用）。檔案先落系統暫存夾，比完就刪。 */
function chromeVerify() {
  const fs = require("fs"), os = require("os"), { spawn } = require("child_process");
  return ({ slimHtml, fullHtml, layout, fileName }) => new Promise((resolve) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cs-verify-"));
    const slim = path.join(dir, fileName), full = path.join(dir, "_reference-full.html"), out = path.join(dir, "aem-verify.json");
    fs.writeFileSync(slim, slimHtml); fs.writeFileSync(full, fullHtml);
    const ch = spawn(process.execPath, [path.join(PIPE, "aem_verify.js"), slim, layout, "--ref", full, "--out", out], { cwd: PIPE });
    const bufs = []; ch.stdout.on("data", (d) => bufs.push(d)); ch.stderr.on("data", (d) => bufs.push(d));
    const done = (code) => { let report = null; try { report = JSON.parse(fs.readFileSync(out, "utf8")); } catch (e) { /* 沒產報告＝照 exit code 判 */ } fs.rmSync(dir, { recursive: true, force: true }); resolve({ ok: code === 0, report, detail: Buffer.concat(bufs).toString("utf8") }); };
    ch.on("error", (e) => { bufs.push(Buffer.from(String(e))); done(1); }); ch.on("close", done);
  });
}

module.exports = { createRun, runGate, runProductCheck, applyLivePrices, exportHtml, chromeVerify };
