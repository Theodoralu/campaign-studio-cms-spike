"use strict";
/**
 * netlify-auth.sh 退役測試（2026-08-04 遷移 #5；零新相依，僅 node:test；不觸網）
 *
 * 契約：Netlify 站已刪除、本腳本退役——任何殘留 source 必須
 *   ①非零回傳 ②stderr 帶明確退役訊息（含替代路徑 publish-docs-site.sh）③不得設值 NETLIFY_AUTH_TOKEN
 * 2026-09-21：替代路徑由 deploy-ghe-pages.sh 改為 publish-docs-site.sh（前者隨美國站停權一併退役）。
 * 這條斷言的價值就在這裡——指路碑指到另一塊墓碑時，它會紅。
 * ——防「靜默給空 token」讓殘留呼叫端誤以為可部署（鐵律 3 失敗要出聲）。
 * 歷史迴歸鎖（2026-07-28 token 直取＋三分失因分流）見 git 歷史本檔前版。
 */
const { test } = require("node:test");
const assert = require("node:assert");
const { spawnSync } = require("node:child_process");
const path = require("node:path");

const AUTH_SH = path.join(__dirname, "..", "..", "workbench", "netlify-auth.sh");

test("退役：source 回非零且訊息明確（不靜默）", () => {
  const r = spawnSync("/bin/zsh", ["-c", `source "${AUTH_SH}"; echo "rc=$?"`], { encoding: "utf8" });
  assert.match(r.stdout, /rc=1/, "source 後 $? 應為 1（退役＝非零）");
  assert.match(r.stderr, /已退役/, "stderr 應含退役訊息");
  assert.match(r.stderr, /publish-docs-site\.sh/, "訊息應指出替代發佈路徑（且必須是還活著的那一支）");
});

test("退役：不得設值 NETLIFY_AUTH_TOKEN（防殘留呼叫端誤判可部署）", () => {
  const r = spawnSync("/bin/zsh", ["-c", `source "${AUTH_SH}" 2>/dev/null; echo "tk=[$NETLIFY_AUTH_TOKEN]"`], { encoding: "utf8" });
  assert.match(r.stdout, /tk=\[\]/, "NETLIFY_AUTH_TOKEN 不得被設值");
});
