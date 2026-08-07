// ALL_SCHEMAS の合成不変条件。paper / profile 収録前は flat な素のコマンド名を
// スプレッドしていたため、paper の assets / create-order / pnl 等が既存キーと
// 衝突し「型エラーも出ず静かに後勝ちで消える」構造だった。ここでその穴を固定する。
import { describe, expect, it } from "vitest";
import {
  PAPER_COMMANDS,
  PROFILE_COMMANDS,
  TAX_COMMANDS,
  TRADE_COMMANDS,
} from "../commands/registry.js";
import {
  ALL_SCHEMAS,
  SCHEMA_DEF_COUNT,
  SCHEMA_KEY_COLLISIONS,
} from "../commands/schema/registry.js";
import { SUBCOMMAND_GROUPS } from "../commands/schema/types.js";

const GROUPS = {
  trade: TRADE_COMMANDS,
  tax: TAX_COMMANDS,
  paper: PAPER_COMMANDS,
  profile: PROFILE_COMMANDS,
} as const;

describe("ALL_SCHEMAS のキー合成", () => {
  it("1 件も取りこぼさない（キー数 = 各 defs のキー数の合計）", () => {
    expect(SCHEMA_KEY_COLLISIONS).toEqual([]);
    expect(Object.keys(ALL_SCHEMAS)).toHaveLength(SCHEMA_DEF_COUNT);
  });

  it("キーは呼び出しパスそのもの（サブコマンドだけ `<category> <name>`）", () => {
    for (const [key, def] of Object.entries(ALL_SCHEMAS)) {
      const isSub = SUBCOMMAND_GROUPS.has(def.category);
      expect(key.includes(" "), `${key}: category=${def.category}`).toBe(isSub);
      if (isSub) expect(key.startsWith(`${def.category} `), key).toBe(true);
    }
  });

  it("素の名前が衝突する 6 組が両方とも残る（回帰の本体）", () => {
    const pairs = [
      ["assets", "paper assets"],
      ["active-orders", "paper active-orders"],
      ["trade-history", "paper trade-history"],
      ["trade create-order", "paper create-order"],
      ["trade cancel-order", "paper cancel-order"],
      ["tax pnl", "paper pnl"],
    ];
    for (const [a, b] of pairs) {
      expect(ALL_SCHEMAS[a], `${a} が ${b} に上書きされている`).toBeDefined();
      expect(ALL_SCHEMAS[b], `${b} が ${a} に上書きされている`).toBeDefined();
      expect(ALL_SCHEMAS[a]).not.toBe(ALL_SCHEMAS[b]);
    }
  });
});

describe("カタログのコマンド網羅", () => {
  it("登録済みサブコマンドが全て `<group> <name>` キーで載る", () => {
    for (const [group, commands] of Object.entries(GROUPS)) {
      for (const name of Object.keys(commands)) {
        const key = `${group} ${name}`;
        expect(ALL_SCHEMAS[key], `${key} が ALL_SCHEMAS に無い`).toBeDefined();
        expect(ALL_SCHEMAS[key].category).toBe(group);
      }
    }
  });

  it("サブコマンドの schema に登録されていない名前が混ざらない", () => {
    for (const [key, def] of Object.entries(ALL_SCHEMAS)) {
      if (!SUBCOMMAND_GROUPS.has(def.category)) continue;
      const name = key.slice(def.category.length + 1);
      expect(
        GROUPS[def.category as keyof typeof GROUPS][name],
        `${key} に handler が無い`,
      ).toBeDefined();
    }
  });
});
