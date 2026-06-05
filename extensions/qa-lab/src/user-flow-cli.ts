// Qa Lab plugin module exposes user-flow planning commands.
import type { Command } from "commander";
import {
  QA_USER_FLOW_STANDARD_FLOWS,
  planQaUserFlows,
  type QaStandardUserFlowCapabilityId,
  type QaStandardUserFlowId,
} from "openclaw/plugin-sdk/qa-user-flows";

type QaUserFlowSelectionOptions = {
  surface?: string[];
};

type QaUserFlowsPlanOptions = QaUserFlowSelectionOptions & {
  capability?: string[];
  driverFlow?: string[];
  flow?: string[];
};

type QaUserFlowsRunOptions = QaUserFlowsPlanOptions & {
  allowFailures?: boolean;
  altModel?: string;
  concurrency?: number;
  fast?: boolean;
  json?: boolean;
  model?: string;
  outputDir?: string;
  providerMode?: string;
  repoRoot?: string;
  transport?: string;
};

type QaUserFlowSuiteRunOptions = {
  allowFailures?: boolean;
  alternateModel?: string;
  concurrency?: number;
  fastMode?: boolean;
  outputDir?: string;
  primaryModel?: string;
  providerMode?: string;
  repoRoot?: string;
  scenarioIds?: string[];
  transportId?: string;
};

type QaUserFlowCliRuntime = {
  runSuite(opts: QaUserFlowSuiteRunOptions): Promise<void>;
};

function writeJson(value: unknown) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function normalizeRepeatedStringValues(values: readonly string[] | undefined) {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const value of values ?? []) {
    for (const entry of value.split(",")) {
      const trimmed = entry.trim();
      if (!trimmed || seen.has(trimmed)) {
        continue;
      }
      seen.add(trimmed);
      result.push(trimmed);
    }
  }
  return result;
}

function collectQaUserFlowCliString(value: string, previous: string[]) {
  const trimmed = value.trim();
  return trimmed ? [...previous, trimmed] : previous;
}

function filterStandardFlowsBySurface(surfaces: readonly string[]) {
  if (surfaces.length === 0) {
    return [...QA_USER_FLOW_STANDARD_FLOWS];
  }
  const requested = new Set(surfaces);
  return QA_USER_FLOW_STANDARD_FLOWS.filter((flow) => requested.has(flow.surface));
}

function buildQaUserFlowsPlanOutput(opts: QaUserFlowsPlanOptions) {
  const surfaces = normalizeRepeatedStringValues(opts.surface);
  const flows = filterStandardFlowsBySurface(surfaces);
  const availableCapabilities = normalizeRepeatedStringValues(
    opts.capability,
  ) as QaStandardUserFlowCapabilityId[];
  const driverSupportedFlowIds = normalizeRepeatedStringValues(
    opts.driverFlow,
  ) as QaStandardUserFlowId[];
  const requestedFlowIds = normalizeRepeatedStringValues(opts.flow) as QaStandardUserFlowId[];
  const plan = planQaUserFlows({
    flows,
    availableCapabilities,
    ...(driverSupportedFlowIds.length > 0 ? { driverSupportedFlowIds } : {}),
    ...(requestedFlowIds.length > 0 ? { requestedFlowIds } : {}),
  });
  return {
    version: 1,
    filters: {
      surfaces,
      requestedFlowIds,
      driverSupportedFlowIds,
    },
    availableCapabilities,
    ...plan,
  };
}

function resolveQaUserFlowRunScenarioIds(plan: ReturnType<typeof buildQaUserFlowsPlanOutput>) {
  const unsupportedRunnerFlowIds = plan.selected
    .filter((flow) => flow.execution.runner !== "qa-lab-flow" || !flow.qaScenarioIds?.length)
    .map((flow) => `${flow.id} (${flow.execution.runner})`);
  if (unsupportedRunnerFlowIds.length > 0) {
    throw new Error(
      `selected user flow(s) do not have a QA suite execution mapping yet: ${unsupportedRunnerFlowIds.join(", ")}`,
    );
  }
  return normalizeRepeatedStringValues(plan.selected.flatMap((flow) => flow.qaScenarioIds ?? []));
}

