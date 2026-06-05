// Service registration tests cover plugin-owned lifecycle callback snapshotting.
import {
  createPluginRegistryFixture,
  registerTestPlugin,
} from "openclaw/plugin-sdk/plugin-test-contracts";
import { afterEach, describe, expect, it } from "vitest";
import type { OpenClawConfig } from "../../config/types.openclaw.js";
import { resetPluginRuntimeStateForTest } from "../runtime.js";
import { startPluginServices } from "../services.js";
import { createPluginRecord } from "../status.test-helpers.js";
import type { OpenClawPluginService, OpenClawPluginServiceContext } from "../types.js";

describe("plugin service registration", () => {
  afterEach(() => {
    resetPluginRuntimeStateForTest();
  });

  it("snapshots service fields before service startup", async () => {
    let idReads = 0;
    let startReads = 0;
    let stopReads = 0;
    const events: string[] = [];
    const contexts: OpenClawPluginServiceContext[] = [];
    const start: OpenClawPluginService["start"] = function (this: { marker?: string }, ctx) {
      events.push(`start:${this.marker ?? "missing"}`);
      contexts.push(ctx);
    };
    const stop: NonNullable<OpenClawPluginService["stop"]> = function (
      this: { marker?: string },
      ctx,
    ) {
      events.push(`stop:${this.marker ?? "missing"}`);
      contexts.push(ctx);
    };
    const { config, registry } = createPluginRegistryFixture();
    registerTestPlugin({
      registry,
      config,
      record: createPluginRecord({
        id: "volatile-service-plugin",
        name: "Volatile Service Plugin",
      }),
      register(api) {
        api.registerService({
          marker: "original",
          get id() {
            idReads += 1;
            if (idReads > 1) {
              throw new Error("service id getter re-read");
            }
            return " volatile-service ";
          },
          get start() {
            startReads += 1;
            if (startReads > 1) {
              throw new Error("service start getter re-read");
            }
            return start;
          },
          get stop() {
            stopReads += 1;
            if (stopReads > 1) {
              throw new Error("service stop getter re-read");
            }
            return stop;
          },
        } as OpenClawPluginService & { marker: string });
      },
    });

    const service = registry.registry.services[0]?.service;
    expect(service?.id).toBe("volatile-service");
    const handle = await startPluginServices({
      registry: registry.registry,
      config: {} as OpenClawConfig,
      workspaceDir: "workspace",
    });
    await handle.stop();

    expect(events).toEqual(["start:original", "stop:original"]);
    expect(contexts.map((ctx) => ctx.workspaceDir)).toEqual(["workspace", "workspace"]);
    expect(idReads).toBe(1);
    expect(startReads).toBe(1);
    expect(stopReads).toBe(1);
  });

  it("ignores same-plugin duplicate services before reading lifecycle handlers", () => {
    let duplicateStartReads = 0;
    let duplicateStopReads = 0;
    const { config, registry } = createPluginRegistryFixture();
    registerTestPlugin({
      registry,
      config,
      record: createPluginRecord({
        id: "duplicate-service-plugin",
        name: "Duplicate Service Plugin",
      }),
      register(api) {
        api.registerService({
          id: "duplicate-service",
          start: () => {},
        });
        api.registerService({
          id: "duplicate-service",
          get start() {
            duplicateStartReads += 1;
            throw new Error("duplicate start should not be read");
          },
          get stop() {
            duplicateStopReads += 1;
            throw new Error("duplicate stop should not be read");
          },
        } as OpenClawPluginService);
      },
    });

    expect(registry.registry.services).toHaveLength(1);
    expect(registry.registry.services[0]?.service.id).toBe("duplicate-service");
    expect(duplicateStartReads).toBe(0);
    expect(duplicateStopReads).toBe(0);
  });
});
