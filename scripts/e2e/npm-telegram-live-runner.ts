// Telegram package Docker harness.
// Runs QA live transport code against the package candidate installed in Docker.

import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

function parseBoolean(value: string | undefined) {
  const normalized = value?.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
}

function splitCsv(value: string | undefined) {
  return (value ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function readPositiveIntegerEnv(env: NodeJS.ProcessEnv, name: string): number | undefined {
  const raw = env[name]?.trim();
  if (!raw) {
    return undefined;
  }
  if (!/^[1-9][0-9]*$/u.test(raw)) {
    throw new Error(`${name} must be a positive integer.`);
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value)) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return value;
}

function resolveCredentialSource(env: NodeJS.ProcessEnv) {
  return env.OPENCLAW_NPM_TELEGRAM_CREDENTIAL_SOURCE ?? env.OPENCLAW_QA_CREDENTIAL_SOURCE;
}

function resolveCredentialRole(env: NodeJS.ProcessEnv) {
  return env.OPENCLAW_NPM_TELEGRAM_CREDENTIAL_ROLE ?? env.OPENCLAW_QA_CREDENTIAL_ROLE;
}

async function shouldFailPackageTelegramRun(
  result: { summaryPath: string },
  env: NodeJS.ProcessEnv = process.env,
) {
  if (parseBoolean(env.OPENCLAW_NPM_TELEGRAM_ALLOW_FAILURES)) {
    return false;
  }
  const { readQaSuiteFailedScenarioCountFromFile } =
    await import("../../extensions/qa-lab/src/suite-summary.ts");
  return (await readQaSuiteFailedScenarioCountFromFile(result.summaryPath)) > 0;
}

function resolveRttScenarioSampleCount(env: NodeJS.ProcessEnv, scenarioIds: string[]) {
  const sampleCount = readPositiveIntegerEnv(env, "OPENCLAW_NPM_TELEGRAM_RTT_SAMPLES");
  if (sampleCount === undefined) {
    return undefined;
  }
  if (scenarioIds.length !== 1 || scenarioIds[0] !== "telegram-mentioned-message-reply") {
    throw new Error(
      "OPENCLAW_NPM_TELEGRAM_RTT_SAMPLES requires OPENCLAW_NPM_TELEGRAM_SCENARIOS=telegram-mentioned-message-reply.",
    );
  }
  return sampleCount;
}

function resolvePackageSpec(env: NodeJS.ProcessEnv) {
  const spec = env.OPENCLAW_NPM_TELEGRAM_PACKAGE_SPEC?.trim();
  if (!spec) {
    throw new Error("Missing OPENCLAW_NPM_TELEGRAM_PACKAGE_SPEC.");
  }
  return spec;
}

function buildPackageTelegramQaEvidence(
  result: {
    scenarios: Array<{
      id: string;
      title: string;
      status: "pass" | "fail";
      details: string;
      timing?: Record<string, number | undefined>;
      rttMs?: number;
    }>;
  },
  env: NodeJS.ProcessEnv,
) {
  const packageSpec = resolvePackageSpec(env);
  const providerMode = env.OPENCLAW_NPM_TELEGRAM_PROVIDER_MODE?.trim() || "mock-openai";
  return {
    kind: "openclaw.qa.evidence-summary",
    schemaVersion: 2,
    generatedAt: new Date().toISOString(),
    entries: result.scenarios.map((scenario) => ({
      test: {
        kind: "live-transport-check",
        id: scenario.id,
        title: scenario.title,
      },
      execution: {
        packageSource: {
          kind: "npm-package",
          spec: packageSpec,
        },
        provider: {
          id: "openai",
          live: providerMode === "live-frontier",
          fixture: providerMode,
        },
      },
      result: {
        status: scenario.status,
        details: scenario.details,
        timing:
          scenario.timing ??
          (typeof scenario.rttMs === "number"
            ? {
                rttMs: scenario.rttMs,
              }
            : {}),
      },
    })),
  };
}

async function writePackageTelegramQaEvidence(
  outputDir: string,
  result: Parameters<typeof buildPackageTelegramQaEvidence>[0],
  env: NodeJS.ProcessEnv = process.env,
) {
  const evidencePath = path.join(outputDir, "qa-evidence.json");
  await fs.writeFile(
    evidencePath,
    `${JSON.stringify(buildPackageTelegramQaEvidence(result, env), null, 2)}\n`,
    {
      encoding: "utf8",
      mode: 0o600,
    },
  );
  return evidencePath;
}

async function resolveTrustedOpenClawCommand(rawCommand: string) {
  if (!path.isAbsolute(rawCommand)) {
    throw new Error("OPENCLAW_NPM_TELEGRAM_SUT_COMMAND must be an absolute path.");
  }
  const commandName = path.basename(rawCommand);
  if (commandName !== "openclaw" && commandName !== "openclaw.cmd") {
    throw new Error(
      `OPENCLAW_NPM_TELEGRAM_SUT_COMMAND must point to openclaw; got: ${commandName}`,
    );
  }
  const npmPrefix = process.env.NPM_CONFIG_PREFIX?.trim();
  if (!npmPrefix) {
    throw new Error("Missing NPM_CONFIG_PREFIX for installed openclaw command validation.");
  }
  const [realCommand, realPrefix] = await Promise.all([
    fs.realpath(rawCommand),
    fs.realpath(npmPrefix),
  ]);
  if (realCommand !== realPrefix && !realCommand.startsWith(`${realPrefix}${path.sep}`)) {
    throw new Error("OPENCLAW_NPM_TELEGRAM_SUT_COMMAND must resolve inside NPM_CONFIG_PREFIX.");
  }
  return rawCommand;
}

async function main() {
  const { runTelegramQaLive } =
    await import("../../extensions/qa-lab/src/live-transports/telegram/telegram-live.runtime.ts");
  const rawSutOpenClawCommand = process.env.OPENCLAW_NPM_TELEGRAM_SUT_COMMAND?.trim();
  if (!rawSutOpenClawCommand) {
    throw new Error("Missing OPENCLAW_NPM_TELEGRAM_SUT_COMMAND.");
  }
  const sutOpenClawCommand = await resolveTrustedOpenClawCommand(rawSutOpenClawCommand);

  const repoRoot = path.resolve(process.env.OPENCLAW_NPM_TELEGRAM_REPO_ROOT ?? process.cwd());
  const outputDir =
    process.env.OPENCLAW_NPM_TELEGRAM_OUTPUT_DIR?.trim() ||
    path.join(repoRoot, ".artifacts", "qa-e2e", `npm-telegram-live-${Date.now().toString(36)}`);
  const scenarioIds = splitCsv(process.env.OPENCLAW_NPM_TELEGRAM_SCENARIOS);
  const result = await runTelegramQaLive({
    repoRoot,
    outputDir,
    sutOpenClawCommand,
    preflightInstalledOnboarding: true,
    providerMode: process.env.OPENCLAW_NPM_TELEGRAM_PROVIDER_MODE,
    primaryModel: process.env.OPENCLAW_NPM_TELEGRAM_MODEL,
    alternateModel: process.env.OPENCLAW_NPM_TELEGRAM_ALT_MODEL,
    fastMode: parseBoolean(process.env.OPENCLAW_NPM_TELEGRAM_FAST),
    scenarioIds,
    scenarioSampleCount: resolveRttScenarioSampleCount(process.env, scenarioIds),
    sutAccountId: process.env.OPENCLAW_NPM_TELEGRAM_SUT_ACCOUNT,
    credentialSource: resolveCredentialSource(process.env),
    credentialRole: resolveCredentialRole(process.env),
  });
  const evidencePath = await writePackageTelegramQaEvidence(outputDir, result);

  process.stdout.write(`Package Telegram QA report: ${result.reportPath}\n`);
  process.stdout.write(`Package Telegram QA summary: ${result.summaryPath}\n`);
  process.stdout.write(`Package Telegram QA observed messages: ${result.observedMessagesPath}\n`);
  process.stdout.write(`Package Telegram QA evidence: ${evidencePath}\n`);
  if (await shouldFailPackageTelegramRun(result)) {
    process.exitCode = 1;
  }
}

async function formatRunnerErrorMessage(error: unknown) {
  try {
    const { formatErrorMessage } = await import("../../dist/infra/errors.js");
    return formatErrorMessage(error);
  } catch {
    return error instanceof Error ? error.message : String(error);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(async (error: unknown) => {
    process.stderr.write(
      `package telegram live e2e failed: ${await formatRunnerErrorMessage(error)}\n`,
    );
    process.exitCode = 1;
  });
}

export const testing = {
  buildPackageTelegramQaEvidence,
  readPositiveIntegerEnv,
  resolveCredentialRole,
  resolveCredentialSource,
  resolveRttScenarioSampleCount,
  shouldFailPackageTelegramRun,
  writePackageTelegramQaEvidence,
};
export { testing as __testing };
