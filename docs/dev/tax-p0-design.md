# 税務データ整形 P0 設計メモ

> 作成: 2026-07-25。対象は [tax-requirements.md](tax-requirements.md) §10 の **P0 1〜4**。
> 税務ルールの正は [tax-research.md](tax-research.md)（v2.1）。矛盾時は v2 を採る。
> 実装着手前のレビュー用。**要判断**（§4）が解けるまでコードは書かない。

## 1. 正規化スキーマ型定義案（v2 §13 準拠）

Zod が型の単一ソース（CLAUDE.md）。`z.infer` で型を導出し、手書き interface は置かない。

```ts
// cli/tax/schema/primitives.ts
/** 十進文字列。float 化しないための表現型（後述 §4-2 の decStr） */
export const decStr = z.string().regex(/^-?\d+(\.\d+)?$/, "decimal string required");

export const Venue = z.enum(["BITBANK", "EXTERNAL_EXCHANGE", "SELF_WALLET", "COUNTERPARTY", "UNKNOWN"]);
export const RecognitionPolicy = z.enum(["DELIVERY_DATE", "CONTRACT_DATE"]); // P-09
export const TransferReason = z.enum([
  "SELF_TRANSFER", "PURCHASE_EXTERNAL", "GIFT", "INHERITANCE", "REWARD", "PAYMENT", "UNKNOWN",
]);
export const CostbasisProvenance = z.enum([
  "PURCHASE", "EXCHANGE_FMV", "REWARD_FMV", "ZERO_FORK", "CARRYOVER",
  "INHERITED_BOOK", "GIFT_FMV", "LOW_PRICE_SUM", "DEEMED_5PCT", "MANUAL",
]);
export const EventFlag = z.enum([
  "UNRESOLVED_TRANSFER",  // v2 §13.3: 解決まで当該銘柄の参考損益をブロック
  "NO_RATE", "USER_CONFIRMED", "POSSIBLE_ICHIJI_SHOTOKU", // §7 P-08
  "GRANT_SUSPECT",        // 付録E.3: txid=null、または 円未満端数 & found_at==confirmed_at & 秒以下 00.000
  "FEE_API_ROUNDED",      // 付録E.1: API 手数料は 4 桁丸め値（P-16）
  "NON_JPY_QUOTE",        // 付録E.5: BTC 建てペア検出（TRADE_EXCHANGE 経路 or 明示エラー）
  "UNOBSERVED_SHAPE",     // §9-8: 未観測形状 → 保留リスト
]);
```

