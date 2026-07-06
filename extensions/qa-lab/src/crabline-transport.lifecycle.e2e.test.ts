// Qa Lab e2e tests cover lifecycle behavior owned by the selected Crabline transport adapter.
import fs from "node:fs/promises";
import path from "node:path";
import {
  OPENCLAW_CRABLINE_MANIFEST_PATH,
  type OpenClawCrablineChannelDriverSelection,
} from "@openclaw/crabline";
import { withTempDir } from "openclaw/plugin-sdk/test-env";
import { describe, expect, it } from "vitest";
import {
  createMatrixTestSubstrate,
  runMatrixDifferentialProbe,
  runMatrixLifecycleScenarios,
} from "../../qa-matrix/test-api.js";
import { createQaBusState } from "./bus-state.js";
import { createQaCrablineTransportAdapter } from "./crabline-transport.js";

const EXPECTED_SCENARIOS = ["cold-start", "idempotent-start", "restart", "stop", "resume"] as const;
const MATRIX_ROOM_ID = "!matrix-lifecycle:matrix.test";

const MATRIX_CRABLINE_DRIVER = {
  capabilityMatrixPath: "crabline-fake-provider-capabilities.json",
  channel: "matrix",
  channelDriver: "crabline",
  smokeArtifactPath: "crabline-fake-provider-smoke.json",
} as const satisfies OpenClawCrablineChannelDriverSelection;

type MatrixCrablineManifest = {
  accessToken: string;
  baseUrl: string;
  botUserId: string;
  provider: "matrix";
};

describe("Matrix Crabline channel driver lifecycle", () => {
  it("passes all five scenarios through the selected transport adapter", async () => {
    await withTempDir("matrix-crabline-lifecycle-", async (outputDir) => {
      const substrate = createMatrixTestSubstrate({
        id: MATRIX_CRABLINE_DRIVER.channelDriver,
        async start() {
          const transport = await createQaCrablineTransportAdapter({
            outputDir,
            selection: MATRIX_CRABLINE_DRIVER,
            state: createQaBusState(),
          });
          try {
            const manifest = JSON.parse(
              await fs.readFile(path.join(outputDir, OPENCLAW_CRABLINE_MANIFEST_PATH), "utf8"),
            ) as MatrixCrablineManifest;
            if (manifest.provider !== MATRIX_CRABLINE_DRIVER.channel) {
              throw new Error("Crabline channel driver returned a non-Matrix manifest");
            }
            await transport.sendInbound({
              conversation: { id: MATRIX_ROOM_ID, kind: "group" },
              senderId: "@lifecycle-driver:matrix.test",
              senderName: "Matrix Lifecycle Driver",
              text: "Matrix lifecycle probe",
            });
            return {
              accessToken: manifest.accessToken,
              baseUrl: manifest.baseUrl,
              roomId: MATRIX_ROOM_ID,
              transport,
              userId: manifest.botUserId,
            };
          } catch (error) {
            await transport.cleanup?.().catch(() => {});
            throw error;
          }
        },
        async stop(runtime) {
          await runtime.transport.cleanup?.();
        },
      });

      try {
        const results = await runMatrixLifecycleScenarios({
          async probe(runtime) {
            await runMatrixDifferentialProbe({
              accessToken: runtime.accessToken,
              baseUrl: runtime.baseUrl,
              roomId: runtime.roomId,
              userId: runtime.userId,
            });
          },
          substrate,
        });

        expect(results.map((entry) => entry.id)).toEqual(EXPECTED_SCENARIOS);
      } finally {
        await substrate.stop();
      }
    });
  }, 60_000);
});
