import type { OpenClawConfig, PluginOnboardingContext } from "openclaw/plugin-sdk/plugin-entry";
import { describe, expect, it, vi } from "vitest";
import { __testing } from "./setup-api.js";

function createContext(params: {
  config: OpenClawConfig;
  confirms?: boolean[];
}): PluginOnboardingContext & {
  notes: Array<{ message: string; title?: string }>;
} {
  const notes: Array<{ message: string; title?: string }> = [];
  const confirms = [...(params.confirms ?? [])];
  return {
    config: params.config,
    env: {},
    runtime: {
      log: vi.fn(),
      error: vi.fn(),
      exit: vi.fn(),
    },
    workspaceDir: "/tmp/openclaw-workspace",
    notes,
    prompter: {
      intro: vi.fn(async () => {}),
      outro: vi.fn(async () => {}),
      note: vi.fn(async (message, title) => {
        notes.push({ message, title });
      }),
      select: vi.fn(async () => {
        throw new Error("select should not be called");
      }),
      multiselect: vi.fn(async () => {
        throw new Error("multiselect should not be called");
      }),
      text: vi.fn(async () => {
        throw new Error("text should not be called");
      }),
      confirm: vi.fn(async () => confirms.shift() ?? false),
      progress: vi.fn(() => ({
        update: vi.fn(),
        stop: vi.fn(),
      })),
    },
  };
}

function createReadyComputerUseResult() {
  return {
    status: {
      enabled: true,
      ready: true,
      reason: "ready",
      installed: true,
      pluginEnabled: true,
      mcpServerAvailable: true,
      pluginName: "computer-use",
      mcpServerName: "computer-use",
      tools: ["list_apps"],
      message: "Computer Use is ready.",
    },
    probe: {
      attempted: true,
      state: "completed",
      toolName: "list_apps",
      message: "Computer Use setup probe completed.",
    },
  } as const;
}

describe("Codex setup onboarding hook", () => {
  it("offers native Codex runtime after OpenAI Codex login without forcing Computer Use", async () => {
    const ctx = createContext({
      config: {
        agents: {
          defaults: {
            model: { primary: "openai-codex/gpt-5.5" },
          },
        },
      },
      confirms: [true, false],
    });

    const next = await __testing.runCodexOnboardingHook(ctx, { platform: "darwin" });

    expect(next.agents?.defaults?.model).toMatchObject({ primary: "openai/gpt-5.5" });
    expect(next.agents?.defaults?.models).toMatchObject({ "openai/gpt-5.5": {} });
    expect(next.agents?.defaults?.agentRuntime).toMatchObject({
      id: "codex",
      fallback: "none",
    });
    expect(next.plugins?.entries?.codex).toMatchObject({ enabled: true });
    expect(
      (next.plugins?.entries?.codex as { config?: { computerUse?: unknown } } | undefined)?.config
        ?.computerUse,
    ).toBeUndefined();
  });

  it("sets up Computer Use on macOS when Codex runtime is configured", async () => {
    const setupCodexComputerUsePermissions = vi.fn(async () => createReadyComputerUseResult());
    const ctx = createContext({
      config: {
        agents: {
          defaults: {
            model: { primary: "openai/gpt-5.5" },
            agentRuntime: { id: "codex" },
          },
        },
        plugins: {
          entries: {
            codex: { enabled: true },
          },
        },
      },
      confirms: [true],
    });

    const next = await __testing.runCodexOnboardingHook(ctx, {
      platform: "darwin",
      setupCodexComputerUsePermissions,
    });

    expect(setupCodexComputerUsePermissions).toHaveBeenCalledWith({
      cwd: "/tmp/openclaw-workspace",
      pluginConfig: {
        computerUse: {
          enabled: true,
          autoInstall: true,
        },
      },
    });
    expect(next.plugins?.entries?.codex).toMatchObject({
      enabled: true,
      config: {
        computerUse: {
          enabled: true,
          autoInstall: true,
        },
      },
    });
    expect(ctx.notes.some((note) => note.message.includes("Setup probe: completed"))).toBe(true);
  });

  it("does not show Computer Use setup on non-macOS platforms", async () => {
    const setupCodexComputerUsePermissions = vi.fn(async () => createReadyComputerUseResult());
    const ctx = createContext({
      config: {
        agents: {
          defaults: {
            model: { primary: "openai/gpt-5.5" },
            agentRuntime: { id: "codex" },
          },
        },
      },
      confirms: [true],
    });

    const next = await __testing.runCodexOnboardingHook(ctx, {
      platform: "win32",
      setupCodexComputerUsePermissions,
    });

    expect(setupCodexComputerUsePermissions).not.toHaveBeenCalled();
    expect(next).toBe(ctx.config);
  });
});
