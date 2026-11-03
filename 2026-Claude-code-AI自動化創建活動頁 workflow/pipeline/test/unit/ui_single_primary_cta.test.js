/* 「同一時間會不會有兩顆主色鈕在使用者眼前」絆線（2026-09-11 使用者裁丁案）。
   ------------------------------------------------------------------
   源起：07-29 使用者裁「全畫面唯一 Tier-1 CTA」；08-27 S9 合體制給任務條加了主行動鈕，
   右上 #btn-main 那顆沒回頭處理、一直帶 class="primary"＝兩顆主色並存。
   2026-09-11 丙案把兩顆的字統一之後變成一模一樣的雙胞胎，使用者截圖一眼看到。

   丁案＝右上永遠存在、只有任務條不在使用者眼前時才升主色。
   實量補正（同日走查）：這個外殼是固定框、任務條釘住不會捲走，會讓它消失的只有「沒狀態／沒開活動」時整條藏起來；
   所以編修頁裡右上實際上一直是次要，偵測是為藏起來的狀態與日後版面改動留的保險。守三件：
     ①右上標記不得預設帶 primary（否則任務條在畫面上時就是兩顆）
     ②層級由可見度決定，偵測失效時的預設值必須是「任務條可見」＝右上維持次要＝仍只有一顆主色
       （失敗要往「少一顆」倒，不能往「兩顆都亮」倒）
     ③用換樣式不用藏元素（元素消失＝焦點掉到頁頂，07-25 踩過）
   跟平行線的 ui_delivery_copy.test.js 分開放：那支守「字」，這支守「態」。 */
"use strict";
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const UI = fs.readFileSync(path.resolve(__dirname, "..", "..", "workbench", "public", "index.html"), "utf8");

test("右上主鈕標記不得預設帶 primary（任務條在畫面上時它是次要）", () => {
  const tag = (UI.match(/<button[^>]*id="btn-main"[^>]*>/) || [])[0];
  assert.ok(tag, "找不到 #btn-main");
  assert.doesNotMatch(tag, /class="[^"]*\bprimary\b/, `右上主鈕預設帶 primary＝任務條可見時兩顆主色並存：${tag}`);
});

test("層級由任務條可見度決定；偵測失效的預設是「可見」＝右上維持次要", () => {
  assert.match(UI, /let tbVisible = true;/, "預設值必須是 true——失效時要往『少一顆主色』倒，不能往『兩顆都亮』倒");
  const fn = (UI.match(/function syncMainBtnTier\(\)\{[\s\S]*?\n\}/) || [])[0] || "";
  assert.ok(fn, "找不到 syncMainBtnTier");
  assert.match(fn, /classList\.toggle\("primary", !tbVisible\)/, "層級不是照可見度切換");
  /* 只換 class、不藏元素：函式裡不准出現 display／hidden／remove */
  assert.doesNotMatch(fn, /style\.display|\.hidden\s*=|\.remove\(\)|visibility/, "用藏元素的方式＝焦點會掉、版面會跳（07-25 病例）");
});

test("可見偵測有能力檢查、掛失敗不炸頁；沒有 IntersectionObserver 就不掛、維持預設", () => {
  const fn = (UI.match(/function ensureTaskBarObserver\(\)\{[\s\S]*?\n\}/) || [])[0] || "";
  assert.ok(fn, "找不到 ensureTaskBarObserver");
  /* 走查實測：`"IntersectionObserver" in window` 在屬性存在但值不是建構子時會放行，然後 new 直接炸、openRun 整個中止 */
  assert.match(fn, /typeof window\.IntersectionObserver !== "function"/, "能力檢查要看是不是建構子，不是看屬性在不在");
  assert.match(fn, /try \{[\s\S]*new IntersectionObserver[\s\S]*\} catch/, "掛觀察者沒包 try——裝飾功能炸掉會把編修頁一起拖垮");
  assert.match(fn, /if \(tbObserver !== null\) return;/, "沒有防重掛＝每次重繪多掛一個觀察者（失敗態 false 也要擋住重試）");
});

test("渲染主鈕與任務條之後有同步層級（不然重繪會把 class 洗回舊態）", () => {
  const rs = UI.indexOf("btn.textContent = st.topLabel;");
  assert.ok(rs > 0, "找不到寫 topLabel 的地方");
  const after = UI.slice(rs, rs + 600);
  assert.match(after, /syncMainBtnTier\(\)/, "寫完 topLabel 沒同步層級");
});
