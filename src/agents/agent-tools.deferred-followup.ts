/**
 * Adjusts exec/process tool descriptions for long-running follow-up behavior.
 * Cron-aware runs can point models at scheduled follow-ups; cronless runs keep
 * guidance constrained to process polling and wake handling.
 */
import type { AnyAgentTool } from "./agent-tools.types.js";
import { describeExecTool, describeProcessTool } from "./bash-tools.descriptions.js";

function readToolName(tool: AnyAgentTool): string | undefined {
  try {
    const name = tool.name;
    return typeof name === "string" ? name : undefined;
  } catch {
    return undefined;
  }
}

function replaceToolDescription(tool: AnyAgentTool, description: string): AnyAgentTool {
  const next = Object.create(tool) as AnyAgentTool;
  Object.defineProperty(next, "description", {
    value: description,
    enumerable: true,
    configurable: true,
    writable: true,
  });
  return next;
}

/** Return tools with exec/process descriptions adjusted for cron availability. */
export function applyDeferredFollowupToolDescriptions(
  tools: AnyAgentTool[],
  params?: { agentId?: string },
): AnyAgentTool[] {
  const names = tools.map((tool) => readToolName(tool));
  const hasCronTool = names.includes("cron");
  return tools.map((tool) => {
    const name = readToolName(tool);
    if (name === "exec") {
      return replaceToolDescription(
        tool,
        describeExecTool({ agentId: params?.agentId, hasCronTool }),
      );
    }
    if (name === "process") {
      return replaceToolDescription(tool, describeProcessTool({ hasCronTool }));
    }
    return tool;
  });
}
