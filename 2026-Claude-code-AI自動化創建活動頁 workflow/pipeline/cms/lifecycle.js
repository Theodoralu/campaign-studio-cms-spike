"use strict";
/**
 * cms/lifecycle.js —— 一檔活動的去留：刪除（進垃圾桶）、還原、永久刪除、清空垃圾桶、封存、移回（D14 第三段，2026-11-27）
 *
 * 來源：workbench/server.js 的 DELETE /api/runs/:id、/api/runs-deleted/*、archive／unarchive。網址與回應形狀沿單機版（舊畫面認得）。
 *
 * 與單機版不同的地方：
 *   - 單機版把資料夾搬到 runs/_deleted/；這裡不搬資料，只在狀態檔記 deletedAt（S3 沒有「搬資料夾」這種便宜操作，兩種後端同一套做法）。
 *     列表不列出有 deletedAt 的；垃圾桶只列有 deletedAt 的。
 *   - archivedName 沿單機版的樣子 `<活動編號>__deleted-<時間>`，畫面拿它當還原與永久刪除的代號。
 *   - 單機版刪除時會順手撤掉內網上線頁；新伺服器沒有內網上線（不搬）。已發布到 S3 的頁面目前不會跟著撤（發布端規劃未定，記在 docs/frontend-D14.md）。
 */
const KEEP_DAYS = Math.max(1, Number(process.env.CAMPAIGN_TRASH_DAYS) || 30);
const nameOf = (id, deletedAt) => `${id}__deleted-${String(deletedAt).replace(/[:.]/g, "-")}`;
const idOf = (archivedName) => String(archivedName).split("__deleted-")[0];

function mountLifecycle(api, { store, jobs, deps, wrap }) {
  const nowMs = () => Date.parse(deps.clock.iso());
  const trashed = async () => { const out = []; for (const id of await store.listRuns({ includeDeleted: true })) { const m = await store.readMeta(id); if (m && m.deletedAt) out.push({ id, meta: m }); } return out; };
  /* 進垃圾桶滿 KEEP_DAYS 天＝永久刪除。不掛計時器：列垃圾桶時順手清（沿單機版） */
  const sweep = async () => { let n = 0; for (const t of await trashed()) if ((nowMs() - Date.parse(t.meta.deletedAt)) / 86400000 >= KEEP_DAYS) { await store.deleteRun(t.id); n++; } return n; };

  api.delete("/runs/:id", wrap(async (req, res) => {
    const id = req.params.id, m = await store.readMeta(id);
    if (!m || m.deletedAt) return res.status(404).json({ error: "找不到這個活動——可能已經刪除了，請重新整理頁面", code: "no-run" });
    if (jobs.busy(id)) return res.status(409).json({ error: "這個活動還在處理中，暫時不能刪除——等它完成或失敗後就可以刪", code: "busy" });
    const d = await store.getDraft(id), deletedAt = deps.clock.iso();
    await store.patchMeta(id, { deletedAt, deletedBy: req.user.email, deletedPageName: (d && d.draft.page && d.draft.page.pageName) || "" });
    await store.appendLog(id, `刪除（進垃圾桶，${KEEP_DAYS} 天內可還原）：${req.user.email}`);
    res.json({ ok: true, archivedName: nameOf(id, deletedAt), liveRemoved: false, note: `已移到垃圾桶，${KEEP_DAYS} 天內可以還原。` });
  }));
  api.get("/runs-deleted", wrap(async (req, res) => {
    await sweep();
    const list = (await trashed()).map(({ id, meta }) => ({ archivedName: nameOf(id, meta.deletedAt), id, deletedAt: meta.deletedAt, deletedBy: meta.deletedBy || null, pageName: meta.deletedPageName || "",
      daysLeft: Math.max(0, KEEP_DAYS - Math.floor((nowMs() - Date.parse(meta.deletedAt)) / 86400000)), keepDays: KEEP_DAYS }));
    res.json(list.sort((a, b) => String(b.deletedAt).localeCompare(String(a.deletedAt))));
  }));
  api.post("/runs-deleted/purge", wrap(async (req, res) => { let n = 0; for (const t of await trashed()) { await store.deleteRun(t.id); n++; } res.json({ ok: true, purged: n }); }));
  const inTrash = async (req, res) => { const id = idOf(req.params.name), m = await store.readMeta(id); if (!m || !m.deletedAt) { res.status(404).json({ error: "垃圾桶裡沒有這一檔——可能已經清掉或還原了。", code: "not-in-trash" }); return null; } return { id, m }; };
  api.delete("/runs-deleted/:name", wrap(async (req, res) => { const x = await inTrash(req, res); if (!x) return; await store.deleteRun(x.id); res.json({ ok: true, archivedName: req.params.name }); }));
  api.post("/runs-deleted/:name/restore", wrap(async (req, res) => {
    const x = await inTrash(req, res); if (!x) return;
    await store.patchMeta(x.id, { deletedAt: null, deletedBy: null, deletedPageName: null });
    await store.appendLog(x.id, `自垃圾桶還原：${req.user.email}`);
    res.json({ ok: true, id: x.id });
  }));

  /* 封存＝移出活動總覽、放到「歷史與封存」；資料與狀態都不動 */
  const alive = async (req, res) => { const m = await store.readMeta(req.params.id); if (!m || m.deletedAt) { res.status(404).json({ error: "找不到這個活動——請重新整理頁面", code: "no-run" }); return null; } return m; };
  api.post("/runs/:id/archive", wrap(async (req, res) => { if (!(await alive(req, res))) return; await store.patchMeta(req.params.id, { archived: true }); await store.appendLog(req.params.id, `封存（移出活動總覽）：${req.user.email}`); res.json({ ok: true }); }));
  api.post("/runs/:id/unarchive", wrap(async (req, res) => { if (!(await alive(req, res))) return; await store.patchMeta(req.params.id, { archived: false }); await store.appendLog(req.params.id, `自封存區移回活動總覽：${req.user.email}`); res.json({ ok: true }); }));
}
module.exports = { mountLifecycle, KEEP_DAYS };
