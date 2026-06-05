// Trusted tool policy registration tests cover plugin-owned evaluator snapshotting.
import {
  createPluginRegistryFixture,
  registerTestPlugin,
} from "openclaw/plugin-sdk/plugin-test-contracts";
import { afterEach, describe, expect, it } from "vitest";
import type { PluginTrustedToolPolicyRegistration } from "../host-hooks.js";
import { createEmptyPluginRegistry } from "../registry-empty.js";
import { setActivePluginRegistry } from "../runtime.js";
import { createPluginRecord } from "../status.test-helpers.js";
import { runTrustedToolPolicies } from "../trusted-tool-policy.js";

describe("plugin trusted tool policy registration", () => {
  afterEach(() => {
    setActivePluginRegistry(createEmptyPluginRegistry());
  });

  it("snapshots policy evaluators before trusted tool policy execution", async () => {
    let idReads = 0;
    let descriptionReads = 0;
    let evaluateReads = 0;
    const evaluatedTools: string[] = [];
    const { config, registry } = createPluginRegistryFixture();
    registerTestPlugin({
      registry,
      config,
      record: createPluginRecord({
        id: "volatile-trusted-policy",
        name: "Volatile Trusted Policy",
        origin: "bundled",
      }),
      register(api) {
        api.registerTrustedToolPolicy({
          get id() {
            idReads += 1;
            if (idReads > 1) {
              throw new Error("policy id getter re-read");
            }
            return "policy";
          },
          get description() {
            descriptionReads += 1;
            if (descriptionReads > 1) {
              throw new Error("policy description getter re-read");
            }
            return "Policy";
          },
          get evaluate() {
            evaluateReads += 1;
            if (evaluateReads > 1) {
              throw new Error("policy evaluate getter re-read");
            }
            return (event) => {
              evaluatedTools.push(event.toolName);
              return { block: true, blockReason: "blocked by stored policy" };
            };
          },
        } as PluginTrustedToolPolicyRegistration);
      },
    });
    setActivePluginRegistry(registry.registry);

    expect(registry.registry.trustedToolPolicies?.[0]?.policy.description).toBe("Policy");
    expect(idReads).toBe(1);
    expect(descriptionReads).toBe(1);
    expect(evaluateReads).toBe(1);

    await expect(
      runTrustedToolPolicies(
        { toolName: "dangerous_tool", params: {} },
        { toolName: "dangerous_tool" },
      ),
    ).resolves.toEqual({
      block: true,
      blockReason: "blocked by stored policy",
    });
    expect(evaluatedTools).toEqual(["dangerous_tool"]);
    expect(idReads).toBe(1);
    expect(descriptionReads).toBe(1);
    expect(evaluateReads).toBe(1);
  });
});
