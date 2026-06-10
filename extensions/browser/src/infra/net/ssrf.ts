import { lookup as dnsLookupCb, type LookupAddress } from "node:dns";
import { lookup as dnsLookup } from "node:dns/promises";
import {
  extractEmbeddedIpv4FromIpv6,
  isBlockedSpecialUseIpv4Address,
  isBlockedSpecialUseIpv6Address,
  isCanonicalDottedDecimalIPv4,
  isCloudMetadataIpAddress,
  isIpv4Address,
  isLegacyIpv4Literal,
  isLinkLocalIpAddress,
  parseCanonicalIpAddress,
  parseLooseIpAddress,
  type Ipv4SpecialUseBlockOptions,
  type Ipv6SpecialUseBlockOptions,
} from "@openclaw/net-policy/ip";

type LookupCallback = (
  err: NodeJS.ErrnoException | null,
  address: string | LookupAddress[],
  family?: number,
) => void;

type LookupResult = LookupAddress | LookupAddress[];

export class NetworkTargetBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NetworkTargetBlockedError";
  }
}

export type LookupFn = typeof dnsLookup;

export type NetworkTargetPolicy = {
  allowPrivateNetwork?: boolean;
  dangerouslyAllowPrivateNetwork?: boolean;
  allowRfc2544BenchmarkRange?: boolean;
  allowIpv6UniqueLocalRange?: boolean;
  allowedHostnames?: string[];
  allowedOrigins?: string[];
  hostnameAllowlist?: string[];
};

export type PinnedHostname = {
  hostname: string;
  addresses: string[];
  lookup: typeof dnsLookupCb;
};

export type PinnedHostnameOverride = {
  hostname: string;
  addresses: string[];
};

export type PinnedDispatcherPolicy =
  | {
      mode: "direct";
      connect?: Record<string, unknown>;
      pinnedHostname?: PinnedHostnameOverride;
    }
  | {
      mode: "env-proxy";
      connect?: Record<string, unknown>;
      proxyTls?: Record<string, unknown>;
      pinnedHostname?: PinnedHostnameOverride;
    }
  | {
      mode: "explicit-proxy";
      proxyUrl: string;
      allowPrivateProxy?: boolean;
      proxyTls?: Record<string, unknown>;
      pinnedHostname?: PinnedHostnameOverride;
    };

const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "localhost.localdomain",
  "metadata.google.internal",
]);

function normalizeUnique(values?: readonly string[]): string[] {
  return Array.from(
    new Set(
      (values ?? [])
        .map((value) => normalizeHostname(value))
        .filter((value): value is string => value.length > 0),
    ),
  );
}

export function normalizeHostname(hostname: string): string {
  const normalized = hostname.trim().toLowerCase().replace(/\.+$/u, "");
  return normalized.startsWith("[") && normalized.endsWith("]")
    ? normalized.slice(1, -1)
    : normalized;
}

function looksLikeUnsupportedIpv4Literal(hostname: string): boolean {
  const parts = hostname.split(".");
  return (
    parts.length > 0 &&
    parts.length <= 4 &&
    parts.every(
      (part) => part.length > 0 && (/^[0-9]+$/u.test(part) || /^0x[0-9a-f]+$/iu.test(part)),
    )
  );
}

function resolveIpv4SpecialUseBlockOptions(
  policy?: NetworkTargetPolicy,
): Ipv4SpecialUseBlockOptions {
  return {
    allowRfc2544BenchmarkRange: policy?.allowRfc2544BenchmarkRange === true,
  };
}

function resolveIpv6SpecialUseBlockOptions(
  policy?: NetworkTargetPolicy,
): Ipv6SpecialUseBlockOptions {
  return {
    allowUniqueLocalRange: policy?.allowIpv6UniqueLocalRange === true,
  };
}

