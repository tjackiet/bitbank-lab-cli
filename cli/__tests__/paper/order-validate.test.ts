import { describe, expect, it } from "vitest";
import { validateOrderSize } from "../../commands/paper/order-validate.js";
import { MOCK_PAIRS } from "../test-helpers.js";

describe("validateOrderSize: unit_amount multiple", () => {
  it("rejects amount that is not a multiple of unit_amount", () => {
    const r = validateOrderSize("btc_jpy", "limit", 0.00015, MOCK_PAIRS);
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error).toContain("unit_amount");
  });

  it("rejects market amount that is not a multiple of unit_amount", () => {
    const r = validateOrderSize("btc_jpy", "market", 0.00015, MOCK_PAIRS);
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error).toContain("unit_amount");
  });

  it("accepts amount equal to unit_amount", () => {
    expect(validateOrderSize("btc_jpy", "limit", 0.0001, MOCK_PAIRS).success).toBe(true);
  });

  it("accepts amount that is an exact integer multiple of unit_amount", () => {
    expect(validateOrderSize("btc_jpy", "limit", 0.001, MOCK_PAIRS).success).toBe(true);
  });

  it("does not false-reject due to floating point artifact (0.0003 / 0.0001)", () => {
    // 0.0003 / 0.0001 === 2.9999999999999996 in IEEE 754
    expect(validateOrderSize("btc_jpy", "limit", 0.0003, MOCK_PAIRS).success).toBe(true);
  });

  it("does not false-reject 0.1 + 0.2 (= 0.30000000000000004)", () => {
    expect(validateOrderSize("btc_jpy", "limit", 0.1 + 0.2, MOCK_PAIRS).success).toBe(true);
  });
});

describe("validateOrderSize: price_digits", () => {
  it("rejects price with more decimals than price_digits", () => {
    const r = validateOrderSize("btc_jpy", "limit", 0.001, MOCK_PAIRS, 5000000.5);
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error).toContain("price_digits");
  });

  it("accepts integer price when price_digits=0", () => {
    expect(validateOrderSize("btc_jpy", "limit", 0.001, MOCK_PAIRS, 5000000).success).toBe(true);
  });

  it("accepts price within price_digits when pair allows decimals", () => {
    const pairs = MOCK_PAIRS.map((p) => (p.name === "btc_jpy" ? { ...p, price_digits: 3 } : p));
    expect(validateOrderSize("btc_jpy", "limit", 0.001, pairs, 5000000.123).success).toBe(true);
  });

  it("rejects price exceeding price_digits when pair allows some decimals", () => {
    const pairs = MOCK_PAIRS.map((p) => (p.name === "btc_jpy" ? { ...p, price_digits: 2 } : p));
    const r = validateOrderSize("btc_jpy", "limit", 0.001, pairs, 5000000.123);
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error).toContain("price_digits");
  });

  it("skips price check when price is undefined (market orders)", () => {
    expect(validateOrderSize("btc_jpy", "market", 0.001, MOCK_PAIRS).success).toBe(true);
  });
});
