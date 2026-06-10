// Ollama-owned local-service fetch helper. Kept private-local-only so generic
// managed-proxy local-origin bypass behavior is not public Plugin SDK API.
import { lookup as dnsLookup } from "node:dns/promises";
import type { Dispatcher } from "undici";
import { shouldUseConfiguredLocalOriginManagedProxyBypass } from "../infra/net/configured-local-origin-bypass.js";
import {
  fetchOperatorConfiguredEndpoint,
  type FetchWithResponseReleaseResult,
} from "../infra/net/egress-fetch.js";
import { hasProxyEnvConfigured } from "../infra/net/proxy-env.js";
import { getActiveManagedProxyLoopbackMode } from "../infra/net/proxy/active-proxy-state.js";
import type { PinnedDispatcherPolicy } from "../infra/net/ssrf.js";

type LookupFn = typeof dnsLookup;

type OllamaLocalOriginFetchRequestInit = RequestInit & {
  dispatcher?: Dispatcher;
};

type OllamaLocalOriginFetchLike = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export type OllamaLocalOriginFetchOptions = {
  url: string;
  init?: OllamaLocalOriginFetchRequestInit;
  fetchImpl?: OllamaLocalOriginFetchLike;
  followRedirects?: boolean;
  maxRedirects?: number;
  signal?: AbortSignal;
  timeoutMs?: number;
  operation?: string;
  configuredLocalOriginBaseUrl: string;
  lookupFn?: LookupFn;
};

function normalizeHttpOrigin(value: string): string | undefined {
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

function assertOllamaConfiguredLocalOriginUrlAllowed(url: URL, baseUrl: string): void {
  const expectedOrigin = normalizeHttpOrigin(baseUrl);
  const requestOrigin = normalizeHttpOrigin(url.toString());
  if (expectedOrigin && requestOrigin !== expectedOrigin) {
    throw new Error(`Blocked hostname (not configured Ollama origin): ${url.hostname}`);
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

async function resolveOllamaLocalOriginDispatcherPolicy(params: {
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

export async function fetchOllamaConfiguredLocalOrigin(
  params: OllamaLocalOriginFetchOptions,
): Promise<FetchWithResponseReleaseResult> {
  return await fetchOperatorConfiguredEndpoint({
    url: params.url,
    init: params.init,
    signal: params.signal,
    timeoutMs: params.timeoutMs,
    fetchImpl: params.fetchImpl,
    followRedirects: params.followRedirects,
    maxRedirects: params.maxRedirects,
    operation: params.operation ?? "ollama-configured-local-origin-fetch",
    validateUrl: (url) => {
      assertOllamaConfiguredLocalOriginUrlAllowed(url, params.configuredLocalOriginBaseUrl);
    },
    dispatcherPolicy: async (url) =>
      await resolveOllamaLocalOriginDispatcherPolicy({
        url,
        baseUrl: params.configuredLocalOriginBaseUrl,
        lookupFn: params.lookupFn,
      }),
    useEnvProxy: false,
  });
}
