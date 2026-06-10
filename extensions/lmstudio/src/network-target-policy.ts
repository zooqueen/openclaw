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

export class NetworkTargetBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NetworkTargetBlockedError";
  }
}

export type NetworkTargetPolicy = {
  allowedHostnames?: string[];
  hostnameAllowlist?: string[];
};

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

function normalizeUnique(values?: readonly string[]): string[] {
  return Array.from(
    new Set(
      (values ?? [])
        .map((value) => normalizeHostname(value))
        .filter((value): value is string => value.length > 0),
    ),
  );
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

export function isBlockedHostnameOrIp(hostname: string, policy?: NetworkTargetPolicy): boolean {
  const normalized = normalizeHostname(hostname);
  if (!normalized || normalizeUnique(policy?.allowedHostnames).includes(normalized)) {
    return false;
  }
  return (
    BLOCKED_HOSTNAMES.has(normalized) ||
    normalized.endsWith(".localhost") ||
    normalized.endsWith(".local") ||
    normalized.endsWith(".internal") ||
    isPrivateIpAddress(normalized)
  );
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
