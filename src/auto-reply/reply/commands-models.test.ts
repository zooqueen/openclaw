import { describe, expect, it, vi } from "vitest";

import type { ClawdbotConfig } from "../../config/config.js";
import type { MsgContext } from "../templating.js";
import { buildCommandContext, handleCommands } from "./commands.js";
import { parseInlineDirectives } from "./directive-handling.js";

vi.mock("../../agents/model-catalog.js", () => ({
  loadModelCatalog: vi.fn(async () => [
    { provider: "anthropic", id: "claude-opus-4-5", name: "Claude Opus" },
    { provider: "anthropic", id: "claude-sonnet-4-5", name: "Claude Sonnet" },
    { provider: "openai", id: "gpt-4.1", name: "GPT-4.1" },
    { provider: "openai", id: "gpt-4.1-mini", name: "GPT-4.1 Mini" },
    { provider: "google", id: "gemini-2.0-flash", name: "Gemini Flash" },
  ]),
}));

function buildParams(commandBody: string, cfg: ClawdbotConfig, ctxOverrides?: Partial<MsgContext>) {
  const ctx = {
    Body: commandBody,
    CommandBody: commandBody,
    CommandSource: "text",
    CommandAuthorized: true,
    Provider: "telegram",
    Surface: "telegram",
    ...ctxOverrides,
  } as MsgContext;

  const command = buildCommandContext({
    ctx,
    cfg,
    isGroup: false,
    triggerBodyNormalized: commandBody.trim().toLowerCase(),
    commandAuthorized: true,
  });

  return {
    ctx,
    cfg,
    command,
    directives: parseInlineDirectives(commandBody),
    elevated: { enabled: true, allowed: true, failures: [] },
    sessionKey: "agent:main:main",
    workspaceDir: "/tmp",
    defaultGroupActivation: () => "mention",
    resolvedVerboseLevel: "off" as const,
    resolvedReasoningLevel: "off" as const,
    resolveDefaultThinkingLevel: async () => undefined,
    provider: "anthropic",
    model: "claude-opus-4-5",
    contextTokens: 16000,
    isGroup: false,
  };
}

describe("/models command", () => {
  const cfg = {
    commands: { text: true },
    // allowlist is empty => allowAny, but still okay for listing
    agents: { defaults: { model: { primary: "anthropic/claude-opus-4-5" } } },
  } as unknown as ClawdbotConfig;

  it.each(["telegram", "discord", "whatsapp"])("lists providers on %s", async (surface) => {
    const params = buildParams("/models", cfg, { Provider: surface, Surface: surface });
    const result = await handleCommands(params);
    expect(result.shouldContinue).toBe(false);
    expect(result.reply?.text).toContain("Providers:");
    expect(result.reply?.text).toContain("anthropic");
    expect(result.reply?.text).toContain("Use: /models <provider>");
  });

  it("lists provider models with pagination hints", async () => {
    const params = buildParams("/models anthropic", cfg);
    const result = await handleCommands(params);
    expect(result.shouldContinue).toBe(false);
    expect(result.reply?.text).toContain("Models (anthropic)");
    expect(result.reply?.text).toContain("page 1/");
    expect(result.reply?.text).toContain("anthropic/claude-opus-4-5");
    expect(result.reply?.text).toContain("Switch: /model <provider/model>");
    expect(result.reply?.text).toContain("All: /models anthropic all");
  });

  it("includes configured providers and defaults", async () => {
    const configuredCfg = {
      commands: { text: true },
      agents: {
        defaults: {
          model: {
            primary: "synthetic/synth-1",
            fallbacks: ["synthetic/synth-2"],
          },
          imageModel: {
            primary: "synthetic/synth-image",
            fallbacks: ["synthetic/synth-image-2"],
          },
        },
      },
      models: {
        providers: {
          synthetic: {
            baseUrl: "https://example.com",
            models: [
              {
                id: "synth-3",
                name: "Synth 3",
              },
            ],
          },
        },
      },
    } as unknown as ClawdbotConfig;

    const providersResult = await handleCommands(buildParams("/models", configuredCfg));
    expect(providersResult.shouldContinue).toBe(false);
    expect(providersResult.reply?.text).toContain("synthetic");

    const modelsResult = await handleCommands(buildParams("/models synthetic", configuredCfg));
    expect(modelsResult.shouldContinue).toBe(false);
    expect(modelsResult.reply?.text).toContain("synthetic/synth-1");
    expect(modelsResult.reply?.text).toContain("synthetic/synth-2");
    expect(modelsResult.reply?.text).toContain("synthetic/synth-3");
    expect(modelsResult.reply?.text).toContain("synthetic/synth-image");
    expect(modelsResult.reply?.text).toContain("synthetic/synth-image-2");
  });

  it("errors on out-of-range pages", async () => {
    const params = buildParams("/models anthropic 4", cfg);
    const result = await handleCommands(params);
    expect(result.shouldContinue).toBe(false);
    expect(result.reply?.text).toContain("Page out of range");
    expect(result.reply?.text).toContain("valid: 1-");
  });

  it("handles unknown providers", async () => {
    const params = buildParams("/models not-a-provider", cfg);
    const result = await handleCommands(params);
    expect(result.shouldContinue).toBe(false);
    expect(result.reply?.text).toContain("Unknown provider");
    expect(result.reply?.text).toContain("Available providers");
  });
});
