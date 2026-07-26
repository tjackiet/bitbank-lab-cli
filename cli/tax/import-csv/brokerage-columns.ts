// 販売所（即時売買）「売買履歴」CSV の列定義。**API に一切現れない唯一の取得経路**
// （付録E.3 訂正 / 要求仕様 §2.2）。
//
// 様式の特徴と、そこから来る制約:
// - **手数料列が無い**（スプレッド内包）。fee=0 ではなく「列が存在しない」ので、
//   イベント側も fee を付けず `BROKERAGE_SPREAD` で表す（schema/event.ts の superRefine が強制）
// - **ペア列が無い**。通貨（base）だけで、クォートは JPY 固定として読む
// - **約定代金の列が無い**。数量 × 価格で算出する（P-15）。数量は 8 桁で丸められているため、
//   実際の約定代金と厳密には一致しない可能性がある（差は verify-report が測る）
// - **日時にタイムゾーンが無い**。JST 固定として読む（`jstDateTimeToMs`）
// - 重複排除キーは **注文ID**（取引所約定の trade_id とは別空間）
import { z } from "zod";
import { decStr } from "../../schema-helpers.js";

export const BrokerageRow = z.object({
  order_id: z.string(),
  currency: z.string(),
  /** `買` / `売`。未知の値で CSV 全体を落とさないよう生文字列で受け、to-events で判定する */
  side: z.string(),
  qty: decStr,
  price: decStr,
  executed_at: z.string(),
});
export type BrokerageRow = z.infer<typeof BrokerageRow>;

export const BROKERAGE_COLUMNS = {
  注文ID: "order_id",
  通貨: "currency",
  "売/買": "side",
  数量: "qty",
  指値価格: "price",
  売買日時: "executed_at",
} as const satisfies Record<string, keyof BrokerageRow>;

/** 現物・信用の年間取引報告書と違い、1 行目がそのままヘッダ（メタ行が無い）。 */
export const BROKERAGE_HEADER_MARKER = "注文ID";

export const SIDE_BUY = "買";
export const SIDE_SELL = "売";
