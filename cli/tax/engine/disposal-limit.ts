// 非丸め移動平均法の実用上限（ADR-005 の計測）。
//
// 売却のたびに簿価の分母へ数量の分子が乗り、gcd 約分後も 1 売却あたり約 3.8 bit
// （数量が 8 桁バラバラだと約 13 bit）純増する。BigInt のコストは bit 長の二乗で効くため、
// これを超えると所要時間が非線形に伸びて実用時間で返らなくなる。
//
// **黙って精度を落とさず明示的に止める**（ADR-005: 閾値超での再正規化は「丸め済みの
// 中間値に再度丸めを適用しない」という中核原則に反するので採らない）。判定は計算に
// 入る前に行う — 入ってしまってからでは止められない。
import { ZERO } from "../ratio.js";
import type { LedgerEntry } from "../schema/ledger.js";
import type { EntrySums } from "./sum-entries.js";
import type { AverageOutcome, Book } from "./types.js";

export const MAX_DISPOSALS_UNROUNDED = 5000;

export function countDisposals(entries: readonly LedgerEntry[]): number {
  return entries.filter((e) => e.kind === "DISPOSE").length;
}

/** 上限超で打ち切った結果。数値は出さず（unit=null / cogs=0）理由だけを返す。 */
export function abortedOutcome(
  currency: string,
  disposals: number,
  opening: Book,
  totals: EntrySums,
  violations: string[],
): AverageOutcome {
  return {
    currency,
    method: "moving-average",
    opening,
    acquired: totals.acquired,
    disposed: totals.disposed,
    unit: null,
    cogs: ZERO,
    closing: opening,
    income: totals.income,
    expense: totals.expense,
    violations: [
      ...violations,
      `${currency}: 移動平均法（非丸め）の売却件数が上限 ${MAX_DISPOSALS_UNROUNDED} 件を` +
        `超えています（${disposals} 件）。総平均法を使うか、国税庁計算書互換モード` +
        `（NTA_SHEET_2025_12・売却の都度 ROUNDUP）の実装をお待ちください`,
    ],
  };
}
