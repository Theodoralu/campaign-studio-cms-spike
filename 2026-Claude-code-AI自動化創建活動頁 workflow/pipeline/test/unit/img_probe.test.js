"use strict";
/**
 * workbench/img_probe.js 單元測試（2026-08-26 編輯精選圓 80×80 病例根治批）
 * 守的邏輯：
 *  ①圖頭解析＝純函式餵 bytes（本地 fixture、不打網路）：JPEG（SOF0/SOF2）／PNG／WebP（VP8/VP8L/VP8X）／
 *    GIF 寬高正確；殘缺 bytes／垃圾資料＝null 不誤判
 *  ②圓 img 候選鏈（規則 2026-08-26 裁定）：imgs[1] 首選須實測寬 ≥300（CIRCLE_IMG_MIN_WIDTH）；
 *    不合格依序試 imgs[2..]；都不合格退主圖 imgs[0]；主圖也不合格＝照實用主圖＋notes 出聲（不吞、不留空）
 *  ③探測失敗（逾時等）＝出聲跳過該候選、不整鏈中斷；同 URL 去重不重複探測
 *  ④probe 可注入＝hermetic（probeImageSize 只測不觸網的拒絕路：非 https／壞網址）
 * fixture 紀律：圖檔 bytes 全手工組（最小合法圖頭），零網路、零檔案系統。
 */
const { test } = require("node:test");
const assert = require("node:assert");

const IP = require("../../workbench/img_probe");

/* ---------- 本地 fixture bytes（最小合法圖頭） ---------- */
// JPEG：SOI＋APP0(JFIF)＋SOF 段（marker 可指定＝測 SOF0 基線與 SOF2 漸進）
function jpegBytes(width, height, sofMarker = 0xc0) {
  const app0 = Buffer.from([0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00]);
  const sof = Buffer.alloc(2 + 2 + 5 + 6); // marker(2)+len(2)+precision(1)+H(2)+W(2)+components…
  sof[0] = 0xff; sof[1] = sofMarker;
  sof.writeUInt16BE(sof.length - 2, 2); // len 含自身不含 marker
  sof[4] = 8; // precision
  sof.writeUInt16BE(height, 5);
  sof.writeUInt16BE(width, 7);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), app0, sof]);
}
// PNG：8 byte 簽名＋IHDR（寬高 BE32 @16/20）
function pngBytes(width, height) {
  const b = Buffer.alloc(24);
  b.writeUInt32BE(0x89504e47, 0); b.writeUInt32BE(0x0d0a1a0a, 4);
  b.writeUInt32BE(13, 8); b.write("IHDR", 12, "ascii");
  b.writeUInt32BE(width, 16); b.writeUInt32BE(height, 20);
  return b;
}
// GIF：GIF89a 簽名＋畫布寬高（LE16 @6/8）
function gifBytes(width, height) {
  const b = Buffer.alloc(10);
  b.write("GIF89a", 0, "ascii");
  b.writeUInt16LE(width, 6); b.writeUInt16LE(height, 8);
  return b;
}
// WebP 三型
function webpVP8XBytes(width, height) {
  const b = Buffer.alloc(30);
  b.write("RIFF", 0, "ascii"); b.writeUInt32LE(22, 4); b.write("WEBP", 8, "ascii");
  b.write("VP8X", 12, "ascii"); b.writeUInt32LE(10, 16);
  b.writeUIntLE(width - 1, 24, 3); b.writeUIntLE(height - 1, 27, 3);
  return b;
}
function webpVP8Bytes(width, height) {
  const b = Buffer.alloc(30);
  b.write("RIFF", 0, "ascii"); b.writeUInt32LE(22, 4); b.write("WEBP", 8, "ascii");
  b.write("VP8 ", 12, "ascii"); b.writeUInt32LE(10, 16);
  b[23] = 0x9d; b[24] = 0x01; b[25] = 0x2a; // sync code
  b.writeUInt16LE(width & 0x3fff, 26); b.writeUInt16LE(height & 0x3fff, 28);
  return b;
}
function webpVP8LBytes(width, height) {
  const b = Buffer.alloc(30);
  b.write("RIFF", 0, "ascii"); b.writeUInt32LE(22, 4); b.write("WEBP", 8, "ascii");
  b.write("VP8L", 12, "ascii"); b.writeUInt32LE(10, 16);
  b[20] = 0x2f;
  b.writeUInt32LE(((height - 1) & 0x3fff) << 14 | ((width - 1) & 0x3fff), 21);
  return b;
}

