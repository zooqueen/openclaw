import { lookup as dnsLookup } from "node:dns/promises";
import {
  extractEmbeddedIpv4FromIpv6,
  isBlockedSpecialUseIpv4Address,
  isBlockedSpecialUseIpv6Address,
  isCanonicalDottedDecimalIPv4,
  isIpv4Address,
  isLegacyIpv4Literal,
  parseCanonicalIpAddress,
  parseLooseIpAddress,
  type Ipv4SpecialUseBlockOptions,
} from "@openclaw/net-policy/ip";

export type LookupFn = typeof dnsLookup;
type LookupAddress = { address: string; family: number };
type LookupResult = LookupAddress | LookupAddress[];
type EndpointPolicy = {
  allowPrivateNetwork?: boolean;
  allowRfc2544BenchmarkRange?: boolean;
};

export class NetworkTargetBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NetworkTargetBlockedError";
  }
}

const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "localhost.localdomain",
  "metadata.google.internal",
]);

function normalizeHostname(hostname: string): string {
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

function blockOptions(policy?: EndpointPolicy): Ipv4SpecialUseBlockOptions {
  return { allowRfc2544BenchmarkRange: policy?.allowRfc2544BenchmarkRange === true };
}

export function isPrivateIpAddress(address: string, policy?: EndpointPolicy): boolean {
  const normalized = normalizeHostname(address).replace(/%[0-9a-z_.-]+$/iu, "");
  if (!normalized) {
    return false;
  }
  const strictIp = parseCanonicalIpAddress(normalized);
  if (strictIp) {
    if (isIpv4Address(strictIp)) {
      return isBlockedSpecialUseIpv4Address(strictIp, blockOptions(policy));
    }
    if (isBlockedSpecialUseIpv6Address(strictIp)) {
      return true;
    }
    const embeddedIpv4 = extractEmbeddedIpv4FromIpv6(strictIp);
    return embeddedIpv4
      ? isBlockedSpecialUseIpv4Address(embeddedIpv4, blockOptions(policy))
      : false;
  }
  if (normalized.includes(":") && !parseLooseIpAddress(normalized)) {
    return true;
  }
  if (!isCanonicalDottedDecimalIPv4(normalized) && isLegacyIpv4Literal(normalized)) {
    return true;
  }
  return looksLikeUnsupportedIpv4Literal(normalized);
}

function isBlockedHostname(hostname: string): boolean {
  const normalized = normalizeHostname(hostname);
  return (
    BLOCKED_HOSTNAMES.has(normalized) ||
    normalized.endsWith(".localhost") ||
    normalized.endsWith(".local") ||
    normalized.endsWith(".internal")
  );
}

export function isBlockedHostnameOrIp(hostname: string, policy?: EndpointPolicy): boolean {
  const normalized = normalizeHostname(hostname);
  return (
    Boolean(normalized) && (isBlockedHostname(normalized) || isPrivateIpAddress(normalized, policy))
  );
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

export async function resolvePinnedHostnameWithPolicy(
  hostname: string,
  params: { lookupFn?: LookupFn; policy?: EndpointPolicy } = {},
): Promise<{ hostname: string; addresses: string[] }> {
  const normalized = normalizeHostname(hostname);
  if (!normalized) {
    throw new Error("Invalid hostname");
  }
  const allowPrivateNetwork = params.policy?.allowPrivateNetwork === true;
  if (!allowPrivateNetwork && isBlockedHostnameOrIp(normalized, params.policy)) {
    throw new NetworkTargetBlockedError(
      "Blocked hostname or private/internal/special-use IP address",
    );
  }
  const lookupFn = params.lookupFn ?? dnsLookup;
  const results = normalizeLookupResults(
    (await lookupFn(normalized, { all: true })) as LookupResult,
  );
  if (results.length === 0) {
    throw new Error(`Unable to resolve hostname: ${hostname}`);
  }
  if (
    !allowPrivateNetwork &&
    results.some((entry) => isBlockedHostnameOrIp(entry.address, params.policy))
  ) {
    throw new NetworkTargetBlockedError(
      "Blocked: resolves to private/internal/special-use IP address",
    );
  }
  return { hostname: normalized, addresses: dedupeAndPreferIpv4(results) };
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
