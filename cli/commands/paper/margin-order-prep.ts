// paper create-margin-order の、lock の外の取得と検証（ADR-010 / docs/dev/paper-margin-plan.md §4 Step 5）。
// public の API だけを叩く: pairs（数量の検証・信用対応・新規建て停止）と ticker（口座評価と成行の約定に使う現在値）。
// - 数量・価格の桁は現物と同じ検証（order-validate.ts の validateOrderSize）
// - 信用非対応のペアは PARAM（本番では 40167）。比率が期限切れなら pairs を 1 度だけ取り直す
// - 新規建て停止（stop_margin_long_order / stop_margin_short_order）は新規建てだけを止める。返済は止めない
//   （本番の停止エラーは方向別: 買い新規 50083 / 売り新規 50081）
import { EXIT } from "../../exit-codes.js";
import type { HttpOptions } from "../../http.js";
import type { MarginIntent, PositionSide } from "../../margin-operation.js";
import type { CachedPair } from "../../pairs-cache.js";
import { marginParamsOf } from "../../paper-margin/params.js";
import type { Result } from "../../types.js";
import { ticker } from "../public/ticker.js";
import { validateOrderSize } from "./order-validate.js";

type GetPairs = () => Promise<Result<CachedPair[]>>;

export async function checkOrderPair(
  req: {
    pair: string;
    type: "market" | "limit";
    amount: number;
    price?: number;
    positionSide: PositionSide;
    intent: MarginIntent;
  },
  o: { nowMs: number; getPairs: GetPairs; refreshPairs: GetPairs },
): Promise<Result<{ ok: true }>> {
  let pairs = await o.getPairs();
  if (!pairs.success) return pairs;
  const size = validateOrderSize(req.pair, req.type, req.amount, pairs.data, req.price);
  if (!size.success) return { ...size, exitCode: EXIT.PARAM };
  const lookupIn = (list: CachedPair[]) => {
    const info = list.find((p) => p.name === req.pair);
    return info
      ? marginParamsOf(info, o.nowMs)
      : ({ kind: "unknown", reason: "not in pairs" } as const);
  };
  let lookup = lookupIn(pairs.data);
  if (lookup.kind === "stale") {
    pairs = await o.refreshPairs();
    if (!pairs.success) return pairs;
    lookup = lookupIn(pairs.data);
  }
  if (lookup.kind === "unsupported") {
    return {
      success: false,
      error: `信用取引に対応していないペアです: ${req.pair}（本番では 40167 で拒否される。信用対応ペアは pairs の margin_current_individual_ratio があるもの）`,
      exitCode: EXIT.PARAM,
    };
  }
  if (lookup.kind !== "ok") {
    const why =
      lookup.kind === "unknown" ? lookup.reason : "risk ratio is past its until even after refresh";
    return {
      success: false,
      error: `margin order: cannot read margin params for ${req.pair} (${why})`,
    };
  }
  const stopped =
    req.positionSide === "long" ? lookup.params.stopNewLong : lookup.params.stopNewShort;
  if (req.intent === "open" && stopped) {
    const [label, code] =
      req.positionSide === "long" ? ["ロング（買い）", 50083] : ["ショート（売り）", 50081];
    return {
      success: false,
      error: `${req.pair} の${label}新規建ては停止中です（本番では ${code} で拒否される）。返済はできます`,
    };
  }
  return { success: true, data: { ok: true } };
}

/** 口座評価と成行の約定に使う現在値（ticker の last） */
export async function fetchLastPrices(
  pairs: readonly string[],
  opts?: HttpOptions,
): Promise<Result<Map<string, number>>> {
  const out = new Map<string, number>();
  for (const pair of pairs) {
    const t = await ticker({ pair }, opts);
    if (!t.success) return t;
    const last = Number(t.data.last);
    if (!t.data.last || !Number.isFinite(last) || last <= 0) {
      return { success: false, error: `ticker for ${pair} has no positive last price` };
    }
    out.set(pair, last);
  }
  return { success: true, data: out };
}
