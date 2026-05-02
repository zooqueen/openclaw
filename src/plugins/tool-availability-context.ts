import type { OpenClawConfig } from "../config/types.js";
import {
  DEFAULT_AGENT_ID,
  normalizeAgentId,
  parseAgentSessionKey,
} from "../routing/session-key.js";
import type { JsonObject, JsonPrimitive, ToolAvailabilityContext } from "../tools/types.js";
import { hasManifestConfiguredValue } from "./manifest-tool-availability.js";

function listAgentEntries(cfg: OpenClawConfig) {
  const list = cfg.agents?.list;
  if (!Array.isArray(list)) {
    return [];
  }
  return list.filter((entry) => entry && typeof entry === "object");
}

function resolveDefaultAgentId(cfg: OpenClawConfig): string {
  const agents = listAgentEntries(cfg);
  if (agents.length === 0) {
    return DEFAULT_AGENT_ID;
  }
  const explicitDefault = agents.find((agent) => agent.default);
  return normalizeAgentId(explicitDefault?.id ?? agents[0]?.id);
}

function resolveRequestAgentId(params: {
  config: OpenClawConfig;
  agentId?: string;
  sessionKey?: string;
}): string {
  if (params.agentId?.trim()) {
    return normalizeAgentId(params.agentId);
  }
  const parsed = parseAgentSessionKey(params.sessionKey);
  if (parsed?.agentId) {
    return normalizeAgentId(parsed.agentId);
  }
  return resolveDefaultAgentId(params.config);
}

function resolveAgentMemorySearchEnabled(cfg: OpenClawConfig, agentId: string): boolean {
  const defaults = cfg.agents?.defaults?.memorySearch;
  const agent = listAgentEntries(cfg).find(
    (entry) => normalizeAgentId(entry.id) === normalizeAgentId(agentId),
  );
  return agent?.memorySearch?.enabled ?? defaults?.enabled ?? true;
}

function buildRequestFactValues(params: {
  config: OpenClawConfig;
  agentId?: string;
  sessionKey?: string;
}): Record<string, JsonPrimitive | undefined> {
  const agentId = resolveRequestAgentId(params);
  return {
    "agent.id": agentId,
    "agent.memorySearch.enabled": resolveAgentMemorySearchEnabled(params.config, agentId),
  };
}

export function buildPluginToolAvailabilityContext(params: {
  config: OpenClawConfig;
  env: NodeJS.ProcessEnv;
  enabledPluginIds: Iterable<string>;
  authProviderIds?: Iterable<string>;
  agentId?: string;
  sessionKey?: string;
}): ToolAvailabilityContext {
  return {
    ...(params.authProviderIds ? { authProviderIds: new Set(params.authProviderIds) } : {}),
    config: params.config as unknown as JsonObject,
    isConfigValueAvailable: ({ value }) =>
      hasManifestConfiguredValue({
        config: params.config,
        env: params.env,
        value,
      }),
    env: params.env,
    enabledPluginIds: new Set(params.enabledPluginIds),
    values: buildRequestFactValues({
      config: params.config,
      agentId: params.agentId,
      sessionKey: params.sessionKey,
    }),
  };
}
