// 現在の保有から約定・入出金を逆順に巻き戻し、指定日時の保有を復元する。
//
// **移植元**: 姉妹リポ `bitbankinc/bitbank-lab-mcp` の
// `src/handlers/portfolio/calc.ts#reconstructHoldingsAtDate`（`ecf05ae` 時点）。
// CLAUDE.md が「MCP は別リポ。直接 import しない」と定めているためコピーになっている。
// **逆算の符号・手数料の扱いを変えると静かに値がずれる**ので、片方だけ直さないこと。
import type { Deposit } from "../commands/private/deposit-history.js";
import type { Trade } from "../commands/private/trade-history.js";
import type { Withdrawal } from "../commands/private/withdrawal-history.js";

/** 数量の実質ゼロ判定。移植元と同じ閾値（浮動小数の残渣を保有として残さない） */
const DUST = 1e-12;

export type Holdings = Map<string, number>;

export type Transfers = {
  deposits: readonly Deposit[];
  withdrawals: readonly Withdrawal[];
};

/** 入庫が口座に反映された時刻。DONE なら confirmed_at が入るが、欠落していても
 *  レコードを落とすと再構築が静かに狂うので found_at へフォールバックする
 *  （found_at ≤ confirmed_at。移植元は confirmed_at 固定）。 */
function depositAt(d: Deposit): number {
  return d.confirmed_at ?? d.found_at;
}

function bump(holdings: Holdings, asset: string, next: number): void {
  if (next < DUST) holdings.delete(asset);
  else holdings.set(asset, next);
}

/** 約定 1 件を巻き戻す。**買いで実際に増えた base 量は `qty - feeBase`**（手数料は
 *  base 建てで引かれる）。素朴に `qty` を戻すと手数料ぶんずれる。JPY 側は
 *  買い = `qty × price + feeQuote` を戻し、売り = 受取（`qty × price - feeQuote`）を除く。 */
function undoTrade(holdings: Holdings, t: Trade, asset: string): void {
  const qty = t.amount;
  const price = t.price;
  const feeQuote = t.fee_amount_quote || 0;
  const feeBase = t.fee_amount_base || 0;
  if (!Number.isFinite(qty) || !Number.isFinite(price)) return;

  const current = holdings.get(asset) ?? 0;
  const currentJpy = holdings.get("jpy") ?? 0;

  if (t.side === "buy") {
    bump(holdings, asset, current - (qty - feeBase));
    holdings.set("jpy", currentJpy + qty * price + feeQuote);
  } else {
    holdings.set(asset, current + qty);
    holdings.set("jpy", currentJpy - qty * price + feeQuote);
  }
}

/**
 * `sinceMs` 時点の保有数量を復元する。
 *
 * - 対象の約定は `executed_at >= sinceMs`（新しい順に巻き戻す）
 * - 入出金は **`status === "DONE"` のみ**（未確定・キャンセルは口座残高を動かしていない）
 * - **出金の巻き戻しは `amount + fee`**。出金時に失った手数料も当時は口座にあった
 */
export function reconstructHoldingsAtDate(
  current: readonly { asset: string; amount: number }[],
  trades: readonly Trade[],
  sinceMs: number,
  transfers: Transfers,
): Holdings {
  const holdings: Holdings = new Map();
  for (const h of current) {
    if (Number.isFinite(h.amount) && h.amount > 0) holdings.set(h.asset, h.amount);
  }

  const recent = trades
    .filter((t) => t.executed_at >= sinceMs)
    .sort((a, b) => b.executed_at - a.executed_at);
  for (const t of recent) undoTrade(holdings, t, t.pair.replace("_jpy", ""));

  for (const d of transfers.deposits) {
    if (d.status !== "DONE" || depositAt(d) < sinceMs) continue;
    bump(holdings, d.asset, (holdings.get(d.asset) ?? 0) - d.amount);
  }
  for (const w of transfers.withdrawals) {
    if (w.status !== "DONE" || w.requested_at < sinceMs) continue;
    holdings.set(w.asset, (holdings.get(w.asset) ?? 0) + w.amount + (w.fee || 0));
  }

  for (const [asset, amount] of holdings) {
    if (amount < DUST) holdings.delete(asset);
  }
  return holdings;
}
