// UI CSV 共通のパーサ。責務は「バイト列 → 行 × セル」だけで、列の意味は持たない。
//
// bitbank の書き出しは **UTF-8 BOM 付き**。BOM を落とし損ねると先頭セルが
// "﻿通貨名" になり、列名によるヘッダ検出が静かに失敗する（位置指定なら
// 気づかないまま全列ずれる）ので、復号の段でだけ処理する。
// Excel を経由して Shift_JIS になったファイルも来得るため、UTF-8 として
// 復号できないバイトがあれば復号し直す。
import { readFileSync } from "node:fs";
import { EXIT } from "../../exit-codes.js";
import type { Result } from "../../types.js";

const BOM = "﻿";
/** 復号失敗のシグナル。UTF-8 として不正なバイト列はここに落ちる */
const REPLACEMENT = "�";

/**
 * RFC 4180 相当。引用符内のカンマ・改行・`""` エスケープを扱う。
 * 行区切りは LF / CRLF のみ（CR 単独は区切りにしない。現行の書き出しに存在せず、
 * 「引用符内の CR がデータ」との区別を捨てる方が危ないため）。
 */
export function parseCsv(text: string): string[][] {
  const src = text.startsWith(BOM) ? text.slice(1) : text;
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;

  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c !== '"') cell += c;
      else if (src[i + 1] === '"') {
        cell += '"';
        i++;
      } else quoted = false;
      continue;
    }
    if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(cell);
      cell = "";
    } else if (c === "\n") {
      row.push(cell.endsWith("\r") ? cell.slice(0, -1) : cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += c;
  }
  if (cell !== "" || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

function decode(buf: Uint8Array): string | null {
  const text = new TextDecoder("utf-8").decode(buf);
  if (!text.includes(REPLACEMENT)) return text;
  try {
    return new TextDecoder("shift_jis", { fatal: true }).decode(buf);
  } catch {
    return null;
  }
}

/** ファイルから読む。読めない・復号できないは Result のエラーにする（throw しない）。 */
export function readCsvFile(path: string): Result<string[][]> {
  let buf: Uint8Array;
  try {
    buf = readFileSync(path);
  } catch {
    return { success: false, error: `Cannot read CSV file: ${path}`, exitCode: EXIT.PARAM };
  }
  const text = decode(buf);
  if (text === null) {
    return {
      success: false,
      error: `CSV is neither UTF-8 nor Shift_JIS: ${path}`,
      exitCode: EXIT.PARAM,
    };
  }
  return { success: true, data: parseCsv(text) };
}
