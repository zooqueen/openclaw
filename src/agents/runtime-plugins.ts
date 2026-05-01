import type { OpenClawConfig } from "../config/types.openclaw.js";
import {
  isReplyCapableChannelsLive,
  isReplyRuntimePluginRegistryPrepared,
  logReplyRuntimeColdPathViolation,
} from "../gateway/reply-runtime-readiness-monitor.js";
import {
  resolveCompatibleRuntimePluginRegistry,
  resolveRuntimePluginRegistry,
} from "../plugins/loader.js";
import {
  getActivePluginRegistry,
  getActivePluginRegistryWorkspaceDir,
  getActivePluginRuntimeSubagentMode,
} from "../plugins/runtime.js";
import { resolveUserPath } from "../utils.js";

function hasReusableActiveGatewayRegistry(params: {
  workspaceDir?: string;
  allowGatewaySubagentBinding: boolean;
}): boolean {
  if (isReplyCapableChannelsLive()) {
    return false;
  }
  if (
    !params.allowGatewaySubagentBinding &&
    getActivePluginRuntimeSubagentMode() !== "gateway-bindable"
  ) {
    return false;
  }
  if (!getActivePluginRegistry()) {
    return false;
  }
  const activeWorkspaceDir = getActivePluginRegistryWorkspaceDir();
  if (!activeWorkspaceDir || !params.workspaceDir) {
    return activeWorkspaceDir === params.workspaceDir;
  }
  return resolveUserPath(activeWorkspaceDir) === params.workspaceDir;
}

export function ensureRuntimePluginsLoaded(params: {
  config?: OpenClawConfig;
  workspaceDir?: string | null;
  allowGatewaySubagentBinding?: boolean;
  source?: string;
}): void {
  const workspaceDir =
    typeof params.workspaceDir === "string" && params.workspaceDir.trim()
      ? resolveUserPath(params.workspaceDir)
      : undefined;
  const allowGatewaySubagentBinding =
    params.allowGatewaySubagentBinding === true ||
    getActivePluginRuntimeSubagentMode() === "gateway-bindable";
  const loadOptions = {
    config: params.config,
    workspaceDir,
    runtimeOptions: allowGatewaySubagentBinding
      ? {
          allowGatewaySubagentBinding: true,
        }
      : undefined,
  };
  if (resolveCompatibleRuntimePluginRegistry(loadOptions)) {
    return;
  }
  if (hasReusableActiveGatewayRegistry({ workspaceDir, allowGatewaySubagentBinding })) {
    return;
  }
  const shouldWarnLateColdLoad =
    isReplyCapableChannelsLive() && !isReplyRuntimePluginRegistryPrepared();
  const startedAt = shouldWarnLateColdLoad ? Date.now() : 0;
  resolveRuntimePluginRegistry(loadOptions);
  if (shouldWarnLateColdLoad) {
    logReplyRuntimeColdPathViolation({
      kind: "runtime-plugin-registry",
      source: params.source ?? "agents.runtime-plugins",
      durationMs: Date.now() - startedAt,
    });
  }
}
