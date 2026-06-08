/**
 * MCP HTTP fetch wrappers.
 * Adds scoped TLS/client-cert dispatchers, response cleanup, and same-origin
 * header handling around the MCP SDK fetch contract.
 */
import fs from "node:fs";
import type { FetchLike } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { Dispatcher } from "undici";
import { shouldUseEnvHttpProxyForUrl } from "../infra/net/proxy-env.js";
import { retainSafeHeadersForCrossOriginRedirect } from "../infra/net/redirect-headers.js";
import {
  fetchWithRuntimeDispatcher,
  type DispatcherAwareRequestInit,
} from "../infra/net/runtime-fetch.js";
import { closeDispatcher } from "../infra/net/ssrf.js";
import {
  createHttp1Agent,
  createHttp1EnvHttpProxyAgent,
  loadUndiciRuntimeDeps,
} from "../infra/net/undici-runtime.js";
import { resolveDebugProxySettings } from "../proxy-capture/env.js";

/** MCP SDK-compatible fetch function type. */
export type { FetchLike };

/** Default MCP HTTP fetch backed by lazy-loaded undici runtime deps. */
export const fetchWithUndici: FetchLike = async (url, init) =>
  (await loadUndiciRuntimeDeps().fetch(
    url,
    init as Parameters<ReturnType<typeof loadUndiciRuntimeDeps>["fetch"]>[1],
  )) as unknown as Response;

const MCP_HTTP_MAX_REDIRECTS = 20;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const managedMcpResponseCleanupRegistry = new FinalizationRegistry<{
  finalize: () => Promise<void>;
}>((held) => {
  void held.finalize();
});

function resolveFetchRequest(input: RequestInfo | URL, init?: RequestInit) {
  if (input instanceof Request) {
    const request = new Request(input, init);
    const body = request.body ?? undefined;
    return {
      url: request.url,
      init: {
        method: request.method,
        headers: request.headers,
        body,
        redirect: request.redirect,
        signal: request.signal,
        ...(body ? ({ duplex: "half" } as const) : {}),
      } satisfies RequestInit & { duplex?: "half" },
    };
  }
  return {
    url: input instanceof URL ? input.toString() : input,
    init,
  };
}

async function captureMcpHttpExchange(params: {
  url: string;
  init?: RequestInit;
  response: Response;
}): Promise<void> {
  const settings = resolveDebugProxySettings();
  if (!settings.enabled) {
    return;
  }
  const { captureHttpExchange } = await import("../proxy-capture/runtime.js");
  captureHttpExchange(
    {
      url: params.url,
      method: params.init?.method ?? "GET",
      requestHeaders: params.init?.headers as Headers | Record<string, string> | undefined,
      requestBody:
        (params.init as (RequestInit & { body?: BodyInit | Buffer | string | null }) | undefined)
          ?.body ?? null,
      response: params.response,
      transport: "http",
      meta: {
        captureOrigin: "mcp-http",
        auditContext: "mcp-http",
      },
    },
    settings,
  );
}

