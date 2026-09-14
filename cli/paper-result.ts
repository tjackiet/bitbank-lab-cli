// paper コマンドの Result に「どの state file を読んだか」を meta.statePath として
// 付ける。BITBANK_PAPER_STATE_PATH で複数の仮想口座を切り替えて使う場合、環境変数を
// 付け忘れると既定パスへ静かにフォールバックし、別口座の残高が success:true で返る
// （issue #27）。読み取り系・更新系を問わず全 paper コマンドで参照先を申告する。
import type { Result } from "./types.js";

export function withStatePath<T>(result: Result<T>, statePath: string): Result<T> {
  if (!result.success) return result;
  return { ...result, meta: { ...result.meta, statePath } };
}
