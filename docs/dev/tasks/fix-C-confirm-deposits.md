# タスク依頼 PR-C（critical）: `confirm_deposits` / `confirm_deposits_all` の空レスポンス対応＋リクエスト I/F 再設計

## 位置づけ
- 単一 fix PR（confirm 系 POST 2 本をまとめて）。親は監査レポート
  `docs/dev/audit-private-trade-schema-divergence.md`（突合表 #16・#17 / ISSUE-C）。
- **A〜C の中で最大・最リスク**。レスポンスだけでなく**リクエストボディと CLI 入力 I/F**が乖離しており、
  trade 系（POST 非冪等・silent success リスク）に直結する。**実機確認を経てから着手推奨**。
- **前提**: 基盤 PR-0（`x18` 一般化）が望ましい。A/B とは独立だが、影響範囲が広いので単独で進める。

## 背景
実 API（両エンドポイントとも成功時）の `Response format`:

```json
{ "success": 1, "data": {} }
```

リクエスト仕様:
- `POST /user/confirm_deposits` requestBody: `{ "deposits": [ { "uuid": "...", "originator_uuid": "..." } ] }`
- `POST /user/confirm_deposits_all` requestBody: `{ "originator_uuid": "..." }`（必須）

現実装:
- `cli/commands/trade/confirm-deposits.ts`
  - レスポンス schema `{ uuid: string, status: string }`（必須）
  - リクエストボディ `{ id: parsed.data.id }`（`--id` は `IntegerStringSchema` = 正の整数）
- `cli/commands/trade/confirm-deposits-all.ts`
  - レスポンス schema `{ status: string }`（必須）
  - リクエストボディ無し（`undefined`）

→ **三重の乖離**: ①レスポンス形状 ②リクエストボディ形状 ③入力型（deposit/originator は UUID 文字列で
あって整数 `id` ではない）。

## 症状
- **silent success**: 成功レスポンス `{}` を必須フィールド付き schema でパースできず、CLI が「失敗」を返す。
  実際には確認処理が通っている可能性がある（`trading-safety.md` の POST 非冪等・silent success と同箇所）。
- **リクエスト不正**: 送信ボディが実 API 仕様と異なるため、API 自体がエラー（400 等）を返す or 期待動作しない。
- テスト `cli/__tests__/trade/confirm-deposits.test.ts`（`data:{uuid:"abc",status:"CONFIRMED"}`）・
  `confirm-deposits-all.test.ts`（`data:{status:"CONFIRMED"}`）は架空レスポンスの自己完結モックでグリーン。
  リクエストボディ形状も未検証。

## 実装手順
1. **要実機確認（最優先）**: テスト用口座で両エンドポイントの実 request/response を確認し、
   - 成功時 `data` が本当に空 `{}` か
   - `confirm_deposits` の `deposits[]` 各要素のキー（`uuid` / `originator_uuid`）と必須性
   - `confirm_deposits_all` の `originator_uuid` 必須性
   を確定する。確定内容を PR 説明に記録。
2. レスポンススキーマ（両ファイル）を**空 `data` 許容**へ:
   - 例: `z.object({}).passthrough()`（将来フィールド追加に耐性）。`parseResponse` が成功を返すことを担保。
3. リクエストボディ・入力 I/F 再設計:
   - `confirm-deposits.ts`: 入力を「deposit uuid と originator uuid のペア（複数可）」へ。
     `--id`（整数）を廃し、UUID 検証（`validators.ts` の `UuidSchema`）を用いる新フラグへ
     （例 `--deposits=<uuid>:<originator_uuid>,...` 等、設計は要検討）。body を
     `{ deposits: [{ uuid, originator_uuid }] }` に。
   - `confirm-deposits-all.ts`: `--originator-uuid`（必須・`UuidSchema`）を追加し、
     body を `{ originator_uuid }` に。
4. 配線・カタログを同期:
   - `cli/commands/trade-handlers.ts`（`confirm-deposits` の `options` / 引数マッピング、現 `id: str`）。
   - `cli/commands/schema/defs-trade.ts`（`params` と `output`。現 output が `{ id, status }` で実態とも不一致）。
   - `cli/commands/trade/dry-run.ts`（dry-run 表示の `body` / `endpoint`）。
   - `npx tsx scripts/gen-agents-catalog.ts` で `agents/tool-catalog.json` 等を再生成（chaos `x17` 差分ゼロ）。
5. trade 安全ガード維持:
   - `--execute` / `--confirm` を維持。フレーズは `confirm-guard.ts` の `CONFIRM_PHRASES`
     （`I-UNDERSTAND-CONFIRM-DEPOSITS` / `I-UNDERSTAND-CONFIRM-DEPOSITS-ALL`）。`.superRefine()` 経由を踏襲。
   - POST は `retries: 0` / `retryOnNetworkError: false`（`http-private-post.ts`）を変更しない。
6. テスト:
   - 成功 `{}` レスポンス → `success: true` を検証（実 API は叩かず mock）。
   - 送信ボディが実 API 仕様（`deposits[]` / `originator_uuid`）であることを fetch mock の引数で検証。
   - `--execute` 単独・`--confirm` 不一致で fetch 未呼び出しを検証（ドライラン維持）。
   - フィクスチャ化が適切なら `__fixtures__` 化し `x18` 対象に（空レスポンスは inline でも可、判断を記載）。

## 完了条件
- 空 `data` を成功として扱える（silent success を解消）。
- 送信ボディが実 API 必須項目を満たす（`deposits[]` / `originator_uuid`）。入力 I/F が UUID ベース。
- `trade-handlers.ts` / `defs-trade.ts` / `dry-run.ts` / `agents/` カタログが整合（`x17` グリーン）。
- 安全ガード（`--execute`/`--confirm`/POST 非リトライ）が維持されている。
- `npm test` 全グリーン。実機確認の結果が PR 説明に明記されている。

## 注意
- **本 PR は request 側を含む二重以上の乖離**。監査本体（レスポンス突合）の範囲を超えるため、
  リクエスト仕様は必ず実機で裏取りしてから実装する（推測で確定しない＝`要実機確認`）。
- 入力 I/F の具体的なフラグ設計（複数ペアの渡し方）は本 PR の設計判断。`.claude/rules/commands.md` の
  secret/flag 方針と整合させる（confirm 系は機微情報ではないが、UUID 形式検証は必須）。
- POST 失敗時の状態確認導線（`active-orders` 等での再確認）は `trading-safety.md` を踏襲。

## 参照
- 監査レポート: `docs/dev/audit-private-trade-schema-divergence.md`
- 取引安全: `.claude/rules/trading-safety.md` / `cli/commands/trade/confirm-guard.ts`
- 実 API: rest-api.md `Confirm deposits` / `Confirm all deposits`
