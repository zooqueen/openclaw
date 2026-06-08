// Deprecated compatibility fetch runtime for the former SSRF guard API.
import { lookup as dnsLookup } from "node:dns/promises";
import type { Dispatcher } from "undici";
import { buildTimeoutAbortSignal } from "../../utils/fetch-timeout.js";
import {
  normalizeHeadersInitForFetch,
  normalizeRequestInitHeadersForFetch,
} from "../fetch-headers.js";
import {
  shouldUseConfiguredLocalOriginManagedProxyBypass,
  type ConfiguredLocalOriginManagedProxyBypass,
} from "./configured-local-origin-bypass.js";
import { normalizeHostname } from "./hostname.js";
import { hasProxyEnvConfigured, shouldUseEnvHttpProxyForUrl } from "./proxy-env.js";
import { getActiveManagedProxyLoopbackMode } from "./proxy/active-proxy-state.js";
import { retainSafeHeadersForCrossOriginRedirect as retainSafeRedirectHeaders } from "./redirect-headers.js";
import {
  fetchWithRuntimeDispatcher,
  isMockedFetch,
  type DispatcherAwareRequestInit,
} from "./runtime-fetch.js";
import {
  closeDispatcher,
  createPinnedDispatcher,
  matchesHostnameAllowlist,
  normalizeHostnameAllowlist,
  resolvePinnedHostnameWithPolicy,
  SsrFBlockedError,
  type LookupFn,
  type PinnedDispatcherPolicy,
  type SsrFPolicy,
} from "./ssrf.js";
import { globalUndiciStreamTimeoutMs } from "./undici-global-dispatcher.js";
import {
  createHttp1Agent,
  createHttp1EnvHttpProxyAgent,
  createHttp1ProxyAgent,
} from "./undici-runtime.js";

function resolveDispatcherTimeoutMs(fromParams: number | undefined): number | undefined {
  if (fromParams !== undefined) {
    return fromParams;
  }
  // Fall back to module-level bridge set by ensureGlobalUndiciStreamTimeouts
  // (avoids reading Undici's non-public `.options` field)
  if (globalUndiciStreamTimeoutMs !== undefined) {
    return globalUndiciStreamTimeoutMs;
  }
  return undefined;
}

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export const GUARDED_FETCH_MODE = {
  STRICT: "strict",
  TRUSTED_ENV_PROXY: "trusted_env_proxy",
  TRUSTED_EXPLICIT_PROXY: "trusted_explicit_proxy",
} as const;

export type GuardedFetchMode = (typeof GUARDED_FETCH_MODE)[keyof typeof GUARDED_FETCH_MODE];

export type GuardedFetchOptions = {
  url: string;
  fetchImpl?: FetchLike;
  init?: RequestInit;
  capture?:
    | false
    | {
        flowId?: string;
        meta?: Record<string, unknown>;
      };
  maxRedirects?: number;
  /**
   * Allow replaying unsafe request methods and bodies across cross-origin redirects.
   * Sensitive cross-origin headers (for example Authorization/Cookie) are still stripped.
   * Defaults to false.
   */
  allowCrossOriginUnsafeRedirectReplay?: boolean;
  timeoutMs?: number;
  signal?: AbortSignal;
  requireHttps?: boolean;
  /**
   * @deprecated Private-network and DNS-pinning policy fields are no longer enforced.
   * Hostname/origin allowlist fields are still honored for compatibility.
   */
  policy?: SsrFPolicy;
  /** @deprecated No longer used for DNS pinning. Use proxy.enabled plus external proxy policy. */
  lookupFn?: LookupFn;
  dispatcherPolicy?: PinnedDispatcherPolicy;
  retainAuthorizationRedirectHostnameAllowlist?: string[];
  mode?: GuardedFetchMode;
  /** @deprecated No longer pins DNS. Use proxy.enabled plus external proxy policy. */
  pinDns?: boolean;
  /** @deprecated use `mode: "trusted_env_proxy"` for trusted/operator-controlled URLs. */
  proxy?: "env";
  /**
   * @deprecated use `mode: "trusted_env_proxy"` instead.
   */
  dangerouslyAllowEnvProxyWithoutPinnedDns?: boolean;
  auditContext?: string;
};

