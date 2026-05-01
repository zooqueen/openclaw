import { normalizeProviderId } from "../agents/provider-id.js";
import { createSubsystemLogger } from "../logging/subsystem.js";

export type ReplyRuntimeColdPathKind =
  | "runtime-plugin-registry"
  | "provider-runtime-activation"
  | "runtime-deps-install"
  | "model-catalog-discovery"
  | "provider-runtime-auth"
  | "public-artifact-runtime-deps";

const log = createSubsystemLogger("reply-runtime-readiness");

let replyCapableChannelsLive = false;
let runtimePluginRegistryPrepared = false;
const preparedProviderRuntimeIds = new Set<string>();
const preparedProviderRuntimeAuthIds = new Set<string>();
const warnedViolationKeys = new Set<string>();

function normalizeProviderKey(provider: string): string {
  return normalizeProviderId(provider) || provider.trim().toLowerCase();
}

export function markReplyCapableChannelsLive(): void {
  replyCapableChannelsLive = true;
}

export function markReplyRuntimePluginRegistryPrepared(): void {
  runtimePluginRegistryPrepared = true;
}

export function markReplyRuntimeProviderPrepared(provider: string): void {
  const normalized = normalizeProviderKey(provider);
  if (normalized) {
    preparedProviderRuntimeIds.add(normalized);
  }
}

export function markReplyRuntimeProviderAuthPrepared(provider: string): void {
  const normalized = normalizeProviderKey(provider);
  if (normalized) {
    preparedProviderRuntimeAuthIds.add(normalized);
  }
}

export function isReplyCapableChannelsLive(): boolean {
  return replyCapableChannelsLive;
}

export function isReplyRuntimePluginRegistryPrepared(): boolean {
  return runtimePluginRegistryPrepared;
}

export function isReplyRuntimeProviderPrepared(provider: string): boolean {
  const normalized = normalizeProviderKey(provider);
  return normalized ? preparedProviderRuntimeIds.has(normalized) : false;
}

export function isReplyRuntimeProviderAuthPrepared(provider: string): boolean {
  const normalized = normalizeProviderKey(provider);
  return normalized ? preparedProviderRuntimeAuthIds.has(normalized) : false;
}

export function logReplyRuntimeColdPathViolation(params: {
  kind: ReplyRuntimeColdPathKind;
  source: string;
  durationMs?: number;
  detail?: string;
}): void {
  if (!replyCapableChannelsLive) {
    return;
  }
  const source = params.source.trim() || "unknown";
  const detail = params.detail?.trim();
  const warningKey = [params.kind, source, detail ?? ""].join("::");
  if (warnedViolationKeys.has(warningKey)) {
    return;
  }
  warnedViolationKeys.add(warningKey);
  const durationMs =
    typeof params.durationMs === "number" && Number.isFinite(params.durationMs)
      ? Math.max(0, Math.round(params.durationMs))
      : undefined;
  const suffix = [
    `kind=${params.kind}`,
    `source=${source}`,
    ...(durationMs !== undefined ? [`durationMs=${durationMs}`] : []),
    ...(detail ? [detail] : []),
  ].join(" ");
  log.warn(`reply-runtime readiness violation: ${suffix}`);
}

export function resetReplyRuntimeReadinessMonitorForTest(): void {
  replyCapableChannelsLive = false;
  runtimePluginRegistryPrepared = false;
  preparedProviderRuntimeIds.clear();
  preparedProviderRuntimeAuthIds.clear();
  warnedViolationKeys.clear();
}
