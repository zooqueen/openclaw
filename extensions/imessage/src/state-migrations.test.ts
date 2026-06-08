// Imessage tests cover state migrations plugin behavior.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { detectIMessageLegacyStateMigrations } from "./state-migrations.js";

describe("detectIMessageLegacyStateMigrations", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  function makeStateDir(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-imsg-migration-"));
    tempDirs.push(dir);
    return dir;
  }

  it("imports reply and echo sidecars into plugin state plans", async () => {
    const stateDir = makeStateDir();
    const imsgDir = path.join(stateDir, "imessage");
    fs.mkdirSync(imsgDir, { recursive: true });
    fs.writeFileSync(
      path.join(imsgDir, "reply-cache.jsonl"),
      JSON.stringify({
        accountId: "default",
        messageId: "guid-1",
        shortId: "1",
        timestamp: Date.now(),
        chatIdentifier: "+15551234567",
      }) + "\n",
    );
    fs.writeFileSync(
      path.join(imsgDir, "sent-echoes.jsonl"),
      JSON.stringify({
        scope: "default:imessage:+15551234567",
        text: "hello",
        timestamp: Date.now(),
      }) + "\n",
    );

    const plans = await detectIMessageLegacyStateMigrations({
      cfg: { channels: { imessage: { enabled: true } } } as never,
      env: {},
      stateDir,
    });

    expect(plans.map((plan) => plan.label)).toEqual([
      "iMessage reply short-id counter",
      "iMessage reply short-id cache",
      "iMessage sent-echo dedupe cache",
    ]);
    for (const plan of plans) {
      expect(plan.kind).toBe("plugin-state-import");
      if (plan.kind !== "plugin-state-import") {
        throw new Error("expected plugin-state-import plan");
      }
      expect(plan.pluginId).toBe("imessage");
      if (plan.label !== "iMessage reply short-id counter") {
        expect(plan.cleanupSource).toBe("rename");
      }
      if (
        plan.label === "iMessage reply short-id cache" ||
        plan.label === "iMessage sent-echo dedupe cache"
      ) {
        expect(plan.cleanupWhenEmpty).toBe(true);
      }
      const entries = await plan.readEntries();
      expect(entries).toHaveLength(1);
    }

    const counterPlan = plans.find((plan) => plan.label === "iMessage reply short-id counter");
    expect(counterPlan?.kind).toBe("plugin-state-import");
    if (!counterPlan || counterPlan.kind !== "plugin-state-import") {
      throw new Error("expected reply counter plugin-state-import plan");
    }
    expect(
      await counterPlan.shouldReplaceExistingEntry?.({
        key: "short-id-counter",
        existingValue: { counter: 0 },
        incomingValue: { counter: 1 },
      }),
    ).toBe(true);
    expect(
      await counterPlan.shouldReplaceExistingEntry?.({
        key: "short-id-counter",
        existingValue: { counter: 2 },
        incomingValue: { counter: 1 },
      }),
    ).toBe(false);
  });

  it("leaves unreadable reply-cache sidecars for a later migration attempt", async () => {
    const stateDir = makeStateDir();
    const imsgDir = path.join(stateDir, "imessage");
    fs.mkdirSync(imsgDir, { recursive: true });
    const sourcePath = path.join(imsgDir, "reply-cache.jsonl");
    fs.writeFileSync(sourcePath, "\n");

    const plans = await detectIMessageLegacyStateMigrations({
      cfg: { channels: { imessage: { enabled: true } } } as never,
      env: {},
      stateDir,
    });
    const replyPlan = plans.find((plan) => plan.label === "iMessage reply short-id cache");
    expect(replyPlan?.kind).toBe("plugin-state-import");
    if (!replyPlan || replyPlan.kind !== "plugin-state-import") {
      throw new Error("expected reply cache plugin-state-import plan");
    }
    fs.rmSync(sourcePath);

    expect(() => replyPlan.readEntries()).toThrow("Failed reading");
  });

  it("keeps the latest live reply-cache row for duplicate message ids", async () => {
    const stateDir = makeStateDir();
    const imsgDir = path.join(stateDir, "imessage");
    fs.mkdirSync(imsgDir, { recursive: true });
    const now = Date.now();
    fs.writeFileSync(
      path.join(imsgDir, "reply-cache.jsonl"),
      [
        JSON.stringify({
          accountId: "default",
          messageId: "guid-dup",
          shortId: "1",
          timestamp: now - 2_000,
        }),
        JSON.stringify({
          accountId: "default",
          messageId: "guid-dup",
          shortId: "7",
          timestamp: now - 1_000,
        }),
      ].join("\n"),
    );

    const plans = await detectIMessageLegacyStateMigrations({
      cfg: { channels: { imessage: { enabled: true } } } as never,
      env: {},
      stateDir,
    });
    const replyPlan = plans.find((plan) => plan.label === "iMessage reply short-id cache");
    const counterPlan = plans.find((plan) => plan.label === "iMessage reply short-id counter");
    if (!replyPlan || replyPlan.kind !== "plugin-state-import") {
      throw new Error("expected reply cache plugin-state-import plan");
    }
    if (!counterPlan || counterPlan.kind !== "plugin-state-import") {
      throw new Error("expected reply counter plugin-state-import plan");
    }

    const replyEntries = await replyPlan.readEntries();
    const counterEntries = await counterPlan.readEntries();
    expect(replyEntries).toHaveLength(1);
    const replyEntry = replyEntries[0];
    if (!replyEntry) {
      throw new Error("expected reply cache entry");
    }
    expect((replyEntry.value as { shortId?: string }).shortId).toBe("7");
    expect(counterEntries[0]?.value).toEqual({ counter: 7 });
  });
});
