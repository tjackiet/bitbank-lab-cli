// 移動平均法（v2 §3）。**時系列順が結果を変える**ので安定ソートが前提。
//
//   取得: cost += 取得価額 ; qty += 数量 ; 単価 = cost / qty      ← 丸めない
//   処分: cogs = cost / qty × 数量（全量処分なら簿価残の全額。P-03）
//
// 単価は処分では更新しない（据置）。「年末 1 単位当たり取得価額 = 12/31 に最も近い
// 取得時点の平均単価」という FAQ 2-4 の定義がそのままこの形になる。
import { add, cmp, div, eq, isZero, mul, type Ratio, sub, ZERO } from "../ratio.js";
import type { LedgerEntry } from "../schema/ledger.js";
import { abortedOutcome, countDisposals, MAX_DISPOSALS_UNROUNDED } from "./disposal-limit.js";
import { readAmount, sumEntries } from "./sum-entries.js";
import type { AverageOutcome, Book } from "./types.js";

export { MAX_DISPOSALS_UNROUNDED } from "./disposal-limit.js";

function step(
  book: Book,
  unit: Ratio | null,
  e: LedgerEntry,
  violations: string[],
): { book: Book; unit: Ratio | null; cogs: Ratio } {
  const qty = readAmount(e.qty, "qty", e, violations);
  if (e.kind === "ACQUIRE") {
    const cost = add(book.cost, readAmount(e.cost_jpy, "cost_jpy", e, violations));
    const next = { qty: add(book.qty, qty), cost };
    // 数量ゼロへの取得（数量 0 の調整仕訳）では単価を引けないので据置く
    return { book: next, unit: isZero(next.qty) ? unit : div(next.cost, next.qty), cogs: ZERO };
  }
  if (e.kind !== "DISPOSE") return { book, unit, cogs: ZERO };

  // 数量ゼロの処分では簿価も単価も動かさない。下の P-03 判定は qty と book.qty が
  // 両方ゼロでも真になるため、数量ゼロの調整仕訳で残った簿価が丸ごと cogs へ流れ、
  // 売却代金ゼロの参考損失になってしまう。簿価は期末に残し I2 違反として検知させる
  if (isZero(qty)) return { book, unit, cogs: ZERO };

  if (cmp(qty, book.qty) > 0) {
    violations.push(
      `${e.event_id}#${e.seq}: 処分数量が保有数量を超えています（取込漏れか前年繰越の未入力）`,
    );
    return { book, unit, cogs: ZERO };
  }
  // P-03: 全量処分では簿価残を全額原価へ掃き出す（端数を残さない）
  const cogs = eq(qty, book.qty) ? book.cost : mul(div(book.cost, book.qty), qty);
  return { book: { qty: sub(book.qty, qty), cost: sub(book.cost, cogs) }, unit, cogs };
}

export function movingAverage(
  currency: string,
  entries: readonly LedgerEntry[],
  opening: Book,
): AverageOutcome {
  const totals = sumEntries(entries);
  const violations = [...totals.violations];

  // 実用上限の判定は計算に入る前に（ADR-005。入ってしまうと実用時間で返らない）
  const disposals = countDisposals(entries);
  if (disposals > MAX_DISPOSALS_UNROUNDED) {
    return abortedOutcome(currency, disposals, opening, totals, violations);
  }
  // sort_key は (source_ref, seq)。同一ミリ秒の約定はここで安定順序になる
  const ordered = [...entries].sort(
    (a, b) => a.ts_utc - b.ts_utc || a.sort_key.localeCompare(b.sort_key),
  );

  let book = opening;
  let unit: Ratio | null = isZero(opening.qty) ? null : div(opening.cost, opening.qty);
  let cogs = ZERO;
  for (const e of ordered) {
    const r = step(book, unit, e, violations);
    book = r.book;
    unit = r.unit;
    cogs = add(cogs, r.cogs);
  }

  return {
    currency,
    method: "moving-average",
    opening,
    acquired: totals.acquired,
    disposed: totals.disposed,
    unit,
    cogs,
    closing: book,
    income: totals.income,
    expense: totals.expense,
    violations,
  };
}
