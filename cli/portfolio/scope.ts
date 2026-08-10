// 巡回対象（ペア・資産）と現在の保有の解決。取得も復元もしない、範囲決めだけの層。
import { assets } from "../commands/private/assets.js";
import type { Deposit } from "../commands/private/deposit-history.js";
import type { Trade } from "../commands/private/trade-history.js";
import type { Withdrawal } from "../commands/private/withdrawal-history.js";
import type { PrivateHttpOptions } from "../http-private.js";
import type { Result } from "../types.js";

export type Holding = { asset: string; amount: number };

/** 出庫は asset 必須・約定は pair 必須なので、pairs マスタ（delist 込み）から巡回対象を
 *  作る。取引の無いペア／資産でも 1 リクエストで空が返るだけ。delist 済みでも履歴は
 *  残るため `is_enabled` では絞らない（trade-history --all-pairs と同じ判断）。 */
export function marketScope(list: { name: string; base_asset: string; quote_asset: string }[]): {
  jpyPairs: string[];
  allAssets: string[];
} {
  const jpyPairs: string[] = [];
  const assetSet = new Set<string>();
  for (const p of list) {
    if (p.quote_asset === "jpy") jpyPairs.push(p.name);
    assetSet.add(p.base_asset);
    assetSet.add(p.quote_asset);
  }
  return { jpyPairs: jpyPairs.sort(), allAssets: [...assetSet].sort() };
}

/** 現在の保有数量。**出金申請中（withdrawing）を足し戻す**: onhand からは既に引かれて
 *  いる一方、巻き戻しでは status=DONE の出庫しか戻さないので、足さないと申請中の資産が
 *  過去の全時点で欠ける（cli/tax/import/fetch-assets.ts と同じ「実残高」の定義）。 */
export async function currentHoldings(opts?: PrivateHttpOptions): Promise<Result<Holding[]>> {
  const r = await assets({ showAll: true }, opts);
  if (!r.success) return r;
  const rows = r.data
    .map((a) => ({ asset: a.asset, amount: a.onhand_amount + a.withdrawing_amount }))
    .filter((h) => h.amount > 0);
  return { success: true, data: rows };
}

/**
 * candle を引くペア = 現在の保有 ∪ 期間内に動いた資産。
 *
 * 現在の保有だけで引くと、**期間中に全量売却した銘柄**が過去の点で現在価格に落ちる
 * （復元では当時保有していたことになるのに、その日の始値が無い）。
 */
export function candlePairsFor(
  jpyPairs: readonly string[],
  holdings: readonly Holding[],
  history: { trades: Trade[]; deposits: Deposit[]; withdrawals: Withdrawal[] },
): string[] {
  const touched = new Set(holdings.map((h) => h.asset));
  for (const t of history.trades) touched.add(t.pair.replace("_jpy", ""));
  for (const d of history.deposits) touched.add(d.asset);
  for (const w of history.withdrawals) touched.add(w.asset);
  return jpyPairs.filter((p) => touched.has(p.slice(0, -"_jpy".length)));
}
