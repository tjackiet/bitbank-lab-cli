# 監査レポート: private / trade スキーマ「モック vs 実 API」乖離の横断調査

- 監査日: 2026-06-03
- 対象: `cli/commands/private/`・`cli/commands/trade/` 全コマンドの Zod レスポンススキーマ
- 実 API 仕様の根拠: <https://github.com/bitbankinc/bitbank-api-docs/blob/master/rest-api.md>
  （`master` を取得し、各エンドポイントの **`Response format` JSON 例** を一次根拠とした）
- 背景: margin-status / margin-positions で「実装スキーマのフィールド名が実 API と全く
  異なるのにテストはモックの自己完結でグリーン」という乖離が見つかった（PR #280 / #281 で
  修正済み、`docs/dev/conventions.md` にレビュー観点を明文化）。同じ病巣が他エンドポイントに
  潜んでいないかを網羅的に確認する。

## 重大度の定義

| 区分 | 意味 |
|---|---|
| **critical** | フィールド名不一致等で**本番レスポンスのパースが失敗**する（margin と同型）。成功レスポンスでも CLI が「失敗」を返す／silent success を招く |
| **minor** | 型・nullable の取り違え、欠落フィールド。通常はパースが通るが、特定条件で失敗し得る／情報が欠落する |
| **ok** | 実装スキーマが実 API JSON 例と整合（未露出の追加フィールドはあってもパースは安全） |
| **要実機確認** | docs が nullable / absent / 型を明記しておらず、JSON 例だけでは断定できない箇所。推測で ok 判定せず保留（CLAUDE.md の日付キー UTC と同じ慎重さ） |

> **型表記の注意**: bitbank docs の「Type」列は数値フィールドを `number` と書くが、
> 実際の `Response format` JSON 例ではほぼ全て **文字列**（例: `"amount": "string"`）で返る。
> 本監査は JSON 例を優先し、CLI 側 `numStr`（文字列→number 変換）が正しいかで判定した。

## 突合表（endpoint → 判定 → 根拠）

| # | endpoint | 実装ファイル | 判定 | 根拠（要点） |
|---|---|---|---|---|
| 1 | `GET /user/assets` | `private/assets.ts` | **ok** | 実装 5 フィールド（asset/free_amount/locked_amount/onhand_amount/withdrawing_amount）は全て JSON 例と一致・文字列。未露出フィールド（amount_precision 等）はパースに無害 |
| 2 | `GET /user/spot/order` | `private/order.ts`（共有 `OrderSchema`） | **minor** | コアは一致。`trigger_price` / `triggered_at` / `position_side` / `user_cancelable` 未露出（stop 系注文のトリガー情報が欠落） |
| 3 | `GET /user/spot/active_orders` | `private/active-orders.ts`（`OrderSchema`） | **minor** | #2 と同じ |
| 4 | `POST /user/spot/orders_info` | `private/orders-info.ts`（`OrderSchema`） | **minor** | #2 と同じ |
| 5 | `POST /user/spot/order`（create） | `trade/create-order.ts`（`OrderSchema`） | **minor** | #2 と同じ |
| 6 | `POST /user/spot/cancel_order` | `trade/cancel-order.ts`（`CancelOrderSchema`） | **ok** | order_id/pair/side/type/price/status の部分集合のみ受領。全て JSON 例に存在 |
| 7 | `POST /user/spot/cancel_orders` | `trade/cancel-orders.ts`（`CancelOrderSchema[]`） | **ok** | #6 と同じ部分集合 |
| 8 | `GET /user/spot/trade_history` | `private/trade-history.ts` | **minor** | コアは一致。`fee_occurred_amount_quote`（spot でも常時返る）・`position_side` / `profit_loss` / `interest`（信用）が欠落 |
| 9 | `GET /user/margin/status` | `private/margin-status.ts` | **ok** | PR #280 で修正済み。JSON 例と完全一致 |
| 10 | `GET /user/margin/positions` | `private/margin-positions.ts` | **ok** | PR #281 で修正済み。JSON 例と完全一致 |
| 11 | `GET /user/deposit_history` | `private/deposit-history.ts` | **minor** ＋要実機確認 | `confirmed_at` を `nullable` だが **非 optional**。docs「exists only for confirmed one」＝ FOUND 時はキー欠落の可能性 → パース失敗リスク。`address` / `network` 欠落 |
| 12 | `GET /user/unconfirmed_deposits` | `private/unconfirmed-deposits.ts` | **critical** | 実装 `found_at`（必須）だが実 API は **`created_at`**。`found_at` キー不在 → パース失敗。margin と同型。`network` も欠落 |
| 13 | `GET /user/deposit_originators` | `private/deposit-originators.ts` | **critical** | 実装が要求する `address` / `asset` は **実 API に存在しない**。実 API は `deposit_type` / `originator_status` / `originator_*` / `originator_substantial_controllers` の全く別構造 → パース失敗。margin と同型 |
| 14 | `GET /user/withdrawal_account` | `private/withdrawal-accounts.ts` | **minor** | `network` フィールド欠落（情報のみ）。受領フィールドは一致 |
| 15 | `GET /user/withdrawal_history` | `private/withdrawal-history.ts` | **minor** ＋要実機確認 | `address` を **非 nullable** で必須。docs「only for crypto assets」＝ fiat(JPY) 出金では欠落の可能性 → パース失敗リスク。`account_uuid` / `network` / `destination_tag` / `bank_*` 等多数欠落 |
| 16 | `POST /user/confirm_deposits` | `trade/confirm-deposits.ts` | **critical** | レスポンスは実 API では **`data: {}`（空）**。実装は `{uuid, status}` を必須 → 成功時もパース失敗（silent success）。加えてリクエストボディも乖離（実装 `{id}` vs 実 API `{deposits:[{uuid, originator_uuid}]}`） |
| 17 | `POST /user/confirm_deposits_all` | `trade/confirm-deposits-all.ts` | **critical** | レスポンスは実 API では **`data: {}`（空）**。実装は `{status}` を必須 → 成功時もパース失敗。加えてリクエスト必須 `{originator_uuid}` を送っていない |

