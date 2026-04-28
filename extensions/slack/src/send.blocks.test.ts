import { describe, expect, it, vi } from "vitest";
import { createSlackSendTestClient, installSlackBlockTestMocks } from "./blocks.test-helpers.js";

vi.mock("@slack/web-api", () => ({
  WebClient: class SlackWebClientTestDouble {},
}));

vi.mock("openclaw/plugin-sdk/fetch-runtime", () => ({
  withTrustedEnvProxyGuardedFetchMode: (params: Record<string, unknown>) => params,
}));

vi.mock("openclaw/plugin-sdk/ssrf-runtime", () => ({
  fetchWithSsrFGuard: vi.fn(async () => {
    throw new Error("unexpected Slack upload fetch in block test");
  }),
}));

vi.mock("./client.js", () => ({
  createSlackTokenCacheKey: (token: string) => `test:${token}`,
  getSlackWriteClient: () => {
    throw new Error("Slack block tests must pass an explicit client");
  },
}));

installSlackBlockTestMocks();
const { sendMessageSlack } = await import("./send.js");
const SLACK_TEST_CFG = { channels: { slack: { botToken: "xoxb-test" } } };

describe("sendMessageSlack NO_REPLY guard", () => {
  it("suppresses NO_REPLY text before any Slack API call", async () => {
    const client = createSlackSendTestClient();
    const result = await sendMessageSlack("channel:C123", "NO_REPLY", {
      token: "xoxb-test",
      cfg: SLACK_TEST_CFG,
      client,
    });

    expect(client.chat.postMessage).not.toHaveBeenCalled();
    expect(result.messageId).toBe("suppressed");
  });

  it("suppresses NO_REPLY with surrounding whitespace", async () => {
    const client = createSlackSendTestClient();
    const result = await sendMessageSlack("channel:C123", "  NO_REPLY  ", {
      token: "xoxb-test",
      cfg: SLACK_TEST_CFG,
      client,
    });

    expect(client.chat.postMessage).not.toHaveBeenCalled();
    expect(result.messageId).toBe("suppressed");
  });

  it("does not suppress substantive text containing NO_REPLY", async () => {
    const client = createSlackSendTestClient();
    await sendMessageSlack("channel:C123", "This is not a NO_REPLY situation", {
      token: "xoxb-test",
      cfg: SLACK_TEST_CFG,
      client,
    });

    expect(client.chat.postMessage).toHaveBeenCalled();
  });

  it("does not suppress NO_REPLY when blocks are attached", async () => {
    const client = createSlackSendTestClient();
    const result = await sendMessageSlack("channel:C123", "NO_REPLY", {
      token: "xoxb-test",
      cfg: SLACK_TEST_CFG,
      client,
      blocks: [{ type: "section", text: { type: "mrkdwn", text: "content" } }],
    });

    expect(client.chat.postMessage).toHaveBeenCalled();
    expect(result.messageId).toBe("171234.567");
  });
});

describe("sendMessageSlack chunking", () => {
  it("keeps 4205-character text in a single Slack post by default", async () => {
    const client = createSlackSendTestClient();
    const message = "a".repeat(4205);

    await sendMessageSlack("channel:C123", message, {
      token: "xoxb-test",
      cfg: SLACK_TEST_CFG,
      client,
    });

    expect(client.chat.postMessage).toHaveBeenCalledTimes(1);
    expect(client.chat.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: "C123",
        text: message,
      }),
    );
  });

  it("splits oversized fallback text through the normal Slack sender", async () => {
    const client = createSlackSendTestClient();
    const message = "a".repeat(8500);

    await sendMessageSlack("channel:C123", message, {
      token: "xoxb-test",
      cfg: SLACK_TEST_CFG,
      client,
    });

    const postedTexts = client.chat.postMessage.mock.calls.map((call) => call[0].text);

    expect(postedTexts).toHaveLength(2);
    expect(postedTexts.every((text) => typeof text === "string" && text.length <= 8000)).toBe(true);
    expect(postedTexts.join("")).toBe(message);
  });
});

