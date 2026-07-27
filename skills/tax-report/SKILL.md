---
name: tax-report
description: |
  bitbank 口座の取引を確定申告向けに整形する（取引集計・残高突合・年間取引報告書
  との突合・参考損益）。CLI が計算した確定値だけを提示し、Skill 側では一切計算しない。
  代表トリガー: 「確定申告のデータを作りたい」「取得価額を出して」
  「年間取引報告書と合ってる？」「暗号資産の税金の準備をしたい」「譲渡原価は？」
  注意: 出すのは**税計算用参考データ**であり税務上の所得金額ではない。申告要否・税額の
  判定はしない。含み損益の現況把握は portfolio が担当（本 skill は年分の確定データ）。
compatibility: |
  Requires the bitbank CLI on PATH (install separately: npm i -g bitbank-lab-cli).
  Plugin install alone does NOT bundle the CLI or its dependencies. Node.js 22+.
  Private API commands require API key/secret. **read-only キーを使うこと**
  （tax サブコマンドは private GET のみで POST は叩かない）。
metadata:
  author: bitbank-aiforge
  version: "1.0"
  requires:
    bins:
      - bitbank
---

# 税務データ整形 Skill

## この Skill の規律（最優先）

1. **計算しない**。数量・金額・損益は `bitbank tax ...` の出力値をそのまま使う。
   足し算・平均・按分を自分でやらない（税務は間違えられない領域なので、
   計算は CLI に閉じている → [ADR-004](../../docs/adr/004-tax-logic-in-cli-exception.md)）
2. **「税務上の所得金額」と言わない**。「税計算用参考データ」「参考損益」と呼ぶ。
   **ただし「単一取引所だから計算できない」とも言わない**。限界は口座外に同一銘柄が
   あるときの話で、bitbank だけで完結している銘柄なら譲渡原価は正しく出る
   （それを識別するのが `--attest`）。無条件に否定すると bitbank だけで取引している
   利用者の数値まで無効に見せてしまう
3. **申告要否・税額・所得区分を判定しない**。20 万円ルールにも触れない
   （CLI が返す `disclaimers` をそのまま提示する）
4. コマンドが数値を出さなかった銘柄について、**代わりに推定値を出さない**。
   `blocked_by` の理由をそのまま伝える

## 前提: 認証

read-only の API キーを profile に登録する（詳細は
`_shared/references/cli-conventions.md` の「認証」）。

```bash
bitbank profile add tax     # secret は対話 hidden 入力
bitbank tax reconcile --format=json --machine
```

## 実行フロー

### Step 1: 年分と評価方法を確認する

- 年分は **JST** で区切る（`--year=2026`）
- 評価方法の既定は**総平均法**。移動平均法は税務署へ届出済みのユーザーだけ
  （`--method=moving-average`）。どちらか分からなければ総平均法のまま進め、
  「届出をしていれば移動平均法」とだけ伝える

### Step 2: 残高突合で「取り込めているか」を先に見る

```bash
bitbank tax reconcile --format=json --machine
```

`rows[].diagnosis` を読む。

- 全銘柄 `MATCH` → API だけで足りている。Step 5 へ進んでよい
- `MISSING_ACQUISITION` / `MISSING_DISPOSAL` がある → **API に現れない取引がある**。
  第一候補は**販売所（即時売買）**。Step 3 で売買履歴 CSV をもらって取り込む

> 残差は「判定」ではなく「検出」。閾値外でもコマンドは成功で返る。
> 残差が出たこと自体を失敗として伝えない。

### Step 3: 年間取引報告書 CSV をユーザーに用意してもらう

**ここは自動化できない。ユーザーの操作が要る。** 次のように依頼する。

> bitbank の Web サイトにログインして、次の CSV をダウンロードし、
> ファイルパスを教えてください。
>
> 1. **売買履歴**（販売所＝即時売買の取引）— API では取得できないので、これが無いと
>    販売所の取引が丸ごと抜けます
> 2. **年間取引報告書**の対象年（例: 2026 年分）— 突合用。信用取引を使っている場合は
>    **現物と信用で別ファイル**になるので両方

補足として伝えてよいこと:

- 販売所（即時売買）の取引は API では取得できず、この報告書にだけ現れる
- ファイルは**ローカルで読むだけ**でどこにも送信しない
- 氏名が 1 行目に入っているので、パスだけ伝えれば中身を貼る必要はない

売買履歴を受け取ったら、まず残高突合をやり直して残差が消えるか見る。

```bash
bitbank tax reconcile --brokerage-csv=/path/to/dealer_history.csv --format=json --machine
```

次に報告書と突合する。報告書はどちらか一方だけでも実行できる。

```bash
bitbank tax verify-report --year=2026 \
  --brokerage-csv=/path/to/dealer_history.csv \
  --csv=/path/to/annual_trade_report.csv \
  --margin-csv=/path/to/annual_margin_trade_report.csv \
  --format=json --machine
```

`--brokerage-csv` は `events` / `reconcile` / `pnl` / `verify-report` の 4 本すべてで使える。
**一度渡したら以降のコマンドでも必ず渡す** — 付け忘れると販売所ぶんが抜けた数値が出る。

### Step 4: 差の読み方

まず `report_checks` を見る。`ok: false` があれば**報告書側の読み取りが疑わしい**
ので、API との差を論じる前にユーザーへ確認する（ファイルが編集されている、
様式が変わった、等）。

`rows[].report_kind` が `spot` か `margin` かで、差の読み方が変わる。

`rows[].diagnosis`（現物 = `report_kind: spot`）:

