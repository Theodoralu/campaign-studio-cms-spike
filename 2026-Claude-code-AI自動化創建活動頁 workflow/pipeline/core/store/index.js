"use strict";
/**
 * core/store/index.js —— RunStore：一檔活動的資料放哪、怎麼安全地存（D11，2026-11-18）
 *
 * 一檔活動（run）＝一組檔：wb_meta.json（狀態）、snapshot.json（來源快照）、draft.json（草稿）、gate_report.json、product_check.json、
 * feedback_patch.json、wb.log、export/…。單機版把它們放在 runs/<id>/ 資料夾，server.js 到處直接讀寫。
 * 這裡把「放哪」抽成後端（fs_backend＝本機資料夾，擺法與單機版相同；s3_backend＝S3），把「怎麼安全地存」寫成一份、兩個後端共用：
 *
 *   1. 舊版存檔 409：存草稿要帶「我是從哪一版改的」（ifMatch＝讀取時拿到的 etag）。伺服器那份已經不是那一版＝ConflictError（409）＋最新版，不落盤。
 *      比對與寫入是同一步（後端的條件式寫入），兩個人同時按儲存只會有一個成功。
 *   2. 真值欄照伺服器：畫面存檔時，商品的品名／價格／劃線價／連結／優惠原文以伺服器為準（truth_fields.js），改了哪些回報給呼叫端。
 *   3. 內容指紋與核可失效：核可記下當時的內容指紋（fingerprint.js）。之後草稿內容變了＝核可失效（清 approvedAt、留 approvedAtPrev、寫 log）；
 *      內容沒變的存檔不動核可。approvalState() 另外再比一次指紋——就算清旗標那一步沒寫成，內容對不上的核可也不算數。
 *   4. 留舊版：每次覆寫草稿都留得回上一版（fs＝draft.vN.json；S3＝bucket 版本控管）。
 *
 * 還沒接：server.js 仍直接讀寫 runs/（216 處）；D13 的路由與背景工作改用這裡。
 */
const { fingerprint } = require("./fingerprint");
const { enforceProductTruth, PRODUCT_TRUTH_FIELDS } = require("./truth_fields");
const { createFsBackend } = require("./fs_backend");
const { createS3Backend, awsS3Client } = require("./s3_backend");

class ConflictError extends Error { constructor(message, code, extra) { super(message); this.name = "ConflictError"; this.status = 409; this.code = code; Object.assign(this, extra || {}); } }
class NotFoundError extends Error { constructor(message) { super(message); this.name = "NotFoundError"; this.status = 404; this.code = "not-found"; } }
const isPre = (e) => e && e.code === "PreconditionFailed";
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,80}$/;
const ser = (o) => JSON.stringify(o, null, 1); // 與單機版落檔格式相同

