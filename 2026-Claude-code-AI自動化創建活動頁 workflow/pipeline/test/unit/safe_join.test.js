/* 路徑穿越守門（workbench/server.js safeJoin）——2026-09-11 補洞後的絆線。
   ------------------------------------------------------------------
   原本只判 `p.startsWith(root)`。那會讓「同前綴的姊妹資料夾」通過：
   root=/x/briefs 配 rel=`../briefs-evil/a` 正規化成 /x/briefs-evil/a，startsWith 為真。
   本機單人工具風險低，但這是守門不是提示——守門要嘛擋得住，要嘛別叫守門。

   本檔不 require server.js（它一 require 就起服務），改為對照同一份實作邏輯測。
   **所以有一條自我防線**：下面那條「實作沒漂」會把 server.js 裡的原始碼撈出來比對，
   哪天有人只改了 server 沒改這裡，會紅。 */
"use strict";
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

/* 與 workbench/server.js 同一份邏輯（見上方說明與下面的「實作沒漂」測試） */
const safeJoin = (root, rel) => {
  const base = path.resolve(root);
  const p = path.resolve(base, rel);
  return p === base || p.startsWith(base + path.sep) ? p : null;
};

const ROOT = path.resolve("/tmp/_sj/briefs");

test("放行：資料夾內的正常相對路徑", () => {
  for (const ok of ["built-in/01.md", "mine/我的檔.md", "./mine/a.md", "mine//b.md"]) {
    assert.ok(safeJoin(ROOT, ok), `應放行卻擋了：${ok}`);
  }
  assert.strictEqual(safeJoin(ROOT, ""), ROOT, "空字串＝資料夾本身，應放行");
});

test("擋下：往上跳出資料夾", () => {
  for (const bad of ["../secret.md", "../../etc/passwd", "mine/../../x.md", "built-in/../../../y.md"]) {
    assert.strictEqual(safeJoin(ROOT, bad), null, `應擋卻放行了：${bad}`);
  }
});

test("擋下：同前綴的姊妹資料夾（這就是 2026-09-11 補的那個洞）", () => {
  for (const bad of ["../briefs-evil/a.md", "../briefsX/a.md", "../briefs.bak/a.md"]) {
    const got = safeJoin(ROOT, bad);
    assert.strictEqual(got, null, `同前綴姊妹資料夾應擋卻放行了：${bad} → ${got}`);
  }
});

test("擋下：絕對路徑硬塞", () => {
  for (const bad of ["/etc/passwd", "/tmp/_sj/briefs-evil/a.md"]) {
    assert.strictEqual(safeJoin(ROOT, bad), null, `絕對路徑應擋卻放行了：${bad}`);
  }
  /* 指回自己資料夾內的絕對路徑＝可以放行（resolve 後落在 base 之下） */
  assert.ok(safeJoin(ROOT, path.join(ROOT, "mine/a.md")));
});

test("實作沒漂：server.js 裡的 safeJoin 仍是「等於 base 或 base+分隔字元開頭」這一版", () => {
  const src = fs.readFileSync(path.resolve(__dirname, "..", "..", "workbench", "server.js"), "utf8");
  const body = (src.match(/const safeJoin = \(root, rel\) => \{[\s\S]*?\n\};/) || [])[0] || "";
  assert.ok(body, "找不到 safeJoin——它被搬家或改名了，本測試要同步更新");
  assert.match(body, /path\.resolve\(/, "改回 path.join 就沒有正規化保證了");
  assert.match(body, /base \+ path\.sep/, "少了分隔字元＝同前綴姊妹資料夾又會通過（2026-09-11 的洞）");
  assert.doesNotMatch(body, /return p\.startsWith\(root\)/, "回到舊寫法了");
});
