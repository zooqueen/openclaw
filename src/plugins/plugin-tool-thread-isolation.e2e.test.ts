import { describe, expect, it } from "vitest";
import { jsonResult, type AnyAgentTool } from "../agents/tools/common.js";
import type { OpenClawConfig } from "../config/types.openclaw.js";
import { createPluginRecord } from "./loader-records.js";
import { createPluginRegistry } from "./registry.js";
import {
  getPluginRuntimeGatewayRequestScope,
  withPluginRuntimeGatewayRequestScope,
} from "./runtime/gateway-request-scope.js";
import type { PluginRuntime } from "./runtime/types.js";

const TEST_PARAMETERS = {
  type: "object",
  additionalProperties: false,
  properties: {},
} as const;

function createTestRegistry() {
  return createPluginRegistry({
    logger: {
      info() {},
      warn() {},
      error() {},
      debug() {},
    },
    runtime: {} as PluginRuntime,
    activateGlobalSideEffects: false,
  });
}

function createRecord(pluginId: string) {
  return createPluginRecord({
    id: pluginId,
    name: pluginId,
    source: `/plugins/${pluginId}/index.js`,
    rootDir: `/plugins/${pluginId}`,
    origin: "global",
    enabled: true,
    configSchema: false,
    contracts: {
      tools: [`${pluginId}_tool`],
    },
  });
}

function requireTool(value: ReturnType<typeof createTestRegistry>["registry"]["tools"][number]) {
  const resolved = value.factory({});
  if (!resolved || Array.isArray(resolved)) {
    throw new Error("expected one plugin tool");
  }
  return resolved;
}

describe("plugin tool thread isolation", () => {
  it("runs plugin tool factories and execute callbacks under the owning plugin scope", async () => {
    const pluginRegistry = createTestRegistry();
    const observed: Array<{
      phase: "factory" | "execute";
      pluginId?: string;
      pluginSource?: string;
    }> = [];

    for (const pluginId of ["alpha", "beta"]) {
      const record = createRecord(pluginId);
      const api = pluginRegistry.createApi(record, { config: {} as OpenClawConfig });
      api.registerTool(
        () => {
          const factoryScope = getPluginRuntimeGatewayRequestScope();
          observed.push({
            phase: "factory",
            pluginId: factoryScope?.pluginId,
            pluginSource: factoryScope?.pluginSource,
          });
          return {
            name: `${pluginId}_tool`,
            label: `${pluginId} tool`,
            description: `${pluginId} tool`,
            parameters: TEST_PARAMETERS,
            async execute() {
              const executeScope = getPluginRuntimeGatewayRequestScope();
              observed.push({
                phase: "execute",
                pluginId: executeScope?.pluginId,
                pluginSource: executeScope?.pluginSource,
              });
              return jsonResult({ pluginId });
            },
          };
        },
        { name: `${pluginId}_tool` },
      );
    }

    await withPluginRuntimeGatewayRequestScope(
      {
        pluginId: "outer",
        pluginSource: "/plugins/outer/index.js",
        isWebchatConnect: () => false,
      },
      async () => {
        const tools = pluginRegistry.registry.tools.map(requireTool);
        await Promise.all(tools.map((tool) => tool.execute(`call-${tool.name}`, {}, undefined)));
        expect(getPluginRuntimeGatewayRequestScope()).toMatchObject({
          pluginId: "outer",
          pluginSource: "/plugins/outer/index.js",
        });
      },
    );

    expect(getPluginRuntimeGatewayRequestScope()).toBeUndefined();
    expect(observed).toEqual([
      {
        phase: "factory",
        pluginId: "alpha",
        pluginSource: "/plugins/alpha/index.js",
      },
      {
        phase: "factory",
        pluginId: "beta",
        pluginSource: "/plugins/beta/index.js",
      },
      {
        phase: "execute",
        pluginId: "alpha",
        pluginSource: "/plugins/alpha/index.js",
      },
      {
        phase: "execute",
        pluginId: "beta",
        pluginSource: "/plugins/beta/index.js",
      },
    ]);
  });
});
