// Tests `openclaw agents view-system-prompt` prompt assembly and output routing.
import { describe, expect, it, vi } from "vitest";
import type { AgentTool } from "../agents/runtime/index.js";
import type { OpenClawConfig } from "../config/types.openclaw.js";
import type { Model } from "../llm/types.js";
import type { RuntimeEnv } from "../runtime.js";
import {
  agentsViewSystemPromptCommand,
  type AgentsSystemPromptPreviewDeps,
  buildAgentsSystemPromptPreview,
} from "./agents.commands.view-system-prompt.js";

const requireValidConfigMock = vi.hoisted(() => vi.fn());

vi.mock("./agents.command-shared.js", () => ({
  requireValidConfig: requireValidConfigMock,
}));

function makeConfig(): OpenClawConfig {
  return {
    agents: {
      defaults: {
        workspace: "/tmp/openclaw-main",
        model: { primary: "openai/gpt-5.4" },
      },
      list: [
        {
          id: "main",
          default: true,
          workspace: "/tmp/openclaw-main",
        },
        {
          id: "ops",
          workspace: "/tmp/openclaw-ops",
          model: "anthropic/claude-sonnet-4.6",
        },
      ],
    },
  } as OpenClawConfig;
}

function makeModel(provider = "openai", id = "gpt-5.5"): Model {
  return {
    id,
    name: id,
    api: "openai-responses",
    provider,
    baseUrl: "",
    reasoning: true,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 200_000,
    maxTokens: 16_000,
  } as Model;
}

function makeTool(name: string): AgentTool {
  return {
    name,
    label: name,
    description: name,
    parameters: {},
    execute: vi.fn(async () => ({ content: [], details: undefined })),
  } as unknown as AgentTool;
}

function makeDeps() {
  const buildAttemptSystemPrompt = vi.fn<AgentsSystemPromptPreviewDeps["buildAttemptSystemPrompt"]>(
    (params) => ({
      baseSystemPrompt: "base prompt",
      systemPrompt: `assembled:${params.embeddedSystemPrompt.runtimeInfo.model}`,
    }),
  );
  const createOpenClawCodingTools = vi.fn<
    AgentsSystemPromptPreviewDeps["createOpenClawCodingTools"]
  >(() => [makeTool("read"), makeTool("message")]);
  const resolveModelAsync = vi.fn<AgentsSystemPromptPreviewDeps["resolveModelAsync"]>(
    async (provider: string, modelId: string) =>
      ({
        model: makeModel(provider, modelId),
        authStorage: {},
        modelRegistry: {},
      }) as Awaited<ReturnType<AgentsSystemPromptPreviewDeps["resolveModelAsync"]>>,
  );
  return {
    buildAttemptSystemPrompt,
    createOpenClawCodingTools,
    resolveModelAsync,
    getMachineDisplayName: vi.fn(async () => "test-host"),
  };
}

describe("buildAgentsSystemPromptPreview", () => {
  it("assembles prompt params using selected agent workspace, active model, and normalized channel", async () => {
    const deps = makeDeps();

    const preview = await buildAgentsSystemPromptPreview(
      {
        agentId: "ops",
        model: "openai/gpt-5.5",
        channel: "Telegram",
      },
      makeConfig(),
      deps,
    );

    expect(preview).toMatchObject({
      agentId: "ops",
      workspaceDir: "/tmp/openclaw-ops",
      provider: "openai",
      modelId: "gpt-5.5",
      channel: "telegram",
      prompt: "assembled:openai/gpt-5.5",
    });
    expect(deps.resolveModelAsync).toHaveBeenCalledWith(
      "openai",
      "gpt-5.5",
      expect.any(String),
      expect.any(Object),
      expect.objectContaining({
        workspaceDir: "/tmp/openclaw-ops",
        skipAgentDiscovery: true,
        allowBundledStaticCatalogFallback: true,
      }),
    );
    expect(deps.createOpenClawCodingTools).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: "ops",
        workspaceDir: "/tmp/openclaw-ops",
        cwd: "/tmp/openclaw-ops",
        spawnWorkspaceDir: "/tmp/openclaw-ops",
        modelProvider: "openai",
        modelId: "gpt-5.5",
        messageProvider: "telegram",
      }),
    );
    const promptParams = deps.buildAttemptSystemPrompt.mock.calls[0]?.[0];
    expect(promptParams?.embeddedSystemPrompt.runtimeInfo).toMatchObject({
      agentId: "ops",
      host: "test-host",
      model: "openai/gpt-5.5",
      defaultModel: "anthropic/claude-sonnet-4.6",
      channel: "telegram",
    });
    expect(promptParams?.embeddedSystemPrompt.tools.map((tool: AgentTool) => tool.name)).toEqual([
      "read",
      "message",
    ]);
    expect(promptParams?.embeddedSystemPrompt.includeMemorySection).toBe(true);
    expect(promptParams?.providerTransform.context).toMatchObject({
      workspaceDir: "/tmp/openclaw-ops",
      provider: "openai",
      modelId: "gpt-5.5",
      runtimeChannel: "telegram",
      agentId: "ops",
    });
  });

  it("uses the configured default agent and model when no overrides are supplied", async () => {
    const deps = makeDeps();

    await buildAgentsSystemPromptPreview({}, makeConfig(), deps);

    const promptParams = deps.buildAttemptSystemPrompt.mock.calls[0]?.[0];
    expect(promptParams?.embeddedSystemPrompt.runtimeInfo).toMatchObject({
      agentId: "main",
      model: "openai/gpt-5.4",
      defaultModel: "openai/gpt-5.4",
    });
  });
});

describe("agentsViewSystemPromptCommand", () => {
  it("prints prompt text to stdout and metadata to stderr", async () => {
    const runtime = {
      log: vi.fn(),
      error: vi.fn(),
      exit: vi.fn(),
      writeStdout: vi.fn(),
    } satisfies RuntimeEnv & { writeStdout: (value: string) => void };
    const deps = makeDeps();
    requireValidConfigMock.mockResolvedValueOnce(makeConfig());

    await agentsViewSystemPromptCommand(
      { agentId: "main", model: "openai/gpt-5.5" },
      runtime,
      deps,
    );

    expect(runtime.writeStdout).toHaveBeenCalledWith("assembled:openai/gpt-5.5");
    expect(runtime.error).toHaveBeenCalledWith(expect.stringContaining("Model: openai/gpt-5.5"));
    expect(runtime.log).not.toHaveBeenCalled();
  });
});
