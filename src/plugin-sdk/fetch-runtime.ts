// Public fetch/proxy helpers for plugins that need wrapped fetch behavior.

import {
  fetchOperatorConfiguredEndpoint as fetchOperatorConfiguredEndpointInternal,
  fetchUntrustedUrl as fetchUntrustedUrlInternal,
  fetchWithResponseRelease as fetchWithResponseReleaseInternal,
  type FetchWithResponseReleaseResult,
} from "../infra/net/egress-fetch.js";

export { resolveFetch, wrapFetchWithAbortSignal } from "../infra/fetch.js";
export { type FetchWithResponseReleaseResult } from "../infra/net/egress-fetch.js";
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

type FetchRuntimeRequestInit = RequestInit & {
  dispatcher?: unknown;
};

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export type FetchRuntimeOptions = {
  url: string;
  init?: FetchRuntimeRequestInit;
  fetchImpl?: FetchLike;
  followRedirects?: boolean;
  maxRedirects?: number;
  signal?: AbortSignal;
  timeoutMs?: number;
  operation?: string;
  validateUrl?: (
    url: URL,
    context: { previousUrl?: URL; redirectCount: number },
  ) => void | Promise<void>;
  useEnvProxy?: boolean;
  allowCrossOriginUnsafeRedirectReplay?: boolean;
  onResponse?: (params: {
    url: string;
    init: FetchRuntimeRequestInit;
    response: Response;
    capturedByGlobalFetchPatch: boolean;
    usingRuntimeFetch: boolean;
  }) => void | Promise<void>;
};

export type FetchWithResponseReleaseOptions = FetchRuntimeOptions;

export async function fetchWithResponseRelease(
  params: FetchRuntimeOptions,
): Promise<FetchWithResponseReleaseResult> {
  return await fetchWithResponseReleaseInternal(
    params as Parameters<typeof fetchWithResponseReleaseInternal>[0],
  );
}

export async function fetchOperatorConfiguredEndpoint(
  params: FetchRuntimeOptions,
): Promise<FetchWithResponseReleaseResult> {
  return await fetchOperatorConfiguredEndpointInternal(
    params as Parameters<typeof fetchOperatorConfiguredEndpointInternal>[0],
  );
}

export async function fetchUntrustedUrl(
  params: FetchRuntimeOptions,
): Promise<FetchWithResponseReleaseResult> {
  return await fetchUntrustedUrlInternal(params as Parameters<typeof fetchUntrustedUrlInternal>[0]);
}
