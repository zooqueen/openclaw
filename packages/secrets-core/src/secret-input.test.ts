import { describe, expect, it } from "vitest";
import {
  normalizeOptionalSecretInput,
  normalizeResolvedSecretInputString,
  normalizeSecretInput,
  parseLegacySecretRefEnvMarker,
  resolveSecretInputString,
} from "./index.js";

describe("normalizeSecretInput", () => {
  it("returns empty string for non-string values", () => {
    expect(normalizeSecretInput(undefined)).toBe("");
    expect(normalizeSecretInput(null)).toBe("");
    expect(normalizeSecretInput(123)).toBe("");
    expect(normalizeSecretInput({})).toBe("");
  });

  it("strips embedded line breaks and surrounding whitespace", () => {
    expect(normalizeSecretInput("  sk-\r\nabc\n123  ")).toBe("sk-abc123");
  });

  it("drops non-Latin1 code points that can break HTTP ByteString headers", () => {
    expect(normalizeSecretInput("key-\u0417\u2502-token")).toBe("key--token");
  });

  it("preserves Latin-1 characters and internal spaces", () => {
    expect(normalizeSecretInput("  café token  ")).toBe("café token");
  });
});

describe("normalizeOptionalSecretInput", () => {
  it("returns undefined when normalized value is empty", () => {
    expect(normalizeOptionalSecretInput(" \r\n ")).toBeUndefined();
    expect(normalizeOptionalSecretInput("\u0417\u2502")).toBeUndefined();
  });

  it("returns normalized value when non-empty", () => {
    expect(normalizeOptionalSecretInput("  key-\u0417  ")).toBe("key-");
  });
});

describe("resolveSecretInputString", () => {
  it("returns available for non-empty string values", () => {
    expect(
      resolveSecretInputString({
        value: "  abc123  ",
        path: "models.providers.openai.apiKey",
      }),
    ).toEqual({
      status: "available",
      value: "abc123",
      ref: null,
    });
  });

  it("returns configured_unavailable for unresolved refs in inspect mode", () => {
    expect(
      resolveSecretInputString({
        value: { source: "env", provider: "default", id: "OPENAI_API_KEY" },
        path: "models.providers.openai.apiKey",
        mode: "inspect",
      }),
    ).toEqual({
      status: "configured_unavailable",
      value: undefined,
      ref: { source: "env", provider: "default", id: "OPENAI_API_KEY" },
    });
  });

  it("uses explicit refValue in inspect mode", () => {
    expect(
      resolveSecretInputString({
        value: "",
        refValue: { source: "env", provider: "default", id: "OPENAI_API_KEY" },
        path: "profiles.default.key",
        mode: "inspect",
      }),
    ).toEqual({
      status: "configured_unavailable",
      value: undefined,
      ref: { source: "env", provider: "default", id: "OPENAI_API_KEY" },
    });
  });

  it("returns missing when no value or ref is configured", () => {
    expect(
      resolveSecretInputString({
        value: "",
        path: "models.providers.openai.apiKey",
        mode: "inspect",
      }),
    ).toEqual({
      status: "missing",
      value: undefined,
      ref: null,
    });
  });

  it("throws for unresolved refs in strict mode", () => {
    expect(() =>
      resolveSecretInputString({
        value: { source: "env", provider: "default", id: "OPENAI_API_KEY" },
        path: "models.providers.openai.apiKey",
      }),
    ).toThrow(/unresolved SecretRef/);
  });
});

describe("normalizeResolvedSecretInputString", () => {
  it("keeps strict unresolved-ref behavior", () => {
    expect(() =>
      normalizeResolvedSecretInputString({
        value: { source: "env", provider: "default", id: "OPENAI_API_KEY" },
        path: "models.providers.openai.apiKey",
      }),
    ).toThrow(/unresolved SecretRef/);
  });
});

describe("parseLegacySecretRefEnvMarker", () => {
  it("parses legacy env marker strings without making them valid SecretInput strings", () => {
    expect(parseLegacySecretRefEnvMarker("secretref-env:OPENAI_API_KEY")).toEqual({
      source: "env",
      provider: "default",
      id: "OPENAI_API_KEY",
    });
    expect(parseLegacySecretRefEnvMarker("__env__:BAILIAN_API_KEY")).toEqual({
      source: "env",
      provider: "default",
      id: "BAILIAN_API_KEY",
    });
    expect(parseLegacySecretRefEnvMarker("secretref-env:not-valid")).toBeNull();
    expect(
      resolveSecretInputString({
        value: "secretref-env:OPENAI_API_KEY",
        path: "models.providers.openai.apiKey",
        mode: "inspect",
      }),
    ).toEqual({
      status: "available",
      value: "secretref-env:OPENAI_API_KEY",
      ref: null,
    });
  });
});
