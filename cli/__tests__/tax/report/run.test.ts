// pnl 経路を打ち切りあり / なしで 1 往復ずつ通す。差分は --max-pages だけなので、
// 「打ち切ると参考損益が消えて警告が出る」ことを他の要因抜きで固定できる。
import { describe, expect, it } from "vitest";
import { runPnlReport } from "../../../tax/report/run.js";
import type { Taxation } from "../../../tax/schema/taxation.js";
import { tradeHistoryFixture } from "../../__fixtures__/private/trade-history.js";
import { TEST_CREDS } from "../../test-helpers.js";

// 現物約定にする（fixture は信用行なので position_side 等を落とす。
// JSON.stringify が undefined のキーを落とすので、API 応答にも現れない）
const trade = {
  ...tradeHistoryFixture.trades[0],
  executed_at: 1_767_225_600_000, // 2026-01-01T09:00 JST
  position_side: undefined,
  profit_loss: undefined,
  interest: undefined,
};

const taxation: Taxation = {
  mode: "comprehensive",
  certainty: "settled",
  basis: "2026 年分は総合課税",
};

/** 約定 1 件だけ返す mock。2 回目以降は空なので maxPages に余裕があれば打ち切られない。 */
function mockApi(): typeof globalThis.fetch {
  let served = false;
  return (async (input: string | URL) => {
    const { pathname } = new URL(String(input));
    let data: unknown = { withdrawals: [] };
    if (pathname.endsWith("/user/spot/trade_history")) {
      data = { trades: served ? [] : [trade] };
      served = true;
    } else if (pathname.endsWith("/user/deposit_history")) {
      data = { deposits: [] };
    } else if (pathname.endsWith("/user/assets")) {
      // 理論残高（0.001 btc）と一致させて btc をガード(d) MATCH にする。
      // jpy は突合行には出るが ledger に無いので参考損益の対象にならない
      data = { assets: [{ asset: "btc", onhand_amount: "0.001", withdrawing_amount: "0" }] };
    }
    return new Response(JSON.stringify({ success: 1, data }));
  }) as typeof globalThis.fetch;
}

function run(maxPages: number) {
  return runPnlReport(
    { year: 2026, method: "total-average", taxation, attested: true, allZero: true, maxPages },
    { pairs: ["btc_jpy"], assets: ["btc"] },
    { fetch: mockApi(), retries: 0, credentials: TEST_CREDS, nonce: "1" },
  );
}

describe("runPnlReport の打ち切り時の振る舞い", () => {
  it("打ち切りが無ければ参考損益を出し、打ち切り警告も出さない", async () => {
    const r = await run(5);
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.source.truncated).toBe(false);
    expect(r.data.currencies[0].currency).toBe("btc");
    expect(r.data.currencies[0].reference).toBeDefined();
    expect(r.data.warnings.join()).not.toContain("打ち切");
  });

  it("打ち切られたら参考損益を出さず、理由と警告を残す", async () => {
    const r = await run(1);
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.partial).toBe(true);
    expect(r.data.source.truncated).toBe(true);
    // 突合は MATCH のままでもブロックする（欠けたイベントが打ち消し合う場合の穴）
    expect(r.data.reconciliation.find((x) => x.currency === "btc")?.diagnosis).toBe("MATCH");
    expect(r.data.currencies[0].reference).toBeUndefined();
    expect(r.data.currencies[0].blocked_by.join()).toContain("打ち切られています");
    // レポート本体だけを読む経路にも残す（verify-report と同じ文言）
    expect(r.data.warnings.join()).toContain("打ち切られています");
  });
});
