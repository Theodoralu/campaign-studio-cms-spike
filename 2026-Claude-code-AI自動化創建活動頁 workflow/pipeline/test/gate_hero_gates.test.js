"use strict";
/**
 * gate.js v15 hero 版式三閘 golden 迴歸（51 號 W1-E＝CP-25 版式值域／CP-26 佔位殘留／CP-27 素材授權＋灰度門票）
 *
 * hermetic（W1-A review 教訓）：值域真源一律用 test/fixtures/registries/ 最小登記簿複本，
 * 經 GATE_REGISTRY_OVERRIDES env（inline JSON）注入——不依賴主 repo 佈局，pipeline 單獨 checkout 也綠。
 *
 * 做法沿 gate_golden.test.js：execFileSync 跑真實 CLI，斷言 exit code＋stdout 規則碼與訊息；
 * 一律 GATE_SKIP_HTTP=1（離線可重跑）。負向案以「單點突變」正向 fixture 產生（檢入檔＝E1 正負兩件，
 * 其餘分支在測內突變＋註明注入點）。
 */
const { test } = require("node:test");
const assert = require("node:assert");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const GATE = path.join(__dirname, "..", "gate.js");
const FIX = path.join(__dirname, "fixtures");
const REG = path.join(FIX, "registries");

// hermetic 登記簿注入（inline JSON 形；backgrounds 可換 noterms 版測 termsVerification 缺席分支）
const regOverrides = (opts = {}) => JSON.stringify({
  modules: path.join(REG, "modules.json"),
  layouts: path.join(REG, "layouts.manifest.json"),
  backgrounds: path.join(REG, opts.noTerms ? "backgrounds.noterms.manifest.json" : "backgrounds.manifest.json"),
  fonts: path.join(REG, "fonts.manifest.json"),
  motion: path.join(REG, "motion.manifest.json"),
  typestyles: path.join(REG, "typestyles.manifest.json"), // v17（2026-09-08）CP-27 字風分支樣本
  tokens: path.join(REG, "tokens.json"),
  /* 引擎完工名單注入（2026-08-25 引擎完工閘）：非引擎閘主題的測試以 fixture 版式全開＝隔離變因；
     引擎閘專屬測試傳 opts.engineReady=null＝走真名單 */
  ...(opts.engineReady === null ? {} : { engineReady: opts.engineReady || ["new", "legacy", "layout-001", "layout-002", "layout-006", "layout-014", "layout-015", "layout-016"] }),
});

const loadFixture = (name) => JSON.parse(fs.readFileSync(path.join(FIX, name), "utf8"));

// 跑真實 CLI；draft 可傳 fixture 檔名或（突變後的）物件。回傳 { status, stdout, report }。
// opts.noOverrides=true＝不設 GATE_REGISTRY_OVERRIDES（F1 預設值域來源案；draft 須無 kvVariant 才 hermetic）。
function runGate(draft, opts = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gate-hero-"));
  const snapPath = path.join(dir, "snapshot.json");
  const draftPath = path.join(dir, "draft.json"); // 檔名必以 draft.json 結尾＝報告落 tmp（沿 golden 慣例）
  fs.copyFileSync(path.join(FIX, "gate_pass_snapshot.json"), snapPath);
  if (typeof draft === "string") fs.copyFileSync(path.join(FIX, draft), draftPath);
  else fs.writeFileSync(draftPath, JSON.stringify(draft, null, 1));
  const env = { ...process.env, GATE_SKIP_HTTP: "1" };
  if (opts.noOverrides) delete env.GATE_REGISTRY_OVERRIDES;
  else env.GATE_REGISTRY_OVERRIDES = opts.registries ?? regOverrides(opts);
  let status = 0;
  let stdout = "";
  let report = null;
  try {
    stdout = execFileSync("node", [GATE, snapPath, draftPath], { encoding: "utf8", env });
  } catch (e) {
    status = e.status ?? 1;
    stdout = (e.stdout || "").toString();
  } finally {
    try { report = JSON.parse(fs.readFileSync(path.join(dir, "gate_report.json"), "utf8")); } catch { /* 報告缺席＝report=null，由斷言出聲 */ }
    fs.rmSync(dir, { recursive: true, force: true });
  }
  return { status, stdout, report };
}

/* ================= E1 CP-25 版式值域 ================= */

test("E1 正向：layout-006（檢入 fixture）＝值域內、預設背景 bg-005 license A → PASS＋trial 試用 INFO", () => {
  const { status, stdout } = runGate("gate_pass_layout006_draft.json");
  assert.strictEqual(status, 0, `期望 exit 0，實得 ${status}\n${stdout}`);
  assert.match(stdout, /機器閘：PASS/);
  assert.doesNotMatch(stdout, /\[FAIL\]/, "不得出現任何 FAIL 明細列");
  assert.match(stdout, /\[INFO\] CP-25 .*layout-006.*rollout=trial/, "trial 版式應出試用徽章 INFO（E6 資料面）");
});

