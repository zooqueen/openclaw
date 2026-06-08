// Qa Lab tests cover mock channel capability matrix behavior.
import { describe, expect, it } from "vitest";
import {
  buildQaChannelCapabilityMatrix,
  getQaMockChannelDriver,
  listQaMockChannelIds,
} from "./channel-capability-matrix.js";

describe("channel capability matrix", () => {
  it("declares the first concrete mock upstream driver for Telegram", () => {
    const driver = getQaMockChannelDriver("telegram");

    expect(driver).toMatchObject({
      channelId: "telegram",
      mockDriverId: "telegram-normalized-bus-v1",
      channelLive: false,
      runtimePluginIds: ["qa-channel"],
    });
    expect(driver?.capabilities.dm.status).toBe("covered");
    expect(driver?.capabilities["group-mention"].status).toBe("covered");
    expect(driver?.capabilities["outbound-transcript"].status).toBe("covered");
    expect(driver?.capabilities.thread.status).toBe("planned");
  });

  it("keeps missing channel drivers visible as planned rows", () => {
    const matrix = buildQaChannelCapabilityMatrix();

    expect(listQaMockChannelIds()).toEqual(["telegram"]);
    expect(matrix.channels.map((entry) => entry.channelId)).toEqual([
      "telegram",
      "discord",
      "slack",
      "whatsapp",
    ]);
    expect(getQaMockChannelDriver("discord")).toBeUndefined();
    expect(matrix.channels.find((entry) => entry.channelId === "discord")).toMatchObject({
      mockDriverId: null,
      capabilities: {
        dm: {
          status: "planned",
          coverageId: "channels.discord.dm",
        },
      },
    });
  });
});
