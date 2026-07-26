# 税務・会計データ整形 開発ロードマップ

> 策定: 2026-07-22。アーキテクチャ決定は [ADR-004](../adr/004-tax-logic-in-cli-exception.md)。
> フェーズ管理は [phases.md](phases.md) の Phase 6。

## 背景と期限

- 取引所側にデータが揃っているのに、税務処理のために利用者が自力でデータを
  組み立て直している（複数ユーザーが独立に指摘）
- **2027 年 2〜3 月の確定申告シーズン（2026 年分）に間に合わせる**
  - 12 月頭までに動くものを完成
  - 11 月中に実データ（年間取引）での検証を終える
  - 7 月下旬起点で残り約 4〜5 ヶ月

## 税制前提（2026 年 7 月時点）

- 金商法・資金決済法等改正法（暗号資産の金商法移管）は **2026-07-15 に成立**。
  暗号資産関連規定は公布から 1 年以内に施行（[tax-research.md](tax-research.md) §12）
- 申告分離課税（20%）の適用開始は「金商法等改正法の施行日の属する年の翌年 1/1 以後の
  譲渡」。2027 年中施行なら 2028-01-01 開始が有力だが、施行日確定までは未確定
- **2027 年 2〜3 月の申告（2026 年分）は現行制度（総合課税・原則その他雑所得）で確定**。
  本ロードマップは現行制度への対応を優先する
- 分離課税は対象が「特定暗号資産」に限定される見込み。対象外の譲渡は
  「総合課税の譲渡所得＋特則」の構造。経路別の具体分類は政省令・通達待ち
- 計算細目の税制調査は **完了**（[tax-research.md](tax-research.md) v2、2026-07-23 受領）。
  反映内容は「税制調査の反映」参照

## ユーザー層

税務ニーズは一様ではない。一つの機能で全員をカバーしようとしない。

| 層 | 特徴 | 必要な整形の深さ |
|---|---|---|
| **A** | 海外 CEX/DEX が主戦場。bitbank は円転の換金窓口 | 正規化まで（損益計算まで行うと他社分と二重計算になるため不要） |
| **B** | bitbank が主戦場（一般〜VIP/MM まで規模の幅） | bitbank 単体の損益計算まで（取得原価・実現損益） |
| **C** | 初心者・ライト層。含み益 20 万円超で心配になる層 | 概算の申告要否の目安＋専門家への誘導（断定的な税務判断はしない） |

## 整形の深さとスコープ境界

1. **生データ出力** — 取引履歴・入出金履歴の CSV/JSON 化（対応する）
2. **正規化** — ペア表記統一・タイムゾーン統一・手数料内訳分離など、
   他社データと合算しやすい共通フォーマット（対応する。A 層の主価値）
3. **損益計算** — bitbank 単体の取得原価計算・実現損益算出（対応する。B 層の核）
4. 他社データとの通算損益計算 — **スコープ外**。正規化データを既存の税務 SaaS
   （Cryptact、Gtax 等）に渡す前提
5. 申告要否・税額の確定判定 — **やらない**。概算の目安と専門家・国税庁への誘導まで

## アーキテクチャ（ADR-004）

```
[共有ロジック層 = CLI 内 tax カテゴリ]（生データ取得 → 正規化 → 損益計算）
        ↓
  A層・B層が実データで CLI Skill を使い倒す
        ↓
  手数料・信用建玉・複数ペア按分などのバグ/仕様漏れが実戦で見つかる
        ↓
  検証済みロジックを MCP Tool が CLI サブプロセス実行で利用
        ↓
  C層は自然言語で対話。Tool 側で計算を完結、LLM は説明・目安・誘導に専念
```

- 損益計算は CLI 内 `tax` カテゴリに実装（ADR-002 の例外。`paper` の前例に倣う）
- Skill は計算しない。CLI コマンドが返す確定値のみを使う（税務は間違えられない領域）
- 課税方式（総合課税/分離課税）は入口パラメータとして最初から持たせる。
  分離課税ロジックの実装は制度詳細確定後（2027 年前半に判断）