function createRunStore(backend, { clock = null } = {}) {
  const nowIso = () => (clock ? clock.iso() : new Date().toISOString());
  const K = (id, name) => { if (!ID_RE.test(String(id))) throw new Error("活動編號格式不對：" + id); return `${id}/${name}`; };

  async function getText(id, name) { return backend.get(K(id, name)); }
  async function putText(id, name, text, opts = {}) {
    try { return await backend.put(K(id, name), text, opts); }
    catch (e) { if (isPre(e)) throw new ConflictError(`${name} 已被別人更新，這次沒有存入`, "stale-write", { name }); throw e; }
  }
  async function getJson(id, name) { const r = await getText(id, name); return r ? { data: JSON.parse(r.text), etag: r.etag, versionId: r.versionId } : null; }
  async function putJson(id, name, data, opts = {}) { return putText(id, name, ser(data), opts); }

  /** 讀→改→帶版本寫回；撞到別人先寫就重讀重試（狀態檔、log 這種「大家都在加東西」的檔用） */
  async function update(id, name, fn, { tries = 40, json = true } = {}) {
    for (let i = 0; i < tries; i++) {
      const cur = await getText(id, name);
      const next = fn(cur ? (json ? JSON.parse(cur.text) : cur.text) : null);
      if (next === undefined) return cur ? (json ? JSON.parse(cur.text) : cur.text) : null; // fn 說不用改
      try { await backend.put(K(id, name), json ? ser(next) : next, cur ? { ifMatch: cur.etag } : { ifNoneMatch: "*" }); return next; }
      catch (e) { if (!isPre(e)) throw e; }
      await new Promise((r) => setTimeout(r, Math.random() * 4 * (i + 1))); // 錯開重試，免得同一批寫入一直互撞
    }
    throw new ConflictError(`${name} 寫入一直被別的寫入插隊（重試 ${tries} 次）`, "busy", { name });
  }

  const readMeta = async (id) => { const r = await getJson(id, "wb_meta.json"); return r ? r.data : null; };
  const patchMeta = (id, patch) => update(id, "wb_meta.json", (m) => {
    const p = typeof patch === "function" ? patch(m || {}) : patch;
    return p === undefined ? undefined : { ...(m || {}), ...p, updatedAt: nowIso() };
  });
  const appendLog = (id, line) => update(id, "wb.log", (t) => (t || "") + `[${nowIso()}] ${line}\n`, { json: false });
  const readLog = async (id) => { const r = await getText(id, "wb.log"); return r ? r.text : ""; };

  async function createRun(id, meta = {}) {
    const t = nowIso();
    try { await backend.put(K(id, "wb_meta.json"), ser({ id, createdAt: t, ...meta, updatedAt: t }), { ifNoneMatch: "*" }); }
    catch (e) { if (isPre(e)) throw new ConflictError(`活動 ${id} 已經存在`, "run-exists"); throw e; }
    return readMeta(id);
  }
  async function listRuns() { return (await backend.children("")).filter((n) => ID_RE.test(n) && !n.startsWith("_")).sort().reverse(); }
  const deleteRun = (id) => backend.del(K(id, "").replace(/\/$/, ""));

  async function getDraft(id) { const r = await getJson(id, "draft.json"); return r ? { draft: r.data, etag: r.etag, versionId: r.versionId, fingerprint: fingerprint(r.data) } : null; }

  /**
   * 存草稿。source："client"＝畫面存檔（要帶 ifMatch、真值欄照伺服器）｜"system"＝系統寫入（建立、收尾、價格對真、換品；不過真值欄那關）。
   * 回 { etag, fingerprint, versionId, changed, corrected, approvalInvalidated }。版本不符丟 ConflictError（code: stale-draft，帶 latest）。
   */
  async function saveDraft(id, draft, { ifMatch = null, source = "client", actor = null, note = "" } = {}) {
    if (!draft || !draft.page || !Array.isArray(draft.products)) throw Object.assign(new Error("儲存的內容不完整，這次沒有存入"), { status: 400, code: "bad-draft" });
    const cur = await getDraft(id);
    const stale = (latest) => new ConflictError("草稿已經被更新過，這次沒有存入——已換成最新版，請再改一次", "stale-draft", { latest });
    if (source === "client" && cur && ifMatch == null) throw new ConflictError("存檔沒有帶版本（請重新整理頁面後再改一次）", "missing-base", { latest: cur });
    if (ifMatch != null && (!cur || cur.etag !== ifMatch)) { await appendLog(id, `草稿存檔被擋：${actor || source} 手上的版本不是最新版——不蓋、回最新版`); throw stale(cur); }
    let corrected = [];
    if (source === "client") {
      const snap = await getJson(id, "snapshot.json");
      corrected = enforceProductTruth(draft, { serverDraft: cur && cur.draft, snapshot: snap && snap.data });
    }
    let put;
    try { put = await backend.put(K(id, "draft.json"), ser(draft), cur ? { ifMatch: cur.etag, keepVersion: true } : { ifNoneMatch: "*" }); }
    catch (e) { if (isPre(e)) { await appendLog(id, `草稿存檔被擋：${actor || source} 與另一筆存檔同時到，後到的不蓋`); throw stale(await getDraft(id)); } throw e; }
    const fp = fingerprint(draft), changed = !cur || fp !== cur.fingerprint;
    let approvalInvalidated = false;
    if (changed) {
      const t = nowIso();
      await patchMeta(id, (m) => {
        const p = source === "system" ? { sysDraftWriteAt: Date.parse(t) } : {};
        if (m.approvedAt) { approvalInvalidated = true; Object.assign(p, { approvedAt: null, approvalInvalidatedAt: t, approvedAtPrev: m.approvedAt }); }
        return Object.keys(p).length ? p : undefined;
      });
    }
    const back = put.versionId ? `；上一版可還原（${backend.kind === "fs" ? "draft.v" + put.versionId + ".json" : "版本 " + put.versionId}）` : "";
    await appendLog(id, `草稿存檔（${actor || source}${note ? "：" + note : ""}）${changed ? "" : "：內容沒變"}${back}`);
    if (corrected.length) await appendLog(id, `真值欄照伺服器：${corrected.length} 欄改回伺服器的值（${corrected.slice(0, 5).map((c) => `gdid ${c.gdid} ${c.field}`).join("、")}${corrected.length > 5 ? "…" : ""}）`);
    if (approvalInvalidated) await appendLog(id, "核可失效：核可後內容有變更，需重新檢查並核可");
    return { etag: put.etag, fingerprint: fp, versionId: put.versionId, changed, corrected, approvalInvalidated };
  }

  /** 核可＝鎖這一版內容。expectFingerprint＝核可者畫面上看到的那一版；對不上＝他看的不是現在這份，不給核可。 */
  async function approve(id, { by, expectFingerprint = null, extra = {} } = {}) {
    const cur = await getDraft(id);
    if (!cur) throw new NotFoundError(`活動 ${id} 還沒有草稿`);
    if (expectFingerprint && expectFingerprint !== cur.fingerprint) throw new ConflictError("草稿在你檢視之後有變更，這次沒有核可——請重新檢查後再核可", "approve-stale", { latest: cur });
    const t = nowIso();
    await patchMeta(id, { approvedAt: t, approvedBy: by || null, approvedFingerprint: cur.fingerprint, approvalInvalidatedAt: null, ...extra });
    await appendLog(id, `核可：${by || "（未具名）"} 核可內容版本 ${cur.fingerprint}`);
    return { approvedAt: t, approvedBy: by || null, fingerprint: cur.fingerprint };
  }
  /** 現在算不算已核可：要有 approvedAt，而且核可時的指紋＝現在草稿的指紋 */
  async function approvalState(id) {
    const [m, cur] = [await readMeta(id), await getDraft(id)];
    const fp = cur ? cur.fingerprint : null;
    const flagged = !!(m && m.approvedAt);
    const matches = !!(flagged && m.approvedFingerprint && m.approvedFingerprint === fp);
    return { approved: flagged && matches, approvedAt: (m && m.approvedAt) || null, approvedBy: (m && m.approvedBy) || null, fingerprint: fp, approvedFingerprint: (m && m.approvedFingerprint) || null, stale: flagged && !matches };
  }

  const listDraftVersions = (id) => backend.versions(K(id, "draft.json"));
  async function getDraftVersion(id, versionId) { const r = await backend.getVersion(K(id, "draft.json"), versionId); return r ? { draft: JSON.parse(r.text), versionId, fingerprint: fingerprint(JSON.parse(r.text)) } : null; }

  return { backend, kind: backend.kind, listRuns, createRun, deleteRun, readMeta, patchMeta, appendLog, readLog, getJson, putJson, getText, putText, getDraft, saveDraft, approve, approvalState, listDraftVersions, getDraftVersion };
}