## モック（テスト）の検証 — 自己完結トートロジーの有無

margin と同じく、乖離エンドポイントのテストは**実装の架空フィールドをそのままモックに書いて
グリーン**になっており、実 API 形状を一切検証していない（トートロジー）。

| endpoint | テスト | モック形状 | 問題 |
|---|---|---|---|
| unconfirmed_deposits | `private/unconfirmed-deposits.test.ts` | `{...,found_at: 1234567890123}` | 実 API の `created_at` ではなく実装の `found_at` を使用。乖離を隠蔽 |
| deposit_originators | `private/deposit-originators.test.ts` | `{uuid,label,address,asset}` | 実 API に無い `address`/`asset` を使用。実構造（deposit_type 等）を検証せず |
| confirm_deposits | `trade/confirm-deposits.test.ts` | `data:{uuid:"abc",status:"CONFIRMED"}` | 実 API の `{}` ではなく実装の架空 2 フィールドを使用。リクエストボディ形状も未検証 |
| confirm_deposits_all | `trade/confirm-deposits-all.test.ts` | `data:{status:"CONFIRMED"}` | 同上 |
| deposit_history | `private/deposit-history.test.ts` | 常に `confirmed_at` あり | FOUND（confirmed_at 欠落）ケースを検証せず |
| withdrawal_history | `private/withdrawal-history.test.ts` | 常に `address` あり（crypto） | fiat（address 欠落）ケースを検証せず |

> 共有フィクスチャ（`cli/__tests__/__fixtures__/private/`）と chaos `x18` は現状 **margin のみ**を
> カバーする（`x18` の `MARGIN_TESTS` 限定）。本監査の結果に基づき、各 fix で対象テストを
> フィクスチャ化し `x18` の対象に追加することを推奨する。

## 追従 issue ブリーフ（PR1 / PR2 様式）

> 本タスクでは**コード修正しない**。fix は下記 issue ごとに別 PR で行う。
> 各ブリーフは「位置づけ / 背景 / 症状 / 修正方針 / 完了条件 / 注意」で統一。

### ISSUE-A（critical）: `unconfirmed_deposits` フィールド名 `found_at` → `created_at`

- **位置づけ**: 単一 fix PR。本監査が親。margin PR #280/#281 と同型。
- **背景**: 実 API `GET /user/unconfirmed_deposits` の JSON 例は時刻フィールドを
  `created_at` で返すが、実装 `UnconfirmedDepositSchema` は `found_at: z.number()` を必須にしている。
- **症状**: 実レスポンスに `found_at` が無く `created_at` がある → Zod パース失敗。
  未確認入金が 1 件でもあると `unconfirmed-deposits` が常に失敗する。テストは `found_at` を
  使った自己完結モックでグリーンのため検知できていない。