function buildManagedMcpResponse(
  response: Response,
  release: () => Promise<void>,
  refreshTimeout?: () => void,
): Response {
  if (!response.body) {
    void release();
    return response;
  }

  const source = response.body;
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let released = false;
  const cleanupRegistrationToken = {};
  const finalize = async () => {
    if (released) {
      return;
    }
    released = true;
    managedMcpResponseCleanupRegistry.unregister(cleanupRegistrationToken);
    await reader?.cancel().catch(() => undefined);
    await release().catch(() => undefined);
  };
  const wrappedBody = new ReadableStream<Uint8Array>({
    start() {
      reader = source.getReader();
    },
    async pull(controller) {
      try {
        const chunk = await reader?.read();
        if (!chunk || chunk.done) {
          controller.close();
          await finalize();
          return;
        }
        refreshTimeout?.();
        controller.enqueue(chunk.value);
      } catch (error) {
        controller.error(error);
        await finalize();
      }
    },
    async cancel(reason) {
      try {
        await reader?.cancel(reason);
      } finally {
        await finalize();
      }
    },
  });
  managedMcpResponseCleanupRegistry.register(wrappedBody, { finalize }, cleanupRegistrationToken);
  return new Response(wrappedBody, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

function dropBodyHeaders(headers?: HeadersInit): HeadersInit | undefined {
  if (!headers) {
    return headers;
  }
  const nextHeaders = new Headers(headers);
  nextHeaders.delete("content-encoding");
  nextHeaders.delete("content-language");
  nextHeaders.delete("content-length");
  nextHeaders.delete("content-location");
  nextHeaders.delete("content-type");
  nextHeaders.delete("transfer-encoding");
  return nextHeaders;
}

function rewriteRedirectInitForStatus(
  init: RequestInit | undefined,
  status: number,
): RequestInit | undefined {
  if (!init) {
    return init;
  }
  const method = init.method?.toUpperCase() ?? "GET";
  const shouldForceGet =
    status === 303
      ? method !== "GET" && method !== "HEAD"
      : (status === 301 || status === 302) && method === "POST";
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

function rewriteRedirectInitForCrossOrigin(init: RequestInit | undefined): RequestInit | undefined {
  if (!init) {
    return init;
  }
  const method = init.method?.toUpperCase() ?? "GET";
  const headers = retainSafeHeadersForCrossOriginRedirect(init.headers);
  if (method === "GET" || method === "HEAD") {
    return { ...init, headers };
  }
  return {
    ...init,
    body: undefined,
    headers: dropBodyHeaders(headers),
  };
}

function mcpRedirectVisitKey(url: string, init: RequestInit | undefined): string {
  return `${init?.method?.toUpperCase() ?? "GET"} ${url}`;
}

/** Builds an MCP fetch function with optional TLS/client-cert dispatcher support. */
export function buildMcpHttpFetch(params: {
  sslVerify?: boolean;
  clientCert?: string;
  clientKey?: string;
  resourceUrl?: string;
  allowNonResourceOriginRequests?: boolean;
}): FetchLike {
  const needsCustomDispatcher =
    params.sslVerify === false || Boolean(params.clientCert || params.clientKey);
  const scopedOrigin = params.resourceUrl ? new URL(params.resourceUrl).origin : undefined;
  const allowedOrigins = scopedOrigin ? new Set([scopedOrigin]) : undefined;

  let customConnect: Record<string, unknown> | undefined;
  const resolveCustomDispatcher = (url: URL): Dispatcher | undefined => {
    if (!needsCustomDispatcher || !scopedOrigin || url.origin !== scopedOrigin) {
      return undefined;
    }
    customConnect ??= {
      ...(params.sslVerify === false ? { rejectUnauthorized: false } : {}),
      ...(params.clientCert ? { cert: fs.readFileSync(params.clientCert, "utf-8") } : {}),
      ...(params.clientKey ? { key: fs.readFileSync(params.clientKey, "utf-8") } : {}),
    };
    if (shouldUseEnvHttpProxyForUrl(url.toString())) {
      return createHttp1EnvHttpProxyAgent({
        connect: { ...customConnect },
        requestTls: { ...customConnect },
      });
    }
    return createHttp1Agent({ connect: { ...customConnect } });
  };

  return async (url, init) => {
    const request = resolveFetchRequest(url, init);
    let currentUrl = request.url;
    let currentInit = request.init;
    let redirectCount = 0;
    const redirectVisits = new Set<string>();
    let activeDispatcher: Dispatcher | undefined;
    let released = false;
    const release = async () => {
      if (released) {
        return;
      }
      released = true;
      await closeDispatcher(activeDispatcher);
    };
    try {
      while (true) {
        const parsed = new URL(currentUrl);
        const visitKey = mcpRedirectVisitKey(currentUrl, currentInit);
        if (redirectVisits.has(visitKey)) {
          throw new Error("Redirect loop detected");
        }
        redirectVisits.add(visitKey);
        if (
          allowedOrigins &&
          !allowedOrigins.has(parsed.origin) &&
          params.allowNonResourceOriginRequests !== true
        ) {
          throw new Error(
            `MCP HTTP fetch blocked outside configured resource origin: ${parsed.origin}`,
          );
        }
        activeDispatcher =
          resolveCustomDispatcher(parsed) ??
          (shouldUseEnvHttpProxyForUrl(parsed.toString())
            ? createHttp1EnvHttpProxyAgent()
            : createHttp1Agent());
        const requestInit: DispatcherAwareRequestInit = {
          ...(currentInit ? { ...currentInit } : {}),
          redirect: "manual",
          dispatcher: activeDispatcher,
        };
        const response = await fetchWithRuntimeDispatcher(currentUrl, requestInit);
        await captureMcpHttpExchange({ url: currentUrl, init: requestInit, response });
        if (!REDIRECT_STATUSES.has(response.status)) {
          return buildManagedMcpResponse(response, release);
        }
        const location = response.headers.get("location");
        await response.body?.cancel().catch(() => undefined);
        await closeDispatcher(activeDispatcher);
        activeDispatcher = undefined;
        if (!location) {
          throw new Error(`Redirect missing location header (${response.status})`);
        }
        redirectCount += 1;
        if (redirectCount > MCP_HTTP_MAX_REDIRECTS) {
          throw new Error(`Too many redirects (limit: ${MCP_HTTP_MAX_REDIRECTS})`);
        }
        const nextParsed = new URL(location, currentUrl);
        if (
          allowedOrigins &&
          allowedOrigins.has(parsed.origin) &&
          !allowedOrigins.has(nextParsed.origin)
        ) {
          throw new Error(
            `MCP HTTP fetch blocked outside configured resource origin: ${nextParsed.origin}`,
          );
        }
        if (
          allowedOrigins &&
          !allowedOrigins.has(nextParsed.origin) &&
          params.allowNonResourceOriginRequests !== true
        ) {
          throw new Error(
            `MCP HTTP fetch blocked outside configured resource origin: ${nextParsed.origin}`,
          );
        }
        currentInit = rewriteRedirectInitForStatus(currentInit, response.status);
        if (nextParsed.origin !== parsed.origin) {
          currentInit = rewriteRedirectInitForCrossOrigin(currentInit);
        }
        currentUrl = nextParsed.toString();
      }
    } catch (error) {
      await release();
      throw error;
    }
  };
}

/** Removes Authorization from MCP headers before forwarding to non-authorized paths. */
export function withoutMcpAuthorizationHeader(
  headers: Record<string, string> | undefined,
): Record<string, string> | undefined {
  if (!headers) {
    return undefined;
  }
  const entries = Object.entries(headers).filter(([key]) => key.toLowerCase() !== "authorization");
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

/** Wraps MCP fetch so configured headers are applied only to the resource origin. */
export function withSameOriginMcpHttpHeaders(params: {
  fetchFn: FetchLike;
  headers: Record<string, string> | undefined;
  resourceUrl: string;
}): FetchLike {
  if (!params.headers || Object.keys(params.headers).length === 0) {
    return params.fetchFn;
  }
  const resourceOrigin = new URL(params.resourceUrl).origin;
  return (url, init) => {
    if (new URL(url).origin !== resourceOrigin) {
      return params.fetchFn(url, init);
    }
    const headers = new Headers(params.headers);
    for (const [key, value] of new Headers(init?.headers)) {
      headers.set(key, value);
    }
    return params.fetchFn(url, { ...(init as RequestInit), headers });
  };
}
