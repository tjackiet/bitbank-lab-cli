import { describe, expect, it } from "vitest";
import { candles } from "../../../commands/public/candles.js";
import { mockFetchData } from "../../test-helpers.js";

const MOCK_HOURLY = {
  candlestick: [
    {
      type: "1hour",
      ohlcv: [["100", "110", "90", "105", "50", 1709164800000]],
    },
  ],
};

describe("Chaos P-10: candles --date real-date validation", () => {
  it("rejects 2025-02-30 (day out of range for February)", async () => {
    const r = await candles({ pair: "btc_jpy", type: "1hour", date: "20250230" });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error).toContain("day");
      expect(r.error).toContain("30");
    }
  });

  it("rejects 2025-02-29 (non-leap year)", async () => {
    const r = await candles({ pair: "btc_jpy", type: "1hour", date: "20250229" });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error).toContain("day");
  });

  it("rejects 2025-13-01 (month out of range)", async () => {
    const r = await candles({ pair: "btc_jpy", type: "1hour", date: "20251301" });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error).toContain("month");
      expect(r.error).toContain("13");
    }
  });

  it("accepts 2024-02-29 (leap year)", async () => {
    const r = await candles(
      { pair: "btc_jpy", type: "1hour", date: "20240229", noCache: true },
      { fetch: mockFetchData(MOCK_HOURLY), retries: 0 },
    );
    expect(r.success).toBe(true);
  });

  it("rejects year 9999 (above range)", async () => {
    const r = await candles({ pair: "btc_jpy", type: "1hour", date: "99991231" });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error).toContain("year");
  });

  it("rejects year 0000 (below range)", async () => {
    const r = await candles({ pair: "btc_jpy", type: "1hour", date: "00000101" });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error).toContain("year");
  });

  it("rejects yearly type with year out of range (--type=1day --date=9999)", async () => {
    const r = await candles({ pair: "btc_jpy", type: "1day", date: "9999" });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error).toContain("year");
  });
});