- 税務の年区切りは JST。「JST は表示・説明用のみ」規約の例外として
  `cli/date-utils.ts` に JST 年境界ヘルパーを追加する
- tax 出力に免責文言を機械可読な形で含める。C 層 MCP は read-only API キー導線
  （[botter-runbook](../botter-runbook.md) の read-only profile）を前提にする
- private GET とローカル計算のみ。trade エンドポイントには一切触れない

## Week 1 で潰す前提リスク（実機確認）

| # | 確認項目 | NG だった場合の影響 |
|---|---|---|
| 1 | **API 履歴保持期間**: trade_history / deposit_history / withdrawal_history が 2026-01-01 JST まで遡れるか | Web の取引報告書 CSV 取込へのフォールバックが必要（計画への影響が最大） |
| 2 | 信用の金利・建玉管理料が trade_history の `interest` に出るか | 控除項目が API だけで完結せず、段階 3 の仕様変更 |
| 3 | maker リベート（マイナス手数料）の出方（quote/base どちらに乗るか） | 手数料の原価算入仕様に影響 |
| 4 | 非 JPY ペア約定の有無 | 約定時点の円換算ロジックが段階 3 に必須になる |
| 5 | 出金 `fee` が `amount` 込みか別建てか | 正規化スキーマの手数料内訳分離の仕様 |
| 6 | API に存在しない課税イベントの棚卸し（貸暗号資産の利用料、キャンペーン等） | 免責明記 or Web CSV 取込のスコープ判断（Week 4 までに決定） |

### 実機確認の結果

- **#1 履歴保持期間（2026-07-22 確認・クリア）**: trade_history は **5 年以上前**の約定まで
  遡及可（5 年スパンの since/end 指定も受理）。deposit_history も同時期の入金
  （最古約定の直前 = 口座利用開始とみられる）まで遡及を確認。withdrawal_history も
  `--end` 逆方向ページングが機能。**口座利用開始以来の全履歴が API から取得可能。
  Web CSV フォールバックは不要**
- **#2 信用取引レコード（2026-07-23 確認・クリア）**: eth_jpy の小口ロング 1 往復
  （1 日超保有・JST 0 時を 1 回またぎ）を実機で作成し、全レコードを検算一致まで解読。
  **以下の実測値は特定性を下げるため関係式に置換した**（値を丸めると恒等式の検算が
  合わなくなり、かえって証拠価値が失われるため）:
  - **判別**: trade / order とも信用は `position_side` が入る（現物はキー自体が欠落）。
    決済レコードは `side: sell` + `position_side: long`
  - **手数料**: 建て時は `fee_amount_quote: 0` のまま `fee_occurred_amount_quote` に
    発生額のみ記録され、建玉の `unrealized_fee_amount` に累積。決済時に建て分+決済分を
    合算して決済レコードの `fee_amount_quote` で一括精算
    （実測で `建て分 + 決済分 = 決済レコードの fee_amount_quote` が成立）
  - **建玉金利**: 0.04%/日を JST 0 時時点の建玉に課金（建て直後は 0、0 時またぎで 1 日分、
    24h 経過時点では増えない）。公式の信用取引ルールと一致。決済レコードの `interest` に
    原精度で精算（実測で `interest = product × 0.0004 × またいだ 0 時の回数` が成立）
  - **`profit_loss` は値幅損益から全手数料・金利を控除したネット実現損益**
    （検算: `profit_loss = 値幅損益 − Σfee − interest` が原精度で完全一致）。
    **段階 3 で fee / interest を再控除すると二重計上になる**（最重要）。
    信用の実現損益は決済レコードの `profit_loss` をそのまま採用する
  - **端数**: positions は 3 桁丸め表示、trade の fee 系は 4 桁四捨五入、
    `profit_loss` / `interest` は原精度。段階 3 は API 値を採用し、自前計算は検算
    （`interest = product × 0.0004 × またいだ 0 時の回数` 等）に限る
  - 2025-06-30 まで建玉金利 0 円キャンペーンがあったため、**2025 年分データの
    `interest: 0` は正常**（検証で異常と誤判定しない）
  - 補足: 注文照会は pair × order_id の複合キー（不一致は 50009）。
    `agents/error-catalog.json` の 50009 の記述に反映済み（Week 2 ⑤）
