# タスク依頼 PR-B（critical）: `deposit_originators` 架空フィールド `address` / `asset` の全面是正

## 位置づけ
- 単一 fix PR。親は監査レポート `docs/dev/audit-private-trade-schema-divergence.md`（突合表 #13 / ISSUE-B）。
- margin と同型（スキーマがほぼ作り話）。実装フィールドが実 API と**全く別構造**。
- **前提**: 基盤 PR-0（chaos `x18` 一般化）が望ましい。未マージなら本 PR で `x18` 対象追加（手順 5）。
- A/C とは独立。並行着手可。

## 背景
実 API `GET /user/deposit_originators` の `Response format` JSON 例（`originators[]` の要素）:

```json
{
  "uuid": "string", "label": "string",
  "deposit_type": "string", "deposit_purpose": "string|null",
  "originator_status": "string", "originator_type": "string",
  "originator_last_name": null, "originator_first_name": null,
  "originator_country": "string", "originator_prefecture": "string",
  "originator_city": "string", "originator_address": "string",
  "originator_building": null, "originator_company_name": "string",
  "originator_company_type": "string", "originator_company_type_position": "string",
  "originator_substantial_controllers": [
    { "uuid": "string", "name": "string", "country": "string", "prefecture": null }
  ]
}
```

現実装 `cli/commands/private/deposit-originators.ts` の `OriginatorSchema`:

```
{ uuid, label, address: z.string(), asset: z.string(), network: z.string().optional() }
```

→ 実 API に **`address` / `asset` / `network` は存在しない**。実構造は `deposit_type` /
`originator_status` / `originator_*`（氏名・住所・会社情報）/ `originator_substantial_controllers[]`。

## 症状
- 実 API に無い `address` / `asset` を必須要求 → オリジネーターが 1 件でもあるとパース失敗。
- `deposit-originators` コマンドが**常に失敗**する。
- テスト `cli/__tests__/private/deposit-originators.test.ts`（L6 の mock が `{uuid,label,address,asset}`）は
  自己完結トートロジーでグリーン。

## 実装手順
1. `cli/commands/private/deposit-originators.ts`:
   - `OriginatorSchema` を実 API JSON 例に沿って再定義。
   - `null` を返し得る `deposit_purpose` / `originator_last_name` / `originator_first_name` /
     `originator_country` / `originator_prefecture` / `originator_city` / `originator_address` /
     `originator_building` / `originator_company_name` / `originator_company_type` /
     `originator_company_type_position` は `z.string().nullable()`。
   - `originator_substantial_controllers` はネスト配列スキーマ
     `z.array(z.object({ uuid, name, country, prefecture: z.string().nullable() }))`。
   - 架空の `address` / `asset` / `network` を削除。
2. 共有フィクスチャ新設 `cli/__tests__/__fixtures__/private/deposit-originators.ts`:
   - 実 API JSON 例の生形状（null 値を含む代表ケース）。冒頭に由来コメント。
3. `cli/__tests__/private/deposit-originators.test.ts`:
   - インライン mock を撤去しフィクスチャ参照に。null フィールドが通ることを検証。
4. **要実機確認（リクエスト側）**: docs は `GET /user/deposit_originators` の Parameters を **None** と
   記載。現実装は `asset` を必須にし `params { asset }` を送る（`depositOriginators({ asset })`）。
   実機で「`asset` 必須か / 無視されるか」を確認し、不要なら**入力 I/F から `asset` を外す**。
   外す場合は `cli/commands/trade-handlers.ts` 相当の private 配線・`schema/defs-*.ts` の params も更新。
5. chaos `x18`: PR-0 済みなら自動。未済なら対象リストに `deposit-originators.test.ts` を追加。
6. params / output を変更したら `npx tsx scripts/gen-agents-catalog.ts` で再生成（`x17` 差分ゼロ）。

## 完了条件
- 実 API JSON 例（null を含む）をそのままパースできる。架空の `address` / `asset` を含まない。
- リクエスト `asset` の要否を実機確認のうえ確定（外した／残した理由を PR 説明に明記）。
- フィクスチャ集約＋ `x18` グリーン、`npm test` 全グリーン。

## 注意
- docs 表では `originator_substantial_controllers` の内側キーが本体 originator と重複表記される箇所が
  あるが、**JSON 例**（`uuid/name/country/prefecture`）を正とする。`prefecture` は null あり。
- 露出するフィールドが多い。CLI 出力（table/csv）の列設計は別途検討（最低限 JSON で全フィールドを返す）。

## 参照
- 監査レポート: `docs/dev/audit-private-trade-schema-divergence.md`
- 実 API: rest-api.md `Fetch deposit originators`
