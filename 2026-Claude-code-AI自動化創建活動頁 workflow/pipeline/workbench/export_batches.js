/**
 * 策展批次快照匯出（分享站「活動創建總覽」資料源）
 * 用法：node export_batches.js <輸出 batches.json 路徑>
 *
 * 掃 runs/（活躍）＋ runs/_deleted/（已刪除歸檔）→ 批次狀態快照。
 * 定位：deploy-site sync 時執行＝「刪除互動 → 線上入口狀態隨部署同步」的機制載體；
 * 線上頁為唯讀快照（本機工作台才是操作介面），快照時間戳寫入 exportedAt。
 */
const fs = require("fs");
const path = require("path");

const RUNS = path.join(__dirname, "..", "runs");
const out = process.argv[2];
if (!out) { console.error("用法：node export_batches.js <輸出 batches.json 路徑>"); process.exit(1); }

function gateSummary(dir) {
  try {
    const g = JSON.parse(fs.readFileSync(path.join(dir, "gate_report.json"), "utf8"));
    return { pass: g.result === "PASS", fail: (g.counts && g.counts.FAIL) || 0, warn: (g.counts && g.counts.WARN) || 0, checkedAt: g.checkedAt || "" };
  } catch (e) { return null; }
}
function rowOf(dir, id, status, extra) {
  let meta = {}; try { meta = JSON.parse(fs.readFileSync(path.join(dir, "wb_meta.json"), "utf8")); } catch (e) {}
  let pageName = meta.deletedPageName || "";
  try { pageName = JSON.parse(fs.readFileSync(path.join(dir, "draft.json"), "utf8")).page.pageName || pageName; } catch (e) {}
  const xlsx = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith(".xlsx")) : [];
  let refreshPolicy = null, themeHue = null;
  try { const pgd = JSON.parse(fs.readFileSync(path.join(dir, "draft.json"), "utf8")).page;
    refreshPolicy = pgd.refreshPolicy || null; themeHue = (pgd.theme && pgd.theme.hueFamily) || null; } catch (e) {}
  return {
    id, status, pageName,
    scenario: (meta.input && meta.input.scenario) || "",
    theme: (meta.input && meta.input.theme) || "",
    sourceUrl: (meta.input && meta.input.url) || "",
    engineUsed: meta.engineUsed || (meta.stage ? meta.engine : "歷史批次"),
    stage: meta.stage || (fs.existsSync(path.join(dir, "draft.json")) ? "ready" : "snapshot-only"),
    gate: gateSummary(dir), xlsx,
    createdAt: meta.createdAt || "", updatedAt: meta.updatedAt || "",
    approvedAt: meta.approvedAt || null,
    liveUrl: meta.liveUrl || null,
    deployStage: (meta.deploy && meta.deploy.stage) || null,
    refreshPolicy, themeHue,
    localPreview: `http://localhost:8787/frametest/?draftUrl=/api/runs/${id}/draft.json`,
    ...extra
  };
}

const active = fs.readdirSync(RUNS).filter((n) => !n.startsWith("_"))
  .filter((n) => fs.existsSync(path.join(RUNS, n, "snapshot.json")) || fs.existsSync(path.join(RUNS, n, "draft.json")))
  .sort().reverse().map((n) => rowOf(path.join(RUNS, n), n, "active", {}));
const trash = path.join(RUNS, "_deleted");
const deleted = fs.existsSync(trash) ? fs.readdirSync(trash).sort().reverse().map((n) => {
  let meta = {}; try { meta = JSON.parse(fs.readFileSync(path.join(trash, n, "wb_meta.json"), "utf8")); } catch (e) {}
  return rowOf(path.join(trash, n), n.split("__deleted-")[0], "deleted", { deletedAt: meta.deletedAt || "", localPreview: "" });
}) : [];

fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify({ exportedAt: new Date().toISOString(), active, deleted }, null, 1));
console.log(`✓ batches.json：活躍 ${active.length} 筆／已刪除 ${deleted.length} 筆 → ${out}`);
