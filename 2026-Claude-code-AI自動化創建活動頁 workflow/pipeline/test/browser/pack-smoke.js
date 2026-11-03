"use strict";
/* pack-smoke：解開同事包自己跑一趟（第一層測試 ②；打包前總檢坑 3「包對不對不能靠人對清單」的機器解）
   ------------------------------------------------------------------
   白話：把剛打好的 zip 解到暫存資料夾，用「包裡自帶的 Node」以同事模式啟動，打幾條最會漏帶就會壞的路徑。
   任何漏帶（登記簿、引擎、背景地圖、內建範本、色彩引擎）都會在這裡現形，不必維護第二份名單。
   用法：node test/browser/pack-smoke.js <zip>        exit 0＝綠；1＝紅（逐條印）；2＝用法錯
   node --test 下跳過（非 hermetic、要 zip）。不開瀏覽器（能力全關掃字由 caps-journey 在開發樹覆蓋）。 */
if (process.env.NODE_TEST_CONTEXT) { console.log("pack-smoke：手動（需 zip），node --test 下跳過"); return; }
const fs = require("fs"), os = require("os"), path = require("path"), { spawn, execFileSync } = require("child_process");
const zip = process.argv[2];
if (!zip || !fs.existsSync(zip)) { console.error("用法：node test/browser/pack-smoke.js <zip>"); process.exit(2); }
let pass = 0, fail = 0; const ok = (n, c, note = "") => { (c ? pass++ : fail++); console.log(`${c ? "✔" : "✖"} ${n}${note ? "　" + note : ""}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function findFile(dir, tail, depth = 0) { // 路徑含中文與空格，不猜、走一遍找
  if (depth > 6) return null;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name === "node_modules") continue; const r = findFile(p, tail, depth + 1); if (r) return r; }
    else if (p.endsWith(tail)) return p;
  }
  return null;
}

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pack-smoke-"));
  const runs = fs.mkdtempSync(path.join(os.tmpdir(), "pack-smoke-runs-"));
  let ch = null;
  try {
    execFileSync("unzip", ["-q", zip, "-d", tmp]);
    const server = findFile(tmp, "/pipeline/workbench/server.js");
    ok("解開後找得到 pipeline/workbench/server.js", !!server, server ? "" : "包裡沒有伺服器主程式");
    if (!server) throw new Error("stop");
    const pipe = path.resolve(server, "..", "..");
    const pkgRoot = path.resolve(pipe, "..", "..");            // CampaignStudio/
    const arch = process.arch === "arm64" ? "arm64" : "x64";
    const nodeBin = path.join(pkgRoot, "runtime", `darwin-${arch}`, "node");
    ok(`包內自帶 Node（${arch}）存在且可執行`, fs.existsSync(nodeBin) && (fs.statSync(nodeBin).mode & 0o111) !== 0, nodeBin);
    const otherArch = arch === "arm64" ? "x64" : "arm64";
    ok(`另一種晶片的 Node（${otherArch}）也在`, fs.existsSync(path.join(pkgRoot, "runtime", `darwin-${otherArch}`, "node")));
    ok("Intel 與 M 系列的圖片套件都在", fs.existsSync(path.join(pipe, "node_modules", "@img", "sharp-darwin-x64")) && fs.existsSync(path.join(pipe, "node_modules", "@img", "sharp-darwin-arm64")));
    const versionFile = path.join(pipe, "workbench", "VERSION");
    const version = fs.existsSync(versionFile) ? fs.readFileSync(versionFile, "utf8").split("\n")[0].trim() : "";
    ok("VERSION 第一行＝日期-hash", /^\d{8}-[0-9a-f]{7,}$/.test(version), version || "（缺）");
    ok("負責人的私人東西不在包裡", !fs.existsSync(path.join(pipe, ".google-token.json")) && !fs.existsSync(path.join(pipe, "workbench", ".wb-pass")) && !fs.existsSync(path.join(pipe, "runs")) && !fs.existsSync(path.join(pipe, ".git")));

    /* 用包內 Node 起同事模式 */
    const port = 23000 + Math.floor(Math.random() * 900);
    const env = { ...process.env, CAMPAIGN_MODE: "editor", CAMPAIGN_RUNS_DIR: runs, CAMPAIGN_CAPS: "ai:0,publish:0,vendorSheet:0" }; delete env.WB_PASS;
    ch = spawn(nodeBin, [server, String(port)], { env, stdio: ["ignore", "pipe", "pipe"] });
    let log = ""; ch.stdout.on("data", (d) => { log += d; }); ch.stderr.on("data", (d) => { log += d; });
    let exited = null; ch.on("exit", (code) => { exited = code; });
    let up = false, lastErr = null; // 守門 G2：等待迴圈不吞錯——記最後一次原因，等不到時一起印（沿 caps-journey 寫法）
    for (let i = 0; i < 120 && exited === null; i++) { try { if ((await fetch(`http://127.0.0.1:${port}/ping`)).status === 204) { up = true; break; } } catch (e) { lastErr = e; } await sleep(500); }
    ok("用包內 Node 啟動、/ping 204", up, up ? "" : `結束碼 ${exited}；最後連線錯誤：${lastErr ? lastErr.message : "無"}；日誌尾：${log.slice(-400)}`);
    if (!up) throw new Error("stop");
    let v = null; for (let i = 0; i < 60; i++) { try { v = await (await fetch(`http://127.0.0.1:${port}/api/version`)).json(); if (v.caps) break; } catch (e) { lastErr = e; } await sleep(500); }
    if (!v || !v.caps) console.error(`（等能力表期間最後一次錯誤：${lastErr ? lastErr.message : "無"}）`);
    ok("/api/version：mode=editor、能力三項皆無", v && v.mode === "editor" && v.caps && !v.caps.ai && !v.caps.publish && !v.caps.vendorSheet);
    ok("/api/version.build＝VERSION 第一行（介面右上角會顯示的那個）", v && v.build === version, v ? String(v.build) : "");

    const briefs = await (await fetch(`http://127.0.0.1:${port}/api/briefs`)).json();
    const arr = briefs.items || briefs.briefs || briefs;
    const kinds = Array.isArray(arr) ? arr.map((b) => b.kind) : [];
    ok("策略檔清單只有內建範本、沒有負責人的", kinds.length >= 5 && kinds.every((k) => k === "built-in"), `${kinds.length} 份：${[...new Set(kinds)].join("/")}`);

    for (const [u, what] of [
      ["/frametest/index.html", "預覽引擎"],
      ["/frametest/assets/hero-bg/bg-map.js", "背景地圖（鏡像那份；源頭不帶）"],
      ["/frametest/assets/hero-bg/bg-001.png", "背景圖"],
      ["/api/layout-thumbs/layout-001.png", "版式縮圖（登記簿路徑）"],
      ["/api/layout-catalog", "版式目錄"],
      ["/api/flow-guide", "引導文案"],
      ["/api/runs", "活動列表（空）"],
      ["/", "首頁"],
    ]) { let s = 0, why = ""; try { s = (await fetch(`http://127.0.0.1:${port}${u}`)).status; } catch (e) { why = e.message; } ok(`${what} ${u} → 200`, s === 200, s ? String(s) : `連不上：${why}`); }

    /* 被關掉的路要真的關：發佈 403 */
    let s403 = 0, why403 = ""; try { s403 = (await fetch(`http://127.0.0.1:${port}/api/runs/x/deploy`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })).status; } catch (e) { why403 = e.message; }
    ok("同事版發佈路由 403", s403 === 403, s403 ? String(s403) : `連不上：${why403}`);

    await sleep(1500);
    const bad = (log.match(/\[fatal\]|Cannot find module|ENOENT|登記簿讀取失敗/g) || []);
    ok("開機日誌無 fatal／找不到模組／登記簿讀取失敗", bad.length === 0, bad.slice(0, 3).join("｜"));
  } catch (e) {
    if (e.message !== "stop") { fail++; console.log("✖ 冒煙本身出錯：" + e.message); }
  } finally {
    if (ch) { try { ch.kill("SIGTERM"); } catch (e) { console.warn("收工 kill 失敗（可能已結束）：" + e.message); } }
    try { fs.rmSync(tmp, { recursive: true, force: true }); fs.rmSync(runs, { recursive: true, force: true }); } catch (e) { console.warn("暫存清理失敗（不影響結果）：" + e.message); }
  }
  console.log(`\n解包冒煙：pass=${pass} fail=${fail}`);
  process.exit(fail ? 1 : 0);
})();
