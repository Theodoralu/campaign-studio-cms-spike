/* Google Sheets／Drive 整合模組（2026-07-27）：用 Node 原生 https 打 OAuth2＋Sheets v4＋Drive v3，零新相依。
 * 用途：CMS 用「用戶自己的 Google 帳號」在其 Drive 專屬資料夾建立廠商溝通用 Sheet、雲端分享、讀回變更。
 *   - per-user OAuth（授權碼流程，離線 refresh_token）；憑證(client_id/secret)＋token 存 gitignored 檔。
 *   - scope：spreadsheets（讀寫表）＋drive.file（只碰 app 自建檔，最小權限）＋userinfo.email（顯示連的是誰）。
 *   - 資料夾模型：drive.file 無法列既有資料夾 → app 自建並擁有一個專屬資料夾（folderId 存 config），可改名/換。
 * 設計：所有函式在「未設定憑證／未連結」時丟帶 code 的錯（NO_CONFIG / NOT_CONNECTED / AUTH_EXPIRED），供 server 白盒化提示。 */
"use strict";
const https = require("https");
const fs = require("fs");
const path = require("path");
const { URL, URLSearchParams } = require("url");

const CONFIG_PATH = path.join(__dirname, ".google-config.json"); // { clientId, clientSecret, folderId, folderName }
const TOKEN_PATH = path.join(__dirname, ".google-token.json");   // { access_token, refresh_token, expiry(ms), scope, email }
const SCOPES = [
  "https://www.googleapis.com/auth/spreadsheets",
  "https://www.googleapis.com/auth/drive.file",
  "https://www.googleapis.com/auth/userinfo.email",
];

function _readJson(p) { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch (e) { return null; } }
function _writeJson(p, o) { fs.writeFileSync(p, JSON.stringify(o, null, 1), { mode: 0o600 }); try { fs.chmodSync(p, 0o600); } catch (e) {} } // 0600 建檔＝關掉世界可讀窗口（QA #6）

function loadConfig() { return _readJson(CONFIG_PATH) || {}; }
function saveConfig(patch) { const c = { ...loadConfig(), ...patch }; _writeJson(CONFIG_PATH, c); return c; }
function loadToken() { return _readJson(TOKEN_PATH); }
function saveToken(tok) { _writeJson(TOKEN_PATH, tok); return tok; }
function clearToken() { try { fs.unlinkSync(TOKEN_PATH); } catch (e) {} }

function _err(code, message) { const e = new Error(message); e.code = code; return e; }
function requireConfig() {
  const c = loadConfig();
  if (!c.clientId || !c.clientSecret) throw _err("NO_CONFIG", "尚未設定 Google 應用憑證（client_id／client_secret）——請先在 Google Cloud 建立 OAuth 用戶端並填入設定");
  return c;
}

/* ---------- 低階 HTTPS（回傳 {status, json, raw}） ---------- */
function _request(method, urlStr, { headers = {}, body = null } = {}) {
  return new Promise((resolve, reject) => {
    let u; try { u = new URL(urlStr); } catch (e) { return reject(e); }
    const data = body == null ? null : (typeof body === "string" ? body : JSON.stringify(body));
    const opts = { method, hostname: u.hostname, path: u.pathname + u.search, headers: { ...headers } };
    if (data != null) opts.headers["Content-Length"] = Buffer.byteLength(data);
    const req = https.request(opts, (res) => {
      let raw = ""; res.setEncoding("utf8");
      res.on("data", (d) => (raw += d));
      res.on("end", () => { let json = null; try { json = raw ? JSON.parse(raw) : null; } catch (e) {} resolve({ status: res.statusCode, json, raw }); });
    });
    req.on("error", reject);
    req.setTimeout(30000, () => { req.destroy(_err("TIMEOUT", "Google API 連線逾時")); });
    if (data != null) req.write(data);
    req.end();
  });
}
function _form(method, urlStr, params) {
  return _request(method, urlStr, { headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(params).toString() });
}

