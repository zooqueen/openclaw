import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { isBundledSourceOverlayPath } from "./bundled-source-overlays.js";

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-source-overlay-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  vi.restoreAllMocks();
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("bundled source overlays", () => {
  it("reuses mount-point stat results inside a process", () => {
    const root = makeTempDir();
    const pluginDir = path.join(root, "extensions", "memory-core");
    fs.mkdirSync(pluginDir, { recursive: true });
    const statSpy = vi.spyOn(fs, "statSync");

    expect(isBundledSourceOverlayPath({ sourcePath: pluginDir, mountPoints: new Set() })).toBe(
      false,
    );
    const firstCallCount = statSpy.mock.calls.length;

    expect(isBundledSourceOverlayPath({ sourcePath: pluginDir, mountPoints: new Set() })).toBe(
      false,
    );

    expect(statSpy.mock.calls.length).toBe(firstCallCount);
  });
});
