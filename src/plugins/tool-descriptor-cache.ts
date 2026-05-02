import fs from "node:fs";
import type { AnyAgentTool } from "../agents/tools/common.js";
import type { JsonObject, ToolDescriptor } from "../tools/types.js";

const PLUGIN_TOOL_DESCRIPTOR_CACHE_VERSION = 1;

export type CachedPluginToolDescriptor = {
  descriptor: ToolDescriptor;
  displaySummary?: string;
  ownerOnly?: boolean;
  optional: boolean;
};

const descriptorCache = new Map<string, CachedPluginToolDescriptor[]>();

export function resetPluginToolDescriptorCache(): void {
  descriptorCache.clear();
}

function sourceFingerprint(source: string): string {
  try {
    const stat = fs.statSync(source);
    return `${stat.size}:${Math.round(stat.mtimeMs)}`;
  } catch {
    return "missing";
  }
}

export function buildPluginToolDescriptorCacheKey(params: {
  pluginId: string;
  source: string;
  rootDir?: string;
  contractToolNames: readonly string[];
}): string {
  return JSON.stringify({
    version: PLUGIN_TOOL_DESCRIPTOR_CACHE_VERSION,
    pluginId: params.pluginId,
    source: params.source,
    rootDir: params.rootDir ?? null,
    sourceFingerprint: sourceFingerprint(params.source),
    contractToolNames: [...params.contractToolNames].toSorted(),
  });
}

function asJsonObject(value: unknown): JsonObject {
  return value as JsonObject;
}

export function capturePluginToolDescriptor(params: {
  pluginId: string;
  tool: AnyAgentTool;
  optional: boolean;
}): CachedPluginToolDescriptor {
  const label = (params.tool as { label?: unknown }).label;
  const title = typeof label === "string" && label.trim() ? label.trim() : undefined;
  return {
    ...(params.tool.displaySummary ? { displaySummary: params.tool.displaySummary } : {}),
    ...(params.tool.ownerOnly === true ? { ownerOnly: true } : {}),
    optional: params.optional,
    descriptor: {
      name: params.tool.name,
      ...(title ? { title } : {}),
      description: params.tool.description,
      inputSchema: asJsonObject(params.tool.parameters),
      owner: { kind: "plugin", pluginId: params.pluginId },
      executor: { kind: "plugin", pluginId: params.pluginId, toolName: params.tool.name },
    },
  };
}

export function readCachedPluginToolDescriptors(
  cacheKey: string,
): readonly CachedPluginToolDescriptor[] | undefined {
  return descriptorCache.get(cacheKey);
}

export function writeCachedPluginToolDescriptors(params: {
  cacheKey: string;
  descriptors: readonly CachedPluginToolDescriptor[];
}): void {
  descriptorCache.set(params.cacheKey, [...params.descriptors]);
}
