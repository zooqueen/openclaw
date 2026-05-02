import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { __testing, cleanupLegacyPluginDependencyState } from "./plugin-dependency-cleanup.js";

describe("cleanupLegacyPluginDependencyState", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-plugin-deps-cleanup-"));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("collects and removes legacy plugin dependency state without deleting current runtime deps", async () => {
    const stateDir = path.join(tempDir, "state");
    const packageRoot = path.join(tempDir, "package");
    const legacyLocalRoot = path.join(stateDir, ".local", "bundled-plugin-runtime-deps");
    const currentRuntimeRoot = path.join(
      stateDir,
      "plugin-runtime-deps",
      "openclaw-2026.4.30-abcdef123456",
    );
    const legacyExtensionNodeModules = path.join(
      packageRoot,
      "dist",
      "extensions",
      "demo",
      "node_modules",
    );
    const legacyManifest = path.join(
      packageRoot,
      "dist",
      "extensions",
      "demo",
      ".openclaw-runtime-deps.json",
    );

    await fs.mkdir(legacyLocalRoot, { recursive: true });
    await fs.mkdir(currentRuntimeRoot, { recursive: true });
    await fs.mkdir(legacyExtensionNodeModules, { recursive: true });
    await fs.writeFile(path.join(currentRuntimeRoot, "marker"), "ok");
    await fs.writeFile(legacyManifest, "{}");

    const env = { OPENCLAW_STATE_DIR: stateDir };
    const targets = await __testing.collectLegacyPluginDependencyTargets(env, { packageRoot });
    expect(targets).toEqual(
      expect.arrayContaining([legacyLocalRoot, legacyExtensionNodeModules, legacyManifest]),
    );
    expect(targets).not.toContain(path.join(stateDir, "plugin-runtime-deps"));
    expect(targets).not.toContain(currentRuntimeRoot);

    const result = await cleanupLegacyPluginDependencyState({ env, packageRoot });

    expect(result.warnings).toEqual([]);
    expect(result.changes.length).toBeGreaterThanOrEqual(3);
    await expect(fs.stat(legacyLocalRoot)).rejects.toThrow();
    await expect(fs.stat(legacyExtensionNodeModules)).rejects.toThrow();
    await expect(fs.stat(legacyManifest)).rejects.toThrow();
    await expect(fs.stat(currentRuntimeRoot)).resolves.toBeTruthy();
  });
});