test("E1 負向：未知貨號 layout-999（檢入 fixture）→ exit 1＋FAIL CP-25 帶原值與值域來源＋CP-27 授權未驗", () => {
  const { status, stdout } = runGate("gate_fail_unknown_variant_draft.json");
  assert.strictEqual(status, 1, `期望 exit 1，實得 ${status}\n${stdout}`);
  assert.match(stdout, /\[FAIL\] CP-25 .*「layout-999」不是合法版式貨號/, "訊息應載欄名與收到的原值");
  assert.match(stdout, /modules\.json hero variants/, "訊息應指向值域真源");
  assert.match(stdout, /\[FAIL\] CP-27 .*素材授權無法驗證/, "版式非法＝授權未驗也要出聲，不靜默略過");
});

test("E1 檢入 fixture 不變量：正負兩件皆＝gate_pass_draft 僅 page.kvVariant 單點注入", () => {
  const base = loadFixture("gate_pass_draft.json");
  for (const [f, want] of [["gate_pass_layout006_draft.json", "layout-006"], ["gate_fail_unknown_variant_draft.json", "layout-999"]]) {
    const d = loadFixture(f);
    assert.strictEqual(d.page.kvVariant, want, `${f} 注入值應為 ${want}`);
    const dPage = { ...d.page }; delete dPage.kvVariant;
    assert.deepStrictEqual(dPage, base.page, `${f} 除 kvVariant 外 page 不應有其他差異`);
    assert.deepStrictEqual(d.products, base.products, `${f} products 不應有差異`);
  }
});

test("CP-25 舊拼法 kv-new＝讀入正規化為 new（值域內）→ PASS＋INFO 記正規化", () => {
  const d = loadFixture("gate_pass_draft.json");
  d.page.kvVariant = "kv-new"; // 注入點：舊拼法（51 §2.6 讀入正規化、寫出端不再輸出）
  const { status, stdout } = runGate(d);
  assert.strictEqual(status, 0, stdout);
  assert.match(stdout, /\[INFO\] CP-25 .*「kv-new」＝舊拼法.*「new」/);
});

test("CP-25 欄位缺席＝舊 draft legacy 態略過（沿既有 pass fixture＝零波及）", () => {
  const { status, stdout } = runGate("gate_pass_draft.json");
  assert.strictEqual(status, 0, stdout);
  assert.doesNotMatch(stdout, /CP-25|CP-27/, "無版式欄＝三閘不應出任何 CP-25/27 行");
});

test("CP-25 登記簿讀取失敗而 draft 有版式欄＝FAIL 出聲（不裝懂、不靜默略過）", () => {
  const bad = JSON.parse(regOverrides());
  bad.modules = path.join(REG, "不存在的登記簿.json"); // 注入點：值域真源缺席
  const { status, stdout } = runGate("gate_pass_layout006_draft.json", { registries: JSON.stringify(bad) });
  assert.strictEqual(status, 1, stdout);
  assert.match(stdout, /\[FAIL\] CP-25 .*登記簿讀取失敗/);
  assert.match(stdout, /\[FAIL\] CP-27 .*素材授權無法驗證/);
});

/* ================= F1 GATE_REGISTRY_OVERRIDES 生效必留痕（review F1） ================= */

test("F1 override 生效＝WARN 出聲＋report.registrySource 記注入來源（inline／路徑兩形）", () => {
  // inline JSON 形＝記形式標記
  const r1 = runGate("gate_pass_layout006_draft.json");
  assert.strictEqual(r1.status, 0, r1.stdout);
  assert.match(r1.stdout, /\[WARN\] CP-25 值域來源＝GATE_REGISTRY_OVERRIDES 注入（非正式登記簿），本報告不得作為出貨依據/);
  assert.strictEqual(r1.report?.registrySource, "GATE_REGISTRY_OVERRIDES（inline JSON）");
  // 路徑形＝記注入路徑
  const p = path.join(os.tmpdir(), `gate-hero-regfile-${process.pid}.json`);
  fs.writeFileSync(p, regOverrides());
  try {
    const r2 = runGate("gate_pass_layout006_draft.json", { registries: p });
    assert.strictEqual(r2.status, 0, r2.stdout);
    assert.match(r2.stdout, /\[WARN\] CP-25 值域來源＝GATE_REGISTRY_OVERRIDES 注入/);
    assert.strictEqual(r2.report?.registrySource, p, "路徑形注入應在 report 記錄注入路徑");
  } finally {
    fs.rmSync(p, { force: true });
  }
});

