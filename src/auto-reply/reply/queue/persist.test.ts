import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { withTempDir } from "../../../test-helpers/temp-dir.js";
import { createDeferred, createQueueTestRun as createRun } from "../queue.test-helpers.js";
import { scheduleFollowupDrain } from "./drain.js";
import { enqueueFollowupRun, resetRecentQueuedMessageIdDedupe } from "./enqueue.js";
import {
  loadPersistedFollowupQueueSnapshots,
  persistFollowupQueuesForRestart,
  recoverPersistedFollowupQueuesForRestart,
  resolvePersistedFollowupQueueDir,
} from "./persist.js";
import { clearFollowupQueue } from "./state.js";
import type { FollowupRun, QueueSettings } from "./types.js";

const touchedQueueKeys = new Set<string>();

const settings: QueueSettings = {
  mode: "followup",
  debounceMs: 0,
  cap: 20,
  dropPolicy: "summarize",
};

const recoveryConfig = {
  channels: {
    slack: {
      enabled: true,
    },
  },
} as FollowupRun["run"]["config"];

afterEach(() => {
  for (const key of touchedQueueKeys) {
    clearFollowupQueue(key);
  }
  touchedQueueKeys.clear();
  resetRecentQueuedMessageIdDedupe();
});

function trackKey(key: string): string {
  touchedQueueKeys.add(key);
  return key;
}

function makeQueuedRun(key: string, prompt = "queued user text"): FollowupRun {
  const run = createRun({
    prompt,
    messageId: `message-${key}`,
    originatingChannel: "slack",
    originatingTo: "C123",
    originatingAccountId: "workspace-a",
    originatingThreadId: "171234.0001",
  });
  return {
    ...run,
    transcriptPrompt: `transcript:${prompt}`,
    summaryLine: `summary:${prompt}`,
    originatingChatType: "channel",
    run: {
      ...run.run,
      agentId: "main",
      sessionKey: key,
      runtimePolicySessionKey: key,
      messageProvider: "slack",
      agentAccountId: "bot-a",
      groupId: "group-a",
      groupChannel: "slack",
      groupSpace: "workspace-a",
      senderId: "U123",
      senderName: "Ada",
      senderUsername: "ada",
      senderIsOwner: false,
      traceAuthorized: false,
      execOverrides: {
        host: "gateway",
        security: "allowlist",
        ask: "on-miss",
        node: "local",
      },
      bashElevated: {
        enabled: true,
        allowed: false,
        defaultLevel: "off",
      },
      ownerNumbers: ["+15550100"],
      sourceReplyDeliveryMode: "automatic",
      silentReplyPromptMode: "generic",
      enforceFinalTag: true,
      allowEmptyAssistantReplyAsSilent: true,
      config: {
        channels: {
          slack: {
            enabled: true,
          },
        },
      } as FollowupRun["run"]["config"],
    },
  };
}

async function listPersistedSnapshotBasenames(stateDir: string): Promise<string[]> {
  const dir = resolvePersistedFollowupQueueDir(stateDir);
  try {
    return (await fs.readdir(dir)).filter((file) => file.endsWith(".json")).toSorted();
  } catch {
    return [];
  }
}