- **#3 手数料（2026-07-23 確認・クリア）**: maker リベート（マイナス手数料）が実在
  （btc_jpy の全約定——数百件規模——のうち maker が十数件、そのほぼ全てが負の
  `fee_amount_quote`）。
  **段階 3 は負の手数料を扱える設計が必須**（所得区分・計上方法は税制調査項目 2）。
  base 通貨建て手数料は 0 件（実測上、手数料は quote/JPY 側のみ）。現物では
  `fee_amount_quote` = `fee_occurred_amount_quote` が全件一致（docs 記述を全量追認）
- **#4 取引ペア（2026-07-23 確認）**: 検証口座の取引歴は十数ペア・全て `_jpy` 建て
  → 円換算ロジックはこの口座の検証では不要。`matic_jpy` / `rndr_jpy` の履歴が残存
  → **リネーム資産（MATIC→POL、RNDR→RENDER 等）の取得原価引継ぎマッピング**が
  新規論点（仕様検討事項）。**追確認（2026-07-24）**: `/spot/pairs` は BTC 建て 15 ペア
  （xrp/eth/ltc/bcc/mona/xlm/qtum/bat/omg/xym/link/mkr/boba/enj/matic の各 `_btc`）を
  返すが、**BTC 建てペアは新規注文停止（bitbank 社内確認では「delist 済み」）**。
  pairs はペア定義マスタとして停止済みエントリを保持し、取引可否は `is_enabled` /
  `stop_order` 系フラグで表現される。**フラグ実値は確定**（[tax-research.md](tax-research.md)
  付録E.5）: BTC 建て 15 組は `is_enabled=true` かつ `stop_order=true`（定義は有効なまま
  新規注文のみ停止）。したがって現行取引可否の判定に `is_enabled` 単独は使えない。含意:
  - 現行取引に BTC 建ては発生しない → 円換算（税制調査 §6・P-07）と暗号資産建て手数料
    （P-11）は「当年データ」の要件ではなく、**過去年からの簿価再構築**（前年末残高を
    持たない初回利用ユーザーが過去履歴を遡って取得価額を計算するケース）の要件として残る
  - Week 2 の全ペア横断取得は delist 込みの pairs マスタを回す（過去履歴の網羅に必要）。
    ここでは**取引可否で絞り込まない**（停止済みペアにも過去の約定履歴があるため）
  - 現行取引可否を判定する用途では `is_enabled && !stop_order` 相当を使う。
    上記のとおり `is_enabled` 単独では BTC 建て 15 組を「取引可」と誤判定する
  - BTC 建て約定レコードの実形状は新規約定では作れないため、過去に BTC 建て取引歴の
    ある口座のデータ提供（ヒアリング協力者・社内）で確認する
- **#5 出金 fee（2026-07-23 確認）**: crypto 出金は `amount` と `fee` が別建てで、
  **両者の合計がちょうど切りの良い額**になることから総引落 = amount + fee と推定
  （値は特定性を下げるため省略）。正規化では fee を
  別フィールドで維持。**crypto 建て出金手数料は暗号資産での支払いのため、それ自体が
  譲渡（課税イベント）になり得る** → 税制調査項目 2 の回答を待って段階 3 の扱いを決定