test("F1 不設 env＝report.registrySource 記預設值「registries」、stdout 無注入 WARN", () => {
  const { status, stdout, report } = runGate("gate_pass_draft.json", { noOverrides: true });
  assert.strictEqual(status, 0, stdout);
  assert.strictEqual(report?.registrySource, "registries", "預設值域來源應為正式登記簿");
  assert.doesNotMatch(stdout, /GATE_REGISTRY_OVERRIDES 注入/);
});

/* ================= E2 CP-26 佔位殘留 ================= */

test("E2 負向：hero 槽殘留「滿 $-- 折 $--」→ FAIL CP-26 帶欄位路徑與原值", () => {
  const d = loadFixture("gate_pass_layout006_draft.json");
  d.page.hero = { "discount-digit": "滿 $-- 折 $--" }; // 注入點：折扣槽佔位（51 §2.10 型）
  const { status, stdout } = runGate(d);
  assert.strictEqual(status, 1, stdout);
  assert.match(stdout, /\[FAIL\] CP-26 page\.hero\.discount-digit「滿 \$-- 折 \$--」含示意佔位/);
});

test("E2 負向：00.00–00.00 型佔位（檔期／價帶）也命中 CP-26", () => {
  const d = loadFixture("gate_pass_layout006_draft.json");
  d.page.hero = { "time-band": "檔期 00.00–00.00" }; // 注入點：零值日期帶佔位
  const { status, stdout } = runGate(d);
  assert.strictEqual(status, 1, stdout);
  assert.match(stdout, /\[FAIL\] CP-26 page\.hero\.time-band/);
});

test("E2 正向：佔位收在 heroSlotStash／meta（不渲染不出貨）＝不擋；真實日期 2026.07.03 不誤殺", () => {
  const d = loadFixture("gate_pass_layout006_draft.json");
  d.page.heroSlotStash = { "discount-digit": "滿 $-- 折 $--" }; // 暫存＝合法（換回還原時強制重驗另有專責）
  d.meta.note = "滿 $-- 折 $--（meta 不進渲染）";
  const { status, stdout } = runGate(d);
  assert.strictEqual(status, 0, stdout);
  assert.doesNotMatch(stdout, /CP-26/, "排除子樹與真實日期字串不得觸發 CP-26");
});

test("F3 排除僅契約正位：深層模組下掛名 meta 的子欄含佔位＝FAIL 照抓（不再任意深度跳過）", () => {
  const d = loadFixture("gate_pass_layout006_draft.json");
  d.page.floors[0].meta = { note: "滿 $-- 折 $--" }; // 注入點：深層同名鍵（舊制＝鍵名任意深度排除會矇混出貨）
  const { status, stdout } = runGate(d);
  assert.strictEqual(status, 1, stdout);
  assert.match(stdout, /\[FAIL\] CP-26 page\.floors\[0\]\.meta\.note「滿 \$-- 折 \$--」含示意佔位/, "深層 meta 子欄應照掃、FAIL 帶完整路徑");
});

/* ================= F5 CP-26 正則誤殺面顯式表格（review F5） ================= */

test("F5 CP-26 佔位正則表格：真實價格/檔期/價帶/CSS 變數＝不命中；$--／00.00〜00.00 型佔位＝必中", () => {
  // 直測 gate.js 匯出正則（RULES＝export_rules 同源；require 不觸發 main）——斷言逐字可觀察，不靠整包 fixture 隱性背書
  const { RULES } = require(GATE);
  const spec = RULES.heroLayoutChecks.placeholderResidue;
  const re = new RegExp(spec.pattern, spec.flags);
  const noHit = ["$1,299", "08.30–09.30", "100.00–200.00", "var(--x)"];
  const mustHit = ["滿＄--", "00.00〜00.00", "滿 $-- 折 $--"];
  for (const s of noHit) assert.strictEqual(re.test(s), false, `真實值不得誤殺：「${s}」`);
  for (const s of mustHit) assert.strictEqual(re.test(s), true, `佔位型必須命中：「${s}」`);
});

/* ================= E3／E7 CP-27 素材授權 ================= */

test("E3 制度升版：layout-001 預設背景 bg-001＝license C → INFO 掛牌放行（63 號浮水印制 2026-08-31；原 FAIL 斷言隨裁決退場）", () => {
  const d = loadFixture("gate_pass_draft.json");
  d.page.kvVariant = "layout-001"; // 注入點：C 級預設背景版式
  const { status, stdout } = runGate(d);
  assert.strictEqual(status, 0, stdout); // C 級不再擋死＝放行；掛牌由渲染端自動執行
  assert.match(stdout, /\[INFO\] CP-27 背景「bg-001」（版式預設（layout-001\.defaultBackground））license C＝授權未過正式查核——頁面會掛「背景版權待審核」浮水印/);
  assert.doesNotMatch(stdout, /\[FAIL\] CP-27 背景「bg-001」/);
});

