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
} from "@openclaw/net-policy/ip";

type LookupAddress = { address: string; family: number };
type LookupResult = LookupAddress | LookupAddress[];

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

function isPrivateIpAddress(address: string): boolean {
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

function isBlockedHostnameOrIp(hostname: string): boolean {
  const normalized = normalizeHostname(hostname);
  return (
    Boolean(normalized) &&
    (BLOCKED_HOSTNAMES.has(normalized) ||
      normalized.endsWith(".localhost") ||
      normalized.endsWith(".local") ||
      normalized.endsWith(".internal") ||
      isPrivateIpAddress(normalized))
  );
}

function normalizeLookupResults(results: LookupResult): readonly LookupAddress[] {
  return Array.isArray(results) ? results : [results];
}

export async function assertPublicHostnameResolves(hostname: string): Promise<void> {
  const normalized = normalizeHostname(hostname);
  if (!normalized) {
    throw new Error("Invalid hostname");
  }
  if (isBlockedHostnameOrIp(normalized)) {
    throw new Error("Blocked hostname or private/internal/special-use IP address");
  }
  const results = normalizeLookupResults(
    (await dnsLookup(normalized, { all: true })) as LookupResult,
  );
  if (results.length === 0) {
    throw new Error(`Unable to resolve hostname: ${hostname}`);
  }
  if (
    results.some(
      (entry) =>
        isBlockedHostnameOrIp(entry.address) ||
        isLinkLocalIpAddress(entry.address) ||
        isCloudMetadataIpAddress(entry.address),
    )
  ) {
    throw new Error("Blocked: resolves to private/internal/special-use IP address");
  }
}
