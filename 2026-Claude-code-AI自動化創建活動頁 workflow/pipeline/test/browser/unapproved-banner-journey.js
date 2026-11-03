/* 未定稿橫幅・旅程走查（2026-09-14 三題牆第 1 題甲；2026-09-16 落地）
   ------------------------------------------------------------------
   走的是**拿到連結的人**那條路，不是捷徑注入：真的起一個 HTTP server 服 deploy-site、
   真的用 ?draftUrl= 進頁、真的讓頁面自己去 fetch 那份 JSON、真的過白名單與載入器。
   （52 號 §3-1a：把資料直接塞進最後一段看畫面＝跳過的每一層都可能藏著沒同步到的舊檢查。）

   測試用的那兩份 draft **不落檔**——server 在記憶體裡回應 /live-drafts/j-*.json，
   deploy-site 一個位元組都不動（那是產物區，R1）。

   跑法：node test/browser/unapproved-banner-journey.js
   需要：Chrome（playwright-core channel:chrome）＋已 sync 過的 deploy-site */
if (process.env.NODE_TEST_CONTEXT) { console.log("unapproved-banner-journey：手動旅程走查（需 Chrome），node --test 下跳過——手動跑：node test/browser/unapproved-banner-journey.js"); return; }
const { chromium } = require("playwright-core");
const http = require("http");
const path = require("path");
const fs = require("fs");

const ROOT = path.resolve(__dirname, "..", "..", "..", "..", "2026-AI自動化活動頁生成規劃", "deploy-site");
const COPY = "這一版還沒定稿，內容可能還會變——正式版以核可後的為準。";
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".woff2": "font/woff2" };

/* 三份稿只差「發佈鏈有沒有告訴我們核可狀態」這一格，內容完全相同＝差異一定來自 publish，不是別的東西 */
const draftBody = (publish) => {
  const d = {
    id: "journey", page: {
      pageName: "旅程走查專用（非真實活動）",
      kv: { eyebrowZh: "走查", titleLine1: "旅程走查", titleLine2: "非真實活動", dateValue: "2026.09.16 ~ 09.16" },
      floors: [], walls: [],
    },
    products: [{ gdid: "901", name: "走查用示意商品（非賣品）", img: "", price: 100, url: "https://tw.buy.yahoo.com/" }],
  };
  if (publish) d.publish = publish;
  return JSON.stringify(d);
};
const VIRTUAL = {
  "/live-drafts/j-unapproved.json": draftBody({ approved: false, approvedAt: null, publishedAt: "2026-09-16T02:00:00.000Z" }),
  "/live-drafts/j-approved.json": draftBody({ approved: true, approvedAt: "2026-09-16T01:00:00.000Z", publishedAt: "2026-09-16T02:00:00.000Z" }),
  "/live-drafts/j-legacy.json": draftBody(null), // 本功能上線前就已經發佈出去的頁＝沒有 publish 欄位
};

const serve = () => new Promise((resolve) => {
  const srv = http.createServer((req, res) => {
    const u = decodeURIComponent(req.url.split("?")[0]);
    if (VIRTUAL[u]) { res.writeHead(200, { "content-type": MIME[".json"] }); return res.end(VIRTUAL[u]); }
    const f = path.join(ROOT, u);
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end("not found"); }
    res.writeHead(200, { "content-type": MIME[path.extname(f).toLowerCase()] || "application/octet-stream" });
    fs.createReadStream(f).pipe(res);
  });
  srv.listen(0, "127.0.0.1", () => resolve({ srv, port: srv.address().port }));
});

/* 裝置模式走真機那條路：頁面開頭自己會判「有觸控且螢幕 <1200」→ location.replace 導向 ?device=。
   所以這裡給 hasTouch，讓那段程式自己跑，而不是手動塞 ?device=（塞參數＝跳過那一層，就不是使用者走的路了）。 */
const DEV = {
  desktop: { w: 1440, h: 900, touch: false, dev: "" },
  tablet: { w: 768, h: 1024, touch: true, dev: "tablet" },
  mobile: { w: 375, h: 812, touch: true, dev: "mobile" },
};