/* ---------- OAuth2 授權碼流程 ---------- */
function getAuthUrl(redirectUri) {
  const c = requireConfig();
  const state = require("crypto").randomBytes(16).toString("hex"); // QA #5：隨機 state 防 CSRF
  saveConfig({ _oauthState: state, _oauthStateAt: Date.now() });   // 存 gitignored config、供 callback 驗證
  const q = new URLSearchParams({
    client_id: c.clientId, redirect_uri: redirectUri, response_type: "code",
    scope: SCOPES.join(" "), access_type: "offline", prompt: "consent", include_granted_scopes: "true",
    state,
  });
  return "https://accounts.google.com/o/oauth2/v2/auth?" + q.toString();
}
function verifyState(state) { // 一次性驗證＋10 分有效
  const c = loadConfig();
  const ok = !!state && state === c._oauthState && (Date.now() - (c._oauthStateAt || 0) < 10 * 60 * 1000);
  if (ok) saveConfig({ _oauthState: null, _oauthStateAt: null }); // QA 修：只在成功時清（mismatch 也清會讓偽造 callback DoS 進行中的登入）
  return ok;
}
async function exchangeCode(code, redirectUri) {
  const c = requireConfig();
  const r = await _form("POST", "https://oauth2.googleapis.com/token", {
    code, client_id: c.clientId, client_secret: c.clientSecret, redirect_uri: redirectUri, grant_type: "authorization_code",
  });
  if (r.status !== 200 || !r.json || !r.json.access_token) throw _err("AUTH_FAILED", "換取 token 失敗：" + ((r.json && (r.json.error_description || r.json.error)) || r.raw || r.status));
  const tok = {
    access_token: r.json.access_token,
    refresh_token: r.json.refresh_token || (loadToken() || {}).refresh_token || null, // 二次授權可能不回 refresh_token＝沿用舊的
    expiry: Date.now() + (r.json.expires_in || 3600) * 1000,
    scope: r.json.scope || SCOPES.join(" "),
  };
  try { tok.email = await getEmail(tok.access_token); } catch (e) {}
  return saveToken(tok);
}
async function _refresh(tok) {
  const c = requireConfig();
  if (!tok || !tok.refresh_token) throw _err("NOT_CONNECTED", "尚未連結 Google 帳號——請先點「用 Google 登入」");
  const r = await _form("POST", "https://oauth2.googleapis.com/token", {
    refresh_token: tok.refresh_token, client_id: c.clientId, client_secret: c.clientSecret, grant_type: "refresh_token",
  });
  if (r.status !== 200 || !r.json || !r.json.access_token) {
    // refresh_token 失效（測試模式 7 天過期／撤銷）＝要求重新登入
    throw _err("AUTH_EXPIRED", "Google 授權已過期（測試模式每 7 天需重連）——請重新點「用 Google 登入」");
  }
  const next = { ...tok, access_token: r.json.access_token, expiry: Date.now() + (r.json.expires_in || 3600) * 1000 };
  return saveToken(next);
}
async function getAccessToken() {
  requireConfig();
  let tok = loadToken();
  if (!tok || !tok.refresh_token) throw _err("NOT_CONNECTED", "尚未連結 Google 帳號——請先點「用 Google 登入」");
  if (!tok.access_token || Date.now() > (tok.expiry || 0) - 60000) tok = await _refresh(tok); // 提早 60 秒續期
  return tok.access_token;
}
async function getEmail(accessToken) {
  const r = await _request("GET", "https://www.googleapis.com/oauth2/v2/userinfo", { headers: { Authorization: "Bearer " + accessToken } });
  return (r.json && r.json.email) || null;
}

/* ---------- 已認證的 Google API 呼叫（自動帶 token，401 續期重試一次） ---------- */
async function api(method, url, body) {
  let token = await getAccessToken();
  const call = (t) => _request(method, url, { headers: { Authorization: "Bearer " + t, ...(body != null ? { "Content-Type": "application/json" } : {}) }, body });
  let r = await call(token);
  if (r.status === 401) { const tok = await _refresh(loadToken()); r = await call(tok.access_token); }
  if (r.status >= 400) { const e = _err("API_ERROR", `Google API ${method} 失敗（${r.status}）：${(r.json && r.json.error && r.json.error.message) || r.raw || ""}`.slice(0, 300)); e.status = r.status; throw e; }
  return r.json;
}
/* 試算表是否還存在（未刪、未丟垃圾桶）＝防「更新到已刪的舊表」鬼打牆（2026-07-27）：
   trashed→false（要改建新的）；404 永久刪除→false；其他錯誤往上拋（勿誤判成刪除而建重複）。 */
async function sheetAlive(id) {
  if (!id) return false;
  try { const f = await api("GET", `https://www.googleapis.com/drive/v3/files/${id}?fields=id,trashed`); return !!(f && f.id && !f.trashed); }
  catch (e) { if (e.status === 404) return false; throw e; }
}

