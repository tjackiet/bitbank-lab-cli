import { EXIT } from "../../exit-codes.js";
import { nowIso } from "../../paper-state.js";
import {
  type ProfilesFile,
  emptyProfilesFile,
  loadProfiles,
  saveProfiles,
} from "../../profiles-store.js";
import type { Result } from "../../types.js";
import { type Prompts, defaultPrompts } from "./prompt.js";

const NAME_RE = /^[A-Za-z0-9._-]+$/;

export type ProfileAddArgs = {
  name: string;
  description?: string;
  setDefault?: boolean;
};

export type ProfileAddResult = {
  added: string;
  default: boolean;
  description?: string;
};

export async function profileAdd(
  args: ProfileAddArgs,
  prompts: Prompts = defaultPrompts,
): Promise<Result<ProfileAddResult>> {
  const { name } = args;
  if (!NAME_RE.test(name) || name.startsWith(".") || name.includes("..")) {
    return { success: false, error: "Invalid profile name", exitCode: EXIT.PARAM };
  }

  const file = loadProfiles();
  const current: ProfilesFile = file.success ? file.data : emptyProfilesFile();
  if (current.profiles[name]) {
    return {
      success: false,
      error: `Profile "${name}" already exists`,
      exitCode: EXIT.PARAM,
    };
  }

  const key = process.env.BITBANK_API_KEY ?? (await prompts.readVisible(`API key for "${name}": `));
  if (!key) {
    return { success: false, error: "API key is required", exitCode: EXIT.PARAM };
  }
  const secret =
    process.env.BITBANK_API_SECRET ?? (await prompts.readHidden(`API secret for "${name}": `));
  if (!secret) {
    return { success: false, error: "API secret is required", exitCode: EXIT.PARAM };
  }

  const next: ProfilesFile = {
    version: 1,
    default: args.setDefault ? name : current.default,
    profiles: {
      ...current.profiles,
      [name]: { key, secret, description: args.description, createdAt: nowIso() },
    },
  };
  const saved = saveProfiles(next);
  if (!saved.success) return saved;

  return {
    success: true,
    data: { added: name, default: next.default === name, description: args.description },
  };
}
