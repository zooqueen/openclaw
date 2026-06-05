import { describe, expect, it, vi } from "vitest";
import { ExtensionRunner } from "./runner.js";
import type { Extension, ExtensionError, ExtensionRuntime } from "./types.js";

function createRuntime(): ExtensionRuntime {
  return {
    pendingProviderRegistrations: [],
    flagValues: new Map(),
    invalidate: vi.fn(),
  } as unknown as ExtensionRuntime;
}

function createExtension(path: string, handlers: Extension["handlers"]): Extension {
  return {
    path,
    resolvedPath: path,
    sourceInfo: {} as Extension["sourceInfo"],
    handlers,
    tools: new Map(),
    messageRenderers: new Map(),
    commands: new Map(),
    flags: new Map(),
    shortcuts: new Map(),
  };
}

describe("ExtensionRunner", () => {
  it("reports hostile tool_call handler failures and blocks execution", async () => {
    const hostileError = new Error("handler exploded");
    Object.defineProperties(hostileError, {
      message: {
        get() {
          throw new Error("message denied");
        },
      },
      stack: {
        get() {
          throw new Error("stack denied");
        },
      },
    });
    const healthyHandler = vi.fn(() => ({
      block: true,
      reason: "blocked by healthy handler",
    }));
    const runner = new ExtensionRunner(
      [
        createExtension(
          "bad-extension",
          new Map([
            [
              "tool_call",
              [
                () => {
                  throw hostileError;
                },
              ],
            ],
          ]) as Extension["handlers"],
        ),
        createExtension(
          "healthy-extension",
          new Map([["tool_call", [healthyHandler]]]) as Extension["handlers"],
        ),
      ],
      createRuntime(),
      "/tmp/openclaw-extension-runner-test",
      {} as never,
      {} as never,
    );
    const errors: ExtensionError[] = [];
    runner.onError((error) => errors.push(error));

    const result = await runner.emitToolCall({
      type: "tool_call",
      toolCallId: "call-1",
      toolName: "bad_lookup",
      input: {},
    });

    expect(result).toEqual({ block: true, reason: "Extension failed, blocking execution" });
    expect(healthyHandler).not.toHaveBeenCalled();
    expect(errors).toEqual([
      {
        extensionPath: "bad-extension",
        event: "tool_call",
        error: "Unknown extension error",
      },
    ]);
  });
});
