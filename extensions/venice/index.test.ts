// Venice tests cover index plugin behavior.
import { registerSingleProviderPlugin } from "openclaw/plugin-sdk/plugin-test-runtime";
import { describe, expect, it } from "vitest";
import plugin from "./index.js";

describe("venice provider plugin", () => {
  it("applies the shared xAI compat patch to Grok-backed Venice models only", async () => {
    const provider = await registerSingleProviderPlugin(plugin);

    expect(
      provider.normalizeResolvedModel?.({
        modelId: "venice/grok-4",
        model: {
          id: "grok-4",
          compat: {
            supportsUsageInStreaming: true,
          },
        },
      } as never),
    ).toEqual({
      id: "grok-4",
      compat: {
        supportsUsageInStreaming: true,
        toolSchemaProfile: "xai",
        unsupportedToolSchemaKeywords: [
          "minLength",
          "maxLength",
          "minItems",
          "maxItems",
          "minContains",
          "maxContains",
        ],
        nativeWebSearchTool: true,
        toolCallArgumentsEncoding: "html-entities",
      },
    });

    expect(
      provider.normalizeResolvedModel?.({
        modelId: "venice/llama-3.3-70b",
        model: {
          id: "llama-3.3-70b",
          compat: {},
        },
      } as never),
    ).toBeUndefined();
  });

  it("fills missing DeepSeek V4 reasoning_content on Venice replay turns", async () => {
    const provider = await registerSingleProviderPlugin(plugin);
    const capturedPayloads: Record<string, unknown>[] = [];
    const baseStreamFn = (_model: unknown, _context: unknown, options: unknown) => {
      const payload = {
        model: "deepseek-v4-pro",
        thinking: { type: "enabled" },
        reasoning_effort: "high",
        messages: [
          {
            role: "assistant",
            reasoning_content: null,
            tool_calls: [
              {
                id: "call_1",
                type: "function",
                function: { name: "read", arguments: "{}" },
              },
            ],
          },
          { role: "assistant", content: "done" },
        ],
      };
      (options as { onPayload?: (payload: Record<string, unknown>) => void })?.onPayload?.(payload);
      capturedPayloads.push(payload);
      return {} as never;
    };

    const streamFn = provider.wrapStreamFn?.({
      streamFn: baseStreamFn as never,
      providerId: "venice",
      modelId: "deepseek-v4-pro",
      thinkingLevel: "high",
    } as never);

    expect(streamFn).toBeTypeOf("function");
    await streamFn?.({ provider: "venice", id: "deepseek-v4-pro" } as never, {} as never, {});

    expect(capturedPayloads).toEqual([
      {
        model: "deepseek-v4-pro",
        messages: [
          {
            role: "assistant",
            tool_calls: [
              {
                id: "call_1",
                type: "function",
                function: { name: "read", arguments: "{}" },
              },
            ],
            reasoning_content: "",
          },
          {
            role: "assistant",
            content: "done",
            reasoning_content: "",
          },
        ],
      },
    ]);
  });

  it("overwrites hostile configurable Venice replay payload fields", async () => {
    const provider = await registerSingleProviderPlugin(plugin);
    let capturedPayload: Record<string, unknown> | undefined;
    const baseStreamFn = (_model: unknown, _context: unknown, options: unknown) => {
      const assistantMessage: Record<string, unknown> = { role: "assistant" };
      Object.defineProperty(assistantMessage, "reasoning_content", {
        configurable: true,
        get() {
          throw new Error("reasoning_content getter failed");
        },
      });
      const payload: Record<string, unknown> = {
        model: "deepseek-v4-pro",
        reasoning_effort: "high",
        messages: [assistantMessage],
      };
      Object.defineProperty(payload, "thinking", {
        configurable: true,
        get() {
          throw new Error("thinking getter failed");
        },
      });
      (options as { onPayload?: (payload: Record<string, unknown>) => void })?.onPayload?.(payload);
      capturedPayload = payload;
      return {} as never;
    };

    const streamFn = provider.wrapStreamFn?.({
      streamFn: baseStreamFn as never,
      providerId: "venice",
      modelId: "deepseek-v4-pro",
      thinkingLevel: "high",
    } as never);

    await streamFn?.({ provider: "venice", id: "deepseek-v4-pro" } as never, {} as never, {});

    expect(capturedPayload).toEqual({
      model: "deepseek-v4-pro",
      messages: [{ role: "assistant", reasoning_content: "" }],
    });
  });

  it("fails closed when Venice replay payload fields cannot be removed", async () => {
    const provider = await registerSingleProviderPlugin(plugin);
    const baseStreamFn = (_model: unknown, _context: unknown, options: unknown) => {
      const payload: Record<string, unknown> = {
        model: "deepseek-v4-pro",
        messages: [],
      };
      Object.defineProperty(payload, "thinking", {
        configurable: false,
        value: { type: "enabled" },
      });
      (options as { onPayload?: (payload: Record<string, unknown>) => void })?.onPayload?.(payload);
      return {} as never;
    };

    const streamFn = provider.wrapStreamFn?.({
      streamFn: baseStreamFn as never,
      providerId: "venice",
      modelId: "deepseek-v4-pro",
      thinkingLevel: "high",
    } as never);

    expect(() =>
      streamFn?.({ provider: "venice", id: "deepseek-v4-pro" } as never, {} as never, {}),
    ).toThrow("Venice payload field could not be removed: thinking");
  });
});
