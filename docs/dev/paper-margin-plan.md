# ペーパートレードの信用取引 — 開発計画

> Phase 8 の計画書。`paper` サブコマンドに信用（margin）の新規建て・返済を足すための
> スコープ・前提となる事実・設計判断・実装ステップ・検証手順をまとめる。
> 進捗チェックリストは [`phases.md`](phases.md) の Phase 8、
> 設計判断は [ADR-010](../adr/010-paper-margin-simulation.md)（Proposed）に記録する
> （本書は計画であって ADR ではない）。

---

## 1. 現状と目的

### 現状（2026-11 時点）

| 領域 | 状態 |
|---|---|
| paper の**現物** | 実装済み。成行は ticker の last で即時約定、指値（GTC）は 1m 足の lazy tick で約定判定。state は v3（`cli/paper-state.ts`） |
| paper の**売り越し** | 不可。`computePositions`（`cli/paper-pnl.ts`）が `negative position detected ... (paper does not support short)` で止める |
| 信用の**読み取り**（実口座） | `margin-status` / `margin-positions` が実装済み（private GET） |
| 信用の**発注**（実口座） | Phase 7 で計画中。[ADR-009](../adr/009-margin-order-separate-command.md) は Accepted、実装は未着手 |
| paper の信用 | 未実装。[`margin-order-plan.md`](margin-order-plan.md) §1 で「証拠金・金利・ロスカットのモデルが要るので別フェーズ」とスコープ外にしていた |

### 目的

仮想資金で信用の**新規建て**と**返済**を練習できるようにする。

- 本番の `trade create-margin-order`（Phase 7）と**同じ語彙**（`side × position_side`）で書けるようにする。
  [`botter-runbook.md`](../botter-runbook.md) の「paper → dry-run → 本番」を、名前空間の差し替え
  （`paper` → `trade`）だけで進められる状態を保つ
- レバレッジを掛けたときの保証金率の動きと、ロスカットで建玉が強制決済される流れを、実資金を失わずに体験できるようにする
- 本番と一致させられない部分は**黙って近似しない**。仮定として申告する（§3.4）

### スコープ外（本フェーズでやらないこと）

- **代用暗号資産**（暗号資産を保証金に算入する。本番は掛目 50% 以下で算入する）。v1 の保証金は JPY 残高だけにする。
  保証金を少なく見積もる向きなので、ロスカットは本番より早く起きる（安全側）
- **法人口座**のリスク想定比率（`margin_current_company_ratio`）。個人口座を前提にする
- `stop` / `stop_limit` / `take_profit` / `stop_loss` 注文。現物 paper にも無い
- **追証の期限到来による強制決済**。発生条件・期限の規則を確認できていない（§2.3）。
  v1 は「追証発生中」の表示と新規建ての停止まで
- **入金**。paper には入金コマンドが無い。追証・不足金の解消手段は返済と `paper reset` だけになる
- 部分約定・スリッページ。現物 paper と同じ前提（指値は指値ぴったり、成行は last）
- 信用の税務。`tax` は実口座専用で、paper の履歴は読まない

---

## 2. 使える情報源と、分からないこと

paper は **public の ticker・candlestick・pairs だけ**を叩く（CLAUDE.md の paper 例外節）。
信用のパラメータをどこまで public から取れるかが、このフェーズの成否を決める。

### 2.1 `GET /spot/pairs` の信用フィールド（public）

