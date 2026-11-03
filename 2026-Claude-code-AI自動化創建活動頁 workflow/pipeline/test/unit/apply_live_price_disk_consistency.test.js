"use strict";
/**
 * 套用新價之後不准自動重跑合規檢查（2026-09-30；病例＝使用者連開兩檔都看到「剛按完套用新價就冒紅燈」）
 *
 * 病灶：`apply-live-price(-all)` 由伺服器把新價寫進磁碟 snapshot.json，但 draft 的新價只在本地待存。
 * 此刻磁碟上是「新快照 vs 舊草稿」，而 gate.js CP-02 比的正是這兩個檔 ⇒ 必 FAIL。
 * afterDraftMutation() 沒收到明確的 diskConsistent 就退回 `!dirty`；而 setDirty(true) 寫在它後面一行，
 * 當下 dirty 仍為 false ⇒ 判定磁碟一致 ⇒ autoRegate() 立刻對半新半舊的磁碟重跑＝假紅燈。
 * 實證：wb-111631／wb-112554 兩檔 log 皆為「套用 → gate exit 1 →（儲存）→ gate exit 0」。
 *
 * 本檔守兩層：
 *   ① 定點——兩支套價函式必須明寫 diskConsistent:false（日後有人改回去即紅）
 *   ② 整類——任何 afterDraftMutation 呼叫，若「後面幾行才 setDirty(true)」，一律要明寫 diskConsistent
 *      （這是原始的漏法：順序錯＝讀到過期的 dirty。順序對的寫法不受本條拘束。）
 */
const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const SRC = path.join(__dirname, "..", "..", "workbench", "public", "index.html");
const html = fs.readFileSync(SRC, "utf8");
const lines = html.split("\n");

