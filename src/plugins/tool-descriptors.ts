import type { JsonObject, ToolDescriptor } from "../tools/types.js";
import type { PluginManifestRecord } from "./manifest-registry.js";
import { normalizePluginToolNames } from "./tool-contracts.js";

export type PluginToolDescriptorManifestRecord = Pick<
  PluginManifestRecord,
  "contracts" | "id" | "toolMetadata"
>;

function asToolJsonObject(value: Record<string, unknown>): JsonObject {
  return value as JsonObject;
}

export function listPluginManifestToolDescriptors(
  plugin: PluginToolDescriptorManifestRecord,
): ToolDescriptor[] {
  const descriptors: ToolDescriptor[] = [];
  for (const toolName of normalizePluginToolNames(plugin.contracts?.tools)) {
    const metadata = plugin.toolMetadata?.[toolName];
    if (!metadata?.descriptor) {
      continue;
    }
    descriptors.push({
      name: toolName,
      ...(metadata.descriptor.title ? { title: metadata.descriptor.title } : {}),
      description: metadata.descriptor.description,
      inputSchema: asToolJsonObject(metadata.descriptor.inputSchema),
      ...(metadata.descriptor.outputSchema
        ? { outputSchema: asToolJsonObject(metadata.descriptor.outputSchema) }
        : {}),
      owner: { kind: "plugin", pluginId: plugin.id },
      executor: { kind: "plugin", pluginId: plugin.id, toolName },
      ...(metadata.descriptor.availability
        ? { availability: metadata.descriptor.availability }
        : {}),
      ...(metadata.descriptor.annotations
        ? { annotations: asToolJsonObject(metadata.descriptor.annotations) }
        : {}),
      ...(metadata.descriptor.sortKey ? { sortKey: metadata.descriptor.sortKey } : {}),
    });
  }
  return descriptors;
}

export function listMissingPluginManifestToolDescriptors(
  plugin: PluginToolDescriptorManifestRecord,
): string[] {
  return normalizePluginToolNames(plugin.contracts?.tools).filter(
    (toolName) => !plugin.toolMetadata?.[toolName]?.descriptor,
  );
}
