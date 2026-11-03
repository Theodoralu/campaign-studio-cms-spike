"use strict";
/* fetch_page_retry.test.js —— 第③件驗收（故障注入）：連線層失敗要換新連線再試一次；HTTP 5xx 不重試；兩次都失敗要印得出原因 */
const test = require("node:test");
const assert = require("node:assert");
const { EventEmitter } = require("node:events");
const { fetchPage } = require("../../fetch_parse.js");
const { errText } = require("../../lib/err_text.js");

const netFail = () => { const e = new AggregateError([Object.assign(new Error("connect ECONNREFUSED 203.0.113.1:443"), { code: "ECONNREFUSED" })], ""); return e; };
function fakeGet(plan, calls) {
  return (url, opts, cb) => {
    const i = calls.push({ url, opts }) - 1; const step = plan[i] || plan[plan.length - 1];
    const req = new EventEmitter(); req.setTimeout = () => {}; req.destroy = () => {};
    setImmediate(() => {
      if (step.err) return req.emit("error", step.err);
      const res = new EventEmitter(); res.statusCode = step.status || 200; res.headers = {}; res.setEncoding = () => {}; res.resume = () => {};
      cb(res); setImmediate(() => { if (res.statusCode === 200) res.emit("data", step.body || "<html>ok</html>"); res.emit("end"); });
    });
    return req;
  };
}

test("連線層失敗 → 800ms（測試縮成 10ms）後重試一次並成功；重試那次帶新連線參數", async () => {
  const calls = [];
  const r = await fetchPage("https://tw.buy.yahoo.com/brands/41193409", { get: fakeGet([{ err: netFail() }, { status: 200, body: "<html>第二次</html>" }], calls), retryDelayMs: 10 });
  assert.strictEqual(calls.length, 2);
  assert.strictEqual(r.html, "<html>第二次</html>");
  assert.strictEqual(calls[1].opts.autoSelectFamilyAttemptTimeout, 2000); // 重試那次放寬雙協定等待
});

test("HTTP 503 不是這台的問題 → 不重試、直接丟 HTTP 錯", async () => {
  const calls = [];
  await assert.rejects(fetchPage("https://tw.buy.yahoo.com/x", { get: fakeGet([{ status: 503 }], calls), retryDelayMs: 10 }), /HTTP 503/);
  assert.strictEqual(calls.length, 1);
});

test("兩次都連不上 → 丟出的錯用 errText 印得出 ECONNREFUSED（不是空白）", async () => {
  const calls = [];
  try { await fetchPage("https://tw.buy.yahoo.com/x", { get: fakeGet([{ err: netFail() }, { err: netFail() }], calls), retryDelayMs: 10 }); assert.fail("應該要丟錯"); }
  catch (e) { assert.strictEqual(calls.length, 2); assert.strictEqual(e.message, ""); assert.match(errText(e), /ECONNREFUSED/); }
});

test("故障注入開關 CS_FETCH_SIMULATE_OFFLINE=1 → 不打網路、直接丟多位址連不上的 AggregateError", async () => {
  process.env.CS_FETCH_SIMULATE_OFFLINE = "1";
  try { await assert.rejects(fetchPage("https://tw.buy.yahoo.com/x"), (e) => e instanceof AggregateError && e.message === "" && /ECONNREFUSED/.test(errText(e))); }
  finally { delete process.env.CS_FETCH_SIMULATE_OFFLINE; }
});
