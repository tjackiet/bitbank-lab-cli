import { defaultStatePath, loadState } from "../../paper-state.js";
import type { Result } from "../../types.js";

export type PaperAssetRow = { asset: string; amount: number };

export type PaperAssetsArgs = { statePath?: string };

export async function paperAssets(args: PaperAssetsArgs = {}): Promise<Result<PaperAssetRow[]>> {
  const path = args.statePath ?? defaultStatePath();
  const r = await loadState(path);
  if (!r.success) return r;
  if (!r.data) {
    return {
      success: false,
      error: "paper state not initialized. Run 'bitbank paper init --jpy=<amount>' first.",
    };
  }
  const rows: PaperAssetRow[] = Object.entries(r.data.balances).map(([asset, amount]) => ({
    asset,
    amount,
  }));
  return { success: true, data: rows };
}
