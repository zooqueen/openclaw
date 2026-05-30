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

function createRecord(pluginId: string, toolNames: string[] = [`${pluginId}_tool`]) {
  return createPluginRecord({
    id: pluginId,
    name: pluginId,
    source: `/plugins/${pluginId}/index.js`,
    rootDir: `/plugins/${pluginId}`,
    origin: "global",
    enabled: true,
    configSchema: false,
    contracts: {
      tools: toolNames,
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
  it("runs plugin tool factories, prepare callbacks, and execute callbacks under the owning plugin scope", async () => {
    const pluginRegistry = createTestRegistry();
    const observed: Array<{
      phase: "factory" | "prepare" | "execute";
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
            prepareArguments(args) {
              const prepareScope = getPluginRuntimeGatewayRequestScope();
              observed.push({
                phase: "prepare",
                pluginId: prepareScope?.pluginId,
                pluginSource: prepareScope?.pluginSource,
              });
              return args as never;
            },
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
        await Promise.all(
          tools.map((tool) =>
            tool.execute(`call-${tool.name}`, tool.prepareArguments?.({}) ?? {}, undefined),
          ),
        );
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
        phase: "prepare",
        pluginId: "alpha",
        pluginSource: "/plugins/alpha/index.js",
      },
      {
        phase: "execute",
        pluginId: "alpha",
        pluginSource: "/plugins/alpha/index.js",
      },
      {
        phase: "prepare",
        pluginId: "beta",
        pluginSource: "/plugins/beta/index.js",
      },
      {
        phase: "execute",
        pluginId: "beta",
        pluginSource: "/plugins/beta/index.js",
      },
    ]);
  });

  it("wraps static tool prepare callbacks and restores the caller scope after errors", async () => {
    const pluginRegistry = createTestRegistry();
    const record = createRecord("static");
    const api = pluginRegistry.createApi(record, { config: {} as OpenClawConfig });
    const observed: Array<{
      phase: "prepare" | "execute";
      pluginId?: string;
      pluginSource?: string;
    }> = [];

    api.registerTool({
      name: "static_tool",
      label: "static tool",
      description: "static tool",
      parameters: TEST_PARAMETERS,
      prepareArguments() {
        const prepareScope = getPluginRuntimeGatewayRequestScope();
        observed.push({
          phase: "prepare",
          pluginId: prepareScope?.pluginId,
          pluginSource: prepareScope?.pluginSource,
        });
        throw new Error("invalid static tool args");
      },
      async execute() {
        const executeScope = getPluginRuntimeGatewayRequestScope();
        observed.push({
          phase: "execute",
          pluginId: executeScope?.pluginId,
          pluginSource: executeScope?.pluginSource,
        });
        return jsonResult({ pluginId: "static" });
      },
    });

    await withPluginRuntimeGatewayRequestScope(
      {
        pluginId: "outer",
        pluginSource: "/plugins/outer/index.js",
        isWebchatConnect: () => false,
      },
      async () => {
        const tool = requireTool(pluginRegistry.registry.tools[0]);
        expect(() => tool.prepareArguments?.({})).toThrow("invalid static tool args");
        expect(getPluginRuntimeGatewayRequestScope()).toMatchObject({
          pluginId: "outer",
          pluginSource: "/plugins/outer/index.js",
        });
        await tool.execute("call-static", {}, undefined);
        expect(getPluginRuntimeGatewayRequestScope()).toMatchObject({
          pluginId: "outer",
          pluginSource: "/plugins/outer/index.js",
        });
      },
    );

    expect(getPluginRuntimeGatewayRequestScope()).toBeUndefined();
    expect(observed).toEqual([
      {
        phase: "prepare",
        pluginId: "static",
        pluginSource: "/plugins/static/index.js",
      },
      {
        phase: "execute",
        pluginId: "static",
        pluginSource: "/plugins/static/index.js",
      },
    ]);
  });

  it("wraps every tool returned by an array factory", async () => {
    const pluginRegistry = createTestRegistry();
    const toolNames = ["array_first", "array_second"];
    const record = createRecord("array", toolNames);
    const api = pluginRegistry.createApi(record, { config: {} as OpenClawConfig });
    const observed: Array<{
      name: string;
      pluginId?: string;
      pluginSource?: string;
    }> = [];

    api.registerTool(
      () =>
        toolNames.map(
          (name): AnyAgentTool => ({
            name,
            label: name,
            description: name,
            parameters: TEST_PARAMETERS,
            async execute() {
              const executeScope = getPluginRuntimeGatewayRequestScope();
              observed.push({
                name,
                pluginId: executeScope?.pluginId,
                pluginSource: executeScope?.pluginSource,
              });
              return jsonResult({ name });
            },
          }),
        ),
      { names: toolNames },
    );

    await withPluginRuntimeGatewayRequestScope(
      {
        pluginId: "outer",
        pluginSource: "/plugins/outer/index.js",
        isWebchatConnect: () => false,
      },
      async () => {
        const resolved = pluginRegistry.registry.tools[0].factory({});
        if (!Array.isArray(resolved)) {
          throw new Error("expected array plugin tools");
        }
        await Promise.all(resolved.map((tool) => tool.execute(`call-${tool.name}`, {}, undefined)));
        expect(getPluginRuntimeGatewayRequestScope()).toMatchObject({
          pluginId: "outer",
          pluginSource: "/plugins/outer/index.js",
        });
      },
    );

    expect(observed).toEqual([
      {
        name: "array_first",
        pluginId: "array",
        pluginSource: "/plugins/array/index.js",
      },
      {
        name: "array_second",
        pluginId: "array",
        pluginSource: "/plugins/array/index.js",
      },
    ]);
  });
});
