import {
  listAgentIds,
  resolveAgentWorkspaceDir,
  resolveDefaultAgentId,
} from "../../agents/agent-scope.js";
import {
  listCoreToolSections,
  PROFILE_OPTIONS,
  resolveCoreToolProfiles,
} from "../../agents/tool-catalog.js";
import { summarizeToolDescriptionText } from "../../agents/tool-description-summary.js";
import { normalizeToolName } from "../../agents/tool-policy.js";
import type { OpenClawConfig } from "../../config/types.openclaw.js";
import { normalizePluginsConfig } from "../../plugins/config-state.js";
import {
  isManifestPluginAvailableForControlPlane,
  loadManifestContractSnapshot,
} from "../../plugins/manifest-contract-eligibility.js";
import { hasManifestToolAvailability } from "../../plugins/manifest-tool-availability.js";
import { getActivePluginRegistry } from "../../plugins/runtime.js";
import { normalizeOptionalString } from "../../shared/string-coerce.js";
import {
  ErrorCodes,
  errorShape,
  formatValidationErrors,
  type ToolsCatalogResult,
  validateToolsCatalogParams,
} from "../protocol/index.js";
import type { GatewayRequestHandlers, RespondFn } from "./types.js";

type ToolCatalogEntry = {
  id: string;
  label: string;
  description: string;
  source: "core" | "plugin";
  pluginId?: string;
  optional?: boolean;
  risk?: "low" | "medium" | "high";
  tags?: string[];
  defaultProfiles: Array<"minimal" | "coding" | "messaging" | "full">;
};

type ToolCatalogGroup = {
  id: string;
  label: string;
  source: "core" | "plugin";
  pluginId?: string;
  tools: ToolCatalogEntry[];
};

function resolveAgentIdOrRespondError(
  rawAgentId: unknown,
  respond: RespondFn,
  cfg: OpenClawConfig,
) {
  const knownAgents = listAgentIds(cfg);
  const requestedAgentId = normalizeOptionalString(rawAgentId) ?? "";
  const agentId = requestedAgentId || resolveDefaultAgentId(cfg);
  if (requestedAgentId && !knownAgents.includes(agentId)) {
    respond(
      false,
      undefined,
      errorShape(ErrorCodes.INVALID_REQUEST, `unknown agent id "${requestedAgentId}"`),
    );
    return null;
  }
  return { cfg, agentId };
}

function buildCoreGroups(): ToolCatalogGroup[] {
  return listCoreToolSections().map((section) => ({
    id: section.id,
    label: section.label,
    source: "core",
    tools: section.tools.map((tool) => ({
      id: tool.id,
      label: tool.label,
      description: tool.description,
      source: "core",
      defaultProfiles: resolveCoreToolProfiles(tool.id),
    })),
  }));
}

function buildPluginToolMetadataKey(pluginId: string, toolName: string): string {
  return JSON.stringify([pluginId, toolName]);
}

function buildActivePluginToolCatalogLookups() {
  const activeRegistry = getActivePluginRegistry();
  return {
    metadata: new Map(
      (activeRegistry?.toolMetadata ?? []).map((entry) => [
        buildPluginToolMetadataKey(entry.pluginId, entry.metadata.toolName),
        entry.metadata,
      ]),
    ),
    registrations: new Map(
      (activeRegistry?.tools ?? []).flatMap((entry) =>
        entry.names.map((name) => [buildPluginToolMetadataKey(entry.pluginId, name), entry]),
      ),
    ),
  };
}

