"use strict";
/*
 * google_sheets.js 純邏輯單測（node:test，零新相依）。
 *
 * 覆蓋範圍＝不需網路/憑證即可驗的推導與狀態邏輯：
 *   - verifyState()：OAuth state 一次性驗證（對符才清、對不符不清＝防偽造 callback DoS、逾時失效）
 *   - status()：由 scope 字串推導 scopesOk/missingScopes、由 token 推導 connected/configured/email
 *   - getAuthUrl()：無憑證丟 NO_CONFIG；有憑證組出正確 OAuth URL 並持久化 state
 *   - loadConfig/saveConfig/loadToken/clearToken：config/token 存取基本行為
 *
 * 安全手法：以「虛擬記憶體檔案系統」只攔截 CONFIG_PATH／TOKEN_PATH 兩個路徑，
 *   其餘路徑一律 pass-through 到真實 fs。因此：
 *     (1) 真實 .google-config.json／.google-token.json 全程「不讀不寫」（不碰真憑證/真 token）。
 *     (2) 被測函式皆不觸發 https，故完全不需 mock 網路層。
 *   這是刻意挑出「與網路/憑證解耦」的最小可安全單測集合；createSheet/api/exchangeCode 等
 *   與 https 深度耦合者不在此檔（不為湊覆蓋率而 mock 整個網路層）。
 */
