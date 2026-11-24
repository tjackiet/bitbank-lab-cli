// paper の信用の state スキーマ（ADR-010 / docs/dev/paper-margin-plan.md §3.3・§3.8）。
// Step 3 で PaperState v4 に組み込む。いまは建玉のスキーマだけを置く。
//
// フィールド名は paper の state の慣例どおり camelCase にし、本番 margin-positions の名前
// （open_amount / product / average_price / unrealized_fee_amount / unrealized_interest_amount）
// への写像は出力側で行う。locked_amount（未約定の返済注文が予約している数量）は state に
// 持たず、openOrders から導く（closable.ts）。取消・約定のたびに数字を合わせ直さずに済む。
import { z } from "zod";
import { PositionSideSchema } from "../margin-operation.js";

export const MarginPositionSchema = z.object({
  pair: z.string(),
  positionSide: PositionSideSchema,
  /** 建玉数量（本番の open_amount） */
  openAmount: z.number().positive(),
  /** Σ 約定数量 × 約定価格（本番の product）。平均建値 = product / openAmount */
  product: z.number().positive(),
  /** 新規建て時に積んだ手数料のうち未精算分（本番の unrealized_fee_amount）。リベートなら負 */
  unrealizedFee: z.number(),
  /** 積み上がった利息のうち未精算分（本番の unrealized_interest_amount） */
  unrealizedInterest: z.number().nonnegative(),
  /** 最初に建てた時刻（ISO 8601） */
  openedAt: z.string(),
  /** 利息を最後に積んだ時刻（ISO 8601）。利息は JST 0 時をまたぐたびに積む（ADR-010 決定 7） */
  lastInterestAt: z.string(),
});

export type MarginPosition = z.infer<typeof MarginPositionSchema>;
