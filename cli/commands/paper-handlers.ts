import type { CommandEntry } from "./handler-types.js";
import { bool, str, valStr } from "./handler-types.js";
import { handler } from "./make-handler.js";

export const paperCommands: Record<string, CommandEntry> = {
  init: {
    description: "Initialize a paper trading account (virtual JPY balance)",
    options: { jpy: str, force: bool() },
    handler: handler("./paper/init.js", "paperInit", (_a, v) => ({
      jpy: valStr(v, "jpy"),
      force: !!v.force,
    })),
  },
  assets: {
    description: "Show paper trading balances",
    handler: handler("./paper/assets.js", "paperAssets", () => ({})),
  },
  "create-order": {
    description: "Place a paper market order at live last price",
    options: { pair: str, side: str, type: str, amount: str },
    handler: handler("./paper/create-order.js", "paperCreateOrder", (_a, v) => ({
      pair: valStr(v, "pair"),
      side: valStr(v, "side"),
      type: valStr(v, "type"),
      amount: valStr(v, "amount"),
    })),
  },
  "trade-history": {
    description: "Show paper trading execution history",
    handler: handler("./paper/trade-history.js", "paperTradeHistory", () => ({})),
  },
  reset: {
    description: "Reset paper trading state (requires --confirm)",
    options: { confirm: bool() },
    handler: handler("./paper/reset.js", "paperReset", (_a, v) => ({
      confirm: !!v.confirm,
    })),
  },
};
