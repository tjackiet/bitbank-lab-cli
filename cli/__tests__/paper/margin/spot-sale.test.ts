// 100行超: 追証の解消の行為としての現物の売却（lazy tick の指値の売り・paper create-order の成行の売り）を、
// 数える売り・数えない売り（基準時より前・JPY 以外・状態が古い）の両側から検査する
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { paperCreateOrder } from "../../../commands/paper/create-order.js";
import { marginParamsOf } from "../../../paper-margin/params.js";
import type { SpotFill } from "../../../paper-margin/spot-sale.js";
import { applyMarginTick } from "../../../paper-margin/tick.js";
import { loadState, type PaperState } from "../../../paper-state.js";
import {
  BTC,
  candlesOf,
  longPosition,
  MIN,
  pairsOf,
  seedState,
  stateAt,
  tickerAt,
} from "./fixtures.js";

const P = Date.parse;
const iso = (ms: number) => new Date(ms).toISOString();
const LAST = "2026-11-02T00:00:00.000Z"; // 09:00 JST
const T0 = P(LAST);
const CALL = { judgedAt: LAST, deadline: "2026-11-03T00:00:00.000Z", amount: 110_000 };

describe("a spot limit sell filled in the tick (applyMarginTick)", () => {
  // JPY 600,000・ロング 0.1 @ 10,000,000・最後の足 9,900,000 → B 590,000 ≥ Mm 500,000（値は戻っている）
  const state = stateAt(
    LAST,
    { balances: { jpy: 600_000 } },
    {
      positions: [longPosition(LAST)],
      call: { ...CALL, judgedAt: iso(T0 + 5 * MIN) },
    },
  );
  const lookup = marginParamsOf(BTC, T0);
  if (lookup.kind !== "ok") throw new Error(lookup.kind);
  const input = {
    candlesByPair: new Map([
      [
        "btc_jpy",
        [{ timestamp: T0 + 9 * MIN, open: 9.9e6, high: 9.9e6, low: 9.9e6, close: 9.9e6, vol: 1 }],
      ],
    ]),
    params: new Map([["btc_jpy", lookup.params]]),
    candleFromMs: T0,
    periodMs: MIN,
    approximate: false,
  };
  const run = (spotFills: SpotFill[]) => {
    const r = applyMarginTick(state, input, T0 + 10 * MIN, { spotFills, newId: () => "x" });
    if (!r.success) throw new Error(r.error);
    return r.data.state.margin.call;
  };

  it("resolves the call when a JPY sale filled at or after the judgment", () => {
    expect(run([{ pair: "btc_jpy", side: "sell", filledAt: iso(T0 + 6 * MIN) }])).toBe(null);
  });

  it("does not count a sale from before the call was judged (price recovery alone does not resolve)", () => {
    expect(run([{ pair: "btc_jpy", side: "sell", filledAt: iso(T0 + 2 * MIN) }])).not.toBe(null);
  });

  it("does not count a sale on a non-JPY pair (no JPY comes in), nor a buy", () => {
    expect(run([{ pair: "eth_btc", side: "sell", filledAt: iso(T0 + 6 * MIN) }])).not.toBe(null);
    expect(run([{ pair: "btc_jpy", side: "buy", filledAt: iso(T0 + 6 * MIN) }])).not.toBe(null);
  });
});

describe("paper create-order: a spot market sell during a margin call", () => {
  let dir: string;
  let statePath: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "paper-spot-sale-"));
    statePath = join(dir, "paper-state.json");
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  // JPY 400,000・現物 0.02 BTC・ロング 0.1 @ 10,000,000・価格 9,900,000 → B 390,000 < Mm 500,000（追証中）
  async function seed() {
    const s = stateAt(LAST, { balances: { jpy: 400_000, btc: 0.02 } });
    await seedState(statePath, {
      ...s,
      margin: { ...s.margin, positions: [longPosition(LAST)], call: CALL },
    });
  }
  const sell = (over: Partial<Parameters<typeof paperCreateOrder>[0]> = {}) =>
    paperCreateOrder(
      {
        ...{ pair: "btc_jpy", side: "sell", type: "market", amount: "0.02", statePath },
        ...{ getPairs: pairsOf(BTC), nowMs: T0 + 10 * MIN },
        fetchCandles: candlesOf([[T0 + MIN, 9_900_000, 9_900_000]]),
        ...over,
      },
      tickerAt(9_900_000),
    );
  const call = async (): Promise<PaperState["margin"]["call"]> => {
    const r = await loadState(statePath);
    if (!r.success || !r.data) throw new Error("load failed");
    return r.data.margin.call;
  };

  it("resolves the call when the sale brings B ≥ Mm (JPY + 198,000 − taker fee)", async () => {
    await seed();
    const r = await sell();
    if (!r.success || !("fillPrice" in r.data)) throw new Error(JSON.stringify(r));
    expect(r.data.marginCallResolved).toBe(true);
    expect(await call()).toBe(null);
  });

  it("keeps the call when the sale is too small", async () => {
    await seed();
    const r = await sell({ amount: "0.001" });
    if (!r.success || !("fillPrice" in r.data)) throw new Error(JSON.stringify(r));
    expect(r.data.marginCallResolved).toBe(false);
    expect(await call()).toEqual(CALL);
  });

  it("does not resolve on a stale margin state (the lazy tick could not scan up to now)", async () => {
    await seed();
    const r = await sell({ fetchCandles: async () => ({ success: false, error: "boom" }) });
    if (!r.success || !("fillPrice" in r.data)) throw new Error(JSON.stringify(r));
    expect(r.data.marginCallResolved).toBe(false);
    expect(await call()).toEqual(CALL);
  });

  it("adds no marginCallResolved field when there is no margin call", async () => {
    await seedState(statePath, stateAt(LAST, { balances: { jpy: 400_000, btc: 0.02 } }));
    const r = await sell();
    expect(r.success && "marginCallResolved" in r.data).toBe(false);
  });
});
