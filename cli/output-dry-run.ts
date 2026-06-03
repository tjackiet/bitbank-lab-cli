import type { DryRunData, DryRunFee } from "./types.js";

/** result.data が trade dry-run のプレビューか判定する type guard。
 *  human 経路の分岐と監査ログのスキップ判定に使うため、dryRun フラグだけでなく
 *  shape も検証して fail-closed にする（実 API レスポンスの誤判定を防ぐ）。 */
export function isDryRunData(data: unknown): data is DryRunData {
  if (typeof data !== "object" || data === null) return false;
  const v = data as Record<string, unknown>;
  return (
    v.dryRun === true &&
    typeof v.endpoint === "string" &&
    typeof v.executeHint === "string" &&
    typeof v.body === "object" &&
    v.body !== null &&
    (v.confirmPhrase === undefined || typeof v.confirmPhrase === "string")
  );
}

/** human 向け: 従来の DRY RUN 整形ボックスを stdout に描画する。
 *  body は dryRunResult 側で機微フラグをマスク済みなので、ここでは整形だけ行う。 */
export function printDryRunBox(data: DryRunData): void {
  const lines = [
    "🔍 DRY RUN（実際のAPIは叩きません）",
    "",
    "リクエスト内容:",
    `  エンドポイント: POST ${data.endpoint}`,
    "  ボディ:",
  ];
  for (const [k, v] of Object.entries(data.body ?? {})) {
    lines.push(`    ${k}: ${JSON.stringify(v)}`);
  }
  if (data.fee) appendFeeLines(lines, data.fee, data.body?.side);
  lines.push("");
  lines.push(
    data.confirmPhrase
      ? `実行するには --execute と --confirm=${data.confirmPhrase} を付けてください:`
      : "実行するには --execute を付けてください:",
  );
  lines.push(`  ${data.executeHint}`);
  process.stdout.write(`${lines.join("\n")}\n`);
}

/** 手数料見積り行を box に足す。買いは推定コスト、売りは推定手取りとして表示する。 */
function appendFeeLines(lines: string[], fee: DryRunFee, side: unknown): void {
  lines.push("", "手数料見積り:");
  lines.push(`  role: ${fee.role}`);
  lines.push(
    `  rate: ${fee.rate}（${(fee.rate * 100).toFixed(4)}%）${fee.rate < 0 ? " ← maker リベート" : ""}`,
  );
  if (fee.estimatedFeeQuote !== undefined) {
    lines.push(`  推定手数料(quote): ${fee.estimatedFeeQuote}`);
  }
  if (fee.estimatedCostQuote !== undefined) {
    lines.push(
      `  ${side === "sell" ? "推定手取り(quote)" : "推定コスト(quote)"}: ${fee.estimatedCostQuote}`,
    );
  }
  if (fee.note) lines.push(`  ※ ${fee.note}`);
}
