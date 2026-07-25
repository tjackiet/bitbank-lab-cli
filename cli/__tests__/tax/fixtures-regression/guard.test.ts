import { describe, expect, it } from "vitest";
import { checkFixtures, ENV_VAR, formatMismatch } from "./guard.js";

// ガード自体のテスト（実データ不要）。実データ回帰は fixtures.test.ts が担う。
describe("fixtures ガード: 3 状態の判定", () => {
  it("環境変数が無ければ skip（fail にしない）", () => {
    const saved = process.env[ENV_VAR];
    delete process.env[ENV_VAR];
    const s = checkFixtures();
    expect(s.kind).toBe("skip");
    if (s.kind === "skip") expect(s.reason).toContain(ENV_VAR);
    if (saved !== undefined) process.env[ENV_VAR] = saved;
  });

  it("環境変数が指す先に raw/ が無ければ skip", () => {
    const saved = process.env[ENV_VAR];
    process.env[ENV_VAR] = "/nonexistent-path-for-test";
    const s = checkFixtures();
    expect(s.kind).toBe("skip");
    if (s.kind === "skip") expect(s.reason).toContain("raw/");
    if (saved === undefined) delete process.env[ENV_VAR];
    else process.env[ENV_VAR] = saved;
  });

  it("不一致メッセージは skip と区別でき、対象ファイルを列挙し、再生成手順を含む", () => {
    const msg = formatMismatch({
      kind: "mismatch",
      root: "/tmp/fx",
      missing: ["raw/batch1/a.json"],
      differing: ["raw/batch1/b.json", "raw/batch2/c.json"],
      extra: [],
    });
    expect(msg).toContain("データ相違");
    expect(msg).toContain("skip とは別状態");
    expect(msg).toContain("raw/batch1/a.json");
    expect(msg).toContain("raw/batch1/b.json");
    expect(msg).toContain("raw/batch2/c.json");
    expect(msg).toContain("欠落 (1)");
    expect(msg).toContain("内容相違 (2)");
    expect(msg).toContain("gen-fixtures-manifest.ts");
  });
});
