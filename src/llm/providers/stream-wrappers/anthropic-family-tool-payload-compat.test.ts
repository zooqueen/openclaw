// Anthropic-family payload compatibility tests cover provider payload projection.
import { describe, expect, it } from "vitest";
import type { StreamFn } from "../../../agents/runtime/index.js";
import { createOpenAIAnthropicToolPayloadCompatibilityWrapper } from "./anthropic-family-tool-payload-compat.js";

function runAnthropicPayloadWrapper(payload: Record<string, unknown>): void {
  const baseStreamFn: StreamFn = (_model, _context, options) => {
    options?.onPayload?.(payload, {} as never);
    return {} as ReturnType<StreamFn>;
  };
  const wrapped = createOpenAIAnthropicToolPayloadCompatibilityWrapper(baseStreamFn);

  void wrapped(
    {
      api: "anthropic-messages",
      provider: "openai-compatible-anthropic",
      id: "compat-model",
      compat: { requiresOpenAiAnthropicToolPayload: true },
    } as never,
    { messages: [] } as never,
    {},
  );
}

describe("createOpenAIAnthropicToolPayloadCompatibilityWrapper", () => {
  it("skips unreadable tool rows while preserving healthy converted tools", () => {
    const unreadableName = {};
    Object.defineProperty(unreadableName, "name", {
      enumerable: true,
      get() {
        throw new Error("raw name getter");
      },
    });
    const unreadableSchema = { name: "poisoned" };
    Object.defineProperty(unreadableSchema, "input_schema", {
      enumerable: true,
      get() {
        throw new Error("raw schema getter");
      },
    });
    const payload = {
      tools: [
        unreadableName,
        unreadableSchema,
        {
          name: "lookup",
          description: "Lookup docs",
          input_schema: { type: "object", properties: { query: { type: "string" } } },
          strict: true,
        },
      ],
    };

    runAnthropicPayloadWrapper(payload);

    expect(payload.tools).toEqual([
      {
        type: "function",
        function: {
          name: "lookup",
          description: "Lookup docs",
          parameters: { type: "object", properties: { query: { type: "string" } } },
          strict: true,
        },
      },
    ]);
  });

  it("drops unreadable payload fields instead of crashing compatibility cleanup", () => {
    const payload: Record<string, unknown> = {};
    Object.defineProperty(payload, "tools", {
      enumerable: true,
      configurable: true,
      get() {
        throw new Error("raw tools getter");
      },
    });
    Object.defineProperty(payload, "tool_choice", {
      enumerable: true,
      configurable: true,
      get() {
        throw new Error("raw tool choice getter");
      },
    });

    runAnthropicPayloadWrapper(payload);

    expect(Object.hasOwn(payload, "tools")).toBe(false);
    expect(Object.hasOwn(payload, "tool_choice")).toBe(false);
  });
});
