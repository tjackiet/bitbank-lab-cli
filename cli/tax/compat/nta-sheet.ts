// 国税庁「暗号資産の計算書」互換モード（`NTA_SHEET_2025_12`。v2 付録D）。
// 既定の計算（ADR-005: 内部非丸め）は**変えない**。「計算書に手で書き込んだらこうなる」
// 値を併記するための層で、用途はレポートの互換欄と回帰テストだけ（付録D.6）。
//
// **丸めの位置が方式で違う**（実ファイルの数式解析・付録D.2 / D.3）。ここが本体:
// - 総平均法: 単価・原価・残高は**非丸め**。最終の
//   **収入金額計を切捨て（AV52）・必要経費計を切上げ（AV53）**。所得は丸めた両者の差
// - 移動平均法: **売却の都度、残高価額を切上げ**。譲渡原価はそこからの差引で、
//   集計段階の**追加の丸めは無い**（丸めは既に売却時に入っているため）
import type { AverageOutcome, Book } from "../engine/types.js";
import { add, cmp, div, eq, isZero, mul, type Ratio, sub, ZERO } from "../ratio.js";
import { fromDecimalString, toDecimalString, toYen } from "../ratio-decimal.js";
import type { LedgerEntry } from "../schema/ledger.js";
import { NTA_SHEET_MODE, type NtaCompat } from "../schema/nta.js";

const num = (s: string | undefined): Ratio => (s ? (fromDecimalString(s) ?? ZERO) : ZERO);
const yen = (r: Ratio, mode: "ROUNDDOWN" | "ROUNDUP" | "HALF_UP"): string =>
  toYen(r, mode).toString();

/**
 * 移動平均法の残高を計算書の漸化式で回し直す。既定エンジンは `cost -= cogs` だが、
 * 計算書は**売却のたびに残高を `ceil(単価 × 残数量)` へ置き直す**（D.3）。
 * 譲渡原価は最後に差引で出す（`(繰越 + Σ購入) − 年末残高`）。
 */
function movingAverageBook(entries: readonly LedgerEntry[], opening: Book): Book {
  const ordered = [...entries].sort(
    (a, b) => a.ts_utc - b.ts_utc || a.sort_key.localeCompare(b.sort_key),
  );
  let book = opening;
  let unit: Ratio | null = isZero(opening.qty) ? null : div(opening.cost, opening.qty);
  for (const e of ordered) {
    const qty = num(e.qty);
    if (e.kind === "ACQUIRE") {
      book = { qty: add(book.qty, qty), cost: add(book.cost, num(e.cost_jpy)) };
      if (!isZero(book.qty)) unit = div(book.cost, book.qty);
      continue;
    }
    if (e.kind !== "DISPOSE" || isZero(qty) || cmp(qty, book.qty) > 0) continue;
    const left = sub(book.qty, qty);
    // 全量処分は残高ゼロ（切上げても 0）。単価が無い異常時は簿価を動かさない
    const cost =
      eq(qty, book.qty) || unit === null ? ZERO : fromYen(toYen(mul(unit, left), "ROUNDUP"));
    book = { qty: left, cost };
  }
  return book;
}

const fromYen = (v: bigint): Ratio => ({ n: v, d: 1n });

export function ntaCompat(outcome: AverageOutcome, entries: readonly LedgerEntry[]): NtaCompat {
  const revenue = add(outcome.disposed.proceeds, outcome.income);
  if (outcome.method === "moving-average") {
    const closing = movingAverageBook(entries, outcome.opening);
    // cogs は差引（D.5）。売却時の切上げぶんが原価側から抜けて残高へ寄る
    const cogs = sub(add(outcome.opening.cost, outcome.acquired.cost), closing.cost);
    const expense = add(cogs, outcome.expense);
    // 移動平均法は集計段階の追加丸めが無い。表示のため切捨てるだけ
    return {
      mode: NTA_SHEET_MODE,
      cogs_jpy: yen(cogs, "ROUNDDOWN"),
      closing_cost_jpy: yen(closing.cost, "ROUNDDOWN"),
      income_total_jpy: yen(revenue, "ROUNDDOWN"),
      expense_total_jpy: yen(expense, "ROUNDDOWN"),
      income_jpy: toDecimalString(sub(revenue, expense), 0, "ROUNDDOWN"),
      carryover_cost_jpy: yen(closing.cost, "HALF_UP"),
    };
  }
  // 総平均法: 丸めるのは最終 2 セルだけ。**所得は丸めた両者の差**（丸め前の差ではない）
  const expense = add(outcome.cogs, outcome.expense);
  const incomeTotal = toYen(revenue, "ROUNDDOWN");
  const expenseTotal = toYen(expense, "ROUNDUP");
  return {
    mode: NTA_SHEET_MODE,
    cogs_jpy: yen(outcome.cogs, "ROUNDDOWN"),
    closing_cost_jpy: yen(outcome.closing.cost, "ROUNDDOWN"),
    income_total_jpy: incomeTotal.toString(),
    expense_total_jpy: expenseTotal.toString(),
    income_jpy: (incomeTotal - expenseTotal).toString(),
    carryover_cost_jpy: yen(outcome.closing.cost, "HALF_UP"),
  };
}
