import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach } from "vitest";
import { resetThrottle } from "../throttle.js";

// テスト間で profiles.json が ~/.bitbank に共有されると干渉するため、
// 全テスト実行を tmp の存在しないパスに固定して隔離する。
const tmp = mkdtempSync(join(tmpdir(), "bitbank-tests-"));
process.env.BITBANK_PROFILES_PATH = join(tmp, "profiles.json");

beforeEach(() => resetThrottle());
