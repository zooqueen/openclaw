import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createWebFetchTool, createWebSearchTool } from "./web-tools.js";

describe("web tools defaults", () => {
  it("enables web_fetch by default (non-sandbox)", () => {
    const tool = createWebFetchTool({ config: {}, sandboxed: false });
    expect(tool?.name).toBe("web_fetch");
  });

  it("disables web_fetch when explicitly disabled", () => {
    const tool = createWebFetchTool({
      config: { tools: { web: { fetch: { enabled: false } } } },
      sandboxed: false,
    });
    expect(tool).toBeNull();
  });

  it("enables web_search by default", () => {
    const tool = createWebSearchTool({ config: {}, sandboxed: false });
    expect(tool?.name).toBe("web_search");
  });
});

describe("web_search country and language parameters", () => {
  const priorFetch = global.fetch;

  beforeEach(() => {
    vi.stubEnv("BRAVE_API_KEY", "test-key");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    // @ts-expect-error global fetch cleanup
    global.fetch = priorFetch;
  });

  it("should pass country parameter to Brave API", async () => {
    const mockFetch = vi.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ web: { results: [] } }),
      } as Response),
    );
    // @ts-expect-error mock fetch
    global.fetch = mockFetch;

    const tool = createWebSearchTool({ config: undefined, sandboxed: true });
    expect(tool).not.toBeNull();

    await tool?.execute?.(1, { query: "test", country: "DE" });

    expect(mockFetch).toHaveBeenCalled();
    const url = new URL(mockFetch.mock.calls[0][0] as string);
    expect(url.searchParams.get("country")).toBe("DE");
  });

  it("should pass search_lang parameter to Brave API", async () => {
    const mockFetch = vi.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ web: { results: [] } }),
      } as Response),
    );
    // @ts-expect-error mock fetch
    global.fetch = mockFetch;

    const tool = createWebSearchTool({ config: undefined, sandboxed: true });
    await tool?.execute?.(1, { query: "test", search_lang: "de" });

    const url = new URL(mockFetch.mock.calls[0][0] as string);
    expect(url.searchParams.get("search_lang")).toBe("de");
  });

  it("should pass ui_lang parameter to Brave API", async () => {
    const mockFetch = vi.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ web: { results: [] } }),
      } as Response),
    );
    // @ts-expect-error mock fetch
    global.fetch = mockFetch;

    const tool = createWebSearchTool({ config: undefined, sandboxed: true });
    await tool?.execute?.(1, { query: "test", ui_lang: "de" });

    const url = new URL(mockFetch.mock.calls[0][0] as string);
    expect(url.searchParams.get("ui_lang")).toBe("de");
  });
});

describe("web_search Perplexity provider configuration", () => {
  const priorFetch = global.fetch;

  beforeEach(() => {
    vi.stubEnv("PERPLEXITY_API_KEY", "pplx-test");
    vi.stubEnv("OPENROUTER_API_KEY", "sk-or-test");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    // @ts-expect-error global fetch cleanup
    global.fetch = priorFetch;
  });

  it("defaults to Perplexity base URL when PERPLEXITY_API_KEY is set", async () => {
    const mockFetch = vi.fn((_input: RequestInfo, _init?: RequestInit) =>
      Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            choices: [{ message: { content: "ok" } }],
            citations: [],
          }),
      } as Response),
    );
    // @ts-expect-error mock fetch
    global.fetch = mockFetch;

    const tool = createWebSearchTool({
      config: { tools: { web: { search: { provider: "perplexity" } } } },
      sandboxed: true,
    });

    await tool?.execute?.(1, { query: "test" });

    expect(mockFetch).toHaveBeenCalled();
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit?];
    expect(url).toBe("https://api.perplexity.ai/chat/completions");
    const headers = (init?.headers ?? {}) as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer pplx-test");
  });

  it("uses OpenRouter base URL when configured, even with PERPLEXITY_API_KEY set", async () => {
    const mockFetch = vi.fn((_input: RequestInfo, _init?: RequestInit) =>
      Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            choices: [{ message: { content: "ok" } }],
            citations: [],
          }),
      } as Response),
    );
    // @ts-expect-error mock fetch
    global.fetch = mockFetch;

    const tool = createWebSearchTool({
      config: {
        tools: {
          web: {
            search: { provider: "perplexity", perplexity: { baseUrl: "https://openrouter.ai/api/v1" } },
          },
        },
      },
      sandboxed: true,
    });

    await tool?.execute?.(1, { query: "test" });

    expect(mockFetch).toHaveBeenCalled();
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit?];
    expect(url).toBe("https://openrouter.ai/api/v1/chat/completions");
    const headers = (init?.headers ?? {}) as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer sk-or-test");
  });

  it("returns missing key when OpenRouter base URL is configured without OPENROUTER_API_KEY", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "");
    const mockFetch = vi.fn();
    // @ts-expect-error mock fetch
    global.fetch = mockFetch;

    const tool = createWebSearchTool({
      config: {
        tools: {
          web: {
            search: { provider: "perplexity", perplexity: { baseUrl: "https://openrouter.ai/api/v1" } },
          },
        },
      },
      sandboxed: true,
    });

    const result = await tool?.execute?.(1, { query: "test" });
    expect(mockFetch).not.toHaveBeenCalled();
    expect(result?.details).toMatchObject({ error: "missing_openrouter_api_key" });
  });
});
