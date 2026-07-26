// 年間取引報告書（現物）と API 由来集計の突合。**検出であって判定ではない**。
// 差が出ること自体は異常ではない（販売所は API に一切現れないため、CSV 未投入の
// 口座では購入・売却の差が必ず残る）。この差を数量として示すのがこのモジュールの仕事。

import { EXIT } from "../../exit-codes.js";
import type { Result } from "../../types.js";
import { canonicalAsset } from "../import/symbol-alias.js";
import type { ParsedAnnualReport } from "../import-csv/annual-report.js";
import type { AnnualReportRow } from "../import-csv/annual-report-columns.js";
import { UNSUPPORTED_FIELDS } from "../import-csv/annual-report-columns.js";
import { isZero, type Ratio, ZERO } from "../ratio.js";
import { fromDecimalString } from "../ratio-decimal.js";
import type { ReportCheck, VerifyRow } from "../schema/verify.js";
import { type Aggregated, COMPARED_FIELDS, zeroFigures } from "./aggregate.js";
import { reportChecks } from "./checks.js";
import { toleranceFor, verifyRow } from "./rows.js";

export type Unsupported = { currency: string; field: string; value: string };

export type VerifyOutcome = {
  rows: VerifyRow[];
  checks: ReportCheck[];
  unsupported: Unsupported[];
  warnings: string[];
};

const at = (row: AnnualReportRow, field: keyof AnnualReportRow): Ratio =>
  fromDecimalString(row[field]) ?? ZERO;

/**
 * 資産キーを名寄せして引けるようにする。**正規化後に衝突したら黙って上書きせず
 * エラーにする** — 旧名と新名の行が両方あると後勝ちで片方の数量が消え、その分が
 * まるごと「取込漏れ」に見えてしまう（合算すべきか別物かは人が判断する領域）。
 */
function byCanonicalCurrency(
  rows: readonly AnnualReportRow[],
): Result<Map<string, AnnualReportRow>> {
  const out = new Map<string, AnnualReportRow>();
  for (const row of rows) {
    const key = canonicalAsset(row.currency);
    if (out.has(key)) {
      return {
        success: false,
        error: `Duplicate report currency after normalization: ${row.currency} (=> ${key})`,
        exitCode: EXIT.PARAM,
      };
    }
    out.set(key, row);
  }
  return { success: true, data: out };
}

function unsupportedOf(rows: readonly AnnualReportRow[]): Unsupported[] {
  const out: Unsupported[] = [];
  for (const row of rows) {
    for (const field of UNSUPPORTED_FIELDS) {
      if (!isZero(at(row, field))) out.push({ currency: row.currency, field, value: row[field] });
    }
  }
  return out;
}

export function compareAnnualReport(
  report: ParsedAnnualReport,
  aggregated: Aggregated,
): Result<VerifyOutcome> {
  const indexed = byCanonicalCurrency(report.rows);
  if (!indexed.success) return indexed;

  const checked = reportChecks(report.rows);
  const warnings = [...checked.warnings, ...aggregated.warnings];
  const unsupported = unsupportedOf(report.rows);
  if (unsupported.length > 0) {
    warnings.push(
      `当 CLI が API から再現できない列（BTC 建て / 貸出）に値があります: ${unsupported.length} 件。該当銘柄の差はこの分を含みます`,
    );
  }

  const currencies = [...new Set([...indexed.data.keys(), ...aggregated.byCurrency.keys()])].sort();
  const rows: VerifyRow[] = [];
  for (const currency of currencies) {
    const reported = indexed.data.get(currency);
    const api = aggregated.byCurrency.get(currency) ?? zeroFigures();
    if (reported === undefined) {
      warnings.push(`${currency}: 報告書に行がありません（API 側の集計のみで比較しています）`);
    }
    for (const field of COMPARED_FIELDS) {
      const row = verifyRow(
        currency,
        field,
        reported === undefined ? ZERO : at(reported, field),
        api[field],
        toleranceFor(field, api.fee_rounded_count),
      );
      if (row !== null) rows.push(row);
    }
  }
  return { success: true, data: { rows, checks: checked.checks, unsupported, warnings } };
}