- **修正方針**: `found_at` → `created_at` にリネーム。欠落の `network: z.string()` を追加。
  テストを `__fixtures__/private/unconfirmed-deposits.ts`（実 API JSON 例由来）に集約し、
  chaos `x18` の対象に追加。
- **完了条件**: フィクスチャが実 API 形状（`created_at` / `network` あり、`found_at` なし）。
  実装がそれをパースできる。`x18` が当該テストのフィクスチャ参照を強制。
- **注意**: `txid` は docs 本文 `string`（null 記載なし）。現実装の `.nullable()` は安全側。
  維持で可。

### ISSUE-B（critical）: `deposit_originators` 架空フィールド `address` / `asset`

- **位置づけ**: 単一 fix PR。本監査が親。margin と同型（スキーマの作り話）。
- **背景**: 実 API `GET /user/deposit_originators` の JSON 例は
  `uuid / label / deposit_type / deposit_purpose / originator_status / originator_type /
  originator_*（氏名・住所・会社情報）/ originator_substantial_controllers[]` を返すが、
  実装 `OriginatorSchema` は `{uuid, label, address, asset, network?}` という**全く異なる**構造。
- **症状**: 実 API に `address` / `asset` が無く必須要求しているためパース失敗。
  `deposit-originators` がオリジネーター 1 件でも常に失敗する。テストは
  `{uuid,label,address,asset}` の架空モックでグリーン。
- **修正方針**: 実 API JSON 例に沿って `OriginatorSchema` を再定義。null を返し得る
  `originator_*` 群は `nullable`、`originator_substantial_controllers` はネスト配列スキーマで。
  テストを `__fixtures__/private/deposit-originators.ts` に集約し `x18` 対象化。
- **完了条件**: 実 API JSON 例（本レポート添付の構造）をそのままパースできる。
  架空の `address` / `asset` を含まない。
- **注意**: docs 表に `originator_substantial_controllers` のキー名が `uuid/name/country/prefecture`
  と内側 originator と重複表記される箇所がある。JSON 例（`originator_substantial_controllers: [...]`）を
  正とする。`prefecture` は null あり。

### ISSUE-C（critical）: `confirm_deposits` / `confirm_deposits_all` レスポンス空 `{}`・リクエストボディ乖離

- **位置づけ**: 単一 fix PR（confirm 系 POST 2 本をまとめて）。本監査が親。
- **背景**: 実 API は両エンドポイントとも成功時に `data: {}`（空オブジェクト）を返す。
  実装は `confirm_deposits` で `{uuid, status}`、`confirm_deposits_all` で `{status}` を必須。
  さらにリクエストボディも乖離: `confirm_deposits` は実 API が `{deposits:[{uuid, originator_uuid}]}` を
  要求するが実装は `{id}` を送る。`confirm_deposits_all` は実 API が必須 `{originator_uuid}` を要求するが
  実装は本体なし。
- **症状**: (1) 成功レスポンス `{}` をパースできず CLI が「失敗」を返す（**silent success**: 実際は
  確認処理が通っている可能性）。(2) リクエスト形状が違うため API がそもそも 400/エラーを返す。
  trade 系は POST 非冪等のため特に危険（`trading-safety.md` の silent success と同じ箇所）。
- **修正方針**: レスポンススキーマを「空 `data`」を許容する形（例: `z.object({}).passthrough()` 等）に。
  リクエストボディを実 API 仕様（`deposits` 配列 / `originator_uuid`）に合わせ、CLI 入力 I/F
  （現 `--id`）も再設計。`--execute` / `--confirm` ガードは維持（フレーズ表は
  `trading-safety.md` 準拠）。
- **完了条件**: 空レスポンスを成功として扱える。送信ボディが実 API 必須項目を満たす。
  テストで「成功 `{}` レスポンス → success: true」「ボディ形状が実 API 仕様」を検証
  （実 API は叩かず mock）。
- **注意**: これは**リクエスト**側も含む二重乖離。本監査は主にレスポンス突合だが、confirm 系は
  リクエストボディも実機未検証のため**要実機確認**。POST はリトライ無効（冪等性保護）を維持。

### ISSUE-D（minor ＋要実機確認）: `deposit_history` `confirmed_at` の optional 取り違え・欠落フィールド

- **位置づけ**: 単一 fix PR。優先度はパース失敗リスクのため critical 寄りだが、欠落 vs null が
  未確認のため minor＋保留。
