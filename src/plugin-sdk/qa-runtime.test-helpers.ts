/**
 * Shared fixtures for QA Lab runtime facade tests.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, vi } from "vitest";

type QaRuntimeModule = {
  loadQaRuntimeModule: () => unknown;
};

type SurfaceLoaderMock = ReturnType<typeof vi.fn>;

/** Removes temporary source roots created by QA runtime tests. */
export function cleanupTempDirs(tempDirs: string[]): void {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** Restores the experimental QA CLI env flag after a test mutates it. */
export function restoreExperimentalQaCliEnv(originalExperimentalQaCli: string | undefined): void {
  if (originalExperimentalQaCli === undefined) {
    delete process.env.OPENCLAW_ENABLE_EXPERIMENTAL_QA_CLI;
  } else {
    process.env.OPENCLAW_ENABLE_EXPERIMENTAL_QA_CLI = originalExperimentalQaCli;
  }
}

/** Creates a minimal source checkout shape that enables experimental QA source runtime loading. */
export function makeExperimentalQaSourceRoot(tempDirs: string[], prefix: string): string {
  const sourceRoot = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(sourceRoot);
  fs.mkdirSync(path.join(sourceRoot, "src"), { recursive: true });
  fs.mkdirSync(path.join(sourceRoot, "extensions"), { recursive: true });
  fs.writeFileSync(path.join(sourceRoot, ".git"), "gitdir: /tmp/mock\n", "utf8");
  process.env.OPENCLAW_ENABLE_EXPERIMENTAL_QA_CLI = "1";
  return sourceRoot;
}

function makeQaRuntimeSurface() {
  return {
    defaultQaRuntimeModelForMode: vi.fn(),
    startQaLiveLaneGateway: vi.fn(),
  };
}

/** Asserts that the public QA Lab runtime facade loads from the bundled plugin surface. */
export async function expectQaLabRuntimeSurfaceLoad(params: {
  importRuntime: () => Promise<QaRuntimeModule>;
  loadBundledPluginPublicSurfaceModuleSync: SurfaceLoaderMock;
}) {
  const runtimeSurface = makeQaRuntimeSurface();
  params.loadBundledPluginPublicSurfaceModuleSync.mockReturnValue(runtimeSurface);

  const module = await params.importRuntime();

  expect(module.loadQaRuntimeModule()).toBe(runtimeSurface);
  expect(params.loadBundledPluginPublicSurfaceModuleSync).toHaveBeenCalledWith({
    dirName: "qa-lab",
    artifactBasename: "runtime-api.js",
  });
}

/** Asserts experimental QA loading rewrites bundled plugin lookup to the source extensions root. */
export async function expectExperimentalQaLabRuntimeSurfaceLoad(params: {
  tempDirs: string[];
  importRuntime: () => Promise<QaRuntimeModule>;
  loadBundledPluginPublicSurfaceModuleSync: SurfaceLoaderMock;
  resolveOpenClawPackageRootSync: SurfaceLoaderMock;
}) {
  const sourceRoot = makeExperimentalQaSourceRoot(params.tempDirs, "openclaw-qa-runtime-root-");
  params.resolveOpenClawPackageRootSync.mockReturnValue(sourceRoot);

  const runtimeSurface = makeQaRuntimeSurface();
  params.loadBundledPluginPublicSurfaceModuleSync.mockReturnValue(runtimeSurface);

  const module = await params.importRuntime();

  expect(module.loadQaRuntimeModule()).toBe(runtimeSurface);
  expect(params.loadBundledPluginPublicSurfaceModuleSync).toHaveBeenCalledWith({
    dirName: "qa-lab",
    artifactBasename: "runtime-api.js",
    env: expect.objectContaining({
      OPENCLAW_ENABLE_EXPERIMENTAL_QA_CLI: "1",
      OPENCLAW_BUNDLED_PLUGINS_DIR: path.join(sourceRoot, "extensions"),
    }),
  });
}