(async () => {
  const { srv, port } = await serve();
  const browser = await chromium.launch({ channel: "chrome" });
  const rows = [];
  let bad = 0;

  for (const [devName, D] of Object.entries(DEV)) {
    for (const [caseName, file] of [["未核可就發佈", "j-unapproved"], ["已核可", "j-approved"], ["沒有核可資訊（舊頁）", "j-legacy"]]) {
      const page = await browser.newPage({ viewport: { width: D.w, height: D.h }, hasTouch: D.touch, isMobile: D.touch });
      const errs = [];
      const missing = [];
      page.on("pageerror", (e) => errs.push("PAGEERROR " + e.message));
      page.on("console", (m) => { if (m.type() === "error" && !/net::|ERR_|status of 404/.test(m.text())) errs.push("CONSOLE " + m.text()); });
      page.on("response", (r) => { if (r.status() === 404) missing.push(new URL(r.url()).pathname); }); // 404 分開記＝走查用的精簡 server 沒有的檔（例：字型、示範圖），不與程式錯誤混為一談
      await page.goto(`http://127.0.0.1:${port}/lecreuset-frametest/index.html?draftUrl=../live-drafts/${file}.json`, { waitUntil: "load" });
      await page.waitForTimeout(2500);

      const r = await page.evaluate(() => {
        const el = document.getElementById("unapproved-banner");
        const vis = !!el && getComputedStyle(el).display !== "none";
        const uh = document.getElementById("sec-uh");
        return {
          shown: vis,
          text: el ? el.textContent.trim() : "(無節點)",
          // 橫幅在頁首之上、且沒有蓋住頁首（靜態塊推開內容，不是浮層）
          aboveHeader: !!(el && uh) && el.compareDocumentPosition(uh) === Node.DOCUMENT_POSITION_FOLLOWING,
          headerTop: uh ? Math.round(uh.getBoundingClientRect().top) : null,
          bannerBottom: vis && el ? Math.round(el.getBoundingClientRect().bottom) : null,
          // 真的有載到稿（不是示範資料）＝旅程真的走通，不是看到一個空殼加橫幅
          loadedDraft: document.body.classList.contains("draft-mode"),
          title: (document.getElementById("kv-title-line1") || {}).textContent || document.title,
          overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        };
      });

      const expectShown = file === "j-unapproved";
      const okShown = r.shown === expectShown;
      const okText = !r.shown || r.text === COPY;
      const okOrder = !r.shown || r.aboveHeader;
      const okPush = !r.shown || (r.bannerBottom !== null && r.headerTop !== null && r.headerTop >= r.bannerBottom - 1); // 推開而非遮住
      const okLoaded = r.loadedDraft;
      const okOverflow = r.overflowX <= 0;
      const okErr = errs.length === 0;
      const okDev = D.dev === "" || page.url().includes("device=" + D.dev); // 真機導向那一層有沒有真的跑到
      const pass = okShown && okText && okOrder && okPush && okLoaded && okOverflow && okErr && okDev;
      if (!pass) bad++;
      rows.push({ dev: devName, case: caseName, pass, 橫幅: r.shown ? "亮" : "不亮", 預期: expectShown ? "亮" : "不亮",
        文案對: okText, 在頁首之上: okOrder, 推開沒遮住: okPush, 有載到稿: okLoaded, 裝置模式對: okDev, 橫向溢出: r.overflowX, 錯誤: errs.slice(0, 2), 缺檔: [...new Set(missing)].slice(0, 3) });
      await page.close();
    }
  }

  await browser.close();
  srv.close();
  console.table(rows.map((x) => ({ 裝置: x.dev, 情境: x.case, 結果: x.pass ? "✓" : "✗", 橫幅: x.橫幅, 預期: x.預期, 文案: x.文案對 ? "✓" : "✗", 在頁首之上: x.在頁首之上 ? "✓" : "✗", 推開沒遮住: x.推開沒遮住 ? "✓" : "✗", 有載到稿: x.有載到稿 ? "✓" : "✗", 裝置模式: x.裝置模式對 ? "✓" : "✗", 溢出: x.橫向溢出 })));
  rows.filter((x) => !x.pass).forEach((x) => console.log("✗", x.dev, x.case, JSON.stringify(x)));
  console.log(bad === 0 ? `\n✓ 旅程走查通過：${rows.length}/${rows.length}（3 裝置 × 3 情境，真 HTTP＋真 ?draftUrl= 通道）` : `\n✗ ${bad} 項不合格`);
  process.exit(bad === 0 ? 0 : 1);
})();