export type GuardedFetchResult = {
  response: Response;
  finalUrl: string;
  release: () => Promise<void>;
  refreshTimeout?: () => void;
};

type GuardedFetchInternalOptions = GuardedFetchOptions & {
  managedProxyBypass?: ConfiguredLocalOriginManagedProxyBypass;
  resolveDispatcherPolicy?: (url: URL) => PinnedDispatcherPolicy | undefined;
};

export type GuardedFetchConfiguredLocalOriginOptions = GuardedFetchOptions & {
  configuredLocalOriginBaseUrl: string;
};

type GuardedFetchPresetOptions = Omit<
  GuardedFetchOptions,
  "mode" | "proxy" | "dangerouslyAllowEnvProxyWithoutPinnedDns"
>;

const DEFAULT_MAX_REDIRECTS = 3;
const OPENCLAW_DEBUG_PROXY_ENABLED = "OPENCLAW_DEBUG_PROXY_ENABLED";

function getRedirectVisitKey(url: string, init: RequestInit | undefined): string {
  return `${init?.method?.toUpperCase() ?? "GET"} ${url}`;
}

function isTruthyEnvValue(value: string | undefined): boolean {
  return value === "1" || value === "true" || value === "yes" || value === "on";
}

export function withStrictGuardedFetchMode(params: GuardedFetchPresetOptions): GuardedFetchOptions {
  return { ...params, mode: GUARDED_FETCH_MODE.STRICT };
}

export function withTrustedEnvProxyGuardedFetchMode(
  params: GuardedFetchPresetOptions,
): GuardedFetchOptions {
  return { ...params, mode: GUARDED_FETCH_MODE.TRUSTED_ENV_PROXY };
}

export function withTrustedExplicitProxyGuardedFetchMode(
  params: GuardedFetchPresetOptions,
): GuardedFetchOptions {
  return { ...params, mode: GUARDED_FETCH_MODE.TRUSTED_EXPLICIT_PROXY };
}

function resolveGuardedFetchMode(params: GuardedFetchOptions): GuardedFetchMode {
  // Legacy proxy flags map to the explicit trusted env-proxy mode; strict is the
  // default for user-influenced URLs.
  if (params.mode) {
    return params.mode;
  }
  if (params.proxy === "env" && params.dangerouslyAllowEnvProxyWithoutPinnedDns === true) {
    return GUARDED_FETCH_MODE.TRUSTED_ENV_PROXY;
  }
  return GUARDED_FETCH_MODE.STRICT;
}

async function createPolicyDispatcherWithoutPinnedDns(
  dispatcherPolicy?: PinnedDispatcherPolicy,
  timeoutMs?: number,
  params?: {
    hostname: string;
    lookupFn?: LookupFn;
    policy?: SsrFPolicy;
  },
): Promise<Dispatcher | undefined> {
  if (!dispatcherPolicy) {
    return undefined;
  }
  if (dispatcherPolicy.pinnedHostname) {
    if (!params) {
      throw new Error("Pinned dispatcher policy requires request hostname context");
    }
    const pinned = await resolvePinnedHostnameWithPolicy(params.hostname, {
      lookupFn: params.lookupFn,
      policy: params.policy,
    });
    return createPinnedDispatcher(pinned, dispatcherPolicy, params.policy, timeoutMs);
  }

  if (dispatcherPolicy.mode === "direct") {
    return createHttp1Agent(
      dispatcherPolicy.connect ? { connect: { ...dispatcherPolicy.connect } } : undefined,
      timeoutMs,
    );
  }

  if (dispatcherPolicy.mode === "env-proxy") {
    return createHttp1EnvHttpProxyAgent(
      {
        ...(dispatcherPolicy.connect
          ? {
              connect: { ...dispatcherPolicy.connect },
              requestTls: { ...dispatcherPolicy.connect },
            }
          : {}),
        ...(dispatcherPolicy.proxyTls ? { proxyTls: { ...dispatcherPolicy.proxyTls } } : {}),
      },
      timeoutMs,
    );
  }

  const proxyUrl = dispatcherPolicy.proxyUrl.trim();
  if (dispatcherPolicy.proxyTls) {
    return createHttp1ProxyAgent(
      { uri: proxyUrl, requestTls: { ...dispatcherPolicy.proxyTls } },
      timeoutMs,
    );
  }
  return createHttp1ProxyAgent({ uri: proxyUrl }, timeoutMs);
}

