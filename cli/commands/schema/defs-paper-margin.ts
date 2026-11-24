// paper の信用（ADR-010）の出力スキーマの部品。agents カタログの単一ソース。
// 欄は cli/paper-margin/ の型（history.ts の MarginHistoryEntry、tick.ts の MarginTickReport）に合わせる。
// 信用のコマンド（create-margin-order / margin-status / margin-positions）を足すときはここに定義を置く。
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