const { test, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");

const gs = require("../../google_sheets.js");
const CONFIG_PATH = gs.CONFIG_PATH;
const TOKEN_PATH = gs.TOKEN_PATH;
const VIRTUAL = new Set([CONFIG_PATH, TOKEN_PATH]);

// ---- 虛擬 FS：只攔兩個憑證路徑，其餘 pass-through ----
const store = new Map(); // path -> JSON 字串
const real = {
  readFileSync: fs.readFileSync,
  writeFileSync: fs.writeFileSync,
  chmodSync: fs.chmodSync,
  unlinkSync: fs.unlinkSync,
};
function enoent(p) {
  const e = new Error("ENOENT: no such file (virtual): " + p);
  e.code = "ENOENT";
  return e;
}
function installVirtualFs() {
  fs.readFileSync = function (p, ...rest) {
    if (VIRTUAL.has(p)) {
      if (!store.has(p)) throw enoent(p);
      return store.get(p);
    }
    return real.readFileSync.call(fs, p, ...rest);
  };
  fs.writeFileSync = function (p, data, ...rest) {
    if (VIRTUAL.has(p)) { store.set(p, String(data)); return; }
    return real.writeFileSync.call(fs, p, data, ...rest);
  };
  fs.chmodSync = function (p, ...rest) {
    if (VIRTUAL.has(p)) return; // no-op
    return real.chmodSync.call(fs, p, ...rest);
  };
  fs.unlinkSync = function (p, ...rest) {
    if (VIRTUAL.has(p)) { if (!store.has(p)) throw enoent(p); store.delete(p); return; }
    return real.unlinkSync.call(fs, p, ...rest);
  };
}
function restoreFs() {
  fs.readFileSync = real.readFileSync;
  fs.writeFileSync = real.writeFileSync;
  fs.chmodSync = real.chmodSync;
  fs.unlinkSync = real.unlinkSync;
}
function seedConfig(obj) { store.set(CONFIG_PATH, JSON.stringify(obj)); }
function seedToken(obj) { store.set(TOKEN_PATH, JSON.stringify(obj)); }
function readConfigRaw() { return store.has(CONFIG_PATH) ? JSON.parse(store.get(CONFIG_PATH)) : null; }

beforeEach(() => { store.clear(); installVirtualFs(); });
afterEach(() => { restoreFs(); store.clear(); });

// ============ 前置健全性：虛擬 FS 沒碰到真實憑證檔 ============
test("虛擬 FS：未 seed 時 loadConfig={} 且 loadToken=null（證明沒讀到真實檔）", () => {
  assert.deepStrictEqual(gs.loadConfig(), {});
  assert.strictEqual(gs.loadToken(), null);
});

// ============ config / token 存取 ============
test("saveConfig 合併既有欄位並回寫；loadConfig 讀回", () => {
  seedConfig({ clientId: "cid", folderName: "舊資料夾" });
  const merged = gs.saveConfig({ folderName: "新資料夾", folderId: "F1" });
  assert.strictEqual(merged.clientId, "cid");      // 舊欄位保留
  assert.strictEqual(merged.folderName, "新資料夾"); // 覆蓋
  assert.strictEqual(merged.folderId, "F1");        // 新增
  assert.deepStrictEqual(gs.loadConfig(), { clientId: "cid", folderName: "新資料夾", folderId: "F1" });
});

test("loadToken 讀回 seed 的 token；clearToken 後回 null", () => {
  seedToken({ refresh_token: "rt", scope: "x" });
  assert.deepStrictEqual(gs.loadToken(), { refresh_token: "rt", scope: "x" });
  gs.clearToken();
  assert.strictEqual(gs.loadToken(), null);
});

test("損毀 JSON 檔：loadConfig 回 {}、loadToken 回 null（不丟錯）", () => {
  store.set(CONFIG_PATH, "{ not json ");
  store.set(TOKEN_PATH, "<<broken>>");
  assert.deepStrictEqual(gs.loadConfig(), {});
  assert.strictEqual(gs.loadToken(), null);
});

// ============ verifyState：一次性 + 逾時 + 對不符不清 ============
test("verifyState：正確且未逾時 → true，且成功後清除 state（一次性）", () => {
  seedConfig({ _oauthState: "abc123", _oauthStateAt: Date.now() });
  assert.strictEqual(gs.verifyState("abc123"), true);
  assert.strictEqual(readConfigRaw()._oauthState, null); // 已清
  // 一次性：同一 state 再驗 → false
  assert.strictEqual(gs.verifyState("abc123"), false);
});

test("verifyState：不符 → false，且『不』清除進行中的 state（防偽造 callback DoS）", () => {
  seedConfig({ _oauthState: "goodstate", _oauthStateAt: Date.now() });
  assert.strictEqual(gs.verifyState("attacker"), false);
  assert.strictEqual(readConfigRaw()._oauthState, "goodstate"); // 仍在，真使用者可完成登入
});

test("verifyState：空/未帶 state → false", () => {
  seedConfig({ _oauthState: "goodstate", _oauthStateAt: Date.now() });
  assert.strictEqual(gs.verifyState(""), false);
  assert.strictEqual(gs.verifyState(undefined), false);
  assert.strictEqual(gs.verifyState(null), false);
});

test("verifyState：逾時（>10 分）→ false", () => {
  seedConfig({ _oauthState: "abc", _oauthStateAt: Date.now() - (10 * 60 * 1000 + 1000) });
  assert.strictEqual(gs.verifyState("abc"), false);
});

test("verifyState：無 config（無 _oauthState）→ false", () => {
  assert.strictEqual(gs.verifyState("anything"), false);
});

// ============ status()：scope 推導 + token 推導 ============
test("status：無 config 無 token → 未設定、未連結、scope 全缺", () => {
  const s = gs.status();
  assert.strictEqual(s.configured, false);
  assert.strictEqual(s.connected, false);
  assert.strictEqual(s.email, null);
  assert.strictEqual(s.folderId, null);
  assert.strictEqual(s.scopesOk, false);
  assert.deepStrictEqual(s.missingScopes, [
    "Google 試算表（讀寫 Sheets）",
    "Google 雲端硬碟（建立/存放檔案）",
  ]);
  assert.strictEqual(s.hasApiKey, false);
});

test("status：有憑證 + 具完整 scope 的 token → 已設定、已連結、scopesOk、無缺 scope", () => {
  seedConfig({ clientId: "cid", clientSecret: "sec", folderId: "F1", folderName: "資料夾", apiKey: "AK", projectNumber: "123" });
  seedToken({
    refresh_token: "rt",
    scope: "https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/userinfo.email",
    email: "u@example.com",
  });
  const s = gs.status();
  assert.strictEqual(s.configured, true);
  assert.strictEqual(s.connected, true);
  assert.strictEqual(s.email, "u@example.com");
  assert.strictEqual(s.folderId, "F1");
  assert.strictEqual(s.folderName, "資料夾");
  assert.strictEqual(s.scopesOk, true);
  assert.deepStrictEqual(s.missingScopes, []);
  assert.strictEqual(s.hasApiKey, true);
  assert.strictEqual(s.apiKey, "AK");
  assert.strictEqual(s.appId, "123");
});

test("status：只授 userinfo.email → scopesOk=false 且兩項 scope 皆缺", () => {
  seedConfig({ clientId: "cid", clientSecret: "sec" });
  seedToken({ refresh_token: "rt", scope: "https://www.googleapis.com/auth/userinfo.email", email: "e@x.com" });
  const s = gs.status();
  assert.strictEqual(s.configured, true);
  assert.strictEqual(s.connected, true);
  assert.strictEqual(s.scopesOk, false);
  assert.deepStrictEqual(s.missingScopes, [
    "Google 試算表（讀寫 Sheets）",
    "Google 雲端硬碟（建立/存放檔案）",
  ]);
});

test("status：只授 spreadsheets（缺 drive.file）→ scopesOk=false 且只缺雲端硬碟", () => {
  seedConfig({ clientId: "cid", clientSecret: "sec" });
  seedToken({ refresh_token: "rt", scope: "https://www.googleapis.com/auth/spreadsheets" });
  const s = gs.status();
  assert.strictEqual(s.scopesOk, false);
  assert.deepStrictEqual(s.missingScopes, ["Google 雲端硬碟（建立/存放檔案）"]);
});

test("status：有 token 但無 refresh_token → connected=false（未完成離線授權）", () => {
  seedConfig({ clientId: "cid", clientSecret: "sec" });
  seedToken({ access_token: "at", scope: "https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/drive.file" });
  const s = gs.status();
  assert.strictEqual(s.connected, false);
  assert.strictEqual(s.scopesOk, true); // scope 仍由 scope 字串推導，與 connected 無關
});

test("status：僅填 clientId（缺 clientSecret）→ configured=false", () => {
  seedConfig({ clientId: "cid" });
  assert.strictEqual(gs.status().configured, false);
});

// ============ getAuthUrl()：NO_CONFIG + URL 組裝 + state 持久化 ============
test("getAuthUrl：未設定憑證 → 丟 NO_CONFIG", () => {
  assert.throws(() => gs.getAuthUrl("http://localhost:8787/oauth/callback"), (e) => {
    assert.strictEqual(e.code, "NO_CONFIG");
    return true;
  });
});

test("getAuthUrl：有憑證 → 產生正確 OAuth URL、含全部 scope，並把 state 持久化到 config", () => {
  seedConfig({ clientId: "my-client-id", clientSecret: "sec" });
  const redirect = "http://localhost:8787/oauth/callback";
  const url = gs.getAuthUrl(redirect);
  const u = new URL(url);
  assert.strictEqual(u.origin + u.pathname, "https://accounts.google.com/o/oauth2/v2/auth");
  const q = u.searchParams;
  assert.strictEqual(q.get("client_id"), "my-client-id");
  assert.strictEqual(q.get("redirect_uri"), redirect);
  assert.strictEqual(q.get("response_type"), "code");
  assert.strictEqual(q.get("access_type"), "offline");
  assert.strictEqual(q.get("prompt"), "consent");
  assert.strictEqual(q.get("include_granted_scopes"), "true");
  assert.strictEqual(q.get("scope"), gs.SCOPES.join(" "));
  // 三個 scope 皆在
  for (const sc of gs.SCOPES) assert.ok(q.get("scope").includes(sc), "scope 應含 " + sc);
  // state 非空且已持久化到 config，_oauthStateAt 為近似現在時間
  const state = q.get("state");
  assert.ok(state && state.length >= 16, "state 應為隨機非空字串");
  const cfg = readConfigRaw();
  assert.strictEqual(cfg._oauthState, state);
  assert.ok(Math.abs(Date.now() - cfg._oauthStateAt) < 5000, "_oauthStateAt 應接近現在");
});

test("getAuthUrl → verifyState 端到端：URL 內的 state 可通過驗證且一次性", () => {
  seedConfig({ clientId: "cid", clientSecret: "sec" });
  const url = gs.getAuthUrl("http://localhost:8787/oauth/callback");
  const state = new URL(url).searchParams.get("state");
  assert.strictEqual(gs.verifyState(state), true);  // 首次通過
  assert.strictEqual(gs.verifyState(state), false); // 一次性：再驗失敗
});

test("getAuthUrl：每次呼叫產生不同 state（隨機性）", () => {
  seedConfig({ clientId: "cid", clientSecret: "sec" });
  const s1 = new URL(gs.getAuthUrl("http://localhost/cb")).searchParams.get("state");
  const s2 = new URL(gs.getAuthUrl("http://localhost/cb")).searchParams.get("state");
  assert.notStrictEqual(s1, s2);
});
