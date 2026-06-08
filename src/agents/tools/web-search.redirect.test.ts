// web_search redirect tests cover citation URL HEAD resolution behavior.
import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveCitationRedirectUrl } from "./web-search-citation-redirect.js";

describe("web_search redirect resolution hardening", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("resolves redirects via HEAD requests", async () => {
    const fetchMock = vi.fn(async () => {
      const response = new Response(null, { status: 200 });
      Object.defineProperty(response, "url", { value: "https://example.com/final" });
      return response;
    });
    vi.stubGlobal("fetch", fetchMock);

    const resolved = await resolveCitationRedirectUrl("https://example.com/start");
    expect(resolved).toBe("https://example.com/final");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const call = fetchMock.mock.calls.at(0) as
      | [string, { method?: unknown; signal?: unknown }]
      | undefined;
    expect(call?.[0]).toBe("https://example.com/start");
    expect(call?.[1]?.method).toBe("HEAD");
    expect(call?.[1]?.signal).toBeInstanceOf(AbortSignal);
  });

  it("falls back to the original URL when redirect resolution fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("blocked");
      }),
    );
    await expect(resolveCitationRedirectUrl("https://example.com/start")).resolves.toBe(
      "https://example.com/start",
    );
  });
});
