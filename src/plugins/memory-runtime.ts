import type { OpenClawConfig } from "../config/types.openclaw.js";
import { normalizePluginsConfig } from "./config-state.js";
import { resolveRuntimePluginRegistry } from "./loader.js";
import {
  getMemoryCapabilityRegistration,
  getMemoryRuntime,
  listActiveMemoryPublicArtifacts as listRegisteredMemoryPublicArtifacts,
} from "./memory-state.js";
import {
  buildPluginRuntimeLoadOptions,
  resolvePluginRuntimeLoadContext,
} from "./runtime/load-context.js";

function resolveMemoryRuntimePluginIds(config: OpenClawConfig): string[] {
  const memorySlot = normalizePluginsConfig(config.plugins).slots.memory;
  return typeof memorySlot === "string" && memorySlot.trim().length > 0 ? [memorySlot] : [];
}

function loadActiveMemorySlotPlugin(cfg: OpenClawConfig): void {
  const context = resolvePluginRuntimeLoadContext({ config: cfg });
  const onlyPluginIds = resolveMemoryRuntimePluginIds(context.config);
  if (onlyPluginIds.length === 0) {
    return;
  }
  resolveRuntimePluginRegistry(
    buildPluginRuntimeLoadOptions(context, {
      onlyPluginIds,
    }),
  );
}

function ensureMemoryRuntime(cfg?: OpenClawConfig) {
  const current = getMemoryRuntime();
  if (current || !cfg) {
    return current;
  }
  loadActiveMemorySlotPlugin(cfg);
  return getMemoryRuntime();
}

function ensureMemoryCapability(cfg?: OpenClawConfig) {
  const current = getMemoryCapabilityRegistration();
  if (current || !cfg) {
    return current;
  }
  loadActiveMemorySlotPlugin(cfg);
  return getMemoryCapabilityRegistration();
}

export async function getActiveMemorySearchManager(params: {
  cfg: OpenClawConfig;
  agentId: string;
  purpose?: "default" | "status";
}) {
  const runtime = ensureMemoryRuntime(params.cfg);
  if (!runtime) {
    return { manager: null, error: "memory plugin unavailable" };
  }
  return await runtime.getMemorySearchManager(params);
}

export function resolveActiveMemoryBackendConfig(params: { cfg: OpenClawConfig; agentId: string }) {
  return ensureMemoryRuntime(params.cfg)?.resolveMemoryBackendConfig(params) ?? null;
}

export async function closeActiveMemorySearchManagers(cfg?: OpenClawConfig): Promise<void> {
  void cfg;
  const runtime = getMemoryRuntime();
  await runtime?.closeAllMemorySearchManagers?.();
}

export async function listActiveMemoryPublicArtifacts(params: { cfg: OpenClawConfig }) {
  ensureMemoryCapability(params.cfg);
  return await listRegisteredMemoryPublicArtifacts(params);
}
