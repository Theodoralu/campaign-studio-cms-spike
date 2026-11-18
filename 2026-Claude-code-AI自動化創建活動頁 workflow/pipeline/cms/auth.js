"use strict";
/**
 * cms/auth.js —— 現在的使用者是誰（D12）
 *
 * 程式其他地方只看 req.user＝{ email, name, dept }（沒登入＝null）。來源可換：
 *   dev  ：本機開發的假登入。身分來自請求標頭 X-Dev-User（測試用，方便同一個伺服器換人），沒帶就用環境變數 CS_DEV_USER。
 *          正式環境（NODE_ENV=production）拒絕啟動——假登入等於沒有登入。
 *   okta ：公司帳號登入（OIDC）。**還沒接上**：Okta 應用程式要等 repo 搬進 Yahoo 才能申請。這裡先把需要的設定驗好、把缺口講清楚；
 *          接的時候只補這一個函式，requireUser／requireApprover 與所有路由都不用動。
 * 守門：requireUser（沒登入＝401）、requireApprover（不在審核者名單＝403）。
 */
const parseUser = (s) => { const v = String(s || "").trim(); if (!v) return null; const m = v.match(/^(.*?)<([^>]+)>$/); const email = (m ? m[2] : v).trim().toLowerCase(); if (!/^[^@\s]+@[^@\s]+$/.test(email)) return null; return { email, name: m ? m[1].trim() : email.split("@")[0], dept: "" }; };

function devAuth({ env = process.env } = {}) {
  if (env.NODE_ENV === "production") throw new Error("正式環境不能用假登入（CS_AUTH=dev）——請設定 CS_AUTH=okta");
  const fallback = parseUser(env.CS_DEV_USER);
  return { kind: "dev", middleware: (req, res, next) => { req.user = parseUser(req.headers["x-dev-user"]) || fallback; next(); } };
}

const OKTA_KEYS = ["CS_OKTA_ISSUER", "CS_OKTA_CLIENT_ID", "CS_OKTA_REDIRECT_URI"];
function oktaAuth({ env = process.env } = {}) {
  const missing = OKTA_KEYS.filter((k) => !env[k]);
  if (missing.length) throw new Error(`Okta 登入缺設定：${missing.join("、")}（另需密鑰 okta/client-secret 與 session/secret）`);
  throw new Error("Okta 登入還沒接上：應用程式要等 repo 搬進 Yahoo 才能申請。現在請用 CS_AUTH=dev 在本機開發。");
}
function authFromEnv(env = process.env) { const kind = env.CS_AUTH || "dev"; if (kind === "dev") return devAuth({ env }); if (kind === "okta") return oktaAuth({ env }); throw new Error(`CS_AUTH 只能是 dev 或 okta（收到 ${kind}）`); }

const requireUser = (req, res, next) => (req.user ? next() : res.status(401).json({ error: "請先登入", code: "unauthenticated" }));
const requireApprover = (approvers) => (req, res, next) => {
  if (!req.user) return res.status(401).json({ error: "請先登入", code: "unauthenticated" });
  if (!approvers.isApprover(req.user.email)) return res.status(403).json({ error: "只有審核者可以核可——請把這檔活動交給審核者", code: "not-approver" });
  next();
};
module.exports = { devAuth, oktaAuth, authFromEnv, requireUser, requireApprover, parseUser, OKTA_KEYS };
