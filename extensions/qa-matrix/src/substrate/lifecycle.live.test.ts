import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { provisionMatrixQaRoom } from "./client.js";
import { runMatrixQaDifferentialProbe } from "./differential-probe.js";
import { runMatrixQaLifecycleScenarios } from "./lifecycle.js";
import {
  createMatrixQaTuwunelSubstrate,
  type MatrixQaTuwunelRuntime,
} from "./tuwunel-lifecycle.runtime.js";

const EXPECTED_SCENARIOS = ["cold-start", "idempotent-start", "restart", "stop", "resume"] as const;

describe("Matrix QA live channel driver lifecycle", () => {
  const outputDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(
      outputDirs.splice(0).map(async (directory) => {
        try {
          await fs.rm(directory, { force: true, recursive: true });
        } catch (error) {
          // Tuwunel writes container-owned database files. The Testbox is disposable,
          // so cleanup must not hide a completed lifecycle proof with an EACCES failure.
          if ((error as NodeJS.ErrnoException).code !== "EACCES") {
            throw error;
          }
        }
      }),
    );
  });

  async function createOutputDir(substrate: string) {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), `matrix-qa-${substrate}-`));
    outputDirs.push(directory);
    return directory;
  }

  it("passes all five scenarios on Tuwunel", async () => {
    const outputDir = await createOutputDir("tuwunel");
    const substrate = createMatrixQaTuwunelSubstrate({ outputDir });
    let provisioned: Awaited<ReturnType<typeof provisionMatrixQaRoom>> | undefined;

    try {
      const results = await runMatrixQaLifecycleScenarios({
        async probe(runtime: MatrixQaTuwunelRuntime) {
          provisioned ??= await provisionMatrixQaRoom({
            baseUrl: runtime.baseUrl,
            driverLocalpart: "lifecycle-driver",
            observerLocalpart: "lifecycle-observer",
            registrationToken: runtime.harness.registrationToken,
            roomName: "Matrix QA Lifecycle",
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
  }, 180_000);
});
