import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { SessionManager } from "@mariozechner/pi-coding-agent";
import { afterEach, describe, expect, it } from "vitest";
import { makeAgentAssistantMessage } from "../test-helpers/agent-message-fixtures.js";
import {
  rotateTranscriptAfterCompaction,
  shouldRotateCompactionTranscript,
} from "./compaction-successor-transcript.js";

let tmpDir: string | undefined;

async function createTmpDir(): Promise<string> {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "compaction-successor-test-"));
  return tmpDir;
}

afterEach(async () => {
  if (tmpDir) {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => undefined);
    tmpDir = undefined;
  }
});

function makeAssistant(text: string, timestamp: number) {
  return makeAgentAssistantMessage({
    content: [{ type: "text", text }],
    timestamp,
  });
}

function createCompactedSession(sessionDir: string): {
  manager: SessionManager;
  sessionFile: string;
} {
  const manager = SessionManager.create(sessionDir, sessionDir);
  manager.appendModelChange("openai", "gpt-5.2");
  manager.appendThinkingLevelChange("medium");
  manager.appendCustomEntry("test-extension", { cursor: "before-compaction" });
  manager.appendMessage({ role: "user", content: "old user", timestamp: 1 });
  manager.appendMessage(makeAssistant("old assistant", 2));
  const firstKeptId = manager.appendMessage({ role: "user", content: "kept user", timestamp: 3 });
  manager.appendMessage(makeAssistant("kept assistant", 4));
  manager.appendCompaction("Summary of old user and old assistant.", firstKeptId, 5000);
  manager.appendMessage({ role: "user", content: "post user", timestamp: 5 });
  manager.appendMessage(makeAssistant("post assistant", 6));
  return { manager, sessionFile: manager.getSessionFile()! };
}

describe("rotateTranscriptAfterCompaction", () => {
  it("creates a compacted successor transcript and leaves the archive untouched", async () => {
    const dir = await createTmpDir();
    const { manager, sessionFile } = createCompactedSession(dir);
    const originalBytes = await fs.readFile(sessionFile, "utf8");
    const originalEntryCount = manager.getEntries().length;

    const result = await rotateTranscriptAfterCompaction({
      sessionManager: manager,
      sessionFile,
      now: () => new Date("2026-04-27T12:00:00.000Z"),
    });

    expect(result.rotated).toBe(true);
    expect(result.sessionId).toBeTruthy();
    expect(result.sessionFile).toBeTruthy();
    expect(result.sessionFile).not.toBe(sessionFile);
    expect(await fs.readFile(sessionFile, "utf8")).toBe(originalBytes);

    const successor = SessionManager.open(result.sessionFile!);
    expect(successor.getHeader()).toMatchObject({
      id: result.sessionId,
      parentSession: sessionFile,
      cwd: dir,
    });
    expect(successor.getEntries().length).toBeLessThan(originalEntryCount);
    expect(successor.getBranch()[0]?.type).toBe("model_change");
    expect(successor.getBranch()).toContainEqual(
      expect.objectContaining({
        type: "custom",
        customType: "test-extension",
        data: { cursor: "before-compaction" },
      }),
    );

    const context = successor.buildSessionContext();
    const contextText = JSON.stringify(context.messages);
    expect(contextText).toContain("Summary of old user and old assistant.");
    expect(contextText).toContain("kept user");
    expect(contextText).toContain("post assistant");
    expect(
      context.messages.some((message) => message.role === "user" && message.content === "old user"),
    ).toBe(false);
    expect(context.model?.provider).toBe("openai");
    expect(context.thinkingLevel).toBe("medium");
  });

  it("skips sessions with no compaction entry", async () => {
    const dir = await createTmpDir();
    const manager = SessionManager.create(dir, dir);
    manager.appendMessage({ role: "user", content: "hello", timestamp: 1 });
    manager.appendMessage(makeAssistant("hi", 2));

    const result = await rotateTranscriptAfterCompaction({
      sessionManager: manager,
      sessionFile: manager.getSessionFile()!,
    });

    expect(result).toMatchObject({
      rotated: false,
      reason: "no compaction entry",
    });
  });
});

describe("shouldRotateCompactionTranscript", () => {
  it("keeps transcript rotation opt-in behind the existing config key", () => {
    expect(shouldRotateCompactionTranscript()).toBe(false);
    expect(
      shouldRotateCompactionTranscript({
        agents: { defaults: { compaction: { truncateAfterCompaction: true } } },
      }),
    ).toBe(true);
  });
});
