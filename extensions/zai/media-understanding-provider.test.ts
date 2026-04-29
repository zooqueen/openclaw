import type { Api, Model } from "@mariozechner/pi-ai";
import { describe, expect, it } from "vitest";
import {
  resolveZaiVisionStandardBaseUrl,
  routeZaiVisionModelToStandardEndpoint,
  zaiMediaUnderstandingProvider,
} from "./media-understanding-provider.js";
import {
  ZAI_CN_BASE_URL,
  ZAI_CODING_CN_BASE_URL,
  ZAI_CODING_GLOBAL_BASE_URL,
  ZAI_GLOBAL_BASE_URL,
} from "./model-definitions.js";

function createZaiModel(overrides: Partial<Model<Api>> = {}): Model<Api> {
  return {
    id: "glm-4.6v",
    name: "GLM-4.6V",
    api: "openai-completions",
    provider: "zai",
    baseUrl: ZAI_CODING_GLOBAL_BASE_URL,
    reasoning: true,
    input: ["text", "image"],
    cost: { input: 0.3, output: 0.9, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128000,
    maxTokens: 32768,
    ...overrides,
  };
}

describe("zai media understanding provider", () => {
  it.each([
    [ZAI_CODING_GLOBAL_BASE_URL, ZAI_GLOBAL_BASE_URL],
    [ZAI_CODING_CN_BASE_URL, ZAI_CN_BASE_URL],
    ["https://proxy.example.com/api/coding/paas/v5", "https://proxy.example.com/api/paas/v5"],
  ])("maps coding endpoint %s to standard multimodal endpoint %s", (baseUrl, expected) => {
    expect(resolveZaiVisionStandardBaseUrl(baseUrl)).toBe(expected);
    expect(resolveZaiVisionStandardBaseUrl(`${baseUrl}/`)).toBe(expected);
  });

  it.each(["glm-4.6v", "glm-4.5v", "glm-5v-turbo"])(
    "routes %s vision requests away from Coding Plan base URLs",
    (modelId) => {
      const model = createZaiModel({ id: modelId, name: modelId });
      const routed = routeZaiVisionModelToStandardEndpoint(model);

      expect(routed).toMatchObject({
        id: modelId,
        provider: "zai",
        baseUrl: ZAI_GLOBAL_BASE_URL,
        input: ["text", "image"],
      });
      expect(routed).not.toBe(model);
      expect(model.baseUrl).toBe(ZAI_CODING_GLOBAL_BASE_URL);
    },
  );

  it("keeps text-only ZAI models on the configured Coding Plan endpoint", () => {
    const model = createZaiModel({
      id: "glm-5.1",
      name: "GLM-5.1",
      input: ["text"],
      baseUrl: ZAI_CODING_CN_BASE_URL,
    });

    expect(routeZaiVisionModelToStandardEndpoint(model)).toBe(model);
    expect(model.baseUrl).toBe(ZAI_CODING_CN_BASE_URL);
  });

  it("keeps non-coding ZAI endpoints unchanged", () => {
    const model = createZaiModel({ baseUrl: ZAI_GLOBAL_BASE_URL });

    expect(resolveZaiVisionStandardBaseUrl(ZAI_GLOBAL_BASE_URL)).toBeUndefined();
    expect(routeZaiVisionModelToStandardEndpoint(model)).toBe(model);
  });

  it("declares ZAI image understanding support", () => {
    expect(zaiMediaUnderstandingProvider).toMatchObject({
      id: "zai",
      capabilities: ["image"],
      defaultModels: { image: "glm-4.6v" },
      autoPriority: { image: 60 },
      describeImage: expect.any(Function),
      describeImages: expect.any(Function),
    });
  });
});
