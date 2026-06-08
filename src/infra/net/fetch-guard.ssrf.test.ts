// Deprecated fetch guard compatibility tests cover the remaining public API
// shape, redirect hygiene, and managed-proxy local-provider loopback behavior.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  fetchConfiguredLocalOriginWithSsrFGuard,
  fetchWithSsrFGuard,
  retainSafeHeadersForCrossOriginRedirectHeaders,
  withTrustedEnvProxyGuardedFetchMode,
} from "./fetch-guard.js";
import { resetActiveManagedProxyStateForTests } from "./proxy/active-proxy-state.js";
import { SsrFBlockedError } from "./ssrf.js";
import { TEST_UNDICI_RUNTIME_DEPS_KEY } from "./undici-runtime.js";

const { agentCtor, envHttpProxyAgentCtor, proxyAgentCtor, runtimeFetch } = vi.hoisted(() => ({
  agentCtor: vi.fn(function MockAgent(
    this: { close: () => Promise<void>; options: unknown },
    options: unknown,
  ) {
    this.options = options;
    this.close = async () => {};
  }),
  envHttpProxyAgentCtor: vi.fn(function MockEnvHttpProxyAgent(
    this: { close: () => Promise<void>; options: unknown },
    options: unknown,
  ) {
    this.options = options;
    this.close = async () => {};
  }),
  proxyAgentCtor: vi.fn(function MockProxyAgent(
    this: { close: () => Promise<void>; options: unknown },
    options: unknown,
  ) {
    this.options = options;
    this.close = async () => {};
  }),
  runtimeFetch: vi.fn(),
}));

function okResponse(body = "ok", url?: string): Response {
  const response = new Response(body, { status: 200 });
  if (url) {
    Object.defineProperty(response, "url", { value: url });
  }
  return response;
}

function redirectResponse(location: string, status = 302): Response {
  return new Response(null, {
    status,
    headers: { location },
  });
}

function installManagedProxyRuntime(loopbackMode: "gateway-only" | "proxy" | "block"): void {
  vi.stubEnv("OPENCLAW_PROXY_ACTIVE", "1");
  vi.stubEnv("OPENCLAW_PROXY_LOOPBACK_MODE", loopbackMode);
  vi.stubEnv("HTTP_PROXY", "http://127.0.0.1:7890");
  (globalThis as Record<string, unknown>)[TEST_UNDICI_RUNTIME_DEPS_KEY] = {
    Agent: agentCtor,
    EnvHttpProxyAgent: envHttpProxyAgentCtor,
    ProxyAgent: proxyAgentCtor,
    fetch: runtimeFetch,
  };
}

function createLoopbackLookup(): NonNullable<
  Parameters<typeof fetchConfiguredLocalOriginWithSsrFGuard>[0]["lookupFn"]
> {
  return vi.fn(async () => [{ address: "127.0.0.1", family: 4 }]) as unknown as NonNullable<
    Parameters<typeof fetchConfiguredLocalOriginWithSsrFGuard>[0]["lookupFn"]
  >;
}

