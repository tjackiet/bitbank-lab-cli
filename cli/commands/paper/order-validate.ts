import type { CachedPair } from "../../pairs-cache.js";
import type { Result } from "../../types.js";

// 浮動小数の丸め誤差吸収用。例: 0.0003 / 0.0001 = 2.9999999999999996 → < 1e-9 で OK 扱い。
const PRECISION_TOLERANCE = 1e-9;

function isMultipleOf(value: number, step: number): boolean {
  if (step <= 0) return false;
  const ratio = value / step;
  return Math.abs(ratio - Math.round(ratio)) <= PRECISION_TOLERANCE;
}

function hasAtMostDigits(value: number, digits: number): boolean {
  if (digits < 0) return false;
  const scale = 10 ** digits;
  const scaled = value * scale;
  return Math.abs(scaled - Math.round(scaled)) <= PRECISION_TOLERANCE;
}

export function validateOrderSize(
  pair: string,
  type: "market" | "limit",
  amount: number,
  pairs: CachedPair[],
  price?: number,
): Result<{ ok: true }> {
  const info = pairs.find((p) => p.name === pair);
  if (!info) return { success: false, error: `unknown pair: ${pair}` };
  if (amount < info.unit_amount) {
    return {
      success: false,
      error: `amount < unit_amount: ${pair} requires >= ${info.unit_amount}`,
    };
  }
  if (!isMultipleOf(amount, info.unit_amount)) {
    return {
      success: false,
      error: `amount not a multiple of unit_amount: ${pair} unit_amount=${info.unit_amount}`,
    };
  }
  const max = type === "limit" ? info.limit_max_amount : info.market_max_amount;
  if (amount > max) {
    return {
      success: false,
      error: `amount > ${type}_max_amount: ${pair} max ${max}`,
    };
  }
  if (price !== undefined && !hasAtMostDigits(price, info.price_digits)) {
    return {
      success: false,
      error: `price exceeds price_digits: ${pair} price_digits=${info.price_digits}`,
    };
  }
  return { success: true, data: { ok: true } };
}
