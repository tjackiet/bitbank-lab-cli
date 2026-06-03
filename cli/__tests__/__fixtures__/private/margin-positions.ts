// 実 bitbank API `GET /user/margin/positions` の代表レスポンス（`data` 部分）。
//
// なぜ共有フィクスチャか: margin-status.ts の冒頭コメント参照。実 API 形状の
//   単一ソースとして固定し、各テストがインライン即席モックで実装と
//   トートロジーを組むのを防ぐ。
//
// 形状の根拠: PR #281（fix: margin-positions を実 bitbank API のレスポンス形式に整合）。
//   position は最低 1 件入れて「建玉が 1 件でもあるとパース失敗」だった回帰を踏み続ける。
//   数値は API が返す「文字列」のまま（CLI 側 numStr が number へ変換する）。
//   occurred_at / due_date_at のみ Unix ms の number。

export const marginPositionsFixture = {
  notice: {
    what: "additional_margin",
    occurred_at: 1700000000000,
    amount: "5000",
    due_date_at: 1700600000000,
  },
  payables: { amount: "0" },
  positions: [
    {
      pair: "btc_jpy",
      position_side: "long",
      open_amount: "0.01",
      product: "150000",
      average_price: "15000000",
      unrealized_fee_amount: "0.5",
      unrealized_interest_amount: "1.2",
    },
  ],
  losscut_threshold: { individual: "80", company: "60" },
};
