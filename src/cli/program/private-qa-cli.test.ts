// Experimental QA CLI tests cover QA command registration and filesystem behavior.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadExperimentalQaCliModule } from "./private-qa-cli.js";

describe("experimental QA CLI loader", () => {
  const tempDirs: string[] = [];
  const originalExperimentalQaCli = process.env.OPENCLAW_ENABLE_EXPERIMENTAL_QA_CLI;

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
    if (originalExperimentalQaCli === undefined) {
      delete process.env.OPENCLAW_ENABLE_EXPERIMENTAL_QA_CLI;
    } else {
      process.env.OPENCLAW_ENABLE_EXPERIMENTAL_QA_CLI = originalExperimentalQaCli;
    }
  });

  it("loads the bundled QA CLI module when experimental QA is enabled", async () => {
    process.env.OPENCLAW_ENABLE_EXPERIMENTAL_QA_CLI = "1";
    const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-qa-bundle-"));
    tempDirs.push(repoRoot);
    const expectedPaths = new Set([path.join(repoRoot, "dist", "plugin-sdk", "qa-lab.js")]);
    let importedSpecifier: string | undefined;
    const isQaLabCliAvailable = vi.fn();
    const registerQaLabCli = vi.fn();
    const importModule = vi.fn(async (specifier: string) => {
      importedSpecifier = specifier;
      return {
        isQaLabCliAvailable,
        registerQaLabCli,
      };
    });

    const module = await loadExperimentalQaCliModule({
      importModule,
      resolvePackageRootSync: () => repoRoot,
      existsSync: (filePath) => typeof filePath === "string" && expectedPaths.has(filePath),
    });

    expect(importModule).toHaveBeenCalledTimes(1);
    expect(importedSpecifier).toContain("/dist/plugin-sdk/qa-lab.js");
    expect(module.isQaLabCliAvailable).toBe(isQaLabCliAvailable);
    expect(module.registerQaLabCli).toBe(registerQaLabCli);
  });

  it("rejects when the bundled QA CLI module is missing", () => {
    process.env.OPENCLAW_ENABLE_EXPERIMENTAL_QA_CLI = "1";
    const repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-qa-missing-bundle-"));
    tempDirs.push(repoRoot);
    const importModule = vi.fn(async () => ({
      isQaLabCliAvailable: vi.fn(),
      registerQaLabCli: vi.fn(),
    }));

    expect(() =>
      loadExperimentalQaCliModule({
        importModule,
        resolvePackageRootSync: () => repoRoot,
        existsSync: () => false,
      }),
    ).toThrow("bundled QA Lab CLI module");
    expect(importModule).not.toHaveBeenCalled();
  });

  it("rejects when the experimental QA env flag is disabled", () => {
    delete process.env.OPENCLAW_ENABLE_EXPERIMENTAL_QA_CLI;
    const importModule = vi.fn(async () => ({}));

    expect(() => loadExperimentalQaCliModule({ importModule })).toThrow(
      "OPENCLAW_ENABLE_EXPERIMENTAL_QA_CLI=1",
    );
    expect(importModule).not.toHaveBeenCalled();
  });
});