describe("followup queue restart persistence", () => {
  it("recovers queued followups through the normal followup drain shape", async () => {
    await withTempDir({ prefix: "openclaw-followup-persist-" }, async (stateDir) => {
      const key = trackKey(`agent:main:slack:thread:${Date.now()}`);
      const queued = makeQueuedRun(key);
      enqueueFollowupRun(key, queued, settings, "none", undefined, false);

      const persisted = await persistFollowupQueuesForRestart({ stateDir });
      expect(persisted).toEqual({ persistedQueues: 1, persistedItems: 1 });

      const loaded = await loadPersistedFollowupQueueSnapshots({ stateDir });
      expect(loaded.snapshots).toHaveLength(1);
      expect(loaded.snapshots[0]).toMatchObject({
        key,
        mode: "followup",
        dropPolicy: "summarize",
        items: [
          expect.objectContaining({
            prompt: "queued user text",
            transcriptPrompt: "transcript:queued user text",
            originatingChannel: "slack",
            originatingTo: "C123",
            originatingAccountId: "workspace-a",
            originatingThreadId: "171234.0001",
            originatingChatType: "channel",
            run: expect.objectContaining({
              sessionKey: key,
              messageProvider: "slack",
              senderId: "U123",
              senderIsOwner: false,
              execOverrides: expect.objectContaining({
                security: "allowlist",
              }),
            }),
          }),
        ],
      });
      expect(Object.hasOwn(loaded.snapshots[0]?.items[0]?.run ?? {}, "config")).toBe(false);
      expect(Object.hasOwn(loaded.snapshots[0]?.lastRun ?? {}, "config")).toBe(false);

      clearFollowupQueue(key);
      const recovered: FollowupRun[] = [];
      const result = await recoverPersistedFollowupQueuesForRestart({
        stateDir,
        config: recoveryConfig,
        createRunFollowup: () => async (run) => {
          recovered.push(run);
        },
      });

      expect(result).toEqual({ recoveredQueues: 1, recoveredItems: 1, malformedFiles: 0 });
      await vi.waitFor(() => {
        expect(recovered).toHaveLength(1);
      });
      expect(recovered[0]).toMatchObject({
        prompt: "queued user text",
        transcriptPrompt: "transcript:queued user text",
        originatingChannel: "slack",
        originatingTo: "C123",
        originatingAccountId: "workspace-a",
        originatingThreadId: "171234.0001",
        originatingChatType: "channel",
        run: expect.objectContaining({
          sessionKey: key,
          messageProvider: "slack",
          senderId: "U123",
          senderIsOwner: false,
          config: recoveryConfig,
        }),
      });
      expect("kind" in recovered[0]).toBe(false);
      expect(await listPersistedSnapshotBasenames(stateDir)).toEqual([]);
    });
  });

  it("can persist a recovered queue again before its drain resolves", async () => {
    await withTempDir({ prefix: "openclaw-followup-persist-" }, async (stateDir) => {
      const key = trackKey(`agent:main:slack:consecutive:${Date.now()}`);
      enqueueFollowupRun(key, makeQueuedRun(key, "survives another restart"), settings, "none");
      await persistFollowupQueuesForRestart({ stateDir });
      clearFollowupQueue(key);

      const releaseDrain = createDeferred<void>();
      const recovered: FollowupRun[] = [];
      await recoverPersistedFollowupQueuesForRestart({
        stateDir,
        config: recoveryConfig,
        createRunFollowup: () => async (run) => {
          recovered.push(run);
          await releaseDrain.promise;
        },
      });
      await vi.waitFor(() => {
        expect(recovered).toHaveLength(1);
      });

      const persistedAgain = await persistFollowupQueuesForRestart({ stateDir });
      expect(persistedAgain).toEqual({ persistedQueues: 1, persistedItems: 1 });
      const loadedAgain = await loadPersistedFollowupQueueSnapshots({ stateDir });
      expect(loadedAgain.snapshots[0]?.items[0]?.prompt).toBe("survives another restart");
      expect(Object.hasOwn(loadedAgain.snapshots[0]?.items[0]?.run ?? {}, "config")).toBe(false);

      releaseDrain.resolve();
      await vi.waitFor(() => {
        expect(recovered).toHaveLength(1);
      });
    });
  });

  it("does not serialize resolved runtime config secrets and restores current config", async () => {
    await withTempDir({ prefix: "openclaw-followup-persist-" }, async (stateDir) => {
      const key = trackKey(`agent:main:slack:secret:${Date.now()}`);
      const resolvedSecret = "persist-test-resolved-secret-value";
      const queued = makeQueuedRun(key, "do not persist resolved config");
      queued.run.config = {
        tools: {
          web: {
            search: {
              apiKey: resolvedSecret,
            },
          },
        },
      } as FollowupRun["run"]["config"];
      enqueueFollowupRun(key, queued, settings, "none", undefined, false);

      await persistFollowupQueuesForRestart({ stateDir });
      const snapshotFiles = await listPersistedSnapshotBasenames(stateDir);
      expect(snapshotFiles).toHaveLength(1);
      const rawSnapshot = await fs.readFile(
        path.join(resolvePersistedFollowupQueueDir(stateDir), snapshotFiles[0]!),
        "utf-8",
      );
      expect(rawSnapshot).not.toContain(resolvedSecret);
      expect(rawSnapshot).not.toContain('"config"');

      const loaded = await loadPersistedFollowupQueueSnapshots({ stateDir });
      expect(Object.hasOwn(loaded.snapshots[0]?.items[0]?.run ?? {}, "config")).toBe(false);
      expect(Object.hasOwn(loaded.snapshots[0]?.lastRun ?? {}, "config")).toBe(false);

      clearFollowupQueue(key);
      const currentConfig = {
        tools: {
          web: {
            search: {
              apiKey: "${BRAVE_API_KEY}",
            },
          },
        },
      } as FollowupRun["run"]["config"];
      const recovered: FollowupRun[] = [];
      await recoverPersistedFollowupQueuesForRestart({
        stateDir,
        config: currentConfig,
        createRunFollowup: () => async (run) => {
          recovered.push(run);
        },
      });

      await vi.waitFor(() => {
        expect(recovered).toHaveLength(1);
      });
      expect(recovered[0]?.run.config).toBe(currentConfig);
      expect(JSON.stringify(recovered[0])).not.toContain(resolvedSecret);
    });
  });

  it("removes malformed persisted data without scheduling a followup", async () => {
    await withTempDir({ prefix: "openclaw-followup-persist-" }, async (stateDir) => {
      const snapshotDir = resolvePersistedFollowupQueueDir(stateDir);
      await fs.mkdir(snapshotDir, { recursive: true });
      await fs.writeFile(path.join(snapshotDir, "broken.json"), "{not-json", "utf-8");
      const createRunFollowup = vi.fn();
      const scheduleDrain = vi.fn<typeof scheduleFollowupDrain>();
      const log = { warn: vi.fn() };

      const result = await recoverPersistedFollowupQueuesForRestart({
        stateDir,
        config: recoveryConfig,
        log,
        createRunFollowup,
        scheduleDrain,
      });

      expect(result).toEqual({ recoveredQueues: 0, recoveredItems: 0, malformedFiles: 1 });
      expect(createRunFollowup).not.toHaveBeenCalled();
      expect(scheduleDrain).not.toHaveBeenCalled();
      expect(log.warn).toHaveBeenCalledWith(
        expect.stringContaining("removed malformed followup queue restart snapshot"),
      );
      expect(await listPersistedSnapshotBasenames(stateDir)).toEqual([]);
    });
  });
});
