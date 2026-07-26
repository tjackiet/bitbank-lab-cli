// 現物の突合で使う「報告書と同じ軸」の項目定義。集計ループ（aggregate.ts）と
// 突合（annual-report.ts）の両方が参照するので、型だけを切り出してある。
import { type Ratio, ZERO } from "../ratio.js";
import type { VerifyField } from "../schema/verify.js";

export const COMPARED_FIELDS = [
  "buy_qty",
  "buy_jpy",
  "sell_qty",
  "sell_jpy",
  "deposit_qty",
  "withdrawal_qty",
  "fee",
] as const satisfies readonly VerifyField[];
export type ComparedField = (typeof COMPARED_FIELDS)[number];

export type Figures = Record<ComparedField, Ratio> & {
  /** API 4 桁丸め（付録E.1 / P-16）の手数料が何件寄与したか。許容幅の算出に使う */
  fee_rounded_count: number;
};

export type Aggregated = { byCurrency: Map<string, Figures>; warnings: string[] };

/** 報告書にしか現れない銘柄の API 側（= 全項目ゼロ）としても使う。 */
export function zeroFigures(): Figures {
  const f = { fee_rounded_count: 0 } as Figures;
  for (const k of COMPARED_FIELDS) f[k] = ZERO;
  return f;
}
