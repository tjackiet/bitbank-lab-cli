import { type PaperHistoryEntry, defaultStatePath, loadState } from "../../paper-state.js";
import type { Result } from "../../types.js";

export type PaperTradeHistoryArgs = { statePath?: string };

export async function paperTradeHistory(
  args: PaperTradeHistoryArgs = {},
): Promise<Result<PaperHistoryEntry[]>> {
  const path = args.statePath ?? defaultStatePath();
  const r = await loadState(path);
  if (!r.success) return r;
  if (!r.data) {
    return {
      success: false,
      error: "paper state not initialized. Run 'bitbank paper init --jpy=<amount>' first.",
    };
  }
  return { success: true, data: r.data.history };
}
