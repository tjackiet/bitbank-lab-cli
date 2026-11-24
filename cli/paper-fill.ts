// 100行超: paper の指値 fill 解決と、信用の走査を lock の内外のどこで回すか（取得は外・反映は内・
// lastTickAt を進める条件）を 1 ファイルで完結させる。計算本体は fees.ts / paper-margin/ に委譲。
// async な candles fetch と /spot/pairs（手数料）fetch は updateState の lock
// 外で済ませ、fresh state に対する fill の reconcile（sync）だけを lock 内で
// 実行する。指値は必ず maker なので約定手数料はペアのライブ maker_fee_rate_quote
// （負ならリベート）を resolveFeeRate で引く。
// テスト時は fetchCandles / getPairs / nowMs を注入し、本番用デフォルトは
// public candles / pairs API を叩く。
// 信用（ADR-010）の建玉・注文があれば、現物の約定を反映した後に信用の走査も回す。取得は lock の外
// （paper-margin-tick.ts）、state の更新は lock 内（paper-margin/tick.ts）。
import { type Candle, fetchOne } from "./commands/public/candles-fetch.js";
import { ymdUtc } from "./date-utils.js";
import { computeFill, resolveFeeRate } from "./fees.js";
import type { HttpOptions } from "./http.js";
import { type CachedPair, getPairsWithCache } from "./pairs-cache.js";
import { applyMarginTick, type MarginTickReport } from "./paper-margin/tick.js";
import { hasMarginBook, prepareMarginTick } from "./paper-margin-tick.js";
import {
  applyFillToBalances,
  defaultStatePath,
  genId,
  loadState,
  type OpenOrder,
  type PaperHistoryEntry,
  type PaperState,
} from "./paper-state.js";
import { updateState } from "./paper-state-mutate.js";
import type { Result } from "./types.js";

const ONE_MIN_MS = 60_000;
const MAX_LOOKBACK_MS = 24 * 60 * 60 * 1000;

export type FetchCandles = (
  pair: string,
  fromMs: number,
  toMs: number,
) => Promise<Result<Candle[]>>;

export type GetPairs = () => Promise<Result<CachedPair[]>>;

export type TickOptions = {
  statePath?: string;
  pair?: string;
  fetchCandles?: FetchCandles;
  getPairs?: GetPairs;
  nowMs?: number;
  feeRate?: number;
  httpOptions?: HttpOptions;
  /** 信用の走査で 24h を超える区間を見るときの 4hour 足の取得（テスト用の注入口） */
  fetchCoarseCandles?: FetchCandles;
};

export type TickResult = {
  filled: PaperHistoryEntry[];
  warnings: string[];
  lastTickAt: string;
  /** 信用の走査を回したときだけ（約定・強制決済の決済、追証・強制決済の出来事） */
  margin?: MarginTickReport;
};

