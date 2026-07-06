import { withTempDir } from "openclaw/plugin-sdk/test-env";
import { describe, expect, it } from "vitest";
import { provisionMatrixQaRoom } from "./client.js";
import { runMatrixQaDifferentialProbe } from "./differential-probe.js";
import { runMatrixLifecycleScenarios } from "./lifecycle.test-support.js";
import {
  createMatrixTuwunelTestSubstrate,
  type MatrixTuwunelTestRuntime,
} from "./tuwunel-lifecycle.test-support.js";

const EXPECTED_SCENARIOS = ["cold-start", "idempotent-start", "restart", "stop", "resume"] as const;

async function withTuwunelOutputDir(run: (outputDir: string) => Promise<void>) {
  let didRunFail = false;
  let runError: unknown;
  try {
    await withTempDir("matrix-tuwunel-lifecycle-", async (outputDir) => {
      try {
        await run(outputDir);
      } catch (error) {
        didRunFail = true;
        runError = error;
        throw error;
      }
    });
  } catch (error) {
    if (didRunFail) {
      throw runError;
    }
    if ((error as NodeJS.ErrnoException).code !== "EACCES") {
      throw error;
    }
  }
}

describe("Matrix live driver lifecycle", () => {
  it("passes all five scenarios on Tuwunel", async () => {
    await withTuwunelOutputDir(async (outputDir) => {
      const substrate = createMatrixTuwunelTestSubstrate({ outputDir });
      let provisioned: Awaited<ReturnType<typeof provisionMatrixQaRoom>> | undefined;

      try {
        const results = await runMatrixLifecycleScenarios({
          async probe(runtime: MatrixTuwunelTestRuntime) {
            provisioned ??= await provisionMatrixQaRoom({
              baseUrl: runtime.baseUrl,
              driverLocalpart: "lifecycle-driver",
              observerLocalpart: "lifecycle-observer",
              registrationToken: runtime.harness.registrationToken,
              roomName: "Matrix Lifecycle Test",
              sutLocalpart: "lifecycle-sut",
            });
            await runMatrixQaDifferentialProbe({
              accessToken: provisioned.driver.accessToken,
              baseUrl: runtime.baseUrl,
              roomId: provisioned.roomId,
              userId: provisioned.driver.userId,
            });
          },
          substrate,
        });

        expect(results.map((entry) => entry.id)).toEqual(EXPECTED_SCENARIOS);
      } finally {
        await substrate.stop();
      }
    });
  }, 180_000);
});