function buildQaUserFlowRunOutput(params: {
  error?: string;
  plan: ReturnType<typeof buildQaUserFlowsPlanOutput>;
  scenarioIds: readonly string[];
  status: "fail" | "pass";
}) {
  return {
    version: 1,
    status: params.status,
    plan: {
      selected: params.plan.selected,
      skipped: params.plan.skipped,
    },
    execution: {
      runner: "qa-suite",
      scenarioIds: [...params.scenarioIds],
    },
    ...(params.error ? { error: params.error } : {}),
  };
}

export function registerQaUserFlowCli(qa: Command, runtime?: QaUserFlowCliRuntime) {
  const userFlows = qa.command("user-flows").description("Run OpenClaw-owned QA user flows");

  // Future: list and plan commands could expose the standard catalog and the
  // selected/skipped run plan for Kova/debugging without executing scenarios.

  userFlows
    .command("run")
    .description("Run selected QA user flows through the existing QA suite runner")
    .option("--repo-root <path>", "Repository root to target when running from a neutral cwd")
    .option("--output-dir <path>", "Suite artifact directory")
    .option("--transport <id>", "QA transport id", "qa-channel")
    .option("--provider-mode <mode>", "QA provider mode", "mock-openai")
    .option("--model <ref>", "Primary provider/model ref")
    .option("--alt-model <ref>", "Alternate provider/model ref")
    .option("--fast", "Enable provider fast mode where supported", false)
    .option(
      "--allow-failures",
      "Write artifacts without setting a failing exit code when scenarios fail",
      false,
    )
    .option("--concurrency <count>", "Scenario worker concurrency", (value: string) => {
      const parsed = Number.parseInt(value, 10);
      if (!Number.isSafeInteger(parsed) || parsed < 1 || String(parsed) !== value.trim()) {
        throw new Error("--concurrency must be a positive integer.");
      }
      return parsed;
    })
    .option(
      "--surface <id>",
      "Filter by user-flow surface (repeatable or comma-separated)",
      collectQaUserFlowCliString,
      [],
    )
    .option(
      "--flow <id>",
      "Request one user-flow id (repeatable or comma-separated)",
      collectQaUserFlowCliString,
      [],
    )
    .option(
      "--capability <id>",
      "Declare one available capability id (repeatable or comma-separated)",
      collectQaUserFlowCliString,
      [],
    )
    .option(
      "--driver-flow <id>",
      "Declare one concretely driver-supported flow id (repeatable or comma-separated)",
      collectQaUserFlowCliString,
      [],
    )
    .option("--json", "Emit selected/skipped user-flow plan and execution summary as JSON", false)
    .action(async (opts: QaUserFlowsRunOptions) => {
      if (!runtime) {
        throw new Error("QA user-flow run command is missing its suite runner.");
      }
      const plan = buildQaUserFlowsPlanOutput(opts);
      const scenarioIds = resolveQaUserFlowRunScenarioIds(plan);
      if (scenarioIds.length === 0) {
        throw new Error("No runnable QA suite scenarios selected for the requested user flows.");
      }
      try {
        await runtime.runSuite({
          repoRoot: opts.repoRoot,
          outputDir: opts.outputDir,
          transportId: opts.transport,
          providerMode: opts.providerMode,
          primaryModel: opts.model,
          alternateModel: opts.altModel,
          fastMode: opts.fast,
          allowFailures: opts.allowFailures,
          concurrency: opts.concurrency,
          scenarioIds,
        });
        if (opts.json) {
          writeJson(buildQaUserFlowRunOutput({ plan, scenarioIds, status: "pass" }));
        }
      } catch (error) {
        if (opts.json) {
          writeJson(
            buildQaUserFlowRunOutput({
              plan,
              scenarioIds,
              status: "fail",
              error: error instanceof Error ? error.message : String(error),
            }),
          );
        }
        throw error;
      }
    });
}

export const qaUserFlowCliTesting = {
  buildQaUserFlowsPlanOutput,
  buildQaUserFlowRunOutput,
  normalizeRepeatedStringValues,
  resolveQaUserFlowRunScenarioIds,
};
