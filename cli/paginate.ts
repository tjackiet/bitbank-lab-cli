// カーソルページャ。private の履歴系エンドポイントで違うのは「1 ページの取得」
// 「重複排除キー」「次カーソルの作り方」の 3 点だけなので、それだけを注入する。
//
// ページ境界はタイムスタンプカーソルのため**同一ミリ秒で重複が返る**（要求仕様 §2.1、
// 実測で確認済み）。重複排除は取りこぼしではなく仕様なので、除去件数を必ず返す。
//
// 元は cli/tax/import/paginate.ts にあった（税務インポータ専用）。下記の停止条件は
// 「履歴が 1 件欠けたら集計が静かに狂う」用途すべてに必要なので、tax（ADR-004 の例外
// カテゴリ）配下から cli/ 直下へ移した。balance-history（portfolio 再構築）も同じ
// 停止条件に依存する。
import type { Result } from "./types.js";

export type PageSpec<T> = {
  /** cursor は since（前方走査）か end（後方走査）。エンドポイント側が解釈する */
  fetchPage: (cursor: string | undefined) => Promise<Result<T[]>>;
  /** 重複排除キー（trade_id / uuid）。冪等性 NFR の単位でもある */
  keyOf: (row: T) => string;
  /** このページから次カーソルを作る。undefined で打ち切り */
  nextCursor: (rows: T[]) => string | undefined;
  maxPages: number;
  initialCursor?: string;
};

export type Paged<T> = { rows: T[]; deduped: number; truncated: boolean };

export async function paginate<T>(spec: PageSpec<T>): Promise<Result<Paged<T>>> {
  const rows: T[] = [];
  const seen = new Set<string>();
  let deduped = 0;
  let cursor = spec.initialCursor;

  for (let page = 0; page < spec.maxPages; page++) {
    const r = await spec.fetchPage(cursor);
    if (!r.success) return r;

    let added = 0;
    for (const row of r.data) {
      const key = spec.keyOf(row);
      if (seen.has(key)) {
        deduped++;
        continue;
      }
      seen.add(key);
      rows.push(row);
      added++;
    }

    // 停止条件は「新規行がゼロ」だけにする。**「要求 count より短いページ = 最終ページ」
    // とは判定しない** — サーバが count をエンドポイント固有の上限にクランプすると、
    // その仮定は初回ページで成立してしまい、残りを取らないまま truncated:false を返す
    // （= 黙って欠損する）。カーソルは境界行を必ず含むので、続きが無いときだけ
    // added が 0 になる。代償は打ち切り判定のための余分な 1 リクエストのみ。
    if (added === 0) {
      return { success: true, data: { rows, deduped, truncated: false } };
    }
    const next = spec.nextCursor(r.data);
    if (next === undefined) return { success: true, data: { rows, deduped, truncated: false } };
    cursor = next;
  }

  // 打ち切り。呼び出し側が partial として上げる（欠損したまま黙って集計しない）
  return { success: true, data: { rows, deduped, truncated: true } };
}