- **#6 データ量（2026-07-23 確認）**: btc_jpy 全期間で数百約定（5 年超）。
  個人規模の検証ではページング・性能問題なし。VIP/MM 規模はヒアリングで確認
- **#7 販売所（即時売買）は API に存在しない（2026-07-25 確認・仕様変更）**:
  `/user/spot/trade_history` が返すのは**取引所（板）取引のみ**で、販売所取引は
  注文 ID 照合で交差ゼロ。販売所は **UI CSV「売買履歴」でのみ取得可能**。
  → **UI CSV 取込が P1 から P0 へ昇格**（[tax-requirements.md](tax-requirements.md) §2.2 / §2.4）。
  これは残高突合（ガード(d)）が取込漏れを検出した実例でもあり、当初「積立」「ダスト消滅」と
  診断していた残差はすべて販売所取引だった（[tax-evidence/BALANCE_RECONCILIATION.md](tax-evidence/BALANCE_RECONCILIATION.md) 訂正履歴）

## 税制調査の反映（2026-07-23 受領・v2）

調査・仕様の本体は [tax-research.md](tax-research.md)（ルールを【確定】【互換】【方針】の
3 層タグで管理。【方針】は付録 B に集約し**税務監修必須**）。段階 2・3 の仕様に直結する
決定と、実機確認との突合結果:

- **位置づけは B 案**: 出力は「bitbank 口座における取引集計・税計算用参考データ」。
  平均法は全取引所・全ウォレット横断で計算するものなので、単一取引所のデータだけでは
  正確な譲渡原価を原理的に計算できない（FAQ 2-8）。参考損益は**表示ガード**
  （ユーザーのアテステーション・未解決入庫なし・前年末残高確定）成立時のみ数値表示（§1.2）。
  ロードマップの「B 層向け損益計算」は以後「参考損益」と呼ぶ
- **信用取引**: FAQ 2-13（個別法・決済年帰属・金利は決済損益へ織込み）は実機確認 #2 の
  bitbank `profit_loss`（ネット値）と整合。ただしネット額の利用は条件付き（P-06）で、
  売買代金・金利・管理料・手数料の**分解明細を常時併記**する。分解は #2 で解読済みの
  `fee_occurred_amount_quote` / `interest` から機械生成できる
- **マイナス手数料**: 受取時に収入計上（リベート収入）の単一標準・切替不可（P-04）。
  実測（#3）では bitbank のリベートは JPY 建てのため簿価計算への影響なし
- **端数処理**: 内部は Decimal 非丸め・**浮動小数点禁止**（P-02）。丸めは出力層と
  Excel 互換モードに隔離。→ **実装論点**: JS の number は使えないため、外部依存最小
  方針との調整（decimal ライブラリ導入 or BigInt 固定小数点の自作）を **Week 6 冒頭に
  ADR 化**する。不変条件テスト I1〜I4（§3）を必須テストにする
- **認識基準**: 約定日時ベース・JST 年分判定・年度内固定（P-09）。正規化は
  `ts_utc` / `ts_jst` を二重保存（§8.5）— Week 2 の JST 年境界ヘルパーの仕様が確定
- **正規化スキーマ**: 調査 §13 の Event スキーマ（kind / costbasis_provenance /
  入庫理由 enum / `UNRESOLVED_TRANSFER` フラグ、A 案=全口座統合へ拡張可能）を
  Week 4 の仕様の土台にする
- **検証アンカー追加**: FAQ 公式設例のゴールデンテスト（2-4 総平均 譲渡原価 3,106,000 /
  移動平均 3,080,200 / 2-8 所得金額 2,189,000 ほか）を必須テストに昇格。国税庁計算書
  との一致は xlsx 数式解析後の「互換モード」として 2 段構え（§11）。FAQ は例年 12 月
  下旬改訂のため、毎年 1 月のリリース手順に差分確認を組み込む