- **背景**: docs「`confirmed_at` … exists only for confirmed one」。実装は
  `confirmed_at: z.number().nullable()`（**非 optional**）。FOUND ステータスの入金では
  キー自体が欠落する可能性があり、その場合パース失敗。加えて `address` / `network` 欠落。
- **症状（想定）**: 確認前（FOUND）の入金履歴が混ざると `deposit-history` がパース失敗し得る。
- **修正方針**: `confirmed_at` を `.nullable().optional()` に。`address: z.string()` /
  `network: z.string()` を追加。フィクスチャに「FOUND（confirmed_at 欠落）」「CONFIRMED」両ケースを置く。
- **完了条件**: 両ケースをパースできる。フィクスチャ集約＋ `x18` 対象化。
- **注意・要実機確認**: docs は「欠落」か「`null`」かを JSON 例で示していない（例は `0`）。
  `.nullable().optional()` は両方を許容する安全側だが、実機で FOUND 入金のレスポンスを確認して確定すること。

### ISSUE-E（minor ＋要実機確認）: `withdrawal_history` `address` 非 nullable・fiat 出金欠落フィールド

- **位置づけ**: 単一 fix PR。fiat(JPY) 出金でパース失敗リスク。
- **背景**: docs「`address` … only for crypto assets」。実装は `address: z.string()`（必須・非 nullable）。
  JPY 等 fiat 出金履歴では `address` が欠落 → パース失敗リスク。`account_uuid` / `network` /
  `destination_tag`（number or string）/ `bank_name` / `branch_name` / `account_type` /
  `account_number` / `account_owner` も欠落。`label` も「only for crypto」で fiat 時欠落の可能性。
- **症状（想定）**: JPY 出金履歴を含むと `withdrawal-history` がパース失敗し得る。crypto のみなら通る。
- **修正方針**: crypto/fiat で出る項目を `.nullable().optional()` に整理。
  `destination_tag` は `z.union([z.number(), z.string()]).nullable().optional()`。
  必要なフィールドを露出。crypto 出金 / fiat 出金の 2 フィクスチャを用意。
- **完了条件**: crypto・fiat 双方のレスポンスをパースできる。フィクスチャ集約＋ `x18` 対象化。
- **注意・要実機確認**: 各フィールドが fiat/crypto でキー欠落か `null` かは JSON 例だけでは断定不可。
  実機（JPY 出金あり口座）で確認のうえ確定すること。

### ISSUE-F（minor）: 共有 `OrderSchema` / `trade_history` の欠落フィールド（情報露出）

- **位置づけ**: 単一 fix PR。パース失敗は無し。情報欠落の解消（低優先）。
- **背景**: `OrderSchema`（order / active_orders / orders_info / create-order が共有）は
  `position_side` / `user_cancelable` / `triggered_at` / `trigger_price` を露出していない。
  `trade_history` は `fee_occurred_amount_quote`（spot でも常時返る）/ `position_side` /
  `profit_loss` / `interest` を露出していない。
- **症状**: パースは通るが、stop 系注文のトリガー価格・信用建玉情報・実現損益が CLI から見えない。
- **修正方針**: 各フィールドを適切な nullable/optional で追加（stop 系限定フィールドは optional）。
- **完了条件**: 追加フィールドを含むフィクスチャでパース・露出を検証。
- **注意**: `GET /user/withdrawal_account` の `network` 欠落（#14）も同質の情報欠落。本 issue に含めるか
  別 issue にするかは実装者判断（小さいので本 issue に同梱可）。

## 完了条件チェック（本監査タスク）

- [x] 全 private/trade エンドポイント（17 件）の突合表を docs に記載
- [x] 乖離ごとに重大度（critical×3 / minor×5 / ok×9）と追従 issue（A〜F）を紐付け
- [x] テストモックが実 API 形状か（トートロジー隠蔽の有無）を併記
- [x] docs が型/欠落/null を明記しない箇所は「要実機確認」で保留（推測で ok にしない）
- [x] 本タスクではコード修正しない（fix は各 issue → 別 PR）

## 参考

- レビュー観点（モックの実 API 準拠）: `docs/dev/conventions.md`「private モックの実 API 準拠」
- 取引安全（POST 非冪等・silent success）: `.claude/rules/trading-safety.md`
- 共有フィクスチャ / chaos `x18`: `cli/__tests__/__fixtures__/private/`,
  `cli/__tests__/chaos/conventions/x18-private-mock-fixtures.test.ts`
