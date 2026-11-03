#!/usr/bin/env node
/* build_pack_whatsnew.js — 把「給用的人看的更新說明」轉成包最上層那份純文字檔
 *
 * 白話：同事解開壓縮檔，第一眼要能看到「這一版有什麼新的、值不值得換」。
 *       那段話只有一個真源＝規劃/releases/<tag>.md，這支負責把它轉成 txt 放進包裡。
 *       同一段話絕不手抄第二份——抄三份，三個月後它們會講三種話。
 *
 * 用法：node tools/build_pack_whatsnew.js --version <日期-hash> --out <輸出檔> [--releases-dir <目錄>]
 *       例：node tools/build_pack_whatsnew.js --version 20260921-3ee04ec --out "$STAGE/這一版有什麼新的.txt"
 *
 * 版本怎麼配對（打包機的版本號是「日期-當下 hash」，而說明是人先寫的，hash 常常對不上）：
 *   ① 有 releases/v<日期-hash>.md ＝ 精準命中，直接用
 *   ② 沒有但有同一天的 v<日期>-*.md ＝ 用同日最新那份，印黃燈講明「說明寫的是哪一版、這包是哪一版」
 *   ③ 同一天一份都沒有 ＝ 紅燈 exit 1。發版必附更新說明（規矩＝77 號），沒說明就不該出包；
 *      這裡不靜默產一份空的，也不默默跳過（鐵律 3：失敗要出聲、不靜默降級）。
 */
"use strict";
const fs = require("fs");
const path = require("path");

const WRAP = 76; // 顯示寬度（全形算 2 格）；先看我.txt 手工斷行也在這個範圍

/** 全形字算兩格——不算的話中文會斷在半條線上 */
function dispWidth(s) {
  let w = 0;
  for (const ch of s) {
    const c = ch.codePointAt(0);
    const wide =
      (c >= 0x1100 && c <= 0x115f) || (c >= 0x2e80 && c <= 0xa4cf) ||
      (c >= 0xac00 && c <= 0xd7a3) || (c >= 0xf900 && c <= 0xfaff) ||
      (c >= 0xfe30 && c <= 0xfe6f) || (c >= 0xff00 && c <= 0xff60) ||
      (c >= 0xffe0 && c <= 0xffe6) || (c >= 0x1f300 && c <= 0x1f9ff);
    w += wide ? 2 : 1;
  }
  return w;
}

const NO_LINE_START = "，。、：；！？）」』】〕》…・"; // 這些不能排到行首，會很醜
const NO_LINE_END = "「『（【《〔"; // 開引號不能留在行尾——會變成「上一行以『「』結尾、下一行才是內容」（2026-09-21 人眼驗收抓到）

/** 按顯示寬度斷行；續行縮排對齊（列點的第二行要縮進去，不然看不出還是同一條） */
function wrap(text, indent = "") {
  const out = [];
  let line = "";
  const chars = [...text];
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    const next = chars[i + 1];
    const limit = WRAP - dispWidth(out.length === 0 ? "" : indent);
    if (dispWidth(line + ch) > limit && line) {
      // 標點不能排到行首（自己是、或下一個字是）→ 讓它留在這一行，寬一格沒關係
      if (NO_LINE_START.includes(ch) || (next && NO_LINE_START.includes(next))) {
        line += ch;
        continue;
      }
      // 行尾若是開引號，把它帶到下一行去（留在行尾會讓引號跟它包住的字被拆開）
      let carry = "";
      while (line.length > 1 && NO_LINE_END.includes(line[line.length - 1])) {
        carry = line[line.length - 1] + carry;
        line = line.slice(0, -1);
      }
      out.push(line);
      line = carry + ch;
    } else {
      line += ch;
    }
  }
  if (line) out.push(line);
  return out.map((l, i) => (i === 0 ? l : indent + l)).join("\n");
}

