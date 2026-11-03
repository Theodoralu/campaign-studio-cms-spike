#!/usr/bin/env node
// build-css.mjs —— tokens.json（真源）→ tokens.css（產物）
// 用法：node design-tokens/build-css.mjs
// 原則：改 token 改 tokens.json 再重跑本檔；tokens.css 不得手改（R1 同邏輯）。

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const src = JSON.parse(fs.readFileSync(path.join(here, 'tokens.json'), 'utf8'));

const lines = [];
lines.push('/* tokens.css —— 由 tokens.json 生成，不要手改（改 json 再跑 build-css.mjs） */');
lines.push(`/* 來源：${src.meta.source}｜同步：${src.meta.syncedAt}｜命名：${src.meta.naming} */`);
lines.push('');

const names = Object.keys(src.colors);
for (const theme of src.themes) {
  if (theme.rejected) {
    lines.push(`/* ${theme.label}＝Figma「${theme.figmaMode}」：2026-08-21 主題拍板未採用，留 tokens.json 存檔、不輸出 CSS */`);
    lines.push('');
    continue;
  }
  const sel = theme.slug === 'default' ? ':root' : `[data-campaign-theme="${theme.slug}"]`;
  lines.push(`/* ${theme.label}${theme.draft ? '（草案，主題拍板前勿上線）' : ''}＝Figma「${theme.figmaMode}」 */`);
  lines.push(`${sel} {`);
  for (const n of names) {
    const c = src.colors[n];
    lines.push(`  ${c.css || `--cs-${n}`}: ${c.values[theme.slug]};${c.invariant ? ' /* 恆定 */' : ''}`);
  }
  lines.push('}');
  lines.push('');
}
lines.push('/* 附註：surface-module 套用時容器透明度恆定 55%（43 號 §F）；price-red 為真值鐵律色，任何主題不得覆寫。 */');

fs.writeFileSync(path.join(here, 'tokens.css'), lines.join('\n') + '\n');
console.log(`✓ tokens.css 生成：${names.length} 變數 × ${src.themes.length} 主題`);