describe("sendMessageSlack markdown tables", () => {
  it("sends Slack Block Kit table blocks for markdown tables", async () => {
    const client = createSlackSendTestClient();
    await sendMessageSlack("channel:C123", "Before\n\n| Name | Age |\n|---|---|\n| Alice | 30 |", {
      token: "xoxb-test",
      cfg: SLACK_TEST_CFG,
      client,
    });

    expect(client.chat.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: "C123",
        text: expect.stringContaining("| Name "),
        blocks: [
          {
            type: "section",
            text: { type: "mrkdwn", text: "Before" },
          },
          {
            type: "table",
            rows: [
              [
                { type: "raw_text", text: "Name" },
                { type: "raw_text", text: "Age" },
              ],
              [
                { type: "raw_text", text: "Alice" },
                { type: "raw_text", text: "30" },
              ],
            ],
            column_settings: [{ is_wrapped: true }, { is_wrapped: true }],
          },
        ],
      }),
    );
  });
});

describe("sendMessageSlack blocks", () => {
  it("posts blocks with fallback text when message is empty", async () => {
    const client = createSlackSendTestClient();
    const result = await sendMessageSlack("channel:C123", "", {
      token: "xoxb-test",
      cfg: SLACK_TEST_CFG,
      client,
      blocks: [{ type: "divider" }],
    });

    expect(client.conversations.open).not.toHaveBeenCalled();
    expect(client.chat.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: "C123",
        text: "Shared a Block Kit message",
        blocks: [{ type: "divider" }],
      }),
    );
    expect(result).toEqual({ messageId: "171234.567", channelId: "C123" });
  });

  it("derives fallback text from image blocks", async () => {
    const client = createSlackSendTestClient();
    await sendMessageSlack("channel:C123", "", {
      token: "xoxb-test",
      cfg: SLACK_TEST_CFG,
      client,
      blocks: [{ type: "image", image_url: "https://example.com/a.png", alt_text: "Build chart" }],
    });

    expect(client.chat.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        text: "Build chart",
      }),
    );
  });

  it("derives fallback text from video blocks", async () => {
    const client = createSlackSendTestClient();
    await sendMessageSlack("channel:C123", "", {
      token: "xoxb-test",
      cfg: SLACK_TEST_CFG,
      client,
      blocks: [
        {
          type: "video",
          title: { type: "plain_text", text: "Release demo" },
          video_url: "https://example.com/demo.mp4",
          thumbnail_url: "https://example.com/thumb.jpg",
          alt_text: "demo",
        },
      ],
    });

    expect(client.chat.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        text: "Release demo",
      }),
    );
  });

  it("derives fallback text from file blocks", async () => {
    const client = createSlackSendTestClient();
    await sendMessageSlack("channel:C123", "", {
      token: "xoxb-test",
      cfg: SLACK_TEST_CFG,
      client,
      blocks: [{ type: "file", source: "remote", external_id: "F123" }],
    });

    expect(client.chat.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        text: "Shared a file",
      }),
    );
  });

  it("rejects blocks combined with mediaUrl", async () => {
    const client = createSlackSendTestClient();
    await expect(
      sendMessageSlack("channel:C123", "hi", {
        token: "xoxb-test",
        cfg: SLACK_TEST_CFG,
        client,
        mediaUrl: "https://example.com/image.png",
        blocks: [{ type: "divider" }],
      }),
    ).rejects.toThrow(/does not support blocks with mediaUrl/i);
    expect(client.chat.postMessage).not.toHaveBeenCalled();
  });

  it("rejects empty blocks arrays from runtime callers", async () => {
    const client = createSlackSendTestClient();
    await expect(
      sendMessageSlack("channel:C123", "hi", {
        token: "xoxb-test",
        cfg: SLACK_TEST_CFG,
        client,
        blocks: [],
      }),
    ).rejects.toThrow(/must contain at least one block/i);
    expect(client.chat.postMessage).not.toHaveBeenCalled();
  });

  it("rejects blocks arrays above Slack max count", async () => {
    const client = createSlackSendTestClient();
    const blocks = Array.from({ length: 51 }, () => ({ type: "divider" }));
    await expect(
      sendMessageSlack("channel:C123", "hi", {
        token: "xoxb-test",
        cfg: SLACK_TEST_CFG,
        client,
        blocks,
      }),
    ).rejects.toThrow(/cannot exceed 50 items/i);
    expect(client.chat.postMessage).not.toHaveBeenCalled();
  });

  it("rejects blocks missing type from runtime callers", async () => {
    const client = createSlackSendTestClient();
    await expect(
      sendMessageSlack("channel:C123", "hi", {
        token: "xoxb-test",
        cfg: SLACK_TEST_CFG,
        client,
        blocks: [{} as { type: string }],
      }),
    ).rejects.toThrow(/non-empty string type/i);
    expect(client.chat.postMessage).not.toHaveBeenCalled();
  });
});