describe("fetchWithSsrFGuard compatibility", () => {
  beforeEach(() => {
    agentCtor.mockClear();
    envHttpProxyAgentCtor.mockClear();
    proxyAgentCtor.mockClear();
    runtimeFetch.mockReset();
    resetActiveManagedProxyStateForTests();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    resetActiveManagedProxyStateForTests();
    delete (globalThis as Record<string, unknown>)[TEST_UNDICI_RUNTIME_DEPS_KEY];
  });

  it("keeps the deprecated helper as a direct fetch compatibility API", async () => {
    const fetchImpl = vi.fn(async () => okResponse("loopback"));

    const result = await fetchWithSsrFGuard({
      url: "http://127.0.0.1:11434/api/embed",
      fetchImpl,
    });

    expect(fetchImpl).toHaveBeenCalledWith(
      "http://127.0.0.1:11434/api/embed",
      expect.objectContaining({ redirect: "manual" }),
    );
    expect(result.finalUrl).toBe("http://127.0.0.1:11434/api/embed");
    expect(await result.response.text()).toBe("loopback");
    await result.release();
  });

  it("keeps injected fetch implementations when proxy dispatchers are selected", async () => {
    const calls: Array<{
      input: RequestInfo | URL;
      init?: RequestInit & { dispatcher?: unknown };
    }> = [];
    const fetchImpl = async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ input, init });
      return okResponse("proxied");
    };
    installManagedProxyRuntime("proxy");

    const result = await fetchWithSsrFGuard({
      ...withTrustedEnvProxyGuardedFetchMode({
        url: "https://api.example.com/v1/resources",
      }),
      fetchImpl,
    });

    expect(runtimeFetch).not.toHaveBeenCalled();
    expect(calls).toHaveLength(1);
    expect(calls[0]?.input).toBe("https://api.example.com/v1/resources");
    expect(calls[0]?.init?.dispatcher).toBeDefined();
    await result.release();
  });

  it("honors explicit hostname allowlists in the deprecated helper", async () => {
    const fetchImpl = vi.fn(async () => okResponse());

    await expect(
      fetchWithSsrFGuard({
        url: "https://blocked.example/resource",
        fetchImpl,
        policy: { hostnameAllowlist: ["allowed.example"] },
      }),
    ).rejects.toThrow(SsrFBlockedError);

    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("honors explicit origin allowlists in the deprecated helper", async () => {
    const fetchImpl = vi.fn(async () => okResponse());

    await expect(
      fetchWithSsrFGuard({
        url: "https://blocked.example:8443/resource",
        fetchImpl,
        policy: { allowedOrigins: ["https://allowed.example:8443"] },
      }),
    ).rejects.toThrow(SsrFBlockedError);

    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects redirects outside explicit hostname allowlists and cancels redirect bodies", async () => {
    let canceled = false;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("redirect"));
      },
      cancel() {
        canceled = true;
      },
    });
    const fetchImpl = vi.fn(
      async () =>
        new Response(body, {
          status: 302,
          headers: { location: "https://blocked.example/next" },
        }),
    );

    await expect(
      fetchWithSsrFGuard({
        url: "https://allowed.example/start",
        fetchImpl,
        policy: { hostnameAllowlist: ["allowed.example"] },
      }),
    ).rejects.toThrow(SsrFBlockedError);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(canceled).toBe(true);
  });

  it("cancels the final response body on release", async () => {
    let canceled = false;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("body"));
      },
      cancel() {
        canceled = true;
      },
    });
    const fetchImpl = vi.fn(async () => new Response(body, { status: 200 }));

    const result = await fetchWithSsrFGuard({
      url: "https://allowed.example/resource",
      fetchImpl,
    });
    await result.release();

    expect(canceled).toBe(true);
  });

  it("still rejects plain HTTP when requireHttps is set", async () => {
    const fetchImpl = vi.fn(async () => okResponse());

    await expect(
      fetchWithSsrFGuard({
        url: "http://example.com/resource",
        fetchImpl,
        requireHttps: true,
      }),
    ).rejects.toThrow(/https/i);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("still rejects non-HTTP schemes", async () => {
    const fetchImpl = vi.fn(async () => okResponse());

    await expect(
      fetchWithSsrFGuard({
        url: "data:text/plain,hello",
        fetchImpl,
      }),
    ).rejects.toThrow("fetchWithSsrFGuard only supports http and https URLs");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("strips sensitive headers and bodies on cross-origin redirects", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(redirectResponse("https://other.example/next", 307))
      .mockResolvedValueOnce(okResponse("done"));

    const result = await fetchWithSsrFGuard({
      url: "https://api.example/start",
      fetchImpl,
      init: {
        method: "POST",
        headers: {
          Accept: "application/json",
          Authorization: "Bearer secret",
          Cookie: "sid=secret",
          "Content-Type": "application/json",
          "X-Api-Key": "secret",
        },
        body: JSON.stringify({ ok: true }),
      },
    });

    const secondInit = fetchImpl.mock.calls[1]?.[1] as RequestInit | undefined;
    expect(secondInit?.body).toBeUndefined();
    const secondHeaders = new Headers(secondInit?.headers);
    expect(secondHeaders.get("accept")).toBe("application/json");
    expect(secondHeaders.has("authorization")).toBe(false);
    expect(secondHeaders.has("cookie")).toBe(false);
    expect(secondHeaders.has("content-type")).toBe(false);
    expect(secondHeaders.has("x-api-key")).toBe(false);
    expect(result.finalUrl).toBe("https://other.example/next");
    await result.release();
  });

  it("retains only redirect-safe headers in the exported header helper", () => {
    expect(
      retainSafeHeadersForCrossOriginRedirectHeaders({
        Accept: "application/json",
        Authorization: "Bearer secret",
        Cookie: "sid=secret",
        "X-Trace": "secret",
      }),
    ).toEqual({ accept: "application/json" });
  });

  it("preserves target TLS options for env-proxy dispatchers", async () => {
    installManagedProxyRuntime("proxy");
    runtimeFetch.mockResolvedValueOnce(okResponse("proxied"));

    const result = await fetchWithSsrFGuard({
      url: "https://api.example/v1/models",
      dispatcherPolicy: {
        mode: "env-proxy",
        connect: { ca: "target-ca" },
      },
    });
    await result.release();

    expect(envHttpProxyAgentCtor).toHaveBeenCalledOnce();
    expect(envHttpProxyAgentCtor.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        connect: expect.objectContaining({ ca: "target-ca" }),
        requestTls: expect.objectContaining({ ca: "target-ca" }),
      }),
    );
  });

  it("routes direct dispatcher policies through env proxy routing when proxy env applies", async () => {
    installManagedProxyRuntime("proxy");
    const fetchImpl = async (_input: RequestInfo | URL, _init?: RequestInit) =>
      okResponse("proxied");

    const result = await fetchWithSsrFGuard({
      url: "https://api.example/v1/models",
      fetchImpl,
      dispatcherPolicy: {
        mode: "direct",
        connect: { ca: "target-ca" },
      },
    });
    await result.release();

    expect(agentCtor).not.toHaveBeenCalled();
    expect(envHttpProxyAgentCtor).toHaveBeenCalledOnce();
    expect(envHttpProxyAgentCtor.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        connect: expect.objectContaining({ ca: "target-ca" }),
        requestTls: expect.objectContaining({ ca: "target-ca" }),
      }),
    );
  });

  it("routes injected fetch calls through env proxy routing when no dispatcher policy is supplied", async () => {
    installManagedProxyRuntime("proxy");
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      okResponse("proxied"),
    );

    const result = await fetchWithSsrFGuard({
      url: "https://api.example/v1/models",
      fetchImpl,
    });
    await result.release();

    expect(runtimeFetch).not.toHaveBeenCalled();
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(agentCtor).not.toHaveBeenCalled();
    expect(envHttpProxyAgentCtor).toHaveBeenCalledOnce();
    expect(fetchImpl.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({
        dispatcher: expect.any(Object),
      }),
    );
  });

  it("does not expose internal managed-proxy bypass through the public helper", async () => {
    installManagedProxyRuntime("gateway-only");
    const fetchImpl = vi.fn(async () => okResponse("public"));

    const result = await fetchWithSsrFGuard({
      url: "http://127.0.0.1:11434/api/embed",
      fetchImpl,
      lookupFn: createLoopbackLookup(),
      managedProxyBypass: {
        kind: "configured-local-origin",
        baseUrl: "http://127.0.0.1:11434",
      },
    } as Parameters<typeof fetchWithSsrFGuard>[0] & Record<string, unknown>);
    await result.release();

    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(agentCtor).not.toHaveBeenCalled();
    expect(envHttpProxyAgentCtor).toHaveBeenCalledOnce();
  });

  it("bypasses the managed proxy for exact configured loopback origins in gateway-only mode", async () => {
    installManagedProxyRuntime("gateway-only");
    const lookupFn = createLoopbackLookup();
    const fetchImpl = vi.fn(async () => okResponse());

    const result = await fetchConfiguredLocalOriginWithSsrFGuard({
      url: "http://127.0.0.1:11434/api/embed",
      fetchImpl,
      lookupFn,
      configuredLocalOriginBaseUrl: "http://127.0.0.1:11434",
    });

    expect(agentCtor).toHaveBeenCalledOnce();
    expect(envHttpProxyAgentCtor).not.toHaveBeenCalled();
    expect(fetchImpl).toHaveBeenCalledOnce();
    await result.release();
  });

  it("routes configured loopback origins through the managed proxy in proxy mode", async () => {
    installManagedProxyRuntime("proxy");
    const lookupFn = createLoopbackLookup();
    const fetchImpl = vi.fn(async () => okResponse());

    const result = await fetchConfiguredLocalOriginWithSsrFGuard({
      url: "http://127.0.0.1:11434/api/embed",
      fetchImpl,
      lookupFn,
      configuredLocalOriginBaseUrl: "http://127.0.0.1:11434",
    });

    expect(agentCtor).not.toHaveBeenCalled();
    expect(envHttpProxyAgentCtor).toHaveBeenCalledOnce();
    expect(fetchImpl).toHaveBeenCalledOnce();
    await result.release();
  });

  it("honors proxy.loopbackMode=block for configured loopback origins", async () => {
    installManagedProxyRuntime("block");
    const lookupFn = createLoopbackLookup();
    const fetchImpl = vi.fn(async () => okResponse());

    await expect(
      fetchConfiguredLocalOriginWithSsrFGuard({
        url: "http://127.0.0.1:11434/api/embed",
        fetchImpl,
        lookupFn,
        configuredLocalOriginBaseUrl: "http://127.0.0.1:11434",
      }),
    ).rejects.toThrow("blocked by proxy.loopbackMode");
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