```ts
// cli/tax/schema/event.ts — v2 §13.2 の Event
export const EventKind = z.enum([
  "TRADE_SPOT_BUY", "TRADE_SPOT_SELL", "TRADE_EXCHANGE",
  "MARGIN_OPEN", "MARGIN_CLOSE", "FEE", "REBATE",
  "LENDING_REWARD", "CAMPAIGN_REWARD", "AIRDROP", "FORK_RECEIPT",
  "DEPOSIT", "WITHDRAWAL", "PAYMENT",
  "GIFT_OUT", "GIFT_IN", "BEQUEST_OUT", "INHERITANCE_IN", "LOW_PRICE_TRANSFER", "DONATION",
  "ADJUSTMENT",
]);

export const TaxEvent = z.object({
  event_id: z.string(),                 // 決定論的に生成（下記）
  source_ref: z.string(),               // trade_id / uuid（監査・重複排除）
  ts_utc: z.number().int(),             // API の Unix ms をそのまま
  ts_jst: z.string(),                   // jstIso() の +09:00 付き ISO
  year_jst: z.number().int(),           // jstYear()。年分判定はこれだけを使う
  account_id: z.string(),               // 既定 "bitbank:default"（サブアカウントは P2）
  kind: EventKind,
  currency: z.string(),                 // 名寄せ後の資産キー（matic→pol, rndr→render のみ）
  qty: decStr,
  jpy_value: decStr.optional(),
  rate_source: z.object({               // §6 P-07 の監査情報
    pair: z.string(), venue: Venue, method: z.enum(["LAST_TRADE", "VIA_PAIR", "EXTERNAL", "MANUAL"]),
    ts_utc: z.number().int(), path: z.array(z.string()),
  }).optional(),
  transfer: z.object({
    counter_account_id: z.string().optional(),
    transfer_group_id: z.string().optional(),
    reason: TransferReason,
    fee_qty: decStr.optional(),         // 付録E.3: 出庫の資産減少 = amount + fee
  }).optional(),
  margin: z.object({                    // §5・付録E.2
    position_side: z.enum(["long", "short"]),
    role: z.enum(["OPEN", "CLOSE"]),    // API に無いのでトラッカーが決定（§2 margin-tracker）
    realized_net: decStr.optional(),    // profit_loss（ネット。再控除禁止）
    interest: decStr.optional(),
    fee_charged: decStr.optional(),     // fee_amount_quote（決済時は建て分込みの累計）
    fee_occurred: decStr.optional(),    // fee_occurred_amount_quote
  }).optional(),
  fee: z.object({                       // 現物の手数料内訳（§4）
    quote_charged: decStr, quote_occurred: decStr, base: decStr,
  }).optional(),
  costbasis_provenance: CostbasisProvenance.optional(), // 取得系イベントに必須（検証で強制）
  recognition_policy: RecognitionPolicy,
  flags: z.array(EventFlag),
  pair_raw: z.string().optional(),      // 付録E.5: ペア名は生値保持（名寄せしない）
});
export type TaxEvent = z.infer<typeof TaxEvent>;
```

- `event_id` は `<kind>:<source_ref>`（trade は `trade:<trade_id>`、入出庫は `dep:<uuid>`/`wd:<uuid>`）
  で決定論的に生成する。再取得で同一 → 冪等性（NFR）と重複排除を同じキーで満たす
- **仕訳（ledger）は Event から派生させる別型**にする。v2 §13.3 のパイプライン
  `Event列 → ACQUIRE/DISPOSE/INCOME/EXPENSE → 平均法 → レポート`。変換規則は v2 付録A の表が単一ソース

```ts
// cli/tax/schema/ledger.ts
export const LedgerKind = z.enum(["ACQUIRE", "DISPOSE", "INCOME", "EXPENSE"]);
export const LedgerEntry = z.object({
  event_id: z.string(), seq: z.number().int(),   // 同一 event 由来の複数仕訳を安定順序化
  kind: LedgerKind, currency: z.string(), year_jst: z.number().int(),
  ts_utc: z.number().int(), sort_key: z.string(),  // (ts_utc, source_ref) の安定ソート用
  qty: decStr,                                    // ACQUIRE/DISPOSE のみ
  cost_jpy: decStr.optional(),                    // ACQUIRE: 取得価額（購入手数料込み）
  proceeds_jpy: decStr.optional(),                // DISPOSE: 譲渡価額
  amount_jpy: decStr.optional(),                  // INCOME/EXPENSE
  category: z.string(),                           // "rebate_income" / "expense_fee" / "margin_net" 等
  policy_ids: z.array(z.string()),                // 適用した【方針】ID（P-04 等）をレポートに露出
});
```

## 2. モジュール分割案

1 ファイル 100 行が目安（chaos x04）なので、責務ごとに小さく割る。依存は上から下の一方向。

