"use strict";
/**
 * cms/secrets.js —— 密鑰從哪來（D12）
 * 程式其他地方只呼叫 secrets.get("名稱")，不管來源：
 *   env：本機開發。讀環境變數（名稱轉大寫、非英數換成底線：okta/client-secret → OKTA_CLIENT_SECRET）
 *   asm：正式環境。讀 AWS Secrets Manager（secretId＝prefix＋名稱）；SDK 用到才載入。值快取在記憶體，不寫檔、不進 log。
 * 密鑰不放進 repo、設定檔或映像檔。
 */
const envName = (name) => String(name).toUpperCase().replace(/[^A-Z0-9]+/g, "_");
function envSecrets(env = process.env) {
  return { kind: "env", async get(name) { const v = env[envName(name)]; if (v == null || v === "") throw new Error(`缺密鑰：環境變數 ${envName(name)} 沒有設定`); return v; }, async has(name) { return !!env[envName(name)]; } };
}
function asmSecrets({ prefix = "", region, client = null } = {}) {
  const cache = new Map();
  const getClient = () => {
    if (client) return client;
    let sdk; try { sdk = require("@aws-sdk/client-secrets-manager"); } catch (e) { throw new Error("要從 AWS Secrets Manager 讀密鑰需要先安裝 @aws-sdk/client-secrets-manager；本機開發請用 CS_SECRETS=env"); }
    const c = new sdk.SecretsManagerClient({ region: region || process.env.AWS_REGION });
    client = { getSecretValue: (p) => c.send(new sdk.GetSecretValueCommand(p)) }; return client;
  };
  const get = async (name) => { if (cache.has(name)) return cache.get(name); const r = await getClient().getSecretValue({ SecretId: prefix + name }); if (r.SecretString == null) throw new Error(`密鑰 ${prefix + name} 沒有文字內容`); cache.set(name, r.SecretString); return r.SecretString; };
  return { kind: "asm", get, async has(name) { try { await get(name); return true; } catch (e) { return false; } } };
}
function secretsFromEnv(env = process.env) { return (env.CS_SECRETS || "env") === "asm" ? asmSecrets({ prefix: env.CS_SECRETS_PREFIX || "", region: env.AWS_REGION }) : envSecrets(env); }
module.exports = { envSecrets, asmSecrets, secretsFromEnv, envName };
