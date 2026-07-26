import { bool, type CommandEntry, str, valStr } from "./handler-types.js";
import { handler } from "./make-handler.js";

export const taxCommands: Record<string, CommandEntry> = {
  events: {
    description: "Normalize trade/deposit/withdrawal history into tax events (read-only)",
    options: { year: str, "max-pages": str },
    handler: handler("./tax/events.js", "taxEvents", (_a, v) => ({
      year: valStr(v, "year"),
      maxPages: valStr(v, "max-pages"),
    })),
  },
  reconcile: {
    description: "Compare rebuilt theoretical balances against /user/assets (detect, not judge)",
    options: { "max-pages": str },
    handler: handler("./tax/reconcile.js", "taxReconcile", (_a, v) => ({
      maxPages: valStr(v, "max-pages"),
    })),
  },
  pnl: {
    description: "Transaction summary + reference P&L when the display guards all pass",
    options: {
      year: str,
      method: str,
      carryover: str,
      attest: bool(),
      "max-pages": str,
    },
    handler: handler("./tax/pnl.js", "taxPnl", (_a, v) => ({
      year: valStr(v, "year"),
      method: valStr(v, "method"),
      carryover: valStr(v, "carryover"),
      attest: v.attest === true,
      maxPages: valStr(v, "max-pages"),
    })),
  },
};
