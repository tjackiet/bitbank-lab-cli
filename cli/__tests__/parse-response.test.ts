import { describe, expect, it } from "vitest";
import { z } from "zod";
import { parseResponse } from "../parse-response.js";
import type { Result } from "../types.js";

const TickerSchema = z.object({ last: z.number(), nested: z.object({ v: z.number() }).optional() });

describe("parseResponse meta/partial passthrough", () => {
  it("carries meta (rateLimit) from input result to parsed result", () => {
    const input: Result<unknown> = {
      success: true,
      data: { last: 100 },
      meta: { rateLimit: { remaining: 5, limit: 10, reset: 1 } },
    };
    const r = parseResponse(input, TickerSchema);
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.last).toBe(100);
      expect(r.meta?.rateLimit).toEqual({ remaining: 5, limit: 10, reset: 1 });
    }
  });

  it("carries partial flag through", () => {
    const input: Result<unknown> = { success: true, data: { last: 100 }, partial: true };
    const r = parseResponse(input, TickerSchema);
    expect(r.success && r.partial).toBe(true);
  });

  it("carries meta through the key-selecting overload", () => {
    const input: Result<unknown> = {
      success: true,
      data: { last: 1, nested: { v: 7 } },
      meta: { dedupedCount: 2 },
    };
    const r = parseResponse(input, TickerSchema, "nested");
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data).toEqual({ v: 7 });
      expect(r.meta?.dedupedCount).toBe(2);
    }
  });

  it("omits meta/partial when input has none", () => {
    const r = parseResponse({ success: true, data: { last: 100 } }, TickerSchema);
    expect(r.success).toBe(true);
    if (r.success) {
      expect("meta" in r).toBe(false);
      expect("partial" in r).toBe(false);
    }
  });

  it("passes through a failed input result unchanged", () => {
    const input: Result<unknown> = { success: false, error: "boom", exitCode: 3 };
    expect(parseResponse(input, TickerSchema)).toBe(input);
  });

  it("returns an error result when the schema rejects the data", () => {
    const r = parseResponse({ success: true, data: { last: "nope" } }, TickerSchema);
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error).toContain("Invalid response");
  });
});
