"use strict";
const LEGACY_ROOT = process.env.CS_LEGACY_ROOT || "<legacy-root>"; // D5：單機版作者的設計源檔根目錄，不在 repo；要跑請設環境變數
/* 活動策略檔旅程走查（71 號；2026-09-11）——照使用者的路真點擊：
     建立頁選策略檔 → 開始策展（快速草稿＝沒有 AI 那條路）→ 編修頁看文案有沒有照他寫的走。
   用法：node test/browser/brief-journey.js <port> <outDir>
   前置：workbench server 活著、能連 tw.buy.yahoo.com。node --test 下跳過（非 hermetic）。

   兩個 2026-09-11 走查踩過的坑已寫進腳本，別再拿掉：
     ①送出前檢查擋下時要把提示抓出來——原本靜默空等 240 秒才逾時，沉默不等於進行中。
     ②樓層區塊預設收合＝內容還沒渲染；而且 innerText 不含輸入框的值。要逐層開、讀 input.value。 */
if (process.env.NODE_TEST_CONTEXT) { console.log("brief-journey：手動旅程走查（需 Chrome＋活 server＋外網），node --test 下跳過"); return; }
const fs=require("fs"),path=require("path");
const PIPE=`${LEGACY_ROOT}/2026-Claude-code-AI自動化創建活動頁 workflow/pipeline`;
const pw=require(PIPE+"/node_modules/playwright-core");
const PASS=fs.readFileSync(path.join(PIPE,"workbench",".wb-pass"),"utf8").trim();
const BRIEF="built-in/05-時事主題-情境選品.md", SRC="https://tw.buy.yahoo.com/category/4481524";
const R=[],ok=(n,p,note)=>{R.push(p);console.log(`${p?"PASS":"FAIL"}  ${n}${note?"  |  "+note:""}`);};
(async()=>{
  const b=await pw.chromium.launch({channel:"chrome",headless:true});
  const p=await (await b.newContext({viewport:{width:1440,height:950},httpCredentials:{username:"yahoo",password:PASS}})).newPage();
  const errs=[]; p.on("pageerror",e=>errs.push(String(e)));
  await p.goto("http://127.0.0.1:8791/",{waitUntil:"domcontentloaded"});
  await p.waitForSelector("#home-create-card",{timeout:15000});
  await p.click("#home-btn-create"); await p.waitForTimeout(1500);

  await p.fill("#in-url",SRC);
  const cards=await p.$$("#recipe-cards .recipe-card");
  await p.click('#recipe-cards .recipe-card[data-scenario="時事主題-情境×選品"]'); // 2026-09-15 卡名改口＝改用 value 鍵找卡，不跟顯示字綁死
  await p.waitForTimeout(800);
  await p.fill("#in-theme","中秋烤肉");
  await p.selectOption("#in-brief",BRIEF); await p.waitForTimeout(500);
  ok("選了策略檔、確認句出現", /會帶入：主標、分幾層/.test(await p.$eval("#in-brief-note",e=>e.textContent)));
  await p.fill("#in-owner-email","tofu");
  // 部門是必填（2026-09-11 走查踩到：沒填就被送出前檢查擋下，然後空等逾時）
  const depts=await p.$$eval("#in-owner-dept option",o=>o.map(x=>x.value).filter(v=>v&&v!=="__custom__"));
  if(depts.length) await p.selectOption("#in-owner-dept",depts[0]);
  await p.waitForTimeout(400);
  await p.click('.engine-card[data-engine="auto"]');           // 快速草稿＝沒有 AI 的同事那條路
  await p.screenshot({path:path.join(process.argv[2],"j-create.png")});

  await p.click("#btn-create");
  // 被擋下時把提示抓出來，不要靜默空等（2026-09-11 踩過：漏填部門→等 240 秒才知道）
  await p.waitForTimeout(2500);
  const blocked=await p.evaluate(()=>{const t=document.querySelector("#toast,.toast");return t&&getComputedStyle(t).display!=="none"?t.textContent.trim():"";});
  if(blocked) { ok("送出沒有被擋下",false,"被擋："+blocked); await p.screenshot({path:path.join(process.argv[2],"j-blocked.png")}); await b.close(); process.exit(1); }
  await p.waitForFunction(()=>{const v=document.querySelector("#view-work");return v&&v.style.display==="flex";},null,{timeout:240000});
  const runId=await p.evaluate(()=>{const e=document.querySelector("[data-runid],#work-runid");return e?(e.dataset&&e.dataset.runid)||e.textContent.trim():(location.hash||"")});
  ok("建置完成、自動進編修頁",true,runId);
  await p.waitForTimeout(3000);

  const banner=await p.evaluate(()=>{const n=document.querySelector("#brief-note");return n&&n.style.display!=="none"?n.innerText.trim():"";});
  ok("編修頁講明哪些是策略檔帶入的", /照策略檔帶入了/.test(banner)&&/你的策略檔/.test(banner), banner.split("\n")[0]);
  ok("不再說選品「還不會影響選哪些商品」（2026-09-14 階段二接上；選品旅程另見 brief-selection-journey.js）", !/還不會影響選哪些商品/.test(banner));

  await p.waitForSelector("#sec-kv",{timeout:15000});
  await p.evaluate(()=>ensureSectionOpen("sec-kv")); await p.waitForTimeout(1500);
  const t0=await p.$eval('#editor-col [data-hero-piece$=":0"]',e=>e.value).catch(()=>"");
  ok("主標＝策略檔寫的（中秋烤肉／一次備齊）", /中秋烤肉/.test(t0)&&/一次備齊/.test(t0), JSON.stringify(t0));

  const floors=await p.evaluate(()=>{
    const d=window.draft&&window.draft.page&&window.draft.page.floors;
    return d?d.map(f=>f.title+"／"+(f.subtitle||"")):null;});
  ok("樓層＝策略檔寫的三層", Array.isArray(floors)&&/烤肉必備/.test(floors[0]||""), (floors||[]).join("  |  "));

  await p.screenshot({path:path.join(process.argv[2],"j-editor.png")});
  ok("零 console error", errs.length===0, errs.slice(0,2).join(" / "));
  console.log(`\n${R.filter(Boolean).length}/${R.length} 句成立｜run=${runId}`);
  await b.close(); process.exit(R.every(Boolean)?0:1);
})().catch(e=>{console.error("中止："+e.message);process.exit(2);});