const createFsRunStore = (runsDir, opts) => createRunStore(createFsBackend(runsDir), opts);
const createS3RunStore = ({ client, bucket, prefix = "runs" }, opts) => createRunStore(createS3Backend({ client, bucket, prefix }), opts);
/** 依環境變數選後端：CS_STORE=fs（預設；CS_RUNS_DIR）｜s3（CS_S3_BUCKET、CS_S3_PREFIX、CS_S3_ENDPOINT＝MinIO 用、AWS_REGION） */
function storeFromEnv(env = process.env, opts) {
  if ((env.CS_STORE || "fs") === "s3") {
    if (!env.CS_S3_BUCKET) throw new Error("CS_STORE=s3 需要設定 CS_S3_BUCKET");
    return createS3RunStore({ client: awsS3Client({ region: env.AWS_REGION, endpoint: env.CS_S3_ENDPOINT || undefined }), bucket: env.CS_S3_BUCKET, prefix: env.CS_S3_PREFIX || "runs" }, opts);
  }
  if (!env.CS_RUNS_DIR) throw new Error("CS_STORE=fs 需要設定 CS_RUNS_DIR（活動資料夾）");
  return createFsRunStore(env.CS_RUNS_DIR, opts);
}

module.exports = { createRunStore, createFsRunStore, createS3RunStore, storeFromEnv, awsS3Client, ConflictError, NotFoundError, fingerprint, PRODUCT_TRUTH_FIELDS };