export async function runTick(opts: TickOptions = {}): Promise<Result<TickResult>> {
  const path = opts.statePath ?? defaultStatePath();
  const nowMs = opts.nowMs ?? Date.now();
  const newLastTickAt = new Date(nowMs).toISOString();
  // Peek to know what to fetch outside the lock. lock 内で fresh state を
  // 再読み込みするので、ここで読んだ openOrders はあくまで「どの pair の
  // candles を取りに行くか」のヒント。
  const peek = await loadState(path);
  if (!peek.success) return peek;
  if (!peek.data) {
    return { success: true, data: { filled: [], warnings: [], lastTickAt: newLastTickAt } };
  }
  const warnings: string[] = [];
  const candlesByPair = new Map<string, Candle[]>();
  const pairsByName = new Map<string, CachedPair>();
  let anyFetchFailed = false;
  const fetchFn = opts.fetchCandles ?? defaultFetchCandles(opts.httpOptions);
  if (peek.data.openOrders.length > 0) {
    let fromMs = Math.min(Date.parse(peek.data.lastTickAt), nowMs);
    if (nowMs - fromMs > MAX_LOOKBACK_MS) {
      warnings.push(`gap > 24h; limiting to last 24h (lastTickAt=${peek.data.lastTickAt})`);
      fromMs = nowMs - MAX_LOOKBACK_MS;
    }
    const pairs = uniquePairs(peek.data.openOrders, opts.pair);
    for (const p of pairs) {
      const cr = await fetchFn(p, fromMs, nowMs);
      if (!cr.success) {
        anyFetchFailed = true;
        warnings.push(`fetch candles for ${p} failed: ${cr.error}`);
        continue;
      }
      candlesByPair.set(
        p,
        [...cr.data].sort((a, b) => a.timestamp - b.timestamp),
      );
    }
    // 約定時のみペア手数料が要る。feeRate override があれば resolveFeeRate が
    // それを最優先で使うのでペア取得は不要（取得失敗で約定を止めない）。候補
    // ローソクが 1 本も無ければ /spot/pairs を引かない（無駄 fetch 回避）。引け
    // なければ誤レート確定を避けるため約定を見送り、lastTickAt を進めず次 tick
    // で再試行する（candle fetch 失敗と同じ扱い）。
    if (opts.feeRate === undefined && [...candlesByPair.values()].some((c) => c.length > 0)) {
      const getPairsFn =
        opts.getPairs ?? (() => getPairsWithCache({ httpOptions: opts.httpOptions }));
      const pr = await getPairsFn();
      if (!pr.success) {
        anyFetchFailed = true;
        warnings.push(`fetch pairs failed: ${pr.error}`);
        candlesByPair.clear();
      } else {
        for (const cp of pr.data) pairsByName.set(cp.name, cp);
      }
    }
  }
  const margin = await prepareMarginTick(peek.data, {
    nowMs,
    pair: opts.pair,
    fetchCandles: fetchFn,
    fetchCoarseCandles: opts.fetchCoarseCandles,
    getPairs: opts.getPairs,
    httpOptions: opts.httpOptions,
  });
  // 準備に失敗しても anyFetchFailed は立てない。lock 内の marginPending が、fresh な state に信用の
  // 建玉・注文がある限り lastTickAt を止める（peek の後に全部閉じられていれば止める理由が無い）。
  warnings.push(...margin.warnings);
  const res = await updateState<TickResult>(
    (state) => {
      if (!state) {
        return {
          success: false,
          error: "paper state was removed during tick",
        };
      }
      // fresh state から fromMs を再導出（他の tick が進めている可能性がある）。
      let fromMs = Math.min(Date.parse(state.lastTickAt), nowMs);
      if (nowMs - fromMs > MAX_LOOKBACK_MS) fromMs = nowMs - MAX_LOOKBACK_MS;
      const { state: spotDone, filled } = fillAgainstCandles(
        state,
        candlesByPair,
        pairsByName,
        fromMs,
        nowMs,
        opts.feeRate,
      );
      let working = spotDone;
      let marginReport: MarginTickReport | undefined;
      // 信用の走査は口座全体で 1 回。peek の後に信用の建玉・注文が増えていて準備が無いときや、
      // 走査が失敗したときは、その区間を未処理として lastTickAt を進めない（次の tick でやり直す）。
      let marginPending = margin.kind !== "ready" && hasMarginBook(working);
      if (margin.kind === "ready") {
        const spotSold = filled.some((f) => f.side === "sell");
        const m = applyMarginTick(working, margin.input, nowMs, { spotSold, newId: genId });
        if (m.success) {
          working = m.data.state;
          marginReport = m.data.report;
        } else {
          warnings.push(`margin scan failed: ${m.error}`);
          marginPending = true;
        }
      }
      // 部分 tick（pair 限定 or fetch 失敗 or 信用の未処理）では lastTickAt を進めない。
      // 進めると未処理 pair / 未処理区間が永久に評価されなくなる。
      const advanceTick = !anyFetchFailed && !marginPending && opts.pair === undefined;
      const persistedLastTickAt = advanceTick ? newLastTickAt : working.lastTickAt;
      const newState: PaperState = {
        ...working,
        lastTickAt: persistedLastTickAt,
        updatedAt: newLastTickAt,
      };
      return {
        success: true,
        data: {
          state: newState,
          result: {
            filled,
            warnings,
            lastTickAt: persistedLastTickAt,
            ...(marginReport ? { margin: marginReport } : {}),
          },
        },
      };
    },
    { path },
  );
  if (res.success) {
    for (const msg of res.data.warnings) process.stderr.write(`Warning: ${msg}\n`);
  }
  return res;
}

