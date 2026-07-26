// 年間取引報告書（現物）CSV → 行。**この層は解釈しない**（名寄せも合算もしない）。
// 1 行目は氏名・発行者のメタ行なので、ヘッダは列名で探す。
import { EXIT } from "../../exit-codes.js";
import type { Result } from "../../types.js";
import { formatZodError } from "../../validators.js";
import { AnnualReportRow, COLUMNS, HEADER_MARKER } from "./annual-report-columns.js";
import { readCsvFile } from "./parse-csv.js";

export type ParsedAnnualReport = {
  rows: AnnualReportRow[];
  /** 未知の列見出し。様式が変わった兆候なので握り潰さず上へ報告する */
  unknownColumns: string[];
};

const err = (error: string): Result<never> => ({ success: false, error, exitCode: EXIT.PARAM });

function headerIndex(table: readonly (readonly string[])[]): number {
  return table.findIndex((row) => row.some((cell) => cell.trim() === HEADER_MARKER));
}

/** 列見出し → 列位置。未知の見出しは捨てずに返す。 */
function locateColumns(header: readonly string[]): {
  at: Map<string, number>;
  unknown: string[];
} {
  const known: Record<string, string> = COLUMNS;
  const at = new Map<string, number>();
  const unknown: string[] = [];
  header.forEach((cell, i) => {
    const name = cell.trim();
    if (name === "") return;
    const field = known[name];
    if (field === undefined) unknown.push(name);
    else at.set(field, i);
  });
  return { at, unknown };
}

export function parseAnnualReport(
  table: readonly (readonly string[])[],
): Result<ParsedAnnualReport> {
  const h = headerIndex(table);
  if (h === -1) return err(`Annual report header not found (no "${HEADER_MARKER}" column)`);

  const { at, unknown } = locateColumns(table[h]);
  const missing = Object.values(COLUMNS).filter((f) => !at.has(f));
  if (missing.length > 0) return err(`Annual report is missing columns: ${missing.join(", ")}`);

  const rows: AnnualReportRow[] = [];
  for (let i = h + 1; i < table.length; i++) {
    const cells = table[i];
    if (cells.every((c) => c.trim() === "")) continue; // 末尾の空行
    const raw: Record<string, string> = {};
    for (const [field, index] of at) raw[field] = (cells[index] ?? "").trim();
    const parsed = AnnualReportRow.safeParse(raw);
    if (!parsed.success) {
      return err(`Annual report line ${i + 1}: ${formatZodError(parsed.error)}`);
    }
    rows.push(parsed.data);
  }
  if (rows.length === 0) return err("Annual report has no data rows");
  return { success: true, data: { rows, unknownColumns: unknown } };
}

export function readAnnualReport(path: string): Result<ParsedAnnualReport> {
  const table = readCsvFile(path);
  if (!table.success) return table;
  return parseAnnualReport(table.data);
}
