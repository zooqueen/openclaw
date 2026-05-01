import type { OpenClawConfig } from "../config/types.openclaw.js";
import { callGateway } from "../gateway/call.js";
import { isEmbeddedMode } from "../infra/embedded-mode.js";
import { getActiveRuntimeWebToolsMetadata } from "../secrets/runtime.js";
import { normalizeDeliveryContext } from "../utils/delivery-context.js";
import type { GatewayMessageChannel } from "../utils/message-channel.js";
import { resolveAgentWorkspaceDir, resolveSessionAgentIds } from "./agent-scope.js";
import { resolveOpenClawPluginToolsForOptions } from "./openclaw-plugin-tools.js";
import { applyNodesToolWorkspaceGuard } from "./openclaw-tools.nodes-workspace-guard.js";
import {
  collectPresentOpenClawTools,
  isUpdatePlanToolEnabledForOpenClawTools,
} from "./openclaw-tools.registration.js";
import type { SandboxFsBridge } from "./sandbox/fs-bridge.js";
import type { SpawnedToolContext } from "./spawned-context.js";
import type { ToolFsPolicy } from "./tool-fs-policy.js";
import { normalizeToolName } from "./tool-policy.js";
import { createAgentsListTool } from "./tools/agents-list-tool.js";
import { createCanvasTool } from "./tools/canvas-tool.js";
import type { AnyAgentTool } from "./tools/common.js";
import { createCronTool } from "./tools/cron-tool.js";
import { createEmbeddedCallGateway } from "./tools/embedded-gateway-stub.js";
import { createGatewayTool } from "./tools/gateway-tool.js";
import { createImageGenerateTool } from "./tools/image-generate-tool.js";
import { createImageTool } from "./tools/image-tool.js";
import { createMessageTool } from "./tools/message-tool.js";
import { createMusicGenerateTool } from "./tools/music-generate-tool.js";
import { createNodesTool } from "./tools/nodes-tool.js";
import { createPdfTool } from "./tools/pdf-tool.js";
import { createSessionStatusTool } from "./tools/session-status-tool.js";
import { createSessionsHistoryTool } from "./tools/sessions-history-tool.js";
import { createSessionsListTool } from "./tools/sessions-list-tool.js";
import { createSessionsSendTool } from "./tools/sessions-send-tool.js";
import { createSessionsSpawnTool } from "./tools/sessions-spawn-tool.js";
import { createSessionsYieldTool } from "./tools/sessions-yield-tool.js";
import { createSubagentsTool } from "./tools/subagents-tool.js";
import { createTtsTool } from "./tools/tts-tool.js";
import { createUpdatePlanTool } from "./tools/update-plan-tool.js";
import { createVideoGenerateTool } from "./tools/video-generate-tool.js";
import { createWebFetchTool, createWebSearchTool } from "./tools/web-tools.js";
import { resolveWorkspaceRoot } from "./workspace-dir.js";

type OpenClawToolsDeps = {
  callGateway: typeof callGateway;
  config?: OpenClawConfig;
};

const defaultOpenClawToolsDeps: OpenClawToolsDeps = {
  callGateway,
};

let openClawToolsDeps: OpenClawToolsDeps = defaultOpenClawToolsDeps;

function normalizeToolAllowlist(toolAllowlist?: string[]): Set<string> | null {
  if (!toolAllowlist || toolAllowlist.length === 0) {
    return null;
  }
  const normalized = new Set(
    toolAllowlist.map((entry) => normalizeToolName(entry)).filter((entry) => entry.length > 0),
  );
  return normalized.size > 0 ? normalized : null;
}

function isRequestedTool(toolAllowlist: Set<string> | null, toolName: string): boolean {
  return toolAllowlist ? toolAllowlist.has(normalizeToolName(toolName)) : true;
}

type PreparedReusableToolSurface = {
  webSearchTool: AnyAgentTool | null;
  webFetchTool: AnyAgentTool | null;
  imageTool: AnyAgentTool | null;
  pdfTool: AnyAgentTool | null;
};

