// 復元を疑うべき理由を文言にする層。**黙って通さない**ための出口なので、
// Result の partial / meta.truncated と重複してでもレポート本体（data.warnings）に残す
// （meta を読まない経路からは partial が見えない。cli/tax/import/collect.ts と同じ判断）。

export const TRUNCATED_WARNING =
  "履歴がページ上限で打ち切られています。1 件でも欠けると復元値が静かにずれます（--max-pages を上げて再実行してください）";

export type WarningInput = {
  /** 約定・入庫・出庫のいずれかがページ上限に当たった */
  historyTruncated: boolean;
  /** 評価時点が MAX_POINTS を超え、古い側を落とした */
  gridTruncated: boolean;
  /** 復元から除外した非 JPY クォートのペア */
  nonJpyPairs: readonly string[];
  /** 価格が一切引けず評価・純入出金から落ちた資産（0 円で積んだのと同じ） */
  unpricedAssets: readonly string[];
};

export function buildWarnings(i: WarningInput): string[] {
  const warnings: string[] = [];
  if (i.historyTruncated) warnings.push(TRUNCATED_WARNING);
  if (i.gridTruncated) {
    warnings.push(
      "評価時点が上限に達したため、古い側の点を落としました（--since を狭めてください）",
    );
  }
  if (i.nonJpyPairs.length > 0) {
    warnings.push(`非 JPY クォートの約定を復元から除外しました: ${i.nonJpyPairs.join(", ")}`);
  }
  if (i.unpricedAssets.length > 0) {
    warnings.push(
      `価格が引けず評価・純入出金から落ちた資産があります（値は過小です）: ${i.unpricedAssets.join(", ")}`,
    );
  }
  return warnings;
}