test("E3 負向：B 級背景無複查紀錄（bg-010 明選）→ FAIL CP-27", () => {
  const d = loadFixture("gate_pass_draft.json");
  d.page.kvVariant = "layout-002";
  d.page.backgroundId = "bg-010"; // 注入點：B 級未複查
  const { status, stdout } = runGate(d);
  assert.strictEqual(status, 1, stdout);
  assert.match(stdout, /\[FAIL\] CP-27 B 級背景「bg-010」（page\.backgroundId）無複查紀錄/);
});

test("E3 正向：B 級已複查（layout-002 預設 bg-008＝pass、簿有 termsVerification）→ PASS＋灰度門票綠", () => {
  const d = loadFixture("gate_pass_draft.json");
  d.page.kvVariant = "layout-002";
  const { status, stdout } = runGate(d);
  assert.strictEqual(status, 0, stdout);
  assert.doesNotMatch(stdout, /\[FAIL\]/);
});

test("E3 負向：conditional 任版式預設（layout-015→bg-012）＝FAIL 不得任預設", () => {
  const d = loadFixture("gate_pass_draft.json");
  d.page.kvVariant = "layout-015"; // 注入點：虛構錯簿案＝defaultBackground 綁 conditional
  const { status, stdout } = runGate(d);
  assert.strictEqual(status, 1, stdout);
  assert.match(stdout, /\[FAIL\] CP-27 B 級背景「bg-012」複查判定 conditional＝不得任版式預設背景/);
});

test("E6 灰度門票：trial 版式明選 conditional 背景（layout-002＋bg-012）＝黃燈 WARN＋門票 FAIL", () => {
  const d = loadFixture("gate_pass_draft.json");
  d.page.kvVariant = "layout-002";
  d.page.backgroundId = "bg-012"; // 注入點：trial 版式配 conditional 背景
  const { status, stdout } = runGate(d);
  assert.strictEqual(status, 1, stdout);
  assert.match(stdout, /\[WARN\] CP-27 B 級背景「bg-012」（明選）複查判定 conditional＝黃燈/);
  assert.match(stdout, /\[FAIL\] CP-27 灰度門票：試用版式「layout-002」.*「bg-012」＝B\/conditional 不符/);
});

test("E6 對照：非 trial 版式明選 conditional（layout-014＋bg-012）＝僅黃燈 WARN、無門票 FAIL → exit 0", () => {
  const d = loadFixture("gate_pass_draft.json");
  d.page.kvVariant = "layout-014"; // 虛構＝無 rollout 旗標（開放）
  d.page.backgroundId = "bg-012";
  const { status, stdout } = runGate(d);
  assert.strictEqual(status, 0, stdout);
  assert.match(stdout, /\[WARN\] CP-27 B 級背景「bg-012」（明選）複查判定 conditional＝黃燈/);
  assert.doesNotMatch(stdout, /灰度門票/);
});

test("E6 legacy 停新案開關：rollout=closed（layout-016）＝INFO 出聲、歷史頁照舊出貨 → exit 0", () => {
  const d = loadFixture("gate_pass_draft.json");
  d.page.kvVariant = "layout-016"; // 虛構＝closed 變體（真簿 legacy 現況無旗標＝開放）
  const { status, stdout } = runGate(d);
  assert.strictEqual(status, 0, stdout);
  assert.match(stdout, /\[INFO\] CP-25 .*layout-016.*停接新案（rollout=closed）/);
});

test("E3 負向：B 級商用條款＝backgrounds manifest meta.termsVerification 缺席 → FAIL（A 級不受此欄限制）", () => {
  const dB = loadFixture("gate_pass_draft.json");
  dB.page.kvVariant = "layout-002"; // 預設 bg-008＝B/pass
  const rB = runGate(dB, { noTerms: true });
  assert.strictEqual(rB.status, 1, rB.stdout);
  assert.match(rB.stdout, /\[FAIL\] CP-27 B 級背景「bg-008」出貨需生成平台商用條款查證紀錄.*termsVerification 欄缺席/);
  const dA = loadFixture("gate_pass_layout006_draft.json"); // bg-005＝A 級
  const rA = runGate(dA, { noTerms: true });
  assert.strictEqual(rA.status, 0, rA.stdout);
});

