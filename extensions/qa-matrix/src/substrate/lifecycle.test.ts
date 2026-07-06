import { describe, expect, it, vi } from "vitest";
import type { MatrixQaHarness } from "./harness.runtime.js";
import {
  createMatrixTestSubstrate,
  runMatrixLifecycleScenarios,
  type MatrixTestSubstrateRuntime,
} from "./lifecycle.test-support.js";
import { createMatrixTuwunelTestSubstrate } from "./tuwunel-lifecycle.test-support.js";

describe("Matrix test substrate lifecycle", () => {
  it("passes the five lifecycle scenarios through the shared interface", async () => {
    let activeBaseUrl: string | undefined;
    let runtimeSequence = 0;
    const substrate = createMatrixTestSubstrate<MatrixTestSubstrateRuntime>({
      id: "test",
      async start() {
        runtimeSequence += 1;
        activeBaseUrl = `http://127.0.0.1:${28_007 + runtimeSequence}/`;
        return { baseUrl: activeBaseUrl };
      },
      async stop() {
        activeBaseUrl = undefined;
      },
    });
    const probe = vi.fn(async (runtime: MatrixTestSubstrateRuntime) => {
      expect(runtime.baseUrl).toBe(activeBaseUrl);
    });

    const results = await runMatrixLifecycleScenarios({
      fetchImpl: async (input) => {
        const requestUrl =
          typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        if (!activeBaseUrl || !requestUrl.startsWith(activeBaseUrl)) {
          throw new TypeError("fetch failed");
        }
        return new Response("{}", { status: 200 });
      },
      probe,
      substrate,
    });

    expect(results.map((entry) => entry.id)).toEqual([
      "cold-start",
      "idempotent-start",
      "restart",
      "stop",
      "resume",
    ]);
    expect(runtimeSequence).toBe(3);
    expect(probe).toHaveBeenCalledTimes(4);
    expect(substrate.state.status).toBe("running");
  });

  it("keeps running state when stop fails", async () => {
    const runtime = { baseUrl: "http://127.0.0.1:28008/" };
    const substrate = createMatrixTestSubstrate({
      id: "test",
      async start() {
        return runtime;
      },
      async stop() {
        throw new Error("stop failed");
      },
    });
    await substrate.start();

    await expect(substrate.stop()).rejects.toThrow("stop failed");
    expect(substrate.state).toEqual({ runtime, status: "running" });
  });

  it("wraps Tuwunel harness start and cleanup", async () => {
    const stop = vi.fn(async () => {});
    const startMatrixQaHarness = vi.fn(async (params: { homeserverPort?: number }) => {
      expect(params.homeserverPort).toBe(
        startMatrixQaHarness.mock.calls.length > 1 ? 39123 : undefined,
      );
      return {
        homeserverPort: 39123,
        stop,
        upstreamBaseUrl: "http://127.0.0.1:28008/",
      } as unknown as MatrixQaHarness;
    });
    const substrate = createMatrixTuwunelTestSubstrate(
      { outputDir: "/tmp/matrix-test" },
      { startMatrixQaHarnessImpl: startMatrixQaHarness },
    );

    const runtime = await substrate.start();
    await substrate.restart();
    await substrate.stop();

    expect(runtime.baseUrl).toBe("http://127.0.0.1:28008/");
    expect(startMatrixQaHarness).toHaveBeenCalledTimes(2);
    expect(stop).toHaveBeenCalledTimes(2);
  });
});
