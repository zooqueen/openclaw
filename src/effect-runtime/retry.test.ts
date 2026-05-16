import { Effect } from "effect";
import { describe, expect, it, vi } from "vitest";

import { runOpenClawEffect } from "./index.js";
import { runRetryingPromise } from "./retry.js";

describe("effect runtime kernel", () => {
  it("rethrows typed failures without exposing Effect fiber wrappers", async () => {
    const error = new Error("typed failure");

    await expect(runOpenClawEffect(Effect.fail(error))).rejects.toBe(error);
  });

  it("retries failed promise operations through the internal Effect runtime", async () => {
    const sleep = vi.fn(async () => undefined);
    const operation = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error("HTTP 503"))
      .mockResolvedValueOnce("ok");

    await expect(
      runRetryingPromise({
        operation,
        maxAttempts: 2,
        shouldRetry: () => true,
        resolveDelayMs: () => 25,
        sleep,
      }),
    ).resolves.toBe("ok");

    expect(operation).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(25);
  });

  it("does not sleep after retry exhaustion", async () => {
    const sleep = vi.fn(async () => undefined);
    const error = new Error("HTTP 503");
    const operation = vi.fn<() => Promise<string>>().mockRejectedValue(error);

    await expect(
      runRetryingPromise({
        operation,
        maxAttempts: 1,
        shouldRetry: () => true,
        resolveDelayMs: () => 25,
        sleep,
      }),
    ).rejects.toBe(error);

    expect(operation).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });
});