let preparedReusableToolSurfacesByConfig = new WeakMap<
  OpenClawConfig,
  Map<string, PreparedReusableToolSurface>
>();
const preparedReusableToolSurfacesWithoutConfig = new Map<string, PreparedReusableToolSurface>();
const reusableToolSurfaceObjectIdentityCache = new WeakMap<object, number>();
let nextReusableToolSurfaceObjectIdentity = 1;

function getReusableToolSurfaceObjectIdentity(value: object | undefined): number {
  if (!value) {
    return 0;
  }
  let cached = reusableToolSurfaceObjectIdentityCache.get(value);
  if (cached) {
    return cached;
  }
  cached = nextReusableToolSurfaceObjectIdentity++;
  reusableToolSurfaceObjectIdentityCache.set(value, cached);
  return cached;
}

function buildPreparedReusableToolSurfaceKey(params: {
  agentDir?: string;
  workspaceDir?: string;
  fsPolicy?: ToolFsPolicy;
  sandboxed?: boolean;
  sandboxRoot?: string;
  sandboxFsBridge?: SandboxFsBridge;
  modelHasVision?: boolean;
  runtimeWebTools: ReturnType<typeof getActiveRuntimeWebToolsMetadata>;
}): string {
  return JSON.stringify([
    params.agentDir ?? "",
    params.workspaceDir ?? "",
    params.fsPolicy?.workspaceOnly === true,
    params.sandboxed === true,
    params.sandboxRoot ?? "",
    getReusableToolSurfaceObjectIdentity(params.sandboxFsBridge),
    params.modelHasVision === true,
    params.runtimeWebTools?.search?.providerConfigured ?? "",
    params.runtimeWebTools?.search?.selectedProvider ?? "",
    params.runtimeWebTools?.fetch?.providerConfigured ?? "",
    params.runtimeWebTools?.fetch?.selectedProvider ?? "",
  ]);
}

function getPreparedReusableToolSurfaceCache(
  config?: OpenClawConfig,
): Map<string, PreparedReusableToolSurface> {
  if (!config) {
    return preparedReusableToolSurfacesWithoutConfig;
  }
  let cached = preparedReusableToolSurfacesByConfig.get(config);
  if (!cached) {
    cached = new Map<string, PreparedReusableToolSurface>();
    preparedReusableToolSurfacesByConfig.set(config, cached);
  }
  return cached;
}

function getOrCreatePreparedReusableToolSurface(params: {
  config?: OpenClawConfig;
  agentDir?: string;
  workspaceDir?: string;
  fsPolicy?: ToolFsPolicy;
  sandboxed?: boolean;
  sandboxRoot?: string;
  sandboxFsBridge?: SandboxFsBridge;
  modelHasVision?: boolean;
  runtimeWebTools: ReturnType<typeof getActiveRuntimeWebToolsMetadata>;
}): PreparedReusableToolSurface {
  // Full OpenClaw tool objects are not safe to cache across replies because some
  // constructors capture per-message routing or requester context. Reuse only the
  // stable heavy subset that depends on warmed agent/session config.
  const cache = getPreparedReusableToolSurfaceCache(params.config);
  const cacheKey = buildPreparedReusableToolSurfaceKey(params);
  const cached = cache.get(cacheKey);
  if (cached) {
    return cached;
  }
  const created = {
    webSearchTool: createWebSearchTool({
      config: params.config,
      sandboxed: params.sandboxed,
      runtimeWebSearch: params.runtimeWebTools?.search,
    }),
    webFetchTool: createWebFetchTool({
      config: params.config,
      sandboxed: params.sandboxed,
      runtimeWebFetch: params.runtimeWebTools?.fetch,
    }),
    imageTool: params.agentDir?.trim()
      ? createImageTool({
          config: params.config,
          agentDir: params.agentDir,
          workspaceDir: params.workspaceDir,
          sandbox:
            params.sandboxRoot && params.sandboxFsBridge
              ? {
                  root: params.sandboxRoot,
                  bridge: params.sandboxFsBridge,
                }
              : undefined,
          fsPolicy: params.fsPolicy,
          modelHasVision: params.modelHasVision,
        })
      : null,
    pdfTool: params.agentDir?.trim()
      ? createPdfTool({
          config: params.config,
          agentDir: params.agentDir,
          workspaceDir: params.workspaceDir,
          sandbox:
            params.sandboxRoot && params.sandboxFsBridge
              ? {
                  root: params.sandboxRoot,
                  bridge: params.sandboxFsBridge,
                }
              : undefined,
          fsPolicy: params.fsPolicy,
        })
      : null,
  } satisfies PreparedReusableToolSurface;
  cache.set(cacheKey, created);
  return created;
}

