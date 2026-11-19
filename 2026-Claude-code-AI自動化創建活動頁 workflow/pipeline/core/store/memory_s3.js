"use strict";
/**
 * core/store/memory_s3.js —— 記憶體版 S3（測試用；語意照 S3：ETag、If-Match／If-None-Match 不符回 412、版本控管留舊版）
 * calls＝每次呼叫的紀錄，測試用來確認「寫入真的有帶 If-Match」。
 */
const crypto = require("crypto");
function createMemoryS3({ versioning = true } = {}) {
  const objects = new Map(); // Key → [{ Body, ETag, VersionId, LastModified }]（最後一筆＝現行版）
  const calls = [];
  let seq = 0;
  const err = (name, status) => Object.assign(new Error(name), { name, $metadata: { httpStatusCode: status } });
  const latest = (Key) => { const v = objects.get(Key); return v && v.length ? v[v.length - 1] : null; };
  return {
    calls, objects,
    async getObject({ Key, VersionId }) { calls.push({ op: "get", Key, VersionId }); const v = VersionId ? (objects.get(Key) || []).find((x) => x.VersionId === VersionId) : latest(Key); if (!v) throw err("NoSuchKey", 404); return { Body: v.Body, ETag: v.ETag, VersionId: v.VersionId }; },
    async putObject({ Key, Body, IfMatch, IfNoneMatch, ContentType, CacheControl }) {
      calls.push({ op: "put", Key, IfMatch, IfNoneMatch, ContentType, CacheControl });
      const cur = latest(Key);
      if (IfNoneMatch === "*" && cur) throw err("PreconditionFailed", 412);
      if (IfMatch != null && (!cur || cur.ETag !== IfMatch)) throw err("PreconditionFailed", 412);
      const rec = { Body: String(Body), ETag: '"' + crypto.createHash("md5").update(String(Body)).digest("hex") + '"', VersionId: "v" + String(++seq).padStart(6, "0"), LastModified: new Date(Date.now() + seq) };
      if (versioning) objects.set(Key, [...(objects.get(Key) || []), rec]); else objects.set(Key, [rec]);
      return { ETag: rec.ETag, VersionId: rec.VersionId };
    },
    async deleteObject({ Key }) { calls.push({ op: "delete", Key }); objects.delete(Key); return {}; },
    async listObjectsV2({ Prefix = "", Delimiter }) {
      calls.push({ op: "list", Prefix, Delimiter });
      const keys = [...objects.keys()].filter((k) => k.startsWith(Prefix)).sort();
      if (!Delimiter) return { Contents: keys.map((Key) => ({ Key })), IsTruncated: false };
      const prefixes = new Set(), contents = [];
      for (const k of keys) { const rest = k.slice(Prefix.length); const i = rest.indexOf(Delimiter); if (i >= 0) prefixes.add(Prefix + rest.slice(0, i + 1)); else contents.push({ Key: k }); }
      return { Contents: contents, CommonPrefixes: [...prefixes].map((p) => ({ Prefix: p })), IsTruncated: false };
    },
    async listObjectVersions({ Prefix = "" }) { const Versions = []; for (const [Key, vs] of objects) if (Key.startsWith(Prefix)) vs.forEach((v, i) => Versions.push({ Key, VersionId: v.VersionId, LastModified: v.LastModified, IsLatest: i === vs.length - 1 })); return { Versions }; },
  };
}
module.exports = { createMemoryS3 };
