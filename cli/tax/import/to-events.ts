// 生レコード → 正規化イベント列の入口。約定は margin-tracker で新規 / 決済を確定して
// から現物 / 信用へ振り分け、入出庫と合わせて時系列に並べる。
//
// 組み立てたイベントは**必ず TaxEvent スキーマで検証する**。条件付き必須は
// superRefine が単一ソース（schema/event.ts）なので、ここで独自に条件を書き直すと
// 契約が二重定義になる。検証に落ちた行は捨てずに保留リストへ回す。
import { TaxEvent } from "../schema/event.js";
import { isPending, type Normalized, type Pending } from "./event-base.js";
import { trackMargin } from "./margin-tracker.js";
import type { RawTrade } from "./raw-trade.js";
import type { RawDeposit, RawWithdrawal } from "./raw-transfer.js";
import { marginEvent } from "./to-events-margin.js";
import { spotEvent } from "./to-events-spot.js";
import { depositEvent, withdrawalEvent } from "./to-events-transfer.js";

export type RawInput = {
  trades: readonly RawTrade[];
  deposits: readonly RawDeposit[];
  withdrawals: readonly RawWithdrawal[];
};

export type NormalizeResult = Normalized & {
  /** 建玉の整合違反など、取込は出来たが要確認の事象 */
  warnings: string[];
};

export function toEvents(input: RawInput): NormalizeResult {
  const events: TaxEvent[] = [];
  const pending: Pending[] = [];
  const collect = (v: TaxEvent | Pending): void => {
    if (isPending(v)) pending.push(v);
    else events.push(v);
  };

  const margin = trackMargin(input.trades);
  for (const t of input.trades) {
    collect(
      t.position_side === undefined ? spotEvent(t) : marginEvent(t, margin.roles.get(t.trade_id)),
    );
  }
  for (const d of input.deposits) collect(depositEvent(d));
  for (const w of input.withdrawals) collect(withdrawalEvent(w));

  const validated: TaxEvent[] = [];
  for (const e of events) {
    const parsed = TaxEvent.safeParse(e);
    if (parsed.success) validated.push(parsed.data);
    else
      pending.push({ source_ref: e.source_ref, reason: `スキーマ違反: ${parsed.error.message}` });
  }

  // 決定論性 NFR: 同一タイムスタンプは source_ref で安定ソートする
  validated.sort((a, b) => a.ts_utc - b.ts_utc || a.event_id.localeCompare(b.event_id));

  const warnings = margin.anomalies.map((a) => `trade_id=${a.trade_id}: ${a.reason}`);
  if (margin.outstanding.length > 0) {
    const list = margin.outstanding.map((o) => `${o.key}=${o.qty}`).join(", ");
    // 未決済建玉は当年損益に含めない（v2 §5）。含めないこと自体を明示する
    warnings.push(`未決済建玉が残っています（当年損益には含めません）: ${list}`);
  }
  return { events: validated, pending, warnings };
}