export function createOpenClawTools(
  options?: {
    sandboxBrowserBridgeUrl?: string;
    allowHostBrowserControl?: boolean;
    agentSessionKey?: string;
    agentChannel?: GatewayMessageChannel;
    agentAccountId?: string;
    /** Delivery target for topic/thread routing. */
    agentTo?: string;
    /** Thread/topic identifier for routing replies to the originating thread. */
    agentThreadId?: string | number;
    agentDir?: string;
    sandboxRoot?: string;
    sandboxContainerWorkdir?: string;
    sandboxFsBridge?: SandboxFsBridge;
    fsPolicy?: ToolFsPolicy;
    sandboxed?: boolean;
    config?: OpenClawConfig;
    pluginToolAllowlist?: string[];
    /** Current channel ID for auto-threading. */
    currentChannelId?: string;
    /** Current thread timestamp for auto-threading. */
    currentThreadTs?: string;
    /** Current inbound message id for action fallbacks. */
    currentMessageId?: string | number;
    /** Reply-to mode for auto-threading. */
    replyToMode?: "off" | "first" | "all" | "batched";
    /** Mutable ref to track if a reply was sent (for "first" mode). */
    hasRepliedRef?: { value: boolean };
    /** If true, the model has native vision capability */
    modelHasVision?: boolean;
    /** Active model provider for provider-specific tool gating. */
    modelProvider?: string;
    /** Active model id for provider/model-specific tool gating. */
    modelId?: string;
    /** If true, nodes action="invoke" can call media-returning commands directly. */
    allowMediaInvokeCommands?: boolean;
    /** Explicit agent ID override for cron/hook sessions. */
    requesterAgentIdOverride?: string;
    /** Restrict the cron tool to self-removing this active cron job. */
    cronSelfRemoveOnlyJobId?: string;
    /** Require explicit message targets (no implicit last-route sends). */
    requireExplicitMessageTarget?: boolean;
    /** If true, omit the message tool from the tool list. */
    disableMessageTool?: boolean;
    /** If true, skip plugin tool resolution and return only shipped core tools. */
    disablePluginTools?: boolean;
    /** Materialize only the named tools when the caller already has an explicit allowlist. */
    toolAllowlist?: string[];
    /** Trusted sender id from inbound context (not tool args). */
    requesterSenderId?: string | null;
    /** Whether the requesting sender is an owner. */
    senderIsOwner?: boolean;
    /** Ephemeral session UUID — regenerated on /new and /reset. */
    sessionId?: string;
    /**
     * Workspace directory to pass to spawned subagents for inheritance.
     * Defaults to workspaceDir. Use this to pass the actual agent workspace when the
     * session itself is running in a copied-workspace sandbox (`ro` or `none`) so
     * subagents inherit the real workspace path instead of the sandbox copy.
     */
    spawnWorkspaceDir?: string;
    /** Callback invoked when sessions_yield tool is called. */
    onYield?: (message: string) => Promise<void> | void;
    /** Allow plugin tools for this tool set to late-bind the gateway subagent. */
    allowGatewaySubagentBinding?: boolean;
  } & SpawnedToolContext,
): AnyAgentTool[] {
  const resolvedConfig = options?.config ?? openClawToolsDeps.config;
  const { sessionAgentId } = resolveSessionAgentIds({
    sessionKey: options?.agentSessionKey,
    config: resolvedConfig,
    agentId: options?.requesterAgentIdOverride,
  });
  // Fall back to the session agent workspace so plugin loading stays workspace-stable
  // even when a caller forgets to thread workspaceDir explicitly.
  const inferredWorkspaceDir =
    options?.workspaceDir || !resolvedConfig
      ? undefined
      : resolveAgentWorkspaceDir(resolvedConfig, sessionAgentId);
  const workspaceDir = resolveWorkspaceRoot(options?.workspaceDir ?? inferredWorkspaceDir);
  const spawnWorkspaceDir = resolveWorkspaceRoot(
    options?.spawnWorkspaceDir ?? options?.workspaceDir ?? inferredWorkspaceDir,
  );
  const deliveryContext = normalizeDeliveryContext({
    channel: options?.agentChannel,
    to: options?.agentTo,
    accountId: options?.agentAccountId,
    threadId: options?.agentThreadId,
  });
  const requestedToolNames = normalizeToolAllowlist(options?.toolAllowlist);
  const runtimeWebTools = getActiveRuntimeWebToolsMetadata();
  const sandbox =
    options?.sandboxRoot && options?.sandboxFsBridge
      ? { root: options.sandboxRoot, bridge: options.sandboxFsBridge }
      : undefined;
  const preparedReusableToolSurface = getOrCreatePreparedReusableToolSurface({
    config: options?.config,
    agentDir: options?.agentDir,
    workspaceDir,
    fsPolicy: options?.fsPolicy,
    sandboxed: options?.sandboxed,
    sandboxRoot: options?.sandboxRoot,
    sandboxFsBridge: options?.sandboxFsBridge,
    modelHasVision: options?.modelHasVision,
    runtimeWebTools,
  });
  const imageTool = isRequestedTool(requestedToolNames, "image")
    ? (preparedReusableToolSurface?.imageTool ??
      (options?.agentDir?.trim()
        ? createImageTool({
            config: options?.config,
            agentDir: options.agentDir,
            workspaceDir,
            sandbox,
            fsPolicy: options?.fsPolicy,
            modelHasVision: options?.modelHasVision,
          })
        : null))
    : null;
  const imageGenerateTool = isRequestedTool(requestedToolNames, "image_generate")
    ? createImageGenerateTool({
        config: options?.config,
        agentDir: options?.agentDir,
        workspaceDir,
        sandbox,
        fsPolicy: options?.fsPolicy,
      })
    : null;
  const videoGenerateTool = isRequestedTool(requestedToolNames, "video_generate")
    ? createVideoGenerateTool({
        config: options?.config,
        agentDir: options?.agentDir,
        agentSessionKey: options?.agentSessionKey,
        requesterOrigin: deliveryContext ?? undefined,
        workspaceDir,
        sandbox,
        fsPolicy: options?.fsPolicy,
      })
    : null;
  const musicGenerateTool = isRequestedTool(requestedToolNames, "music_generate")
    ? createMusicGenerateTool({
        config: options?.config,
        agentDir: options?.agentDir,
        agentSessionKey: options?.agentSessionKey,
        requesterOrigin: deliveryContext ?? undefined,
        workspaceDir,
        sandbox,
        fsPolicy: options?.fsPolicy,
      })
    : null;
  const pdfTool = isRequestedTool(requestedToolNames, "pdf")
    ? (preparedReusableToolSurface?.pdfTool ??
      (options?.agentDir?.trim()
        ? createPdfTool({
            config: options?.config,
            agentDir: options.agentDir,
            workspaceDir,
            sandbox,
            fsPolicy: options?.fsPolicy,
          })
        : null))
    : null;
  const webSearchTool = isRequestedTool(requestedToolNames, "web_search")
    ? (preparedReusableToolSurface?.webSearchTool ??
      createWebSearchTool({
        config: options?.config,
        sandboxed: options?.sandboxed,
        runtimeWebSearch: runtimeWebTools?.search,
      }))
    : null;
  const webFetchTool = isRequestedTool(requestedToolNames, "web_fetch")
    ? (preparedReusableToolSurface?.webFetchTool ??
      createWebFetchTool({
        config: options?.config,
        sandboxed: options?.sandboxed,
        runtimeWebFetch: runtimeWebTools?.fetch,
      }))
    : null;
  const messageTool =
    options?.disableMessageTool || !isRequestedTool(requestedToolNames, "message")
      ? null
      : createMessageTool({
          agentAccountId: options?.agentAccountId,
          agentSessionKey: options?.agentSessionKey,
          sessionId: options?.sessionId,
          config: options?.config,
          currentChannelId: options?.currentChannelId,
          currentChannelProvider: options?.agentChannel,
          currentThreadTs: options?.currentThreadTs,
          currentMessageId: options?.currentMessageId,
          replyToMode: options?.replyToMode,
          hasRepliedRef: options?.hasRepliedRef,
          sandboxRoot: options?.sandboxRoot,
          requireExplicitTarget: options?.requireExplicitMessageTarget,
          requesterSenderId: options?.requesterSenderId ?? undefined,
          senderIsOwner: options?.senderIsOwner,
        });
  const embedded = isEmbeddedMode();
  const nodesTool =
    !embedded && isRequestedTool(requestedToolNames, "nodes")
      ? applyNodesToolWorkspaceGuard(
          createNodesTool({
            agentSessionKey: options?.agentSessionKey,
            agentChannel: options?.agentChannel,
            agentAccountId: options?.agentAccountId,
            currentChannelId: options?.currentChannelId,
            currentThreadTs: options?.currentThreadTs,
            config: options?.config,
            modelHasVision: options?.modelHasVision,
            allowMediaInvokeCommands: options?.allowMediaInvokeCommands,
          }),
          {
            fsPolicy: options?.fsPolicy,
            sandboxContainerWorkdir: options?.sandboxContainerWorkdir,
            sandboxRoot: options?.sandboxRoot,
            workspaceDir,
          },
        )
      : null;
  const effectiveCallGateway = embedded
    ? createEmbeddedCallGateway()
    : openClawToolsDeps.callGateway;
  const tools: AnyAgentTool[] = [
    ...(embedded
      ? []
      : [
          ...(isRequestedTool(requestedToolNames, "canvas")
            ? [createCanvasTool({ config: options?.config })]
            : []),
          ...collectPresentOpenClawTools([nodesTool]),
          ...(isRequestedTool(requestedToolNames, "cron")
            ? [
                createCronTool({
                  agentSessionKey: options?.agentSessionKey,
                  currentDeliveryContext: {
                    channel: options?.agentChannel,
                    to: options?.currentChannelId ?? options?.agentTo,
                    accountId: options?.agentAccountId,
                    threadId: options?.currentThreadTs ?? options?.agentThreadId,
                  },
                  ...(options?.cronSelfRemoveOnlyJobId
                    ? { selfRemoveOnlyJobId: options.cronSelfRemoveOnlyJobId }
                    : {}),
                }),
              ]
            : []),
        ]),
    ...(!embedded && messageTool ? [messageTool] : []),
    ...(isRequestedTool(requestedToolNames, "tts")
      ? [
          createTtsTool({
            agentChannel: options?.agentChannel,
            config: resolvedConfig,
            agentId: sessionAgentId,
            agentAccountId: options?.agentAccountId,
          }),
        ]
      : []),
    ...collectPresentOpenClawTools([imageGenerateTool, musicGenerateTool, videoGenerateTool]),
    ...(embedded
      ? []
      : isRequestedTool(requestedToolNames, "gateway")
        ? [
            createGatewayTool({
              agentSessionKey: options?.agentSessionKey,
              config: options?.config,
            }),
          ]
        : []),
    ...(isRequestedTool(requestedToolNames, "agents_list")
      ? [
          createAgentsListTool({
            agentSessionKey: options?.agentSessionKey,
            requesterAgentIdOverride: options?.requesterAgentIdOverride,
          }),
        ]
      : []),
    ...(isUpdatePlanToolEnabledForOpenClawTools({
      config: resolvedConfig,
      agentSessionKey: options?.agentSessionKey,
      agentId: options?.requesterAgentIdOverride,
      modelProvider: options?.modelProvider,
      modelId: options?.modelId,
    })
      ? isRequestedTool(requestedToolNames, "update_plan")
        ? [createUpdatePlanTool()]
        : []
      : []),
    ...(isRequestedTool(requestedToolNames, "sessions_list")
      ? [
          createSessionsListTool({
            agentSessionKey: options?.agentSessionKey,
            sandboxed: options?.sandboxed,
            config: resolvedConfig,
            callGateway: effectiveCallGateway,
          }),
        ]
      : []),
    ...(isRequestedTool(requestedToolNames, "sessions_history")
      ? [
          createSessionsHistoryTool({
            agentSessionKey: options?.agentSessionKey,
            sandboxed: options?.sandboxed,
            config: resolvedConfig,
            callGateway: effectiveCallGateway,
          }),
        ]
      : []),
    ...(embedded
      ? []
      : [
          ...(isRequestedTool(requestedToolNames, "sessions_send")
            ? [
                createSessionsSendTool({
                  agentSessionKey: options?.agentSessionKey,
                  agentChannel: options?.agentChannel,
                  sandboxed: options?.sandboxed,
                  config: resolvedConfig,
                  callGateway: openClawToolsDeps.callGateway,
                }),
              ]
            : []),
          ...(isRequestedTool(requestedToolNames, "sessions_spawn")
            ? [
                createSessionsSpawnTool({
                  agentSessionKey: options?.agentSessionKey,
                  agentChannel: options?.agentChannel,
                  agentAccountId: options?.agentAccountId,
                  agentTo: options?.agentTo,
                  agentThreadId: options?.agentThreadId,
                  agentGroupId: options?.agentGroupId,
                  agentGroupChannel: options?.agentGroupChannel,
                  agentGroupSpace: options?.agentGroupSpace,
                  agentMemberRoleIds: options?.agentMemberRoleIds,
                  sandboxed: options?.sandboxed,
                  config: resolvedConfig,
                  requesterAgentIdOverride: options?.requesterAgentIdOverride,
                  workspaceDir: spawnWorkspaceDir,
                }),
              ]
            : []),
        ]),
    ...(isRequestedTool(requestedToolNames, "sessions_yield")
      ? [
          createSessionsYieldTool({
            sessionId: options?.sessionId,
            onYield: options?.onYield,
          }),
        ]
      : []),
    ...(isRequestedTool(requestedToolNames, "subagents")
      ? [
          createSubagentsTool({
            agentSessionKey: options?.agentSessionKey,
          }),
        ]
      : []),
    ...(isRequestedTool(requestedToolNames, "session_status")
      ? [
          createSessionStatusTool({
            agentSessionKey: options?.agentSessionKey,
            config: resolvedConfig,
            sandboxed: options?.sandboxed,
          }),
        ]
      : []),
    ...collectPresentOpenClawTools([webSearchTool, webFetchTool, imageTool, pdfTool]),
  ];

  if (options?.disablePluginTools) {
    return tools;
  }

  const wrappedPluginTools = resolveOpenClawPluginToolsForOptions({
    options,
    resolvedConfig,
    existingToolNames: new Set(tools.map((tool) => tool.name)),
  });

  return [...tools, ...wrappedPluginTools];
}

export const __testing = {
  setDepsForTest(overrides?: Partial<OpenClawToolsDeps>) {
    openClawToolsDeps = overrides
      ? {
          ...defaultOpenClawToolsDeps,
          ...overrides,
        }
      : defaultOpenClawToolsDeps;
  },
  resetPreparedReusableToolSurfaceCacheForTest() {
    preparedReusableToolSurfacesByConfig = new WeakMap<
      OpenClawConfig,
      Map<string, PreparedReusableToolSurface>
    >();
    preparedReusableToolSurfacesWithoutConfig.clear();
  },
};
