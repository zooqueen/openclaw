// Bundled-plugin-only network policy bridge. This intentionally stays
// private-local-only; third-party plugins should use fetch-runtime plus local
// validation rather than reusable OpenClaw network-policy primitives.
export {
  assertHostnameAllowedWithPolicy,
  assertHttpUrlTargetsPrivateNetwork,
  buildHostnameAllowlistPolicyFromSuffixAllowlist,
  createPinnedLookup,
  isBlockedHostnameOrIp as isPrivateOrLoopbackHost,
  isBlockedHostname,
  isBlockedHostnameOrIp,
  isHostnameAllowedByPattern,
  isHttpsUrlAllowedByHostnameSuffixAllowlist,
  isPrivateIpAddress,
  isPrivateNetworkAllowedByPolicy,
  isPrivateNetworkOptInEnabled,
  matchesHostnameAllowlist,
  SsrFBlockedError as NetworkTargetBlockedError,
  networkTargetPolicyFromDangerouslyAllowPrivateNetwork,
  networkTargetPolicyFromHttpBaseUrlAllowedHostname,
  networkTargetPolicyFromHttpBaseUrlAllowedOrigin,
  normalizeHostnameAllowlist,
  normalizeHostnameSuffixAllowlist,
  resolveNetworkTargetPolicyForUrl,
  resolvePinnedHostnameWithPolicy,
  type LookupFn,
  type SsrFPolicy as NetworkTargetPolicy,
  type PinnedDispatcherPolicy,
  type PinnedHostname,
  type PinnedHostnameOverride,
  type PrivateIpBlockOptions,
} from "../infra/net/ssrf.js";
export { normalizeHostname } from "../infra/net/hostname.js";
