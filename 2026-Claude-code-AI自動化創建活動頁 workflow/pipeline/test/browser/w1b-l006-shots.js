const LEGACY_ROOT = process.env.CS_LEGACY_ROOT || "<legacy-root>"; // D5：單機版作者的設計源檔根目錄，不在 repo；要跑請設環境變數
/* W1-B 切片二視覺 QA：layout-006 舞台三連拍（1440 預設主題／1440 綠主題／1024 縮放）＋一張帶槽位資料
   跑法：node test/browser/w1b-l006-shots.js [outDir]   預設輸出 test/browser/.shots/（不進版控）

   2026-09-16 修兩個毛病（`TEST-SHOTS-DIRTY-TREE`；同族五支截圖腳本逐支比對後確認只有本支有問題）：
   ①**少了測試時跳過的防護**——其他五支都有 `NODE_TEST_CONTEXT` 早退，只有本支沒有，所以 pre-commit 跑
     `node --test` 時會真的開 Chrome 重拍四張圖，每條線收工都得手動還原（2026-09-16 一天踩三次）。
   ②**輸出寫死在版控的測試資料夾裡**（原 `OUT = __dirname`）——而那四張圖正被
     `docs/design-qa/hero-wave1-dual-shell-2026-08-24.md` 與 `docs/stories/hero-wave1-dual-shell.md`
     當成「2026-08-24 當時驗過的證據」引用。每跑一次就覆寫一次，git 歷史顯示已被「重跑雜訊」
     覆寫並重新提交至少三次＝**文件說「✅ 實證，見這張圖」，而那張圖早就不是當初那張了**。
     四張證據已於 2026-09-16 搬進 `docs/design-qa/hero-wave1-dual-shell-2026-08-24-shots/` 凍存，
     本腳本預設不再寫進任何版控位置；要更新證據＝明確傳 outDir 指過去，那是刻意的動作、不是副作用。 */
if (process.env.NODE_TEST_CONTEXT) { console.log("w1b-l006-shots：手動 design QA 實拍腳本（需 Chrome），node --test 下跳過——手動跑：node test/browser/w1b-l006-shots.js [outDir]"); return; }
const { chromium } = require("playwright-core");
const path = require("path");
const fs = require("fs");
const FILE = `${LEGACY_ROOT}/2026-AI自動化活動頁生成規劃/MVP_Phase1_LeCreuset_活動頁Prototype_FrameTest.html`;
const OUT = process.argv[2] ? path.resolve(process.argv[2]) : path.join(__dirname, ".shots");
fs.mkdirSync(OUT, { recursive: true });
(async () => {
  const browser = await chromium.launch({ channel: "chrome" });
  const shots = [];
  async function shot(name, vw, theme, heroData) {
    const page = await browser.newPage({ viewport: { width: vw, height: 900 } });
    const errs = [];
    page.on("pageerror", (e) => errs.push("PAGEERROR " + e.message));
    page.on("console", (m) => { if (m.type() === "error") errs.push("CONSOLE " + m.text()); });
    await page.goto("file://" + FILE + "#exp=kv:layout-006", { waitUntil: "load" });
    await page.waitForTimeout(2500);
    if (theme) await page.evaluate((t) => document.body.setAttribute("data-campaign-theme", t), theme);
    if (heroData) await page.evaluate((d) => { window.__hv2Draft = d; renderHeroV2("layout-006", d); }, heroData);
    await page.waitForTimeout(1200);
    const el = await page.$("#hv2-l006");
    const box = el ? await el.boundingBox() : null;
    const visible = box && box.width > 0;
    await page.screenshot({ path: path.join(OUT, name), clip: box && box.width >= vw ? undefined : (box ? { x: Math.max(0, box.x), y: Math.max(0, box.y), width: Math.min(vw, box.width), height: Math.min(900, box.height) } : undefined) });
    console.log(name, "stage:", visible ? `${Math.round(box.width)}x${Math.round(box.height)}@(${Math.round(box.x)},${Math.round(box.y)})` : "MISSING", errs.length ? "ERRS:" + errs.join(" | ") : "console-clean");
    await page.close();
  }
  const demoDraft = { page: { kvVariant: "layout-006", hero: { "title-center": "NEW IN\n秋季新品搶先看\nAUTUMN COLLECTION\nNEW ARRIVAL", "item-ring": { gdids: ["11", "22", "33", "44"] } } }, products: [
    { gdid: "11", name: "測試品 1", img: `file://${LEGACY_ROOT}/2026-AI自動化活動頁生成規劃/assets/lecreuset-hero-source.jpg`, tag: "One-Piece" },
    { gdid: "22", name: "測試品 2", img: `file://${LEGACY_ROOT}/2026-AI自動化活動頁生成規劃/assets/lecreuset-hero-source.jpg`, tag: "Bra Top" },
    { gdid: "33", name: "測試品 3", img: `file://${LEGACY_ROOT}/2026-AI自動化活動頁生成規劃/assets/lecreuset-hero-source.jpg`, tag: "Tops" },
    { gdid: "44", name: "測試品 4", img: `file://${LEGACY_ROOT}/2026-AI自動化活動頁生成規劃/assets/lecreuset-hero-source.jpg`, tag: "Blouse" },
  ] };
  await shot("l006-empty-1440.png", 1440, null, null);
  await shot("l006-green-1440.png", 1440, "green-light", null);
  await shot("l006-fit-1024.png", 1024, null, null);
  await shot("l006-data-1440.png", 1440, null, demoDraft);
  await browser.close();
})();
