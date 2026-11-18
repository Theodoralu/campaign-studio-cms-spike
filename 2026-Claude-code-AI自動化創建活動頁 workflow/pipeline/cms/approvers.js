"use strict";
/** cms/approvers.js —— 審核者名單（D12）。檔案格式見 config/approvers.json；格式不對＝啟動時就出聲，不要等到有人按核可才發現。 */
const fs = require("fs");
function loadApprovers(file) {
  let j;
  try { j = JSON.parse(fs.readFileSync(file, "utf8")); } catch (e) { throw new Error(`審核者名單讀不到或不是合法 JSON（${file}）：${e.message}`); }
  if (!j || !Array.isArray(j.approvers)) throw new Error(`審核者名單格式不對（${file}）：要有 approvers 陣列`);
  const emails = new Map();
  for (const a of j.approvers) { const e = String((a && a.email) || "").trim().toLowerCase(); if (!/^[^@\s]+@[^@\s]+$/.test(e)) throw new Error(`審核者名單有一筆 email 不對：${JSON.stringify(a)}`); emails.set(e, { email: e, name: (a && a.name) || "" }); }
  if (!emails.size) throw new Error(`審核者名單是空的（${file}）——至少要有一位，否則沒有人能核可`);
  return { file, count: emails.size, isApprover: (email) => emails.has(String(email || "").trim().toLowerCase()), list: () => [...emails.values()] };
}
module.exports = { loadApprovers };
