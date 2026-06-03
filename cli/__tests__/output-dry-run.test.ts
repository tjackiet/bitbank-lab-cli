import { describe, expect, it, vi } from "vitest";
import { isDryRunData, printDryRunBox } from "../output-dry-run.js";

describe("isDryRunData", () => {
  it("detects dry-run preview data", () => {
    expect(isDryRunData({ dryRun: true, endpoint: "/x", body: {}, executeHint: "y" })).toBe(true);
  });

  it("rejects anything that is not a dry-run preview", () => {
    expect(isDryRunData({ price: 100 })).toBe(false);
    expect(isDryRunData({ dryRun: false })).toBe(false);
    expect(isDryRunData(null)).toBe(false);
    expect(isDryRunData("dryRun")).toBe(false);
    expect(isDryRunData(undefined)).toBe(false);
  });

  it("rejects a bare { dryRun: true } missing the required shape (fail-closed)", () => {
    expect(isDryRunData({ dryRun: true })).toBe(false);
    expect(isDryRunData({ dryRun: true, endpoint: "/x" })).toBe(false);
    expect(isDryRunData({ dryRun: true, endpoint: "/x", body: {}, executeHint: 1 })).toBe(false);
  });
});

describe("printDryRunBox", () => {
  it("renders the DRY RUN box with endpoint, body and execute hint", () => {
    const writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    printDryRunBox({
      dryRun: true,
      endpoint: "/v1/user/spot/order",
      body: { pair: "btc_jpy", side: "buy", amount: "0.001" },
      executeHint: "npx bitbank trade create-order --execute --confirm=I-UNDERSTAND-CREATE-ORDER",
      confirmPhrase: "I-UNDERSTAND-CREATE-ORDER",
    });
    const out = writeSpy.mock.calls.map((c) => c[0]).join("");
    expect(out).toContain("🔍 DRY RUN");
    expect(out).toContain("POST /v1/user/spot/order");
    expect(out).toContain('pair: "btc_jpy"');
    expect(out).toContain("--confirm=I-UNDERSTAND-CREATE-ORDER");
    writeSpy.mockRestore();
  });

  it("renders already-masked body values and omits the phrase line when absent", () => {
    const writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    printDryRunBox({
      dryRun: true,
      endpoint: "/x",
      body: { token: "***" },
      executeHint: "run --execute",
    });
    const out = writeSpy.mock.calls.map((c) => c[0]).join("");
    expect(out).toContain('token: "***"');
    expect(out).toContain("実行するには --execute を付けてください");
    expect(out).not.toContain("--confirm=");
    writeSpy.mockRestore();
  });
});

describe("printDryRunBox 手数料見積り", () => {
  function render(data: Parameters<typeof printDryRunBox>[0]): string {
    const writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    printDryRunBox(data);
    const out = writeSpy.mock.calls.map((c) => c[0]).join("");
    writeSpy.mockRestore();
    return out;
  }

  it("buy は role / rate / 推定コスト / note を表示する", () => {
    const out = render({
      dryRun: true,
      endpoint: "/v1/user/spot/order",
      body: { pair: "btc_jpy", side: "buy", price: "5000000", amount: "0.02" },
      executeHint: "run --execute",
      fee: {
        role: "maker",
        rate: 0.0001,
        estimatedFeeQuote: 10,
        estimatedCostQuote: 100010,
        note: "想定 role",
      },
    });
    expect(out).toContain("手数料見積り:");
    expect(out).toContain("role: maker");
    expect(out).toContain("推定手数料(quote): 10");
    expect(out).toContain("推定コスト(quote): 100010");
    expect(out).toContain("※ 想定 role");
  });

  it("sell は推定手取りとして表示し、負レートはリベート表記する", () => {
    const out = render({
      dryRun: true,
      endpoint: "/x",
      body: { side: "sell" },
      executeHint: "run --execute",
      fee: { role: "maker", rate: -0.0002, estimatedFeeQuote: -20, estimatedCostQuote: 100020 },
    });
    expect(out).toContain("推定手取り(quote): 100020");
    expect(out).not.toContain("推定コスト");
    expect(out).toContain("maker リベート");
  });

  it("market は率と note のみで推定コスト行を出さない", () => {
    const out = render({
      dryRun: true,
      endpoint: "/x",
      body: { side: "buy" },
      executeHint: "run --execute",
      fee: { role: "taker", rate: 0.0012, note: "成行/逆指値: 約定価格依存" },
    });
    expect(out).toContain("role: taker");
    expect(out).not.toContain("推定コスト");
    expect(out).not.toContain("推定手数料");
    expect(out).toContain("約定価格依存");
  });

  it("fee が無ければ手数料セクションを出さない（cancel-* 等は無改修）", () => {
    const out = render({
      dryRun: true,
      endpoint: "/x",
      body: { pair: "btc_jpy" },
      executeHint: "run --execute",
    });
    expect(out).not.toContain("手数料見積り");
  });
});
