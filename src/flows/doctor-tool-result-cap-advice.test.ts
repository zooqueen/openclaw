import { describe, expect, it } from "vitest";
import { formatToolResultCapAdvice } from "./doctor-tool-result-cap-advice.js";

const DEFAULT_INPUT = {
  configuredCap: undefined,
  defaultCap: 16_000,
  schemaMaxCap: 250_000,
} as const;

describe("formatToolResultCapAdvice", () => {
  it("stays quiet when the user has explicitly set a cap", () => {
    const advice = formatToolResultCapAdvice({
      ...DEFAULT_INPUT,
      configuredCap: 32_000,
      primaryModelContextWindow: 200_000,
      primaryModelKey: "anthropic/claude-opus-4-7",
    });
    expect(advice).toEqual([]);
  });

  it("stays quiet when the primary model context window is unknown", () => {
    const advice = formatToolResultCapAdvice({
      ...DEFAULT_INPUT,
      primaryModelContextWindow: undefined,
      primaryModelKey: "unknown/model",
    });
    expect(advice).toEqual([]);
  });

  it("stays quiet for small-context models because the runtime share already caps below 16K", () => {
    const advice = formatToolResultCapAdvice({
      ...DEFAULT_INPUT,
      primaryModelContextWindow: 8_000,
      primaryModelKey: "openai/gpt-4-8k",
    });
    expect(advice).toEqual([]);
  });

  it("advises on 200K-context models with a model-aware suggested value", () => {
    const advice = formatToolResultCapAdvice({
      ...DEFAULT_INPUT,
      primaryModelContextWindow: 200_000,
      primaryModelKey: "anthropic/claude-opus-4-7",
    });
    expect(advice.length).toBeGreaterThan(0);
    const text = advice.join("\n");
    expect(text).toContain('"anthropic/claude-opus-4-7"');
    expect(text).toContain("200K context window");
    expect(text).toContain("16K default");
    expect(text).toContain("agents.defaults.contextLimits.toolResultMaxChars");
    expect(text).toContain("schema max 250K");
    expect(text).toMatch(/values around \d+K are typical/);
  });

  it("never suggests a value above the schema cap, even on 1M context models", () => {
    const advice = formatToolResultCapAdvice({
      ...DEFAULT_INPUT,
      primaryModelContextWindow: 1_000_000,
      primaryModelKey: "xai/grok-1m",
    });
    const text = advice.join("\n");
    expect(text).toContain("1M context window");
    expect(text).toContain("values around 250K are typical");
  });

  it("uses a generic label when the primary model key is missing", () => {
    const advice = formatToolResultCapAdvice({
      ...DEFAULT_INPUT,
      primaryModelContextWindow: 200_000,
      primaryModelKey: undefined,
    });
    expect(advice[0]).toContain("primary model has a 200K context window");
  });
});
