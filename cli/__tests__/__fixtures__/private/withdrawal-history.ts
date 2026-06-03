// 実 bitbank API `GET /user/withdrawal_history`（rest-api.md "Fetch withdrawal
// history"）の代表レスポンス（`data.withdrawals` の要素）。
//
// なぜ共有フィクスチャか:
//   本監査（docs/dev/audit-private-trade-schema-divergence.md / 突合表 #15・ISSUE-E）で、
//   実装側の WithdrawalSchema が `address` を非 nullable・必須にしていたが、
//   `address` は "only for crypto" な項目であり、fiat（jpy）出金では欠落し得る。
//   テストが常に address ありの crypto インラインモックで自己完結すると、fiat
//   （欠落）ケースのパース失敗を一切検知できないトートロジーに陥る。実 API docs
//   由来の 2 ケースを 1 箇所に固定し、当該テストがここを import することで
//   crypto / fiat 双方のシェイプを担保する。
//
// 形状の根拠: rest-api.md の Response format JSON 例
//   常時: uuid, asset, account_uuid, amount(string), fee(string), status,
//         requested_at(number)
//   crypto のみ: label, address, network, destination_tag(number|string), txid
//   fiat のみ: bank_name, branch_name, account_type, account_number, account_owner
//   数値は API が返す「文字列」のまま置く（amount / fee は numStr が number へ
//   変換するため変換前の生形状を再現）。
//
// 2 ケース:
//   ① crypto 出金: address / network / txid / destination_tag あり。
//      fiat 専用フィールド（bank_* 等）は欠落。
//   ② fiat（jpy）出金: bank_name 等あり・address / network / txid 欠落。
//      銀行振込のため出金アドレスが存在せず、暗号資産専用フィールドが落ちる
//      形状を再現。
//
// 注意（要実機確認）: 各フィールドが crypto/fiat で「キー欠落」か「null」かは
//   JSON 例だけでは断定不可。さらに destination_tag の型（number / string）は
//   資産依存。実装は双方を nullable + optional / union にした安全側で、本
//   フィクスチャは「キー欠落」側を代表ケースとして再現する。実機（jpy 出金
//   あり口座 / XRP 等 tag 付き資産）のレスポンスで最終確定すること。

export const withdrawalHistoryFixture = {
  withdrawals: [
    {
      // ① crypto 出金: address / network / txid / destination_tag あり
      uuid: "11111111-2222-3333-4444-555555555555",
      asset: "xrp",
      account_uuid: "aaaa1111-bbbb-2222-cccc-333333333333",
      amount: "100",
      fee: "0.15",
      status: "DONE",
      requested_at: 1234567890123,
      label: "main-wallet",
      address: "rLW9gnQo7BQhU6igk5keqYnH3TVrCxGRzm",
      network: "xrp",
      destination_tag: 123456,
      txid: "tx123abc",
    },
    {
      // ② fiat（jpy）出金: bank_* あり・crypto 専用フィールド欠落
      uuid: "66666666-7777-8888-9999-000000000000",
      asset: "jpy",
      account_uuid: "dddd4444-eeee-5555-ffff-666666666666",
      amount: "50000",
      fee: "550",
      status: "DONE",
      requested_at: 1234567891000,
      bank_name: "bitbank bank",
      branch_name: "head office",
      account_type: "ordinary",
      account_number: "1234567",
      account_owner: "TARO YAMADA",
    },
  ],
};
