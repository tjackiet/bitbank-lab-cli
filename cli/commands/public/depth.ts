import { z } from "zod";
import { type HttpOptions, publicGet } from "../../http.js";
import { parseResponse } from "../../parse-response.js";
import { numStr } from "../../schema-helpers.js";
import type { Result } from "../../types.js";
import { MSG_PAIR_DEPTH, validatePair } from "../../validators.js";

// raw /depth は asks/bids/timestamp に加えて成行量・板外集計・sequenceId も返す。
// 数量系と sequenceId はすべて文字列（"0" 既定で null は来ない）なので numStr で正規化する。
const DepthSchema = z.object({
  asks: z.array(z.tuple([numStr, numStr])),
  bids: z.array(z.tuple([numStr, numStr])),
  asks_over: numStr,
  asks_under: numStr,
  bids_over: numStr,
  bids_under: numStr,
  ask_market: numStr,
  bid_market: numStr,
  timestamp: z.number(),
  sequenceId: numStr,
});

export type Depth = z.infer<typeof DepthSchema>;

export async function depth(
  args: { pair: string | undefined },
  opts?: HttpOptions,
): Promise<Result<Depth>> {
  const v = validatePair(args.pair, MSG_PAIR_DEPTH);
  if (!v.success) return v;
  const result = await publicGet<unknown>(`/${v.data}/depth`, opts);
  return parseResponse(result, DepthSchema);
}
