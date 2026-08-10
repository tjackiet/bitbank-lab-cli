// 100行超: 取得〜組み立ての通し検証。「復元が効いていること」「打ち切りを黙って通さない
// こと」「candle 欠落でスケールが崩れないこと」を 1 本の実行経路で押さえるため、
// セットアップ（保有・価格・足）を共有したケース群になる。
import { describe, expect, it } from "vitest";
import { runBalanceHistory } from "../../portfolio/run.js";
import { BalanceHistorySchema } from "../../portfolio/schema.js";
import { TRUNCATED_WARNING } from "../../portfolio/warnings.js";
import { TEST_CREDS } from "../test-helpers.js";
import { mockMarket, rawDeposit, rawTrade, rawWithdrawal } from "./mock-market.js";

const DAY = 86_400_000;
const D1 = Date.UTC(2026, 7, 1);
const D2 = Date.UTC(2026, 7, 2);
const D3 = Date.UTC(2026, 7, 3);
const NOW = D3 + 12 * 3_600_000;

const OPTS = { retries: 0, credentials: TEST_CREDS, nonce: "1" } as const;
const ARGS = {
  sinceMs: D1,
  nowMs: NOW,
  granularity: "day" as const,
  maxPages: 10,
  noCache: true,
};

const BTC_CANDLES: [number, string][] = [
  [D1, "10000000"],
  [D2, "11000000"],
  [D3, "12000000"],
];

