import { z } from "zod";
import type { ExitCode } from "./exit-codes.js";

const RateLimitSchema = z.object({
  remaining: z.number(),
  limit: z.number(),
  reset: z.number(),
});

export type RateLimitInfo = z.infer<typeof RateLimitSchema>;

export type TruncationReason = "MAX_RANGE_FETCHES" | "HARD_MAX_SEGMENTS" | "MAX_PAGES";

export type Gap = { from: number; to: number; missing: number };

/** 取得コンテキスト: どのコマンドを・どのパラメータで叩いたか（再現性のため meta に付与）。 */
export type RequestContext = {
  command: string;
  pair?: string;
  type?: string;
  date?: string;
  from?: string;
  to?: string;
  limit?: number;
};

export type ResultMeta = {
  rateLimit?: RateLimitInfo;
  truncated?: boolean;
  truncatedAt?: string;
  requestedLimit?: number;
  returnedRows?: number;
  reason?: TruncationReason;
  dedupedCount?: number;
  gaps?: Gap[];
  lastIsIncomplete?: boolean;
  request?: RequestContext;
  timezone?: string; // 取得時の日付基準。常に "UTC"
  source?: string; // "public" / "private"（modulePath ベースの粗い分類）
  fetchedAt?: string; // 取得時刻（ISO 8601 / UTC）
};

export type Result<T> =
  | { success: true; data: T; partial?: boolean; meta?: ResultMeta }
  | { success: false; error: string; exitCode?: ExitCode };

export type Format = "json" | "table" | "csv";
