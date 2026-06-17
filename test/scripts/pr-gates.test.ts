import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

const changelogScriptPath = path.join(process.cwd(), "scripts", "pr-lib", "changelog.sh");
const commonScriptPath = path.join(process.cwd(), "scripts", "pr-lib", "common.sh");
const gatesScriptPath = path.join(process.cwd(), "scripts", "pr-lib", "gates.sh");
const prScriptPath = path.join(process.cwd(), "scripts", "pr");
const prepareCoreScriptPath = path.join(process.cwd(), "scripts", "pr-lib", "prepare-core.sh");

function run(cwd: string, command: string, args: string[], env?: NodeJS.ProcessEnv): string {
  return execFileSync(command, args, {
    cwd,
    encoding: "utf8",
    env: env ? { ...process.env, ...env } : process.env,
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function createNonDocsDiffRepo(): string {
  const repo = mkdtempSync(path.join(os.tmpdir(), "openclaw-pr-gates-"));
  run(repo, "git", ["init", "-q", "--initial-branch=main"]);
  run(repo, "git", ["config", "user.email", "test@example.com"]);
  run(repo, "git", ["config", "user.name", "Test User"]);
  mkdirSync(path.join(repo, "test", "scripts"), { recursive: true });
  writeFileSync(path.join(repo, "test", "scripts", "fixture.test.ts"), "export {};\n", "utf8");
  run(repo, "git", ["add", "."]);
  run(repo, "git", ["commit", "-qm", "seed"]);
  const baseSha = run(repo, "git", ["rev-parse", "HEAD"]);
  run(repo, "git", ["update-ref", "refs/remotes/origin/main", baseSha]);
  run(repo, "git", ["checkout", "-qb", "feature"]);
  writeFileSync(
    path.join(repo, "test", "scripts", "fixture.test.ts"),
    "export { value };\n",
    "utf8",
  );
  run(repo, "git", ["add", "."]);
  run(repo, "git", ["commit", "-qm", "change test"]);
  return repo;
}

function runFailure(cwd: string, command: string, args: string[]): string {
  try {
    return run(cwd, command, args);
  } catch (error) {
    return `${(error as { stdout?: unknown }).stdout ?? ""}${(error as { stderr?: unknown }).stderr ?? ""}`;
  }
}

describe("pr gates", () => {
  it("runs prepare gates and push through the PR worktree script", () => {
    const prepareCore = readFileSync(prepareCoreScriptPath, "utf8");

    expect(prepareCore).toContain('"$worktree_script" prepare-gates "$pr"');
    expect(prepareCore).toContain('"$worktree_script" prepare-push "$pr"');
    expect(prepareCore).toContain('"$PWD/scripts/pr" prepare-gates "$pr"');
  });

  it("keeps prepare commands on the linked worktree script", () => {
    const repo = mkdtempSync(path.join(os.tmpdir(), "openclaw-pr-bootstrap-"));
    const linkedWorktree = path.join(repo, "linked");
    try {
      mkdirSync(path.join(repo, "scripts"), { recursive: true });
      cpSync(prScriptPath, path.join(repo, "scripts", "pr"));
      cpSync(path.join(process.cwd(), "scripts", "pr-lib"), path.join(repo, "scripts", "pr-lib"), {
        recursive: true,
      });
      run(repo, "git", ["init", "-q", "--initial-branch=main"]);
      run(repo, "git", ["config", "user.email", "test@example.com"]);
      run(repo, "git", ["config", "user.name", "Test User"]);
      run(repo, "git", ["add", "."]);
      run(repo, "git", ["commit", "-qm", "seed"]);
      run(repo, "git", ["worktree", "add", "-qb", "linked", linkedWorktree]);
      writeFileSync(
        path.join(repo, "scripts", "pr"),
        "#!/usr/bin/env bash\nprintf 'canonical-wrapper\\n'\n",
        "utf8",
      );

      const prepareOutput = runFailure(linkedWorktree, "bash", [
        path.join(linkedWorktree, "scripts", "pr"),
        "prepare-gates",
      ]);
      const reviewOutput = runFailure(linkedWorktree, "bash", [
        path.join(linkedWorktree, "scripts", "pr"),
        "review-init",
      ]);

      expect(prepareOutput).toContain("Usage:");
      expect(prepareOutput).not.toContain("canonical-wrapper");
      expect(reviewOutput).toContain("canonical-wrapper");
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  it("uses changed tests for prepare gates and lease-retry gates", () => {
    const repo = createNonDocsDiffRepo();
    const callsPath = path.join(repo, "calls.log");
    mkdirSync(path.join(repo, ".local"));
    writeFileSync(path.join(repo, ".local", "pr-meta.env"), "PR_AUTHOR=alice\n", "utf8");

    try {
      const output = run(
        repo,
        "bash",
        [
          "-c",
          `
set -euo pipefail
source "$OPENCLAW_PR_COMMON_SH"
source "$OPENCLAW_PR_CHANGELOG_SH"
source "$OPENCLAW_PR_GATES_SH"

enter_worktree() { :; }
checkout_prep_branch() { :; }
bootstrap_deps_if_needed() { :; }
require_artifact() { [ -s "$1" ]; }
changelog_required_for_changed_files() { return 1; }
run_quiet_logged() { printf '%s\\n' "$*" >>"$OPENCLAW_TEST_CALLS"; }

prepare_gates 123
run_prepare_push_retry_gates false
`,
        ],
        {
          OPENCLAW_PR_COMMON_SH: commonScriptPath,
          OPENCLAW_PR_CHANGELOG_SH: changelogScriptPath,
          OPENCLAW_PR_GATES_SH: gatesScriptPath,
          OPENCLAW_TEST_CALLS: callsPath,
        },
      );
      const calls = readFileSync(callsPath, "utf8");

      expect(output).toContain("gates_mode=changed");
      expect(calls).toContain(
        "pnpm test:changed .local/gates-test.log env OPENCLAW_TEST_CHANGED_BROAD=1 pnpm test:changed\n",
      );
      expect(calls).toContain(
        "pnpm test:changed (lease-retry) .local/lease-retry-test.log env OPENCLAW_TEST_CHANGED_BROAD=1 pnpm test:changed\n",
      );
      expect(calls).not.toContain("pnpm test .local/gates-test.log pnpm test\n");
      expect(calls).not.toContain(
        "pnpm test (lease-retry) .local/lease-retry-test.log pnpm test\n",
      );
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });
});
