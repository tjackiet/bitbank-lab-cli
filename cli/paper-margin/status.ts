// 100行超: 本番 margin-status と同名の欄（各欄の丸め規則つき）と paper だけの欄を 1 つの出力型にまとめ、その値を埋める。
// 欄の対応を 1 か所で読めるようにするため、型と組み立てを分けない（account.ts と同じ理由）。
//
// paper margin-status の出力（ADR-010 / docs/dev/paper-margin-plan.md §3.7）。純関数。
// - 本番と同じ意味で計算できる欄だけを本番と同じ名前（snake_case）で出し、丸めも本番の docs に合わせる（rounding.ts）
// - margin_call_percentage / losscut_percentage は本番の値の意味を実口座で確かめていないので同名では出さない。
//   代わりに公表ルールから導いた paper の判定しきい値を thresholds に出す（追証は Mm / P、強制決済は Mm × 掛け目 / P）
// - status は NORMAL / CALL / DEBT（paper の強制決済は一瞬で終わるので LOSSCUT は残らない）
// - available_balances は paper の見積り（B − Mm − Mo）/ r。本番は審査で決まるご利用可能額でも頭打ちになる
import type { PaperState } from "../paper-state.js";
import type { Result } from "../types.js";
import { evaluateAccount } from "./account.js";
import { bookOf, hasMarginBook } from "./book.js";
import { newOpenCapacity } from "./new-open.js";
import type { MarginPairParams } from "./params.js";
import { ceilTo, floorTo, truncTo } from "./rounding.js";
import type { MarginCall } from "./state.js";
import { maintenanceBySide } from "./status-sides.js";

export type MarginStatusView = {
  status: "NORMAL" | "CALL" | "DEBT";
  total_margin_balance: number;
  total_margin_balance_percentage: number | null;
  margin_position_profit_loss: number;
  unrealized_cost: number;
  total_margin_position_product: number;
  open_margin_position_product: number;
  open_margin_order_product: number;
  total_position_maintenance_margin: number;
  total_long_position_maintenance_margin: number;
  total_short_position_maintenance_margin: number;
  total_open_order_maintenance_margin: number;
  total_long_open_order_maintenance_margin: number;
  total_short_open_order_maintenance_margin: number;
  available_balances: Array<{ pair: string; long: number; short: number }>;
  /** paper の判定しきい値（保証金率 %）。建玉が無ければ null */
  thresholds: {
    margin_call_below_percentage: number | null;
    losscut_below_percentage: number | null;
  };
  margin_call: MarginCall | null;
  payables: { amount: number };
  last_tick_at: string;
  /** 信用の建玉・注文があるのに、直前の tick が now まで走査できなかった */
  stale: boolean;
  assumptions: PaperState["margin"]["assumptions"] & {
    riskRatios: Record<string, { ratio: number; until: string; source: "current" | "next" }>;
    valuationPrices: Record<string, number>;
  };
};

export function buildMarginStatus(
  state: PaperState,
  /** 信用対応の全ペアのパラメータ（available_balances に出す）。建玉・注文のペアは必ず含む */
  params: ReadonlyMap<string, MarginPairParams>,
  prices: ReadonlyMap<string, number>,
  nowMs: number,
): Result<MarginStatusView> {
  const book = bookOf(state);
  const riskRatio = (p: string) => params.get(p)?.riskRatio;
  const acc = evaluateAccount({
    jpy: book.jpy,
    positions: book.positions,
    openOrders: book.orders,
    riskRatio,
    price: (p) => prices.get(p),
  });
  if (!acc.success) return acc;
  const a = acc.data;
  const sides = maintenanceBySide(book, riskRatio);
  const k = state.margin.assumptions.rules.losscutMultiplier;
  const held = a.openPositionProduct;
  const pct = (x: number) => (held > 0 ? ceilTo((x / held) * 100, 2) : null);
  const pairs = [...params.keys()].sort();
  const view: MarginStatusView = {
    status: a.payables > 0 ? "DEBT" : book.call ? "CALL" : "NORMAL",
    total_margin_balance: truncTo(a.totalMarginBalance, 4),
    total_margin_balance_percentage:
      a.marginRatio === null ? null : truncTo(a.marginRatio * 100, 2),
    margin_position_profit_loss: floorTo(a.positionProfitLoss, 4),
    unrealized_cost: ceilTo(a.unrealizedCost, 4),
    total_margin_position_product: truncTo(held + a.openOrderProduct, 4),
    open_margin_position_product: truncTo(held, 4),
    open_margin_order_product: truncTo(a.openOrderProduct, 4),
    total_position_maintenance_margin: ceilTo(a.positionMaintenanceMargin, 4),
    total_long_position_maintenance_margin: ceilTo(sides.position.long, 4),
    total_short_position_maintenance_margin: ceilTo(sides.position.short, 4),
    total_open_order_maintenance_margin: ceilTo(a.openOrderMaintenanceMargin, 4),
    total_long_open_order_maintenance_margin: ceilTo(sides.order.long, 4),
    total_short_open_order_maintenance_margin: ceilTo(sides.order.short, 4),
    available_balances: pairs.map((pair) => {
      const cap = truncTo(newOpenCapacity(a, params.get(pair)?.riskRatio ?? 1), 4);
      return { pair, long: cap, short: cap };
    }),
    thresholds: {
      margin_call_below_percentage: pct(a.positionMaintenanceMargin),
      losscut_below_percentage: pct(a.positionMaintenanceMargin * k),
    },
    margin_call: book.call,
    payables: { amount: a.payables },
    last_tick_at: state.lastTickAt,
    stale: hasMarginBook(state) && Date.parse(state.lastTickAt) < nowMs,
    assumptions: {
      ...state.margin.assumptions,
      riskRatios: Object.fromEntries(
        pairs.map((p) => {
          const x = params.get(p) as MarginPairParams;
          return [
            p,
            {
              ratio: x.riskRatio,
              until: new Date(x.riskRatioUntilMs).toISOString(),
              source: x.riskRatioSource,
            },
          ];
        }),
      ),
      valuationPrices: Object.fromEntries(prices),
    },
  };
  return { success: true, data: view };
}
