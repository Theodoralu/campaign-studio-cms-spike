"use strict";
/**
 * core/store/fs_backend.js —— 檔案系統後端（本機開發用；資料夾擺法與單機版 runs/<id>/ 相同）
 * 介面（S3 後端同形）：get／put（ifMatch、ifNoneMatch、keepVersion）／del／children／versions／getVersion。
 * etag＝內容 sha256。比對後寫入（compare-and-swap）靠同一個程序內的逐鍵排隊；多個程序同時寫同一個資料夾不保證——那是 S3 後端的工作。
 * 舊版：keepVersion 時先把現有檔複製成 <名>.v<N>.<副檔名>（＝單機版的 draft.vN.json 慣例）。
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const etagOf = (buf) => crypto.createHash("sha256").update(buf).digest("hex");
const precondition = (msg) => Object.assign(new Error(msg), { code: "PreconditionFailed" });

function createFsBackend(root) {
  const base = path.resolve(root);
  const locks = new Map();
  const file = (key) => { const p = path.resolve(base, key); if (p !== base && !p.startsWith(base + path.sep)) throw new Error("store：鍵跑出根目錄 " + key); return p; };
  const withLock = async (key, fn) => { const prev = locks.get(key) || Promise.resolve(); let release; const mine = new Promise((r) => (release = r)); locks.set(key, prev.then(() => mine)); await prev; try { return await fn(); } finally { release(); if (locks.get(key) === mine) locks.delete(key); } };
  const readNow = (key) => { try { const buf = fs.readFileSync(file(key)); return { text: buf.toString("utf8"), etag: etagOf(buf), versionId: null }; } catch (e) { if (e.code === "ENOENT" || e.code === "EISDIR") return null; throw e; } };
  const verName = (key, n) => { const ext = path.extname(key); return key.slice(0, key.length - ext.length) + ".v" + n + ext; };
  const verList = (key) => { const out = []; for (let n = 1; fs.existsSync(file(verName(key, n))); n++) out.push(String(n)); return out; };
  return {
    kind: "fs", root: base,
    async get(key) { return readNow(key); },
    async put(key, text, { ifMatch = null, ifNoneMatch = null, keepVersion = false } = {}) {
      return withLock(key, async () => {
        const cur = readNow(key);
        if (ifNoneMatch === "*" && cur) throw precondition("已存在：" + key);
        if (ifMatch != null && (!cur || cur.etag !== ifMatch)) throw precondition("版本不符：" + key);
        const p = file(key); fs.mkdirSync(path.dirname(p), { recursive: true });
        let versionId = null;
        if (keepVersion && cur) { versionId = String(verList(key).length + 1); fs.copyFileSync(p, file(verName(key, versionId))); }
        const tmp = p + ".tmp-" + process.pid + "-" + crypto.randomBytes(4).toString("hex");
        fs.writeFileSync(tmp, text); fs.renameSync(tmp, p);
        return { etag: etagOf(Buffer.from(text, "utf8")), versionId };
      });
    },
    async del(key) { try { fs.rmSync(file(key), { recursive: true, force: true }); } catch (e) { if (e.code !== "ENOENT") throw e; } },
    /** prefix 底下一層的名字（資料夾名或檔名） */
    async children(prefix) { try { return fs.readdirSync(file(prefix)).sort(); } catch (e) { if (e.code === "ENOENT") return []; throw e; } },
    /** 舊版清單（舊→新）；不含現行版 */
    async versions(key) { return verList(key).map((v) => ({ versionId: v })); },
    async getVersion(key, versionId) { return readNow(verName(key, versionId)); },
  };
}
module.exports = { createFsBackend };
