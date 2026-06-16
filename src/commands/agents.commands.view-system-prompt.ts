// Implements `openclaw agents view-system-prompt` prompt assembly preview.
import os from "node:os";
import { normalizeOptionalString } from "@openclaw/normalization-core/string-coerce";
import { isAcpRuntimeSpawnAvailable } from "../acp/runtime/availability.js";
import {
  resolveAgentDir,
  resolveAgentWorkspaceDir,
  resolveDefaultAgentId,
} from "../agents/agent-scope.js";
import { createOpenClawCodingTools, resolveProcessToolScopeKey } from "../agents/agent-tools.js";
import { listActiveProcessSessionReferences } from "../agents/bash-process-references.js";
import {
  buildBootstrapContextForFiles,
  resolveBootstrapFilesForRun,
} from "../agents/bootstrap-files.js";
import {
  listChannelSupportedActions,
  resolveChannelMessageToolHints,
  resolveChannelReactionGuidance,
} from "../agents/channel-tools.js";
import { resolveModelAsync } from "../agents/embedded-agent-runner/model.js";
import { buildAttemptSystemPrompt } from "../agents/embedded-agent-runner/run/attempt-system-prompt.js";
import { resolveHeartbeatPromptForSystemPrompt } from "../agents/heartbeat-system-prompt.js";
import {
  resolveDefaultModelForAgent,
  resolveModelRefFromString,
} from "../agents/model-selection.js";
import { collectRuntimeChannelCapabilities } from "../agents/runtime-capabilities.js";
import { detectRuntimeShell } from "../agents/shell-utils.js";
import { buildSystemPromptParams } from "../agents/system-prompt-params.js";
import { DEFAULT_BOOTSTRAP_FILENAME } from "../agents/workspace.js";
import type { OpenClawConfig } from "../config/types.openclaw.js";
import { getMachineDisplayName } from "../infra/machine-name.js";
import type { Model } from "../llm/types.js";
import { listRegisteredPluginAgentPromptGuidance } from "../plugins/command-registry-state.js";
import {
  resolveProviderSystemPromptContribution,
  transformProviderSystemPrompt,
} from "../plugins/provider-runtime.js";
import { normalizeAgentId } from "../routing/session-key.js";
import type { RuntimeEnv } from "../runtime.js";
import { defaultRuntime } from "../runtime.js";
import { normalizeMessageChannel } from "../utils/message-channel.js";
import { isReasoningTagProvider } from "../utils/provider-utils.js";
import { requireValidConfig } from "./agents.command-shared.js";

export type AgentsViewSystemPromptOptions = {
  agentId?: string;
  model?: string;
  channel?: string;
};

export type AgentsSystemPromptPreviewDeps = {
  buildAttemptSystemPrompt: typeof buildAttemptSystemPrompt;
  createOpenClawCodingTools: typeof createOpenClawCodingTools;
  resolveModelAsync: typeof resolveModelAsync;
  getMachineDisplayName: typeof getMachineDisplayName;
};

export type AgentsSystemPromptPreview = {
  agentId: string;
  workspaceDir: string;
  provider: string;
  modelId: string;
  channel?: string;
  prompt: string;
};

const defaultPreviewDeps: AgentsSystemPromptPreviewDeps = {
  buildAttemptSystemPrompt,
  createOpenClawCodingTools,
  resolveModelAsync,
  getMachineDisplayName,
};

function resolvePreviewModelRef(params: { cfg: OpenClawConfig; agentId: string; model?: string }): {
  provider: string;
  model: string;
} {
  const defaultRef = resolveDefaultModelForAgent({
    cfg: params.cfg,
    agentId: params.agentId,
  });
  const selected = normalizeOptionalString(params.model);
  if (!selected) {
    return defaultRef;
  }
  return (
    resolveModelRefFromString({
      cfg: params.cfg,
      raw: selected,
      defaultProvider: defaultRef.provider,
      allowPluginNormalization: true,
    })?.ref ?? {
      provider: defaultRef.provider,
      model: selected,
    }
  );
}

function writePrompt(runtime: RuntimeEnv, prompt: string): void {
  const writable = runtime as RuntimeEnv & { writeStdout?: (value: string) => void };
  if (typeof writable.writeStdout === "function") {
    writable.writeStdout(prompt);
    return;
  }
  runtime.log(prompt);
}

function formatMetadata(preview: AgentsSystemPromptPreview): string {
  return [
    `Agent: ${preview.agentId}`,
    `Workspace: ${preview.workspaceDir}`,
    `Model: ${preview.provider}/${preview.modelId}`,
    `Channel: ${preview.channel ?? "none"}`,
    `Prompt bytes: ${Buffer.byteLength(preview.prompt, "utf8")}`,
  ].join("\n");
}

