import {
  resolveAgentModelFallbackValues,
  resolveAgentModelPrimaryValue,
  resolveAgentModelTimeoutMsValue,
} from "../../config/model-input.js";
import type { AgentModelConfig } from "../../config/types.agents-shared.js";
import type { OpenClawConfig } from "../../config/types.openclaw.js";
import { resolveProcessScopedMap } from "../../shared/process-scoped-map.js";
import {
  externalCliDiscoveryForProviderAuth,
  ensureAuthProfileStore,
  hasAnyAuthProfileStoreSource,
  listProfilesForProvider,
} from "../auth-profiles.js";
import { DEFAULT_MODEL, DEFAULT_PROVIDER } from "../defaults.js";
import { resolveEnvApiKey } from "../model-auth.js";
import { resolveConfiguredModelRef } from "../model-selection.js";

export type ToolModelConfig = { primary?: string; fallbacks?: string[]; timeoutMs?: number };
const REPLY_RUNTIME_TOOL_PROVIDER_AUTH_CACHE_KEY = Symbol.for(
  "openclaw.replyRuntimeToolProviderAuthCache",
);

function getReplyRuntimeToolProviderAuthCache() {
  return resolveProcessScopedMap<boolean>(REPLY_RUNTIME_TOOL_PROVIDER_AUTH_CACHE_KEY);
}

function buildReplyRuntimeToolProviderAuthCacheKey(params: {
  provider: string;
  agentDir?: string;
}): string {
  return JSON.stringify([params.provider.trim().toLowerCase(), params.agentDir?.trim() || ""]);
}

export function hasToolModelConfig(model: ToolModelConfig | undefined): boolean {
  return Boolean(
    model?.primary?.trim() || (model?.fallbacks ?? []).some((entry) => entry.trim().length > 0),
  );
}

export function resolveDefaultModelRef(cfg?: OpenClawConfig): { provider: string; model: string } {
  if (cfg) {
    const resolved = resolveConfiguredModelRef({
      cfg,
      defaultProvider: DEFAULT_PROVIDER,
      defaultModel: DEFAULT_MODEL,
    });
    return { provider: resolved.provider, model: resolved.model };
  }
  return { provider: DEFAULT_PROVIDER, model: DEFAULT_MODEL };
}

export function hasAuthForProvider(params: { provider: string; agentDir?: string }): boolean {
  const cacheKey = buildReplyRuntimeToolProviderAuthCacheKey(params);
  const cache = getReplyRuntimeToolProviderAuthCache();
  const cached = cache.get(cacheKey);
  if (cached !== undefined) {
    return cached;
  }
  const cacheResolved = (value: boolean) => {
    cache.set(cacheKey, value);
    return value;
  };
  if (resolveEnvApiKey(params.provider)?.apiKey) {
    return cacheResolved(true);
  }
  const agentDir = params.agentDir?.trim();
  if (!agentDir) {
    return cacheResolved(false);
  }
  if (!hasAnyAuthProfileStoreSource(agentDir)) {
    return cacheResolved(false);
  }
  const store = ensureAuthProfileStore(agentDir, {
    externalCli: externalCliDiscoveryForProviderAuth({ provider: params.provider }),
  });
  return cacheResolved(listProfilesForProvider(store, params.provider).length > 0);
}

export function coerceToolModelConfig(model?: AgentModelConfig): ToolModelConfig {
  const primary = resolveAgentModelPrimaryValue(model);
  const fallbacks = resolveAgentModelFallbackValues(model);
  const timeoutMs = resolveAgentModelTimeoutMsValue(model);
  return {
    ...(primary?.trim() ? { primary: primary.trim() } : {}),
    ...(fallbacks.length > 0 ? { fallbacks } : {}),
    ...(timeoutMs !== undefined ? { timeoutMs } : {}),
  };
}

export function buildToolModelConfigFromCandidates(params: {
  explicit: ToolModelConfig;
  agentDir?: string;
  candidates: Array<string | null | undefined>;
  isProviderConfigured?: (provider: string) => boolean;
}): ToolModelConfig | null {
  if (hasToolModelConfig(params.explicit)) {
    return params.explicit;
  }

  const deduped: string[] = [];
  for (const candidate of params.candidates) {
    const trimmed = candidate?.trim();
    if (!trimmed || !trimmed.includes("/")) {
      continue;
    }
    const provider = trimmed.slice(0, trimmed.indexOf("/")).trim();
    const providerConfigured =
      params.isProviderConfigured?.(provider) ??
      hasAuthForProvider({ provider, agentDir: params.agentDir });
    if (!provider || !providerConfigured) {
      continue;
    }
    if (!deduped.includes(trimmed)) {
      deduped.push(trimmed);
    }
  }

  if (deduped.length === 0) {
    return null;
  }

  return {
    primary: deduped[0],
    ...(deduped.length > 1 ? { fallbacks: deduped.slice(1) } : {}),
    ...(params.explicit.timeoutMs !== undefined ? { timeoutMs: params.explicit.timeoutMs } : {}),
  };
}
