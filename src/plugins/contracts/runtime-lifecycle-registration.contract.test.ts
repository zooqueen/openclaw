// Runtime lifecycle registration tests cover plugin-owned callback snapshotting.
import {
  createPluginRegistryFixture,
  registerTestPlugin,
} from "openclaw/plugin-sdk/plugin-test-contracts";
import { afterEach, describe, expect, it } from "vitest";
import { runPluginHostCleanup } from "../host-hook-cleanup.js";
import type { PluginRuntimeLifecycleRegistration } from "../host-hooks.js";
import { createEmptyPluginRegistry } from "../registry-empty.js";
import { setActivePluginRegistry } from "../runtime.js";
import { createPluginRecord } from "../status.test-helpers.js";

describe("plugin runtime lifecycle registration", () => {
  afterEach(() => {
    setActivePluginRegistry(createEmptyPluginRegistry());
  });

  it("snapshots cleanup callbacks before runtime cleanup", async () => {
    let cleanupReads = 0;
    const cleanupEvents: string[] = [];
    const { config, registry } = createPluginRegistryFixture();
    registerTestPlugin({
      registry,
      config,
      record: createPluginRecord({
        id: "volatile-runtime-lifecycle",
        name: "Volatile Runtime Lifecycle",
      }),
      register(api) {
        api.registerRuntimeLifecycle({
          id: "cleanup",
          description: "Cleanup callback",
          get cleanup() {
            cleanupReads += 1;
            if (cleanupReads > 1) {
              throw new Error("cleanup getter re-read");
            }
            return ({ reason }) => {
              cleanupEvents.push(reason);
            };
          },
        } as PluginRuntimeLifecycleRegistration);
      },
    });
    setActivePluginRegistry(registry.registry);

    expect(registry.registry.runtimeLifecycles?.[0]?.lifecycle.description).toBe(
      "Cleanup callback",
    );
    expect(cleanupReads).toBe(1);
    await expect(
      runPluginHostCleanup({
        registry: registry.registry,
        pluginId: "volatile-runtime-lifecycle",
        reason: "disable",
        sessionStorePaths: [],
      }),
    ).resolves.toEqual({ cleanupCount: 1, failures: [] });
    expect(cleanupEvents).toEqual(["disable"]);
    expect(cleanupReads).toBe(1);
  });
});
