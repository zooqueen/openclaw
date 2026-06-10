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
import type { MediaFetchUrlPolicy } from "openclaw/plugin-sdk/media-runtime";

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
): MediaFetchUrlPolicy | undefined {
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
