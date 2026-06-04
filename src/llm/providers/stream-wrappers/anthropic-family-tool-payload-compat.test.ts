import type { StreamFn } from "openclaw/plugin-sdk/agent-core";
import type { Model } from "openclaw/plugin-sdk/llm";
import { createAssistantMessageEventStream } from "openclaw/plugin-sdk/llm";
import { describe, expect, it } from "vitest";
import { createOpenAIAnthropicToolPayloadCompatibilityWrapper } from "./anthropic-family-tool-payload-compat.js";

const model = {
  api: "anthropic-messages",
  provider: "openai-compatible-anthropic",
  id: "claude-compatible",
  compat: { requiresOpenAiAnthropicToolPayload: true },
} as unknown as Model<"anthropic-messages">;

describe("createOpenAIAnthropicToolPayloadCompatibilityWrapper", () => {
  it("skips unreadable tool schemas while preserving healthy payload tools", () => {
    const payloads: Array<Record<string, unknown>> = [];
    const baseStreamFn: StreamFn = (nextModel, context, options) => {
      const payload: Record<string, unknown> = {
        model: nextModel.id,
        tools: [
          {
            name: "bad_schema",
            description: "Bad schema",
            get parameters(): never {
              throw new Error("parameters getter exploded");
            },
          },
          {
            name: "lookup",
            description: "Lookup",
            parameters: {
              type: "object",
              properties: { query: { type: "string" } },
            },
          },
        ],
      };
      options?.onPayload?.(payload, nextModel);
      payloads.push(structuredClone(payload));
      return createAssistantMessageEventStream();
    };

    const wrapped = createOpenAIAnthropicToolPayloadCompatibilityWrapper(baseStreamFn);

    expect(() => void wrapped(model, { messages: [] }, {})).not.toThrow();
    expect(payloads[0]?.tools).toEqual([
      {
        type: "function",
        function: {
          name: "lookup",
          description: "Lookup",
          parameters: {
            type: "object",
            properties: { query: { type: "string" } },
          },
        },
      },
    ]);
  });

  it("uses Anthropic input_schema without reading a poisoned parameters fallback", () => {
    const payloads: Array<Record<string, unknown>> = [];
    const baseStreamFn: StreamFn = (nextModel, context, options) => {
      const payload: Record<string, unknown> = {
        model: nextModel.id,
        tools: [
          {
            name: "lookup",
            input_schema: {
              type: "object",
              properties: { query: { type: "string" } },
            },
            get parameters(): never {
              throw new Error("parameters fallback getter exploded");
            },
          },
        ],
      };
      options?.onPayload?.(payload, nextModel);
      payloads.push(structuredClone(payload));
      return createAssistantMessageEventStream();
    };

    const wrapped = createOpenAIAnthropicToolPayloadCompatibilityWrapper(baseStreamFn);

    expect(() => void wrapped(model, { messages: [] }, {})).not.toThrow();
    expect(payloads[0]?.tools).toEqual([
      {
        type: "function",
        function: {
          name: "lookup",
          parameters: {
            type: "object",
            properties: { query: { type: "string" } },
          },
        },
      },
    ]);
  });
});
