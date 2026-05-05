// 100行超: paper サブコマンド専用のローカル状態管理。
// CLI 全体は API データの取得・整形のみを責務とするが、
// paper はライブ価格 × 仮想資金のシミュレーションを行うため例外的に
// state を持つ（CLAUDE.md 参照）。スキーマ・I/O・ヘルパーをまとめて集約。
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { z } from "zod";
import type { Result } from "./types.js";

export const PaperHistoryEntrySchema = z.object({
  id: z.string(),
  pair: z.string(),
  side: z.enum(["buy", "sell"]),
  type: z.literal("market"),
  amount: z.number(),
  fillPrice: z.number(),
  feeJpy: z.number(),
  filledAt: z.string(),
});

export const PaperStateSchema = z.object({
  version: z.literal(1),
  createdAt: z.string(),
  updatedAt: z.string(),
  initialJpy: z.number(),
  balances: z.record(z.string(), z.number()),
  history: z.array(PaperHistoryEntrySchema),
});

export type PaperState = z.infer<typeof PaperStateSchema>;
export type PaperHistoryEntry = z.infer<typeof PaperHistoryEntrySchema>;

// bitbank 公称テイカー手数料 0.12%
// 出典: https://bitbank.cc/docs/fees/
export const DEFAULT_TAKER_FEE_RATE = 0.0012;

export function defaultStatePath(): string {
  if (process.env.BITBANK_PAPER_STATE_PATH) return process.env.BITBANK_PAPER_STATE_PATH;
  const xdg = process.env.XDG_DATA_HOME;
  if (xdg) return join(xdg, "bitbank", "paper-state.json");
  return join(homedir(), ".bitbank", "paper-state.json");
}

export function nowIso(): string {
  return new Date(Date.now()).toISOString();
}

export function genId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export async function loadState(path = defaultStatePath()): Promise<Result<PaperState | null>> {
  try {
    const buf = await readFile(path, "utf-8");
    const json = JSON.parse(buf) as unknown;
    const parsed = PaperStateSchema.safeParse(json);
    if (!parsed.success) {
      return { success: false, error: `Invalid paper state: ${parsed.error.message}` };
    }
    return { success: true, data: parsed.data };
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") {
      return { success: true, data: null };
    }
    const msg = e instanceof Error ? e.message : String(e);
    return { success: false, error: `Failed to read paper state: ${msg}` };
  }
}

export async function saveState(
  state: PaperState,
  path = defaultStatePath(),
): Promise<Result<{ saved: true }>> {
  try {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, `${JSON.stringify(state, null, 2)}\n`, {
      encoding: "utf-8",
      mode: 0o600,
    });
    return { success: true, data: { saved: true } };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { success: false, error: `Failed to write paper state: ${msg}` };
  }
}

export async function deleteState(path = defaultStatePath()): Promise<Result<{ deleted: true }>> {
  try {
    await unlink(path);
    return { success: true, data: { deleted: true } };
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") {
      return { success: true, data: { deleted: true } };
    }
    const msg = e instanceof Error ? e.message : String(e);
    return { success: false, error: `Failed to delete paper state: ${msg}` };
  }
}