- **C 層向け文言**: 20 万円ルール免責は §10 v2 テンプレートを採用（住民税・
  判定除外所得の但し書き込み）。所得区分アラート（収入 300 万円超で警告・判定はしない、
  P-12）を実装する
- **5% ルール**: 自動適用禁止。ユーザー明示選択＋監査ログのみ（P-10）

## 週次実行計画

> **読み方の注意**: 週の完了は「週表に印が付いているか」ではなく**成果物が存在するか**で判断する。
> 成果物列が埋まっていればその週の目的は果たされている（週表の行だけを見て
> 「未着手」と判断しない。実際に一度誤読が起きた）。

| 週 | リリース内容 | 成果物（実体） | 状態 |
|---|---|---|---|
| Week 1 | ヒアリング項目案の確定＋A/B 層への打診開始。生データ取得 API の網羅化に着手。**実機確認 6 項目**。ADR-004 | 本書「実機確認の結果」#1〜#6 / [ADR-004](../adr/004-tax-logic-in-cli-exception.md) | **完了** |
| Week 2 | 生データ取得の網羅化を完成・リリース（trade-history 全ペア横断 / 入出金 `--all` ページング / withdrawal 全 asset 横断 / JST 年境界ヘルパー） | `cli/date-utils.ts` の JST ヘルパー / `deposit-history-all` / `withdrawal-history-all` / `trade-history-all-pairs`（PR #1〜#4 マージ済み） | **完了** |
| Week 3 | ヒアリング実施（A/B 層）。並行してトラック 3（投資オンボーディング/ツール最適化）の設計に着手 | **[tax-requirements.md](tax-requirements.md) §1.2「主ターゲット（営業ヒアリングより）」** — 中口マニュアル勢〜10 万件規模・初心者・法人対象外。NFR の 10^5 件と §1.3 の非目標はここから直接導出 | **主目的は完了**（残: B 層の規模感データ。設計はブロックしない） |
| Week 4 | ヒアリング結果を反映し、正規化ロジック（段階 2）の仕様確定・実装。**Cryptact/Gtax 直接出力 vs 汎用フォーマットを決定**。API 外課税イベントの扱いも確定 | 仕様: [tax-requirements.md](tax-requirements.md) / [tax-p0-design.md](tax-p0-design.md)。実装: 未着手（P0-1） | **仕様は確定・実装は未着手** |
| Week 5 | 正規化を CLI Skill としてリリース、A 層向け先行公開。CLAUDE.md / commands.md へ tax カテゴリ・例外条項追記 | — | 未着手 |
| Week 6 | 損益計算（段階 3）実装: 総平均法/移動平均法・手数料原価算入・信用（金利/建玉管理料）・端数処理・課税方式パラメータ | 数値基盤は先行完成: [ADR-005](../adr/005-tax-exact-rational-arithmetic.md) / `cli/tax/ratio.ts` / `ratio-decimal.ts` | **数値基盤のみ完了**・エンジン未着手 |
| Week 7 | 損益計算を CLI Skill に統合、B 層（VIP/MM 含む）先行公開。**検証アンカーとの突合開始** | — | 未着手 |
| Week 8 | フィードバック反映しつつ MCP Tool 化に着手（CLI サブプロセス方式） | — | 未着手 |
| Week 9 | MCP Tool の対話フロー（概算表示・免責文言・専門家誘導・read-only キー導線）を実装・リリース | — | 未着手 |
| Week 10〜 | 12 月の本番検証（実年間データ）に向けたバグ修正・精度向上 | fixtures 経路は整備済み（skip ゲート + SHA-256 manifest） | 未着手 |

7 月下旬起点で Week 10 は 10 月上旬ごろ。11 月実データ検証、12 月完成のゴールに
対してバッファを持たせた設計。

