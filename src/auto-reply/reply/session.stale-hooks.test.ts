import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { OpenClawConfig } from "../../config/config.js";
import type { SessionEntry } from "../../config/sessions.js";
import type { HookRunner } from "../../plugins/hooks.js";
import { initSessionState } from "./session.js";

const triggerInternalHookMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const hookRunnerMocks = vi.hoisted(() => ({
  current: null as HookRunner | null,
  hasHooks: vi.fn<HookRunner["hasHooks"]>(),
  runBeforeReset: vi.fn<HookRunner["runBeforeReset"]>(),
}));
const browserMaintenanceMocks = vi.hoisted(() => ({
  closeTrackedBrowserTabsForSessions: vi.fn(async () => 0),
}));
const sessionRuntimeMocks = vi.hoisted(() => ({
  retireSessionMcpRuntime: vi.fn(async () => undefined),
  resetRegisteredAgentHarnessSessions: vi.fn(async () => undefined),
}));

vi.mock("../../hooks/internal-hooks.js", () => ({
  createInternalHookEvent: (
    type: string,
    action: string,
    sessionKey: string,
    context: Record<string, unknown>,
  ) => ({
    type,
    action,
    sessionKey,
    context,
    timestamp: new Date(0),
    messages: [],
  }),
  triggerInternalHook: triggerInternalHookMock,
}));

vi.mock("../../plugins/hook-runner-global.js", () => ({
  getGlobalHookRunner: () => hookRunnerMocks.current,
}));

vi.mock("../../plugin-sdk/browser-maintenance.js", () => ({
  closeTrackedBrowserTabsForSessions: browserMaintenanceMocks.closeTrackedBrowserTabsForSessions,
}));

vi.mock("../../agents/pi-bundle-mcp-tools.js", () => ({
  retireSessionMcpRuntime: sessionRuntimeMocks.retireSessionMcpRuntime,
}));

vi.mock("../../agents/harness/registry.js", () => ({
  resetRegisteredAgentHarnessSessions: sessionRuntimeMocks.resetRegisteredAgentHarnessSessions,
}));

let suiteRoot = "";
let suiteCase = 0;

beforeAll(async () => {
  suiteRoot = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-session-stale-hooks-"));
});

afterAll(async () => {
  await fs.rm(suiteRoot, { recursive: true, force: true });
  suiteRoot = "";
  suiteCase = 0;
});

beforeEach(() => {
  triggerInternalHookMock.mockClear();
  triggerInternalHookMock.mockResolvedValue(undefined);
  hookRunnerMocks.current = null;
  hookRunnerMocks.hasHooks.mockReset();
  hookRunnerMocks.runBeforeReset.mockReset();
  hookRunnerMocks.runBeforeReset.mockResolvedValue(undefined);
  browserMaintenanceMocks.closeTrackedBrowserTabsForSessions.mockClear();
  sessionRuntimeMocks.retireSessionMcpRuntime.mockClear();
  sessionRuntimeMocks.resetRegisteredAgentHarnessSessions.mockClear();
});

