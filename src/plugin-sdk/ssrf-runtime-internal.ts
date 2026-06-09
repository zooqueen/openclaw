// Private helper surface for bundled plugins with configured local IPC.
// Keep managed proxy bypass capabilities out of the public plugin SDK surface.
import { lookup as dnsLookup } from "node:dns/promises";
import { asNullableRecord } from "../../packages/normalization-core/src/record-coerce.js";
import { normalizeLowercaseStringOrEmpty } from "../../packages/normalization-core/src/string-coerce.js";
import { normalizeUniqueStringEntries } from "../../packages/normalization-core/src/string-normalization.js";
import { shouldUseConfiguredLocalOriginManagedProxyBypass } from "../infra/net/configured-local-origin-bypass.js";
import {
  fetchOperatorConfiguredEndpoint,
  type FetchWithResponseReleaseResult,
} from "../infra/net/egress-fetch.js";
import { normalizeHostname } from "../infra/net/hostname.js";
import { hasProxyEnvConfigured } from "../infra/net/proxy-env.js";
import { getActiveManagedProxyLoopbackMode } from "../infra/net/proxy/active-proxy-state.js";
import { registerManagedProxyBrowserCdpBypass } from "../infra/net/proxy/proxy-lifecycle.js";
import {
  closeDispatcher,
  createPinnedDispatcher,
  createPinnedLookup,
  isBlockedHostnameOrIp,
  isPrivateIpAddress,
  isPrivateNetworkAllowedByPolicy,
  matchesHostnameAllowlist,
  mergeSsrFPolicies,
  normalizeHostnameAllowlist,
  resolvePinnedHostname,
  resolvePinnedHostnameWithPolicy,
  resolveSsrFPolicyForUrl,
  SsrFBlockedError,
  ssrfPolicyFromHttpBaseUrlAllowedHostname,
  ssrfPolicyFromHttpBaseUrlAllowedOrigin,
  type LookupFn,
  type PinnedDispatcherPolicy,
  type SsrFPolicy,
} from "../infra/net/ssrf.js";
import type {
  ChannelDoctorConfigMutation,
  ChannelDoctorLegacyConfigRule,
} from "./channel-contract.js";
import type { OpenClawConfig } from "./config-runtime.js";

export {
  closeDispatcher,
  createPinnedDispatcher,
  createPinnedLookup,
  isBlockedHostnameOrIp,
  isPrivateIpAddress,
  isPrivateNetworkAllowedByPolicy,
  matchesHostnameAllowlist,
  mergeSsrFPolicies,
  registerManagedProxyBrowserCdpBypass,
  resolvePinnedHostname,
  resolvePinnedHostnameWithPolicy,
  resolveSsrFPolicyForUrl,
  SsrFBlockedError,
  ssrfPolicyFromHttpBaseUrlAllowedHostname,
  ssrfPolicyFromHttpBaseUrlAllowedOrigin,
};
export type { LookupFn, PinnedDispatcherPolicy, SsrFPolicy };

export type ConfiguredLocalOriginFetchOptions = {
  url: string;
  init?: RequestInit;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
  policy?: SsrFPolicy;
  lookupFn?: LookupFn;
  configuredLocalOriginBaseUrl: string;
  auditContext?: string;
};

export function isPrivateOrLoopbackHost(hostname: string): boolean {
  return isBlockedHostnameOrIp(hostname);
}

/** Accepted bundled-channel config shapes that opt into private-network HTTP targets. */
export type PrivateNetworkOptInInput =
  | boolean
  | null
  | undefined
  | Pick<SsrFPolicy, "allowPrivateNetwork" | "dangerouslyAllowPrivateNetwork">
  | {
      /** Canonical explicit opt-in for private/internal network targets. */
      dangerouslyAllowPrivateNetwork?: boolean | null;
      /** @deprecated Compatibility alias; prefer dangerouslyAllowPrivateNetwork. */
      allowPrivateNetwork?: boolean | null;
      /** Nested channel config shape used by current plugin network settings. */
      network?:
        | Pick<SsrFPolicy, "allowPrivateNetwork" | "dangerouslyAllowPrivateNetwork">
        | null
        | undefined;
    };

/** Reads current and legacy private-network opt-in shapes from bundled channel config. */
export function isPrivateNetworkOptInEnabled(input: PrivateNetworkOptInInput): boolean {
  if (input === true) {
    return true;
  }
  const record = asNullableRecord(input);
  if (!record) {
    return false;
  }
  const network = asNullableRecord(record.network);
  return (
    record.allowPrivateNetwork === true ||
    record.dangerouslyAllowPrivateNetwork === true ||
    network?.allowPrivateNetwork === true ||
    network?.dangerouslyAllowPrivateNetwork === true
  );
}

