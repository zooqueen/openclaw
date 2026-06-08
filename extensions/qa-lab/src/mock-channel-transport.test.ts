// Qa Lab tests cover mock channel transport behavior.
import { describe, expect, it } from "vitest";
import { createQaBusState } from "./bus-state.js";
import { createQaMockChannelTransport } from "./mock-channel-transport.js";

describe("mock channel transport", () => {
  it("selects Telegram while routing through the normalized QA channel shim", () => {
    const transport = createQaMockChannelTransport({
      channelId: "telegram",
      state: createQaBusState(),
    });

    expect(transport.id).toBe("telegram");
    expect(transport.channelId).toBe("telegram");
    expect(transport.channelLive).toBe(false);
    expect(transport.mockUpstreamDriverId).toBe("telegram-normalized-bus-v1");
    expect(transport.requiredPluginIds).toEqual(["qa-channel"]);
    expect(transport.buildAgentDelivery({ target: "qa-room" })).toEqual({
      channel: "qa-channel",
      replyChannel: "qa-channel",
      replyTo: "qa-room",
    });
  });
});