/* ---------- Drive 資料夾（app 自建並擁有；drive.file 適用） ---------- */
async function ensureFolder(name) {
  const c = loadConfig();
  if (c.folderId) { // 驗證仍存在（未被使用者刪）
    try { const f = await api("GET", `https://www.googleapis.com/drive/v3/files/${c.folderId}?fields=id,name,trashed`); if (f && f.id && !f.trashed) return { id: f.id, name: f.name }; } catch (e) {}
  }
  const folder = await api("POST", "https://www.googleapis.com/drive/v3/files?fields=id,name", {
    name: name || "YEC 活動頁-廠商溝通", mimeType: "application/vnd.google-apps.folder",
  });
  saveConfig({ folderId: folder.id, folderName: folder.name });
  return { id: folder.id, name: folder.name };
}
async function renameFolder(newName) {
  const c = requireConfig(); if (!c.folderId) return ensureFolder(newName);
  const f = await api("PATCH", `https://www.googleapis.com/drive/v3/files/${c.folderId}?fields=id,name`, { name: newName });
  saveConfig({ folderName: f.name }); return { id: f.id, name: f.name };
}
async function newFolder(name) { saveConfig({ folderId: null }); return ensureFolder(name); } // 換一個新資料夾（改路徑）

/* ---------- 建立/更新廠商 Sheet ---------- */
/* rows＝二維陣列（含表頭）；meta＝{ title, headerNote, previewUrl }。回傳 { spreadsheetId, url } */
async function createSheet(title, rows, meta = {}) {
  const created = await api("POST", "https://sheets.googleapis.com/v4/spreadsheets", {
    properties: { title }, sheets: [{ properties: { title: "商品變更單", gridProperties: { frozenRowCount: meta.headerRows || 1 } } }],
  });
  const id = created.spreadsheetId;
  const folder = await ensureFolder(loadConfig().folderName);
  // 移進專屬資料夾（建立時預設在 root）
  try { await api("PATCH", `https://www.googleapis.com/drive/v3/files/${id}?addParents=${folder.id}&removeParents=root&fields=id,parents`); } catch (e) {}
  await api("PUT", `https://sheets.googleapis.com/v4/spreadsheets/${id}/values/${encodeURIComponent("商品變更單!A1")}?valueInputOption=RAW`, { values: rows });
  return { spreadsheetId: id, url: created.spreadsheetUrl || `https://docs.google.com/spreadsheets/d/${id}/edit`, folderId: folder.id, folderName: folder.name };
}
async function updateSheetValues(spreadsheetId, rows) {
  // 先清舊列再寫（QA #2：商品變少時避免殘留幽靈列、廠商在殘列的修改被靜默丟棄）
  try { await api("POST", `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent("商品變更單!A1:Z2000")}:clear`, {}); } catch (e) {}
  await api("PUT", `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent("商品變更單!A1")}?valueInputOption=RAW`, { values: rows });
  return { spreadsheetId };
}
/* 確保表落在目前設定的資料夾（使用者用 Picker 換資料夾後，更新既有表也一併搬過去；2026-07-27） */
async function ensureInFolder(fileId) {
  const c = loadConfig(); if (!c.folderId || !fileId) return;
  try {
    const f = await api("GET", `https://www.googleapis.com/drive/v3/files/${fileId}?fields=parents`);
    const parents = (f && f.parents) || [];
    if (parents.includes(c.folderId)) return;
    await api("PATCH", `https://www.googleapis.com/drive/v3/files/${fileId}?addParents=${c.folderId}${parents.length ? "&removeParents=" + parents.join(",") : ""}&fields=id,parents`);
  } catch (e) { /* 搬移失敗不阻斷更新 */ }
}
async function readSheet(spreadsheetId) {
  const r = await api("GET", `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent("商品變更單!A1:Z1000")}`);
  return (r && r.values) || [];
}

