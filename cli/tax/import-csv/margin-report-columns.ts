// 年間取引報告書（**信用**）CSV の列定義。現物とは別様式・別ファイルで、
// 通貨（ペア）単位に 4 項目だけを持つ。
//
// 決定的な違い（社内設計資料 2024-11 / 国税庁への照会結果）:
// - 損益は**個別法（FIFO）**で算出する。現物の総平均法・移動平均法とは別系統
// - **年中信用取引損益は取引手数料を控除していない**（控除するのは利息だけ）。
//   手数料は「支払手数料」列に分けて載り、申告時にユーザーが現物の手数料と合算して
//   国税庁計算書の「手数料等」欄へ入れる（手数料は消費税の課税対象という整理）
// - 年末建玉は法人向け（みなし決済損益額）。個人の申告には不要
import { z } from "zod";
import { decStr } from "../../schema-helpers.js";

export const MarginReportRow = z.object({
  currency: z.string(),
  end_short_position: decStr,
  end_long_position: decStr,
  margin_pnl: decStr,
  margin_fee: decStr,
});
export type MarginReportRow = z.infer<typeof MarginReportRow>;

export const MARGIN_COLUMNS = {
  通貨名: "currency",
  年末保有中売建玉: "end_short_position",
  年末保有中買建玉: "end_long_position",
  年中信用取引損益: "margin_pnl",
  支払手数料: "margin_fee",
} as const satisfies Record<string, keyof MarginReportRow>;

export const MARGIN_HEADER_MARKER = "年中信用取引損益";

/** 全履歴が要るため年ウィンドウでは復元できない列（比較せず参考表示に留める）。 */
export const POSITION_FIELDS = [
  "end_short_position",
  "end_long_position",
] as const satisfies readonly (keyof MarginReportRow)[];