async function resolveLookupAddresses(
  hostname: string,
  lookupFn: LookupFn,
): Promise<readonly string[]> {
  const results = await lookupFn(hostname, { all: true });
  const records = Array.isArray(results) ? results : [results];
  return records.map((record) => record.address);
}

async function resolveConfiguredLocalOriginManagedProxyPolicy(params: {
  url: URL;
  options: GuardedFetchInternalOptions;
}): Promise<PinnedDispatcherPolicy | undefined> {
  if (
    !params.options.managedProxyBypass ||
    getActiveManagedProxyLoopbackMode() === undefined ||
    !hasProxyEnvConfigured()
  ) {
    return undefined;
  }

  const resolvedAddresses = await resolveLookupAddresses(
    params.url.hostname,
    params.options.lookupFn ?? dnsLookup,
  );
  return shouldUseConfiguredLocalOriginManagedProxyBypass({
    url: params.url,
    managedProxyBypass: params.options.managedProxyBypass,
    resolvedAddresses,
  })
    ? { mode: "direct" }
    : { mode: "env-proxy" };
}

function resolveDispatcherPolicyWithEnvProxyRouting(params: {
  url: URL;
  dispatcherPolicy?: PinnedDispatcherPolicy;
}): PinnedDispatcherPolicy | undefined {
  if (!shouldUseEnvHttpProxyForUrl(params.url.toString())) {
    return params.dispatcherPolicy;
  }
  if (!params.dispatcherPolicy) {
    return { mode: "env-proxy" };
  }
  if (params.dispatcherPolicy.mode !== "direct") {
    return params.dispatcherPolicy;
  }
  return {
    mode: "env-proxy",
    ...(params.dispatcherPolicy.connect ? { connect: { ...params.dispatcherPolicy.connect } } : {}),
  };
}

