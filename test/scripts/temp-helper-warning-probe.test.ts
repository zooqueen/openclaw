import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("temp helper warning probe", () => {
  it("intentionally creates a bare temp dir for CI warning validation", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "openclaw-temp-helper-warning-probe-"));
    try {
      expect(fs.existsSync(tempDir)).toBe(true);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
