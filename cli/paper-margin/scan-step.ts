// scan.ts の 1 時刻ぶんの処理（ADR-010 決定 4・7 / docs/dev/paper-margin-plan.md §3.5・§3.6）。
//   1. その時刻までの利息を積む → 2. 新規建ての指値の約定 → 3. JST 15 時なら追証を判定 →
//   4. 追証の期限切れか強制決済の判定基準で強制決済 → 5. 返済の指値の約定（約定後に追証が解ければ解消）
// 同じ足の中での前後は分からないので、強制決済が早く起きる順にしている（新規建てで建玉が増えてから判定し、
// 返済で建玉が減るのは判定の後）。
import { marginOperation } from "../margin-operation.js";
import type { Result } from "../types.js";
import { isLosscutCondition } from "./conditions.js";
import { applyOrderFill, orderHits } from "./fills.js";
import { accrueInterest } from "./interest.js";
import { executeLosscut, worstPrices } from "./losscut.js";
import { isMarginCallExpired, judgeMarginCall, resolvesMarginCall } from "./margin-call.js";
import { accountAt, rangesAt, type ScanContext } from "./scan-context.js";
import type { MarginBook } from "./state.js";

export function step(
  ctx: ScanContext,
  start: MarginBook,
  t: number,
  isCallTime: boolean,
): Result<MarginBook> {
  const accrued = accrueInterest(start.positions, ctx.input.params, t);
  if (!accrued.success) return accrued;
  ctx.interest.push(...accrued.data.charges);
  const opened = fillOrders(ctx, { ...start, positions: accrued.data.positions }, t, "open");
  if (!opened.success) return opened;
  let book = opened.data;
  if (book.positions.length === 0) return { success: true, data: book };
  if (isCallTime && !book.call) {
    const acc = accountAt(ctx, book, t);
    if (!acc.success) return acc;
    const call = judgeMarginCall(acc.data, t, ctx.input.rules);
    if (call) {
      book = { ...book, call };
      ctx.events.push({ kind: "margin-call", call });
    }
  }
  const expired = book.call !== null && isMarginCallExpired(book.call, t);
  const acc = accountAt(ctx, book, t);
  if (!acc.success) return acc;
  if (expired || isLosscutCondition(acc.data, ctx.input.rules.losscutMultiplier)) {
    return losscut(ctx, book, t, expired ? "margin-call-expired" : "below-losscut");
  }
  return fillOrders(ctx, book, t, "close");
}

function losscut(
  ctx: ScanContext,
  book: MarginBook,
  t: number,
  reason: "below-losscut" | "margin-call-expired",
): Result<MarginBook> {
  const at = new Date(t).toISOString();
  const prices = worstPrices(book.positions, rangesAt(ctx, book, t));
  if (!prices.success) return prices;
  const closeTaker = (pair: string) => ctx.input.params.get(pair)?.fee.closeTaker;
  const r = executeLosscut(book, prices.data, closeTaker, at);
  if (!r.success) return r;
  ctx.events.push({
    kind: "losscut",
    at,
    reason,
    closes: r.data.closes,
    canceled: r.data.canceled,
  });
  return { success: true, data: r.data.book };
}

/** その時刻に足のあるペアで、指値に触れた intent の注文を約定させる。返済で追証が解ければ解消する */
function fillOrders(
  ctx: ScanContext,
  start: MarginBook,
  t: number,
  intent: "open" | "close",
): Result<MarginBook> {
  let book = start;
  const at = new Date(t).toISOString();
  for (const o of start.orders) {
    if (marginOperation(o.side, o.positionSide).intent !== intent) continue;
    const candle = ctx.track.candleAt(o.pair, t);
    if (Date.parse(o.createdAt) > t || !candle || !orderHits(o, candle)) continue;
    const params = ctx.input.params.get(o.pair);
    if (!params) return { success: false, error: `margin scan: no margin params for ${o.pair}` };
    const r = applyOrderFill(book, o, params.fee, at);
    if (!r.success) return r;
    book = r.data.book;
    ctx.events.push({ kind: "fill", ...r.data.event });
    if (intent === "close" && book.call) {
      const acc = accountAt(ctx, book, t);
      if (!acc.success) return acc;
      if (resolvesMarginCall(acc.data)) {
        book = { ...book, call: null };
        ctx.events.push({ kind: "margin-call-resolved", at });
      }
    }
  }
  return { success: true, data: book };
}
