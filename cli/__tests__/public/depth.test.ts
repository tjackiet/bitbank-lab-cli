import { describe, expect, it } from "vitest";
import { depth } from "../../commands/public/depth.js";
import { mockFetchData, mockFetchRaw } from "../test-helpers.js";

const MOCK_DEPTH = {
  asks: [
    ["100", "1.0"],
    ["101", "2.0"],
  ],
  bids: [["99", "1.5"]],
  asks_over: "10.5",
  asks_under: "0",
  bids_over: "0",
  bids_under: "5.25",
  ask_market: "0",
  bid_market: "0",
  timestamp: 1000,
  sequenceId: "1234567890",
};

describe("depth", () => {
  it("returns error when pair is missing", async () => {
    const result = await depth({ pair: undefined });
    expect(result.success).toBe(false);
  });

  it("returns parsed depth", async () => {
    const result = await depth(
      { pair: "btc_jpy" },
      { fetch: mockFetchData(MOCK_DEPTH), retries: 0 },
    );
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.asks).toHaveLength(2);
      expect(result.data.bids).toHaveLength(1);
      expect(typeof result.data.asks[0][0]).toBe("number");
      expect(typeof result.data.asks[0][1]).toBe("number");
      expect(result.data.asks[0][0]).toBe(100);
      expect(result.data.asks[0][1]).toBe(1);
      // API が文字列で返す板外集計・成行量・sequenceId が number に正規化される
      expect(typeof result.data.sequenceId).toBe("number");
      expect(result.data.sequenceId).toBe(1234567890);
      expect(typeof result.data.asks_over).toBe("number");
      expect(result.data.asks_over).toBe(10.5);
      expect(result.data.bids_under).toBe(5.25);
      expect(result.data.ask_market).toBe(0);
      expect(result.data.bid_market).toBe(0);
    }
  });

  it("propagates API error", async () => {
    const result = await depth(
      { pair: "btc_jpy" },
      {
        fetch: mockFetchRaw({ success: 0, data: { code: 70001 } }),
        retries: 0,
      },
    );
    expect(result.success).toBe(false);
  });

  it("returns error on invalid response shape", async () => {
    const result = await depth(
      { pair: "btc_jpy" },
      { fetch: mockFetchData("invalid"), retries: 0 },
    );
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toContain("Invalid response");
  });
});