**クリティカルパスは実装ではなく外部入力**（2026-07-25 時点）: 実装側は Week 2 完了 +
数値基盤（Week 6 相当）が先行済みで見通しが立っている。一方、**付録B の【方針】P-01〜P-19 の
税務監修**と**免責文言の法務レビュー**は未着手で、これらが 11 月の実データ検証より前に
片付いていないと、検証で出た数字の意味が確定しない。

## ヒアリング設計（Week 1 確定 → Week 3 実施 → **要求仕様 §1.2 へ反映済み**）

> **実施済み**。結果は [tax-requirements.md](tax-requirements.md) §1.2 に「主ターゲット
> （営業ヒアリングより）」として反映されている。以下は当初の設計項目（記録として残す）。

- **A 層**: 使っている税務 SaaS（Cryptact / Gtax / 税理士渡し / 自作）と、
  そこへ渡すのに必要なフォーマット。bitbank 分を合算するときに今困っている点
- **B 層**: 法人か個人か（法人は期末時価評価が絡み損益計算の前提が変わる）、
  年間約定件数の規模（`trade-history --all` の安全弁は 100 万件）、
  データ取得時のレート制限の体感、信用取引の利用有無
- **C 層**: 既存プロファイルに近いユーザーを想定、追加ヒアリングは優先度低

## 検証アンカー（11 月実データ検証の合否基準）

同一の年間実データに対して、以下との突合で差分ゼロ（または差分の原因を説明可能）
であること:

1. bitbank 公式の年間取引報告書
2. 正規化データを税務 SaaS（Cryptact / Gtax）に投入した損益計算結果
3. 国税庁の暗号資産の計算書（総平均法・移動平均法の様式）

## 外部入力待ち・残タスク

- **税制調査**: 完了（2026-07-23 受領、[tax-research.md](tax-research.md) v2）。
  同書の残タスクを引き継ぐ:
  1. ~~国税庁計算書 xlsx の数式解析~~ → **完了**（2026-07-23、tax-research.md 付録 D
     `NTA_SHEET_2025_12`）。総平均法は E/G/I とも非丸め・最終段のみ収入切捨て/経費切上げ、
     移動平均法は売却の都度残高価額を円未満切上げ。**内部 Decimal 非丸め方針（P-02）と
     総平均法は完全一致**し、互換モードの実装コストは小さい。
     残: FAQ 設例値での検算（Week 6 ゴールデンテスト）
  2. 付録 B（【方針】台帳 P-01〜P-12）の税務監修
  3. FAQ 2-2 の令和 6 年 12 月版との差分確認
  4. 免責文言一式の法務レビュー
- **実機確認**: #1〜#6 完了。`/spot/pairs`（ペア定義マスタ）は BTC 建て 15 本を返すが
  全て delist 済み（取引不可）＝現行の取引可能ペアは全て JPY 建て（実機確認 #4）
- **B 層ヒアリング（残り分）**: アカウントマネージャー経由の規模感データ
  （上位 botter の年間約定件数の桁・法人比率・税務処理の現状ワークフロー）。
  **設計はブロックしない** — スループット設計値 10^5 は要求仕様 §1.2 で既に確定済みで、
  この追加データは「設計余裕 10^6 が妥当か」の裏取りに使う

## 実装状況・引き継ぎ（2026-07-24 更新）

> **運用フロー（確立済み）**: 個人フォーク `tjackiet/bitbank-lab-cli`（bitbankinc の
> true fork）の **main に蓄積**する。作業は main から切ったブランチ →
> **base=main の PR** → CodeRabbit レビュー → CI green → merge commit で main へ。
> CodeRabbit は base が default branch（main）の PR しか自動レビューしない
> （他ブランチ base では Review skipped）。**PR は必ず最初から base=main で作る**こと。
> base の変更（`edited` イベント）自体は workflow を発火させないため、branch フィルタ
> 付き workflow が走るのは次の push（`synchronize`）以降になり、CodeRabbit の自動
> レビューも base 変更だけでは始まらない（`@coderabbitai review` コメントか push が
> 必要）。会社リポは着地先（fork main → bitbankinc の PR）に徹する。
> 新セッションはまず本節・[tax-requirements.md](tax-requirements.md)（要求仕様）・
> [tax-research.md](tax-research.md)（税務仕様 v2.1。**矛盾時はこちらが正**）・
> [tax-p0-design.md](tax-p0-design.md)（P0 設計メモ・要判断リスト）・
> [ADR-004](../adr/004-tax-logic-in-cli-exception.md) を読むこと。

