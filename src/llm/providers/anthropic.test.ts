import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Context, Model } from "../types.js";

const anthropicMockState = vi.hoisted(() => ({
  configs: [] as unknown[],
  createImpl: null as null | ((params: unknown, options: unknown) => unknown),
}));

vi.mock("@anthropic-ai/sdk", () => ({
  default: class MockAnthropic {
    messages = {
      create: vi.fn((params: unknown, options: unknown) => {
        if (anthropicMockState.createImpl) {
          return anthropicMockState.createImpl(params, options);
        }
        throw new Error("stop after constructor");
      }),
    };

    constructor(config: unknown) {
      anthropicMockState.configs.push(config);
    }
  },
}));

import { streamAnthropic, streamSimpleAnthropic } from "./anthropic.js";

function createSseResponse(events: Record<string, unknown>[] = []): Response {
  const body = events
    .map((event) => `event: ${String(event.type)}\ndata: ${JSON.stringify(event)}\n\n`)
    .join("");
  return new Response(body, {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}

function makeAnthropicModel(overrides: Partial<Model<"anthropic-messages">> = {}) {
  return {
    id: "claude-sonnet-4-6",
    name: "Claude Sonnet 4.6",
    provider: "anthropic",
    api: "anthropic-messages",
    baseUrl: "https://api.anthropic.com",
    reasoning: true,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 200_000,
    maxTokens: 4096,
    ...overrides,
  } satisfies Model<"anthropic-messages">;
}

describe("Anthropic provider", () => {
  beforeEach(() => {
    anthropicMockState.configs = [];
    anthropicMockState.createImpl = null;
  });

  it("keeps Cloudflare AI Gateway upstream provider auth on the Anthropic API key", async () => {
    const model = makeAnthropicModel({
      provider: "cloudflare-ai-gateway",
      baseUrl: "https://gateway.ai.cloudflare.com/v1/account/gateway/anthropic/v1/messages",
      headers: {
        "cf-aig-authorization": "Bearer gateway-token",
      },
    });
    const context = {
      messages: [{ role: "user", content: "hello", timestamp: 1 }],
    } satisfies Context;

    streamAnthropic(model, context, {
      apiKey: "sk-ant-provider",
    });

    await vi.waitFor(() => expect(anthropicMockState.configs).toHaveLength(1));
    const config = anthropicMockState.configs[0] as {
      apiKey?: string | null;
      authToken?: string | null;
      defaultHeaders?: Record<string, string | null>;
    };

    expect(config.apiKey).toBe("sk-ant-provider");
    expect(config.authToken).toBeNull();
    expect(config.defaultHeaders?.["x-api-key"]).toBeUndefined();
    expect(config.defaultHeaders?.["cf-aig-authorization"]).toBe("Bearer gateway-token");
  });

  it("preserves provider-signed Anthropic thinking text on replay", async () => {
    const highSurrogate = String.fromCharCode(0xd83d);
    const signedThinking = `keep${highSurrogate}signed`;
    let capturedPayload: unknown;
    const client = {
      messages: {
        create: vi.fn(() => ({
          asResponse: () =>
            Promise.resolve(
              createSseResponse([
                {
                  type: "message_start",
                  message: { id: "msg_1", usage: { input_tokens: 1, output_tokens: 0 } },
                },
                {
                  type: "message_delta",
                  delta: { stop_reason: "end_turn" },
                  usage: { input_tokens: 1, output_tokens: 1 },
                },
                { type: "message_stop" },
              ]),
            ),
        })),
      },
    };

    const stream = streamAnthropic(
      makeAnthropicModel(),
      {
        messages: [
          { role: "user", content: "hello", timestamp: 0 },
          {
            role: "assistant",
            provider: "anthropic",
            api: "anthropic-messages",
            model: "claude-sonnet-4-6",
            stopReason: "stop",
            timestamp: 0,
            usage: {
              input: 0,
              output: 0,
              cacheRead: 0,
              cacheWrite: 0,
              totalTokens: 0,
              cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
            },
            content: [
              {
                type: "thinking",
                thinking: signedThinking,
                thinkingSignature: "sig_1",
              },
              {
                type: "thinking",
                thinking: `sanitize${highSurrogate}synthetic`,
                thinkingSignature: "reasoning_content",
              },
            ],
          },
          { role: "user", content: "again", timestamp: 0 },
        ],
      },
      {
        apiKey: "sk-ant-provider",
        client: client as never,
        onPayload: (payload) => {
          capturedPayload = payload;
        },
      },
    );

    await stream.result();

    const payload = capturedPayload as { messages: Array<{ role: string; content: unknown[] }> };
    const assistantMessage = payload.messages.find((message) => message.role === "assistant");
    expect(assistantMessage?.content).toEqual([
      {
        type: "thinking",
        thinking: signedThinking,
        signature: "sig_1",
      },
      {
        type: "thinking",
        thinking: "sanitizesynthetic",
        signature: "reasoning_content",
      },
    ]);
  });

  it("skips malformed tools when building Anthropic provider payloads", async () => {
    let capturedPayload: unknown;
    const tools = [
      {
        get name() {
          throw new Error("legacy anthropic tool name getter exploded");
        },
        description: "unreadable name",
        parameters: { type: "object", properties: {} },
      },
      {
        name: "description_poisoned_tool",
        get description() {
          throw new Error("legacy anthropic tool description getter exploded");
        },
        parameters: {
          type: "object",
          properties: {
            query: { type: "string" },
          },
        },
      },
      {
        name: "parameters_poisoned_tool",
        get parameters() {
          throw new Error("legacy anthropic tool parameters getter exploded");
        },
      },
      {
        name: "dynamic_schema_tool",
        description: "unsupported dynamic schema",
        parameters: {
          type: "object",
          properties: {
            target: { $dynamicRef: "#target" },
          },
        },
      },
      {
        name: "tojson_projected_tool",
        description: "schema projection differs from live properties",
        parameters: {
          type: "object",
          properties: {
            target: { $dynamicRef: "#target" },
          },
          toJSON() {
            return {
              type: "object",
              properties: {
                safe: { type: "string" },
              },
              required: ["safe"],
            };
          },
        },
      },
      {
        name: "dynamic_keyword_field_tool",
        description: "schema map names can look like dynamic schema keywords",
        parameters: {
          type: "object",
          properties: {
            $dynamicRef: { type: "string" },
          },
          required: ["$dynamicRef"],
        },
      },
      {
        name: "good_plugin_tool",
        description: "valid schema",
        parameters: {
          type: "object",
          properties: {
            query: { type: "string" },
          },
          required: ["query"],
        },
      },
    ];

    const stream = streamAnthropic(
      makeAnthropicModel(),
      {
        messages: [{ role: "user", content: "hello", timestamp: 0 }],
        tools,
      } as unknown as Context,
      {
        apiKey: "sk-ant-provider",
        onPayload: (payload) => {
          capturedPayload = payload;
          throw new Error("stop before network");
        },
      },
    );

    const result = await stream.result();

    expect(result.stopReason).toBe("error");
    expect(result.errorMessage).toContain("stop before network");
    const payloadTools = (capturedPayload as { tools?: Array<Record<string, unknown>> }).tools;
    expect(payloadTools).toHaveLength(4);
    expect(payloadTools?.[0]).toMatchObject({
      name: "description_poisoned_tool",
      input_schema: {
        properties: {
          query: { type: "string" },
        },
      },
    });
    expect(payloadTools?.[0]).not.toHaveProperty("description");
    expect(payloadTools?.[1]).toMatchObject({
      name: "tojson_projected_tool",
      input_schema: {
        properties: {
          safe: { type: "string" },
        },
        required: ["safe"],
      },
    });
    expect(payloadTools?.[2]).toMatchObject({
      name: "dynamic_keyword_field_tool",
      description: "schema map names can look like dynamic schema keywords",
      input_schema: {
        properties: {
          $dynamicRef: { type: "string" },
        },
        required: ["$dynamicRef"],
      },
    });
    expect(payloadTools?.[3]).toMatchObject({
      name: "good_plugin_tool",
      description: "valid schema",
      input_schema: {
        properties: {
          query: { type: "string" },
        },
        required: ["query"],
      },
    });
  });

  it("remaps OAuth tool-use names without scanning poisoned descriptors", async () => {
    anthropicMockState.createImpl = () => ({
      asResponse: () =>
        Promise.resolve(
          createSseResponse([
            {
              type: "message_start",
              message: { id: "msg_1", usage: { input_tokens: 1, output_tokens: 0 } },
            },
            {
              type: "content_block_start",
              index: 0,
              content_block: {
                type: "tool_use",
                id: "toolu_1",
                name: "Read",
                input: { file_path: "README.md" },
              },
            },
            { type: "content_block_stop", index: 0 },
            {
              type: "message_delta",
              delta: { stop_reason: "tool_use" },
              usage: { input_tokens: 1, output_tokens: 1 },
            },
            { type: "message_stop" },
          ]),
        ),
    });
    const tools = [
      {
        get name() {
          throw new Error("legacy anthropic OAuth remap name getter exploded");
        },
        description: "unreadable name",
        parameters: { type: "object", properties: {} },
      },
      {
        name: "read",
        description: "read a file",
        parameters: { type: "object", properties: {} },
      },
    ];

    const stream = streamAnthropic(
      makeAnthropicModel(),
      {
        messages: [{ role: "user", content: "hello", timestamp: 0 }],
        tools,
      } as unknown as Context,
      {
        apiKey: "sk-ant-oat-example",
      },
    );

    const result = await stream.result();

    expect(result.stopReason).toBe("toolUse");
    expect(result.content).toContainEqual(
      expect.objectContaining({
        type: "toolCall",
        name: "read",
      }),
    );
  });

  it("clamps max adaptive effort when the Claude model does not advertise it", async () => {
    let capturedPayload: unknown;
    const stream = streamSimpleAnthropic(
      makeAnthropicModel({
        id: "claude-sonnet-4-6",
        name: "Claude Sonnet 4.6",
      }),
      {
        messages: [{ role: "user", content: "hello", timestamp: 0 }],
      },
      {
        apiKey: "sk-ant-provider",
        reasoning: "max",
        onPayload: (payload) => {
          capturedPayload = payload;
        },
      },
    );

    await stream.result();

    expect((capturedPayload as { output_config?: unknown }).output_config).toEqual({
      effort: "high",
    });
  });

  it("forwards simple stop sequences to Anthropic stop_sequences", async () => {
    let capturedPayload: unknown;
    const stream = streamSimpleAnthropic(
      makeAnthropicModel(),
      {
        messages: [{ role: "user", content: "hello", timestamp: 0 }],
      },
      {
        apiKey: "sk-ant-provider",
        stop: ["STOP"],
        onPayload: (payload) => {
          capturedPayload = payload;
          throw new Error("stop before network");
        },
      },
    );

    const result = await stream.result();

    expect(result.stopReason).toBe("error");
    expect((capturedPayload as { stop_sequences?: unknown }).stop_sequences).toEqual(["STOP"]);
  });
});
