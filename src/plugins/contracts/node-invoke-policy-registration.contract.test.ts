// Node invoke policy registration tests cover plugin-owned policy snapshotting.
import {
  createPluginRegistryFixture,
  registerTestPlugin,
} from "openclaw/plugin-sdk/plugin-test-contracts";
import { afterEach, describe, expect, it } from "vitest";
import type { OpenClawConfig } from "../../config/types.openclaw.js";
import {
  isForegroundRestrictedPluginNodeCommand,
  resolveNodeCommandAllowlist,
} from "../../gateway/node-command-policy.js";
import { resetPluginRuntimeStateForTest, setActivePluginRegistry } from "../runtime.js";
import { createPluginRecord } from "../status.test-helpers.js";
import type {
  OpenClawPluginNodeInvokePolicy,
  OpenClawPluginNodeInvokePolicyContext,
} from "../types.js";

describe("plugin node invoke policy registration", () => {
  afterEach(() => {
    resetPluginRuntimeStateForTest();
  });

  it("snapshots policy fields before node command policy projection", async () => {
    let commandsReads = 0;
    let defaultPlatformsReads = 0;
    let dangerousReads = 0;
    let foregroundRestrictedReads = 0;
    let handleReads = 0;
    const handler: OpenClawPluginNodeInvokePolicy["handle"] = (ctx) => ({
      ok: true,
      payload: ctx.command,
    });
    const { config, registry } = createPluginRegistryFixture();
    registerTestPlugin({
      registry,
      config,
      record: createPluginRecord({
        id: "volatile-node-policy",
        name: "Volatile Node Policy",
      }),
      register(api) {
        api.registerNodeInvokePolicy({
          get commands() {
            commandsReads += 1;
            if (commandsReads > 1) {
              throw new Error("policy commands getter re-read");
            }
            return [" volatile.snapshot ", "volatile.snapshot"];
          },
          get defaultPlatforms() {
            defaultPlatformsReads += 1;
            if (defaultPlatformsReads > 1) {
              throw new Error("policy defaultPlatforms getter re-read");
            }
            return ["ios", " ios ", "android"];
          },
          get dangerous() {
            dangerousReads += 1;
            if (dangerousReads > 1) {
              throw new Error("policy dangerous getter re-read");
            }
            return false;
          },
          get foregroundRestrictedOnIos() {
            foregroundRestrictedReads += 1;
            if (foregroundRestrictedReads > 1) {
              throw new Error("policy foregroundRestrictedOnIos getter re-read");
            }
            return true;
          },
          get handle() {
            handleReads += 1;
            if (handleReads > 1) {
              throw new Error("policy handle getter re-read");
            }
            return handler;
          },
        } as OpenClawPluginNodeInvokePolicy);
      },
    });
    setActivePluginRegistry(registry.registry);

    const policy = registry.registry.nodeInvokePolicies?.[0]?.policy;
    expect(policy).toMatchObject({
      commands: ["volatile.snapshot"],
      defaultPlatforms: ["ios", "android"],
      foregroundRestrictedOnIos: true,
    });
    expect(policy?.dangerous).toBeUndefined();
    expect(
      resolveNodeCommandAllowlist({} as OpenClawConfig, { platform: "ios" }).has(
        "volatile.snapshot",
      ),
    ).toBe(true);
    expect(isForegroundRestrictedPluginNodeCommand(" volatile.snapshot ")).toBe(true);
    expect(
      await Promise.resolve(
        policy?.handle({
          nodeId: "node-1",
          command: "volatile.snapshot",
          params: {},
          config: {} as OpenClawConfig,
          invokeNode: async () => ({ ok: true, payload: "raw", payloadJSON: null }),
        } satisfies OpenClawPluginNodeInvokePolicyContext),
      ),
    ).toEqual({ ok: true, payload: "volatile.snapshot" });

    expect(commandsReads).toBe(1);
    expect(defaultPlatformsReads).toBe(1);
    expect(dangerousReads).toBe(1);
    expect(foregroundRestrictedReads).toBe(1);
    expect(handleReads).toBe(1);
  });
});
