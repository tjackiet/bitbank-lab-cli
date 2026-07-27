// 参考損益の表示ガード（v2 §1.2 (a)〜(c) + 付録E.4 (d) + 履歴打ち切り）。**B案の核心**。
// すべて満たす銘柄だけ参考損益を数値表示し、満たさない銘柄は取引集計のみを出して
// 「表示できない理由」を明示する。ガードは黙って通さない側に倒す。

import type { CurrencyResult } from "../engine/run.js";
import type { Deferred } from "../ledger/from-events.js";
import type { AssetComparison } from "../reconcile/compare.js";
import type { TaxEvent } from "../schema/event.js";

export type GuardInput = {
  /** (a) ユーザーの明示的なアテステーション（コマンドの --attest） */
  attested: boolean;
  /**
   * 履歴がページ上限で打ち切られたか。欠けたイベントが通貨ごとに偶然ネットゼロだと
   * 残高突合（d）は MATCH のまま通るので、打ち切り自体を独立したブロック条件にする。
   * 打ち切りは入出金側も含み銘柄に正確に紐づけられないため、判定は全銘柄一括。
   */
  truncated: boolean;
  events: readonly TaxEvent[];
  results: Map<string, CurrencyResult>;
  reconciliation: readonly AssetComparison[];
  deferred: readonly Deferred[];
};

export type GuardVerdict = { allowed: boolean; blockedBy: string[]; warnings: string[] };

/** (b) を崩すフラグ。いずれも「取得価額が未確定」を意味する。 */
const BLOCKING_FLAGS = [
  "UNRESOLVED_TRANSFER",
  "GRANT_SUSPECT",
  "NON_JPY_QUOTE",
  "NO_RATE",
  "UNOBSERVED_SHAPE",
] as const;

const FLAG_REASON: Record<(typeof BLOCKING_FLAGS)[number], string> = {
  UNRESOLVED_TRANSFER: "(b) 未解決の入庫があります（入庫理由と取得価額の由来が未確定）",
  GRANT_SUSPECT: "(b) 付与とみられる入庫があります（取得価額の由来が未確定）",
  NON_JPY_QUOTE: "(b) 非 JPY クォートの約定があります（交換の完全計算は P0 では未対応）",
  NO_RATE: "(b) 円換算額を決められない約定があります",
  UNOBSERVED_SHAPE: "(b) 未観測の形状（暗号資産建て手数料など）があります",
};

function flagReasons(events: readonly TaxEvent[], currency: string): string[] {
  const hit = new Set<string>();
  for (const e of events) {
    if (e.currency !== currency) continue;
    for (const f of BLOCKING_FLAGS) if (e.flags.includes(f)) hit.add(FLAG_REASON[f]);
  }
  return [...hit];
}

function reconcileReason(rows: readonly AssetComparison[], currency: string): string | null {
  const row = rows.find((r) => r.currency === currency);
  if (row === undefined) return null; // 突合対象外（当年に動きのない銘柄）
  if (row.diagnosis === "MATCH") return null;
  return `(d) 残高突合が一致しません（残差 ${row.residual}: ${row.hint}）`;
}

export function evaluateGuard(input: GuardInput, currency: string): GuardVerdict {
  const blockedBy: string[] = [];
  const warnings: string[] = [];

  // 履歴が欠けていれば (a)〜(d) の成否によらず集計自体を信用できない
  if (input.truncated) {
    blockedBy.push(
      "履歴がページ上限で打ち切られています（全履歴が必要です。--max-pages を上げて再実行してください）",
    );
  }
  if (!input.attested) {
    blockedBy.push(
      "(a) アテステーション未取得: bitbank 以外の取引所・ウォレット・他アカウントでの" +
        "同一銘柄の保有・取引がないことの確認が必要です（--attest）",
    );
  }
  blockedBy.push(...flagReasons(input.events, currency));

  const result = input.results.get(currency);
  if (result === undefined || !result.openingKnown) {
    blockedBy.push("(c) 前年末残高（数量・簿価）が未確定です（--carryover で指定してください）");
  }
  const reconcile = reconcileReason(input.reconciliation, currency);
  if (reconcile !== null) blockedBy.push(reconcile);

  for (const d of input.deferred) {
    if (d.currency === currency) blockedBy.push(`(b) 仕訳化できないイベント: ${d.reason}`);
  }
  if (result !== undefined) {
    for (const v of result.outcome.violations) blockedBy.push(`計算前提の違反: ${v}`);
    for (const v of result.invariants) blockedBy.push(`不変条件 ${v.id}: ${v.detail}`);
  }

  // 出庫自体は譲渡ではないので計算は続行できる（v2 §1.2）。警告だけ付ける
  if (input.events.some((e) => e.kind === "WITHDRAWAL" && e.currency === currency)) {
    warnings.push("出庫があります。出庫先での売却・使用・決済は本レポートに含まれません");
  }
  return { allowed: blockedBy.length === 0, blockedBy: [...new Set(blockedBy)], warnings };
}
