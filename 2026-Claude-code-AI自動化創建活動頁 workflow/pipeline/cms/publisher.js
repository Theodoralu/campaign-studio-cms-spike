"use strict";
/**
 * cms/publisher.js —— 發布：把做好的 HTML 交到「存放層」（試作，2026-11-19）
 *
 * 背景：ECSEARCH-39133 規劃活動頁改由 S3（存放）＋CloudFront（對外與快取）上線，取代 AEM。這裡先做前半段——
 * 製作完成後把 HTML 上傳到 S3，讓「製作 → 發布」的接口有一個真的實作可以對著討論。
 *
 *   publisher.publish({ id, fileName, html }) → { url, bucket, key, etag, versionId, publishedAt }
 *
 * 先假設、等 39133 定案再改的三件事：
 *   路徑＝<prefix>/<活動編號>/index.html（票上寫 pages/<page>/index.html；頁面名稱先用活動編號）
 *   內容＝CMS 做出來的單一 HTML 原樣上傳，不拆（票上的 campaign-minifier 會不會再處理一次，未定）
 *   快取＝Cache-Control: max-age=600（票上訂 HTML 10 分鐘）
 * 沒做：CloudFront 與清快取（invalidation）、Athenz 換臨時憑證、共用 runtime（main.js／main.css）。
 *
 * 設定（環境變數）：CS_PUBLISH=s3 才啟用；沒設＝不發布，製作完只產檔（預設）。
 *   CS_PUBLISH_BUCKET（必填）｜CS_PUBLISH_PREFIX（預設 pages）｜CS_PUBLISH_ENDPOINT（本機 MinIO 用）｜
 *   CS_PUBLISH_BASE_URL（對外網址的開頭；有設才回 url。正式環境＝CloudFront 的網域，本機＝MinIO 的 <endpoint>/<bucket>）
 */
const HTML_CACHE_CONTROL = "public, max-age=600";
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,80}$/;

function createS3Publisher({ client, bucket, prefix = "pages", baseUrl = null, clock = null }) {
  if (!client || !bucket) throw new Error("S3 發布需要 client 與 bucket");
  const pre = String(prefix || "").replace(/^\/+|\/+$/g, "");
  const keyOf = (id) => { if (!ID_RE.test(String(id))) throw new Error("活動編號格式不對：" + id); return `${pre ? pre + "/" : ""}${id}/index.html`; };
  return {
    kind: "s3", bucket, prefix: pre,
    keyOf,
    urlOf: (id) => (baseUrl ? `${String(baseUrl).replace(/\/+$/, "")}/${keyOf(id)}` : null),
    async publish({ id, html }) {
      if (typeof html !== "string" || !html.length) throw new Error("沒有可發布的內容");
      const Key = keyOf(id);
      const r = await client.putObject({ Bucket: bucket, Key, Body: html, ContentType: "text/html; charset=utf-8", CacheControl: HTML_CACHE_CONTROL });
      return { url: this.urlOf(id), bucket, key: Key, etag: r.ETag || null, versionId: r.VersionId || null, publishedAt: clock ? clock.iso() : new Date().toISOString() };
    },
  };
}

/** 依環境變數組 publisher；沒啟用回 null（製作流程看到 null 就不發布） */
function publisherFromEnv(env = process.env, { clock = null } = {}) {
  const kind = env.CS_PUBLISH || "";
  if (!kind) return null;
  if (kind !== "s3") throw new Error(`CS_PUBLISH 只能是 s3 或不設（收到 ${kind}）`);
  if (!env.CS_PUBLISH_BUCKET) throw new Error("CS_PUBLISH=s3 需要設定 CS_PUBLISH_BUCKET");
  const { awsS3Client } = require("../core/store/s3_backend");
  return createS3Publisher({ client: awsS3Client({ region: env.AWS_REGION, endpoint: env.CS_PUBLISH_ENDPOINT || undefined }), bucket: env.CS_PUBLISH_BUCKET, prefix: env.CS_PUBLISH_PREFIX || "pages", baseUrl: env.CS_PUBLISH_BASE_URL || null, clock });
}
module.exports = { createS3Publisher, publisherFromEnv, HTML_CACHE_CONTROL };
