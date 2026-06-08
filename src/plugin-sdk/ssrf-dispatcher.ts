// Narrow SSRF dispatcher helpers for plugins that pin DNS resolution before fetch.

export {
  closeDispatcher,
  createPinnedDispatcher,
  resolvePinnedHostname,
  resolvePinnedHostnameWithPolicy,
  type LookupFn,
  type PinnedDispatcherPolicy,
  type SsrFPolicy,
} from "../infra/net/ssrf.js";
