# 表記規約

## CLI 起動形式

- README 本文のコマンド例は **`bitbank <cmd>` 形式に統一**（`./install.sh` 実行済み前提）。
  Quick Start のフォールバック節のみ `npx tsx [--env-file=.env] cli/index.ts <cmd>` を残し、
  未 install ユーザーへの読み替え方法を 1 か所だけ提示する。
- Skill 側 (`.claude/skills/`) も `bitbank <cmd>` で統一。fallback の言及は
  `_shared/references/cli-conventions.md` に一本化。
- 採用理由: Quick Start が既に install.sh 推奨構成、Skill 側との整合、
  `npx bitbank` / `npx tsx ...` の混在を解消し本文を短く保つため。

## private モックの実 API 準拠（テストフィクスチャ）

- private 系コマンドのテストで使うレスポンスモックは、実 bitbank API docs 由来の
  **代表レスポンスを `cli/__tests__/__fixtures__/private/` に集約**し、各テストは
  そこを import して使う。テスト内でインラインの即席モックを組まない。
- 背景: margin バグ（PR #280 / #281）の根本原因は、テストのモックが実装と同じ
  架空フィールドで自己完結し、実 API 形状を一切検証していなかったこと。
  インライン即席モックは「実装と一致するだけのトートロジー」に陥り、実 API との
  乖離を隠す。フィクスチャを単一ソースにすれば、実 API 形状を 1 箇所で固定でき、
  ズレたときに全テストが一斉に落ちて気付ける。
- フィクスチャは API が返す**生の形状**（数値は文字列のまま等、変換前）で置く。
  変換後の期待値はテスト側で検証する。形状の根拠（由来する PR / API docs）は
  フィクスチャ冒頭にコメントで残す。
- **レビュー観点**: private テストの差分を見るとき「モックは実 API 準拠か」を必ず
  確認する。新規フィールド追加時はまず実 API の実レスポンスで形状を確認し、
  架空のフィールド名を推測で足さない。
- 自動エンロール（フィクスチャ駆動）: chaos `x18` は明示リスト方式をやめ、
  `cli/__tests__/__fixtures__/private/` に置かれた各フィクスチャを起点に検査する。
  **`__fixtures__/private/<endpoint>.ts` を置けば、対応する
  `cli/__tests__/private/<endpoint>.test.ts` が存在し、そのフィクスチャを import
  しているか（＝即席インラインモックの混入）を `x18` が自動で強制する。**
  - 命名規約: フィクスチャ `<endpoint>.ts` ↔ テスト `<endpoint>.test.ts`
    （`.test` を除いた basename 一致）。
  - 集約用の補助ファイル（`index.ts` 等）を将来置く場合、`x18` の列挙対象から
    除外される（テスト本体ではないため）。
  - 効果: 新しい private エンドポイントを実 API 準拠化する際は、フィクスチャを
    1 本足すだけで検査対象に乗る。`x18` 本体や本ドキュメントの編集は不要。
  - 展開対象: 当初は margin 2 本に限定していたが、本監査
    （[`audit-private-trade-schema-divergence.md`](audit-private-trade-schema-divergence.md)）で
    private エンドポイントへの展開対象が確定したため一般化した。
- 機械検証の限界: 「モックが実 API と一致」を完全に機械検証するのはライブ呼び出し
  なしでは不可能。`x18` はフィクスチャを参照しているか（＝即席インラインモックの
  混入）を検知する軽量チェックに留める。フィクスチャが複数の形状を export する
  ケースでも「テストがそのフィクスチャを import しているか」だけを見る。実形状の
  正しさはフィクスチャ集約＋本レビュー観点で担保する。

## 出力の改行・エンコーディング

- **全出力は LF (`\n`) 固定**（`cli/output.ts` / `cli/output-tabular.ts`）。
  Node は Windows でも `process.stdout.write` の `\n` を `\r\n` に変換しないため、
  どのプラットフォームでも LF で出る。意図的な仕様であり、`\r\n` は付けない。
  CSV (`--format=csv`) も LF 固定。現代の Excel / LibreOffice / pandas は
  LF-only CSV を解釈できる（RFC4180 は CRLF 規定だが実害なし）。
- dry-run の human プレビュー (`cli/output-dry-run.ts`) は UTF-8 で日本語＋絵文字
  (`🔍`) を出す。UTF-8 を描画できない旧 cp932 コンソールでは絵文字以前に日本語が
  化けるため、絵文字単体を ASCII 化しても可読性は改善しない。Windows Terminal /
  PowerShell 7 など現行環境では問題なく表示される。