公式 [rest-api_JP.md](https://github.com/bitbankinc/bitbank-api-docs/blob/master/rest-api_JP.md)「銘柄詳細」の記述:

| フィールド | docs の説明 | 型 |
|---|---|---|
| `margin_open_maker_fee_rate_quote` | 新規建てmaker手数料率(クオート資産) | string \| null |
| `margin_open_taker_fee_rate_quote` | 新規建てtaker手数料率(クオート資産) | string \| null |
| `margin_close_maker_fee_rate_quote` | 決済maker手数料率(クオート資産) | string \| null |
| `margin_close_taker_fee_rate_quote` | 決済maker手数料率(クオート資産)（**docs の誤記と思われる**。名前は taker） | string \| null |
| `margin_long_interest` | ロング利息率/日 | string \| null |
| `margin_short_interest` | ショート利息率/日 | string \| null |
| `margin_current_individual_ratio` | 現在の個人のリスク想定比率 | string \| null |
| `margin_current_individual_until` | 現在の個人のリスク想定比率の適用終了日時（UnixTimeのミリ秒） | number \| null |
| `margin_next_individual_ratio` / `_until` | 次の個人のリスク想定比率 / その適用終了日時 | string \| null / number \| null |
| `margin_current_company_ratio` 他 | 法人の同等値（本フェーズでは使わない） | |
| `stop_margin_long_order` | ロング新規建て注文停止ステータス | boolean |
| `stop_margin_short_order` | ショート新規建て注文停止ステータス | boolean |

実際の値（`cli/__tests__/__fixtures__/tax/pairs-master.json`、2026-07-25 採取の無加工出力）:

- `margin_*` が**非 null なのは btc / xrp / eth / sol / doge の 5 ペアだけ**。他の JPY ペアはすべて null。
  この 5 ペアは、2026-09-15 の実機確認で `margin-status` の `available_balances` に出たペアと一致する
- 個人のリスク想定比率は 5 ペアとも `0.5`。法人は `0.0818`（btc）〜`0.5`（sol / doge）とペアで違う
- 利息率は 5 ペアとも `0.0004`。docs に単位の明記は無いが、税務調査の実測で
  **小数（0.04%/日）**と確定している（§2.4）
- 手数料率: 新規建て taker は btc が `0.001`、他が `0.0012`。maker は btc が `0`、他が `-0.0002`（リベート）
- `until` は火曜 23:59:59.999 JST で、current と next の差は 7 日。比率は週次で切り替わる

**CLI はこれらを捨てている。** `cli/commands/public/pairs.ts` の `PairSchema` と
`cli/pairs-cache.ts` の `CachedPairSchema` は `z.object` なので、未知キーは Zod が落とす。
`bitbank pairs` の出力にも pairs キャッシュにも `margin_*` は現れない。Step 1 で通す。

### 2.2 Phase 7 の前提との食い違い（要再確認 #PM-0）

[`margin-order-plan.md`](margin-order-plan.md) §2 と ADR-009 のコンテキストは
「`GET /spot/pairs` に信用対応フラグは無い（`is_enabled` / `stop_order` /
`stop_order_and_cancel` のみ）。信用対応ペアの唯一の情報源は `margin-status`」としている。

- 挙げられている 3 フラグは、CLI の `PairSchema` が持つ boolean と**ちょうど同じ**。
  CLI の出力（未知キーが落ちた後）を見て確認した可能性が高い
- 生レスポンスには `stop_margin_long_order` / `stop_margin_short_order` があり、
  信用非対応ペアでは `margin_*` が null になる（§2.1）
- 「信用対応」を表す boolean そのものは確かに無い。なので「フラグは無い」は字義どおりには正しい。
  ただ、**`margin_current_individual_ratio` が非 null かどうかで信用対応ペアを判定できる**

本セッションからは api.bitbank.cc に届かず、最新の生レスポンスで確かめられていない。
Step 0 で再確認する。確定したら、ADR-009 決定 4 の「非対応ペアは CLI 側で事前に弾けない」という
前提は見直せる（本フェーズの範囲外。ADR-009 は main に入っているので、書き換えずに別途扱う）。

### 2.3 public の情報だけでは決まらないこと

bitbank の[信用取引ルール](https://bitbank.cc/guide/margin-trading-rule)から分かっていること:

- 受入保証金は、現物口座の円と暗号資産の合計（暗号資産には 50% 以下の掛目）
- 未収費用 = 未収の売買手数料 + 利息 + 決済損金 + 不足金
- 必要保証金 = 維持必要保証金額（建玉数量 × 平均建値 × リスク想定比率）+ 約定時必要保証金額
- 保証金率 = 受入保証金合計額 ÷ 保有建玉額
- 受入保証金合計額が必要保証金を下回ると、追加保証金や強制決済が起こり得る

**ただし計画作成時点で、このページの原文は読めていない。** 本セッションのネットワーク設定では
bitbank.cc に届かず、上の内容は検索結果の抜粋から拾ったもの。Step 0 で原文を確認する。

実口座の API（private）が教えてくれる状態は次のとおり（rest-api_JP.md）:

- `margin-status` の `status`: `NORMAL` / `LOSSCUT`（強制決済中）/ `CALL`（追証発生中）/ `DEBT`（不足金発生中）/ `SETTLED`（債権売却済）
- `margin_call_percentage`（追加保証金率%）と `losscut_percentage`（強制決済率%）。どちらも口座ごとに計算される値で、算式は docs に無い
- `margin-positions` の `losscut_threshold`（強制決済掛け目。`individual` / `company`）と
  `notice`（`margin_call` / `debt` / `settled`、金額と対応期限）

まだ分かっていないこと（2026-11-24 時点。§2.4・§2.5 の結果を反映）:

| # | 項目 | 状態 |
|---|---|---|
| #PM-1 | 追証・ロスカットのしきい値 | **未確定。** 発生条件（保証金率で何 % 未満か。必要保証金との比で表すのか）、判定のタイミング（常時か、定時か）、追証の期限、ロスカットで決済する範囲（全建玉か）と、未約定注文の扱い。姉妹リポにも材料なし |
| #PM-2 | 保証金率の算式 | **一部だけ分かった。** `open_margin_position_product` は建玉ごとの `product`（= 平均建値 × 数量。建値基準）の合計と円未満を除いて一致する（姉妹リポの実口座確認）。受入保証金に評価損益・未収費用を含めるか、保証金率の分母、約定時必要保証金の算式、`available_balances` の算式は未確定 |
| #PM-3 | 利息 | **確定（§2.4）。** ショートの利息の符号（受け取りになるか）だけ未観測 |
| #PM-4 | 評価価格 | **未確定。** 姉妹リポは口座全体の `margin_position_profit_loss` を API からそのまま使っており、自前で評価していない |

### 2.4 このリポの税務調査で実測済みのこと

`docs/dev/tax-roadmap.md`（信用の実機検証）と `docs/dev/tax-evidence/ANSWERS.md` §4 に、
実口座で信用の建玉を作って全レコードを検算一致まで解読した結果が残っている。
計画の初版ではこれを拾えておらず、#PM-3 を未確定としていた。

- **利息**: 0.04%/日を **JST 0 時の時点で持っている建玉**に掛ける。建てた直後は 0、0 時をまたぐと 1 日分、
  24h 経っても 0 時をまたがなければ増えない。`interest = product × 0.0004 × またいだ 0 時の回数` が原精度で成立。
  「公式の信用取引ルールと一致」と記録されている。実測は 1 日超保有・0 時を 1 回またいだロングの 1 件で、
  複数回またぎは同じ式の外挿。2025-06-30 までは利息 0 円キャンペーンだった
- **手数料**: 建て時は `fee_amount_quote: 0` で、発生額は `fee_occurred_amount_quote` にだけ記録され、
  建玉の `unrealized_fee_amount` に積み上がる。決済時に「建て分 + 決済分」を決済行の `fee_amount_quote` で一括精算
  （実測で一致）。姉妹リポの実口座確認とも一致する
- **`profit_loss`**: `値幅損益 − 決済行の fee_amount_quote − interest` が原精度で完全一致。
  手数料・利息を引いた後のネット値（`close.ts` の前提と一致）
- **端数**: 約定の手数料系は 4 桁で四捨五入、`profit_loss` / `interest` は原精度、positions は 3 桁表示。
  姉妹リポの実口座でも約定の手数料・損益は円未満まで計上される（例: 損益 −12.8929 円）。
  完全精度で計算すれば恒等式は誤差ゼロで、丸めた手数料を使うと見かけの差が出る

### 2.5 姉妹リポ（bitbank-lab-mcp）への問い合わせ結果（2026-11-24）

姉妹リポの信用は「API の値を取得して表示する」だけで、追証・ロスカット・保証金率・利息を自前で計算するコードは無い。
根拠は公式 docs のミラーと実口座での数点の確認で、ルールページや契約締結前交付書面を根拠にした記述は無い。
新しく分かったのは次の点:

- **docs が定める丸め規則**（`margin-status` の各値）。paper の出力をこれに合わせられる:

  | フィールド | 丸め |
  |---|---|
  | `total_margin_balance_percentage` | 切り捨て 2 桁 |
  | `total_margin_balance` | 切り捨て 4 桁 |
  | `margin_position_profit_loss` | −∞ 方向に 4 桁 |
  | `unrealized_cost` | +∞ 方向に 4 桁 |
  | 維持必要保証金・約定時必要保証金 | 切り上げ 4 桁 |
  | 追加保証金率・強制決済率 | 切り上げ 0 桁 |

- `stop_margin_long_order` / `stop_margin_short_order` は新規建て（buy × long / sell × short）だけを止め、
  返済は止めない扱い（本計画 §3.4 と同じ）
- `losscut` は約定履歴の `type` に現れることがある（docs）。paper のロスカット決済を `type: "losscut"` の約定として
  記録すると、本番の約定履歴と形が揃う
- 「最大レバレッジ 2 倍」「保証金率が閾値を下回ると自動決済」など、姉妹リポにある説明文の一部は出典が無い。
  本計画の根拠には使わない
- `margin_current_individual_ratio` を信用対応ペアの目印に使うのは、姉妹リポでも推測の扱い（#PM-0 は未確定のまま）

---

## 3. 設計判断（ADR-010 で確定する）

### 3.1 public のみの境界は変えない

| 案 | 内容 | 採否 |
|---|---|---|
| **A** | パラメータは `/spot/pairs` から引く。取れないものは仮定値として state に固定する | **採用** |
| B | 実口座の `margin-status` / `margin-positions`（private GET）からしきい値などを引く | 不採用 |

B を捨てる理由:

- paper の価値は「API キーなしで誰でも練習できる」こと（Skill の compatibility は「`.env` は不要」）。
  private を引くと信用審査済みのアカウントが要り、練習の入口として成り立たない
- 実口座の値が paper に混ざり、「どこまでが仮想か」が曖昧になる
- chaos `x09`（paper は `http-private*` / `auth` を import しない）を崩すことになる

### 3.2 コマンド形状 — 本番 Phase 7 と同じ語彙

```bash
bitbank paper create-margin-order --pair=btc_jpy --side=buy --position-side=long --type=market --amount=0.001
bitbank paper create-margin-order --pair=btc_jpy --side=sell --position-side=long --type=limit --price=16000000 --amount=0.001 --intent=close
bitbank paper margin-status
bitbank paper margin-positions [--pair=btc_jpy]
```

| 案 | 内容 | 採否 |
|---|---|---|
| **A** | `paper create-margin-order` を新設。`--position-side` 必須、`--intent` は任意のクロスチェック、結果に操作ラベル。`paper create-order` は `--position-side` を `PARAM` で拒否 | **採用** |
| B | `paper create-order` に `--position-side` を足す | 不採用 |
| C | `paper open-position` / `paper close-position` | 不採用 |

- **B を捨てる理由。** 本番の `trade create-order` は `--position-side` を拒否する（ADR-009 決定 1）。
  paper で B の形を練習すると、本番に移ったときにコマンド名が変わり、練習した手順がそのまま使えない
- **C を捨てる理由。** ADR-009 が案 C を捨てた理由（CLI が open / close を抽象化すると、
  API の `side` と表示がずれたときの責任が CLI に来る）は paper でも同じ
- **`--execute` / `--confirm` は持たない。** 実資金に触れないので、paper の既存方針（`reset` 以外は確認なし）に合わせる
- `paper cancel-order` / `active-orders` / `trade-history` は現物と共用する。
  本番でも取消は現物と信用で共通のエンドポイントなので、対応が取れる。
  信用の注文・約定には `positionSide` を付けて出す

本番との違いの一覧は §5。

### 3.3 口座と建玉のモデル

- **JPY 残高は現物と信用で共有する。** 本番の「現物口座の円が保証金」と同じ。
  現物の買い（成行・指値ロック）で保証金が必要保証金を割り込むなら、その注文は拒否する
- **v1 の保証金は JPY 残高だけ**（代用暗号資産なし）。安全側に倒すため（§1 スコープ外）
- **建玉は `pair × position_side` で集約し、平均建値で持つ。** 本番の `margin-positions` と同じ粒度にする。
  **出力の**フィールド名は本番に合わせる: `open_amount` / `locked_amount` / `product` / `average_price` /
  `unrealized_fee_amount` / `unrealized_interest_amount`。state の中は paper の慣例どおり camelCase
  （`openAmount` / `product` / `unrealizedFee` / `unrealizedInterest`）で持ち、出力側で写す
- `locked_amount`（未約定の返済注文が予約している数量）は state に持たず、未約定注文から導く。
  現物の指値ロック（`computeLocked`）と同じ考え方で、取消・約定のたびに数字を合わせ直さずに済む
- 返済は平均建値で損益を確定し、未実現の手数料・利息を返済数量で按分して精算する。
  確定する損益は手数料・利息を引いた後のネット値で、本番 `trade-history` の `profit_loss` と同じ定義
  （`cli/tax/import/to-events-margin.ts` 冒頭。batch1 の検算で確認済み）。JPY 残高にはこの値だけを足す
- 両建て（同じペアのロングとショートを同時に持つ）は本番で可能なので、paper でも禁止しない

### 3.4 数値の出どころ — ライブ値と、申告する仮定値

| 値 | 出どころ |
|---|---|
| 信用対応ペア | `/spot/pairs` の `margin_current_individual_ratio` が非 null（#PM-0 で確定） |
| リスク想定比率（個人） | `/spot/pairs` の `margin_current_individual_ratio`。`until` を過ぎていたら `margin_next_individual_ratio` を使うか、pairs を取り直す |
| 新規建て・決済の手数料率 | `/spot/pairs` の `margin_open_*` / `margin_close_*`（成行 = taker、指値 = maker） |
| 利息率 | `/spot/pairs` の `margin_long_interest` / `margin_short_interest`（小数の日率。§2.4 で実測） |
| 利息の掛け方 | **実測（§2.4）。** JST 0 時をまたぐたびに `product × 日率`。ショートも `margin_short_interest` で同じく支払う扱い（ショートは未観測なので仮定） |
| 新規建て停止 | `/spot/pairs` の `stop_margin_long_order` / `stop_margin_short_order` |
| 追証・ロスカットのしきい値 | **仮定値**。既定値は Step 0（#PM-1）で決める |
| 保証金率の算式の細部 | **仮定**（#PM-2） |
| 評価価格 | **仮定**。v1 は ticker の last（現物 paper の成行と揃える。#PM-4） |

- 仮定値は `paper init` のときに state へ書き込み、**信用の全出力に `assumptions` として載せる**
  （使ったリスク想定比率と `until`、しきい値、評価価格、保証金の範囲）。
  CLI のバージョンが上がって既定値が変わっても、既存の仮想口座の結果がこっそり変わらないようにする
- v3 の state を v4 に移行するときは、移行時点の既定値を書き込む
- 本番の値と一致する保証は無い。そのことを出力・Skill・runbook で明示する

paper が使う暫定の算式（記号は ADR-010 と共通。`[#PM-n]` が付いた箇所は Step 0 で確定させる）:

```text
P  = Σ open_amount × average_price                 # 保有建玉額 [#PM-2: 時価か建値か]
U  = Σ long:  (price − average_price) × open_amount
     Σ short: (average_price − price) × open_amount # 評価損益（price は評価価格 [#PM-4]）
C  = Σ unrealized_fee_amount + unrealized_interest_amount   # 未収費用
B  = JPY 残高 + U − C                               # 受入保証金合計額 [#PM-2]
Mm = Σ open_amount × average_price × r              # 維持必要保証金（r = リスク想定比率）
Mo = Σ 未約定の新規建て指値 amount × price × r       # 約定時必要保証金 [#PM-2]
保証金率 = B / P
新規建て可否: B − Mm − Mo ≥ 新規分の amount × price × r
追証:   保証金率 < θ_call   [#PM-1]
ロスカット: 保証金率 < θ_lc  [#PM-1]
```

### 3.5 ロスカット判定 — 保守側に倒し、見えない区間は申告する

- tick のたびに、前回 tick 以降の 1m 足を時系列に走査する。各分で、建玉に**不利な極値**
  （ロングは low、ショートは high。両建てのペアは両方を試して低いほうの保証金率）で保証金率を評価する
- 複数ペアに建玉があるときは、各ペアの足を timestamp で揃え、口座全体で評価する
- しきい値を割ったら、全建玉をその足の不利な極値で決済し、未約定の信用注文を取り消す
  （#PM-1 で本番の範囲が分かったら合わせる）。極値で約定させるのは、急変時に成行のロスカットが滑る分を見込むため
- **建玉がある間は、`openOrders` が空でも tick で足を取りに行く。** 現行の `runTick` は
  `openOrders` が空なら早期 return するので、条件を広げる
- **lazy tick の 24h 上限を超えた区間。** 現物の指値は「24h に制限して警告」で済ませている。
  信用でロスカットを見逃すのは間違いが静かなので、24h を超える区間は年単位ファイルで取れる 4hour 足で判定する。
  そのうえで `warnings` と結果の `approximate: true` で申告する。足の取得に失敗した区間は
  現物と同じく `lastTickAt` を進めず、次の tick で取り直す
- 粗い足や極値での判定は、本番より早くロスカットさせる方向にずれる。paper で生き残った戦略が
  本番でロスカットされるのが最悪の失敗なので、ずれは安全側にだけ許す

### 3.6 追証・不足金

- **追証。** 保証金率が `θ_call` を割ったら `status: "CALL"` を出し、新規建てを拒否する。
  返済は許す。期限到来の強制決済は v1 では実装しない（#PM-1 の規則が分かるまで）
- **ロスカット決済の記録。** 約定履歴に `type: "losscut"` として載せる（本番の約定履歴と同じ形。§2.5）
- **不足金。** ロスカットの決済後に JPY 残高が負になったら、その額を `payables` に出し、`status: "DEBT"` にする。
  不足金がある間は新規の注文をすべて拒否する。paper には入金が無いので、解消手段は `paper reset` だけになる

### 3.7 出力と損益

- `paper margin-status` / `paper margin-positions` は、本番と**同じ意味で計算できるフィールドだけ**同名で出す。
  算式が分からないもの（`margin_call_percentage` / `losscut_percentage` / `losscut_threshold`）は出さない。
  代わりに `assumptions` に paper のしきい値を出す
- `paper pnl` の `perPair` / `total` は**現物だけのまま**にする。信用の履歴を混ぜると、
  `computePositions` が売り越しで落ちる。信用の実現・未実現損益は `margin` 節として別に足す。
  `total` の意味は変えない（既存の利用者を壊さない）
- 信用の約定は `paper trade-history` に `positionSide` と、返済時の `profitLoss` / `interest` を付けて載せる。
  本番の `trade-history` が `position_side` / `profit_loss` / `interest` を返すのに合わせる

### 3.8 数値・state・配置

- **数値は倍精度のまま**にし、`snapAmount` で誤差を潰す（`cli/paper-precision.ts`）。
  ADR-005 の厳密有理数は税務経路に限る（ADR-007 と同じ扱い）
- **state は v4 にする。** 追加するもの:
  - `marginPositions`（§3.3 のフィールド + `openedAt` / `lastInterestAt`）
  - `openOrders[].positionSide?` と `history[].positionSide?` / `profitLoss?` / `interest?`
  - `margin: { assumptions, payables }`

  v3 → v4 は空の配列と既定の仮定値で移行する。**v4 を書いた後に古い CLI に戻すと
  `Invalid paper state` で止まる**（ダウングレード不可）。CHANGELOG に書く
- **計算本体は `cli/paper-margin/` に置く。** 既存の例外（`cli/tax/` / `cli/portfolio/` / `cli/brief/`）と同じ形にする
  - chaos `x09` は `cli/commands/paper/` と `cli/paper-*.ts` しか見ていない。**新ディレクトリを検査範囲に足すのは必須。**
    足さないと「paper は private を叩かない」という検査が、新しいコードに効かない
  - `package.json` の `files` に `cli/paper-margin/` を足す（chaos `x22`）
- **`side × position_side → 操作ラベル / intent` の純関数は Phase 7 と共有する。**
  置き場所は中立な `cli/margin-operation.ts` にする。Phase 7 計画 §3.5 は `cli/commands/trade/margin-operation.ts` としているので、
  先に着手した側が中立の位置に作り、もう一方の計画書をそれに合わせる。
  paper から `cli/commands/trade/` を import する形は避ける

---

## 4. 実装ステップ

各ステップは独立した PR にできる粒度。順序は依存関係のとおり。

### Step 0: 仕様確認（メンテナ）

- **#PM-0** 最新の `/spot/pairs` の生レスポンスで、§2.1 の `margin_*` と `stop_margin_*` が出ていること、
  信用非対応ペアで null になることを確認する。確定したら `margin-order-plan.md` §2 に注記する
- **#PM-1・#PM-2・#PM-4**（§2.3）を bitbank の信用取引ルールと契約締結前交付書面の原文で確認する。
  確認できない項目は ADR-010 の仮定値として既定値を決める。#PM-3 は税務調査の実測で確定済み（§2.4）
- **#PM-5** 算式の突合。信用審査済みのアカウントで最小数量の建玉を持ち、`margin-status` の
  `total_margin_balance` / `total_margin_balance_percentage` を記録する。同じ入力を §3.4 の算式に通し、
  差を記録する（手作業。paper のコードは private を叩かない）
- 結果を ADR-010 に反映して `Accepted` にする

### Step 1: pairs の信用フィールドを通す

- `cli/commands/public/pairs.ts` の `PairSchema` に `margin_*`（nullable の numStr / number）と
  `stop_margin_long_order` / `stop_margin_short_order` を足す
- `cli/pairs-cache.ts` の `CachedPairSchema` を同様に拡張し、キャッシュの `version` を 2 に上げる
  （v1 のキャッシュは信用フィールドが無いので、読んだら取り直す）
- 比率は週次で切り替わる（`until`）。キャッシュの TTL（24h）とは別に、`until` を過ぎていたら
  `next` の値を使うか取り直すかを `cli/paper-margin/params.ts` で決める
  （実装: current の `until` までは current、過ぎたら next、next も過ぎたら `stale` を返して取り直させる）
- `defs-public-*.ts` の `pairs` output を更新し、`tool-catalog.json` を再生成する
- 現物 paper の挙動は変えない（既存テスト無変更で green）
- `cli/paper-margin/` を作るので、chaos `x09` の検査範囲と `package.json` の `files` もこの Step で足す（§3.8）
- キーの一覧と、Zod（API / キャッシュ）・JSON Schema（カタログ）の各表現での型は
  `cli/pair-margin-fields.ts` を単一ソースにする

### Step 2: `cli/margin-operation.ts`（Phase 7 と共有）

- `side × position_side → { label, intent }` の純関数と、`--intent` 不一致の判定
- Phase 7 が先に作っていたら、それを使う（実際は本フェーズが先に作った。
  `margin-order-plan.md` §3.5 を `cli/margin-operation.ts` に合わせて更新済み）

### Step 3: state v4

- `cli/paper-state.ts` は既に 243 行あるので、信用のスキーマは `cli/paper-margin/state.ts` に分ける
  （建玉のスキーマ `MarginPositionSchema` は Step 4 の建玉計算と一緒に先に作成済み）
- v1 / v2 / v3 → v4 の移行。仮定値の既定は `cli/paper-margin/assumptions.ts` を単一ソースにする

### Step 4: 計算本体 `cli/paper-margin/`

| ファイル | 責務 |
|---|---|
| `params.ts` | pairs → ペアごとの信用パラメータ（比率・手数料率・利息率・停止フラグ） |
| `account.ts` | §3.4 の P / U / C / B / Mm / Mo・保証金率・新規建て可否・`status` |
| `positions.ts` | 建玉の加算（平均建値）・評価損益（**実装済み**） |
| `close.ts` | 返済と精算（未実現の手数料・利息の按分、ネット損益の確定）（**実装済み**） |
| `closable.ts` | `locked_amount` の導出と返済可能数量の検査（本番の 50062 相当）（**実装済み**） |
| `interest.ts` | JST 0 時をまたぐごとの利息の積み上げ（`product × 日率`。§2.4。JST の境界計算は `cli/date-utils.ts` に置く） |
| `losscut.ts` | 足の時系列走査・不利な極値での判定・全建玉の決済（§3.5） |

純関数で書き、I/O（ticker / candles / pairs の取得）は呼び出し側に置く。
現物の `cli/paper-fill.ts` と同じく、取得は lock の外、state の更新は `updateState` の中で行う。

### Step 5: コマンド

- `cli/commands/paper/create-margin-order.ts`
  - params: `pair` / `side` / `position-side`（必須、`long|short`）/ `type`（`market|limit`）/
    `amount` / `price` / `intent`（任意）
  - 拒否するもの: 信用非対応ペア、新規建て停止中、新規建てで保証金不足、返済で返済可能数量
    （`open_amount − locked_amount`）超過、`CALL` / `DEBT` 中の新規建て。
    メッセージには本番の対応コードを添える（例:「返済可能数量を超えています（本番では 50062）」）
  - 結果に `operation: { label, intent }` を載せる
  - 手数料は円に丸めない。state には完全精度で持ち、出力の手数料系だけ 4 桁で四捨五入する
    （本番の約定履歴と同じ。§2.4。現物 paper の `computeFill` は JPY を整数に丸めるが、信用には流用しない）
- `cli/commands/paper/margin-status.ts` / `margin-positions.ts`（lazy tick → 評価 → 出力。`assumptions` 付き）
- `paper create-order` は `--position-side` を受けたら `PARAM`（「信用は `paper create-margin-order`」）
- `cli/paper-fill.ts`: 信用の指値約定（maker 手数料は `margin_open_*` / `margin_close_*`）、
  建玉があるときの tick、ロスカット判定の呼び出し
- `paper cancel-order`: 信用の指値も取り消せる（返済注文なら `locked_amount` を戻す）
- `paper pnl`: 信用の履歴を `perPair` から除外し、`margin` 節を足す（§3.7）
- `paper assets`: 信用の指値の約定時必要保証金をロックとして見せる

### Step 6: 登録とカタログ

- `cli/commands/paper-handlers.ts` に登録し、`cli/commands/schema/defs-paper.ts` に params / output を足す
- `npx tsx scripts/gen-agents-catalog.ts` で `agents/` を再生成する（paper なので `dangerous` は付かない）

### Step 7: テスト

- `cli/__tests__/paper/margin/`:
  - ロング・ショートの新規建て → 返済で、損益・手数料・利息の精算が合う
  - 4 組合せの操作ラベル、`--intent` 不一致の拒否
  - 信用非対応ペア・停止フラグ・保証金不足・返済超過・`CALL` / `DEBT` 中の拒否
  - ロスカット: 単一ペア、複数ペアの同時刻評価、両建て、極値での約定、未約定注文の取消
  - 24h を超えるギャップで 4hour 足に切り替わり、`approximate` と `warnings` が出る
  - 足の取得に失敗したら `lastTickAt` を進めない
  - 利息の日付境界（ホスト TZ に依存しないこと。chaos `x13` と同じく TZ を変えて同じ結果）
  - 現物の買いで保証金が必要保証金を割るなら拒否
  - `paper pnl` の `perPair` / `total` が信用の約定で変わらない
  - state v3 → v4 の移行
- chaos:
  - `x09` の検査範囲に `cli/paper-margin/` を足す（§3.8。Step 1 で実施済み）
  - `x22` は `package.json` の `files` 更新で通す（Step 1 で実施済み）
  - `x04`（各ファイル 100 行目安）、`x17`（catalog の drift）

### Step 8: ドキュメント（ADR-010 が Accepted になってから）

- `CLAUDE.md` の paper 例外節: 信用を足したこと、public のみの境界は不変、ADR-010 へのリンク
- `.claude/rules/commands.md` の paper 行
- `skills/paper-trade/SKILL.md`: トリガー（「仮想でショートして」「ペーパーで信用買い」）、
  実行フロー、Gotchas（「paper の保証金率は仮定値込み。本番は `margin-status` で確認」）
- `docs/botter-runbook.md` 段階 2: 信用の練習手順（`paper margin-status` で `assumptions` を確認してから建てる）
- `README.md` の paper 表、`CHANGELOG.md`（state v4 はダウングレード不可）

---

## 5. 本番（Phase 7）との対応

| 項目 | 本番 `trade create-margin-order` | `paper create-margin-order` |
|---|---|---|
| 語彙 | `side × position_side` | 同じ |
| ガード | dry-run 既定、`--execute` + `--confirm=I-UNDERSTAND-CREATE-MARGIN-ORDER` | なし（仮想） |
| 操作ラベル | dry-run に出す | 結果に出す |
| `--intent` | 任意。不一致は `PARAM` | 同じ |
| 手数料 | dry-run では見積らない | ライブの信用手数料率で約定時に計算する（paper は約定をシミュレートするので） |
| 信用非対応ペア | API が 40167 で拒否 | `margin_*` が null なら CLI が拒否 |
| 返済超過 | API が 50062 で拒否 | CLI が同じ条件で拒否 |
| 新規建て停止 | API が 50081〜50084 で拒否 | `stop_margin_*_order` を見て CLI が拒否 |
| 新規建て可能額超過 | API が 50061 で拒否 | §3.4 の算式で CLI が拒否 |
| 状態の確認 | `margin-status` / `margin-positions`（private） | `paper margin-status` / `paper margin-positions`（`assumptions` 付き） |

---

## 6. リスクと未決事項

- **仮定値が本番とずれる。** `assumptions` を毎回出し、Skill と runbook で
  「本番の保証金率は `margin-status` で確認する」と案内する。#PM-5 の突合結果を ADR-010 に残す
- **paper の保証金率を本番の目安として使われる。** 数値が本番と同じ形で出るほど起こりやすい。
  フィールドを本番と同名にするのは同じ意味で計算できるものだけに絞る（§3.7）
- **粗い足・極値での判定は誤検知する。** 安全側（本番より早いロスカット）にずれる前提で受け入れ、`approximate` で申告する
- **利息の日付境界は JST 0 時（§2.4 で確定）。** API キーの組み立てではなく取引所の暦の再現なので、
  税務の年分判定（`cli/date-utils.ts`）と同じく「JST は表示用のみ」の例外になる。ADR-010 決定 7 に記録した。
  CLAUDE.md への追記は ADR-010 が Accepted になってから
- **Phase 7 との順序。** 依存は `cli/margin-operation.ts` の共有だけで、どちらを先にやってもよい。
  Phase 7 は実機確認 #M-1〜#M-5 がメンテナのアカウント待ちなので、paper を先に進めても衝突しない
- **ADR-009 の前提（#PM-0）。** pairs で信用対応ペアを判定できると確定したら、Phase 7 の dry-run でも
  非対応ペアを事前に弾けるようになる。ADR-009 は書き換えず、計画書の注記か新しい ADR で扱う
