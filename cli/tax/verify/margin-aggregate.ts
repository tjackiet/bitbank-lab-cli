// API 由来イベントを、年間取引報告書（信用）と同じ軸へ集計する。
//
// 報告書の定義（社内設計資料）は `年中信用取引損益 = 値幅損益 − 利息` で、
// **取引手数料は控除していない**。一方 API の `profit_loss` は
// `値幅損益 − Σ手数料 − 利息`（実機確認 #2 で検算済み）なので、
//
//     報告書の損益 = profit_loss + 決済レコードの fee_amount_quote
//
// が定義上の対応になる。手数料を足し戻さずに比べると、差がまるごと手数料ぶん出る。
//
// 手数料は 2 通りの積み方を両方出す。報告書が「精算ベース（決済時に建て分と合算）」と
// 「発生ベース（各約定日）」のどちらで合計しているかは資料から確定できず、年をまたぐ
// 建玉があると両者はずれる。どちらが一致したかで基準が判明する。
import { splitPair } from "../import/symbol-alias.js";
import { add, type Ratio, ZERO } from "../ratio.js";
import { fromDecimalString } from "../ratio-decimal.js";
import type { TaxEvent } from "../schema/event.js";

export const MARGIN_FIELDS = ["margin_pnl", "margin_fee", "margin_fee_occurred"] as const;
export type MarginField = (typeof MARGIN_FIELDS)[number];

export type MarginFigures = Record<MarginField, Ratio> & { closes: number };
export type MarginAggregated = { byCurrency: Map<string, MarginFigures>; warnings: string[] };

function zero(): MarginFigures {
  const f = { closes: 0 } as MarginFigures;
  for (const k of MARGIN_FIELDS) f[k] = ZERO;
  return f;
}

export function aggregateMarginForReport(events: readonly TaxEvent[]): MarginAggregated {
  const byCurrency = new Map<string, MarginFigures>();
  const warnings: string[] = [];
  const slot = (currency: string): MarginFigures => {
    const found = byCurrency.get(currency);
    if (found) return found;
    const fresh = zero();
    byCurrency.set(currency, fresh);
    return fresh;
  };
  const num = (value: string | undefined, label: string, ref: string): Ratio => {
    if (value === undefined) return ZERO;
    const r = fromDecimalString(value);
    if (r !== null) return r;
    warnings.push(`${ref}: ${label} を十進文字列として読めません（${value}）`);
    return ZERO;
  };

  let nonJpyQuote = 0;
  let missingNet = 0;
  for (const e of events) {
    if (e.kind !== "MARGIN_OPEN" && e.kind !== "MARGIN_CLOSE") continue;
    if (e.flags.includes("NON_JPY_QUOTE")) {
      nonJpyQuote++;
      continue;
    }
    // 報告書の通貨名は base_asset（ペアではない）
    const f = slot(splitPair(e.pair_raw ?? "")?.base ?? e.currency);
    const charged = num(e.margin?.fee_charged, "margin.fee_charged", e.event_id);
    f.margin_fee = add(f.margin_fee, charged);
    f.margin_fee_occurred = add(
      f.margin_fee_occurred,
      num(e.margin?.fee_occurred, "margin.fee_occurred", e.event_id),
    );
    if (e.kind !== "MARGIN_CLOSE") continue;
    f.closes++;
    if (e.margin?.realized_net === undefined) {
      missingNet++;
      continue;
    }
    // 手数料を**足し戻して**報告書の定義（値幅 − 利息）へ揃える
    const net = num(e.margin.realized_net, "margin.realized_net", e.event_id);
    f.margin_pnl = add(f.margin_pnl, add(net, charged));
  }
  if (nonJpyQuote > 0) {
    warnings.push(`非 JPY クォートの信用約定 ${nonJpyQuote} 件を集計から除外しました`);
  }
  if (missingNet > 0) {
    warnings.push(`realized_net を持たない決済 ${missingNet} 件がありました（損益は不足します）`);
  }
  return { byCurrency, warnings };
}
