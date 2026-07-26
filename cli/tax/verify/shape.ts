// 突合結果を VerifyReport の形に組み立てる。run.ts は「収集 → 突合」に専念させる。
import type { Collected } from "../import/collect.js";
import type { ParsedAnnualReport } from "../import-csv/annual-report.js";
import type { ParsedMarginReport } from "../import-csv/margin-report.js";
import { verifyDisclaimers } from "../report/disclaimers.js";
import type { VerifyReport } from "../schema/verify.js";
import type { VerifyOutcome } from "./annual-report.js";
import type { MarginOutcome } from "./margin-report.js";

export type ShapeArgs = {
  year: number;
  report?: ParsedAnnualReport;
  marginReport?: ParsedMarginReport;
  events: number;
  collected: Collected;
  spot?: VerifyOutcome;
  margin?: MarginOutcome;
};

export function shapeVerifyReport(args: ShapeArgs, warnings: string[]): VerifyReport {
  return {
    year_jst: args.year,
    source: {
      csv_rows: args.report?.rows.length ?? 0,
      margin_csv_rows: args.marginReport?.rows.length ?? 0,
      events: args.events,
      pending: args.collected.pending.length,
      truncated: args.collected.truncated,
    },
    rows: [...(args.spot?.rows ?? []), ...(args.margin?.rows ?? [])],
    report_checks: args.spot?.checks ?? [],
    unsupported: [...(args.spot?.unsupported ?? []), ...(args.margin?.unsupported ?? [])],
    unknown_columns: [
      ...(args.report?.unknownColumns ?? []),
      ...(args.marginReport?.unknownColumns ?? []),
    ],
    warnings,
    disclaimers: verifyDisclaimers(),
  };
}
