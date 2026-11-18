#!/usr/bin/env node
"use strict";
/**
 * tools/store_s3_check.js —— 對「真的」S3（或 MinIO）驗一次 RunStore（D11，2026-11-18）
 *
 * 單元測試用的是記憶體版 S3；這支拿真的 bucket 走同樣幾步，確認三件記憶體版證明不了的事：
 *   ①這個 bucket 支援條件式寫入（If-Match／If-None-Match）②版本控管有開（拿得回上一版）③手上的憑證讀寫刪都有權限
 * 會在 bucket 的 <prefix>/_check-<時間>/ 底下建一檔測試活動，跑完刪掉。
 *
 * 用法（需要先 npm install @aws-sdk/client-s3）：
 *   CS_STORE=s3 CS_S3_BUCKET=<bucket> AWS_REGION=<region> node tools/store_s3_check.js
 *   MinIO：再加 CS_S3_ENDPOINT=http://localhost:9000 與 AWS_ACCESS_KEY_ID／AWS_SECRET_ACCESS_KEY；第一次加 --create-bucket（建 bucket＋開版本控管）
 * exit 0＝全過；1＝有一步沒過；2＝環境沒設好。
 */
const fs = require("fs");
const path = require("path");
const S = require(path.join(__dirname, "..", "core", "store"));
const FIX = path.join(__dirname, "..", "test", "fixtures", "runs", "2026-10-27-wb-085823");
const read = (f) => JSON.parse(fs.readFileSync(path.join(FIX, f), "utf8"));

/** --create-bucket：bucket 不存在就建、並打開版本控管（本機 MinIO 用；公司的 bucket 由申請流程建立，不要用這個旗標） */
async function ensureBucket() {
  const sdk = require("@aws-sdk/client-s3");
  const endpoint = process.env.CS_S3_ENDPOINT || undefined, Bucket = process.env.CS_S3_BUCKET;
  const c = new sdk.S3Client({ region: process.env.AWS_REGION, endpoint, forcePathStyle: !!endpoint });
  try { await c.send(new sdk.CreateBucketCommand({ Bucket })); console.log(`✔ 建立 bucket ${Bucket}`); }
  catch (e) { if (!/BucketAlreadyOwnedByYou|BucketAlreadyExists/.test(e.name || "")) throw e; console.log(`✔ bucket ${Bucket} 已存在`); }
  await c.send(new sdk.PutBucketVersioningCommand({ Bucket, VersioningConfiguration: { Status: "Enabled" } }));
  console.log("✔ 版本控管已開啟");
}

async function main() {
  if (process.argv.includes("--create-bucket")) { try { await ensureBucket(); } catch (e) { console.error(`✖ 建立 bucket 失敗：${e.name || ""} ${e.message}`); process.exit(2); } }
  let store;
  try { store = S.storeFromEnv({ ...process.env, CS_STORE: "s3", CS_S3_PREFIX: (process.env.CS_S3_PREFIX || "runs") + "/_check-" + Date.now() }); }
  catch (e) { console.error("✖ " + e.message); process.exit(2); }
  const id = "check-run"; let bad = 0;
  const step = async (name, fn) => { try { await fn(); console.log("✔ " + name); } catch (e) { bad++; console.error(`✖ ${name}：${e.name || ""} ${e.message}`); } };
  await step("建立活動（If-None-Match: *）", async () => { await store.createRun(id, { stage: "check" }); });
  await step("重複建立同編號被擋（bucket 支援條件式寫入）", async () => { try { await store.createRun(id); } catch (e) { if (e.code === "run-exists") return; throw e; } throw new Error("沒被擋——這個 bucket／端點不支援 If-None-Match"); });
  await step("系統寫入草稿", async () => { await store.putJson(id, "snapshot.json", read("snapshot.replay.json")); await store.saveDraft(id, read("draft.golden.json"), { source: "system", note: "check" }); });
  await step("兩個人交錯存檔，後者 409（If-Match）", async () => {
    const a = await store.getDraft(id), b = await store.getDraft(id);
    a.draft.page.ctaText = "甲"; b.draft.page.ctaText = "乙";
    await store.saveDraft(id, a.draft, { ifMatch: a.etag, actor: "甲" });
    try { await store.saveDraft(id, b.draft, { ifMatch: b.etag, actor: "乙" }); } catch (e) { if (e.code === "stale-draft") return; throw e; }
    throw new Error("後者沒被擋——這個 bucket／端點不支援 If-Match");
  });
  await step("拿得回上一版（bucket 版本控管有開）", async () => { const vs = await store.listDraftVersions(id); if (!vs.length) throw new Error("沒有舊版——請開啟 bucket 的 Versioning"); const v = await store.getDraftVersion(id, vs[0].versionId); if (!v || !v.draft.page) throw new Error("舊版讀不回來"); });
  await step("清掉測試資料", async () => { await store.deleteRun(id); });
  console.log(bad ? `\n✖ ${bad} 步沒過` : "\n✔ 這個 bucket 可以當 RunStore 的後端");
  process.exit(bad ? 1 : 0);
}
main();
