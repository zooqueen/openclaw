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
} from "@openclaw/net-policy/ip";

export type LookupFn = typeof dnsLookup;
type LookupAddress = { address: string; family: number };
type LookupResult = LookupAddress | LookupAddress[];
type EndpointPolicy = {
  allowPrivateNetwork?: boolean;
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

export function isPrivateIpAddress(address: string): boolean {
  const normalized = normalizeHostname(address).replace(/%[0-9a-z_.-]+$/iu, "");
  if (!normalized) {
    return false;
  }
  const strictIp = parseCanonicalIpAddress(normalized);
  if (strictIp) {
    if (isIpv4Address(strictIp)) {
      return isBlockedSpecialUseIpv4Address(strictIp);
    }
    if (isBlockedSpecialUseIpv6Address(strictIp)) {
      return true;
    }
    const embeddedIpv4 = extractEmbeddedIpv4FromIpv6(strictIp);
    return embeddedIpv4 ? isBlockedSpecialUseIpv4Address(embeddedIpv4) : false;
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

export function isBlockedHostnameOrIp(hostname: string): boolean {
  const normalized = normalizeHostname(hostname);
  return Boolean(normalized) && (isBlockedHostname(normalized) || isPrivateIpAddress(normalized));
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
  if (!allowPrivateNetwork && isBlockedHostnameOrIp(normalized)) {
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
  if (!allowPrivateNetwork && results.some((entry) => isBlockedHostnameOrIp(entry.address))) {
    throw new NetworkTargetBlockedError(
      "Blocked: resolves to private/internal/special-use IP address",
    );
  }
  return { hostname: normalized, addresses: dedupeAndPreferIpv4(results) };
}
