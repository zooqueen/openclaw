import { requireActivePluginRegistry } from "../../plugins/runtime.js";
import { parseCommandArgs, resolveTextCommand } from "../commands-registry.js";
import type { CommandHandler } from "./commands-types.js";

export const handlePluginCommand: CommandHandler = async (params, allowTextCommands) => {
  if (!allowTextCommands) return null;
  const registry = requireActivePluginRegistry();
  if (registry.chatCommands.length === 0) return null;

  const raw = params.command.commandBodyNormalized;
  if (!raw.startsWith("/")) return null;

  const resolved = resolveTextCommand(raw, params.cfg);
  if (!resolved) return null;

  const registration = registry.chatCommands.find(
    (entry) => entry.command.key === resolved.command.key,
  );
  if (!registration) return null;

  if (resolved.args) {
    params.ctx.CommandArgs = parseCommandArgs(resolved.command, resolved.args);
  }

  return await registration.handler(params, allowTextCommands);
};