export function isPrivateIpAddress(address: string, policy?: NetworkTargetPolicy): boolean {
  const normalized = normalizeHostname(address).replace(/%[0-9a-z_.-]+$/iu, "");
  if (!normalized) {
    return false;
  }

  const blockOptions = resolveIpv4SpecialUseBlockOptions(policy);
  const ipv6BlockOptions = resolveIpv6SpecialUseBlockOptions(policy);
  const strictIp = parseCanonicalIpAddress(normalized);
  if (strictIp) {
    if (isIpv4Address(strictIp)) {
      return isBlockedSpecialUseIpv4Address(strictIp, blockOptions);
    }
    if (isBlockedSpecialUseIpv6Address(strictIp, ipv6BlockOptions)) {
      return true;
    }
    const embeddedIpv4 = extractEmbeddedIpv4FromIpv6(strictIp);
    return embeddedIpv4 ? isBlockedSpecialUseIpv4Address(embeddedIpv4, blockOptions) : false;
  }
  if (normalized.includes(":") && !parseLooseIpAddress(normalized)) {
    return true;
  }
  if (!isCanonicalDottedDecimalIPv4(normalized) && isLegacyIpv4Literal(normalized)) {
    return true;
  }
  return looksLikeUnsupportedIpv4Literal(normalized);
}

export function isBlockedHostname(hostname: string): boolean {
  const normalized = normalizeHostname(hostname);
  return (
    BLOCKED_HOSTNAMES.has(normalized) ||
    normalized.endsWith(".localhost") ||
    normalized.endsWith(".local") ||
    normalized.endsWith(".internal")
  );
}

export function isBlockedHostnameOrIp(hostname: string, policy?: NetworkTargetPolicy): boolean {
  const normalized = normalizeHostname(hostname);
  return (
    Boolean(normalized) && (isBlockedHostname(normalized) || isPrivateIpAddress(normalized, policy))
  );
}

export const isPrivateOrLoopbackHost = isBlockedHostnameOrIp;

export function isPrivateNetworkAllowedByPolicy(policy?: NetworkTargetPolicy): boolean {
  return policy?.dangerouslyAllowPrivateNetwork === true || policy?.allowPrivateNetwork === true;
}

export function isPrivateNetworkOptInEnabled(input: unknown): boolean {
  if (input === true) {
    return true;
  }
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return false;
  }
  const record = input as {
    allowPrivateNetwork?: unknown;
    dangerouslyAllowPrivateNetwork?: unknown;
    network?: { allowPrivateNetwork?: unknown; dangerouslyAllowPrivateNetwork?: unknown };
  };
  return (
    record.allowPrivateNetwork === true ||
    record.dangerouslyAllowPrivateNetwork === true ||
    record.network?.allowPrivateNetwork === true ||
    record.network?.dangerouslyAllowPrivateNetwork === true
  );
}

function normalizeHostnameAllowlist(values?: readonly string[]): string[] {
  return normalizeUnique(values).filter((value) => value !== "*" && value !== "*.");
}

function isHostnameAllowedByPattern(hostname: string, pattern: string): boolean {
  if (pattern.startsWith("*.")) {
    const suffix = pattern.slice(2);
    return Boolean(suffix) && hostname !== suffix && hostname.endsWith(`.${suffix}`);
  }
  return hostname === pattern;
}

export function matchesHostnameAllowlist(hostname: string, allowlist: readonly string[]): boolean {
  return (
    allowlist.length === 0 ||
    allowlist.some((pattern) => isHostnameAllowedByPattern(hostname, pattern))
  );
}

function resolveHostnamePolicyChecks(hostname: string, policy?: NetworkTargetPolicy) {
  const normalized = normalizeHostname(hostname);
  if (!normalized) {
    throw new Error("Invalid hostname");
  }
  const allowedHostnames = new Set(normalizeUnique(policy?.allowedHostnames));
  const skipPrivateNetworkChecks =
    isPrivateNetworkAllowedByPolicy(policy) || allowedHostnames.has(normalized);
  if (
    !matchesHostnameAllowlist(normalized, normalizeHostnameAllowlist(policy?.hostnameAllowlist))
  ) {
    throw new NetworkTargetBlockedError(`Blocked hostname (not in allowlist): ${hostname}`);
  }
  if (!skipPrivateNetworkChecks && isBlockedHostnameOrIp(normalized, policy)) {
    throw new NetworkTargetBlockedError(
      "Blocked hostname or private/internal/special-use IP address",
    );
  }
  return { normalized, skipPrivateNetworkChecks };
}

