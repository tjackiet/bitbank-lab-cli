// 100行超: 全件ページング（後方 end 走査）と --all/--year ディスパッチャを同居させ、
// withdrawal-history(leaf) → all の循環依存を断つため。--year は JST 年分（ADR-004 の税務例外）。
// deposit-history-all.ts のミラー（差分: tsKey は requested_at、asset は必須）
import { z } from "zod";
import { jstYear, jstYearRangeMs } from "../../date-utils.js";
import { EXIT } from "../../exit-codes.js";
import type { PrivateHttpOptions } from "../../http-private.js";
import type { Result } from "../../types.js";
import { AssetSchema } from "../../validators.js";
import { formatZodError } from "./input-schemas.js";
import {
  type Withdrawal,
  type WithdrawalHistoryArgs,
  withdrawalHistory,
} from "./withdrawal-history.js";

const PAGE_SIZE = 1000;
export const MAX_PAGES_DEFAULT = 1000;

const MaxPagesSchema = z
  .string()
  .regex(/^[1-9]\d*$/, "max-pages must be a positive integer")
  .transform((s, ctx) => {
    const n = Number(s);
    if (!Number.isSafeInteger(n)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "max-pages must be a safe integer (≤ 2^53 - 1)",
      });
      return z.NEVER;
    }
    return n;
  });

const YearSchema = z.string().regex(/^\d{4}$/, "year must be 4 digits (YYYY, JST)");

type WithdrawalHistoryAllArgs = {
  asset: string | undefined;
  since?: string;
  end?: string;
  year?: string;
  maxPages?: string;
};

export async function withdrawalHistoryAll(
  args: WithdrawalHistoryAllArgs,
  opts?: PrivateHttpOptions,
): Promise<Result<Withdrawal[]>> {
  // withdrawal_history は asset 必須（deposit との差分）。ページングに入る前に検証する
  const av = AssetSchema.safeParse(args.asset);
  if (!av.success) return { success: false, error: formatZodError(av.error), exitCode: EXIT.PARAM };

  let maxPages = MAX_PAGES_DEFAULT;
  if (args.maxPages !== undefined) {
    const parsed = MaxPagesSchema.safeParse(args.maxPages);
    if (!parsed.success)
      return { success: false, error: formatZodError(parsed.error), exitCode: EXIT.PARAM };
    maxPages = parsed.data;
  }

  // --year（JST 年分）: 範囲クエリ + 取得後の厳密フィルタ。bitbank の end 境界の
  // 含む/排他が未確定なため、jstYear で年分を確定させる（ADR-004 の税務例外）。
  let since = args.since;
  let end = args.end;
  let filterYear: number | undefined;
  if (args.year !== undefined) {
    if (args.since !== undefined || args.end !== undefined) {
      return {
        success: false,
        error: "--year cannot be combined with --since/--end",
        exitCode: EXIT.PARAM,
      };
    }
    const parsed = YearSchema.safeParse(args.year);
    if (!parsed.success)
      return { success: false, error: formatZodError(parsed.error), exitCode: EXIT.PARAM };
    filterYear = Number(parsed.data);
    const range = jstYearRangeMs(filterYear);
    since = String(range.startMs);
    end = String(range.endMs);
  }

  const all: Withdrawal[] = [];
  const seen = new Set<string>();
  let truncated = true;
  for (let page = 0; page < maxPages; page++) {
    const result = await withdrawalHistory(
      { asset: av.data, count: String(PAGE_SIZE), since, end },
      opts,
    );
    if (!result.success) return result;
    let added = 0;
    for (const r of result.data) {
      if (!seen.has(r.uuid)) {
        seen.add(r.uuid);
        all.push(r);
        added++;
      }
    }
    if (result.data.length < PAGE_SIZE || added === 0) {
      truncated = false;
      break;
    }
    // 後方 end 走査: このページ最古の requested_at より前へ。dedup が境界重複を吸収する。
    end = String(Math.min(...result.data.map((r) => r.requested_at)));
  }

  all.sort((a, b) => a.requested_at - b.requested_at); // 時系列（税務台帳向け）
  const data =
    filterYear === undefined ? all : all.filter((r) => jstYear(r.requested_at) === filterYear);

  if (truncated) {
    return {
      success: true,
      data,
      partial: true,
      meta: { truncated: true, reason: "MAX_PAGES", returnedRows: data.length },
    };
  }
  return { success: true, data };
}

/** --all / --year を全件取得へ、それ以外を単一ページ取得へ振り分ける。 */
export async function withdrawalHistoryDispatch(
  args: WithdrawalHistoryArgs & { all?: boolean; year?: string; maxPages?: string },
  opts?: PrivateHttpOptions,
): Promise<Result<Withdrawal[]>> {
  if (args.all || args.year !== undefined) {
    return withdrawalHistoryAll(
      {
        asset: args.asset,
        since: args.since,
        end: args.end,
        year: args.year,
        maxPages: args.maxPages,
      },
      opts,
    );
  }
  return withdrawalHistory(args, opts);
}