function isRedirectStatus(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

function isAmbientGlobalFetch(params: {
  fetchImpl: FetchLike | undefined;
  globalFetch: FetchLike | undefined;
}): boolean {
  return (
    typeof params.fetchImpl === "function" &&
    typeof params.globalFetch === "function" &&
    params.fetchImpl === params.globalFetch
  );
}

export function retainSafeHeadersForCrossOriginRedirectHeaders(
  headers?: HeadersInit,
): Record<string, string> | undefined {
  return retainSafeRedirectHeaders(headers);
}

async function captureGuardedFetchExchange(params: {
  url: string;
  method: string;
  requestHeaders?: Headers | Record<string, string> | undefined;
  requestBody?: BodyInit | Buffer | string | null;
  response: Response;
  transport?: "http" | "sse";
  capture: GuardedFetchOptions["capture"];
  auditContext?: string;
  capturedByGlobalFetchPatch?: boolean;
}): Promise<void> {
  if (params.capture === false || !isTruthyEnvValue(process.env[OPENCLAW_DEBUG_PROXY_ENABLED])) {
    return;
  }
  const { captureHttpExchange, isDebugProxyGlobalFetchPatchInstalled } =
    await import("../../proxy-capture/runtime.js");
  if (params.capturedByGlobalFetchPatch && isDebugProxyGlobalFetchPatchInstalled()) {
    return;
  }
  captureHttpExchange({
    url: params.url,
    method: params.method,
    requestHeaders: params.requestHeaders,
    requestBody: params.requestBody,
    response: params.response,
    transport: params.transport,
    flowId: params.capture?.flowId,
    meta: {
      captureOrigin: "guarded-fetch",
      ...(params.auditContext ? { auditContext: params.auditContext } : {}),
      ...params.capture?.meta,
    },
  });
}

function retainSafeHeadersForCrossOriginRedirect(init?: RequestInit): RequestInit | undefined {
  if (!init?.headers) {
    return init;
  }
  return { ...init, headers: retainSafeRedirectHeaders(init.headers) };
}

function resolveRetainedAuthorizationForRedirect(params: {
  init?: RequestInit;
  nextUrl: URL;
  hostnameAllowlist?: string[];
}): string | undefined {
  const init = params.init;
  if (!init?.headers || !params.hostnameAllowlist?.length) {
    return undefined;
  }
  if (params.nextUrl.protocol !== "https:") {
    return undefined;
  }
  if (
    !params.hostnameAllowlist.includes("*") &&
    !matchesHostnameAllowlist(params.nextUrl.hostname, params.hostnameAllowlist)
  ) {
    return undefined;
  }
  const normalizedInit = normalizeRequestInitHeadersForFetch(init);
  if (!normalizedInit?.headers) {
    return undefined;
  }
  return new Headers(normalizedInit.headers).get("authorization") ?? undefined;
}

function restoreRedirectAuthorization(params: {
  init?: RequestInit;
  authorization?: string;
}): RequestInit | undefined {
  if (!params.authorization) {
    return params.init;
  }
  const headers = new Headers(params.init?.headers);
  headers.set("Authorization", params.authorization);
  return { ...params.init, headers };
}

function dropBodyHeaders(headers?: HeadersInit): HeadersInit | undefined {
  if (!headers) {
    return headers;
  }
  const nextHeaders = new Headers(normalizeHeadersInitForFetch(headers));
  nextHeaders.delete("content-encoding");
  nextHeaders.delete("content-language");
  nextHeaders.delete("content-length");
  nextHeaders.delete("content-location");
  nextHeaders.delete("content-type");
  nextHeaders.delete("transfer-encoding");
  return nextHeaders;
}

function rewriteRedirectInitForMethod(params: {
  init?: RequestInit;
  status: number;
}): RequestInit | undefined {
  const { init, status } = params;
  if (!init) {
    return init;
  }

  const currentMethod = init.method?.toUpperCase() ?? "GET";
  const shouldForceGet =
    status === 303
      ? currentMethod !== "GET" && currentMethod !== "HEAD"
      : (status === 301 || status === 302) && currentMethod === "POST";

  if (!shouldForceGet) {
    return init;
  }

  return {
    ...init,
    method: "GET",
    body: undefined,
    headers: dropBodyHeaders(init.headers),
  };
}

function rewriteRedirectInitForCrossOrigin(params: {
  init?: RequestInit;
  allowUnsafeReplay: boolean;
}): RequestInit | undefined {
  const { init, allowUnsafeReplay } = params;
  if (!init || allowUnsafeReplay) {
    return init;
  }

  const currentMethod = init.method?.toUpperCase() ?? "GET";
  if (currentMethod === "GET" || currentMethod === "HEAD") {
    return init;
  }

  return {
    ...init,
    body: undefined,
    headers: dropBodyHeaders(init.headers),
  };
}

export { fetchWithRuntimeDispatcher } from "./runtime-fetch.js";

function normalizeGuardedFetchPolicyOrigin(value: string): string | undefined {
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

function assertGuardedFetchUrlAllowedByPolicy(url: URL, policy?: SsrFPolicy): void {
  const hostnameAllowlist = normalizeHostnameAllowlist([
    ...(policy?.allowedHostnames ?? []),
    ...(policy?.hostnameAllowlist ?? []),
  ]);
  const allowedOrigins = (policy?.allowedOrigins ?? [])
    .map((origin) => normalizeGuardedFetchPolicyOrigin(origin))
    .filter((origin): origin is string => Boolean(origin));
  if (hostnameAllowlist.length === 0 && allowedOrigins.length === 0) {
    return;
  }

  const normalizedHostname = normalizeHostname(url.hostname);
  const origin = normalizeGuardedFetchPolicyOrigin(url.toString());
  const hostAllowed =
    hostnameAllowlist.length > 0 && matchesHostnameAllowlist(normalizedHostname, hostnameAllowlist);
  const originAllowed = origin ? allowedOrigins.includes(origin) : false;
  if (!hostAllowed && !originAllowed) {
    throw new SsrFBlockedError(`Blocked hostname (not in allowlist): ${url.hostname}`);
  }
}

async function fetchWithDeprecatedSsrFGuardCompatibility(
  params: GuardedFetchInternalOptions,
): Promise<GuardedFetchResult> {
  void params.lookupFn;
  void params.pinDns;
  void params.proxy;
  void params.dangerouslyAllowEnvProxyWithoutPinnedDns;
  const defaultFetch: FetchLike | undefined = params.fetchImpl ?? globalThis.fetch;
  if (!defaultFetch) {
    throw new Error("fetch is not available");
  }
  const maxRedirects =
    typeof params.maxRedirects === "number" && Number.isFinite(params.maxRedirects)
      ? Math.max(0, Math.floor(params.maxRedirects))
      : DEFAULT_MAX_REDIRECTS;
  const timeout = buildTimeoutAbortSignal({
    timeoutMs: params.timeoutMs,
    signal: params.signal,
    operation: "fetchWithSsrFGuard",
    url: params.url,
  });
  let released = false;
  let dispatcher: Dispatcher | undefined;
  let finalResponse: Response | undefined;
  const release = async () => {
    if (released) {
      return;
    }
    released = true;
    timeout.cleanup();
    await finalResponse?.body?.cancel().catch(() => undefined);
    await closeDispatcher(dispatcher);
  };
  let currentUrl = params.url;
  let currentInit = normalizeRequestInitHeadersForFetch(
    params.init ? { ...params.init } : undefined,
  );
  const visited = new Set<string>();
  try {
    for (let redirectCount = 0; ; redirectCount += 1) {
      const parsedUrl = new URL(currentUrl);
      if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
        throw new Error("fetchWithSsrFGuard only supports http and https URLs");
      }
      if (params.requireHttps && parsedUrl.protocol !== "https:") {
        throw new Error(`HTTPS is required for ${parsedUrl.toString()}`);
      }
      assertGuardedFetchUrlAllowedByPolicy(parsedUrl, params.policy);
      const visitKey = getRedirectVisitKey(parsedUrl.toString(), currentInit);
      if (visited.has(visitKey)) {
        throw new Error(`Redirect loop detected for ${parsedUrl.toString()}`);
      }
      visited.add(visitKey);
      const configuredLocalOriginPolicy = await resolveConfiguredLocalOriginManagedProxyPolicy({
        url: parsedUrl,
        options: params,
      });
      const requestedDispatcherPolicy =
        params.resolveDispatcherPolicy?.(parsedUrl) ??
        params.dispatcherPolicy ??
        (resolveGuardedFetchMode(params) === GUARDED_FETCH_MODE.TRUSTED_ENV_PROXY
          ? ({ mode: "env-proxy" } satisfies PinnedDispatcherPolicy)
          : undefined);
      const dispatcherPolicy =
        configuredLocalOriginPolicy ??
        resolveDispatcherPolicyWithEnvProxyRouting({
          url: parsedUrl,
          dispatcherPolicy: requestedDispatcherPolicy,
        });
      dispatcher = await createPolicyDispatcherWithoutPinnedDns(
        dispatcherPolicy,
        resolveDispatcherTimeoutMs(params.timeoutMs),
        {
          hostname: parsedUrl.hostname,
          lookupFn: params.lookupFn,
          policy: params.policy,
        },
      );
      const init: DispatcherAwareRequestInit = {
        ...(currentInit ? { ...currentInit } : {}),
        redirect: "manual",
        ...(dispatcher ? { dispatcher } : {}),
        ...(timeout.signal ? { signal: timeout.signal } : {}),
      };
      const useInjectedFetch = Boolean(params.fetchImpl && params.fetchImpl !== globalThis.fetch);
      const useRuntimeFetch =
        Boolean(dispatcher) && !useInjectedFetch && !isMockedFetch(defaultFetch);
      const response = useRuntimeFetch
        ? await fetchWithRuntimeDispatcher(parsedUrl.toString(), init)
        : await defaultFetch(parsedUrl.toString(), init);
      await captureGuardedFetchExchange({
        url: parsedUrl.toString(),
        method: currentInit?.method ?? "GET",
        requestHeaders: currentInit?.headers as Headers | Record<string, string> | undefined,
        requestBody:
          (currentInit as (RequestInit & { body?: BodyInit | null }) | undefined)?.body ?? null,
        response,
        transport: "http",
        capture: params.capture,
        auditContext: params.auditContext,
        capturedByGlobalFetchPatch:
          !useRuntimeFetch &&
          isAmbientGlobalFetch({
            fetchImpl: defaultFetch,
            globalFetch: globalThis.fetch,
          }),
      });
      if (!isRedirectStatus(response.status)) {
        finalResponse = response;
        return {
          response,
          finalUrl: parsedUrl.toString(),
          release,
          refreshTimeout: timeout.refresh,
        };
      }
      const location = response.headers.get("location");
      await response.body?.cancel().catch(() => undefined);
      await closeDispatcher(dispatcher);
      dispatcher = undefined;
      if (!location) {
        throw new Error(`Redirect missing location header (${response.status})`);
      }
      if (redirectCount + 1 > maxRedirects) {
        throw new Error(`Too many redirects (limit: ${maxRedirects})`);
      }
      const nextParsedUrl = new URL(location, parsedUrl);
      assertGuardedFetchUrlAllowedByPolicy(nextParsedUrl, params.policy);
      const nextUrl = nextParsedUrl.toString();
      const retainedAuthorization = resolveRetainedAuthorizationForRedirect({
        init: currentInit,
        nextUrl: nextParsedUrl,
        hostnameAllowlist: params.retainAuthorizationRedirectHostnameAllowlist,
      });
      currentInit = rewriteRedirectInitForMethod({ init: currentInit, status: response.status });
      if (nextParsedUrl.origin !== parsedUrl.origin) {
        currentInit = rewriteRedirectInitForCrossOrigin({
          init: currentInit,
          allowUnsafeReplay: params.allowCrossOriginUnsafeRedirectReplay === true,
        });
        currentInit = retainSafeHeadersForCrossOriginRedirect(currentInit);
        currentInit = restoreRedirectAuthorization({
          init: currentInit,
          authorization: retainedAuthorization,
        });
      }
      currentUrl = nextUrl;
      timeout.refresh();
    }
  } catch (error) {
    await release();
    throw error;
  }
}

/**
 * @deprecated Compatibility wrapper for the former guarded-fetch API. It preserves
 * timeout, redirect, dispatcher, release, and explicit hostname/origin allowlist
 * behavior, but does not enforce private-network SSRF policy; use ordinary fetch
 * plus proxy.enabled with an external egress policy.
 */
export async function fetchWithSsrFGuard(params: GuardedFetchOptions): Promise<GuardedFetchResult> {
  const { managedProxyBypass, resolveDispatcherPolicy, ...publicParams } =
    params as GuardedFetchInternalOptions;
  void managedProxyBypass;
  void resolveDispatcherPolicy;
  return await fetchWithDeprecatedSsrFGuardCompatibility(publicParams);
}

export async function fetchConfiguredLocalOriginWithSsrFGuard({
  configuredLocalOriginBaseUrl,
  ...params
}: GuardedFetchConfiguredLocalOriginOptions): Promise<GuardedFetchResult> {
  return await fetchWithDeprecatedSsrFGuardCompatibility({
    ...params,
    managedProxyBypass: {
      kind: "configured-local-origin",
      baseUrl: configuredLocalOriginBaseUrl,
    },
  });
}
