// paper の信用で使うペアごとのパラメータを pairs から引く（ADR-010 決定 3 / docs/dev/paper-margin-plan.md §3.4）。
// 1 ペアずつの判定は paper-margin/params.ts（純関数）。ここは取得の順序だけを持つ:
// - リスク想定比率が適用期限切れ（stale）なら pairs を 1 度だけ取り直す（キャッシュの TTL 24h より比率の週次切替が先に来る）
// - 信用非対応・フィールド欠落のペアに建玉か注文があれば失敗（黙って既定値で埋めない）
import type { CachedPair } from "./pairs-cache.js";
import { type MarginPairParams, marginParamsOf } from "./paper-margin/params.js";
import type { Result } from "./types.js";

type GetPairs = () => Promise<Result<CachedPair[]>>;

export async function resolveMarginParams(
  pairs: readonly string[],
  o: { nowMs: number; getPairs: GetPairs; refreshPairs: GetPairs },
): Promise<Result<Map<string, MarginPairParams>>> {
  let source = await o.getPairs();
  for (let attempt = 0; ; attempt++) {
    if (!source.success)
      return { success: false, error: `margin: fetch pairs failed: ${source.error}` };
    const byName = new Map(source.data.map((p) => [p.name, p] as const));
    const out = new Map<string, MarginPairParams>();
    const problems: string[] = [];
    let stale = false;
    for (const pair of pairs) {
      const info = byName.get(pair);
      const r = info
        ? marginParamsOf(info, o.nowMs)
        : { kind: "unknown" as const, reason: "not in pairs" };
      if (r.kind === "ok") out.set(pair, r.params);
      else if (r.kind === "stale") stale = true;
      else problems.push(`${pair} (${r.kind === "unknown" ? r.reason : "margin not supported"})`);
    }
    if (problems.length > 0) {
      return { success: false, error: `margin: no margin params for ${problems.join(", ")}` };
    }
    if (!stale) return { success: true, data: out };
    if (attempt > 0) {
      return {
        success: false,
        error: "margin: risk ratio in pairs is past its until even after refresh",
      };
    }
    source = await o.refreshPairs();
  }
}