function normalizeLookupResults(results: LookupResult): readonly LookupAddress[] {
  return Array.isArray(results) ? results : [results];
}

function dedupeAndPreferIpv4(results: readonly LookupAddress[]): string[] {
  const seen = new Set<string>();
  const ipv4: string[] = [];
  const otherFamilies: string[] = [];
  for (const entry of results) {
    if (seen.has(entry.address)) {
      continue;
    }
    seen.add(entry.address);
    if (entry.family === 4) {
      ipv4.push(entry.address);
      continue;
    }
    otherFamilies.push(entry.address);
  }
  return [...ipv4, ...otherFamilies];
}

function assertAllowedTrustedHostnameResolvedAddresses(results: readonly LookupAddress[]): void {
  for (const entry of results) {
    if (isLinkLocalIpAddress(entry.address) || isCloudMetadataIpAddress(entry.address)) {
      throw new NetworkTargetBlockedError(
        "Blocked: resolves to private/internal/special-use IP address",
      );
    }
  }
}

export function createPinnedLookup(params: {
  hostname: string;
  addresses: string[];
  fallback?: typeof dnsLookupCb;
}): typeof dnsLookupCb {
  const normalizedHost = normalizeHostname(params.hostname);
  if (params.addresses.length === 0) {
    throw new Error(`Pinned lookup requires at least one address for ${params.hostname}`);
  }
  const fallback = params.fallback ?? dnsLookupCb;
  const records = params.addresses.map((address) => ({
    address,
    family: address.includes(":") ? 6 : 4,
  }));
  const ipv4Records = records.filter((entry) => entry.family === 4);
  const automaticRecords = ipv4Records.length > 0 ? ipv4Records : records;
  let index = 0;
  return ((host: string, options?: unknown, callback?: unknown) => {
    const cb: LookupCallback =
      typeof options === "function" ? (options as LookupCallback) : (callback as LookupCallback);
    if (!cb) {
      return;
    }
    if (normalizeHostname(host) !== normalizedHost) {
      return typeof options === "function" || options === undefined
        ? (fallback as unknown as (hostname: string, callback: LookupCallback) => void)(host, cb)
        : (
            fallback as unknown as (
              hostname: string,
              options: unknown,
              callback: LookupCallback,
            ) => void
          )(host, options, cb);
    }
    const opts =
      typeof options === "object" && options !== null
        ? (options as { all?: boolean; family?: number })
        : {};
    const requestedFamily = typeof options === "number" ? options : (opts.family ?? 0);
    const candidates =
      requestedFamily === 4 || requestedFamily === 6
        ? records.filter((entry) => entry.family === requestedFamily)
        : automaticRecords;
    const usable = candidates.length > 0 ? candidates : automaticRecords;
    if (opts.all) {
      cb(null, usable as LookupAddress[]);
      return;
    }
    const chosen = usable[index % usable.length];
    index += 1;
    cb(null, chosen.address, chosen.family);
  }) as typeof dnsLookupCb;
}

export async function resolvePinnedHostnameWithPolicy(
  hostname: string,
  params: { lookupFn?: LookupFn; policy?: NetworkTargetPolicy } = {},
): Promise<PinnedHostname> {
  const { normalized, skipPrivateNetworkChecks } = resolveHostnamePolicyChecks(
    hostname,
    params.policy,
  );
  const lookupFn = params.lookupFn ?? dnsLookup;
  const results = normalizeLookupResults(
    (await lookupFn(normalized, { all: true })) as LookupResult,
  );
  if (results.length === 0) {
    throw new Error(`Unable to resolve hostname: ${hostname}`);
  }
  if (!skipPrivateNetworkChecks) {
    for (const entry of results) {
      if (isBlockedHostnameOrIp(entry.address, params.policy)) {
        throw new NetworkTargetBlockedError(
          "Blocked: resolves to private/internal/special-use IP address",
        );
      }
    }
  } else if (!isPrivateNetworkAllowedByPolicy(params.policy)) {
    assertAllowedTrustedHostnameResolvedAddresses(results);
  }
  const addresses = dedupeAndPreferIpv4(results);
  return {
    hostname: normalized,
    addresses,
    lookup: createPinnedLookup({ hostname: normalized, addresses }),
  };
}

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
  if (isBlockedHostnameOrIp(parsed.hostname)) {
    return;
  }
  const allowPrivateNetwork =
    typeof params.dangerouslyAllowPrivateNetwork === "boolean"
      ? params.dangerouslyAllowPrivateNetwork
      : params.allowPrivateNetwork;
  if (allowPrivateNetwork !== true) {
    throw new Error(errorMessage);
  }
  const pinned = await resolvePinnedHostnameWithPolicy(parsed.hostname, {
    lookupFn: params.lookupFn,
    policy: { allowPrivateNetwork: true },
  });
  if (!pinned.addresses.every((address) => isPrivateIpAddress(address))) {
    throw new Error(errorMessage);
  }
}

