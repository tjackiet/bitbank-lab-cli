// paper の信用の追証（ADR-010 決定 4 / docs/dev/paper-margin-plan.md §2.3・§3.6）。純関数。
// 公表ルール: 毎日 15 時の時点で 維持必要保証金額 > 受入保証金合計額 なら発生し、解消期限は基準時から
// 24 時間以内。解消しなければ強制決済。差入方法は入金・暗号資産の預入・現物の売却・建玉の決済の 4 つ。
// paper で行えるのは現物の売却と建玉の返済だけで、その行為の直後に条件が解けていれば解消とする。
// 価格の回復だけでは解消しない（公表ルールの差入方法に無く、本番より強制決済が遅れる向きになるため）。
import { snapAmount } from "../paper-precision.js";
import type { MarginAccount } from "./account.js";
import { isMarginCallCondition, type MarginRules } from "./conditions.js";
import type { MarginCall } from "./state.js";

/** 基準時（JST 15 時）の口座から追証を判定する。発生しなければ null */
export function judgeMarginCall(
  a: MarginAccount,
  judgedAtMs: number,
  rules: Pick<MarginRules, "marginCallGraceMs">,
): MarginCall | null {
  if (!isMarginCallCondition(a)) return null;
  return {
    judgedAt: new Date(judgedAtMs).toISOString(),
    deadline: new Date(judgedAtMs + rules.marginCallGraceMs).toISOString(),
    amount: snapAmount(a.positionMaintenanceMargin - a.totalMarginBalance),
  };
}

/** 解消期限を過ぎたか（期限の時刻ちょうどで強制決済する） */
export function isMarginCallExpired(call: MarginCall, atMs: number): boolean {
  return atMs >= Date.parse(call.deadline);
}

/** 解消の行為（建玉の返済・現物の売却）の直後の口座で、追証が解けたか。建玉が無くなれば解ける */
export function resolvesMarginCall(after: MarginAccount): boolean {
  return !isMarginCallCondition(after);
}
