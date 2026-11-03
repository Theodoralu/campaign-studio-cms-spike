/* 能力表接線絆線（2026-09-15 B 批，牆第 6 題甲）：介面只准用三個能力字、只准從 /api/version 讀、伺服器 403 名單與介面藏的入口要對得上。
   守法＝從最外層讀 index.html／server.js 字面（沿 ui_no_lifecycle 形式）。 */
"use strict";
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const C = require("../../lib/capabilities.js");

const UI_RAW = fs.readFileSync(path.resolve(__dirname, "..", "..", "workbench", "public", "index.html"), "utf8");
const UI = UI_RAW.replace(/<!--[\s\S]*?-->/g, "").replace(/\/\*[\s\S]*?\*\//g, ""); // 剝掉 HTML／JS 區塊註解：只掃使用者看得到或程式真的在跑的（沿 ui_no_lifecycle）
const SRV = fs.readFileSync(path.resolve(__dirname, "..", "..", "workbench", "server.js"), "utf8");

test("data-needs 只准用能力表的三個字（值域＝lib/capabilities KEYS）", () => {
  const used = [...UI.matchAll(/data-needs="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(used.length >= 2, "首頁 AI 行與建立頁策展方式組至少要掛 data-needs");
  for (const k of used) assert.ok(C.KEYS.includes(k), `data-needs="${k}" 不在能力值域 ${C.KEYS.join("/")}`);
  const dyn = [...UI.matchAll(/hasCap\("([^"]+)"\)/g)].map((m) => m[1]);
  for (const k of dyn) assert.ok(C.KEYS.includes(k), `hasCap("${k}") 不在能力值域`);
});

test("靜態 data-needs 元素預設 hidden（能力表沒到之前先藏＝fail-closed）", () => {
  for (const m of UI.matchAll(/<[^>]*data-needs="[^"]+"[^>]*>/g)) assert.match(m[0], /\shidden[\s>]/, `${m[0].slice(0, 90)} 少了 hidden`);
});

test("前端只從 /api/version 讀能力；不讀模式旗標（介面看能力、伺服器看旗標）", () => {
  assert.match(UI, /applyCaps\(v\)/, "checkVersion 要把 /api/version 回應交給 applyCaps");
  assert.doesNotMatch(UI, /CAMPAIGN_MODE|\.mode === "editor"/, "介面不得依模式旗標決定長相——那是伺服器的事");
});

test("伺服器 403 名單存在且含三類：發佈、對外、試算表；線上改價（套用新價）不在名單（2026-09-16 牆 P-8 甲）", () => {
  /* 2026-09-16 前這裡要求名單含 apply-live-price(-all)——與 server_editor_mode.test.js 各抄一份同一條規則（一條規則兩道門）；
     P-8 裁甲後兩處同批改。套用新價只改本機快照、不碰線上頁，同事機遇變價必須有路可走。 */
  const m = SRV.match(/const EDITOR_BLOCKED_SUBROUTES = new Set\(\[([^\]]+)\]\)/);
  assert.ok(m, "找不到 EDITOR_BLOCKED_SUBROUTES");
  const list = [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
  for (const r of ["deploy", "publish-public", "sheet-create", "sheet-read", "sheet-status", "sheet-unlink"]) assert.ok(list.includes(r), `名單缺 ${r}`);
  for (const r of ["apply-live-price", "apply-live-price-all"]) assert.ok(!list.includes(r), `${r} 不該在 403 名單（P-8 甲）`);
});

test("介面對應：發佈次鈕與入口欄只在 hasCap(publish) 時出現；AI 卡組掛 data-needs=ai", () => {
  assert.match(UI, /previewSecondary = hasCap\("publish"\)/);
  assert.match(UI, /hasCap\("publish"\) \? '<th class="col-p3">入口<\/th>'/);
  assert.match(UI, /id="engine-group" data-needs="ai" hidden/);
});

test("/api/version 帶 mode 與 caps；建立時 engine ai 有伺服器守門", () => {
  assert.match(SRV, /mode: MODE, build: BUILD, caps: CAPS \? CAPS\.caps : null/); // 2026-09-16 加 build 欄（版本記號給側欄）
  assert.match(SRV, /input\.engine === "ai" && !\(CAPS && CAPS\.caps\.ai\)/);
});

/* ── 第二段（2026-09-15 使用者過目 15 條文案後接線） ── */
test("依能力切換的句子集中在 CAP_COPY，每鍵都有 pub／noPub 兩支", () => {
  const m = UI.match(/const CAP_COPY = \{([\s\S]*?)\n\};/);
  assert.ok(m, "找不到 CAP_COPY");
  const keys = [...m[1].matchAll(/^\s+(\w+):\s*\{/gm)].map((x) => x[1]);
  for (const k of ["step5Desc", "approveLead", "approvedToast", "menuHintTail", "liveTab", "homeThirdTitle", "homeThirdEmpty"]) assert.ok(keys.includes(k), `CAP_COPY 缺 ${k}`);
  for (const k of keys) {
    const row = m[1].match(new RegExp(`^\\s+${k}:\\s*\\{([^\\n]*)`, "m"))[1];
    assert.match(row, /pub:/, `${k} 缺 pub`); assert.match(row, /noPub:/, `${k} 缺 noPub`);
  }
  for (const k of keys) assert.ok(UI.includes(`capCopy("${k}")`), `CAP_COPY.${k} 沒有被任何地方用到（死鍵）`);
});

test("「發佈內網預覽」的介面句都改讀表：五步第 5 步、核可確認框、核可 toast、選單提示、分頁、首頁第三卡", () => {
  assert.doesNotMatch(UI, /const VIEW_DEFS/, "VIEW_DEFS 常數應改成依能力的 viewDefs()");
  assert.match(UI, /const viewDefs = \(\) =>/);
  assert.match(UI, /desc: \(\) => capCopy\("step5Desc"\)/);
  assert.match(UI, /dlg\("核可這一版？", `\$\{capCopy\("approveLead"\)\}/);
  assert.match(UI, /: capCopy\("approvedToast"\)\)/);
  assert.match(UI, /\+ capCopy\("menuHintTail"\)\)/);
  assert.match(UI, /capCopy\("homeThirdTitle"\)/); assert.match(UI, /capCopy\("homeThirdEmpty"\)/);
});

test("商品狀態燈不再看有沒有發佈；講上次檢查與幾件要處理", () => {
  assert.doesNotMatch(UI, /if \(!r\.liveUrl\) return '<span class="chip mute" title="尚未發佈預覽">/, "舊的「沒發佈＝—」判斷要拿掉（同事版永遠沒發佈）");
  assert.match(UI, /件要處理<\/span>/); assert.match(UI, /都正常<\/span>/); assert.match(UI, /上次檢查 \$\{when\}/);
  assert.match(UI, /製作 AEM 網頁檔前會自動檢查/);
});

test("已交付＝AEM 檔真的下載過（downloadedAt）；狀態膠囊、分桶、首頁最近交付都用同一個 isDelivered", () => {
  assert.match(UI, /const isDelivered = \(r\) => \{ const d = deliveryOf\(r\); return !!\(d && d\.downloadedAt\); \}/);
  assert.match(UI, /if \(isDelivered\(r\)\) return '<span class="chip live" title="AEM 網頁檔已下載">/);
  assert.match(UI, /delivered: act\.filter\(r => !isBusy\(r\) && isDelivered\(r\)\)/);
  assert.match(UI, /runsCache\.filter\(x => !x\.archived && isDelivered\(x\)\)/);
  assert.match(SRV, /setExportAem\(id, \{ downloadedAt: new Date\(\)\.toISOString\(\) \}\)/, "伺服器下載路由要記 downloadedAt");
});

test("Claude 裝了沒登入的橫幅：字照使用者過目的第 3 條，只在 installed 且 loginOk===false 時出現", () => {
  assert.match(UI, /detail\.ai\.installed && detail\.ai\.loginOk === false/);
  assert.ok(UI.includes("AI 智慧策展目前用不了：這台電腦的 Claude 還沒登入。快速草稿不受影響。"));
});

/* 橫幅「重新檢查」四態（2026-09-21 使用者過目核可；story docs/stories/caps-recheck.md）。
   守這四句的理由跟守第 3 條一樣：它們是 CMS 介面的溝通文字，改字要先給使用者過目（CLAUDE.md 溝通節），
   絆線在這裡＝有人順手改字會紅，不會安靜地漂。 */
test("橫幅重新檢查：四態文案逐字＝使用者核可版", () => {
  for (const s of [
    "AI 智慧策展目前用不了：這台電腦的 Claude 還沒登入。快速草稿不受影響。",
    "登入好了，重新檢查",
    "…正在檢查，大約要等 15 秒",
    "AI 智慧策展可以用了",
    "還是連不上。請確認 Claude 已經登入，再試一次。",
  ]) assert.ok(UI.includes(s), `橫幅四態文案漏了或被改字：「${s}」`);
});

test("橫幅重新檢查：打伺服器的重測端點、成功走既有 applyCaps（不自己另寫一套收橫幅）", () => {
  assert.match(UI, /fetch\("\/api\/caps\/recheck", \{ method: "POST" \}\)/, "要打重測端點");
  assert.match(UI, /async function recheckAi\(\)/);
  assert.match(UI, /if \(v\) applyCaps\(v\);/, "成功後沿用既有 applyCaps＝橫幅收掉、AI 卡長回來、列表重繪一次到位（鐵律 4：不另立一套）");
  assert.match(SRV, /u\.pathname === "\/api\/caps\/recheck" && req\.method === "POST"/, "伺服器要有對應端點且只收 POST");
});

test("重測端點放在登入守門之後（它會真的叫一次 claude，不能裸奔在免登入區）", () => {
  const iAuth = SRV.indexOf('res.end("需要登入（帳密向 Tofu 索取）")');
  const iRecheck = SRV.indexOf('u.pathname === "/api/caps/recheck"');
  assert.ok(iAuth > 0 && iRecheck > 0, "兩個錨點都要找得到");
  assert.ok(iRecheck > iAuth, "重測端點必須在登入守門之後（免登入區只能放 /ping、/api/version 這種不花錢的）");
});

test("能力表可重測：開機那一次不再是唯一一次，且併發共用同一輪", () => {
  assert.match(SRV, /let capsInflight = null/, "要有進行中旗標＝連點不重複 spawn（探針花的是真額度）");
  assert.match(SRV, /if \(capsInflight\) return capsInflight;/);
  assert.match(SRV, /capsInflight = null;/, "每一輪結束一定要清旗標，否則一次失敗就永遠測不了（R2 靜默失敗）");
  assert.doesNotMatch(SRV, /detectCapsAtBoot/, "舊的一次性函式名不該還在（改名＝呼叫端全數跟上）");
  assert.match(SRV, /if \(input\.engine === "ai"\) await detectCaps\("AI 策展前確認"\);/, "AI 路要先問一次現在＝同時堵假紅與假綠");
});
