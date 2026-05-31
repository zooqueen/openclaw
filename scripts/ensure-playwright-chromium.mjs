#!/usr/bin/env node
import { spawnSync as spawnSyncImpl } from "node:child_process";
import { existsSync as existsSyncImpl, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const playwrightInstallArgs = ["install", "chromium"];

function resolvePlaywrightCliPath() {
  return resolve(dirname(require.resolve("playwright/package.json")), "cli.js");
}

export function resolvePlaywrightInstallRunner(options = {}) {
  return {
    command: options.nodeExecPath ?? process.execPath,
    args: [options.playwrightCliPath ?? resolvePlaywrightCliPath(), ...playwrightInstallArgs],
    shell: false,
  };
}

export function isDirectScriptExecution(
  argvEntry = process.argv[1],
  modulePath = fileURLToPath(import.meta.url),
  realpath = realpathSync.native,
) {
  if (!argvEntry) {
    return false;
  }
  try {
    return realpath(argvEntry) === realpath(modulePath);
  } catch {
    return resolve(argvEntry) === resolve(modulePath);
  }
}

export function ensurePlaywrightChromium(options = {}) {
  const env = options.env ?? process.env;
  const executablePath = options.executablePath ?? chromium.executablePath();
  const existsSync = options.existsSync ?? existsSyncImpl;
  const log = options.log ?? console.error;
  const spawnSync = options.spawnSync ?? spawnSyncImpl;

  if (existsSync(executablePath)) {
    return 0;
  }

  if (env.OPENCLAW_UI_E2E_ALLOW_MISSING_CHROMIUM === "1") {
    log(
      `[ui-e2e] Playwright Chromium is missing at ${executablePath}; OPENCLAW_UI_E2E_ALLOW_MISSING_CHROMIUM=1 leaves the lane skipped.`,
    );
    return 0;
  }

  log(`[ui-e2e] Playwright Chromium is missing at ${executablePath}; installing chromium.`);
  const runner = resolvePlaywrightInstallRunner({
    nodeExecPath: options.nodeExecPath,
    playwrightCliPath: options.playwrightCliPath,
  });
  const result = spawnSync(runner.command, runner.args, {
    cwd: options.cwd ?? repoRoot,
    env,
    shell: runner.shell,
    stdio: options.stdio ?? "inherit",
    windowsVerbatimArguments: runner.windowsVerbatimArguments,
  });
  const status = result.status ?? 1;
  if (status !== 0) {
    return status;
  }

  if (!existsSync(executablePath)) {
    log(
      `[ui-e2e] Playwright install completed but Chromium is still missing at ${executablePath}.`,
    );
    return 1;
  }
  return 0;
}

if (isDirectScriptExecution()) {
  process.exitCode = ensurePlaywrightChromium();
}
