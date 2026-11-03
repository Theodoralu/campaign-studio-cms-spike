"use strict";
/**
 * publish_stamp 契約測試（2026-09-14 三題牆第 1 題甲；工單 CMS-PREVIEW-UNAPPROVED-MARK）
 *
 * 守的病：預覽連結可以在沒核可的狀態下發出去，而拿到連結的人看不出這一版定了沒
 * （已核可與沒核可的頁長得一模一樣），他可能拿它去開會。
 *
 * 契約：
 *   ①沒核可＝approved:false（前台據此亮「這一版還沒定稿」橫幅）
 *   ②有核可＝approved:true 且帶得出核可時間
 *   ③蓋章不得動到內容——gate 驗過的那份內容要原樣送出，只多一個 publish 鍵
 *   ④解析不了＝原文原樣回傳＋說得出為什麼（發佈鏈不因為多蓋一個標記而倒掉；
 *     前台對「沒有 publish 欄位」的處置是不亮＝退回本功能上線前的行為，不會誤標）
 */
const { test, describe } = require("node:test");
const assert = require("node:assert");
const { publishStamp, stampDraftJson } = require("../../lib/publish_stamp");

const DRAFT = { id: "wb-1", page: { kv: { titleLine1: "秋季家電展" } }, products: [{ gdid: "123", price: 990 }] };
const NOW = new Date("2026-09-16T02:30:00.000Z");

describe("發佈時蓋上核可狀態", () => {
  test("① 沒核可＝approved false、核可時間 null", () => {
    const s = publishStamp({}, NOW);
    assert.strictEqual(s.approved, false, "沒核可時間就是沒核可");
    assert.strictEqual(s.approvedAt, null);
    assert.strictEqual(s.publishedAt, NOW.toISOString(), "要記下發佈當下的時間（快照，不是活狀態）");
  });

  test("② 有核可＝approved true 且帶得出核可時間", () => {
    const a = "2026-09-16T01:00:00.000Z";
    const s = publishStamp({ approvedAt: a }, NOW);
    assert.strictEqual(s.approved, true);
    assert.strictEqual(s.approvedAt, a);
  });

  test("③ 蓋章不動內容——只多一個 publish 鍵，其餘逐鍵相同", () => {
    const raw = JSON.stringify(DRAFT, null, 1) + "\n";
    const out = stampDraftJson(raw, { approvedAt: "2026-09-16T01:00:00.000Z" }, NOW);
    assert.strictEqual(out.stamped, true);
    const back = JSON.parse(out.text);
    const { publish, ...rest } = back;
    assert.deepStrictEqual(rest, DRAFT, "內容必須一個字都沒變——gate 驗的是這份");
    assert.ok(publish && publish.approved === true, "publish 鍵要在");
  });

  test("③ -b 未核可的稿同樣只多一鍵（內容不因為沒核可而被動手腳）", () => {
    const out = stampDraftJson(JSON.stringify(DRAFT), {}, NOW);
    const { publish, ...rest } = JSON.parse(out.text);
    assert.deepStrictEqual(rest, DRAFT);
    assert.strictEqual(publish.approved, false);
  });

  test("④ 解析不了＝原文原樣回傳、不丟例外、說得出為什麼", () => {
    const bad = "{ 這不是 JSON";
    const out = stampDraftJson(bad, {}, NOW);
    assert.strictEqual(out.text, bad, "原文要原樣送——蓋不上標記不該連內容都發不出去");
    assert.strictEqual(out.stamped, false);
    assert.match(out.reason, /解析不了/, "要說得出為什麼（呼叫端據此出聲）");
  });

  test("④ -b 頂層是陣列（不是物件）＝同樣原樣回傳，不硬塞鍵", () => {
    const arr = "[1,2,3]";
    const out = stampDraftJson(arr, {}, NOW);
    assert.strictEqual(out.text, arr);
    assert.strictEqual(out.stamped, false);
    assert.match(out.reason, /不是物件/);
  });

  test("⑤ 蓋完仍是合法 JSON 且結尾換行（與既有 draft 落檔慣例一致）", () => {
    const out = stampDraftJson(JSON.stringify(DRAFT), {}, NOW);
    assert.doesNotThrow(() => JSON.parse(out.text));
    assert.ok(out.text.endsWith("\n"), "結尾換行＝git diff 不會多一行 \\ No newline");
  });
});
