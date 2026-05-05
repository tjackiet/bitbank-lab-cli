// 100行超: paper の成行 fill ロジック（バリデーション → ticker 取得 →
// 残高更新 → state 永続化 → 履歴追記）を直線的に表現するため許容。
import { z } from "zod";
import type { HttpOptions } from "../../http.js";
import {
  DEFAULT_TAKER_FEE_RATE,
  type PaperState,
  defaultStatePath,
  genId,
  loadState,
  nowIso,
  saveState,
} from "../../paper-state.js";
import type { Result } from "../../types.js";
import { PairSchema, PositiveDecimalSchema } from "../../validators.js";
import { ticker } from "../public/ticker.js";

const InputSchema = z.object({
  pair: PairSchema,
  side: z.enum(["buy", "sell"]),
  type: z.literal("market"),
  amount: PositiveDecimalSchema,
});

export type PaperCreateOrderArgs = {
  pair?: string;
  side?: string;
  type?: string;
  amount?: string;
  feeRate?: number;
  statePath?: string;
};

export type PaperFill = {
  id: string;
  pair: string;
  side: "buy" | "sell";
  type: "market";
  amount: number;
  fillPrice: number;
  feeJpy: number;
  filledAt: string;
  balances: Record<string, number>;
};

export async function paperCreateOrder(
  args: PaperCreateOrderArgs,
  opts?: HttpOptions,
): Promise<Result<PaperFill>> {
  const parsed = InputSchema.safeParse({
    pair: args.pair,
    side: args.side,
    type: args.type,
    amount: args.amount,
  });
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues.map((i) => i.message).join("; ") };
  }
  const path = args.statePath ?? defaultStatePath();
  const sr = await loadState(path);
  if (!sr.success) return sr;
  if (!sr.data) {
    return {
      success: false,
      error: "paper state not initialized. Run 'bitbank paper init --jpy=<amount>' first.",
    };
  }
  const t = await ticker({ pair: parsed.data.pair }, opts);
  if (!t.success) return t;
  if (!t.data.last) return { success: false, error: "ticker has no last price" };
  const last = Number(t.data.last);
  if (!Number.isFinite(last) || last <= 0) {
    return { success: false, error: "ticker last price is not a positive finite number" };
  }
  const amount = Number(parsed.data.amount);
  const feeRate = args.feeRate ?? DEFAULT_TAKER_FEE_RATE;
  const [base, quote] = parsed.data.pair.split("_");
  const notional = amount * last;
  const feeJpy = notional * feeRate;
  const balances = { ...sr.data.balances };
  if (parsed.data.side === "buy") {
    const cost = notional + feeJpy;
    if ((balances[quote] ?? 0) < cost) {
      return {
        success: false,
        error: `insufficient ${quote}: need ${cost}, have ${balances[quote] ?? 0}`,
      };
    }
    balances[quote] = (balances[quote] ?? 0) - cost;
    balances[base] = (balances[base] ?? 0) + amount;
  } else {
    if ((balances[base] ?? 0) < amount) {
      return {
        success: false,
        error: `insufficient ${base}: need ${amount}, have ${balances[base] ?? 0}`,
      };
    }
    balances[base] = (balances[base] ?? 0) - amount;
    balances[quote] = (balances[quote] ?? 0) + (notional - feeJpy);
  }
  const filledAt = nowIso();
  const id = genId();
  const fill: PaperFill = {
    id,
    pair: parsed.data.pair,
    side: parsed.data.side,
    type: "market",
    amount,
    fillPrice: last,
    feeJpy,
    filledAt,
    balances,
  };
  const newState: PaperState = {
    ...sr.data,
    updatedAt: filledAt,
    balances,
    history: [
      ...sr.data.history,
      {
        id,
        pair: fill.pair,
        side: fill.side,
        type: "market",
        amount,
        fillPrice: last,
        feeJpy,
        filledAt,
      },
    ],
  };
  const w = await saveState(newState, path);
  if (!w.success) return w;
  return { success: true, data: fill };
}