test("E7 動畫：motionFlag=sway 綁 C 級素材（motion-002）＝FAIL；綁 A 級（motion-901）＝過", () => {
  const d = loadFixture("gate_pass_layout006_draft.json");
  d.page.motionFlag = "sway";
  d.page.motionId = "motion-002"; // 注入點：試作預覽素材（僅內部預覽・未過授權）
  const rC = runGate(d);
  assert.strictEqual(rC.status, 1, rC.stdout);
  assert.match(rC.stdout, /\[FAIL\] CP-27 page\.motionFlag=sway 綁定素材「motion-002」license C/);
  d.page.motionId = "motion-901";
  const rA = runGate(d);
  assert.strictEqual(rA.status, 0, rA.stdout);
  assert.doesNotMatch(rA.stdout, /\[FAIL\]/);
});

test("E7 動畫：motionFlag 缺席＝容忍；static＝略過；sway 未綁素材＝WARN 出聲不擋；非法值＝FAIL 帶原值", () => {
  const base = loadFixture("gate_pass_layout006_draft.json");
  const r0 = runGate(base); // 缺席
  assert.strictEqual(r0.status, 0, r0.stdout);
  const dStatic = { ...base, page: { ...base.page, motionFlag: "static" } };
  const rS = runGate(dStatic);
  assert.strictEqual(rS.status, 0, rS.stdout);
  assert.doesNotMatch(rS.stdout, /motionFlag/, "static＝不動不驗、零輸出");
  const dNoRef = { ...base, page: { ...base.page, motionFlag: "sway" } };
  const rW = runGate(dNoRef);
  assert.strictEqual(rW.status, 0, rW.stdout);
  assert.match(rW.stdout, /\[WARN\] CP-27 page\.motionFlag=sway 但未綁動畫素材貨號/);
  const dBad = { ...base, page: { ...base.page, motionFlag: "bounce" } };
  const rB = runGate(dBad);
  assert.strictEqual(rB.status, 1, rB.stdout);
  assert.match(rB.stdout, /\[FAIL\] CP-27 page\.motionFlag 值「bounce」不在 static\|sway\|flip/);
});

/* ── 引擎完工閘（2026-08-25 使用者實測揪出的誤放洞）：真樣式未完工的版式＝FAIL 擋出貨 ── */
test("CP-25 引擎完工閘：未完工版式（fixture 貨號 layout-014＝永不入真名單）＝FAIL 出聲；layout-006（完工名單內）不受影響", () => {
  const d = loadFixture("gate_pass_layout006_draft.json");
  /* 滾動上架制測試設計：樣本必須用「永遠不會完工」的 fixture 專屬貨號（014/015/016 只存在測試登記簿）——
     用真貨號（如 002）＝該款完工上架日測試就紅（2026-08-25 實際發生過一次，特此改制） */
  d.page.kvVariant = "layout-014";
  d.page.backgroundId = "bg-008"; // 明選 B-pass 背景＝CP-27 全過，隔離出「只剩引擎未完工」一刀
  const r = runGate(d, { engineReady: null }); // null＝不注入名單＝走真 ENGINE_SUPPORTED
  assert.strictEqual(r.status, 1, "未完工版式＝出貨擋下");
  assert.match(r.stdout, /樣式製作中（引擎未完工）/);
  assert.ok(r.report.findings.some((f) => f.level === "FAIL" && f.code === "CP-25" && /ENGINE_SUPPORTED/.test(f.msg)), "報告記引擎完工閘 FAIL");
  const ok = runGate("gate_pass_layout006_draft.json", { engineReady: null });
  assert.strictEqual(ok.status, 0, "完工版式（006）照常放行＝完工一款解鎖一款");
});

/* ── 折扣數字人工真值欄（2026-08-25 使用者裁決：預設抓真值、策展無優惠時開放人填、AI 禁代填） ── */
test("優惠文案人工欄（2026-09-03 放寬）：折數或自由文案 ≤6 字＝INFO 揭示人工填寫；超過 6 字＝FAIL 白話擋；留白＝零聲量", () => {
  const base = loadFixture("gate_pass_layout006_draft.json");
  for (const v of ["85折", "買一送一", "滿千折百再送"]) {/* 折數／自由文案／恰 6 字皆放行（原規則只准 1~3 位數字＝使用者裁決「不要強制只能寫折數」） */
    const ok = JSON.parse(JSON.stringify(base)); ok.page.hero = { ...(ok.page.hero || {}), "discount-digit": v };
    const r1 = runGate(ok);
    assert.strictEqual(r1.status, 0, `「${v}」不擋`);
    assert.ok(r1.report.findings.some((f) => f.level === "INFO" && /人工填寫/.test(f.msg)), "出貨揭示人工填寫");
  }
  const bad = JSON.parse(JSON.stringify(base)); bad.page.hero = { ...(bad.page.hero || {}), "discount-digit": "買一送一超划算" };/* 7 字 */
  const r2 = runGate(bad);
  assert.strictEqual(r2.status, 1);
  assert.match(r2.stdout, /太長/);
  const blank = runGate(base);
  assert.ok(!blank.report.findings.some((f) => /優惠文案|折扣數字/.test(f.msg)), "留白＝不出聲");
});

