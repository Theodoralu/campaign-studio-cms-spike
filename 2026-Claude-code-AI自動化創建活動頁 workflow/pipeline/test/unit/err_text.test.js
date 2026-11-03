"use strict";
/* err_text.test.js —— 故障注入：空 message 的 AggregateError 要能印出可讀原因、要被判成連線層（CMS-OFFLINE-HONESTY 第②件驗收） */
const test = require("node:test");
const assert = require("node:assert");
const { errText, errKind, sourceFailVerdict } = require("../../lib/err_text.js");

const withCode = (msg, code) => Object.assign(new Error(msg), { code });

test("AggregateError（message 空）→ 印出 errors[] 裡的 code，不再是空白", () => {
  const agg = new AggregateError([withCode("connect ECONNREFUSED 203.0.113.1:443", "ECONNREFUSED"), withCode("connect ENETUNREACH 2001:db8::1:443", "ENETUNREACH")], "");
  assert.strictEqual(agg.message, ""); // 病例形狀：Node 多位址全部連不上就是這樣
  const t = errText(agg);
  assert.match(t, /ECONNREFUSED/); assert.match(t, /ENETUNREACH/);
  assert.strictEqual(errKind(agg), "network");
});

test("errText：一般 Error 照印 message；code 不重複；cause 鏈接在後面", () => {
  assert.strictEqual(errText(new Error("HTTP 503 for https://x")), "HTTP 503 for https://x");
  assert.strictEqual(errText(withCode("connect ETIMEDOUT 1.2.3.4:443", "ETIMEDOUT")), "connect ETIMEDOUT 1.2.3.4:443");
  const e = new Error("外層"); e.cause = withCode("", "ENOTFOUND");
  assert.strictEqual(errText(e), "外層 ← ENOTFOUND");
  assert.strictEqual(errText(null), ""); assert.strictEqual(errText("純字串"), "純字串");
  assert.strictEqual(errText(new Error("")), "未知錯誤");
});

test("errText：超長訊息截斷、循環 cause 不會爆", () => {
  const e = new Error("x".repeat(1000)); assert.ok(errText(e).length <= 401);
  const a = new Error("a"); const b = new Error("b"); a.cause = b; b.cause = a;
  assert.strictEqual(errText(a), "a ← b");
});

test("errKind：四種判準", () => {
  assert.strictEqual(errKind(withCode("", "ENOTFOUND")), "network");
  assert.strictEqual(errKind(new Error("timeout")), "network");             // fetch_parse setTimeout 丟的就是這個字
  assert.strictEqual(errKind(new Error("socket hang up")), "network");
  assert.strictEqual(errKind(new Error("HTTP 503 for https://tw.buy.yahoo.com/brands/1")), "http");
  assert.strictEqual(errKind(new Error("HTTP 404＝dead（近空殼）：https://x")), "dead");
  assert.strictEqual(errKind(new Error("JSON 解析失敗")), "other");
  const wrapped = new Error("讀取失敗"); wrapped.cause = withCode("", "ECONNRESET");
  assert.strictEqual(errKind(wrapped), "network");
});

test("sourceFailVerdict：連線層那句不再叫人換網址、技術訊息在句尾括號", () => {
  const agg = new AggregateError([withCode("connect ECONNREFUSED 203.0.113.1:443", "ECONNREFUSED")], "");
  const v = sourceFailVerdict(agg);
  assert.strictEqual(v.kind, "network");
  assert.match(v.verdict, /連不到 Yahoo/); assert.match(v.verdict, /不是網址的問題/);
  assert.doesNotMatch(v.verdict, /換個來源|改貼/);
  assert.match(v.verdict, /（技術訊息：.*ECONNREFUSED.*）$/);
  const h = sourceFailVerdict(new Error("HTTP 503 for https://x"));
  assert.strictEqual(h.kind, "http"); assert.match(h.verdict, /再換一個來源/);
  const o = sourceFailVerdict(new Error("怪事"));
  assert.strictEqual(o.kind, "other"); assert.match(o.verdict, /系統管理員/);
});
