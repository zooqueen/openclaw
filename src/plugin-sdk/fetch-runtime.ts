// Public fetch/proxy helpers for plugins that need wrapped fetch behavior.

import { retainSafeHeadersForCrossOriginRedirect } from "../infra/net/redirect-headers.js";
import type { DispatcherAwareRequestInit } from "../infra/net/runtime-fetch.js";
import { buildTimeoutAbortSignal } from "../utils/fetch-timeout.js";

export { resolveFetch, wrapFetchWithAbortSignal } from "../infra/fetch.js";
export {
  createHttp1Agent,
  createHttp1EnvHttpProxyAgent,
  createHttp1ProxyAgent,
} from "../infra/net/undici-runtime.js";
export {
  addActiveManagedProxyTlsOptions,
  resolveActiveManagedProxyTlsOptions,
} from "../infra/net/proxy/managed-proxy-undici.js";
export {
  createNodeProxyAgent,
  type CreateNodeProxyAgentOptions,
} from "../infra/net/node-proxy-agent.js";
export {
  hasEnvHttpProxyConfigured,
  hasEnvHttpProxyAgentConfigured,
  resolveEnvHttpProxyAgentOptions,
  resolveEnvHttpProxyUrl,
  shouldUseEnvHttpProxyForUrl,
} from "../infra/net/proxy-env.js";
export { getProxyUrlFromFetch, makeProxyFetch } from "../infra/net/proxy-fetch.js";
export { createPinnedLookup } from "../infra/net/ssrf.js";
export type { PinnedDispatcherPolicy } from "../infra/net/ssrf.js";

export type FetchWithResponseReleaseOptions = {
  url: string;
  init?: DispatcherAwareRequestInit;
  fetchImpl?: typeof fetch;
  followRedirects?: boolean;
  maxRedirects?: number;
  signal?: AbortSignal;
  timeoutMs?: number;
  validateUrl?: (url: URL) => void | Promise<void>;
};

export type FetchWithResponseReleaseResult = {
  response: Response;
  finalUrl: string;
  release: () => Promise<void>;
  refreshTimeout?: () => void;
};

const FETCH_WITH_RESPONSE_RELEASE_MAX_REDIRECTS = 10;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

function dropRedirectBodyHeaders(headers?: HeadersInit): Headers | undefined {
  if (!headers) {
    return undefined;
  }
  const next = new Headers(headers);
  next.delete("content-encoding");
  next.delete("content-language");
  next.delete("content-length");
  next.delete("content-location");
  next.delete("content-type");
  next.delete("transfer-encoding");
  return next;
}

function rewriteRedirectInitForMethod(init: RequestInit | undefined, status: number) {
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
    headers: dropRedirectBodyHeaders(init.headers),
  };
}

function rewriteRedirectInitForCrossOrigin(init: RequestInit | undefined) {
  if (!init) {
    return init;
  }
  const safeHeaders = retainSafeHeadersForCrossOriginRedirect(init.headers);
  const currentMethod = init.method?.toUpperCase() ?? "GET";
  if (currentMethod === "GET" || currentMethod === "HEAD") {
    return { ...init, headers: safeHeaders };
  }
  return {
    ...init,
    body: undefined,
    headers: dropRedirectBodyHeaders(safeHeaders),
  };
}

/** Performs ordinary fetch and preserves the common response cleanup pattern. */
export async function fetchWithResponseRelease(
  params: FetchWithResponseReleaseOptions,
): Promise<FetchWithResponseReleaseResult> {
  const fetchImpl = params.fetchImpl ?? globalThis.fetch;
  if (!fetchImpl) {
    throw new Error("fetch is not available");
  }
  const timeout = buildTimeoutAbortSignal({
    timeoutMs: params.timeoutMs,
    signal: params.signal ?? params.init?.signal ?? undefined,
    operation: "fetchWithResponseRelease",
    url: params.url,
  });
  let released = false;
  let response: Response | undefined;
  const release = async () => {
    if (released) {
      return;
    }
    released = true;
    timeout.cleanup();
    await response?.body?.cancel().catch(() => undefined);
  };
  try {
    let currentUrl = params.url;
    let currentInit: DispatcherAwareRequestInit | undefined = params.init
      ? { ...params.init }
      : undefined;
    const maxRedirects = Math.max(
      0,
      Math.floor(params.maxRedirects ?? FETCH_WITH_RESPONSE_RELEASE_MAX_REDIRECTS),
    );
    for (let redirectCount = 0; ; redirectCount += 1) {
      await params.validateUrl?.(new URL(currentUrl));
      response = await fetchImpl(currentUrl, {
        ...currentInit,
        redirect: "manual",
        ...(timeout.signal ? { signal: timeout.signal } : {}),
      });
      if (params.followRedirects === false || !REDIRECT_STATUSES.has(response.status)) {
        break;
      }
      const status = response.status;
      const location = response.headers.get("location");
      await response.body?.cancel().catch(() => undefined);
      response = undefined;
      if (!location) {
        throw new Error(`Redirect missing location header (${status})`);
      }
      if (redirectCount + 1 > maxRedirects) {
        throw new Error(`Too many redirects (limit: ${maxRedirects})`);
      }
      const currentParsedUrl = new URL(currentUrl);
      const nextParsedUrl = new URL(location, currentParsedUrl);
      await params.validateUrl?.(nextParsedUrl);
      currentInit = rewriteRedirectInitForMethod(currentInit, status);
      if (nextParsedUrl.origin !== currentParsedUrl.origin) {
        currentInit = rewriteRedirectInitForCrossOrigin(currentInit);
      }
      currentUrl = nextParsedUrl.toString();
      timeout.refresh();
    }
    return {
      response,
      finalUrl: response.url || currentUrl,
      release,
      refreshTimeout: timeout.refresh,
    };
  } catch (error) {
    timeout.cleanup();
    throw error;
  }
}