/* ---------- ①圖頭解析 ---------- */
test("parseImageSize：JPEG SOF0 基線＝寬高正確（80×80 病例形）", () => {
  assert.deepEqual(IP.parseImageSize(jpegBytes(80, 80)), { type: "jpeg", width: 80, height: 80 });
});
test("parseImageSize：JPEG SOF2 漸進式也認得（Yahoo 圖床兩形都有）", () => {
  assert.deepEqual(IP.parseImageSize(jpegBytes(1000, 700, 0xc2)), { type: "jpeg", width: 1000, height: 700 });
});
test("parseImageSize：JPEG 截到 SOF 段之前＝null（bytes 不夠不誤判）", () => {
  const full = jpegBytes(600, 600);
  assert.equal(IP.parseImageSize(full.subarray(0, 8)), null);
});
test("parseImageSize：PNG IHDR 寬高正確", () => {
  assert.deepEqual(IP.parseImageSize(pngBytes(1000, 1000)), { type: "png", width: 1000, height: 1000 });
});
test("parseImageSize：GIF 畫布寬高正確", () => {
  assert.deepEqual(IP.parseImageSize(gifBytes(320, 240)), { type: "gif", width: 320, height: 240 });
});
test("parseImageSize：WebP VP8X／VP8／VP8L 三型寬高正確", () => {
  assert.deepEqual(IP.parseImageSize(webpVP8XBytes(500, 400)), { type: "webp", width: 500, height: 400 });
  assert.deepEqual(IP.parseImageSize(webpVP8Bytes(300, 300)), { type: "webp", width: 300, height: 300 });
  assert.deepEqual(IP.parseImageSize(webpVP8LBytes(135, 135)), { type: "webp", width: 135, height: 135 });
});
test("parseImageSize：垃圾資料／HTML 殼頁 bytes＝null（不把非圖當圖）", () => {
  assert.equal(IP.parseImageSize(Buffer.from("<html><body>404</body></html>")), null);
  assert.equal(IP.parseImageSize(Buffer.alloc(0)), null);
});

/* ---------- ②③圓 img 候選鏈（probe 注入＝不打網路） ---------- */
// 尺寸表 stub：URL → 寬；"TIMEOUT" 值＝模擬探測失敗；同時記呼叫序（驗鏈序與去重）
const stubProbe = (sizeByUrl, calls = []) => async (u) => {
  calls.push(u);
  const w = sizeByUrl[u];
  if (w === "TIMEOUT") throw new Error("逾時 2500ms");
  if (w == null) throw new Error("HTTP 404");
  return { type: "jpeg", width: w, height: w };
};

