import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// margin バグ（PR #280 / #281）の根本原因は、テストのモックが実装と同じ架空
// フィールドで自己完結し、実 API 形状を一切検証していなかったこと。同じ穴を
// 再び踏まないため、margin private テストは実 API docs 由来の共有フィクスチャ
// （cli/__tests__/__fixtures__/private/）を参照し、即席インラインモックを
// 組まないことを軽量に検査する。
//
// 注意: 「モックが実 API と一致」を完全に機械検証するのは原理的に困難
// （ライブ呼び出しなしでは実形状を取れない）。本テストはあくまで
// 「即席インラインモックの混入検知」に留め、実形状の正しさはフィクスチャ集約と
// レビュー観点の明文化（docs/dev/conventions.md）で担保する。
const TESTS_DIR = join(process.cwd(), "cli", "__tests__", "private");

// margin に限定する（他エンドポイントへの展開は監査結果に委ねる）。
const MARGIN_TESTS = ["margin-status.test.ts", "margin-positions.test.ts"];

describe("Chaos X-18: margin private tests use shared __fixtures__ (no inline ad-hoc mocks)", () => {
  for (const file of MARGIN_TESTS) {
    it(`${file} imports its mock shape from __fixtures__/private/`, () => {
      const src = readFileSync(join(TESTS_DIR, file), "utf-8");
      expect(
        /from\s+["'][^"']*__fixtures__\/private\/[^"']+["']/.test(src),
        `${file} must import its mock from cli/__tests__/__fixtures__/private/ instead of defining an inline ad-hoc mock (see docs/dev/conventions.md).`,
      ).toBe(true);
    });
  }
});
