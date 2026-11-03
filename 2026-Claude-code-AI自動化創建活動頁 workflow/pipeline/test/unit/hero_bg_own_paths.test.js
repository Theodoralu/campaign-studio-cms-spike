"use strict";
/**
 * hero_bg_own_paths.test.js —— 「你上傳的背景」路徑規則的單一立法（lib/hero_bg_own.js，2026-09-29 牆）
 * 三條出口（AEM 內嵌／ZIP 隨包／發佈複製）共用這一套：驗形、對磁碟、轉內嵌。
 * 病例＝2026-09-29：組裝器不認 own 圖、做出背景是空的檔（靜默壞）——所以缺檔一律丟錯出聲，不回空值。
 */
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const O = require("../../lib/hero_bg_own.js");

test("parseOwnApiPath：只認 /api/runs/<id>/hero-bg/<三格檔名>；data URI、外站網址、亂檔名＝null", () => {
  assert.deepStrictEqual(O.parseOwnApiPath("/api/runs/2026-09-29-wb-112554/hero-bg/375.webp"), { runId: "2026-09-29-wb-112554", file: "375.webp" });
  assert.deepStrictEqual(O.parseOwnApiPath("/api/runs/r%201/hero-bg/desktop.jpg"), { runId: "r 1", file: "desktop.jpg" });
  assert.strictEqual(O.parseOwnApiPath("data:image/webp;base64,AAAA"), null);
  assert.strictEqual(O.parseOwnApiPath("https://evil/hero-bg/375.webp"), null);
  assert.strictEqual(O.parseOwnApiPath("/api/runs/r1/hero-bg/original-375.jpg"), null, "original-* 是留檔不是頁面用圖");
  assert.strictEqual(O.parseOwnApiPath("/api/runs/r1/hero-bg/../../secret.png"), null);
  assert.strictEqual(O.parseOwnApiPath(null), null);
});

test("resolveOwnFileMap：逐格對到磁碟實檔＋mime；已是 data: 的格跳過；缺檔＝丟錯出聲講哪一格", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "own-paths-"));
  fs.mkdirSync(path.join(dir, O.DIRNAME));
  fs.writeFileSync(path.join(dir, O.DIRNAME, "desktop.webp"), Buffer.from([1, 2, 3]));
  fs.writeFileSync(path.join(dir, O.DIRNAME, "768.png"), Buffer.from([4]));
  const page = { backgroundId: "own", heroBgOwn: { files: {
    desktop: "/api/runs/x/hero-bg/desktop.webp",
    "768": "/api/runs/x/hero-bg/768.png",
    "375": "data:image/webp;base64,AAAA", // 已內嵌＝跳過
  } } };
  const m = O.resolveOwnFileMap(page, dir);
  assert.deepStrictEqual(Object.keys(m).sort(), ["768", "desktop"]);
  assert.strictEqual(m.desktop.mime, "image/webp");
  assert.strictEqual(m["768"].mime, "image/png");
  assert.strictEqual(fs.existsSync(m.desktop.abs), true);
  assert.strictEqual(O.ownFileDataUri(m.desktop), "data:image/webp;base64," + Buffer.from([1, 2, 3]).toString("base64"));
  // 缺檔＝出聲（不靜默給空背景）
  const missing = { backgroundId: "own", heroBgOwn: { files: { desktop: "/api/runs/x/hero-bg/desktop.jpg" } } };
  assert.throws(() => O.resolveOwnFileMap(missing, dir), /桌機版[\s\S]*找不到/);
  // 路徑不合形（想指到別的地方）＝同樣出聲
  const evil = { backgroundId: "own", heroBgOwn: { files: { desktop: "../../etc/passwd" } } };
  assert.throws(() => O.resolveOwnFileMap(evil, dir), /找不到/);
  fs.rmSync(dir, { recursive: true, force: true });
});
