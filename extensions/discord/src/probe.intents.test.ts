import { describe, expect, it } from "vitest";
import {
  fetchDiscordApplicationSummary,
  resolveDiscordPrivilegedIntentsFromFlags,
} from "./probe.js";
import { urlToString } from "./test-http-helpers.js";

describe("resolveDiscordPrivilegedIntentsFromFlags", () => {
  it("reports disabled when no bits set", () => {
    expect(resolveDiscordPrivilegedIntentsFromFlags(0)).toEqual({
      presence: "disabled",
      guildMembers: "disabled",
      messageContent: "disabled",
    });
  });

  it("reports enabled when full intent bits set", () => {
    const flags = (1 << 12) | (1 << 14) | (1 << 18);
    expect(resolveDiscordPrivilegedIntentsFromFlags(flags)).toEqual({
      presence: "enabled",
      guildMembers: "enabled",
      messageContent: "enabled",
    });
  });

  it("reports limited when limited intent bits set", () => {
    const flags = (1 << 13) | (1 << 15) | (1 << 19);
    expect(resolveDiscordPrivilegedIntentsFromFlags(flags)).toEqual({
      presence: "limited",
      guildMembers: "limited",
      messageContent: "limited",
    });
  });

  it("prefers enabled over limited when both set", () => {
    const flags = (1 << 12) | (1 << 13) | (1 << 14) | (1 << 15) | (1 << 18) | (1 << 19);
    expect(resolveDiscordPrivilegedIntentsFromFlags(flags)).toEqual({
      presence: "enabled",
      guildMembers: "enabled",
      messageContent: "enabled",
    });
  });

  it("retries application metadata HTML rate limits before returning no summary", async () => {
    let calls = 0;
    const fetcher = async (url: Request | URL | string) => {
      expect(urlToString(url)).toBe("https://discord.com/api/v10/oauth2/applications/@me");
      calls += 1;
      return new Response("<html><title>Error 1015</title><body>rate limited</body></html>", {
        status: 429,
        headers: { "Retry-After": "0" },
      });
    };

    const summary = await fetchDiscordApplicationSummary("token", 5000, fetcher);

    expect(summary).toBeUndefined();
    expect(calls).toBe(3);
  });
});
