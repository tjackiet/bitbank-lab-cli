// 実 bitbank API `GET /user/margin/status` の代表レスポンス（`data` 部分）。
//
// なぜ共有フィクスチャか:
//   margin バグ（PR #280）の根本原因は、テストのモックが実装と同じ架空フィールドで
//   自己完結し、実 API 形状を一切検証していなかったこと。各テストがインラインで
//   即席モックを書くと再び実装と一致するだけのトートロジーに陥る。実 API docs 由来の
//   シェイプを 1 箇所に固定し、全 margin テストがここを import することで
//   「モックは実 API 準拠」を構造的に担保する。
//
// 形状の根拠: PR #280（fix: margin-status を実 bitbank API のレスポンス形式に整合）で
//   実 API に整合させたフィールド集合。数値は API が返す「文字列」のまま置く
//   （CLI 側で numStr が number へ変換するため、変換前の生形状を再現する）。

export const marginStatusFixture = {
  status: "NORMAL",
  total_margin_balance: "1000000.0000",
  total_margin_balance_percentage: "300.00",
  margin_position_profit_loss: "500.0000",
  margin_call_percentage: "100",
  losscut_percentage: "50",
  buy_credit: "900000",
  sell_credit: "900000",
  unrealized_cost: "12345.0000",
  total_margin_position_product: "150000",
  open_margin_position_product: "100000",
  open_margin_order_product: "50000",
  total_position_maintenance_margin: "15000",
  total_long_position_maintenance_margin: "10000",
  total_short_position_maintenance_margin: "5000",
  total_open_order_maintenance_margin: "8000",
  total_long_open_order_maintenance_margin: "6000",
  total_short_open_order_maintenance_margin: "2000",
  available_balances: [{ pair: "btc_jpy", long: "900000", short: "800000" }],
};

// 建玉が無い口座では各 percentage が null で返る（CLI は nullableNumStr で受ける）。
export const marginStatusNoPositionFixture = {
  ...marginStatusFixture,
  total_margin_balance_percentage: null,
  margin_call_percentage: null,
  losscut_percentage: null,
};
