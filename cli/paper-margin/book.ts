// PaperState（v4）と、信用の計算が使う MarginBook の相互変換（ADR-010 / docs/dev/paper-margin-plan.md §3.3）。
// JPY 残高は現物と共有する balances.jpy を差入保証金として渡し、計算後の値を書き戻す。
import type { PaperState } from "../paper-state.js";
import type { MarginBook } from "./state.js";

export function bookOf(state: PaperState): MarginBook {
  return {
    jpy: state.balances.jpy ?? 0,
    positions: state.margin.positions,
    orders: state.margin.orders,
    call: state.margin.call,
  };
}

export function withBook(state: PaperState, book: MarginBook): PaperState {
  return {
    ...state,
    balances: { ...state.balances, jpy: book.jpy },
    margin: { ...state.margin, positions: book.positions, orders: book.orders, call: book.call },
  };
}

/** 信用の建玉か注文があるか（信用の走査が要る口座か） */
export function hasMarginBook(state: PaperState): boolean {
  return state.margin.positions.length > 0 || state.margin.orders.length > 0;
}
