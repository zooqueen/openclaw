// Matrix test API exposes shared test-only substrate contracts.
export { runMatrixQaDifferentialProbe as runMatrixDifferentialProbe } from "./src/substrate/differential-probe.js";
export {
  createMatrixTestSubstrate,
  runMatrixLifecycleScenarios,
  type MatrixLifecycleScenarioId,
  type MatrixLifecycleScenarioResult,
  type MatrixTestSubstrate,
  type MatrixTestSubstrateRuntime,
  type MatrixTestSubstrateState,
} from "./src/substrate/lifecycle.test-support.js";
export {
  createMatrixTuwunelTestSubstrate,
  type MatrixTuwunelTestRuntime,
} from "./src/substrate/tuwunel-lifecycle.test-support.js";
