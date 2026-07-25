# 残高再構築実験（amount+fee 問題の確定と隠れフローの検出）

> **本書は実口座での検証記録**（[tax-fixtures-plan.md](../tax-fixtures-plan.md)）。
> 生データ（`raw/`）は**本リポジトリには置かない**（`BITBANK_TAX_FIXTURES` が指す別環境）。
> 口座規模が分かる絶対件数・実測金額・実日時は**丸めるか関係式に置換**してある。
> 資産別の結果表は口座の資産構成そのものになるため、**表を載せず「表が示した性質」を記述**する。

- 実験日: 2026-07-25。データ: `raw/<batch>/`（履歴と `/user/assets` を同一バッチで採取、採取間隔約 1 分）
- 演算: 全金額を文字列→ BigInt の 10^18 スケール固定小数で計算（float 不使用）。
  スクリプト: `scripts/dev/tax/reconcile.ts`（原型を保全。ADR-005 以降の製品コードは `cli/tax/` 側）
- 対象行: 現物約定（千件規模）/ 信用約定 2 行 / 入庫（crypto + jpy の 2 系統）/ 出庫（CANCELED を除外）

## 再構築モデル

- 現物約定: buy は base +amount・quote −amount×price、sell は逆。手数料は base −`fee_amount_base`（全行ゼロ）、
  quote −`fee_amount_quote`（メイカーの負値はそのまま加算 = リベート）
- 信用約定: 資産残高に触れない。quote(JPY) へ `profit_loss` のみ加算
  （`profit_loss` は手数料・利息控除後のネット値。fee/interest を別途減算すると二重計上）
- 入庫: +amount（全行 DONE）
- 出庫（DONE のみ）: 仮説1 = −(amount + fee) / 仮説2 = −amount
- 実残高: assets の `onhand_amount` + `withdrawing_amount`。シンボル改称は旧+新を合算比較（matic+pol, rndr+render）

## 結論 1: 出庫の控除は「amount + fee」（仮説1）で確定

資産ごとに 2 つの仮説で理論残高を出し、実残高との残差を比較した。**表の代わりに、表が示した
2 つの性質を記す**（この 2 つが揃うことが仮説1 の証明であり、個別の金額は不要）:

```text
性質1: 出庫実績のある資産すべてで、残差H1（= 実残高 − 理論H1）が **完全にゼロ**
性質2: 残差H2（= 実残高 − 理論H2）が、資産ごとの **出庫 fee 合計と正確に一致**（符号は負）
       → 仮説2 は「fee 分ちょうど」ずれる。すなわち fee は amount とは別に控除されている
```

- fiat（jpy 出金）も crypto と同じく **amount + fee が控除**される
- → インポータ仕様: **出庫レコードの資産減少 = amount + fee**。`fee` は amount に含まれない別掲

## 結論 2: 未追跡フローは実在する（4 種を検出）

### 2-1. API 外の JPY→BTC 購入とみられる対応残差（最重要）

- btc 残差 **+約0.0004 BTC**（実残高が理論より多い）と jpy 残差 **−約4,500 円**（少ない）が同時に存在
  （**値は特定性を下げるため丸めた検証値**）
- 論証の要点は次の 2 点で、これが揃うと「JPY を払って BTC を取得した取引が API 外にある」ことになる:
  1. **残差の符号が逆**（crypto は増・JPY は減）
  2. **その比が相場と整合**: 暗黙レート = JPY 残差 ÷ BTC 残差 ≒ **約1,075万円/BTC**。
     採取時の btc_jpy last との乖離は数 % で、2026 年の相場レンジに収まる
- → **trade_history にも deposit_history にも現れない JPY→BTC の購入経路が存在する**。候補は
  「かんたん積立」等の UI 外購入導線（複数回の定期買付なら加重平均単価となり乖離も説明できる）。
  API からは断定不能
- インポータ仕様への含意: **積立等の取得は API で取得不能 → 手動調整（または UI CSV）経路が必須**

### 2-2. JPY の円未満端数付与（deposit_history に混入する付与イベント）