function uniquePairs(orders: OpenOrder[], filter?: string): string[] {
  const set = new Set<string>();
  for (const o of orders) {
    if (filter && o.pair !== filter) continue;
    set.add(o.pair);
  }
  return [...set];
}

/** candle 群に対し working state の指値を約定させ、filled を積む。
 * openOrders は全て limit ＝ 板に置く側なので約定は必ず maker。ペアの
 * ライブ maker_fee_rate_quote（負ならリベート）を引く。feeOverride は
 * resolveFeeRate 内で最優先される（全約定に効く）。 */
function fillAgainstCandles(
  working: PaperState,
  candlesByPair: Map<string, Candle[]>,
  pairsByName: Map<string, CachedPair>,
  fromMs: number,
  nowMs: number,
  feeOverride?: number,
): { state: PaperState; filled: PaperHistoryEntry[] } {
  const filled: PaperHistoryEntry[] = [];
  for (const [p, candles] of candlesByPair) {
    const rate = resolveFeeRate(pairsByName.get(p), "maker", feeOverride);
    for (const candle of candles) {
      if (candle.timestamp < fromMs || candle.timestamp > nowMs) continue;
      for (const o of working.openOrders.filter(
        (o) => o.pair === p && Date.parse(o.createdAt) <= candle.timestamp,
      )) {
        const hits = o.side === "buy" ? candle.low <= o.price : candle.high >= o.price;
        if (!hits) continue;
        const r = applyFill(working, o, candle, rate);
        working = r.state;
        filled.push(r.entry);
      }
    }
  }
  return { state: working, filled };
}

function applyFill(
  state: PaperState,
  o: OpenOrder,
  candle: Candle,
  feeRate: number,
): { state: PaperState; entry: PaperHistoryEntry } {
  const [base, quote] = o.pair.split("_");
  const notional = o.price * o.amount;
  const { feeQuote, cost, proceeds } = computeFill(notional, feeRate, quote);
  const balances = applyFillToBalances(state.balances, o.side, base, quote, o.amount, {
    cost,
    proceeds,
  });
  const filledAt = new Date(candle.timestamp + ONE_MIN_MS).toISOString();
  const entry: PaperHistoryEntry = {
    id: o.id,
    pair: o.pair,
    side: o.side,
    type: "limit",
    amount: o.amount,
    fillPrice: o.price,
    feeQuote,
    filledAt,
  };
  const newState: PaperState = {
    ...state,
    balances,
    history: [...state.history, entry],
    openOrders: state.openOrders.filter((x) => x.id !== o.id),
  };
  return { state: newState, entry };
}

function defaultFetchCandles(httpOpts?: HttpOptions): FetchCandles {
  return async (pair, fromMs, toMs) => {
    // bitbank の 1min candle は UTC 基準の YYYYMMDD で配信されるため
    // ホスト TZ ではなく UTC で日付セグメントを組み立てる。
    // fromMs〜toMs は呼び出し側で 24h 以内に cap されているので
    // UTC 日付は最大 2 つ（同日 or 隣接日）にしかならない。
    const dates = new Set<string>([ymdUtc(fromMs), ymdUtc(toMs)]);
    const all: Candle[] = [];
    for (const d of [...dates].sort()) {
      const r = await fetchOne(pair, "1min", d, httpOpts, true);
      if (!r.success) return r;
      for (const c of r.data) {
        if (c.timestamp >= fromMs && c.timestamp <= toMs) all.push(c);
      }
    }
    return { success: true, data: all };
  };
}
