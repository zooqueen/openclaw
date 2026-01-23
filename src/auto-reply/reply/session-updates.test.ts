import { describe, expect, it, vi } from "vitest";

import type { ClawdbotConfig } from "../../config/config.js";
import { enqueueSystemEvent, resetSystemEventsForTest } from "../../infra/system-events.js";
import { incrementCompactionCount, prependSystemEvents } from "./session-updates.js";

describe("prependSystemEvents", () => {
  it("adds a local timestamp to queued system events by default", async () => {
    vi.useFakeTimers();
    const originalTz = process.env.TZ;
    process.env.TZ = "America/Los_Angeles";
    const timestamp = new Date("2026-01-12T20:19:17Z");
    vi.setSystemTime(timestamp);

    enqueueSystemEvent("Model switched.", { sessionKey: "agent:main:main" });

    const result = await prependSystemEvents({
      cfg: {} as ClawdbotConfig,
      sessionKey: "agent:main:main",
      isMainSession: false,
      isNewSession: false,
      prefixedBodyBase: "User: hi",
    });

    expect(result).toMatch(/System: \[2026-01-12 12:19:17 [^\]]+\] Model switched\./);

    resetSystemEventsForTest();
    process.env.TZ = originalTz;
    vi.useRealTimers();
  });
});

describe("incrementCompactionCount", () => {
  it("updates cached total tokens after compaction without clearing input/output", async () => {
    const sessionKey = "agent:main:main";
    const sessionStore = {
      [sessionKey]: {
        sessionId: "s1",
        updatedAt: 10,
        compactionCount: 1,
        totalTokens: 9_000,
        inputTokens: 111,
        outputTokens: 222,
      },
    };
    const now = 1234;

    const nextCount = await incrementCompactionCount({
      sessionEntry: sessionStore[sessionKey],
      sessionStore,
      sessionKey,
      now,
      tokensAfter: 2_000,
    });

    expect(nextCount).toBe(2);
    expect(sessionStore[sessionKey]).toMatchObject({
      compactionCount: 2,
      totalTokens: 2_000,
      inputTokens: 111,
      outputTokens: 222,
      updatedAt: now,
    });
  });
});
