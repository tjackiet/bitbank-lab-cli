// 取得層（ページング・重複排除・2 系統取得）。ページ境界はタイムスタンプカーソルの
// ため**同一ミリ秒で重複が返る**（要求仕様 §2.1）ので、除去件数まで確認する。
import { describe, expect, it } from "vitest";
import { fetchDeposits } from "../../../tax/import/fetch-deposits.js";
import { fetchTrades } from "../../../tax/import/fetch-trades.js";
import { fetchWithdrawals } from "../../../tax/import/fetch-withdrawals.js";
import { paginate } from "../../../tax/import/paginate.js";
import { tradeHistoryFixture } from "../../__fixtures__/private/trade-history.js";
import { TEST_CREDS } from "../../test-helpers.js";

const base = tradeHistoryFixture.trades[0];
const trade = (id: number, over: Record<string, unknown> = {}) => ({
  ...base,
  trade_id: id,
  order_id: id,
  executed_at: 1_767_225_600_000 + id,
  ...over,
});

/** URL のクエリを見て応答を切り替える mock fetch。 */
function routedFetch(route: (url: URL) => unknown): typeof globalThis.fetch {
  return (async (input: string | URL) => {
    const url = new URL(typeof input === "string" ? input : input.toString());
    return new Response(JSON.stringify({ success: 1, data: route(url) }));
  }) as typeof globalThis.fetch;
}

const opts = (fetch: typeof globalThis.fetch) => ({
  fetch,
  retries: 0,
  credentials: TEST_CREDS,
  nonce: "1",
});

describe("paginate", () => {
  it("同一キーの行を除去し、除去件数を返す", async () => {
    const pages = [
      [{ id: 1 }, { id: 2 }],
      [{ id: 2 }, { id: 3 }], // 境界重複
      [{ id: 4 }],
    ];
    let i = 0;
    const r = await paginate<{ id: number }>({
      fetchPage: async () => ({ success: true, data: pages[i++] ?? [] }),
      keyOf: (x) => String(x.id),
      nextCursor: () => "next",
      pageSize: 2,
      maxPages: 10,
    });
    expect(r.success && r.data.rows.map((x) => x.id)).toEqual([1, 2, 3, 4]);
    expect(r.success && r.data.deduped).toBe(1);
    expect(r.success && r.data.truncated).toBe(false);
  });

  it("maxPages に当たったら truncated を立てる（黙って欠損させない）", async () => {
    let id = 0;
    const r = await paginate<{ id: number }>({
      fetchPage: async () => ({ success: true, data: [{ id: id++ }, { id: id++ }] }),
      keyOf: (x) => String(x.id),
      nextCursor: () => "next",
      pageSize: 2,
      maxPages: 3,
    });
    expect(r.success && r.data.truncated).toBe(true);
    expect(r.success && r.data.rows).toHaveLength(6);
  });
});

describe("fetchTrades", () => {
  it("ペアを順に巡回し時系列で束ねる", async () => {
    const fetch = routedFetch((url) => ({
      trades: url.searchParams.get("pair") === "btc_jpy" ? [trade(2)] : [trade(1)],
    }));
    const r = await fetchTrades({ pairs: ["btc_jpy", "eth_jpy"] }, opts(fetch));
    expect(r.success && r.data.trades.map((t) => t.trade_id)).toEqual([1, 2]);
  });

  it("trade_id がペアを跨いで衝突したら明示エラーで止める", async () => {
    // event_id は `trade:<trade_id>` なので、交差すると下流で片方が黙って消える
    const fetch = routedFetch((url) => ({
      trades: [trade(9, { pair: url.searchParams.get("pair") })],
    }));
    const r = await fetchTrades({ pairs: ["btc_jpy", "eth_jpy"] }, opts(fetch));
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error).toContain("trade_id 9");
  });

  it("数値は文字列のまま保持する（number 化しない）", async () => {
    const fetch = routedFetch(() => ({ trades: [trade(1, { amount: "0.00000001" })] }));
    const r = await fetchTrades({ pairs: ["btc_jpy"] }, opts(fetch));
    expect(r.success && r.data.trades[0].amount).toBe("0.00000001");
  });
});

describe("fetchDeposits", () => {
  it("asset 省略（crypto）と asset=jpy（fiat）の 2 系統を両方取る", async () => {
    const seen: (string | null)[] = [];
    const fetch = routedFetch((url) => {
      const asset = url.searchParams.get("asset");
      seen.push(asset);
      return {
        deposits: [
          asset === "jpy"
            ? { uuid: "j1", asset: "jpy", amount: "10000", status: "DONE", found_at: 2 }
            : { uuid: "c1", asset: "btc", amount: "0.1", status: "DONE", found_at: 1 },
        ],
      };
    });
    const r = await fetchDeposits({}, opts(fetch));
    expect(seen).toEqual([null, "jpy"]);
    expect(r.success && r.data.deposits.map((d) => d.uuid)).toEqual(["c1", "j1"]);
  });
});

describe("fetchWithdrawals", () => {
  it("asset を全巡回し uuid で重複排除する", async () => {
    const fetch = routedFetch((url) => ({
      withdrawals: [
        {
          uuid: `w-${url.searchParams.get("asset")}`,
          asset: url.searchParams.get("asset"),
          amount: "1",
          fee: "0.1",
          status: "DONE",
          requested_at: 1,
        },
      ],
    }));
    const r = await fetchWithdrawals({ assets: ["btc", "eth"] }, opts(fetch));
    expect(r.success && r.data.withdrawals.map((w) => w.uuid)).toEqual(["w-btc", "w-eth"]);
  });
});
