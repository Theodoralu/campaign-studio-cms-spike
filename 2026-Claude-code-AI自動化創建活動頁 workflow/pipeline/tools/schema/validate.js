#!/usr/bin/env node
/* schema 驗證器（D3）：node tools/schema/validate.js <schemaDir> <file.json>...
   檔種由檔名推：draft*.json / *_draft.json → draft；snapshot*.json / *_snapshot.json → snapshot；其餘取檔名本體。 */
const fs = require("fs"), path = require("path");
const Ajv = require("ajv/dist/2020"), addFormats = require("ajv-formats");
const ajv = new Ajv({ allErrors: true, strict: false, allowUnionTypes: true }); addFormats(ajv);
const [schemaDir, ...files] = process.argv.slice(2);
const kindOf = (f) => { const b = path.basename(f, ".json").split(".")[0]; /* draft.golden.json → draft */ if (/(^|_)draft(\.|$)/.test(b)) return "draft"; if (/(^|_)snapshot(\.|$)/.test(b)) return "snapshot"; return b; };
const cache = {};
const validatorFor = (kind) => cache[kind] || (cache[kind] = ajv.compile(JSON.parse(fs.readFileSync(path.join(schemaDir, `${kind}.schema.json`), "utf8"))));
let bad = 0;
for (const f of files) {
  const kind = kindOf(f), v = validatorFor(kind), ok = v(JSON.parse(fs.readFileSync(f, "utf8")));
  console.log((ok ? "✔" : "✖"), kind.padEnd(13), f.split("/").slice(-2).join("/"));
  if (!ok) { bad++; for (const e of v.errors.slice(0, 10)) console.log("   ", e.instancePath || "/", e.message, e.params && e.params.allowedValues ? JSON.stringify(e.params.allowedValues) : ""); }
}
process.exit(bad ? 1 : 0);
