import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { paperInit } from "../../commands/paper/init.js";
import { paperReset } from "../../commands/paper/reset.js";

let dir: string;
let statePath: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "paper-reset-"));
  statePath = join(dir, "paper-state.json");
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("paper reset", () => {
  it("requires --confirm", async () => {
    await paperInit({ jpy: "1000000", statePath });
    const r = await paperReset({ statePath });
    expect(r.success).toBe(false);
    expect(existsSync(statePath)).toBe(true);
  });

  it("deletes state with --confirm", async () => {
    await paperInit({ jpy: "1000000", statePath });
    expect(existsSync(statePath)).toBe(true);
    const r = await paperReset({ confirm: true, statePath });
    expect(r.success).toBe(true);
    expect(existsSync(statePath)).toBe(false);
  });

  it("succeeds even when state file does not exist", async () => {
    const r = await paperReset({ confirm: true, statePath });
    expect(r.success).toBe(true);
  });
});
