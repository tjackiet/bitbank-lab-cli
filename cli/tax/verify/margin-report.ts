// 年間取引報告書（信用）と API 由来集計の突合。
//
// 報告書の「年中信用取引損益」は**利息だけを控除**した値で、取引手数料は別列。
// 集計側（margin-aggregate.ts）で手数料を足し戻してから比べる。
import type { Result } from "../../types.js";
import type { ParsedMarginReport } from "../import-csv/margin-report.js";
import type { MarginReportRow } from "../import-csv/margin-report-columns.js";
import { POSITION_FIELDS } from "../import-csv/margin-report-columns.js";
import { isZero, ZERO } from "../ratio.js";
import type { VerifyRow } from "../schema/verify.js";
import type { Unsupported } from "./annual-report.js";
import { indexByCurrency, readField } from "./index-rows.js";
import { MARGIN_FIELDS, type MarginAggregated } from "./margin-aggregate.js";
import { marginHint } from "./margin-hints.js";
import { buildRow, DUST_TOLERANCE, feeTolerance } from "./rows.js";

export type MarginOutcome = { rows: VerifyRow[]; unsupported: Unsupported[]; warnings: string[] };

/** 年末建玉は全履歴が要る（前年以前に建てた玉が残る）。年ウィンドウでは復元できない。 */
function positionsOf(rows: readonly MarginReportRow[]): Unsupported[] {
  const out: Unsupported[] = [];
  for (const row of rows) {
    for (const field of POSITION_FIELDS) {
      if (!isZero(readField(row, field))) {
        out.push({ currency: row.currency, field, value: row[field] });
      }
    }
  }
  return out;
}

export function compareMarginReport(
  report: ParsedMarginReport,
  aggregated: MarginAggregated,
): Result<MarginOutcome> {
  const indexed = indexByCurrency(report.rows, "margin report");
  if (!indexed.success) return indexed;

  const warnings = [...aggregated.warnings];
  const unsupported = positionsOf(report.rows);
  if (unsupported.length > 0) {
    warnings.push(
      "年末建玉（売建玉 / 買建玉）は全履歴が必要なため突合していません。報告書の値をそのまま参照してください（法人向け項目）",
    );
  }

  const currencies = [...new Set([...indexed.data.keys(), ...aggregated.byCurrency.keys()])].sort();
  const rows: VerifyRow[] = [];
  for (const currency of currencies) {
    const reported = indexed.data.get(currency);
    const api = aggregated.byCurrency.get(currency);
    if (reported === undefined) warnings.push(`${currency}: 信用の報告書に行がありません`);
    for (const field of MARGIN_FIELDS) {
      // 手数料の 2 系統はどちらも報告書の同じ列（支払手数料）と比べる
      const column = field === "margin_pnl" ? "margin_pnl" : "margin_fee";
      const row = buildRow({
        reportKind: "margin",
        currency,
        field,
        report: reported === undefined ? ZERO : readField(reported, column),
        api: api?.[field] ?? ZERO,
        tolerance: field === "margin_pnl" ? DUST_TOLERANCE : feeTolerance(api?.closes ?? 0),
        hint: marginHint(field),
      });
      if (row !== null) rows.push(row);
    }
  }
  return { success: true, data: { rows, unsupported, warnings } };
}