```
cli/tax/
  ratio.ts            # 厳密有理数（BigInt 分子/分母）: 四則・比較・floor/ceil/roundHalfUp・十進化
  ratio-parse.ts      # 十進文字列 ⇄ 有理数（float を一切経由しない）
  schema/
    primitives.ts     # decStr / enum 群（§1）
    event.ts          # TaxEvent
    ledger.ts         # LedgerEntry
    report.ts         # レポート出力型
  import/
    raw-trade.ts      # trade_history の「文字列保持」スキーマ（既存 numStr 経路とは別。§4-2）
    raw-transfer.ts   # deposit/withdrawal の文字列保持スキーマ
    fetch-trades.ts   # 全ペア横断取得（既存 tradeHistoryAllPairs を再利用）+ trade_id dedup
    fetch-deposits.ts # ★2系統取得（asset 省略=crypto / asset=jpy=fiat）+ uuid dedup
    fetch-withdrawals.ts # 全 asset 巡回 + uuid dedup + CANCELED 除外
    margin-tracker.ts # position_side + 数量積み上げで OPEN/CLOSE 判定（付録E.2。profit_loss では判定しない）
    to-events.ts      # 生レコード → TaxEvent（現物/信用の振り分け・非JPY quote 検出）
    grant-suspect.ts  # 付録E.3 の付与痕跡判定（txid=null ／ 円未満端数 & found_at==confirmed_at & 秒以下 00.000）
    symbol-alias.ts   # {matic→pol, rndr→render} のみ。mkr→sky は名寄せ禁止（手動マスタ）
  ledger/
    from-events.ts    # 付録A の対応表に従い LedgerEntry へ
  reconcile/
    rebuild.ts        # Event 列 → 資産別理論残高（出庫は amount+fee で減算）
    compare.ts        # /user/assets と突合・ダスト閾値・残差の符号診断（ガード(d) / P-17）
  engine/
    total-average.ts  # 総平均法（v2 §3）
    moving-average.ts # 移動平均法（v2 §3・時系列安定ソート）
    invariants.ts     # I1〜I4 の機械検証
    nta-compat.ts     # NTA_SHEET_2025_12（P1。P0 では型と分岐点だけ用意）
  guard/
    reference-pnl.ts  # ガード(a)〜(d) 判定 → 表示可否とブロック理由
  report/
    build.ts          # 取引集計 + （ガード成立時のみ）参考損益
    disclaimers.ts    # 免責文言（v2 §1.3/§9/§10/§12 から転記。文言は仕様書が単一ソース）
cli/commands/tax/     # CLI 表層（Result パターン・--format=json|table|csv）
  events.ts           # bitbank tax events --year=2026
  reconcile.ts        # bitbank tax reconcile --year=2026
  pnl.ts              # bitbank tax pnl --year=2026 --method=total-average
```

- 登録は `registry.ts` に `TAX_COMMANDS`（`bitbank tax <cmd>`）を追加。`paper`/`profile` と同じ
  サブコマンド形式。**private GET のみ・POST は呼ばない**
- ADR-004 が「CLAUDE.md の例外条項と commands.md のカテゴリ表への追記は実装着手時に行う」と
  規定しているので、この P0 で両方に `tax` を追記する
- 計算は CLI 内（ADR-004 の例外）。Skill 側には計算を置かない

## 3. §9 未確定事項のうち実装に影響するもの（暫定扱い）

実装の分岐に直接効く 5 件だけ挙げる。いずれも**【方針】の判断は変えず**、切替点をコードに残す。

| # | 事項 | 暫定実装 | 切替の残し方 |
|---|---|---|---|
| 1 | ⑩支払手数料が丸め前/後どちらの合計か | **API 値（4 桁丸め）を正**（P-16）。`FEE_API_ROUNDED` フラグを付与 | UI CSV 取込（P1）で完全精度値を併記し突合ログに差分を出す |
| 2 | リベートの扱い | 負 fee → **収入計上**（P-04）。ただし P-04 の簡素化は **JPY ペア限定**（付録E.5）。BTC 建てペアの負 fee は P-11（厳密処理）へ | `policy_ids` に P-04/P-11 を記録。月次キャッシュバックは `ADJUSTMENT`（P1） |
| 3 | 出庫手数料（P-13/P-14） | **必要経費に算入しない**。ただし crypto 出庫手数料は**数量減少として必ず記帳**（残高突合が壊れるため） | 経費算入は engine の入力段でフラグ 1 本。既定 off |
| 4 | MKR→SKY（P-18） | **継続（簿価引継ぎ・課税イベントなし）**。名寄せはせず手動マスタ | 転換を `ADJUSTMENT` 2 本（DISPOSE+ACQUIRE）へ切替可能な形にする |
| 5 | 付与イベント（`GRANT_SUSPECT`）の区分 | 雑所得ラベル + `POSSIBLE_ICHIJI_SHOTOKU`。**取得価額が未解決なので当該銘柄はガード(b)でブロック**し参考損益を出さない | 手動入力（P1）で由来を解決すればガードが通る |