function normalizePolicyOrigin(value: string): string | undefined {
  try {
    const parsed = new URL(value.trim());
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return undefined;
    }
    parsed.hostname = normalizeHostname(parsed.hostname);
    return parsed.origin.toLowerCase();
  } catch {
    return undefined;
  }
}

export function resolveNetworkTargetPolicyForUrl(
  url: URL,
  policy?: NetworkTargetPolicy,
): NetworkTargetPolicy | undefined {
  if (!policy?.allowedOrigins?.length) {
    return policy;
  }
  const requestOrigin = normalizePolicyOrigin(url.toString());
  const allowedOrigins = policy.allowedOrigins
    .map((origin) => normalizePolicyOrigin(origin))
    .filter((origin): origin is string => Boolean(origin));
  if (!requestOrigin || !allowedOrigins.includes(requestOrigin)) {
    return policy;
  }
  return {
    ...policy,
    allowedHostnames: Array.from(
      new Set([...(policy.allowedHostnames ?? []), normalizeHostname(url.hostname)]),
    ),
  };
}

export function networkTargetPolicyFromHttpBaseUrlAllowedHostname(
  baseUrl: string,
): NetworkTargetPolicy | undefined {
  try {
    const parsed = new URL(baseUrl.trim());
    return parsed.protocol === "http:" || parsed.protocol === "https:"
      ? { allowedHostnames: [parsed.hostname] }
      : undefined;
  } catch {
    return undefined;
  }
}

export function networkTargetPolicyFromDangerouslyAllowPrivateNetwork(
  dangerouslyAllowPrivateNetwork: boolean | null | undefined,
): NetworkTargetPolicy | undefined {
  return dangerouslyAllowPrivateNetwork === true ? { allowPrivateNetwork: true } : undefined;
}

function normalizeHostnameSuffix(value: string): string {
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) {
    return "";
  }
  if (trimmed === "*" || trimmed === "*.") {
    return "*";
  }
  return trimmed
    .replace(/^\*\.?/u, "")
    .replace(/^\.+/u, "")
    .replace(/\.+$/u, "");
}

export function normalizeHostnameSuffixAllowlist(
  input?: readonly string[],
  defaults?: readonly string[],
): string[] {
  const source = input && input.length > 0 ? input : defaults;
  const normalized = Array.from(
    new Set((source ?? []).map(normalizeHostnameSuffix).filter(Boolean)),
  );
  return normalized.includes("*") ? ["*"] : normalized;
}

export function buildHostnameAllowlistPolicyFromSuffixAllowlist(
  allowHosts?: readonly string[],
): NetworkTargetPolicy | undefined {
  const normalized = normalizeHostnameSuffixAllowlist(allowHosts);
  if (normalized.length === 0 || normalized.includes("*")) {
    return undefined;
  }
  return {
    hostnameAllowlist: normalized.flatMap((host) => [host, `*.${host}`]),
  };
}

export function isHttpsUrlAllowedByHostnameSuffixAllowlist(
  url: string,
  allowHosts?: readonly string[],
): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") {
      return false;
    }
    const hostname = normalizeHostname(parsed.hostname);
    return normalizeHostnameSuffixAllowlist(allowHosts).some(
      (allowHost) =>
        allowHost === "*" || hostname === allowHost || hostname.endsWith(`.${allowHost}`),
    );
  } catch {
    return false;
  }
}
