import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveImplicitProviders } from "./models-config.providers.js";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("Ollama provider", () => {
  const previousEnv = { ...process.env };

  afterEach(() => {
    for (const key of Object.keys(process.env)) {
      if (!(key in previousEnv)) delete process.env[key];
    }
    for (const [key, value] of Object.entries(previousEnv)) {
      process.env[key] = value;
    }
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("should not include ollama when no API key is configured", async () => {
    const agentDir = mkdtempSync(join(tmpdir(), "clawd-test-"));
    const providers = await resolveImplicitProviders({ agentDir });

    // Ollama requires explicit configuration via OLLAMA_API_KEY env var or profile
    expect(providers?.ollama).toBeUndefined();
  });

  it("discovers tool-capable models when OLLAMA_API_KEY is set", async () => {
    process.env.OLLAMA_API_KEY = "ollama-local";
    delete process.env.VITEST;
    process.env.NODE_ENV = "development";

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          models: [{ name: "llama3.3" }, { name: "no-tools-model" }],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          capabilities: ["tools", "thinking"],
          model_info: {
            "general.architecture": "llama",
            "llama.context_length": "4096",
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          capabilities: ["thinking"],
          model_info: {
            "general.architecture": "llama",
            "llama.context_length": "2048",
          },
        }),
      });
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    const agentDir = mkdtempSync(join(tmpdir(), "clawd-test-"));
    const providers = await resolveImplicitProviders({ agentDir });

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("http://127.0.0.1:11434/api/tags");
    expect(fetchMock.mock.calls[1]?.[0]).toBe("http://127.0.0.1:11434/api/show");

    const provider = providers?.ollama;
    expect(provider?.baseUrl).toBe("http://127.0.0.1:11434/v1");
    expect(provider?.models).toHaveLength(1);
    expect(provider?.models?.[0]?.id).toBe("llama3.3");
    expect(provider?.models?.[0]?.reasoning).toBe(true);
    expect(provider?.models?.[0]?.contextWindow).toBe(4096);
    expect(provider?.models?.[0]?.maxTokens).toBe(4096 * 10);
  });

  it("skips discovery when ollama is explicitly configured", async () => {
    process.env.OLLAMA_API_KEY = "ollama-local";
    delete process.env.VITEST;
    process.env.NODE_ENV = "development";

    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    const agentDir = mkdtempSync(join(tmpdir(), "clawd-test-"));
    const providers = await resolveImplicitProviders({
      agentDir,
      explicitProviders: {
        ollama: {
          baseUrl: "http://example.com/v1",
          api: "openai-completions",
          models: [],
        },
      },
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(providers?.ollama).toBeUndefined();
  });
});
