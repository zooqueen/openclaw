import type { OpenClawConfig } from "../../config/types.openclaw.js";
import { resolveProviderAuthProfileId } from "../../plugins/provider-runtime.js";
import { resolveProcessScopedMap } from "../../shared/process-scoped-map.js";
import { ensureAuthProfileStore } from "../auth-profiles.js";
import type { AuthProfileStore } from "../auth-profiles/types.js";
import {
  resolvePreparedAuthProfileOrder,
  shouldPreferExplicitConfigApiKeyAuth,
} from "../model-auth.js";

const PREPARED_PI_RUN_BOOTSTRAP_STATE_CACHE_KEY = Symbol.for(
  "openclaw.preparedPiRunBootstrapStateCache",
);

export type PreparedPiRunBootstrapState = {
  authStore: AuthProfileStore;
  preparedPiProfileOrder: string[];
  preparedPiProviderOrderedProfiles: string[];
};

function getPreparedPiRunBootstrapStateCache() {
  return resolveProcessScopedMap<PreparedPiRunBootstrapState>(
    PREPARED_PI_RUN_BOOTSTRAP_STATE_CACHE_KEY,
  );
}

function buildPreparedPiRunBootstrapStateCacheKey(params: {
  config: OpenClawConfig;
  agentDir: string;
  workspaceDir: string;
  provider: string;
  modelId: string;
}): string {
  return JSON.stringify([params.agentDir, params.workspaceDir, params.provider, params.modelId]);
}

function createPreparedPiRunBootstrapState(params: {
  config: OpenClawConfig;
  agentDir: string;
  workspaceDir: string;
  provider: string;
  modelId: string;
}): PreparedPiRunBootstrapState {
  const authStore = ensureAuthProfileStore(params.agentDir, {
    allowKeychainPrompt: false,
  });
  if (shouldPreferExplicitConfigApiKeyAuth(params.config, params.provider)) {
    return {
      authStore,
      preparedPiProfileOrder: [],
      preparedPiProviderOrderedProfiles: [],
    };
  }
  const preparedPiProfileOrder = resolvePreparedAuthProfileOrder({
    cfg: params.config,
    store: authStore,
    provider: params.provider,
    agentDir: params.agentDir,
    workspaceDir: params.workspaceDir,
  });
  const providerPreferredProfileId = resolveProviderAuthProfileId({
    provider: params.provider,
    config: params.config,
    workspaceDir: params.workspaceDir,
    context: {
      config: params.config,
      agentDir: params.agentDir,
      workspaceDir: params.workspaceDir,
      provider: params.provider,
      modelId: params.modelId,
      preferredProfileId: undefined,
      lockedProfileId: undefined,
      profileOrder: preparedPiProfileOrder,
      authStore,
    },
  });
  const preparedPiProviderOrderedProfiles =
    providerPreferredProfileId && preparedPiProfileOrder.includes(providerPreferredProfileId)
      ? [
          providerPreferredProfileId,
          ...preparedPiProfileOrder.filter((profileId) => profileId !== providerPreferredProfileId),
        ]
      : preparedPiProfileOrder;
  return {
    authStore,
    preparedPiProfileOrder,
    preparedPiProviderOrderedProfiles,
  };
}

export function resetPreparedPiRunBootstrapStateCacheForTest(): void {
  getPreparedPiRunBootstrapStateCache().clear();
}

export function preparePreparedPiRunBootstrapState(params: {
  config?: OpenClawConfig;
  agentDir: string;
  workspaceDir: string;
  provider: string;
  modelId: string;
}): PreparedPiRunBootstrapState {
  const { config } = params;
  if (!config) {
    return {
      authStore: ensureAuthProfileStore(params.agentDir, {
        allowKeychainPrompt: false,
      }),
      preparedPiProfileOrder: [],
      preparedPiProviderOrderedProfiles: [],
    };
  }
  const resolvedParams = { ...params, config };
  const cacheKey = buildPreparedPiRunBootstrapStateCacheKey(resolvedParams);
  const cache = getPreparedPiRunBootstrapStateCache();
  const cached = cache.get(cacheKey);
  if (cached) {
    return cached;
  }
  const prepared = createPreparedPiRunBootstrapState(resolvedParams);
  cache.set(cacheKey, prepared);
  return prepared;
}

export function resolvePreparedPiRunBootstrapState(params: {
  config?: OpenClawConfig;
  agentDir: string;
  workspaceDir: string;
  provider: string;
  modelId: string;
}): PreparedPiRunBootstrapState {
  const { config } = params;
  if (!config) {
    return preparePreparedPiRunBootstrapState(params);
  }
  const resolvedParams = { ...params, config };
  const cacheKey = buildPreparedPiRunBootstrapStateCacheKey(resolvedParams);
  return (
    getPreparedPiRunBootstrapStateCache().get(cacheKey) ??
    preparePreparedPiRunBootstrapState(resolvedParams)
  );
}