/** Converts channel private-network opt-in config into the shared internal policy shape. */
export function ssrfPolicyFromPrivateNetworkOptIn(
  input: PrivateNetworkOptInInput,
): SsrFPolicy | undefined {
  return isPrivateNetworkOptInEnabled(input) ? { allowPrivateNetwork: true } : undefined;
}

/** Compatibility wrapper for callers that already use the canonical dangerous flag name. */
export function ssrfPolicyFromDangerouslyAllowPrivateNetwork(
  dangerouslyAllowPrivateNetwork: boolean | null | undefined,
): SsrFPolicy | undefined {
  return ssrfPolicyFromPrivateNetworkOptIn(dangerouslyAllowPrivateNetwork);
}

/** Detects the retired flat `allowPrivateNetwork` key before doctor migration. */
export function hasLegacyFlatAllowPrivateNetworkAlias(value: unknown): boolean {
  const entry = asNullableRecord(value);
  return Boolean(entry && Object.hasOwn(entry, "allowPrivateNetwork"));
}

/** Moves flat private-network config into `network.dangerouslyAllowPrivateNetwork`. */
export function migrateLegacyFlatAllowPrivateNetworkAlias(params: {
  entry: Record<string, unknown>;
  pathPrefix: string;
  changes: string[];
}): { entry: Record<string, unknown>; changed: boolean } {
  if (!hasLegacyFlatAllowPrivateNetworkAlias(params.entry)) {
    return { entry: params.entry, changed: false };
  }

  const legacyAllowPrivateNetwork = params.entry.allowPrivateNetwork;
  const currentNetworkRecord = asNullableRecord(params.entry.network);
  const currentNetwork = currentNetworkRecord ? { ...currentNetworkRecord } : {};
  const currentDangerousAllowPrivateNetwork = currentNetwork.dangerouslyAllowPrivateNetwork;

  let resolvedDangerousAllowPrivateNetwork: unknown = currentDangerousAllowPrivateNetwork;
  if (typeof currentDangerousAllowPrivateNetwork === "boolean") {
    // The canonical key wins when both shapes are present.
    resolvedDangerousAllowPrivateNetwork = currentDangerousAllowPrivateNetwork;
  } else if (typeof legacyAllowPrivateNetwork === "boolean") {
    resolvedDangerousAllowPrivateNetwork = legacyAllowPrivateNetwork;
  } else if (currentDangerousAllowPrivateNetwork === undefined) {
    resolvedDangerousAllowPrivateNetwork = legacyAllowPrivateNetwork;
  }

  delete currentNetwork.dangerouslyAllowPrivateNetwork;
  if (resolvedDangerousAllowPrivateNetwork !== undefined) {
    currentNetwork.dangerouslyAllowPrivateNetwork = resolvedDangerousAllowPrivateNetwork;
  }

  const nextEntry = { ...params.entry };
  delete nextEntry.allowPrivateNetwork;
  if (Object.keys(currentNetwork).length > 0) {
    nextEntry.network = currentNetwork;
  } else {
    delete nextEntry.network;
  }

  params.changes.push(
    `Moved ${params.pathPrefix}.allowPrivateNetwork → ${params.pathPrefix}.network.dangerouslyAllowPrivateNetwork (${String(resolvedDangerousAllowPrivateNetwork)}).`,
  );
  return { entry: nextEntry, changed: true };
}

function hasLegacyAllowPrivateNetworkInAccounts(value: unknown): boolean {
  const accounts = asNullableRecord(value);
  return Boolean(
    accounts &&
      Object.values(accounts).some((account) =>
        hasLegacyFlatAllowPrivateNetworkAlias(asNullableRecord(account) ?? {}),
      ),
  );
}

