import { z } from "zod";
import { EXIT } from "../../exit-codes.js";
import { type PrivatePostOptions, privatePost } from "../../http-private-post.js";
import { parseResponse } from "../../parse-response.js";
import type { DryRunData, Result } from "../../types.js";
import { UuidSchema } from "../../validators.js";
import { refineExecuteConfirm } from "./confirm-guard.js";
import { dryRunResult } from "./dry-run.js";

// 実 bitbank API `POST /user/confirm_deposits_all` は成功時 data を空 {} で返す
// （rest-api.md "Confirm all deposits"）。空 data を成功として扱うため passthrough。
const ConfirmDepositsAllResponseSchema = z.object({}).passthrough();

export type ConfirmDepositsAllResponse = z.infer<typeof ConfirmDepositsAllResponseSchema>;

const ConfirmDepositsAllInputSchema = z
  .object({
    // originator_uuid は実 API で必須。UuidSchema で形式も検証する。
    originatorUuid: UuidSchema,
    execute: z.boolean().optional(),
    confirm: z.string().optional(),
  })
  .superRefine(refineExecuteConfirm("confirm-deposits-all"));

export type ConfirmDepositsAllArgs = {
  originatorUuid?: string;
  execute?: boolean;
  confirm?: string;
};

export async function confirmDepositsAll(
  args: ConfirmDepositsAllArgs,
  opts?: PrivatePostOptions,
): Promise<Result<ConfirmDepositsAllResponse | DryRunData>> {
  const parsed = ConfirmDepositsAllInputSchema.safeParse({
    originatorUuid: args.originatorUuid,
    execute: args.execute,
    confirm: args.confirm,
  });
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => i.message).join("; ");
    return { success: false, error: msg, exitCode: EXIT.PARAM };
  }

  const body = { originator_uuid: parsed.data.originatorUuid };

  if (!parsed.data.execute) {
    return dryRunResult({
      command: "confirm-deposits-all",
      endpoint: "/v1/user/confirm_deposits_all",
      body,
      args: { originatorUuid: args.originatorUuid },
    });
  }

  const result = await privatePost<unknown>("/user/confirm_deposits_all", body, opts);
  return parseResponse(result, ConfirmDepositsAllResponseSchema);
}
