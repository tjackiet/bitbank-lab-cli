// 信用の突合ヒント。現物と違い、差の第一候補は「販売所」ではない（信用に販売所は無い）。
// 疑うのは **損益の算出基準**（報告書は生約定から FIFO で再計算、API は取引所が付けた
// `profit_loss`）と、**手数料の合計基準**（精算ベース / 発生ベース）。
import type { VerifyDiagnosis } from "../schema/verify.js";
import type { MarginField } from "./margin-aggregate.js";

const HINTS: Record<MarginField, Partial<Record<VerifyDiagnosis, string>>> = {
  margin_pnl: {
    REPORT_EXCESS:
      "報告書が多い: 報告書は生約定から FIFO（個別法）で再計算する。API の profit_loss と建玉の対応付けが違う可能性",
    API_EXCESS:
      "API が多い: 年をまたぐ建玉の帰属年、または未取込の決済がある可能性（利息の控除位置も確認する）",
  },
  margin_fee: {
    REPORT_EXCESS:
      "報告書が多い: 発生ベース（各約定日）で合計されている可能性 → margin_fee_occurred 行を見る",
    API_EXCESS: "API が多い: 年をまたぐ建玉の手数料が決済年にまとめて精算されている可能性",
  },
  margin_fee_occurred: {
    REPORT_EXCESS:
      "報告書が多い: 精算ベース（決済時に一括）で合計されている可能性 → margin_fee 行を見る",
    API_EXCESS: "API が多い: 精算ベースの合計（margin_fee 行）と比べる",
  },
};

export function marginHint(field: MarginField): (d: VerifyDiagnosis) => string {
  return (diagnosis) => {
    if (diagnosis === "MATCH") return "許容幅内で一致";
    if (diagnosis === "FEE_ROUNDING") return "API 手数料の 4 桁丸めで説明できる範囲の差（P-16）";
    return HINTS[field][diagnosis] ?? "";
  };
}