/** Build doctor rules that migrate legacy private-network aliases for one bundled channel. */
export function createLegacyPrivateNetworkDoctorContract(params: { channelKey: string }): {
  legacyConfigRules: ChannelDoctorLegacyConfigRule[];
  normalizeCompatibilityConfig: (params: { cfg: OpenClawConfig }) => ChannelDoctorConfigMutation;
} {
  const pathPrefix = `channels.${params.channelKey}`;
  return {
    legacyConfigRules: [
      {
        path: ["channels", params.channelKey],
        message: `${pathPrefix}.allowPrivateNetwork is legacy; use ${pathPrefix}.network.dangerouslyAllowPrivateNetwork instead. Run "openclaw doctor --fix".`,
        match: (value) => hasLegacyFlatAllowPrivateNetworkAlias(asNullableRecord(value) ?? {}),
      },
      {
        path: ["channels", params.channelKey, "accounts"],
        message: `${pathPrefix}.accounts.<id>.allowPrivateNetwork is legacy; use ${pathPrefix}.accounts.<id>.network.dangerouslyAllowPrivateNetwork instead. Run "openclaw doctor --fix".`,
        match: hasLegacyAllowPrivateNetworkInAccounts,
      },
    ],
    normalizeCompatibilityConfig: ({ cfg }) => {
      const channels = asNullableRecord(cfg.channels);
      const channelEntry = asNullableRecord(channels?.[params.channelKey]);
      if (!channelEntry) {
        return { config: cfg, changes: [] };
      }

      const changes: string[] = [];
      let updatedChannel = channelEntry;
      let changed = false;

      const topLevel = migrateLegacyFlatAllowPrivateNetworkAlias({
        entry: updatedChannel,
        pathPrefix,
        changes,
      });
      updatedChannel = topLevel.entry;
      changed = changed || topLevel.changed;

      const accounts = asNullableRecord(updatedChannel.accounts);
      if (accounts) {
        let accountsChanged = false;
        const nextAccounts: Record<string, unknown> = { ...accounts };
        for (const [accountId, accountValue] of Object.entries(accounts)) {
          const account = asNullableRecord(accountValue);
          if (!account) {
            continue;
          }
          const migrated = migrateLegacyFlatAllowPrivateNetworkAlias({
            entry: account,
            pathPrefix: `${pathPrefix}.accounts.${accountId}`,
            changes,
          });
          if (!migrated.changed) {
            continue;
          }
          nextAccounts[accountId] = migrated.entry;
          accountsChanged = true;
        }
        if (accountsChanged) {
          updatedChannel = { ...updatedChannel, accounts: nextAccounts };
          changed = true;
        }
      }

      if (!changed) {
        return { config: cfg, changes: [] };
      }

      return {
        config: {
          ...cfg,
          channels: {
            ...cfg.channels,
            [params.channelKey]: updatedChannel,
          } as OpenClawConfig["channels"],
        },
        changes,
      };
    },
  };
}

/** @deprecated Use `ssrfPolicyFromDangerouslyAllowPrivateNetwork`. */
export function ssrfPolicyFromAllowPrivateNetwork(
  allowPrivateNetwork: boolean | null | undefined,
): SsrFPolicy | undefined {
  return ssrfPolicyFromDangerouslyAllowPrivateNetwork(allowPrivateNetwork);
}

/** Allows cleartext HTTP only when the target is loopback/private or DNS-pins to private IPs. */
export async function assertHttpUrlTargetsPrivateNetwork(
  url: string,
  params: {
    dangerouslyAllowPrivateNetwork?: boolean | null;
    allowPrivateNetwork?: boolean | null;
    lookupFn?: LookupFn;
    errorMessage?: string;
  } = {},
): Promise<void> {
  const parsed = new URL(url);
  if (parsed.protocol !== "http:") {
    return;
  }

  const errorMessage =
    params.errorMessage ?? "HTTP URL must target a trusted private/internal host";
  const { hostname } = parsed;
  if (!hostname) {
    throw new Error(errorMessage);
  }

  // Literal loopback/private hosts can stay local without DNS.
  if (isBlockedHostnameOrIp(hostname)) {
    return;
  }

  const allowPrivateNetwork =
    typeof params.dangerouslyAllowPrivateNetwork === "boolean"
      ? params.dangerouslyAllowPrivateNetwork
      : params.allowPrivateNetwork;

  if (allowPrivateNetwork !== true) {
    throw new Error(errorMessage);
  }

  // Private-network opt-in is for trusted private/internal targets, not a
  // blanket exemption for cleartext public internet hosts.
  const pinned = await resolvePinnedHostnameWithPolicy(hostname, {
    lookupFn: params.lookupFn,
    policy: ssrfPolicyFromDangerouslyAllowPrivateNetwork(true),
  });
  if (!pinned.addresses.every((address) => isPrivateIpAddress(address))) {
    throw new Error(errorMessage);
  }
}

function normalizeHostnameSuffix(value: string): string {
  const trimmed = normalizeLowercaseStringOrEmpty(value);
  if (!trimmed) {
    return "";
  }
  if (trimmed === "*" || trimmed === "*.") {
    return "*";
  }
  const withoutWildcard = trimmed.replace(/^\*\.?/, "");
  const withoutLeadingDot = withoutWildcard.replace(/^\.+/, "");
  return withoutLeadingDot.replace(/\.+$/, "");
}

function isHostnameAllowedBySuffixAllowlist(
  hostname: string,
  allowlist: readonly string[],
): boolean {
  if (allowlist.includes("*")) {
    return true;
  }
  const normalized = normalizeLowercaseStringOrEmpty(hostname);
  return allowlist.some((entry) => normalized === entry || normalized.endsWith(`.${entry}`));
}

