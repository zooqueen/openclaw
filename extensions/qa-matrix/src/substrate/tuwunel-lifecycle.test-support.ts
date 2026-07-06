import { startMatrixQaHarness, type MatrixQaHarness } from "./harness.runtime.js";
import { createMatrixTestSubstrate } from "./lifecycle.test-support.js";

export type MatrixTuwunelTestRuntime = {
  baseUrl: string;
  harness: MatrixQaHarness;
};

type MatrixTuwunelTestDeps = NonNullable<Parameters<typeof startMatrixQaHarness>[1]> & {
  startMatrixQaHarnessImpl?: typeof startMatrixQaHarness;
};

export function createMatrixTuwunelTestSubstrate(
  params: Parameters<typeof startMatrixQaHarness>[0],
  deps?: MatrixTuwunelTestDeps,
) {
  const { startMatrixQaHarnessImpl = startMatrixQaHarness, ...harnessDeps } = deps ?? {};
  let homeserverPort = params.homeserverPort;
  return createMatrixTestSubstrate<MatrixTuwunelTestRuntime>({
    id: "tuwunel",
    async start() {
      const harness = await startMatrixQaHarnessImpl(
        {
          ...params,
          ...(homeserverPort === undefined ? {} : { homeserverPort }),
        },
        harnessDeps,
      );
      homeserverPort ??= harness.homeserverPort;
      return {
        baseUrl: harness.upstreamBaseUrl,
        harness,
      };
    },
    async stop(runtime) {
      await runtime.harness.stop();
    },
  });
}
