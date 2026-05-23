import type { ExecElevatedDefaults, ExecToolDefaults } from "../bash-tools.js";
import type { resolveSandboxContext } from "../sandbox.js";
import type { EmbeddedFullAccessBlockedReason, EmbeddedSandboxInfo } from "./types.js";

type EmbeddedFullAccessExecPolicy = Pick<ExecToolDefaults, "mode" | "security">;
type EmbeddedFullAccessHostPolicy = Pick<ExecToolDefaults, "security">;

function execPolicyBlocksFullAccess(params: {
  execPolicy?: EmbeddedFullAccessExecPolicy;
  hostPolicy?: EmbeddedFullAccessHostPolicy;
}): boolean {
  return (
    params.execPolicy?.mode === "deny" ||
    params.execPolicy?.security === "deny" ||
    params.hostPolicy?.security === "deny"
  );
}

export function resolveEmbeddedFullAccessState(params: {
  execElevated?: ExecElevatedDefaults;
  execPolicy?: EmbeddedFullAccessExecPolicy;
  hostPolicy?: EmbeddedFullAccessHostPolicy;
}): {
  available: boolean;
  blockedReason?: EmbeddedFullAccessBlockedReason;
} {
  if (execPolicyBlocksFullAccess(params)) {
    return {
      available: false,
      blockedReason: "host-policy",
    };
  }
  if (params.execElevated?.fullAccessAvailable === true) {
    return { available: true };
  }
  if (params.execElevated?.fullAccessAvailable === false) {
    return {
      available: false,
      blockedReason: params.execElevated.fullAccessBlockedReason ?? "host-policy",
    };
  }
  if (!params.execElevated?.enabled || !params.execElevated.allowed) {
    return {
      available: false,
      blockedReason: "host-policy",
    };
  }
  return { available: true };
}

export function buildEmbeddedSandboxInfo(
  sandbox?: Awaited<ReturnType<typeof resolveSandboxContext>>,
  execElevated?: ExecElevatedDefaults,
  execPolicy?: EmbeddedFullAccessExecPolicy,
  hostPolicy?: EmbeddedFullAccessHostPolicy,
): EmbeddedSandboxInfo | undefined {
  if (!sandbox?.enabled) {
    return undefined;
  }
  const elevatedConfigured = execElevated?.enabled === true;
  const elevatedAllowed = Boolean(execElevated?.enabled && execElevated.allowed);
  const fullAccess = resolveEmbeddedFullAccessState({
    execElevated,
    execPolicy,
    hostPolicy,
  });
  return {
    enabled: true,
    workspaceDir: sandbox.workspaceDir,
    containerWorkspaceDir: sandbox.containerWorkdir,
    workspaceAccess: sandbox.workspaceAccess,
    agentWorkspaceMount: sandbox.workspaceAccess === "ro" ? "/agent" : undefined,
    browserBridgeUrl: sandbox.browser?.bridgeUrl,
    hostBrowserAllowed: sandbox.browserAllowHostControl,
    ...(elevatedConfigured
      ? {
          elevated: {
            allowed: elevatedAllowed,
            defaultLevel: execElevated?.defaultLevel ?? "off",
            fullAccessAvailable: fullAccess.available,
            ...(fullAccess.blockedReason
              ? { fullAccessBlockedReason: fullAccess.blockedReason }
              : {}),
          },
        }
      : {}),
  };
}
