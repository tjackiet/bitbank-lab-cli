import { describe, expect, it, vi } from "vitest";
import { output } from "../../../output.js";

describe("Chaos F-01: empty data array in all formats", () => {
  it("json: outputs empty array in envelope data", () => {
    const spy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    output({ success: true, data: [] }, "json");
    const out = spy.mock.calls.map((c) => c[0]).join("");
    expect(JSON.parse(out).data).toEqual([]);
    spy.mockRestore();
  });

  it("table: does not crash on empty array", () => {
    const spy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    output({ success: true, data: [] }, "table");
    const out = spy.mock.calls.map((c) => c[0]).join("");
    // Empty array → no output (printTable returns early)
    expect(out).toBe("");
    spy.mockRestore();
  });

  it("csv: does not crash on empty array", () => {
    const spy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    output({ success: true, data: [] }, "csv");
    const out = spy.mock.calls.map((c) => c[0]).join("");
    expect(out).toBe("");
    spy.mockRestore();
  });
});
