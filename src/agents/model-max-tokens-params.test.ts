import { describe, expect, it } from "vitest";
import { canonicalizeMaxTokensParam, resolveMaxTokensParam } from "./model-max-tokens-params.js";

describe("model max-token params", () => {
  it("skips dynamic max-token accessors while preserving healthy aliases", () => {
    const params: Record<string, unknown> = {
      max_tokens: 512,
    };
    Object.defineProperty(params, "maxTokens", {
      enumerable: true,
      get() {
        throw new Error("raw maxTokens getter failed");
      },
    });

    expect(resolveMaxTokensParam(params)).toBe(512);
  });

  it("canonicalizes healthy aliases without invoking dynamic accessors", () => {
    const merged: Record<string, unknown> = {
      max_tokens: 512,
    };
    Object.defineProperty(merged, "maxTokens", {
      configurable: true,
      enumerable: true,
      get() {
        throw new Error("raw maxTokens getter failed");
      },
    });

    canonicalizeMaxTokensParam({
      merged,
      sources: [merged],
    });

    expect(merged).toEqual({ maxTokens: 512 });
  });

  it("fails closed when conflicting aliases cannot be removed", () => {
    const merged: Record<string, unknown> = {
      max_tokens: 512,
    };
    Object.defineProperty(merged, "max_completion_tokens", {
      configurable: false,
      enumerable: true,
      value: 1024,
      writable: true,
    });

    expect(() =>
      canonicalizeMaxTokensParam({
        merged,
        sources: [merged],
      }),
    ).toThrow("max-token parameter could not be removed: max_completion_tokens");
  });
});
