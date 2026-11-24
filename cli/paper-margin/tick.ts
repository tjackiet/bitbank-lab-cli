// paper の lazy tick の、信用の state 更新（ADR-010 / docs/dev/paper-margin-plan.md §3.5・§3.6）。純関数。
// runTick の updateState（lock 内）から呼ぶ。足・pairs の取得は lock の外（cli/paper-margin-tick.ts）。
// - 現物の約定を反映した後の state に scan.ts を回し、建玉・注文・追証・JPY を書き戻す
// - 指値の約定と強制決済の決済は margin.history に積む（history.ts）
// - この tick で現物の売りが約定し、追証が残っていれば、窓の終わりの足で解消を判定する。
//   差入方法の「現物の売却」にあたるが、売りの約定時刻までは再現しない近似（解消は実際より遅れる側）
import type { Candle } from "../commands/public/candles-fetch.js";
import type { PaperState } from "../paper-state.js";
import type { Result } from "../types.js";
import { bookOf, withBook } from "./book.js";
import { historyOfFill, historyOfLosscut, type MarginHistoryEntry } from "./history.js";
import type { PriceRange } from "./losscut.js";
import { resolvesAfterSpotSale } from "./margin-call.js";
import type { MarginPairParams } from "./params.js";
import { scanMargin } from "./scan.js";
import type { MarginBook } from "./state.js";

export type MarginTickInput = {
  candlesByPair: Map<string, Candle[]>;
  params: Map<string, MarginPairParams>;
  /** 足を拾い始める時刻（足の区切りに揃えた前回 tick） */
  candleFromMs: number;
  /** 24h を超える区間を 4hour 足で見たか */
  approximate: boolean;
};

export type MarginTickEvent =
  | { kind: "margin-call"; at: string; deadline: string; amount: number }
  | { kind: "margin-call-resolved"; at: string }
  | { kind: "losscut"; at: string; reason: "below-losscut" | "margin-call-expired" };

export type MarginTickReport = {
  filled: MarginHistoryEntry[];
  events: MarginTickEvent[];
  approximate: boolean;
};

export function applyMarginTick(
  state: PaperState,
  input: MarginTickInput,
  nowMs: number,
  opts: { spotSold: boolean; newId: () => string },
): Result<{ state: PaperState; report: MarginTickReport }> {
  const scan = scanMargin({
    book: bookOf(state),
    candlesByPair: input.candlesByPair,
    params: input.params,
    rules: state.margin.assumptions.rules,
    fromMs: Math.min(Date.parse(state.lastTickAt), nowMs),
    toMs: nowMs,
    candleFromMs: input.candleFromMs,
  });
  if (!scan.success) return scan;
  const filled: MarginHistoryEntry[] = [];
  const events: MarginTickEvent[] = [];
  for (const e of scan.data.events) {
    if (e.kind === "fill") filled.push(historyOfFill(e));
    else if (e.kind === "margin-call") {
      events.push({
        kind: e.kind,
        at: e.call.judgedAt,
        deadline: e.call.deadline,
        amount: e.call.amount,
      });
    } else if (e.kind === "losscut") {
      for (const c of e.closes) filled.push(historyOfLosscut(c, opts.newId(), e.at));
      events.push({ kind: e.kind, at: e.at, reason: e.reason });
    } else events.push(e);
  }
  let book = scan.data.book;
  if (
    book.call &&
    opts.spotSold &&
    resolvesAfterSpotSale(book, lastRanges(book, input), input.params)
  ) {
    book = { ...book, call: null };
    events.push({ kind: "margin-call-resolved", at: new Date(nowMs).toISOString() });
  }
  const next = withBook(state, book);
  const margin = { ...next.margin, history: [...next.margin.history, ...filled] };
  return {
    success: true,
    data: {
      state: { ...next, margin },
      report: { filled, events, approximate: input.approximate },
    },
  };
}

/** 建玉のあるペアの、窓の最後の足の安値・高値 */
function lastRanges(book: MarginBook, input: MarginTickInput): Map<string, PriceRange> {
  const out = new Map<string, PriceRange>();
  for (const p of book.positions) {
    const last = (input.candlesByPair.get(p.pair) ?? []).at(-1);
    if (last) out.set(p.pair, { low: last.low, high: last.high });
  }
  return out;
}
