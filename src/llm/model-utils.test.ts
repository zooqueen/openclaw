// Shared model utility tests cover provider-agnostic thinking metadata handling.
import { describe, expect, it } from "vitest";
import {
  calculateCost,
  clampThinkingLevel,
  getSupportedThinkingLevels,
  modelsAreEqual,
} from "./model-utils.js";
import type { Model } from "./types.js";

const baseModel = {
  id: "reasoning-model",
  name: "Reasoning Model",
  api: "openai-responses",
  provider: "openai",
  baseUrl: "https://api.openai.com/v1",
  reasoning: true,
  input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 128000,
  maxTokens: 4096,
} satisfies Model<"openai-responses">;

function usage() {
  return {
    input: 1000,
    output: 2000,
    cacheRead: 3000,
    cacheWrite: 4000,
    totalTokens: 10000,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };
}

describe("model cost metadata", () => {
  it("treats unreadable model cost metadata as zero cost", () => {
    const model = Object.defineProperties(
      { ...baseModel },
      {
        cost: {
          get() {
            throw new Error("cost getter should be caught");
          },
        },
      },
    ) as Model<"openai-responses">;

    expect(calculateCost(model, usage())).toEqual({
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      total: 0,
    });
  });

  it("skips unreadable nested model cost fields", () => {
    const cost = Object.defineProperties(
      {},
      {
        input: {
          value: 2,
        },
        output: {
          get() {
            throw new Error("output getter should be caught");
          },
        },
        cacheRead: {
          value: 4,
        },
        cacheWrite: {
          get() {
            throw new Error("cacheWrite getter should be caught");
          },
        },
      },
    );
    const model = Object.assign({}, baseModel, { cost }) as Model<"openai-responses">;

    expect(calculateCost(model, usage())).toEqual({
      input: 0.002,
      output: 0,
      cacheRead: 0.012,
      cacheWrite: 0,
      total: 0.014,
    });
  });

  it("preserves readable accessor-backed model cost metadata", () => {
    const cost = Object.defineProperties(
      {},
      {
        input: {
          get() {
            return 2;
          },
        },
        output: {
          get() {
            return 3;
          },
        },
        cacheRead: {
          get() {
            return 4;
          },
        },
        cacheWrite: {
          get() {
            return 5;
          },
        },
      },
    );
    const model = Object.assign({}, baseModel, { cost }) as Model<"openai-responses">;

    expect(calculateCost(model, usage())).toEqual({
      input: 0.002,
      output: 0.006,
      cacheRead: 0.012,
      cacheWrite: 0.02,
      total: 0.04,
    });
  });
});

describe("thinking level metadata", () => {
  it("treats unreadable model thinking metadata as non-reasoning", () => {
    const model = Object.defineProperties(
      { ...baseModel },
      {
        reasoning: {
          get() {
            throw new Error("reasoning getter should be caught");
          },
        },
        thinkingLevelMap: {
          get() {
            throw new Error("thinkingLevelMap getter should be caught");
          },
        },
      },
    ) as Model<"openai-responses">;

    expect(getSupportedThinkingLevels(model)).toEqual(["off"]);
    expect(clampThinkingLevel(model, "high")).toBe("off");
  });

  it("preserves readable accessor-backed thinking metadata", () => {
    const model = Object.defineProperties(
      { ...baseModel },
      {
        reasoning: {
          get() {
            return true;
          },
        },
        thinkingLevelMap: {
          get() {
            return { off: null, low: null, xhigh: "high", max: null };
          },
        },
      },
    ) as Model<"openai-responses">;

    expect(getSupportedThinkingLevels(model)).toEqual(["minimal", "medium", "high", "xhigh"]);
    expect(clampThinkingLevel(model, "max")).toBe("xhigh");
  });

  it("skips unreadable thinking-level map entries", () => {
    const thinkingLevelMap = Object.defineProperties(
      {},
      {
        xhigh: {
          get() {
            throw new Error("xhigh getter should be caught");
          },
        },
        max: {
          value: "max",
        },
      },
    );
    const model = Object.assign({}, baseModel, { thinkingLevelMap }) as Model<"openai-responses">;

    expect(getSupportedThinkingLevels(model)).toContain("max");
    expect(getSupportedThinkingLevels(model)).not.toContain("xhigh");
  });
});

describe("model identity metadata", () => {
  it("treats unreadable model identity as unequal", () => {
    const hostile = Object.defineProperties(
      { ...baseModel },
      {
        id: {
          get() {
            throw new Error("id getter should be caught");
          },
        },
        provider: {
          get() {
            throw new Error("provider getter should be caught");
          },
        },
      },
    ) as Model<"openai-responses">;

    expect(modelsAreEqual(hostile, baseModel)).toBe(false);
    expect(modelsAreEqual(baseModel, hostile)).toBe(false);
    expect(modelsAreEqual(hostile, hostile)).toBe(false);
  });

  it("preserves readable accessor-backed model identity", () => {
    const accessorModel = Object.defineProperties(
      { ...baseModel },
      {
        id: {
          get() {
            return "reasoning-model";
          },
        },
        provider: {
          get() {
            return "openai";
          },
        },
      },
    ) as Model<"openai-responses">;

    expect(modelsAreEqual(accessorModel, baseModel)).toBe(true);
    expect(modelsAreEqual(accessorModel, { ...baseModel, id: "other-model" })).toBe(false);
  });
});
