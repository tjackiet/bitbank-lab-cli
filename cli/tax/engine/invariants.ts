// 不変条件の機械検証（v2 §3）。**Ratio で厳密に比較する**（許容誤差を置かない）。
// 誤差を許すと、丸めが混入したときに検知できなくなる — それが I1 の存在意義。
//
//   I1: 期首簿価 + Σ取得価額 == Σ譲渡原価 + 期末簿価
//   I2: 数量 >= 0、数量 == 0 のとき簿価 == 0
//   I3: 交換取引ごとに 支払側 proceeds == 受取側 cost
import { add, cmp, eq, isZero, ZERO } from "../ratio.js";
import { fromDecimalString } from "../ratio-decimal.js";
import type { LedgerEntry } from "../schema/ledger.js";
import type { AverageOutcome } from "./types.js";

export type InvariantViolation = { id: "I1" | "I2" | "I3"; detail: string };

export function checkI1(o: AverageOutcome): InvariantViolation[] {
  const left = add(o.opening.cost, o.acquired.cost);
  const right = add(o.cogs, o.closing.cost);
  if (eq(left, right)) return [];
  return [
    {
      id: "I1",
      detail: `${o.currency}: 期首簿価+Σ取得価額 と Σ譲渡原価+期末簿価 が一致しません`,
    },
  ];
}

export function checkI2(o: AverageOutcome): InvariantViolation[] {
  const out: InvariantViolation[] = [];
  if (cmp(o.closing.qty, ZERO) < 0) {
    out.push({ id: "I2", detail: `${o.currency}: 期末数量が負です` });
  }
  if (isZero(o.closing.qty) && !isZero(o.closing.cost)) {
    out.push({ id: "I2", detail: `${o.currency}: 期末数量ゼロなのに簿価が残っています` });
  }
  return out;
}

/** 同一 event_id に ACQUIRE と DISPOSE が両方ある = 交換取引。金額の一致を見る。 */
export function checkI3(entries: readonly LedgerEntry[]): InvariantViolation[] {
  const byEvent = new Map<string, { cost?: string; proceeds?: string }>();
  for (const e of entries) {
    if (e.kind !== "ACQUIRE" && e.kind !== "DISPOSE") continue;
    const slot = byEvent.get(e.event_id) ?? {};
    if (e.kind === "ACQUIRE") slot.cost = e.cost_jpy;
    else slot.proceeds = e.proceeds_jpy;
    byEvent.set(e.event_id, slot);
  }
  const out: InvariantViolation[] = [];
  for (const [eventId, slot] of byEvent) {
    if (slot.cost === undefined || slot.proceeds === undefined) continue;
    const c = fromDecimalString(slot.cost);
    const p = fromDecimalString(slot.proceeds);
    if (c === null || p === null || !eq(c, p)) {
      out.push({ id: "I3", detail: `${eventId}: 支払側 proceeds と受取側 cost が一致しません` });
    }
  }
  return out;
}

export function checkInvariants(
  outcome: AverageOutcome,
  entries: readonly LedgerEntry[],
): InvariantViolation[] {
  return [...checkI1(outcome), ...checkI2(outcome), ...checkI3(entries)];
}
