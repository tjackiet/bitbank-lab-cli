// レポート出力型（v2 §1.2 の「ガード成立時のみ参考損益」を型で表す）。
// `reference` が optional なのが本質: **ガードが通らない銘柄では欄そのものが存在しない**。
// 0 や null を入れると「損益ゼロ」と読めてしまうため、欄を出さないことで区別する。
import { z } from "zod";
import { Method } from "./method.js";
import { decStr } from "./primitives.js";

/** 取引集計。ガードの成否に関係なく常に出す（年間取引報告書相当のデータ）。 */
export const CurrencySummary = z.object({
  acquired_qty: decStr,
  acquired_cost_jpy: decStr,
  disposed_qty: decStr,
  proceeds_jpy: decStr,
  income_jpy: decStr, // リベート収入・信用差益（銘柄別・JPY）
  expense_jpy: decStr, // 売却手数料・信用差損（銘柄別・JPY）
});

/** 参考損益。ガード(a)〜(d) がすべて成立した銘柄にだけ付く。 */
export const ReferencePnl = z.object({
  unit_price_jpy: decStr,
  cogs_jpy: decStr,
  closing_qty: decStr,
  closing_cost_jpy: decStr,
  revenue_total_jpy: decStr,
  expense_total_jpy: decStr,
  reference_pnl_jpy: decStr, // 負値のまま出す（max(0,·) に丸めない。v2 §9）
});

export const CurrencyReport = z.object({
  currency: z.string(),
  method: Method,
  summary: CurrencySummary,
  reference: ReferencePnl.optional(),
  blocked_by: z.array(z.string()),
  warnings: z.array(z.string()),
  policy_ids: z.array(z.string()),
});

export const ReconciliationRow = z.object({
  currency: z.string(),
  theoretical: decStr,
  actual: decStr,
  residual: decStr,
  within_dust: z.boolean(),
  diagnosis: z.string(),
  hint: z.string(),
});

export const TaxReport = z.object({
  year_jst: z.number().int(),
  method: Method,
  attested: z.boolean(),
  source: z.object({
    events: z.number().int(),
    pending: z.number().int(),
    deferred: z.number().int(),
    deduped: z.number().int(),
    truncated: z.boolean(),
  }),
  currencies: z.array(CurrencyReport),
  reconciliation: z.array(ReconciliationRow),
  /** 取り込めなかった行（NFR 堅牢性: 未知は警告して保留リストへ） */
  pending: z.array(z.object({ source_ref: z.string(), reason: z.string() })),
  warnings: z.array(z.string()),
  disclaimers: z.array(z.string()),
});

export type CurrencySummary = z.infer<typeof CurrencySummary>;
export type ReferencePnl = z.infer<typeof ReferencePnl>;
export type CurrencyReport = z.infer<typeof CurrencyReport>;
export type ReconciliationRow = z.infer<typeof ReconciliationRow>;
export type TaxReport = z.infer<typeof TaxReport>;