`deposit_history?asset=jpy` に、通常の銀行入金と異なる特徴を持つ行を複数検出。**判定条件は次の 3 つを
すべて満たすこと**【確定・生データで確認済み】:

```text
1. amount が **円未満の端数**を持つ
2. found_at == confirmed_at（通常の銀行入金は検知と着金に時間差が出る）
3. 秒以下が **00.000**（epoch ミリ秒の下 3 桁がゼロ、かつ JST の正時ちょうどに一致）
```

形状の例（**値は完全な合成例**。実測値ではない）:

```json
{ "amount": "12.345678901", "found_at": 1700000000000, "confirmed_at": 1700000000000, "status": "DONE" }
```

- 何の付与か（キャンペーン・分配・調整）はレスポンスから判定不能だが、
  **「付与収入が jpy 入金行として API に現れるケースがある」**ことの実証
- 注意: これらは `asset=jpy` を明示しないと取得できない（結論 3 参照）

### 2-3. チェーン外付与とみられる crypto 入庫行（txid=null・プレースホルダー address）

形状（**識別子と数量は例示**。`address` の値のみ bitbank が返す実際のプレースホルダー定数）:

```json
{ "asset": "btc", "amount": "0.024", "network": "bitcoin",
  "address": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx", "txid": null,
  "found_at": 1600000000000, "confirmed_at": 1600000000000, "status": "DONE" }
```

- crypto 入庫でありながら **txid が null、address が bitbank 側のプレースホルダー文字列**
- チェーン外の付与・振替が deposit_history に混入する実例。**ANSWERS.md Q3 の「txid は全行に存在」は
  本行により訂正**（キーは存在するが null があり得る）
- インポータ仕様への含意: txid=null の入庫行は「外部からの移転」ではなく付与系の可能性があり、
  取得原価の扱いが異なる → フラグ立てが必要

### 2-4. ダスト消滅（複数資産で負の微小残差）

- 構造: 入庫の小数桁（8〜9 桁）> 取引ペアの amount 桁（4 桁等）のため、全量売却後に理論上は端数が
  残るが実残高は 0
- 端数の消滅経路（bitbank 側の端数処理・表示打切り等）は API から判定不能。
  **規模は最大でも 1e-4 未満/資産**で、ダスト許容閾値の設計材料になる

## 結論 3: deposit_history の asset 省略は fiat を返さない（採取手順の罠）

- asset **省略**: **crypto のみ**が返る
- `asset=jpy` **明示**: fiat が返る（通常入金 + 上記の端数付与行）
- → 全量取得には「省略 1 回 + `asset=jpy` 1 回」の**2 系統が必須**。fiat 行のフィールドは
  uuid / asset / amount / found_at / confirmed_at / status のみ（network / address / txid はキーごと欠落）

## 補足: 信用まわりの整合確認

- `profit_loss` を**ネット値として 1 回だけ** JPY に計上するモデルで矛盾なし。
  gross 解釈（fee + interest を別途減算）にすると全体残差が悪化する（数円規模でずれる）
- `total_margin_balance` は独立ウォレットではなく、**現物残高×掛目（collateral_ratio）の評価合算**と整合:
  `Σ(onhand × ratio × 時価) + jpy ≈ total_margin_balance`（ticker の時点差による乖離は 2% 未満）。
  よって信用 PL・金利・手数料は現物 JPY 残高に直接反映され、**振替という隠れフローは存在しない**
- JPY 残差の円未満端数は、端数付与行と信用 PL 等の既知の小数の合成で説明でき、独立の異常ではない

## インポータ仕様への反映事項（まとめ）

1. 出庫控除 = amount + fee（fiat / crypto 共通）
2. 入庫は「省略」+「`asset=jpy`」の 2 系統で取得
3. txid=null の crypto 入庫行・上記 3 条件を満たす jpy 入金行は付与系としてフラグ
4. API 外の購入経路（積立とみられる）が存在するため、残高突合による検出と手動調整インターフェースが必須
5. ダスト許容閾値は資産あたり 1e-4 程度で設計可能（今回の観測上限）
