import { afterEach, describe, expect, it, vi } from "vitest";
import { setMSTeamsRuntime } from "./runtime.js";
import {
  clearMSTeamsSentMessageCache,
  recordMSTeamsSentMessage,
  wasMSTeamsMessageSent,
  wasMSTeamsMessageSentForConfig,
} from "./sent-message-cache.js";

describe("msteams sent message cache", () => {
  afterEach(() => {
    clearMSTeamsSentMessageCache();
    vi.restoreAllMocks();
  });

  it("records and resolves sent message ids", () => {
    recordMSTeamsSentMessage("conv-1", "msg-1");
    expect(wasMSTeamsMessageSent("conv-1", "msg-1")).toBe(true);
    expect(wasMSTeamsMessageSent("conv-1", "msg-2")).toBe(false);
  });

  it("persists sent message ids only when opted in", async () => {
    const register = vi.fn().mockResolvedValue(undefined);
    const lookup = vi.fn().mockResolvedValue({ sentAt: 123 });
    const openKeyedStore = vi.fn(() => ({
      register,
      lookup,
      consume: vi.fn(),
      delete: vi.fn(),
      entries: vi.fn(),
      clear: vi.fn(),
    }));
    setMSTeamsRuntime({
      state: { openKeyedStore },
      logging: { getChildLogger: () => ({ warn: vi.fn() }) },
    } as never);

    recordMSTeamsSentMessage("conv-1", "msg-1");
    expect(openKeyedStore).not.toHaveBeenCalled();

    const cfg = {
      plugins: { entries: { msteams: { config: { experimentalPersistentState: true } } } },
    };
    recordMSTeamsSentMessage("conv-1", "msg-2", { cfg });

    await vi.waitFor(() => expect(register).toHaveBeenCalledTimes(1));
    expect(register).toHaveBeenCalledWith("conv-1:msg-2", { sentAt: expect.any(Number) });

    clearMSTeamsSentMessageCache();
    await expect(
      wasMSTeamsMessageSentForConfig({ cfg, conversationId: "conv-1", messageId: "msg-2" }),
    ).resolves.toBe(true);
    expect(lookup).toHaveBeenCalledWith("conv-1:msg-2");
  });
});
