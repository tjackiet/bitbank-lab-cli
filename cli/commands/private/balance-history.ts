// `bitbank balance-history` — JPY 建て資産推移の再構築（private GET のみ・読み取り専用）。
//
// 「現在の保有量 × 過去の価格」ではなく、**現在の残高から約定・入出金を逆算して**各時点の
// 保有を復元する。積み立て口座では前者が実残高から大きく乖離し、実機確認 #14 の追試で
// 口座の持ち主が「資産が半減した」と誤認しかけた。計算本体は cli/portfolio/。
import { EXIT } from "../../exit-codes.js";
import type { PrivateHttpOptions } from "../../http-private.js";
import { GRANULARITIES, type Granularity } from "../../portfolio/grid.js";
import { runBalanceHistory } from "../../portfolio/run.js";
import type { BalanceHistory } from "../../portfolio/schema.js";
import type { Result } from "../../types.js";
import { formatZodError } from "../../validators.js";
import { parseMaxPages, TimestampMsSchema } from "./input-schemas.js";

/** 履歴取得は「ペア数 + 資産数」ぶんの private GET を逐次で回すため、既定は短めの窓にする。 */
const DEFAULT_DAYS = 30;
const MAX_PAGES_DEFAULT = 1000;
const DAY_MS = 86_400_000;

export type BalanceHistoryArgs = {
  since?: string;
  days?: string;
  granularity?: string;
  maxPages?: string;
  noCache?: boolean;
};

export type BalanceHistoryData = BalanceHistory;

function parseDays(v: string | undefined): Result<number> {
  if (v === undefined) return { success: true, data: DEFAULT_DAYS };
  if (!/^[1-9]\d*$/.test(v)) {
    return { success: false, error: "--days must be a positive integer", exitCode: EXIT.PARAM };
  }
  return { success: true, data: Number(v) };
}

function parseGranularity(v: string | undefined): Result<Granularity> {
  if (v === undefined) return { success: true, data: "day" };
  if (!(GRANULARITIES as readonly string[]).includes(v)) {
    return {
      success: false,
      error: `Invalid --granularity "${v}". Valid: ${GRANULARITIES.join(", ")}`,
      exitCode: EXIT.PARAM,
    };
  }
  return { success: true, data: v as Granularity };
}

/** --since（Unix ms）を優先し、無ければ --days 遡る。両方指定は PARAM エラー。 */
function resolveSince(args: BalanceHistoryArgs, nowMs: number): Result<number> {
  if (args.since !== undefined && args.days !== undefined) {
    return {
      success: false,
      error: "--since cannot be combined with --days",
      exitCode: EXIT.PARAM,
    };
  }
  if (args.since !== undefined) {
    const parsed = TimestampMsSchema.safeParse(args.since);
    if (!parsed.success) {
      return { success: false, error: formatZodError(parsed.error), exitCode: EXIT.PARAM };
    }
    return { success: true, data: Number(parsed.data) };
  }
  const days = parseDays(args.days);
  if (!days.success) return days;
  return { success: true, data: nowMs - days.data * DAY_MS };
}

export async function balanceHistory(
  args: BalanceHistoryArgs,
  opts?: PrivateHttpOptions,
): Promise<Result<BalanceHistoryData>> {
  const nowMs = Date.now();
  const since = resolveSince(args, nowMs);
  if (!since.success) return since;
  const granularity = parseGranularity(args.granularity);
  if (!granularity.success) return granularity;
  const mp = parseMaxPages(args.maxPages, MAX_PAGES_DEFAULT);
  if (!mp.success) return mp;

  return runBalanceHistory(
    {
      sinceMs: since.data,
      nowMs,
      granularity: granularity.data,
      maxPages: mp.data,
      noCache: args.noCache === true,
    },
    opts,
  );
}
