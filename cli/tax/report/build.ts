// レポート組み立て（v2 §1.2）。取引集計は常に出し、参考損益はガード成立時だけ付ける。
import type { CurrencyResult } from "../engine/run.js";
import type { GuardInput } from "../guard/reference-pnl.js";
import type { Collected } from "../import/collect.js";
import type { LedgerResult } from "../ledger/from-events.js";
import type { AssetComparison } from "../reconcile/compare.js";
import type { Method } from "../schema/method.js";
import type { ReconciliationRow, TaxReport } from "../schema/report.js";
import type { Taxation } from "../schema/taxation.js";
import { currencyReport } from "./currency.js";
import { disclaimers } from "./disclaimers.js";

export type BuildArgs = {
  year: number;
  method: Method;
  taxation: Taxation;
  attested: boolean;
  collected: Collected;
  ledger: LedgerResult;
  results: Map<string, CurrencyResult>;
  reconciliation: readonly AssetComparison[];
};

function toRow(c: AssetComparison): ReconciliationRow {
  return {
    currency: c.currency,
    theoretical: c.theoretical,
    actual: c.actual,
    residual: c.residual,
    dust: c.dust,
    within_dust: c.withinDust,
    diagnosis: c.diagnosis,
    hint: c.hint,
  };
}

export function buildReport(args: BuildArgs): TaxReport {
  const guardInput: GuardInput = {
    attested: args.attested,
    events: args.collected.events,
    results: args.results,
    reconciliation: args.reconciliation,
    deferred: args.ledger.deferred,
  };
  const currencies = [...args.results.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([currency, result]) => currencyReport(currency, result, args.ledger, guardInput));

  return {
    year_jst: args.year,
    method: args.method,
    taxation: args.taxation,
    attested: args.attested,
    source: {
      events: args.collected.events.length,
      pending: args.collected.pending.length,
      deferred: args.ledger.deferred.length,
      deduped: args.collected.counts.deduped,
      truncated: args.collected.truncated,
    },
    currencies,
    reconciliation: args.reconciliation.map(toRow),
    pending: args.collected.pending,
    warnings: args.collected.warnings,
    disclaimers: disclaimers(args.taxation, args.year),
  };
}