test("① 單品套價 applyLivePrice：明寫 diskConsistent:false", () => {
  const i = lines.findIndex((l) => /^async function applyLivePrice\(/.test(l));
  assert.ok(i >= 0, "找不到 applyLivePrice——函式被改名了？請同步本測試");
  const body = lines.slice(i, i + 30).join("\n");
  assert.match(body, /afterDraftMutation\(r,\s*\{\s*diskConsistent:\s*false\s*\}\)/,
    "套用新價後若不明寫 diskConsistent:false，會對『新快照＋舊草稿』的磁碟自動重跑合規檢查＝假紅燈");
});

test("② 一鍵套用全部 applyAllLivePrices：明寫 diskConsistent:false", () => {
  const i = lines.findIndex((l) => /^async function applyAllLivePrices\(/.test(l));
  assert.ok(i >= 0, "找不到 applyAllLivePrices——函式被改名了？請同步本測試");
  const body = lines.slice(i, i + 30).join("\n");
  assert.match(body, /afterDraftMutation\(r,\s*\{\s*diskConsistent:\s*false\s*\}\)/,
    "批次套價與單品套價同一病灶，修法必須一致");
});

/* 偵測器（③與④共用）：找出「沒明寫 diskConsistent，而且【緊接的下一個非空行】就把 dirty 設成 true」的呼叫點。
   為何只看下一個非空行＝原始病灶的精確形狀（afterDraftMutation(r); 換行 renderEditor(); setDirty(true); ...）。
   先前用「往後看 4 行」會誤報三處：editorial-add ×2（下一行是 setDirty(false)＝伺服器已寫盤、磁碟本就一致）
   與換圓卡（setDirty(true) 在呼叫之前，抓到的是 4 行後非同步回呼裡無關的那一個）。 */
function findStaleDirtyCalls(srcLines) {
  const bad = [];
  srcLines.forEach((l, idx) => {
    if (!/afterDraftMutation\s*\(/.test(l)) return;
    if (/^\s*function afterDraftMutation/.test(l)) return;           // 定義本身
    if (/afterDraftMutation\([^)]*diskConsistent/.test(l)) return;    // 已明寫＝不靠 dirty
    let j = idx + 1;
    while (j < srcLines.length && srcLines[j].trim() === "") j++;
    /* 剝行註解再比（2026-09-30 自捕誤報：editorial-add ×2 的註解裡寫著「原 setDirty(true)＝…」，
       偵測器讀到的是註解不是程式碼）。`[^:]` 是為了不把 https:// 當成註解起點。 */
    const codeOnly = j < srcLines.length ? srcLines[j].replace(/(^|[^:])\/\/.*$/, "$1") : "";
    if (/setDirty\(true\)/.test(codeOnly)) {
      bad.push(`第 ${idx + 1} 行：${l.trim().slice(0, 90)}`);
    }
  });
  return bad;
}

test("③ 整類絆線：afterDraftMutation 的下一行才 setDirty(true) 的呼叫，一律要明寫 diskConsistent", () => {
  assert.deepStrictEqual(findStaleDirtyCalls(lines), [],
    "這些呼叫點在 setDirty(true) 之前就呼叫 afterDraftMutation＝它讀到的是過期的 dirty，會誤判磁碟一致並\n" +
    "自動重跑合規檢查（autoRegate），而此刻磁碟上是「伺服器已更新的快照 vs 尚未儲存的舊草稿」＝假紅燈。\n" +
    "修法二選一：把 setDirty(true) 搬到呼叫之前，或明寫 diskConsistent。");
});

test("④ 偵測器自我驗證：對「壞形狀」必須抓得到（防本檔空綠）", () => {
  /* 卡 20260921-fixtures-that-flatter-the-gate：綠燈可能只是因為素材是我挑的最短那個。
     這裡餵一段刻意寫壞的程式碼（＝修復前 applyLivePrice 的原貌），偵測器抓不到就代表③形同虛設。 */
  const 壞 = ["  draft.products[i].price = r.price;", "  afterDraftMutation(r); // 舊寫法", "  renderEditor(); setDirty(true); applyAndWire();"];
  assert.strictEqual(findStaleDirtyCalls(壞).length, 1, "偵測器對已知的壞形狀失靈＝③是假閘");
  const 好1 = ["  renderEditor(); setDirty(true); applyAndWire();", "  afterDraftMutation();"];
  const 好2 = ["  afterDraftMutation(r, { diskConsistent: false });", "  renderEditor(); setDirty(true); applyAndWire();"];
  const 好3 = ["  afterDraftMutation(r);", "  renderEditor(); setDirty(false); applyAndWire();"];
  const 好4 = ["  afterDraftMutation(r);", "  renderEditor(); setDirty(false); applyAndWire(); // 原 setDirty(true) 已改掉"]; // 註解裡的字不算程式碼
  for (const [名, 樣] of [["順序正確", 好1], ["明寫參數", 好2], ["伺服器已寫盤", 好3], ["只出現在註解裡", 好4]]) {
    assert.deepStrictEqual(findStaleDirtyCalls(樣), [], `${名}的寫法被誤報＝偵測器太寬，會擋到沒問題的程式`);
  }
});

/* ⑤ 語意測試（2026-09-30 加：使用者 14:43 截圖抓到 ①②③④ 全綠但功能沒修好）
   原本本檔只驗「diskConsistent:false 這串字有沒有寫在程式裡」＝文字測試。而第一刀的 bug 在 afterDraftMutation
   那一行的**判斷式**：`(opts && opts.diskConsistent) || !dirty`——明確傳 false 會被 `||` 短路掉、退回 !dirty，
   於是參數寫了也沒用。文字測試看不到這種錯（卡 20260921-green-gates-can-be-looking-elsewhere：門全綠不等於對，
   門可能沒在看那個維度）。本條把那一行從原始碼撈出來當成函式跑真值表＝驗語意不驗字面。 */
test("⑤ 語意：afterDraftMutation 的磁碟一致性判定，明確傳 false 必須壓得住（不能被 || 短路掉）", () => {
  const line = lines.find((l) => /const consistent\s*=/.test(l) && /diskConsistent/.test(l));
  assert.ok(line, "找不到 consistent 判定那一行——被改名了？請同步本測試");
  const expr = line.slice(line.indexOf("=") + 1).replace(/;\s*$/, "");
  const f = new Function("opts", "dirty", `return (${expr});`);
  const cases = [
    [{ diskConsistent: false }, false, false, "套價：磁碟是新快照＋舊草稿 ⇒ 不准自動重跑"],
    [{ diskConsistent: false }, true,  false, "明確 false 要勝過 dirty"],
    [{ diskConsistent: true },  true,  true,  "伺服器已寫盤：明確 true"],
    [undefined,                 false, true,  "沒給參數＝看 !dirty（乾淨）"],
    [undefined,                 true,  false, "沒給參數＝看 !dirty（有未存）"],
  ];
  for (const [opts, dirty, want, name] of cases) {
    assert.strictEqual(!!f(opts, dirty), want, `${name}｜opts=${JSON.stringify(opts)} dirty=${dirty}`);
  }
});
