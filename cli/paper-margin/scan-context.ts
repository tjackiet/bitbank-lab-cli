// scan.ts / scan-step.ts が共有する文脈と、足の不利な極値での口座評価（ADR-010 決定 4）。
import type { Candle } from "../commands/public/candles-fetch.js";
import type { Result } from "../types.js";
import { evaluateAccount, type MarginAccount } from "./account.js";
import type { MarginRules } from "./assumptions.js";
import type { MarginFillEvent } from "./fills.js";
import type { InterestCharge } from "./interest.js";
import { type LosscutClose, type PriceRange, worstPrices } from "./losscut.js";
import type { MarginPairParams } from "./params.js";
import type { PriceTrack } from "./scan-prices.js";
import type { MarginBook, MarginCall, MarginOrder } from "./state.js";

export type ScanEvent =
  | ({ kind: "fill" } & MarginFillEvent)
  | { kind: "margin-call"; call: MarginCall }
  | { kind: "margin-call-resolved"; at: string }
  | {
      kind: "losscut";
      at: string;
      reason: "below-losscut" | "margin-call-expired";
      closes: LosscutClose[];
      canceled: MarginOrder[];
    };

export type ScanInput = {
  book: MarginBook;
  candlesByPair: ReadonlyMap<string, readonly Candle[]>;
  params: ReadonlyMap<string, MarginPairParams>;
  rules: MarginRules;
  /** 前回 tick の時刻。この時刻の足から見る */
  fromMs: number;
  toMs: number;
};

/** 走査中に積み上げる結果（events / interest）と、入力・価格への参照 */
export type ScanContext = {
  input: ScanInput;
  track: PriceTrack;
  events: ScanEvent[];
  interest: InterestCharge[];
};

export function rangesAt(ctx: ScanContext, book: MarginBook, t: number): Map<string, PriceRange> {
  return new Map(book.positions.map((p) => [p.pair, ctx.track.rangeAt(p.pair, t)] as const));
}

/** 足の不利な極値（losscut.ts の worstPrices）で評価した口座 */
export function accountAt(ctx: ScanContext, book: MarginBook, t: number): Result<MarginAccount> {
  const prices = worstPrices(book.positions, rangesAt(ctx, book, t));
  if (!prices.success) return prices;
  return evaluateAccount({
    jpy: book.jpy,
    positions: book.positions,
    openOrders: book.orders,
    riskRatio: (pair) => ctx.input.params.get(pair)?.riskRatio,
    price: (pair) => prices.data.get(pair),
  });
}
