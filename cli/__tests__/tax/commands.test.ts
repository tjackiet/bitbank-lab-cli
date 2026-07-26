// tax コマンドの表層（登録・入力検証・繰越の読み込み）。
// 実 API は叩かず、入力検証で止まる経路だけを検査する（fetch が呼ばれないことも確認）。
import { describe, expect, it } from "vitest";
import { commandDescriptions, TAX_COMMANDS } from "../../commands/registry.js";
import { ALL_SCHEMAS } from "../../commands/schema/registry.js";
import { taxPnl } from "../../commands/tax/pnl.js";
import { EXIT } from "../../exit-codes.js";
import { resolveCommand } from "../../router.js";
import { parseCarryover } from "../../tax/carryover.js";
import { toExactDecimalString } from "../../tax/ratio-decimal.js";

const failFetch = (() => {
  throw new Error("fetch should not be called");
}) as unknown as typeof fetch;

const noCall = { fetch: failFetch, retries: 0 as const };

describe("tax コマンドの登録", () => {
  it("router が tax グループを解決する", () => {
    expect(resolveCommand(["tax"]).group).toBe("tax");
    expect(resolveCommand(["tax", "pnl"]).entry).toBe(TAX_COMMANDS.pnl);
    expect(resolveCommand(["tax", "nope"]).entry).toBeUndefined();
  });

  it("schema カタログに tax カテゴリで載る", () => {
    for (const name of ["events", "reconcile", "pnl"]) {
      expect(ALL_SCHEMAS[name]?.category).toBe("tax");
    }
  });

  it("description は `tax <name>` キーで引ける", () => {
    expect(commandDescriptions()["tax pnl"]).toBe(TAX_COMMANDS.pnl.description);
  });
});

describe("tax pnl の入力検証", () => {
  it("--year が無ければ PARAM エラー（API は叩かない）", async () => {
    const r = await taxPnl({}, noCall);
    expect(r.success).toBe(false);
    if (!r.success) expect(r.exitCode).toBe(EXIT.PARAM);
  });

  it("不正な --year は PARAM エラー", async () => {
    const r = await taxPnl({ year: "26" }, noCall);
    expect(r.success).toBe(false);
    if (!r.success) expect(r.exitCode).toBe(EXIT.PARAM);
  });

  it("未知の --method は PARAM エラー", async () => {
    const r = await taxPnl({ year: "2026", method: "fifo" }, noCall);
    expect(r.success).toBe(false);
    if (!r.success) expect(r.exitCode).toBe(EXIT.PARAM);
  });

  it("読めない --carryover は PARAM エラー", async () => {
    const r = await taxPnl({ year: "2026", carryover: "/nonexistent/carryover.json" }, noCall);
    expect(r.success).toBe(false);
    if (!r.success) expect(r.exitCode).toBe(EXIT.PARAM);
  });
});

describe("繰越の読み込み", () => {
  it("十進文字列のまま厳密に読む", () => {
    const r = parseCarryover({ BTC: { qty: "1.5", cost_jpy: "931800" } });
    expect(r.success).toBe(true);
    if (r.success) {
      // 資産キーは小文字へ寄せる（"BTC" でも引ける）
      expect(toExactDecimalString(r.data.btc.qty)).toBe("1.5");
      expect(toExactDecimalString(r.data.btc.cost)).toBe("931800");
    }
  });

  it("十進文字列でない値は PARAM エラー（黙って 0 にしない）", () => {
    const r = parseCarryover({ btc: { qty: "1.5e3", cost_jpy: "1" } });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.exitCode).toBe(EXIT.PARAM);
  });
});
