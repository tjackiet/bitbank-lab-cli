// 100行超: paper の信用コマンドの params / output（agents カタログの単一ソース）を宣言的に集約。
// 信用の state（建玉・注文・約定履歴）のフィールドを 1 つずつ列挙するため出力項目数に比例して伸びる（defs-paper.ts と同じ）。
//
// paper の信用（ADR-010）の出力スキーマ。
// 欄は cli/paper-margin/ の型（history.ts の MarginHistoryEntry、tick.ts の MarginTickReport）に合わせる。
// 信用のコマンド（create-margin-order / margin-status / margin-positions）の定義もここに置く。
import { p, type SchemaDef } from "./types.js";

const s = { type: "string" };
const n = { type: "number" };
const b = { type: "boolean" };

/** 信用の約定履歴の 1 行（本番 trade-history の信用行と同じ手数料・損益の欄） */
export const marginHistoryEntry = {
  type: "object",
  properties: {
    id: s,
    pair: s,
    side: s,
    positionSide: s,
    type: { type: "string", enum: ["market", "limit", "losscut"] },
    amount: n,
    fillPrice: n,
    feeOccurred: n,
    feeCharged: n,
    profitLoss: n,
    interest: n,
    filledAt: s,
  },
};

/** lazy tick で信用の走査を回したときの結果（paper tick の output.margin） */
export const marginTickReport = {
  type: "object",
  description:
    "Present only when the account has margin positions or orders. Fills and losscut closes, plus margin-call / losscut events",
  properties: {
    filled: { type: "array", items: marginHistoryEntry },
    events: {
      type: "array",
      items: {
        type: "object",
        properties: {
          kind: { type: "string", enum: ["margin-call", "margin-call-resolved", "losscut"] },
          at: s,
          deadline: s,
          amount: n,
          reason: { type: "string", enum: ["below-losscut", "margin-call-expired"] },
        },
      },
    },
    approximate: b,
  },
};

const marginOrder = {
  type: "object",
  properties: {
    id: s,
    pair: s,
    side: s,
    positionSide: s,
    type: s,
    price: n,
    amount: n,
    createdAt: s,
  },
};

const marginPosition = {
  type: ["object", "null"],
  properties: {
    pair: s,
    positionSide: s,
    openAmount: n,
    product: n,
    unrealizedFee: n,
    unrealizedInterest: n,
    openedAt: s,
    lastInterestAt: s,
  },
};

const operation = {
  type: "object",
  description: "Derived from side × position_side (e.g. ロング返済（sell × long）)",
  properties: { label: s, intent: { type: "string", enum: ["open", "close"] } },
};

export const paperMarginSchemas: Record<string, SchemaDef> = {
  "create-margin-order": {
    category: "paper",
    params: {
      pair: p("string", "Margin-enabled trading pair (e.g. btc_jpy)"),
      side: p("string", "Order side. Open/close is decided by side × position-side", {
        enum: ["buy", "sell"],
      }),
      "position-side": p(
        "string",
        "Position side (required): buy×long / sell×short open, sell×long / buy×short close",
        {
          enum: ["long", "short"],
        },
      ),
      type: p("string", "Order type", { enum: ["market", "limit"] }),
      amount: p("string", "Order amount"),
      price: p("string", "Limit price (required for limit orders)"),
      intent: p(
        "string",
        "Optional cross-check; rejected with PARAM if it does not match side × position-side",
        {
          enum: ["open", "close"],
        },
      ),
    },
    // market は ticker の last で即時約定、limit は margin.orders に積むだけ（約定は lazy tick）
    output: {
      oneOf: [
        {
          type: "object",
          properties: {
            operation,
            fill: marginHistoryEntry,
            position: marginPosition,
            jpy: n,
            marginCallResolved: b,
          },
        },
        { type: "object", properties: { operation, placed: marginOrder } },
      ],
    },
  },
};