`#6`（P-01〜P-19 全般）は **`policy_ids` を全仕訳に持たせ、レポート末尾に「適用した処理方針」として
一覧出力**する形で吸収する。監修で方針が変わったとき、差し替え箇所が機械的に辿れる。

## 4. 要判断（コード着手前に決めたい）

### 4-1. `fixtures/` がこのリポジトリに存在しない ★ブロッカーではないが回帰資産が欠ける

`tax-requirements.md` は `fixtures/`（実口座の API 生レスポンス・`FIELDS.md`・`ENDPOINTS.md`・
`BALANCE_RECONCILIATION.md`・`SYMBOL_ALIASES.md`・`PAIRS_MASTER.json`・`tests/`・`tools/reconcile.ts`）を
エビデンス兼回帰テスト資産として前提にしているが、**この repo には無い**（別環境で作られたもの）。

影響の切り分け:

- P0-1〜4 の**実装自体は可能**（仕様が v2 付録D/E に十分に落ちている）。テストは合成フィクスチャ
  + 既存 `cli/__tests__/__fixtures__/private/` で書ける
- **できないのは**「実データでの回帰（手数料 4 桁丸めの全行検証・`profit_loss` の誤差ゼロ再現・
  重複排除後の件数一致）」と「`reconcile.ts` の"昇格"」（昇格元が無いので E.3/E.4 から新規実装になる）

判断が必要な点: 実口座データを**この公開フォークに置くか**（機密性の判断はユーザー側）。
置かない場合は、値を匿名化した最小フィクスチャを作るか、回帰テストは別環境に残す。

### 4-2. `float 禁止` が既存の chaos 規約 x14 と正面衝突する ★要方針決定

- v2 P-02 / NFR: 全金額・数量は**文字列 → Decimal 直パース。float 禁止**
- chaos **x14** は逆に「`price`/`amount`/`fee`/`rate`/`pnl`/`vol` を含むフィールドを `z.string()` の
  ままにするのを禁止」し、`numStr`（= **JS number へ変換**）への統一を強制している
- つまり既存 `Trade` スキーマ（`cli/commands/private/trade-history.ts`）は `amount`/`price`/
  `fee_amount_quote` すべて **number 化済み**で、**税務経路からはそのまま使えない**

提案（CLAUDE.md「違反したら無視・回避せず修正する」に従い、回避ではなく規約側を明示的に拡張）:

1. `cli/schema-helpers.ts` に **`decStr`**（十進文字列を検証し文字列のまま保持）を追加
2. x14 の許可リストを `numStr | nullableNumStr | decStr` に拡張し、
   「税務経路（`cli/tax/`）は精度保持のため `decStr` を使う」を規約として明記
3. 税務インポータは既存 private コマンドの戻り値を使わず、**生レスポンスを `decStr` スキーマで
   別途 parse する**（`import/raw-*.ts`）。既存コマンドの出力互換は壊さない

### 4-3. 数値表現 → **決定済み。[ADR-005](../adr/005-tax-exact-rational-arithmetic.md) を参照**

以下は判断前の記述で、2 点誤りがあったため訂正した上で残す（経緯として有用なため）。

- **訂正 1**: 本質は「有理数か十進か」ではなく **「丸めは厳密値に対して 1 回だけ適用し、
  丸め済みの中間値に再度丸めない」** という原則。有理数はその手段