/** md 行內語法拆掉——給同事看的純文字不該出現星號和反引號 */
function inlineToPlain(s) {
  return s
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/(^|[^*])\*([^*]+?)\*(?=[^*]|$)/g, "$1$2")
    .replace(/`([^`]+?)`/g, "$1")
    .replace(/\[([^\]]+?)\]\(([^)]+?)\)/g, "$1（$2）")
    .replace(/~~(.+?)~~/g, "$1")
    .trimEnd();
}

/** md → 純文字（文風對齊 pack-root/先看我.txt：標題底線、列點用「・」） */
function mdToPlain(md, opts = {}) {
  const lines = md.replace(/\r\n/g, "\n").split("\n");
  const out = [];
  const pushBlank = () => { if (out.length && out[out.length - 1] !== "") out.push(""); };

  for (let raw of lines) {
    const line = raw.replace(/\s+$/, "");

    // 小標底線的下一行是空行（md 原文都這樣寫）＝吃掉，讓內容緊貼小標
    if (/^\s*$/.test(line)) {
      if (/^-{2,}$/.test(out[out.length - 1] || "")) continue;
      pushBlank();
      continue;
    }

    // 引言（> …）當普通段落，去掉箭頭
    let body = line.replace(/^\s*>\s?/, "");

    // 標題
    let m = body.match(/^(#{1,6})\s+(.*)$/);
    if (m) {
      const level = m[1].length;
      const title = inlineToPlain(m[2]);
      pushBlank();
      out.push(title);
      out.push((level === 1 ? "=" : "-").repeat(Math.min(dispWidth(title), WRAP)));
      // 大標下面空一行（中間夾版本註記），小標底線後直接接內容——文風對齊 pack-root/先看我.txt
      if (level === 1) {
        if (opts.versionNote) out.push(opts.versionNote);
        pushBlank();
      }
      continue;
    }

    // 水平線
    if (/^\s*([-*_])\1{2,}\s*$/.test(body)) { pushBlank(); continue; }

    // 表格：分隔列丟掉，資料列轉「・欄一：欄二｜欄三」
    if (/^\s*\|/.test(body)) {
      if (/^\s*\|[\s:|-]+\|\s*$/.test(body)) continue;
      const cells = body.split("|").slice(1, -1).map((c) => inlineToPlain(c.trim())).filter(Boolean);
      if (!cells.length) continue;
      const head = cells[0];
      const rest = cells.slice(1).join("｜");
      out.push(wrap("・" + (rest ? `${head}：${rest}` : head), "  "));
      continue;
    }

    // 列點（含編號）→「・」；巢狀列點縮排保留
    m = body.match(/^(\s*)([-*+]|\d+[.)])\s+(.*)$/);
    if (m) {
      const depth = Math.floor(m[1].length / 2);
      const pad = "  ".repeat(depth);
      const text = inlineToPlain(m[3]);
      out.push(wrap(`${pad}・${text}`, pad + "  "));
      continue;
    }

    out.push(wrap(inlineToPlain(body)));
  }

  // 收尾：開頭結尾不留空行，中間不留連續空行
  const txt = out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  return txt + "\n";
}

/** 挑說明檔：精準 → 同日最新 → 紅燈 */
function pickReleaseFile(dir, versionLine) {
  if (!fs.existsSync(dir)) return { error: `找不到更新說明資料夾：${dir}` };
  const exact = path.join(dir, `v${versionLine}.md`);
  if (fs.existsSync(exact)) return { file: exact, exact: true, tag: `v${versionLine}` };

  const date = String(versionLine).split("-")[0];
  const sameDay = fs.readdirSync(dir).filter((f) => f.startsWith(`v${date}-`) && f.endsWith(".md")).sort();

  /* 同一天只有一份＝用它（說明多半是 commit 前就寫好的，hash 對不上屬正常）。
     同一天有好幾份＝紅燈，不猜。
     為什麼不猜：曾經用「檔案修改時間最新」決勝，2026-09-21 實測挑中的是已作廢那份——
     它第一句寫著「此版未發佈給任何人，已由 … 取代」，那句話會被印在同事解開壓縮檔看到的第一頁。
     而且 mtime 不是內容屬性：重新 clone、從外接碟還原、rsync 回來之後順序全變（備份鏈是本專案常態）。
     代價不對稱＝紅燈只要多打一行指令，猜錯是把錯誤資訊交到同事手上。 */
  if (sameDay.length === 1) {
    const f = sameDay[0];
    return { file: path.join(dir, f), exact: false, tag: f.replace(/\.md$/, "") };
  }
  if (sameDay.length > 1) {
    return {
      error: `${date} 這一天有 ${sameDay.length} 份更新說明，但沒有一份對得上這一包（v${versionLine}）——我不猜是哪一份。\n` +
        `        候選：${sameDay.join("、")}\n` +
        `        修法二選一：①把要用的那份改名成 v${versionLine}.md（git mv）②打包時明示 PACK_NOTES=<檔名>`,
      ambiguous: sameDay,
    };
  }
  return {
    error: `${dir} 裡沒有 ${date} 這一天的更新說明（找不到 v${versionLine}.md，也沒有 v${date}-*.md）。\n` +
      `        發版必附給用的人看的更新說明（規矩＝規劃/77 號）。請先寫 releases/v${versionLine}.md 再打包。`,
  };
}

function main(argv) {
  const arg = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : null; };
  const versionLine = arg("--version");
  const out = arg("--out");
  if (!versionLine || !out) {
    console.error('用法：node tools/build_pack_whatsnew.js --version <日期-hash> --out <輸出檔> [--releases-dir <目錄>] [--notes <說明檔>]');
    return 2;
  }
  const dir = arg("--releases-dir") ||
    path.resolve(__dirname, "../../../2026-AI自動化活動頁生成規劃/releases");

  /* --notes＝明示指定用哪一份說明（同一天有好幾份時的正解：打的人講出自己知道在用哪一份）。
     指定了就不猜、不退路，檔案不在就紅。 */
  const notesArg = arg("--notes");
  let picked;
  if (notesArg) {
    const f = path.isAbsolute(notesArg) ? notesArg : path.join(dir, notesArg);
    if (!fs.existsSync(f)) { console.error(`✗ 更新說明：--notes 指定的檔案不存在：${f}`); return 1; }
    const tag = path.basename(f).replace(/\.md$/, "");
    picked = { file: f, exact: tag === `v${versionLine}`, tag, explicit: true };
  } else {
    picked = pickReleaseFile(dir, versionLine);
  }
  if (picked.error) { console.error(`✗ 更新說明：${picked.error}`); return 1; }

  /* 版本註記要自己講真話：退路啟動（hash 對不上、用了同日另一份說明）時，
     包裡這份 txt 必須寫明「說明取自哪一版」——終端機那兩行 ⚠ 會被後面的 rsync／zip 輸出滾過去，
     而這份 txt 是同事真的會讀的地方。出聲要出在讀者看得到的位置（鐵律 3）。 */
  const versionNote = picked.exact
    ? `（這一版有什麼新的・版本 ${versionLine}）`
    : `（這一版有什麼新的・版本 ${versionLine}；說明內容取自 ${picked.tag}）`;
  const md = fs.readFileSync(picked.file, "utf8");
  let txt = mdToPlain(md, { versionNote });
  /* 版本註記是跟著大標插的。但 77 號 §3 只要求「第一行回答值不值得換」，沒要求一定有大標——
     沒有大標的說明轉出來會連版本字樣都沒有，同事回報問題時講不出手上是哪一版（第二審 F9）。 */
  if (!txt.includes(versionNote)) txt = `${versionNote}\n\n${txt}`;

  /* 「有檔」不等於「有內容」。原本量整份輸出的寬度，但那包含機器自己加的大標、底線與版本註記——
     光這三行就 138 格，一份只有標題、內文一個字都沒有的說明照樣過關（2026-09-21 第二審實算抓到）。
     所以改量「人真的寫了東西」：①必須有 77 號 §3 規定的開頭句 ②扣掉裝飾後的內文要有份量。
     開頭句這一刀順便擋掉三種壞說明：佔位稿、沒照格式寫的、抄錯範本的。 */
  const lines = txt.split("\n");
  const skip = new Set();
  lines.forEach((l, i) => {
    if (/^[=\-]{2,}$/.test(l)) { skip.add(i); skip.add(i - 1); } // 底線，以及它上面那行標題
    if (l === versionNote) skip.add(i);
  });
  const bodyWidth = lines.reduce((n, l, i) => (skip.has(i) || !l.trim() ? n : n + dispWidth(l)), 0);
  if (!/值不值得換：/.test(txt)) {
    console.error(`✗ 更新說明 ${path.basename(picked.file)} 沒有開頭那句「值不值得換：…」——同事第一行就要知道該不該換版。`);
    console.error(`        格式＝值不值得換：<值得／可以再等>——<一句理由>（規矩＝規劃/77 號 §3；可以誠實寫「可以再等」）`);
    return 1;
  }
  /* 100 格＝「開頭句＋兩三條」的最小真實說明（扣掉標題、底線、版本註記之後）。
     刻意設寬鬆：真實說明都上千格，這道門擋的是佔位稿與只有標題那種，不是擋小修版
     （小修版照 77 號可以誠實寫「可以再等」，本來就短）。 */
  if (bodyWidth < 100) {
    console.error(`✗ 更新說明 ${path.basename(picked.file)} 幾乎沒有內文（扣掉標題後量到 ${bodyWidth} 格，至少要 100），不出包。`);
    return 1;
  }

  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, txt, "utf8");

  // NOTES_TAG＝機器可讀，給 pack-editor.sh 接去寫進包內版本記號檔、並在收尾摘要再講一次
  console.log(`NOTES_TAG=${picked.tag}`);
  if (picked.exact) {
    console.log(`✓ 這一版有什麼新的.txt ← ${path.basename(picked.file)}`);
  } else {
    console.log(`⚠ 這一版有什麼新的.txt ← ${path.basename(picked.file)}（說明寫的是 ${picked.tag}，這包是 v${versionLine}）`);
    console.log(`  ${picked.explicit ? "你用 --notes 明示指定的" : "說明是寫完之後才 commit 的，hash 對不上屬正常"}；包裡那份 txt 與版本記號檔都已寫明取自哪一版。`);
  }
  return 0;
}

module.exports = { mdToPlain, inlineToPlain, pickReleaseFile, dispWidth, wrap };

if (require.main === module) process.exit(main(process.argv.slice(2)));
