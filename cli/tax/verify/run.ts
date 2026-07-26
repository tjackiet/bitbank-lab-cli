// 年間取引報告書突合の実行（当年イベント収集 → 集計 → 突合）。
// 残高突合（reconcile）と違って**全履歴を必要としない**。報告書は年単位で閉じており、
// 比較対象も当年フローだけなので、収集は年ウィンドウで済む。
//
// CSV は**コマンド層で読んでから**渡す。壊れた CSV で API を叩いてから落ちると、
// 認証・レート制限だけ消費して何も得られない。
import type { PrivateHttpOptions } from "../../http-private.js";
import type { Result } from "../../types.js";
import { collectEvents } from "../import/collect.js";
import type { ParsedAnnualReport } from "../import-csv/annual-report.js";
import type { ParsedMarginReport } from "../import-csv/margin-report.js";
import type { Market } from "../reconcile/run.js";
import { verifyDisclaimers } from "../report/disclaimers.js";
import type { VerifyReport } from "../schema/verify.js";
import { aggregateForReport } from "./aggregate.js";
import { compareAnnualReport } from "./annual-report.js";
import { aggregateMarginForReport } from "./margin-aggregate.js";
import { compareMarginReport } from "./margin-report.js";

export type VerifyArgs = {
  year: number;
  /** 現物の年間取引報告書。信用だけ突合したいときは省略できる */
  report?: ParsedAnnualReport;
  /** 信用の年間取引報告書（別様式・別ファイル） */
  marginReport?: ParsedMarginReport;
  since?: string;
  end?: string;
  maxPages?: number;
};

export async function runVerifyReport(
  args: VerifyArgs,
  market: Market,
  opts?: PrivateHttpOptions,
): Promise<Result<VerifyReport>> {
  const collected = await collectEvents(
    {
      pairs: market.pairs,
      assets: market.assets,
      since: args.since,
      end: args.end,
      maxPages: args.maxPages,
    },
    opts,
  );
  if (!collected.success) return collected;

  // 範囲クエリの境界ではなく year_jst で年分を確定させる（ADR-004 の税務例外）
  const events = collected.data.events.filter((e) => e.year_jst === args.year);

  const spot =
    args.report === undefined
      ? undefined
      : compareAnnualReport(args.report, aggregateForReport(events));
  if (spot !== undefined && !spot.success) return spot;
  const margin =
    args.marginReport === undefined
      ? undefined
      : compareMarginReport(args.marginReport, aggregateMarginForReport(events));
  if (margin !== undefined && !margin.success) return margin;

  const spotData = spot?.success === true ? spot.data : undefined;
  const marginData = margin?.success === true ? margin.data : undefined;
  const warnings = [
    ...(spotData?.warnings ?? []),
    ...(marginData?.warnings ?? []),
    ...collected.data.warnings,
  ];
  if (collected.data.truncated) {
    // 打ち切られていれば API 側が一様に少なくなる。その差を販売所ぶんと読んではいけない
    warnings.push("履歴がページ上限で打ち切られています。差は取込漏れを含みます（--max-pages）");
  }

  const data: VerifyReport = {
    year_jst: args.year,
    source: {
      csv_rows: args.report?.rows.length ?? 0,
      margin_csv_rows: args.marginReport?.rows.length ?? 0,
      events: events.length,
      pending: collected.data.pending.length,
      truncated: collected.data.truncated,
    },
    rows: [...(spotData?.rows ?? []), ...(marginData?.rows ?? [])],
    report_checks: spotData?.checks ?? [],
    unsupported: [...(spotData?.unsupported ?? []), ...(marginData?.unsupported ?? [])],
    unknown_columns: [
      ...(args.report?.unknownColumns ?? []),
      ...(args.marginReport?.unknownColumns ?? []),
    ],
    warnings,
    disclaimers: verifyDisclaimers(),
  };
  return collected.partial
    ? { success: true, data, partial: true, meta: collected.meta }
    : { success: true, data };
}