/* ── CP-28 主視覺真值連動（CO-20260825-01：cornerProducts gdid 必填） ── */
test("CP-28：cornerProducts 缺 gdid＝FAIL 白話擋；帶 gdid＝過；欄缺席＝零聲量", () => {
  const base = loadFixture("gate_pass_layout006_draft.json");
  const bad = JSON.parse(JSON.stringify(base));
  bad.page.kv = { ...(bad.page.kv || {}), cornerProducts: [{ slot: 1, img: "x.jpg", name: "手填名", url: "https://tw.buy.yahoo.com/x" }] };
  const r1 = runGate(bad);
  assert.strictEqual(r1.status, 1);
  assert.match(r1.stdout, /缺賣場編號/);
  const ok = JSON.parse(JSON.stringify(base));
  ok.page.kv = { ...(ok.page.kv || {}), cornerProducts: [{ slot: 1, img: "x.jpg", name: "n", url: "https://tw.buy.yahoo.com/x", gdid: "12345678" }] };
  const r2 = runGate(ok);
  assert.ok(!r2.report.findings.some((f) => f.code === "CP-28"), "帶 gdid＝CP-28 不出聲");
  const blank = runGate(base);
  assert.ok(!blank.report.findings.some((f) => f.code === "CP-28"), "欄缺席＝零聲量");
});

/* ── 活動時間人工真值欄（2026-08-25）：v2 無主軸＝INFO 揭示；legacy 原條文不鬆 ── */
test("CP-02 檔期人工欄：layout-* 填 dateValue 無主軸＝INFO 人工揭示不擋；legacy 同況＝照舊 FAIL", () => {
  const base = loadFixture("gate_pass_layout006_draft.json");
  const v2 = JSON.parse(JSON.stringify(base));
  v2.page.kv = { ...(v2.page.kv || {}), dateValue: "08/30–09/30" };
  const r1 = runGate(v2);
  assert.strictEqual(r1.status, 0, "v2 人工檔期不擋");
  assert.ok(r1.report.findings.some((f) => f.level === "INFO" && /人工填寫/.test(f.msg) && /活動時間/.test(f.msg)));
  const legacy = JSON.parse(JSON.stringify(base));
  delete legacy.page.kvVariant;
  legacy.page.kv = { ...(legacy.page.kv || {}), dateValue: "08/30–09/30" };
  const r2 = runGate(legacy, { noOverrides: false });
  assert.ok(r2.report.findings.some((f) => f.level === "FAIL" && /未指定主軸/.test(f.msg)), "legacy 原條文不鬆");
});

/* ================= E8 CP-27 字風／副標字體授權（v17＝2026-09-08 使用者裁決 CP-27 納管字型；CP 登記表 v1.17） ================= */
const withTs = (titleStyle, subtitleFont) => {
  const d = loadFixture("gate_pass_layout006_draft.json"); // 正向底：layout-006＋bg-005 A＝其餘 CP-27 全綠
  if (titleStyle !== undefined) d.page.titleStyle = titleStyle;
  if (subtitleFont !== undefined) d.page.subtitleFont = subtitleFont;
  return d;
};
const cp27Fonts = (report) => (report.findings || []).filter((f) => f.code === "CP-27" && /字風|副標字體/.test(f.msg));

