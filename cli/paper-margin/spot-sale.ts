// 追証の解消の行為としての現物の売却（ADR-010 決定 4 / docs/dev/paper-margin-plan.md §3.6）。純関数。
// 公表ルールの差入方法の「現物の売却」: JPY 建ての現物を売って JPY（差入保証金）が増えた直後に B ≥ Mm なら解消する。
// 価格の回復だけでは解消しないので、売りの「後」でなければ数えない。JPY 以外のペアの売りは JPY が増えないので数えない。
// - lazy tick で約定した指値の売り: 走査（scan-actions.ts の resolveBySpotSale）が、売りの約定時刻に、その時点の口座で判定する。
//   ここでは現物の約定履歴から、窓の中の売りの時刻と JPY の増減を組み立てるだけ（spotEventsSince）
// - 成行の売り（paper create-order）: 売った後の口座を現在値（ticker の last）で判定する。信用の状態が now まで
//   走査済みで、期限前のときだけ（古い状態で解消すると、期限切れで強制決済されるはずの追証を消してしまう）
import type { PaperHistoryEntry, PaperState } from "../paper-state.js";
import { bookOf, isMarginStale, withBook } from "./book.js";
import { isMarginCallExpired, resolvesAfterAction } from "./margin-call.js";
import type { MarginPairParams } from "./params.js";

/** 約定した現物の売買（JPY 建てかどうか・向き） */
type SpotSale = { pair: string; side: "buy" | "sell" };

const raisesJpy = (f: SpotSale) => f.side === "sell" && f.pair.endsWith("_jpy");

/** 信用の走査の窓（fromMs より後）に約定した現物の、JPY の増減と、指値の売りの約定時刻（scan.ts に渡す）。
 *  現物の約定履歴から導くので、信用の走査に失敗した tick で約定した分も、次に走査できた tick で数えられる。
 *  JPY の増減は約定履歴の値から組み立てる（代金と手数料の円への丸めの順で 1 円ずれることがある。評価の時刻をずらす
 *  ためだけに使い、残高そのものは変えない）。成行の売りは売った時点で判定済みなので、解消の行為には数えない */
export function spotEventsSince(
  history: readonly PaperHistoryEntry[],
  fromMs: number,
): { spotJpy: { atMs: number; delta: number }[]; spotSaleTimes: number[] } {
  const inWindow = history.filter(
    (h) => h.pair.endsWith("_jpy") && Date.parse(h.filledAt) > fromMs,
  );
  const spotJpy = inWindow.map((h) => {
    const notional = h.amount * h.fillPrice;
    const delta = h.side === "sell" ? notional - h.feeQuote : -(notional + h.feeQuote);
    return { atMs: Date.parse(h.filledAt), delta };
  });
  const spotSaleTimes = inWindow
    .filter((h) => h.type === "limit" && raisesJpy(h))
    .map((h) => Date.parse(h.filledAt));
  return { spotJpy, spotSaleTimes };
}

/** 成行の現物の売りを反映した後の state で、追証が解けたか判定し、解けていれば消す */
export function resolveCallAfterSpotSale(
  state: PaperState,
  sale: SpotSale,
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
