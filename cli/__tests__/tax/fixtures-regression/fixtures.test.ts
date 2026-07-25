import { describe, expect, it } from "vitest";
import { checkFixtures, formatMismatch } from "./guard.js";

// 実データ回帰テスト。**データ無しなら skip・データ相違なら fail**（docs/dev/tax-fixtures-plan.md）。
// 実データは本リポジトリに置かないため、CI では常に skip 経路に入る。
const state = checkFixtures();

if (state.kind === "skip") {
  // 黙って緑にすると「回帰が通った」と誤解されるため、必ず理由を出す
  console.info(`[fixtures-regression] skip: ${state.reason}`);
}

describe("実データ fixtures の同一性", () => {
  it("manifest と一致する（データ相違は skip ではなく fail）", () => {
    if (state.kind === "skip") return; // データ無し → 検証しない
    if (state.kind === "mismatch") expect.fail(formatMismatch(state));
    expect(state.files).toBeGreaterThan(0);
  });
});

// 実データがある環境でのみ走る本体。移植元の原型は scripts/dev/tax/tests/ にある
// （node --test で動く。原型は検証済みオラクルとして保全する）。
const describeWithFixtures = state.kind === "ready" ? describe : describe.skip;

describeWithFixtures("実データ回帰（P0-2 で原型から移植）", () => {
  it.todo("(1) ページ内重複なし・ページ間の重複は隣接ページのみ");
  it.todo("(2) 現物全行で fee_amount_quote == fee_occurred_amount_quote");
  it.todo("(3) 信用決済行の profit_loss 検算");
  it.todo("(4) 型スナップショット照合");
  it.todo("(5) 残高突合: 原型 reconcile.ts と製品コードの結果が一致する（恒久差分検証）");
});
