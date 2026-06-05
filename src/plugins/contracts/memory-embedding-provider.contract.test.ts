// Memory embedding provider contract tests cover memory plugin embedding provider behavior.
import {
  createPluginRegistryFixture,
  registerVirtualTestPlugin,
} from "openclaw/plugin-sdk/plugin-test-contracts";
import { describe, expect, it } from "vitest";
import {
  getRegisteredMemoryEmbeddingProvider,
  type MemoryEmbeddingProviderAdapter,
} from "../memory-embedding-providers.js";
import { createPluginRecord } from "../status.test-helpers.js";

describe("memory embedding provider registration", () => {
  it("rejects non-memory plugins that did not declare the capability contract", () => {
    const { config, registry } = createPluginRegistryFixture();

    registerVirtualTestPlugin({
      registry,
      config,
      id: "not-memory",
      name: "Not Memory",
      register(api) {
        api.registerMemoryEmbeddingProvider({
          id: "forbidden",
          create: async () => ({ provider: null }),
        });
      },
    });

    expect(getRegisteredMemoryEmbeddingProvider("forbidden")).toBeUndefined();
    const diagnostic = registry.registry.diagnostics.find(
      (entry) => entry.pluginId === "not-memory",
    );
    expect(diagnostic?.message).toBe(
      "plugin must own memory slot or declare contracts.memoryEmbeddingProviders for adapter: forbidden",
    );
  });

  it("allows non-memory plugins that declare the capability contract", () => {
    const { config, registry } = createPluginRegistryFixture();

    registerVirtualTestPlugin({
      registry,
      config,
      id: "external-vector",
      name: "External Vector",
      contracts: {
        memoryEmbeddingProviders: ["external-vector"],
      },
      register(api) {
        api.registerMemoryEmbeddingProvider({
          id: "external-vector",
          create: async () => ({ provider: null }),
        });
      },
    });

    const provider = getRegisteredMemoryEmbeddingProvider("external-vector");
    expect(provider?.adapter.id).toBe("external-vector");
    expect(provider?.ownerPluginId).toBe("external-vector");
  });

  it("skips inactive dual-kind memory adapters before reading adapter fields", () => {
    let idReads = 0;
    const { config, registry } = createPluginRegistryFixture();

    registerVirtualTestPlugin({
      registry,
      config,
      id: "inactive-dual-memory",
      name: "Inactive Dual Memory",
      kind: ["memory", "context-engine"],
      register(api) {
        api.registerMemoryEmbeddingProvider({
          get id() {
            idReads += 1;
            throw new Error("inactive memory embedding id getter read");
          },
          create: async () => ({ provider: null }),
        });
      },
    });

    expect(getRegisteredMemoryEmbeddingProvider("inactive-dual-memory")).toBeUndefined();
    expect(idReads).toBe(0);
    expect(registry.registry.diagnostics).toEqual([
      {
        pluginId: "inactive-dual-memory",
        level: "warn",
        source: "/virtual/inactive-dual-memory/index.ts",
        message:
          "dual-kind plugin not selected for memory slot; skipping memory embedding provider registration",
      },
    ]);
  });

  it("snapshots adapter fields before memory embedding runtime lookup", async () => {
    let idReads = 0;
    let defaultModelReads = 0;
    let createReads = 0;
    let shouldContinueReads = 0;
    const events: string[] = [];
    const { config, registry } = createPluginRegistryFixture();

    registerVirtualTestPlugin({
      registry,
      config,
      id: "volatile-memory-vector",
      name: "Volatile Memory Vector",
      contracts: {
        memoryEmbeddingProviders: ["volatile-memory-vector"],
      },
      register(api) {
        api.registerMemoryEmbeddingProvider({
          marker: "original",
          get id() {
            idReads += 1;
            if (idReads > 1) {
              throw new Error("memory embedding id getter re-read");
            }
            return " volatile-memory-vector ";
          },
          get defaultModel() {
            defaultModelReads += 1;
            if (defaultModelReads > 1) {
              throw new Error("memory embedding defaultModel getter re-read");
            }
            return "memory-model";
          },
          get create() {
            createReads += 1;
            if (createReads > 1) {
              throw new Error("memory embedding create getter re-read");
            }
            return async function (this: { marker?: string }) {
              events.push(`create:${this.marker ?? "missing"}`);
              return { provider: null };
            };
          },
          get shouldContinueAutoSelection() {
            shouldContinueReads += 1;
            if (shouldContinueReads > 1) {
              throw new Error("memory embedding shouldContinue getter re-read");
            }
            return function (this: { marker?: string }) {
              events.push(`continue:${this.marker ?? "missing"}`);
              return true;
            };
          },
        } as MemoryEmbeddingProviderAdapter & { marker: string });
      },
    });

    expect(registry.registry.diagnostics).toEqual([]);
    const provider = getRegisteredMemoryEmbeddingProvider("volatile-memory-vector");
    expect(provider?.adapter.defaultModel).toBe("memory-model");
    await expect(provider?.adapter.create({} as never)).resolves.toEqual({ provider: null });
    expect(provider?.adapter.shouldContinueAutoSelection?.(new Error("boom"))).toBe(true);
    expect(events).toEqual(["create:original", "continue:original"]);
    expect(idReads).toBe(1);
    expect(defaultModelReads).toBe(1);
    expect(createReads).toBe(1);
    expect(shouldContinueReads).toBe(1);
  });

  it("records the owning memory plugin id for registered adapters", () => {
    const { config, registry } = createPluginRegistryFixture();

    registerVirtualTestPlugin({
      registry,
      config,
      id: "memory-core",
      name: "Memory Core",
      kind: "memory",
      register(api) {
        api.registerMemoryEmbeddingProvider({
          id: "demo-embedding",
          create: async () => ({ provider: null }),
        });
      },
    });

    const provider = getRegisteredMemoryEmbeddingProvider("demo-embedding");
    expect(provider?.adapter.id).toBe("demo-embedding");
    expect(provider?.ownerPluginId).toBe("memory-core");
  });

  it("keeps companion embedding providers available during tool discovery", () => {
    const { config, registry } = createPluginRegistryFixture();
    const record = createPluginRecord({
      id: "tool-discovery-memory",
      name: "Tool Discovery Memory",
      kind: "memory",
      contracts: { tools: ["memory_recall"] },
    });
    registry.registry.plugins.push(record);
    const api = registry.createApi(record, {
      config,
      registrationMode: "tool-discovery",
    });

    api.registerMemoryEmbeddingProvider({
      id: "tool-discovery-embedding",
      create: async () => ({ provider: null }),
    });
    api.registerTool({
      name: "memory_recall",
      label: "Memory Recall",
      description: "Recall memory",
      parameters: {},
      execute: async () => ({ content: [], details: {} }),
    });

    const provider = getRegisteredMemoryEmbeddingProvider("tool-discovery-embedding");
    expect(provider?.adapter.id).toBe("tool-discovery-embedding");
    expect(provider?.ownerPluginId).toBe("tool-discovery-memory");
    expect(registry.registry.tools).toHaveLength(1);
    expect(registry.registry.tools[0]?.pluginId).toBe("tool-discovery-memory");
    expect(registry.registry.tools[0]?.names).toEqual(["memory_recall"]);
  });
});
