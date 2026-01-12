import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { withTempHome as withTempHomeBase } from "../../test/helpers/temp-home.js";
import { loadModelCatalog } from "../agents/model-catalog.js";
import { runEmbeddedPiAgent } from "../agents/pi-embedded.js";
import { getReplyFromConfig } from "./reply.js";

vi.mock("../agents/pi-embedded.js", () => ({
  abortEmbeddedPiRun: vi.fn().mockReturnValue(false),
  runEmbeddedPiAgent: vi.fn(),
  queueEmbeddedPiMessage: vi.fn().mockReturnValue(false),
  resolveEmbeddedSessionLane: (key: string) =>
    `session:${key.trim() || "main"}`,
  isEmbeddedPiRunActive: vi.fn().mockReturnValue(false),
  isEmbeddedPiRunStreaming: vi.fn().mockReturnValue(false),
}));

vi.mock("../agents/model-catalog.js", () => ({
  loadModelCatalog: vi.fn(),
}));

async function withTempHome<T>(fn: (home: string) => Promise<T>): Promise<T> {
  return withTempHomeBase(
    async (home) => {
      return await fn(home);
    },
    { prefix: "clawdbot-reasoning-tags-" },
  );
}

describe("reasoning tag enforcement", () => {
  const reasoningModel = "google-antigravity/gemini-3";

  beforeEach(() => {
    vi.mocked(runEmbeddedPiAgent).mockReset();
    vi.mocked(loadModelCatalog).mockResolvedValue([
      { id: "gemini-3", name: "Gemini 3", provider: "google-antigravity" },
    ]);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("sets enforceFinalTag for providers that require reasoning tags", async () => {
    await withTempHome(async (home) => {
      vi.mocked(runEmbeddedPiAgent).mockResolvedValue({
        payloads: [{ text: "ok" }],
        meta: {
          durationMs: 1,
          agentMeta: {
            sessionId: "s",
            provider: "google-antigravity",
            model: "gemini-3",
          },
        },
      });

      await getReplyFromConfig(
        { Body: "hello", From: "+1999", To: "+2000" },
        {},
        {
          agents: {
            defaults: {
              model: reasoningModel,
              models: { [reasoningModel]: {} },
              workspace: path.join(home, "clawd"),
            },
          },
          whatsapp: { allowFrom: ["*"] },
          session: { store: path.join(home, "sessions.json") },
        },
      );

      expect(runEmbeddedPiAgent).toHaveBeenCalledTimes(1);
      const args = vi.mocked(runEmbeddedPiAgent).mock.calls[0]?.[0];
      expect(args?.enforceFinalTag).toBe(true);
      expect(args?.provider).toBe("google-antigravity");
    });
  });
});
