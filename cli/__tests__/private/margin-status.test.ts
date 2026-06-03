import { describe, expect, it } from "vitest";
import { marginStatus } from "../../commands/private/margin-status.js";
import { TEST_CREDS, mockFetchData, mockFetchRaw } from "../test-helpers.js";

const MOCK = {
  status: "NORMAL",
  total_margin_balance: "1000000.0000",
  total_margin_balance_percentage: "300.00",
  margin_position_profit_loss: "500.0000",
  margin_call_percentage: "100",
  losscut_percentage: "50",
  buy_credit: "900000",
  sell_credit: "900000",
};

describe("marginStatus", () => {
  it("returns margin status", async () => {
    const result = await marginStatus({
      fetch: mockFetchData(MOCK),
      retries: 0,
      credentials: TEST_CREDS,
      nonce: "1",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      // status は文字列のまま通る
      expect(result.data.status).toBe("NORMAL");
      // 文字列 → number 変換
      expect(result.data.total_margin_balance).toBe(1000000);
      expect(typeof result.data.total_margin_balance).toBe("number");
      expect(result.data.margin_position_profit_loss).toBe(500);
      expect(result.data.buy_credit).toBe(900000);
    }
  });

  it("accepts null for nullable percentage fields (no positions)", async () => {
    const result = await marginStatus({
      fetch: mockFetchData({
        ...MOCK,
        total_margin_balance_percentage: null,
        margin_call_percentage: null,
        losscut_percentage: null,
      }),
      retries: 0,
      credentials: TEST_CREDS,
      nonce: "1",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.total_margin_balance_percentage).toBe(null);
      expect(result.data.margin_call_percentage).toBe(null);
      expect(result.data.losscut_percentage).toBe(null);
    }
  });

  it("propagates API error", async () => {
    const result = await marginStatus({
      fetch: mockFetchRaw({ success: 0, data: { code: 70001 } }),
      retries: 0,
      credentials: TEST_CREDS,
      nonce: "1",
    });
    expect(result.success).toBe(false);
  });

  it("returns error on invalid response shape", async () => {
    const result = await marginStatus({
      fetch: mockFetchData("invalid"),
      retries: 0,
      credentials: TEST_CREDS,
      nonce: "1",
    });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toContain("Invalid response");
  });
});
