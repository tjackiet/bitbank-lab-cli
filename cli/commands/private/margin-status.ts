import { z } from "zod";
import { type PrivateHttpOptions, privateGet } from "../../http-private.js";
import { parseResponse } from "../../parse-response.js";
import { nullableNumStr, numStr } from "../../schema-helpers.js";
import type { Result } from "../../types.js";

const MarginStatusSchema = z.object({
  status: z.string(),
  total_margin_balance: numStr,
  total_margin_balance_percentage: nullableNumStr,
  margin_position_profit_loss: numStr,
  margin_call_percentage: nullableNumStr,
  losscut_percentage: nullableNumStr,
  buy_credit: numStr,
  sell_credit: numStr,
});

export type MarginStatus = z.infer<typeof MarginStatusSchema>;

export async function marginStatus(opts?: PrivateHttpOptions): Promise<Result<MarginStatus>> {
  const result = await privateGet<unknown>("/user/margin/status", undefined, opts);
  return parseResponse(result, MarginStatusSchema);
}
