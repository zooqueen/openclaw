/** Generic user-flow planning contracts used by QA Lab and plugin-owned QA drivers. */

export const QA_USER_FLOW_SURFACES = [
  "messaging",
  "setup",
  "model",
  "tool",
  "approval",
  "memory",
  "media",
  "plugin",
  "recovery",
  "scheduling",
  "security",
  "workspace",
] as const;

export type QaUserFlowSurfaceId = (typeof QA_USER_FLOW_SURFACES)[number] | (string & {});

export type QaUserFlowContractFamily =
  | "agent-runtime"
  | "approval"
  | "channel"
  | "gateway"
  | "media"
  | "memory"
  | "plugin"
  | "provider"
  | "scheduler"
  | "security"
  | "setup"
  | "tool"
  | "workspace"
  | (string & {});

export type QaUserFlowActionDescriptor = {
  actor: "user" | "operator" | "system";
  object?: string;
  verb: string;
};

export type QaUserFlowContractRef = {
  family: QaUserFlowContractFamily;
  name: string;
};

export type QaUserFlowExecutionTarget =
  | "running-gateway"
  | "gateway-lab"
  | "contract-fixture"
  | "static-catalog"
  | (string & {});

export type QaUserFlowExecutionDescriptor = {
  runner: "qa-lab-flow" | "live-transport" | "contract-test" | "manual" | (string & {});
  target: QaUserFlowExecutionTarget;
};

export type QaUserFlowCapabilityDefinition<TCapabilityId extends string = string> = {
  contracts?: readonly QaUserFlowContractRef[];
  description: string;
  id: TCapabilityId;
  surface: QaUserFlowSurfaceId;
  title: string;
};

export type QaUserFlowDefinition<
  TId extends string = string,
  TCapabilityId extends string = string,
> = {
  action: QaUserFlowActionDescriptor;
  contracts?: readonly QaUserFlowContractRef[];
  description: string;
  execution: QaUserFlowExecutionDescriptor;
  id: TId;
  qaScenarioIds?: readonly string[];
  requiredCapabilities: readonly TCapabilityId[];
  surface: QaUserFlowSurfaceId;
  title: string;
};

export type QaUserFlowCapabilityMapping<TCapabilityId extends string = string> = {
  /** Plugin, runtime, or driver id that owns this optional flow mapping. */
  ownerId: string;
  /** Capability atoms this owner can prove for user-flow planning. */
  provides: readonly TCapabilityId[];
  /** Flow ids this owner has concrete driver coverage for. Omit when inferred by capabilities. */
  supportedFlowIds?: readonly string[];
};

export type QaUserFlowPlanEntry<TDefinition extends QaUserFlowDefinition> = TDefinition & {
  missingCapabilities: readonly TDefinition["requiredCapabilities"][number][];
};

export type QaUserFlowSkipReason =
  | "driver-not-implemented"
  | "missing-capability"
  | "not-requested";

export type QaUserFlowPlan<TDefinition extends QaUserFlowDefinition = QaUserFlowDefinition> = {
  selected: readonly TDefinition[];
  skipped: readonly (QaUserFlowPlanEntry<TDefinition> & {
    reason: QaUserFlowSkipReason;
  })[];
};

