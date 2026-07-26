// 突合行の組み立て（許容幅・診断・ヒント）。annual-report.ts を 100 行に収めるための分割。
import { cmp, fromBigint, isZero, mul, type Ratio, ratio, sub, ZERO } from "../ratio.js";
import { fromDecimalString, toDecimalString, toExactDecimalString } from "../ratio-decimal.js";
import { abs, DUST_THRESHOLD } from "../reconcile/compare-parts.js";
import type { VerifyDiagnosis, VerifyRow } from "../schema/verify.js";
import type { ComparedField } from "./aggregate.js";

const DUST = fromDecimalString(DUST_THRESHOLD) ?? ZERO;

/** API 手数料は小数第 4 位丸め（付録E.1 / P-16）。1 件あたりの最大誤差は 0.5×10^-4。 */
const FEE_HALF_ULP = ratio(1n, 20_000n);

/**
 * 手数料だけ許容幅を件数に比例させる。報告書側が丸め前合計なら差は必ず出るが、
 * その差は **件数 × 半 ulp** を超えられない。固定閾値だと件数が増えるほど
 * 「取込漏れ」と誤診し、逆に緩い固定値にすると本物の欠落を見逃す。
 */
export function toleranceFor(field: ComparedField, feeRoundedCount: number): Ratio {
  if (field !== "fee") return DUST;
  const bound = mul(fromBigint(BigInt(feeRoundedCount)), FEE_HALF_ULP);
  return cmp(bound, DUST) > 0 ? bound : DUST;
}

/** 有限小数同士の和なので厳密表現になる。理論上の取りこぼしだけ丸めて出す。 */
function dec(r: Ratio): string {
  return toExactDecimalString(r) ?? toDecimalString(r, 12, "HALF_UP");
}

const TRADE_FIELDS = new Set<ComparedField>(["buy_qty", "buy_jpy", "sell_qty", "sell_jpy"]);

function hintFor(field: ComparedField, diagnosis: VerifyDiagnosis): string {
  if (diagnosis === "MATCH") return "許容幅内で一致";
  if (diagnosis === "FEE_ROUNDING") {
    return "API 手数料の 4 桁丸めで説明できる範囲の差（P-16。件数 × 半 ulp 以内）";
  }
  if (diagnosis === "REPORT_EXCESS") {
    return TRADE_FIELDS.has(field)
      ? "報告書が多い: 販売所（即時売買）は API に現れない。UI CSV「売買履歴」の取込で解消する見込み"
      : "報告書が多い: 取込の打ち切り（--max-pages）か、API に現れない移転の可能性";
  }
  return TRADE_FIELDS.has(field)
    ? "API が多い: 報告書の対象外（信用は別様式）か、年分判定・重複排除のズレの可能性"
    : "API が多い: 年分判定（JST）のズレか、報告書の対象外の移転の可能性";
}

/** 報告書・API とも 0 の項目は行にしない（全銘柄 × 全項目のゼロ行で埋まるため）。 */
export function verifyRow(
  currency: string,
  field: ComparedField,
  report: Ratio,
  api: Ratio,
  tolerance: Ratio,
): VerifyRow | null {
  if (isZero(report) && isZero(api)) return null;
  const diff = sub(report, api);
  const magnitude = abs(diff);
  const diagnosis: VerifyDiagnosis =
    cmp(magnitude, DUST) <= 0
      ? "MATCH"
      : cmp(magnitude, tolerance) <= 0
        ? "FEE_ROUNDING"
        : cmp(diff, ZERO) > 0
          ? "REPORT_EXCESS"
          : "API_EXCESS";
  return {
    currency,
    field,
    report: dec(report),
    api: dec(api),
    diff: dec(diff),
    tolerance: dec(tolerance),
    within_tolerance: cmp(magnitude, tolerance) <= 0,
    diagnosis,
    hint: hintFor(field, diagnosis),
  };
}
