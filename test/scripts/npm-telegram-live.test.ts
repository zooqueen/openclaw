// Npm Telegram Live tests cover npm telegram live script behavior.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { testing } from "../../scripts/e2e/npm-telegram-live-runner.ts";

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const DOCKER_SCRIPT_PATH = path.resolve(TEST_DIR, "../../scripts/e2e/npm-telegram-live-docker.sh");
const PREPARE_PACKAGE_PATH = path.resolve(
  TEST_DIR,
  "../../scripts/e2e/lib/npm-telegram-live/prepare-package.mjs",
);
const tempRoots: string[] = [];

function mkTempRoot() {
  const root = mkdtempSync(path.join(tmpdir(), "openclaw-npm-telegram-live-"));
  tempRoots.push(root);
  return root;
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { force: true, recursive: true });
  }
});

describe("package Telegram live Docker E2E", () => {
  it("supports npm-specific Convex credential aliases", () => {
    const script = readFileSync(DOCKER_SCRIPT_PATH, "utf8");

    expect(script).toContain("OPENCLAW_NPM_TELEGRAM_CREDENTIAL_SOURCE");
    expect(script).toContain("OPENCLAW_NPM_TELEGRAM_CREDENTIAL_ROLE");
    expect(script).toContain('docker_env+=(-e OPENCLAW_QA_CREDENTIAL_SOURCE="$credential_source")');
    expect(script).toContain('docker_env+=(-e OPENCLAW_QA_CREDENTIAL_ROLE="$credential_role")');
  });

  it("defaults CI runs to Convex when broker credentials are present", () => {
    const script = readFileSync(DOCKER_SCRIPT_PATH, "utf8");

    expect(script).toContain(
      'if [ -n "${CI:-}" ] && [ -n "${OPENCLAW_QA_CONVEX_SITE_URL:-}" ]; then',
    );
    expect(script).toContain("OPENCLAW_QA_CONVEX_SECRET_CI");
    expect(script).toContain("OPENCLAW_QA_CONVEX_SECRET_MAINTAINER");
    expect(script).toContain('printf "convex"');
  });

  it("installs the package candidate before forwarding runtime secrets", () => {
    const script = readFileSync(DOCKER_SCRIPT_PATH, "utf8");
    const installRunStart = script.indexOf('echo "Running package Telegram live Docker E2E');
    const installRunEnd = script.indexOf("# Mount only QA harness source");
    const installRun = script.slice(installRunStart, installRunEnd);

    expect(installRunStart).toBeGreaterThanOrEqual(0);
    expect(installRunEnd).toBeGreaterThan(installRunStart);
    expect(installRun).toContain(
      '-e OPENCLAW_E2E_NPM_INSTALL_TIMEOUT="${OPENCLAW_E2E_NPM_INSTALL_TIMEOUT:-600s}"',
    );
    expect(installRun).toContain(
      '"$timeout_bin" --kill-after=30s "$npm_install_timeout" npm install -g "$install_source" --no-fund --no-audit',
    );
    expect(installRun).toContain("elif command -v gtimeout >/dev/null 2>&1; then");
    expect(installRun).toContain('timeout_bin="gtimeout"');
    expect(installRun).toContain(
      'echo "timeout or gtimeout is required for OPENCLAW_E2E_NPM_INSTALL_TIMEOUT=$npm_install_timeout" >&2',
    );
    expect(installRun).toContain('"$timeout_bin" --kill-after=1s 1s true >/dev/null 2>&1');
    expect(installRun).toContain(
      '"$timeout_bin" "$npm_install_timeout" npm install -g "$install_source" --no-fund --no-audit',
    );
    expect(installRun).toContain('npm install -g "$install_source" --no-fund --no-audit');
    expect(installRun).not.toContain(
      "running package install without OPENCLAW_E2E_NPM_INSTALL_TIMEOUT",
    );
    expect(installRun).toContain('"${package_mount_args[@]}"');
    expect(installRun).not.toContain('"${docker_env[@]}"');
    expect(installRun).toContain("run_logged docker_e2e_docker_run_cmd run --rm");
    expect(installRun).not.toContain("run_logged docker run --rm");
    expect(script).toContain("run_logged docker_e2e_run_with_harness");
    expect(script).toContain('docker_e2e_print_log "$run_log"');
    expect(script).not.toContain('cat "$run_log"');
    expect(script).toContain('"${docker_env[@]}"');
    expect(script).toContain('if [ -z "$credential_role" ] && [ -n "${CI:-}" ]');
    expect(script).toContain('credential_role="ci"');
  });

  it("bounds installed-package hot path OpenClaw commands", () => {
    const script = readFileSync(DOCKER_SCRIPT_PATH, "utf8");
    const runtimeRunStart = script.indexOf("# Mount only QA harness source");
    const runtimeRun = script.slice(runtimeRunStart);

    expect(runtimeRunStart).toBeGreaterThanOrEqual(0);
    expect(script).toContain(
      '-e OPENCLAW_E2E_COMMAND_TIMEOUT="${OPENCLAW_E2E_COMMAND_TIMEOUT:-300s}"',
    );
    expect(runtimeRun).toContain("source scripts/lib/openclaw-e2e-instance.sh");
    expect(runtimeRun).toContain("openclaw_e2e_run_command openclaw --version");
    expect(runtimeRun).toContain("openclaw_e2e_run_command openclaw onboard");
    expect(runtimeRun).toContain(
      'OPENAI_API_KEY="$hotpath_openai_api_key" openclaw_e2e_run_command openclaw onboard',
    );
    expect(runtimeRun).not.toContain("export OPENAI_API_KEY=");
    expect(runtimeRun).toContain("openclaw_e2e_run_command openclaw channels add");
    expect(runtimeRun).toContain("openclaw_e2e_run_command openclaw doctor --fix");
    expect(runtimeRun).toContain("openclaw_e2e_run_command openclaw doctor --non-interactive");
    expect(runtimeRun).toContain('openclaw_e2e_print_log "$file"');
    expect(runtimeRun).not.toContain("sed -n '1,220p'");
    expect(runtimeRun).not.toMatch(/^\s*openclaw (onboard|channels add|doctor )/mu);
  });

  it("can install a resolved package tarball instead of a registry spec", () => {
    const script = readFileSync(DOCKER_SCRIPT_PATH, "utf8");

    expect(script).toContain("OPENCLAW_NPM_TELEGRAM_PACKAGE_TGZ");
    expect(script).toContain("OPENCLAW_CURRENT_PACKAGE_TGZ");
    expect(script).toContain(
      'package_mount_args=(-v "$resolved_package_tgz:$package_install_source:ro")',
    );
    expect(script).toContain('validate_openclaw_package_spec "$PACKAGE_SPEC"');
    expect(script.indexOf('if [ -n "$resolved_package_tgz" ]; then')).toBeLessThan(
      script.indexOf('validate_openclaw_package_spec "$PACKAGE_SPEC"'),
    );
  });

  it("keeps live Docker artifacts isolated by default", () => {
    const script = readFileSync(DOCKER_SCRIPT_PATH, "utf8");

    expect(script).toContain(
      'RUN_ID="${OPENCLAW_NPM_TELEGRAM_RUN_ID:-$(date -u +%Y%m%dT%H%M%SZ)-$$}"',
    );
    expect(script).toContain(
      'OUTPUT_DIR="${OPENCLAW_NPM_TELEGRAM_OUTPUT_DIR:-.artifacts/qa-e2e/npm-telegram-live/$RUN_ID}"',
    );
    expect(script).toContain('-e OPENCLAW_NPM_TELEGRAM_OUTPUT_DIR="$OUTPUT_DIR"');
    expect(script).not.toContain(
      'OUTPUT_DIR="${OPENCLAW_NPM_TELEGRAM_OUTPUT_DIR:-.artifacts/qa-e2e/npm-telegram-live}"',
    );
  });

  it("uses the container temp root for OpenClaw runtime scratch files", () => {
    const script = readFileSync(DOCKER_SCRIPT_PATH, "utf8");
    const dockerEnvStart = script.indexOf("docker_env=(");
    const dockerEnvEnd = script.indexOf(")\n\nforward_env_if_set", dockerEnvStart);
    const dockerEnv = script.slice(dockerEnvStart, dockerEnvEnd);

    expect(dockerEnvStart).toBeGreaterThanOrEqual(0);
    expect(dockerEnvEnd).toBeGreaterThan(dockerEnvStart);
    expect(dockerEnv).toContain("-e TMPDIR=/tmp");
  });

  it("forwards package Telegram RTT sample count into the live harness", () => {
    const script = readFileSync(DOCKER_SCRIPT_PATH, "utf8");

    expect(script).toContain("OPENCLAW_NPM_TELEGRAM_RTT_SAMPLES");
  });

  it("keeps private QA harness imports local while using the installed package dist", () => {
    const script = readFileSync(DOCKER_SCRIPT_PATH, "utf8");
    const preparePackage = readFileSync(PREPARE_PACKAGE_PATH, "utf8");
    const gatewayRpcClient = readFileSync(
      path.resolve(TEST_DIR, "../../extensions/qa-lab/src/gateway-rpc-client.ts"),
      "utf8",
    );
    const qaRuntimeApi = readFileSync(
      path.resolve(TEST_DIR, "../../extensions/qa-lab/src/runtime-api.ts"),
      "utf8",
    );

    expect(script).toContain('ln -sfnT "$openclaw_package_dir/dist" /app/dist');
    expect(script).toContain('cp "$openclaw_package_dir/package.json" /app/package.json');
    expect(script).toContain('-v "$ROOT_DIR/extensions/qa-lab:/app/extensions/qa-lab:ro"');
    expect(script).not.toContain('ln -sfnT /app/extensions "$openclaw_package_dir/extensions"');
    expect(script).toContain("node scripts/e2e/lib/npm-telegram-live/prepare-package.mjs");
    expect(script).toContain("/app/node_modules/openclaw/package.json");
    expect(preparePackage).toContain('pkg.exports["./plugin-sdk/gateway-runtime"]');
    expect(preparePackage).toContain('"./dist/plugin-sdk/gateway-runtime.js"');
    expect(gatewayRpcClient).toContain('from "openclaw/plugin-sdk/gateway-runtime"');
    expect(qaRuntimeApi).toContain('from "openclaw/plugin-sdk/gateway-runtime"');
  });

  it("exposes installed package dependencies to the mounted QA harness", () => {
    const script = readFileSync(DOCKER_SCRIPT_PATH, "utf8");

    expect(script).toContain("link_installed_package_dependency()");
    expect(script).toContain(
      'local source="/npm-global/lib/node_modules/openclaw/node_modules/$name"',
    );
    expect(script).toContain('ln -sfn "$source" "$target"');
    expect(script).toContain('link_installed_package_dependency "$dependency"');
    expect(script).toContain("@modelcontextprotocol/sdk");
    expect(script).toContain("yaml");
    expect(script).toContain("zod");
  });

  it("lets npm-specific credential aliases override shared QA env", () => {
    expect(
      testing.resolveCredentialSource({
        OPENCLAW_NPM_TELEGRAM_CREDENTIAL_SOURCE: "convex",
        OPENCLAW_QA_CREDENTIAL_SOURCE: "env",
      }),
    ).toBe("convex");
    expect(
      testing.resolveCredentialRole({
        OPENCLAW_NPM_TELEGRAM_CREDENTIAL_ROLE: "ci",
        OPENCLAW_QA_CREDENTIAL_ROLE: "maintainer",
      }),
    ).toBe("ci");
  });

  it("builds qa evidence with aggregate Telegram RTT timing", () => {
    const evidence = testing.buildPackageTelegramQaEvidence(
      {
        scenarios: [
          {
            id: "telegram-canary",
            title: "Telegram canary",
            status: "pass",
            details: "reply matched",
            rttMs: 900,
          },
          {
            id: "telegram-mentioned-message-reply",
            title: "Telegram mentioned message gets a reply",
            status: "pass",
            details: "20/20 samples passed",
            timing: {
              avgMs: 1300,
              p50Ms: 1200,
              p95Ms: 1800,
              maxMs: 2200,
              samples: 20,
              failedSamples: 0,
            },
          },
        ],
      },
      {
        OPENCLAW_NPM_TELEGRAM_PACKAGE_SPEC: "openclaw@main",
        OPENCLAW_NPM_TELEGRAM_PROVIDER_MODE: "mock-openai",
      },
    );

    expect(evidence).toMatchObject({
      kind: "openclaw.qa.evidence-summary",
      schemaVersion: 2,
      entries: [
        {
          test: { id: "telegram-canary" },
          execution: {
            packageSource: { kind: "npm-package", spec: "openclaw@main" },
            provider: { fixture: "mock-openai", live: false },
          },
          result: { status: "pass", timing: { rttMs: 900 } },
        },
        {
          test: { id: "telegram-mentioned-message-reply" },
          result: {
            status: "pass",
            timing: {
              avgMs: 1300,
              p50Ms: 1200,
              p95Ms: 1800,
              maxMs: 2200,
              samples: 20,
              failedSamples: 0,
            },
          },
        },
      ],
    });
  });

  it("writes package Telegram qa evidence for the RTT importer", async () => {
    const outputDir = mkTempRoot();
    const evidencePath = await testing.writePackageTelegramQaEvidence(
      outputDir,
      {
        scenarios: [
          {
            id: "telegram-canary",
            title: "Telegram canary",
            status: "pass",
            details: "reply matched",
            rttMs: 900,
          },
          {
            id: "telegram-mentioned-message-reply",
            title: "Telegram mentioned message gets a reply",
            status: "pass",
            details: "20/20 samples passed",
            timing: {
              p50Ms: 1200,
              p95Ms: 1800,
              samples: 20,
              failedSamples: 0,
            },
          },
        ],
      },
      { OPENCLAW_NPM_TELEGRAM_PACKAGE_SPEC: "openclaw@main" },
    );
    const evidence = JSON.parse(readFileSync(evidencePath, "utf8")) as {
      entries: Array<{ result?: { timing?: Record<string, number> }; test?: { id?: string } }>;
    };

    expect(evidencePath).toBe(path.join(outputDir, "qa-evidence.json"));
    expect(
      evidence.entries.find((entry) => entry.test?.id === "telegram-mentioned-message-reply")
        ?.result?.timing,
    ).toMatchObject({
      p50Ms: 1200,
      p95Ms: 1800,
      samples: 20,
      failedSamples: 0,
    });
  });

  it("requires RTT sampling to target the mention reply scenario", () => {
    expect(
      testing.resolveRttScenarioSampleCount({ OPENCLAW_NPM_TELEGRAM_RTT_SAMPLES: "20" }, [
        "telegram-mentioned-message-reply",
      ]),
    ).toBe(20);
    expect(() =>
      testing.resolveRttScenarioSampleCount({ OPENCLAW_NPM_TELEGRAM_RTT_SAMPLES: "20" }, []),
    ).toThrow(
      "OPENCLAW_NPM_TELEGRAM_RTT_SAMPLES requires OPENCLAW_NPM_TELEGRAM_SCENARIOS=telegram-mentioned-message-reply.",
    );
    expect(() =>
      testing.readPositiveIntegerEnv(
        { OPENCLAW_NPM_TELEGRAM_RTT_SAMPLES: "0" },
        "OPENCLAW_NPM_TELEGRAM_RTT_SAMPLES",
      ),
    ).toThrow("OPENCLAW_NPM_TELEGRAM_RTT_SAMPLES must be a positive integer.");
  });

  it("gates package Telegram status on the summary artifact", async () => {
    const summaryPath = path.join(mkTempRoot(), "telegram-qa-summary.json");
    writeFileSync(
      summaryPath,
      JSON.stringify({
        counts: { total: 1, passed: 1, failed: 0 },
        scenarios: [{ status: "fail" }],
      }),
      "utf8",
    );

    await expect(
      testing.shouldFailPackageTelegramRun(
        { summaryPath },
        { OPENCLAW_NPM_TELEGRAM_ALLOW_FAILURES: "" },
      ),
    ).resolves.toBe(true);
  });

  it("does not read package Telegram summaries when failures are allowed", async () => {
    await expect(
      testing.shouldFailPackageTelegramRun(
        { summaryPath: path.join(mkTempRoot(), "missing-summary.json") },
        { OPENCLAW_NPM_TELEGRAM_ALLOW_FAILURES: "1" },
      ),
    ).resolves.toBe(false);
  });
});