### 前提（新セッション開始時に確認）

- `git fetch origin main` で remote-tracking ref を更新してから
  `git log --oneline origin/main` を確認し、先頭付近に
  「Merge pull request #3: feat: trade-history に --all-pairs / --year を追加」が見えること
- **旧セッション由来のコミット SHA（7697564 / 06130b7 / a313997 等）はフォーク移行時に
  作り直されており存在しない**。過去作業の照合はコミットメッセージで行う
- **AI エージェントセッションに限り**、git identity 未設定なら
  user.email=noreply@anthropic.com / user.name=Claude を設定する
  （人間のコントリビュータは自身の identity をそのまま使う）
- `npm ci` 後、ローカル hook（lefthook pre-commit）が緑であること。CI（`ci.yml`）は
  hook 経由ではなく共通の 3 検証を直接実行する:
  `npx biome check cli/` / `npx tsc --noEmit` / `npx vitest run`。
  CI はこれに加えて `npm audit --audit-level=critical` を実行するが、
  こちらは警告のみの非ブロッキング（merge gate は上記 3 つ）

### 実装済み（Week 2 ①〜③）

- **① JST 年境界ヘルパー**（`cli/date-utils.ts`）:
  `jstYear(ms)` / `jstYearRangeMs(year)→{startMs,endMs}`（半開区間）/ `jstIso(ms)`。
  epoch を +9h ずらして getUTC* で読み TZ 非依存（x13 と同じ安定性をテスト）。
  税務の年分は JST（ADR-004 の例外）。テスト `cli/__tests__/date-utils-jst.test.ts`
- **② deposit-history に `--all` / `--year`**（`cli/commands/private/deposit-history-all.ts`）:
  後方 end 走査で全件ページング・uuid dedup・max-pages 安全弁。
  `--year=<YYYY>` は jstYearRangeMs で範囲を絞り jstYear で厳密フィルタ（end 境界の
  含む/排他に依存しない）。--year は --all を含意し --since/--end と併用不可。出力は
  found_at 昇順。schema def / agents カタログ / completion 更新済み。
  テスト `cli/__tests__/private/deposit-history-all.test.ts`
- **③ withdrawal-history に `--all` / `--year`**（`cli/commands/private/withdrawal-history-all.ts`,
  fork PR #1 merged）: ② のミラー。差分は 2 点 — tsKey は `requested_at`、
  **asset 必須**（ページング前に `AssetSchema` で fail-fast。`trade-history-all` の
  pair 検証と同型）。CodeRabbit（ASSERTIVE）指摘ゼロで通過。
  テスト `cli/__tests__/private/withdrawal-history-all.test.ts`
