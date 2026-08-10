import { describe, expect, it } from "vitest";
import { candlePairsFor, marketScope, pairAssetsOf } from "../../portfolio/scope.js";
import { trade } from "./factories.js";

const MASTER = [
  { name: "btc_jpy", base_asset: "btc", quote_asset: "jpy" },
  { name: "xrp_jpy", base_asset: "xrp", quote_asset: "jpy" },
  { name: "xrp_btc", base_asset: "xrp", quote_asset: "btc" },
] as const;

describe("marketScope", () => {
  it("約定取得は全ペア、candle 用は JPY ペアに分ける", () => {
    const s = marketScope(MASTER);
    expect(s.allPairs).toEqual(["btc_jpy", "xrp_btc", "xrp_jpy"]);
    expect(s.jpyPairs).toEqual(["btc_jpy", "xrp_jpy"]);
    expect(s.allAssets).toEqual(["btc", "jpy", "xrp"]);
  });
});

describe("candlePairsFor", () => {
  it("非 JPY 約定の base/quote をマスタから拾い、JPY 建て candle を選ぶ", () => {
    const pairs = candlePairsFor(
      ["btc_jpy", "xrp_jpy"],
      [],
      {
        trades: [trade({ pair: "xrp_btc", side: "buy", amount: 1, price: 0.00002 })],
        deposits: [],
        withdrawals: [],
      },
      pairAssetsOf(MASTER),
    );
    expect(pairs).toEqual(["btc_jpy", "xrp_jpy"]);
  });
});
