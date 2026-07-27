// レポート組み立て。**ガード不成立なら `reference` 欄そのものを出さない**ことが要点
// （0 や null を入れると「損益ゼロ」と読めてしまう。v2 §1.2）。
import { describe, expect, it } from "vitest";
import { runEngine } from "../../../tax/engine/run.js";
import { ZERO_BOOK } from "../../../tax/engine/total-average.js";
import type { Collected } from "../../../tax/import/collect.js";
import type { LedgerResult } from "../../../tax/ledger/from-events.js";
import type { AssetComparison } from "../../../tax/reconcile/compare.js";
import { buildReport } from "../../../tax/report/build.js";
import type { TaxEvent } from "../../../tax/schema/event.js";
import type { LedgerEntry } from "../../../tax/schema/ledger.js";
import { TaxReport } from "../../../tax/schema/report.js";

const DAY = 86_400_000;
const entry = (
  kind: "ACQUIRE" | "DISPOSE",
  qty: string,
  jpy: string,
  seq: number,
): LedgerEntry => ({
  event_id: `e${seq}`,
  seq: 0,
  kind,
  currency: "btc",
  year_jst: 2026,
  ts_utc: seq * DAY,
  sort_key: `e${seq}:0`,
  qty,
  ...(kind === "ACQUIRE" ? { cost_jpy: jpy } : { proceeds_jpy: jpy }),
  category: kind === "ACQUIRE" ? "purchase" : "sale",
  policy_ids: kind === "ACQUIRE" ? ["P-16"] : [],
});

const ledger: LedgerResult = {
  entries: [entry("ACQUIRE", "3", "1000", 1), entry("DISPOSE", "1", "500", 2)],
  deferred: [],
};

const event: TaxEvent = {
  event_id: "e1",
  source_ref: "1",
  ts_utc: DAY,
  ts_jst: "1970-01-02T09:00:00+09:00",
  year_jst: 2026,
  account_id: "bitbank:default",
  kind: "TRADE_SPOT_BUY",
  market_type: "ORDERBOOK",
  source_system: "API",
  currency: "btc",
  qty: "3",
  jpy_value: "1000",
  costbasis_provenance: "PURCHASE",
  recognition_policy: "DELIVERY_DATE",
  flags: [],
};

const collected: Collected = {
  events: [event],
  pending: [],
  warnings: [],
  counts: { trades: 1, deposits: 0, withdrawals: 0, deduped: 0 },
  truncated: false,
  truncatedPairs: [],
  truncatedAssets: [],
};

const match: AssetComparison = {
  currency: "btc",
  theoretical: "3",
  actual: "3",
  residual: "0",
  dust: "0.0001",
  withinDust: true,
  diagnosis: "MATCH",
  hint: "ダスト閾値内で一致",
};

function build(attested: boolean, over: Partial<Collected> = {}) {
  return buildReport({
    year: 2026,
    method: "total-average",
    taxation: { mode: "comprehensive", certainty: "settled", basis: "2026 年分は総合課税" },
    attested,
    collected: { ...collected, ...over },
    ledger,
    results: runEngine({
      entries: ledger.entries,
      method: "total-average",
      opening: { btc: ZERO_BOOK },
    }),
    reconciliation: [match],
  });
}

describe("buildReport", () => {
  it("出力はスキーマを満たす", () => {
    expect(TaxReport.safeParse(build(true)).success).toBe(true);
  });

  it("ガード成立時は参考損益を出す（表示は円未満切捨て）", () => {
    const c = build(true).currencies[0];
    expect(c.reference).toBeDefined();
    // 単価 1000/3 = 333.33…、譲渡原価 = 333.33…、収入 500 → 参考損益 166
    expect(c.reference?.unit_price_jpy).toBe("333.33333333");
    expect(c.reference?.cogs_jpy).toBe("333");
    expect(c.reference?.reference_pnl_jpy).toBe("166");
  });

  it("ガード不成立なら reference 欄を出さず理由を並べる", () => {
    const c = build(false).currencies[0];
    expect(c.reference).toBeUndefined();
    expect(c.blocked_by.join()).toContain("(a)");
    // 取引集計はガードに関係なく常に出す
    expect(c.summary.acquired_qty).toBe("3");
    expect(c.summary.proceeds_jpy).toBe("500");
  });

  // 打ち切りは残高突合が MATCH でも通してはいけない（欠けた買いと売りが偶然
  // ネットゼロなら突合は成立してしまう）
  it("履歴が打ち切られていれば reference 欄を出さない", () => {
    const c = build(true, { truncated: true }).currencies[0];
    expect(c.reference).toBeUndefined();
    expect(c.blocked_by.join()).toContain("打ち切られています");
  });

  it("適用した【方針】ID をレポートに露出する", () => {
    expect(build(true).currencies[0].policy_ids).toEqual(["P-16"]);
  });

  it("免責文言を常時付け、「所得金額」とは呼ばない", () => {
    const r = build(true);
    expect(r.disclaimers.length).toBeGreaterThan(0);
    expect(r.disclaimers[0]).toContain("税計算用参考データ");
    expect(r.disclaimers[0]).toContain("税務上の所得金額ではありません");
    // 「単一取引所だから計算できない」とは言い切らない。限界は口座外に同一銘柄が
    // あるときの話で、そこを条件付きで述べているか
    expect(r.disclaimers[0]).toContain("bitbank 口座だけで完結している");
    expect(r.disclaimers.join()).toContain("20万円以下であっても");
  });
});