test("候選鏈①：imgs[1] 合格（寬 ≥300）＝照舊選第二張白底圖、verified、零 notes", async () => {
  const calls = [];
  const r = await IP.pickCircleImg(["https://i/main.jpg", "https://i/white.jpg"], { probe: stubProbe({ "https://i/white.jpg": 1000 }, calls) });
  assert.equal(r.img, "https://i/white.jpg");
  assert.equal(r.verified, true);
  assert.equal(r.width, 1000);
  assert.deepEqual(r.notes, []);
  assert.deepEqual(calls, ["https://i/white.jpg"]); // 合格即停＝主圖不必探
});
test("候選鏈②（80×80 病例）：imgs[1] 太小＝跳過出聲、imgs[2] 合格＝改選", async () => {
  const r = await IP.pickCircleImg(
    ["https://i/main.jpg", "https://i/tiny-80.jpg", "https://i/big-400.jpg"],
    { probe: stubProbe({ "https://i/tiny-80.jpg": 80, "https://i/big-400.jpg": 400 }) });
  assert.equal(r.img, "https://i/big-400.jpg");
  assert.equal(r.verified, true);
  assert.equal(r.notes.length, 1);
  assert.match(r.notes[0], /80px＜300/);
});
test("候選鏈③：imgs[1..] 全太小＝退主圖；主圖合格＝verified", async () => {
  const r = await IP.pickCircleImg(
    ["https://i/main-1000.jpg", "https://i/a-80.jpg", "https://i/b-135.jpg"],
    { probe: stubProbe({ "https://i/main-1000.jpg": 1000, "https://i/a-80.jpg": 80, "https://i/b-135.jpg": 135 }) });
  assert.equal(r.img, "https://i/main-1000.jpg");
  assert.equal(r.verified, true);
  assert.equal(r.notes.length, 2); // 兩張太小各出聲一次
});
test("候選鏈④：全部不合格（含主圖）＝照實用主圖＋notes 出聲（不吞、不留空）", async () => {
  const r = await IP.pickCircleImg(
    ["https://i/main-80.jpg", "https://i/a-80.jpg"],
    { probe: stubProbe({ "https://i/main-80.jpg": 80, "https://i/a-80.jpg": 80 }) });
  assert.equal(r.img, "https://i/main-80.jpg"); // 不留空
  assert.equal(r.verified, false);
  assert.match(r.notes[r.notes.length - 1], /照實用主圖/);
});
test("候選鏈⑤：探測全逾時＝逐候選出聲跳過、照實用主圖（離線不擋建立流程）", async () => {
  const r = await IP.pickCircleImg(
    ["https://i/main.jpg", "https://i/a.jpg"],
    { probe: stubProbe({ "https://i/main.jpg": "TIMEOUT", "https://i/a.jpg": "TIMEOUT" }) });
  assert.equal(r.img, "https://i/main.jpg");
  assert.equal(r.verified, false);
  assert.ok(r.notes.some((n) => /探測失敗/.test(n) && /逾時/.test(n)));
  assert.match(r.notes[r.notes.length - 1], /照實用主圖/);
});
test("候選鏈⑥：單圖商品（只有主圖）＝直接驗主圖；太小照實用＋出聲", async () => {
  const ok = await IP.pickCircleImg(["https://i/only-500.jpg"], { probe: stubProbe({ "https://i/only-500.jpg": 500 }) });
  assert.equal(ok.img, "https://i/only-500.jpg");
  assert.equal(ok.verified, true);
  const small = await IP.pickCircleImg(["https://i/only-80.jpg"], { probe: stubProbe({ "https://i/only-80.jpg": 80 }) });
  assert.equal(small.img, "https://i/only-80.jpg");
  assert.equal(small.verified, false);
});
test("候選鏈⑦：同 URL 去重＝不重複探測（imgs[1] 與主圖同圖只探一次）", async () => {
  const calls = [];
  const r = await IP.pickCircleImg(
    ["https://i/same.jpg", "https://i/same.jpg"],
    { probe: stubProbe({ "https://i/same.jpg": 80 }, calls) });
  assert.equal(calls.length, 1);
  assert.equal(r.img, "https://i/same.jpg");
  assert.equal(r.verified, false);
});
test("候選鏈⑧：imgs 空＝img 空字串＋出聲（上游守門本就要求 imgs[0] 存在）", async () => {
  const r = await IP.pickCircleImg([], { probe: stubProbe({}) });
  assert.equal(r.img, "");
  assert.equal(r.verified, false);
  assert.equal(r.notes.length, 1);
});
test("候選鏈⑨：minWidth 可調（預設常數＝300 圓顯示級）", async () => {
  assert.equal(IP.CIRCLE_IMG_MIN_WIDTH, 300);
  const r = await IP.pickCircleImg(["https://i/m.jpg", "https://i/w-250.jpg"], { probe: stubProbe({ "https://i/w-250.jpg": 250 }), minWidth: 200 });
  assert.equal(r.img, "https://i/w-250.jpg");
  assert.equal(r.verified, true);
});

/* ---------- ④probeImageSize 不觸網的拒絕路 ---------- */
test("probeImageSize：非 https 圖址＝reject 出聲（沿 urlStatus 慣例）", async () => {
  await assert.rejects(IP.probeImageSize("http://img.yec.tw/x.jpg"), /https/);
});
test("probeImageSize：壞網址＝reject 出聲", async () => {
  await assert.rejects(IP.probeImageSize("不是網址"), /格式不對/);
});
