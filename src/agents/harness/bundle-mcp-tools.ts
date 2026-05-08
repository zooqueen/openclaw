import type { OpenClawConfig } from "../../config/types.openclaw.js";
import { createBundleMcpToolRuntime } from "../pi-bundle-mcp-tools.js";
import type { BundleMcpToolRuntime, SessionMcpRuntime } from "../pi-bundle-mcp-types.js";
import { applyFinalEffectiveToolPolicy } from "../pi-embedded-runner/effective-tool-policy.js";
import { shouldCreateBundleMcpRuntimeForAttempt } from "../pi-embedded-runner/run/attempt-tool-construction-plan.js";

export type PolicyAwareBundleMcpToolRuntimeParams = {
  toolsEnabled: boolean;
  disableTools?: boolean;
  toolsAllow?: string[];
  workspaceDir: string;
  config?: OpenClawConfig;
  reservedToolNames?: Iterable<string>;
  sandboxToolPolicy?: { allow?: string[]; deny?: string[] };
  sessionKey?: string;
  agentId?: string;
  modelProvider?: string;
  modelId?: string;
  messageProvider?: string;
  agentAccountId?: string | null;
  groupId?: string | null;
  groupChannel?: string | null;
  groupSpace?: string | null;
  spawnedBy?: string | null;
  senderId?: string | null;
  senderName?: string | null;
  senderUsername?: string | null;
  senderE164?: string | null;
  senderIsOwner?: boolean;
  ownerOnlyToolAllowlist?: string[];
  warn: (message: string) => void;
  createRuntime?: (params: {
    sessionId: string;
    workspaceDir: string;
    cfg?: OpenClawConfig;
  }) => SessionMcpRuntime;
};

export async function createPolicyAwareBundleMcpToolRuntime(
  params: PolicyAwareBundleMcpToolRuntimeParams,
): Promise<BundleMcpToolRuntime | undefined> {
  if (
    !shouldCreateBundleMcpRuntimeForAttempt({
      toolsEnabled: params.toolsEnabled,
      disableTools: params.disableTools,
      toolsAllow: params.toolsAllow,
    })
  ) {
    return undefined;
  }

  const runtime = await createBundleMcpToolRuntime({
    workspaceDir: params.workspaceDir,
    cfg: params.config,
    reservedToolNames: params.reservedToolNames,
    ...(params.createRuntime ? { createRuntime: params.createRuntime } : {}),
  });
  const tools = applyFinalEffectiveToolPolicy({
    bundledTools: runtime.tools,
    config: params.config,
    sandboxToolPolicy: params.sandboxToolPolicy,
    sessionKey: params.sessionKey,
    agentId: params.agentId,
    modelProvider: params.modelProvider,
    modelId: params.modelId,
    messageProvider: params.messageProvider,
    agentAccountId: params.agentAccountId,
    groupId: params.groupId,
    groupChannel: params.groupChannel,
    groupSpace: params.groupSpace,
    spawnedBy: params.spawnedBy,
    senderId: params.senderId,
    senderName: params.senderName,
    senderUsername: params.senderUsername,
    senderE164: params.senderE164,
    senderIsOwner: params.senderIsOwner,
    ownerOnlyToolAllowlist: params.ownerOnlyToolAllowlist,
    warn: params.warn,
  });

  return {
    tools,
    dispose: runtime.dispose,
  };
}