export async function buildAgentsSystemPromptPreview(
  opts: AgentsViewSystemPromptOptions,
  cfg: OpenClawConfig,
  deps: AgentsSystemPromptPreviewDeps = defaultPreviewDeps,
): Promise<AgentsSystemPromptPreview> {
  const agentId = normalizeAgentId(opts.agentId ?? resolveDefaultAgentId(cfg));
  const defaultAgentId = resolveDefaultAgentId(cfg);
  const workspaceDir = resolveAgentWorkspaceDir(cfg, agentId);
  const agentDir = resolveAgentDir(cfg, agentId);
  const modelRef = resolvePreviewModelRef({ cfg, agentId, model: opts.model });
  const resolvedModel = await deps.resolveModelAsync(
    modelRef.provider,
    modelRef.model,
    agentDir,
    cfg,
    {
      workspaceDir,
      skipAgentDiscovery: true,
      allowBundledStaticCatalogFallback: true,
    },
  );
  if (!resolvedModel.model) {
    throw new Error(
      resolvedModel.error ??
        `Unknown model: ${modelRef.provider}/${modelRef.model}. Try --model with a configured provider/model id.`,
    );
  }

  const model = resolvedModel.model as Model;
  const sessionKey = `agent:${agentId}:prompt-preview`;
  const bootstrapFiles = await resolveBootstrapFilesForRun({
    workspaceDir,
    config: cfg,
    sessionKey,
    agentId,
    warn: () => {},
  });
  const contextFiles = buildBootstrapContextForFiles(bootstrapFiles, {
    config: cfg,
    agentId,
    warn: () => {},
  });
  const workspaceNotes = bootstrapFiles.some(
    (file) => file.name === DEFAULT_BOOTSTRAP_FILENAME && !file.missing,
  )
    ? ["Reminder: commit your changes in this workspace after edits."]
    : undefined;
  const runtimeChannel = normalizeMessageChannel(opts.channel);
  const runtimeCapabilities = collectRuntimeChannelCapabilities({
    cfg,
    channel: runtimeChannel,
  });
  const channelActions = runtimeChannel
    ? listChannelSupportedActions({ cfg, channel: runtimeChannel, agentId })
    : undefined;
  const messageToolHints = runtimeChannel
    ? resolveChannelMessageToolHints({ cfg, channel: runtimeChannel })
    : undefined;
  const defaultModelRef = resolveDefaultModelForAgent({ cfg, agentId });
  const machineName = await deps.getMachineDisplayName();
  const tools = deps.createOpenClawCodingTools({
    agentId,
    agentDir,
    sessionKey,
    workspaceDir,
    cwd: workspaceDir,
    spawnWorkspaceDir: workspaceDir,
    config: cfg,
    modelProvider: modelRef.provider,
    modelId: modelRef.model,
    modelApi: model.api,
    modelContextWindowTokens: model.contextWindow,
    modelCompat: model.compat,
    messageProvider: runtimeChannel,
  });
  const { runtimeInfo, userTimezone, userTime, userTimeFormat } = buildSystemPromptParams({
    config: cfg,
    agentId,
    workspaceDir,
    cwd: workspaceDir,
    runtime: {
      sessionKey,
      host: machineName,
      os: `${os.type()} ${os.release()}`,
      arch: os.arch(),
      node: process.version,
      model: `${modelRef.provider}/${modelRef.model}`,
      defaultModel: `${defaultModelRef.provider}/${defaultModelRef.model}`,
      shell: detectRuntimeShell(),
      channel: runtimeChannel,
      capabilities: runtimeCapabilities,
      channelActions,
      activeProcessSessions: listActiveProcessSessionReferences({
        scopeKey: resolveProcessToolScopeKey({ sessionKey, agentId }),
      }),
    },
  });
  const promptMode = "full";
  const promptContributionContext = {
    config: cfg,
    agentDir,
    workspaceDir,
    provider: modelRef.provider,
    modelId: modelRef.model,
    promptMode,
    agentId,
    trigger: "manual",
    ...(runtimeChannel ? { runtimeChannel } : {}),
    ...(runtimeCapabilities ? { runtimeCapabilities } : {}),
  } as const;
  const { systemPrompt } = deps.buildAttemptSystemPrompt({
    isRawModelRun: false,
    transformProviderSystemPrompt,
    embeddedSystemPrompt: {
      config: cfg,
      agentId,
      workspaceDir,
      reasoningLevel: "off",
      reasoningTagHint: isReasoningTagProvider(modelRef.provider, {
        config: cfg,
        workspaceDir,
        modelId: modelRef.model,
        modelApi: model.api,
        model,
      }),
      heartbeatPrompt: resolveHeartbeatPromptForSystemPrompt({
        config: cfg,
        agentId,
        defaultAgentId,
      }),
      workspaceNotes,
      reactionGuidance: runtimeChannel
        ? resolveChannelReactionGuidance({ cfg, channel: runtimeChannel })
        : undefined,
      promptMode,
      acpEnabled: isAcpRuntimeSpawnAvailable({ config: cfg }),
      promptSurface: "openclaw_main",
      nativeCommandGuidanceLines: listRegisteredPluginAgentPromptGuidance({
        surface: "openclaw_main",
      }),
      runtimeInfo,
      messageToolHints,
      tools,
      userTimezone,
      userTime,
      userTimeFormat,
      contextFiles,
      includeMemorySection: true,
      promptContribution: resolveProviderSystemPromptContribution({
        provider: modelRef.provider,
        config: cfg,
        workspaceDir,
        context: promptContributionContext,
      }),
    },
    providerTransform: {
      provider: modelRef.provider,
      config: cfg,
      workspaceDir,
      context: {
        ...promptContributionContext,
        config: cfg,
      },
    },
  });
  return {
    agentId,
    workspaceDir,
    provider: modelRef.provider,
    modelId: modelRef.model,
    ...(runtimeChannel ? { channel: runtimeChannel } : {}),
    prompt: systemPrompt,
  };
}

/** Print an assembled prompt preview for a configured agent without making an LLM call. */
export async function agentsViewSystemPromptCommand(
  opts: AgentsViewSystemPromptOptions,
  runtime: RuntimeEnv = defaultRuntime,
  deps: AgentsSystemPromptPreviewDeps = defaultPreviewDeps,
): Promise<void> {
  const cfg = await requireValidConfig(runtime);
  if (!cfg) {
    return;
  }
  const preview = await buildAgentsSystemPromptPreview(opts, cfg, deps);
  runtime.error(formatMetadata(preview));
  writePrompt(runtime, preview.prompt);
}
