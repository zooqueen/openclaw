import fs from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import handler from "./handler.js";
import { createHookEvent } from "../../hooks.js";
import type { ClawdbotConfig } from "../../../config/config.js";
import { makeTempWorkspace } from "../../../test-helpers/workspace.js";

describe("session-memory hook", () => {
  it("writes a memory entry without queuing a user confirmation", async () => {
    const workspaceDir = await makeTempWorkspace("clawdbot-session-memory-");
    const cfg: ClawdbotConfig = {
      agents: {
        defaults: {
          workspace: workspaceDir,
        },
      },
    };
    const context: Record<string, unknown> = {
      cfg,
      sessionEntry: {
        sessionId: "session-123",
        sessionFile: "",
      },
      commandSource: "test",
    };

    const event = createHookEvent("command", "new", "agent:main:main", context);
    await handler(event);

    expect(event.messages).toEqual([]);

    const memoryDir = path.join(workspaceDir, "memory");
    const files = await fs.readdir(memoryDir);
    expect(files).toHaveLength(1);

    const entry = await fs.readFile(path.join(memoryDir, files[0] ?? ""), "utf-8");
    expect(entry).toContain("Session Key");
    expect(entry).toContain("session-123");
  });
});
