#!/usr/bin/env node
"use strict";
/**
 * tools/publish_local_setup.js —— 在「本機 MinIO」準備一個給發布試作用的 bucket（2026-11-19）
 *
 * 做三件事：建 bucket、開版本控管、設成任何人可讀（這樣瀏覽器才能直接開）。
 * ⚠ 只給本機 MinIO 用。正式環境的 bucket 是私有的、只有 CloudFront 能讀（ECSEARCH-39133），不會設成公開；
 *   所以這支只接受 localhost／127.0.0.1 的端點，其他一律拒絕。
 *
 * 用法：AWS_ACCESS_KEY_ID=… AWS_SECRET_ACCESS_KEY=… AWS_REGION=us-east-1 CS_PUBLISH_ENDPOINT=http://localhost:9000 CS_PUBLISH_BUCKET=cs-pages node tools/publish_local_setup.js
 */
async function main() {
  const endpoint = process.env.CS_PUBLISH_ENDPOINT || "", Bucket = process.env.CS_PUBLISH_BUCKET || "";
  if (!Bucket) { console.error("✖ 需要設定 CS_PUBLISH_BUCKET"); process.exit(2); }
  let host = ""; try { host = new URL(endpoint).hostname; } catch (e) { /* 下面一起擋 */ }
  if (!["localhost", "127.0.0.1"].includes(host)) { console.error(`✖ 這支只給本機 MinIO 用（CS_PUBLISH_ENDPOINT 要是 http://localhost:… 或 http://127.0.0.1:…，收到「${endpoint}」）。正式的 bucket 不能設成公開。`); process.exit(2); }
  const sdk = require("@aws-sdk/client-s3");
  const c = new sdk.S3Client({ region: process.env.AWS_REGION, endpoint, forcePathStyle: true });
  try { await c.send(new sdk.CreateBucketCommand({ Bucket })); console.log(`✔ 建立 bucket ${Bucket}`); }
  catch (e) { if (!/BucketAlreadyOwnedByYou|BucketAlreadyExists/.test(e.name || "")) throw e; console.log(`✔ bucket ${Bucket} 已存在`); }
  await c.send(new sdk.PutBucketVersioningCommand({ Bucket, VersioningConfiguration: { Status: "Enabled" } })); console.log("✔ 版本控管已開啟");
  const Policy = JSON.stringify({ Version: "2012-10-17", Statement: [{ Effect: "Allow", Principal: { AWS: ["*"] }, Action: ["s3:GetObject"], Resource: [`arn:aws:s3:::${Bucket}/*`] }] });
  await c.send(new sdk.PutBucketPolicyCommand({ Bucket, Policy })); console.log("✔ 設成任何人可讀（只限本機試作）");
  console.log(`\n發布後的網址會是：${endpoint.replace(/\/+$/, "")}/${Bucket}/pages/<活動編號>/index.html`);
}
main().catch((e) => { console.error(`✖ ${e.name || ""} ${e.message}`); process.exit(1); });
