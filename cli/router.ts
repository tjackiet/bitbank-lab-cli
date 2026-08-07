import type { CommandEntry } from "./commands/handler-types.js";
import {
  COMMANDS,
  commandDescriptions,
  PAPER_COMMANDS,
  PROFILE_COMMANDS,
  TAX_COMMANDS,
  TRADE_COMMANDS,
} from "./commands/registry.js";
import type { Format } from "./types.js";

/** サブコマンド形式で呼ぶグループ（`bitbank <group> <name>`）。
 *  フラット一覧での誤爆を減らすためのもので、実行ガードではない（commands.md）。 */
const GROUP_REGISTRY = {
  trade: TRADE_COMMANDS,
  paper: PAPER_COMMANDS,
  profile: PROFILE_COMMANDS,
  tax: TAX_COMMANDS,
} as const;

export type SubcommandGroup = keyof typeof GROUP_REGISTRY;

const GROUPS = Object.keys(GROUP_REGISTRY) as SubcommandGroup[];

export type ResolvedCommand = {
  /** サブコマンドグループ名。フラットなコマンドでは undefined */
  group: SubcommandGroup | undefined;
  command: string | undefined;
  entry: CommandEntry | undefined;
};

export function resolveCommand(positionals: string[]): ResolvedCommand {
  const group = GROUPS.find((g) => g === positionals[0]);
  const command = group ? positionals[1] : positionals[0];
  let entry: CommandEntry | undefined;
  if (group) entry = command ? GROUP_REGISTRY[group][command] : undefined;
  else entry = COMMANDS[command ?? ""];
  return { group, command, entry };
}

export async function handleSpecialCommand(
  command: string,
  args: string[],
  opts: Record<string, string | boolean | undefined>,
  format: Format,
): Promise<boolean> {
  if (command === "profiles") {
    const { profilesHandler } = await import("./commands/profiles.js");
    await profilesHandler(args, opts, format);
    return true;
  }
  if (command === "completion") {
    const { completionHandler } = await import("./commands/completion/index.js");
    await completionHandler(args, opts, format);
    return true;
  }
  if (command === "schema") {
    const { buildSchemaHandler } = await import("./commands/schema/handler.js");
    await buildSchemaHandler(commandDescriptions())(args, opts, format);
    return true;
  }
  return false;
}

/** `group` 付きで呼ぶと `<group> <name>` キーで schema を引く（ALL_SCHEMAS の
 *  キーは呼び出しパス。素の名前は private の assets と paper assets のように衝突する）。 */
export async function runCommandHelp(
  command: string,
  description: string,
  group?: SubcommandGroup,
): Promise<boolean> {
  const { showCommandHelp } = await import("./commands/schema/help.js");
  return showCommandHelp(group ? `${group} ${command}` : command, description);
}