- **④ trade-history に `--all-pairs` / `--year`**（fork PR #3 merged）: pairs マスタ
  （delist 込み・実機 #4）の全 `name` を逐次ループし各 pair の `tradeHistoryAll` を
  マージ。構成は `trade-history-dispatch.ts`（振り分け）→ `trade-history-all-pairs.ts`
  （横断取得）→ `trade-history-all.ts` → leaf の一方向依存（ディスパッチャは
  dispatch ファイルへ移動し、`trade-history-all.ts` は 100 行以内に復帰）。要点:
  - dedup は `pair:trade_id` 複合キー（trade_id の pair 横断一意性が未確認のため
    安全側）。出力は `executed_at` 昇順。`--year` は ②③ と同仕様で、
    `--pair` 併用時は単一ペアの年分、`--all-pairs` 併用時は全ペアの年分
  - `--max-pages`（pair ごと上限）到達ペアは `meta.truncatedPairs` で報告
  - `--max-pages` / `--year` の検証は `input-schemas.ts` の `parseMaxPages` /
    `resolveYearWindow` に共通化（②③ も同ヘルパーへ移行済み）。YearSchema は
    `^[1-9]\d{3}$`（0 始まり 4 桁年は Date.UTC の 1900 年代補正で範囲と
    フィルタが食い違うため拒否。CodeRabbit 指摘）
  - レート制限は逐次実行 + `http-core` の `waitForSlot` / 429 リトライで対応
    （追加実装なしを確認）。進捗の stderr 出力は既存 `--all` 系との一貫性を理由に
    見送り（CodeRabbit が learning として記録済み）
  - テスト `cli/__tests__/private/trade-history-all-pairs.test.ts` /
    `trade-history-dispatch.test.ts`
- **⑤ error-catalog の 50009**（本 PR）: 「注文照会は pair × order_id の複合キーで、
  不一致でも 50009（実機 #2）」を `scripts/gen-agents-catalog.ts` の GENERAL
  `agent_action` に反映して regenerate。コンパニオン文書
  `skills/_shared/references/error-catalog.md` §3b にも同旨を追記

### 次タスク（Week 2 残り）

- **要判断（③ の派生）**: withdrawal の全 asset 横断（asset ループ）を別フラグにするか。
  ④ の `--all-pairs`（pairs マスタ起点）と同型にするなら、assets 一覧の取得元
  （private `assets` か、pairs マスタの base/quote 集合か）の決定が先
- Week 2 の生データ取得網羅（①〜⑤）はこれで完了。以降は Week 3（ヒアリング実施・
  トラック 3 設計）と Week 4（正規化仕様）へ

### 実装 gotchas（chaos 規約）

- Result パターン（throw 禁止 x01）、Zod が型の単一ソース、`--format=json|table|csv`
- **1 ファイル 100 行**（x04）。超過は冒頭に `// 100行超: <理由>` コメント
- handler description / schema def を変えたら **`npx tsx scripts/gen-agents-catalog.ts`**
  （x17 drift）+ completion スナップショット更新
  **`npx vitest run cli/__tests__/completion/scripts.test.ts -u`**
- private テストは実 API を叩かずモック（`mockFetchData` / `mockFetchDataCapture` /
  `__fixtures__/private/`）

### CI / レビュー基盤（2026-07-24 時点）

- fork の GitHub Actions は有効化済み。`ci.yml`（biome + tsc + vitest +
  npm audit critical）は PR / main push で走る
- **`security.yml`（Security Audit）は fork では `disabled_fork` になり得る**: schedule
  トリガーを含む workflow は fork では per-workflow で無効化され、push / pull_request
  トリガーまで全て止まる仕様。Actions タブ → Security Audit → 「Enable workflow」
  （オーナー操作）で解除する。本 fork は有効化済みで、base=main の PR では
  `audit`（npm audit high・ブロッキング）+ `gitleaks` が走る。
  走っていなければユーザーに有効化を依頼する
- CodeRabbit は base=main の PR 作成で自動レビュー。手動トリガーは
  `@coderabbitai review` コメント

### 段階3（Week 6）着手前に決める設計

- **P-02 内部 Decimal 非丸め・浮動小数点禁止**（tax-research §3）→ JS number 不可。
  decimal ライブラリ or BigInt 固定小数点の自作を **Week 6 冒頭に ADR 化**。丸めは
  付録 D の互換モードで再現、FAQ 設例をゴールデンテスト
- **信用の二重計上禁止**: 実現損益は決済レコードの `profit_loss`（ネット値）を採用し、
  fee / interest を再控除しない（実機 #2）
