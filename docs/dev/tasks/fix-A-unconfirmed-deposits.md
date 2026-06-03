# タスク依頼 PR-A（critical）: `unconfirmed_deposits` フィールド名 `found_at` → `created_at`

## 位置づけ
- 単一 fix PR。親は監査レポート `docs/dev/audit-private-trade-schema-divergence.md`（突合表 #12 / ISSUE-A）。
- margin バグ（PR #280 / #281）と同型の「実装の架空フィールド名が実 API と不一致 → 本番パース失敗」。
- **前提**: 基盤 PR-0（chaos `x18` の一般化）が先に入っていることが望ましい。未マージなら本 PR 内で
  当該テストを `x18` の検査対象に追加する（手順 4 参照）。
- 他の fix（B/C）とは独立。並行着手可。

## 背景
実 API `GET /user/unconfirmed_deposits` の `Response format` JSON 例:

```json
{ "uuid": "string", "asset": "string", "amount": "string",
  "network": "string", "txid": "string", "created_at": 0 }
```

現実装 `cli/commands/private/unconfirmed-deposits.ts` の `UnconfirmedDepositSchema`:

```
{ uuid, asset, amount: numStr, txid: string|null, found_at: z.number() }
```

- 時刻フィールドが **`found_at`（実装）vs `created_at`（実 API）** で不一致。
- `network` が欠落。

## 症状
- 実レスポンスに `found_at` が無く `created_at` がある → 必須 `found_at` が欠落し Zod パース失敗。
- 未確認入金が 1 件でも存在すると `unconfirmed-deposits` コマンドが**常に失敗**する。
- テスト `cli/__tests__/private/unconfirmed-deposits.test.ts`（L7 の mock が `found_at` を使用）は
  実装と同じ架空フィールドの自己完結トートロジーのためグリーンで、乖離を検知できていない。

## 実装手順
1. `cli/commands/private/unconfirmed-deposits.ts`:
   - `found_at: z.number()` → `created_at: z.number()` にリネーム。
   - `network: z.string()` を追加。
2. 共有フィクスチャ新設 `cli/__tests__/__fixtures__/private/unconfirmed-deposits.ts`:
   - 実 API JSON 例の**生形状**（`amount` は文字列のまま、`created_at` は number、`network` あり、
     `found_at` は持たない）。
   - 冒頭コメントに由来（本監査 / rest-api.md `GET /user/unconfirmed_deposits`）を明記。
3. `cli/__tests__/private/unconfirmed-deposits.test.ts`:
   - インライン mock を撤去し、上記フィクスチャを import して使う。
   - 変換後の期待値（`created_at` が number として通る等）はテスト側で検証。
4. chaos `x18`:
   - PR-0 一般化済みなら自動で対象化（フィクスチャ追加だけで enroll）。
   - 未一般化なら `cli/__tests__/chaos/conventions/x18-private-mock-fixtures.test.ts` の対象リストに
     `unconfirmed-deposits.test.ts` を追加。
5. 出力フィールドを変える場合（`network` を露出する等）は `cli/commands/schema/defs-*.ts` の output を
   更新し、`npx tsx scripts/gen-agents-catalog.ts` で `agents/` を再生成（chaos `x17` 差分ゼロ）。

## 完了条件
- フィクスチャが実 API 形状（`created_at` / `network` あり、`found_at` なし）。
- 実装がそのフィクスチャをパースできる。
- 当該テストがインライン mock を持たず、フィクスチャ参照で `x18` グリーン。
- `npm test` 全グリーン。catalog を触った場合 `x17` グリーン。

## 注意
- `txid` は docs 本文では `string`（null 記載なし）だが、現実装の `.nullable()` は安全側。維持で可。
- 本エンドポイントはレスポンスのみの修正で、リクエスト側（パラメータ None）に乖離はない。

## 参照
- 監査レポート: `docs/dev/audit-private-trade-schema-divergence.md`
- レビュー観点: `docs/dev/conventions.md`「private モックの実 API 準拠」
- 実 API: rest-api.md `Fetch unconfirmed deposits`
