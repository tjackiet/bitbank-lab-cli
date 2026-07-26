// `bitbank tax reconcile` — 理論残高と /user/assets の突合（ガード(d) / P-17）。
//
// **判定ではなく検出**。閾値外でもコマンドは成功で返し、残差の量と符号を報告する。
// 実口座では販売所取引が API に現れないため「全資産で残差ゼロ」は成立しない
// （UI CSV 取込は P0-6）。ここで残差が出ること自体が取込漏れの検出手段になっている。
import type { PrivateHttpOptions } from "../../http-private.js";
import { DUST_THRESHOLD } from "../../tax/reconcile/compare.js";
import { runReconcile } from "../../tax/reconcile/run.js";
import type { ReconciliationRow } from "../../tax/schema/report.js";
import type { Result } from "../../types.js";
import { parseMaxPages } from "../private/input-schemas.js";
import { resolveMarket } from "./market.js";

const MAX_PAGES_DEFAULT = 1000;

export type TaxReconcileArgs = { maxPages?: string };

export type TaxReconcileData = {
  dust_threshold: string;
  rows: ReconciliationRow[];
  /** 突合不能（非 JPY クォートを含む）資産 */
  unreconcilable: string[];
  problems: string[];
  warnings: string[];
  counts: { events: number; pending: number };
};

export async function taxReconcile(
  args: TaxReconcileArgs,
  opts?: PrivateHttpOptions,
): Promise<Result<TaxReconcileData>> {
  const mp = parseMaxPages(args.maxPages, MAX_PAGES_DEFAULT);
  if (!mp.success) return mp;

  const market = await resolveMarket(opts);
  if (!market.success) return market;

  const r = await runReconcile(market.data, { maxPages: mp.data }, opts);
  if (!r.success) return r;

  const data: TaxReconcileData = {
    dust_threshold: DUST_THRESHOLD,
    rows: r.data.comparisons.map((c) => ({
      currency: c.currency,
      theoretical: c.theoretical,
      actual: c.actual,
      residual: c.residual,
      within_dust: c.withinDust,
      diagnosis: c.diagnosis,
      hint: c.hint,
    })),
    unreconcilable: [...r.data.rebuilt.unreconcilable].sort(),
    problems: r.data.rebuilt.problems,
    warnings: r.data.collected.warnings,
    counts: { events: r.data.collected.events.length, pending: r.data.collected.pending.length },
  };
  return r.partial ? { success: true, data, partial: true, meta: r.meta } : { success: true, data };
}
