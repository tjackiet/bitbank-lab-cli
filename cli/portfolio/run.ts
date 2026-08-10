// 100行超: 「現在の残高 → 履歴 → 価格 → 復元 → 組み立て」を通す 1 本のパイプライン。
// 各段の実装は scope / fetch-* / equity / net-flow / assemble に分けてあり、ここに残るのは
// 順序と受け渡しだけ。途中で切ると「どの順で何を渡すか」が 2 ファイルに割れて読めなくなる。
import { pairs } from "../commands/public/pairs.js";
import type { PrivateHttpOptions } from "../http-private.js";
import type { Result } from "../types.js";
import { assemble, currentPoint, priceQuality } from "./assemble.js";
import { buildEquitySeries } from "./equity.js";
import { fetchHistory } from "./fetch-history.js";
import { fetchCurrentPrices, fetchDailyOpens } from "./fetch-prices.js";
import { buildGrid, candleLimitFor, type Granularity } from "./grid.js";
import { calcPeriodNetFlow } from "./net-flow.js";
import type { BalanceHistory } from "./schema.js";
import { candlePairsFor, currentHoldings, marketScope } from "./scope.js";
import { buildWarnings } from "./warnings.js";

export type RunArgs = {
  sinceMs: number;
  nowMs: number;
  granularity: Granularity;
  maxPages: number;
  noCache: boolean;
};

export async function runBalanceHistory(
  args: RunArgs,
  opts?: PrivateHttpOptions,
): Promise<Result<BalanceHistory>> {
  const grid = buildGrid(args.sinceMs, args.nowMs, args.granularity);
  if (!grid.success) return grid;

  const market = await pairs(opts);
  if (!market.success) return market;
  const { jpyPairs, allAssets } = marketScope(market.data);

  const holdings = await currentHoldings(opts);
  if (!holdings.success) return holdings;

  const history = await fetchHistory(jpyPairs, allAssets, {
    since: String(grid.data.startMs),
    maxPages: args.maxPages,
    opts,
  });
  if (!history.success) return history;
  const { transfers } = history.data;

  const prices = await fetchCurrentPrices(opts);
  if (!prices.success) return prices;

  const candlePairs = candlePairsFor(jpyPairs, holdings.data, {
    trades: history.data.trades,
    ...transfers,
  });
  const dailyOpens = await fetchDailyOpens(
    candlePairs,
    candleLimitFor(grid.data, args.nowMs),
    args.noCache,
    opts,
  );

  // 非 JPY クォートの約定は JPY 建てで巻き戻せない。黙って無視すると数量がずれるので、
  // 除外したことを warning に出す（実測では全ペア JPY 建てだが仕様変更への保険）。
  const jpyTrades = history.data.trades.filter((t) => t.pair.endsWith("_jpy"));
  const nonJpyPairs = [
    ...new Set(history.data.trades.filter((t) => !t.pair.endsWith("_jpy")).map((t) => t.pair)),
  ].sort();

  const series = buildEquitySeries({
    grid: grid.data.points,
    current: holdings.data,
    trades: jpyTrades,
    transfers,
    dailyOpens,
    currentPrices: prices.data,
  });
  const { flow, unpricedAssets } = calcPeriodNetFlow(transfers, grid.data.startMs, prices.data);

  const historyTruncated =
    history.data.truncatedPairs.length > 0 ||
    history.data.truncatedAssets.length > 0 ||
    history.data.depositsTruncated;

  const data = assemble({
    grid: grid.data,
    nowMs: args.nowMs,
    granularity: args.granularity,
    points: series.points,
    current: currentPoint(
      new Map(holdings.data.map((h) => [h.asset, h.amount])),
      prices.data,
      args.nowMs,
    ),
    flow,
    quality: priceQuality(
      holdings.data.map((h) => h.asset).filter((a) => a !== "jpy"),
      series.fallbackAssets,
    ),
    completeness: {
      complete: !historyTruncated,
      truncated_pairs: history.data.truncatedPairs,
      truncated_assets: history.data.truncatedAssets,
      deposits_truncated: history.data.depositsTruncated,
      grid_truncated: grid.data.truncated,
    },
    warnings: buildWarnings({
      historyTruncated,
      gridTruncated: grid.data.truncated,
      nonJpyPairs,
      unpricedAssets: [...new Set([...unpricedAssets, ...series.unpricedAssets])].sort(),
    }),
  });

  if (historyTruncated) {
    return {
      success: true,
      data,
      partial: true,
      meta: { truncated: true, reason: "MAX_PAGES", returnedRows: data.points.length },
    };
  }
  return { success: true, data };
}
