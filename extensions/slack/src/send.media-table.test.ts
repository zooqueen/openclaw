import type { WebClient } from "@slack/web-api";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installSlackBlockTestMocks } from "./blocks.test-helpers.js";

installSlackBlockTestMocks();

vi.mock("@slack/web-api", () => ({
  WebClient: class SlackWebClientTestDouble {},
}));

const loadOutboundMediaFromUrlMock = vi.hoisted(() =>
  vi.fn(async (_mediaUrl: string, _options?: unknown) => ({
    buffer: Buffer.from("fake-image"),
    contentType: "image/png",
    fileName: "report.png",
  })),
);

const fetchWithSsrFGuard = vi.fn(
  async (params: { url: string; init?: RequestInit }) =>
    ({
      response: await fetch(params.url, params.init),
      finalUrl: params.url,
      release: async () => {},
    }) as const,
);

vi.mock("openclaw/plugin-sdk/ssrf-runtime", () => ({
  fetchWithSsrFGuard: (...args: unknown[]) =>
    fetchWithSsrFGuard(...(args as [params: { url: string; init?: RequestInit }])),
}));

vi.mock("openclaw/plugin-sdk/fetch-runtime", async () => {
  return {
    withTrustedEnvProxyGuardedFetchMode: (params: Record<string, unknown>) => params,
  };
});

vi.mock("./client.js", () => ({
  createSlackTokenCacheKey: (token: string) => `test:${token}`,
  getSlackWriteClient: () => {
    throw new Error("Slack media table tests must pass an explicit client");
  },
}));

vi.mock("./runtime-api.js", async () => {
  const actual = await vi.importActual<typeof import("./runtime-api.js")>("./runtime-api.js");
  return {
    ...actual,
    loadOutboundMediaFromUrl: (...args: Parameters<typeof actual.loadOutboundMediaFromUrl>) =>
      loadOutboundMediaFromUrlMock(...args),
  };
});

const { sendMessageSlack } = await import("./send.js");
const SLACK_TEST_CFG = { channels: { slack: { botToken: "xoxb-test" } } };

type MediaTableTestClient = WebClient & {
  conversations: { open: ReturnType<typeof vi.fn> };
  chat: { postMessage: ReturnType<typeof vi.fn> };
  files: {
    getUploadURLExternal: ReturnType<typeof vi.fn>;
    completeUploadExternal: ReturnType<typeof vi.fn>;
  };
};

function createMediaTableTestClient(): MediaTableTestClient {
  return {
    conversations: {
      open: vi.fn(async () => ({ channel: { id: "D123" } })),
    },
    chat: {
      postMessage: vi.fn(async () => ({ ts: "171234.567" })),
    },
    files: {
      getUploadURLExternal: vi.fn(async () => ({
        ok: true,
        upload_url: "https://uploads.slack.test/upload",
        file_id: "F123",
      })),
      completeUploadExternal: vi.fn(async () => ({ ok: true })),
    },
  } as unknown as MediaTableTestClient;
}

describe("sendMessageSlack media markdown tables", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = vi.fn(
      async () => new Response("ok", { status: 200 }),
    ) as unknown as typeof fetch;
    fetchWithSsrFGuard.mockClear();
    loadOutboundMediaFromUrlMock.mockClear();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("falls back to code-rendered tables when media upload prevents blocks", async () => {
    const client = createMediaTableTestClient();

    await sendMessageSlack("channel:C123", "| Name | Age |\n|---|---|\n| Alice | 30 |", {
      token: "xoxb-test",
      cfg: SLACK_TEST_CFG,
      client,
      mediaUrl: "https://example.com/report.png",
    });

    expect(client.chat.postMessage).not.toHaveBeenCalled();
    expect(client.files.completeUploadExternal).toHaveBeenCalledWith(
      expect.objectContaining({
        initial_comment: expect.stringContaining("| Name "),
      }),
    );
  });
});
