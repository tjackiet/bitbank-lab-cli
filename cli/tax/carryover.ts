// 前年繰越（(H)(I) の引継ぎ）の読み込み。ガード(c)「前年末残高が確定していること」の
// 入力そのもので、**未入力とゼロは別物**として扱う（未入力なら参考損益を出さない）。
//
// 形式: { "btc": { "qty": "1.5", "cost_jpy": "931800" }, ... }
import { readFileSync } from "node:fs";
import { z } from "zod";
import { EXIT } from "../exit-codes.js";
import { decStr } from "../schema-helpers.js";
import type { Result } from "../types.js";
import type { OpeningBalances } from "./engine/types.js";
import { fromDecimalString } from "./ratio-decimal.js";

export const CarryoverFile = z.record(z.string(), z.object({ qty: decStr, cost_jpy: decStr }));
export type CarryoverFile = z.infer<typeof CarryoverFile>;

/** 「当年が初年度で前年末残高はゼロ」を明示するための値。--carryover=zero で指定する。 */
export const CARRYOVER_ZERO = "zero";

export function parseCarryover(json: unknown): Result<OpeningBalances> {
  const parsed = CarryoverFile.safeParse(json);
  if (!parsed.success) {
    return {
      success: false,
      error: `Invalid carryover: ${parsed.error.message}`,
      exitCode: EXIT.PARAM,
    };
  }
  const opening: OpeningBalances = {};
  for (const [currency, v] of Object.entries(parsed.data)) {
    const qty = fromDecimalString(v.qty);
    const cost = fromDecimalString(v.cost_jpy);
    if (qty === null || cost === null) {
      return {
        success: false,
        error: `Invalid carryover for ${currency}: qty / cost_jpy must be decimal strings`,
        exitCode: EXIT.PARAM,
      };
    }
    opening[currency.toLowerCase()] = { qty, cost };
  }
  return { success: true, data: opening };
}

/** ファイルから読む。読めない・壊れているは Result のエラーにする（throw しない）。 */
export function loadCarryover(path: string): Result<OpeningBalances> {
  let raw: string;
  try {
    raw = readFileSync(path, "utf-8");
  } catch {
    return { success: false, error: `Cannot read carryover file: ${path}`, exitCode: EXIT.PARAM };
  }
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return {
      success: false,
      error: `Carryover file is not valid JSON: ${path}`,
      exitCode: EXIT.PARAM,
    };
  }
  return parseCarryover(json);
}