function buildPluginGroups(params: {
  cfg: OpenClawConfig;
  agentId: string;
  existingToolNames: Set<string>;
}): ToolCatalogGroup[] {
  if (!normalizePluginsConfig(params.cfg.plugins).enabled) {
    return [];
  }
  const workspaceDir = resolveAgentWorkspaceDir(params.cfg, params.agentId);
  const snapshot = loadManifestContractSnapshot({
    config: params.cfg,
    workspaceDir,
    env: process.env,
  });
  const groups = new Map<string, ToolCatalogGroup>();
  // Key metadata by plugin ownership and tool name so we only project metadata that
  // was registered BY the tool's owning plugin. Without this scoping, plugin-X
  // could override the catalog label/description/risk/tags for another plugin's
  // tool by registering metadata with the same toolName.
  const activeRegistryLookups = buildActivePluginToolCatalogLookups();
  const existingNormalized = new Set(
    Array.from(params.existingToolNames, (tool) => normalizeToolName(tool)),
  );
  for (const plugin of snapshot.plugins) {
    if (
      !isManifestPluginAvailableForControlPlane({
        snapshot,
        plugin,
        config: params.cfg,
      })
    ) {
      continue;
    }
    const toolNames = plugin.contracts?.tools ?? [];
    if (toolNames.length === 0) {
      continue;
    }
    const pluginId = plugin.id;
    const groupId = `plugin:${pluginId}`;
    const existing =
      groups.get(groupId) ??
      ({
        id: groupId,
        label: pluginId,
        source: "plugin",
        pluginId,
        tools: [],
      } as ToolCatalogGroup);
    for (const toolName of toolNames) {
      if (existingNormalized.has(normalizeToolName(toolName))) {
        continue;
      }
      if (
        !hasManifestToolAvailability({
          plugin,
          toolNames: [toolName],
          config: params.cfg,
          env: process.env,
        })
      ) {
        continue;
      }
      const ownedMetadata = activeRegistryLookups.metadata.get(
        buildPluginToolMetadataKey(plugin.id, toolName),
      );
      const runtimeRegistration = activeRegistryLookups.registrations.get(
        buildPluginToolMetadataKey(plugin.id, toolName),
      );
      existing.tools.push({
        id: toolName,
        label: normalizeOptionalString(ownedMetadata?.displayName) ?? toolName,
        description: summarizeToolDescriptionText({
          rawDescription: ownedMetadata?.description ?? `Plugin tool provided by ${plugin.id}.`,
        }),
        source: "plugin",
        pluginId,
        optional: runtimeRegistration?.optional,
        risk: ownedMetadata?.risk,
        tags: ownedMetadata?.tags,
        defaultProfiles: [],
      });
      groups.set(groupId, existing);
    }
  }
  return [...groups.values()]
    .map((group) =>
      Object.assign({}, group, { tools: group.tools.toSorted((a, b) => a.id.localeCompare(b.id)) }),
    )
    .toSorted((a, b) => a.label.localeCompare(b.label));
}

export function buildToolsCatalogResult(params: {
  cfg: OpenClawConfig;
  agentId?: string;
  includePlugins?: boolean;
}): ToolsCatalogResult {
  const agentId = normalizeOptionalString(params.agentId) || resolveDefaultAgentId(params.cfg);
  const includePlugins = params.includePlugins !== false;
  const groups = buildCoreGroups();
  if (includePlugins) {
    const existingToolNames = new Set(
      groups.flatMap((group) => group.tools.map((tool) => tool.id)),
    );
    groups.push(
      ...buildPluginGroups({
        cfg: params.cfg,
        agentId,
        existingToolNames,
      }),
    );
  }
  return {
    agentId,
    profiles: PROFILE_OPTIONS.map((profile) => ({ id: profile.id, label: profile.label })),
    groups,
  };
}

export const toolsCatalogHandlers: GatewayRequestHandlers = {
  "tools.catalog": ({ params, respond, context }) => {
    if (!validateToolsCatalogParams(params)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid tools.catalog params: ${formatValidationErrors(validateToolsCatalogParams.errors)}`,
        ),
      );
      return;
    }
    const resolved = resolveAgentIdOrRespondError(
      params.agentId,
      respond,
      context.getRuntimeConfig(),
    );
    if (!resolved) {
      return;
    }
    respond(
      true,
      buildToolsCatalogResult({
        cfg: resolved.cfg,
        agentId: resolved.agentId,
        includePlugins: params.includePlugins,
      }),
      undefined,
    );
  },
};