async function makeCaseDir(prefix: string): Promise<string> {
  const dir = path.join(suiteRoot, `${prefix}${++suiteCase}`);
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

async function writeSessionStore(
  storePath: string,
  sessionKey: string,
  entry: SessionEntry,
): Promise<void> {
  await fs.mkdir(path.dirname(storePath), { recursive: true });
  await fs.writeFile(storePath, JSON.stringify({ [sessionKey]: entry }), "utf-8");
}

function transcript(...messages: Array<{ role: "user" | "assistant"; content: string }>): string {
  return messages
    .map((message) =>
      JSON.stringify({
        type: "message",
        message,
      }),
    )
    .join("\n");
}

describe("initSessionState stale reset hooks", () => {
  it("fires command:reset hooks for daily rollovers without a plugin hook runner", async () => {
    const root = await makeCaseDir("daily-");
    const workspaceDir = path.join(root, "workspace");
    const storePath = path.join(root, "sessions.json");
    const sessionKey = "agent:main:telegram:dm:daily";
    const previousSessionId = "daily-stale-session";
    const transcriptPath = path.join(root, `${previousSessionId}.jsonl`);
    const now = Date.now();

    await fs.mkdir(workspaceDir, { recursive: true });
    await fs.writeFile(
      transcriptPath,
      transcript(
        { role: "user", content: "Question before daily rollover" },
        { role: "assistant", content: "Answer before daily rollover" },
      ),
      "utf-8",
    );
    await writeSessionStore(storePath, sessionKey, {
      sessionId: previousSessionId,
      sessionFile: transcriptPath,
      sessionStartedAt: now - 48 * 60 * 60 * 1000,
      lastInteractionAt: now - 1000,
      updatedAt: now - 1000,
    });

    const cfg = {
      agents: { defaults: { workspace: workspaceDir } },
      session: { store: storePath },
    } as OpenClawConfig;

    const result = await initSessionState({
      ctx: {
        Body: "hello",
        From: "telegram:daily",
        To: "telegram:bot",
        Provider: "telegram",
        Surface: "telegram",
        SessionKey: sessionKey,
      },
      cfg,
      commandAuthorized: true,
    });

    expect(result.isNewSession).toBe(true);
    expect(result.resetTriggered).toBe(false);
    expect(triggerInternalHookMock).toHaveBeenCalledTimes(1);
    expect(triggerInternalHookMock).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "command",
        action: "reset",
        sessionKey,
        context: expect.objectContaining({
          commandSource: "session-rollover",
          previousSessionEndReason: "daily",
          workspaceDir,
          sessionEntry: expect.objectContaining({ sessionId: result.sessionId }),
          previousSessionEntry: expect.objectContaining({
            sessionId: previousSessionId,
            sessionFile: expect.stringContaining(`${previousSessionId}.jsonl.reset.`),
          }),
        }),
      }),
    );
  });

  it("passes idle rollover reason and resolved agent context to before_reset hooks", async () => {
    hookRunnerMocks.hasHooks.mockImplementation((hookName) => hookName === "before_reset");
    hookRunnerMocks.current = {
      hasHooks: hookRunnerMocks.hasHooks,
      runBeforeReset: hookRunnerMocks.runBeforeReset,
    } as unknown as HookRunner;

    const root = await makeCaseDir("idle-");
    const workspaceDir = path.join(root, "navi-workspace");
    const storePath = path.join(root, "sessions.json");
    const sessionKey = "agent:navi:whatsapp:dm:idle";
    const previousSessionId = "idle-stale-session";
    const transcriptPath = path.join(root, `${previousSessionId}.jsonl`);
    const now = Date.now();

    await fs.mkdir(workspaceDir, { recursive: true });
    await fs.writeFile(
      transcriptPath,
      transcript(
        { role: "user", content: "Question before idle rollover" },
        { role: "assistant", content: "Answer before idle rollover" },
      ),
      "utf-8",
    );
    await writeSessionStore(storePath, sessionKey, {
      sessionId: previousSessionId,
      sessionFile: transcriptPath,
      sessionStartedAt: now - 60 * 60 * 1000,
      lastInteractionAt: now - 60 * 60 * 1000,
      updatedAt: now - 1000,
    });

    const cfg = {
      agents: { list: [{ id: "navi", workspace: workspaceDir, default: true }] },
      session: {
        store: storePath,
        reset: { mode: "idle", idleMinutes: 30 },
      },
    } as OpenClawConfig;

    await initSessionState({
      ctx: {
        Body: "hello",
        From: "whatsapp:idle",
        To: "whatsapp:bot",
        Provider: "whatsapp",
        Surface: "whatsapp",
        SessionKey: sessionKey,
      },
      cfg,
      commandAuthorized: true,
    });

    await vi.waitFor(() => expect(hookRunnerMocks.runBeforeReset).toHaveBeenCalledTimes(1));
    expect(hookRunnerMocks.runBeforeReset).toHaveBeenCalledWith(
      expect.objectContaining({
        reason: "idle",
        sessionFile: expect.stringContaining(`${previousSessionId}.jsonl.reset.`),
        messages: [
          { role: "user", content: "Question before idle rollover" },
          { role: "assistant", content: "Answer before idle rollover" },
        ],
      }),
      expect.objectContaining({
        agentId: "navi",
        sessionKey,
        sessionId: previousSessionId,
        workspaceDir,
      }),
    );
  });
});