export const QA_USER_FLOW_STANDARD_CAPABILITIES = [
  {
    id: "messaging.inbound-message",
    title: "Receive message",
    description: "A user can send text into OpenClaw through a message surface.",
    surface: "messaging",
    contracts: [{ family: "channel", name: "base message ingress contract" }],
  },
  {
    id: "messaging.outbound-final-reply",
    title: "Send final reply",
    description: "OpenClaw can deliver the assistant's final answer back to the user.",
    surface: "messaging",
    contracts: [{ family: "channel", name: "outbound reply contract" }],
  },
  {
    id: "messaging.thread-reply",
    title: "Reply in thread",
    description: "Threaded user prompts preserve their reply context.",
    surface: "messaging",
    contracts: [{ family: "channel", name: "thread binding contract" }],
  },
  {
    id: "messaging.reaction-events",
    title: "Observe reactions",
    description: "Native reaction/edit/delete style events can be observed and normalized.",
    surface: "messaging",
    contracts: [{ family: "channel", name: "message actions contract" }],
  },
  {
    id: "messaging.mention-gating",
    title: "Gate unmentioned message",
    description: "A group message that does not address OpenClaw does not trigger a reply.",
    surface: "messaging",
    contracts: [{ family: "channel", name: "mention gating contract" }],
  },
  {
    id: "security.sender-allowlist",
    title: "Block unauthorized sender",
    description: "A sender outside the configured allowlist does not trigger a reply.",
    surface: "security",
    contracts: [{ family: "channel", name: "sender allowlist contract" }],
  },
  {
    id: "setup.native-help-command",
    title: "Handle native help command",
    description: "A user can ask the transport-specific command surface for help.",
    surface: "setup",
    contracts: [{ family: "channel", name: "native command contract" }],
  },
  {
    id: "setup.provider-auth",
    title: "Authenticate provider",
    description: "A user can connect provider credentials through setup or auth repair.",
    surface: "setup",
    contracts: [{ family: "provider", name: "provider auth contract" }],
  },
  {
    id: "setup.config-apply",
    title: "Apply configuration",
    description: "A config/setup change becomes active without corrupting runtime state.",
    surface: "setup",
    contracts: [{ family: "setup", name: "config mutation contract" }],
  },
  {
    id: "model.final-response",
    title: "Return model response",
    description: "A selected model can produce a final response for a user turn.",
    surface: "model",
    contracts: [{ family: "provider", name: "provider runtime contract" }],
  },
  {
    id: "model.switch",
    title: "Switch models",
    description: "A user can switch models and continue the same task coherently.",
    surface: "model",
    contracts: [{ family: "provider", name: "provider selection contract" }],
  },
  {
    id: "tool.call",
    title: "Call tool",
    description: "A user request can drive an OpenClaw tool call and continue to completion.",
    surface: "tool",
    contracts: [{ family: "tool", name: "tool runtime contract" }],
  },
  {
    id: "approval.native-roundtrip",
    title: "Approve action",
    description: "A user can approve or deny a pending action through a supported surface.",
    surface: "approval",
    contracts: [{ family: "approval", name: "approval runtime contract" }],
  },
  {
    id: "memory.store",
    title: "Store memory",
    description: "A user-visible fact can be committed to the configured memory surface.",
    surface: "memory",
    contracts: [{ family: "memory", name: "memory host contract" }],
  },
  {
    id: "memory.recall",
    title: "Recall memory",
    description: "A later user turn can recall relevant scoped memory.",
    surface: "memory",
    contracts: [{ family: "memory", name: "memory query contract" }],
  },
  {
    id: "media.image-input",
    title: "Understand image",
    description: "A user can attach an image and receive a grounded answer about it.",
    surface: "media",
    contracts: [{ family: "media", name: "media understanding contract" }],
  },
  {
    id: "plugin.lifecycle",
    title: "Load plugin",
    description: "A plugin can be installed, discovered, and made available to a user task.",
    surface: "plugin",
    contracts: [{ family: "plugin", name: "plugin registration contract" }],
  },
  {
    id: "recovery.restart-resume",
    title: "Resume after restart",
    description: "A user flow can continue after a runtime or gateway restart.",
    surface: "recovery",
    contracts: [{ family: "gateway", name: "restart recovery contract" }],
  },
  {
    id: "scheduling.reminder",
    title: "Deliver reminder",
    description: "A scheduled user reminder can be created and delivered once.",
    surface: "scheduling",
    contracts: [{ family: "scheduler", name: "scheduled task contract" }],
  },
  {
    id: "security.redaction",
    title: "Protect secret",
    description: "Secrets stay redacted in user-visible logs, traces, and tool output.",
    surface: "security",
    contracts: [{ family: "security", name: "secret redaction contract" }],
  },
  {
    id: "workspace.edit-loop",
    title: "Edit workspace",
    description: "A user can ask for workspace edits and receive a coherent completion report.",
    surface: "workspace",
    contracts: [{ family: "workspace", name: "workspace tool contract" }],
  },
] as const satisfies readonly QaUserFlowCapabilityDefinition[];

