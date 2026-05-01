import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const discoveredModels = new Map<string, Record<string, unknown>>();
  const discoverAuthStorage = vi.fn((agentDir?: string) => ({
    agentDir,
    setRuntimeApiKey: vi.fn(),
  }));
  const discoverModels = vi.fn((authStorage: unknown, agentDir: string) => ({
    authStorage,
    agentDir,
    find: vi.fn((provider: string, modelId: string) => {
      return discoveredModels.get(`${provider}/${modelId}`) ?? null;
    }),
    getAll: vi.fn(() => []),
    getAvailable: vi.fn(() => []),
  }));

  return {
    discoveredModels,
    discoverAuthStorage,
    discoverModels,
  };
});

vi.mock("../pi-model-discovery.js", () => ({
  discoverAuthStorage: mocks.discoverAuthStorage,
  discoverModels: mocks.discoverModels,
}));

vi.mock("../../plugins/provider-runtime.js", () => ({
  applyProviderResolvedModelCompatWithPlugins: () => undefined,
  applyProviderResolvedTransportWithPlugin: () => undefined,
  buildProviderUnknownModelHintWithPlugin: () => undefined,
  normalizeProviderResolvedModelWithPlugin: () => undefined,
  normalizeProviderTransportWithPlugin: () => undefined,
  prepareProviderDynamicModel: async () => {},
  runProviderDynamicModel: () => undefined,
  shouldPreferProviderRuntimeResolvedModel: () => false,
}));

import {
  preparePiDiscoveryStores,
  resetPreparedPiDiscoveryStoresCacheForTest,
  resetReplyRuntimeResolvedModelCacheForTest,
  resolveModelAsync,
} from "./model.js";

function buildConfig() {
  return {
    models: {
      providers: {
        custom: {
          api: "openai-completions",
          baseUrl: "http://localhost:9999",
          models: [
            { id: "alpha", name: "alpha" },
            { id: "beta", name: "beta" },
          ],
        },
      },
    },
  };
}

function buildModel(modelId: string) {
  return {
    id: modelId,
    name: modelId,
    provider: "custom",
    api: "openai-completions",
    baseUrl: "http://localhost:9999",
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 8192,
    maxTokens: 1024,
  };
}

describe("PI discovery store preparation", () => {
  beforeEach(() => {
    resetPreparedPiDiscoveryStoresCacheForTest();
    resetReplyRuntimeResolvedModelCacheForTest();
    mocks.discoveredModels.clear();
    mocks.discoveredModels.set("custom/alpha", buildModel("alpha"));
    mocks.discoveredModels.set("custom/beta", buildModel("beta"));
    mocks.discoverAuthStorage.mockClear();
    mocks.discoverModels.mockClear();
  });

  it("reuses prepared discovery stores after startup primes reply-time model resolution", async () => {
    const cfg = buildConfig();

    const first = await resolveModelAsync("custom", "alpha", "/tmp/agent-state", cfg, {
      primeReplyRuntimeCache: true,
    });

    expect(first.model?.id).toBe("alpha");
    expect(mocks.discoverAuthStorage).toHaveBeenCalledTimes(1);
    expect(mocks.discoverModels).toHaveBeenCalledTimes(1);

    const second = await resolveModelAsync("custom", "beta", "/tmp/agent-state", cfg);

    expect(second.model?.id).toBe("beta");
    expect(mocks.discoverAuthStorage).toHaveBeenCalledTimes(1);
    expect(mocks.discoverModels).toHaveBeenCalledTimes(1);
    expect(second.authStorage).toBe(first.authStorage);
    expect(second.modelRegistry).toBe(first.modelRegistry);
  });

  it("lets callers explicitly prepare stores for later resolveModelAsync reuse", async () => {
    const cfg = buildConfig();

    const prepared = preparePiDiscoveryStores("/tmp/agent-state");

    expect(mocks.discoverAuthStorage).toHaveBeenCalledTimes(1);
    expect(mocks.discoverModels).toHaveBeenCalledTimes(1);

    const result = await resolveModelAsync("custom", "alpha", "/tmp/agent-state", cfg);

    expect(result.model?.id).toBe("alpha");
    expect(mocks.discoverAuthStorage).toHaveBeenCalledTimes(1);
    expect(mocks.discoverModels).toHaveBeenCalledTimes(1);
    expect(result.authStorage).toBe(prepared.authStorage);
    expect(result.modelRegistry).toBe(prepared.modelRegistry);
  });

  it("keeps skipPiDiscovery preparation separate from full PI discovery stores", async () => {
    const cfg = buildConfig();

    const skipped = preparePiDiscoveryStores("/tmp/agent-state", {
      skipPiDiscovery: true,
    });

    expect(mocks.discoverAuthStorage).not.toHaveBeenCalled();
    expect(mocks.discoverModels).not.toHaveBeenCalled();

    const result = await resolveModelAsync("custom", "alpha", "/tmp/agent-state", cfg);

    expect(result.model?.id).toBe("alpha");
    expect(mocks.discoverAuthStorage).toHaveBeenCalledTimes(1);
    expect(mocks.discoverModels).toHaveBeenCalledTimes(1);
    expect(result.authStorage).not.toBe(skipped.authStorage);
    expect(result.modelRegistry).not.toBe(skipped.modelRegistry);
  });
});