/** Normalize suffix-style host allowlists into lowercase canonical entries with wildcard collapse. */
export function normalizeHostnameSuffixAllowlist(
  input?: readonly string[],
  defaults?: readonly string[],
): string[] {
  const source = input && input.length > 0 ? input : defaults;
  if (!source || source.length === 0) {
    return [];
  }
  const normalized = normalizeUniqueStringEntries(source.map(normalizeHostnameSuffix));
  if (normalized.includes("*")) {
    return ["*"];
  }
  return normalized;
}

/** Check whether a URL is HTTPS and its hostname matches the normalized suffix allowlist. */
export function isHttpsUrlAllowedByHostnameSuffixAllowlist(
  url: string,
  allowlist: readonly string[],
): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") {
      return false;
    }
    return isHostnameAllowedBySuffixAllowlist(parsed.hostname, allowlist);
  } catch {
    return false;
  }
}

/** Converts suffix-style host allowlists into internal hostname allowlist policy patterns. */
export function buildHostnameAllowlistPolicyFromSuffixAllowlist(
  allowHosts?: readonly string[],
): SsrFPolicy | undefined {
  const normalizedAllowHosts = normalizeHostnameSuffixAllowlist(allowHosts);
  if (normalizedAllowHosts.length === 0) {
    return undefined;
  }
  const patterns = new Set<string>();
  for (const normalized of normalizedAllowHosts) {
    if (normalized === "*") {
      return undefined;
    }
    patterns.add(normalized);
    patterns.add(`*.${normalized}`);
  }

  if (patterns.size === 0) {
    return undefined;
  }
  return { hostnameAllowlist: Array.from(patterns) };
}

function normalizePolicyOrigin(value: string): string | undefined {
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return undefined;
    }
    parsed.hostname = parsed.hostname.replace(/\.+$/, "");
    return parsed.origin.toLowerCase();
  } catch {
    return undefined;
  }
}

function assertConfiguredLocalOriginUrlAllowed(url: URL, policy?: SsrFPolicy): void {
  const hostnameAllowlist = normalizeHostnameAllowlist([
    ...(policy?.allowedHostnames ?? []),
    ...(policy?.hostnameAllowlist ?? []),
  ]);
  const allowedOrigins = (policy?.allowedOrigins ?? [])
    .map((origin) => normalizePolicyOrigin(origin))
    .filter((origin): origin is string => Boolean(origin));
  if (hostnameAllowlist.length === 0 && allowedOrigins.length === 0) {
    return;
  }
  const hostname = normalizeHostname(url.hostname);
  const origin = normalizePolicyOrigin(url.toString());
  const hostAllowed =
    hostnameAllowlist.length > 0 && matchesHostnameAllowlist(hostname, hostnameAllowlist);
  const originAllowed = origin ? allowedOrigins.includes(origin) : false;
  if (!hostAllowed && !originAllowed) {
    throw new Error(`Blocked hostname (not in allowlist): ${url.hostname}`);
  }
}

async function resolveLookupAddresses(
  hostname: string,
  lookupFn: LookupFn,
): Promise<readonly string[]> {
  const results = await lookupFn(hostname, { all: true });
  const records = Array.isArray(results) ? results : [results];
  return records.map((record) => record.address);
}

async function resolveConfiguredLocalOriginDispatcherPolicy(params: {
  url: URL;
  baseUrl: string;
  lookupFn?: LookupFn;
}): Promise<PinnedDispatcherPolicy | undefined> {
  if (getActiveManagedProxyLoopbackMode() === undefined || !hasProxyEnvConfigured()) {
    return undefined;
  }
  const resolvedAddresses = await resolveLookupAddresses(
    params.url.hostname,
    params.lookupFn ?? dnsLookup,
  );
  return shouldUseConfiguredLocalOriginManagedProxyBypass({
    url: params.url,
    managedProxyBypass: {
      kind: "configured-local-origin",
      baseUrl: params.baseUrl,
    },
    resolvedAddresses,
  })
    ? { mode: "direct" }
    : { mode: "env-proxy" };
}

export async function fetchConfiguredLocalOriginWithEgressPolicy(
  params: ConfiguredLocalOriginFetchOptions,
): Promise<FetchWithResponseReleaseResult> {
  return await fetchOperatorConfiguredEndpoint({
    url: params.url,
    init: params.init,
    signal: params.signal,
    fetchImpl: params.fetchImpl,
    operation: params.auditContext ?? "configured-local-origin-fetch",
    validateUrl: (url) => {
      assertConfiguredLocalOriginUrlAllowed(url, params.policy);
    },
    dispatcherPolicy: async (url) =>
      await resolveConfiguredLocalOriginDispatcherPolicy({
        url,
        baseUrl: params.configuredLocalOriginBaseUrl,
        lookupFn: params.lookupFn,
      }),
    useEnvProxy: false,
  });
}