export type QaStandardUserFlowCapabilityId =
  (typeof QA_USER_FLOW_STANDARD_CAPABILITIES)[number]["id"];

export const QA_USER_FLOW_STANDARD_FLOWS = [
  {
    id: "messaging.direct-reply",
    title: "Direct message reply",
    description: "A user sends a message and receives a final answer on the same surface.",
    execution: { runner: "qa-lab-flow", target: "running-gateway" },
    surface: "messaging",
    action: { actor: "user", verb: "send", object: "message" },
    requiredCapabilities: ["messaging.inbound-message", "messaging.outbound-final-reply"],
    contracts: [{ family: "channel", name: "base channel plugin contract" }],
    qaScenarioIds: ["channel-chat-baseline", "dm-chat-baseline"],
  },
  {
    id: "messaging.thread-follow-up",
    title: "Thread follow-up",
    description: "A user follows up inside a thread and receives the answer in that context.",
    execution: { runner: "qa-lab-flow", target: "running-gateway" },
    surface: "messaging",
    action: { actor: "user", verb: "reply", object: "thread" },
    requiredCapabilities: ["messaging.inbound-message", "messaging.thread-reply"],
    contracts: [{ family: "channel", name: "thread binding contract" }],
    qaScenarioIds: ["thread-follow-up"],
  },
  {
    id: "messaging.reaction-edit-delete",
    title: "Message action observation",
    description: "A user edits, deletes, or reacts to a message and the transport observes it.",
    execution: { runner: "qa-lab-flow", target: "running-gateway" },
    surface: "messaging",
    action: { actor: "user", verb: "react", object: "message" },
    requiredCapabilities: ["messaging.reaction-events"],
    contracts: [{ family: "channel", name: "message actions contract" }],
    qaScenarioIds: ["reaction-edit-delete"],
  },
  {
    id: "messaging.mention-gating",
    title: "Mention gating",
    description: "A group user message that does not mention OpenClaw does not receive a reply.",
    execution: { runner: "live-transport", target: "running-gateway" },
    surface: "messaging",
    action: { actor: "user", verb: "send", object: "unmentioned group message" },
    requiredCapabilities: ["messaging.inbound-message", "messaging.mention-gating"],
    contracts: [{ family: "channel", name: "mention gating contract" }],
  },
  {
    id: "security.sender-allowlist-block",
    title: "Sender allowlist block",
    description: "A blocked user sends a message and receives no OpenClaw reply.",
    execution: { runner: "live-transport", target: "running-gateway" },
    surface: "security",
    action: { actor: "user", verb: "send", object: "blocked sender message" },
    requiredCapabilities: ["messaging.inbound-message", "security.sender-allowlist"],
    contracts: [{ family: "channel", name: "sender allowlist contract" }],
  },
  {
    id: "setup.native-help-command",
    title: "Native help command",
    description: "A user asks for help through the transport command surface and gets a reply.",
    execution: { runner: "live-transport", target: "running-gateway" },
    surface: "setup",
    action: { actor: "user", verb: "request", object: "native help command" },
    requiredCapabilities: [
      "messaging.inbound-message",
      "setup.native-help-command",
      "messaging.outbound-final-reply",
    ],
    contracts: [{ family: "channel", name: "native command contract" }],
  },
  {
    id: "setup.provider-auth",
    title: "Provider auth setup",
    description: "A user connects provider credentials and can use the provider afterward.",
    execution: { runner: "qa-lab-flow", target: "running-gateway" },
    surface: "setup",
    action: { actor: "user", verb: "connect", object: "provider" },
    requiredCapabilities: ["setup.provider-auth", "model.final-response"],
    contracts: [{ family: "provider", name: "provider auth contract" }],
    qaScenarioIds: ["anthropic-opus-api-key-smoke", "auth-profile-doctor-migration-safety"],
  },
  {
    id: "setup.config-hot-apply",
    title: "Config hot apply",
    description: "A user changes configuration and the runtime observes the new behavior.",
    execution: { runner: "qa-lab-flow", target: "running-gateway" },
    surface: "setup",
    action: { actor: "user", verb: "change", object: "configuration" },
    requiredCapabilities: ["setup.config-apply"],
    contracts: [{ family: "setup", name: "config mutation contract" }],
    qaScenarioIds: ["config-patch-hot-apply", "config-apply-restart-wakeup"],
  },
  {
    id: "model.switch-follow-up",
    title: "Model switch follow-up",
    description: "A user switches models and continues the task without losing context.",
    execution: { runner: "qa-lab-flow", target: "running-gateway" },
    surface: "model",
    action: { actor: "user", verb: "switch", object: "model" },
    requiredCapabilities: ["model.final-response", "model.switch"],
    contracts: [{ family: "provider", name: "provider selection contract" }],
    qaScenarioIds: ["model-switch-follow-up", "model-switch-tool-continuity"],
  },
  {
    id: "tool.call-followthrough",
    title: "Tool call follow-through",
    description: "A user asks for a tool-backed task and receives a final answer after the tool.",
    execution: { runner: "qa-lab-flow", target: "running-gateway" },
    surface: "tool",
    action: { actor: "user", verb: "request", object: "tool-backed task" },
    requiredCapabilities: ["tool.call", "model.final-response"],
    contracts: [{ family: "agent-runtime", name: "OpenClaw-owned tool runtime contract" }],
    qaScenarioIds: ["approval-turn-tool-followthrough", "message-tool"],
  },
  {
    id: "approval.native-roundtrip",
    title: "Approval roundtrip",
    description: "A user approves or denies a pending tool action and the run honors it.",
    execution: { runner: "qa-lab-flow", target: "running-gateway" },
    surface: "approval",
    action: { actor: "user", verb: "decide", object: "approval request" },
    requiredCapabilities: ["approval.native-roundtrip", "tool.call"],
    contracts: [{ family: "approval", name: "approval runtime contract" }],
    qaScenarioIds: ["approval-turn-tool-followthrough", "approval-denial-stop"],
  },
  {
    id: "memory.scoped-recall",
    title: "Scoped memory recall",
    description: "A user stores a fact and receives a later answer that recalls the right fact.",
    execution: { runner: "qa-lab-flow", target: "running-gateway" },
    surface: "memory",
    action: { actor: "user", verb: "ask", object: "remembered fact" },
    requiredCapabilities: ["memory.store", "memory.recall"],
    contracts: [{ family: "memory", name: "memory host/query contract" }],
    qaScenarioIds: ["memory-recall", "thread-memory-isolation"],
  },
  {
    id: "media.image-understanding",
    title: "Image understanding",
    description: "A user attaches an image and receives an answer grounded in the image.",
    execution: { runner: "qa-lab-flow", target: "running-gateway" },
    surface: "media",
    action: { actor: "user", verb: "attach", object: "image" },
    requiredCapabilities: ["media.image-input", "model.final-response"],
    contracts: [{ family: "media", name: "media understanding contract" }],
    qaScenarioIds: ["image-understanding-attachment"],
  },
  {
    id: "plugin.lifecycle-hot-reload",
    title: "Plugin lifecycle hot reload",
    description: "A user installs or updates a plugin and can use its newly available surface.",
    execution: { runner: "qa-lab-flow", target: "running-gateway" },
    surface: "plugin",
    action: { actor: "user", verb: "install", object: "plugin" },
    requiredCapabilities: ["plugin.lifecycle"],
    contracts: [{ family: "plugin", name: "plugin registration contract" }],
    qaScenarioIds: ["plugin-lifecycle-hot-reload", "mcp-plugin-tools-call"],
  },
  {
    id: "recovery.restart-resume",
    title: "Restart resume",
    description: "A user-visible run survives a gateway/runtime restart and completes.",
    execution: { runner: "qa-lab-flow", target: "running-gateway" },
    surface: "recovery",
    action: { actor: "system", verb: "restart", object: "gateway" },
    requiredCapabilities: ["recovery.restart-resume", "model.final-response"],
    contracts: [{ family: "gateway", name: "restart recovery contract" }],
    qaScenarioIds: ["gateway-restart-inflight-run"],
  },
  {
    id: "scheduling.reminder-roundtrip",
    title: "Reminder roundtrip",
    description: "A user creates a reminder and receives it exactly once at the expected time.",
    execution: { runner: "qa-lab-flow", target: "running-gateway" },
    surface: "scheduling",
    action: { actor: "user", verb: "schedule", object: "reminder" },
    requiredCapabilities: ["scheduling.reminder", "messaging.outbound-final-reply"],
    contracts: [{ family: "scheduler", name: "scheduled task contract" }],
    qaScenarioIds: ["reminder-roundtrip", "cron-single-run-no-duplicate"],
  },
  {
    id: "security.secret-redaction",
    title: "Secret redaction",
    description: "A user action that touches secrets does not leak them into visible evidence.",
    execution: { runner: "qa-lab-flow", target: "running-gateway" },
    surface: "security",
    action: { actor: "user", verb: "inspect", object: "diagnostics" },
    requiredCapabilities: ["security.redaction"],
    contracts: [{ family: "security", name: "secret redaction contract" }],
    qaScenarioIds: ["redaction-no-secret-leak", "secret-redaction-tool-logs"],
  },
  {
    id: "workspace.edit-loop",
    title: "Workspace edit loop",
    description: "A user asks for workspace changes and receives a coherent completion report.",
    execution: { runner: "jsonl-replay", target: "running-gateway" },
    surface: "workspace",
    action: { actor: "user", verb: "edit", object: "workspace" },
    requiredCapabilities: ["workspace.edit-loop", "tool.call"],
    contracts: [{ family: "workspace", name: "workspace tool contract" }],
  },
] as const satisfies readonly QaUserFlowDefinition<string, QaStandardUserFlowCapabilityId>[];

