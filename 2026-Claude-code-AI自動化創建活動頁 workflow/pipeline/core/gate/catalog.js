"use strict";
/**
 * core/gate/catalog.js —— 檢查點（CP）清單（D10，2026-11-17）
 *
 * 來源＝repo 現有程式（gate.js 會發出的 26 個代號＋aem_verify.js 的 CP-32）。Alice 團隊的檢查點登記表（00 號，CP-01～35）尚未拿到全文，
 * 到手後逐條對這份；對不上的號碼列在 NOT_IN_REPO（目前只知道號碼不在 gate.js，內容待登記表確認）。
 *
 * 欄位：code｜title（白話：在查什麼）｜max（最重會到哪一級：FAIL＝擋發佈、WARN＝提醒不擋）｜where（哪支程式發）｜
 *       test（哪裡有測試資料會觸發它：catalog＝test/unit/cp_catalog.test.js 的變異案例；其餘＝既有測試檔名）
 * test/unit/cp_catalog.test.js 守兩件事：gate.js 發得出來的代號都在這張表；表上每一條都有測試資料。
 */
const CATALOG = [
  { code: "CP-01", title: "主視覺標題用到字型沒有的字（會整段換成備用字型）", max: "WARN", where: "gate", test: ["catalog"] },
  { code: "CP-02", title: "真值：價格、折數、品名、連結、檔期、標籤都要跟來源快照逐字相符", max: "FAIL", where: "gate", test: ["gate_golden.test.js", "gate_cp02_url_forms.test.js", "first_draft_no_red.test.js"] },
  { code: "CP-03", title: "文字寬度：商品標籤、主視覺品名不能超出版位", max: "FAIL", where: "gate", test: ["gate_hero_slots.test.js", "unit/gate_friendly_five_codes.test.js"] },
  { code: "CP-04", title: "連結只能連 Yahoo 購物網域；圖片網址要打得開", max: "FAIL", where: "gate", test: ["gate_golden.test.js", "unit/cp02_deadlock_exits.test.js"] },
  { code: "CP-06", title: "同一模組內（以及編輯精選與本期活動之間）不能出現同一個活動或同一個連結", max: "FAIL", where: "gate", test: ["gate_entry_count.test.js", "unit/dup_product_marking.test.js"] },
  { code: "CP-07", title: "活動入口連到的活動已經過期", max: "FAIL", where: "gate", test: ["catalog"] },
  { code: "CP-08", title: "活動入口的圖必須是該活動（或該商品）的第一張商品圖", max: "FAIL", where: "gate", test: ["catalog"] },
  { code: "CP-09", title: "商品型入口：只能連商品頁、不能寫優惠或檔期字眼、不顯示檔期", max: "FAIL", where: "gate", test: ["catalog"] },
  { code: "CP-10", title: "本期活動的來源模式要一致（優惠活動／品牌推薦／商品替補），且查得到出處", max: "FAIL", where: "gate", test: ["catalog"] },
  { code: "CP-11", title: "主視覺商品圖必須是該商品的第二張商品圖", max: "FAIL", where: "gate", test: ["gate_hero_gates.test.js"] },
  { code: "CP-12", title: "各樓層情境卡的連結不能重複", max: "FAIL", where: "gate", test: ["unit/content_checks.test.js"] },
  { code: "CP-13", title: "文案裡不能出現網址或參數（search p=、actid=、http://）", max: "FAIL", where: "gate", test: ["catalog"] },
  { code: "CP-14", title: "主題契合：活動入口的商品要跟活動主題有關（命中率門檻 30%）", max: "FAIL", where: "gate", test: ["unit/theme_fit_entries.test.js", "unit/curation_brief_fit.test.js"] },
  { code: "CP-15", title: "本期活動入口數量 3～12 則", max: "FAIL", where: "gate", test: ["gate_entry_count.test.js", "unit/content_modules.test.js"] },
  { code: "CP-16", title: "品類牆數量 1～3 面", max: "FAIL", where: "gate", test: ["unit/content_modules.test.js"] },
  { code: "CP-17", title: "本期活動入口不能活動型與商品型混用；模組標題要跟入口型別相符", max: "FAIL", where: "gate", test: ["catalog"] },
  { code: "CP-18", title: "全頁互斥：同一件商品不能在頁面上出現兩次", max: "FAIL", where: "gate", test: ["gate_exposure_boundary.test.js", "first_draft_no_red.test.js"] },
  { code: "CP-20", title: "模組主從一致：樓層／牆的標題跟裡面的商品、連結要對得上（只對同義表內的品類生效）", max: "FAIL", where: "gate", test: ["catalog"] },
  { code: "CP-21", title: "品類牆每面商品數應為 4／8／12 件", max: "FAIL", where: "gate", test: ["unit/content_modules.test.js", "unit/wall_add_cap.test.js"] },
  { code: "CP-22", title: "「看更多」連結的目的地要合法、搜尋結果不能是空的", max: "FAIL", where: "gate", test: ["gate_entry_count.test.js", "gate_golden.test.js"] },
  { code: "CP-25", title: "版式貨號（kvVariant）必須在登記簿裡，而且引擎已支援", max: "FAIL", where: "gate", test: ["gate_hero_gates.test.js", "unit/layout_choice.test.js"] },
  { code: "CP-26", title: "草稿不能殘留佔位字（例如「滿 $-- 折 $--」）", max: "FAIL", where: "gate", test: ["gate_hero_gates.test.js", "unit/gate_message_long_values.test.js"] },
  { code: "CP-27", title: "素材授權：背景、動畫、字風都要是審核通過的；自己上傳的背景要三張齊", max: "FAIL", where: "gate", test: ["gate_hero_gates.test.js", "unit/hero_bg_license.test.js"] },
  { code: "CP-28", title: "主視覺上的商品必須綁賣場編號（價格才能連動）", max: "FAIL", where: "gate", test: ["gate_hero_gates.test.js", "unit/gate_friendly_five_codes.test.js"] },
  { code: "CP-29", title: "主視覺商品槽件數：至少 1 件、不超過該槽上限", max: "FAIL", where: "gate", test: ["unit/gate_friendly_five_codes.test.js"] },
  { code: "CP-31", title: "內文模組（資訊卡、banner、主打選品、促銷卡）在場就要填完整", max: "FAIL", where: "gate", test: ["gate_hero_gates.test.js", "unit/gate_friendly_five_codes.test.js"] },
  { code: "CP-32", title: "AEM 檔顯示檢查：桌機／平板／手機實際打開，零錯誤、單檔自足、不溢出、與未瘦身版一致", max: "FAIL", where: "aem_verify", test: ["ci:aem-verify"] },
];
/** 登記表有號、但 repo 的 gate.js 沒有發這個代號（內容待 Alice 的登記表確認；CP-19 價格巡檢排程已停用，不搬） */
const NOT_IN_REPO = ["CP-05", "CP-19", "CP-23", "CP-24", "CP-30", "CP-33", "CP-34", "CP-35"];
const byCode = new Map(CATALOG.map((c) => [c.code, c]));
module.exports = { CATALOG, NOT_IN_REPO, byCode };
