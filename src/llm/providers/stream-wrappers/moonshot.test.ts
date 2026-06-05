// Moonshot stream wrapper tests cover provider payload compatibility shims.
import { describe, expect, it } from "vitest";
import type { StreamFn } from "../../../agents/runtime/index.js";
import { createSiliconFlowThinkingWrapper } from "./moonshot.js";

function runSiliconFlowThinkingWrapper(payload: Record<string, unknown>): void {
  const baseStreamFn: StreamFn = (_model, _context, options) => {
    options?.onPayload?.(payload, {} as never);
    return {} as ReturnType<StreamFn>;
  };
  const wrapped = createSiliconFlowThinkingWrapper(baseStreamFn);

  void wrapped(
    { id: "Pro/example", provider: "siliconflow" } as never,
    {
      messages: [],
    } as never,
    {},
  );
}

describe("createSiliconFlowThinkingWrapper", () => {
  it("normalizes thinking off to null", () => {
    const payload = { thinking: "off" };

    runSiliconFlowThinkingWrapper(payload);

    expect(payload.thinking).toBeNull();
  });

  it("overwrites an unreadable configurable thinking field", () => {
    const payload: Record<string, unknown> = {};
    Object.defineProperty(payload, "thinking", {
      configurable: true,
      get() {
        throw new Error("thinking getter failed");
      },
    });

    expect(() => runSiliconFlowThinkingWrapper(payload)).not.toThrow();

    expect(payload.thinking).toBeNull();
  });

  it("fails closed when the thinking field cannot be patched", () => {
    const payload: Record<string, unknown> = {};
    Object.defineProperty(payload, "thinking", {
      configurable: false,
      get() {
        throw new Error("thinking getter failed");
      },
    });

    expect(() => runSiliconFlowThinkingWrapper(payload)).toThrow(
      "SiliconFlow thinking payload patch failed",
    );
  });
});