export type QaStandardUserFlowId = (typeof QA_USER_FLOW_STANDARD_FLOWS)[number]["id"];

const QA_USER_FLOW_STANDARD_ID_SET = new Set(QA_USER_FLOW_STANDARD_FLOWS.map((flow) => flow.id));

function assertKnownQaUserFlowIds<TDefinition extends QaUserFlowDefinition>(
  flows: readonly TDefinition[],
  ids: readonly string[],
) {
  const knownIds = new Set(flows.map((flow) => flow.id));
  for (const id of ids) {
    if (!knownIds.has(id)) {
      throw new Error(`unknown QA user flow id: ${id}`);
    }
  }
}

/** Collects unique capability atoms from optional plugin, runtime, or driver mappings. */
export function collectQaUserFlowCapabilities<TCapabilityId extends string>(
  mappings: readonly QaUserFlowCapabilityMapping<TCapabilityId>[],
) {
  const capabilities: TCapabilityId[] = [];
  const seen = new Set<TCapabilityId>();
  for (const mapping of mappings) {
    for (const capability of mapping.provides) {
      if (seen.has(capability)) {
        continue;
      }
      seen.add(capability);
      capabilities.push(capability);
    }
  }
  return capabilities;
}

/** Collects concrete flow ids from mappings that declare driver-backed support. */
export function collectQaUserFlowSupportedFlowIds(
  mappings: readonly QaUserFlowCapabilityMapping[],
) {
  const flowIds: string[] = [];
  const seen = new Set<string>();
  for (const mapping of mappings) {
    for (const flowId of mapping.supportedFlowIds ?? []) {
      if (seen.has(flowId)) {
        continue;
      }
      seen.add(flowId);
      flowIds.push(flowId);
    }
  }
  return flowIds;
}

