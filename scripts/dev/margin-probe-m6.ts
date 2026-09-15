// 信用注文の実機確認 #M-6（docs/dev/margin-order-plan.md §4 Step 6）。開発用スクリプト。
//   npx tsx scripts/dev/margin-probe-m6.ts [sell-long|buy-short] [--execute]
// 建玉が無い状態で「返済方向」（sell×long / buy×short）の信用注文を出すと API が
// どう応答するかを観測する。価格は現在値の 2 倍（sell）/ 半分（buy）なので約定しない。
// 注文が通った場合は active_orders を表示してから即キャンセルする（#M-4 の確認を兼ねる）。
// 認証は通常の CLI と同じ（default profile → BITBANK_API_KEY / BITBANK_API_SECRET env）。
// --execute なしでは body を表示するだけで API を叩かない。
import { publicGet } from "../../cli/http.js";
import { privateGet } from "../../cli/http-private.js";
import { privatePost } from "../../cli/http-private-post.js";

const PAIR = "btc_jpy";
const AMOUNT = "0.0001"; // /spot/pairs の unit_amount
const CASE = process.argv[2] === "buy-short" ? "buy-short" : "sell-long";
const EXECUTE = process.argv.includes("--execute");

const [side, position_side] = CASE === "buy-short" ? ["buy", "short"] : ["sell", "long"];

type Positions = { positions: { pair: string; position_side: string; open_amount: string }[] };
const pos = await privateGet<Positions>("/user/margin/positions", { pair: PAIR });
if (!pos.success) {
  console.error("margin/positions 失敗:", pos.error);
  process.exit(1);
}
const open = pos.data.positions.find((p) => p.position_side === position_side)?.open_amount;
if (Number(open) !== 0) {
  console.error(`建玉あり (${position_side} open_amount=${open})。実験を中止します`);
  process.exit(1);
}

const t = await publicGet<{ last: string }>(`/${PAIR}/ticker`);
if (!t.success) {
  console.error("ticker 失敗:", t.error);
  process.exit(1);
}
const last = Number(t.data.last);
const price = String(side === "sell" ? Math.round(last * 2) : Math.round(last / 2));

const body = { pair: PAIR, side, position_side, type: "limit", price, amount: AMOUNT };
console.log("body:", JSON.stringify(body));
if (!EXECUTE) {
  console.log("(dry) --execute を付けると送信します");
  process.exit(0);
}

const r = await privatePost<{ order_id: number }>("/user/spot/order", body);
console.log("order response:", JSON.stringify(r, null, 2));
if (!r.success) process.exit(0);

const active = await privateGet<unknown>("/user/spot/active_orders", { pair: PAIR });
console.log("active_orders:", JSON.stringify(active, null, 2));

const c = await privatePost<unknown>("/user/spot/cancel_order", {
  pair: PAIR,
  order_id: r.data.order_id,
});
console.log("cancel response:", JSON.stringify(c, null, 2));
