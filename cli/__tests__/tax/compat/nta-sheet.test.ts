// 国税庁計算書（NTA_SHEET_2025_12）互換モード（検証アンカー 2）。
//
// 固定するのは 2 つ。**公式設例を再現すること**と、**既定と丸め位置が違うこと**。
// 後者が要る理由: FAQ の設例は値がすべて割り切れるので、互換モードを何も実装せず
// 既定値をそのまま返しても設例テストは通ってしまう。丸めが実際に効くケースを
// 別に置かないと「互換になっている」ことを担保できない。
import { describe, expect, it } from "vitest";
import { ntaCompat } from "../../../tax/compat/nta-sheet.js";
import { movingAverage } from "../../../tax/engine/moving-average.js";
import { totalAverage, ZERO_BOOK } from "../../../tax/engine/total-average.js";
import type { LedgerEntry } from "../../../tax/schema/ledger.js";

const DAY = 86_400_000;
const base = (seq: number) => ({
  event_id: `trade:${seq}`,
  seq: 0,
  currency: "btc",
  year_jst: 2026,
  ts_utc: seq * DAY,
  sort_key: `${seq}:0`,
  policy_ids: [],
});
const acquire = (seq: number, qty: string, cost: string): LedgerEntry => ({
  ...base(seq),
  kind: "ACQUIRE",
  qty,
  cost_jpy: cost,
  category: "purchase",
});
const dispose = (seq: number, qty: string, proceeds: string): LedgerEntry => ({
  ...base(seq),
  kind: "DISPOSE",
  qty,
  proceeds_jpy: proceeds,
  category: "sale",
});

/** 付録D.4 の公式設例（FAQ 2-4 / 2-8）。 */
const FAQ: LedgerEntry[] = [
  acquire(1, "4", "1845000"),
  acquire(2, "2", "1650000"),
  dispose(3, "2", "2400000"),
  acquire(4, "0.5", "542800"),
  dispose(5, "3", "2895000"),
];

describe("公式設例の再現（付録D.4）", () => {
  it("総平均法: 譲渡原価 3,106,000 / 年末残高 931,800 / 所得 2,189,000", () => {
    const c = ntaCompat(totalAverage("btc", FAQ, ZERO_BOOK), FAQ);
    expect(c).toMatchObject({
      mode: "NTA_SHEET_2025_12",
      cogs_jpy: "3106000",
      closing_cost_jpy: "931800",
      income_total_jpy: "5295000",
      expense_total_jpy: "3106000",
      income_jpy: "2189000",
      carryover_cost_jpy: "931800",
    });
  });

  it("移動平均法: 譲渡原価 3,080,200 / 年末残高価額 957,600", () => {
    const c = ntaCompat(movingAverage("btc", FAQ, ZERO_BOOK), FAQ);
    expect(c).toMatchObject({ cogs_jpy: "3080200", closing_cost_jpy: "957600" });
  });
});

describe("既定と丸め位置が違う（互換モードが効いている証拠）", () => {
  // 収入 1000.4 / 必要経費 1000.3。丸め前の差は +0.1 だが、
  // 計算書は収入を切捨て・経費を切上げるので 1000 − 1001 = −1 になる
  it("総平均法: 収入は切捨て・必要経費は切上げ（所得は丸めた両者の差）", () => {
    const entries = [acquire(1, "3", "3000"), dispose(2, "1", "1000.4")];
    const outcome = totalAverage("btc", entries, ZERO_BOOK);
    outcome.expense = { n: 3n, d: 10n }; // 手数料等 0.3
    const c = ntaCompat(outcome, entries);
    expect(c).toMatchObject({
      income_total_jpy: "1000", // ROUNDDOWN(1000.4)
      expense_total_jpy: "1001", // ROUNDUP(1000.3)
      income_jpy: "-1",
    });
  });

  // 単価 1000/3 の状態で 1 単位売ると、残高は ceil(1000/3 × 2) = 667 へ切上がる。
  // 既定は残高 2000/3（≒666.67）なので、譲渡原価が 1 円ぶん軽くなる
  it("移動平均法: 売却の都度、残高価額を切上げる", () => {
    const entries = [acquire(1, "3", "1000"), dispose(2, "1", "500")];
    const c = ntaCompat(movingAverage("btc", entries, ZERO_BOOK), entries);
    expect(c.closing_cost_jpy).toBe("667");
    expect(c.cogs_jpy).toBe("333"); // (0 + 1000) − 667
  });

  it("全量処分なら残高はゼロ（切上げても増えない）", () => {
    const entries = [acquire(1, "3", "1000"), dispose(2, "3", "1200")];
    const c = ntaCompat(movingAverage("btc", entries, ZERO_BOOK), entries);
    expect(c.closing_cost_jpy).toBe("0");
    expect(c.cogs_jpy).toBe("1000");
  });
});
