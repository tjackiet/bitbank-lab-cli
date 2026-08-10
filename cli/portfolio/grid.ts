// 評価時点のグリッド（UTC 日境界 / UTC 月初）。
//
// bitbank の candlestick は UTC 基準（cli/date-utils.ts の単一ソース。1day 足は
// UTC 00:00 起点）なので、グリッドも UTC で刻んで足の日付キーと素直に一致させる。
// **JST は表示用のみ**という CLI 規約（ADR-004 の税務例外の外）に従う。
import { EXIT } from "../exit-codes.js";
import type { Result } from "../types.js";

export const GRANULARITIES = ["day", "month"] as const;
export type Granularity = (typeof GRANULARITIES)[number];

/** グリッド点の上限。誤指定で候補が膨らんでも復元ループが暴走しないための安全弁
 *  （day で約 2 年分）。超過ぶんは切り捨てず、新しい側から `maxPoints` 点を残す。 */
export const MAX_POINTS = 750;

function utcDayStart(ms: number): number {
  const d = new Date(ms);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

function utcMonthStart(ms: number): number {
  const d = new Date(ms);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
}

function nextPoint(ms: number, granularity: Granularity): number {
  if (granularity === "day") return ms + 86_400_000;
  const d = new Date(ms);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
}

export type Grid = {
  /** 昇順の評価時点（epoch ms）。最後の点は現在の期間の開始（当日 / 当月初） */
  points: number[];
  /** 実際に系列の起点になった時点。--since を丸めた後の値 */
  startMs: number;
  /** MAX_POINTS で古い側を落としたか */
  truncated: boolean;
};

/**
 * `[sinceMs, nowMs]` を granularity 単位の境界へ刻む。sinceMs は期間の開始境界へ
 * 切り下げる（--since=1/15 12:00 なら 1/15 00:00 UTC から）。
 */
export function buildGrid(sinceMs: number, nowMs: number, granularity: Granularity): Result<Grid> {
  if (sinceMs > nowMs) {
    return { success: false, error: "--since must not be in the future", exitCode: EXIT.PARAM };
  }
  const align = granularity === "day" ? utcDayStart : utcMonthStart;
  const last = align(nowMs);
  const points: number[] = [];
  for (let ms = align(sinceMs); ms <= last; ms = nextPoint(ms, granularity)) {
    points.push(ms);
  }
  // 起点が現在の期間より後（= 今日の途中を --since に指定）でも 1 点は返す
  if (points.length === 0) points.push(last);

  const truncated = points.length > MAX_POINTS;
  const kept = truncated ? points.slice(points.length - MAX_POINTS) : points;
  return { success: true, data: { points: kept, startMs: kept[0], truncated } };
}

/** 1day 足を何本取れば grid 全体をカバーできるか（candles の --limit 相当）。 */
export function candleLimitFor(grid: Grid, nowMs: number): number {
  const spanDays = Math.ceil((nowMs - grid.startMs) / 86_400_000);
  return Math.max(2, spanDays + 2);
}