| diagnosis | 意味 | 次の一手 |
|---|---|---|
| `MATCH` | 許容幅内で一致 | なし |
| `FEE_ROUNDING` | API 手数料の 4 桁丸めで説明できる差 | なし（正常） |
| `REPORT_EXCESS` | 報告書 > API。**取込漏れ**側 | 購入・売却なら販売所ぶんの可能性が高い。`--brokerage-csv` を渡していなければ渡して再実行する。渡しても残るなら原因は別（下記 warnings を見る） |
| `API_EXCESS` | API > 報告書 | 年分判定・重複排除のズレ、または報告書の対象外（信用は別様式）。原因が説明できるまで数値を出さない |

信用（`report_kind: margin`）の行は 3 本ある。

| field | 意味 |
|---|---|
| `margin_pnl` | 年中信用取引損益。**報告書は手数料を控除していない**（利息だけ控除）ので、CLI は API の `profit_loss` に手数料を足し戻して比べる |
| `margin_fee` | 支払手数料を**精算ベース**（決済時に建て分と合算）で合計したもの |
| `margin_fee_occurred` | 同じ列を**発生ベース**（各約定日）で合計したもの |

`margin_fee` と `margin_fee_occurred` は**同じ報告書の列**と比べている。報告書がどちらの
基準で合計しているかは未確定なので、一致した方が基準。年をまたぐ建玉が無ければ両方一致する。

年末建玉（売建玉 / 買建玉）は全履歴が必要なので突合せず `unsupported` に出る。
報告書の値をそのまま提示し、**申告上どう扱うかは述べない**（税理士・国税庁の領域）。

`warnings` / `unsupported` は握り潰さずそのまま伝える。特に:

- 「履歴がページ上限で打ち切られています」→ 差の解釈が無効。`--max-pages` を上げて再実行
- 「信用取引 N 件を集計から除外しました」→ 現物の報告書には現れないので正常
- `unsupported`（BTC 建て・貸出の列に値がある）→ その銘柄の差はこの分を含む

詳細は [`references/annual-report-guide.md`](references/annual-report-guide.md)。

### Step 5: 前年繰越を確定させる

参考損益は**前年末の数量と取得価額（簿価）が確定していないと出ない**。

- 当年が bitbank 利用初年度 → `--carryover=zero`
- そうでない → 前年の残高と簿価を JSON で用意してもらう

```json
{ "btc": { "qty": "1.5", "cost_jpy": "931800" } }
```

> 年間取引報告書の「年始数量」は数量だけで、**簿価（取得価額）は載っていない**。
> 数量の裏取りには使えるが、繰越簿価の代わりにはならない。

### Step 6: 参考データを出す

```bash
bitbank tax pnl --year=2026 --method=total-average --carryover=./carryover.json --attest --format=json --machine
```

`--attest` は「**この銘柄を bitbank 口座の外で保有・売買していない**」という
ユーザーの申告。勝手に付けない。ユーザーに確認してから付ける。
外部に保有がある銘柄では平均法が成立しないため、参考損益は出せない。

**`--taxation` は指定しない**。課税方式は `--year` から決まるもので、このフラグは
「ユーザーの認識と一致しているか」を確認したいときだけ使う確認用。付けても値は変わらず、
食い違えばエラーになるだけ。出力の `taxation.mode` / `taxation.certainty` を読んで伝える。

- `certainty: "settled"` → その年の課税方式は確定している
- `certainty: "projected"` → 見込み。`taxation.basis` の理由をそのまま伝える
- 方式が決まらない年（2028 年分以降）はコマンドがエラーになる。**推測で数値を出さない**

### Step 7: 伝え方

- `currencies[].summary`（取引集計）は常に提示してよい
- `currencies[].reference`（参考損益）は**存在する銘柄だけ**提示する。
  無い銘柄は `blocked_by` の理由を列挙する（欄が無いことに意味がある。
  0 と書かない）
- `disclaimers` は要約せず全文を末尾に置く
- 最後に「最終的な申告内容は税理士または国税庁にご確認ください」を添える

## Gotchas

- **販売所は API に存在しない**。`trade-history` に出ないのは不具合ではない。
  取込経路は UI CSV「売買履歴」（`--brokerage-csv`）だけ
- **販売所 CSV には約定代金の列が無い**ので、CLI は `数量 × 指値価格` で算出する。
  数量は 8 桁で丸められているため、実際の約定代金とわずかにずれる可能性がある
  （報告書との差が小さく残るときはこれを疑う）
- **販売所には手数料が無い**（スプレッド内包）。手数料ゼロで約定したわけではないので、
  「手数料がかかっていない」と説明しない
- **年分は JST**。UTC で 12/31 でも JST では翌年になる約定がある。`--year` に任せる
- **手数料の二重計上**をしない。購入時手数料は取得価額に算入済みで、
  必要経費へ再掲しない（CLI が分けて出す）
- **信用の損益と手数料は別欄**。報告書の「年中信用取引損益」は利息だけを控除した値で、
  手数料は「支払手数料」列に分かれる**様式になっている**。CLI もこの分け方に合わせてある
  （差益/差損と手数料を別仕訳にする）。**どの欄へどう転記するかは案内しない** —
  項目の定義を示すところまでが本 skill の範囲で、記載方法は税理士・国税庁に確認してもらう
- **信用は個別法（FIFO）**。現物の総平均法・移動平均法とは別系統で、`--method` の
  影響を受けない
- **信用の `profit_loss` は手数料・金利控除後のネット値**。CLI は報告書の定義へ揃えるために
  手数料を足し戻すが、これは控除の**取り消し**であって二重控除ではない。
  自分で改めて手数料や金利を引かないこと
- **MKR→SKY のような比率換算転換は名寄せしない**（1:1 でないため簿価が壊れる）
- `tax` サブコマンドは private GET のみ。注文・出金の API は絶対に呼ばない
- 参考損益が出なかったことを「損益ゼロ」と表現しない