test("E8 正向：approved 字風（css-t1→font-001 A）＋pickable A 副標字體 → PASS、零字型類 CP-27", () => {
  const { status, stdout, report } = runGate(withTs("css-t1", { fontId: "font-001", weight: 300 }));
  assert.strictEqual(status, 0, stdout);
  assert.deepStrictEqual(cp27Fonts(report), []);
});
test("E8 負向：pending 字風（css-t2）→ FAIL CP-27 尚未審查通過（手改 draft 也擋得住）", () => {
  const { status, stdout } = runGate(withTs("css-t2"));
  assert.strictEqual(status, 1, stdout);
  assert.match(stdout, /\[FAIL\] CP-27 字風「T2 樣本字風・待審」尚未審查通過（登記簿 review\.status=pending）/);
});
test("E8 負向：查無字風（css-999）→ FAIL CP-27 不在字風登記簿", () => {
  const { status, stdout } = runGate(withTs("css-999"));
  assert.strictEqual(status, 1, stdout);
  assert.match(stdout, /\[FAIL\] CP-27 字風「css-999」（page\.titleStyle）不在字風登記簿/);
});
test("E8 負向：approved 字風主字型 B 級無複查（css-t3→font-002）→ FAIL；B 級已複查（css-t4→font-004）→ PASS", () => {
  const bad = runGate(withTs("css-t3"));
  assert.strictEqual(bad.status, 1, bad.stdout);
  assert.match(bad.stdout, /\[FAIL\] CP-27 字風「T3 樣本字風・B未複查」主字型「樣本B未複查」 license B 無複查紀錄/);
  const ok = runGate(withTs("css-t4"));
  assert.strictEqual(ok.status, 0, ok.stdout);
  assert.deepStrictEqual(cp27Fonts(ok.report), []);
});
test("E8 負向：approved 字風缺 fontId（css-t5）→ FAIL 沒有主字型戶口", () => {
  const { status, stdout } = runGate(withTs("css-t5"));
  assert.strictEqual(status, 1, stdout);
  assert.match(stdout, /\[FAIL\] CP-27 字風「T5 樣本字風・缺戶口」已審但沒有主字型戶口/);
});
test("E8 負向：副標字體 C 級／A 級不可選／查無／形狀壞 → 各自 FAIL 出聲", () => {
  const c = runGate(withTs(undefined, { fontId: "font-003", weight: 300 }));
  assert.strictEqual(c.status, 1, c.stdout); assert.match(c.stdout, /副標字體「樣本C級」登記為不供挑選/);
  const a2 = runGate(withTs(undefined, { fontId: "font-005" }));
  assert.strictEqual(a2.status, 1, a2.stdout); assert.match(a2.stdout, /副標字體「樣本A不可選」登記為不供挑選/);
  const none = runGate(withTs(undefined, { fontId: "font-999" }));
  assert.strictEqual(none.status, 1, none.stdout); assert.match(none.stdout, /副標字體「font-999」不在字體簿/);
  const shape = runGate(withTs(undefined, "font-001"));
  assert.strictEqual(shape.status, 1, shape.stdout); assert.match(shape.stdout, /page\.subtitleFont 形狀不對/);
});
test("E8 休眠：legacy 頁（無 kvVariant）帶 titleStyle＝§2.13 欄休眠、不驗不誤殺", () => {
  const d = loadFixture("gate_pass_draft.json");
  d.page.titleStyle = "css-t2"; // 待審字風掛在 legacy 頁＝引擎不渲染、閘不管
  const { report } = runGate(d);
  assert.ok(report, "報告缺席");
  assert.deepStrictEqual(cp27Fonts(report), []);
});

/* ================= E9 CP-31 內文模組完整性（70 號 2026-09-09；gate v18） =================
   引擎對「節點在場、必填全空」畫虛線佔位框；CP-26 只認 $-- 型樣板字＝空字串漏網。本閘：模組加了就要填完，否則 FAIL 白話講哪一列。 */
const emptyMechRow = () => ({ label: "", brandName: "", offerText: "", thresholdText: "", rewardText: "", rewardImgs: [], ctaUrl: "" });
const filledMechRow = (i) => ({ label: `好禮${i}`, brandName: "某旗艦店", offerText: "全館優惠", thresholdText: "滿 $1,000", rewardText: "折 $100", rewardImgs: [], ctaUrl: "" });

test("E9 負向：活動資訊卡加了但三列全空＋banner 空 → FAIL CP-31 帶列號白話", () => {
  const d = loadFixture("gate_pass_layout006_draft.json");
  d.page.mechanic = { variant: "info-offer-rows", banner: { img: "", imgs: ["", "", ""], badgeText: "", titleLine1: "", titleLine2: "", url: "" }, rows: [emptyMechRow(), emptyMechRow(), emptyMechRow()] };
  const { status, stdout } = runGate(d);
  assert.strictEqual(status, 1, stdout);
  assert.match(stdout, /\[FAIL\] CP-31 活動資訊卡第 1 列/);
  assert.match(stdout, /\[FAIL\] CP-31 活動資訊卡第 3 列/);
  assert.match(stdout, /\[FAIL\] CP-31 活動資訊卡的 banner/);
});

test("E9 正向：活動資訊卡三列填滿＋banner 有第一行標題 → 零 CP-31", () => {
  const d = loadFixture("gate_pass_layout006_draft.json");
  d.page.mechanic = { variant: "info-offer-rows", banner: { imgs: [], badgeText: "", titleLine1: "全民運動日", titleLine2: "", url: "" }, rows: [filledMechRow(1), filledMechRow(2), filledMechRow(3)] };
  const { stdout } = runGate(d);
  assert.doesNotMatch(stdout, /CP-31/, "填滿不得觸發 CP-31");
});

