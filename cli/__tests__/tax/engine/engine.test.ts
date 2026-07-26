// エンジンの境界挙動。ゴールデンケースは golden-nta.test.ts が持つので、
// ここは**前提が崩れたときに黙って数値を出さない**ことを固定する。
import { describe, expect, it } from "vitest";
import { checkI1, checkI2, checkI3 } from "../../../tax/engine/invariants.js";
import { movingAverage } from "../../../tax/engine/moving-average.js";
import { runEngine } from "../../../tax/engine/run.js";
import { bookFromDecimal, totalAverage, ZERO_BOOK } from "../../../tax/engine/total-average.js";
import { toExactDecimalString } from "../../../tax/ratio-decimal.js";
import type { LedgerEntry } from "../../../tax/schema/ledger.js";

const DAY = 86_400_000;
const base = {
  currency: "btc",
  year_jst: 2026,
  category: "x",
  policy_ids: [] as string[],
};

const acquire = (seq: number, qty: string, cost: string): LedgerEntry => ({
  ...base,
  event_id: `a${seq}`,
  seq: 0,
  kind: "ACQUIRE",
  ts_utc: seq * DAY,
  sort_key: `a${seq}:0`,
  qty,
  cost_jpy: cost,
});

const dispose = (seq: number, qty: string, proceeds: string): LedgerEntry => ({
  ...base,
  event_id: `d${seq}`,
  seq: 0,
  kind: "DISPOSE",
  ts_utc: seq * DAY,
  sort_key: `d${seq}:0`,
  qty,
  proceeds_jpy: proceeds,
});

const exact = (r: { n: bigint; d: bigint }) => toExactDecimalString(r);

describe("総平均法の境界", () => {
  it("前年繰越を単価計算に含める", () => {
    const opening = bookFromDecimal("1", "500000");
    expect(opening).not.toBeNull();
    const o = totalAverage("btc", [acquire(1, "1", "700000")], opening as never);
    expect(exact(o.unit as never)).toBe("600000");
    expect(exact(o.closing.cost)).toBe("1200000");
    expect(checkI1(o)).toEqual([]);
  });

  it("取得ゼロで処分があるときは違反として報告する（0 円原価にしない）", () => {
    const o = totalAverage("btc", [dispose(1, "1", "100000")], ZERO_BOOK);
    expect(o.unit).toBeNull();
    expect(o.violations.join()).toContain("取得が 1 件も無い");
    expect(checkI2(o)).not.toEqual([]);
  });

  it("割り切れない単価でも I1 が厳密に成立する（丸めを挟まない）", () => {
    const entries = [acquire(1, "3", "100"), dispose(2, "1", "50")];
    const o = totalAverage("btc", entries, ZERO_BOOK);
    expect(exact(o.unit as never)).toBeNull(); // 100/3 は有限小数にならない
    expect(checkI1(o)).toEqual([]);
  });
});

describe("移動平均法の境界", () => {
  it("全量処分では簿価残を全額原価へ掃き出す（P-03）", () => {
    const entries = [acquire(1, "3", "100"), dispose(2, "3", "500")];
    const o = movingAverage("btc", entries, ZERO_BOOK);
    expect(exact(o.cogs)).toBe("100");
    expect(exact(o.closing.cost)).toBe("0");
    expect(exact(o.closing.qty)).toBe("0");
    expect(checkI2(o)).toEqual([]);
  });

  it("単価は処分では据置き、次の取得で更新される（FAQ 2-4 の年末単価の定義）", () => {
    const entries = [acquire(1, "2", "200"), dispose(2, "1", "500"), acquire(3, "1", "400")];
    const o = movingAverage("btc", entries, ZERO_BOOK);
    // 100 → (100 + 400) / 2 = 250
    expect(exact(o.unit as never)).toBe("250");
  });

  it("保有を超える処分は違反として報告し、簿価を壊さない", () => {
    const o = movingAverage("btc", [acquire(1, "1", "100"), dispose(2, "2", "500")], ZERO_BOOK);
    expect(o.violations.join()).toContain("処分数量が保有数量を超えています");
    expect(exact(o.closing.qty)).toBe("1");
  });

  it("時系列が入れ替わっていても sort_key で安定に並べ直す", () => {
    const entries = [acquire(3, "1", "400"), acquire(1, "2", "200"), dispose(2, "1", "500")];
    const o = movingAverage("btc", entries, ZERO_BOOK);
    expect(exact(o.unit as never)).toBe("250");
  });
});

describe("不変条件", () => {
  it("I3: 同一イベント由来の取得と処分の金額が食い違えば検出する", () => {
    const swap = (cost: string, proceeds: string): LedgerEntry[] => [
      { ...acquire(1, "1", cost), event_id: "ex:1" },
      { ...dispose(1, "1", proceeds), event_id: "ex:1" },
    ];
    expect(checkI3(swap("1000", "1000"))).toEqual([]);
    expect(checkI3(swap("1000", "999"))[0].id).toBe("I3");
  });
});

describe("runEngine", () => {
  it("JPY は評価対象の暗号資産ではないので銘柄集計から外す", () => {
    const jpy = { ...acquire(1, "1", "1"), currency: "jpy" };
    const r = runEngine({ entries: [jpy], method: "total-average", opening: {} });
    expect(r.size).toBe(0);
  });

  it("繰越だけあって当年の動きが無い銘柄も集計対象に残す", () => {
    const opening = { eth: ZERO_BOOK };
    const r = runEngine({ entries: [], method: "total-average", opening });
    expect(r.get("eth")?.openingKnown).toBe(true);
  });

  it("銘柄別に評価方法を上書きできる（種類ごとに選定する制度に合わせる）", () => {
    const entries = [acquire(1, "3", "100"), dispose(2, "3", "500")];
    const r = runEngine({
      entries,
      method: "total-average",
      methodByCurrency: { btc: "moving-average" },
      opening: { btc: ZERO_BOOK },
    });
    expect(r.get("btc")?.outcome.method).toBe("moving-average");
  });
});