- **訂正 2**: 下表の (c)「差引方式」を*変更*と書いたのは誤り。差引方式は
  [tax-research.md](tax-research.md) §3 の擬似コードが**既に採用済みの現行仕様**
  （付録D.2 の `G = E×F` は国税庁 Excel シート側の数式＝互換モードで再現する対象）。
  I1 は成立させるが互換モードの `ROUNDUP` 境界問題は解決しないため単独の解にはならず、
  有理数と併用する

#### （以下、判断前の記述）I1「Decimal で厳密一致」は有限桁 Decimal では成立しない

総平均法は `E = (B+D)/(A+C)` が割り切れないことがあり（v2 D.2 は非丸め）、
`G = E×F`・`I = E×H` の**直接乗算**を採る。I1 は

```
(B+D) == G + I == E×F + E×H == E×((A+C)) == (B+D)
```

で、**E が厳密なら恒等的に成立**する。しかし decimal.js 等の有限有効桁では E に丸めが入り、
`G + I ≠ B+D`（誤差が残る）ため **I1 の「厳密一致」テストが原理的に通らない**。
互換モードの `ROUNDUP`/`ROUNDDOWN` も、境界値が `66.99999…` と表現されると 1 円ずれる。

選択肢:

| 案 | I1 厳密一致 | 外部依存 | 実装量 | 備考 |
|---|---|---|---|---|
| **(a) BigInt 有理数を自作**（推奨） | ○（恒等的に成立） | **なし** | `ratio.ts` 約 120 行 | CLAUDE.md「外部依存最小」と整合。gcd 約約で分母膨張を抑える。除算は単価計算のみ |
| (b) decimal.js を追加 | ×（許容誤差が必要） | 追加 1 本 | 小 | 依存クールダウン 7 日（`dependency-cooldown.md`）。I1 をトレランス比較に緩める必要 |
| (c) cogs を差引方式に変更 | ○（定義上成立） | なし | 小 | v2 D.2 の `G=E×F` と式が変わる（値は一致するが仕様との対応が薄れる） |

**推奨は (a)**。10^5 件の性能は要計測（NFR）だが、除算が必要なのは単価と移動平均法の処分時のみ。
これは ADR 化する（ロードマップも「Week 6 冒頭に ADR 化」と規定済み）。

### 4-4. `TRADE_EXCHANGE` の優先度が v2 と要求仕様で食い違う ★報告

- v2 付録E.5: 「`TRADE_EXCHANGE` は『予約』ではなく**過年度取込で必須**に格上げ」
- `tax-requirements.md` §10: `TRADE_EXCHANGE`（過年度BTC建てペア）は **P2**
- 同 §3.1 では「非JPYクォートは `TRADE_EXCHANGE` へ振り分け **or 明示エラー**」（P0 の防御要件）

v2 を正とすると、**当年（2026 年分）は BTC 建ての新規約定が発生しない**（15 組は
`stop_order=true` で新規注文停止）ため、当年計算に交換ロジックは不要。必要になるのは
**過年度から簿価を再構築するケース**。よって P0 では
「非JPY quote を検出したら `NON_JPY_QUOTE` フラグ + 当該銘柄をガードでブロック（明示エラー）」
までを実装し、交換の完全計算は P2 のまま——という整理を提案する。この解釈で進めてよいか確認したい。

### 4-5. ロードマップの記述が付録E.5 と不整合 ★軽微・修正予定

`tax-roadmap.md` 実機確認 #4 は「BTC 建てペアは全て **delist 済み**（社内確認）／フラグ実値の確認が残」
と書いているが、付録E.5 で **`is_enabled=true` かつ `stop_order=true`**（新規注文停止だが定義は有効）と
確定した。実装済みの `trade-history --all-pairs` は `is_enabled` に依存しない設計なので**挙動は正しいまま**。
ロードマップ側の記述を付録E.5 に合わせて更新する。
