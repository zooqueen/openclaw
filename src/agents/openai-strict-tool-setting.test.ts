// OpenAI strict-tool setting tests cover model metadata quarantine before provider setup.
import { describe, expect, it } from "vitest";
import { resolveOpenAIStrictToolSetting } from "./openai-strict-tool-setting.js";

describe("resolveOpenAIStrictToolSetting", () => {
  it("ignores unreadable model metadata while resolving strict-tool defaults", () => {
    const model = Object.defineProperties(
      {},
      {
        provider: {
          get() {
            throw new Error("provider getter should be caught");
          },
        },
        api: {
          get() {
            throw new Error("api getter should be caught");
          },
        },
        baseUrl: {
          get() {
            throw new Error("baseUrl getter should be caught");
          },
        },
        id: {
          get() {
            throw new Error("id getter should be caught");
          },
        },
        compat: {
          get() {
            throw new Error("compat getter should be caught");
          },
        },
      },
    );

    expect(resolveOpenAIStrictToolSetting(model)).toBeUndefined();
    expect(resolveOpenAIStrictToolSetting(model, { supportsStrictMode: true })).toBe(false);
  });

  it("preserves readable accessor-backed native OpenAI metadata", () => {
    const model = Object.defineProperties(
      {},
      {
        provider: {
          get() {
            return "openai";
          },
        },
        api: {
          get() {
            return "openai-responses";
          },
        },
        baseUrl: {
          get() {
            return "https://api.openai.com/v1";
          },
        },
        id: {
          get() {
            return "gpt-5.5";
          },
        },
      },
    );

    expect(resolveOpenAIStrictToolSetting(model)).toBe(true);
  });
});
