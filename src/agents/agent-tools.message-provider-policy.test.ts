/**
 * Tests message-provider tool filtering.
 * Voice-like transports should not expose text-to-speech when that surface is
 * unsafe or redundant for the active channel.
 */
import { describe, expect, it } from "vitest";
import {
  filterToolNamesByMessageProvider,
  filterToolsByMessageProvider,
} from "./agent-tools.message-provider-policy.js";

const DEFAULT_TOOL_NAMES = ["read", "write", "tts", "web_search"];

describe("createOpenClawCodingTools message provider policy", () => {
  it.each(["voice", "VOICE", " Voice ", "discord-voice", "DISCORD-VOICE", " Discord-Voice "])(
    "does not expose tts tool for normalized voice provider: %s",
    (messageProvider) => {
      const names = new Set(filterToolNamesByMessageProvider(DEFAULT_TOOL_NAMES, messageProvider));
      expect(names.has("tts")).toBe(false);
    },
  );

  it("keeps tts tool for non-voice providers", () => {
    const names = new Set(filterToolNamesByMessageProvider(DEFAULT_TOOL_NAMES, "guildchat"));
    expect(names.has("tts")).toBe(true);
  });

  it("skips unreadable tool names while preserving healthy duplicate tools", () => {
    const firstRead = { name: "read", id: 1 };
    const secondRead = { name: "read", id: 2 };
    const unreadableTool = {};
    Object.defineProperty(unreadableTool, "name", {
      get() {
        throw new Error("bad tool name");
      },
    });

    expect(
      filterToolsByMessageProvider(
        [
          firstRead,
          { name: "tts", id: 3 },
          unreadableTool as { name: string; id?: number },
          { name: 42 as unknown as string, id: 4 },
          secondRead,
        ],
        "voice",
      ),
    ).toEqual([firstRead, secondRead]);
  });
});
