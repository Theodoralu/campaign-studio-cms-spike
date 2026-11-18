"use strict";
/**
 * core/store/s3_backend.js —— S3 後端（正式環境用）
 *
 * 比對後寫入靠 S3 的條件式寫入：PutObject 帶 If-Match（版本要對得上）或 If-None-Match: *（只在不存在時寫）；不符 S3 回 412。
 * 舊版靠 bucket 的版本控管（Versioning 要開）：每次覆寫 S3 自己留舊版，這裡不另外複製。
 *
 * client＝五個方法的小介面（參數名照 AWS SDK v3 的 Command 輸入）：
 *   getObject({Bucket,Key,VersionId?}) → { Body: 字串, ETag, VersionId } ｜找不到丟 { name: "NoSuchKey" }
 *   putObject({Bucket,Key,Body,ContentType,IfMatch?,IfNoneMatch?}) → { ETag, VersionId }｜條件不符丟 { name: "PreconditionFailed" } 或 httpStatusCode 412
 *   deleteObject({Bucket,Key})；listObjectsV2({Bucket,Prefix,Delimiter,ContinuationToken})；listObjectVersions({Bucket,Prefix})
 * 真的 S3：awsS3Client()（需要 @aws-sdk/client-s3）。測試：memory_s3.js（同語意的記憶體版）。
 */
const precondition = (msg) => Object.assign(new Error(msg), { code: "PreconditionFailed" });
const isMissing = (e) => e && (e.name === "NoSuchKey" || e.name === "NotFound" || e.Code === "NoSuchKey" || (e.$metadata && e.$metadata.httpStatusCode === 404));
const isPrecondition = (e) => e && (e.name === "PreconditionFailed" || e.Code === "PreconditionFailed" || e.name === "ConditionalRequestConflict" || (e.$metadata && [409, 412].includes(e.$metadata.httpStatusCode)));

function createS3Backend({ client, bucket, prefix = "" }) {
  if (!client || !bucket) throw new Error("S3 後端需要 client 與 bucket");
  const pre = prefix ? prefix.replace(/\/+$/, "") + "/" : "";
  const K = (key) => pre + key;
  const read = async (params) => { try { const r = await client.getObject(params); return { text: typeof r.Body === "string" ? r.Body : await r.Body.transformToString("utf-8"), etag: r.ETag, versionId: r.VersionId || null }; } catch (e) { if (isMissing(e)) return null; throw e; } };
  return {
    kind: "s3", bucket, prefix: pre,
    async get(key) { return read({ Bucket: bucket, Key: K(key) }); },
    async put(key, text, { ifMatch = null, ifNoneMatch = null } = {}) {
      const params = { Bucket: bucket, Key: K(key), Body: text, ContentType: /\.json$/.test(key) ? "application/json; charset=utf-8" : /\.html$/.test(key) ? "text/html; charset=utf-8" : "text/plain; charset=utf-8" };
      if (ifMatch != null) params.IfMatch = ifMatch;
      if (ifNoneMatch != null) params.IfNoneMatch = ifNoneMatch;
      try { const r = await client.putObject(params); return { etag: r.ETag, versionId: r.VersionId || null }; }
      catch (e) { if (isPrecondition(e)) throw precondition((ifNoneMatch ? "已存在：" : "版本不符：") + key); throw e; }
    },
    async del(key) {
      const p = K(key);
      let token; do { const r = await client.listObjectsV2({ Bucket: bucket, Prefix: p, ContinuationToken: token }); for (const o of r.Contents || []) if (o.Key === p || o.Key.startsWith(p + "/")) await client.deleteObject({ Bucket: bucket, Key: o.Key }); token = r.IsTruncated ? r.NextContinuationToken : null; } while (token);
    },
    async children(prefix) {
      const p = K(prefix).replace(/\/+$/, "") + "/"; const out = new Set(); let token;
      do { const r = await client.listObjectsV2({ Bucket: bucket, Prefix: p, Delimiter: "/", ContinuationToken: token });
        for (const c of r.CommonPrefixes || []) out.add(c.Prefix.slice(p.length).replace(/\/$/, ""));
        for (const o of r.Contents || []) out.add(o.Key.slice(p.length));
        token = r.IsTruncated ? r.NextContinuationToken : null; } while (token);
      return [...out].filter(Boolean).sort();
    },
    async versions(key) {
      const r = await client.listObjectVersions({ Bucket: bucket, Prefix: K(key) });
      return (r.Versions || []).filter((v) => v.Key === K(key) && !v.IsLatest).sort((a, b) => new Date(a.LastModified) - new Date(b.LastModified)).map((v) => ({ versionId: v.VersionId, lastModified: v.LastModified }));
    },
    async getVersion(key, versionId) { return read({ Bucket: bucket, Key: K(key), VersionId: versionId }); },
  };
}

/** 真的 S3（或 MinIO：給 endpoint＋forcePathStyle）。SDK 用到才載入——本機開發與測試不需要裝。 */
function awsS3Client({ region, endpoint, forcePathStyle, credentials } = {}) {
  let sdk;
  try { sdk = require("@aws-sdk/client-s3"); }
  catch (e) { throw new Error("要連 S3 需要先安裝 @aws-sdk/client-s3（npm install @aws-sdk/client-s3）；本機開發請用 FsRunStore（CS_STORE=fs）"); }
  const c = new sdk.S3Client({ region: region || process.env.AWS_REGION, endpoint, forcePathStyle: forcePathStyle != null ? forcePathStyle : !!endpoint, credentials });
  const send = (Cmd) => (params) => c.send(new Cmd(params));
  return { getObject: send(sdk.GetObjectCommand), putObject: send(sdk.PutObjectCommand), deleteObject: send(sdk.DeleteObjectCommand), listObjectsV2: send(sdk.ListObjectsV2Command), listObjectVersions: send(sdk.ListObjectVersionsCommand) };
}
module.exports = { createS3Backend, awsS3Client };
