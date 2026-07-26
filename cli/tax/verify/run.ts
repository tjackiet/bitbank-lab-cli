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
import type { Market } from "../reconcile/run.js";
import { verifyDisclaimers } from "../report/disclaimers.js";
import type { VerifyReport } from "../schema/verify.js";
import { aggregateForReport } from "./aggregate.js";
import { compareAnnualReport } from "./annual-report.js";

export type VerifyArgs = {
  year: number;
  report: ParsedAnnualReport;
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
  const compared = compareAnnualReport(args.report, aggregateForReport(events));
  if (!compared.success) return compared;

  const warnings = [...compared.data.warnings, ...collected.data.warnings];
  if (collected.data.truncated) {
    // 打ち切られていれば API 側が一様に少なくなる。その差を販売所ぶんと読んではいけない
    warnings.push("履歴がページ上限で打ち切られています。差は取込漏れを含みます（--max-pages）");
  }

  const data: VerifyReport = {
    year_jst: args.year,
    source: {
      csv_rows: args.report.rows.length,
      events: events.length,
      pending: collected.data.pending.length,
      truncated: collected.data.truncated,
    },
    rows: compared.data.rows,
    report_checks: compared.data.checks,
    unsupported: compared.data.unsupported,
    unknown_columns: args.report.unknownColumns,
    warnings,
    disclaimers: verifyDisclaimers(),
  };
  return collected.partial
    ? { success: true, data, partial: true, meta: collected.meta }
    : { success: true, data };
}
