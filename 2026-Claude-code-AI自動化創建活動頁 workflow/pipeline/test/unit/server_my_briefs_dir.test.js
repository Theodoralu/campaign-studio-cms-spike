/* 策略檔分家（2026-09-22 使用者核准）：內建範本留在包裡、自己寫的存家目錄。
   病例＝同事裝第三版包實測——啟動器只交代 CAMPAIGN_RUNS_DIR、沒交代策略檔，
   於是他寫的策略檔被存在包裡面，換一顆包就消失，而第二版包的說明親口寫著「換電腦都帶得走」。

   ⚠ 這支存在的理由：既有兩支策略檔測試（server_brief_flow／server_mine_trash）都只設
   CAMPAIGN_BRIEFS_DIR，所以走的是「沒交代＝沿舊行為」那條路——它們全綠只證明舊行為沒壞，
   完全沒驗到分家與搬家（卡 20260921-fixtures-that-flatter-the-gate：綠燈可能只因素材是最短那個）。
   本檔把兩個資料夾分開起，並且預先在舊位置放一份，驗搬家真的發生。 */
"use strict";
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

const PIPE = path.resolve(__dirname, "..", "..");
const PORT = 23000 + Math.floor(Math.random() * 900);
const BASE = `http://127.0.0.1:${PORT}`;
let child, out = "", runs, packBriefs, myBriefs;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const J = async (p, init) => { const r = await fetch(BASE + p, init); let j = null; try { j = await r.json(); } catch (e) { j = null; } return { status: r.status, j }; };
const POST = (p, body, method = "POST") => J(p, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
/* /api/briefs 回的是 { ok, briefs:[…] }，不是裸陣列——第一版測試假設成裸陣列，於是「內建剩 0 份」
   是測試自己壞的、不是程式壞的（今天第 N 次：先確認量尺，再相信讀數）。 */
const briefList = async () => (((await J("/api/briefs")).j) || {}).briefs || [];

/* 合格的策展劇本＝直接拿內建範本，避免這支測試去重寫一份格式（格式真源只有一個） */
function builtinSample() {
  const dir = path.join(PIPE, "briefs", "built-in");
  const f = fs.readdirSync(dir).filter((x) => /\.md$/.test(x)).sort()[0];
  return fs.readFileSync(path.join(dir, f), "utf8");
}

test.before(async () => {
  runs = fs.mkdtempSync(path.join(os.tmpdir(), "wb-mbd-runs-"));
  packBriefs = fs.mkdtempSync(path.join(os.tmpdir(), "wb-mbd-pack-"));
  myBriefs = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "wb-mbd-home-")), "briefs", "mine");

  // 包裡：內建範本＋Gemini 指令（唯讀那一半）
  fs.cpSync(path.join(PIPE, "briefs", "built-in"), path.join(packBriefs, "built-in"), { recursive: true });
  fs.copyFileSync(path.join(PIPE, "briefs", "Gemini助理指令.md"), path.join(packBriefs, "Gemini助理指令.md"));

  // 舊位置預先放兩份＝模擬「同事已經在舊版上存過策略檔」：一份要被搬走、一份在新位置同名（不可覆蓋）
  fs.mkdirSync(path.join(packBriefs, "mine"), { recursive: true });
  fs.writeFileSync(path.join(packBriefs, "mine", "舊版存的.md"), builtinSample());
  fs.writeFileSync(path.join(packBriefs, "mine", "同名的.md"), builtinSample().replace(/^/, "<!-- 舊位置那份 -->\n"));
  fs.mkdirSync(myBriefs, { recursive: true });
  fs.writeFileSync(path.join(myBriefs, "同名的.md"), builtinSample().replace(/^/, "<!-- 新位置那份，不可被覆蓋 -->\n"));

  const env = {
    ...process.env, CAMPAIGN_MODE: "editor", CAMPAIGN_RUNS_DIR: runs,
    CAMPAIGN_BRIEFS_DIR: packBriefs, CAMPAIGN_MY_BRIEFS_DIR: myBriefs,
    CAMPAIGN_CAPS: "ai:0,publish:0,vendorSheet:0",
  };
  delete env.WB_PASS;
  child = spawn(process.execPath, [path.join(PIPE, "workbench", "server.js"), String(PORT)], { env, stdio: ["ignore", "pipe", "pipe"] });
  child.stdout.on("data", (d) => { out += d; }); child.stderr.on("data", (d) => { out += d; });
  let last = null;
  for (let i = 0; i < 200; i++) { try { if ((await fetch(`${BASE}/ping`)).status === 204) { last = null; break; } } catch (e) { last = e; } await sleep(300); }
  if (last) throw new Error("起不來：" + last.message + "\n" + out.slice(-800));
});
test.after(() => { try { child.kill("SIGTERM"); } catch (e) { /* 已結束 */ } });

test("分家①：內建範本還在（分家不能把包裡那一半弄丟）", async () => {
  const arr = await briefList();
  const builtin = arr.filter((b) => b.kind === "built-in");
  assert.ok(builtin.length >= 5, `內建範本只剩 ${builtin.length} 份：${JSON.stringify(arr)}`);
  const gem = await J("/api/briefs/gem-instructions");
  assert.strictEqual(gem.status, 200);
  assert.ok((gem.j.text || "").length > 200, "Gemini 指令讀不到＝包裡那一半被改壞了");
});

test("分家②：貼上的策略檔落在家目錄，包裡不會多出東西", async () => {
  const before = fs.readdirSync(path.join(packBriefs, "mine")).filter((f) => /\.md$/.test(f)).length;
  const r = await POST("/api/briefs/mine", { text: builtinSample(), name: "貼上測試" });
  assert.strictEqual(r.status, 200, JSON.stringify(r.j));
  assert.match(r.j.file, /^mine\//, "回傳的邏輯路徑仍然要長 mine/xxx（前端不必知道實體在哪）");

  const landed = path.join(myBriefs, path.basename(r.j.file));
  assert.ok(fs.existsSync(landed), `沒落在家目錄：${landed}`);
  const after = fs.readdirSync(path.join(packBriefs, "mine")).filter((f) => /\.md$/.test(f)).length;
  assert.strictEqual(after, before, "包裡的 mine 多了檔案＝還是存回包裡面了");

  // 讀回來要讀得到（邏輯路徑要真的通到新位置）
  const back = await J(`/api/briefs/read?file=${encodeURIComponent(r.j.file)}`);
  assert.strictEqual(back.status, 200, JSON.stringify(back.j));
});

test("搬家③：舊位置那份被搬過來，而且出聲", async () => {
  assert.ok(fs.existsSync(path.join(myBriefs, "舊版存的.md")), "舊版存的策略檔沒有被搬過來＝同事會弄丟");
  assert.match(out, /策略檔搬家：從包裡搬出/, "搬了卻不出聲＝鐵律 3（日誌：" + out.slice(-300) + "）");
  const listed = await briefList();
  assert.ok(listed.some((b) => b.kind === "mine" && /舊版存的/.test(b.file || b.name || "")), "搬過來了但清單看不到：" + JSON.stringify(listed));
});

test("搬家④：同名的不覆蓋——以新位置那份為準", async () => {
  const txt = fs.readFileSync(path.join(myBriefs, "同名的.md"), "utf8");
  assert.match(txt, /新位置那份，不可被覆蓋/, "搬家把使用者新位置的檔覆蓋掉了＝比不搬更糟");
});
