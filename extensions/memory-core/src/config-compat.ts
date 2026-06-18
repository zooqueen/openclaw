// Memory Core compatibility migration moves global dreaming settings into agent memory config.
import type { OpenClawConfig } from "openclaw/plugin-sdk/config-contracts";

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function mergeMissing(target: Record<string, unknown>, source: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(source)) {
    const existing = asRecord(target[key]);
    const nested = asRecord(value);
    if (existing && nested) {
      mergeMissing(existing, nested);
      continue;
    }
    if (!Object.hasOwn(target, key)) {
      target[key] = value;
    }
  }
}

function ensureMemoryCoreExtension(target: Record<string, unknown>): Record<string, unknown> {
  const memory = asRecord(target.memory) ?? {};
  target.memory = memory;
  const extensions = asRecord(memory.extensions) ?? {};
  memory.extensions = extensions;
  const core = asRecord(extensions["memory-core"]) ?? {};
  extensions["memory-core"] = core;
  return core;
}

function normalizePluginId(value: string): string {
  return value.trim().toLowerCase();
}

function resolveSelectedMemoryPluginConfig(
  config: OpenClawConfig,
): { pluginId: string; config: Record<string, unknown> } | undefined {
  const selectedId = config.plugins?.slots?.memory;
  if (
    typeof selectedId !== "string" ||
    !selectedId.trim() ||
    normalizePluginId(selectedId) === "none" ||
    normalizePluginId(selectedId) === "memory-core"
  ) {
    return undefined;
  }
  const entries = asRecord(config.plugins?.entries);
  for (const [pluginId, rawEntry] of Object.entries(entries ?? {})) {
    if (normalizePluginId(pluginId) !== normalizePluginId(selectedId)) {
      continue;
    }
    const pluginConfig = asRecord(asRecord(rawEntry)?.config);
    if (pluginConfig) {
      return { pluginId, config: pluginConfig };
    }
  }
  return undefined;
}

/** Moves legacy global dreaming config and agent dreaming flags to canonical memory extensions. */
export function migrateMemoryCoreLegacyConfig(config: OpenClawConfig): {
  config: OpenClawConfig;
  changes: string[];
} | null {
  const legacyPluginConfig = asRecord(config.plugins?.entries?.["memory-core"]?.config);
  const selectedMemoryPlugin = resolveSelectedMemoryPluginConfig(config);
  const selectedPluginDreaming = asRecord(selectedMemoryPlugin?.config.dreaming);
  const legacyAgentDreaming = (config.agents?.list ?? []).some(
    (agent) => asRecord(agent)?.dreaming !== undefined,
  );
  if (!legacyPluginConfig && !selectedPluginDreaming && !legacyAgentDreaming) {
    return null;
  }

  const next = structuredClone(config);
  const changes: string[] = [];
  if (legacyPluginConfig) {
    const plugins = asRecord(next.plugins) ?? {};
    next.plugins = plugins;
    const entries = asRecord(plugins.entries) ?? {};
    plugins.entries = entries;
    const entry = asRecord(entries["memory-core"]) ?? {};
    entries["memory-core"] = entry;
    const pluginConfig = asRecord(entry.config) ?? {};
    const agents = asRecord(next.agents) ?? {};
    next.agents = agents;
    const defaults = asRecord(agents.defaults) ?? {};
    agents.defaults = defaults;
    const core = ensureMemoryCoreExtension(defaults);
    if (Object.keys(core).length > 0) {
      mergeMissing(core, pluginConfig);
      changes.push(
        "Merged plugins.entries.memory-core.config → agents.defaults.memory.extensions.memory-core (kept explicit agent memory settings).",
      );
    } else {
      Object.assign(core, pluginConfig);
      changes.push(
        "Moved plugins.entries.memory-core.config → agents.defaults.memory.extensions.memory-core.",
      );
    }
    delete entry.config;
  }

  if (selectedPluginDreaming && selectedMemoryPlugin) {
    const selectedPluginConfig = resolveSelectedMemoryPluginConfig(next)?.config;
    if (!selectedPluginConfig) {
      throw new Error(
        `Cannot migrate dreaming config: missing selected memory plugin "${selectedMemoryPlugin.pluginId}".`,
      );
    }
    const agents = asRecord(next.agents) ?? {};
    next.agents = agents;
    const defaults = asRecord(agents.defaults) ?? {};
    agents.defaults = defaults;
    const core = ensureMemoryCoreExtension(defaults);
    const existingDreaming = asRecord(core.dreaming);
    if (existingDreaming) {
      mergeMissing(existingDreaming, selectedPluginDreaming);
      changes.push(
        `Merged plugins.entries.${selectedMemoryPlugin.pluginId}.config.dreaming → agents.defaults.memory.extensions.memory-core.dreaming (kept explicit core dreaming settings).`,
      );
    } else {
      core.dreaming = selectedPluginDreaming;
      changes.push(
        `Moved plugins.entries.${selectedMemoryPlugin.pluginId}.config.dreaming → agents.defaults.memory.extensions.memory-core.dreaming.`,
      );
    }
    delete selectedPluginConfig.dreaming;
  }

  const agents = asRecord(next.agents);
  if (Array.isArray(agents?.list)) {
    for (const [index, rawAgent] of agents.list.entries()) {
      const agent = asRecord(rawAgent);
      const dreaming = asRecord(agent?.dreaming);
      if (!agent || !dreaming) {
        continue;
      }
      const core = ensureMemoryCoreExtension(agent);
      const existingDreaming = asRecord(core.dreaming);
      if (existingDreaming) {
        mergeMissing(existingDreaming, dreaming);
      } else {
        core.dreaming = dreaming;
      }
      delete agent.dreaming;
      changes.push(
        `Moved agents.list.${index}.dreaming → agents.list.${index}.memory.extensions.memory-core.dreaming.`,
      );
    }
  }

  return { config: next, changes };
}
