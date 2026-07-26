// 参考損益レポートの実行パイプライン。
// 収集は**全履歴**で行う（残高突合＝ガード(d) が全履歴でしか成立しないため）。
// 仕訳化は当年分（year_jst）だけに絞る。前年分は繰越（--carryover）で受け取る。
import type { PrivateHttpOptions } from "../../http-private.js";
import type { Result } from "../../types.js";
import { runEngine } from "../engine/run.js";
import { ZERO_BOOK } from "../engine/total-average.js";
import type { OpeningBalances } from "../engine/types.js";
import type { BrokerageRow } from "../import-csv/brokerage-columns.js";
import { ledgerFromEvents } from "../ledger/from-events.js";
import { type Market, runReconcile } from "../reconcile/run.js";
import type { Method } from "../schema/method.js";
import type { TaxReport } from "../schema/report.js";
import { buildReport } from "./build.js";

export type PnlArgs = {
  year: number;
  method: Method;
  attested: boolean;
  /** 明示された前年繰越。`allZero` のときは当年を初年度として全銘柄ゼロ確定にする */
  opening?: OpeningBalances;
  allZero?: boolean;
  maxPages?: number;
  /** 販売所「売買履歴」CSV の行（API には現れない経路） */
  brokerage?: readonly BrokerageRow[];
};

/** --carryover=zero: 当年に出てくる銘柄をゼロ確定の繰越として埋める。 */
function zeroOpening(currencies: Iterable<string>): OpeningBalances {
  const opening: OpeningBalances = {};
  for (const c of currencies) opening[c] = ZERO_BOOK;
  return opening;
}

export async function runPnlReport(
  args: PnlArgs,
  market: Market,
  opts?: PrivateHttpOptions,
): Promise<Result<TaxReport>> {
  const reconciled = await runReconcile(
    market,
    { maxPages: args.maxPages, brokerage: args.brokerage },
    opts,
  );
  if (!reconciled.success) return reconciled;
  const { collected, comparisons } = reconciled.data;

  // 年分は JST だけで判定する（要求仕様 §4。12/28 JST = 12/27 UTC の例が実在する）
  const yearEvents = collected.events.filter((e) => e.year_jst === args.year);
  const ledger = ledgerFromEvents(yearEvents);

  const opening = args.allZero
    ? zeroOpening(new Set(ledger.entries.map((e) => e.currency)))
    : (args.opening ?? {});
  const results = runEngine({ entries: ledger.entries, method: args.method, opening });

  const report = buildReport({
    year: args.year,
    method: args.method,
    attested: args.attested,
    // ガードは当年のイベントだけを見る（過年度の未解決入庫まで当年をブロックしない）
    collected: { ...collected, events: yearEvents },
    ledger,
    results,
    reconciliation: comparisons,
  });
  return reconciled.partial
    ? { success: true, data: report, partial: true, meta: reconciled.meta }
    : { success: true, data: report };
}