/** Plans user-facing flows from capability mappings and optional driver support. */
export function planQaUserFlows<TDefinition extends QaUserFlowDefinition>(params: {
  availableCapabilities: readonly string[];
  driverSupportedFlowIds?: readonly string[];
  flows: readonly TDefinition[];
  requestedFlowIds?: readonly string[];
}): QaUserFlowPlan<TDefinition> {
  assertKnownQaUserFlowIds(params.flows, params.driverSupportedFlowIds ?? []);
  assertKnownQaUserFlowIds(params.flows, params.requestedFlowIds ?? []);

  const availableCapabilities = new Set(params.availableCapabilities);
  const driverSupportedFlowIds = params.driverSupportedFlowIds
    ? new Set(params.driverSupportedFlowIds)
    : null;
  const requestedFlowIds = params.requestedFlowIds ? new Set(params.requestedFlowIds) : null;

  const selected: TDefinition[] = [];
  const skipped: QaUserFlowPlan<TDefinition>["skipped"][number][] = [];

  for (const flow of params.flows) {
    const missingCapabilities = flow.requiredCapabilities.filter(
      (capability) => !availableCapabilities.has(capability),
    );
    const baseEntry = {
      ...flow,
      missingCapabilities,
    };

    if (requestedFlowIds && !requestedFlowIds.has(flow.id)) {
      skipped.push({ ...baseEntry, reason: "not-requested" });
      continue;
    }

    if (driverSupportedFlowIds && !driverSupportedFlowIds.has(flow.id)) {
      skipped.push({ ...baseEntry, reason: "driver-not-implemented" });
      continue;
    }

    if (missingCapabilities.length > 0) {
      skipped.push({ ...baseEntry, reason: "missing-capability" });
      continue;
    }

    selected.push(flow);
  }

  return { selected, skipped };
}

