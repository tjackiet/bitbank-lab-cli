// 復元ロジックのテスト用ファクトリ。**パース後**（numStr で number 化済み）の形を作る。
// 生 API 形状の担保は共有フィクスチャ（__fixtures__/private/）と各コマンドテストの責務で、
// ここは「逆算の算術」だけを固定するため意図的に最小の値を置く。
import type { Deposit } from "../../commands/private/deposit-history.js";
import type { Trade } from "../../commands/private/trade-history.js";
import type { Withdrawal } from "../../commands/private/withdrawal-history.js";

let tradeId = 0;

export function trade(o: Partial<Trade> & Pick<Trade, "side" | "amount" | "price">): Trade {
  tradeId += 1;
  return {
    trade_id: tradeId,
    pair: "btc_jpy",
    order_id: tradeId,
    type: "limit",
    maker_taker: "taker",
    fee_amount_base: 0,
    fee_amount_quote: 0,
    fee_occurred_amount_quote: 0,
    executed_at: 1_000,
    ...o,
  };
}

export function deposit(o: Partial<Deposit> & Pick<Deposit, "asset" | "amount">): Deposit {
  return {
    uuid: `dep-${o.uuid ?? o.asset}-${o.amount}`,
    status: "DONE",
    found_at: 1_000,
    confirmed_at: 1_000,
    ...o,
  };
}

export function withdrawal(
  o: Partial<Withdrawal> & Pick<Withdrawal, "asset" | "amount" | "fee">,
): Withdrawal {
  return {
    uuid: `wd-${o.uuid ?? o.asset}-${o.amount}`,
    account_uuid: "acct",
    status: "DONE",
    requested_at: 1_000,
    ...o,
  };
}

export const NO_TRANSFERS = { deposits: [], withdrawals: [] };
