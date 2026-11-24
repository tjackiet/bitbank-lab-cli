// 本番 margin-status の各値と同じ桁・向きで丸める（公式 docs の rest-api_JP.md。計画書 §2.5）。
// paper の内部は完全精度のまま持ち、丸めは出力（paper margin-status / margin-positions）でだけ行う。
// 浮動小数の誤差（50 が 49.999999999、0 が ±1e-10 になる等）で 1 単位ずれないよう、丸める桁のさらに 3 桁下で
// 一度そろえてから丸める（4 桁丸めの JPY なら 1e-7 円未満の誤差を消す。意味のある値の桁には届かない）。
// 結果の −0 は 0 にする。
const scaled = (x: number, digits: number) => Number((x * 10 ** digits).toFixed(3));
const clean = (x: number) => (x === 0 ? 0 : x);

/** 切り捨て（0 方向）。total_margin_balance（4 桁）・total_margin_balance_percentage（2 桁）など */
export const truncTo = (x: number, digits: number) =>
  clean(Math.trunc(scaled(x, digits)) / 10 ** digits);

/** −∞ 方向。margin_position_profit_loss（4 桁） */
export const floorTo = (x: number, digits: number) =>
  clean(Math.floor(scaled(x, digits)) / 10 ** digits);

/** 切り上げ（+∞ 方向）。unrealized_cost・維持必要保証金・約定時必要保証金（4 桁） */
export const ceilTo = (x: number, digits: number) =>
  clean(Math.ceil(scaled(x, digits)) / 10 ** digits);

/** 四捨五入。本番の docs に規則の無い paper だけの欄・建玉の表示用（本番の約定の手数料は 4 桁の四捨五入） */
export const roundTo = (x: number, digits: number) =>
  clean(Math.round(scaled(x, digits)) / 10 ** digits);