describe("runBalanceHistory", () => {
  it("約定を巻き戻して各時点の保有を復元する", async () => {
    // D2 に 1 BTC を手数料 0.001 BTC 付きで購入 → D1 時点の保有は 2 - (1 - 0.001) = 1.001
    const { fetch } = mockMarket({
      assets: { btc: "2", jpy: "1000000" },
      prices: { btc: "13000000" },
      candles: { btc: BTC_CANDLES },
      trades: {
        btc_jpy: [
          rawTrade({
            trade_id: 7,
            side: "buy",
            amount: "1",
            price: "11000000",
            fee_amount_base: "0.001",
            fee_amount_quote: "0",
            executed_at: D2 + 3_600_000,
          }),
        ],
      },
    });
    const r = await runBalanceHistory(ARGS, { fetch, ...OPTS });
    expect(r.success).toBe(true);
    if (!r.success) return;

    const [p1, p2, p3] = r.data.points;
    // D1: 1.001 BTC × 10,000,000 + (1,000,000 + 11,000,000) JPY
    expect(p1.value_jpy).toBe(Math.round(1.001 * 10_000_000) + 12_000_000);
    expect(p2.value_jpy).toBe(Math.round(1.001 * 11_000_000) + 12_000_000);
    // D3 は約定後なので 2 BTC・JPY 100 万
    expect(p3.value_jpy).toBe(2 * 12_000_000 + 1_000_000);
    expect(r.data.current.value_jpy).toBe(2 * 13_000_000 + 1_000_000);
    expect(r.data.completeness.complete).toBe(true);
    expect(r.data.price_quality.level).toBe("complete");
  });

  it("入出金を元本として分離し、調整後増減から除く", async () => {
    const { fetch } = mockMarket({
      assets: { jpy: "1500000" },
      prices: { btc: "13000000" },
      candles: { btc: BTC_CANDLES },
      deposits: [
        rawDeposit({
          uuid: "dep-1",
          asset: "jpy",
          amount: "500000",
          found_at: D2,
          confirmed_at: D2,
        }),
      ],
      withdrawals: {
        jpy: [
          rawWithdrawal({
            uuid: "wd-1",
            asset: "jpy",
            amount: "100000",
            fee: "550",
            requested_at: D2,
          }),
        ],
      },
    });
    const r = await runBalanceHistory(ARGS, { fetch, ...OPTS });
    expect(r.success).toBe(true);
    if (!r.success) return;

    // D1 の JPY = 1,500,000 - 500,000 + (100,000 + 550) = 1,100,550
    expect(r.data.points[0].value_jpy).toBe(1_100_550);
    expect(r.data.flow).toEqual({ net_flow_jpy: 400_000, withdrawal_fee_jpy: 550 });
    expect(r.data.change.change_jpy).toBe(1_500_000 - 1_100_550);
    // 調整後 = 単純増減 − 純入出金 → 出金手数料ぶんのマイナスだけが残る
    expect(r.data.change.adjusted_change_jpy).toBe(-550);
  });

  it("candle が取れない資産は現在価格へ落ち、最終点とスケールが揃う", async () => {
    const { fetch } = mockMarket({
      assets: { btc: "2" },
      prices: { btc: "13000000" },
      candles: {}, // 全 candle 取得失敗
    });
    const r = await runBalanceHistory(ARGS, { fetch, ...OPTS });
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.price_quality).toEqual({ level: "fallback_only", fallback_assets: ["btc"] });
    expect(new Set(r.data.points.map((p) => p.value_jpy))).toEqual(new Set([26_000_000]));
    expect(r.data.current.value_jpy).toBe(26_000_000);
  });

  it("入出金履歴がページ上限に達したら partial + warning で申告する", async () => {
    const { fetch } = mockMarket({
      assets: { jpy: "1000000" },
      prices: { btc: "13000000" },
      candles: { btc: BTC_CANDLES },
      depositsNeverEnd: NOW,
    });
    const r = await runBalanceHistory({ ...ARGS, maxPages: 2 }, { fetch, ...OPTS });
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.partial).toBe(true);
    expect(r.meta?.truncated).toBe(true);
    expect(r.data.completeness).toMatchObject({ complete: false, deposits_truncated: true });
    expect(r.data.warnings).toContain(TRUNCATED_WARNING);
  });

  it("出金申請中（withdrawing）の数量を現在残高に足し戻す", async () => {
    // onhand からは既に引かれているが status はまだ DONE ではないので巻き戻しでも
    // 戻らない。足し戻さないと申請中の 100,000 円が過去の全時点から消える
    const { fetch } = mockMarket({
      assets: { jpy: ["900000", "100000"] },
      prices: {},
      candles: {},
      withdrawals: {
        jpy: [
          rawWithdrawal({
            uuid: "wd-pending",
            asset: "jpy",
            amount: "100000",
            fee: "550",
            status: "PENDING",
            requested_at: D2,
          }),
        ],
      },
    });
    const r = await runBalanceHistory(ARGS, { fetch, ...OPTS });
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.current.value_jpy).toBe(1_000_000);
    expect(r.data.points.every((p) => p.value_jpy === 1_000_000)).toBe(true);
    // 未確定の出金は純入出金にも計上しない
    expect(r.data.flow).toEqual({ net_flow_jpy: 0, withdrawal_fee_jpy: 0 });
  });

  it("前提の注記を必ず出力に含め、出力契約（Zod）に適合する", async () => {
    const { fetch } = mockMarket({ assets: { jpy: "1000" }, prices: {}, candles: {} });
    const r = await runBalanceHistory(ARGS, { fetch, ...OPTS });
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.note).toContain("逆算");
    expect(r.data.assumptions.length).toBeGreaterThan(0);
    expect(r.data.price_quality.level).toBe("jpy_only");
    expect(BalanceHistorySchema.safeParse(r.data).success).toBe(true);
  });

  it("価格が一切引けない保有は 0 円で黙って積まず、warning に出す", async () => {
    // ticker にも candle にも無い銘柄（delist 直後・シンボル rename 等）
    const { fetch } = mockMarket({ assets: { btc: "1" }, prices: {}, candles: {} });
    const r = await runBalanceHistory(ARGS, { fetch, ...OPTS });
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.warnings.some((w) => w.includes("btc"))).toBe(true);
  });

  it("月次グリッドでは UTC 月初だけを評価する", async () => {
    const { fetch } = mockMarket({
      assets: { jpy: "1000" },
      prices: {},
      candles: {},
    });
    const r = await runBalanceHistory(
      { ...ARGS, sinceMs: D1 - 40 * DAY, granularity: "month" },
      { fetch, ...OPTS },
    );
    expect(r.success).toBe(true);
    if (r.success)
      expect(r.data.points.map((p) => p.date)).toEqual(["2026-06-01", "2026-07-01", "2026-08-01"]);
  });
});
