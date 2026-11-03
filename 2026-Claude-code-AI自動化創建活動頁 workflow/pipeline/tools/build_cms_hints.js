"use strict";
/**
 * tools/build_cms_hints.js —— CMS 提示產物生成器（70 號 2026-09-09）
 *
 * 白話：CMS 加模組時要多講的那些話（輸入框淺灰提示、預覽灰字示範句、模組／版面白話與長相圖）
 * 真源在規劃 repo 的欄位字典；這支把它算成 CMS 讀得動的一份 JSON＋幾張圖，放進 workbench/public/。
 *
 * 真源＝規劃/tools/lib/field-dictionary.mjs（buildCmsHints：CMS_COPY／MODULE_PLAIN／VARIANT_PLAIN）＋規劃/modules.json（可選版面對帳）
 * 產物＝workbench/public/cms-hints.json＋workbench/public/module-specs/*.png（從 activity-page-ia-web/public/module-specs 搬）
 * 掛點（沿 build_bg_map.js 前例）：sync.sh 每次部署跑 --strict（真源不在＝exit 1 擋部署）；server.js 啟動時跑（真源不在＝沿用 commit 產物、出聲不擋——
 *   69 號同事編修版沒有規劃 repo，靠 commit 進 pipeline 的產物帶著走）。
 * 冪等：不寫時間戳（52 號 R6 生成器去日期戳）；同真源＝同產物，git diff 乾淨。
 * 保鮮絆線＝test/unit/cms_hints.test.js（真源可達時，產物必等於現算；顯示字串禁貨號／代號／程式鍵名）。
 * 產物守門＝.claude/hooks/block-build-output-edit.py RULES 兩行（改字請改真源再重跑本檔）。
 */
const fs = require("fs");
const path = require("path");
const { pathToFileURL } = require("url");

const PIPE = path.join(__dirname, "..");
const PLAN = path.join(PIPE, "..", "..", "2026-AI自動化活動頁生成規劃");
const DICT = path.join(PLAN, "tools", "lib", "field-dictionary.mjs");
const MODULES_JSON = path.join(PLAN, "modules.json");
const SRC_IMG_DIR = path.join(PLAN, "activity-page-ia-web", "public", "module-specs");
const OUT_JSON = path.join(PIPE, "workbench", "public", "cms-hints.json");
const OUT_IMG_DIR = path.join(PIPE, "workbench", "public", "module-specs");

const sourceReachable = () => fs.existsSync(DICT) && fs.existsSync(MODULES_JSON) && fs.existsSync(SRC_IMG_DIR);

/** 只算、不寫（測試用） */
async function compute() {
  const { buildCmsHints } = await import(pathToFileURL(DICT).href);
  const hints = buildCmsHints({ contentModulesPath: path.join(PIPE, "lib", "content_modules.js"), modulesPath: MODULES_JSON });
  return { hints, json: JSON.stringify(hints, null, 1) + "\n" };
}

/** 算＋寫產物（JSON＋圖；多出來的舊圖刪掉＝產物目錄只放清單上的） */
async function build() {
  const { hints, json } = await compute();
  fs.mkdirSync(OUT_IMG_DIR, { recursive: true });
  for (const f of hints.images) {
    const src = path.join(SRC_IMG_DIR, f);
    if (!fs.existsSync(src)) throw new Error(`母版圖不存在：${src}——module-specs/manifest.json 改名了？先對齊再出產物`);
    fs.copyFileSync(src, path.join(OUT_IMG_DIR, f));
  }
  for (const f of fs.readdirSync(OUT_IMG_DIR)) if (/\.png$/i.test(f) && !hints.images.includes(f)) fs.unlinkSync(path.join(OUT_IMG_DIR, f));
  const prev = fs.existsSync(OUT_JSON) ? fs.readFileSync(OUT_JSON, "utf8") : null;
  fs.writeFileSync(OUT_JSON, json);
  const fields = Object.values(hints.fields).reduce((n, f) => n + Object.keys(f).length, 0);
  return { changed: prev !== json, fields, images: hints.images.length };
}

module.exports = { compute, build, sourceReachable, DICT, MODULES_JSON, SRC_IMG_DIR, OUT_JSON, OUT_IMG_DIR };

if (require.main === module) {
  const strict = process.argv.includes("--strict");
  if (!sourceReachable()) {
    const msg = `[cms-hints] 真源不可達（規劃 repo 不在這台機器：${DICT}）＝沿用已 commit 的 workbench/public/cms-hints.json`;
    if (strict) { console.error("✗ " + msg + "——部署鏈要求真源在場"); process.exit(1); }
    console.log("ⓘ " + msg);
    process.exit(0);
  }
  build()
    .then((r) => console.log(`✓ cms-hints.json ${r.changed ? "已更新" : "無變更"}（欄位 ${r.fields}、母版圖 ${r.images}）→ ${path.relative(PIPE, OUT_JSON)}`))
    .catch((e) => { console.error("✗ CMS 提示產物生成失敗：" + (e && e.message ? e.message : e)); process.exit(1); });
}