test("E9 負向：主打選品沒挑主打商品、沒大標題、右欄 0 件 → FAIL CP-31 ×2＋右欄 FAIL", () => {
  const d = loadFixture("gate_pass_layout006_draft.json");
  d.page.spotlight = { badgeText: "", title: "", subtitle: "", heroCard: { capsuleText: "", diagonalText: "", offerLine: "", gdid: "" }, productRefs: [] };
  const { status, stdout } = runGate(d);
  assert.strictEqual(status, 1, stdout);
  assert.match(stdout, /\[FAIL\] CP-31 主打選品還沒挑主打商品/);
  assert.match(stdout, /\[FAIL\] CP-31 主打選品的大標題還沒填/);
  assert.match(stdout, /\[FAIL\] CP-31 主打選品右欄還沒放商品/);
});

test("E9 負向：促銷卡第 2 張沒挑商品 → FAIL CP-31 講第 2 張；舊形單物件 promoCard 也照掃", () => {
  const d = loadFixture("gate_pass_layout006_draft.json");
  d.page.promoCards = [{ capsuleText: "", diagonalText: "", offerLine: "", priceNote: "", gdid: String((d.products[0] || {}).gdid || "1") }, { capsuleText: "", diagonalText: "", offerLine: "", priceNote: "", gdid: "" }];
  let r = runGate(d);
  assert.strictEqual(r.status, 1, r.stdout);
  assert.match(r.stdout, /\[FAIL\] CP-31 促銷卡第 2 張還沒挑商品/);
  assert.doesNotMatch(r.stdout, /促銷卡第 1 張/);
  const d2 = loadFixture("gate_pass_layout006_draft.json");
  d2.page.promoCard = { capsuleText: "", diagonalText: "", offerLine: "", priceNote: "", gdid: "" };
  r = runGate(d2);
  assert.match(r.stdout, /\[FAIL\] CP-31 促銷卡第 1 張還沒挑商品/);
});

test("E9 邊界：三模組都不在頁上（鍵缺席）＝零 CP-31（不誤殺舊稿）", () => {
  const d = loadFixture("gate_pass_layout006_draft.json");
  delete d.page.mechanic; delete d.page.spotlight; delete d.page.promoCards; delete d.page.promoCard;
  const { stdout } = runGate(d);
  assert.doesNotMatch(stdout, /CP-31/);
});

/* ── v2 頁休眠 KV 槽不驗（2026-09-30 包測病例 wb-174316）──
 * 病：layout-* 頁的舊 kv.keyProductGdids／kv.images 休眠不渲染（14 §2.13），CP-02-KV／CP-11 卻照驗；
 *     「去修」指向的主視覺用圖改的是 page.hero＝使用者永遠修不掉。
 * 守兩面：①v2 頁帶壞掉的休眠 kv＝不 FAIL、出聲 INFO ②legacy 頁同款壞 kv＝照樣 FAIL（守衛不放老頁）。 */
test("v2 頁：休眠 kv 商品槽與圓圖不驗（壞圖不紅、出聲 INFO）；legacy 頁照樣紅", () => {
  const bogus = "https://img.yec.tw/zp/MerchandiseImages/DEADBEEF00-SP-0000000.jpg";
  // ① v2（layout-006 正向 fixture）＋植入壞掉的休眠 kv
  const v2 = loadFixture("gate_pass_layout006_draft.json");
  v2.page.kv = { ...(v2.page.kv || {}), keyProductGdids: ["9999001", "9999002", "9999003"], images: [bogus, bogus, bogus] };
  const a = runGate(v2);
  const aRows = (a.report?.results || a.report?.rows || []).filter(r => JSON.stringify(r).includes("CP-11") || JSON.stringify(r).includes("KV 主打"));
  assert.strictEqual(a.status, 0, "v2 頁休眠 kv 帶壞資料不得紅：\n" + a.stdout.slice(-600));
  assert.ok(a.stdout.includes("休眠"), "跳過要出聲（INFO 含「休眠」字樣），不得靜默");
  assert.ok(!a.stdout.includes("不是主打商品的商品圖"), "v2 頁不得再吐 CP-11 商品圖 FAIL");
  // ② legacy（無 kvVariant 的正向 fixture）＋同款壞圖＝照樣 FAIL（證明守衛只放 v2）
  const legacy = loadFixture("gate_pass_draft.json");
  legacy.page.kv.images = [legacy.page.kv.images[0], bogus, legacy.page.kv.images[2]];
  const b = runGate(legacy, { noOverrides: true });
  assert.notStrictEqual(b.status, 0, "legacy 頁壞 KV 圖必須維持紅——守衛不得把老頁一起放掉");
  assert.ok(b.stdout.includes("不是主打商品的商品圖"), "legacy 紅的原因必須還是 CP-11 那條：\n" + b.stdout.slice(-400));
});
