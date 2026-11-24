// 追証・強制決済の判定基準（ADR-010 / docs/dev/paper-margin-plan.md §2.3）。純関数。
// bitbank の信用取引ルールどおり。どちらも口座単位で、建玉が無ければ成立しない。
// 保証金率で言い換えると、追証は「保証金率 < リスク想定比率」（個人 50%）、
// 強制決済は「保証金率 < リスク想定比率 × 強制決済掛け目」（個人 25%）になる。
// いつ評価するか（追証は毎日 JST 15 時、強制決済は随時）は呼び出し側が決める。
import type { MarginAccount } from "./account.js";

/** 強制決済掛け目（信用取引ルール、2026-11-24 確認）。public の API では取れないので、
 *  state に固定する既定値として使う（ADR-010 決定 3） */
export const DEFAULT_LOSSCUT_MULTIPLIER = 0.5;

/** 追証の判定基準: 維持必要保証金額 > 受入保証金合計額 */
export function isMarginCallCondition(a: MarginAccount): boolean {
  return a.openPositionProduct > 0 && a.positionMaintenanceMargin > a.totalMarginBalance;
}

/** 強制決済の判定基準（随時）: 維持必要保証金額 × 強制決済掛け目 > 受入保証金合計額 */
export function isLosscutCondition(a: MarginAccount, losscutMultiplier: number): boolean {
  return (
    a.openPositionProduct > 0 &&
    a.positionMaintenanceMargin * losscutMultiplier > a.totalMarginBalance
  );
}
