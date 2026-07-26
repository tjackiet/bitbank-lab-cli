// イベント → 仕訳（付録A の対応表）。手数料の扱いが税務上の分岐点なので、
// 購入時（取得価額算入）・売却時（必要経費）・負値（リベート収入 P-04）を固定する。
import { describe, expect, it } from "vitest";
import { ledgerFromEvents } from "../../../tax/ledger/from-events.js";
import type { TaxEvent } from "../../../tax/schema/event.js";
import type { EventFlag } from "../../../tax/schema/primitives.js";

const common = {
  source_ref: "1",
  ts_utc: 1_767_225_600_000,
  ts_jst: "2026-01-01T09:00:00+09:00",
  year_jst: 2026,
  account_id: "bitbank:default",
  source_system: "API",
  currency: "btc",
  recognition_policy: "DELIVERY_DATE",
  market_type: "ORDERBOOK",
  pair_raw: "btc_jpy",
  flags: [] as EventFlag[],
} as const;

const fee = (quote: string) => ({ quote_charged: quote, quote_occurred: quote, base: "0" });

const buy = (feeQuote: string): TaxEvent =>
  ({
    ...common,
    event_id: "trade:1",
    kind: "TRADE_SPOT_BUY",
    qty: "0.1",
    jpy_value: "1000000",
    costbasis_provenance: "PURCHASE",
    fee: fee(feeQuote),
  }) as TaxEvent;

const sell = (feeQuote: string): TaxEvent =>
  ({
    ...common,
    event_id: "trade:2",
    source_ref: "2",
    kind: "TRADE_SPOT_SELL",
    qty: "0.1",
    jpy_value: "1200000",
    fee: fee(feeQuote),
  }) as TaxEvent;

describe("現物の仕訳化", () => {
  it("購入時手数料は取得価額に算入する（必要経費に再掲しない）", () => {
    const { entries } = ledgerFromEvents([buy("550")]);
    expect(entries).toHaveLength(1);
    expect(entries[0].kind).toBe("ACQUIRE");
    expect(entries[0].cost_jpy).toBe("1000550"); // FAQ 1-5 の設例と同じ構造
  });

  it("売却時手数料は必要経費として別仕訳になる", () => {
    const { entries } = ledgerFromEvents([sell("600")]);
    expect(entries.map((e) => e.kind)).toEqual(["DISPOSE", "EXPENSE"]);
    expect(entries[0].proceeds_jpy).toBe("1200000");
    expect(entries[1].amount_jpy).toBe("600");
    expect(entries[1].category).toBe("expense_fee");
  });

  it("負の手数料（メイカーリベート）は収入計上する（P-04）", () => {
    const { entries } = ledgerFromEvents([buy("-12.3456")]);
    expect(entries.map((e) => e.kind)).toEqual(["ACQUIRE", "INCOME"]);
    // リベートは取得価額を減らさない（簿価中立）
    expect(entries[0].cost_jpy).toBe("1000000");
    expect(entries[1].amount_jpy).toBe("12.3456");
    expect(entries[1].policy_ids).toContain("P-04");
  });
});

describe("信用の仕訳化", () => {
  const marginClose = (net: string): TaxEvent =>
    ({
      ...common,
      event_id: "margin:3",
      source_ref: "3",
      kind: "MARGIN_CLOSE",
      qty: "0.5",
      jpy_value: "5000000",
      margin: {
        position_side: "long",
        role: "CLOSE",
        realized_net: net,
        interest: "-5",
        fee_charged: "100",
        fee_occurred: "100",
      },
    }) as TaxEvent;

  it("決済益は銘柄別の INCOME（fee / interest を再控除しない）", () => {
    const { entries } = ledgerFromEvents([marginClose("1000")]);
    expect(entries).toHaveLength(1);
    expect(entries[0].kind).toBe("INCOME");
    expect(entries[0].currency).toBe("btc");
    expect(entries[0].amount_jpy).toBe("1000"); // 100 の手数料を引かない
  });

  it("決済損は EXPENSE（絶対値で計上）", () => {
    const { entries } = ledgerFromEvents([marginClose("-2500")]);
    expect(entries[0].kind).toBe("EXPENSE");
    expect(entries[0].amount_jpy).toBe("2500");
  });

  it("新規建ては仕訳を作らない（決済年に帰属させるため）", () => {
    const open = { ...marginClose("0"), kind: "MARGIN_OPEN" } as TaxEvent;
    expect(ledgerFromEvents([open]).entries).toEqual([]);
  });
});

describe("仕訳を作らないイベント", () => {
  it("入出庫は課税イベントではないので仕訳ゼロ", () => {
    const deposit = { ...common, event_id: "dep:1", kind: "DEPOSIT", qty: "1" } as TaxEvent;
    const withdrawal = { ...common, event_id: "wd:1", kind: "WITHDRAWAL", qty: "1" } as TaxEvent;
    const r = ledgerFromEvents([deposit, withdrawal]);
    expect(r.entries).toEqual([]);
    expect(r.deferred).toEqual([]);
  });

  it("TRADE_EXCHANGE は deferred に積んで理由を残す（P0 では計算しない）", () => {
    const ex = {
      ...common,
      event_id: "trade:9",
      kind: "TRADE_EXCHANGE",
      qty: "1",
      costbasis_provenance: "EXCHANGE_FMV",
      flags: ["NON_JPY_QUOTE", "NO_RATE"],
    } as TaxEvent;
    const r = ledgerFromEvents([ex]);
    expect(r.entries).toEqual([]);
    expect(r.deferred[0].currency).toBe("btc");
    expect(r.deferred[0].reason).toContain("TRADE_EXCHANGE");
  });

  it("円換算額の無い現物約定は deferred（0 円として飲み込まない）", () => {
    const broken = { ...buy("0"), jpy_value: undefined } as TaxEvent;
    const r = ledgerFromEvents([broken]);
    expect(r.entries).toEqual([]);
    expect(r.deferred[0].reason).toContain("jpy_value");
  });
});