/* ---------- 多頁籤與權限（活動總覽表用，2026-07-28 overview-sheet story；皆在既有 spreadsheets＋drive.file scope 內） ---------- */
async function createSpreadsheetTabs(title, tabTitles) {
  const created = await api("POST", "https://sheets.googleapis.com/v4/spreadsheets", {
    properties: { title }, sheets: tabTitles.map((t, i) => ({ properties: { title: t, index: i, gridProperties: { frozenRowCount: t === "總覽" ? 2 : 1 } } })),
  });
  return { spreadsheetId: created.spreadsheetId, url: created.spreadsheetUrl || `https://docs.google.com/spreadsheets/d/${created.spreadsheetId}/edit` };
}
async function getSheetTabs(spreadsheetId) {
  const r = await api("GET", `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=sheets.properties(title,sheetId)`);
  return ((r && r.sheets) || []).map((s) => s.properties);
}
async function ensureTabs(spreadsheetId, titles) {
  const have = (await getSheetTabs(spreadsheetId)).map((t) => t.title);
  const missing = titles.filter((t) => !have.includes(t));
  if (!missing.length) return;
  await api("POST", `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`, {
    requests: missing.map((t) => ({ addSheet: { properties: { title: t } } })),
  });
}
async function writeTab(spreadsheetId, tab, rows) {
  // ⚠ RAW 是 overview-mail.gs 死人開關的前提、禁改 USER_ENTERED：日期字串會被 Sheets 解析成 Date 物件，
  //   .gs 端 patrolDate!==today 永真＝天天誤報「巡檢未更新」且正式信永不寄；活動ID 數字化丟前導零＝closed- 鍵漂移。
  // 先清舊列再寫（同 updateSheetValues 慣例：防資料變少時殘留幽靈列）
  try { await api("POST", `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(tab + "!A1:Z5000")}:clear`, {}); } catch (e) { /* 清舊列失敗＝直接覆寫（同 updateSheetValues 慣例） */ }
  await api("PUT", `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(tab + "!A1")}?valueInputOption=RAW`, { values: rows });
}
async function listPermissions(fileId) {
  const r = await api("GET", `https://www.googleapis.com/drive/v3/files/${fileId}/permissions?fields=permissions(emailAddress,role,type)`);
  return ((r && r.permissions) || []);
}
/* 分享唯讀（冪等：已在權限清單＝跳過；sendNotificationEmail=true＝Google 原生通知信作首次入口告知） */
async function shareReader(fileId, email) {
  const have = await listPermissions(fileId);
  if (have.some((p) => (p.emailAddress || "").toLowerCase() === String(email).toLowerCase())) return { shared: false, reason: "already" };
  await api("POST", `https://www.googleapis.com/drive/v3/files/${fileId}/permissions?sendNotificationEmail=true`, { type: "user", role: "reader", emailAddress: email });
  return { shared: true };
}

/* ---------- 狀態（供 UI；不丟錯） ---------- */
function status() {
  const c = loadConfig(), t = loadToken();
  const scopes = (t && t.scope ? t.scope.split(" ") : []);
  const has = (frag) => scopes.some((s) => s.includes(frag));
  return {
    configured: !!(c.clientId && c.clientSecret),
    connected: !!(t && t.refresh_token),
    email: (t && t.email) || null,
    folderId: c.folderId || null,
    folderName: c.folderName || null,
    scopesOk: has("spreadsheets") && has("drive.file"), // 建表/資料夾需要這兩個；只授 email 會全部失敗
    missingScopes: [!has("spreadsheets") && "Google 試算表（讀寫 Sheets）", !has("drive.file") && "Google 雲端硬碟（建立/存放檔案）"].filter(Boolean),
    hasApiKey: !!c.apiKey,
    apiKey: c.apiKey || null,        // 瀏覽器用金鑰（設計上非機密、露在前端），供 Picker 使用
    appId: c.projectNumber || null,  // 專案編號（Picker setAppId，選填）
    testModeNote: "測試模式下 Google 授權每 7 天需重連",
  };
}
/* Picker 選中的資料夾：取中繼資料（順帶驗證 app 對該資料夾有 drive.file 存取＝Picker 已授權） */
async function getFolder(id) {
  return api("GET", `https://www.googleapis.com/drive/v3/files/${id}?fields=id,name,mimeType,trashed`);
}

module.exports = {
  SCOPES, CONFIG_PATH, TOKEN_PATH,
  loadConfig, saveConfig, loadToken, clearToken, status,
  getAuthUrl, verifyState, exchangeCode, getAccessToken, getEmail,
  ensureFolder, renameFolder, newFolder, getFolder,
  createSheet, updateSheetValues, readSheet, sheetAlive, ensureInFolder,
  createSpreadsheetTabs, getSheetTabs, ensureTabs, writeTab, listPermissions, shareReader,
};
