// Kimi Coding live tests cover the native subscription endpoint.
import { streamSimple, type Context, type Model, type Tool } from "openclaw/plugin-sdk/llm";
import { registerSingleProviderPlugin } from "openclaw/plugin-sdk/plugin-test-runtime";
import { encodePngRgba, fillPixel, isLiveTestEnabled } from "openclaw/plugin-sdk/test-env";
import { Type } from "typebox";
import { describe, expect, it } from "vitest";
import plugin from "./index.js";
import { buildKimiCodingProvider } from "./provider-catalog.js";

const KIMI_API_KEY = process.env.KIMI_API_KEY?.trim() ?? "";
const describeLive = isLiveTestEnabled() && KIMI_API_KEY.length > 0 ? describe : describe.skip;

function createReferencePng(): Buffer {
  const width = 96;
  const height = 96;
  const pixels = Buffer.alloc(width * height * 4, 255);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      fillPixel(pixels, x, y, width, 225, 242, 255, 255);
    }
  }
  for (let y = 20; y < 76; y += 1) {
    for (let x = 20; x < 76; x += 1) {
      fillPixel(pixels, x, y, width, 255, 140, 0, 255);
    }
  }

  return encodePngRgba(pixels, width, height);
}

function resolveKimiCodingModel(): Model<"openai-completions"> {
  const provider = buildKimiCodingProvider();
  const model = provider.models.find((entry) => entry.id === "kimi-for-coding");
  if (!model) {
    throw new Error("Kimi Coding catalog does not include kimi-for-coding");
  }
  return {
    provider: "kimi",
    baseUrl: provider.baseUrl,
    headers: provider.headers,
    ...model,
    api: "openai-completions",
  } as Model<"openai-completions">;
}

function createColorTool(): Tool {
  return {
    name: "report_color",
    description: "Report the color of the large central square in the supplied image.",
    parameters: Type.Object(
      {
        color: Type.Union([Type.Literal("orange"), Type.Literal("purple")]),
      },
      { additionalProperties: false },
    ),
  };
}

describeLive("kimi coding image live", () => {
  it("analyzes an image through chat completions and completes a tool replay", async () => {
    const provider = await registerSingleProviderPlugin(plugin);
    const wrappedStream = provider.wrapStreamFn?.({
      provider: "kimi",
      modelId: "kimi-for-coding",
      thinkingLevel: "off",
      streamFn: streamSimple,
    } as never);
    if (!wrappedStream) {
      throw new Error("Kimi Coding provider did not register a stream wrapper");
    }

    const tool = createColorTool();
    const firstUser = {
      role: "user" as const,
      content: [
        {
          type: "text" as const,
          text: "Inspect the image. Call report_color once with orange or purple. Do not answer directly.",
        },
        {
          type: "image" as const,
          data: createReferencePng().toString("base64"),
          mimeType: "image/png",
        },
      ],
      timestamp: Date.now(),
    };
    const firstStream = await wrappedStream(
      resolveKimiCodingModel(),
      { messages: [firstUser], tools: [tool] },
      {
        apiKey: KIMI_API_KEY,
        maxTokens: 512,
      },
    );
    const first = await firstStream.result();
    if (first.stopReason === "error") {
      throw new Error(first.errorMessage || "Kimi Coding image request failed");
    }

    const toolCall = first.content.find((block) => block.type === "toolCall");
    if (!toolCall || toolCall.type !== "toolCall") {
      throw new Error(`Kimi Coding did not call report_color: ${first.stopReason}`);
    }
    expect(toolCall.name).toBe("report_color");
    expect(toolCall.arguments.color).toBe("orange");

    const replayContext: Context = {
      messages: [
        firstUser,
        first,
        {
          role: "toolResult",
          toolCallId: toolCall.id,
          toolName: toolCall.name,
          content: [{ type: "text", text: "image-ok" }],
          isError: false,
          timestamp: Date.now(),
        },
        {
          role: "user",
          content: "Reply with exactly: IMAGE_OK",
          timestamp: Date.now(),
        },
      ],
      tools: [tool],
    };
    const secondStream = await wrappedStream(resolveKimiCodingModel(), replayContext, {
      apiKey: KIMI_API_KEY,
      maxTokens: 128,
    });
    const second = await secondStream.result();
    if (second.stopReason === "error") {
      throw new Error(second.errorMessage || "Kimi Coding tool replay failed");
    }

    const text = second.content
      .filter((block) => block.type === "text")
      .map((block) => block.text.trim())
      .join(" ");
    expect(text).toMatch(/^IMAGE_OK[.!]?$/i);
  }, 180_000);
});
