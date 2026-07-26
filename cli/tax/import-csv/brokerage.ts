// 販売所「売買履歴」CSV → 行。この層は解釈しない（判定は to-events-brokerage.ts）。
import type { Result } from "../../types.js";
import { BROKERAGE_COLUMNS, BROKERAGE_HEADER_MARKER, BrokerageRow } from "./brokerage-columns.js";
import { readCsvFile } from "./parse-csv.js";
import { type ParsedReport, parseReportTable } from "./parse-report.js";

export type ParsedBrokerage = ParsedReport<BrokerageRow>;

const SPEC = {
  columns: BROKERAGE_COLUMNS as Record<string, string>,
  schema: BrokerageRow,
  marker: BROKERAGE_HEADER_MARKER,
  label: "Brokerage history",
};

export function parseBrokerage(table: readonly (readonly string[])[]): Result<ParsedBrokerage> {
  return parseReportTable(table, SPEC);
}

export function readBrokerage(path: string): Result<ParsedBrokerage> {
  const table = readCsvFile(path);
  if (!table.success) return table;
  return parseBrokerage(table.data);
}
