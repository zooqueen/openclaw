import { afterEach, describe, expect, it, vi } from "vitest";

import { twilioApiRequest } from "./api.js";

describe("twilioApiRequest", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("encodes array params as repeated form fields", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => "",
    });

    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    await twilioApiRequest({
      baseUrl: "https://api.example.com",
      accountSid: "AC123",
      authToken: "token",
      endpoint: "/Calls.json",
      body: {
        To: "+15555550123",
        StatusCallbackEvent: ["initiated", "completed"],
      },
    });

    const [, init] = fetchMock.mock.calls[0] ?? [];
    const body = init?.body as URLSearchParams | undefined;

    expect(body?.getAll("StatusCallbackEvent")).toEqual([
      "initiated",
      "completed",
    ]);
    expect(body?.get("To")).toBe("+15555550123");
  });
});