/** Plans the built-in standard user-flow catalog from optional owner mappings. */
export function planQaStandardUserFlows(params: {
  availableCapabilities?: readonly QaStandardUserFlowCapabilityId[];
  mappings?: readonly QaUserFlowCapabilityMapping<QaStandardUserFlowCapabilityId>[];
  requestedFlowIds?: readonly QaStandardUserFlowId[];
}) {
  const mappedCapabilities = params.mappings ? collectQaUserFlowCapabilities(params.mappings) : [];
  const mappedFlowIds = params.mappings ? collectQaUserFlowSupportedFlowIds(params.mappings) : [];
  const driverSupportedFlowIds = mappedFlowIds.length > 0 ? mappedFlowIds : undefined;
  return planQaUserFlows({
    flows: QA_USER_FLOW_STANDARD_FLOWS,
    availableCapabilities: [...mappedCapabilities, ...(params.availableCapabilities ?? [])],
    ...(driverSupportedFlowIds ? { driverSupportedFlowIds } : {}),
    ...(params.requestedFlowIds ? { requestedFlowIds: params.requestedFlowIds } : {}),
  });
}

/** Fails fast when caller-provided standard flow ids drift from the shared catalog. */
export function assertKnownQaStandardUserFlowIds(ids: readonly QaStandardUserFlowId[]) {
  for (const id of ids) {
    if (!QA_USER_FLOW_STANDARD_ID_SET.has(id)) {
      throw new Error(`unknown QA standard user flow id: ${id}`);
    }
  }
}
