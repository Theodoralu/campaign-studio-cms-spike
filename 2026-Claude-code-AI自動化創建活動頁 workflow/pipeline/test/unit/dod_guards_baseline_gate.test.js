/* G6：draft 寫入點基線調動必附登記（2026-09-22 使用者裁 Q3 丙）
 *
 * 守的病：G3 是「數量閘」——數程式裡有幾個地方會寫入頁面資料，超過基線就紅。
 * 但數量閘的逃生口就是改數量：把上限從 16 改成 17，紅燈就沒了，
 * 而它原本的紅燈訊息還親口教你「把基線調為 N」。於是「請確認新入口有讓舊章失效」
 * 這句請人確認的話，可以一個字都不看就繞過去——而它守的是消費者看到的頁面。
 *
 * G6 把捷徑堵死：動基線就要同批動登記檔，調高還要真的多出一筆登記。
 * 本檔的重點不是「G6 會綠」，是**證明它真的會紅**（09-15 判準：綠燈要先證明它會紅；
 * 09-16 病例＝黑話絆線第一版故障注入五發只中一發，因為比對面太窄）。
 */
"use strict";
const { test, describe } = require("node:test");
const assert = require("node:assert");
const { draftBaselineGate, countAllowEntries } = require("../../tools/dod-guards.js");

const BASE = ".dod-baseline.json";
const ALLOW = "scripts/draft-writers.allow";
const bl = (n) => JSON.stringify({ emptyCatchMax: 33, draftWriters: n });
// 登記檔的一筆＝行首非空白非 # 的一行（續行縮排、註解以 # 開頭，都不算）
const allowOf = (...ids) =>
  "# draft.json 寫入點登記\n# ──────\n" +
  ids.map((i) => `${i}  server.js  writeFileSync draft.json  invalidateApproval ✓\n     （續行說明不該被算成一筆）`).join("\n") + "\n";

describe("G6 基線調動必附登記", () => {
  describe("該擋的（紅）", () => {
    test("① 只把上限改大、登記檔沒跟上＝擋（這就是原本那條捷徑）", () => {
      const r = draftBaselineGate({
        staged: [BASE], headBaseline: bl(15), stagedBaseline: bl(16),
        headAllow: allowOf("a"), stagedAllow: allowOf("a"),
      });
      assert.equal(r.ok, false);
      assert.match(r.detail, /只改數字不算數/);
      assert.match(r.detail, /invalidateApproval/); // 紅燈要教怎麼做，不是只說不行
    });

    test("② 登記檔有進本批，但一筆都沒多＝擋（碰一下檔案不算交代）", () => {
      const r = draftBaselineGate({
        staged: [BASE, ALLOW], headBaseline: bl(15), stagedBaseline: bl(16),
        headAllow: allowOf("a", "b"), stagedAllow: allowOf("a", "b"), // 只改了註解之類
      });
      assert.equal(r.ok, false);
      assert.match(r.detail, /沒多出任何一筆/);
      assert.match(r.detail, /2 → 2 筆/);
    });

    test("③ 登記檔反而變少、上限卻調高＝擋", () => {
      const r = draftBaselineGate({
        staged: [BASE, ALLOW], headBaseline: bl(15), stagedBaseline: bl(18),
        headAllow: allowOf("a", "b", "c"), stagedAllow: allowOf("a"),
      });
      assert.equal(r.ok, false);
    });

    test("④ 一次跳很多也一樣擋（不是只擋 +1）", () => {
      const r = draftBaselineGate({
        staged: [BASE], headBaseline: bl(15), stagedBaseline: bl(99),
        headAllow: allowOf("a"), stagedAllow: allowOf("a"),
      });
      assert.equal(r.ok, false);
      assert.match(r.detail, /15 → 99/);
    });
  });

  describe("該放行的（綠）——不擋有正當手續的人", () => {
    test("⑤ 上限調高＋登記真的多一筆＝放行", () => {
      const r = draftBaselineGate({
        staged: [BASE, ALLOW], headBaseline: bl(15), stagedBaseline: bl(16),
        headAllow: allowOf("a"), stagedAllow: allowOf("a", "b"),
      });
      assert.equal(r.ok, true);
      assert.match(r.detail, /1 → 2 筆/);
    });

    test("⑥ 上限調降（ratchet 收緊）＋登記檔同批更新＝放行", () => {
      const r = draftBaselineGate({
        staged: [BASE, ALLOW], headBaseline: bl(16), stagedBaseline: bl(15),
        headAllow: allowOf("a", "b"), stagedAllow: allowOf("a"),
      });
      assert.equal(r.ok, true);
      assert.match(r.detail, /ratchet 收緊/);
    });

    test("⑦ 基線檔根本不在本批＝不適用，不吵人", () => {
      const r = draftBaselineGate({
        staged: ["workbench/server.js"], headBaseline: bl(15), stagedBaseline: bl(15),
        headAllow: allowOf("a"), stagedAllow: allowOf("a"),
      });
      assert.equal(r.ok, true);
      assert.equal(r.moved, false);
    });

    test("⑧ 改的是基線裡別的欄位（draftWriters 沒動）＝放行", () => {
      const r = draftBaselineGate({
        staged: [BASE], headBaseline: bl(15),
        stagedBaseline: JSON.stringify({ emptyCatchMax: 30, draftWriters: 15 }),
        headAllow: allowOf("a"), stagedAllow: allowOf("a"),
      });
      assert.equal(r.ok, true);
      assert.match(r.detail, /未動/);
    });

    test("⑨ 讀不到基線值（新檔／壞 JSON）＝本閘不判，交給 G3，不假裝有結論", () => {
      for (const bad of ["", "{壞掉的 JSON", JSON.stringify({ draftWriters: "十六" })]) {
        const r = draftBaselineGate({
          staged: [BASE], headBaseline: bad, stagedBaseline: bl(16),
          headAllow: allowOf("a"), stagedAllow: allowOf("a"),
        });
        assert.equal(r.ok, true, `輸入 ${JSON.stringify(bad)} 應不判`);
        assert.match(r.detail, /G3/);
      }
    });
  });

  describe("登記筆數怎麼算（算錯就等於門沒在看）", () => {
    test("⑩ 只算行首非空白非 # 的行；註解、續行、空行都不算", () => {
      const txt = [
        "# 這是註解",
        "",
        "curate-initial   workbench/curate_auto.js  writeFileSync draft.json",
        "     （這是上一筆的續行說明，不是新的一筆）",
        "# 另一段註解",
        "combo-apply      lib/hero_combo.js  writeComboIntoDraft",
      ].join("\n");
      assert.equal(countAllowEntries(txt), 2);
    });

    test("⑪ 空輸入與 null 都回 0，不丟例外", () => {
      assert.equal(countAllowEntries(""), 0);
      assert.equal(countAllowEntries(null), 0);
      assert.equal(countAllowEntries(undefined), 0);
    });

    test("⑫ 真檔案讀得出筆數（絆線：格式若改掉，這裡會先紅）", () => {
      const fs = require("node:fs"), path = require("node:path");
      const real = fs.readFileSync(path.join(__dirname, "../../", ALLOW), "utf8");
      assert.ok(countAllowEntries(real) >= 20, `真登記檔應有 20 筆以上，實得 ${countAllowEntries(real)}`);
    });
  });
});
