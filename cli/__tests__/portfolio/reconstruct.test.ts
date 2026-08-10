// 100行超: 逆算の細部（手数料・status・時刻カーソル）を 1 ケース 1 事実で固定する。
// ここが移植の要で、1 つ落とすと静かに値がずれるのでケースを間引かない。
import { describe, expect, it } from "vitest";
import { reconstructHoldingsAtDate } from "../../portfolio/reconstruct.js";
import { deposit, NO_TRANSFERS, trade, withdrawal } from "./factories.js";

const SINCE = 500;

describe("reconstructHoldingsAtDate — 約定の巻き戻し", () => {
  it("買いは qty ではなく (qty - feeBase) を戻す（base 建て手数料）", () => {
    // 1.0 BTC の買いで base 手数料 0.01 → 実際に増えたのは 0.99。
    // 現在 1.0 BTC なら約定前は 0.01 BTC。素朴に qty を戻すと 0（保有が消える）。
    const holdings = reconstructHoldingsAtDate(
      [{ asset: "btc", amount: 1 }],
      [trade({ side: "buy", amount: 1, price: 1_000_000, fee_amount_base: 0.01 })],
      SINCE,
      NO_TRANSFERS,
    );
    expect(holdings.get("btc")).toBeCloseTo(0.01, 12);
    // 素朴な qty 巻き戻しなら 0 になり、DUST 判定で削除される
    expect(holdings.has("btc")).toBe(true);
  });

  it("買いは JPY 側に (qty × price + feeQuote) を戻す", () => {
    const holdings = reconstructHoldingsAtDate(
      [
        { asset: "btc", amount: 1 },
        { asset: "jpy", amount: 0 },
      ],
      [trade({ side: "buy", amount: 1, price: 1_000_000, fee_amount_quote: 1_200 })],
      SINCE,
      NO_TRANSFERS,
    );
    expect(holdings.get("jpy")).toBe(1_001_200);
  });

  it("売りは base を戻し、受取 JPY（qty × price − feeQuote）を除く", () => {
    const holdings = reconstructHoldingsAtDate(
      [{ asset: "jpy", amount: 1_000_000 }],
      [trade({ side: "sell", amount: 1, price: 1_000_000, fee_amount_quote: 1_200 })],
      SINCE,
      NO_TRANSFERS,
    );
    expect(holdings.get("btc")).toBe(1);
    expect(holdings.get("jpy")).toBe(1_200);
  });

  it("売りでも feeBase を戻す（base 建て手数料はどちら向きでも base から引かれる）", () => {
    // 移植元（MCP）は売りで qty しか戻さない。cli/tax/reconcile/rebuild.ts は買い・売りの
    // 両方で base 手数料を base から引いており、そちらに揃えてある
    const holdings = reconstructHoldingsAtDate(
      [],
      [trade({ side: "sell", amount: 1, price: 1_000_000, fee_amount_base: 0.002 })],
      SINCE,
      NO_TRANSFERS,
    );
    expect(holdings.get("btc")).toBeCloseTo(1.002, 12);
    expect(holdings.get("btc")).not.toBe(1);
  });

  it("since より前の約定は巻き戻さない", () => {
    const holdings = reconstructHoldingsAtDate(
      [{ asset: "btc", amount: 1 }],
      [trade({ side: "buy", amount: 1, price: 1_000_000, executed_at: SINCE - 1 })],
      SINCE,
      NO_TRANSFERS,
    );
    expect(holdings.get("btc")).toBe(1);
  });

  it("新しい約定から順に巻き戻す（複数件の合成）", () => {
    const trades = [
      trade({ side: "buy", amount: 1, price: 1_000_000, executed_at: 1_000 }),
      trade({ side: "buy", amount: 2, price: 2_000_000, executed_at: 2_000 }),
    ];
    const holdings = reconstructHoldingsAtDate(
      [
        { asset: "btc", amount: 3 },
        { asset: "jpy", amount: 0 },
      ],
      trades,
      SINCE,
      NO_TRANSFERS,
    );
    expect(holdings.has("btc")).toBe(false); // 3 - 1 - 2 = 0
    expect(holdings.get("jpy")).toBe(5_000_000);
  });
});

describe("reconstructHoldingsAtDate — 入出金の巻き戻し", () => {
  it("出金は amount + fee を足し戻す（当時は手数料も口座にあった）", () => {
    const holdings = reconstructHoldingsAtDate([], [], SINCE, {
      deposits: [],
      withdrawals: [withdrawal({ asset: "xrp", amount: 100, fee: 0.15 })],
    });
    expect(holdings.get("xrp")).toBeCloseTo(100.15, 12);
    expect(holdings.get("xrp")).not.toBe(100);
  });

  it("入金は amount を引く", () => {
    const holdings = reconstructHoldingsAtDate([{ asset: "jpy", amount: 30_000 }], [], SINCE, {
      deposits: [deposit({ asset: "jpy", amount: 10_000 })],
      withdrawals: [],
    });
    expect(holdings.get("jpy")).toBe(20_000);
  });

  it("status !== DONE の入出金は反映しない", () => {
    const holdings = reconstructHoldingsAtDate([{ asset: "jpy", amount: 30_000 }], [], SINCE, {
      deposits: [deposit({ asset: "jpy", amount: 10_000, status: "FOUND" })],
      withdrawals: [withdrawal({ asset: "jpy", amount: 5_000, fee: 550, status: "PENDING" })],
    });
    expect(holdings.get("jpy")).toBe(30_000);
  });

  it("confirmed_at が欠けた DONE 入金は found_at を時刻に使う（黙って落とさない）", () => {
    const inWindow = deposit({
      asset: "jpy",
      amount: 10_000,
      confirmed_at: undefined,
      found_at: SINCE + 1,
    });
    const beforeWindow = deposit({
      asset: "jpy",
      amount: 7_000,
      uuid: "old",
      confirmed_at: undefined,
      found_at: SINCE - 1,
    });
    const holdings = reconstructHoldingsAtDate([{ asset: "jpy", amount: 30_000 }], [], SINCE, {
      deposits: [inWindow, beforeWindow],
      withdrawals: [],
    });
    expect(holdings.get("jpy")).toBe(20_000);
  });

  it("since より前の入出金は巻き戻さない", () => {
    const holdings = reconstructHoldingsAtDate([{ asset: "jpy", amount: 30_000 }], [], SINCE, {
      deposits: [deposit({ asset: "jpy", amount: 10_000, confirmed_at: SINCE - 1 })],
      withdrawals: [withdrawal({ asset: "jpy", amount: 5_000, fee: 550, requested_at: SINCE - 1 })],
    });
    expect(holdings.get("jpy")).toBe(30_000);
  });
});
