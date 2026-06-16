// Memory status collection for status scans.
// Runtime memory dependencies stay lazy so status paths without memory avoid loading the search manager.

import os from "node:os";
import path from "node:path";
import { resolveMemorySearchConfig } from "../agents/memory-search.js";
import { resolveStateDir } from "../config/paths.js";
import type { OpenClawConfig } from "../config/types.js";
import type { DoctorMemoryStatusPayload } from "../gateway/server-methods/doctor.js";
import { createLazyImportLoader } from "../shared/lazy-promise.js";
import type { getAgentLocalStatuses as getAgentLocalStatusesFn } from "./status.agent-local.js";
import {
  resolveSharedMemoryStatusSnapshot,
  type MemoryPluginStatus,
  type MemoryStatusSnapshot,
} from "./status.scan.shared.js";

const statusScanDepsRuntimeModuleLoader = createLazyImportLoader(
  () => import("./status.scan.deps.runtime.js"),
);
const gatewayCallModuleLoader = createLazyImportLoader(() => import("../gateway/call.js"));

function loadStatusScanDepsRuntimeModule() {
  return statusScanDepsRuntimeModuleLoader.load();
}

function loadGatewayCallModule() {
  return gatewayCallModuleLoader.load();
}

/** Returns the default on-disk memory store path for an agent. */
export function resolveDefaultMemoryStorePath(agentId: string): string {
  return path.join(resolveStateDir(process.env, os.homedir), "memory", `${agentId}.sqlite`);
}

/** Resolves memory index/cache status for the current status scan. */
export async function resolveStatusMemoryStatusSnapshot(params: {
  cfg: OpenClawConfig;
  agentStatus: Awaited<ReturnType<typeof getAgentLocalStatusesFn>>;
  memoryPlugin: MemoryPluginStatus;
  requireDefaultStore?: (agentId: string) => string;
  includeLocal?: boolean;
  gatewayReachable?: boolean;
  gatewayCallOverrides?: {
    url: string;
    token?: string;
    password?: string;
  };
}): Promise<MemoryStatusSnapshot | null> {
  if (!params.memoryPlugin.enabled || !params.memoryPlugin.slot) {
    return null;
  }
  if (params.includeLocal !== false) {
    const { getMemorySearchManager } = await loadStatusScanDepsRuntimeModule();
    const local = await resolveSharedMemoryStatusSnapshot({
      cfg: params.cfg,
      agentStatus: params.agentStatus,
      memoryPlugin: params.memoryPlugin,
      resolveMemoryConfig: resolveMemorySearchConfig,
      getMemorySearchManager,
      requireDefaultStore: params.requireDefaultStore,
    });
    if (local) {
      return local;
    }
  }
  return await resolveGatewayMemoryStatusSnapshot(params);
}

async function resolveGatewayMemoryStatusSnapshot(params: {
  cfg: OpenClawConfig;
  agentStatus: Awaited<ReturnType<typeof getAgentLocalStatusesFn>>;
  gatewayReachable?: boolean;
  gatewayCallOverrides?: {
    url: string;
    token?: string;
    password?: string;
  };
}): Promise<MemoryStatusSnapshot | null> {
  if (params.gatewayReachable !== true) {
    return null;
  }
  const agentId = params.agentStatus.defaultId ?? "main";
  const { callGateway } = await loadGatewayCallModule();
  const payload = await callGateway<DoctorMemoryStatusPayload>({
    config: params.cfg,
    method: "doctor.memory.status",
    params: { agentId, probe: false },
    timeoutMs: 2500,
    ...(params.gatewayCallOverrides ?? {}),
  }).catch(() => null);
  if (!payload?.runtime.ok) {
    return null;
  }
  return {
    agentId: payload.agentId || agentId,
    ...payload.runtime,
  };
}
