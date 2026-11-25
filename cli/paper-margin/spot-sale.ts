// 追証の解消の行為としての現物の売却（ADR-010 決定 4 / docs/dev/paper-margin-plan.md §3.6）。純関数。
// 公表ルールの差入方法の「現物の売却」: JPY 建ての現物を売って JPY（差入保証金）が増えた直後に B ≥ Mm なら解消する。
// 価格の回復だけでは解消しないので、売りの「後」でなければ数えない。JPY 以外のペアの売りは JPY が増えないので数えない。
// - lazy tick で約定した指値の売り（tick.ts）: 追証の基準時以降に約定した売りがあれば、窓の最後の足の不利な極値で判定する
//   （売りの約定時刻までは再現しない近似。解消は実際より遅れる側）
// - 成行の売り（paper create-order）: 売った後の口座を現在値（ticker の last）で判定する。信用の状態が now まで
//   走査済みで、期限前のときだけ（古い状態で解消すると、期限切れで強制決済されるはずの追証を消してしまう）
import type { Candle } from "../commands/public/candles-fetch.js";
import type { PaperState } from "../paper-state.js";
import { bookOf, isMarginStale, withBook } from "./book.js";
import type { PriceRange } from "./losscut.js";
import { isMarginCallExpired, resolvesAfterAction } from "./margin-call.js";
import type { MarginPairParams } from "./params.js";
import type { MarginBook, MarginCall } from "./state.js";

/** 約定した現物（tick の約定・成行の約定） */
export type SpotFill = { pair: string; side: "buy" | "sell"; filledAt: string };

const raisesJpy = (f: Pick<SpotFill, "pair" | "side">) =>
  f.side === "sell" && f.pair.endsWith("_jpy");

/** 追証の基準時以降に、JPY 建ての現物の売りが約定したか */
export function soldSpotForJpySince(fills: readonly SpotFill[], call: MarginCall): boolean {
  const judgedAt = Date.parse(call.judgedAt);
  return fills.some((f) => raisesJpy(f) && Date.parse(f.filledAt) >= judgedAt);
}

/** 建玉のあるペアの、窓の最後の足の安値・高値 */
export function lastRanges(
  book: MarginBook,
  candlesByPair: ReadonlyMap<string, readonly Candle[]>,
): Map<string, PriceRange> {
  const out = new Map<string, PriceRange>();
  for (const p of book.positions) {
    const last = (candlesByPair.get(p.pair) ?? []).at(-1);
    if (last) out.set(p.pair, { low: last.low, high: last.high });
  }
  return out;
}

/** 成行の現物の売りを反映した後の state で、追証が解けたか判定し、解けていれば消す */
export function resolveCallAfterSpotSale(
  state: PaperState,
  sale: Pick<SpotFill, "pair" | "side">,
  ctx: {
    params: ReadonlyMap<string, Pick<MarginPairParams, "riskRatio">>;
    prices: ReadonlyMap<string, number>;
    nowMs: number;
  },
): { state: PaperState; resolved: boolean } {
  const call = state.margin.call;
  if (!call || !raisesJpy(sale)) return { state, resolved: false };
  if (isMarginStale(state, ctx.nowMs) || isMarginCallExpired(call, ctx.nowMs)) {
    return { state, resolved: false };
  }
  const ranges = new Map(
    [...ctx.prices].map(([pair, px]) => [pair, { low: px, high: px }] as const),
  );
  const book = bookOf(state);
  if (!resolvesAfterAction(book, ranges, ctx.params)) return { state, resolved: false };
  return { state: withBook(state, { ...book, call: null }), resolved: true };
}
